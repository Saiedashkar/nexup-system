import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { execSync } from "node:child_process";
import path from "node:path";
import {
  createCapitalContribution,
  createCapitalSpend,
  getCapitalLedger,
  getCapitalSummary,
  getCapitalWithdrawalsByPerson,
  softDeleteCapitalSpend,
  updateCapitalSpend,
} from "@/lib/capital";
import { prisma, prismaRaw } from "@/lib/prisma";

/* Throwaway database lifecycle (local cluster on :5435) — same recipe as
   tests/capital.test.ts: ensure db → reset schema → prisma db push → run
   → drop. The Prisma pool binds ONCE to the stable URL .../capital_test
   (set by tests/capital-env.setup.ts). No test ever touches real Supabase. */
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
  // db push (not migrate deploy): same reasoning as capital.test.ts —
  // the historical chain has pre-existing drift on empty databases.
  execSync(`npx prisma db push --schema=prisma/schema.prisma --url "${DB_URL}"`, { env: ENV, stdio: "pipe", cwd: path.resolve(__dirname, "..") });
}, 240_000);

afterAll(async () => {
  try { await prisma.$disconnect(); } catch { /* ignore */ }
  try { psql(`DROP DATABASE IF EXISTS "${DB_NAME}" WITH (FORCE)`); } catch { /* ignore */ }
});

/** Raw counts of every accounting surface a PERSON_WITHDRAWAL must NEVER touch. */
async function separationCounts() {
  const [profitTransfers, partnerTransactions, poolTransactions, officeExpenses, clientPayments, profitLedger] =
    await Promise.all([
      prismaRaw.profitTransfer.count(),
      prismaRaw.partnerTransaction.count(),
      prismaRaw.poolTransaction.count(),
      prismaRaw.officeExpense.count(),
      prismaRaw.clientPayment.count(),
      prismaRaw.nexupProfitLedger.count(),
    ]);
  return { profitTransfers, partnerTransactions, poolTransactions, officeExpenses, clientPayments, profitLedger };
}

describe("Capital person withdrawals — acceptance chain", () => {
  let userId: string;
  let funderId: string;   // معتصم — contributes capital
  let adelId: string;     // عادل — withdraws from capital
  let saeedId: string;    // سعيد — withdraws from capital
  let adelSecondId: string; // Adel's second (2,000) movement id

  beforeAll(async () => {
    // Clean slate for the exact-numbers chain (throwaway DB → hard delete via raw client).
    await prismaRaw.capitalSpend.deleteMany({});
    await prismaRaw.capitalContribution.deleteMany({});

    const user = await prisma.user.create({
      data: { email: "cw-accept@example.local", name: "CW Test Admin", role: "SUPER_ADMIN", passwordHash: "x" },
    });
    const funder = await prisma.partner.create({ data: { name: "معتصم-CW" } });
    const adel = await prisma.partner.create({ data: { name: "عادل-CW" } });
    const saeed = await prisma.partner.create({ data: { name: "سعيد-CW" } });
    userId = user.id; funderId = funder.id; adelId = adel.id; saeedId = saeed.id;
  }, 60_000);

  it("1. capital IN 20,000 → received 20,000, spent 0, available 20,000; no person withdrawals yet", async () => {
    await createCapitalContribution({
      partnerId: funderId, amount: 20000, type: "CASH",
      date: new Date("2026-09-01"), description: "رأس مال للمكتب", userId,
    });
    const s = await getCapitalSummary();
    expect(s.totalReceived).toBe(20000);
    expect(s.totalSpent).toBe(0);
    expect(s.available).toBe(20000);
    expect(await getCapitalWithdrawalsByPerson()).toEqual([]);
  });

  it("2. Hermes 2,000 normal EXPENSE → available 18,000; person report still empty", async () => {
    await createCapitalSpend({
      amount: 2000, date: new Date("2026-09-02"), spendType: "EXPENSE",
      category: "مشتريات", description: "صرف Hermes", userId,
    });
    const s = await getCapitalSummary();
    expect(s.totalReceived).toBe(20000);
    expect(s.totalSpent).toBe(2000);
    expect(s.available).toBe(18000);
    expect(await getCapitalWithdrawalsByPerson()).toEqual([]);
  });

  it("3. Adel PERSON_WITHDRAWAL 3,000 → spent 5,000, available 15,000, Adel=3,000; profit accounting untouched", async () => {
    const before = await separationCounts();
    const w = await createCapitalSpend({
      amount: 3000, date: new Date("2026-09-03"), spendType: "PERSON_WITHDRAWAL",
      recipientPartnerId: adelId, description: "سحب نقدي شخصي", userId,
    });
    expect(w.spendType).toBe("PERSON_WITHDRAWAL");
    expect(w.recipientPartnerId).toBe(adelId);
    expect(w.recipientName).toBe("عادل-CW"); // readable snapshot at entry time

    const s = await getCapitalSummary();
    expect(s.totalReceived).toBe(20000);
    expect(s.totalSpent).toBe(5000);
    expect(s.available).toBe(15000);

    const report = await getCapitalWithdrawalsByPerson();
    expect(report).toHaveLength(1);
    expect(report[0]).toMatchObject({ recipientPartnerId: adelId, name: "عادل-CW", total: 3000, count: 1 });

    expect(await separationCounts()).toEqual(before); // ABSOLUTE separation
  });

  it("4. Saeed PERSON_WITHDRAWAL 1,000 → spent 6,000, available 14,000; report Adel=3,000 then Saeed=1,000", async () => {
    await createCapitalSpend({
      amount: 1000, date: new Date("2026-09-04"), spendType: "PERSON_WITHDRAWAL",
      recipientPartnerId: saeedId, description: "سحب نقدي شخصي", userId,
    });
    const s = await getCapitalSummary();
    expect(s.totalSpent).toBe(6000);
    expect(s.available).toBe(14000);

    const report = await getCapitalWithdrawalsByPerson();
    expect(report.map(r => [r.name, r.total])).toEqual([["عادل-CW", 3000], ["سعيد-CW", 1000]]);
  });

  it("5. Adel second 2,000 on a different date → separate ledger movement, Adel=5,000, available 12,000", async () => {
    const second = await createCapitalSpend({
      amount: 2000, date: new Date("2026-09-10"), spendType: "PERSON_WITHDRAWAL",
      recipientPartnerId: adelId, description: "سحب شخصي إضافي", userId,
    });
    adelSecondId = second.id;

    const report = await getCapitalWithdrawalsByPerson();
    const adel = report.find(r => r.recipientPartnerId === adelId);
    expect(adel).toMatchObject({ total: 5000, count: 2 });
    expect((await getCapitalSummary()).available).toBe(12000);

    // Each withdrawal remains its own dated ledger movement (never merged).
    const { entries } = await getCapitalLedger();
    const adelRows = entries.filter(e => e.type === "CAPITAL_SPEND" && e.recipientPartnerId === adelId);
    expect(adelRows).toHaveLength(2);
    expect(new Set(adelRows.map(r => r.date))).toHaveLength(2);
    expect(adelRows.map(r => r.spendType)).toEqual(["PERSON_WITHDRAWAL", "PERSON_WITHDRAWAL"]);
    expect(adelRows.every(r => r.recipientName === "عادل-CW")).toBe(true);
  });

  it("6. editing Adel's second withdrawal (amount + recipient) updates both Available Capital and person totals", async () => {
    await updateCapitalSpend({
      id: adelSecondId, userId,
      amount: 1500, date: new Date("2026-09-11"),
      recipientPartnerId: saeedId, recipientName: "سعيد-CW",
    });
    let report = await getCapitalWithdrawalsByPerson();
    expect(report.find(r => r.recipientPartnerId === adelId)).toMatchObject({ total: 3000, count: 1 });
    expect(report.find(r => r.recipientPartnerId === saeedId)).toMatchObject({ total: 2500, count: 2 });
    expect((await getCapitalSummary()).available).toBe(12500); // 20k − 2k − 3k − 1k − 1.5k

    // Restore the exact pre-edit state.
    await updateCapitalSpend({
      id: adelSecondId, userId,
      amount: 2000, date: new Date("2026-09-10"),
      recipientPartnerId: adelId, recipientName: "عادل-CW",
    });
    report = await getCapitalWithdrawalsByPerson();
    expect(report.find(r => r.recipientPartnerId === adelId)).toMatchObject({ total: 5000, count: 2 });
    expect(report.find(r => r.recipientPartnerId === saeedId)).toMatchObject({ total: 1000, count: 1 });
    expect((await getCapitalSummary()).available).toBe(12000);
  });

  it("7. ledger exposes classification + recipient for badges: EXPENSE rows have no recipient", async () => {
    const { entries } = await getCapitalLedger();
    const hermes = entries.find(e => e.description === "صرف Hermes");
    expect(hermes?.spendType).toBe("EXPENSE");
    expect(hermes?.recipientPartnerId).toBeNull();
    expect(hermes?.recipientName).toBeNull();
    const withdrawals = entries.filter(e => e.spendType === "PERSON_WITHDRAWAL");
    expect(withdrawals.length).toBe(3);
    expect(withdrawals.every(e => e.recipientName && e.recipientPartnerId)).toBe(true);
  });

  it("8. creating/editing/deleting a withdrawal leaves every protected accounting table byte-identical", async () => {
    const hassan = await prisma.partner.create({ data: { name: "حسن-CW" } });
    const before = await separationCounts();

    const w = await createCapitalSpend({
      amount: 500, date: new Date("2026-09-12"), spendType: "PERSON_WITHDRAWAL",
      recipientPartnerId: hassan.id, description: "سحب حسن", userId,
    });
    expect((await getCapitalSummary()).available).toBe(11500);

    await updateCapitalSpend({ id: w.id, userId, amount: 700, notes: "تعديل سحب" });
    await softDeleteCapitalSpend({ id: w.id, userId });

    expect(await separationCounts()).toEqual(before);
    expect((await getCapitalSummary()).available).toBe(12000);
    // حسن completely gone from the report after deletion.
    expect((await getCapitalWithdrawalsByPerson()).find(r => r.name === "حسن-CW")).toBeUndefined();
  });

  it("9. overspend protection applies to PERSON_WITHDRAWAL (INSUFFICIENT_CAPITAL)", async () => {
    await expect(
      createCapitalSpend({
        amount: 20000, date: new Date("2026-09-13"), spendType: "PERSON_WITHDRAWAL",
        recipientPartnerId: adelId, description: "سحب أكبر من المتاح", userId,
      }),
    ).rejects.toMatchObject({ code: "INSUFFICIENT_CAPITAL" });
    expect((await getCapitalSummary()).available).toBe(12000);
  });

  it("10. soft-deleting Adel's second 2,000 → Adel back to 3,000, available 14,000, row survives", async () => {
    await softDeleteCapitalSpend({ id: adelSecondId, userId });

    const s = await getCapitalSummary();
    expect(s.totalSpent).toBe(6000);
    expect(s.available).toBe(14000);

    const report = await getCapitalWithdrawalsByPerson();
    // Adel back to 3,000; Saeed's 1,000 withdrawal remains.
    expect(report.map(r => [r.name, r.total, r.count])).toEqual([
      ["عادل-CW", 3000, 1],
      ["سعيد-CW", 1000, 1],
    ]);

    const { entries } = await getCapitalLedger();
    expect(entries.filter(e => e.id === adelSecondId)).toHaveLength(0); // excluded from ledger

    const raw = await prismaRaw.capitalSpend.findUnique({ where: { id: adelSecondId } });
    expect(raw?.deletedAt).toBeTruthy(); // historical row survives (soft delete)
    expect(raw?.spendType).toBe("PERSON_WITHDRAWAL");
  });
});

describe("Capital spend classification — validation & backward compatibility", () => {
  let userId: string;
  let adelId: string;
  let saeedId: string;

  beforeAll(async () => {
    await prismaRaw.capitalSpend.deleteMany({});
    await prismaRaw.capitalContribution.deleteMany({});

    const user = await prisma.user.create({
      data: { email: "cw-valid@example.local", name: "CW Valid Admin", role: "SUPER_ADMIN", passwordHash: "x" },
    });
    const adel = await prisma.partner.create({ data: { name: "عادل-CW2" } });
    const saeed = await prisma.partner.create({ data: { name: "سعيد-CW2" } });
    userId = user.id; adelId = adel.id; saeedId = saeed.id;

    await createCapitalContribution({
      partnerId: adelId, amount: 5000, type: "CASH",
      date: new Date("2026-09-01"), description: "رأس مال اختبار", userId,
    });
  }, 60_000);

  it("11. historical compatibility: spend created WITHOUT spendType defaults to EXPENSE and behaves identically", async () => {
    const spend = await createCapitalSpend({
      amount: 1000, date: new Date("2026-09-02"),
      category: "تجهيزات", description: "صرف قديم الطراز", userId,
    });
    expect(spend.spendType).toBe("EXPENSE");
    expect(spend.recipientPartnerId).toBeNull();
    expect(spend.recipientName).toBeNull();

    let s = await getCapitalSummary();
    expect(s.totalSpent).toBe(1000);
    expect(s.available).toBe(4000);

    // Amount-only edit of a legacy-style row still works (no recipient validation).
    const updated = await updateCapitalSpend({ id: spend.id, userId, amount: 800 });
    expect(updated.spendType).toBe("EXPENSE");
    expect((await getCapitalSummary()).available).toBe(4200);
  });

  it("12. PERSON_WITHDRAWAL and CUSTODY without a structured recipient are rejected", async () => {
    await expect(
      createCapitalSpend({
        amount: 100, date: new Date("2026-09-03"), spendType: "PERSON_WITHDRAWAL",
        description: "بدون مستلم", userId,
      }),
    ).rejects.toMatchObject({ code: "RECIPIENT_REQUIRED" });

    await expect(
      createCapitalSpend({
        amount: 100, date: new Date("2026-09-03"), spendType: "CUSTODY",
        description: "بدون مستلم عهدة", userId,
      }),
    ).rejects.toMatchObject({ code: "RECIPIENT_REQUIRED" });

    expect((await getCapitalSummary()).totalSpent).toBe(800);
  });

  it("13. recipient fields on EXPENSE are rejected (RECIPIENT_NOT_ALLOWED)", async () => {
    await expect(
      createCapitalSpend({
        amount: 100, date: new Date("2026-09-03"), spendType: "EXPENSE",
        category: "مشتريات", recipientName: "عادل-CW2", description: "مصروف بمستلم", userId,
      }),
    ).rejects.toMatchObject({ code: "RECIPIENT_NOT_ALLOWED" });
  });

  it("14. unknown recipient partner is rejected (RECIPIENT_NOT_FOUND); invalid type rejected", async () => {
    await expect(
      createCapitalSpend({
        amount: 100, date: new Date("2026-09-03"), spendType: "PERSON_WITHDRAWAL",
        recipientPartnerId: "nonexistent-partner-id", description: "مستلم غير موجود", userId,
      }),
    ).rejects.toMatchObject({ code: "RECIPIENT_NOT_FOUND" });

    await expect(
      createCapitalSpend({
        amount: 100, date: new Date("2026-09-03"), spendType: "SALARY",
        recipientPartnerId: adelId, description: "نوع غير صالح", userId,
      }),
    ).rejects.toMatchObject({ code: "INVALID_SPEND_TYPE" });
  });

  it("15. CUSTODY reduces Available Capital but is EXCLUDED from the person-withdrawal report", async () => {
    const c = await createCapitalSpend({
      amount: 300, date: new Date("2026-09-04"), spendType: "CUSTODY",
      recipientName: "حازم-CW", description: "عهدة شراء", userId,
    });
    expect(c.spendType).toBe("CUSTODY");
    expect(c.recipientName).toBe("حازم-CW");
    expect((await getCapitalSummary()).available).toBe(3900);

    // Custody must not leak into per-person withdrawal totals.
    expect(await getCapitalWithdrawalsByPerson()).toEqual([]);

    await softDeleteCapitalSpend({ id: c.id, userId });
    expect((await getCapitalSummary()).available).toBe(4200);
  });

  it("16. unregistered person withdrawal: manual name snapshot lands in the report with null partner link", async () => {
    const w = await createCapitalSpend({
      amount: 250, date: new Date("2026-09-05"), spendType: "PERSON_WITHDRAWAL",
      recipientName: "محمود-CW", description: "سحب شخص غير مسجل", userId,
    });
    expect(w.recipientPartnerId).toBeNull();
    expect(w.recipientName).toBe("محمود-CW");

    const report = await getCapitalWithdrawalsByPerson();
    expect(report).toHaveLength(1);
    expect(report[0]).toMatchObject({ recipientPartnerId: null, name: "محمود-CW", total: 250, count: 1 });

    await softDeleteCapitalSpend({ id: w.id, userId });
    expect(await getCapitalWithdrawalsByPerson()).toEqual([]);
    expect((await getCapitalSummary()).available).toBe(4200);
  });

  it("17. reclassification: EXPENSE → PERSON_WITHDRAWAL requires recipient; switching back clears it", async () => {
    const spend = await createCapitalSpend({
      amount: 500, date: new Date("2026-09-06"),
      category: "مشتريات", description: "سيُعاد تصنيفه", userId,
    });
    expect((await getCapitalSummary()).available).toBe(3700);

    // Switching type without a recipient is refused.
    await expect(
      updateCapitalSpend({ id: spend.id, userId, spendType: "PERSON_WITHDRAWAL" }),
    ).rejects.toMatchObject({ code: "RECIPIENT_REQUIRED" });

    // With a recipient: reclassified, amount unchanged → balances unchanged.
    await updateCapitalSpend({ id: spend.id, userId, spendType: "PERSON_WITHDRAWAL", recipientPartnerId: saeedId });
    let report = await getCapitalWithdrawalsByPerson();
    expect(report).toHaveLength(1);
    expect(report[0]).toMatchObject({ recipientPartnerId: saeedId, name: "سعيد-CW2", total: 500, count: 1 });
    expect((await getCapitalSummary()).available).toBe(3700);

    // Switching back to EXPENSE with explicit nulls clears the recipient.
    await updateCapitalSpend({
      id: spend.id, userId, spendType: "EXPENSE",
      recipientPartnerId: null, recipientName: null,
    });
    const raw = await prismaRaw.capitalSpend.findUnique({ where: { id: spend.id } });
    expect(raw?.spendType).toBe("EXPENSE");
    expect(raw?.recipientPartnerId).toBeNull();
    expect(raw?.recipientName).toBeNull();
    expect(await getCapitalWithdrawalsByPerson()).toEqual([]);
  });

  it("18. mixed-classification ledger keeps running balances correct across all types", async () => {
    // State: IN 5,000 − EXPENSE 800 − WITHDRAWAL 500 = 3,700.
    const w = await createCapitalSpend({
      amount: 1200, date: new Date("2026-09-07"), spendType: "PERSON_WITHDRAWAL",
      recipientPartnerId: adelId, description: "سحب عادل", userId,
    });
    expect((await getCapitalSummary()).available).toBe(2500);

    const { entries, summary } = await getCapitalLedger();
    const chrono = [...entries].reverse();
    expect(chrono[0].type).toBe("CAPITAL_IN");
    expect(chrono[0].balanceAfter).toBe(5000);
    expect(chrono[1].balanceAfter).toBe(4200);
    expect(chrono[2].balanceAfter).toBe(3700);
    expect(chrono[3].balanceAfter).toBe(2500);
    expect(summary.available).toBe(2500);

    // Report: only Adel — the row reclassified in test 17 is an EXPENSE again.
    const report = await getCapitalWithdrawalsByPerson();
    expect(report.map(r => [r.name, r.total])).toEqual([["عادل-CW2", 1200]]);

    // Cleanup for a clean end state.
    await softDeleteCapitalSpend({ id: w.id, userId });
    expect((await getCapitalSummary()).available).toBe(3700);
  });
});
