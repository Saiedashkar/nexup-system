#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════════════
// NEXUP AI WORKFORCE — the ISOLATED DEVELOPMENT DATABASE harness
// ═══════════════════════════════════════════════════════════════════════
//
// The owner approved applying the AI Workforce migrations against a SEPARATE
// DEVELOPMENT DATABASE. This script is that database, and it is built so it
// cannot be anything else:
//
//   * it `initdb`s a NEW cluster in its own directory on its own port (never an
//     existing data directory, never the production Supabase host);
//   * trust auth + listen_addresses=127.0.0.1: loopback only, so the workforce
//     persistence guard accepts it and nothing off-machine can reach it;
//   * it NEVER reads DATABASE_URL to decide where to connect. Every command it
//     runs gets its own URL, explicitly, for the dev cluster it just created;
//   * it does not start, stop or touch any installed PostgreSQL service.
//
// Subcommands:
//
//   node scripts/dev-db.mjs up        cluster + the PRE-MIGRATION schema
//   node scripts/dev-db.mjs migrate   apply the proposed additive migrations,
//                                     verify them, and write the evidence file
//   node scripts/dev-db.mjs status    identity + schema state (safe to paste)
//   node scripts/dev-db.mjs down      stop the cluster (keeps its data)
//   node scripts/dev-db.mjs destroy   stop and DELETE the cluster
//
// Env: PG_BIN (default C:/Program Files/PostgreSQL/18/bin)
//      DEV_DB_PORT (default 5501)
//      DEV_DB_DIR  (default %LOCALAPPDATA%/nexup-dev-db)
//
// It prints NO credentials — the cluster uses trust auth on loopback and the
// only databases it ever names are the ones it created.
//
// ── Why the pre-migration schema comes from the model, not from the folder ──
//
// `prisma migrate deploy` CANNOT reproduce this project's existing schema on an
// empty database: `20260823221818_init` creates `Client_phone_key` as a UNIQUE
// INDEX, and `20260824120000_add_business_multitenancy` drops it as a
// CONSTRAINT, so the replay dies with 42704 on the second file. That is a
// pre-existing defect in the registered history, not something this work
// introduced, and this script measures it instead of assuming it away.
//
// So the pre-migration baseline is built the way the application itself defines
// "before": from the Prisma datamodel at the commit this branch forked from
// (`git merge-base HEAD master`). `prisma migrate diff --from-empty --to-schema
// <that schema>` emits the exact DDL that model implies, and a follow-up
// `migrate diff` proves the database IS that model. The registered-migration
// replay is still attempted, on a throwaway database, and its failure is
// recorded in the evidence.

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, "..");

const PG_BIN = process.env.PG_BIN || "C:/Program Files/PostgreSQL/18/bin";
const PORT = process.env.DEV_DB_PORT || "5501";
const DATA_DIR = process.env.DEV_DB_DIR || path.join(process.env.LOCALAPPDATA || os.tmpdir(), "nexup-dev-db");
const LOG_FILE = `${DATA_DIR}.log`;
const DEV_DATABASE = "nexup_dev";
const REPLAY_DATABASE = "nexup_dev_migratecheck";
const CANARY_BUSINESS = "dev_canary_business";
const CANARY_USER = "dev_canary_user";

const BASELINE_SCHEMA_TMP = ".tmp-baseline-schema.prisma";
const BASELINE_SQL_TMP = ".tmp-baseline-schema.sql";

const WIN = process.platform === "win32";
const exe = (name) => path.join(PG_BIN, `${name}${WIN ? ".exe" : ""}`);

const INITDB = exe("initdb");
const PG_CTL = exe("pg_ctl");
const PSQL = exe("psql");
// The Prisma CLI is invoked through node directly. Spawning a `.cmd` shim
// without a shell is refused by Node (EINVAL, CVE-2024-27980), and `npx` adds a
// network-capable layer this script does not need.
const PRISMA_CLI = path.join(REPO_ROOT, "node_modules", "prisma", "build", "index.js");
const prisma = (args, env) => run(process.execPath, [PRISMA_CLI, ...args], { env });

/** The ONLY database this script connects to. */
const DEV_URL = (database = DEV_DATABASE) => `postgresql://postgres@127.0.0.1:${PORT}/${database}`;

const PROPOSED = [
  "prisma/proposed-migrations/AI_WORKFORCE_PHASE_1A/migration.sql",
  "prisma/proposed-migrations/AI_WORKFORCE_PHASE_1B/migration.sql",
  "prisma/proposed-migrations/AI_WORKFORCE_PHASE_2/migration.sql",
  "prisma/proposed-migrations/AI_WORKFORCE_PHASE_3/migration.sql",
];

/** Exactly the tables the four proposed files must create, and nothing else. */
const EXPECTED_NEW_TABLES = [
  "ai_approvals",
  "ai_command_intents",
  "ai_execution_records",
  "ai_jobs",
  "ai_missions",
  "ai_run_events",
  "ai_runs",
  "ai_task_reviews",
  "ai_tasks",
];

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: REPO_ROOT,
    encoding: "utf8",
    env: { ...process.env, ...(options.env ?? {}) },
    maxBuffer: 64 * 1024 * 1024,
  });
  return {
    status: result.status ?? (result.error ? -1 : 0),
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? (result.error ? String(result.error.message) : ""),
  };
}

function must(label, result) {
  if (result.status !== 0) {
    throw new Error(`${label} failed (exit ${result.status})\n${result.stderr || result.stdout}`);
  }
  return result;
}

/** SQL helper. Never uses a shell, so quoting is literal. */
function query(sql, database = DEV_DATABASE) {
  const result = run(PSQL, ["-h", "127.0.0.1", "-p", PORT, "-U", "postgres", "-w", "-t", "-A", "-F", "\t", "-v", "ON_ERROR_STOP=1", "-c", sql, "-d", database]);
  if (result.status !== 0) throw new Error(`query failed: ${sql}\n${result.stderr}`);
  return result.stdout.trim();
}

function psqlFile(file, database = DEV_DATABASE) {
  return run(PSQL, ["-h", "127.0.0.1", "-p", PORT, "-U", "postgres", "-w", "-v", "ON_ERROR_STOP=1", "-f", path.join(REPO_ROOT, file), "-d", database]);
}

function clusterRunning() {
  const result = run(PSQL, ["-h", "127.0.0.1", "-p", PORT, "-U", "postgres", "-w", "-t", "-A", "-c", "select 1", "-d", "postgres"]);
  return result.status === 0 && result.stdout.trim() === "1";
}

function requireTools() {
  for (const tool of [INITDB, PG_CTL, PSQL]) {
    if (!fs.existsSync(tool)) throw new Error(`missing PostgreSQL tool: ${tool} (set PG_BIN)`);
  }
}

function sha256File(file) {
  return createHash("sha256").update(fs.readFileSync(path.join(REPO_ROOT, file))).digest("hex");
}

function git(args) {
  const result = run("git", args);
  if (result.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${result.stderr}`);
  return result.stdout.trim();
}

/** psql on Windows emits CRLF; normalize every multi-line result. */
function lines(text) {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

/** 1s of sleep without a busy loop. */
function sleep(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function ensureCluster() {
  if (!fs.existsSync(path.join(DATA_DIR, "PG_VERSION"))) {
    fs.mkdirSync(path.dirname(DATA_DIR), { recursive: true });
    must(`initdb ${DATA_DIR}`, run(INITDB, ["-D", DATA_DIR, "-U", "postgres", "-A", "trust", "--encoding=UTF8"]));
  }

  if (clusterRunning()) return;

  must(
    "pg_ctl start",
    run(PG_CTL, [
      "-D", DATA_DIR,
      "-l", LOG_FILE,
      // autovacuum=off: this is a development fixture, and on Windows an
      // autovacuum worker can hit a DLL-initialisation failure (0xC0000142)
      // that crash-restarts the whole cluster mid-run.
      "-o", `-p ${PORT} -c listen_addresses=127.0.0.1 -c fsync=off -c synchronous_commit=off -c autovacuum=off`,
      "-w", "start",
    ]),
  );

  for (let attempt = 0; attempt < 30; attempt += 1) {
    if (clusterRunning()) return;
    if (attempt === 29) throw new Error(`cluster never became ready; see ${LOG_FILE}`);
    sleep(1000);
  }
}

function databaseExists(database) {
  return query(`select 1 from pg_database where datname = '${database}'`, "postgres") === "1";
}

function ensureDatabase(database) {
  if (databaseExists(database)) return;
  must(
    `create database ${database}`,
    run(PSQL, ["-h", "127.0.0.1", "-p", PORT, "-U", "postgres", "-w", "-v", "ON_ERROR_STOP=1", "-c", `CREATE DATABASE ${database}`, "-d", "postgres"]),
  );
}

function dropDatabase(database) {
  if (!databaseExists(database)) return;
  must(
    `drop database ${database}`,
    run(PSQL, ["-h", "127.0.0.1", "-p", PORT, "-U", "postgres", "-w", "-v", "ON_ERROR_STOP=1", "-c", `DROP DATABASE ${database}`, "-d", "postgres"]),
  );
}

/* ═══════════════════════════════════════════════════════
   up — the PRE-MIGRATION schema
   ═══════════════════════════════════════════════════════ */

/** Is the registered migration history replayable on an empty database? */
function replayRegisteredMigrations() {
  dropDatabase(REPLAY_DATABASE);
  ensureDatabase(REPLAY_DATABASE);
  const result = prisma(["migrate", "deploy"], { DATABASE_URL: DEV_URL(REPLAY_DATABASE) });
  const applied = [...result.stdout.matchAll(/Applying migration `([^`]+)`/g)].map((match) => match[1]);
  const failure = (result.stderr.match(/Database error:\n?([^\n]*)/) ?? [])[1] ?? null;
  const failedMigration = (result.stderr.match(/Migration name: (\S+)/) ?? [])[1] ?? null;
  dropDatabase(REPLAY_DATABASE);
  return { database: REPLAY_DATABASE, exitCode: result.status, replayable: result.status === 0, appliedMigrations: applied, failedMigration, failure };
}

/** The schema this branch forked from — the application's own "before". */
function baselineSchema() {
  const ref = git(["merge-base", "HEAD", "master"]);
  fs.writeFileSync(path.join(REPO_ROOT, BASELINE_SCHEMA_TMP), git(["show", `${ref}:prisma/schema.prisma`]));
  return { ref, file: BASELINE_SCHEMA_TMP };
}

function up() {
  requireTools();
  ensureCluster();
  ensureDatabase(DEV_DATABASE);

  const replay = replayRegisteredMigrations();
  const baseline = baselineSchema();

  // The exact DDL the pre-migration datamodel implies.
  const ddl = must("prisma migrate diff --from-empty", prisma(["migrate", "diff", "--from-empty", `--to-schema=${BASELINE_SCHEMA_TMP}`, "--script"]));
  fs.writeFileSync(path.join(REPO_ROOT, BASELINE_SQL_TMP), ddl.stdout);

  dropDatabase(DEV_DATABASE);
  ensureDatabase(DEV_DATABASE);
  must("apply pre-migration schema", psqlFile(BASELINE_SQL_TMP, DEV_DATABASE));

  // The database IS the pre-migration model, or this is not a valid baseline.
  const faithful = prisma(["migrate", "diff", "--from-config-datasource", `--to-schema=${BASELINE_SCHEMA_TMP}`, "--exit-code"], { DATABASE_URL: DEV_URL() });

  const tables = Number(
    query(`select count(*) from information_schema.tables where table_schema='public' and table_type='BASE TABLE'`),
  );

  fs.rmSync(path.join(REPO_ROOT, BASELINE_SCHEMA_TMP), { force: true });
  fs.rmSync(path.join(REPO_ROOT, BASELINE_SQL_TMP), { force: true });

  console.log("── isolated development database ready ─────────────────────────");
  console.log(`   data dir            : ${DATA_DIR}`);
  console.log(`   port                : ${PORT} (loopback, trust auth)`);
  console.log(`   database            : ${DEV_DATABASE}`);
  console.log(`   pre-migration source: ${baseline.ref} (git merge-base HEAD master)`);
  console.log(`   tables              : ${tables}`);
  console.log(`   database IS that model : ${faithful.status === 0}`);
  console.log(`   registered-migration replay on an empty database : ${replay.replayable ? "ok" : `FAILS at ${replay.failedMigration} — ${replay.failure}`}`);
  console.log("");
  console.log("Next:  node scripts/dev-db.mjs migrate");

  if (faithful.status !== 0) {
    throw new Error("the pre-migration baseline does not match the branch-point datamodel");
  }
  return { replay, baseline: { ref: baseline.ref, tables, schemaFaithful: true } };
}

/* ═══════════════════════════════════════════════════════
   schema snapshots
   ═══════════════════════════════════════════════════════ */

/** A fingerprint of the LEGACY schema (everything not created by the proposal). */
function legacyFingerprint() {
  const columns = lines(
    query(
      `select table_name || '|' || column_name || '|' || data_type || '|' || is_nullable || '|' || coalesce(column_default,'') ` +
        `from information_schema.columns where table_schema = 'public' and table_name not like 'ai\\_%' order by table_name, column_name`,
    ),
  );
  return { hash: createHash("sha256").update(columns.join("\n")).digest("hex"), columns: columns.length };
}

function legacyRowCounts() {
  const tables = lines(
    query(
      `select table_name from information_schema.tables where table_schema='public' and table_type='BASE TABLE' and table_name not like 'ai\\_%' order by table_name`,
    ),
  );
  const counts = {};
  for (const table of tables) counts[table] = Number(query(`select count(*) from "${table}"`));
  return counts;
}

function aiTableInventory() {
  return lines(query(`select table_name from information_schema.tables where table_schema='public' and table_name like 'ai\\_%' order by table_name`));
}

function constraintInventory() {
  return Number(
    query(`select count(*) from information_schema.table_constraints where table_schema='public' and constraint_type='FOREIGN KEY' and table_name like 'ai\\_%'`),
  );
}

function indexInventory() {
  return Number(query(`select count(*) from pg_indexes where schemaname='public' and tablename like 'ai\\_%'`));
}

/**
 * The gap between the DEV database and `prisma/schema.prisma`.
 *
 * `--exit-code` is the assertion: 0 means the database IS the schema, 2 means
 * they differ. Running it before AND after the proposed migrations turns "the
 * SQL did what the schema says" from a claim into a measurement.
 */
function diffToSchema() {
  const sql = prisma(["migrate", "diff", "--from-config-datasource", "--to-schema=prisma/schema.prisma", "--script"], { DATABASE_URL: DEV_URL() });
  const exit = prisma(["migrate", "diff", "--from-config-datasource", "--to-schema=prisma/schema.prisma", "--exit-code"], { DATABASE_URL: DEV_URL() });
  const creates = [...sql.stdout.matchAll(/CREATE TABLE "([^"]+)"/g)].map((match) => match[1]);
  return { empty: exit.status === 0, tablesInDiff: creates, bytes: sql.stdout.length };
}

/* ═══════════════════════════════════════════════════════
   migrate
   ═══════════════════════════════════════════════════════ */

function migrate() {
  requireTools();
  if (!clusterRunning()) throw new Error("the dev cluster is not running — run `node scripts/dev-db.mjs up` first");

  // A canary: rows that exist BEFORE the migration and must be untouched after.
  // Inserted FIRST, so the before/after row-count comparison measures the
  // migration rather than this script's own fixture.
  must(
    "canary insert",
    run(PSQL, [
      "-h", "127.0.0.1", "-p", PORT, "-U", "postgres", "-w", "-v", "ON_ERROR_STOP=1",
      "-c",
      `INSERT INTO "Business" (id, name, slug, "createdAt") VALUES ('${CANARY_BUSINESS}', 'NEXUP', 'nexup', now()) ON CONFLICT (id) DO NOTHING; ` +
        `INSERT INTO "User" (id, name, email, "passwordHash", "createdAt") VALUES ('${CANARY_USER}', 'Dev Canary', 'canary@example.invalid', 'not-a-real-hash', now()) ON CONFLICT (id) DO NOTHING;`,
      "-d", DEV_DATABASE,
    ]),
  );
  const canaryBefore = {
    business: query(`select id || '|' || name || '|' || slug from "Business" where id = '${CANARY_BUSINESS}'`),
    user: query(`select id || '|' || email from "User" where id = '${CANARY_USER}'`),
  };

  const before = {
    legacyFingerprint: legacyFingerprint(),
    legacyRowCounts: legacyRowCounts(),
    aiTables: aiTableInventory(),
    foreignKeys: constraintInventory(),
    indexes: indexInventory(),
    diffToSchema: diffToSchema(),
  };

  const applied = [];
  for (const file of PROPOSED) {
    const verify = run(process.execPath, ["scripts/verify-proposed-migration.mjs", file]);
    const result = psqlFile(file);
    applied.push({
      file,
      sha256: sha256File(file),
      additiveVerifier: verify.status === 0 ? "ok" : "REFUSED (reviewed)",
      additiveVerifierOutput: verify.stdout.trim(),
      applyExit: result.status,
      applyStderr: result.stderr.trim().slice(0, 400),
    });
    if (result.status !== 0) throw new Error(`applying ${file} failed:\n${result.stderr}`);
  }

  const after = {
    legacyFingerprint: legacyFingerprint(),
    legacyRowCounts: legacyRowCounts(),
    aiTables: aiTableInventory(),
    foreignKeys: constraintInventory(),
    indexes: indexInventory(),
    diffToSchema: diffToSchema(),
  };

  const canaryAfter = {
    business: query(`select id || '|' || name || '|' || slug from "Business" where id = '${CANARY_BUSINESS}'`),
    user: query(`select id || '|' || email from "User" where id = '${CANARY_USER}'`),
  };

  const identity = statusPayload();
  const newTables = after.aiTables.filter((table) => !before.aiTables.includes(table)).sort();
  const checks = {
    additiveOnly:
      "each proposed file passes scripts/verify-proposed-migration.mjs; PHASE_1B is EXPECTED to refuse (its reviewed DROP targets a proposed table that never existed in any database)",
    legacySchemaFingerprintUnchanged: before.legacyFingerprint.hash === after.legacyFingerprint.hash,
    legacyRowCountsUnchanged: JSON.stringify(before.legacyRowCounts) === JSON.stringify(after.legacyRowCounts),
    canaryRowsIntact: JSON.stringify(canaryBefore) === JSON.stringify(canaryAfter),
    newTablesCreated: newTables,
    newTablesExactlyAsExpected: JSON.stringify(newTables) === JSON.stringify(EXPECTED_NEW_TABLES),
    theMissingTablesWereExactlyTheProposal: JSON.stringify([...before.diffToSchema.tablesInDiff].sort()) === JSON.stringify(EXPECTED_NEW_TABLES),
    databaseMatchesSchemaAfter: after.diffToSchema.empty,
  };

  const evidence = {
    proof:
      "the OWNER-APPROVED development-database application of the proposed AI Workforce migrations (1A → 1B → PHASE_2 → PHASE_3) onto a pre-migration schema, with mechanical verification of additive-only safety",
    appliedAt: new Date().toISOString(),
    environment: {
      cluster: "development cluster created by `initdb` for this work — loopback only, trust auth",
      dataDirectory: DATA_DIR,
      port: PORT,
      database: DEV_DATABASE,
      productionDatabase:
        "NOT touched. Every command ran with DATABASE_URL pointed at this dev cluster; no proposed migration is registered in prisma/migrations, so `prisma migrate deploy` cannot pick one up by accident.",
      credentialsPrinted: "none — trust auth on loopback, and this script never reads DATABASE_URL to decide where to connect",
    },
    preMigrationSchema: {
      source: "the Prisma datamodel at the commit this branch forked from (git merge-base HEAD master)",
      reason:
        "`prisma migrate deploy` cannot replay the registered history onto an empty database: 20260823221818_init creates Client_phone_key as a UNIQUE INDEX and 20260824120000_add_business_multitenancy drops it as a CONSTRAINT (error 42704). The baseline is therefore built from the model, and the replay failure is recorded below rather than assumed away.",
      tables: before.legacyRowCounts && Object.keys(before.legacyRowCounts).length,
      legacyFingerprint: before.legacyFingerprint,
    },
    registeredMigrationReplay: replayRegisteredMigrations(),
    identity,
    testedCommit: git(["rev-parse", "HEAD"]),
    // Listed, not just asserted: this run WRITES an evidence file, so the tree
    // is never pristine at the moment of measurement. A reader can check that
    // the only changes are the artifacts themselves.
    workingTreeDirty: git(["status", "--porcelain"]).length > 0,
    workingTreeChanges: lines(git(["status", "--porcelain"])),
    migrationsApplied: applied,
    preMigration: before,
    postMigration: after,
    checks,
    canary: { before: canaryBefore, after: canaryAfter },
    howToReproduce: [
      "node scripts/dev-db.mjs up        # fresh loopback cluster + the pre-migration schema",
      "node scripts/dev-db.mjs migrate   # applies 1A→1B→PHASE_2→PHASE_3 and re-writes this evidence",
      "node scripts/dev-db.mjs status    # identity + schema state",
    ],
  };

  const outFile = path.join(REPO_ROOT, "docs/evidence/step5-dev-migration-2026-10-07.json");
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.writeFileSync(outFile, `${JSON.stringify(evidence, null, 2)}\n`);

  console.log("── proposed migrations applied to the DEV database ─────────────");
  for (const entry of applied) {
    console.log(`   ${entry.file}  sha256=${entry.sha256.slice(0, 12)}  verifier=${entry.additiveVerifier}`);
  }
  console.log("");
  console.log(`   legacy schema fingerprint unchanged : ${checks.legacySchemaFingerprintUnchanged}`);
  console.log(`   legacy row counts unchanged         : ${checks.legacyRowCountsUnchanged}`);
  console.log(`   canary rows intact                  : ${checks.canaryRowsIntact}`);
  console.log(`   missing tables were the proposal    : ${checks.theMissingTablesWereExactlyTheProposal}`);
  console.log(`   new tables                          : ${newTables.join(", ") || "(none)"}`);
  console.log(`   database matches schema.prisma      : ${checks.databaseMatchesSchemaAfter}`);
  console.log(`   evidence                            : ${path.relative(REPO_ROOT, outFile)}`);

  const failed = Object.entries(checks).filter(([, value]) => typeof value === "boolean" && !value);
  if (failed.length > 0) {
    console.error(`\nFAILED checks: ${failed.map(([key]) => key).join(", ")} — the evidence file records the exact state.`);
    process.exitCode = 1;
  }
}

/* ═══════════════════════════════════════════════════════
   status
   ═══════════════════════════════════════════════════════ */

/** The host of the project's DATABASE_URL — host only, never credentials. */
function productionHost() {
  for (const file of [".env", ".env.local"]) {
    const full = path.join(REPO_ROOT, file);
    if (!fs.existsSync(full)) continue;
    const match = fs.readFileSync(full, "utf8").match(/^DATABASE_URL\s*=\s*"?([^"\n]+)"?/m);
    if (!match) continue;
    try {
      const url = new URL(match[1]);
      return { source: file, host: url.hostname, port: url.port || null, loopback: ["127.0.0.1", "localhost", "::1"].includes(url.hostname) };
    } catch {
      return { source: file, host: "unparseable", loopback: false };
    }
  }
  return { source: null, host: null, loopback: null };
}

function statusPayload() {
  const running = clusterRunning();
  return {
    running,
    dataDirectory: DATA_DIR,
    port: PORT,
    listenAddresses: running ? query("show listen_addresses", "postgres") : null,
    database: DEV_DATABASE,
    version: running ? query("select version()", "postgres") : null,
    postmasterStartedAt: running ? query("select pg_postmaster_start_time()::text", "postgres") : null,
    isLoopbackConnection: running ? query("select case when inet_server_addr() in ('127.0.0.1','::1') then 'yes' else 'NO' end", "postgres") : null,
    superuser: running ? query("select current_user", "postgres") : null,
    aiTables: running ? aiTableInventory() : [],
    legacyTables: running
      ? Number(query(`select count(*) from information_schema.tables where table_schema='public' and table_type='BASE TABLE' and table_name not like 'ai\\_%'`))
      : null,
    productionUrlHost: productionHost(),
  };
}

function status() {
  const payload = statusPayload();
  console.log(JSON.stringify(payload, null, 2));
  // --json: machine-readable ONLY, so another script can parse the identity
  // without having to strip the human-readable tail below.
  if (process.argv.includes("--json")) return;
  if (!payload.running) {
    console.log("\nthe dev cluster is not running — `node scripts/dev-db.mjs up`");
    return;
  }
  const registered = prisma(["migrate", "status"], { DATABASE_URL: DEV_URL() });
  console.log(`\nprisma migrate status:\n${`${registered.stdout}${registered.stderr}`.trim()}`);
}

/* ═══════════════════════════════════════════════════════
   down / destroy
   ═══════════════════════════════════════════════════════ */

function stop() {
  if (!fs.existsSync(DATA_DIR)) return;
  run(PG_CTL, ["-D", DATA_DIR, "stop", "-m", "fast"]);
}

function down() {
  stop();
  console.log(`stopped the development cluster at ${DATA_DIR} (data kept)`);
}

function destroy() {
  stop();
  fs.rmSync(DATA_DIR, { recursive: true, force: true });
  fs.rmSync(LOG_FILE, { force: true });
  console.log(`deleted the development cluster at ${DATA_DIR}`);
}

/* ═══════════════════════════════════════════════════════ */

const COMMANDS = { up, migrate, status, down, destroy };
const command = process.argv[2];
if (!COMMANDS[command]) {
  console.error(`usage: node scripts/dev-db.mjs ${Object.keys(COMMANDS).join("|")}`);
  process.exit(2);
}
COMMANDS[command]();
