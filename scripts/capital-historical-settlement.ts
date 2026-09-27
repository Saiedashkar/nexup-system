/* One-shot, heavily guarded operations script for the historical Capital
   settlement (authorized by Saeed).

   Guarantees:
   - Reads REAL data from the real Supabase database via the app's own
     Prisma client (soft-delete-aware, exactly what the service uses).
     Connections go through the IPv4 pooler (the direct db.* host is
     IPv6-only and unreachable from this machine); DATABASE_URL is only
     re-hosted internally, credentials are never printed.
   - Aborts BEFORE inserting unless: no prior settlement exists,
     active CASH contributions sum to exactly 74,260 EGP, and active
     capital spends sum to exactly 0 EGP.
   - Creates exactly ONE CapitalSpend through the REAL service function
     (createCapitalSpend) so the movement is a genuine ledger record.
   - Verifies after insert: 74,260 / 74,260 / 0 and that pool, revenue,
     profit, office expenses and contributions are untouched.
   - Never updates or deletes any other record. No migrations.

   Run: npx tsx scripts/capital-historical-settlement.ts
   Exit codes: 0 success · 2 preflight abort (nothing written) · 3 post-insert
   mismatch (settlement row remains; report it — do not rerun). */

import "dotenv/config";

const EXPECTED = 74260;
const PROJECT_REF = "hoahuemoxjwivbuvxlkt";
const POOLER_HOST = "aws-1-eu-west-1.pooler.supabase.com";

const toP = (v: number | null | undefined) => Math.round((v ?? 0) * 100);
const egp = (p: number) => (Math.round(p) / 100).toLocaleString("en-US", { maximumFractionDigits: 2 });

class Abort extends Error {}

function abort(msg: string): never {
  console.error(`\n❌ ABORT: ${msg}`);
  console.error("   Nothing was written. Real data is unchanged.");
  process.exit(2);
}

async function main() {
  const verifyOnly = process.argv.includes("--verify"); // read-only re-check mode
  console.log("═".repeat(64));
  console.log(" Historical Capital settlement — guarded one-shot");
  console.log("═".repeat(64));

  /* ── Resolve the reachable pooler URL from .env (never printed) ── */
  const rawUrl = process.env.DATABASE_URL || "";
  let u: URL;
  try { u = new URL(rawUrl); } catch { abort("DATABASE_URL is not a valid URL."); }
  if (!u.hostname.includes(PROJECT_REF)) {
    abort(`DATABASE_URL does not reference the expected Supabase project (${PROJECT_REF}).`);
  }
  const poolerUrl =
    `postgresql://postgres.${PROJECT_REF}:${encodeURIComponent(u.password)}` +
    `@${POOLER_HOST}:6543/postgres?pgbouncer=true&connection_limit=1`;
  process.env.DATABASE_URL = poolerUrl;
  console.log(`DB: Supabase project ${PROJECT_REF} via pooler (transaction mode, connection_limit=1)`);

  /* The Prisma client reads DATABASE_URL at module init — import it only
     after the URL rewrite above. */
  const { prismaRaw } = await import("../src/lib/prisma");
  const capital = await import("../src/lib/capital");

  type Snap = Record<string, number>;
  async function snapshot(): Promise<Snap> {
    const [
      poolCount, expenseCount, clientPaymentCount, paymentReceiptCount,
      profitCount, profitSum, officeExpenseCount, officeExpenseSum,
      contributionRowCount, capitalSpendCount, fixedExpenseCount,
      userCount, partnerCount, partnerTxCount,
    ] = await Promise.all([
      prismaRaw.poolTransaction.count(),
      prismaRaw.expense.count(),
      prismaRaw.clientPayment.count(),
      prismaRaw.paymentReceipt.count(),
      prismaRaw.profitTransfer.count(),
      prismaRaw.profitTransfer.aggregate({ _sum: { amount: true } }),
      prismaRaw.officeExpense.count(),
      prismaRaw.officeExpense.aggregate({ _sum: { cost: true } }),
      prismaRaw.capitalContribution.count(),
      prismaRaw.capitalSpend.count(),
      prismaRaw.fixedExpense.count(),
      prismaRaw.user.count(),
      prismaRaw.partner.count(),
      prismaRaw.partnerTransaction.count(),
    ]);
    return {
      poolCount, expenseCount, clientPaymentCount, paymentReceiptCount,
      profitCount, profitSumP: toP(profitSum._sum.amount ?? null),
      officeExpenseCount, officeExpenseSumP: toP(officeExpenseSum._sum.cost ?? null),
      contributionRowCount, capitalSpendCount, fixedExpenseCount,
      userCount, partnerCount, partnerTxCount,
    };
  }

  const diff = (before: Snap, after: Snap) => {
    const out: string[] = [];
    for (const k of Object.keys(before)) if (before[k] !== after[k]) out.push(`${k}: ${before[k]} → ${after[k]}`);
    return out;
  };

  const before = await snapshot();

  /* ── Preflight ─────────────────────────────────────────────── */
  console.log("\n─ Preflight guards ─");

  const dup = await prismaRaw.capitalSpend.findFirst({
    where: {
      OR: [
        { category: "تسوية افتتاحية" },
        { description: { contains: "تسوية رصيد رأس المال السابق" } },
      ],
    },
  });
  if (dup && !verifyOnly) abort(`a historical settlement already exists (id ${dup.id}, ${egp(toP(dup.amount))} EGP, deletedAt=${dup.deletedAt}) — refusing to create a duplicate.`);

  const contributions = await prismaRaw.capitalContribution.findMany({
    where: { deletedAt: null, type: "CASH" },
    include: { partner: { select: { name: true } } },
    orderBy: { date: "asc" },
  });
  const receivedP = contributions.reduce((s, c) => s + toP(c.amount), 0);

  const spends = await prismaRaw.capitalSpend.findMany({ where: { deletedAt: null } });
  const spentP = spends.reduce((s, x) => s + toP(x.amount), 0);

  console.log(`active CASH contributions: ${contributions.length} row(s), total ${egp(receivedP)} EGP`);
  for (const c of contributions) {
    console.log(`  · ${c.date.toISOString().slice(0, 10)}  ${egp(toP(c.amount))} EGP  ${c.partner.name}${c.description ? ` — ${c.description}` : ""}`);
  }
  console.log(`active capital spends: ${spends.length} row(s), total ${egp(spentP)} EGP`);

  if (verifyOnly) {
    console.log(dup
      ? `settlement: EXISTS  id=${dup.id}  amount=${egp(toP(dup.amount))} EGP  deletedAt=${dup.deletedAt}`
      : "settlement: none found (no تسوية افتتاحية / تسوية رصيد رأس المال السابق row)");
    const s = await capital.getCapitalSummary();
    console.log(`summary: received=${s.totalReceived} spent=${s.totalSpent} available=${s.available}`);
    console.log(`raw rows: capitalContribution=${before.contributionRowCount} capitalSpend=${before.capitalSpendCount}`);
    await prismaRaw.$disconnect();
    process.exit(0);
  }

  if (receivedP !== toP(EXPECTED)) {
    abort(`CASH contribution total is ${egp(receivedP)} EGP, expected exactly ${EXPECTED} EGP. Assumptions no longer match — stopping per instructions.`);
  }
  if (spentP !== 0) {
    abort(`capital spends total is ${egp(spentP)} EGP, expected exactly 0 EGP. Assumptions no longer match — stopping per instructions.`);
  }
  capital.toPiasters(EXPECTED); // sanity: exact-piaster representability

  /* ── Insert the settlement through the real service ────────── */
  console.log("\n─ Inserting settlement (createCapitalSpend) ─");

  const systemUser = await prismaRaw.user.findFirst({
    where: { role: "SUPER_ADMIN" },
    orderBy: { createdAt: "asc" },
  });
  if (!systemUser) abort("no SUPER_ADMIN user found to attribute the settlement to.");
  console.log(`attributed to user: ${systemUser.name} (${systemUser.id})`);

  let settlementId = "";
  try {
    const settlement = await capital.createCapitalSpend({
      amount: EXPECTED,
      date: new Date("2026-09-01T00:00:00.000Z"),
      category: "تسوية افتتاحية",
      description: "تسوية رصيد رأس المال السابق",
      notes:
        "يمثل إجمالي رأس المال التاريخي الذي تم صرفه بالكامل قبل بدء استخدام نظام تتبع مصروفات رأس المال الجديد.",
      contributionId: null,
      userId: systemUser.id,
    });
    settlementId = settlement.id;
  } catch (e) {
    abort(`createCapitalSpend failed: ${e instanceof Error ? e.message : String(e)}`);
  }
  console.log(`settlement created: ${settlementId}`);

  /* ── Post-verification ─────────────────────────────────────── */
  console.log("\n─ Post-settlement verification (real service + raw counts) ─");

  // One beat for the pooler before verification reads.
  await new Promise(r => setTimeout(r, 1500));

  const summary = await capital.getCapitalSummary();
  console.log(`service summary: received=${summary.totalReceived} spent=${summary.totalSpent} available=${summary.available}`);

  const receivedOk = toP(summary.totalReceived) === toP(EXPECTED);
  const spentOk = toP(summary.totalSpent) === toP(EXPECTED);
  const availableOk = toP(summary.available) === 0;
  if (!receivedOk || !spentOk || !availableOk) {
    console.error(`❌ POST-INSERT MISMATCH: received=${summary.totalReceived} spent=${summary.totalSpent} available=${summary.available}`);
    console.error(`   Settlement row ${settlementId} EXISTS. Do NOT rerun this script; resolve manually or remove the row via the recycle bin.`);
    process.exit(3);
  }

  const settlementRows = await prismaRaw.capitalSpend.findMany({
    where: { OR: [{ category: "تسوية افتتاحية" }, { description: { contains: "تسوية رصيد رأس المال السابق" } }] },
  });
  if (settlementRows.length !== 1) {
    console.error(`❌ expected exactly ONE settlement row, found ${settlementRows.length} (${settlementRows.map(r => r.id).join(", ")})`);
    process.exit(3);
  }

  const after = await snapshot();
  const changes = diff(before, after).filter(c => !c.startsWith("capitalSpendCount:"));
  if (after.capitalSpendCount !== before.capitalSpendCount + 1) {
    changes.push(`capitalSpendCount: ${before.capitalSpendCount} → ${after.capitalSpendCount} (expected exactly +1 for the settlement)`);
  }
  if (changes.length > 0) {
    console.error("❌ isolation violated — unrelated tables changed:");
    for (const c of changes) console.error(`   ${c}`);
    console.error(`   Settlement row ${settlementId} EXISTS. Investigate before proceeding.`);
    process.exit(3);
  }

  const { entries } = await capital.getCapitalLedger();
  const chrono = [...entries].reverse();
  const last = chrono[chrono.length - 1];
  console.log(`ledger rows: ${entries.length} (IN ${entries.filter(e => e.type === "CAPITAL_IN").length}, SPEND ${entries.filter(e => e.type === "CAPITAL_SPEND").length}); final running balance: ${last ? last.balanceAfter : 0}`);

  console.log("\n✅ SUCCESS");
  console.log(`  settlement id : ${settlementId}`);
  console.log(`  received      : ${egp(toP(summary.totalReceived))} EGP`);
  console.log(`  spent         : ${egp(toP(summary.totalSpent))} EGP`);
  console.log(`  available     : ${egp(toP(summary.available))} EGP`);
  console.log("  isolation     : pool/expenses/revenue/profit/office-expenses/contributions unchanged");
  await prismaRaw.$disconnect();
  process.exit(0);
}

main().catch(e => {
  console.error("❌ ABORT (unexpected):", e instanceof Error ? e.message : e);
  process.exit(2);
});
