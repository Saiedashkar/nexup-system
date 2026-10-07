import { describe, expect, it } from "vitest";

import { createSequentialIdFactory, sequentialClock } from "@/modules/ai-workforce/core/ids";
import {
  bootstrapStrategyAnalyst,
  canTransitionTask,
  createHermesRuntime,
  createHermesRuntimeFromEnv,
  createMissionOrchestrator,
  createWorkforceDomain,
  dependenciesMet,
  founderActorRegistration,
  isTerminalTask,
  STRATEGY_INTERNAL_BRIEF_CAPABILITY_ID,
  STRATEGY_INTERNAL_BRIEF_CAPABILITY_VERSION,
  type HermesAsyncTransport,
  type HermesRuntimeConfig,
  type HermesTransportProvenance,
  type HermesTransportRequest,
  type HermesTransportResult,
  type MissionTask,
  type RuntimeEvent,
  type WorkforceDomain,
} from "@/modules/workforce";

// The mock transport is NOT on the production module surface: it lives in its
// own test-support module and declares `provenance: "TEST"`.
import { DeterministicHermesTransport } from "@/modules/workforce/runtimes/hermes/testing/deterministic-transport";

/**
 * STEP 5/8 — the REAL mission lifecycle.
 *
 *   Command → Mission → Task → Agent → Capability → Runtime → Execution
 *           → Result → Review → (human) → Mission
 *
 * Everything below runs the REAL registries, the REAL dispatcher, the REAL
 * orchestrator and the REAL Hermes adapter. The only substituted piece is the
 * TRANSPORT (a deterministic in-process double), which is exactly the seam the
 * live section replaces with the production bridge.
 *
 * The four things this file exists to prove:
 *   1. the lifecycle advances in ONE place, and only in allowed directions;
 *   2. a task cannot run without an assigned actor, an assigned capability and
 *      the actor's own runtime;
 *   3. an agent's result is not a decision — a HUMAN decides, exactly once;
 *   4. a retryable failure retries (with a fresh attempt and the SAME task) and
 *      a permanent one fails the task and the mission.
 */

const MARKER = "NEXUP_STEP5_MISSION_OK";
const INSTRUCTION = `Return exactly: ${MARKER}`;
const FOUNDER = "actor_founder";

/* ══════════════════════════════════════════════════════
   Fixtures
   ══════════════════════════════════════════════════════ */

class CountingTransport implements HermesAsyncTransport {
  readonly kind = "DETERMINISTIC";
  readonly provenance: HermesTransportProvenance;
  startCalls = 0;
  cancelCalls = 0;
  constructor(private readonly inner: HermesAsyncTransport) {
    this.provenance = inner.provenance;
  }
  async startRun(request: HermesTransportRequest) {
    this.startCalls += 1;
    return this.inner.startRun(request);
  }
  async invoke(request: HermesTransportRequest): Promise<HermesTransportResult> {
    if (request.operation === "cancel") this.cancelCalls += 1;
    return this.inner.invoke(request);
  }
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

type Wired = {
  domain: WorkforceDomain;
  transport: CountingTransport;
  actorId: string;
  runtimeId: string;
  orchestrator: ReturnType<typeof createMissionOrchestrator>;
};

/** A domain with the real strategy actor wired to a deterministic transport. */
async function wired(options: { holdCompletionMs?: number; failWith?: "UNAVAILABLE" } = {}): Promise<Wired> {
  const ids = createSequentialIdFactory("w");
  const now = sequentialClock("2026-06-01T00:00:00.000Z", 1000);
  const domain = createWorkforceDomain({ ids, now });
  const transport = new CountingTransport(
    new DeterministicHermesTransport({
      ...(options.holdCompletionMs !== undefined ? { holdCompletionMs: options.holdCompletionMs } : {}),
      ...(options.failWith ? { failWith: options.failWith } : {}),
    }),
  );
  const adapter = createHermesRuntime(hermesConfig(), { transport, ids, now, allowTestTransport: true });
  const built = await bootstrapStrategyAnalyst(domain, { runtime: adapter });
  if (!built.enabled) throw new Error(built.reason);
  await domain.actors.register(founderActorRegistration());

  const orchestrator = createMissionOrchestrator(domain, { defaultReviewerActorId: FOUNDER });
  return { domain, transport, actorId: built.actorId, runtimeId: built.runtimeId, orchestrator };
}

async function stateOf(domain: WorkforceDomain, missionId: string) {
  return {
    mission: await domain.missions.require(missionId),
    tasks: await domain.tasks.listForMission(missionId),
    executions: await domain.executionRecords.listForMission(missionId),
  };
}

function taskByTitle(tasks: readonly MissionTask[], title: string): MissionTask {
  const task = tasks.find((candidate) => candidate.title === title);
  if (!task) throw new Error(`no task titled "${title}"`);
  return task;
}

/* ══════════════════════════════════════════════════════
   A. Task state machine
   ══════════════════════════════════════════════════════ */

describe("STEP 5 A — the task state machine", () => {
  it("only allows the declared edges, and REVIEW is left by a decision", () => {
    expect(canTransitionTask("PENDING", "READY")).toBe(true);
    expect(canTransitionTask("PENDING", "RUNNING")).toBe(false);
    expect(canTransitionTask("READY", "RUNNING")).toBe(true);
    expect(canTransitionTask("RUNNING", "REVIEW")).toBe(true);
    expect(canTransitionTask("REVIEW", "COMPLETED")).toBe(true);
    expect(canTransitionTask("REVIEW", "REVISION")).toBe(true);
    expect(canTransitionTask("REVISION", "READY")).toBe(true);
    // The retry edge exists; the skip-ahead edge does not.
    expect(canTransitionTask("FAILED", "READY")).toBe(true);
    expect(canTransitionTask("FAILED", "COMPLETED")).toBe(false);
    expect(canTransitionTask("COMPLETED", "READY")).toBe(false);
    expect(isTerminalTask("COMPLETED")).toBe(true);
    expect(isTerminalTask("REVIEW")).toBe(false);
  });

  it("gates on dependencies", () => {
    const base: MissionTask = {
      id: "t1",
      missionId: "m1",
      sequence: 1,
      title: "a",
      objective: "a",
      input: {},
      assignedActorId: null,
      requiredCapabilityId: null,
      dependsOn: ["t0"],
      state: "PENDING",
      attempt: 0,
      maxAttempts: 2,
      history: [],
      createdAt: "x",
      updatedAt: "x",
    };
    const unmet: MissionTask = { ...base, id: "t0", dependsOn: [], state: "RUNNING" };
    expect(dependenciesMet(base, [base, unmet])).toBe(false);
    expect(dependenciesMet(base, [base, { ...unmet, state: "COMPLETED" }])).toBe(true);
  });
});

/* ══════════════════════════════════════════════════════
   B. The full lifecycle
   ══════════════════════════════════════════════════════ */

describe("STEP 5 B — the mission lifecycle, end to end", () => {
  it("plans, dispatches in dependency order, parks for review, and completes on a human's word", async () => {
    const { domain, orchestrator, actorId, runtimeId } = await wired();

    const mission = await orchestrator.createMission({
      title: "Internal strategy brief",
      goal: "Produce two short internal strategy briefs",
      createdBy: FOUNDER,
      owner: FOUNDER,
      businessId: "biz_nexup",
      priority: "LOW",
    });
    expect(mission.state).toBe("DRAFT");

    const planned = await orchestrator.plan(mission.id, [
      {
        title: "brief-one",
        objective: "Produce the first internal brief",
        input: { instruction: INSTRUCTION },
        assignedActorId: actorId,
        requiredCapabilityId: STRATEGY_INTERNAL_BRIEF_CAPABILITY_ID,
        requiredCapabilityVersion: STRATEGY_INTERNAL_BRIEF_CAPABILITY_VERSION,
      },
      {
        title: "brief-two",
        objective: "Produce the second internal brief",
        input: { instruction: INSTRUCTION },
        assignedActorId: actorId,
        requiredCapabilityId: STRATEGY_INTERNAL_BRIEF_CAPABILITY_ID,
        dependsOn: ["brief-one"],
      },
    ]);

    // Dependency order: one runs, the dependent one waits.
    expect(planned.mission.state).toBe("RUNNING");
    const first = taskByTitle(planned.tasks, "brief-one");
    const second = taskByTitle(planned.tasks, "brief-two");
    expect(first.state).toBe("RUNNING");
    expect(second.state).toBe("PENDING");
    expect(first.attempt).toBe(1);
    expect(first.executionHandleId).toBeTruthy();

    // The execution carries its attribution.
    const firstExecution = (await domain.executionRecords.listForTask(first.id))[0];
    expect(firstExecution.actorId).toBe(actorId);
    expect(firstExecution.runtimeId).toBe(runtimeId);
    expect(firstExecution.capabilityId).toBe(STRATEGY_INTERNAL_BRIEF_CAPABILITY_ID);
    expect(firstExecution.attempt).toBe(1);
    expect(firstExecution.idempotencyKey).toBe(`task:${first.id}:attempt:1`);
    expect(firstExecution.missionId).toBe(mission.id);
    expect(firstExecution.taskId).toBe(first.id);

    // The agent's success parks the task for a HUMAN — it does not complete it.
    const settledFirst = await orchestrator.settleTask(mission.id, first.id);
    expect(settledFirst.state).toBe("REVIEW");
    const afterFirst = await stateOf(domain, mission.id);
    expect(afterFirst.mission.state).toBe("WAITING");
    const review = await domain.reviews.forTask(first.id);
    expect(review).toHaveLength(1);
    expect(review[0].state).toBe("PENDING");
    // The reviewer is the mission's human owner.
    expect(review[0].reviewerActorId).toBe(FOUNDER);
    // The dependent task is still waiting: its dependency is not COMPLETED yet.
    expect(taskByTitle(afterFirst.tasks, "brief-two").state).toBe("PENDING");

    // A human accepts it. Only now does the dependent task start.
    const approved = await orchestrator.decide(review[0].id, {
      decision: "APPROVED",
      decidedBy: FOUNDER,
      note: "looks right",
    });
    expect(taskByTitle(approved.tasks, "brief-one").state).toBe("COMPLETED");
    const secondAfterApproval = taskByTitle(approved.tasks, "brief-two");
    expect(secondAfterApproval.state).toBe("RUNNING");
    expect(secondAfterApproval.attempt).toBe(1);
    expect(approved.mission.state).toBe("RUNNING");

    // A needs-revision decision sends the task back for ANOTHER attempt.
    await orchestrator.settleTask(mission.id, secondAfterApproval.id);
    const secondReview = (await domain.reviews.forTask(secondAfterApproval.id))[0];
    const revised = await orchestrator.decide(secondReview.id, {
      decision: "NEEDS_REVISION",
      decidedBy: FOUNDER,
      note: "sharpen it",
    });
    const retried = taskByTitle(revised.tasks, "brief-two");
    expect(retried.state).toBe("RUNNING");
    expect(retried.attempt).toBe(2);
    expect(retried.history.map((entry) => entry.to)).toContain("REVISION");
    // A new attempt is a NEW execution, not a replay of the old one.
    const attemptsForSecond = await domain.executionRecords.listForTask(secondAfterApproval.id);
    expect(attemptsForSecond.map((record) => record.attempt)).toEqual([1, 2]);
    expect(new Set(attemptsForSecond.map((record) => record.idempotencyKey)).size).toBe(2);

    // Accept the second attempt: the mission completes.
    await orchestrator.settleTask(mission.id, retried.id);
    const finalReview = (await domain.reviews.forTask(retried.id)).find((entry) => entry.state === "PENDING");
    const completed = await orchestrator.decide(finalReview!.id, { decision: "APPROVED", decidedBy: FOUNDER });
    expect(completed.mission.state).toBe("COMPLETED");
    expect(completed.mission.finishedAt).toBeTruthy();
    expect(completed.tasks.every((task) => task.state === "COMPLETED")).toBe(true);
    expect(completed.mission.taskRefs).toHaveLength(2);
    expect(completed.mission.history.map((entry) => entry.to)).toEqual([
      "PLANNING",
      "RUNNING",
      "WAITING",
      "RUNNING",
      "WAITING",
      "RUNNING",
      "WAITING",
      "COMPLETED",
    ]);

    // The audit spine: every attempt has events, and the accepted ones name
    // what the provider reported.
    const allExecutions = await domain.executionRecords.listForMission(mission.id);
    expect(allExecutions).toHaveLength(3);
    expect(allExecutions.every((record) => record.audit.length >= 2)).toBe(true);
    expect(allExecutions.every((record) => record.audit.some((event) => event.type === "TERMINAL"))).toBe(true);
    const accepted = allExecutions[0];
    expect(JSON.stringify(accepted.output ?? accepted.outputText ?? "")).toContain("deterministic");
  });

  it("keeps a task's result attached to the review that accepted it", async () => {
    const { domain, orchestrator, actorId } = await wired();
    const mission = await orchestrator.createMission({
      title: "m",
      goal: "g",
      createdBy: FOUNDER,
      owner: FOUNDER,
    });
    const planned = await orchestrator.plan(mission.id, [
      {
        title: "single",
        objective: "one brief",
        input: { instruction: INSTRUCTION },
        assignedActorId: actorId,
        requiredCapabilityId: STRATEGY_INTERNAL_BRIEF_CAPABILITY_ID,
      },
    ]);
    const task = planned.tasks[0];
    await orchestrator.settleTask(mission.id, task.id);
    const review = (await domain.reviews.forTask(task.id))[0];
    await orchestrator.decide(review.id, { decision: "APPROVED", decidedBy: FOUNDER });

    const stored = (await domain.tasks.listForMission(mission.id))[0];
    expect(stored.result).toMatchObject({ reviewId: review.id, executionRecordId: review.executionRecordId });
  });
});

/* ══════════════════════════════════════════════════════
   C. Human authority
   ══════════════════════════════════════════════════════ */

describe("STEP 5 C — human authority is not optional", () => {
  it("refuses a decision from an AI agent, even the actor that produced the work", async () => {
    const { domain, orchestrator, actorId } = await wired();
    const mission = await orchestrator.createMission({ title: "m", goal: "g", createdBy: FOUNDER, owner: FOUNDER });
    const planned = await orchestrator.plan(mission.id, [
      {
        title: "single",
        objective: "one brief",
        input: { instruction: INSTRUCTION },
        assignedActorId: actorId,
        requiredCapabilityId: STRATEGY_INTERNAL_BRIEF_CAPABILITY_ID,
      },
    ]);
    await orchestrator.settleTask(mission.id, planned.tasks[0].id);
    const review = (await domain.reviews.forTask(planned.tasks[0].id))[0];

    await expect(orchestrator.decide(review.id, { decision: "APPROVED", decidedBy: actorId })).rejects.toMatchObject({
      code: "APPROVAL_FORBIDDEN",
    });
    // The review is untouched and still pending.
    expect((await domain.reviews.get(review.id))?.state).toBe("PENDING");
    // ...and its task is still parked.
    expect((await domain.tasks.listForMission(mission.id))[0].state).toBe("REVIEW");
  });

  it("permits exactly ONE decision", async () => {
    const { domain, orchestrator, actorId } = await wired();
    const mission = await orchestrator.createMission({ title: "m", goal: "g", createdBy: FOUNDER, owner: FOUNDER });
    const planned = await orchestrator.plan(mission.id, [
      {
        title: "single",
        objective: "one brief",
        input: { instruction: INSTRUCTION },
        assignedActorId: actorId,
        requiredCapabilityId: STRATEGY_INTERNAL_BRIEF_CAPABILITY_ID,
      },
    ]);
    await orchestrator.settleTask(mission.id, planned.tasks[0].id);
    const review = (await domain.reviews.forTask(planned.tasks[0].id))[0];

    await orchestrator.decide(review.id, { decision: "APPROVED", decidedBy: FOUNDER });
    await expect(orchestrator.decide(review.id, { decision: "REJECTED", decidedBy: FOUNDER })).rejects.toMatchObject({
      code: "APPROVAL_ALREADY_DECIDED",
    });
  });

  it("a human rejection fails the task (and the mission) rather than silently completing it", async () => {
    const { domain, orchestrator, actorId } = await wired();
    const mission = await orchestrator.createMission({ title: "m", goal: "g", createdBy: FOUNDER, owner: FOUNDER });
    const planned = await orchestrator.plan(mission.id, [
      {
        title: "single",
        objective: "one brief",
        input: { instruction: INSTRUCTION },
        assignedActorId: actorId,
        requiredCapabilityId: STRATEGY_INTERNAL_BRIEF_CAPABILITY_ID,
        maxAttempts: 1,
      },
    ]);
    await orchestrator.settleTask(mission.id, planned.tasks[0].id);
    const review = (await domain.reviews.forTask(planned.tasks[0].id))[0];
    const result = await orchestrator.decide(review.id, {
      decision: "REJECTED",
      decidedBy: FOUNDER,
      note: "wrong brief",
    });

    expect(result.mission.state).toBe("FAILED");
    expect(taskByTitle(result.tasks, "single").state).toBe("FAILED");
    expect(taskByTitle(result.tasks, "single").error?.code).toBe("APPROVAL_REJECTED");
    // The refusal is recorded on the execution's audit trail too.
    const record = (await domain.executionRecords.listForTask(planned.tasks[0].id))[0];
    expect(record.audit.some((event) => event.type === "REJECTED")).toBe(true);
  });
});

/* ══════════════════════════════════════════════════════
   D. Retry / failure propagation
   ══════════════════════════════════════════════════════ */

describe("STEP 5 D — retry state, and truthful failure", () => {
  it("retries a RETRYABLE transport failure, then fails the task and the mission", async () => {
    const { domain, orchestrator, actorId, transport } = await wired({ failWith: "UNAVAILABLE" });
    const mission = await orchestrator.createMission({ title: "m", goal: "g", createdBy: FOUNDER, owner: FOUNDER });
    const planned = await orchestrator.plan(mission.id, [
      {
        title: "single",
        objective: "one brief",
        input: { instruction: INSTRUCTION },
        assignedActorId: actorId,
        requiredCapabilityId: STRATEGY_INTERNAL_BRIEF_CAPABILITY_ID,
        maxAttempts: 2,
      },
    ]);
    const task = planned.tasks[0];
    expect(task.state).toBe("RUNNING");

    // Attempt 1 fails retryably -> the task goes back to READY.
    const firstFailure = await orchestrator.settleTask(mission.id, task.id);
    expect(firstFailure.state).toBe("READY");
    const once = await domain.tasks.listForMission(mission.id);
    expect(once[0].attempt).toBe(1);
    expect(once[0].error?.retryable).toBe(true);

    // The stepper re-dispatches it — a NEW attempt, the SAME task.
    const advanced = await orchestrator.advance(mission.id);
    const retried = taskByTitle(advanced.tasks, "single");
    expect(retried.state).toBe("RUNNING");
    expect(retried.attempt).toBe(2);
    expect(transport.startCalls).toBe(2);

    // Attempt 2 exhausts the allowance -> the task AND the mission fail.
    const secondFailure = await orchestrator.settleTask(mission.id, retried.id);
    expect(secondFailure.state).toBe("FAILED");
    const final = await stateOf(domain, mission.id);
    expect(final.mission.state).toBe("FAILED");
    const attempts = await domain.executionRecords.listForTask(task.id);
    expect(attempts.map((record) => record.attempt)).toEqual([1, 2]);
    expect(attempts.every((record) => record.status === "FAILED")).toBe(true);
    expect(attempts[0].error?.category).toBe("TRANSPORT");
  });

  it("does not touch the transport when the actor is not assigned the capability", async () => {
    const { domain, orchestrator, actorId, runtimeId, transport } = await wired();

    // A second AI agent on the SAME runtime, but with NO assignment.
    const stranger = await domain.actors.register({
      slug: "unassigned-analyst",
      displayName: "Unassigned Analyst",
      type: "AI_AGENT",
      role: "analyst",
      department: "strategy",
      reportsTo: null,
      collaborators: [],
      lifecycle: "SHADOW",
      runtimeBinding: { runtimeId, runtimeType: "EXTERNAL_AGENT_RUNTIME" },
      modelPolicy: { strategy: "RUNTIME_DEFAULT" },
      autonomyLevel: "ASSISTED",
      memoryScope: { scope: "NONE", retention: "EPHEMERAL" },
      permissions: [{ permission: "aiworkforce.access" }],
      approvalPolicy: { mode: "INHERIT" },
      escalationTarget: FOUNDER,
      metadata: {},
    });

    const mission = await orchestrator.createMission({ title: "m", goal: "g", createdBy: FOUNDER, owner: FOUNDER });
    const planned = await orchestrator.plan(mission.id, [
      {
        title: "stranger",
        objective: "should not run",
        input: { instruction: INSTRUCTION },
        assignedActorId: stranger.id,
        requiredCapabilityId: STRATEGY_INTERNAL_BRIEF_CAPABILITY_ID,
      },
    ]);
    const task = planned.tasks[0];
    expect(task.state).toBe("READY");

    // The stepper refuses, and says why, without completing or failing anything.
    const advanced = await orchestrator.advance(mission.id);
    expect(taskByTitle(advanced.tasks, "stranger").state).toBe("READY");
    expect(advanced.mission.state).toBe("PLANNING");
    expect(await domain.executionRecords.listForMission(mission.id)).toHaveLength(0);
    expect(transport.startCalls).toBe(0);

    // Starting it directly reports the refusal as a BLOCKED outcome.
    const blocked = await orchestrator.startTask(mission.id, task.id);
    expect(blocked.blocked).toMatch(/not assigned/i);
    expect(blocked.state).toBe("READY");

    // The assigned actor, by contrast, runs fine.
    const good = await wired();
    expect(good.actorId).toBe(actorId);
  });
});

/* ══════════════════════════════════════════════════════
   E. Cancellation through the runtime port
   ══════════════════════════════════════════════════════ */

describe("STEP 5 E — cancelling a mission cancels its executions through the port", () => {
  it("cancels an in-flight execution, its task and the mission", async () => {
    const { domain, orchestrator, actorId, transport } = await wired({ holdCompletionMs: 400 });
    const mission = await orchestrator.createMission({ title: "m", goal: "g", createdBy: FOUNDER, owner: FOUNDER });
    const planned = await orchestrator.plan(mission.id, [
      {
        title: "single",
        objective: "one brief",
        input: { instruction: INSTRUCTION },
        assignedActorId: actorId,
        requiredCapabilityId: STRATEGY_INTERNAL_BRIEF_CAPABILITY_ID,
      },
    ]);
    const task = planned.tasks[0];
    expect(task.state).toBe("RUNNING");

    const cancelled = await orchestrator.cancelMission(mission.id, "operator cancelled");
    expect(cancelled.mission.state).toBe("CANCELLED");
    expect(taskByTitle(cancelled.tasks, "single").state).toBe("CANCELLED");
    // The cancel went through the AgentRuntime port, not straight to a transport.
    expect(transport.cancelCalls).toBe(1);
    const record = (await domain.executionRecords.listForTask(task.id))[0];
    expect(record.status).toBe("CANCELLED");
    expect(record.cancelled?.reason).toBe("operator cancelled");
    expect(record.audit.some((event) => event.type === "CANCELLED")).toBe(true);
  });
});

/* ══════════════════════════════════════════════════════
   F. The read model
   ══════════════════════════════════════════════════════ */

describe("STEP 5 F — reading state never advances it", () => {
  it("snapshot() is inert", async () => {
    const { domain, orchestrator, actorId } = await wired();
    const mission = await orchestrator.createMission({ title: "m", goal: "g", createdBy: FOUNDER, owner: FOUNDER });
    await orchestrator.plan(mission.id, [
      {
        title: "single",
        objective: "one brief",
        input: { instruction: INSTRUCTION },
        assignedActorId: actorId,
        requiredCapabilityId: STRATEGY_INTERNAL_BRIEF_CAPABILITY_ID,
      },
    ]);

    const first = await orchestrator.snapshot(mission.id);
    const second = await orchestrator.snapshot(mission.id);
    expect(second).toEqual(first);
    expect(first.tasks).toHaveLength(1);
    expect(first.executions).toHaveLength(1);
    expect(first.reviews).toHaveLength(0);
    // Same again: the read did not start anything else.
    expect(await domain.executionRecords.listForMission(mission.id)).toHaveLength(1);
  });
});

/* ══════════════════════════════════════════════════════
   H. LIVE — one real mission, one real agent turn
   ══════════════════════════════════════════════════════ */

const liveRequested = process.env.NEXUP_BRIDGE_E2E === "1";

describe.skipIf(!liveRequested)("STEP 5 H — a real mission through the real bridge", () => {
  it(
    "runs one task, records the execution, and completes on a human decision",
    async () => {
      const domain = createWorkforceDomain({ ids: createSequentialIdFactory("w") });
      const events: RuntimeEvent[] = [];
      const runtime = createHermesRuntimeFromEnv(process.env, { eventSink: (event) => events.push(event) });
      if (!runtime.enabled) throw new Error(runtime.reason);
      const built = await bootstrapStrategyAnalyst(domain, { runtime: runtime.adapter });
      if (!built.enabled) throw new Error(built.reason);
      await domain.actors.register(founderActorRegistration());

      const orchestrator = createMissionOrchestrator(domain, { defaultReviewerActorId: FOUNDER });

      const mission = await orchestrator.createMission({
        title: `Step 5 live mission ${Date.now()}`,
        goal: "Produce one internal strategy brief",
        createdBy: FOUNDER,
        owner: FOUNDER,
        priority: "LOW",
      });

      const startedAt = Date.now();
      const planned = await orchestrator.plan(mission.id, [
        {
          title: "live-brief",
          objective: "Produce one internal strategy brief",
          input: { instruction: INSTRUCTION },
          assignedActorId: built.actorId,
          requiredCapabilityId: STRATEGY_INTERNAL_BRIEF_CAPABILITY_ID,
          requiredCapabilityVersion: STRATEGY_INTERNAL_BRIEF_CAPABILITY_VERSION,
        },
      ]);
      const task = planned.tasks[0];
      expect(task.state).toBe("RUNNING");
      const acceptedMs = Date.now() - startedAt;

      const settled = await orchestrator.settleTask(mission.id, task.id);
      expect(settled.state).toBe("REVIEW");

      const review = (await domain.reviews.forTask(task.id))[0];
      expect(review.state).toBe("PENDING");
      const decided = await orchestrator.decide(review.id, {
        decision: "APPROVED",
        decidedBy: FOUNDER,
        note: "step5 live acceptance",
      });

      const wallMs = Date.now() - startedAt;
      const snapshot = await orchestrator.snapshot(mission.id);
      const execution = snapshot.executions[0];
      const text = `${execution.outputText ?? ""}${JSON.stringify(execution.output ?? {})}`;

      console.log(
        `[step5-audit] ${JSON.stringify({
          step: "5",
          at: new Date().toISOString(),
          missionId: snapshot.mission.id,
          missionState: snapshot.mission.state,
          missionHistory: snapshot.mission.history.map((entry) => entry.to),
          taskId: task.id,
          taskState: snapshot.tasks[0].state,
          taskAttempt: snapshot.tasks[0].attempt,
          executionRecordId: execution.id,
          handleId: execution.handleId,
          providerExecutionId: execution.providerExecutionId ?? null,
          actorId: execution.actorId,
          runtimeId: execution.runtimeId,
          capabilityId: execution.capabilityId,
          attempt: execution.attempt,
          status: execution.status,
          idempotencyKey: execution.idempotencyKey ?? null,
          auditEventTypes: execution.audit.map((event) => event.type),
          reviewState: review.state,
          decidedBy: review.decidedBy,
          markerFound: text.includes(MARKER),
          acceptedMs,
          wallMs,
          eventTypes: [...new Set(events.map((event) => event.type))],
          outputPreview: text.slice(0, 200),
        })}`,
      );

      expect(decided.mission.state).toBe("COMPLETED");
      expect(snapshot.tasks[0].state).toBe("COMPLETED");
      expect(execution.status).toBe("SUCCEEDED");
      expect(execution.providerExecutionId).toBeTruthy();
      expect(execution.handleId).toBeTruthy();
      expect(execution.actorId).toBe(built.actorId);
      expect(text).toContain(MARKER);
      expect(snapshot.reviews.every((entry) => entry.state !== "PENDING")).toBe(true);
    },
    180_000,
  );
});
