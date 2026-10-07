import { describe, expect, it } from "vitest";

import { createSequentialIdFactory, sequentialClock } from "@/modules/ai-workforce/core/ids";
import {
  bootstrapStrategyAnalyst,
  createCommandCenterQueries,
  createHermesRuntime,
  createMissionOrchestrator,
  createWorkforceDomain,
  founderActorRegistration,
  STRATEGY_INTERNAL_BRIEF_CAPABILITY_ID,
  type HermesRuntimeConfig,
  type MissionTask,
  type WorkforceDomain,
} from "@/modules/workforce";
import { DeterministicHermesTransport } from "@/modules/workforce/runtimes/hermes/testing/deterministic-transport";

/**
 * STEP 5/8 G — the Command Center's QUERY surfaces, before Step 6 draws them.
 *
 * Step 6 needs Active Missions, agent/execution status, Recent Activity and a
 * Decision Queue. Those four answers must come from the repositories, not from a
 * screen's own arithmetic, or the screen and the mission will eventually
 * disagree. This file pins that down, and pins down the one property that makes
 * the surface safe to hand to a page: it READS only.
 *
 * Nothing here is UI, and no existing Command Center mock is touched.
 */

const FOUNDER = "actor_founder";
const MARKER = "NEXUP_COMMAND_CENTER_QUERY_OK";
const INSTRUCTION = `Return exactly: ${MARKER}`;

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

type Wired = {
  domain: WorkforceDomain;
  orchestrator: ReturnType<typeof createMissionOrchestrator>;
  actorId: string;
  runtimeId: string;
  ids: ReturnType<typeof createSequentialIdFactory>;
  now: ReturnType<typeof sequentialClock>;
};

async function wired(): Promise<Wired> {
  const ids = createSequentialIdFactory("w");
  const now = sequentialClock("2026-09-01T00:00:00.000Z", 1000);
  const domain = createWorkforceDomain({ ids, now });
  await domain.actors.register(founderActorRegistration());

  const adapter = createHermesRuntime(hermesConfig(), {
    transport: new DeterministicHermesTransport(),
    ids,
    now,
    allowTestTransport: true,
  });
  const built = await bootstrapStrategyAnalyst(domain, { runtime: adapter });
  if (!built.enabled) throw new Error(built.reason);

  return {
    domain,
    ids,
    now,
    actorId: built.actorId,
    runtimeId: built.runtimeId,
    orchestrator: createMissionOrchestrator(domain, { defaultReviewerActorId: FOUNDER }),
  };
}

async function planOneTask(w: Wired, title: string, goal: string, missionInput: Partial<Parameters<Wired["orchestrator"]["createMission"]>[0]> = {}) {
  const mission = await w.orchestrator.createMission({
    title,
    goal,
    createdBy: FOUNDER,
    owner: FOUNDER,
    ...missionInput,
  });
  const planned = await w.orchestrator.plan(mission.id, [
    {
      title: `${title}-task`,
      objective: `produce the brief for ${title}`,
      input: { instruction: INSTRUCTION },
      assignedActorId: w.actorId,
      requiredCapabilityId: STRATEGY_INTERNAL_BRIEF_CAPABILITY_ID,
    },
  ]);
  const task = planned.tasks[0];
  return { mission: planned.mission, task };
}

/** A stable, ordered picture of everything the repositories hold. */
async function stateOfEverything(domain: WorkforceDomain) {
  const missions = await domain.missionRepository.list(100);
  const tasks = await Promise.all(missions.map((mission) => domain.tasks.listForMission(mission.id)));
  const executions = await Promise.all(missions.map((mission) => domain.executionRecords.listForMission(mission.id)));
  const reviews = await Promise.all(tasks.flat().map((task) => domain.reviewRepository.forTask(task.id)));
  return JSON.stringify({ missions, tasks, executions, reviews });
}

describe("G — the Command Center query surfaces", () => {
  it("answers active missions, execution status, recent activity and the decision queue from the repositories", async () => {
    const w = await wired();

    // One mission parked for a human, and one that is already finished.
    const running = await planOneTask(w, "active-mission", "still going", { projectRef: "prj_strategy", clientRef: "cli_1" });
    await w.orchestrator.settleTask(running.mission.id, running.task.id);

    const finished = await planOneTask(w, "finished-mission", "already done");
    await w.orchestrator.settleTask(finished.mission.id, finished.task.id);
    const [finishedReview] = await w.domain.reviews.forTask(finished.task.id);
    await w.orchestrator.decide(finishedReview.id, { decision: "APPROVED", decidedBy: FOUNDER });

    const queries = createCommandCenterQueries({
      missions: w.domain.missionRepository,
      tasks: w.domain.tasks,
      executionRecords: w.domain.executionRecords,
      reviews: w.domain.reviewRepository,
      now: w.now,
    });

    // ── Active Missions: only the non-terminal one, with its progress ──
    const active = await queries.activeMissions();
    expect(active.map((row) => row.missionId)).toEqual([running.mission.id]);
    expect(active[0].state).toBe("WAITING");
    expect(active[0].projectRef).toBe("prj_strategy");
    expect(active[0].clientRef).toBe("cli_1");
    // State keys are the `TaskState` values verbatim, plus `total`.
    expect(active[0].tasks).toMatchObject({ total: 1, REVIEW: 1, COMPLETED: 0, RUNNING: 0 });
    expect(active[0].attempts).toBe(1);
    expect(active[0].decisionQueue).toBe(1);
    expect(active[0].lastActivityAt).toBeTruthy();

    // ── Decision Queue: the human's actual work, with context ──
    const queue = await queries.decisionQueue();
    expect(queue).toHaveLength(1);
    expect(queue[0].missionId).toBe(running.mission.id);
    expect(queue[0].missionTitle).toBe("active-mission");
    expect(queue[0].taskTitle).toBe("active-mission-task");
    expect(queue[0].reviewerActorId).toBe(FOUNDER);
    expect(queue[0].summary).toMatch(/accept/i);

    // ── Execution status: attributed, with BOTH identities ──
    const status = await queries.executionStatus({ missionId: running.mission.id });
    expect(status).toHaveLength(1);
    expect(status[0]).toMatchObject({
      missionId: running.mission.id,
      taskId: running.task.id,
      attempt: 1,
      status: "SUCCEEDED",
      runtimeId: w.runtimeId,
      actorId: w.actorId,
      capabilityId: STRATEGY_INTERNAL_BRIEF_CAPABILITY_ID,
      terminal: true,
    });
    expect(status[0].handleId).toBeTruthy();
    // The deterministic transport has NO provider session separate from its
    // handle, so `providerExecutionId` is legitimately absent here — and the
    // surface must report that absence rather than invent an id. The BRIDGE
    // path carries both identities (see the live durability evidence).
    expect(status[0].providerExecutionId ?? null).toBeNull();

    // ── Recent Activity: newest first, and truthful about what happened ──
    const activity = await queries.recentActivity();
    expect(activity.length).toBe(2);
    expect(activity[0].at >= activity[1].at).toBe(true);
    expect(activity.every((row) => row.lastEvent === "TERMINAL")).toBe(true);
    expect(activity.every((row) => row.summary.includes("succeeded"))).toBe(true);

    // ── One snapshot, one read ──
    const snap = await queries.snapshot();
    expect(snap.generatedAt).toBeTruthy();
    expect(snap.activeMissions).toHaveLength(1);
    expect(snap.decisionQueue).toHaveLength(1);
    expect(snap.recentActivity).toHaveLength(2);
    expect(snap.executionStatus).toHaveLength(2);
  });

  it("reports the LATEST attempt per task, not every attempt", async () => {
    const w = await wired();
    const { mission, task } = await planOneTask(w, "retried", "one revision then done");

    await w.orchestrator.settleTask(mission.id, task.id);
    const [firstReview] = await w.domain.reviews.forTask(task.id);
    await w.orchestrator.decide(firstReview.id, { decision: "NEEDS_REVISION", decidedBy: FOUNDER });
    await w.orchestrator.settleTask(mission.id, task.id);
    const [secondReview] = (await w.domain.reviews.forTask(task.id)).filter((entry) => entry.state === "PENDING");
    expect(secondReview).toBeTruthy();

    const queries = createCommandCenterQueries({
      missions: w.domain.missionRepository,
      tasks: w.domain.tasks,
      executionRecords: w.domain.executionRecords,
      reviews: w.domain.reviewRepository,
    });

    // Both attempts exist...
    const all = await w.domain.executionRecords.listForTask(task.id);
    expect(all.map((record) => record.attempt)).toEqual([1, 2]);
    // ...but the status surface shows one row per task: the current attempt.
    const status = await queries.executionStatus({ taskId: task.id });
    expect(status).toHaveLength(1);
    expect(status[0].attempt).toBe(2);
    expect(status[0].terminal).toBe(true);

    // Activity still shows BOTH attempts, because a feed is history.
    const activity = await queries.recentActivity();
    expect(activity.filter((row) => row.taskId === task.id)).toHaveLength(2);
  });

  it("READS only: running every query changes nothing", async () => {
    const w = await wired();
    const { mission, task } = await planOneTask(w, "read-only", "queries must not advance the mission");
    await w.orchestrator.settleTask(mission.id, task.id);

    const queries = createCommandCenterQueries({
      missions: w.domain.missionRepository,
      tasks: w.domain.tasks,
      executionRecords: w.domain.executionRecords,
      reviews: w.domain.reviewRepository,
      now: w.now,
    });

    const before = await stateOfEverything(w.domain);
    const missionBefore = await w.domain.missions.require(mission.id);
    const taskBefore = await w.domain.tasks.get(task.id);

    await queries.activeMissions();
    await queries.executionStatus({ limit: 100 });
    await queries.recentActivity(100);
    await queries.decisionQueue(100);
    await queries.snapshot(100);
    // Twice, in case a first read warmed something mutable.
    await queries.snapshot(100);

    const after = await stateOfEverything(w.domain);
    expect(after).toBe(before);

    const missionAfter = await w.domain.missions.require(mission.id);
    const taskAfter = await w.domain.tasks.get(task.id);
    expect(missionAfter).toEqual(missionBefore);
    expect(taskAfter).toEqual(taskBefore);
    // The pending decision is still pending — reading the queue did not decide it.
    expect((await w.domain.reviews.listPending())).toHaveLength(1);
  });

  it("says nothing rather than something wrong, on an empty domain", async () => {
    const w = await wired();
    const queries = createCommandCenterQueries({
      missions: w.domain.missionRepository,
      tasks: w.domain.tasks,
      executionRecords: w.domain.executionRecords,
      reviews: w.domain.reviewRepository,
    });
    expect(await queries.activeMissions()).toEqual([]);
    expect(await queries.executionStatus()).toEqual([]);
    expect(await queries.recentActivity()).toEqual([]);
    expect(await queries.decisionQueue()).toEqual([]);
  });

  it("is reachable from the composed domain", async () => {
    const w = await wired();
    const { mission, task } = await planOneTask(w, "via-domain", "the domain exposes the surface");
    await w.orchestrator.settleTask(mission.id, task.id);
    const queued = await w.domain.queries.decisionQueue();
    expect(queued.map((row) => row.taskId)).toEqual([task.id]);
    const active = await w.domain.queries.activeMissions();
    expect(active[0].missionId).toBe(mission.id);
    expect(active[0].tasks.REVIEW).toBe(1);
  });

  it("uses the injected clock for `generatedAt`, so a snapshot is reproducible", async () => {
    const w = await wired();
    const queries = createCommandCenterQueries({
      missions: w.domain.missionRepository,
      tasks: w.domain.tasks,
      executionRecords: w.domain.executionRecords,
      reviews: w.domain.reviewRepository,
      now: () => new Date("2026-09-30T12:00:00.000Z"),
    });
    const snap = await queries.snapshot();
    expect(snap.generatedAt).toBe("2026-09-30T12:00:00.000Z");
  });

  it("returns task counts that add up to the task list", async () => {
    const w = await wired();
    const { mission } = await planOneTask(w, "counts", "counts must not drift");
    const tasks: MissionTask[] = await w.domain.tasks.listForMission(mission.id);
    const progress = (await w.domain.queries.activeMissions()).find((row) => row.missionId === mission.id)!;
    const sum = progress.tasks.PENDING + progress.tasks.READY + progress.tasks.RUNNING + progress.tasks.REVIEW +
      progress.tasks.COMPLETED + progress.tasks.FAILED + progress.tasks.REVISION + progress.tasks.CANCELLED;
    expect(progress.tasks.total).toBe(tasks.length);
    expect(sum).toBe(tasks.length);
  });
});
