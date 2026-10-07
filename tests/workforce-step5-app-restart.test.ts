import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createSequentialIdFactory, sequentialClock } from "@/modules/ai-workforce/core/ids";
import { createWorkforcePrismaClient, type WorkforcePrismaHandle } from "@/modules/ai-workforce/persistence/prisma-client";
import { createHermesRuntime, type HermesRuntimeConfig } from "@/modules/workforce";
import { createWorkforceApplication, getWorkforceApplication, workforceApplicationStatus } from "@/modules/workforce/application";
import { DeterministicHermesTransport } from "@/modules/workforce/runtimes/hermes/testing/deterministic-transport";

/**
 * STEP 5/8 — PROCESS-RESTART / REHYDRATION, through the APPLICATION boundary.
 *
 * The durability suite proved the REPOSITORIES survive a restart. This file
 * proves something different: that the APPLICATION does not depend on process
 * memory. It spawns whole OS processes:
 *
 *   A → issues a Command, then exits. Its registries, its ids, its runtime
 *       handles and its transport's run table die with it.
 *   B → a DIFFERENT process with a fresh transport rehydrates the mission from
 *       the rows, finds the human decision that was still open, and completes it.
 *   C → a DIFFERENT process again, given the case A left RUNNING. This is the
 *       case that does NOT work, and it is measured rather than omitted.
 *
 * The assertions that make this a proof and not a script: the receipts must name
 * different PIDs; B must handle the decision A raised; the FINAL state is
 * verified from a THIRD composition and from the RAW ROWS, so no child grades
 * its own work.
 *
 * LOCAL AND ISOLATED: skipped unless `AI_WORKFORCE_TEST_DATABASE_URL` is set,
 * creates and drops its OWN database in the throwaway development cluster, and
 * never reads `DATABASE_URL` for the application.
 */

const BASE_URL = process.env.AI_WORKFORCE_TEST_DATABASE_URL;
const DB_NAME = "workforce_app_restart_test";
const DB_URL = BASE_URL ? `${BASE_URL.replace(/\/$/, "")}/${DB_NAME}` : "";
const REPO_ROOT = path.resolve(__dirname, "..");
const PSQL_BIN = process.env.PSQL_BIN || "C:\\Program Files\\PostgreSQL\\18\\bin\\psql.exe";
const PORT = BASE_URL ? new URL(BASE_URL).port || "5432" : "5432";
const VITEST_BIN = path.join(REPO_ROOT, "node_modules", "vitest", "vitest.mjs");

const MIGRATIONS = [
  "prisma/proposed-migrations/AI_WORKFORCE_PHASE_1A/migration.sql",
  "prisma/proposed-migrations/AI_WORKFORCE_PHASE_1B/migration.sql",
  "prisma/proposed-migrations/AI_WORKFORCE_PHASE_2/migration.sql",
  "prisma/proposed-migrations/AI_WORKFORCE_PHASE_3/migration.sql",
];

const describeIfDatabase = BASE_URL ? describe : describe.skip;

/**
 * psql WITHOUT a shell: the arguments are passed as an argv array, so a quoted
 * SQL identifier ("taskId") survives. Going through a shell string does not: on
 * Windows execSync uses cmd.exe, which eats the escaped quotes.
 */
function psqlArgs(args: readonly string[]): string {
  const result = spawnSync(PSQL_BIN, args, {
    env: { ...process.env, PGPASSWORD: "postgres" },
    encoding: "utf8",
    cwd: REPO_ROOT,
  });
  if (result.status !== 0) {
    throw new Error(`psql failed (${result.status}): ${result.stderr || result.stdout}`);
  }
  return (result.stdout ?? "").trim();
}

function psql(sql: string, database = "postgres") {
  return psqlArgs(["-h", "127.0.0.1", "-p", PORT, "-U", "postgres", "-w", "-t", "-A", "-v", "ON_ERROR_STOP=1", "-c", sql, "-d", database]);
}

function psqlFile(file: string) {
  psqlArgs(["-h", "127.0.0.1", "-p", PORT, "-U", "postgres", "-w", "-v", "ON_ERROR_STOP=1", "-f", path.join(REPO_ROOT, file), "-d", DB_NAME]);
}

function hermesConfig(): HermesRuntimeConfig {
  return {
    runtimeId: "runtime_hermes_saeed",
    displayName: "Hermes Agent Runtime",
    transport: "BRIDGE",
    profile: "saieed",
    bridgeEndpoint: "https://bridge.invalid",
    bridgeKeyId: "nexup-vercel",
    bridgeSecretPresent: true,
    timeoutMs: 5_000,
    maxOutputBytes: 8_192,
    capabilities: { submit: true, status: true, health: true, cancel: true, resume: false },
    authTokenPresent: false,
    authHeaderName: "Authorization",
    authScheme: "Bearer",
  };
}

/** Runs one child process to completion, or fails with the child's own output. */
function runChildProcess(file: string, env: Record<string, string>): void {
  const result = spawnSync(process.execPath, [VITEST_BIN, "run", "--config", "vitest.process.config.ts", file], {
    cwd: REPO_ROOT,
    encoding: "utf8",
    env: { ...process.env, ...env },
    maxBuffer: 32 * 1024 * 1024,
  });
  if (result.status !== 0) {
    throw new Error(
      `${file} exited ${result.status}\n--- stdout ---\n${(result.stdout ?? "").slice(-4000)}\n--- stderr ---\n${(result.stderr ?? "").slice(-4000)}`,
    );
  }
}

type Receipt = Record<string, string | number | boolean | null>;

describeIfDatabase("STEP 5 — the application rehydrates a mission after a REAL process restart", () => {
  const handles: WorkforcePrismaHandle[] = [];
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "nexup-restart-proof-"));

  /** A composition the PARENT owns, so it can verify independently. */
  async function parentApplication() {
    const handle = createWorkforcePrismaClient(DB_URL);
    handles.push(handle);
    const ids = createSequentialIdFactory("parent");
    const now = sequentialClock("2026-08-04T00:00:00.000Z", 1000);
    return createWorkforceApplication(handle, {
      ids,
      now,
      runtime: createHermesRuntime(hermesConfig(), {
        transport: new DeterministicHermesTransport({ statusSequence: ["succeeded"] }),
        ids,
        now,
        allowTestTransport: true,
      }),
    });
  }

  function runChild(file: string, env: Record<string, string>, receiptName: string): Receipt {
    const receiptFile = path.join(tempDir, receiptName);
    runChildProcess(file, { ...env, APP_PROOF_DATABASE_URL: DB_URL, PSQL_BIN, APP_PROOF_RECEIPT: receiptFile });
    return JSON.parse(fs.readFileSync(receiptFile, "utf8")) as Receipt;
  }

  beforeAll(() => {
    psql(`DROP DATABASE IF EXISTS ${DB_NAME}`);
    psql(`CREATE DATABASE ${DB_NAME}`);
    for (const migration of MIGRATIONS) psqlFile(migration);
  });

  afterAll(async () => {
    for (const handle of handles) await handle.disconnect().catch(() => undefined);
    fs.rmSync(tempDir, { recursive: true, force: true });
    if (BASE_URL) psql(`DROP DATABASE IF EXISTS ${DB_NAME}`);
  });

  it("fails closed when the process has no verified durable database", async () => {
    // The singleton is the composition a route uses, and it must never quietly
    // fall back to memory for something as durable as a mission.
    const status = workforceApplicationStatus();
    expect(status.available).toBe(false);
    await expect(getWorkforceApplication()).rejects.toMatchObject({ code: "PERSISTENCE_UNAVAILABLE" });
  });

  it("process A hands over an OPEN HUMAN DECISION and process B finishes the mission from the rows", async () => {
    const key = "restart-proof-1";

    // ── Process A: issue, settle, exit. The decision is still open. ──────
    const receiptA = runChild(
      "tests/process/app-process-a.test.ts",
      { APP_PROOF_KEY: key, APP_PROOF_SETTLE: "yes" },
      "receipt-a.json",
    );

    expect(receiptA.pid).not.toBe(process.pid);
    expect(receiptA.settledByA).toBe(true);
    expect(receiptA.missionState).toBe("WAITING");
    expect(receiptA.taskState).toBe("REVIEW");
    expect(receiptA.executionHandleId).toBeTruthy();
    expect(receiptA.pendingReviewId).toBeTruthy();

    const missionId = String(receiptA.missionId);
    const taskId = String(receiptA.taskId);
    const executionRecordId = String(receiptA.executionRecordId);

    // ── Process B: a different process, fresh transport, same database. ──
    const receiptB = runChild(
      "tests/process/app-process-b.test.ts",
      { APP_PROOF_KEY: key, APP_PROOF_MISSION_ID: missionId },
      "receipt-b.json",
    );

    expect(receiptB.pid).not.toBe(receiptA.pid);
    expect(receiptB.pid).not.toBe(process.pid);
    expect(receiptB.missionId).toBe(missionId);
    // B handled the decision A raised — reached through the ROWS, not memory.
    expect(receiptB.polledHandleId).toBe(receiptA.executionHandleId);
    expect(receiptB.executionStatus).toBe("SUCCEEDED");
    expect(receiptB.taskState).toBe("COMPLETED");
    expect(receiptB.missionState).toBe("COMPLETED");
    expect(receiptB.reviewState).toBe("APPROVED");
    expect(receiptB.decidedBy).toBe("actor_founder");
    expect(receiptB.intentMissionId).toBe(missionId);

    // ── The parent verifies, from a THIRD composition… ───────────────────
    const application = await parentApplication();
    const final = await application.commands.snapshot(missionId as never);
    expect(final.mission.state).toBe("COMPLETED");
    expect(final.tasks[0]!.state).toBe("COMPLETED");
    expect(final.executions[0]!.handleId).toBe(receiptA.executionHandleId);
    expect(final.reviews[0]!.decidedBy).toBe("actor_founder");

    // ── …and from the RAW ROWS, so no composition grades its own work. ───
    expect(psql(`select state from "ai_missions" where id = '${missionId}'`, DB_NAME)).toBe("COMPLETED");
    expect(psql(`select state from "ai_tasks" where id = '${taskId}'`, DB_NAME)).toBe("COMPLETED");
    expect(
      psql(`select status from "ai_execution_records" where id = '${executionRecordId}'`, DB_NAME),
    ).toBe("SUCCEEDED");
    expect(
      psql(`select state || '|' || coalesce("decidedBy",'none') from "ai_task_reviews" where "taskId" = '${taskId}'`, DB_NAME),
    ).toBe("APPROVED|actor_founder");
    expect(
      psql(`select count(*) from "ai_command_intents" where scope = 'proof:restart' and "idempotencyKey" = '${key}'`, DB_NAME),
    ).toBe("1");

    // ── The ledger survived TWO restarts ─────────────────────────────────
    const executionsBefore = Number(
      psql(`select count(*) from "ai_execution_records" where "missionId" = '${missionId}'`, DB_NAME),
    );
    const replay = await application.commands.issueCommand({
      idempotencyKey: key,
      scope: "proof:restart",
      title: "Restart proof mission",
      goal: "prove the application lifecycle survives a process restart",
      requestedBy: "actor_founder",
      owner: "actor_founder",
      tasks: [
        {
          title: "restart-proof-task",
          objective: "produce a brief",
          instruction: "Return exactly: NEXUP_RESTART_PROOF_OK",
        },
      ],
    });
    expect(replay.kind).toBe("replayed");
    if (replay.kind === "replayed") expect(replay.mission.id).toBe(missionId);
    expect(
      Number(psql(`select count(*) from "ai_execution_records" where "missionId" = '${missionId}'`, DB_NAME)),
    ).toBe(executionsBefore);
  }, 400_000);
  it("re-adopts an IN-FLIGHT execution after a real restart, without resubmitting it, and completes the mission", async () => {
    const key = "restart-proof-2";

    // Process A issues and exits with the task RUNNING while the provider run is
    // genuinely still alive (APP_PROOF_HOLD_MS holds the completion, and that
    // timer is unref'd, so A really does die with work in flight).
    const receiptA = runChild(
      "tests/process/app-process-a.test.ts",
      { APP_PROOF_KEY: key, APP_PROOF_SETTLE: "no", APP_PROOF_HOLD_MS: "30000" },
      "receipt-a2.json",
    );
    expect(receiptA.settledByA).toBe(false);
    expect(receiptA.taskState).toBe("RUNNING");

    const missionId = String(receiptA.missionId);
    const taskId = String(receiptA.taskId);
    const handleId = String(receiptA.executionHandleId);
    expect(handleId).toBeTruthy();

    // Process C: a DIFFERENT process — fresh registries, fresh ids, fresh
    // transport. The provider kept the run and finished it while we were down.
    // C must ADOPT it by asking, never by submitting it again.
    const receiptC = runChild(
      "tests/process/app-process-c.test.ts",
      { APP_PROOF_KEY: key, APP_PROOF_MISSION_ID: missionId, APP_PROOF_HANDLE_ID: handleId },
      "receipt-c.json",
    );

    expect(receiptC.pid).not.toBe(receiptA.pid);
    expect(receiptC.pid).not.toBe(process.pid);
    expect(receiptC.handleId).toBe(handleId);
    // THE claim: re-adoption never started a second run.
    expect(receiptC.runsStartedByC).toBe(0);
    // ...and it settled the attempt from what the runtime reported.
    expect(receiptC.executionStatusAfter).toBe("SUCCEEDED");
    expect(receiptC.executionCount).toBe(1);
    expect(String(receiptC.auditTypes)).toContain("RECONCILED");
    expect(receiptC.taskStateAfter).toBe("REVIEW");
    expect(receiptC.missionStateAfter).toBe("WAITING");
    expect(String(receiptC.changes)).toContain("ADOPTED_TERMINAL");

    // Process B: a THIRD process takes the human decision the re-adopted attempt
    // parked. The human boundary is unchanged by any of this.
    const receiptB = runChild(
      "tests/process/app-process-b.test.ts",
      { APP_PROOF_KEY: key, APP_PROOF_MISSION_ID: missionId },
      "receipt-b2.json",
    );
    expect(receiptB.polledHandleId).toBe(handleId);
    expect(receiptB.missionState).toBe("COMPLETED");
    expect(receiptB.reviewState).toBe("APPROVED");

    // The parent verifies from a FOURTH composition and from the RAW ROWS.
    const application = await parentApplication();
    const final = await application.commands.snapshot(missionId as never);
    expect(final.mission.state).toBe("COMPLETED");
    expect(final.tasks[0]!.state).toBe("COMPLETED");
    expect(final.executions).toHaveLength(1);
    expect(final.executions[0]!.handleId).toBe(handleId);

    expect(psql(`select state from "ai_missions" where id = '${missionId}'`, DB_NAME)).toBe("COMPLETED");
    expect(psql(`select state from "ai_tasks" where id = '${taskId}'`, DB_NAME)).toBe("COMPLETED");
    // EXACTLY ONE attempt row and exactly one runtime handle: no process in this
    // chain asked the provider to run this work twice.
    expect(
      psql(`select count(*) from "ai_execution_records" where "missionId" = '${missionId}'`, DB_NAME),
    ).toBe("1");
    expect(
      psql(`select count(distinct "handleId") from "ai_execution_records" where "missionId" = '${missionId}'`, DB_NAME),
    ).toBe("1");
    expect(psql(`select status from "ai_execution_records" where "taskId" = '${taskId}'`, DB_NAME)).toBe("SUCCEEDED");
    // The durable audit carries the reconciliation, so the ROW itself shows that
    // a surviving process verified it — no process memory required.
    expect(
      psql(`select audit::text from "ai_execution_records" where "taskId" = '${taskId}'`, DB_NAME),
    ).toContain("RECONCILED");
  }, 400_000);

  it("cannot verify an execution the runtime no longer knows, and escalates it to a human instead of guessing", async () => {
    const key = "restart-proof-3";

    const receiptA = runChild(
      "tests/process/app-process-a.test.ts",
      { APP_PROOF_KEY: key, APP_PROOF_SETTLE: "no", APP_PROOF_HOLD_MS: "30000" },
      "receipt-a3.json",
    );
    const missionId = String(receiptA.missionId);
    const taskId = String(receiptA.taskId);
    const handleId = String(receiptA.executionHandleId);

    // Process E asks the runtime about the run, and the runtime does not know it
    // any more (404, as a restarted bridge answers). That is knowledge that the
    // execution is GONE - not that it failed.
    const receiptE = runChild(
      "tests/process/app-process-e.test.ts",
      { APP_PROOF_KEY: key, APP_PROOF_MISSION_ID: missionId, APP_PROOF_HANDLE_ID: handleId },
      "receipt-e.json",
    );

    expect(receiptE.executionStatusAfter).toBe("UNKNOWN");
    expect(receiptE.errorCategory).toBe("UNKNOWN_REMOTE");
    expect(receiptE.escalated).toBe(true);
    expect(receiptE.settled).toBe(false);
    // No retry, no second run, no fabricated terminal state.
    expect(receiptE.runsStartedByE).toBe(0);
    expect(receiptE.executionCount).toBe(1);
    expect(receiptE.attemptAfter).toBe(1);
    expect(receiptE.taskStateAfter).toBe("REVIEW");
    expect(Number(receiptE.decisionQueueSize)).toBeGreaterThan(0);

    // The RAW rows agree, and the attempt is NOT terminal: only a human moves it.
    expect(psql(`select status from "ai_execution_records" where "taskId" = '${taskId}'`, DB_NAME)).toBe("UNKNOWN");
    expect(psql(`select state from "ai_tasks" where id = '${taskId}'`, DB_NAME)).toBe("REVIEW");
    expect(
      psql(`select error ->> 'category' from "ai_execution_records" where "taskId" = '${taskId}'`, DB_NAME),
    ).toBe("UNKNOWN_REMOTE");
    expect(
      psql(`select count(*) from "ai_execution_records" where "missionId" = '${missionId}'`, DB_NAME),
    ).toBe("1");
    expect(
      psql(`select count(*) from "ai_task_reviews" where "taskId" = '${taskId}' and state = 'PENDING'`, DB_NAME),
    ).toBe("1");

    // The human's release valve still works: a person may ask for another
    // attempt (REVISION -> READY) or cancel. Nothing here chose for them.
    const application = await parentApplication();
    const snapshot = await application.commands.snapshot(missionId as never);
    const pending = snapshot.reviews.find((review) => review.state === "PENDING")!;
    const decided = await application.commands.decide(pending.id, {
      decision: "NEEDS_REVISION",
      decidedBy: "actor_founder",
      note: "the run could not be verified; try again",
    });
    expect(decided.mission.state).not.toBe("COMPLETED");
    const afterDecision = await application.commands.snapshot(missionId as never);
    expect(["REVISION", "READY", "RUNNING"]).toContain(afterDecision.tasks[0]!.state);
  }, 400_000);
});

