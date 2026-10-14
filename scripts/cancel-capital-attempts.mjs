#!/usr/bin/env node
/* ═══════════════════════════════════════════════════════════════════════
   Cancels THREE specific capital contributions — and nothing else.

   AUTHORISED SCOPE (fixed IDs, given by the owner):
     cmv408owg000004jmg7jyju9w
     cmv40bs8i000204jmlev4ufzf
     cmv40f0mh000404lei1pd6gat
   All three are ASSET (in-kind) rows of 8,500 EGP created on 2026-10-11
   while the capital page was misreporting in-kind contributions.

   Guarantees:
     • NOTHING is hard-deleted: each row only gets deletedAt/deletedByUserId
       (the app's soft-delete), so the audit trail and the recycle bin keep
       the original record and its values.
     • The tool REFUSES to run against anything but a loopback database
       unless --allow-non-loopback is passed explicitly. So the isolated
       copy is the default and production needs a deliberate flag.
     • DRY RUN by default. --apply is required to write.
     • Every row is verified before and after: it must exist, be ACTIVE,
       be type ASSET and be exactly 8,500 EGP. A single mismatch aborts the
       whole run with ZERO writes.
     • No other table is written except ActivityLog (audit entries).

   Usage:
     DATABASE_URL=postgresql://postgres@127.0.0.1:5435/nexup_restore \
       node scripts/cancel-capital-attempts.mjs [--apply] [--evidence=<file>]

   Reason recorded for the cancellation:
     «إلغاء محاولات تسجيل أثناء خلل صفحة رأس المال؛ سيعيد المستخدم تسجيل
       الدفعات بعد الإصلاح»
   The ActivityLog table has no free-text column, so the reason is stored as
   a dedicated audit action (CANCEL_ATTEMPT_UI_DEFECT) plus this evidence
   file, which carries the full Arabic text.
   ═══════════════════════════════════════════════════════════════════════ */

import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

const REASON_AR =
  "إلغاء محاولات تسجيل أثناء خلل صفحة رأس المال؛ سيعيد المستخدم تسجيل الدفعات بعد الإصلاح";
const AUDIT_ACTION = "CANCEL_ATTEMPT_UI_DEFECT";
const EXPECTED_AMOUNT = 8500;
const EXPECTED_TYPE = "ASSET";

/** The authorised ids — with the values the audit found for each. */
const AUTHORISED = [
  { id: "cmv408owg000004jmg7jyju9w", description: "ايجار مكتب", date: "2026-10-11" },
  { id: "cmv40bs8i000204jmlev4ufzf", description: "ايجار شهر 10", date: "2026-10-01" },
  { id: "cmv40f0mh000404lei1pd6gat", description: "ايجار شهر 10", date: "2026-10-11" },
];

const args = process.argv.slice(2);
const apply = args.includes("--apply");
const allowNonLoopback = args.includes("--allow-non-loopback");
const evidenceArg = args.find(a => a.startsWith("--evidence="));
const EVIDENCE = evidenceArg ? evidenceArg.split("=")[1] : null;

const url = process.env.DATABASE_URL || "";
if (!url) {
  console.error("✗ DATABASE_URL is not set. Refusing to guess a database.");
  process.exit(2);
}
const host = new URL(url).hostname;
const isLoopback = host === "127.0.0.1" || host === "localhost" || host === "::1";
if (!isLoopback && !allowNonLoopback) {
  console.error(`✗ DATABASE_URL host is "${host}" — not a loopback database.`);
  console.error("  This tool only touches an isolated local copy by default.");
  console.error("  For a deliberate production run, pass --allow-non-loopback.");
  process.exit(2);
}

const { PrismaClient } = require("@prisma/client");
const { PrismaPg } = require("@prisma/adapter-pg");
const pg = require("pg");

const pool = new pg.Pool({
  connectionString: url,
  ssl: isLoopback ? false : { rejectUnauthorized: false },
});
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

const egp = n => `${Math.round((Number(n) || 0) * 100) / 100} EGP`;

async function totals() {
  const [cash, asset, assetCount, spent, activeRows] = await Promise.all([
    prisma.capitalContribution.aggregate({ where: { deletedAt: null, type: "CASH" }, _sum: { amount: true } }),
    prisma.capitalContribution.aggregate({ where: { deletedAt: null, type: "ASSET" }, _sum: { amount: true } }),
    prisma.capitalContribution.count({ where: { deletedAt: null, type: "ASSET" } }),
    prisma.capitalSpend.aggregate({ where: { deletedAt: null }, _sum: { amount: true } }),
    prisma.capitalContribution.count({ where: { deletedAt: null } }),
  ]);
  return {
    cashFunding: Math.round((cash._sum.amount ?? 0) * 100) / 100,
    assetFunding: Math.round((asset._sum.amount ?? 0) * 100) / 100,
    assetCount,
    totalSpent: Math.round((spent._sum.amount ?? 0) * 100) / 100,
    activeContributionRows: activeRows,
  };
}

function printTotals(label, t) {
  console.log(`  ${label}`);
  console.log(`    إجمالي التمويل النقدي : ${egp(t.cashFunding)}`);
  console.log(`    مساهمات عينية (ASSET) : ${egp(t.assetFunding)}  (${t.assetCount} صف)`);
  console.log(`    إجمالي المصروف        : ${egp(t.totalSpent)}`);
  console.log(`    صفوف مساهمات نشطة     : ${t.activeContributionRows}`);
}

async function main() {
  console.log("═".repeat(70));
  console.log(" Cancel the three authorised capital attempts (soft delete only)");
  console.log("═".repeat(70));
  console.log(`  database host : ${host}${isLoopback ? "  (isolated local copy)" : "  ⚠ NOT LOOPBACK"}`);
  console.log(`  mode          : ${apply ? "APPLY (writes)" : "DRY RUN (no writes)"}`);
  console.log("");

  /* ── 1. verify every authorised row before touching anything ───────── */
  const found = [];
  const problems = [];
  for (const spec of AUTHORISED) {
    const row = await prisma.capitalContribution.findUnique({ where: { id: spec.id } });
    if (!row) { problems.push(`${spec.id}: NOT FOUND`); continue; }
    if (row.deletedAt) { problems.push(`${spec.id}: already soft-deleted (${row.deletedAt.toISOString()})`); continue; }
    if (row.type !== EXPECTED_TYPE) { problems.push(`${spec.id}: type is ${row.type}, expected ${EXPECTED_TYPE}`); continue; }
    if (Math.round(row.amount * 100) !== EXPECTED_AMOUNT * 100) {
      problems.push(`${spec.id}: amount is ${row.amount}, expected ${EXPECTED_AMOUNT}`);
      continue;
    }
    const linkedSpends = await prisma.capitalSpend.count({ where: { contributionId: spec.id } });
    if (linkedSpends > 0) { problems.push(`${spec.id}: has ${linkedSpends} linked spend(s)`); continue; }
    const recordDate = row.date.toISOString().slice(0, 10);
    if (recordDate !== spec.date) {
      console.log(`  note: ${spec.id} is dated ${recordDate} (audit read ${spec.date}) — value verified instead.`);
    }
    found.push({ spec, row, recordDate });
  }

  console.log("─ verified rows ─");
  for (const f of found) {
    console.log(`  • ${f.spec.id}  ${egp(f.row.amount)}  type=${f.row.type}  fundFlow=${f.row.fundFlow}  date=${f.recordDate}  "${f.row.description ?? ""}"`);
  }
  if (problems.length) {
    console.log("\n✗ PREFLIGHT FAILED — nothing was written:");
    for (const p of problems) console.log(`   ${p}`);
    process.exit(3);
  }
  if (found.length !== AUTHORISED.length) {
    console.log("\n✗ PREFLIGHT FAILED — not every authorised row is present and eligible. Nothing written.");
    process.exit(3);
  }

  const before = await totals();
  console.log("\n─ before ─");
  printTotals("current totals", before);

  if (!apply) {
    console.log("\n DRY RUN — no writes. Re-run with --apply to cancel these three rows.");
    await prisma.$disconnect();
    process.exit(0);
  }

  /* ── 2. soft-delete, one transaction per row, each with its audit entry ── */
  const actor = await prisma.user.findFirst({
    where: { role: "SUPER_ADMIN" },
    orderBy: { createdAt: "asc" },
    select: { id: true, name: true, email: true },
  });
  if (!actor) {
    console.log("\n✗ no SUPER_ADMIN user to attribute the cancellation to. Nothing written.");
    process.exit(3);
  }
  console.log(`\n─ applying (attributed to ${actor.name} <${actor.email}>) ─`);

  const applied = [];
  for (const f of found) {
    await prisma.$transaction(async tx => {
      await tx.capitalContribution.update({
        where: { id: f.spec.id },
        data: { deletedAt: new Date(), deletedByUserId: actor.id },
      });
      await tx.activityLog.create({
        data: { userId: actor.id, action: "SOFT_DELETE", entityType: "CapitalContribution", entityId: f.spec.id },
      });
      await tx.activityLog.create({
        data: { userId: actor.id, action: AUDIT_ACTION, entityType: "CapitalContribution", entityId: f.spec.id },
      });
    });
    applied.push(f.spec.id);
    console.log(`  ✓ soft-deleted ${f.spec.id}`);
  }

  /* ── 3. verify afterwards ──────────────────────────────────────────── */
  const after = await totals();
  console.log("\n─ after ─");
  printTotals("resulting totals", after);

  const checks = [];
  checks.push({ check: "cash funding unchanged", expected: before.cashFunding, actual: after.cashFunding, ok: after.cashFunding === before.cashFunding });
  checks.push({ check: "spends unchanged", expected: before.totalSpent, actual: after.totalSpent, ok: after.totalSpent === before.totalSpent });
  checks.push({
    check: "asset funding reduced by exactly 3 × 8,500",
    expected: Math.round((before.assetFunding - 25500) * 100) / 100,
    actual: after.assetFunding,
    ok: Math.round((before.assetFunding - 25500) * 100) / 100 === after.assetFunding,
  });
  checks.push({ check: "asset rows reduced by 3", expected: before.assetCount - 3, actual: after.assetCount, ok: after.assetCount === before.assetCount - 3 });

  // every cancelled row must still exist, soft-deleted, with its values intact
  for (const f of found) {
    const row = await prisma.capitalContribution.findUnique({ where: { id: f.spec.id } });
    const ok = !!row && row.deletedAt instanceof Date && Math.round(row.amount * 100) === EXPECTED_AMOUNT * 100
      && row.type === EXPECTED_TYPE && row.description === f.row.description;
    checks.push({ check: `audit row preserved intact: ${f.spec.id}`, expected: `soft-deleted, ${EXPECTED_AMOUNT} ${EXPECTED_TYPE}`, actual: row ? `${row.amount} ${row.type} deletedAt=${row.deletedAt?.toISOString()}` : "MISSING", ok });
  }

  // no other capital row may have been touched
  const otherTouched = await prisma.activityLog.count({
    where: {
      entityType: "CapitalContribution",
      entityId: { notIn: AUTHORISED.map(a => a.id) },
      timestamp: { gte: new Date(Date.now() - 10 * 60 * 1000) },
    },
  });
  checks.push({ check: "no other contribution touched", expected: 0, actual: otherTouched, ok: otherTouched === 0 });

  console.log("\n─ verification ─");
  let allOk = true;
  for (const c of checks) {
    if (!c.ok) allOk = false;
    console.log(`  ${c.ok ? "✓" : "✗"} ${c.check}  (expected ${c.expected}, got ${c.actual})`);
  }

  if (EVIDENCE) {
    fs.mkdirSync(path.dirname(EVIDENCE), { recursive: true });
    fs.writeFileSync(EVIDENCE, JSON.stringify({
      generatedAt: new Date().toISOString(),
      tool: "scripts/cancel-capital-attempts.mjs",
      target: { host, isolated: isLoopback },
      authorisedIds: AUTHORISED,
      applied,
      reasonAr: REASON_AR,
      auditAction: AUDIT_ACTION,
      actor,
      before,
      after,
      checks,
      note: "Soft delete only: rows keep their values and stay visible in the recycle bin. ActivityLog has no free-text column, hence the dedicated action code plus this evidence file.",
    }, null, 2));
    console.log(`\n  evidence written: ${EVIDENCE}`);
  }

  await prisma.$disconnect();
  console.log(allOk ? "\n✅ DONE — three attempts cancelled, all checks passed." : "\n⚠ DONE with failed checks — review above before proceeding.");
  process.exit(allOk ? 0 : 4);
}

main().catch(async e => {
  console.error("✗ ABORT (unexpected):", e instanceof Error ? e.message : e);
  try { await prisma.$disconnect(); } catch { /* ignore */ }
  process.exit(2);
});
