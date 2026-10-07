#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════════════
// NEXUP — READ-ONLY production migration-history check
// ═══════════════════════════════════════════════════════════════════════
//
// The production migration package says its apply procedure depends on one
// FACT: whether `_prisma_migrations` lists every registered migration. This
// script answers that question and nothing else.
//
// IT IS READ-ONLY BY CONSTRUCTION:
//
//   - every statement it sends starts with `select` (asserted below, so a later
//     edit cannot quietly turn this into a writer);
//   - it runs no DDL, no migration, no `db execute`, no `prisma migrate *`;
//   - there is no `--apply` flag and no code path that writes.
//
// It prints the HOST, the counts and the migration NAMES. It never prints the
// connection URL, the user, the password or any row contents.
//
// Usage:  node scripts/check-production-migration-history.mjs
// Exit:   0 = inspected; 2 = could NOT be inspected (the reason is printed)

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, "..");

/** Reads DATABASE_URL from the project's env files WITHOUT printing it. */
function productionUrl() {
  for (const file of [".env.local", ".env"]) {
    const full = path.join(REPO_ROOT, file);
    if (!fs.existsSync(full)) continue;
    const match = fs.readFileSync(full, "utf8").match(/^DATABASE_URL\s*=\s*"?([^"\n]+)"?/m);
    if (match) return { url: match[1], source: file };
  }
  return null;
}

/** Every statement this script is allowed to send. */
const QUERIES = {
  database: "select current_database()",
  applied: `select coalesce(json_agg(migration_name order by finished_at), '[]'::json) from "_prisma_migrations" where finished_at is not null`,
  failed: `select count(*) from "_prisma_migrations" where finished_at is null`,
  rolledBack: `select count(*) from "_prisma_migrations" where rolled_back_at is not null`,
  registry: `select count(*) from information_schema.tables where table_schema='public' and table_type='BASE TABLE'`,
};

for (const [name, sql] of Object.entries(QUERIES)) {
  if (!/^\s*select\b/i.test(sql)) {
    console.error(`refusing to run the "${name}" statement: it is not a select`);
    process.exit(2);
  }
}

const resolved = productionUrl();
if (!resolved) {
  console.error("no DATABASE_URL found in .env.local or .env — nothing to inspect");
  process.exit(2);
}

let host;
try {
  host = new URL(resolved.url).hostname;
} catch {
  console.error("DATABASE_URL is not a parseable URL");
  process.exit(2);
}

console.log("── read-only production migration-history check ────────────────");
console.log(`   configured in : ${resolved.source}`);
console.log(`   host          : ${host}  (credentials never printed)`);
console.log("   statements    : select only — no DDL, no migration, no write");
console.log("");

const { Client } = await import("pg");
const client = new Client({
  connectionString: resolved.url,
  ssl: { rejectUnauthorized: false },
  connectionTimeoutMillis: 15_000,
  statement_timeout: 20_000,
  application_name: "nexup-migration-readonly-check",
});

const result = { host, readable: false, reason: null };

try {
  await client.connect();
  result.database = (await client.query(QUERIES.database)).rows[0]?.current_database ?? null;
  result.appliedMigrations = (await client.query(QUERIES.applied)).rows[0]?.coalesce ?? [];
  result.unfinishedMigrations = Number((await client.query(QUERIES.failed)).rows[0]?.count ?? -1);
  result.rolledBackMigrations = Number((await client.query(QUERIES.rolledBack)).rows[0]?.count ?? -1);
  result.publicTables = Number((await client.query(QUERIES.registry)).rows[0]?.count ?? -1);
  result.readable = true;

  console.log(`   database      : ${result.database}`);
  console.log(`   applied       : ${result.appliedMigrations.length}`);
  console.log(`   unfinished    : ${result.unfinishedMigrations}`);
  console.log(`   rolled back   : ${result.rolledBackMigrations}`);
  console.log(`   public tables : ${result.publicTables}`);
  console.log("");
  console.log("   migration names (newest last):");
  for (const name of result.appliedMigrations) console.log(`     - ${name}`);
} catch (error) {
  result.reason = error instanceof Error ? error.message : String(error);
  console.error(`   NOT INSPECTED: ${result.reason}`);
  console.error("   (no mutation was attempted; this is a connection/permission outcome)");
} finally {
  await client.end().catch(() => undefined);
}

const registered = fs
  .readdirSync(path.join(REPO_ROOT, "prisma", "migrations"), { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort();

result.registeredMigrations = registered;
result.registeredCount = registered.length;
const appliedSet = new Set(result.appliedMigrations);
result.missingFromProduction = registered.filter((name) => !appliedSet.has(name));

console.log("");
console.log("   registered in the repository :", result.registeredCount);
if (result.readable) {
  console.log("   MISSING from production      :", result.missingFromProduction.length || "none");
  for (const name of result.missingFromProduction) console.log(`     ! ${name}`);
}

const out = path.join(REPO_ROOT, "docs/evidence/step5-production-migration-history-2026-10-07.json");
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(
  out,
  `${JSON.stringify(
    {
      proof: "a READ-ONLY inspection of the production migration history: the prerequisite the production migration package depends on",
      generatedAt: new Date().toISOString(),
      readOnly: "select statements only; no DDL, no migration, no write, no schema change",
      ...result,
    },
    null,
    2,
  )}\n`,
);
console.log(`\n   evidence      : ${path.relative(REPO_ROOT, out)}`);

process.exit(result.readable ? 0 : 2);
