import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { AiWorkforceError } from "@/modules/ai-workforce/core/errors";
import { createSequentialIdFactory } from "@/modules/ai-workforce/core/ids";
import type { JsonObject } from "@/modules/ai-workforce/core/types";
import type { ApprovalRecord } from "@/modules/ai-workforce/approvals/approval-repository";
import {
  DenyVariableAiSpendBudgetGovernor,
  type BudgetGovernor,
} from "@/modules/ai-workforce/policies/budget-governor";
import { defineTool } from "@/modules/ai-workforce/registry/tool-definition";
import { ToolRegistry } from "@/modules/ai-workforce/registry/tool-registry";

import {
  createWorkforceDomain,
  DeterministicRuntimeAdapter,
  type WorkforceDomain,
} from "@/modules/workforce";
import { AgentRuntimeDispatcher } from "@/modules/workforce/runtimes/agent-runtime-dispatcher";
import { RUNTIME_DISPATCH_DEFINITION } from "@/modules/ai-workforce/runtime/runtime-dispatch-guard";
import type {
  AgentJobHandle,
  AgentJobSubmission,
} from "@/modules/workforce/runtimes/agent-runtime";
import {
  createCapabilityExecutionService,
  type ApprovalBinding,
} from "@/modules/workforce/execution/capability-execution-service";
import {
  InMemoryExecutionClaimRepository,
  REDISPATCHABLE_CLAIM_STATES,
} from "@/modules/workforce/execution/execution-claim";
import {
  detailPreservesReceipt,
  encodeReceiptDetail,
  receiptFromClaimDetail,
  serializeReceipt,
  type DispatchPreflightReceipt,
} from "@/modules/workforce/execution/execution-claim-receipt";
import { authorityFromAuthenticatedActor } from "@/modules/workforce/execution/session-authority";
import {
  assertForegroundAuthority,
  createExecutionAuthority,
  createReconciliationAuthority,
  type ExecutionAuthority,
} from "@/modules/workforce/execution/execution-authority";
import type {
  BusinessScopeResolver,
  HumanActorResolver,
} from "@/modules/workforce/execution/authority-resolution";
import type {
  ExecutionAttemptRequest,
  ExecutionOutcome,
  ExecutionPreflightResult,
} from "@/modules/workforce/execution/capability-execution-contracts";
import { executionIdempotencyKeyForAttempt } from "@/modules/workforce/execution/capability-execution-contracts";

const REPO_ROOT = path.resolve(__dirname, "..");
const FOUNDER = "actor_founder";

/** Reads a workspace source file. Used by the structural invariant checks. */
function read(relative: string): string {
  return fs.readFileSync(path.join(REPO_ROOT, relative), "utf8");
}

/** Strips comments, so an invariant cannot be satisfied or broken by prose. */
function strip(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/.*$/gm, " ");
}

/* ══════════════════════════════════════════════════════
   The fixture: a REAL domain, REAL policies, REAL claim ledger
   ══════════════════════════════════════════════════════ */

type Harness = {
  domain: WorkforceDomain;
  claims: InMemoryExecutionClaimRepository;
  tools: ToolRegistry;
  execute: (request: ExecutionAttemptRequest) => Promise<ExecutionOutcome>;
  preflight: (request: ExecutionAttemptRequest) => Promise<ExecutionPreflightResult>;
  /** Every submission the runtime saw, in order. */
  submissions: AgentJobSubmission[];
  /** The claim state observed at the moment the external leg was entered. */
  claimStateAtSubmit: string[];
  /** How many times the governed deterministic handler actually ran. */
  deterministicRuns: number;
  setBudget: (governor: BudgetGovernor) => void;
  /** Replaces the bindable approval the next preflight will find. */
  setApproval: (record: ApprovalRecord | null) => void;
  authority: ExecutionAuthority;
  businesses: BusinessScopeResolver;
  /** Seeds/refreshes the authoritative durable task for a request (the preflight re-reads it). */
  seedTask: (request: ExecutionAttemptRequest) => Promise<void>;
  actorId: string;
  deterministicCapabilityId: string;
  runtimeCapabilityId: string;
  missionId: string;
  taskId: string;
};

type HarnessOptions = {
  /** Extra tools/behaviours a single case needs. */
  handler?: (input: Record<string, unknown>) => Promise<unknown> | unknown;
  runtimeMetadata?: JsonObject;
  submissionTimeoutMs?: number;
  actorLifecycle?: "DRAFT" | "APPROVED_AUTONOMY" | "DISABLED";
  missionBusinessRef?: string;
  authorityBusinessSlugs?: string[];
  riskLevel?: "LOW" | "MEDIUM" | "HIGH";
  assignmentConstraints?: { maxRiskLevel?: "LOW" | "MEDIUM" | "HIGH"; businessSlugs?: string[] };
  capabilityStatus?: "ACTIVE" | "DRAFT" | "DISABLED";
  /** Delay the runtime so a submission-timeout case is real. */
  runtimeDelayMs?: number;
};

let seq = 0;

function authorityFor(slugs: string[]): ExecutionAuthority {
  seq += 1;
  return createExecutionAuthority({
    userId: `user_${seq}`,
    actorId: `actor_human_${seq}`,
    actorSlug: `human-${seq}`,
    actorType: "HUMAN",
    permissionTokens: ["aiworkforce.access"],
    accessibleBusinessSlugs: slugs,
    isSuperAdmin: false,
    hasOfficeFinanceFull: false,
    requestedAt: new Date().toISOString(),
  });
}

/** A business registry with the two slugs the cross-business cases need. */
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

async function harness(options: HarnessOptions = {}): Promise<Harness> {
  seq += 1;
  const ids = createSequentialIdFactory(`t${seq}`);
  const domain = createWorkforceDomain({ ids, now: () => new Date("2026-03-01T00:00:00.000Z") });
  const tools = new ToolRegistry();
  const submissions: AgentJobSubmission[] = [];
  const claimStateAtSubmit: string[] = [];
  let deterministicRuns = 0;
  let approval: ApprovalRecord | null = null;
  let budget: BudgetGovernor = new DenyVariableAiSpendBudgetGovernor();

  // The runtime the RUNTIME leg would reach. It records the CLAIM state at the
  // exact moment it is entered, which is what proves the ordering rule.
  const baseRuntime = new DeterministicRuntimeAdapter({
    id: `runtime_proof_${seq}`,
    displayName: "proof runtime",
    ids,
    now: () => new Date("2026-03-01T00:00:00.000Z"),
  });
  // A Proxy rather than an object literal: every real method survives, and only
  // the two things the probe cares about are intercepted.
  const runtime = new Proxy(baseRuntime, {
    get(target, prop, receiver) {
      if (prop === "identity") {
        // A runtime may CLAIM to be free. The budget boundary must ignore that.
        return {
          ...target.identity,
          metadata: { ...target.identity.metadata, ...(options.runtimeMetadata ?? {}) },
        };
      }
      // `startJob` is the ASYNCHRONOUS contract, and the dispatcher prefers it
      // (`isAsyncAgentRuntime`), so that is the method the mission path reaches.
      // The blocking `submitJob` is intercepted too, for a runtime composed
      // without the async contract.
      if (prop === "startJob" || prop === "submitJob") {
        return async (request: AgentJobSubmission): Promise<AgentJobHandle> => {
          submissions.push(request);
          // The claim state AT THE MOMENT the external leg was entered.
          const rows = request.jobId ? await claims.listForTask(request.jobId) : [];
          const byTask = rows[0]?.state;
          const byKey = request.idempotencyKey
            ? (await claims.findByKey(request.idempotencyKey))?.state
            : undefined;
          claimStateAtSubmit.push(byTask ?? byKey ?? "MISSING");
          if (options.runtimeDelayMs) {
            await new Promise((resolve) => setTimeout(resolve, options.runtimeDelayMs));
          }
          return target.startJob(request);
        };
      }
      const value = Reflect.get(target, prop, receiver) as unknown;
      return typeof value === "function" ? (value as (...args: unknown[]) => unknown).bind(target) : value;
    },
  });

  const claims = new InMemoryExecutionClaimRepository({ ids, now: () => new Date("2026-03-01T00:00:00.000Z") });
  domain.runtimes.register(runtime);

  // ── The actor: an AI agent bound to that runtime ──
  const actorId = `actor_analyst_${seq}`;
  await domain.actors.register({
    id: actorId,
    slug: `analyst-${seq}`,
    displayName: "Proof Analyst",
    type: "AI_AGENT",
    role: "analyst",
    department: null,
    reportsTo: null,
    collaborators: [],
    lifecycle: options.actorLifecycle ?? "APPROVED_AUTONOMY",
    runtimeBinding: { runtimeId: runtime.identity.id, runtimeType: runtime.identity.type },
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

  // ── The deterministic LOCAL handler (no provider, no external call) ──
  const deterministicCapabilityId = `proof.echo${seq}`;
  tools.register(
    defineTool(
      {
        id: deterministicCapabilityId,
        name: "Proof echo",
        description: "read-only, deterministic, in-process",
        domain: "system",
        action: `echo${seq}`,
        riskLevel: "LOW",
        readWriteMode: "READ",
        inputSchema: { kind: "object", fields: {} },
        outputSchema: { kind: "object", fields: {} },
        requiredPermissions: ["aiworkforce.access"],
      },
      async (input) => {
        deterministicRuns += 1;
        return options.handler ? await options.handler(input) : { echoed: true };
      },
    ),
  );
  await domain.capabilities.register({
    id: deterministicCapabilityId,
    name: "Proof echo",
    kind: "TOOL",
    version: "1.0.0",
    description: "deterministic proof capability",
    owner: actorId,
    status: options.capabilityStatus ?? "ACTIVE",
    riskLevel: options.riskLevel ?? "LOW",
    approvalRequirement: "NONE",
    runtimeRequirements: { supportsDeterministic: true },
    tags: [],
    metadata: {},
  });
  await domain.assignments.assign({
    actorId,
    capabilityId: deterministicCapabilityId,
    capabilityVersion: "1.0.0",
    grantedBy: FOUNDER,
    ...(options.assignmentConstraints ? { constraints: options.assignmentConstraints } : {}),
  });

  // ── The RUNTIME-bound capability (a SKILL hosted on the runtime) ──
  const runtimeCapabilityId = `proof.brief${seq}`;
  await domain.capabilities.register({
    id: runtimeCapabilityId,
    name: "Proof brief",
    kind: "SKILL",
    version: "1.0.0",
    description: "runtime-hosted proof capability",
    owner: actorId,
    status: "ACTIVE",
    riskLevel: "LOW",
    approvalRequirement: "NONE",
    runtimeRequirements: { requiresRuntime: true, requiredRuntimeTypes: [runtime.identity.type] },
    procedureRef: "sop://proof",
    tags: [],
    metadata: {},
  });
  await domain.assignments.assign({
    actorId,
    capabilityId: runtimeCapabilityId,
    capabilityVersion: "1.0.0",
    grantedBy: FOUNDER,
    constraints: { maxRiskLevel: "MEDIUM" },
  });

  const businesses = businessRegistry();
  const mission = await domain.missions.create({
    title: "Proof mission",
    goal: "prove the governed path",
    createdBy: actorId,
    owner: FOUNDER,
    businessId: options.missionBusinessRef ?? "biz_nexup",
  });

  const dispatcher = new AgentRuntimeDispatcher({
    runtimes: domain.runtimes,
    actors: domain.actors,
    assignments: domain.assignments,
  });

  const service = createCapabilityExecutionService({
    ids,
    now: () => new Date("2026-03-01T00:00:00.000Z"),
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
        deterministicRuns += 1;
        const output = input.input;
        return { handleId: `det_${seq}_${deterministicRuns}`, status: "SUCCEEDED" as const, output };
      },
    },
    dispatcher,
    tools,
    businesses,
    missions: domain.missionRepository,
    // The final preflight re-reads the authoritative task.
    tasks: domain.tasks,
    budget: {
      policyRef: "test.mutable",
      evaluate: async (input) => budget.evaluate(input),
    },
    approvals: {
      async findForAttempt() {
        return approval;
      },
    },
    processId: "proof",
    ...(options.submissionTimeoutMs ? { submissionTimeoutMs: options.submissionTimeoutMs } : {}),
  });

  const authority = authorityFor(options.authorityBusinessSlugs ?? ["nexup"]);

  // The authoritative durable task each request must match. The harness keeps it
  // in step with the request so the concurrency/ordering cases stay focused; the
  // adversarial SUBSTITUTION cases build the service directly (see the
  // correction suite).
  async function ensureTask(request: ExecutionAttemptRequest): Promise<void> {
    const at = "2026-03-01T00:00:00.000Z";
    const base = {
      id: request.taskId,
      missionId: request.missionId,
      sequence: 1,
      title: `proof ${request.taskId}`,
      objective: "prove",
      input: request.input,
      assignedActorId: request.assignedActorId,
      requiredCapabilityId: request.requiredCapabilityId,
      dependsOn: [] as string[],
      state: "READY" as const,
      attempt: Math.max(0, request.attempt - 1),
      maxAttempts: 5,
      history: [{ from: null, to: "READY" as const, at, reason: "planned" }],
      createdAt: at,
      updatedAt: at,
    };
    const task = request.requiredCapabilityVersion
      ? { ...base, requiredCapabilityVersion: request.requiredCapabilityVersion }
      : base;
    const existing = await domain.tasks.get(request.taskId);
    if (existing) {
      const next = { ...existing, ...task, state: "READY" as const };
      const stored = await domain.tasks.update(next, [existing.state]);
      if (!stored) {
        await domain.tasks.update(next, ["READY", "RUNNING", "PENDING", "FAILED", "REVISION", "CANCELLED", "REVIEW", "COMPLETED"]);
      }
    } else {
      await domain.tasks.insert(task);
    }
  }

  return {
    domain,
    claims,
    tools,
    execute: async (request) => {
      await ensureTask(request);
      return service.execute(request);
    },
    preflight: async (request) => {
      await ensureTask(request);
      return service.preflight(request);
    },
    seedTask: ensureTask,
    submissions,
    claimStateAtSubmit,
    get deterministicRuns() {
      return deterministicRuns;
    },
    setBudget: (governor) => {
      budget = governor;
    },
    setApproval: (record) => {
      approval = record;
    },
    authority,
    businesses,
    actorId,
    deterministicCapabilityId,
    runtimeCapabilityId,
    missionId: mission.id,
    taskId: `task_proof_${seq}`,
  } as Harness;
}

function request(w: Harness, overrides: Partial<ExecutionAttemptRequest> = {}): ExecutionAttemptRequest {
  const attempt = overrides.attempt ?? 1;
  const taskId = overrides.taskId ?? w.taskId;
  return {
    missionId: w.missionId,
    taskId,
    attempt,
    idempotencyKey: executionIdempotencyKeyForAttempt(taskId, attempt),
    authority: w.authority,
    assignedActorId: w.actorId,
    requiredCapabilityId: w.deterministicCapabilityId,
    input: {},
    traceId: `trace:${taskId}:${attempt}`,
    businessScope: null,
    source: "MANUAL",
    ...overrides,
  };
}

/**
 * Wraps an object so a named method records that it was reached, WITHOUT losing
 * the prototype. A spread would drop every class method and make the probe lie.
 */
function instrument<T extends object>(
  target: T,
  hooks: Partial<Record<string, () => void>>,
): T {
  return new Proxy(target, {
    get(current, prop, receiver) {
      const value = Reflect.get(current, prop, receiver) as unknown;
      const hook = typeof prop === "string" ? hooks[prop] : undefined;
      if (typeof value === "function") {
        const bound = (value as (...args: unknown[]) => unknown).bind(current);
        if (!hook) return bound;
        return (...args: unknown[]) => {
          hook();
          return bound(...args);
        };
      }
      return value;
    },
  });
}

const permissiveGovernor: BudgetGovernor = {
  policyRef: "test.permissive",
  async evaluate(input) {
    return { allowed: true, reason: "ALLOWED_ATTESTED_INCLUDED_ROUTE", policyRef: "test.permissive", spend: input.spend };
  },
};

/** A complete, non-secret receipt fixture (structurally the real thing). */
function receiptFixture(
  missionId: string,
  taskId: string,
  capabilityId: string,
): DispatchPreflightReceipt {
  return {
    v: 1,
    missionId,
    taskId,
    attempt: 1,
    idempotencyKey: `task:${taskId}:attempt:1`,
    requestedBy: "user_proof",
    operatorActorId: "actor_proof",
    correlationId: "corr_proof",
    binding: "DETERMINISTIC",
    actorId: "actor_proof",
    capabilityId,
    capabilityVersion: "1.0.0",
    assignmentId: null,
    runtimeId: null,
    businessSlug: "nexup",
    permission: { allowed: true, reason: "ALLOWED" },
    approval: { required: false, satisfied: true, reason: "NOT_REQUIRED", approvalId: null },
    budget: { allowed: true, reason: "ALLOWED_NO_VARIABLE_COST", policyRef: "test", spend: "NO_VARIABLE_COST" },
    risk: { level: "LOW", decision: "WITHIN_DECLARED" },
    decision: "DISPATCH",
    authorizedAt: "2026-03-01T00:00:00.000Z",
  };
}

function approvedRecord(overrides: Partial<ApprovalRecord> = {}): ApprovalRecord {
  return {
    id: "approval_proof_1",
    status: "APPROVED",
    toolId: "proof.echo1",
    riskLevel: "LOW",
    requestedByUserId: "user_x",
    requestedForUserId: "user_x",
    requestReason: "proof",
    createdAt: "2026-03-01T00:00:00.000Z",
    decidedByUserId: FOUNDER,
    decidedAt: "2026-03-01T00:00:00.000Z",
    ...overrides,
  };
}

/* ══════════════════════════════════════════════════════
   1. EXACTLY ONE DISPATCH UNDER CONCURRENCY
   ══════════════════════════════════════════════════════ */

describe("Step 5A-4 — one attempt, one execution, however many callers", () => {
  it("invokes the handler ONCE when many callers race for the same attempt (1)", async () => {
    const w = await harness();
    const sameAttempt = request(w);

    const outcomes = await Promise.all([
      w.execute(sameAttempt),
      w.execute(sameAttempt),
      w.execute(sameAttempt),
      w.execute(sameAttempt),
      w.execute(sameAttempt),
    ]);

    const dispatched = outcomes.filter((outcome) => outcome.kind === "DISPATCHED");
    expect(dispatched).toHaveLength(1);
    for (const loser of outcomes.filter((outcome) => outcome.kind !== "DISPATCHED")) {
      expect(loser.kind).toBe("IN_PROGRESS");
    }
    // THE PROPERTY THAT MATTERS: the work happened once.
    expect(w.deterministicRuns).toBe(1);
    expect(await w.claims.count()).toBe(1);
  });

  it("replays a retry instead of executing again, and never re-runs the handler (10, 12)", async () => {
    const w = await harness();
    const first = await w.execute(request(w));
    expect(first.kind).toBe("DISPATCHED");

    const retry = await w.execute(request(w));
    expect(retry.kind).toBe("REPLAYED");
    if (retry.kind !== "REPLAYED" || first.kind !== "DISPATCHED") throw new Error("unreachable");
    expect(retry.executionRecordId).toBe(first.executionRecordId);
    expect(retry.handleId).toBe(first.handleId);
    expect(w.deterministicRuns).toBe(1);
  });

  it("re-adopts across a restart with an EMPTY in-memory runtime cache (11)", async () => {
    const w = await harness();
    const first = await w.execute(request(w));
    expect(first.kind).toBe("DISPATCHED");

    // A fresh service over the SAME durable claim ledger and record store — the
    // "restart" the requirement is about. The runtime's own idempotency map is
    // useless here: the DECISION must come from the ledger, not from memory.
    const restarted = createCapabilityExecutionService({
      ids: createSequentialIdFactory("restart"),
      now: () => new Date("2026-03-01T01:00:00.000Z"),
      claims: w.claims,
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
          throw new Error("a restart must never invoke the handler again");
        },
      },
      dispatcher: new AgentRuntimeDispatcher({
        runtimes: w.domain.runtimes,
        actors: w.domain.actors,
        assignments: w.domain.assignments,
      }),
      tools: w.tools,
      missions: w.domain.missionRepository,
      tasks: w.domain.tasks,
      businesses: w.businesses,
      processId: "restarted",
    });

    const adopted = await restarted.execute(request(w));
    expect(adopted.kind).toBe("REPLAYED");
    if (adopted.kind !== "REPLAYED" || first.kind !== "DISPATCHED") throw new Error("unreachable");
    expect(adopted.executionRecordId).toBe(first.executionRecordId);
    expect(w.deterministicRuns).toBe(1);
  });

  it("IGNORES a caller-supplied key and resolves the same attempt (13, 5A-4 correction)", async () => {
    // THE CORRECTION. This case used to assert ATTEMPT_IDEMPOTENCY_MISMATCH for a
    // caller-supplied key that differed from the derived one — but that made the
    // caller's string part of the attempt's IDENTITY: a hostile or merely
    // defective caller could reserve `(task, attempt)` under an arbitrary key, and
    // the legitimate orchestration call (which supplies the canonical spelling)
    // was then the one refused. The key is now DERIVED unconditionally inside the
    // boundary and caller input never participates, so the same attempt resolves
    // to the same row and REPLAYS. No second authority, and no second run.
    const w = await harness();
    const first = await w.execute(request(w));
    expect(first.kind).toBe("DISPATCHED");

    const forged = await w.execute(
      request(w, { idempotencyKey: `${executionIdempotencyKeyForAttempt(w.taskId, 1)}:typo` }),
    );
    expect(forged.kind).toBe("REPLAYED");
    if (forged.kind !== "REPLAYED" || first.kind !== "DISPATCHED") throw new Error("unreachable");
    expect(forged.executionRecordId).toBe(first.executionRecordId);
    // ONE claim row and ONE handler invocation: the caller's key changed nothing.
    expect(await w.claims.count()).toBe(1);
    expect(w.deterministicRuns).toBe(1);
  });
});

/* ══════════════════════════════════════════════════════
   2. ORDERING — NOTHING EXTERNAL BEFORE A COMMITTED DISPATCHING
   ══════════════════════════════════════════════════════ */

describe("Step 5A-4 — the DISPATCHING boundary is not decorative", () => {
  it("enters the external leg only AFTER the claim is durably DISPATCHING (24)", async () => {
    const w = await harness();
    w.setBudget(permissiveGovernor);

    const outcome = await w.execute(request(w, { requiredCapabilityId: w.runtimeCapabilityId }));
    expect(outcome.kind).toBe("DISPATCHED");
    expect(w.submissions).toHaveLength(1);
    // The claim state AT SUBMISSION TIME. It was entered — so the run may exist —
    // and it was NOT yet DISPATCHED, because finalization follows the call.
    expect(w.claimStateAtSubmit).toEqual(["DISPATCHING"]);
    expect(REDISPATCHABLE_CLAIM_STATES).not.toContain("DISPATCHING");
  });

  it("never enters the external leg when the claim cannot be committed", async () => {
    const w = await harness();
    w.setBudget(permissiveGovernor);
    const attempt = request(w, { requiredCapabilityId: w.runtimeCapabilityId });

    // Win the attempt with one invocation and hold it there.
    const first = await w.execute(attempt);
    expect(first.kind).toBe("DISPATCHED");

    // A second invocation cannot even reach the runtime.
    const before = w.submissions.length;
    const second = await w.execute(attempt);
    expect(second.kind).toBe("REPLAYED");
    expect(w.submissions).toHaveLength(before);
  });

  it("does not run the handler when the claim was RELEASED by a refusal", async () => {
    const w = await harness();
    // The default DENY governor blocks the RUNTIME leg, so a runtime attempt is
    // refused and the claim must be RELEASED, not left DISPATCHING.
    const outcome = await w.execute(request(w, { requiredCapabilityId: w.runtimeCapabilityId }));
    expect(outcome.kind).toBe("DENIED");
    expect(w.submissions).toHaveLength(0);

    const claim = await w.claims.findByKey(executionIdempotencyKeyForAttempt(w.taskId, 1));
    expect(claim?.state).toBe("RELEASED");
    expect(claim?.detail).toContain("DENIED");
  });
});

/* ══════════════════════════════════════════════════════
   3. AUTHORITY
   ══════════════════════════════════════════════════════ */

describe("Step 5A-4 — foreground authority is required and never invented", () => {
  it("refuses a reconciliation (background) authority for STARTING work", async () => {
    const w = await harness();
    const reconciliation = createReconciliationAuthority({ component: "reconciler" });

    await expect(w.execute(request(w, { authority: reconciliation }))).rejects.toMatchObject({
      code: "AUTHORITY_UNRESOLVED",
    });
    // No claim row was created: the refusal happens before any write.
    expect(await w.claims.count()).toBe(0);
  });

  it("refuses a missing authority, and an expired one", async () => {
    const w = await harness();
    expect(() => assertForegroundAuthority(undefined)).toThrow(/server-created execution authority/);

    const stale = createExecutionAuthority({
      userId: "user_stale",
      actorId: FOUNDER,
      actorSlug: "founder",
      actorType: "HUMAN",
      permissionTokens: ["aiworkforce.access"],
      accessibleBusinessSlugs: ["nexup"],
      isSuperAdmin: false,
      hasOfficeFinanceFull: false,
      // Minted well before the harness clock (2026-03-01), so it is past the
      // 15-minute request deadline the final preflight checks.
      requestedAt: "2026-02-28T00:00:00.000Z",
    });
    await expect(w.execute(request(w, { authority: stale }))).rejects.toMatchObject({
      code: "AUTHORITY_UNRESOLVED",
    });
  });

  it("re-checks the MISSION's canonical business at final preflight (31)", async () => {
    const w = await harness({ missionBusinessRef: "biz_rebound" });
    // The caller reaches only `nexup`, and the mission names `rebound`.
    const outcome = await w.execute(request(w));
    expect(outcome.kind).toBe("DENIED");
    if (outcome.kind !== "DENIED") throw new Error("expected DENIED");
    expect(outcome.code).toBe("BUSINESS_SCOPE_DENIED");
    expect(w.deterministicRuns).toBe(0);
  });

  it("does not let a payload widen the business scope", async () => {
    const w = await harness({ missionBusinessRef: "biz_nexup", authorityBusinessSlugs: ["nexup"] });
    // A payload naming the OTHER business cannot widen anything: the scope gate
    // evaluates the mission's canonical business, which the payload does not own.
    const outcome = await w.execute(
      request(w, { businessScope: { id: "biz_rebound", slug: "rebound" } }),
    );
    expect(outcome.kind).toBe("DISPATCHED");
    expect(w.deterministicRuns).toBe(1);
  });

  it("threads ONE authority object from the edge to the execution attempt (30)", async () => {
    // The session-boundary builder is the only place an authority is minted for a
    // request, and the object it returns is what the execution service receives.
    const w = await harness();
    const humanActors: HumanActorResolver = {
      async resolve(userId: string) {
        return {
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
          metadata: { userId },
          createdAt: "2026-03-01T00:00:00.000Z",
          updatedAt: "2026-03-01T00:00:00.000Z",
        };
      },
    };
    const authority = await authorityFromAuthenticatedActor({
      actor: {
        userId: "user_edge_1",
        name: "Edge",
        role: "ADMIN",
        isSuperAdmin: false,
        hasOfficeFinanceFull: false,
        accessibleBusinessSlugs: ["nexup"],
        permissionTokens: ["aiworkforce.access"],
      },
      humanActors,
    });

    // `requestedBy` is the USER; the resolved ACTOR is separate. The vocabulary
    // 5A-3 froze is still exactly this.
    expect(authority.userId).toBe("user_edge_1");
    expect(authority.actorId).toBe(FOUNDER);
    expect(authority.origin).toBe("REQUEST");

    const outcome = await w.execute(request(w, { authority }));
    expect(outcome.kind).toBe("DISPATCHED");
  });
});

/* ══════════════════════════════════════════════════════
   4. THE FINAL PREFLIGHT GATES
   ══════════════════════════════════════════════════════ */

describe("Step 5A-4 — every gate is re-read at the final preflight", () => {
  it("denies an actor that was disabled after planning (14)", async () => {
    const w = await harness();
    await w.domain.actors.updateLifecycle(w.actorId, "DISABLED", "proof");

    const outcome = await w.execute(request(w));
    expect(outcome.kind).toBe("DENIED");
    if (outcome.kind !== "DENIED") throw new Error("expected DENIED");
    expect(outcome.code).toBe("ACTOR_DISABLED");
    expect(w.deterministicRuns).toBe(0);
  });

  it("denies when the assignment was revoked before dispatch (15)", async () => {
    const w = await harness();
    for (const assignment of w.domain.assignments.listForActor(w.actorId)) {
      await w.domain.assignments.revoke(assignment.id, FOUNDER, "proof revocation");
    }

    const outcome = await w.execute(request(w));
    expect(outcome.kind).toBe("DENIED");
    if (outcome.kind !== "DENIED") throw new Error("expected DENIED");
    expect(outcome.code).toBe("INVALID_ASSIGNMENT");
  });

  it("enforces the assignment's risk ceiling (16)", async () => {
    const w = await harness({
      riskLevel: "HIGH",
      assignmentConstraints: { maxRiskLevel: "MEDIUM" },
    });
    const outcome = await w.execute(request(w));
    expect(outcome.kind).toBe("DENIED");
    if (outcome.kind !== "DENIED") throw new Error("expected DENIED");
    expect(outcome.code).toBe("INVALID_ASSIGNMENT");
    expect(outcome.message).toMatch(/at most MEDIUM/);
  });

  it("enforces the assignment's business restriction (16)", async () => {
    const w = await harness({
      assignmentConstraints: { businessSlugs: ["rebound"] },
    });
    const outcome = await w.execute(request(w));
    expect(outcome.kind).toBe("DENIED");
    if (outcome.kind !== "DENIED") throw new Error("expected DENIED");
    expect(outcome.code).toBe("BUSINESS_SCOPE_DENIED");
  });

  it("denies a capability that is not ACTIVE (17)", async () => {
    const w = await harness({ capabilityStatus: "DRAFT" });
    const outcome = await w.execute(request(w));
    expect(outcome.kind).toBe("DENIED");
    if (outcome.kind !== "DENIED") throw new Error("expected DENIED");
    expect(outcome.code).toBe("TOOL_DISABLED");
  });

  it("denies a pinned capability version that is not the resolved one (17)", async () => {
    const w = await harness();
    const outcome = await w.execute(request(w, { requiredCapabilityVersion: "9.9.9" }));
    expect(outcome.kind).toBe("DENIED");
    if (outcome.kind !== "DENIED") throw new Error("expected DENIED");
    expect(outcome.code).toBe("CAPABILITY_NOT_FOUND");
  });

  it("denies a capability the actor is not assigned, with no dispatch", async () => {
    const w = await harness();
    await w.domain.capabilities.register({
      id: "proof.unassigned",
      name: "Unassigned",
      kind: "TOOL",
      version: "1.0.0",
      description: "no assignment edge",
      owner: w.actorId,
      status: "ACTIVE",
      riskLevel: "LOW",
      approvalRequirement: "NONE",
      runtimeRequirements: { supportsDeterministic: true },
      tags: [],
      metadata: {},
    });

    const outcome = await w.execute(request(w, { requiredCapabilityId: "proof.unassigned" }));
    expect(outcome.kind).toBe("DENIED");
    if (outcome.kind !== "DENIED") throw new Error("expected DENIED");
    expect(outcome.code).toBe("INVALID_ASSIGNMENT");
  });
});

/* ══════════════════════════════════════════════════════
   5. BUDGET — THE UNNEGOTIABLE GATE
   ══════════════════════════════════════════════════════ */

describe("Step 5A-4 — the budget boundary is not weakened for anybody", () => {
  it("refuses a RUNTIME leg under the shipped DENY governor (Hermes included)", async () => {
    const w = await harness();
    const outcome = await w.execute(request(w, { requiredCapabilityId: w.runtimeCapabilityId }));
    expect(outcome.kind).toBe("DENIED");
    expect(w.submissions).toHaveLength(0);
  });

  it("refuses a runtime that CLAIMS to be free (20)", async () => {
    const w = await harness({
      runtimeMetadata: { variableCost: false, externalCalls: false, deterministic: true },
    });
    const outcome = await w.execute(request(w, { requiredCapabilityId: w.runtimeCapabilityId }));
    // Metadata is NOT sufficient to declare a runtime free: only a locally
    // registered deterministic HANDLER is NO_VARIABLE_COST.
    expect(outcome.kind).toBe("DENIED");
    if (outcome.kind !== "DENIED") throw new Error("expected DENIED");
    expect(outcome.message).toMatch(/BUDGET_DENIED_VARIABLE_AI_EXECUTION/);
    expect(w.submissions).toHaveLength(0);
  });

  it("does not let a HUMAN approval override a budget refusal (22)", async () => {
    const w = await harness();
    w.setApproval(
      approvedRecord({
        toolId: RUNTIME_DISPATCH_DEFINITION.id,
        riskLevel: "HIGH",
      }),
    );
    const outcome = await w.execute(request(w, { requiredCapabilityId: w.runtimeCapabilityId }));
    expect(outcome.kind).toBe("DENIED");
    expect(w.submissions).toHaveLength(0);
  });

  it("permits a locally registered deterministic handler with externalCalls=false (21)", async () => {
    const w = await harness();
    const outcome = await w.execute(request(w));
    expect(outcome.kind).toBe("DISPATCHED");
    expect(w.deterministicRuns).toBe(1);
  });

  it("refuses a 'deterministic' invoker that admits it reaches the network", async () => {
    const w = await harness();
    const service = createCapabilityExecutionService({
      ids: createSequentialIdFactory("liar"),
      now: () => new Date("2026-03-01T00:00:00.000Z"),
      claims: w.claims,
      records: w.domain.executionRecords,
      executions: w.domain.executions,
      capabilities: w.domain.capabilities,
      assignments: w.domain.assignments,
      actors: w.domain.actors,
      runtimes: w.domain.runtimes,
      deterministic: {
        id: "liar",
        externalCalls: true as unknown as false,
        async invoke() {
          return { handleId: "nope", status: "SUCCEEDED" as const };
        },
      },
      dispatcher: new AgentRuntimeDispatcher({
        runtimes: w.domain.runtimes,
        actors: w.domain.actors,
        assignments: w.domain.assignments,
      }),
      tools: w.tools,
      missions: w.domain.missionRepository,
      tasks: w.domain.tasks,
      businesses: w.businesses,
      processId: "liar",
    });

    const liarRequest = request(w, { taskId: "task_liar" });
    await w.seedTask(liarRequest);
    const outcome = await service.execute(liarRequest);
    expect(outcome.kind).toBe("UNVERIFIED");
  });
});

/* ══════════════════════════════════════════════════════
   6. APPROVAL BINDING
   ══════════════════════════════════════════════════════ */

describe("Step 5A-4 — an approval must be BOUND to the attempt it authorises", () => {
  it("refuses an approval issued for a different capability", async () => {
    const w = await harness();
    w.setApproval(approvedRecord({ toolId: "some.other.tool" }));

    const outcome = await w.execute(request(w));
    expect(outcome.kind).toBe("DENIED");
    if (outcome.kind !== "DENIED") throw new Error("expected DENIED");
    expect(outcome.code).toBe("APPROVAL_WRONG_TOOL");
  });

  it("refuses an approval bound to a DIFFERENT execution authorization identity", async () => {
    const w = await harness();
    const binding: ApprovalBinding = {
      missionId: w.missionId,
      taskId: "task_somewhere_else",
      attempt: 1,
      idempotencyKey: "task:task_somewhere_else:attempt:1",
      businessId: "biz_nexup",
      actorId: w.actorId,
      capabilityId: w.deterministicCapabilityId,
      capabilityVersion: "1.0.0",
    };
    w.setApproval(
      approvedRecord({
        toolId: w.deterministicCapabilityId,
        metadata: { bindingRef: `mission:${binding.missionId}|task:${binding.taskId}|attempt:1` },
      }),
    );

    const outcome = await w.execute(request(w));
    expect(outcome.kind).toBe("DENIED");
    if (outcome.kind !== "DENIED") throw new Error("expected DENIED");
    expect(outcome.code).toBe("APPROVAL_WRONG_TOOL");
  });

  it("refuses an EXPIRED approval", async () => {
    const w = await harness();
    w.setApproval(
      approvedRecord({
        toolId: w.deterministicCapabilityId,
        decidedAt: "2026-02-27T00:00:00.000Z",
      }),
    );
    const outcome = await w.execute(request(w));
    expect(outcome.kind).toBe("DENIED");
    if (outcome.kind !== "DENIED") throw new Error("expected DENIED");
    expect(outcome.code).toBe("APPROVAL_REQUIRED");
  });

  it("refuses a REJECTED approval", async () => {
    const w = await harness();
    w.setApproval(approvedRecord({ toolId: w.deterministicCapabilityId, status: "REJECTED" }));
    const outcome = await w.execute(request(w));
    expect(outcome.kind).toBe("DENIED");
    if (outcome.kind !== "DENIED") throw new Error("expected DENIED");
    expect(outcome.code).toBe("APPROVAL_REJECTED");
  });
});

/* ══════════════════════════════════════════════════════
   7. UNCERTAINTY — NEVER RELEASED, NEVER REPEATED
   ══════════════════════════════════════════════════════ */

describe("Step 5A-4 — an ambiguous submission becomes doubt, not a retry", () => {
  it("marks UNVERIFIED when the submission times out, and never redispatch (8, 25)", async () => {
    const w = await harness({ submissionTimeoutMs: 20, runtimeDelayMs: 80 });
    w.setBudget(permissiveGovernor);

    const outcome = await w.execute(request(w, { requiredCapabilityId: w.runtimeCapabilityId }));
    expect(outcome.kind).toBe("UNVERIFIED");
    if (outcome.kind !== "UNVERIFIED") throw new Error("expected UNVERIFIED");
    expect(outcome.detail).toMatch(/may have started/);

    const claim = await w.claims.findByKey(executionIdempotencyKeyForAttempt(w.taskId, 1));
    expect(claim?.state).toBe("UNVERIFIED");
    // The lease is GONE, not merely stale, and the attempt is NOT dispatchable.
    expect(claim?.leaseExpiresAt).toBeUndefined();
    expect(REDISPATCHABLE_CLAIM_STATES).not.toContain("UNVERIFIED");

    // A later caller is told the same thing and never reaches the runtime again.
    const before = w.submissions.length;
    const second = await w.execute(request(w, { requiredCapabilityId: w.runtimeCapabilityId }));
    expect(second.kind).toBe("UNVERIFIED");
    expect(w.submissions).toHaveLength(before);
  });

  it("keeps the preflight receipt through an UNVERIFIED transition (32)", async () => {
    const w = await harness({ submissionTimeoutMs: 20, runtimeDelayMs: 80 });
    w.setBudget(permissiveGovernor);
    await w.execute(request(w, { requiredCapabilityId: w.runtimeCapabilityId }));

    const claim = await w.claims.findByKey(executionIdempotencyKeyForAttempt(w.taskId, 1));
    const receipt = receiptFromClaimDetail(claim?.detail);
    expect(receipt).toBeDefined();
    expect(receipt?.v).toBe(1);
    expect(receipt?.binding).toBe("RUNTIME");
    expect(receipt?.budget.spend).toBe("VARIABLE_PROVIDER_COST");
    expect(receipt?.decision).toBe("DISPATCH");
    // The doubt was ADDED, and the committed receipt is byte-for-byte intact.
    expect(detailPreservesReceipt(claim?.detail, receipt!)).toBe(true);
    expect(claim?.detail).toContain("must not be re-dispatched");
    // ...and the receipt carries no credential-shaped value.
    expect(serializeReceipt(receipt!)).not.toMatch(/bearer|cookie|secret|password|token"/i);
  });

  it("refuses to commit a receipt in a form a later transition would DROP (32)", async () => {
    const w = await harness();
    const claimed = await w.claims.claim({
      missionId: w.missionId,
      taskId: "task_receipt_form",
      attempt: 1,
      idempotencyKey: "task:task_receipt_form:attempt:1",
      actorId: w.actorId,
      capabilityId: w.deterministicCapabilityId,
      leaseOwner: "tok_receipt_form",
      leaseTtlMs: 60_000,
    });
    if (claimed.kind !== "CLAIMED") throw new Error("expected CLAIMED");

    // A BARE receipt string is not the envelope, so nothing downstream could
    // read it back — committing it would silently destroy the evidence.
    await expect(
      w.claims.markDispatching(claimed.claim.id, {
        invocationToken: "tok_receipt_form",
        receiptDetail: JSON.stringify({ v: 1, missionId: w.missionId }),
      }),
    ).rejects.toThrow(/envelope produced by `encodeReceiptDetail`/);

    // The correct form is accepted, is readable afterwards, and survives doubt.
    const entered = await w.claims.markDispatching(claimed.claim.id, {
      invocationToken: "tok_receipt_form",
      receiptDetail: encodeReceiptDetail(receiptFixture(w.missionId, "task_receipt_form", w.deterministicCapabilityId)),
    });
    expect(entered?.state).toBe("DISPATCHING");
    expect(receiptFromClaimDetail(entered?.detail)?.decision).toBe("DISPATCH");

    const doubted = await w.claims.markUnverified(claimed.claim.id, "transport failed");
    expect(doubted?.detail).toContain("transport failed");
    expect(receiptFromClaimDetail(doubted?.detail)?.decision).toBe("DISPATCH");
  });

  it("reports the receipt as usable governance evidence on the preflight path", async () => {
    const w = await harness();
    const result = await w.preflight(request(w));
    expect(result.decision).toBe("DISPATCH");
    expect(result.binding).toBe("DETERMINISTIC");
    expect(result.spend).toBe("NO_VARIABLE_COST");
    expect(result.budget.reason).toBe("ALLOWED_NO_VARIABLE_COST");
    expect(result.permission.allowed).toBe(true);
    expect(result.capability.resolved).toBe(true);
    // A preflight performs NO writes and NO external calls.
    expect(await w.claims.count()).toBe(0);
    expect(w.deterministicRuns).toBe(0);
    expect(w.submissions).toHaveLength(0);
  });
});

/* ══════════════════════════════════════════════════════
   8. STRUCTURAL INVARIANTS (no second lifecycle, no direct runtime)
   ══════════════════════════════════════════════════════ */

describe("Step 5A-4 — the architecture the cutover is supposed to have", () => {
  it("creates NO AiJob, AiRun or AiRunEvent on the mission path (23)", () => {
    // Static: the mission execution path must not name the Phase-1 job/run
    // lifecycle at all. `LocalRuntimeAdapter` (which opens runs) is deliberately
    // NOT what the deterministic leg uses.
    const files = [
      "src/modules/workforce/execution/capability-execution-service.ts",
      "src/modules/workforce/execution/governed-deterministic-invoker.ts",
      "src/modules/workforce/orchestration/mission-orchestrator.ts",
    ];
    for (const file of files) {
      const code = strip(read(file));
      expect(code).not.toMatch(/AiJob|aiJob|AiRun\b|aiRun|AiRunEvent|run-recorder|RunRecorder/);
      expect(code).not.toMatch(/local-runtime-adapter|LocalRuntimeAdapter/);
      expect(code).not.toMatch(/job-runner|JobRunner/);
    }
  });

  it("proves it BEHAVIOURALLY: the attempt leaves exactly one execution record (23)", async () => {
    const w = await harness();
    const outcome = await w.execute(request(w));
    expect(outcome.kind).toBe("DISPATCHED");
    const records = await w.domain.executionRecords.listForTask(w.taskId);
    expect(records).toHaveLength(1);
    expect(records[0]!.idempotencyKey).toBe(executionIdempotencyKeyForAttempt(w.taskId, 1));
    expect(records[0]!.capabilityId).toBe(w.deterministicCapabilityId);
    // The audit spine is the ONE trail for this attempt.
    expect(records[0]!.audit.length).toBeGreaterThan(0);
  });

  it("keeps MissionOrchestrator unable to reach a runtime or dispatcher (27)", () => {
    const orchestrator = strip(read("src/modules/workforce/orchestration/mission-orchestrator.ts"));
    expect(orchestrator).toContain("execution.execute(");
    expect(orchestrator).toContain("execution.observe(");
    // Cancellation goes through the governed service too — now via the
    // mission-attempt reservation rather than a bare `execution.cancel(`.
    expect(orchestrator).toContain("execution.cancelMissionAttempts(");
    expect(orchestrator).not.toMatch(/startJob\(|cancelJob\(|waitForExecution\(|dispatchJob\(/);
    expect(orchestrator).not.toMatch(/from\s+["'][^"']*runtimes\/agent-runtime-dispatcher["']/);
    // No provider coupling either — the cutover did not move Hermes up a layer.
    expect(orchestrator).not.toMatch(/from\s+["'][^"']*runtimes\/hermes/);
    expect(orchestrator).not.toMatch(/saieed/);
  });

  it("keeps the reconciler unable to START anything (28)", () => {
    const reconciler = strip(read("src/modules/workforce/execution/execution-reconciler.ts"));
    // It may not acquire a claim, and it may not execute.
    expect(reconciler).not.toMatch(/\.claim\(|\.execute\(|markDispatching|startJob\(|dispatchJob\(/);
    // It MAY observe/adopt and it must be able to say "unverified".
    expect(reconciler).toMatch(/adoptExecution\(/);
    expect(reconciler).toMatch(/CLAIM_UNVERIFIED/);
    expect(reconciler).toMatch(/markUnverified\(/);
  });

  it("keeps the Hermes profile allowlist exactly where it was (26)", () => {
    const config = read("src/modules/workforce/runtimes/hermes/hermes-config.ts");
    expect(config).toMatch(/saieed/);
    expect(config).toMatch(/default/);
    expect(config).toMatch(/NEXUP_ALLOWED_PROFILES/);
    // The cutover touched neither the protocol nor the profile gate.
    const service = read("src/modules/workforce/execution/capability-execution-service.ts");
    expect(service).not.toMatch(/profile|saieed|HERMES_RUNTIME_/i);
  });

  it("keeps prisma/schema.prisma and prisma/migrations untouched by THIS batch", () => {
    const schema = read("prisma/schema.prisma");
    expect(schema).toContain("model AiExecutionClaim");
    // The receipt reuses the existing bounded `detail` column: no new field.
    expect(schema).not.toContain("preflightReceipt");
    const applied = fs.readdirSync(path.join(REPO_ROOT, "prisma", "migrations"), { withFileTypes: true });
    expect(applied.filter((entry) => entry.name.includes("AI_WORKFORCE"))).toEqual([]);
  });
});

/* ══════════════════════════════════════════════════════
   9. CANCELLATION
   ══════════════════════════════════════════════════════ */

describe("Step 5A-4 — cancellation requires authority and is audited first (29)", () => {
  it("refuses an unauthenticated cancellation without touching the runtime", async () => {
    const w = await harness();
    const service = createCapabilityExecutionService({
      ids: createSequentialIdFactory("cancel"),
      now: () => new Date("2026-03-01T00:00:00.000Z"),
      claims: w.claims,
      records: w.domain.executionRecords,
      executions: w.domain.executions,
      capabilities: w.domain.capabilities,
      assignments: w.domain.assignments,
      actors: w.domain.actors,
      runtimes: w.domain.runtimes,
      deterministic: { id: "x", externalCalls: false, async invoke() { return { handleId: "x", status: "SUCCEEDED" as const }; } },
      dispatcher: new AgentRuntimeDispatcher({
        runtimes: w.domain.runtimes,
        actors: w.domain.actors,
        assignments: w.domain.assignments,
      }),
      tools: w.tools,
      missions: w.domain.missionRepository,
      tasks: w.domain.tasks,
      businesses: w.businesses,
      processId: "cancel",
    });

    await expect(
      service.cancel(
        { runtimeId: "runtime_any", handleId: "handle_any" },
        { reason: "nope", authority: undefined as unknown as ExecutionAuthority },
      ),
    ).rejects.toMatchObject({ code: "AUTHORITY_UNRESOLVED" });
  });

  it("records CANCEL_REQUESTED before the external cancellation is attempted", async () => {
    const w = await harness();
    w.setBudget(permissiveGovernor);
    const dispatched = await w.execute(request(w, { requiredCapabilityId: w.runtimeCapabilityId }));
    expect(dispatched.kind).toBe("DISPATCHED");
    if (dispatched.kind !== "DISPATCHED") throw new Error("unreachable");

    const observed: string[] = [];
    const realDispatcher = new AgentRuntimeDispatcher({
      runtimes: w.domain.runtimes,
      actors: w.domain.actors,
      assignments: w.domain.assignments,
    });
    const service = createCapabilityExecutionService({
      ids: createSequentialIdFactory("cancel2"),
      now: () => new Date("2026-03-01T00:00:00.000Z"),
      claims: w.claims,
      records: w.domain.executionRecords,
      executions: instrument(w.domain.executions, {
        recordCancellationRequested: () => observed.push("AUDITED"),
        markCancelled: () => observed.push("CANCELLED"),
      }),
      capabilities: w.domain.capabilities,
      assignments: w.domain.assignments,
      actors: w.domain.actors,
      // The external side effect is observed where it actually happens: at the
      // dispatcher the runtime call goes through.
      runtimes: w.domain.runtimes,
      deterministic: { id: "y", externalCalls: false, async invoke() { return { handleId: "y", status: "SUCCEEDED" as const }; } },
      dispatcher: instrument(realDispatcher, { cancelJob: () => observed.push("RUNTIME_ASKED") }),
      tools: w.tools,
      missions: w.domain.missionRepository,
      tasks: w.domain.tasks,
      businesses: w.businesses,
      processId: "cancel2",
    });

    const result = await service.cancel(
      {
        runtimeId: dispatched.runtimeId,
        handleId: dispatched.handleId,
        executionRecordId: dispatched.executionRecordId,
      },
      { reason: "operator cancelled", authority: w.authority },
    );
    expect(result.cancelled).toBe(true);
    // The audit event exists, and it was written BEFORE the runtime was asked.
    expect(observed[0]).toBe("AUDITED");
    expect(observed.indexOf("AUDITED")).toBeLessThan(observed.indexOf("RUNTIME_ASKED"));
    const record = await w.domain.executionRecords.get(dispatched.executionRecordId);
    expect(record?.audit.map((event) => event.type)).toContain("CANCEL_REQUESTED");
    expect(record?.status).toBe("CANCELLED");
  });
});

/* ══════════════════════════════════════════════════════
   10. NO SECOND LIFECYCLE, NO NEW ERROR VOCABULARY
   ══════════════════════════════════════════════════════ */

describe("Step 5A-4 — reuse, not reinvention", () => {
  it("reuses the Phase-1 policy primitives rather than re-implementing them", () => {
    const service = read("src/modules/workforce/execution/capability-execution-service.ts");
    expect(service).toMatch(/PermissionPolicy/);
    expect(service).toMatch(/evaluateApproval/);
    expect(service).toMatch(/assertMoneySafety/);
    expect(service).toMatch(/classifyRisk/);
    expect(service).toMatch(/BudgetGovernor/);
    expect(service).toMatch(/RUNTIME_DISPATCH_DEFINITION/);
    // ...but it does NOT route a mission task through the Phase-1 job engine.
    expect(service).not.toMatch(/job-runner|JobRunner|AiJob/);
  });

  it("keeps every refusal typed", async () => {
    const w = await harness();
    const denied = await w.execute(
      request(w, { authority: createReconciliationAuthority({ component: "probe" }) }),
    ).catch((error: unknown) => error);
    expect(denied).toBeInstanceOf(AiWorkforceError);
    expect((denied as AiWorkforceError).code).toBe("AUTHORITY_UNRESOLVED");
  });

  it("does not run any deterministic handler when the preflight denies", async () => {
    const w = await harness({ riskLevel: "HIGH", assignmentConstraints: { maxRiskLevel: "LOW" } });
    const outcome = await w.execute(request(w));
    expect(outcome.kind).toBe("DENIED");
    expect(w.deterministicRuns).toBe(0);
  });
});
