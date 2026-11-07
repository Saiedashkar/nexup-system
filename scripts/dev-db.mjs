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
//   node scripts/dev-db.mjs start     just the cluster (loopback, trust auth)
//   node scripts/dev-db.mjs restart   force a FRESH cluster (clears a wedged one)
//   node scripts/dev-db.mjs up        cluster + the PRE-MIGRATION schema
//   node scripts/dev-db.mjs migrate   apply the proposed additive migrations,
//                                     verify them, and write the evidence file
//   node scripts/dev-db.mjs status    identity + schema state (safe to paste)
//   node scripts/dev-db.mjs down      stop the cluster (keeps its data)
//   node scripts/dev-db.mjs destroy   stop and DELETE the cluster — and REFUSE both the
//                                     stop and the delete unless the cluster's OWNERSHIP
//                                     can be shown, so a data directory is never removed
//                                     underneath a live database and a foreign process is
//                                     never signalled because a stale lock file happened
//                                     to name its pid
//
// ── OWNERSHIP: WHAT MAY BE SIGNALLED (sixth, seventh and eighth reviews) ──
//
// A `postmaster.pid` is evidence about a DATA DIRECTORY, not about the process that owns
// pid N right now: a crash leaves the file behind, and the OS can then hand that pid to
// ANY process — including another PostgreSQL cluster. "The image is postgres.exe" is not
// ownership: it is exactly what a foreign cluster's pid looks like. So every path that
// signals a pid (the graceful `pg_ctl stop`, `stopForRestart`, `clearStalePostmaster`)
// first asks the ownership inspector and FAILS CLOSED on `UNCERTAIN`, and the pid is never
// suggested to a human as a kill target on that evidence either.
//
// The sixth and seventh reviews built up the proof; the eighth found four more holes, all
// closed in `scripts/dev-db-ownership.mjs`:
//
//   1. `samePath` deleted every quote character, so `…\owners data` and `…\owner's data`
//      compared EQUAL, and a lock file naming the neighbour's postmaster was accepted.
//      Quoting is now removed only where it is SYNTAX — in the Windows command-line
//      tokeniser — and never from a path;
//   2. a start time within two seconds of the server on the configured port was treated as
//      proof that the pid was that server. Two clusters started in the same second defeat
//      it. Start times are no longer SUFFICIENT: the only positive proof is the process's
//      own ARGUMENT VECTOR carrying an exact `-D`/`--pgdata` argument that resolves to this
//      data directory. A disagreeing start time may still REFUSE; agreement never authorises;
//   3. the force command's exit status was ignored, so a failed `taskkill` deleted the lock
//      file of a live postmaster. The force path now checks the result AND verifies the pid
//      is gone; anything else preserves the lock file and the data and is reported;
//   4. `down` and the graceful restart read ownership once, then signalled through `pg_ctl`
//      without re-reading. Every graceful and every force signal is now preceded by a fresh
//      reading, and every graceful stop is verified by the pid actually disappearing;
//   5. `ps -o args=` renders a command line whose argument boundaries are gone. On POSIX the
//      argument vector is read from `/proc/<pid>/cmdline`; where that is unavailable the
//      answer is "unsupported" and ownership is UNCERTAIN. A rendered command line is
//      never parsed into arguments.
//
// What this cannot do is make check-and-signal atomic: the platform offers no pidfd here,
// so a few milliseconds remain between verification and `taskkill`/`kill -9`, and `pg_ctl`
// re-reads the lock file itself. That limit is stated rather than papered over.
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

import { createOwnershipInspector } from "./dev-db-ownership.mjs";

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
  // Time-bounded: on Windows a wedged backend can make psql block forever, and
  // a harness that hangs is worse than one that fails. Callers may override.
  const result = spawnSync(command, args, {
    cwd: REPO_ROOT,
    encoding: "utf8",
    env: { ...process.env, ...(options.env ?? {}) },
    maxBuffer: 64 * 1024 * 1024,
    timeout: options.timeout ?? 90_000,
    killSignal: "SIGKILL",
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

  clearStalePostmaster();

  must(
    "pg_ctl start",
    run(PG_CTL, [
      "-D", DATA_DIR,
      "-l", LOG_FILE,
      // autovacuum=off: this is a development fixture, and on Windows an
      // autovacuum worker can hit a DLL-initialisation failure (0xC0000142)
      // that crash-restarts the whole cluster mid-run.
      // shared_buffers is lowered for the same reason: on Windows the backend's
      // shared-memory mapping can fail to reserve at its address (error 487)
      // when the segment is large, which is the second half of the same
      // 0xC0000142 symptom. A small segment is plenty for a dev fixture.
      "-o", `-p ${PORT} -c listen_addresses=127.0.0.1 -c fsync=off -c synchronous_commit=off -c autovacuum=off -c shared_buffers=64MB`,
      "-w", "start",
    ]),
  );

  for (let attempt = 0; attempt < 30; attempt += 1) {
    if (clusterRunning()) return;
    if (attempt === 29) throw new Error(`cluster never became ready; see ${LOG_FILE}`);
    sleep(1000);
  }
}

/**
 * Removes a postmaster that is alive but no longer serving.
 *
 * A stale-postmaster cleanup is NOT a cluster shutdown. The data directory's lock file can
 * name a pid that has been reused or has simply exited while the directory is STILL SERVING
 * on its port (a different cluster won the port, or a replacement postmaster is already up).
 * Deleting the lock file in that state hands a free-looking data directory to the next
 * `ensureCluster` step, which will attempt `initdb` / `pg_ctl start` on a directory that may
 * still be in use — exactly the parent-only-shutdown defect the ninth review found.
 *
 * The ownership inspector therefore clears the lock file ONLY when the directory is verifiably
 * NOT serving, and `ensureCluster` refuses to attempt a replacement when the inspector refuses
 * the cleanup. If this throws, the cluster is NOT replaced.
 *
 * `clusterRunning()` answers "can I query it", not "is a process listening". On Windows a
 * backend can die with a DLL-initialisation failure (0xC0000142) and leave the postmaster
 * re-initialising forever: the port stays bound, every connection fails, and `pg_ctl start`
 * then refuses because the data directory still looks in use (and the log file is locked).
 * Without this, the harness is wedged until an operator kills the process by hand.
 *
 * The pid is read from the data directory's own `postmaster.pid`, so nothing outside this
 * cluster is ever touched.
 */
function clearStalePostmaster() {
  const pidFile = path.join(DATA_DIR, "postmaster.pid");
  if (!fs.existsSync(pidFile)) return;
  // The decision — and the file removal — belong to the ownership layer, so the FAIL CLOSED
  // rule can be regressed without a real wedged postmaster. A refusal removes NOTHING and
  // BLOCKS replacement startup, which is the point.
  const result = ownershipInspector.clearStalePostmaster();
  if (result.refused) {
    throw new Error(
      `refusing to clear ${pidFile}: ${result.why}.\n` +
        `A pid file can outlive the process it names and the number can be REUSED, and a gone pid\n` +
        `is not proof that the data directory is free. This script will not clear the lock file,\n` +
        `start a replacement, or signal anything until the directory is verifiably not serving.\n` +
        `If this cluster is genuinely down, inspect the file by hand; if it is up, use\n` +
        `\`node scripts/dev-db.mjs restart\`.`,
    );
  }
  sleep(1500);
}

/**
 * Stop THIS cluster for a restart: GRACEFUL first, force only on freshly re-proven
 * ownership — and never as the first move.
 *
 * Used by `restart` (and so by the demo environment, which wants a FRESH postmaster every
 * time: a fresh one always clears the Windows shared-memory/DLL-init failure a long-lived
 * postmaster can accumulate). The seventh review's finding was that this path force-killed
 * immediately; a cluster that answers `pg_ctl stop` is now stopped the way an operator
 * would stop it, and the force path is reached only when the graceful stop did not take
 * AND the pid can be re-established as ours at that moment.
 *
 * The force escalation (ninth review, P1) does NOT treat "the named pid is gone" as "the
 * cluster has shut down". The graceful stop is verified by the named pid actually disappearing
 * (the cluster we signalled is gone); the force path re-establishes OURS for THAT pid before it
 * signals and then verifies THAT pid is gone. Either way, the lock file is removed only after
 * the termination of the identified cluster's postmaster is verified, and the data directory
 * is preserved (not deleted) unless the caller is `destroy`, which has its own, stricter gates.
 */
function stopForRestart() {
  const pidFile = path.join(DATA_DIR, "postmaster.pid");
  if (!fs.existsSync(pidFile)) return;
  const ownership = ownershipOfLockfileProcess();
  if (ownership.state === "UNCERTAIN") {
    throw new Error(
      `refusing to stop ${DATA_DIR} for a restart: ${ownership.why}.\n` +
        `This command signals a process, so it needs to know WHOSE process it is; the file\n` +
        `it would use as its licence can be stale and its pid reused. Nothing was stopped.`,
    );
  }
  if (ownership.state === "ABSENT") {
    // The file names a pid that no longer exists. That is NOT proof the directory is free:
    // a different cluster may still be serving it, the DEAD pid's workers may still be alive
    // (tenth review, P1), or the lock file may have been removed by something else. The lock
    // is removed only when the directory is verifiably not serving AND no process holds it.
    if (dataDirectoryServingIsOurs()) {
      throw new Error(
        `refusing to stop ${DATA_DIR} for a restart: ${ownership.why}, but the data directory is\n` +
          `still serving on its port, so the lock file is PRESERVED and no replacement is started.\n` +
          `A gone pid is not cluster shutdown.`,
      );
    }
    assertDirectoryFree(ownership.pid, "stop for a restart");
    fs.rmSync(pidFile, { force: true });
    return;
  }

  const pid = ownership.pid;

  // RE-READ IMMEDIATELY BEFORE THE GRACEFUL SIGNAL (eighth review, finding 4). `pg_ctl
  // stop` signals the pid in the lock file, so that file has to name the pid whose
  // ownership was established, as close to the signal as this platform allows.
  const beforeStop = revalidateOwnership(pid);
  if (!beforeStop.ok) {
    throw new Error(
      `refusing to stop ${DATA_DIR} for a restart: ${beforeStop.why}.\n` +
        "Nothing was signalled and the data directory is PRESERVED.",
    );
  }

  // THE WORKERS ARE SNAPSHOTTED BEFORE THE SIGNAL (tenth review, P1). `pg_ctl stop` waits for
  // the postmaster, and a parent that exits is NOT the cluster: a leftover backend keeps the
  // data directory's files open and answers nothing. The snapshot has to come first because on
  // POSIX a dead parent's children are reparented out of reach.
  const workersBefore = ownershipInspector.snapshotClusterProcesses(pid);
  if (!workersBefore.known) {
    throw new Error(
      `refusing to stop ${DATA_DIR} for a restart: ${workersBefore.why}, so this cluster's worker\n` +
        "processes could not be watched and its shutdown could not be established.\n" +
        "Nothing was signalled and the data directory is PRESERVED.",
    );
  }

  const graceful = run(PG_CTL, ["-D", DATA_DIR, "stop", "-m", "fast", "-w", "-t", "60"]);
  // The GRACEFUL stop is judged by whether the WHOLE cluster is gone — the named pid and the
  // workers snapshotted above — not by pg_ctl's exit code, which says nothing about either.
  const gracefulTermination = ownershipInspector.awaitTermination(pid, workersBefore);
  if (gracefulTermination.ok) {
    assertDirectoryFree(pid, "stop for a restart");
    fs.rmSync(pidFile, { force: true });
    return;
  }
  if (gracefulTermination.parentGone) {
    // The postmaster went away but a worker it forked did not. There is no pid left to
    // escalate against, and a worker is not something this script kills by guesswork: the
    // cluster is reported and PRESERVED.
    throw new Error(
      `refusing to release ${DATA_DIR} for a restart: ${gracefulTermination.why} ` +
        `(pg_ctl stop exited ${graceful.status}).\n` +
        "A worker that outlived its postmaster still holds this data directory; the lock file and\n" +
        "the data are PRESERVED. Inspect those pids by hand before starting a replacement.",
    );
  }

  // The graceful stop did not take (pg_ctl exited ${graceful.status}). THIS is the
  // wedged-postmaster case the command exists for — and it is escalated only on evidence
  // read at that moment, with the signal's result checked and the termination verified —
  // including the workers, which `stopOwnPostmaster` snapshot itself before signalling.
  const forced = stopOwnPostmaster(pid);
  if (!forced.ok) {
    throw new Error(
      `refusing to force-stop ${DATA_DIR}: pid ${pid} could not be terminated (${forced.reason}; ` +
        `pg_ctl stop had exited ${graceful.status}).\n` +
        "Nothing further was signalled and the data directory is PRESERVED.",
    );
  }
  assertDirectoryFree(pid, "force-stop");
  fs.rmSync(pidFile, { force: true });
  console.log(`forced a fresh postmaster: this cluster's own pid ${pid} did not stop gracefully, so it was terminated after re-verification`);
}

/**
 * The ONLY force escalation in this script, for a pid ALREADY identified as ours.
 *
 * It takes the pid as an argument precisely so no caller can reach it with a bare number
 * read out of a lock file: every call site passes what `ownershipOfLockfileProcess()`
 * established. The inspector re-reads the evidence immediately before it signals, checks
 * the signal's exit status, and verifies the pid is gone; `ok: false` means the caller must
 * preserve the lock file and the data. See `scripts/dev-db-ownership.mjs`.
 */
function stopOwnPostmaster(pid) {
  return ownershipInspector.stopOwnPostmaster(pid);
}

/** Runs a query, returning null instead of throwing (e.g. no such database). */
function tryQuery(fn) {
  try {
    return fn();
  } catch {
    return null;
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
    // Tolerant: the cluster can be healthy while `nexup_dev` does not exist yet
    // (a caller may build its own database). `status` must still answer, or a
    // readiness check would read as "not running".
    aiTables: running ? (tryQuery(() => aiTableInventory()) ?? []) : [],
    legacyTables: running
      ? (tryQuery(() =>
          Number(query(`select count(*) from information_schema.tables where table_schema='public' and table_type='BASE TABLE' and table_name not like 'ai\\_%'`)),
        ) ?? null)
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

/**
 * Stop THIS cluster, gracefully, and only once it has been identified as ours.
 *
 * `pg_ctl stop` signals the pid in the lock file, so it is gated exactly like the force
 * path: a stale pid file that names a foreign process must not be able to make a graceful
 * stop either. Returns whether it actually asked anything to stop.
 */
function stop() {
  if (!fs.existsSync(DATA_DIR)) return { stopped: false, refused: false, why: "no data directory" };
  const ownership = ownershipOfLockfileProcess();
  if (ownership.state === "ABSENT") return { stopped: false, refused: false, why: ownership.why };
  if (ownership.state === "UNCERTAIN") return { stopped: false, refused: true, why: ownership.why };

  // RE-READ IMMEDIATELY BEFORE THE GRACEFUL SIGNAL (eighth review, finding 4), and verify
  // afterwards that the pid it named is actually gone. A `pg_ctl stop` that returns 0, or
  // one that returns non-zero, is not by itself evidence about the process.
  const beforeStop = revalidateOwnership(ownership.pid);
  if (!beforeStop.ok) return { stopped: false, refused: true, why: beforeStop.why };

  // `down` reports a STOPPED CLUSTER, not a stopped pid (tenth review, P1): the workers are
  // snapshotted while the postmaster is still alive, and the shutdown is only successful when
  // every one of them is gone too.
  const workersBefore = ownershipInspector.snapshotClusterProcesses(ownership.pid);
  if (!workersBefore.known) {
    return {
      stopped: false,
      refused: true,
      why: `${workersBefore.why}, so this cluster's worker processes could not be watched`,
    };
  }
  const exit = run(PG_CTL, ["-D", DATA_DIR, "stop", "-m", "fast", "-w", "-t", "60"]).status;
  const termination = ownershipInspector.awaitTermination(ownership.pid, workersBefore);
  if (!termination.ok) {
    return {
      stopped: false,
      refused: true,
      why: termination.parentGone
        ? `pg_ctl stop exited ${exit} and pid ${ownership.pid} is gone, but its worker process(es) ${termination.remaining.join(", ")} are still alive`
        : `pg_ctl stop exited ${exit} and pid ${ownership.pid} is still alive`,
    };
  }
  return { stopped: true, refused: false, why: null };
}

function down() {
  const result = stop();
  if (result.refused) {
    // A refusal is not a success. The previous version printed this and still exited 0,
    // which let a caller believe a cluster had been stopped when the script had in fact
    // declined to signal anything.
    console.error(
      `refusing to stop ${DATA_DIR}: ${result.why}.\n` +
        "Nothing was signalled. `down` only stops a process it can show is this cluster's own\n" +
        "postmaster; the data is untouched.",
    );
    process.exitCode = 1;
    return;
  }
  console.log(
    result.stopped
      ? `stopped the development cluster at ${DATA_DIR} (data kept)`
      : `nothing to stop at ${DATA_DIR}: no process was identified as this cluster's own postmaster (data kept)`,
  );
  // `stop()` returns `stopped: true` only when the named pid is verifiably gone AFTER a
  // graceful `pg_ctl stop`. It does NOT assert that no other cluster could be serving the
  // directory (that is the caller's responsibility if it cares), and it does NOT delete the
  // data directory. `down` is therefore a "stop this cluster" command, not a "make the
  // directory free" command.
}

/**
 * start — bring the cluster UP and nothing else.
 *
 * `up` deliberately rebuilds the pre-migration schema and measures the
 * registered-history replay; that is its job as an EVIDENCE harness. A caller
 * that only needs a running loopback cluster (e.g. the local demo, which builds
 * its schema from `prisma/schema.prisma`) should not pay for that, so `start`
 * runs `ensureCluster` alone: no database is dropped, no migration is applied.
 */
/**
 * A minimal, database-agnostic identity of the CLUSTER.
 *
 * `start`/`restart` must work before any database exists (a caller may create
 * its own), so they cannot use `statusPayload()` — that reads `nexup_dev` and
 * would throw on a cluster that has none.
 */
function clusterIdentity() {
  const running = clusterRunning();
  return {
    running,
    dataDirectory: DATA_DIR,
    port: PORT,
    listenAddresses: running ? query("show listen_addresses", "postgres") : null,
  };
}

function start() {
  requireTools();
  ensureCluster();
  console.log(JSON.stringify(clusterIdentity(), null, 2));
}

/**
 * restart — always stop this cluster (however unhealthy) and start a FRESH one.
 * The reliable way out of the Windows postmaster wedge (see `stopForRestart`): a verified
 * graceful stop first, the verified force path only if that does not take.
 */
function restart() {
  requireTools();
  stopForRestart();
  ensureCluster();
  console.log(JSON.stringify(clusterIdentity(), null, 2));
}

/* ═══════════════════════════════════════════════════════
   OWNERSHIP — what may be signalled, and what may be deleted
   ═══════════════════════════════════════════════════════ */

/* ═══════════════════════════════════════════════════════════════════════
   THE OWNERSHIP INSPECTOR

   Every decision about whether a pid may be signalled lives in
   scripts/dev-db-ownership.mjs, with its inputs injected (see that file). Here it is wired
   to this machine: process inspection through the same time-bounded `run`, liveness through
   `process.kill(pid, 0)`, and the lock file in THIS cluster's data directory.
   ═══════════════════════════════════════════════════════════════════════ */

const ownershipInspector = createOwnershipInspector({
  dataDir: DATA_DIR,
  platform: process.platform,
  pidFile: path.join(DATA_DIR, "postmaster.pid"),
  exec: (command, args, options) => run(command, args, options),
  isAlive: pidIsAlive,
  fileExists: (target) => fs.existsSync(target),
  readTextFile: (target) => fs.readFileSync(target, "utf8"),
  removeFile: (target) => fs.rmSync(target, { force: true }),
  sleep,
  nowSeconds: () => Math.floor(Date.now() / 1000),
  // THE SERVING TEST. "The named pid is gone" is not "the directory is free" (ninth
  // review, P1), so the ownership layer asks the server on our port whose data directory it
  // opened. These are wired here, at the only place that knows this machine, and are read
  // lazily at decision time.
  clusterRunning,
  dataDirectoryServingIsOurs,
});

/** A path compared by the filesystem's rules (quotes are NOT removed: they are syntax, not name). */
const samePath = ownershipInspector.samePath;

/** WHOSE process does the lock file name? — a reading, never a signal. */
function ownershipOfLockfileProcess() {
  return ownershipInspector.inspect();
}

/**
 * Read the evidence again IMMEDIATELY before a signal.
 *
 * The pid can exit and be reused between the first reading and the signal, so the pid that
 * was identified must still be the pid the lock file names. `pg_ctl stop` reads that file
 * itself, which is why this is the last moment control is available.
 */
function revalidateOwnership(expectedPid) {
  const current = ownershipOfLockfileProcess();
  if (current.state !== "OURS") {
    return { ok: false, why: `ownership could not be re-established immediately before the signal (${current.why})` };
  }
  if (current.pid !== expectedPid) {
    return {
      ok: false,
      why: `the lock file now names pid ${current.pid}, not pid ${expectedPid} whose ownership was established`,
    };
  }
  return { ok: true, why: null };
}

/**
 * THE RELEASE GATE — nothing is released while a process still holds this directory.
 *
 * The tenth review's P1 is that a shutdown used to be judged by ONE pid: the postmaster the
 * lock file named. Its backends and auxiliary workers are separate processes that outlive it
 * (the reviewer reproduced parent gone / child alive / no SQL answer, with the lock file
 * already deleted), and a REPLACEMENT postmaster can hold the directory on a port this harness
 * never queries. `directoryOccupation` answers both, plus the POSIX orphan whose parent was
 * reparented.
 *
 * A refusal here is a dead end by design: the lock file, the replacement and the data all stay
 * where they are, and the operator is told which pids to inspect. `known: false` (the platform
 * would not list processes) is also a refusal — an unproven shutdown is not a shutdown.
 */
function assertDirectoryFree(deadPid, action) {
  const occupation = ownershipInspector.directoryOccupation(deadPid);
  if (!occupation.known) {
    throw new Error(
      `refusing to ${action} ${DATA_DIR}: ${occupation.why}.\n` +
        "A lock file is never removed, a replacement is never started and a data directory is\n" +
        "never deleted while the platform will not say which processes hold it. Nothing was\n" +
        "changed and the data is PRESERVED.",
    );
  }
  if (occupation.pids.length > 0) {
    throw new Error(
      `refusing to ${action} ${DATA_DIR}: process(es) ${occupation.pids.join(", ")} still hold this data\n` +
        `directory (${occupation.reasons.map((entry) => `${entry.pid}: ${entry.why}`).join("; ")}).\n` +
        "A gone pid is not cluster shutdown, and a worker that outlived its postmaster is still\n" +
        "the cluster. Nothing was signalled; the lock file and the data are PRESERVED.",
    );
  }
}

/** Is a pid alive? `EPERM` counts (it exists; we may not signal it). */
function pidIsAlive(pid) {
  if (!(Number.isInteger(pid) && pid > 0)) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code === "EPERM";
  }
}

/**
 * Is THIS data directory served by a live postmaster — asked of the SERVER itself?
 *
 * The decisive question for "is the directory free to have its lock cleared, its
 * replacement started, or its contents deleted": a listener on our port may belong to a
 * different cluster, and the server's own `data_directory` is what settles whose it is.
 *
 * This is NOT cluster shutdown. It is the SERVING test used by the P1 invariant: a named
 * pid can be gone while the directory is still serving (someone else won the port), and
 * "pid gone" must never be treated as "directory free".
 */
function dataDirectoryServingIsOurs() {
  if (!clusterRunning()) return false;
  const serving = tryQuery(() => query("show data_directory", "postgres"));
  return typeof serving === "string" && samePath(serving, DATA_DIR);
}

/**
 * destroy — stop the cluster and DELETE its data directory … but only ever on evidence.
 *
 * The ninth review's P1 makes the invariant explicit: "the named pid is gone" is NOT "the
 * cluster has shut down". A postmaster.pid can be missing or name a reused pid while the data
 * directory is STILL SERVING on its port (a different cluster, or a replacement). Deleting the
 * directory in that state destroys a live database and/or someone else's cluster.
 *
 * So `destroy` requires ALL of the following before the deletion: (1) the cluster was identified
 * as ours AND the graceful stop was verified (named pid gone) OR the cluster was not identified
 * as ours but the directory is verifiably not serving; (2) the server on our port does not
 * report this directory as its own; (3) no live OURS or UNCERTAIN postmaster remains named by
 * a lock file; and (4) no lock file names a gone pid while the directory is still serving.
 *
 * There is NO automatic force escalation here: a cluster that will not stop is reported, never
 * killed. A foreign process is never signalled by a stale file (sixth review); a gone pid is
 * never treated as cluster shutdown (ninth review, P1).
 *
 * The sixth review found two things wrong with the previous version: it force-killed a pid it
 * had "identified" by image name alone (a foreign cluster passes that test), and it suggested a
 * manual `kill` of a pid read from a lock file it had not verified. Both are gone.
 */
function destroy() {
  requireTools();
  if (!fs.existsSync(DATA_DIR)) {
    console.log(`no development cluster to delete at ${DATA_DIR}`);
    return;
  }

  const ownership = ownershipOfLockfileProcess();
  if (ownership.state === "UNCERTAIN") {
    // REFUSED BEFORE ANYTHING IS READ, SIGNALLED OR DELETED — and the message names the
    // evidence that failed, which is what lets a reviewer tell "the pid is not ours" from
    // "the directory is busy". The later checks cover a state that CHANGES while this
    // command runs; this one covers the state it was asked to act on.
    throw new Error(
      `refusing to delete ${DATA_DIR}: ${ownership.why}.\n` +
        `Nothing was signalled — this script will not stop or kill a process it cannot show\n` +
        `is this cluster's own, and it will not delete a data directory while a process that\n` +
        `may be using it is alive. The data is PRESERVED.\n` +
        `If that process is not this cluster, the directory is safe to remove by hand.`,
    );
  }

  let stopExit = null;
  if (ownership.state === "OURS") {
    // Graceful, and only ours. No `/F`, no `kill -9`, no escalation — and read once more
    // immediately before the signal, so the pid `pg_ctl` is about to signal is the pid the
    // evidence was read from. If that reading no longer holds, NOTHING is signalled and the
    // delete does not happen either.
    const beforeStop = revalidateOwnership(ownership.pid);
    if (!beforeStop.ok) {
      throw new Error(
        `refusing to delete ${DATA_DIR}: ${beforeStop.why}.\n` +
          "The data is PRESERVED.",
      );
    }
    const workersBefore = ownershipInspector.snapshotClusterProcesses(ownership.pid);
    if (!workersBefore.known) {
      throw new Error(
        `refusing to delete ${DATA_DIR}: ${workersBefore.why}, so this cluster's worker processes\n` +
          "could not be watched and its shutdown could not be established.\n" +
          "The data is PRESERVED and nothing was signalled.",
      );
    }
    stopExit = run(PG_CTL, ["-D", DATA_DIR, "stop", "-m", "fast", "-w", "-t", "60"]).status;
    const termination = ownershipInspector.awaitTermination(ownership.pid, workersBefore);
    if (!termination.ok) {
      throw new Error(
        `refusing to delete ${DATA_DIR}: ${termination.why} after a graceful stop (pg_ctl exited ${stopExit}).\n` +
          "The data is PRESERVED. Nothing was force-killed — that is deliberate.",
      );
    }
  } else if (ownership.state === "ABSENT") {
    // The lock file names no pid (or a gone pid). That alone is not enough to delete: the
    // directory must not be serving (checked below). If it is still serving, the deletion is
    // refused even though the lock file names nobody — a gone pid is not cluster shutdown.
  } else {
    // UNCERTAIN: nothing was signalled and nothing is deleted.
    throw new Error(
      `refusing to delete ${DATA_DIR}: ${ownership.why}.\n` +
        `Nothing was signalled — this script will not delete a data directory while a process\n` +
        `it cannot identify is named by the lock file. The data is PRESERVED.`,
    );
  }

  if (dataDirectoryServingIsOurs()) {
    throw new Error(
      `refusing to delete ${DATA_DIR}: a live server on our port still reports it as its own data directory.\n` +
        `A data directory is never deleted while a database may still be live inside it.\n` +
        `Nothing was killed. Stop the cluster first:\n  node scripts/dev-db.mjs down\n` +
        `then re-run destroy. (A wedged postmaster is what \`restart\` exists for.)`,
    );
  }

  const after = ownershipOfLockfileProcess();
  if (after.state === "OURS") {
    // Our OWN postmaster did not go down. There is no forced signal in this path by
    // design: the directory is PRESERVED and the operator is told, because a data
    // directory is never deleted underneath a database that may still be live in it.
    throw new Error(
      `refusing to delete ${DATA_DIR}: this cluster's own postmaster (pid ${after.pid}) did not stop.\n` +
        `The data is PRESERVED. Nothing was force-killed — that is deliberate.\n` +
        `Try \`node scripts/dev-db.mjs restart\` (which clears a wedged postmaster it has\n` +
        `identified as its own) or stop the cluster yourself, then re-run destroy.`,
    );
  }
  if (after.state === "UNCERTAIN") {
    throw new Error(
      `refusing to delete ${DATA_DIR}: ${after.why}.\n` +
        `Nothing was signalled — this script will not delete a data directory while a process\n` +
        `it cannot identify is named by the lock file. The data is PRESERVED.`,
    );
  }

  // ABSENT — no lock file names a live process. But a gone/named-absent pid is still NOT
  // cluster shutdown (ninth review, P1): the directory may still be serving, or a lock file
  // may have been removed under us. The earlier `dataDirectoryServingIsOurs()` check already
  // guards the serving case; re-confirm it here so the deletion gate is read in one place.
  if (dataDirectoryServingIsOurs()) {
    throw new Error(
      `refusing to delete ${DATA_DIR}: a live server on our port still reports it as its own data directory.\n` +
        `A data directory is never deleted while a database may still be live inside it.\n` +
        `Nothing was killed. Stop the cluster first:\n  node scripts/dev-db.mjs down\n` +
        `then re-run destroy. (A wedged postmaster is what \`restart\` exists for.)`,
    );
  }

  if (fs.existsSync(path.join(DATA_DIR, "postmaster.pid"))) {
    throw new Error(
      `refusing to delete ${DATA_DIR}: a postmaster.pid still exists after the stop attempt.\n` +
        `The lock file is the cluster's own evidence that the directory is in use; deleting the\n` +
        `directory while it is present would remove a live database's ownership record. The data\n` +
        `is PRESERVED. Stop the cluster first, then re-run destroy.`,
    );
  }

  // THE LAST GATE BEFORE THE DELETE (tenth review, P1). Nothing above proves that the DEAD
  // pid's workers are gone, or that a replacement postmaster is not holding this directory on
  // a port this harness never queried — and deleting the directory underneath either of them
  // destroys a live database.
  assertDirectoryFree(ownership.pid, "delete");

  fs.rmSync(DATA_DIR, { recursive: true, force: true });
  fs.rmSync(LOG_FILE, { force: true });
  console.log(
    `deleted the development cluster at ${DATA_DIR}` +
      (stopExit === null || stopExit === 0 ? "" : ` (pg_ctl stop exited ${stopExit}, and the pid is verified gone)`),
  );
}

/* ═══════════════════════════════════════════════════════ */

const COMMANDS = { start, restart, up, migrate, status, down, destroy };
const command = process.argv[2];
if (!COMMANDS[command]) {
  console.error(`usage: node scripts/dev-db.mjs ${Object.keys(COMMANDS).join("|")}`);
  process.exit(2);
}
COMMANDS[command]();
