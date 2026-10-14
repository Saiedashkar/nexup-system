import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { execSync } from "node:child_process";
import path from "node:path";
import { computeCapitalMetrics, getCapitalMetrics, getOfficeTreasury } from "@/lib/capital-metrics";
import {
  createCapitalContribution,
  createCapitalSpend,
  softDeleteCapitalContribution,
  getCapitalSummary,
  getCapitalLedger,
} from "@/lib/capital";
import { prisma, prismaRaw } from "@/lib/prisma";

/* ═══════════════════════════════════════════════════════════════════════
   Capital metrics — the definitions that must hold everywhere.

   Part 1 is PURE (no database): the allocation rules the business stated.
   Part 2 runs the REAL services against the throwaway local cluster and
   reproduces the production shape that produced the phantom 21,500.
   ═══════════════════════════════════════════════════════════════════════ */

const BASE_URL = process.env.TEST_DATABASE_URL || "postgresql://postgres:postgres@127.0.0.1:5435";
const DB_NAME = "capital_test";
const DB_URL = `${BASE_URL}/${DB_NAME}`;
const PSQL = `"${process.env.PSQL_BIN || "C:\\Program Files\\PostgreSQL\\18\\bin\\psql.exe"}" -h 127.0.0.1 -p ${new URL(BASE_URL).port || 5432} -U postgres`;
const ENV = { ...process.env, PGPASSWORD: "postgres", DATABASE_URL: DB_URL };

function psql(sql: string, db = "postgres") {
  return execSync(`${PSQL} -c "${sql.replace(/"/g, '\\"')}" -d ${db}`, { env: ENV, stdio: "pipe" });
}

const cash = (id: string, amount: number, fundFlow: string, cur = "EGP") => ({
  id, amount, type: "CASH", fundFlow, currency: cur,
});
const asset = (id: string, amount: number) => ({
  id, amount, type: "ASSET", fundFlow: "SPENT_ALREADY", currency: "EGP",
});
const spend = (id: string, amount: number, contributionId: string | null, date = "2026-09-10") => ({
  id, amount, contributionId, date,
});

describe("capital metrics — pure allocation rules", () => {
  it("1. available funding 10,000 spent 3,000 then 2,000 → funding 10,000, remaining 5,000", () => {
    const m = computeCapitalMetrics({
      contributions: [cash("c1", 10000, "STILL_IN_TREASURY")],
      spends: [spend("s1", 3000, "c1", "2026-09-05"), spend("s2", 2000, "c1", "2026-09-06")],
    });
    // Total funding is a record of what came in — spending never erases it.
    expect(m.cashFundingReceived).toBe(10000);
    expect(m.totalSpent).toBe(5000);
    expect(m.availableFund).toBe(5000);
    // The cash that really entered the office and is still there.
    expect(m.cashFundingInTreasury).toBe(10000);
    expect(m.availableCashInTreasury).toBe(5000);
    expect(m.reconciliationWarnings).toHaveLength(0);
  });

  it("2. funding 8,500 recorded as already spent → total funding +8,500, available cash UNCHANGED", () => {
    const m = computeCapitalMetrics({
      contributions: [cash("c1", 8500, "SPENT_ALREADY")],
      spends: [],
    });
    expect(m.cashFundingReceived).toBe(8500);
    expect(m.cashFundingSpentAlready).toBe(8500);
    // Money the partner spent directly never entered the office: it cannot
    // become available cash just because there is no spend row for it.
    expect(m.cashFundingInTreasury).toBe(0);
    expect(m.availableCashInTreasury).toBe(0);
    expect(m.cashInTreasuryNet).toBe(0);
  });

  it("3. an in-kind contribution is shown separately and adds no cash", () => {
    const m = computeCapitalMetrics({
      contributions: [cash("c1", 10000, "STILL_IN_TREASURY"), asset("a1", 8500)],
      spends: [],
    });
    expect(m.assetFunding).toBe(8500);
    expect(m.assetContributionCount).toBe(1);
    expect(m.cashFundingReceived).toBe(10000);
    expect(m.totalFundingInclAssets).toBe(18500);
    // Rule 4: in-kind never increases available cash.
    expect(m.availableCashInTreasury).toBe(10000);
    expect(m.availableFund).toBe(10000);
  });

  it("4. an opening settlement is mirrored by already-spent funding → it never touches cash", () => {
    const m = computeCapitalMetrics({
      contributions: [cash("c1", 74260, "SPENT_ALREADY"), cash("c2", 21500, "STILL_IN_TREASURY")],
      spends: [spend("settle", 74260, null, "2026-09-01")],
    });
    expect(m.alreadySpentMirrorSpend).toBe(74260);
    expect(m.treasuryDrawSpend).toBe(0);
    // The settlement did NOT draw the treasury down — that was the old bug.
    expect(m.availableCashInTreasury).toBe(21500);
    expect(m.unfundedFromTreasury).toBe(0);
    expect(m.unmatchedAlreadySpentFunding).toBe(0);
  });

  it("5. reproduction of the 21,500 problem: cash 21,500 with 22,000 linked spends", () => {
    const linked = [
      spend("sp1", 760, "c2", "2026-09-29"), spend("sp2", 360, "c2", "2026-09-29"),
      spend("sp3", 600, "c2", "2026-09-29"), spend("sp4", 400, "c2", "2026-09-29"),
      spend("sp5", 100, "c2", "2026-09-28"), spend("sp6", 500, "c2", "2026-09-28"),
      spend("sp7", 1200, "c2", "2026-09-26"), spend("sp8", 900, "c2", "2026-09-24"),
      spend("sp9", 500, "c2", "2026-09-17"), spend("sp10", 1100, "c2", "2026-09-20"),
      spend("sp11", 2400, "c2", "2026-09-20"), spend("sp12", 1000, "c2", "2026-09-20"),
      spend("sp13", 1500, "c2", "2026-09-20"), spend("sp14", 980, "c2", "2026-09-28"),
      spend("sp15", 6650, "c2", "2026-09-28"), spend("sp16", 3050, "c2", "2026-09-28"),
    ];
    const m = computeCapitalMetrics({
      contributions: [
        cash("c1", 74760, "SPENT_ALREADY"),   // including the 500 recorded later
        cash("c2", 21500, "STILL_IN_TREASURY"),
      ],
      spends: [...linked, spend("settle", 74260, null, "2026-09-01")],
    });

    // The fund is exactly balanced: everything received was spent.
    expect(m.cashFundingReceived).toBe(96260);
    expect(m.totalSpent).toBe(96260);
    expect(m.availableFund).toBe(0);

    // The phantom: the old treasury counted the 21,500 as cash in hand and
    // ignored the 22,000 actually paid out of it.
    expect(m.availableCashInTreasury).toBe(0);
    expect(m.cashInTreasuryNet).toBe(-500);

    // Both sides of the 500 are REPORTED instead of being clamped away.
    expect(m.unfundedFromTreasury).toBe(500);
    expect(m.unmatchedAlreadySpentFunding).toBe(500);
    expect(m.reconciliationWarnings).toHaveLength(2);
  });

  it("6. an over-draw is reported, never silently forced to zero", () => {
    const m = computeCapitalMetrics({
      contributions: [cash("c1", 1000, "STILL_IN_TREASURY")],
      spends: [spend("s1", 2500, "c1")],
    });
    expect(m.cashInTreasuryNet).toBe(-1500);
    expect(m.availableCashInTreasury).toBe(0);
    expect(m.unfundedFromTreasury).toBe(1500);
    expect(m.reconciliationWarnings[0]).toContain("1500");
  });

  it("7. spending never reduces the total funding; only availability moves", () => {
    const m = computeCapitalMetrics({
      contributions: [cash("c1", 20000, "STILL_IN_TREASURY")],
      spends: [spend("s1", 15000, "c1")],
    });
    expect(m.cashFundingReceived).toBe(20000); // unchanged by the spend
    expect(m.availableFund).toBe(5000);
    expect(m.availableCashInTreasury).toBe(5000);
  });

  it("8. foreign currency is never summed into the EGP totals", () => {
    const m = computeCapitalMetrics({
      contributions: [cash("c1", 10000, "STILL_IN_TREASURY"), cash("c2", 5000, "STILL_IN_TREASURY", "SAR")],
      spends: [],
    });
    expect(m.cashFundingReceived).toBe(10000);
    expect(m.foreignCurrency).toHaveLength(1);
    expect(m.reconciliationWarnings.some(w => w.includes("SAR"))).toBe(true);
  });
});

/* ═══════════════════════════════════════════════════════════════════════
   Part 2 — the real services on the isolated cluster.
   Every shape below is built through the app's own write paths, never by
   inserting rows directly, so the assertions describe real behaviour.
   ═══════════════════════════════════════════════════════════════════════ */

describe("capital metrics — live services on the isolated database", () => {
  let partnerId: string;
  let userId: string;

  beforeAll(async () => {
    try { psql(`DROP DATABASE IF EXISTS "${DB_NAME}" WITH (FORCE)`); } catch { /* may not exist */ }
    psql(`CREATE DATABASE "${DB_NAME}"`);
    execSync(`npx prisma db push --schema=prisma/schema.prisma --url "${DB_URL}"`, {
      env: ENV, stdio: "pipe", cwd: path.resolve(__dirname, ".."),
    });

    const user = await prisma.user.create({
      data: { email: "metrics-test@example.local", name: "Metrics Admin", role: "SUPER_ADMIN", passwordHash: "x" },
    });
    const partner = await prisma.partner.create({ data: { name: "ممول-المقاييس" } });
    userId = user.id;
    partnerId = partner.id;
  }, 240_000);

  afterAll(async () => {
    try { await prisma.$disconnect(); } catch { /* ignore */ }
    try { psql(`DROP DATABASE IF EXISTS "${DB_NAME}" WITH (FORCE)`); } catch { /* ignore */ }
  });

  it("9. in-kind rows are visible in the ledger, never counted as cash, and are soft-deleted, not erased", async () => {
    const inKind = await createCapitalContribution({
      partnerId, amount: 8500, type: "ASSET", date: new Date("2026-10-11"),
      description: "ايجار مكتب (محاولة موثّقة كأصل)", userId,
    });
    await createCapitalContribution({
      partnerId, amount: 21500, type: "CASH", fundFlow: "STILL_IN_TREASURY",
      date: new Date("2026-09-20"), description: "دفعة 20-9", userId,
    });

    let ledger = await getCapitalLedger();
    // Before the fix this row was filtered out of the ledger entirely, which
    // is what made a saved contribution look like it had never been saved.
    expect(ledger.entries.some(e => e.id === inKind.id)).toBe(true);
    const entry = ledger.entries.find(e => e.id === inKind.id);
    expect(entry?.contributionType).toBe("ASSET");

    let m = await getCapitalMetrics();
    expect(m.cashFundingReceived).toBe(21500);   // cash only
    expect(m.assetFunding).toBe(8500);           // separate line
    expect(m.availableFund).toBe(21500);
    expect(m.availableCashInTreasury).toBe(21500);

    // Cancelling the attempt: soft delete keeps the audit row.
    await softDeleteCapitalContribution({ id: inKind.id, userId });
    m = await getCapitalMetrics();
    expect(m.assetFunding).toBe(0);
    expect(m.assetContributionCount).toBe(0);
    expect(m.cashFundingReceived).toBe(21500);   // cash totals untouched
    const rawRow = await prismaRaw.capitalContribution.findUnique({ where: { id: inKind.id } });
    expect(rawRow).not.toBeNull();
    expect(rawRow?.deletedAt).toBeInstanceOf(Date);

    ledger = await getCapitalLedger();
    expect(ledger.entries.some(e => e.id === inKind.id)).toBe(false);
  });

  it("10. the summary, the office treasury and the ledger all report the SAME figures", async () => {
    const summary = await getCapitalSummary();
    const metrics = await getCapitalMetrics();
    const treasury = await getOfficeTreasury();
    const ledger = await getCapitalLedger();

    expect(summary.totalReceived).toBe(metrics.cashFundingReceived);
    expect(summary.available).toBe(metrics.availableFund);
    expect(summary.availableCashInTreasury).toBe(metrics.availableCashInTreasury);
    expect(ledger.summary.totalReceived).toBe(summary.totalReceived);
    expect(treasury.capitalCash).toBe(metrics.availableCashInTreasury);
    // Capital is not revenue: no other ledger was touched by these records.
    expect(treasury.profitTransfers).toBe(0);
    expect(treasury.officeExpenses).toBe(0);
  });

  it("11. two real payments of the same amount are BOTH recorded (amounts are not treated as duplicates)", async () => {
    const before = await getCapitalMetrics();
    const a = await createCapitalContribution({
      partnerId, amount: 500, type: "CASH", fundFlow: "STILL_IN_TREASURY",
      date: new Date("2026-09-25"), description: "دفعة أولى", userId,
    });
    const b = await createCapitalContribution({
      partnerId, amount: 500, type: "CASH", fundFlow: "STILL_IN_TREASURY",
      date: new Date("2026-09-25"), description: "دفعة ثانية", userId,
    });
    expect(a.id).not.toBe(b.id);
    const after = await getCapitalMetrics();
    expect(after.cashFundingReceived).toBe(before.cashFundingReceived + 1000);
    expect(after.cashContributionCount).toBe(before.cashContributionCount + 2);
  });

  it("12. spending does not touch the receivable total, and soft-deleting a spend returns the cash", async () => {
    const before = await getCapitalSummary();
    const spendRow = await createCapitalSpend({
      amount: 1200, date: new Date("2026-09-28"), category: "اشتراكات",
      description: "اشتراك خدمة", userId,
    });
    const after = await getCapitalSummary();
    expect(after.totalReceived).toBe(before.totalReceived); // funding record unchanged
    expect(after.totalSpent).toBe(before.totalSpent + 1200);
    expect(after.available).toBe(before.available - 1200);
    expect(after.availableCashInTreasury).toBe(before.availableCashInTreasury - 1200);

    const { softDeleteCapitalSpend } = await import("@/lib/capital");
    await softDeleteCapitalSpend({ id: spendRow.id, userId });
    const restored = await getCapitalSummary();
    expect(restored.available).toBe(before.available);
    expect(restored.availableCashInTreasury).toBe(before.availableCashInTreasury);
  });

  it("13. the overspend guard still refuses more than the available cash", async () => {
    const summary = await getCapitalSummary();
    await expect(
      createCapitalSpend({
        amount: summary.availableCashInTreasury + 10000,
        date: new Date("2026-09-29"), category: "تجاوز",
        description: "صرف أكبر من المتاح", userId,
      }),
    ).rejects.toThrow(/المتاح/);
  });
});
