#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════════════
// NEXUP — ONE command to open the local demo
// ═══════════════════════════════════════════════════════════════════════
//
//   node scripts/demo-start.mjs          start (or reuse) everything
//   node scripts/demo-start.mjs --stop   stop the app this script started
//
// What it does, in order, with no prompts:
//
//   1. reuses `.demo/env` + `.demo/credentials.txt` if they already exist and
//      the database answers; otherwise builds the whole demo environment
//      (`scripts/demo-env.mjs`) — including a fresh throwaway password;
//   2. makes the isolated cluster on 127.0.0.1:5501 answer, recovering the
//      Windows postmaster wedge if it is stuck;
//   3. frees the app port: a listener is only killed when it is a Node/Next
//      process this project started, never an unrelated service;
//   4. starts `next dev` against that environment and waits until /login
//      really answers over HTTP before printing anything.
//
// It then prints ONLY the URL, the demo email, and where the password lives.
// Nothing here can reach production: every URL is an explicit 127.0.0.1 one.
//
// Why the app must be started through this (or demo-run.sh) and not by hand:
// the demo's DATABASE_URL / AUTH_SECRET / deterministic runtime live in the
// git-ignored `.demo/env`. A bare `npx next dev` would load `.env.local`
// instead and point at the unreachable production host.

import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, "..");
process.chdir(REPO_ROOT);

const WIN = process.platform === "win32";
const DEMO_DIR = path.join(REPO_ROOT, ".demo");
const DEMO_ENV = path.join(DEMO_DIR, "env");
const DEMO_CRED = path.join(DEMO_DIR, "credentials.txt");
const APP_LOG = path.join(DEMO_DIR, "app.log");
const APP_PID = path.join(DEMO_DIR, "app.pid");

const DEFAULT_PORT = process.env.DEMO_PORT || "3300";
const DB_PORT = process.env.DEV_DB_PORT || "5501";
const EMAIL = (process.env.NEXUP_DEMO_EMAIL || "superadmin@nexup").trim();

function fail(message) {
  console.error(`\n✗ ${message}\n`);
  process.exit(1);
}

function run(command, args, options = {}) {
  return spawnSync(command, args, {
    cwd: REPO_ROOT,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    timeout: options.timeout ?? 180_000,
    killSignal: "SIGKILL",
    ...options,
  });
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

// ── process / port helpers ────────────────────────────────────────────

/** PIDs listening on a TCP port, without shelling into a broad pkill. */
function listenersOnPort(port) {
  if (WIN) {
    const out = run("netstat", ["-ano", "-p", "tcp"], { timeout: 20_000 }).stdout || "";
    const pids = new Set();
    for (const line of out.split(/\r?\n/)) {
      const parts = line.trim().split(/\s+/);
      if (parts.length < 5) continue;
      if (parts[0] !== "TCP") continue;
      if (parts[3] !== "LISTENING") continue;
      if (!parts[1].endsWith(`:${port}`)) continue;
      if (/^\d+$/.test(parts[4])) pids.add(Number(parts[4]));
    }
    return [...pids];
  }
  const out = run("lsof", ["-ti", `tcp:${port}`], { timeout: 20_000 }).stdout || "";
  return out.split(/\s+/).filter((x) => /^\d+$/.test(x)).map(Number);
}

function processName(pid) {
  if (WIN) {
    const out = run("tasklist", ["/FI", `PID eq ${pid}`, "/FO", "CSV", "/NH"], { timeout: 20_000 }).stdout || "";
    const match = out.match(/^"([^"]+)"/m);
    return match ? match[1] : "";
  }
  const out = run("ps", ["-o", "comm=", "-p", String(pid)], { timeout: 20_000 }).stdout || "";
  return out.trim();
}

function isAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function killPid(pid) {
  if (WIN) {
    // NOTE: no MSYS_ARG_CONV_EXCL here, so the ordinary `/F` form is correct.
    run("taskkill", ["/F", "/T", "/PID", String(pid)], { timeout: 30_000 });
  } else {
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      /* already gone */
    }
  }
}

/** Port is usable again once nothing is listening on it. */
async function waitForPortFree(port, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (listenersOnPort(port).length === 0) return true;
    await new Promise((r) => setTimeout(r, 500));
  }
  return listenersOnPort(port).length === 0;
}

/**
 * Free the app port. Only processes we are prepared to own are killed: the PID
 * recorded in `.demo/app.pid`, or a Node process. Anything else is left alone
 * and reported, because it is not ours to terminate.
 */
async function freeAppPort(port) {
  const pids = listenersOnPort(port);
  if (pids.length === 0) return { freed: true, reusedPid: null };

  const recorded = fs.existsSync(APP_PID) ? Number(fs.readFileSync(APP_PID, "utf8").trim()) : NaN;

  for (const pid of pids) {
    const name = processName(pid);
    const ours = pid === recorded || /^node(\.exe)?$/i.test(name);
    if (!ours) {
      fail(
        `port ${port} is held by PID ${pid} (${name || "unknown process"}), which this script did not start.\n` +
          `  Stop it yourself, or start the demo on another port:  DEMO_PORT=3301 node scripts/demo-start.mjs`,
      );
    }
    console.log(`   reclaiming port ${port} from PID ${pid} (${name || "node"})`);
    killPid(pid);
  }
  if (!(await waitForPortFree(port))) fail(`port ${port} is still busy after attempting to stop the previous app.`);
  try {
    fs.rmSync(APP_PID, { force: true });
  } catch {
    /* best effort */
  }
  return { freed: true, reusedPid: null };
}

// ── database helpers ──────────────────────────────────────────────────

/**
 * The cluster's own view of itself: `status --json` is read-only, bounded, and
 * prints machine-readable JSON only, so it cannot be confused by the
 * human-readable `prisma migrate status` tail that plain `status` appends.
 */
function clusterStatus() {
  const out = run(process.execPath, ["scripts/dev-db.mjs", "status", "--json"], { timeout: 90_000 });
  if (out.status !== 0) return null;
  const start = out.stdout.indexOf("{");
  if (start === -1) return null;
  try {
    return JSON.parse(out.stdout.slice(start, out.stdout.lastIndexOf("}") + 1));
  } catch {
    return null;
  }
}

function clusterUp() {
  const status = clusterStatus();
  return Boolean(status && status.running);
}

/** The demo database is ready when the schema the app expects is actually there. */
function demoDatabaseReady() {
  const status = clusterStatus();
  if (!status || !status.running) return false;
  return (status.aiTables || []).includes("ai_missions") && Number(status.legacyTables) > 0;
}

async function ensureDatabase() {
  if (clusterUp()) {
    console.log("   database already up — reusing it");
    return;
  }
  console.log("   database not answering — starting / recovering the cluster");
  let start = run(process.execPath, ["scripts/dev-db.mjs", "start"], { timeout: 180_000 });
  if (start.status === 0 && clusterUp()) return;

  console.log("   still not answering — forcing a fresh postmaster");
  start = run(process.execPath, ["scripts/dev-db.mjs", "restart"], { timeout: 180_000 });
  if (start.status !== 0 || !clusterUp()) {
    fail(`the isolated development cluster on 127.0.0.1:${DB_PORT} could not be started.\n  ${start.stderr || start.stdout || "(no output)"}`);
  }
}

// ── app helpers ───────────────────────────────────────────────────────

async function waitForLogin(port, timeoutMs = 180_000) {
  const url = `http://127.0.0.1:${port}/login`;
  const deadline = Date.now() + timeoutMs;
  let last = "";
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url, { redirect: "manual" });
      if (res.status === 200) return true;
      last = `HTTP ${res.status}`;
    } catch (reason) {
      last = reason instanceof Error ? reason.message : String(reason);
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  console.error(`   last attempt: ${last}`);
  return false;
}

async function startApp(port, env) {
  fs.mkdirSync(DEMO_DIR, { recursive: true });
  const logFd = fs.openSync(APP_LOG, "a");
  const nextBin = path.join(REPO_ROOT, "node_modules", "next", "dist", "bin", "next");
  const child = spawn(process.execPath, [nextBin, "dev", "--webpack", "-p", String(port)], {
    cwd: REPO_ROOT,
    env,
    detached: true,
    windowsHide: true,
    stdio: ["ignore", logFd, logFd],
  });
  child.unref();
  if (!child.pid) fail("could not start `next dev`.");
  fs.writeFileSync(APP_PID, String(child.pid));
  console.log(`   started PID ${child.pid} — log: ${path.relative(REPO_ROOT, APP_LOG)}`);
  return child.pid;
}

// ── main ──────────────────────────────────────────────────────────────

function printBanner(port) {
  console.log("");
  console.log("───────────────────────────────────────────────────");
  console.log(`  URL      http://127.0.0.1:${port}/login`);
  console.log(`  email    ${EMAIL}`);
  console.log("  password in .demo/credentials.txt");
  console.log("  stop     node scripts/demo-start.mjs --stop");
  console.log("───────────────────────────────────────────────────");
  console.log("");
}

async function main() {
  const stop = process.argv.includes("--stop");
  const port = DEFAULT_PORT;

  if (stop) {
    const pids = listenersOnPort(port);
    if (pids.length === 0) {
      console.log("Nothing is listening on the demo port — already stopped.");
      return;
    }
    await freeAppPort(port);
    console.log(`Demo app stopped (port ${port} free). The database is left running.`);
    return;
  }

  console.log("── NEXUP local demo ───────────────────────────────");

  // 1. database first: `demo-env.mjs` needs a live cluster to build onto.
  await ensureDatabase();

  // 2. environment — reuse only when the files AND the schema are both really
  //    there, so a half-built `.demo` is repaired instead of trusted.
  const haveEnv = fs.existsSync(DEMO_ENV) && fs.existsSync(DEMO_CRED) && demoDatabaseReady();
  if (haveEnv) {
    console.log("   demo environment already present — reusing it (password unchanged)");
  } else {
    console.log("   demo environment missing or incomplete — building one (clean database, new throwaway password)");
    const built = run(process.execPath, ["scripts/demo-env.mjs"], { stdio: "inherit", timeout: 300_000 });
    if (built.status !== 0) fail("scripts/demo-env.mjs failed — see the output above.");
  }

  // 3. port
  await freeAppPort(port);

  // 4. app
  const env = { ...process.env, ...readEnvFile(DEMO_ENV) };
  if (!env.AUTH_SECRET || env.AUTH_SECRET.length < 32) {
    fail("`.demo/env` has no usable AUTH_SECRET — rebuild it with `node scripts/demo-env.mjs`.");
  }
  await startApp(port, env);

  if (!(await waitForLogin(port))) {
    console.error(`\n✗ the app did not answer on http://127.0.0.1:${port}/login`);
    console.error(`  see ${path.relative(REPO_ROOT, APP_LOG)}`);
    process.exit(1);
  }

  printBanner(port);
}

main().catch((reason) => fail(reason instanceof Error ? reason.message : String(reason)));
