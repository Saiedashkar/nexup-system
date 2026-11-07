import { describe, expect, it } from "vitest";

import { createSequentialIdFactory } from "@/modules/ai-workforce/core/ids";
import { DenyVariableAiSpendBudgetGovernor } from "@/modules/ai-workforce/policies/budget-governor";
import { defineTool } from "@/modules/ai-workforce/registry/tool-definition";
import { ToolRegistry } from "@/modules/ai-workforce/registry/tool-registry";

import { createWorkforceDomain, DeterministicRuntimeAdapter, type WorkforceDomain } from "@/modules/workforce";
import { AgentRuntimeDispatcher } from "@/modules/workforce/runtimes/agent-runtime-dispatcher";
import type { AgentRuntime } from "@/modules/workforce/runtimes/agent-runtime";
import { createCapabilityExecutionService } from "@/modules/workforce/execution/capability-execution-service";
import type { DefaultCapabilityExecutionService } from "@/modules/workforce/execution/capability-execution-service";
import { InMemoryExecutionClaimRepository } from "@/modules/workforce/execution/execution-claim";
import { ExecutionReconciler } from "@/modules/workforce/execution/execution-reconciler";
import type { MissionOrchestrator } from "@/modules/workforce/orchestration/mission-orchestrator";
import { createExecutionAuthority, type ExecutionAuthority } from "@/modules/workforce/execution/execution-authority";
import type { BusinessScopeResolver } from "@/modules/workforce/execution/authority-resolution";
import {
  executionIdempotencyKeyForAttempt,
  type ExecutionAttemptRequest,
} from "@/modules/workforce/execution/capability-execution-contracts";
import { receiptFromClaimDetail } from "@/modules/workforce/execution/execution-claim-receipt";

/**
 * Step 5A-4 CORRECTION — the adversarial invariants.
 *
 * Every case here attacks the AUTHORITY PATH directly: it hands the execution
 * service a request whose identity does not match durable state, or cancels a
 * mission while an attempt is being dispatched, and asserts the service fails
 * CLOSED with zero handler invocation.
 */

const FIXED_NOW = "2026-03-01T00:00:00.000Z";
const FOUNDER = "actor_founder";

function businessRegistry(): BusinessScopeResolver {
  const rows = [
    { id: "biz_nexup", slug: "nexup" },
    { id: "biz_rebound", slug: "rebound" },
  ];
  return {
    async resolve(reference: string) {
      return rows.find((row) => row.id === reference || row.slug === reference) ?? null;
    },
  };
}

type Harness = {
  domain: WorkforceDomain;
  claims: InMemoryExecutionClaimRepository;
  service: DefaultCapabilityExecutionService;
  authority: ExecutionAuthority;
  actorId: string;
  missionId: string;
  taskId: string;
  capabilityId: string;
  assignmentId: string;
  runtimeId: string;
  runs: () => number;
  /** Registers a runtime-hosted capability and assigns it to the actor. */
  addRuntimeCapability: (capabilityId: string) => Promise<void>;
  seedTask: (overrides?: Partial<Record<string, unknown>>) => Promise<void>;
  request: (overrides?: Partial<ExecutionAttemptRequest>) => ExecutionAttemptRequest;
};

let seq = 0;

async function harness(options: { runtimeBound?: boolean } = {}): Promise<Harness> {
  seq += 1;
  const ids = createSequentialIdFactory(`c${seq}`);
  const domain = createWorkforceDomain({ ids, now: () => new Date(FIXED_NOW) });
  const tools = new ToolRegistry();
  let runs = 0;
  const runtimeId = `runtime_corr_${seq}`;
  if (options.runtimeBound) {
    domain.runtimes.register(
      new DeterministicRuntimeAdapter({ id: runtimeId, displayName: "corr runtime", ids, now: () => new Date(FIXED_NOW) }),
    );
  }

  const capabilityId = `proof.echo${seq}`;
  tools.register(
    defineTool(
      {
        id: capabilityId,
        name: "Proof echo",
        description: "deterministic, in-process, read-only",
        domain: "system",
        action: `echo${seq}`,
        riskLevel: "LOW",
        readWriteMode: "READ",
        inputSchema: { kind: "object", fields: {} },
        outputSchema: { kind: "object", fields: {} },
        requiredPermissions: ["aiworkforce.access"],
      },
      async (input) => {
        runs += 1;
        return { echoed: input };
      },
    ),
  );

  const actorId = `actor_agent_${seq}`;
  await domain.actors.register({
    id: actorId,
    slug: `agent-${seq}`,
    displayName: "Proof Agent",
    type: "AI_AGENT",
    role: "agent",
    department: null,
    reportsTo: null,
    collaborators: [],
    // SHADOW without a runtime binding (the deterministic leg needs none); an
    // approved-autonomy agent must carry a binding.
    lifecycle: options.runtimeBound ? "APPROVED_AUTONOMY" : "SHADOW",
    runtimeBinding: options.runtimeBound ? { runtimeId, runtimeType: "DETERMINISTIC_LOCAL" } : null,
    modelPolicy: null,
    autonomyLevel: "SUPERVISED",
    memoryScope: { scope: "NONE", retention: "EPHEMERAL" },
    permissions: [],
    approvalPolicy: { mode: "INHERIT" },
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

  await domain.capabilities.register({
    id: capabilityId,
    name: "Proof echo",
    kind: "TOOL",
    version: "1.0.0",
    description: "deterministic proof capability",
    owner: actorId,
    status: "ACTIVE",
    riskLevel: "LOW",
    approvalRequirement: "NONE",
    runtimeRequirements: { supportsDeterministic: true },
    tags: [],
    metadata: {},
  });
  const assignment = await domain.assignments.assign({
    actorId,
    capabilityId,
    capabilityVersion: "1.0.0",
    grantedBy: FOUNDER,
  });

  const mission = await domain.missions.create({
    title: "Correction mission",
    goal: "prove the authority path",
    createdBy: actorId,
    owner: FOUNDER,
    businessId: "biz_nexup",
  });
  const taskId = `task_corr_${seq}`;

  const claims = new InMemoryExecutionClaimRepository({ ids, now: () => new Date(FIXED_NOW) });
  const service = createCapabilityExecutionService({
    ids,
    now: () => new Date(FIXED_NOW),
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
        runs += 1;
        return { handleId: `det_${seq}_${runs}`, status: "SUCCEEDED" as const, output: input.input };
      },
    },
    dispatcher: new AgentRuntimeDispatcher({
      runtimes: domain.runtimes,
      actors: domain.actors,
      assignments: domain.assignments,
    }),
    tools,
    businesses: businessRegistry(),
    missions: domain.missionRepository,
    tasks: domain.tasks,
    processId: "correction",
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
    requestedAt: FIXED_NOW,
  });

  async function seedTask(overrides: Partial<Record<string, unknown>> = {}): Promise<void> {
    const task = {
      id: taskId,
      missionId: mission.id,
      sequence: 1,
      title: "correction task",
      objective: "prove",
      input: {},
      assignedActorId: actorId,
      requiredCapabilityId: capabilityId,
      requiredCapabilityVersion: "1.0.0",
      dependsOn: [],
      state: "READY" as const,
      attempt: 0,
      maxAttempts: 5,
      history: [{ from: null, to: "READY" as const, at: FIXED_NOW, reason: "planned" }],
      createdAt: FIXED_NOW,
      updatedAt: FIXED_NOW,
      ...overrides,
    };
    const existing = await domain.tasks.get(taskId);
    if (existing) await domain.tasks.update(task as never, [existing.state]);
    else await domain.tasks.insert(task as never);
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
      requiredCapabilityId: capabilityId,
      requiredCapabilityVersion: "1.0.0",
      input: {},
      traceId: `trace:${id}:${attempt}`,
      businessScope: null,
      source: "MANUAL",
      ...overrides,
    };
  }

  async function addRuntimeCapability(id: string): Promise<void> {
    await domain.capabilities.register({
      id,
      name: "Runtime-hosted proof",
      kind: "SKILL",
      version: "1.0.0",
      description: "runtime-hosted, variable cost",
      owner: actorId,
      status: "ACTIVE",
      riskLevel: "LOW",
      approvalRequirement: "NONE",
      runtimeRequirements: { requiresRuntime: true },
      procedureRef: "sop://proof",
      tags: [],
      metadata: {},
    });
    await domain.assignments.assign({ actorId, capabilityId: id, capabilityVersion: "1.0.0", grantedBy: FOUNDER });
  }

  return {
    domain,
    claims,
    service,
    authority,
    actorId,
    missionId: mission.id,
    taskId,
    capabilityId,
    assignmentId: assignment.id,
    runtimeId,
    runs: () => runs,
    addRuntimeCapability,
    seedTask,
    request,
  };
}

/* ══════════════════════════════════════════════════════
   P1-3 — the AUTHORITATIVE task re-read
   ══════════════════════════════════════════════════════ */

describe("P1-3 — CES re-reads the authoritative task and fails closed on substitution", () => {
  it("refuses a substituted ACTOR", async () => {
    const w = await harness();
    await w.seedTask();
    const outcome = await w.service.execute(w.request({ assignedActorId: "actor_someone_else" }));
    expect(outcome.kind).toBe("DENIED");
    if (outcome.kind !== "DENIED") throw new Error("expected DENIED");
    expect(outcome.code).toBe("EXECUTION_TASK_MISMATCH");
    expect(w.runs()).toBe(0);
  });

  it("refuses a substituted CAPABILITY", async () => {
    const w = await harness();
    await w.seedTask();
    const outcome = await w.service.execute(w.request({ requiredCapabilityId: "proof.other" }));
    expect(outcome.kind).toBe("DENIED");
    if (outcome.kind !== "DENIED") throw new Error("expected DENIED");
    expect(outcome.code).toBe("EXECUTION_TASK_MISMATCH");
    expect(w.runs()).toBe(0);
  });

  it("refuses a substituted ATTEMPT", async () => {
    const w = await harness();
    await w.seedTask();
    const outcome = await w.service.execute(w.request({ attempt: 4, idempotencyKey: executionIdempotencyKeyForAttempt(w.taskId, 4) }));
    expect(outcome.kind).toBe("DENIED");
    if (outcome.kind !== "DENIED") throw new Error("expected DENIED");
    expect(outcome.code).toBe("EXECUTION_TASK_MISMATCH");
    expect(w.runs()).toBe(0);
  });

  it("refuses a substituted MISSION", async () => {
    const w = await harness();
    await w.seedTask();
    const outcome = await w.service.execute(w.request({ missionId: "mission_elsewhere" }));
    expect(outcome.kind).toBe("DENIED");
    if (outcome.kind !== "DENIED") throw new Error("expected DENIED");
    // A mission that does not exist is refused before the task re-read; either
    // typed refusal is a fail-closed denial, and neither dispatches.
    expect(["MISSION_NOT_FOUND", "EXECUTION_TASK_MISMATCH"]).toContain(outcome.code);
    expect(w.runs()).toBe(0);
  });

  it("refuses CANONICAL INPUT that does not match the durable task", async () => {
    const w = await harness();
    await w.seedTask();
    const outcome = await w.service.execute(w.request({ input: { instruction: "something else" } }));
    expect(outcome.kind).toBe("DENIED");
    if (outcome.kind !== "DENIED") throw new Error("expected DENIED");
    expect(outcome.code).toBe("EXECUTION_TASK_MISMATCH");
    expect(w.runs()).toBe(0);
  });

  it("dispatches when the request MATCHES the durable task", async () => {
    const w = await harness();
    await w.seedTask();
    const outcome = await w.service.execute(w.request());
    expect(outcome.kind).toBe("DISPATCHED");
    expect(w.runs()).toBe(1);
  });
});

/* ══════════════════════════════════════════════════════
   P1-5 — EXACT deterministic capability version
   ══════════════════════════════════════════════════════ */

describe("P1-5 — a handler runs ONLY at the authorised version", () => {
  it("refuses authorized @2.0.0 when the local registry holds @1.0.0, with zero handler calls", async () => {
    const w = await harness();
    // Authorise the SAME id at version 2.0.0 in the DOMAIN registry, while the
    // local TOOL registry still holds only 1.0.0 — the exact mismatch the
    // invariant forbids.
    await w.domain.capabilities.register({
      id: w.capabilityId,
      name: "Proof echo v2",
      kind: "TOOL",
      version: "2.0.0",
      description: "authorised at 2.0.0 but no handler exists at that version",
      owner: w.actorId,
      status: "ACTIVE",
      riskLevel: "LOW",
      approvalRequirement: "NONE",
      runtimeRequirements: { supportsDeterministic: true },
      tags: [],
      metadata: {},
    });
    await w.domain.assignments.assign({
      actorId: w.actorId,
      capabilityId: w.capabilityId,
      capabilityVersion: "2.0.0",
      grantedBy: FOUNDER,
    });
    await w.seedTask({ requiredCapabilityVersion: "2.0.0" });

    const outcome = await w.service.execute(w.request({ requiredCapabilityVersion: "2.0.0" }));
    expect(outcome.kind).toBe("DENIED");
    if (outcome.kind !== "DENIED") throw new Error("expected DENIED");
    expect(outcome.code).toBe("CAPABILITY_VERSION_CONFLICT");
    expect(w.runs()).toBe(0);
  });
});

/* ══════════════════════════════════════════════════════
   P1-8 — TYPED budget denial
   ══════════════════════════════════════════════════════ */

describe("P1-8 — a budget refusal is its own TYPED code", () => {
  it("reports BUDGET_POLICY_DENIED, not PERMISSION_DENIED", async () => {
    const w = await harness({ runtimeBound: true });
    // A runtime-bound actor/capability is VARIABLE_PROVIDER_COST under the DENY
    // governor, which is the shipped default.
    const runtimeCapabilityId = `${w.capabilityId}.brief`;
    await w.addRuntimeCapability(runtimeCapabilityId);
    await w.seedTask({ requiredCapabilityId: runtimeCapabilityId, requiredCapabilityVersion: "1.0.0" });

    const outcome = await w.service.execute(
      w.request({
        requiredCapabilityId: runtimeCapabilityId,
        requiredCapabilityVersion: "1.0.0",
      }),
    );
    expect(outcome.kind).toBe("DENIED");
    if (outcome.kind !== "DENIED") throw new Error("expected DENIED");
    expect(outcome.code).toBe("BUDGET_POLICY_DENIED");
    // The governor's own machine-readable reason is preserved beside the code.
    expect(outcome.message).toMatch(/BUDGET_DENIED_VARIABLE_AI_EXECUTION/);
    expect(w.runs()).toBe(0);
  });

  it("keeps the DENY default governor as the composed fallback", () => {
    expect(new DenyVariableAiSpendBudgetGovernor().policyRef).toBe("budget.deny-variable-ai-spend.v1");
  });
});

/* ══════════════════════════════════════════════════════
   P1-9 — IMMUTABLE authoritative resolution on the receipt
   ══════════════════════════════════════════════════════ */

describe("P1-9 — the receipt records the AUTHORITATIVE resolution", () => {
  it("carries assignmentId, businessSlug and capabilityVersion from durable state", async () => {
    const w = await harness();
    await w.seedTask();
    // A payload business reference that NAMES another business must not become
    // the receipt's business: the resolution is the mission's canonical one.
    const outcome = await w.service.execute(
      w.request({ businessScope: { id: "biz_rebound", slug: "rebound" } }),
    );
    expect(outcome.kind).toBe("DISPATCHED");

    const claim = await w.claims.findByKey(executionIdempotencyKeyForAttempt(w.taskId, 1));
    const receipt = receiptFromClaimDetail(claim?.detail);
    expect(receipt).toBeDefined();
    expect(receipt?.assignmentId).toBe(w.assignmentId);
    expect(receipt?.businessSlug).toBe("nexup");
    expect(receipt?.capabilityVersion).toBe("1.0.0");
    expect(receipt?.actorId).toBe(w.actorId);
  });
});

/* ══════════════════════════════════════════════════════
   P1-1 — cancellation vs DISPATCH, linearized
   ══════════════════════════════════════════════════════ */

describe("P1-1 — cancellation cannot orphan an external run", () => {
  it("reserves a READY task's next attempt as CANCELLED, so a racing dispatch is refused", async () => {
    const w = await harness();
    await w.seedTask();

    const cancellations = await w.service.cancelMissionAttempts({
      missionId: w.missionId,
      tasks: [{ taskId: w.taskId, state: "READY" }],
      reason: "operator cancelled",
      authority: w.authority,
    });
    expect(cancellations[0]?.cancelled).toBe(true);
    expect(cancellations[0]?.unresolved).toBe(false);

    const claim = await w.claims.findByKey(executionIdempotencyKeyForAttempt(w.taskId, 1));
    expect(claim?.state).toBe("CANCELLED");

    // The racing dispatch now finds a terminal claim and cannot execute.
    const outcome = await w.service.execute(w.request());
    expect(outcome.kind).toBe("DENIED");
    expect(w.runs()).toBe(0);
  });

  it("reports UNRESOLVED when an attempt is DISPATCHING with no record", async () => {
    const w = await harness();
    await w.seedTask();

    // Win the claim and ENTER dispatch, then stop — the crash window.
    const claimed = await w.claims.claim({
      missionId: w.missionId,
      taskId: w.taskId,
      attempt: 1,
      idempotencyKey: executionIdempotencyKeyForAttempt(w.taskId, 1),
      actorId: w.actorId,
      capabilityId: w.capabilityId,
      leaseOwner: "tok_dispatch",
      leaseTtlMs: 60_000,
    });
    if (claimed.kind !== "CLAIMED") throw new Error("expected CLAIMED");
    const entered = await w.claims.markDispatching(claimed.claim.id, { invocationToken: "tok_dispatch" });
    expect(entered?.state).toBe("DISPATCHING");

    const cancellations = await w.service.cancelMissionAttempts({
      missionId: w.missionId,
      tasks: [{ taskId: w.taskId, state: "READY" }],
      reason: "operator cancelled",
      authority: w.authority,
    });
    expect(cancellations[0]?.unresolved).toBe(true);
    // The claim is untouched: dispatch may exist.
    expect((await w.claims.findByKey(executionIdempotencyKeyForAttempt(w.taskId, 1)))?.state).toBe("DISPATCHING");
    expect(w.runs()).toBe(0);
  });

  it("requires a foreground authority to cancel", async () => {
    const w = await harness();
    await w.seedTask();
    await expect(
      w.service.cancelMissionAttempts({
        missionId: w.missionId,
        tasks: [{ taskId: w.taskId, state: "READY" }],
        reason: "nope",
        authority: undefined as unknown as ExecutionAuthority,
      }),
    ).rejects.toMatchObject({ code: "AUTHORITY_UNRESOLVED" });
  });
});

/* ══════════════════════════════════════════════════════
   P1-6 — claim-first unresolved DISPATCHING sweep
   ══════════════════════════════════════════════════════ */

describe("P1-6 — the claim-first sweep discovers DISPATCHING with no record", () => {
  it("marks the doubt durable and never fabricates an execution record or dispatch", async () => {
    const w = await harness();
    // A CONTROLLABLE clock, so the DISPATCHING lease can lapse — the condition a
    // restart-after-crash sweep actually meets.
    let clock = new Date(FIXED_NOW);
    const claims = new InMemoryExecutionClaimRepository({
      ids: createSequentialIdFactory("sweep"),
      now: () => clock,
    });
    // No task row at all: this is the pure crash window.
    const claimed = await claims.claim({
      missionId: w.missionId,
      taskId: w.taskId,
      attempt: 1,
      idempotencyKey: executionIdempotencyKeyForAttempt(w.taskId, 1),
      actorId: w.actorId,
      capabilityId: w.capabilityId,
      leaseOwner: "tok_sweep",
      leaseTtlMs: 1_000,
    });
    if (claimed.kind !== "CLAIMED") throw new Error("expected CLAIMED");
    await claims.markDispatching(claimed.claim.id, { invocationToken: "tok_sweep", leaseTtlMs: 1_000 });
    // The lease lapses while no process is left to record the handle.
    clock = new Date(clock.getTime() + 60_000);

    let escalated = 0;
    const orchestrator = {
      escalateUnverifiedExecution: async () => {
        escalated += 1;
        return { taskId: w.taskId, state: "REVIEW" };
      },
    } as unknown as MissionOrchestrator;

    const reconciler = new ExecutionReconciler({
      records: w.domain.executionRecords,
      executions: w.domain.executions,
      runtimes: w.domain.runtimes,
      missions: w.domain.missionRepository,
      tasks: w.domain.tasks,
      orchestrator,
      claims,
      now: () => clock,
    });

    const results = await reconciler.reconcileDispatchingClaims();
    expect(results).toHaveLength(1);
    expect(results[0]!.kind).toBe("CLAIM_UNVERIFIED");
    // The doubt is durable and no record was fabricated.
    expect((await claims.findByKey(executionIdempotencyKeyForAttempt(w.taskId, 1)))?.state).toBe("UNVERIFIED");
    expect(await w.domain.executionRecords.listForMission(w.missionId)).toHaveLength(0);
    expect(w.runs()).toBe(0);
    // The task is not RUNNING, so nothing was escalated (= no fabricated review).
    expect(escalated).toBe(0);
  });
});

/* ══════════════════════════════════════════════════════
   P1-2 — observe honours waitForTerminal
   ══════════════════════════════════════════════════════ */

describe("P1-2 — waitForTerminal enters the bounded wait path", () => {
  function fakeRuntime(adoptedStatus: "RUNNING" | "SUCCEEDED"): AgentRuntime {
    return {
      identity: { id: "runtime_fake", type: "EXTERNAL_AGENT_RUNTIME", displayName: "fake", metadata: {} },
      async adoptExecution() {
        return {
          kind: "ADOPTED" as const,
          record: { handleId: "h1", runtimeId: "runtime_fake", status: adoptedStatus },
        };
      },
    } as unknown as AgentRuntime;
  }

  it("immediately returns the adopted state when waitForTerminal is false", async () => {
    const w = await harness();
    w.domain.runtimes.register(fakeRuntime("RUNNING"));
    const observation = await w.service.observe(
      { runtimeId: "runtime_fake", handleId: "h1" },
      { waitForTerminal: false },
    );
    expect(observation.kind).toBe("ADOPTED");
    expect(observation.status).toBe("RUNNING");
  });

  it("does not report a non-terminal adopted state as an answer when waiting", async () => {
    const w = await harness();
    w.domain.runtimes.register(fakeRuntime("RUNNING"));
    // The dispatcher's bounded wait is the only leg that may answer a WAIT.
    let waited = 0;
    const dispatcher = new AgentRuntimeDispatcher({
      runtimes: w.domain.runtimes,
      actors: w.domain.actors,
      assignments: w.domain.assignments,
    });
    (dispatcher as unknown as { waitForExecution: unknown }).waitForExecution = async () => {
      waited += 1;
      return { dispatched: true, status: "SUCCEEDED" as const, handle: { handleId: "h1", runtimeId: "runtime_fake", status: "SUCCEEDED" } };
    };
    const service = createCapabilityExecutionService({
      ids: createSequentialIdFactory("obs"),
      now: () => new Date(FIXED_NOW),
      claims: w.claims,
      records: w.domain.executionRecords,
      executions: w.domain.executions,
      capabilities: w.domain.capabilities,
      assignments: w.domain.assignments,
      actors: w.domain.actors,
      runtimes: w.domain.runtimes,
      deterministic: { id: "d", externalCalls: false, async invoke() { return { handleId: "d", status: "SUCCEEDED" as const }; } },
      dispatcher,
      tools: new ToolRegistry(),
      businesses: businessRegistry(),
      missions: w.domain.missionRepository,
      tasks: w.domain.tasks,
      processId: "obs",
    });

    const observation = await service.observe(
      { runtimeId: "runtime_fake", handleId: "h1" },
      { waitForTerminal: true, waitTimeoutMs: 50 },
    );
    expect(waited).toBe(1);
    expect(observation.kind).toBe("KNOWN");
    expect(observation.status).toBe("SUCCEEDED");
  });
});
