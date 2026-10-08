#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════════════
// NEXUP — READ-ONLY production preflight for the AI-workforce migration
// ═══════════════════════════════════════════════════════════════════════
//
// Answers the four questions the owner asked before approving a production
// migration, and nothing else:
//
//   1. which migrations production actually has (Prisma ledger AND the
//      Supabase CLI ledger), and whether the 14 registered Prisma migrations
//      are represented;
//   2. whether any object of the proposed AI-workforce migration already
//      exists — including the two objects Phase 1B would DROP;
//   3. the exact delta the four proposed files WOULD apply;
//   4. whether production's legacy schema still equals the branch-point
//      datamodel the proposal was generated against.
//
// IT IS READ-ONLY BY CONSTRUCTION:
//
//   - every statement it sends starts with `select` (asserted below, so a later
//     edit cannot quietly turn this into a writer);
//   - it runs no DDL, no migration, no `prisma db execute`, no `prisma migrate *`;
//   - there is no `--apply` flag and no code path that writes to a database.
//
// It prints the HOST, counts, names and fingerprints. It never prints the
// connection URL, the user, the password or any row contents.
//
// ── reaching production ────────────────────────────────────────────────
// Supabase's direct host `db.<ref>.supabase.co` publishes an AAAA record only.
// From a workstation with no IPv6 route that host is unreachable — a DNS/route
// outcome, not a credential or permission one. The SAME database is reachable
// over IPv4 through the project's Supavisor pooler, so after the configured host
// fails this script tries pooler candidates (region inferred from the project's
// own AAAA record where it can be, then a small generic list) and reports which
// route answered. Override with NEXUP_PREFLIGHT_POOLER_HOST=<host> if needed.
// Nothing is reconfigured: no DNS change, no env file edit, no server change.
//
// Usage:  node scripts/check-production-preflight-readonly.mjs
// Exit:   0 = inspected; 1 = a correctness check failed; 2 = could NOT inspect

import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, "..");
const EVIDENCE = path.join(REPO_ROOT, "docs/evidence/step5-production-preflight-readonly.json");
const BASELINE_EVIDENCE = path.join(REPO_ROOT, "docs/evidence/step5-dev-migration-2026-10-07.json");

const PROPOSED_FILES = {
  AI_WORKFORCE_PHASE_1A: "prisma/proposed-migrations/AI_WORKFORCE_PHASE_1A/migration.sql",
  AI_WORKFORCE_PHASE_1B: "prisma/proposed-migrations/AI_WORKFORCE_PHASE_1B/migration.sql",
  AI_WORKFORCE_PHASE_2: "prisma/proposed-migrations/AI_WORKFORCE_PHASE_2/migration.sql",
  AI_WORKFORCE_PHASE_3: "prisma/proposed-migrations/AI_WORKFORCE_PHASE_3/migration.sql",
};

/** Reads DATABASE_URL from the project's env files WITHOUT printing it. */
function configuredDatabaseUrl() {
  for (const file of [".env.local", ".env"]) {
    const full = path.join(REPO_ROOT, file);
    if (!fs.existsSync(full)) continue;
    const match = fs.readFileSync(full, "utf8").match(/^DATABASE_URL\s*=\s*"?([^"\n]+)"?/m);
    if (match) return { url: match[1], source: file };
  }
  return null;
}

/** Every statement this script is allowed to send is a select. */
function selectOnly(name, sql) {
  if (!/^\s*select\b/i.test(sql)) throw new Error(`refusing the "${name}" statement: it is not a select`);
  return sql;
}

/** The table a Prisma model maps to (`@@map` wins, otherwise the model name). */
function modelTables() {
  const schema = fs.readFileSync(path.join(REPO_ROOT, "prisma/schema.prisma"), "utf8");
  const tables = new Set();
  for (const block of schema.split(/\nmodel\s+/).slice(1)) {
    const name = block.match(/^([A-Za-z0-9_]+)/)?.[1];
    if (!name) continue;
    const mapped = block.match(/@@map\("([^"]+)"\)/)?.[1];
    tables.add(mapped ?? name);
  }
  return tables;
}

/** The objects each proposed file would create or drop, parsed from the SQL. */
function proposedObjects() {
  const out = {};
  for (const [phase, rel] of Object.entries(PROPOSED_FILES)) {
    const sql = fs.readFileSync(path.join(REPO_ROOT, rel), "utf8");
    const grab = (re) => [...sql.matchAll(re)].map((m) => m[1]);
    out[phase] = {
      file: rel,
      sha256: createHash("sha256").update(sql).digest("hex"),
      createsTables: grab(/CREATE TABLE "([^"]+)"/g),
      createsTypes: grab(/CREATE TYPE "([^"]+)"/g),
      createsIndexes: grab(/CREATE (?:UNIQUE )?INDEX (?:IF NOT EXISTS )?"([^"]+)"/g),
      addsColumns: [...sql.matchAll(/ALTER TABLE "([^"]+)" ADD COLUMN IF NOT EXISTS "([^"]+)"/g)].map((m) => `${m[1]}.${m[2]}`),
      addsConstraints: grab(/ALTER TABLE "[^"]+" ADD CONSTRAINT "([^"]+)"/g),
      dropsTables: grab(/DROP TABLE IF EXISTS "([^"]+)"/g),
      dropsTypes: grab(/DROP TYPE IF EXISTS "([^"]+)"/g),
    };
  }
  return out;
}

function registeredMigrations() {
  return fs
    .readdirSync(path.join(REPO_ROOT, "prisma/migrations"), { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort();
}

/* ── route discovery (read-only probes) ─────────────────────────────────── */

async function tcpOpens(host, port, timeoutMs = 6000) {
  const net = await import("node:net");
  return new Promise((resolve) => {
    const socket = net.connect({ host, port, timeout: timeoutMs });
    socket.on("connect", () => { socket.destroy(); resolve(true); });
    socket.on("timeout", () => { socket.destroy(); resolve(false); });
    socket.on("error", () => { socket.destroy(); resolve(false); });
  });
}

/** AWS IPv6 prefixes Supabase RDS direct endpoints are published under. */
const IPV6_REGION_HINTS = {
  "2a05:d018": "eu-west-1",
  "2a05:d02c": "eu-west-2",
  "2a05:d032": "eu-north-1",
  "2a05:d01c": "eu-central-1",
  "2600:1f18": "us-east-1",
  "2600:1f14": "us-west-2",
  "2406:da18": "ap-southeast-1",
  "2406:da14": "ap-southeast-2",
  "2406:dafc": "ap-south-1",
  "2406:da12": "ap-northeast-1",
};

async function poolerCandidates(hostname) {
  const candidates = [];
  const override = process.env.NEXUP_PREFLIGHT_POOLER_HOST;
  if (override) candidates.push(override);

  const reference = hostname.match(/^db\.([a-z0-9]+)\.supabase\.co$/)?.[1];
  if (!reference) return { reference: null, candidates };

  let region = null;
  try {
    const dns = await import("node:dns/promises");
    const [v6] = await dns.resolve6(hostname);
    if (v6) {
      const prefix = v6.split(":").slice(0, 2).join(":").toLowerCase();
      region = IPV6_REGION_HINTS[prefix] ?? null;
    }
  } catch { /* no AAAA — fall through to the generic list */ }

  if (region) {
    for (const cluster of ["aws-0", "aws-1"]) candidates.push(`${cluster}-${region}.pooler.supabase.com`);
  }
  for (const fallback of ["eu-west-1", "eu-central-1", "us-east-1", "us-west-2"]) {
    for (const cluster of ["aws-1", "aws-0"]) candidates.push(`${cluster}-${fallback}.pooler.supabase.com`);
  }
  return { reference, region, candidates: [...new Set(candidates)] };
}

/* ── main ───────────────────────────────────────────────────────────────── */

const resolved = configuredDatabaseUrl();
if (!resolved) {
  console.error("no DATABASE_URL found in .env.local or .env — nothing to inspect");
  process.exit(2);
}

let configuredHost;
try {
  configuredHost = new URL(resolved.url).hostname;
} catch {
  console.error("DATABASE_URL is not a parseable URL");
  process.exit(2);
}

console.log("── read-only production preflight ──────────────────────────────");
console.log(`   configured in : ${resolved.source}`);
console.log(`   host          : ${configuredHost}  (credentials never printed)`);
console.log("   statements    : select only — no DDL, no migration, no write");

const baseline = fs.existsSync(BASELINE_EVIDENCE) ? JSON.parse(fs.readFileSync(BASELINE_EVIDENCE, "utf8")) : null;
const branchPointFingerprint = baseline?.preMigrationSchema?.legacyFingerprint?.hash ?? null;
const branchPointColumns = baseline?.preMigrationSchema?.legacyFingerprint?.columns ?? null;

const expectedTables = modelTables();
const proposals = proposedObjects();
const registered = registeredMigrations();

const route = { configuredHost, usedHost: null, usedPort: null, reference: null, region: null, directReachable: false, notes: [] };

const { Client } = await import("pg");

/** One read-only attempt against a specific host:port. Returns the payload or null. */
async function inspect(host, port, user) {
  const client = new Client({
    host,
    port,
    user,
    password: new URL(resolved.url).password,
    database: new URL(resolved.url).pathname.replace(/^\//, "") || "postgres",
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 15_000,
    statement_timeout: 25_000,
    application_name: "nexup-preflight-readonly",
  });

  try {
    await client.connect();

    const one = async (name, sql) => (await client.query(selectOnly(name, sql))).rows;

    const identity = (await one("identity", "select current_database() as db, current_user as usr"))[0];

    const prismaTable = (await one("prisma-ledger-present",
      "select count(*)::int as n from information_schema.tables where table_schema='public' and table_name='_prisma_migrations'"))[0].n > 0;
    const supabaseTable = (await one("supabase-ledger-present",
      "select count(*)::int as n from information_schema.tables where table_schema='supabase_migrations' and table_name='schema_migrations'"))[0].n > 0;

    const prismaLedger = prismaTable
      ? await one("prisma-ledger", "select migration_name, finished_at, rolled_back_at from \"_prisma_migrations\" order by finished_at nulls first, migration_name")
      : [];
    const supabaseLedger = supabaseTable
      ? await one("supabase-ledger", "select version, name from supabase_migrations.schema_migrations order by version")
      : [];

    const tables = (await one("tables",
      "select table_name from information_schema.tables where table_schema='public' and table_type='BASE TABLE' order by table_name")).map((r) => r.table_name);
    const columns = await one("columns",
      "select table_name, column_name, data_type, is_nullable, column_default from information_schema.columns where table_schema='public' order by table_name, column_name");
    const indexes = await one("indexes", "select indexname from pg_indexes where schemaname='public'");
    const constraints = await one("constraints",
      "select conname from pg_constraint c join pg_namespace n on n.oid=c.connamespace where n.nspname='public'");
    const enumTypes = (await one("enum-types",
      "select t.typname from pg_type t join pg_namespace n on n.oid=t.typnamespace where n.nspname='public' and t.typtype='e'")).map((r) => r.typname);

    // Prisma names its implicit many-to-many join tables `_<A>To<B>`; they are
    // created by the datamodel itself and are therefore NOT unmodeled.
    const implicitRelation = /^_[A-Za-z0-9]+To[A-Za-z0-9]+$/;
    const unmodeled = tables.filter((t) => !expectedTables.has(t) && !implicitRelation.test(t));
    const legacyTables = tables.filter((t) => !t.startsWith("ai_") && !unmodeled.includes(t));
    const legacyColumns = columns
      .filter((c) => legacyTables.includes(c.table_name))
      .map((c) => `${c.table_name}|${c.column_name}|${c.data_type}|${c.is_nullable}|${c.column_default ?? ""}`);

    const unmodeledRows = {};
    for (const table of unmodeled) {
      unmodeledRows[table] = Number((await one(`rows:${table}`, `select count(*)::int as n from "${table}"`))[0].n);
    }

    const aiTables = tables.filter((t) => t.startsWith("ai_"));
    const aiObjects = {
      tables: aiTables,
      enumTypes: enumTypes.filter((t) => t.startsWith("Ai")),
    };

    return {
      identity,
      prismaTable,
      supabaseTable,
      prismaLedger: prismaLedger.map((r) => ({ name: r.migration_name, finished: Boolean(r.finished_at), rolledBack: Boolean(r.rolled_back_at) })),
      supabaseLedger,
      tables,
      columns,
      indexNames: indexes.map((r) => r.indexname),
      constraintNames: constraints.map((r) => r.conname),
      enumTypes,
      unmodeled,
      unmodeledRows,
      legacyTables,
      legacyFingerprint: { hash: createHash("sha256").update(legacyColumns.join("\n")).digest("hex"), columns: legacyColumns.length },
      aiObjects,
      applicationName: identity.usr,
    };
  } catch (error) {
    console.log(`   route ${host}:${port} -> ${error?.code ?? ""} ${String(error?.message ?? error).slice(0, 110)}`);
    return null;
  } finally {
    await client.end().catch(() => undefined);
  }
}

const directPort = Number(new URL(resolved.url).port || 5432);

let data = null;
if (await tcpOpens(configuredHost, directPort)) {
  console.log(`   configured host ${configuredHost}:${directPort} answers — inspecting there`);
  data = await inspect(configuredHost, directPort, new URL(resolved.url).username);
  if (data) {
    route.usedHost = configuredHost;
    route.usedPort = directPort;
    route.directReachable = true;
  }
}

if (!data) {
  route.notes.push(`the configured host ${configuredHost}:${directPort} did not answer (IPv6-only endpoint and/or no route from this workstation)`);
  const { reference, region, candidates } = await poolerCandidates(configuredHost);
  route.reference = reference;
  route.region = region;
  console.log(`   direct host unreachable → trying IPv4 Supavisor pooler candidates${region ? ` (region ${region} from the project's AAAA record)` : ""}`);
  for (const candidate of candidates) {
    const attempt = await inspect(candidate, 6543, reference ? `postgres.${reference}` : new URL(resolved.url).username);
    if (attempt) {
      route.usedHost = candidate;
      route.usedPort = 6543;
      route.notes.push(`inspected over the project's IPv4 Supavisor pooler (same database, same credentials, select-only)`);
      data = attempt;
      break;
    }
  }
}

if (!data) {
  console.error("");
  console.error("   NOT INSPECTED — no authorized read-only route answered.");
  console.error("   No mutation was attempted; this is a network/route outcome.");
  console.error("   Owner action: run this script from a host with IPv6 (or an IPv4 pooler)");
  console.error("   reachability to the project, or set NEXUP_PREFLIGHT_POOLER_HOST.");
  process.exit(2);
}

/* ── delta classification ───────────────────────────────────────────────── */

const tableSet = new Set(data.tables);
const indexSet = new Set(data.indexNames);
const constraintSet = new Set(data.constraintNames);
const typeSet = new Set(data.enumTypes);
const columnSet = new Set(data.columns.map((c) => `${c.table_name}.${c.column_name}`));

const delta = {};
const summary = { alreadyPresent: [], wouldCreate: [], wouldDrop: [], alreadyAbsent: [] };
for (const [phase, p] of Object.entries(proposals)) {
  const buckets = {
    tables: Object.fromEntries(p.createsTables.map((n) => [n, tableSet.has(n) ? "ALREADY PRESENT" : "WOULD CREATE"])),
    types: Object.fromEntries(p.createsTypes.map((n) => [n, typeSet.has(n) ? "ALREADY PRESENT" : "WOULD CREATE"])),
    indexes: Object.fromEntries(p.createsIndexes.map((n) => [n, indexSet.has(n) ? "ALREADY PRESENT" : "WOULD CREATE"])),
    columns: Object.fromEntries(p.addsColumns.map((n) => [n, columnSet.has(n) ? "ALREADY PRESENT" : "WOULD CREATE"])),
    constraints: Object.fromEntries(p.addsConstraints.map((n) => [n, constraintSet.has(n) ? "ALREADY PRESENT" : "WOULD CREATE"])),
    dropTargets: Object.fromEntries([
      ...p.dropsTables.map((n) => [`table:${n}`, tableSet.has(n) ? "WOULD DROP" : "ALREADY ABSENT"]),
      ...p.dropsTypes.map((n) => [`type:${n}`, typeSet.has(n) ? "WOULD DROP" : "ALREADY ABSENT"]),
    ]),
  };
  delta[phase] = { file: p.file, sha256: p.sha256, ...buckets };

  for (const group of ["tables", "types", "indexes", "columns", "constraints"]) {
    for (const [name, state] of Object.entries(buckets[group])) {
      (state === "ALREADY PRESENT" ? summary.alreadyPresent : summary.wouldCreate).push(`${phase}:${group}:${name}`);
    }
  }
  for (const [name, state] of Object.entries(buckets.dropTargets)) {
    (state === "WOULD DROP" ? summary.wouldDrop : summary.alreadyAbsent).push(`${phase}:${name}`);
  }
}

const appliedPrisma = data.prismaLedger.filter((m) => m.finished).map((m) => m.name);
const missingFromProduction = registered.filter((n) => !appliedPrisma.includes(n));

const result = {
  proof: "a READ-ONLY production preflight for the AI-workforce migration: the migration history production actually has, the presence/absence of every object the four proposed files create or drop, the exact delta they would apply, and whether production's legacy schema still equals the branch-point datamodel",
  generatedAt: new Date().toISOString(),
  readOnly: "select statements only — no DDL, no migration, no write, no schema change, no configuration change",
  route,
  database: data.identity.db,
  connectionUser: data.applicationName,
  history: {
    prismaLedgerTableExists: data.prismaTable,
    prismaLedger: data.prismaLedger,
    appliedCount: appliedPrisma.length,
    unfinished: data.prismaLedger.filter((m) => !m.finished && !m.rolledBack).map((m) => m.name),
    rolledBack: data.prismaLedger.filter((m) => m.rolledBack).map((m) => m.name),
    registeredCount: registered.length,
    registeredMigrations: registered,
    missingFromProduction,
    supabaseLedgerTableExists: data.supabaseTable,
    supabaseLedger: data.supabaseLedger,
  },
  schema: {
    publicBaseTableCount: data.tables.length,
    tables: data.tables,
    aiTables: data.aiObjects.tables,
    aiEnumTypes: data.aiObjects.enumTypes,
    unmodeledTables: data.unmodeled,
    unmodeledRowCounts: data.unmodeledRows,
    modelTableCount: expectedTables.size,
    legacyTableCount: data.legacyTables.length,
    legacyFingerprint: data.legacyFingerprint,
    branchPointFingerprint: { hash: branchPointFingerprint, columns: branchPointColumns },
    legacyMatchesBranchPoint: branchPointFingerprint !== null && data.legacyFingerprint.hash === branchPointFingerprint,
    publicIndexCount: data.indexNames.length,
    publicConstraintCount: data.constraintNames.length,
  },
  proposedDelta: delta,
  summary,
};

fs.mkdirSync(path.dirname(EVIDENCE), { recursive: true });
fs.writeFileSync(EVIDENCE, `${JSON.stringify(result, null, 2)}\n`);

/* ── report ─────────────────────────────────────────────────────────────── */

console.log("");
console.log(`   database              : ${result.database}  (user ${result.connectionUser})`);
console.log(`   reached via           : ${route.usedHost}:${route.usedPort}${route.directReachable ? " (configured host)" : " (IPv4 pooler, same project)"}`);
console.log("");
console.log("   MIGRATION HISTORY");
console.log(`     _prisma_migrations    : ${data.prismaTable ? "present" : "ABSENT"}`);
console.log(`     prisma applied        : ${appliedPrisma.length} of ${registered.length} registered`);
console.log(`     missing from prod     : ${missingFromProduction.length ? missingFromProduction.join(", ") : "none"}`);
console.log(`     unfinished / rolled   : ${result.history.unfinished.length} / ${result.history.rolledBack.length}`);
console.log(`     supabase ledger       : ${data.supabaseTable ? `${data.supabaseLedger.length} entries` : "absent"}`);
for (const entry of data.supabaseLedger) console.log(`       - ${entry.version} ${entry.name}`);
console.log("");
console.log("   SCHEMA");
console.log(`     public base tables    : ${data.tables.length} (${data.legacyTables.length} legacy + ${data.unmodeled.length} unmodeled + ${data.aiObjects.tables.length} ai_*)`);
console.log(`     datamodel tables      : ${expectedTables.size}`);
console.log(`     unmodeled in the DB   : ${data.unmodeled.map((t) => `${t} (${data.unmodeledRows[t]} rows)`).join(", ") || "none"}`);
console.log(`     ai_* tables           : ${data.aiObjects.tables.join(", ") || "(none)"}`);
console.log(`     ai enum types         : ${data.aiObjects.enumTypes.join(", ") || "(none)"}`);
console.log(`     legacy fingerprint    : ${data.legacyFingerprint.hash.slice(0, 16)} (${data.legacyFingerprint.columns} columns)`);
console.log(`     branch-point baseline : ${branchPointFingerprint ? `${branchPointFingerprint.slice(0, 16)} (${branchPointColumns} columns)` : "not recorded"}`);
console.log(`     legacy == branch point: ${result.schema.legacyMatchesBranchPoint}`);
console.log("");
console.log("   DELTA the four proposed files WOULD apply");
for (const [phase, d] of Object.entries(delta)) {
  const counts = { present: 0, create: 0 };
  for (const group of ["tables", "types", "indexes", "columns", "constraints"]) {
    for (const state of Object.values(d[group])) {
      if (state === "ALREADY PRESENT") counts.present += 1;
      else counts.create += 1;
    }
  }
  console.log(`     ${phase.padEnd(21)} would create: ${String(counts.create).padStart(3)}   already present: ${counts.present}`);
  for (const [name, state] of Object.entries(d.dropTargets)) console.log(`       ${state.padEnd(14)} ${name}`);
}
console.log("");
console.log(`     would CREATE          : ${summary.wouldCreate.length} objects`);
console.log(`     already PRESENT       : ${summary.alreadyPresent.length} objects`);
console.log(`     would DROP            : ${summary.wouldDrop.length ? summary.wouldDrop.join(", ") : "nothing"}`);
console.log(`     drop targets already absent: ${summary.alreadyAbsent.length ? summary.alreadyAbsent.join(", ") : "none"}`);
console.log("");
console.log(`   evidence              : ${path.relative(REPO_ROOT, EVIDENCE)}`);

const failures = [];
if (!result.schema.legacyMatchesBranchPoint) failures.push("production's legacy schema no longer matches the branch-point datamodel");
if (registered.length === 0) failures.push("no registered migrations found in prisma/migrations");
if (failures.length) {
  console.error("");
  console.error(`CHECKS FAILED: ${failures.join("; ")} — the evidence file records the exact state.`);
  process.exit(1);
}
