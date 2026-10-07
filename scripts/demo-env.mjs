#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-require-imports */
// ═══════════════════════════════════════════════════════════════════════
// NEXUP AI WORKFORCE — the ONE-COMMAND local demo environment
// ═══════════════════════════════════════════════════════════════════════
//
// Gives the owner a clean, reproducible environment in which the Step-5
// mission lifecycle can be operated entirely on THIS machine:
//
//   1. `node scripts/dev-db.mjs start` — the isolated cluster on
//      127.0.0.1:5501 (loopback, trust auth);
//   2. rebuild `nexup_dev` from `prisma/schema.prisma` — which already declares
//      the `ai_*` models — so the database the app expects exists without
//      registering anything in `prisma/migrations` and without touching any
//      production database;
//   3. seed a LOCAL, throwaway SUPER_ADMIN login (the app's real login flow —
//      bcrypt, no bypass) and the NEXUP business row;
//   4. write `.demo/env` (git-ignored): the app's environment for the demo,
//      including a freshly generated AUTH_SECRET;
//   5. write `.demo/credentials.txt` (git-ignored): the demo email/password.
//
// WHY NOT `dev-db.mjs up` + `migrate`: that path is the EVIDENCE harness — it
// reconstructs the branch-point schema and measures the registered-history
// replay, which is slow and writes an evidence file. A demo only needs the
// schema the application actually expects, so this builds it directly from the
// datamodel (one `prisma migrate diff`, ~10s).
//
// WHAT IT NEVER DOES:
//   - it never reads `DATABASE_URL` to decide where to connect — every command
//     it runs is given its own explicit `127.0.0.1` URL;
//   - it never applies a production migration, never contacts the Supabase
//     host, and never registers anything in `prisma/migrations`;
//   - it never commits a secret. `.demo/` is in `.gitignore`.
//
// Re-running it is safe and always yields a CLEAN environment: `nexup_dev` is
// dropped and rebuilt, so the demo starts from an empty lifecycle.
//
// Usage:  node scripts/demo-env.mjs
// Env:    PG_BIN (C:/Program Files/PostgreSQL/18/bin)
//         DEV_DB_PORT (5501)   DEMO_PORT (3300)
//         NEXUP_DEMO_EMAIL (superadmin@nexup)
//         NEXUP_DEMO_PASSWORD (optional; generated when absent)

import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, "..");
process.chdir(REPO_ROOT);

const PG_BIN = process.env.PG_BIN || "C:/Program Files/PostgreSQL/18/bin";
const PORT = process.env.DEV_DB_PORT || "5501";
const APP_PORT = process.env.DEMO_PORT || "3300";
const DB_NAME = "nexup_dev";
const DB_URL = `postgresql://postgres@127.0.0.1:${PORT}/${DB_NAME}`;
const WIN = process.platform === "win32";
const PSQL = path.join(PG_BIN, `psql${WIN ? ".exe" : ""}`);

const DEMO_DIR = path.join(REPO_ROOT, ".demo");
const DEMO_ENV = path.join(DEMO_DIR, "env");
const DEMO_CRED = path.join(DEMO_DIR, "credentials.txt");

const EMAIL = (process.env.NEXUP_DEMO_EMAIL || "superadmin@nexup").trim();

const PRISMA_CLI = path.join(REPO_ROOT, "node_modules", "prisma", "build", "index.js");

function run(command, args, options = {}) {
  // Every child is time-bounded. A wedged postmaster otherwise makes psql (and
  // the prisma engine) block forever, which turns a setup script into a hang.
  const result = spawnSync(command, args, {
    cwd: REPO_ROOT,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    timeout: 120_000,
    killSignal: "SIGKILL",
    ...options,
  });
  return { status: result.status ?? (result.error ? -1 : 0), stdout: result.stdout ?? "", stderr: result.stderr ?? (result.error ? String(result.error.message) : "") };
}

function must(label, result) {
  if (result.status !== 0) {
    console.error(`\n✗ ${label} failed (exit ${result.status})`);
    console.error(result.stderr || result.stdout || "(no output)");
    process.exit(1);
  }
  return result;
}

/** SQL against the cluster. Never a shell, so quoting is literal. */
function psql(sql, database = "postgres") {
  return run(PSQL, ["-h", "127.0.0.1", "-p", PORT, "-U", "postgres", "-w", "-t", "-A", "-v", "ON_ERROR_STOP=1", "-c", sql, "-d", database]);
}

function readEnvFile(file) {
  if (!fs.existsSync(file)) return {};
  const out = {};
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    let value = trimmed.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    out[trimmed.slice(0, eq).trim()] = value;
  }
  return out;
}

/** The exact DDL `prisma/schema.prisma` implies — legacy tables AND the ai_* set. */
function fullSchemaSql() {
  const diff = must(
    "prisma migrate diff --from-empty",
    run(process.execPath, [PRISMA_CLI, "migrate", "diff", "--from-empty", "--to-schema=prisma/schema.prisma", "--script"]),
  );
  if (!/CREATE TABLE "ai_missions"/.test(diff.stdout)) {
    console.error("✗ the generated schema does not contain the ai_* tables — refusing to seed a half-schema");
    process.exit(1);
  }
  return diff.stdout;
}

async function seedLogin(password) {
  const { PrismaClient, Role } = require("@prisma/client");
  const { PrismaPg } = require("@prisma/adapter-pg");
  const bcrypt = require("bcryptjs");

  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: DB_URL }) });
  try {
    await prisma.business.upsert({ where: { slug: "nexup" }, update: {}, create: { name: "NEXUP", slug: "nexup" } });
    const passwordHash = await bcrypt.hash(password, 12);
    const permissions = {
      name: "Demo Super Admin",
      passwordHash,
      role: Role.SUPER_ADMIN,
      businessId: null,
      canAccessNexup: true,
      canAccessRebound: true,
      canAccessAbomazen: true,
      canAccessOfficeFinanceFull: true,
    };
    await prisma.user.upsert({ where: { email: EMAIL }, update: permissions, create: { email: EMAIL, ...permissions } });
  } finally {
    await prisma.$disconnect();
  }
}

async function main() {
  if (!fs.existsSync(PSQL)) {
    console.error(`✗ psql not found at ${PSQL} (set PG_BIN)`);
    process.exit(1);
  }

  console.log("── 1/4  isolated development cluster ──────────────────────────");
  // `start` reuses a healthy cluster and, because the harness clears a
  // postmaster that is alive but no longer answering, also recovers the Windows
  // shared-memory/DLL-init wedge. (If it ever stays wedged, the fix is
  // `node scripts/dev-db.mjs restart`, which forces a fresh postmaster.)
  must(
    "node scripts/dev-db.mjs start",
    spawnSync(process.execPath, ["scripts/dev-db.mjs", "start"], { cwd: REPO_ROOT, stdio: "inherit", timeout: 180_000, killSignal: "SIGKILL" }),
  );
  console.log(`   ok: 127.0.0.1:${PORT} (loopback, trust auth)`);

  console.log(`── 2/4  rebuild ${DB_NAME} from prisma/schema.prisma ─────────`);
  must(`drop ${DB_NAME}`, psql(`DROP DATABASE IF EXISTS ${DB_NAME} WITH (FORCE)`));
  must(`create ${DB_NAME}`, psql(`CREATE DATABASE ${DB_NAME}`));
  const schema = fullSchemaSql();
  must(`apply schema to ${DB_NAME}`, run(PSQL, ["-h", "127.0.0.1", "-p", PORT, "-U", "postgres", "-w", "-v", "ON_ERROR_STOP=1", "-d", DB_NAME], { input: schema }));
  const tableCount = psql("select count(*) from information_schema.tables where table_schema='public' and table_type='BASE TABLE'", DB_NAME).stdout.trim();
  const aiCount = psql("select count(*) from information_schema.tables where table_schema='public' and table_name like 'ai\\_%'", DB_NAME).stdout.trim();
  console.log(`   ok: ${tableCount} tables (${aiCount} ai_*)`);

  console.log("── 3/4  seed a local, throwaway SUPER_ADMIN login ─────────────");
  const previous = readEnvFile(DEMO_ENV);
  const authSecret = previous.AUTH_SECRET && previous.AUTH_SECRET.length >= 32 ? previous.AUTH_SECRET : crypto.randomBytes(32).toString("hex");
  const password = process.env.NEXUP_DEMO_PASSWORD || previous.NEXUP_DEMO_PASSWORD || crypto.randomBytes(9).toString("base64url");
  await seedLogin(password);
  console.log(`   ok: ${EMAIL} (SUPER_ADMIN)`);

  console.log("── 4/4  write the git-ignored demo environment ────────────────");
  fs.mkdirSync(DEMO_DIR, { recursive: true });
  fs.writeFileSync(
    DEMO_ENV,
    [
      "# Generated by scripts/demo-env.mjs — LOCAL THROWAWAY demo environment.",
      "# Git-ignored. Contains a generated AUTH_SECRET and a local demo login.",
      "# Never point DATABASE_URL at anything but this isolated cluster here.",
      `DEMO_PORT="${APP_PORT}"`,
      `DATABASE_URL="${DB_URL}"`,
      `DATABASE_SSL_DISABLE="1"`,
      `AI_WORKFORCE_PERSISTENCE="database"`,
      `AI_WORKFORCE_DATABASE_URL="${DB_URL}"`,
      `AI_WORKFORCE_DATABASE_TARGET="local"`,
      `AI_WORKFORCE_TEST_TRANSPORT="deterministic"`,
      `AUTH_SECRET="${authSecret}"`,
      `NEXUP_DEMO_EMAIL="${EMAIL}"`,
      `NEXUP_DEMO_PASSWORD="${password}"`,
      "",
    ].join("\n"),
  );
  fs.writeFileSync(
    DEMO_CRED,
    `NEXUP local demo login (throwaway — this database is disposable)\n\n  URL      http://127.0.0.1:${APP_PORT}/login\n  email    ${EMAIL}\n  password ${password}\n\nThis file is git-ignored and contains no real credential.\n`,
  );

  console.log(`
═══════════════════════════════════════════════════════════════════
  Demo environment ready.

  1. start the app :  bash scripts/demo-run.sh
  2. open          :  http://127.0.0.1:${APP_PORT}/login
  3. log in as     :  ${EMAIL}
                      (password in .demo/credentials.txt)
  4. run the demo  :  node scripts/demo-lifecycle.mjs

  The AI runtime is the deterministic TEST transport, so the demo spends
  NO paid provider credits and never contacts production.
═══════════════════════════════════════════════════════════════════
`);
}

main().catch((error) => {
  console.error(error && error.message ? error.message : String(error));
  process.exit(1);
});
