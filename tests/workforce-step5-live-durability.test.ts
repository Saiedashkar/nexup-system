import { execSync } from "node:child_process";
import path from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createSequentialIdFactory } from "@/modules/ai-workforce/core/ids";
import { createWorkforcePrismaClient, type WorkforcePrismaHandle } from "@/modules/ai-workforce/persistence/prisma-client";
import {
  bootstrapStrategyAnalyst,
  createHermesRuntimeFromEnv,
  createMissionOrchestrator,
  founderActorRegistration,
  STRATEGY_INTERNAL_BRIEF_CAPABILITY_ID,
  STRATEGY_INTERNAL_BRIEF_CAPABILITY_VERSION,
  type RuntimeEvent,
} from "@/modules/workforce";
import { createWorkforceDomainFromPrisma } from "@/modules/workforce/persistence";

/**
 * STEP 5/8 — the LIVE end-to-end durability proof.
 *
 * This is section F of the closure mission, in its strongest available form:
 * the REAL agent, over the REAL bridge, to Hermes, with every step of the
 * lifecycle written to a REAL database that survives the process that wrote it.
 *
 *   Command → persisted Mission → persisted Task → real Step-4 agent
 *           → capability authorization → AsyncAgentRuntime → bridge → Hermes
 *           (profile `saieed`) → persisted Execution → persisted PENDING Review
 *           → HUMAN approval → persisted COMPLETED Task → persisted COMPLETED
 *           Mission → re-hydrated by a FRESH process from the database alone
 *
 * The database is a THROWAWAY cluster on loopback, created and deleted by
 * `scripts/run-persistence-proof.sh`; the proposed migration SQL is applied to
 * it by this file. That is deliberate: NEXUP's production database is real
 * data, and applying an unapproved migration to it is exactly what section C
 * forbids. So the trade is stated rather than hidden — the AGENT is real and
 * the PERSISTENCE is real, but the DATABASE IS NOT THE PRODUCTION ONE, and
 * therefore Step 5 stays OPEN until the migration is approved and applied.
 *
 * GATED twice: `NEXUP_BRIDGE_E2E=1` for the live bridge, and
 * `AI_WORKFORCE_TEST_DATABASE_URL` for the isolated database.
 *
 *   NEXUP_BRIDGE_E2E=1 HERMES_RUNTIME_PROFILE=saieed \
 *   HERMES_RUNTIME_TRANSPORT=BRIDGE HERMES_RUNTIME_BRIDGE_URL=… \
 *   HERMES_RUNTIME_BRIDGE_KEY_ID=nexup-vercel HERMES_RUNTIME_BRIDGE_SECRET=… \
 *   PROOF_TEST=tests/workforce-step5-live-durability.test.ts \
 *   bash scripts/run-persistence-proof.sh
 */

const BASE_URL = process.env.AI_WORKFORCE_TEST_DATABASE_URL;
const liveRequested = process.env.NEXUP_BRIDGE_E2E === "1";
const DB_NAME = "workforce_live_durability_test";
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

const describeIfLive = liveRequested && BASE_URL ? describe : describe.skip;

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

describeIfLive("STEP 5 — the REAL agent, persisted, and re-hydrated after a restart", () => {
  const handles: WorkforcePrismaHandle[] = [];

  /** A fresh client and a fresh domain: the database is the only shared state. */
  function newClient(events: RuntimeEvent[]) {
    const handle = createWorkforcePrismaClient(DB_URL);
    handles.push(handle);
    const ids = createSequentialIdFactory("w");
    const domain = createWorkforceDomainFromPrisma(handle, { ids });
    const runtime = createHermesRuntimeFromEnv(process.env, { eventSink: (event) => events.push(event) });
    return { handle, domain, runtime, ids };
  }

  /**
   * One application process. Only the process that RUNS the agent needs the
   * agent wiring; the one that DECIDES needs the human actor, and nothing else —
   * every registry is per-process, so this is a real re-hydration.
   */
  async function openProcess(events: RuntimeEvent[], options: { withAgent?: boolean } = {}) {
    const base = newClient(events);
    await base.domain.actors.register(founderActorRegistration());

    let built: Awaited<ReturnType<typeof bootstrapStrategyAnalyst>> | null = null;
    if (options.withAgent) {
      const runtime = base.runtime;
      if (!runtime.enabled) throw new Error(runtime.reason);
      built = await bootstrapStrategyAnalyst(base.domain, { runtime: runtime.adapter });
      if (!built.enabled) throw new Error(built.reason);
    }

    const orchestrator = createMissionOrchestrator(base.domain, { defaultReviewerActorId: FOUNDER });
    return { ...base, built, orchestrator };
  }

  beforeAll(async () => {
    try {
      psql(`DROP DATABASE IF EXISTS "${DB_NAME}" WITH (FORCE)`);
    } catch {
      /* may not exist */
    }
    psql(`CREATE DATABASE "${DB_NAME}"`);
    for (const file of MIGRATIONS) psqlFile(file);
    execSync("npx prisma generate", { env: process.env, stdio: "pipe", cwd: REPO_ROOT });
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

  it(
    "runs the whole lifecycle against the deployed bridge and keeps it after the process ends",
    async () => {
      const events: RuntimeEvent[] = [];
      const first = await openProcess(events, { withAgent: true });
      const built = first.built;
      if (!built || !built.enabled) throw new Error("the agent was not wired");
      const orchestrator = first.orchestrator;
      const startedAt = new Date();

      const mission = await orchestrator.createMission({
        title: `Durable live brief ${startedAt.toISOString()}`,
        goal: "Prove the persisted lifecycle end to end with a real agent",
        createdBy: FOUNDER,
        owner: FOUNDER,
        businessId: "biz_nexup",
        projectRef: "prj_strategy",
        clientRef: "cli_1",
        priority: "LOW",
      });

      const planned = await orchestrator.plan(mission.id, [
        {
          title: "live-durable-brief",
          objective: "Produce one internal brief through the deployed bridge",
          input: { instruction: INSTRUCTION },
          assignedActorId: built.actorId,
          requiredCapabilityId: STRATEGY_INTERNAL_BRIEF_CAPABILITY_ID,
          requiredCapabilityVersion: STRATEGY_INTERNAL_BRIEF_CAPABILITY_VERSION,
        },
      ]);
      const task = planned.tasks[0];
      expect(task.state).toBe("RUNNING");
      expect(task.executionHandleId).toBeTruthy();

      // The agent answers; the task parks for a HUMAN.
      const parked = await orchestrator.settleTask(mission.id, task.id);
      expect(parked.state).toBe("REVIEW");
      const [pending] = await first.domain.reviews.forTask(task.id);
      expect(pending.state).toBe("PENDING");

      const [execution] = await first.domain.executionRecords.listForTask(task.id);
      const agentMs = Date.parse(execution.completedAt ?? execution.updatedAt) - Date.parse(execution.startedAt);
      const agentText = `${execution.outputText ?? ""}${JSON.stringify(execution.output ?? {})}`;
      // The task points at the SAME execution the runtime minted: the handle on
      // the task row and the handle on the execution row cannot drift.
      expect(execution.handleId).toBe(task.executionHandleId);

      // ── the process that ran the agent is finished with this mission ──
      const firstHandle = execution.handleId;
      const providerExecutionId = execution.providerExecutionId ?? null;

      const second = await openProcess([]);
      const rehydratedMission = await second.domain.missions.require(mission.id);
      expect(rehydratedMission.state).toBe("WAITING");
      expect(rehydratedMission.projectRef).toBe("prj_strategy");
      expect(rehydratedMission.clientRef).toBe("cli_1");

      const [rehydratedTask] = await second.domain.tasks.listForMission(mission.id);
      expect(rehydratedTask.state).toBe("REVIEW");
      expect(rehydratedTask.executionHandleId).toBe(firstHandle);
      expect((await second.domain.reviews.listPending()).map((review) => review.id)).toContain(pending.id);

      const [rehydratedExecution] = await second.domain.executionRecords.listForTask(task.id);
      expect(rehydratedExecution.handleId).toBe(firstHandle);
      expect(rehydratedExecution.providerExecutionId).toBe(providerExecutionId);

      // The HUMAN decides, in the second process.
      const decidedAt = new Date();
      const completed = await second.orchestrator.decide(pending.id, {
        decision: "APPROVED",
        decidedBy: FOUNDER,
        note: "accepted after the agent's process ended",
      });
      expect(completed.mission.state).toBe("COMPLETED");

      // ── a THIRD process reconstructs the finished mission from disk alone ──
      const third = newClient([]);
      const finalMission = await third.domain.missions.require(mission.id);
      const finalTasks = await third.domain.tasks.listForMission(mission.id);
      const finalExecutions = await third.domain.executionRecords.listForMission(mission.id);
      const finalReviews = await third.domain.reviews.forTask(task.id);

      console.log(
        `[step5-durability-audit] ${JSON.stringify({
          step: "5",
          proof: "live+durable lifecycle, re-hydrated after the process ended",
          at: new Date().toISOString(),
          missionId: mission.id,
          missionState: finalMission.state,
          missionHistory: finalMission.history.map((entry) => entry.to),
          projectRef: finalMission.projectRef ?? null,
          clientRef: finalMission.clientRef ?? null,
          taskId: task.id,
          taskState: finalTasks[0].state,
          taskAttempt: finalTasks[0].attempt,
          attempt: finalExecutions[0].attempt,
          actorId: finalExecutions[0].actorId,
          capabilityId: finalExecutions[0].capabilityId,
          capabilityVersion: finalExecutions[0].capabilityVersion ?? null,
          assignmentId: built.assignmentId,
          runtimeId: finalExecutions[0].runtimeId,
          transport: "BRIDGE",
          profileRef: "saieed",
          runId: finalExecutions[0].handleId,
          providerExecutionId: finalExecutions[0].providerExecutionId ?? null,
          idempotencyKey: finalExecutions[0].idempotencyKey ?? null,
          executionStatus: finalExecutions[0].status,
          auditTrail: finalExecutions[0].audit.map((event) => event.type),
          reviewId: pending.id,
          reviewState: finalReviews[0].state,
          reviewDecidedBy: finalReviews[0].decidedBy ?? null,
          reviewDecidedAt: finalReviews[0].decidedAt ?? null,
          decisionAt: decidedAt.toISOString(),
          agentMs,
          markerFound: agentText.includes(MARKER),
          runtimeEvents: [...new Set(events.map((event) => event.type))],
          storage: "isolated local throwaway cluster (NOT the production database)",
        })}`,
      );

      // The acceptance criteria, checked against the RE-READ rows.
      expect(finalMission.state).toBe("COMPLETED");
      expect(finalMission.taskRefs).toEqual([task.id]);
      expect(finalMission.history.map((entry) => entry.to)).toEqual([
        "PLANNING",
        "RUNNING",
        "WAITING",
        "COMPLETED",
      ]);
      expect(finalTasks[0].state).toBe("COMPLETED");
      expect(finalExecutions[0].status).toBe("SUCCEEDED");
      expect(finalExecutions[0].providerExecutionId).toBeTruthy();
      expect(finalExecutions[0].handleId).toBe(firstHandle);
      expect(finalReviews[0].state).toBe("APPROVED");
      expect(finalReviews[0].decidedBy).toBe(FOUNDER);
      expect(agentText).toContain(MARKER);
      expect(events.every((event) => event.profile === "saieed")).toBe(true);
      // A cancelled/never-run path would have left no provider reference.
      expect(finalExecutions[0].audit.some((event) => event.type === "TERMINAL")).toBe(true);
    },
    240_000,
  );
});
