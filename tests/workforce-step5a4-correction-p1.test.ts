import { describe, expect, it } from "vitest";

import { AiWorkforceError } from "@/modules/ai-workforce/core/errors";
import { createSequentialIdFactory } from "@/modules/ai-workforce/core/ids";
import type { BudgetGovernor } from "@/modules/ai-workforce/policies/budget-governor";
import { defineTool } from "@/modules/ai-workforce/registry/tool-definition";
import { ToolRegistry } from "@/modules/ai-workforce/registry/tool-registry";

import { createWorkforceDomain, type WorkforceDomain } from "@/modules/workforce";
import { InMemoryCommandIntentRepository } from "@/modules/workforce/application/command-intent";
import { WorkforceCommandService } from "@/modules/workforce/application/command-service";
import {
  approvalBindingRef,
  createCapabilityExecutionService,
  type DefaultCapabilityExecutionService,
  type ExecutionApprovalSource,
} from "@/modules/workforce/execution/capability-execution-service";
import {
  executionIdempotencyKeyForAttempt,
  type ExecutionAttemptRequest,
} from "@/modules/workforce/execution/capability-execution-contracts";
import {
  InMemoryExecutionClaimRepository,
  type ExecutionClaim,
  type ExecutionClaimRepository,
  type ExecutionClaimRequest,
  type ExecutionClaimSweepQuery,
} from "@/modules/workforce/execution/execution-claim";
import { ExecutionReconciler, sweepLanes } from "@/modules/workforce/execution/execution-reconciler";
import { createExecutionAuthority, type ExecutionAuthority } from "@/modules/workforce/execution/execution-authority";
import { receiptFromClaimDetail } from "@/modules/workforce/execution/execution-claim-receipt";
import type { ExecutionRecord } from "@/modules/workforce/execution/execution-record";
import { createMissionOrchestrator } from "@/modules/workforce/orchestration/create-mission-orchestrator";
import type { MissionOrchestrator } from "@/modules/workforce/orchestration/mission-orchestrator";
import { AgentRuntimeDispatcher } from "@/modules/workforce/runtimes/agent-runtime-dispatcher";
import type { AsyncAgentRuntime } from "@/modules/workforce/runtimes/agent-runtime";
import type { Actor } from "@/modules/workforce/actors/actor-contracts";
import type { MissionTask } from "@/modules/workforce/missions/task-contracts";

/**
 * STEP 5A-4 — THE P1 CORRECTION SUITE.
 *
 * Each case here fails on the REVIEWED tree and passes on the corrected one. The
 * findings it covers, by their review labels:
 *
 *   P1-1  cancellation did not target the AUTHORITATIVE attempt, reserved through
 *         two writes, and could poison a mission's other tasks; `cancel()` accepted
 *         anything object-shaped as an authority.
 *   P1-2  a typed RUNTIME_TIMEOUT was reported as a runtime OUTAGE.
 *   P1-3  claim classification disclosed REPLAYED/IN_PROGRESS/UNVERIFIED before any
 *         canonical identity check, and a legitimate replay of a terminal task was
 *         refused by the fresh-dispatch state rule.
 *   P1-4  claim-first recovery was unreachable from the application entry points.
 *   P1-6  the actor's own RISK_AT_LEAST threshold was ignored, and an APPROVED
 *         record with no decision timestamp bypassed expiry.
 *   P1-7  delivery/finalization consumed the MUTABLE caller request.
 */

const NOW = "2026-05-01T00:00:00.000Z";
const FOUNDER = "actor_founder";

const permissiveGovernor: BudgetGovernor = {
  policyRef: "test.correction.allow",
  async evaluate(input) {
    return { allowed: true, reason: "ALLOWED_ATTESTED_INCLUDED_ROUTE", policyRef: "test.correction.allow", spend: input.spend };
  },
};

function businessRegistry() {
  return {
    async resolve(reference: string) {
      return reference === "biz_nexup" ? { id: "biz_nexup", slug: "nexup" } : null;
    },
  };
}

/* ══════════════════════════════════════════════════════
   The harness
   ══════════════════════════════════════════════════════ */

type Harness = {
  domain: WorkforceDomain;
  claims: InMemoryExecutionClaimRepository;
  service: DefaultCapabilityExecutionService;
  orchestrator: MissionOrchestrator;
  authority: ExecutionAuthority;
  actorId: string;
  missionId: string;
  taskId: string;
  toolCapabilityId: string;
  runtimeCapabilityId: string;
  runtimeId: string;
  /** Every input the deterministic handler was invoked with. */
  handlerInputs: unknown[];
  seedTask: (overrides?: Partial<MissionTask>) => Promise<void>;
  request: (overrides?: Partial<ExecutionAttemptRequest>) => ExecutionAttemptRequest;
  /** A durable execution record, so a RUNNING task can be escalated. */
  seedExecutionRecord: (input: { taskId: string; attempt: number; status: ExecutionRecord["status"] }) => Promise<ExecutionRecord>;
  /** A claim reserved straight into `DISPATCHED`, as a completed first attempt. */
  dispatchedClaim: (input: { taskId: string; attempt: number; handleId: string }) => Promise<ExecutionClaim>;
  /** A claim that entered dispatch and never recorded a handle. */
  unverifiedClaim: (input: { taskId: string; attempt: number }) => Promise<ExecutionClaim>;
};

let seq = 0;

async function harness(
  options: {
    actorApproval?: Actor["approvalPolicy"];
    actorRuntimeBound?: boolean;
    runtime?: AsyncAgentRuntime | null;
    approvals?: ExecutionApprovalSource;
  } = {},
): Promise<Harness> {
  seq += 1;
  const ids = createSequentialIdFactory(`p1${seq}`);
  const domain = createWorkforceDomain({ ids, now: () => new Date(NOW) });
  const tools = new ToolRegistry();
  const handlerInputs: unknown[] = [];

  // The id the ACTOR is bound to must be the id the runtime is actually
  // registered under, so a runtime-leg attempt resolves its binding.
  const runtime = options.runtime ?? null;
  const runtimeId = runtime ? runtime.identity.id : `runtime_p1_${seq}`;
  if (runtime) domain.runtimes.register(runtime);

  // ── A deterministic MEDIUM-risk TOOL capability ──
  const toolCapabilityId = `proof.write${seq}`;
  tools.register(
    defineTool(
      {
        id: toolCapabilityId,
        name: "Proof reversible write",
        description: "deterministic, in-process, reversible",
        domain: "system",
        // The tool contract requires the action to match the id's suffix, and the
        // MEDIUM risk must be at least what the WRITE semantics imply.
        action: `write${seq}`,
        riskLevel: "MEDIUM",
        readWriteMode: "WRITE",
        inputSchema: { kind: "object", fields: {} },
        outputSchema: { kind: "object", fields: {} },
        requiredPermissions: ["aiworkforce.access"],
      },
      async (input) => {
        handlerInputs.push(input);
        return { echoed: input };
      },
    ),
  );

  // ── A RUNTIME-hosted capability (variable cost, no local handler) ──
  const runtimeCapabilityId = `proof.brief${seq}`;

  const actorId = `actor_agent_${seq}`;
  await domain.actors.register({
    id: actorId,
    slug: `agent-${seq}`,
    displayName: "Correction Agent",
    type: "AI_AGENT",
    role: "agent",
    department: null,
    reportsTo: null,
    collaborators: [],
    lifecycle: options.actorRuntimeBound ? "APPROVED_AUTONOMY" : "SHADOW",
    runtimeBinding: options.actorRuntimeBound ? { runtimeId, runtimeType: "EXTERNAL_AGENT_RUNTIME" } : null,
    modelPolicy: null,
    autonomyLevel: "SUPERVISED",
    memoryScope: { scope: "NONE", retention: "EPHEMERAL" },
    permissions: [],
    approvalPolicy: options.actorApproval ?? { mode: "INHERIT" },
    escalationTarget: FOUNDER,
    metadata: {},
  });
  await domain.actors.register({
    id: FOUNDER,
    slug: "founder",
    displayName: "Founder",
    type: "HUMAN",
    role: "founder",
    department: null,
    reportsTo: null,
    collaborators: [],
    lifecycle: "APPROVED_AUTONOMY",
    runtimeBinding: null,
    modelPolicy: null,
    autonomyLevel: "MANUAL",
    memoryScope: { scope: "NONE", retention: "EPHEMERAL" },
    permissions: [],
    approvalPolicy: { mode: "INHERIT" },
    escalationTarget: null,
    metadata: {},
  });

  for (const [id, kind, requirements] of [
    [toolCapabilityId, "TOOL", { supportsDeterministic: true }],
    [runtimeCapabilityId, "SKILL", { requiresRuntime: true }],
  ] as const) {
    await domain.capabilities.register({
      id,
      name: `Proof ${kind}`,
      kind,
      version: "1.0.0",
      description: "correction proof capability",
      owner: actorId,
      status: "ACTIVE",
      riskLevel: "LOW",
      approvalRequirement: "NONE",
      runtimeRequirements: requirements,
      ...(kind === "SKILL" ? { procedureRef: "sop://proof" } : {}),
      tags: [],
      metadata: {},
    });
    await domain.assignments.assign({ actorId, capabilityId: id, capabilityVersion: "1.0.0", grantedBy: FOUNDER });
  }

  const mission = await domain.missions.create({
    title: "P1 correction mission",
    goal: "prove the corrected invariants",
    createdBy: actorId,
    owner: FOUNDER,
    businessId: "biz_nexup",
  });
  const taskId = `task_p1_${seq}`;

  const claims = new InMemoryExecutionClaimRepository({ ids, now: () => new Date(NOW) });
  const service = createCapabilityExecutionService({
    ids,
    now: () => new Date(NOW),
    claims,
    records: domain.executionRecords,
    executions: domain.executions,
    capabilities: domain.capabilities,
    assignments: domain.assignments,
    actors: domain.actors,
    runtimes: domain.runtimes,
    deterministic: {
      id: "proof.deterministic",
      externalCalls: false,
      async invoke(input) {
        handlerInputs.push(input.input);
        return { handleId: `det_${seq}_${handlerInputs.length}`, status: "SUCCEEDED" as const, output: input.input };
      },
    },
    dispatcher: new AgentRuntimeDispatcher({
      runtimes: domain.runtimes,
      actors: domain.actors,
      assignments: domain.assignments,
    }),
    tools,
    budget: permissiveGovernor,
    businesses: businessRegistry(),
    missions: domain.missionRepository,
    tasks: domain.tasks,
    processId: "correction-p1",
    ...(options.approvals ? { approvals: options.approvals } : {}),
  });

  const orchestrator = createMissionOrchestrator(domain, {
    execution: service,
    claims,
    budget: permissiveGovernor,
    businesses: businessRegistry(),
    defaultReviewerActorId: FOUNDER,
  });

  const authority = createExecutionAuthority({
    userId: "user_operator",
    actorId: "actor_human_operator",
    actorSlug: "human-operator",
    actorType: "HUMAN",
    permissionTokens: ["aiworkforce.access"],
    accessibleBusinessSlugs: ["nexup"],
    isSuperAdmin: false,
    hasOfficeFinanceFull: false,
    requestedAt: NOW,
  });

  async function seedTask(overrides: Partial<MissionTask> = {}): Promise<void> {
    const task = {
      id: taskId,
      missionId: mission.id,
      sequence: 1,
      title: "correction task",
      objective: "prove",
      input: {},
      assignedActorId: actorId,
      requiredCapabilityId: toolCapabilityId,
      requiredCapabilityVersion: "1.0.0",
      dependsOn: [],
      state: "READY",
      attempt: 0,
      maxAttempts: 5,
      history: [{ from: null, to: "READY", at: NOW, reason: "planned" }],
      createdAt: NOW,
      updatedAt: NOW,
      ...overrides,
    } as MissionTask;
    const existing = await domain.tasks.get(task.id);
    if (existing) await domain.tasks.update(task, [existing.state]);
    else await domain.tasks.insert(task);
  }

  function request(overrides: Partial<ExecutionAttemptRequest> = {}): ExecutionAttemptRequest {
    const attempt = overrides.attempt ?? 1;
    const id = overrides.taskId ?? taskId;
    return {
      missionId: mission.id,
      taskId: id,
      attempt,
      idempotencyKey: executionIdempotencyKeyForAttempt(id, attempt),
      authority,
      assignedActorId: actorId,
      requiredCapabilityId: toolCapabilityId,
      requiredCapabilityVersion: "1.0.0",
      input: {},
      traceId: `trace:${id}:${attempt}`,
      businessScope: null,
      source: "MANUAL",
      ...overrides,
    };
  }

  async function seedExecutionRecord(input: {
    taskId: string;
    attempt: number;
    status: ExecutionRecord["status"];
  }): Promise<ExecutionRecord> {
    const at = NOW;
    return domain.executionRecords.insert({
      id: `exec_p1_${seq}_${input.attempt}_${input.status}`,
      handleId: `handle_${seq}_${input.attempt}`,
      runtimeId: runtimeId,
      actorId,
      capabilityId: runtimeCapabilityId,
      attempt: input.attempt,
      status: input.status,
      startedAt: at,
      updatedAt: at,
      missionId: mission.id,
      taskId: input.taskId,
      audit: [],
    });
  }

  async function dispatchedClaim(input: { taskId: string; attempt: number; handleId: string }): Promise<ExecutionClaim> {
    const token = `tok_disp_${seq}_${input.attempt}`;
    const claimed = await claims.claim({
      missionId: mission.id,
      taskId: input.taskId,
      attempt: input.attempt,
      idempotencyKey: executionIdempotencyKeyForAttempt(input.taskId, input.attempt),
      actorId,
      capabilityId: runtimeCapabilityId,
      runtimeId,
      leaseOwner: token,
      leaseTtlMs: 600_000,
    });
    if (claimed.kind !== "CLAIMED") throw new Error(`expected CLAIMED, got ${claimed.kind}`);
    const entered = await claims.markDispatching(claimed.claim.id, { invocationToken: token, leaseTtlMs: 600_000 });
    if (!entered) throw new Error("expected DISPATCHING");
    const dispatched = await claims.markDispatched(claimed.claim.id, {
      invocationToken: token,
      executionRecordId: `record_${seq}_${input.attempt}`,
      handleId: input.handleId,
      runtimeId,
    });
    if (!dispatched) throw new Error("expected DISPATCHED");
    return dispatched;
  }

  async function unverifiedClaim(input: { taskId: string; attempt: number }): Promise<ExecutionClaim> {
    const token = `tok_unv_${seq}_${input.attempt}`;
    const claimed = await claims.claim({
      missionId: mission.id,
      taskId: input.taskId,
      attempt: input.attempt,
      idempotencyKey: executionIdempotencyKeyForAttempt(input.taskId, input.attempt),
      actorId,
      capabilityId: runtimeCapabilityId,
      runtimeId,
      leaseOwner: token,
      leaseTtlMs: 600_000,
    });
    if (claimed.kind !== "CLAIMED") throw new Error(`expected CLAIMED, got ${claimed.kind}`);
    const entered = await claims.markDispatching(claimed.claim.id, { invocationToken: token, leaseTtlMs: 600_000 });
    if (!entered) throw new Error("expected DISPATCHING");
    const unverified = await claims.markUnverified(claimed.claim.id, "dispatch was entered and the process died");
    if (!unverified) throw new Error("expected UNVERIFIED");
    return unverified;
  }

  return {
    domain,
    claims,
    service,
    orchestrator,
    authority,
    actorId,
    missionId: mission.id,
    taskId,
    toolCapabilityId,
    runtimeCapabilityId,
    runtimeId,
    handlerInputs,
    seedTask,
    request,
    seedExecutionRecord,
    dispatchedClaim,
    unverifiedClaim,
  };
}

/** A runtime whose bounded wait expires while the execution keeps running. */
function timeoutRuntime(id: string): AsyncAgentRuntime {
  const record = {
    handleId: "r_handle_1",
    runtimeId: id,
    status: "RUNNING" as const,
    submittedAt: NOW,
    startedAt: NOW,
    updatedAt: NOW,
  };
  const handle = {
    handleId: record.handleId,
    runtimeId: id,
    status: "RUNNING" as const,
    submittedAt: NOW,
    updatedAt: NOW,
  };
  return {
    identity: {
      id,
      type: "EXTERNAL_AGENT_RUNTIME",
      displayName: "timeout runtime",
      capabilities: [],
      metadata: {},
    },
    async healthCheck() {
      return { status: "HEALTHY" as const, checkedAt: NOW };
    },
    async submitJob() {
      return handle;
    },
    async resumeJob() {
      return handle;
    },
    async cancelJob() {
      return handle;
    },
    async getExecutionStatus() {
      return handle;
    },
    async startJob() {
      return handle;
    },
    async getExecution() {
      return record;
    },
    async executionEvents() {
      return [];
    },
    async waitForExecution() {
      throw new AiWorkforceError("RUNTIME_TIMEOUT", "Caller waited 5ms for the execution; it was NOT cancelled", {
        handleId: record.handleId,
      });
    },
  };
}

/* ══════════════════════════════════════════════════════
   P1-1 — cancellation targets the AUTHORITATIVE attempt
   ══════════════════════════════════════════════════════ */

describe("P1-1 — cancellation linearizes against the CURRENT attempt only", () => {
  it("never cancels a HISTORICAL attempt's handle when the task is READY for the next one", async () => {
    const w = await harness();
    // Attempt 1 was dispatched (and failed). The task is BACK to READY, so the
    // attempt that may still start is 2.
    const historical = await w.dispatchedClaim({ taskId: w.taskId, attempt: 1, handleId: "historical_handle" });
    await w.seedTask({ attempt: 1, state: "READY", requiredCapabilityId: w.runtimeCapabilityId });

    const results = await w.service.cancelMissionAttempts({
      missionId: w.missionId,
      tasks: [{ taskId: w.taskId, state: "READY" }],
      reason: "operator cancelled",
      authority: w.authority,
    });

    expect(results).toHaveLength(1);
    expect(results[0]!.unresolved).toBe(false);
    // The HISTORICAL attempt is untouched — its handle still exists and it was
    // never sent to a runtime.
    const stillHistorical = await w.claims.findByKey(executionIdempotencyKeyForAttempt(w.taskId, 1));
    expect(stillHistorical?.state).toBe("DISPATCHED");
    expect(stillHistorical?.handleId).toBe("historical_handle");
    expect(stillHistorical?.id).toBe(historical.id);
    // The NEXT attempt is the one that was reserved.
    const next = await w.claims.findByKey(executionIdempotencyKeyForAttempt(w.taskId, 2));
    expect(next?.state).toBe("CANCELLED");
    expect(w.handlerInputs).toHaveLength(0);
  });

  it("reserves through ONE atomic write — no claim() then markCancelled() sequence", async () => {
    const w = await harness();
    await w.seedTask();

    // A counting decorator over the reference ledger: the assertion is about what
    // the cancellation path CALLS, not merely about the state it ends in.
    const calls: string[] = [];
    const inner = w.claims;
    const counting: ExecutionClaimRepository = {
      claim: (request: ExecutionClaimRequest) => {
        calls.push("claim");
        return inner.claim(request);
      },
      get: (id) => inner.get(id),
      findByKey: (key) => inner.findByKey(key),
      listForTask: (taskId) => inner.listForTask(taskId),
      listDispatching: (limit) => inner.listDispatching(limit),
      listUnresolved: (limit) => inner.listUnresolved(limit),
      markDispatching: (id, input) => inner.markDispatching(id, input),
      markDispatched: (id, input) => inner.markDispatched(id, input),
      release: (id, input) => inner.release(id, input),
      markCancelled: (id, input) => {
        calls.push("markCancelled");
        return inner.markCancelled(id, input);
      },
      markUnverified: (id, detail) => inner.markUnverified(id, detail),
      markRecoverySwept: (id) => inner.markRecoverySwept(id),
      reserveCancellation: (request) => {
        calls.push("reserveCancellation");
        return inner.reserveCancellation(request);
      },
      rollbackCancellation: (id, input) => inner.rollbackCancellation(id, input),
      recoveryFor: (id, options) => inner.recoveryFor(id, options),
      count: () => inner.count(),
    };
    const service = createCapabilityExecutionService({
      ids: createSequentialIdFactory(`p1count${seq}`),
      now: () => new Date(NOW),
      claims: counting,
      records: w.domain.executionRecords,
      executions: w.domain.executions,
      capabilities: w.domain.capabilities,
      assignments: w.domain.assignments,
      actors: w.domain.actors,
      runtimes: w.domain.runtimes,
      deterministic: {
        id: "proof.deterministic",
        externalCalls: false,
        async invoke() {
          return { handleId: "unused", status: "SUCCEEDED" as const };
        },
      },
      dispatcher: new AgentRuntimeDispatcher({
        runtimes: w.domain.runtimes,
        actors: w.domain.actors,
        assignments: w.domain.assignments,
      }),
      tools: new ToolRegistry(),
      budget: permissiveGovernor,
      businesses: businessRegistry(),
      missions: w.domain.missionRepository,
      tasks: w.domain.tasks,
    });

    const results = await service.cancelMissionAttempts({
      missionId: w.missionId,
      tasks: [{ taskId: w.taskId, state: "READY" }],
      reason: "one write",
      authority: w.authority,
    });
    expect(results[0]?.state).toBe("CANCELLED");
    // The reservation is ONE call. The old two-write sequence shows up as
    // "claim" and/or "markCancelled" and is exactly what a crash could strand.
    expect(calls).toEqual(["reserveCancellation"]);
    // …and no intermediate lease exists on the terminal row, so there is nothing
    // for a lapsed lease to reclaim later.
    const reserved = await w.claims.findByKey(executionIdempotencyKeyForAttempt(w.taskId, 1));
    expect(reserved?.state).toBe("CANCELLED");
    expect(reserved?.leaseExpiresAt).toBeUndefined();
    const recovery = await w.claims.recoveryFor(reserved!.id);
    expect(recovery?.kind).toBe("CANCELLED");
  });

  it("ROLLS BACK its reservations when another task cannot be resolved, so no task is poisoned", async () => {
    const w = await harness();
    await w.seedTask({ id: `${w.taskId}_a`, state: "READY", attempt: 0 });
    await w.seedTask({ id: `${w.taskId}_b`, state: "RUNNING", attempt: 1 });
    await w.unverifiedClaim({ taskId: `${w.taskId}_b`, attempt: 1 });

    const results = await w.service.cancelMissionAttempts({
      missionId: w.missionId,
      tasks: [
        { taskId: `${w.taskId}_a`, state: "READY" },
        { taskId: `${w.taskId}_b`, state: "RUNNING" },
      ],
      reason: "partial",
      authority: w.authority,
    });

    // Task B could not be resolved; the whole cancellation is reported unresolved.
    expect(results.find((row) => row.taskId === `${w.taskId}_b`)?.unresolved).toBe(true);
    const a = results.find((row) => row.taskId === `${w.taskId}_a`)?.[0];
    expect(results.find((row) => row.taskId === `${w.taskId}_a`)?.unresolved).toBe(true);
    expect(results.find((row) => row.taskId === `${w.taskId}_a`)?.detail).toMatch(/rolled back/);

    // …and A is NOT left terminally cancelled: its reservation was released, so a
    // later dispatch can still happen.
    const aClaim = await w.claims.findByKey(executionIdempotencyKeyForAttempt(`${w.taskId}_a`, 1));
    expect(aClaim?.state).toBe("RELEASED");

    // PROOF it is genuinely dispatchable again: the tool leg runs.
    const outcome = await w.service.execute(
      w.request({ taskId: `${w.taskId}_a`, attempt: 1, missionId: w.missionId }),
    );
    expect(outcome.kind).toBe("DISPATCHED");
    expect(w.handlerInputs).toHaveLength(1);
    void a;
  });

  it("refuses cancellation without a usable foreground authority", async () => {
    const w = await harness();
    await w.seedTask();

    // No authority at all.
    await expect(
      w.service.cancel({ runtimeId: w.runtimeId, handleId: "h" }, { reason: "x", authority: undefined as never }),
    ).rejects.toMatchObject({ code: "AUTHORITY_UNRESOLVED" });

    // A BACKGROUND (reconciliation) authority may observe and adopt; it may not cancel.
    await expect(
      w.service.cancel(
        { runtimeId: w.runtimeId, handleId: "h" },
        {
          reason: "x",
          authority: createExecutionAuthority({
            userId: "reconciler:sweep",
            origin: "RECONCILIATION",
            actorId: "system:sweep",
            actorSlug: "system-sweep",
            actorType: "SYSTEM",
            permissionTokens: [],
            accessibleBusinessSlugs: [],
            isSuperAdmin: false,
            hasOfficeFinanceFull: false,
            requestedAt: NOW,
          }),
        },
      ),
    ).rejects.toMatchObject({ code: "AUTHORITY_UNRESOLVED" });

    // An EXPIRED but otherwise valid authority is refused too.
    await expect(
      w.service.cancel(
        { runtimeId: w.runtimeId, handleId: "h" },
        {
          reason: "x",
          authority: createExecutionAuthority({
            userId: "user_stale",
            actorId: FOUNDER,
            actorSlug: "founder",
            actorType: "HUMAN",
            permissionTokens: ["aiworkforce.access"],
            accessibleBusinessSlugs: ["nexup"],
            isSuperAdmin: false,
            hasOfficeFinanceFull: false,
            requestedAt: "2026-04-01T00:00:00.000Z",
          }),
        },
      ),
    ).rejects.toMatchObject({ code: "AUTHORITY_UNRESOLVED" });
  });
});

/* ══════════════════════════════════════════════════════
   P1-3 — canonical authorization BEFORE claim classification
   ══════════════════════════════════════════════════════ */

describe("P1-3 — no claim classification is reachable by a non-canonical request", () => {
  it("creates NO claim row at all for a substituted request", async () => {
    const w = await harness();
    await w.seedTask();

    const outcome = await w.service.execute(w.request({ requiredCapabilityId: "proof.somewhere_else" }));
    expect(outcome.kind).toBe("DENIED");
    // The ledger was never touched, so REPLAYED / IN_PROGRESS / UNVERIFIED /
    // CANCELLED metadata could not be disclosed to this caller.
    expect(await w.claims.count()).toBe(0);
    expect(w.handlerInputs).toHaveLength(0);
  });

  it("still REPLAYS a legitimate retry of a task that has already reached a terminal state", async () => {
    const w = await harness();
    await w.seedTask();
    const first = await w.service.execute(w.request());
    expect(first.kind).toBe("DISPATCHED");

    // The attempt is finished and the task has moved on (a human accepted it).
    await w.seedTask({ state: "COMPLETED", attempt: 1 });

    const replay = await w.service.execute(w.request());
    expect(replay.kind).toBe("REPLAYED");
  });
});

/* ══════════════════════════════════════════════════════
   P1-2 — a timeout is NOT an outage
   ══════════════════════════════════════════════════════ */

describe("P1-2 — a typed RUNTIME_TIMEOUT stays a timeout", () => {
  it("reports TIMEOUT (not UNAVAILABLE) and leaves the attempt RUNNING and unsettled", async () => {
    const w = await harness({ actorRuntimeBound: true, runtime: timeoutRuntime("runtime_p1_timeout") });
    await w.seedTask({ requiredCapabilityId: w.runtimeCapabilityId });

    const dispatched = await w.service.execute(w.request({ requiredCapabilityId: w.runtimeCapabilityId }));
    expect(dispatched.kind).toBe("DISPATCHED");
    if (dispatched.kind !== "DISPATCHED") throw new Error("unreachable");

    // The observation itself: typed, with the runtime's own non-terminal state.
    const observation = await w.service.observe(
      { runtimeId: dispatched.runtimeId, handleId: dispatched.handleId, executionRecordId: dispatched.executionRecordId },
      { waitForTerminal: true, waitTimeoutMs: 5 },
    );
    expect(observation.kind).toBe("TIMEOUT");
    expect(observation.status).toBe("RUNNING");

    // …and through the orchestrator: BLOCKED with RUNTIME_TIMEOUT, nothing settled.
    await w.seedTask({
      state: "RUNNING",
      attempt: 1,
      requiredCapabilityId: w.runtimeCapabilityId,
      executionRecordId: dispatched.executionRecordId,
      executionHandleId: dispatched.handleId,
    });
    const settled = await w.orchestrator.settleTask(w.missionId, w.taskId, { waitTimeoutMs: 5 });
    expect(settled.blocked).toMatch(/RUNTIME_TIMEOUT/);
    expect(settled.state).toBe("RUNNING");

    // The record was NOT relabelled as a failure or an outage.
    const record = await w.domain.executionRecords.get(dispatched.executionRecordId);
    expect(record?.status).toBe("RUNNING");
  });
});

/* ══════════════════════════════════════════════════════
   P1-6 — the actor's own approval policy counts
   ══════════════════════════════════════════════════════ */

describe("P1-6 — actor RISK_AT_LEAST is applied, and an APPROVED record needs a timestamp", () => {
  it("requires approval at the ACTOR's threshold for an AUTOMATIC attempt, and still lets a manual human through", async () => {
    const w = await harness({ actorApproval: { mode: "RISK_AT_LEAST", minRiskLevel: "MEDIUM" } });
    await w.seedTask();

    // An AUTOMATIC (system-initiated) attempt: human presence is not the approval,
    // so the actor's MEDIUM threshold is what decides.
    const automatic = await w.service.execute(w.request({ source: "AUTOMATIC" }));
    expect(automatic.kind).toBe("WAIT_APPROVAL");
    expect(w.handlerInputs).toHaveLength(0);

    // The SAME attempt, manually triggered: presence IS the approval, exactly as
    // the platform policy says — the actor threshold does not remove that.
    const manual = await w.service.execute(w.request({ source: "MANUAL" }));
    expect(manual.kind).toBe("DISPATCHED");
    expect(w.handlerInputs).toHaveLength(1);
  });

  it("refuses an APPROVED record that carries no decision timestamp", async () => {
    const w = await harness({
      approvals: {
        async findForAttempt(binding) {
          return {
            id: "approval_no_timestamp",
            status: "APPROVED",
            toolId: binding.capabilityId,
            riskLevel: "MEDIUM",
            requestedByUserId: "user_operator",
            requestedForUserId: "user_operator",
            requestReason: "proof",
            createdAt: NOW,
            // decidedAt DELIBERATELY ABSENT: an approval that cannot say WHEN it
            // was decided cannot be bounded by any deadline.
            metadata: { bindingRef: approvalBindingRef(binding) },
          };
        },
      },
    });
    await w.seedTask();

    const outcome = await w.service.execute(w.request({ source: "AUTOMATIC" }));
    expect(outcome.kind).toBe("DENIED");
    if (outcome.kind !== "DENIED") throw new Error("unreachable");
    expect(outcome.message).toMatch(/no valid decision timestamp/);
    expect(w.handlerInputs).toHaveLength(0);
  });

  it("refuses an APPROVED record dated in the future", async () => {
    const w = await harness({
      approvals: {
        async findForAttempt(binding) {
          return {
            id: "approval_future",
            status: "APPROVED",
            toolId: binding.capabilityId,
            riskLevel: "MEDIUM",
            requestedByUserId: "user_operator",
            requestedForUserId: "user_operator",
            requestReason: "proof",
            createdAt: NOW,
            decidedAt: "2027-01-01T00:00:00.000Z",
            metadata: { bindingRef: approvalBindingRef(binding) },
          };
        },
      },
    });
    await w.seedTask();

    const outcome = await w.service.execute(w.request({ source: "AUTOMATIC" }));
    expect(outcome.kind).toBe("DENIED");
    if (outcome.kind !== "DENIED") throw new Error("unreachable");
    expect(outcome.message).toMatch(/future/);
  });
});

/* ══════════════════════════════════════════════════════
   P1-7 — the canonical envelope is immutable
   ══════════════════════════════════════════════════════ */

describe("P1-7 — caller mutation across awaited checks cannot change what executes", () => {
  it("executes the input the boundary captured, not the caller's mutated object", async () => {
    let releaseApproval: (() => void) | null = null;
    let enteredApproval: (() => void) | null = null;
    const approvalWindow = new Promise<void>((resolve) => {
      enteredApproval = resolve;
    });

    const w = await harness({
      approvals: {
        async findForAttempt() {
          if (!releaseApproval) {
            // Park the preflight inside an `await` — the window a caller would use.
            const gate = new Promise<void>((resolve) => {
              releaseApproval = resolve;
            });
            enteredApproval?.();
            await gate;
            return null;
          }
          return null;
        },
      },
    });
    // The durable task must carry the SAME canonical input, so the identity gate
    // passes and the execution actually reaches the approval check.
    await w.seedTask({ input: { instruction: "ORIGINAL" } });

    const request = w.request({ input: { instruction: "ORIGINAL" } });
    const pending = w.service.execute(request);
    await approvalWindow;

    // MUTATE the request the caller still holds, mid-flight.
    (request.input as Record<string, unknown>).instruction = "TAMPERED";
    (request.authority as { actorId: string }).actorId = "actor_someone_else";
    releaseApproval?.();

    const outcome = await pending;
    expect(outcome.kind).toBe("DISPATCHED");
    // The handler ran with the CAPTURED input.
    expect(w.handlerInputs).toHaveLength(1);
    expect((w.handlerInputs[0] as { instruction: string }).instruction).toBe("ORIGINAL");
    // …and the authorising identity on the durable receipt is the captured one.
    if (outcome.kind !== "DISPATCHED") throw new Error("unreachable");
    const claim = await w.claims.findByKey(executionIdempotencyKeyForAttempt(w.taskId, 1));
    const receipt = receiptFromClaimDetail(claim?.detail);
    expect(receipt?.operatorActorId).toBe("actor_human_operator");
  });
});

/* ══════════════════════════════════════════════════════
   P1-4 — recovery IS reachable from the application boundary
   ══════════════════════════════════════════════════════ */

describe("P1-4 — claim-first recovery runs through the application entry points", () => {
  async function wired(): Promise<{
    w: Awaited<ReturnType<typeof harness>>;
    commands: WorkforceCommandService;
    reconciler: ExecutionReconciler;
  }> {
    const w = await harness();
    const reconciler = new ExecutionReconciler({
      records: w.domain.executionRecords,
      executions: w.domain.executions,
      runtimes: w.domain.runtimes,
      missions: w.domain.missionRepository,
      tasks: w.domain.tasks,
      orchestrator: w.orchestrator,
      claims: w.claims,
      now: () => new Date(NOW),
    });
    const commands = new WorkforceCommandService({
      domain: w.domain,
      orchestrator: w.orchestrator,
      intents: new InMemoryCommandIntentRepository({ ids: createSequentialIdFactory("p1intents"), now: () => new Date(NOW) }),
      route: (task) => ({
        assignedActorId: task.assignedActorId ?? w.actorId,
        requiredCapabilityId: task.requiredCapabilityId ?? w.toolCapabilityId,
        requiredCapabilityVersion: "1.0.0",
      }),
      reconciler,
    });
    return { w, commands, reconciler };
  }

  it("finds an entered-but-unidentified attempt through reconcile(), reconcileInFlight() and drain()", async () => {
    const { w, commands } = await wired();
    await w.seedTask();
    // The crash window: DISPATCHING with NO execution record, task still READY.
    const claim = await w.unverifiedClaim({ taskId: w.taskId, attempt: 1 });
    expect(claim.state).toBe("UNVERIFIED");

    const viaReconcile = await commands.reconcile(w.missionId);
    expect(viaReconcile.some((row) => row.kind === "CLAIM_UNVERIFIED" && row.taskId === w.taskId)).toBe(true);

    const viaInFlight = await commands.reconcileInFlight();
    expect(viaInFlight.some((row) => row.kind === "CLAIM_UNVERIFIED")).toBe(true);

    const drained = await commands.drain(w.missionId);
    expect(drained.changes.some((change) => change.includes("CLAIM_UNVERIFIED"))).toBe(true);

    // NOTHING was redispatched and NO execution record was fabricated.
    expect(w.handlerInputs).toHaveLength(0);
    expect(await w.domain.executionRecords.listForMission(w.missionId)).toHaveLength(0);
    expect((await w.claims.findByKey(executionIdempotencyKeyForAttempt(w.taskId, 1)))?.state).toBe("UNVERIFIED");
  });

  it("keeps an UNVERIFIED incident DISCOVERABLE across repeated sweeps, and surfaces it as a read", async () => {
    const { w, commands, reconciler } = await wired();
    await w.seedTask();
    await w.unverifiedClaim({ taskId: w.taskId, attempt: 1 });

    // Sweep twice more: a later sweep asked only for DISPATCHING would lose it.
    await commands.reconcile(w.missionId);
    const third = await commands.reconcile(w.missionId);
    expect(third.some((row) => row.kind === "CLAIM_UNVERIFIED")).toBe(true);

    const incidents = await commands.claimIncidents(w.missionId);
    expect(incidents.map((row) => row.id)).toEqual([
      (await w.claims.findByKey(executionIdempotencyKeyForAttempt(w.taskId, 1)))!.id,
    ]);
    expect(incidents[0]!.state).toBe("UNVERIFIED");

    // The read is inert: it resolves nothing and dispatches nothing.
    const after = await reconciler.openClaimIncidents(w.missionId);
    expect(after).toHaveLength(1);
  });

  it("escalates a RUNNING crash claim to a human through a durable review", async () => {
    const { w, commands } = await wired();
    const record = await w.seedExecutionRecord({ taskId: w.taskId, attempt: 1, status: "RUNNING" });
    await w.seedTask({
      state: "RUNNING",
      attempt: 1,
      requiredCapabilityId: w.runtimeCapabilityId,
      executionRecordId: record.id,
      executionHandleId: record.handleId,
    });
    await w.unverifiedClaim({ taskId: w.taskId, attempt: 1 });

    await commands.reconcile(w.missionId);

    const reviews = await w.domain.reviews.listPending();
    expect(reviews).toHaveLength(1);
    expect(reviews[0]!.taskId).toBe(w.taskId);
    // The RUNNING task was parked for a human — never retried, never failed.
    const task = await w.domain.tasks.get(w.taskId);
    expect(task?.state).toBe("REVIEW");
  });
});

/* ══════════════════════════════════════════════════════
   R3 — recovery CAS, fair sweeps and mission scoping
   ══════════════════════════════════════════════════════ */

/**
 * The third review's recovery findings, in the in-memory reference (the durable
 * adapter is proved separately, against a real PostgreSQL):
 *
 *   R3-1  a LOSING `markUnverified` CAS was ignored. The sweep then escalated
 *         from a STALE SNAPSHOT — asking a human to resolve an attempt that a
 *         racing owner had already identified.
 *   R3-2  a mission-scoped sweep read the GLOBAL first page and filtered the
 *         mission afterwards, so a mission's own incident was invisible behind
 *         other missions' incidents; and a global sweep always re-read the oldest
 *         page, so permanent incidents starved newer ones.
 */

/** A ledger whose clock this test controls, so a lease can be lapsed on purpose. */
function mutableLedger(): { repo: InMemoryExecutionClaimRepository; advance: (ms: number) => void } {
  seq += 1;
  let current = Date.parse(NOW);
  const repo = new InMemoryExecutionClaimRepository({
    ids: createSequentialIdFactory(`r3${seq}`),
    now: () => new Date(current),
  });
  return {
    repo,
    advance: (ms) => {
      current += ms;
    },
  };
}

/**
 * The reference ledger with two hooks, so an interleaving can be produced
 * WITHOUT a sleep: the racing write happens synchronously inside the sweep's own
 * `markUnverified` call. Timing-free by construction — a sleep would make the
 * test a race against the machine rather than against the state machine.
 */
function hookLedger(
  inner: InMemoryExecutionClaimRepository,
  hooks: {
    beforeMarkUnverified?: (claimId: string) => Promise<void>;
    onListUnresolved?: (query: ExecutionClaimSweepQuery | undefined) => void;
  } = {},
): ExecutionClaimRepository {
  return {
    claim: (request) => inner.claim(request),
    get: (id) => inner.get(id),
    findByKey: (key) => inner.findByKey(key),
    listForTask: (taskId) => inner.listForTask(taskId),
    listDispatching: (limit) => inner.listDispatching(limit),
    listUnresolved: (query) => {
      hooks.onListUnresolved?.(query);
      return inner.listUnresolved(query);
    },
    markDispatching: (id, input) => inner.markDispatching(id, input),
    markDispatched: (id, input) => inner.markDispatched(id, input),
    release: (id, input) => inner.release(id, input),
    markCancelled: (id, input) => inner.markCancelled(id, input),
    markUnverified: async (id, detail) => {
      if (hooks.beforeMarkUnverified) await hooks.beforeMarkUnverified(id);
      return inner.markUnverified(id, detail);
    },
    markRecoverySwept: (id) => inner.markRecoverySwept(id),
    reserveCancellation: (request) => inner.reserveCancellation(request),
    rollbackCancellation: (id, input) => inner.rollbackCancellation(id, input),
    recoveryFor: (id, options) => inner.recoveryFor(id, options),
    count: () => inner.count(),
  };
}

/** A claim that entered dispatch and never recorded a handle, with a LAPSED lease. */
async function lapsedDispatchingClaim(
  ledger: { repo: InMemoryExecutionClaimRepository; advance: (ms: number) => void },
  input: { missionId: string; taskId: string; attempt: number; leaseOwner: string },
): Promise<ExecutionClaim> {
  const claimed = await ledger.repo.claim({
    missionId: input.missionId,
    taskId: input.taskId,
    attempt: input.attempt,
    idempotencyKey: executionIdempotencyKeyForAttempt(input.taskId, input.attempt),
    actorId: FOUNDER,
    capabilityId: "proof.r3",
    runtimeId: "runtime_r3",
    leaseOwner: input.leaseOwner,
    leaseTtlMs: 1_000,
  });
  if (claimed.kind !== "CLAIMED") throw new Error(`expected CLAIMED, got ${claimed.kind}`);
  const entered = await ledger.repo.markDispatching(claimed.claim.id, {
    invocationToken: input.leaseOwner,
    leaseTtlMs: 1_000,
  });
  if (!entered) throw new Error("expected DISPATCHING");
  // Lapse it on the LEDGER's own clock — never by sleeping.
  ledger.advance(2_000);
  return entered;
}

/** A claim that was entered and recorded as doubted, durably. */
async function unresolvedClaim(
  ledger: { repo: InMemoryExecutionClaimRepository; advance: (ms: number) => void },
  input: { missionId: string; taskId: string; attempt: number },
): Promise<ExecutionClaim> {
  const entered = await lapsedDispatchingClaim(ledger, { ...input, leaseOwner: `tok_r3_${input.taskId}` });
  const doubted = await ledger.repo.markUnverified(entered.id, "dispatch was entered and the process died");
  if (!doubted) throw new Error("expected UNVERIFIED");
  return doubted;
}

describe("R3-1 — a losing recovery CAS never escalates from a stale snapshot", () => {
  /** The reconciler and harness for a RUNNING task whose claim is doubtful. */
  async function wired(ledger: { repo: InMemoryExecutionClaimRepository; advance: (ms: number) => void }, claims: ExecutionClaimRepository) {
    const w = await harness();
    const record = await w.seedExecutionRecord({ taskId: w.taskId, attempt: 1, status: "RUNNING" });
    await w.seedTask({
      state: "RUNNING",
      attempt: 1,
      requiredCapabilityId: w.runtimeCapabilityId,
      executionRecordId: record.id,
      executionHandleId: record.handleId,
    });
    const reconciler = new ExecutionReconciler({
      records: w.domain.executionRecords,
      executions: w.domain.executions,
      runtimes: w.domain.runtimes,
      missions: w.domain.missionRepository,
      tasks: w.domain.tasks,
      orchestrator: w.orchestrator,
      claims,
      now: () => new Date(NOW),
    });
    return { w, reconciler, record, ledger };
  }

  it("follows the authoritative row when the claim-first CAS loses to a finalising owner", async () => {
    const ledger = mutableLedger();
    const claims = hookLedger(ledger.repo, {
      // THE RACE, made deterministic: the owner records the real execution
      // identity immediately before the sweep's own CAS runs, so the sweep's
      // `markUnverified` necessarily loses.
      beforeMarkUnverified: async (claimId) => {
        const dispatched = await ledger.repo.markDispatched(claimId, {
          invocationToken: "tok_r3_race",
          executionRecordId: "record_r3_race",
          handleId: "handle_r3_race",
          runtimeId: "runtime_r3",
        });
        if (!dispatched) throw new Error("the racing owner must win");
      },
    });
    const { w, reconciler } = await wired(ledger, claims);
    await lapsedDispatchingClaim(ledger, { missionId: w.missionId, taskId: w.taskId, attempt: 1, leaseOwner: "tok_r3_race" });

    const results = await reconciler.reconcileDispatchingClaims();

    // NOT an incident: the ledger names a real execution, so there is nothing for
    // a human to resolve and nothing to escalate.
    expect(results.some((row) => row.kind === "CLAIM_UNVERIFIED")).toBe(false);
    expect(await w.domain.reviews.listPending()).toHaveLength(0);
    // …and the racing owner's identity is intact, not overwritten by a doubt.
    const claim = await ledger.repo.findByKey(executionIdempotencyKeyForAttempt(w.taskId, 1));
    expect(claim?.state).toBe("DISPATCHED");
    expect(claim?.handleId).toBe("handle_r3_race");
  });

  it("follows the authoritative row when the record-first CAS loses to a finalising owner", async () => {
    const ledger = mutableLedger();
    const w0 = await harness();
    const record = await w0.seedExecutionRecord({ taskId: w0.taskId, attempt: 1, status: "ACCEPTED" });
    await w0.seedTask({
      state: "RUNNING",
      attempt: 1,
      requiredCapabilityId: w0.runtimeCapabilityId,
      executionRecordId: record.id,
      executionHandleId: record.handleId,
    });
    const claims = hookLedger(ledger.repo, {
      // The winner finalises the SAME record this pass is reconciling, which is
      // exactly the `record`-first interleaving: the pass must treat it as
      // ordinary adoption rather than as doubt.
      beforeMarkUnverified: async (claimId) => {
        const dispatched = await ledger.repo.markDispatched(claimId, {
          invocationToken: "tok_r3_record_race",
          executionRecordId: record.id,
          handleId: record.handleId,
          runtimeId: "runtime_r3",
        });
        if (!dispatched) throw new Error("the racing owner must win");
      },
    });
    const reconciler = new ExecutionReconciler({
      records: w0.domain.executionRecords,
      executions: w0.domain.executions,
      runtimes: w0.domain.runtimes,
      missions: w0.domain.missionRepository,
      tasks: w0.domain.tasks,
      orchestrator: w0.orchestrator,
      claims,
      now: () => new Date(NOW),
    });
    await lapsedDispatchingClaim(ledger, {
      missionId: w0.missionId,
      taskId: w0.taskId,
      attempt: 1,
      leaseOwner: "tok_r3_record_race",
    });

    const results = await reconciler.reconcileInFlight();

    expect(results.some((row) => row.kind === "CLAIM_UNVERIFIED")).toBe(false);
    expect(await w0.domain.reviews.listPending()).toHaveLength(0);
    // The pass falls through to the RUNTIME question, which is a truthful
    // "cannot observe this here" — not a manufactured human incident.
    expect(results.map((row) => row.kind)).toContain("NO_RUNTIME");
  });

  it("escalates from the AUTHORITATIVE doubt when the CAS loses to a concurrent doubter", async () => {
    const ledger = mutableLedger();
    const w0 = await harness();
    const record = await w0.seedExecutionRecord({ taskId: w0.taskId, attempt: 1, status: "ACCEPTED" });
    await w0.seedTask({
      state: "RUNNING",
      attempt: 1,
      requiredCapabilityId: w0.runtimeCapabilityId,
      executionRecordId: record.id,
      executionHandleId: record.handleId,
    });
    const claims = hookLedger(ledger.repo, {
      // A CONCURRENT sweep got there first and recorded the doubt durably. The
      // loser's CAS returns null, and the outcome is an escalation — but from the
      // row the ledger holds, which is the «still unverified» condition that
      // permits escalation.
      beforeMarkUnverified: async (claimId) => {
        const doubted = await ledger.repo.markUnverified(claimId, "a concurrent sweep recorded this first");
        if (!doubted) throw new Error("the concurrent sweep must win");
      },
    });
    const reconciler = new ExecutionReconciler({
      records: w0.domain.executionRecords,
      executions: w0.domain.executions,
      runtimes: w0.domain.runtimes,
      missions: w0.domain.missionRepository,
      tasks: w0.domain.tasks,
      orchestrator: w0.orchestrator,
      claims,
      now: () => new Date(NOW),
    });
    await lapsedDispatchingClaim(ledger, { missionId: w0.missionId, taskId: w0.taskId, attempt: 1, leaseOwner: "tok_r3_doubt" });

    const results = await reconciler.reconcileInFlight();

    const incident = results.find((row) => row.kind === "CLAIM_UNVERIFIED");
    expect(incident).toBeDefined();
    // The reason reported is the DURABLE one, not this sweep's own sentence.
    expect(incident!.detail).toContain("a concurrent sweep recorded this first");
    expect(await w0.domain.reviews.listPending()).toHaveLength(1);
  });

  it("treats a winner that identified a DIFFERENT execution as adoption, not doubt", async () => {
    const ledger = mutableLedger();
    const w0 = await harness();
    const record = await w0.seedExecutionRecord({ taskId: w0.taskId, attempt: 1, status: "ACCEPTED" });
    await w0.seedTask({
      state: "RUNNING",
      attempt: 1,
      requiredCapabilityId: w0.runtimeCapabilityId,
      executionRecordId: record.id,
      executionHandleId: record.handleId,
    });
    const claims = hookLedger(ledger.repo, {
      beforeMarkUnverified: async (claimId) => {
        const dispatched = await ledger.repo.markDispatched(claimId, {
          invocationToken: "tok_r3_other",
          executionRecordId: "record_r3_someone_else",
          handleId: "handle_r3_someone_else",
          runtimeId: "runtime_r3",
        });
        if (!dispatched) throw new Error("the racing owner must win");
      },
    });
    const reconciler = new ExecutionReconciler({
      records: w0.domain.executionRecords,
      executions: w0.domain.executions,
      runtimes: w0.domain.runtimes,
      missions: w0.domain.missionRepository,
      tasks: w0.domain.tasks,
      orchestrator: w0.orchestrator,
      claims,
      now: () => new Date(NOW),
    });
    await lapsedDispatchingClaim(ledger, { missionId: w0.missionId, taskId: w0.taskId, attempt: 1, leaseOwner: "tok_r3_other" });

    const results = await reconciler.reconcileInFlight();

    // The ledger identifies an execution, so this is ordinary adoption: no doubt,
    // no human incident — and the sweep must never overwrite a REAL identity with
    // its own recorded doubt.
    expect(results.some((row) => row.kind === "CLAIM_UNVERIFIED")).toBe(false);
    expect(await w0.domain.reviews.listPending()).toHaveLength(0);
    const claim = await ledger.repo.findByKey(executionIdempotencyKeyForAttempt(w0.taskId, 1));
    expect(claim?.state).toBe("DISPATCHED");
    expect(claim?.executionRecordId).toBe("record_r3_someone_else");
  });
});

describe("R3-2 — recovery is mission-scoped and sweeps make fair progress", () => {
  function reconcilerFor(w: Awaited<ReturnType<typeof harness>>, claims: ExecutionClaimRepository): ExecutionReconciler {
    return new ExecutionReconciler({
      records: w.domain.executionRecords,
      executions: w.domain.executions,
      runtimes: w.domain.runtimes,
      missions: w.domain.missionRepository,
      tasks: w.domain.tasks,
      orchestrator: w.orchestrator,
      claims,
      now: () => new Date(NOW),
    });
  }

  it("recovers a mission's own incident that sits beyond the first global page", async () => {
    const ledger = mutableLedger();
    const queries: Array<ExecutionClaimSweepQuery | undefined> = [];
    const claims = hookLedger(ledger.repo, { onListUnresolved: (query) => queries.push(query) });
    const w = await harness();

    // 60 incidents of OTHER missions sort ahead of this mission's single one.
    for (let index = 0; index < 60; index += 1) {
      await unresolvedClaim(ledger, { missionId: `mission_r3_other_${index}`, taskId: `task_r3_other_${index}`, attempt: 1 });
      ledger.advance(1_000);
    }
    await unresolvedClaim(ledger, { missionId: w.missionId, taskId: w.taskId, attempt: 1 });

    const reconciler = reconcilerFor(w, claims);
    const scoped = await reconciler.reconcileMission(w.missionId);

    // Found — which is only possible because the mission filter travelled in the
    // QUERY. Read-and-filter-in-the-caller would have returned page one (60 other
    // missions) and found nothing here.
    expect(scoped.filter((row) => row.kind === "CLAIM_UNVERIFIED")).toHaveLength(1);
    expect(queries.some((query) => query?.missionId === w.missionId)).toBe(true);

    // The operator READ is scoped the same way, so an incident is visible without
    // having to run a sweep and hope it lands on the right page.
    const incidents = await reconciler.openClaimIncidents(w.missionId);
    expect(incidents).toHaveLength(1);
    expect(incidents[0]!.taskId).toBe(w.taskId);
  });

  it("sweeps the ledger in DURABLE ROTATION — successive sweeps reach the rows in between", async () => {
    const ledger = mutableLedger();
    const w = await harness();
    // 120 rows, so ONE sweep cannot cover the ledger: a sweep reads one bounded
    // window of EACH of three DISJOINT lanes (Step 5A-4, sixth review) — the 25
    // OLDEST rows no sweep has observed, the 20 least recently observed rows, and the
    // 5 NEWEST unobserved rows, 50 rows in total, and never arranged so that one lane
    // can spend another's share. A row strictly in the middle of the ledger — in this
    // shape rows 50..69 — is therefore NOT in the first sweep's answer, and the review
    // was right to insist that be stated rather than papered over with a bigger
    // budget.
    //
    // What has to hold is the durable part: the sweep STAMPED what it looked at, so
    // the next sweep's UNSEEN window starts where this one stopped — and because the
    // windows are DISJOINT, it is that window which carries the backlog forward,
    // rather than the same page being re-served forever.
    const TOTAL = 120;
    for (let index = 0; index < TOTAL; index += 1) {
      await unresolvedClaim(ledger, { missionId: `mission_r3_bulk_${index}`, taskId: `task_r3_bulk_${index}`, attempt: 1 });
      ledger.advance(1_000);
    }

    // A BRAND-NEW reconciler for every sweep: nothing carries over except the
    // ledger, which is the whole claim being made here.
    const sweep = async () =>
      new Set((await reconcilerFor(w, ledger.repo).reconcileDispatchingClaims()).map((row) => row.taskId));

    const first = await sweep();
    // Both ends of the UNSEEN ledger are in ONE bounded answer —
    expect(first.has("task_r3_bulk_0")).toBe(true);
    expect(first.has(`task_r3_bulk_${TOTAL - 1}`)).toBe(true);
    // — the sweep is BOUNDED, and by ALLOCATION rather than by hope: nothing has
    // been observed yet, so the answer is exactly the 25 oldest unseen rows plus the
    // 5 newest unseen ones —
    expect(first.size).toBe(30);
    // — and the middle rows are honestly NOT claimed by it.
    expect(first.has("task_r3_bulk_60")).toBe(false);

    // The middle arrives because the ROWS carry the progress, not the process: a
    // brand-new reconciler (a restart, a second instance, or simply the next call)
    // continues the walk instead of re-serving its first window.
    const second = await sweep();
    expect(second.has("task_r3_bulk_25")).toBe(true);
    expect(second.has("task_r3_bulk_50")).toBe(false);

    // AND THE GUARANTEE ITSELF: five sweeps cover every unresolved row in the
    // ledger — the middle included — with no cursor anywhere to lose. 25 unseen rows
    // per sweep over 120 rows is ceil(120 / 25) = 5 sweeps.
    const visited = new Set([...first, ...second]);
    for (let sweepNumber = 0; sweepNumber < 5; sweepNumber += 1) {
      for (const id of await sweep()) visited.add(id);
    }
    for (let index = 0; index < TOTAL; index += 1) {
      expect(visited.has(`task_r3_bulk_${index}`)).toBe(true);
    }

    // Nothing was redispatched and no execution record was fabricated to fill the
    // gap: the sweep only ever records doubt.
    expect(await w.domain.executionRecords.list()).toHaveLength(0);
    expect(await ledger.repo.listDispatching()).toHaveLength(0);
  });

  it("never starves a newer incident behind a backlog of permanent ones", async () => {
    const ledger = mutableLedger();
    const w = await harness();
    // More than one sweep's page budget, so the ASCENDING walk cannot finish and
    // the newest-end probe is what guarantees the fresh incident is seen.
    for (let index = 0; index < 700; index += 1) {
      await unresolvedClaim(ledger, { missionId: `mission_r3_backlog_${index}`, taskId: `task_r3_backlog_${index}`, attempt: 1 });
      ledger.advance(1_000);
    }
    await unresolvedClaim(ledger, { missionId: w.missionId, taskId: w.taskId, attempt: 1 });

    const results = await reconcilerFor(w, ledger.repo).reconcileInFlight();
    const taskIds = results.map((row) => row.taskId);

    // The newest incident is seen…
    expect(taskIds).toContain(w.taskId);
    // …while the oldest permanent incidents stay visible rather than being
    // rotated out: both ends of the ledger are in one sweep's answer.
    expect(taskIds).toContain("task_r3_backlog_0");
    // and the sweep is BOUNDED, not an unbounded scan of the whole ledger.
    expect(results.length).toBeLessThan(701);
  });
});

/* ══════════════════════════════════════════════════════
   R4 — DURABLE recovery progress (fifth review)
   ══════════════════════════════════════════════════════ */

/**
 * The FOURTH review's P1, corrected a second time, in the in-memory REFERENCE
 * ledger (the same guarantee is proved against a real PostgreSQL by
 * `tests/workforce-step5a4-recovery-evidence.test.ts`):
 *
 *   R4-1  the cursor lived only for the CALL (`let after` inside
 *         `collectUnresolved`), so every sweep re-read the same oldest 600 rows and
 *         probed the newest 50: with permanent incidents and continued arrivals the
 *         rows in between were never visited — reproduced as 700 permanent
 *         unresolved claims, target row 625, 60 new claims before each sweep.
 *
 * The first correction gave each scope a cursor that survived the call — in PROCESS
 * MEMORY, bounded by an LRU of 64 scopes. The FIFTH review rejected that, and
 * correctly: a restart began every scope again at the oldest end, a 65th active
 * mission evicted an earlier scope, and two instances could not see each other's
 * progress at all. "Progress" was really "repeated work whose repetition nobody
 * bounds".
 *
 * The traversal is therefore no longer a cursor. It is a property of the LEDGER —
 * the least recently SWEPT unresolved row first — and every sweep stamps what it
 * looked at (`markRecoverySwept`). These cases pin what that buys: the review's own
 * scenario, a RESTART, a SECOND INSTANCE, and 70 mission scopes with no state to
 * evict.
 */

describe("R4 — durable recovery progress survives restart, instances and scope count", () => {
  /** The sweep's budget, mirrored from the module. */
  const PAGE = 50;
  /**
   * The UNSEEN window's share of it: `sweepLanes(50).unseen`. The bound arithmetic
   * below is expressed in this number, because this is the window the never-observed
   * backlog is drained through.
   */
  const UNSEEN_QUOTA = 25;

  function reconcilerFor(
    w: Awaited<ReturnType<typeof harness>>,
    claims: ExecutionClaimRepository,
  ): ExecutionReconciler {
    return new ExecutionReconciler({
      records: w.domain.executionRecords,
      executions: w.domain.executions,
      runtimes: w.domain.runtimes,
      missions: w.domain.missionRepository,
      tasks: w.domain.tasks,
      orchestrator: w.orchestrator,
      claims,
      now: () => new Date(NOW),
    });
  }

  it("reaches the row 625 target across sweeps despite 60 arrivals before each — globally and within one mission", async () => {
    const PERMANENT = 700;
    const TARGET_INDEX = 624; // row 625, 1-based — the review's target
    const ARRIVALS = 60;
    // The UNSEEN window takes UNSEEN_QUOTA rows per sweep, oldest first, so reaching
    // row 625 costs ceil(625 / 25) = 25 sweeps. One extra sweep of slack — and
    // nothing about the ARRIVALS enters the arithmetic: they are never-observed rows,
    // they are NEWER than every row already in the ledger, so they queue behind it in
    // this window (and are visible immediately through the NEWEST one).
    const JUSTIFIED_BOUND = Math.ceil((TARGET_INDEX + 1) / UNSEEN_QUOTA) + 1;

    // ── GLOBAL: the permanent incidents belong to many missions ──
    const ledger = mutableLedger();
    const w = await harness();
    for (let index = 0; index < PERMANENT; index += 1) {
      await unresolvedClaim(ledger, {
        missionId: `mission_r4_global_${index}`,
        taskId: `task_r4_global_${index}`,
        attempt: 1,
      });
      ledger.advance(1_000);
    }
    const reconciler = reconcilerFor(w, ledger.repo);
    const target = `task_r4_global_${TARGET_INDEX}`;
    const observed = new Set<string>();
    let arrivalsObserved = 0;
    let found = false;
    let sweeps = 0;

    while (sweeps < JUSTIFIED_BOUND + 3 && !found) {
      sweeps += 1;
      // 60 NEW claims BEFORE each successive sweep, exactly as reproduced.
      for (let index = 0; index < ARRIVALS; index += 1) {
        await unresolvedClaim(ledger, {
          missionId: `mission_r4_arrival_${sweeps}_${index}`,
          taskId: `task_r4_arrival_${sweeps}_${index}`,
          attempt: 1,
        });
        ledger.advance(1_000);
      }
      for (const row of await reconciler.reconcileInFlight()) {
        if (row.taskId) {
          observed.add(row.taskId);
          if (row.taskId === target) found = true;
          if (row.taskId.startsWith("task_r4_arrival_")) arrivalsObserved += 1;
        }
      }
    }

    expect(found).toBe(true);
    expect(sweeps).toBeLessThanOrEqual(JUSTIFIED_BOUND);
    // THE WALK, NOT A PROBE: every original row BEFORE the target was observed on
    // the way. A newest-end probe cannot produce this, and neither can a cursor that
    // resets — a reset would re-read rows 0..49 forever and never reach 625.
    for (let index = 0; index <= TARGET_INDEX; index += 1) {
      expect(observed.has(`task_r4_global_${index}`)).toBe(true);
    }
    // Arrivals are not starved either: the NEWEST window keeps the newest unseen rows
    // visible while the UNSEEN window eats the backlog — and it is a real allocation,
    // not a share of the backlog's.
    expect(arrivalsObserved).toBeGreaterThan(0);
    // The three windows are the WHOLE budget, and each one is real: 25 unseen rows,
    // 20 revisited rows, 5 newest unseen rows.
    expect(UNSEEN_QUOTA + 20 + 5).toBe(PAGE);

    // ── ONE MISSION: the same 700 rows, the same arrivals, all inside ONE mission ──
    const scopedLedger = mutableLedger();
    const missionId = "mission_r4_single";
    for (let index = 0; index < PERMANENT; index += 1) {
      await unresolvedClaim(scopedLedger, { missionId, taskId: `task_r4_single_${index}`, attempt: 1 });
      scopedLedger.advance(1_000);
    }
    const scopedReconciler = reconcilerFor(w, scopedLedger.repo);
    const scopedTarget = `task_r4_single_${TARGET_INDEX}`;
    let scopedFound = false;
    let scopedSweeps = 0;
    while (scopedSweeps < JUSTIFIED_BOUND + 3 && !scopedFound) {
      scopedSweeps += 1;
      for (let index = 0; index < ARRIVALS; index += 1) {
        await unresolvedClaim(scopedLedger, {
          missionId,
          taskId: `task_r4_single_arrival_${scopedSweeps}_${index}`,
          attempt: 1,
        });
        scopedLedger.advance(1_000);
      }
      for (const row of await scopedReconciler.reconcileMission(missionId)) {
        if (row.taskId === scopedTarget) scopedFound = true;
      }
    }
    expect(scopedFound).toBe(true);
    expect(scopedSweeps).toBeLessThanOrEqual(JUSTIFIED_BOUND);

    // The durable queue can be READ, and it says where the next sweep starts: the
    // least recently swept row of this mission, which is past the target because the
    // walk is at the newest end of the original backlog.
    const queue = await scopedReconciler.recoveryQueue(missionId);
    expect(queue.head).not.toBeNull();
    expect(queue.head!.taskId).not.toBe(scopedTarget);
    expect(queue.missionId).toBe(missionId);
    expect(queue.pageSize).toBe(PAGE);
    // The page's split is readable, because the tests (and an operator) depend on it:
    // 25 unseen, 20 revisit, 5 newest.
    expect(queue.lanes).toEqual({ unseen: UNSEEN_QUOTA, revisit: 20, newest: 5 });
  });

  it("keeps its progress in the LEDGER: a brand-new reconciler continues instead of starting over", async () => {
    const missionId = "mission_r4_restart";
    const TOTAL = 700;
    const ledger = mutableLedger();
    const w = await harness();
    for (let index = 0; index < TOTAL; index += 1) {
      await unresolvedClaim(ledger, { missionId, taskId: `task_r4_restart_${index}`, attempt: 1 });
      ledger.advance(1_000);
    }

    // Process A sweeps once: its UNSEEN window is the 25 oldest rows (0..24), its
    // NEWEST window the 5 newest (695..699), and nothing has been observed yet, so
    // its REVISIT window is empty — the allocation is visible in the answer.
    const a = reconcilerFor(w, ledger.repo);
    const first = new Set((await a.reconcileMission(missionId)).map((row) => row.taskId));
    expect(first.has("task_r4_restart_0")).toBe(true);
    expect(first.has("task_r4_restart_24")).toBe(true);
    expect(first.has("task_r4_restart_25")).toBe(false);
    expect(first.has("task_r4_restart_699")).toBe(true);
    expect(first.size).toBe(UNSEEN_QUOTA + 5);

    // Process B is a RESTART: a different object, in a different "process", with no
    // shared memory of any kind. It must CONTINUE, not begin again — and "continue"
    // means the UNSEEN window has moved on to the NEXT 25 rows, which is the window
    // the backlog is drained through.
    const b = reconcilerFor(w, ledger.repo);
    const second = new Set((await b.reconcileMission(missionId)).map((row) => row.taskId));
    expect(second.has("task_r4_restart_25")).toBe(true);
    expect(second.has("task_r4_restart_49")).toBe(true);
    expect(second.has("task_r4_restart_50")).toBe(false);
    // The rows the first sweep looked at come back through the REVISIT window, which
    // is a bounded round-robin over rows already observed — not a restart of the
    // UNSEEN walk. (A row being re-served is the design; that the backlog window
    // moved is the property.)
    expect(second.has("task_r4_restart_0")).toBe(true);

    // TWO INSTANCES AT ONCE: neither can lose a row to the other, because they read
    // the same windows. Both read the next 25 unseen rows, so the UNION covers them —
    // and the rows they both read are simply read twice, never skipped.
    const c = reconcilerFor(w, ledger.repo);
    const d = reconcilerFor(w, ledger.repo);
    const [left, right] = await Promise.all([c.reconcileMission(missionId), d.reconcileMission(missionId)]);
    const union = new Set([...left, ...right].map((row) => row.taskId));
    for (let index = 50; index <= 74; index += 1) {
      expect(union.has(`task_r4_restart_${index}`)).toBe(true);
    }
    expect(union.has("task_r4_restart_75")).toBe(false);

    // …and the UNSEEN window has moved on AGAIN: a FIFTH sweep takes the next 25 rows
    // rather than re-serving the front the racing pair covered.
    const e = reconcilerFor(w, ledger.repo);
    const fifth = new Set((await e.reconcileMission(missionId)).map((row) => row.taskId));
    for (let index = 75; index <= 99; index += 1) {
      expect(fifth.has(`task_r4_restart_${index}`)).toBe(true);
    }
    expect(fifth.has("task_r4_restart_100")).toBe(false);
  });

  it("holds NO per-scope state: 70 mission scopes are all reached, and the first is not evicted", async () => {
    const ledger = mutableLedger();
    const w = await harness();
    const MISSIONS = 70;
    for (let mission = 0; mission < MISSIONS; mission += 1) {
      for (let index = 0; index < 3; index += 1) {
        await unresolvedClaim(ledger, {
          missionId: `mission_r4_scope_${mission}`,
          taskId: `task_r4_scope_${mission}_${index}`,
          attempt: 1,
        });
        ledger.advance(1_000);
      }
    }

    // ONE reconciler sweeps all 70 scopes, with the GLOBAL sweep INTERLEAVED — the
    // arrangement that used to evict the least recently used scope from a 64-entry
    // map.
    const reconciler = reconcilerFor(w, ledger.repo);
    for (let mission = 0; mission < MISSIONS; mission += 1) {
      const scoped = await reconciler.reconcileMission(`mission_r4_scope_${mission}`);
      expect(scoped.filter((row) => row.kind === "CLAIM_UNVERIFIED")).toHaveLength(3);
      if (mission % 5 === 0) await reconciler.reconcileInFlight();
    }

    // The FIRST mission is still exactly where it was: there is no LRU, so "swept
    // long ago" cannot mean "forgotten".
    const again = await reconciler.reconcileMission("mission_r4_scope_0");
    expect(again.filter((row) => row.kind === "CLAIM_UNVERIFIED")).toHaveLength(3);

    // And a process that has never swept anything sees the same queue: the progress
    // was never in the process to begin with.
    const fresh = reconcilerFor(w, ledger.repo);
    const queue = await fresh.recoveryQueue("mission_r4_scope_0");
    expect(queue.head?.taskId).toBe("task_r4_scope_0_0");
    // The other end is a DIFFERENT read: the newest unresolved row, which the
    // freshness page keeps visible whatever the rotation is doing.
    expect(queue.newest?.taskId).toBe("task_r4_scope_0_2");
  });
});

/* ══════════════════════════════════════════════════════
   R5 — the fifth review, in the in-memory REFERENCE ledger
   ══════════════════════════════════════════════════════ */

/**
 * The same two findings the durable proof covers (sections VI and VII of
 * `workforce-step5a4-recovery-evidence.test.ts`), pinned here so the REFERENCE
 * implementation is held to them as well — the durable adapter and the in-memory
 * ledger must not be able to disagree about what "fair" or "observed" means.
 *
 *   R5-1  the CONCURRENT WRAP. A sweep used to keep its position in a mutable
 *         per-scope cursor that every sweep ADVANCED and WRAPPED. Three
 *         overlapping sweeps could interleave so the OLDEST wrote LAST and cleared
 *         the newer sweeps' progress. Scripted here with no timing at all.
 *   R5-2  RECORD-FIRST recovery read a page and then dropped the terminal rows, so
 *         50 newer finished attempts could hide an older open one — and a scope
 *         with more eligible attempts than one page was never walked fairly.
 */
describe("R5 — durable rotation progress and record-first recovery (reference ledger)", () => {
  function reconcilerFor(
    w: Awaited<ReturnType<typeof harness>>,
    claims: ExecutionClaimRepository,
  ): ExecutionReconciler {
    return new ExecutionReconciler({
      records: w.domain.executionRecords,
      executions: w.domain.executions,
      runtimes: w.domain.runtimes,
      missions: w.domain.missionRepository,
      tasks: w.domain.tasks,
      orchestrator: w.orchestrator,
      claims,
      now: () => new Date(NOW),
    });
  }

  it("R5-1: a stale sweep writing LAST cannot clear, rewind or lose newer progress", async () => {
    const ledger = mutableLedger();
    const repo = ledger.repo;
    const missionId = "mission_r5_rotation";
    const TOTAL = 200; // more than one page, so a page CANNOT be the whole scope
    for (let index = 0; index < TOTAL; index += 1) {
      await unresolvedClaim(ledger, { missionId, taskId: `task_r5_${index}`, attempt: 1 });
      ledger.advance(1_000);
    }

    /**
     * Exactly what ONE sweep observes: one bounded window of each of the three
     * DISJOINT lanes (Step 5A-4, sixth review). Composed from the same repository
     * reads the sweep itself makes, so this helper cannot describe a shape the sweep
     * does not use.
     */
    const pageIds = async (): Promise<string[]> => {
      // The three lane quotas of a 50-row budget: 25 unseen, 20 revisit, 5 newest.
      const windows = [
        await repo.listUnresolved({ missionId, limit: 25, lane: "NEVER_OBSERVED" }),
        await repo.listUnresolved({ missionId, limit: 20, lane: "PREVIOUSLY_OBSERVED" }),
        await repo.listUnresolved({ missionId, limit: 5, lane: "NEVER_OBSERVED_NEWEST" }),
      ];
      const ids: string[] = [];
      for (const row of windows.flat()) if (!ids.includes(row.id)) ids.push(row.id);
      return ids;
    };
    /** What a sweep WRITES: one stamp per row it looked at, and nothing else. */
    const stamp = async (ids: readonly string[]): Promise<void> => {
      for (const id of ids) await repo.markRecoverySwept(id);
    };
    const queue = () => repo.listUnresolved({ missionId, limit: TOTAL, order: "LEAST_RECENTLY_SWEPT_FIRST" });
    const stampsOf = async (ids: readonly string[]) =>
      Object.fromEntries(
        await Promise.all(ids.map(async (id) => [id, (await repo.get(id))?.recoverySweptAt ?? null] as const)),
      );

    // ── the three-sweep interleaving: A reads, B and C COMPLETE, then A writes ──
    const aRead = await pageIds();
    const bRead = await pageIds();
    await stamp(bRead);
    const cRead = await pageIds();
    await stamp(cRead);
    const frontBefore = (await queue()).slice(0, 50).map((row) => row.id);
    const bStampsBefore = await stampsOf(bRead);
    await stamp(aRead); // the OLDEST sweep's write lands LAST
    const frontAfter = (await queue()).slice(0, 50).map((row) => row.id);
    const bStampsAfter = await stampsOf(bRead);

    // THE QUEUE DID NOT REWIND: A read the OLDEST rows of an unswept scope, so
    // nothing of A's is at the front — and the front is IDENTICAL before and after
    // its late write. Under the old design this is exactly the write that cleared
    // the newer sweeps' cursor and put the scope back at the rows it had read.
    expect(frontBefore.some((id) => aRead.includes(id))).toBe(false);
    expect(frontAfter).toEqual(frontBefore);

    // Nothing was CLEARED, and nothing went BACKWARDS: a re-stamp can only move a
    // row FORWARD in the queue (it was observed again), never to "never swept".
    for (const id of aRead) expect((await repo.get(id))?.recoverySweptAt).toBeTruthy();
    for (const [id, before] of Object.entries(bStampsBefore)) {
      expect(before).not.toBeNull();
      expect(bStampsAfter[id] ?? null).not.toBeNull();
      expect((bStampsAfter[id] as string) >= (before as string)).toBe(true);
    }

    // …and nothing is LOST: further sweeps still cover the whole scope.
    const seen = new Set<string>([...aRead, ...bRead, ...cRead, ...frontAfter]);
    // 200 rows through a 25-row UNSEEN window is ceil(200 / 25) = 8 sweeps, and the
    // NEWEST window covers the top of the ledger from the start.
    for (let sweep = 0; sweep < 8 && seen.size < TOTAL; sweep += 1) {
      const ids = await pageIds();
      await stamp(ids);
      for (const id of ids) seen.add(id);
    }
    expect(seen.size).toBe(TOTAL);
  });

  it("R5-2: filters recoverable records in the repository BEFORE the limit, and pages fairly past one page", async () => {
    const w = await harness();
    const records = w.domain.executionRecords;

    // ONE older OPEN attempt, then FIFTY newer FINISHED ones — the review's shape.
    const open = await w.seedExecutionRecord({ taskId: w.taskId, attempt: 1, status: "ACCEPTED" });
    for (let index = 0; index < 50; index += 1) {
      await w.seedExecutionRecord({ taskId: w.taskId, attempt: 2 + index, status: "SUCCEEDED" });
    }

    // The page, with the review's own size, is a page of ELIGIBLE attempts: the
    // finished ones are not in it at all, so they cannot have consumed it.
    const page = await records.listRecoverable({ missionId: w.missionId, limit: 50 });
    expect(page.map((row) => row.id)).toEqual([open.id]);

    // The sweep the reconciler runs uses that same read.
    const reconciler = reconcilerFor(w, w.claims);
    const swept = await reconciler.reconcileMission(w.missionId);
    expect(swept.some((row) => row.executionRecordId === open.id)).toBe(true);
    const observed = await records.get(open.id);
    // An observation is NOT a status change and NOT activity.
    expect(observed?.status).toBe("ACCEPTED");
    expect(observed?.updatedAt).toBe(NOW);
    expect(observed?.recoverySweptAt).toBeTruthy();

    // MORE ELIGIBLE ATTEMPTS THAN ONE PAGE: the rotation reaches every one, and
    // every page it serves ADVANCES (asserted, not assumed).
    for (let index = 0; index < 120; index += 1) {
      await w.seedExecutionRecord({ taskId: w.taskId, attempt: 100 + index, status: "ACCEPTED" });
    }
    const seen = new Set<string>();
    let pages = 0;
    while (pages < 6 && seen.size < 121) {
      pages += 1;
      const rows = await records.listRecoverable({ missionId: w.missionId, limit: 50 });
      expect(rows.filter((row) => !seen.has(row.id)).length).toBeGreaterThan(0);
      for (const row of rows) {
        seen.add(row.id);
        await records.markRecoverySwept(row.id);
      }
    }
    expect(pages).toBeLessThanOrEqual(4);
    expect(seen.size).toBe(121);
    expect(seen.has(open.id)).toBe(true);
  });
});

/* ══════════════════════════════════════════════════════
   R6 — REPEATED recovery fairness (the sixth review)
   ══════════════════════════════════════════════════════ */

/**
 * The SIXTH review's first blocking finding, in the in-memory REFERENCE ledger (the
 * durable adapter and the APPLICATION boundary are proved separately, against a real
 * PostgreSQL):
 *
 *   R6-1  ONE page ordered "never observed first, then least recently observed"
 *         proves FIRST discovery and says nothing about the SECOND. With 60 new
 *         claims per sweep, exactly 60 never-observed rows can hold that page
 *         forever — with no growing backlog at all — so a claim that was OBSERVED
 *         once (a live `DISPATCHING` claim, reported `CLAIM_IN_PROGRESS`) was never
 *         revisited. Had its owner then crashed, nothing would ever have noticed.
 *
 * The correction is ALLOCATION, not a better order: three DISJOINT windows, so
 * arrivals (never-observed rows, by definition) cannot spend the revisit window's
 * share. These cases assert RECONSIDERATION AND ITS DURABLE OUTCOME — a claim
 * reaching `UNVERIFIED`, a record gaining a RECONCILED audit event — rather than the
 * contents of a query.
 */
describe("R6 — repeated recovery is bounded for claims and records alike", () => {
  function reconcilerFor(w: Awaited<ReturnType<typeof harness>>, claims: ExecutionClaimRepository): ExecutionReconciler {
    return new ExecutionReconciler({
      records: w.domain.executionRecords,
      executions: w.domain.executions,
      runtimes: w.domain.runtimes,
      missions: w.domain.missionRepository,
      tasks: w.domain.tasks,
      orchestrator: w.orchestrator,
      claims,
      now: () => new Date(NOW),
    });
  }

  /** `sweepLanes(50).revisit` — the observed window's share of one sweep's budget. */
  const REVISIT_QUOTA = 20;

  it("R6-1: revisits an observed `DISPATCHING` claim whose lease then lapses, under 60 arrivals per sweep", async () => {
    const ledger = mutableLedger();
    const w = await harness();
    const missionId = "mission_r6_lapse";
    const taskId = "task_r6_lapse";

    // SIXTY rows that have ALREADY been observed and are still open: the revisit
    // window's competition, and the set the bound is measured over.
    for (let index = 0; index < 60; index += 1) {
      const row = await unresolvedClaim(ledger, {
        missionId: `mission_r6_observed_${index}`,
        taskId: `task_r6_observed_${index}`,
        attempt: 1,
      });
      await ledger.repo.markRecoverySwept(row.id);
    }

    // The target: dispatch was ENTERED and the owner is STILL WORKING (a live lease).
    const live = await ledger.repo.claim({
      missionId,
      taskId,
      attempt: 1,
      idempotencyKey: executionIdempotencyKeyForAttempt(taskId, 1),
      actorId: FOUNDER,
      capabilityId: "proof.r6",
      runtimeId: "runtime_r6",
      leaseOwner: "tok_r6_owner",
      leaseTtlMs: 600_000,
    });
    if (live.kind !== "CLAIMED") throw new Error(`expected CLAIMED, got ${live.kind}`);
    const entered = await ledger.repo.markDispatching(live.claim.id, {
      invocationToken: "tok_r6_owner",
      leaseTtlMs: 600_000,
    });
    if (!entered) throw new Error("expected DISPATCHING");

    // FIRST OBSERVATION: the sweep sees a LIVE lease and says exactly that — the state
    // the review reproduced. Being observed is what puts the row in the REVISIT lane,
    // and only then does the arrival rate stop mattering for it.
    const first = await reconcilerFor(w, ledger.repo).reconcileInFlight();
    expect(first.find((row) => row.taskId === taskId)?.kind).toBe("CLAIM_IN_PROGRESS");
    expect((await ledger.repo.get(entered.id))?.recoverySweptAt).toBeTruthy();

    // …and now the owner CRASHES: the lease lapses on the LEDGER's own clock.
    ledger.advance(700_000);

    // 60 NEW claims before EVERY sweep — more than the whole budget, every time. The
    // old single page would spend all of it on these and never look at the target
    // again; the revisit window's 20 rows are not theirs to spend.
    const ARRIVALS = 60;
    const JUSTIFIED_BOUND = Math.ceil(61 / REVISIT_QUOTA) + 1;
    let revisited: string | null = null;
    let sweeps = 0;
    while (sweeps < JUSTIFIED_BOUND && revisited === null) {
      sweeps += 1;
      for (let index = 0; index < ARRIVALS; index += 1) {
        await unresolvedClaim(ledger, {
          missionId: `mission_r6_arrival_${sweeps}_${index}`,
          taskId: `task_r6_arrival_${sweeps}_${index}`,
          attempt: 1,
        });
      }
      const results = await reconcilerFor(w, ledger.repo).reconcileInFlight();
      const news = results.find((row) => row.taskId === taskId && row.kind !== "CLAIM_IN_PROGRESS");
      if (news) revisited = news.kind;
    }

    // RECONSIDERED within the bound — and the bound is 61 / 20, with the target at
    // position 61 of the rotation: the ARRIVAL COUNT does not appear in the
    // arithmetic, because arrivals can only ever append behind it.
    expect(sweeps).toBeLessThanOrEqual(JUSTIFIED_BOUND);
    expect(revisited).toBe("CLAIM_UNVERIFIED");
    // …and the DURABLE outcome, not merely the report: the doubt was written to the row.
    expect((await ledger.repo.get(entered.id))?.state).toBe("UNVERIFIED");
    // The arrivals were observed as well — they are work, not noise: the unseen window
    // ran every sweep and the newest window kept the freshest of them visible.
    expect(await ledger.repo.count()).toBe(60 + 1 + ARRIVALS * sweeps);
  });

  it("R6-2: revisits an observed but still-open RECORD under 55 arrivals per sweep, and the revisit is durable", async () => {
    const w = await harness();
    const records = w.domain.executionRecords;

    // Sixty attempts already OBSERVED and still open, then the target observed LAST —
    // so the target sits at the BACK of the revisit rotation. That is the shape the
    // review described as "a previously observed record was not revisited in ten
    // record-first sweeps with 55 eligible arrivals per sweep".
    for (let index = 0; index < 60; index += 1) {
      const row = await w.seedExecutionRecord({ taskId: `task_r6_record_observed_${index}`, attempt: 1 + index, status: "ACCEPTED" });
      await records.markRecoverySwept(row.id);
    }
    const target = await w.seedExecutionRecord({ taskId: "task_r6_record_target", attempt: 500, status: "ACCEPTED" });
    await records.markRecoverySwept(target.id);

    const before = (await records.get(target.id))!;
    const ARRIVALS = 55;
    const JUSTIFIED_BOUND = Math.ceil(61 / REVISIT_QUOTA) + 1;
    let revisitedAt: number | null = null;
    let sweep = 0;
    while (sweep < JUSTIFIED_BOUND && revisitedAt === null) {
      sweep += 1;
      for (let index = 0; index < ARRIVALS; index += 1) {
        const n = (sweep - 1) * ARRIVALS + index;
        await w.seedExecutionRecord({ taskId: `task_r6_record_arrival_${n}`, attempt: 1000 + n, status: "ACCEPTED" });
      }
      const results = await reconcilerFor(w, w.claims).reconcileInFlight();
      if (results.some((row) => row.executionRecordId === target.id)) revisitedAt = sweep;
    }

    expect(revisitedAt).toBeLessThanOrEqual(JUSTIFIED_BOUND);
    // The revisit did WORK, durably: a RECONCILED audit event was appended to the
    // attempt. (Row selection alone would prove nothing about recovery happening.)
    const after = (await records.get(target.id))!;
    expect(after.audit.length).toBeGreaterThan(before.audit.length);
    expect(after.audit.some((event) => event.type === "RECONCILED")).toBe(true);
    // …and observing an attempt is still not a status change.
    expect(after.status).toBe("ACCEPTED");
  });

  it("R6-3: global and mission traffic cannot starve each other's observed rows", async () => {
    const ledger = mutableLedger();
    const w = await harness();
    const missionId = "mission_r6_scope";
    const scopedTaskId = "task_r6_scope_scoped";
    const globalTaskId = "task_r6_scope_global";

    // ONE observed, still-open claim INSIDE the mission, and one OUTSIDE it.
    const scoped = await lapsedDispatchingClaim(ledger, {
      missionId,
      taskId: scopedTaskId,
      attempt: 1,
      leaseOwner: "tok_r6_scoped",
    });
    await ledger.repo.markRecoverySwept(scoped.id);
    const global = await lapsedDispatchingClaim(ledger, {
      missionId: "mission_r6_other",
      taskId: globalTaskId,
      attempt: 1,
      leaseOwner: "tok_r6_global",
    });
    await ledger.repo.markRecoverySwept(global.id);

    // Eight rounds of BOTH kinds of traffic — 60 arrivals globally, a global sweep, 60
    // arrivals inside the mission, a mission sweep. The review reproduced eight sweeps
    // of starvation in EACH direction on the unrepaired tree.
    const seen = new Set<string>();
    for (let round = 0; round < 8; round += 1) {
      for (let index = 0; index < 60; index += 1) {
        await unresolvedClaim(ledger, {
          missionId: `mission_r6_global_${round}_${index}`,
          taskId: `task_r6_global_${round}_${index}`,
          attempt: 1,
        });
      }
      for (const row of await reconcilerFor(w, ledger.repo).reconcileInFlight()) {
        if (row.taskId) seen.add(row.taskId);
      }
      for (let index = 0; index < 60; index += 1) {
        await unresolvedClaim(ledger, { missionId, taskId: `task_r6_scoped_${round}_${index}`, attempt: 1 });
      }
      for (const row of await reconcilerFor(w, ledger.repo).reconcileMission(missionId)) {
        if (row.taskId) seen.add(row.taskId);
      }
    }

    // BOTH were reconsidered: the mission's traffic did not hide the global row, and
    // the global traffic did not hide the mission's.
    expect(seen.has(scopedTaskId)).toBe(true);
    expect(seen.has(globalTaskId)).toBe(true);
    // …and both reached the same DURABLE outcome a first observation would have given
    // them: the doubt, on the row, in the ledger.
    expect((await ledger.repo.get(scoped.id))?.state).toBe("UNVERIFIED");
    expect((await ledger.repo.get(global.id))?.state).toBe("UNVERIFIED");
  });
});

/**
 * STEP 5A-4, SEVENTH REVIEW — the sweep budget's OWN arithmetic.
 *
 * The finding: every lane had a floor of one row, so a page of 1 row read THREE lanes
 * (`sweepLanes(1)` returned 1 + 1 + 1), and 2 and 3 overspent too. A caller's limit was
 * therefore not a limit. These cases assert the split itself, at the sizes the review
 * named and at the sweep's own page size, so the correction cannot regress unnoticed.
 */
describe("the sweep budget is never overspent by the lane floors", () => {
  it("returns exactly the requested total for 0, 1, 2 and 3, and at the page size", () => {
    for (const total of [0, 1, 2, 3, 4, 5, 7, 13, 50]) {
      const lanes = sweepLanes(total);
      const sum = lanes.unseen + lanes.revisit + lanes.newest;
      expect(sum, `total requested: ${total}`).toBe(total);
      expect(lanes.unseen, `unseen at ${total}`).toBeGreaterThanOrEqual(0);
      expect(lanes.revisit, `revisit at ${total}`).toBeGreaterThanOrEqual(0);
      expect(lanes.newest, `newest at ${total}`).toBeGreaterThanOrEqual(0);
    }
  });

  it("spends a budget too small for three windows in the consumption order", () => {
    // UNSEEN is consumed first, then REVISIT, then NEWEST — so a one-row page is one
    // UNSEEN row and a two-row page is one UNSEEN plus one REVISIT row.
    expect(sweepLanes(1)).toEqual({ unseen: 1, revisit: 0, newest: 0 });
    expect(sweepLanes(2)).toEqual({ unseen: 1, revisit: 1, newest: 0 });
    expect(sweepLanes(3)).toEqual({ unseen: 2, revisit: 1, newest: 0 });
    // …and from four rows up, every lane is served.
    expect(sweepLanes(4)).toEqual({ unseen: 2, revisit: 1, newest: 1 });
  });

  it("treats an invalid budget as NOTHING, not as a default page", () => {
    expect(sweepLanes(0)).toEqual({ unseen: 0, revisit: 0, newest: 0 });
    expect(sweepLanes(-1)).toEqual({ unseen: 0, revisit: 0, newest: 0 });
    expect(sweepLanes(Number.NaN)).toEqual({ unseen: 0, revisit: 0, newest: 0 });
    expect(sweepLanes(Number.POSITIVE_INFINITY)).toEqual({ unseen: 0, revisit: 0, newest: 0 });
    // A fractional budget is floored; anything above the page is capped at the page.
    expect(sweepLanes(50.9)).toEqual({ unseen: 25, revisit: 20, newest: 5 });
    expect(sweepLanes(500)).toEqual({ unseen: 25, revisit: 20, newest: 5 });
  });

  it("keeps the measured 25 / 20 / 5 allocation at the sweep's own page size", () => {
    expect(sweepLanes(50)).toEqual({ unseen: 25, revisit: 20, newest: 5 });
  });
});
