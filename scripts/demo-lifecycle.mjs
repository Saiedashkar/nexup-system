#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════════════
// NEXUP AI WORKFORCE — the LOCAL lifecycle demo driver
// ═══════════════════════════════════════════════════════════════════════
//
// Drives the REAL application over HTTP, on the LOCAL demo database, using the
// real login flow — no bypass, no mock UI, no direct service calls:
//
//   Command → Mission → Task → Actor/Capability → Runtime → Execution
//           → Result → Human Review → Completed Mission
//
// It is a demonstration of the running system, not a separate implementation:
// every step is an ordinary request a browser or the Command Center would make.
//
//   node scripts/demo-lifecycle.mjs                 full lifecycle, one run
//   node scripts/demo-lifecycle.mjs --retry         …plus an idempotent retry
//   node scripts/demo-lifecycle.mjs --issue-only    issue and stop (restart demo)
//   node scripts/demo-lifecycle.mjs --finish <id>   adopt/settle + decide
//
// Reads `.demo/env` (git-ignored) written by `scripts/demo-env.mjs`.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, "..");

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

const env = readEnvFile(path.join(REPO_ROOT, ".demo/env"));
const PORT = process.env.DEMO_PORT || env.DEMO_PORT || "3300";
const BASE = `http://127.0.0.1:${PORT}`;
const EMAIL = process.env.NEXUP_DEMO_EMAIL || env.NEXUP_DEMO_EMAIL;
const PASSWORD = process.env.NEXUP_DEMO_PASSWORD || env.NEXUP_DEMO_PASSWORD;
const DB_URL = env.AI_WORKFORCE_DATABASE_URL || "postgresql://postgres@127.0.0.1:5501/nexup_dev";

const argv = process.argv.slice(2);
const flag = (name) => argv.includes(name);
const valueOf = (name) => {
  const i = argv.indexOf(name);
  return i === -1 ? undefined : argv[i + 1];
};

function step(n, title) {
  console.log(`\n── ${n}. ${title}`);
}
function line(label, value) {
  console.log(`     ${label.padEnd(22)} ${value}`);
}
function fail(message, detail) {
  console.error(`\n✗ ${message}`);
  if (detail) console.error(typeof detail === "string" ? detail : JSON.stringify(detail, null, 2));
  process.exit(1);
}

let cookie = "";

async function call(method, url, { body, cookie: override } = {}) {
  const headers = {};
  const useCookie = override ?? cookie;
  if (useCookie) headers.cookie = useCookie;
  if (body !== undefined) headers["content-type"] = "application/json";
  let res;
  try {
    res = await fetch(BASE + url, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      redirect: "manual",
    });
  } catch (error) {
    fail(`Could not reach ${BASE}. Start the app first:  bash scripts/demo-run.sh`, error.message);
  }
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* non-JSON (e.g. an HTML redirect) — kept in text */
  }
  const setCookies = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
  return { status: res.status, json, text, setCookies };
}

async function login() {
  const res = await call("POST", "/api/auth/login", { body: { email: EMAIL, password: PASSWORD } });
  if (res.status !== 200) fail(`login failed (${res.status})`, res.json ?? res.text.slice(0, 300));
  const session = res.setCookies.find((c) => c.startsWith("nexup_session="));
  if (!session) fail("login returned no session cookie");
  cookie = session.split(";")[0];
  return res.json;
}

function summarise(snapshot) {
  const mission = snapshot.mission ?? snapshot;
  return {
    mission: mission?.state ?? mission?.mission?.state ?? "?",
    task: snapshot.tasks?.[0]?.state ?? "?",
    execution: snapshot.executions?.[0]?.status ?? "?",
    review: snapshot.reviews?.[0]?.state ?? (snapshot.reviews?.length === 0 ? "none" : "?"),
  };
}

function printSnapshot(label, snapshot) {
  const s = summarise(snapshot);
  console.log(`     ${label}: mission=${s.mission} · task=${s.task} · execution=${s.execution} · review=${s.review}`);
}

async function main() {
  if (!EMAIL || !PASSWORD) fail("No demo login found. Run:  node scripts/demo-env.mjs");

  console.log("═══════════════════════════════════════════════════════════════");
  console.log(" NEXUP — Step-5 lifecycle demo (real HTTP API, local database)");
  console.log("═══════════════════════════════════════════════════════════════");
  line("server", BASE);
  line("login", EMAIL);

  step("A", "Log in through the real authentication flow");
  const user = await login();
  line("signed in as", `${user.user?.name ?? "?"} (${user.user?.role ?? "?"})`);

  step("B", "Readiness — the module reports where its state lives");
  const health = await call("GET", "/api/ai-workforce/health");
  if (health.status !== 200) fail(`health failed (${health.status})`, health.json ?? health.text.slice(0, 300));
  line("status", health.json.status);
  line("persistence", `${health.json.persistence.kind} — ${health.json.persistence.reason}`);
  line("runtime", `${health.json.runtime.kind} · provider ${health.json.runtime.aiProvider}`);
  line("ai provider", health.json.isolation.aiProvider);

  // ── restart demo: issue and stop ────────────────────────────────────
  if (flag("--issue-only")) {
    const key = valueOf("--key") || `owner-demo-${Date.now()}`;
    step("C", "Issue a Command (the Mission is created and the Task dispatched)");
    const issued = await call("POST", "/api/ai-workforce/missions", { body: commandBody(key) });
    if (issued.status !== 201 && issued.status !== 200) fail(`issue failed (${issued.status})`, issued.json);
    const missionId = issued.json.mission.id;
    printSnapshot("after issue", issued.json);
    console.log("\n  Now RESTART the app (Ctrl+C the server, then `bash scripts/demo-run.sh` again),");
    console.log("  and continue from the database with:");
    console.log(`    node scripts/demo-lifecycle.mjs --finish ${missionId}\n`);
    return;
  }

  // ── restart demo: continue from the durable rows ────────────────────
  if (flag("--finish")) {
    const missionId = valueOf("--finish");
    if (!missionId) fail("--finish needs a mission id");
    step("C", "Re-adopt/settle the Mission from the DATABASE (fresh process)");
    const drained = await call("POST", `/api/ai-workforce/missions/${missionId}`, { body: {} });
    if (drained.status !== 200) fail(`drain failed (${drained.status})`, drained.json);
    printSnapshot("after drain", drained.json);
    if (Array.isArray(drained.json.changes)) line("changes", drained.json.changes.join(", ") || "(none)");
    await decideAndFinish(missionId);
    return;
  }

  // ── full happy path ─────────────────────────────────────────────────
  const key = valueOf("--key") || `owner-demo-${Date.now()}`;
  step("C", "Issue a Command (Command → Mission → Task)");
  const issued = await call("POST", "/api/ai-workforce/missions", { body: commandBody(key) });
  if (issued.status !== 201 && issued.status !== 200) fail(`issue failed (${issued.status})`, issued.json);
  const missionId = issued.json.mission.id;
  line("mission", missionId);
  line("idempotency key", key);
  line("replayed", String(issued.json.replayed));
  printSnapshot("after issue", issued.json);

  step("D", "Continue the Mission (dispatch/settle through the runtime)");
  const drained = await call("POST", `/api/ai-workforce/missions/${missionId}`, { body: {} });
  if (drained.status !== 200) fail(`drain failed (${drained.status})`, drained.json);
  printSnapshot("after drain", drained.json);
  if (Array.isArray(drained.json.changes)) line("changes", drained.json.changes.join(", ") || "(none)");
  const execution = drained.json.executions?.[0];
  if (execution) {
    line("execution handle", execution.handleId ?? "?");
    line("execution status", execution.status ?? "?");
    if (execution.output !== undefined) line("result (output)", JSON.stringify(execution.output));
  }

  await decideAndFinish(missionId);

  if (flag("--retry")) {
    step("H", "Idempotent retry — the SAME key must not create a second execution");
    const again = await call("POST", "/api/ai-workforce/missions", { body: commandBody(key) });
    line("status", String(again.json?.status));
    line("replayed", String(again.json?.replayed));
    line("same mission", String(again.json?.mission?.id === missionId));
    const final = await call("GET", `/api/ai-workforce/missions/${missionId}`);
    line("executions (still)", String(final.json.executions.length));
  }

  step("I", "Durable record — read it from a process that shares nothing with the app");
  console.log(`     node scripts/read-durable-mission.cjs "${DB_URL}" ${missionId}`);
}

function commandBody(key) {
  return {
    idempotencyKey: key,
    scope: "demo:owner-walkthrough",
    title: "Owner walkthrough — internal strategy brief",
    goal: "Exercise the Step-5 lifecycle end to end on the local demo database",
    tasks: [
      {
        title: "produce-brief",
        objective: "produce a short internal brief",
        instruction: "Return exactly: NEXUP_OWNER_DEMO_OK",
      },
    ],
  };
}

async function decideAndFinish(missionId) {
  step("E", "The Decision Queue — a human decision is waiting");
  const queue = await call("GET", "/api/ai-workforce/decisions");
  if (queue.status !== 200) fail(`decision queue failed (${queue.status})`, queue.json);
  const pending = (queue.json.decisions ?? []).find((d) => d.missionId === missionId) ?? queue.json.decisions?.[0];
  if (!pending) fail("no pending decision for this mission", queue.json);
  line("review id", pending.reviewId);
  line("review summary", pending.summary ?? "?");

  step("F", "Record ONE human decision (approve) — the human authority boundary");
  const decided = await call("POST", "/api/ai-workforce/decisions", {
    body: { reviewId: pending.reviewId, decision: "APPROVED", note: "owner walkthrough approval" },
  });
  if (decided.status !== 200) fail(`decision failed (${decided.status})`, decided.json);
  printSnapshot("after decision", decided.json);

  step("G", "Final Mission state, straight from the database");
  const final = await call("GET", `/api/ai-workforce/missions/${missionId}`);
  printSnapshot("final", final.json);
  console.log("\n═══════════════════════════════════════════════════════════════");
  console.log(` Mission ${missionId}`);
  const s = summarise(final.json);
  console.log(`   mission=${s.mission} · task=${s.task} · execution=${s.execution} · review=${s.review}`);
  console.log("═══════════════════════════════════════════════════════════════");
}

main().catch((error) => {
  console.error(error && error.message ? error.message : String(error));
  process.exit(1);
});
