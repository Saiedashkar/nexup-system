import { execSync } from "node:child_process";
import path from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createSequentialIdFactory, sequentialClock } from "@/modules/ai-workforce/core/ids";
import { createWorkforcePrismaClient, type WorkforcePrismaHandle } from "@/modules/ai-workforce/persistence/prisma-client";
import {
  bootstrapStrategyAnalyst,
  createHermesRuntime,
  createMissionOrchestrator,
  founderActorRegistration,
  STRATEGY_INTERNAL_BRIEF_CAPABILITY_ID,
  STRATEGY_INTERNAL_BRIEF_CAPABILITY_VERSION,
  type HermesRuntimeConfig,
  type Mission,
  type MissionTask,
  type WorkforceDomain,
} from "@/modules/workforce";
import {
  createPrismaLifecycleRepositories,
  createWorkforceDomainFromPrisma,
} from "@/modules/workforce/persistence";
import { DeterministicHermesTransport } from "@/modules/workforce/runtimes/hermes/testing/deterministic-transport";

/**
 * STEP 5/8 — DURABILITY, against a real PostgreSQL.
 *
 * `workforce-step5-mission.test.ts` proves the lifecycle over in-memory
 * repositories. This file proves the SAME lifecycle over the durable ones, and
 * that is a different claim: process memory must stop being the source of
 * truth. Everything here talks to an actual database, through the actual
 * proposed migration SQL, with the actual foreign keys and unique constraints.
 *
 * LOCAL AND ISOLATED, by construction:
 *
 *   - it is skipped entirely unless `AI_WORKFORCE_TEST_DATABASE_URL` is set;
 *   - it creates and drops its OWN database (`workforce_lifecycle_test`);
 *   - `scripts/run-persistence-proof.sh` supplies a throwaway PostgreSQL
 *     cluster on loopback with trust auth, so no existing cluster — and
 *     certainly not production — is ever touched;
 *   - the schema comes from the PROPOSED migration files (1A → 1B → PHASE_2),
 *     so the SQL that will one day run on a real server runs somewhere first.
 *
 * It never reads `DATABASE_URL`.
 *
 * What it refuses to skip: a restart. Every "process" here owns its own client,
 * its own registries and its own domain, so re-reading a completed mission is a
 * genuine re-hydration, not the same object handed back. Those reconstructions
 * still share this vitest process, which is why the first test ALSO reads the
 * finished chain from a real separate OS process — `scripts/read-durable-
 * mission.cjs`, which imports nothing from `src/` and therefore cannot see any
 * registry, cache or module state this test built.
 */

const BASE_URL = process.env.AI_WORKFORCE_TEST_DATABASE_URL;
const DB_NAME = "workforce_lifecycle_test";
const DB_URL = BASE_URL ? `${BASE_URL.replace(/\/$/, "")}/${DB_NAME}` : "";
const REPO_ROOT = path.resolve(__dirname, "..");
const PSQL_BIN = process.env.PSQL_BIN || "C:\\Program Files\\PostgreSQL\\18\\bin\\psql.exe";
const PORT = BASE_URL ? new URL(BASE_URL).port || "5432" : "5432";

const MIGRATIONS = [
  "prisma/proposed-migrations/AI_WORKFORCE_PHASE_1A/migration.sql",
  "prisma/proposed-migrations/AI_WORKFORCE_PHASE_1B/migration.sql",
  "prisma/proposed-migrations/AI_WORKFORCE_PHASE_2/migration.sql",
];

const FOUNDER = "actor_founder";
const MARKER = "NEXUP_STEP5_DURABILITY_OK";
const INSTRUCTION = `Return exactly: ${MARKER}`;

const describeIfDatabase = BASE_URL ? describe : describe.skip;

/** Whatever the deterministic test transport can be told to do. */
type TransportOptions = ConstructorParameters<typeof DeterministicHermesTransport>[0];

function psql(sql: string, database = "postgres") {
  return execSync(
    `"${PSQL_BIN}" -h 127.0.0.1 -p ${PORT} -U postgres -w -v ON_ERROR_STOP=1 -c "${sql}" -d ${database}`,
    { env: { ...process.env, PGPASSWORD: "postgres" }, stdio: "pipe", cwd: REPO_ROOT },
  );
}

function psqlFile(file: string) {
  return execSync(
    `"${PSQL_BIN}" -h 127.0.0.1 -p ${PORT} -U postgres -w -v ON_ERROR_STOP=1 -f "${path.join(REPO_ROOT, file)}" -d ${DB_NAME}`,
    { env: { ...process.env, PGPASSWORD: "postgres" }, stdio: "pipe", cwd: REPO_ROOT },
  );
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

describeIfDatabase("STEP 5 — the lifecycle survives a real database and a restart", () => {
  const handles: WorkforcePrismaHandle[] = [];

  type Process = {
    domain: WorkforceDomain;
    orchestrator: ReturnType<typeof createMissionOrchestrator>;
    actorId: string;
    runtimeId: string;
    handle: WorkforcePrismaHandle;
  };

  /**
   * One "process": its own connection, its own id factory, its own clock and its
   * own in-memory registries — the durable rows are the only thing it shares
   * with any other process.
   */
  async function boot(prefix: string, transportOptions: TransportOptions = {}): Promise<Process> {
    const handle = createWorkforcePrismaClient(DB_URL);
    handles.push(handle);

    const ids = createSequentialIdFactory(prefix);
    const now = sequentialClock("2026-08-01T00:00:00.000Z", 1000);

    const domain = createWorkforceDomainFromPrisma(handle, { ids, now });
    await domain.actors.register(founderActorRegistration());

    // The real Step-4 actor, wired to the deterministic transport: offline, but
    // through the real adapter, dispatcher and orchestrator.
    const adapter = createHermesRuntime(hermesConfig(), {
      transport: new DeterministicHermesTransport(transportOptions),
      ids,
      now,
      allowTestTransport: true,
    });
    const built = await bootstrapStrategyAnalyst(domain, { runtime: adapter });
    if (!built.enabled) throw new Error(built.reason);

    return {
      domain,
      handle,
      actorId: built.actorId,
      runtimeId: built.runtimeId,
      orchestrator: createMissionOrchestrator(domain, { defaultReviewerActorId: FOUNDER }),
    };
  }

  function taskByTitle(tasks: readonly MissionTask[], title: string): MissionTask {
    const task = tasks.find((candidate) => candidate.title === title);
    if (!task) throw new Error(`no task titled "${title}"`);
    return task;
  }

  /**
   * Reads the chain in a SEPARATE operating-system process.
   *
   * A fresh domain inside this vitest process is a real reconstruction, but it
   * is still the same process. `scripts/read-durable-mission.cjs` imports
   * nothing from `src/`, so it has no access to any registry, cache or module
   * state this test built — if it can see the mission, the database is the only
   * possible source.
   */
  function readOutOfProcess(missionId: string): {
    found: boolean;
    mission: { state: string; projectRef: string | null; clientRef: string | null; historyTo: string[] };
    tasks: Array<{ id: string; title: string; state: string; attempt: number; executionHandleId: string | null; reviewId: string | null }>;
    executions: Array<{ id: string; taskId: string; attempt: number; handleId: string; providerExecutionId: string | null; idempotencyKey: string | null; status: string; auditTypes: string[] }>;
    reviews: Array<{ id: string; taskId: string; state: string; decidedBy: string | null; decidedAt: string | null }>;
  } {
    const raw = execSync(`node scripts/read-durable-mission.cjs "${DB_URL}" "${missionId}"`, {
      cwd: REPO_ROOT,
      stdio: "pipe",
      env: process.env,
    }).toString();
    return JSON.parse(raw);
  }

  beforeAll(async () => {
    try {
      psql(`DROP DATABASE IF EXISTS "${DB_NAME}" WITH (FORCE)`);
    } catch {
      /* may not exist */
    }
    psql(`CREATE DATABASE "${DB_NAME}"`);

    // The additive-only guarantee is asserted, not assumed: the verifier fails
    // on any DROP/DELETE/TRUNCATE/RENAME or any ALTER of a table the file does
    // not itself create.
    execSync(`node scripts/verify-proposed-migration.mjs prisma/proposed-migrations/AI_WORKFORCE_PHASE_2/migration.sql`, {
      stdio: "pipe",
      cwd: REPO_ROOT,
    });

    // PROPOSED migrations, in order. Nothing here is in `prisma/migrations/`.
    for (const file of MIGRATIONS) psqlFile(file);

    // The generated client must know the new models. Local only.
    execSync("npx prisma generate", { env: process.env, stdio: "pipe", cwd: REPO_ROOT });

    // Evidence: the lifecycle tables that exist after applying the proposals.
    execSync(`"${PSQL_BIN}" -h 127.0.0.1 -p ${PORT} -U postgres -w -c "\\dt ai_*" -d ${DB_NAME}`, {
      env: { ...process.env, PGPASSWORD: "postgres" },
      stdio: "inherit",
      cwd: REPO_ROOT,
    });
  }, 300_000);

  afterAll(async () => {
    for (const handle of handles) {
      try {
        await handle.disconnect();
      } catch {
        /* ignore */
      }
    }
    try {
      psql(`DROP DATABASE IF EXISTS "${DB_NAME}" WITH (FORCE)`);
    } catch {
      /* ignore */
    }
  });

  it("runs Command → Mission → Task → Agent → Execution → Review → human → COMPLETED, then re-hydrates it in a fresh process", async () => {
    const first = await boot("p1");

    const mission = await first.orchestrator.createMission({
      title: "Durable internal brief",
      goal: "Prove the lifecycle survives the process that ran it",
      createdBy: FOUNDER,
      owner: FOUNDER,
      businessId: "biz_nexup",
      workspaceRef: "ws_main",
      projectRef: "prj_strategy",
      clientRef: "cli_1",
      priority: "LOW",
    });
    expect(mission.state).toBe("DRAFT");

    const planned = await first.orchestrator.plan(mission.id, [
      {
        title: "durable-brief",
        objective: "Produce one internal brief, durably",
        input: { instruction: INSTRUCTION },
        assignedActorId: first.actorId,
        requiredCapabilityId: STRATEGY_INTERNAL_BRIEF_CAPABILITY_ID,
        requiredCapabilityVersion: STRATEGY_INTERNAL_BRIEF_CAPABILITY_VERSION,
      },
    ]);
    expect(planned.mission.state).toBe("RUNNING");
    const task = taskByTitle(planned.tasks, "durable-brief");
    expect(task.state).toBe("RUNNING");
    expect(task.executionHandleId).toBeTruthy();

    // The agent succeeds; a human still has to accept it.
    const parked = await first.orchestrator.settleTask(mission.id, task.id);
    expect(parked.state).toBe("REVIEW");
    const [pending] = await first.domain.reviews.forTask(task.id);
    expect(pending.state).toBe("PENDING");

    // --- the process dies here. A new one re-reads everything. ---
    const runningExecution = (await first.domain.executionRecords.listForTask(task.id))[0];
    const firstHandle = runningExecution.handleId;
    // Whatever the runtime reported — present or absent — must survive verbatim.
    const providerExecutionId = runningExecution.providerExecutionId ?? null;

    const second = await boot("p2");

    const rehydratedMission = await second.domain.missions.require(mission.id);
    expect(rehydratedMission.state).toBe("WAITING");
    expect(rehydratedMission.projectRef).toBe("prj_strategy");
    expect(rehydratedMission.clientRef).toBe("cli_1");
    expect(rehydratedMission.workspaceRef).toBe("ws_main");
    expect(rehydratedMission.history.map((entry) => entry.to)).toEqual(["PLANNING", "RUNNING", "WAITING"]);

    const [rehydratedTask] = await second.domain.tasks.listForMission(mission.id);
    expect(rehydratedTask.id).toBe(task.id);
    expect(rehydratedTask.state).toBe("REVIEW");
    expect(rehydratedTask.attempt).toBe(1);
    expect(rehydratedTask.executionHandleId).toBe(firstHandle);
    expect(rehydratedTask.reviewId).toBe(pending.id);

    const [rehydratedExecution] = await second.domain.executionRecords.listForTask(task.id);
    expect(rehydratedExecution.handleId).toBe(firstHandle);
    expect(rehydratedExecution.providerExecutionId ?? null).toBe(providerExecutionId);
    expect(rehydratedExecution.status).toBe("SUCCEEDED");
    expect(rehydratedExecution.idempotencyKey).toBe(`task:${task.id}:attempt:1`);
    // The deterministic transport answers in the same breath as the handle, so
    // this attempt went straight to a terminal state: REQUESTED then TERMINAL,
    // with no intermediate ACCEPTED. The trail must survive the round trip
    // intact, whichever shape it has.
    expect(rehydratedExecution.audit.map((event) => event.type)).toEqual(["REQUESTED", "TERMINAL"]);

    const pendingSecond = await second.domain.reviews.listPending();
    expect(pendingSecond.map((review) => review.id)).toContain(pending.id);

    // The HUMAN decides — in the second process.
    const completed = await second.orchestrator.decide(pending.id, {
      decision: "APPROVED",
      decidedBy: FOUNDER,
      note: "accepted after restart",
    });
    expect(completed.mission.state).toBe("COMPLETED");
    expect(completed.mission.finishedAt).toBeTruthy();
    expect(completed.tasks.every((entry) => entry.state === "COMPLETED")).toBe(true);

    // --- and a THIRD process confirms the whole chain is on disk ---
    const third = await boot("p3");
    const finalMission = await third.domain.missions.require(mission.id);
    expect(finalMission.state).toBe("COMPLETED");
    expect(finalMission.taskRefs).toEqual([task.id]);
    // The approval was the LAST thing outstanding, so the mission moves
    // WAITING → COMPLETED without a further turn at RUNNING.
    expect(finalMission.history.map((entry) => entry.to)).toEqual(["PLANNING", "RUNNING", "WAITING", "COMPLETED"]);

    const finalReviews = await third.domain.reviews.forTask(task.id);
    expect(finalReviews).toHaveLength(1);
    expect(finalReviews[0].state).toBe("APPROVED");
    expect(finalReviews[0].decidedBy).toBe(FOUNDER);
    expect(finalReviews[0].decidedAt).toBeTruthy();
    expect(await third.domain.reviews.listPending()).toEqual([]);

    const finalTasks = await third.domain.tasks.listForMission(mission.id);
    expect(finalTasks[0].state).toBe("COMPLETED");
    expect(finalTasks[0].result).toBeTruthy();

    const finalExecutions = await third.domain.executionRecords.listForMission(mission.id);
    expect(finalExecutions).toHaveLength(1);
    expect(finalExecutions[0].status).toBe("SUCCEEDED");

    // --- and a FOURTH reader: a separate OS process, importing nothing from
    //     src/, for which the database is the only possible source of truth ---
    const outOfProcess = readOutOfProcess(mission.id);
    expect(outOfProcess.found).toBe(true);
    expect(outOfProcess.mission.state).toBe("COMPLETED");
    expect(outOfProcess.mission.projectRef).toBe("prj_strategy");
    expect(outOfProcess.mission.clientRef).toBe("cli_1");
    expect(outOfProcess.mission.historyTo).toEqual(["PLANNING", "RUNNING", "WAITING", "COMPLETED"]);

    expect(outOfProcess.tasks).toHaveLength(1);
    expect(outOfProcess.tasks[0].id).toBe(task.id);
    expect(outOfProcess.tasks[0].state).toBe("COMPLETED");
    expect(outOfProcess.tasks[0].attempt).toBe(1);
    expect(outOfProcess.tasks[0].executionHandleId).toBe(firstHandle);
    expect(outOfProcess.tasks[0].reviewId).toBe(pending.id);

    expect(outOfProcess.executions).toHaveLength(1);
    expect(outOfProcess.executions[0].handleId).toBe(firstHandle);
    expect(outOfProcess.executions[0].providerExecutionId ?? null).toBe(providerExecutionId);
    expect(outOfProcess.executions[0].idempotencyKey).toBe(`task:${task.id}:attempt:1`);
    expect(outOfProcess.executions[0].status).toBe("SUCCEEDED");
    expect(outOfProcess.executions[0].auditTypes).toEqual(["REQUESTED", "TERMINAL"]);

    expect(outOfProcess.reviews).toHaveLength(1);
    expect(outOfProcess.reviews[0].state).toBe("APPROVED");
    expect(outOfProcess.reviews[0].decidedBy).toBe(FOUNDER);
    expect(outOfProcess.reviews[0].decidedAt).toBeTruthy();
  }, 180_000);

  it("refuses a STALE snapshot: a transition that lost the compare-and-set does not land", async () => {
    const first = await boot("s1");
    const repositories = createPrismaLifecycleRepositories(first.handle.client);

    const mission = await first.orchestrator.createMission({
      title: "CAS mission",
      goal: "stale writes must lose",
      createdBy: FOUNDER,
      owner: FOUNDER,
    });
    const stale: Mission | null = await repositories.missions.get(mission.id);
    expect(stale).not.toBeNull();

    // A DIFFERENT process advances the mission first.
    const other = await boot("s2");
    await other.orchestrator.plan(mission.id, [
      {
        title: "cas-task",
        objective: "advance the mission from another process",
        input: { instruction: INSTRUCTION },
        assignedActorId: other.actorId,
        requiredCapabilityId: STRATEGY_INTERNAL_BRIEF_CAPABILITY_ID,
      },
    ]);
    const advanced = await other.domain.missions.require(mission.id);
    expect(advanced.state).not.toBe(stale!.state);

    // The stale snapshot still believes the old state, and its CAS must lose.
    const lost = await repositories.missions.update({ ...stale!, state: "COMPLETED" }, [stale!.state]);
    expect(lost).toBeNull();
    // The row is untouched.
    expect((await repositories.missions.get(mission.id))!.state).toBe(advanced.state);
  }, 120_000);

  it("refuses a SECOND decision on the same review, across processes", async () => {
    const first = await boot("d1");
    const repositories = createPrismaLifecycleRepositories(first.handle.client);

    const mission = await first.orchestrator.createMission({
      title: "one decision",
      goal: "a review is decided exactly once",
      createdBy: FOUNDER,
      owner: FOUNDER,
    });
    const planned = await first.orchestrator.plan(mission.id, [
      {
        title: "one-decision-task",
        objective: "produce a brief",
        input: { instruction: INSTRUCTION },
        assignedActorId: first.actorId,
        requiredCapabilityId: STRATEGY_INTERNAL_BRIEF_CAPABILITY_ID,
      },
    ]);
    const task = taskByTitle(planned.tasks, "one-decision-task");
    await first.orchestrator.settleTask(mission.id, task.id);
    const [review] = await first.domain.reviews.forTask(task.id);

    // Process A decides.
    await first.orchestrator.decide(review.id, { decision: "APPROVED", decidedBy: FOUNDER });

    // Process B, holding the same PENDING snapshot, tries to decide again: the
    // compare-and-set loses and no overwrite happens.
    const staleReview = await repositories.reviews.get(review.id);
    expect(staleReview!.state).toBe("APPROVED");
    const raced = await repositories.reviews.decide(
      { ...staleReview!, state: "REJECTED", decidedBy: FOUNDER, decidedAt: new Date().toISOString() },
      ["PENDING"],
    );
    expect(raced).toBeNull();

    const finalReview = (await repositories.reviews.get(review.id))!;
    expect(finalReview.state).toBe("APPROVED");

    // ...and the service reports it as already decided, not as an error state.
    await expect(
      first.orchestrator.decide(review.id, { decision: "REJECTED", decidedBy: FOUNDER }),
    ).rejects.toThrow(/already decided/i);
  }, 120_000);

  it("refuses a non-HUMAN decision on the durable path too", async () => {
    const first = await boot("h1");
    const mission = await first.orchestrator.createMission({
      title: "human authority",
      goal: "an agent cannot approve its own work",
      createdBy: FOUNDER,
      owner: FOUNDER,
    });
    const planned = await first.orchestrator.plan(mission.id, [
      {
        title: "agent-cannot-approve",
        objective: "produce a brief",
        input: { instruction: INSTRUCTION },
        assignedActorId: first.actorId,
        requiredCapabilityId: STRATEGY_INTERNAL_BRIEF_CAPABILITY_ID,
      },
    ]);
    const task = taskByTitle(planned.tasks, "agent-cannot-approve");
    await first.orchestrator.settleTask(mission.id, task.id);
    const [review] = await first.domain.reviews.forTask(task.id);

    await expect(
      first.orchestrator.decide(review.id, { decision: "APPROVED", decidedBy: first.actorId }),
    ).rejects.toThrow(/human authority/i);

    // Still PENDING, and still decidable by the person who owns it.
    expect((await first.domain.reviews.get(review.id))!.state).toBe("PENDING");
    await first.orchestrator.decide(review.id, { decision: "APPROVED", decidedBy: FOUNDER });
  }, 120_000);

  it("keeps both attempts of a retried task, with their own keys and audit trails", async () => {
    const first = await boot("r1");
    const mission = await first.orchestrator.createMission({
      title: "retry durability",
      goal: "a revision is a NEW attempt, and both stay readable",
      createdBy: FOUNDER,
      owner: FOUNDER,
    });
    const planned = await first.orchestrator.plan(mission.id, [
      {
        title: "revised-twice",
        objective: "produce a brief",
        input: { instruction: INSTRUCTION },
        assignedActorId: first.actorId,
        requiredCapabilityId: STRATEGY_INTERNAL_BRIEF_CAPABILITY_ID,
      },
    ]);
    const task = taskByTitle(planned.tasks, "revised-twice");

    await first.orchestrator.settleTask(mission.id, task.id);
    const [firstReview] = await first.domain.reviews.forTask(task.id);
    const revised = await first.orchestrator.decide(firstReview.id, {
      decision: "NEEDS_REVISION",
      decidedBy: FOUNDER,
      note: "sharpen it",
    });
    expect(taskByTitle(revised.tasks, "revised-twice").attempt).toBe(2);

    // The revision put the task back to RUNNING on attempt 2; settle it and
    // accept THAT attempt, so the second attempt ends COMPLETED.
    await first.orchestrator.settleTask(mission.id, task.id);
    const [fresh] = (await first.domain.reviews.forTask(task.id)).filter((entry) => entry.state === "PENDING");
    expect(fresh).toBeTruthy();
    await first.orchestrator.decide(fresh.id, { decision: "APPROVED", decidedBy: FOUNDER });

    // A fresh process sees BOTH attempts, ordered, each with its own key.
    const second = await boot("r2");
    const attempts = await second.domain.executionRecords.listForTask(task.id);
    expect(attempts.map((record) => record.attempt)).toEqual([1, 2]);
    expect(attempts.map((record) => record.idempotencyKey)).toEqual([
      `task:${task.id}:attempt:1`,
      `task:${task.id}:attempt:2`,
    ]);
    expect(new Set(attempts.map((record) => record.id)).size).toBe(2);
    expect(attempts.every((record) => record.audit.length >= 2)).toBe(true);

    // The reviews for both attempts are durable too.
    const reviews = await second.domain.reviews.forTask(task.id);
    expect(reviews.length).toBeGreaterThanOrEqual(2);
    expect(reviews.some((entry) => entry.state === "NEEDS_REVISION")).toBe(true);
    expect(reviews.some((entry) => entry.state === "APPROVED")).toBe(true);
  }, 180_000);

  it("persists EXHAUSTION: the allowance runs out and FAILED survives the restart", async () => {
    const first = await boot("e1", { failWith: "UNAVAILABLE" });
    const mission = await first.orchestrator.createMission({
      title: "exhaustion",
      goal: "a task that never succeeds must end FAILED, durably",
      createdBy: FOUNDER,
      owner: FOUNDER,
    });
    const planned = await first.orchestrator.plan(mission.id, [
      {
        title: "always-fails",
        objective: "fail twice, then stop trying",
        input: { instruction: INSTRUCTION },
        assignedActorId: first.actorId,
        requiredCapabilityId: STRATEGY_INTERNAL_BRIEF_CAPABILITY_ID,
        maxAttempts: 2,
      },
    ]);
    const task = taskByTitle(planned.tasks, "always-fails");

    // Attempt 1 fails RETRYABLY: the task goes back to READY, it does not fail yet.
    const afterFirst = await first.orchestrator.settleTask(mission.id, task.id);
    expect(afterFirst.state).toBe("READY");
    const firstAttempts = await first.domain.executionRecords.listForTask(task.id);
    expect(firstAttempts.map((record) => record.attempt)).toEqual([1]);
    expect(firstAttempts[0].status).toBe("FAILED");
    expect(firstAttempts[0].error?.category).toBe("TRANSPORT");
    expect(firstAttempts[0].error?.retryable).toBe(true);

    // The stepper re-dispatches it; attempt 2 exhausts the allowance.
    const advanced = await first.orchestrator.advance(mission.id);
    const retried = taskByTitle(advanced.tasks, "always-fails");
    expect(retried.attempt).toBe(2);
    const afterSecond = await first.orchestrator.settleTask(mission.id, retried.id);
    expect(afterSecond.state).toBe("FAILED");

    // Everything above comes back from processes that never saw any of it.
    const second = await boot("e2");
    const storedMission = await second.domain.missions.require(mission.id);
    expect(storedMission.state).toBe("FAILED");
    expect(storedMission.finishedAt).toBeTruthy();

    const storedTasks = await second.domain.tasks.listForMission(mission.id);
    expect(storedTasks[0].state).toBe("FAILED");
    expect(storedTasks[0].attempt).toBe(2);

    const attempts = await second.domain.executionRecords.listForTask(task.id);
    expect(attempts.map((record) => record.attempt)).toEqual([1, 2]);
    expect(attempts.every((record) => record.status === "FAILED")).toBe(true);
    expect(attempts.every((record) => record.error?.category === "TRANSPORT")).toBe(true);
    expect(new Set(attempts.map((record) => record.idempotencyKey)).size).toBe(2);

    const outOfProcess = readOutOfProcess(mission.id);
    expect(outOfProcess.mission.state).toBe("FAILED");
    expect(outOfProcess.tasks[0].state).toBe("FAILED");
    expect(outOfProcess.executions.map((execution) => execution.status)).toEqual(["FAILED", "FAILED"]);
  }, 180_000);

  it("persists CANCELLATION: the execution, the task and the mission all end CANCELLED", async () => {
    // The completion is held, so the run is genuinely in flight when cancelled.
    const first = await boot("k1", { holdCompletionMs: 60_000 });
    const mission = await first.orchestrator.createMission({
      title: "cancellation",
      goal: "an in-flight run cancelled through the port, durably",
      createdBy: FOUNDER,
      owner: FOUNDER,
    });
    const planned = await first.orchestrator.plan(mission.id, [
      {
        title: "long-running",
        objective: "still working when the cancel arrives",
        input: { instruction: INSTRUCTION },
        assignedActorId: first.actorId,
        requiredCapabilityId: STRATEGY_INTERNAL_BRIEF_CAPABILITY_ID,
      },
    ]);
    const task = taskByTitle(planned.tasks, "long-running");
    expect(task.state).toBe("RUNNING");
    expect(task.executionHandleId).toBeTruthy();

    const cancelled = await first.orchestrator.cancelMission(mission.id, "test cancellation");
    expect(cancelled.mission.state).toBe("CANCELLED");
    expect(cancelled.tasks[0].state).toBe("CANCELLED");

    const record = (await first.domain.executionRecords.listForTask(task.id))[0];
    expect(record.status).toBe("CANCELLED");
    expect(record.cancelled?.at).toBeTruthy();
    expect(record.cancelled?.reason).toContain("test cancellation");

    // A process that never saw the cancel reads the same terminal state.
    const second = await boot("k2");
    const storedMission = await second.domain.missions.require(mission.id);
    expect(storedMission.state).toBe("CANCELLED");
    const storedTasks = await second.domain.tasks.listForMission(mission.id);
    expect(storedTasks[0].state).toBe("CANCELLED");
    const storedRecord = (await second.domain.executionRecords.listForTask(task.id))[0];
    expect(storedRecord.status).toBe("CANCELLED");
    expect(storedRecord.cancelled?.at).toBeTruthy();
    expect(storedRecord.cancelled?.reason).toContain("test cancellation");

    const outOfProcess = readOutOfProcess(mission.id);
    expect(outOfProcess.mission.state).toBe("CANCELLED");
    expect(outOfProcess.tasks[0].state).toBe("CANCELLED");
    expect(outOfProcess.executions[0].status).toBe("CANCELLED");
  }, 180_000);

  it("enforces the schema contracts: foreign keys and one task per sequence", async () => {
    const first = await boot("c1");
    const repositories = createPrismaLifecycleRepositories(first.handle.client);

    // A task cannot reference a mission that does not exist.
    await expect(
      repositories.tasks.insert({
        id: "w_task_orphan",
        missionId: "w_mission_absent",
        sequence: 1,
        title: "orphan",
        objective: "orphan",
        input: {},
        assignedActorId: null,
        requiredCapabilityId: null,
        dependsOn: [],
        state: "PENDING",
        attempt: 0,
        maxAttempts: 2,
        history: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }),
    ).rejects.toThrow();

    // Two tasks cannot share a mission sequence.
    const mission = await first.orchestrator.createMission({
      title: "constraints",
      goal: "the database enforces the shape",
      createdBy: FOUNDER,
      owner: FOUNDER,
    });
    const planned = await first.orchestrator.plan(mission.id, [
      {
        title: "seq-one",
        objective: "first",
        input: { instruction: INSTRUCTION },
        assignedActorId: first.actorId,
        requiredCapabilityId: STRATEGY_INTERNAL_BRIEF_CAPABILITY_ID,
      },
    ]);
    const existing = planned.tasks[0];
    await expect(
      repositories.tasks.insert({
        ...existing,
        id: "w_task_duplicate_sequence",
        input: {},
        history: [],
      }),
    ).rejects.toThrow();
  }, 120_000);

  it("reports a missing execution record honestly instead of inserting one", async () => {
    const first = await boot("m1");
    const repositories = createPrismaLifecycleRepositories(first.handle.client);

    await expect(
      repositories.executionRecords.save({
        id: "w_execution_absent",
        handleId: "run_absent",
        runtimeId: "runtime_hermes_saeed",
        actorId: "actor_internal_strategy_analyst",
        capabilityId: STRATEGY_INTERNAL_BRIEF_CAPABILITY_ID,
        attempt: 1,
        status: "SUCCEEDED",
        startedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        audit: [],
      }),
    ).rejects.toThrow(/does not exist/i);

    expect(await repositories.executionRecords.get("w_execution_absent")).toBeNull();
  }, 120_000);
});
