import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { execSync } from "node:child_process";
import path from "node:path";
import { createCapitalContribution,
  createCapitalSpend,
  createFixedExpense,
  convertSpendToFixedExpense,
  generateDueFixedExpenses,
  getCapitalLedger,
  getCapitalSummary,
  softDeleteCapitalContribution,
  softDeleteCapitalSpend,
  updateCapitalContribution,
  updateCapitalSpend,
} from "@/lib/capital";
import { prisma, prismaRaw } from "@/lib/prisma";
import { softDeleteRecord } from "@/lib/soft-delete";

/* Throwaway database lifecycle (local cluster on :5434):
   ensure db → reset schema → prisma migrate deploy → run → drop.
   The Prisma pool binds ONCE to the stable URL .../capital_test
   (set by tests/capital-env.setup.ts), so no client re-binding is needed. */
const BASE_URL = process.env.TEST_DATABASE_URL || "postgresql://postgres:postgres@127.0.0.1:5435";
const DB_NAME = "capital_test";
const DB_URL = `${BASE_URL}/${DB_NAME}`;
const PSQL = `"${process.env.PSQL_BIN || "C:\\Program Files\\PostgreSQL\\18\\bin\\psql.exe"}" -h 127.0.0.1 -p ${new URL(BASE_URL).port || 5432} -U postgres`;
const ENV = { ...process.env, PGPASSWORD: "postgres", DATABASE_URL: DB_URL };

function psql(sql: string, db = "postgres") {
  return execSync(`${PSQL} -c "${sql.replace(/"/g, '\\"')}" -d ${db}`, { env: ENV, stdio: "pipe" });
}

beforeAll(async () => {
  try { psql(`DROP DATABASE IF EXISTS "${DB_NAME}" WITH (FORCE)`); } catch { /* may not exist */ }
  psql(`CREATE DATABASE "${DB_NAME}"`);
  // db push (not migrate deploy): the historical migration chain has
  // pre-existing drift on empty databases; production DBs only ever apply
  // the newest migrations, so this affects nothing outside this throwaway DB.
  execSync(`npx prisma db push --schema=prisma/schema.prisma --url "${DB_URL}"`, { env: ENV, stdio: "pipe", cwd: path.resolve(__dirname, "..") });
}, 240_000);

afterAll(async () => {
  try { await prisma.$disconnect(); } catch { /* ignore */ }
  try { psql(`DROP DATABASE IF EXISTS "${DB_NAME}" WITH (FORCE)`); } catch { /* ignore */ }
});

describe("Capital ledger — acceptance scenario", () => {
  let partnerId: string;
  let userId: string;

  beforeAll(async () => {
    const user = await prisma.user.create({
      data: {
        email: "capital-test@example.local", name: "Test Admin",
        role: "SUPER_ADMIN", passwordHash: "x",
      },
    });
    const partner = await prisma.partner.create({ data: { name: "متعصم-TEST" } });
    userId = user.id;
    partnerId = partner.id;
  });

  it("1. capital in 20,000 → received 20,000, spent 0, available 20,000", async () => {
    const contrib = await createCapitalContribution({
      partnerId, amount: 20000, type: "CASH",
      date: new Date("2026-09-01"), description: "رأس مال للمكتب",
      userId,
    });
    expect(contrib.currency).toBe("EGP");

    const s = await getCapitalSummary();
    expect(s.totalReceived).toBe(20000);
    expect(s.totalSpent).toBe(0);
    expect(s.available).toBe(20000);
  });

  it("2. spend 10,000 (تجهيزات تأسيس المكتب) → available 10,000", async () => {
    await createCapitalSpend({
      amount: 10000, date: new Date("2026-09-05"),
      category: "تجهيزات", description: "تجهيزات تأسيس المكتب", userId,
    });

    const s = await getCapitalSummary();
    expect(s.totalReceived).toBe(20000);
    expect(s.totalSpent).toBe(10000);
    expect(s.available).toBe(10000);
  });

  it("3. spend 2,000 subscription + convert to recurring → capital −2,000 only, recurring starts NEXT month, no double count", async () => {
    const spend = await createCapitalSpend({
      amount: 2000, date: new Date("2026-09-10"),
      category: "اشتراكات", description: "اشتراك خدمة X", userId,
    });

    // Capital view: spent becomes 12,000; available 8,000.
    let s = await getCapitalSummary();
    expect(s.totalSpent).toBe(12000);
    expect(s.available).toBe(8000);

    // Convert → recurring definition must start 2026-10-01 (month after spend).
    const { def } = await convertSpendToFixedExpense({
      spendId: spend.id, recurringAmount: 2000, name: "اشتراك خدمة X", userId,
    });
    expect(def.startDate.getUTCMonth()).toBe(9); // October
    expect(def.startDate.getUTCFullYear()).toBe(2026);

    // Generating occurrences now (still September) must NOT create one for
    // September — the recurring engine starts next month.
    const gen = await generateDueFixedExpenses(new Date("2026-09-30"));
    const recurringRows = (await prisma.officeExpense.findMany()).filter(e => e.fixedExpenseId === def.id);
    expect(recurringRows).toHaveLength(0);
    expect(gen.created).toBe(0);

    // Total office expenses remain untouched by the capital spend (2,000
    // exists ONLY as capital spend, never as OfficeExpense).
    const totalOffice = (await prisma.officeExpense.findMany()).reduce((sum, e) => sum + e.cost, 0);
    expect(totalOffice).toBe(0);

    // In October, exactly ONE occurrence materializes.
    const genOct = await generateDueFixedExpenses(new Date("2026-10-31"));
    expect(genOct.created).toBe(1);
    const octRows = (await prisma.officeExpense.findMany()).filter(e => e.fixedExpenseId === def.id);
    expect(octRows).toHaveLength(1);
    expect(octRows[0].month).toBe(10);
    expect(octRows[0].year).toBe(2026);
    expect(octRows[0].category).toBe("FIXED");

    // Idempotent rerun creates nothing new.
    const genAgain = await generateDueFixedExpenses(new Date("2026-10-31"));
    expect(genAgain.created).toBe(0);
    expect((await prisma.officeExpense.findMany()).filter(e => e.fixedExpenseId === def.id)).toHaveLength(1);

    // Capital unchanged by recurring generation: still 12,000 spent / 8,000.
    s = await getCapitalSummary();
    expect(s.totalSpent).toBe(12000);
    expect(s.available).toBe(8000);
  });

  it("4. spend 3,000 (مشتريات المكتب) → received 20,000, spent 15,000, available 5,000", async () => {
    await createCapitalSpend({
      amount: 3000, date: new Date("2026-09-20"),
      category: "مشتريات", description: "مشتريات وتجهيزات للمكتب", userId,
    });

    const s = await getCapitalSummary();
    expect(s.totalReceived).toBe(20000);
    expect(s.totalSpent).toBe(15000);
    expect(s.available).toBe(5000);
  });

  it("5. ledger shows chronological movements with correct running balance", async () => {
    const { entries, summary } = await getCapitalLedger();
    expect(entries).toHaveLength(4); // 1 IN + 3 SPENDs

    // API returns newest first; reverse into chronological order.
    const chronological = [...entries].reverse();
    expect(chronological[0].type).toBe("CAPITAL_IN");
    expect(chronological[0].balanceAfter).toBe(20000);
    expect(chronological[1].balanceAfter).toBe(10000);
    expect(chronological[2].balanceAfter).toBe(8000);
    expect(chronological[3].balanceAfter).toBe(5000);

    // The subscription spend is marked recurring after conversion.
    const subscription = chronological[2];
    expect(subscription.description).toContain("اشتراك");
    expect(subscription.recurring).toBe(true);

    expect(summary.available).toBe(5000);
    expect(summary.funderCount).toBe(1);
  });

  it("6. cannot spend more than available capital (overspend guard)", async () => {
    await expect(
      createCapitalSpend({
        amount: 5001, date: new Date("2026-09-25"),
        category: "اختبار", description: "صرف أكبر من المتاح", userId,
      }),
    ).rejects.toMatchObject({ code: "INSUFFICIENT_CAPITAL" });

    // Boundary: spending exactly the available balance is allowed, then
    // available reaches 0 and further spend is rejected.
    await createCapitalSpend({
      amount: 5000, date: new Date("2026-09-26"),
      category: "اختبار", description: "صرف الرصيد المتبقي بالكامل", userId,
    });
    const s = await getCapitalSummary();
    expect(s.available).toBe(0);

    await expect(
      createCapitalSpend({
        amount: 1, date: new Date("2026-09-27"),
        category: "اختبار", description: "صرف بعد نفاد الرصيد", userId,
      }),
    ).rejects.toMatchObject({ code: "INSUFFICIENT_CAPITAL" });
  });

  it("7. validation: non-positive, non-finite and >2dp amounts are rejected", async () => {
    await expect(createCapitalSpend({ amount: 0, date: new Date(), category: "c", description: "d", userId })).rejects.toMatchObject({ code: "INVALID_AMOUNT" });
    await expect(createCapitalSpend({ amount: -5, date: new Date(), category: "c", description: "d", userId })).rejects.toMatchObject({ code: "INVALID_AMOUNT" });
    await expect(createCapitalSpend({ amount: Number.NaN, date: new Date(), category: "c", description: "d", userId })).rejects.toMatchObject({ code: "INVALID_AMOUNT" });
    await expect(createCapitalSpend({ amount: 10.999, date: new Date(), category: "c", description: "d", userId })).rejects.toMatchObject({ code: "INVALID_AMOUNT" });
    await expect(createCapitalContribution({ partnerId, amount: 100.005, type: "CASH", date: new Date(), userId })).rejects.toMatchObject({ code: "INVALID_AMOUNT" });
  });

  it("8. treasury isolation: capital never moves Revenue/treasury aggregates", async () => {
    // The capital rows live in their own tables; nothing wrote to
    // OfficeExpense / ProfitTransfer / business PoolTransactions.
    const [officeExpenses, profitTransfers, poolTx, capitalSpendRows] = await Promise.all([
      prisma.officeExpense.findMany(),
      prisma.profitTransfer.findMany(),
      prisma.poolTransaction.findMany(),
      prisma.capitalSpend.findMany(),
    ]);
    expect(profitTransfers).toHaveLength(0);
    expect(poolTx).toHaveLength(0);
    // Only the October recurring occurrence exists as an office expense.
    expect(officeExpenses).toHaveLength(1);
    // All capital movements are CapitalSpend rows (1 IN + 3 spends + boundary spend).
    expect(capitalSpendRows).toHaveLength(4);
  });

  it("9. ASSET contributions are documented but not spendable", async () => {
    await createCapitalContribution({
      partnerId, amount: 7000, type: "ASSET",
      date: new Date("2026-09-28"), description: "أصل مقدَّم", userId,
    });
    const s = await getCapitalSummary();
    // Received stays 20,000 (CASH only); ASSET does not become spendable.
    expect(s.totalReceived).toBe(20000);
    expect(s.available).toBe(0);
  });

  it("10. invalid dates are rejected", async () => {
    await expect(
      createCapitalSpend({ amount: 1, date: new Date("garbage"), category: "c", description: "d", userId }),
    ).rejects.toBeTruthy();
  });
});

describe("Capital soft-delete isolation (Issue 2)", () => {
  let partnerId: string;
  let userId: string;

  beforeAll(async () => {
    const user = await prisma.user.create({
      data: {
        email: "capital-sd-test@example.local", name: "SD Test Admin",
        role: "SUPER_ADMIN", passwordHash: "x",
      },
    });
    const partner = await prisma.partner.create({ data: { name: "مموّل-TEST-SD" } });
    userId = user.id;
    partnerId = partner.id;
  });

  it("11. soft-deleted contributions vanish from summary/ledger/counts but keep their row", async () => {
    const before = await getCapitalSummary();

    const keep = await createCapitalContribution({
      partnerId, amount: 12000, type: "CASH",
      date: new Date("2026-09-01"), description: "مساهمة تبقى", userId,
    });
    const drop = await createCapitalContribution({
      partnerId, amount: 3000, type: "CASH",
      date: new Date("2026-09-02"), description: "مساهمة تُحذف", userId,
    });

    let s = await getCapitalSummary();
    expect(s.totalReceived).toBe(before.totalReceived + 15000);
    expect(s.contributionCount).toBe(before.contributionCount + 2);
    expect(s.funderCount).toBe(before.funderCount + 1);

    await softDeleteRecord("CapitalContribution", drop.id, userId);

    s = await getCapitalSummary();
    expect(s.totalReceived).toBe(before.totalReceived + 12000);
    expect(s.contributionCount).toBe(before.contributionCount + 1);
    expect(s.funderCount).toBe(before.funderCount + 1); // keep-contribution still active

    const { entries } = await getCapitalLedger();
    expect(entries.filter(e => e.type === "CAPITAL_IN" && e.id === drop.id)).toHaveLength(0);
    expect(entries.filter(e => e.type === "CAPITAL_IN" && e.id === keep.id)).toHaveLength(1);

    // No hard delete: the historical row survives with its deletedAt stamp.
    const raw = await prismaRaw.capitalContribution.findUnique({ where: { id: drop.id } });
    expect(raw?.deletedAt).toBeTruthy();

    // Deleting the funder's last active contribution removes them from funderCount.
    await softDeleteRecord("CapitalContribution", keep.id, userId);
    s = await getCapitalSummary();
    expect(s.funderCount).toBe(before.funderCount);
  });

  it("12. soft-deleted spends restore available capital and leave the ledger", async () => {
    const before = await getCapitalSummary();

    await createCapitalContribution({
      partnerId, amount: 1000, type: "CASH",
      date: new Date("2026-09-03"), userId,
    });
    const spend = await createCapitalSpend({
      amount: 400, date: new Date("2026-09-04"),
      category: "اختبار", description: "صرف سيُحذف", userId,
    });

    let s = await getCapitalSummary();
    expect(s.available).toBe(before.available + 600);

    await softDeleteRecord("CapitalSpend", spend.id, userId);

    s = await getCapitalSummary();
    expect(s.totalSpent).toBe(before.totalSpent);
    expect(s.spendCount).toBe(before.spendCount);
    expect(s.available).toBe(before.available + 1000);

    const { entries } = await getCapitalLedger();
    expect(entries.filter(e => e.type === "CAPITAL_SPEND" && e.id === spend.id)).toHaveLength(0);

    const raw = await prismaRaw.capitalSpend.findUnique({ where: { id: spend.id } });
    expect(raw?.deletedAt).toBeTruthy();
  });

  it("13. soft-deleted FixedExpense stops generating occurrences", async () => {
    const def = await createFixedExpense({
      name: "اشتراك-TEST-SD", amount: 100,
      startDate: new Date("2026-09-01"), userId,
    });

    await generateDueFixedExpenses(new Date("2026-09-30"));
    const rowsBefore = (await prisma.officeExpense.findMany()).filter(e => e.fixedExpenseId === def.id);
    expect(rowsBefore.length).toBeGreaterThanOrEqual(1);

    await softDeleteRecord("FixedExpense", def.id, userId);

    // Rerun: the deleted definition must be excluded → no new occurrences.
    await generateDueFixedExpenses(new Date("2026-10-31"));
    const rowsAfter = (await prisma.officeExpense.findMany()).filter(e => e.fixedExpenseId === def.id);
    expect(rowsAfter.length).toBe(rowsBefore.length);

    // The extended client hides soft-deleted definitions from normal reads.
    expect(await prisma.fixedExpense.findUnique({ where: { id: def.id } })).toBeNull();
  });
});

describe("Capital management actions — edit & soft delete (regression fix)", () => {
  let partnerId: string;
  let userId: string;
  let contribId: string;

  const toChrono = (entries: Awaited<ReturnType<typeof getCapitalLedger>>["entries"]) =>
    [...entries].reverse();

  beforeAll(async () => {
    // Clean slate for the exact-numbers scenario: prior describes already
    // asserted against their own accumulated state. Throwaway DB → hard
    // delete via the raw client is safe and keeps summary math exact.
    await prismaRaw.capitalSpend.deleteMany({});
    await prismaRaw.capitalContribution.deleteMany({});

    const user = await prisma.user.create({
      data: {
        email: "capital-mgmt-test@example.local", name: "Mgmt Test Admin",
        role: "SUPER_ADMIN", passwordHash: "x",
      },
    });
    const partner = await prisma.partner.create({ data: { name: "مموّل-TEST-MGMT" } });
    userId = user.id;
    partnerId = partner.id;
  }, 60_000);

  it("14. edit contribution IN PLACE: fields update, same row, no new record", async () => {
    const contrib = await createCapitalContribution({
      partnerId, amount: 20000, type: "CASH",
      date: new Date("2026-09-01"), description: "رأس مال للمكتب", userId,
    });
    contribId = contrib.id;

    const partnerB = await prisma.partner.create({ data: { name: "مموّل-TEST-MGMT-B" } });
    const updated = await updateCapitalContribution({
      id: contrib.id,
      userId,
      partnerId: partnerB.id,
      amount: 20000,
      date: new Date("2026-09-02"),
      description: "وصف معدّل",
      reference: "REF-1",
      fundFlow: "STILL_IN_TREASURY",
    });

    // Same row edited — never a new contribution.
    expect(updated.id).toBe(contrib.id);
    expect(updated.description).toBe("وصف معدّل");
    expect(updated.reference).toBe("REF-1");
    expect(updated.fundFlow).toBe("STILL_IN_TREASURY");
    expect(new Date(updated.date).getUTCDate()).toBe(2);

    const s = await getCapitalSummary();
    expect(s.totalReceived).toBe(20000);
    expect(s.contributionCount).toBe(1); // no duplicate row created

    const { entries } = await getCapitalLedger();
    const inEntry = entries.find(e => e.type === "CAPITAL_IN");
    expect(inEntry?.id).toBe(contrib.id);
    expect(inEntry?.funder).toBe("مموّل-TEST-MGMT-B");
    expect(inEntry?.description).toBe("وصف معدّل");
    expect(inEntry?.fundFlow).toBe("STILL_IN_TREASURY");
    expect(inEntry?.balanceAfter).toBe(20000);
  });

  it("15. 20,000 IN → spend 10,000 → available 10,000", async () => {
    const spend = await createCapitalSpend({
      amount: 10000, date: new Date("2026-09-05"),
      category: "تجهيزات", description: "تجهيزات تأسيس المكتب", userId,
    });
    expect(spend.id).toBeTruthy();

    const s = await getCapitalSummary();
    expect(s.totalReceived).toBe(20000);
    expect(s.totalSpent).toBe(10000);
    expect(s.available).toBe(10000);
  });

  it("16. edit spend 10,000 → 8,000 → available 12,000 (PATCH updates same row)", async () => {
    const { entries: before } = await getCapitalLedger();
    const spendEntry = before.find(e => e.type === "CAPITAL_SPEND");
    expect(spendEntry).toBeTruthy();

    const updated = await updateCapitalSpend({
      id: spendEntry!.id,
      userId,
      amount: 8000,
      date: new Date("2026-09-06"),
      category: "تجهيزات",
      description: "تجهيزات معدّلة",
      notes: "ملاحظة التعديل",
      reference: "REF-8",
      contributionId: contribId,
    });

    expect(updated.id).toBe(spendEntry!.id);
    expect(updated.amount).toBe(8000);
    expect(updated.description).toBe("تجهيزات معدّلة");
    expect(updated.contributionId).toBe(contribId);

    const s = await getCapitalSummary();
    expect(s.totalSpent).toBe(8000);
    expect(s.available).toBe(12000);

    const { entries } = await getCapitalLedger();
    const chrono = toChrono(entries);
    expect(chrono).toHaveLength(2);
    expect(chrono[0].balanceAfter).toBe(20000);
    expect(chrono[1].balanceAfter).toBe(12000); // running balance recalculated
    expect(chrono[1].amount).toBe(8000);
    expect(chrono[1].contributionId).toBe(contribId);
  });

  it("17. delete spend → available back to 20,000; row soft-deleted and excluded from ledger", async () => {
    const { entries: before } = await getCapitalLedger();
    const spendEntry = before.find(e => e.type === "CAPITAL_SPEND");
    expect(spendEntry).toBeTruthy();

    await softDeleteCapitalSpend({ id: spendEntry!.id, userId });

    const s = await getCapitalSummary();
    expect(s.totalSpent).toBe(0);
    expect(s.available).toBe(20000); // derived: deletion restored the amount
    expect(s.spendCount).toBe(0);

    const { entries } = await getCapitalLedger();
    expect(entries.filter(e => e.type === "CAPITAL_SPEND")).toHaveLength(0);
    expect(entries.find(e => e.type === "CAPITAL_IN")?.balanceAfter).toBe(20000);

    // Soft delete: the historical row survives with deletedAt.
    const raw = await prismaRaw.capitalSpend.findUnique({ where: { id: spendEntry!.id } });
    expect(raw?.deletedAt).toBeTruthy();
  });

  it("18. new 5,000 spend; spend-edit guards: overspend/invalid amount rejected, boundary allowed", async () => {
    const spend = await createCapitalSpend({
      amount: 5000, date: new Date("2026-09-07"),
      category: "مشتريات", description: "صرف جديد بعد الحذف", userId,
    });
    const s = await getCapitalSummary();
    expect(s.available).toBe(15000);

    // Increase beyond available: delta 15,001 > available 15,000.
    await expect(
      updateCapitalSpend({ id: spend.id, userId, amount: 20001 }),
    ).rejects.toMatchObject({ code: "INSUFFICIENT_CAPITAL" });

    // Invalid edit payloads are rejected.
    await expect(updateCapitalSpend({ id: spend.id, userId, amount: 0 })).rejects.toMatchObject({ code: "INVALID_AMOUNT" });
    await expect(updateCapitalSpend({ id: spend.id, userId, amount: 10.999 })).rejects.toMatchObject({ code: "INVALID_AMOUNT" });
    await expect(updateCapitalSpend({ id: spend.id, userId, description: "   " })).rejects.toMatchObject({ code: "MISSING_DESCRIPTION" });
    await expect(updateCapitalSpend({ id: spend.id, userId, date: new Date("garbage") })).rejects.toMatchObject({ code: "INVALID_DATE" });
    await expect(updateCapitalSpend({ id: spend.id, userId, contributionId: "nonexistent" })).rejects.toMatchObject({ code: "CONTRIBUTION_NOT_FOUND" });

    // Boundary: increasing by exactly the available balance is allowed, then restored.
    await updateCapitalSpend({ id: spend.id, userId, amount: 20000 });
    expect((await getCapitalSummary()).available).toBe(0);
    await updateCapitalSpend({ id: spend.id, userId, amount: 5000 });
    expect((await getCapitalSummary()).available).toBe(15000);
  });

  it("19. reducing Capital IN below existing spends is rejected; boundary allowed", async () => {
    // Reduce 20,000 → 4,999 with 5,000 already spent: would leave −1.
    await expect(
      updateCapitalContribution({ id: contribId, userId, amount: 4999 }),
    ).rejects.toMatchObject({ code: "INSUFFICIENT_CAPITAL" });

    // Boundary: reduce to exactly the spent amount → available 0, allowed.
    await updateCapitalContribution({ id: contribId, userId, amount: 5000 });
    expect((await getCapitalSummary()).available).toBe(0);

    // CASH → ASSET would remove the whole 5,000 from the spendable pool.
    await expect(
      updateCapitalContribution({ id: contribId, userId, type: "ASSET" }),
    ).rejects.toMatchObject({ code: "INSUFFICIENT_CAPITAL" });

    // Restore.
    await updateCapitalContribution({ id: contribId, userId, amount: 20000 });
    expect((await getCapitalSummary()).available).toBe(15000);

    const s = await getCapitalSummary();
    expect(s.contributionCount).toBe(1); // edits never duplicated the row
  });

  it("20. deleting Capital IN that would make the balance negative is rejected with an Arabic message", async () => {
    const err = await softDeleteCapitalContribution({ id: contribId, userId }).then(
      () => null,
      (e: { code: string; message: string }) => e,
    );
    expect(err).not.toBeNull();
    expect(err!.code).toBe("INSUFFICIENT_CAPITAL");
    expect(err!.message).toContain("لا يمكن حذف هذه المساهمة");
    expect(err!.message).toContain("احذف أو عدّل حركات الصرف");

    // Nothing was deleted: the row and the ledger are untouched.
    const { entries } = await getCapitalLedger();
    expect(entries.filter(e => e.type === "CAPITAL_IN" && e.id === contribId)).toHaveLength(1);
    expect((await getCapitalSummary()).totalReceived).toBe(20000);
  });

  it("21. recurring-linked spend delete requires explicit force; OfficeExpense history preserved", async () => {
    const spend = await createCapitalSpend({
      amount: 700, date: new Date("2026-09-08"),
      category: "اشتراكات", description: "اشتراك إدارة", userId,
    });
    const { def } = await convertSpendToFixedExpense({
      spendId: spend.id, recurringAmount: 700, name: "اشتراك إدارة", userId,
    });
    await generateDueFixedExpenses(new Date("2026-10-31"));
    const occurrencesBefore = (await prisma.officeExpense.findMany()).filter(e => e.fixedExpenseId === def.id);
    expect(occurrencesBefore.length).toBeGreaterThanOrEqual(1);

    const { entries } = await getCapitalLedger();
    expect(entries.find(e => e.id === spend.id)?.recurring).toBe(true);

    // First attempt: refused, showing what is linked.
    const err = await softDeleteCapitalSpend({ id: spend.id, userId }).then(
      () => null,
      (e: { code: string; message: string }) => e,
    );
    expect(err).not.toBeNull();
    expect(err!.code).toBe("RECURRING_LINKED");
    expect(err!.message).toContain("اشتراك إدارة");

    // Nothing deleted yet.
    expect(await prisma.capitalSpend.findUnique({ where: { id: spend.id } })).not.toBeNull();

    // Explicit force: soft-delete the spend AND deactivate the recurrence.
    await softDeleteCapitalSpend({ id: spend.id, userId, force: true });

    const rawDef = await prismaRaw.fixedExpense.findUnique({ where: { id: def.id } });
    expect(rawDef?.active).toBe(false); // stopped, never destroyed
    const occurrencesAfter = (await prisma.officeExpense.findMany()).filter(e => e.fixedExpenseId === def.id);
    expect(occurrencesAfter.length).toBe(occurrencesBefore.length); // history intact

    const s = await getCapitalSummary();
    expect(s.available).toBe(15000); // 700 returned to available
    const { entries: after } = await getCapitalLedger();
    expect(after.find(e => e.id === spend.id)).toBeUndefined();
    const raw = await prismaRaw.capitalSpend.findUnique({ where: { id: spend.id } });
    expect(raw?.deletedAt).toBeTruthy();
  });

  it("22. successful Capital IN soft delete: excluded from totals/ledger, row survives", async () => {
    const extra = await createCapitalContribution({
      partnerId, amount: 1000, type: "CASH",
      date: new Date("2026-09-09"), description: "مساهمة إضافية تُحذف", userId,
    });
    expect((await getCapitalSummary()).available).toBe(16000);

    const deleted = await softDeleteCapitalContribution({ id: extra.id, userId });
    expect((deleted as { deletedAt: Date | null }).deletedAt).toBeTruthy();

    const s = await getCapitalSummary();
    expect(s.available).toBe(15000);
    expect(s.contributionCount).toBe(1);
    expect(s.funderCount).toBe(1);

    const { entries } = await getCapitalLedger();
    const inRows = entries.filter(e => e.type === "CAPITAL_IN");
    expect(inRows).toHaveLength(1);
    expect(inRows[0].id).toBe(contribId);
    expect(inRows[0].balanceAfter).toBe(20000);

    const raw = await prismaRaw.capitalContribution.findUnique({ where: { id: extra.id } });
    expect(raw?.deletedAt).toBeTruthy();
  });
});
