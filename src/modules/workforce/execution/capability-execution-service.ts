import { AiWorkforceError, type AiWorkforceErrorCode } from "@/modules/ai-workforce/core/errors";
import {
  createExecutionContext,
  type ExecutionContext,
} from "@/modules/ai-workforce/core/execution-context";
import { RISK_RANK, type Clock, type IdFactory, type JsonObject } from "@/modules/ai-workforce/core/types";
import type { ApprovalRecord } from "@/modules/ai-workforce/approvals/approval-repository";
import {
  DEFAULT_APPROVAL_POLICY,
  evaluateApproval,
  type ApprovalEvaluation,
  type ApprovalPolicy,
} from "@/modules/ai-workforce/approvals/approval-policy";
import {
  DenyVariableAiSpendBudgetGovernor,
  type BudgetGovernor,
} from "@/modules/ai-workforce/policies/budget-governor";
import { assertMoneySafety, isMoneySensitive } from "@/modules/ai-workforce/policies/money-safety";
import { PermissionPolicy, notEvaluatedDecision } from "@/modules/ai-workforce/policies/permission-policy";
import { classifyRisk } from "@/modules/ai-workforce/policies/risk-classification";
import { RUNTIME_DISPATCH_DEFINITION } from "@/modules/ai-workforce/runtime/runtime-dispatch-guard";
import type { ToolDefinition } from "@/modules/ai-workforce/registry/tool-definition";
import type { ToolRegistry } from "@/modules/ai-workforce/registry/tool-registry";

import type { CapabilityRegistry } from "../capabilities/capability-registry";
import type { Capability } from "../capabilities/capability-contracts";
import type { ActorRegistry } from "../actors/actor-registry";
import type { Actor } from "../actors/actor-contracts";
import type { ActorAssignmentService, ActorCapabilityAssignment } from "../assignments/actor-assignment-service";
import type { MissionRepository } from "../missions/mission-repository";
import type { TaskRepository } from "../missions/task-repository";
import type { RuntimeRegistry } from "../runtimes/runtime-registry";
import {
  isAgentExecutionRecovery,
  isTerminalExecutionStatus,
  type AgentExecutionError,
  type AgentExecutionStatus,
} from "../runtimes/agent-runtime";
import type { AgentRuntimeDispatcher } from "../runtimes/agent-runtime-dispatcher";
import {
  assertForegroundAuthority,
  type ExecutionAuthority,
} from "./execution-authority";
import {
  assertBusinessScope,
  type BusinessScopeResolver,
  type ResolvedBusiness,
} from "./authority-resolution";
import {
  claimLeaseTtlForTimeout,
  newInvocationToken,
  type ExecutionClaim,
  type ExecutionClaimRepository,
} from "./execution-claim";
import type { MissionId, TaskId } from "../core/refs";
import { encodeReceiptDetail, type DispatchPreflightReceipt } from "./execution-claim-receipt";
import type { ExecutionRecord, ExecutionRecorder, ExecutionRecordRepository } from "./execution-record";
import type { GovernedDeterministicInvoker } from "./governed-deterministic-invoker";
import {
  executionIdempotencyKeyForAttempt,
  spendClassForBinding,
  type ExecutionAttemptEnvelope,
  type ExecutionAttemptRequest,
  type ExecutionBinding,
  type ExecutionCancellation,
  type ExecutionHandleRef,
  type ExecutionObservation,
  type ExecutionObserveOptions,
  type ExecutionOutcome,
  type ExecutionPreflightResult,
  type ExecutionResolution,
  type MissionAttemptCancellation,
} from "./capability-execution-contracts";

/**
 * CapabilityExecutionService — the ONE execution-policy boundary.
 *
 *   Authenticated authority → MissionOrchestrator → THIS SERVICE
 *     → durable claim → authoritative final preflight → committed DISPATCHING
 *     → governed deterministic handler OR internal runtime dispatcher
 *     → atomic execution record + DISPATCHED → (orchestrator then moves the task)
 *
 * It owns DELIVERY of one attempt. It does not own the mission: it never moves a
 * task, a review or a mission, and it knows nothing about their state machines.
 * `MissionOrchestrator` remains the sole lifecycle authority.
 *
 * THREE RULES THAT ARE STRUCTURAL, NOT COSMETIC:
 *
 *   1. NO EXTERNAL CALL BEFORE A COMMITTED `DISPATCHING`. The claim is won
 *      first, the final preflight is evaluated against freshly re-read state,
 *      and the receipt + `CLAIMED → DISPATCHING` CAS are committed in one
 *      statement. Only then is a runtime or a handler touched. `REDISPATCHABLE_
 *      CLAIM_STATES` deliberately excludes `DISPATCHING`, so no code path can
 *      start a second run for an attempt whose first run may exist.
 *   2. AUTHORITY IS FOREGROUND-ONLY FOR STARTING WORK. `assertForegroundAuthority`
 *      admits an authenticated REQUEST authority and refuses a reconciliation
 *      (background) one, so the recovery sweep can observe and adopt but can
 *      never AUTHORISE a new attempt.
 *   3. THE BUDGET GATE IS NOT NEGOTIABLE. Any `RUNTIME` binding is
 *      `VARIABLE_PROVIDER_COST`, including Hermes and including a runtime that
 *      claims to be free; the shipped governor denies that outright. A human
 *      approval never overrides a budget denial.
 */

/* ═══════════════════════════════════════════════════════
   Approval binding
   ═══════════════════════════════════════════════════════ */

/**
 * The identity an approval must be bound to.
 *
 * An arbitrary `APPROVED` record must NOT authorise "some execution": it must
 * authorise THIS authorization identity. Every field here is derived from
 * durable server-side state, so an approval granted for attempt 1 of task A in
 * business X cannot authorise attempt 2, a different task, or the same task in
 * another business.
 */
export type ApprovalBinding = {
  missionId: string;
  taskId: string;
  attempt: number;
  idempotencyKey: string;
  businessId: string | null;
  actorId: string;
  capabilityId: string;
  capabilityVersion: string | null;
};

/** Where a bound approval comes from. Absent = no approval can ever be found. */
export interface ExecutionApprovalSource {
  /** The approval raised FOR THIS EXACT authorization identity, if one exists. */
  findForAttempt(binding: ApprovalBinding): Promise<ApprovalRecord | null>;
}

/** The deterministic binding identity, usable as an approval's `bindingRef`. */
export function approvalBindingRef(binding: ApprovalBinding): string {
  return [
    `mission:${binding.missionId}`,
    `task:${binding.taskId}`,
    `attempt:${binding.attempt}`,
    `key:${binding.idempotencyKey}`,
    `business:${binding.businessId ?? "-"}`,
    `actor:${binding.actorId}`,
    `capability:${binding.capabilityId}@${binding.capabilityVersion ?? "-"}`,
  ].join("|");
}

/* ═══════════════════════════════════════════════════════
   Dependencies
   ═══════════════════════════════════════════════════════ */

export type CapabilityExecutionServiceDeps = {
  ids: IdFactory;
  now: Clock;
  /** The durable claim ledger — the gate in front of every external call. */
  claims: ExecutionClaimRepository;
  records: ExecutionRecordRepository;
  executions: ExecutionRecorder;
  capabilities: CapabilityRegistry;
  assignments: ActorAssignmentService;
  actors: ActorRegistry;
  runtimes: RuntimeRegistry;
  /**
   * The governed deterministic (in-process, no provider) leg. Its
   * `externalCalls` flag is asserted to be `false` on every use rather than
   * trusted.
   */
  deterministic: GovernedDeterministicInvoker;
  /**
   * The INTERNAL runtime dispatcher. It is deliberately BELOW this service: the
   * orchestrator no longer receives it, so the mission path cannot reach a
   * runtime without first winning a claim and committing `DISPATCHING`.
   */
  dispatcher: AgentRuntimeDispatcher;
  /** Phase-1 permission + risk + money-safety policies, reused unchanged. */
  permissions?: PermissionPolicy;
  approvalPolicy?: ApprovalPolicy;
  approvals?: ExecutionApprovalSource;
  /** REQUIRED by contract. Defaults to the shipped DENY governor. */
  budget?: BudgetGovernor;
  /** Phase-1 tool registry, needed to resolve a TOOL capability's descriptor. */
  tools?: ToolRegistry;
  /** The authoritative business registry, for the canonical scope re-check. */
  businesses?: BusinessScopeResolver;
  /** Missions, read-only, so the canonical business is re-read from durable state. */
  missions?: MissionRepository;
  /**
   * The authoritative mission TASK repository. REQUIRED: the final preflight
   * re-reads the durable task and fails closed unless the request matches it, so
   * a composed service without this can never authorise an execution.
   */
  tasks: TaskRepository;
  /** The durable atomic finalizer. Absent only for the in-memory composition. */
  committer?: ExecutionAttemptCommitterLike;
  /** Stable, non-secret instance label recorded on a receipt. */
  processId?: string;
  /** The configured submission timeout. Lease length is derived from it. */
  submissionTimeoutMs?: number;
  leaseTtlMs?: number;
  /** How long an edge-built authority stays usable. */
  authorityMaxAgeMs?: number;
  /** How long an APPROVED record stays binding. */
  approvalTtlMs?: number;
};

/** The narrow shape the service needs of the durable finalizer. */
export interface ExecutionAttemptCommitterLike {
  commitDispatched(input: {
    claimId: string;
    invocationToken: string;
    record: ExecutionRecord;
    runtimeId?: string;
  }): Promise<{ record: ExecutionRecord; claim: ExecutionClaim }>;
}

export const DEFAULT_SUBMISSION_TIMEOUT_MS = 120_000;
/** An approval older than this no longer binds a NEW attempt. */
export const DEFAULT_APPROVAL_TTL_MS = 24 * 60 * 60_000;
/**
 * How far ahead of the service clock a decision timestamp may be.
 *
 * Generous enough for ordinary clock skew between the process that DECIDED and
 * the process that AUTHORISES, and far too small for anything else. A timestamp
 * materially in the future is not a decision that has happened, so it is refused
 * rather than treated as fresh indefinitely.
 */
export const APPROVAL_CLOCK_SKEW_MS = 5 * 60_000;

/**
 * The refusals that mean "this request is not the canonical attempt at all".
 *
 * They are the ONLY refusals the execution boundary may reach BEFORE it touches
 * the delivery ledger (Step 5A-4 correction, P1-3). Every other refusal — budget,
 * approval, risk, money safety, permission, human-in-the-loop — is decided AFTER
 * the claim, so the attempt is recorded and RELEASED rather than left
 * unaccounted for.
 *
 * The distinction is what stops claim classification from disclosing metadata:
 * `REPLAYED`, `IN_PROGRESS`, `UNVERIFIED` and `CANCELLED` all describe an
 * EXISTING attempt, so a caller whose mission/task/actor/capability/input does not
 * match durable state must be refused before any such answer can be produced.
 */
export const CANONICAL_IDENTITY_REFUSAL_CODES: readonly AiWorkforceErrorCode[] = [
  "AUTHORITY_UNRESOLVED",
  "PERSISTENCE_UNAVAILABLE",
  "MISSION_NOT_FOUND",
  "BUSINESS_SCOPE_DENIED",
  "EXECUTION_TASK_MISMATCH",
  "INVALID_MISSION_TRANSITION",
  "ACTOR_NOT_FOUND",
  "ACTOR_DISABLED",
  "CAPABILITY_NOT_FOUND",
  "CAPABILITY_VERSION_CONFLICT",
  "TOOL_DISABLED",
  "INVALID_ASSIGNMENT",
  "SCOPE_MISSING",
  "RUNTIME_NOT_FOUND",
  "RUNTIME_UNSUPPORTED",
];

/* ═══════════════════════════════════════════════════════
   The service
   ═══════════════════════════════════════════════════════ */

export class DefaultCapabilityExecutionService {
  private readonly permissions: PermissionPolicy;
  private readonly approvalPolicy: ApprovalPolicy;
  private readonly budget: BudgetGovernor;
  private readonly submissionTimeoutMs: number;
  private readonly leaseTtlMs: number;
  private readonly approvalTtlMs: number;
  private readonly authorityMaxAgeMs?: number;
  private readonly processId: string;

  constructor(private readonly deps: CapabilityExecutionServiceDeps) {
    this.permissions = deps.permissions ?? new PermissionPolicy();
    this.approvalPolicy = deps.approvalPolicy ?? DEFAULT_APPROVAL_POLICY;
    // The FAIL-CLOSED default. A composition that forgets the governor gets the
    // DENY one, never an implicit allow.
    this.budget = deps.budget ?? new DenyVariableAiSpendBudgetGovernor();
    this.submissionTimeoutMs = deps.submissionTimeoutMs ?? DEFAULT_SUBMISSION_TIMEOUT_MS;
    this.leaseTtlMs = deps.leaseTtlMs ?? claimLeaseTtlForTimeout(this.submissionTimeoutMs);
    this.approvalTtlMs = deps.approvalTtlMs ?? DEFAULT_APPROVAL_TTL_MS;
    if (deps.authorityMaxAgeMs !== undefined) this.authorityMaxAgeMs = deps.authorityMaxAgeMs;
    this.processId = deps.processId ?? `pid${typeof process !== "undefined" && process.pid ? process.pid : "0"}`;
  }

  /* ═══════════════════════════════════════════════════
     Preflight — pure, no writes, no I/O
     ═══════════════════════════════════════════════════ */

  async preflight(request: ExecutionAttemptRequest): Promise<ExecutionPreflightResult> {
    const capabilityView: ExecutionPreflightResult["capability"] = {
      id: request.requiredCapabilityId,
      ...(request.requiredCapabilityVersion ? { version: request.requiredCapabilityVersion } : {}),
      resolved: false,
      kind: "TOOL",
      riskLevel: "LOW",
      readWriteMode: "READ",
      approvalRequirement: "NONE",
      runtimeRequirements: {},
    };
    const unresolved: ExecutionPreflightResult = {
      capability: capabilityView,
      resolution: null,
      descriptor: null,
      binding: "HUMAN",
      spend: "NO_VARIABLE_COST",
      permission: notEvaluatedDecision(""),
      approval: null,
      budget: {
        allowed: false,
        reason: "BUDGET_DENIED_UNCLASSIFIED",
        policyRef: this.budget.policyRef,
        spend: "NO_VARIABLE_COST",
        detail: "not evaluated",
      },
      // Placeholder only: the governor has not been asked yet.
      budgetEvaluated: false,
      decision: "DENY",
    };

    const deny = (
      code: AiWorkforceErrorCode,
      text: string,
      extra: Partial<ExecutionPreflightResult> = {},
    ): ExecutionPreflightResult => ({
      ...unresolved,
      permission: notEvaluatedDecision(text),
      blocked: { code, message: text },
      ...extra,
    });

    // ── GATE 0. Authority validity and its request deadline. ──
    try {
      assertForegroundAuthority(request.authority, {
        now: this.deps.now(),
        ...(this.authorityMaxAgeMs ? { maxAgeMs: this.authorityMaxAgeMs } : {}),
      });
    } catch (error) {
      return deny("AUTHORITY_UNRESOLVED", message(error));
    }

    // ── GATE 1. Mission + canonical business scope, read from DURABLE state. ──
    // FAIL CLOSED when the mission authority is absent: skipping the scope check
    // would turn a missing dependency into a wider authority, which is exactly
    // the class of bug this gate exists for. A mission that names a business
    // needs the registry too, and an unverifiable business is a refusal.
    if (!this.deps.missions) {
      return deny("PERSISTENCE_UNAVAILABLE", "No mission authority is composed; the canonical mission scope cannot be verified");
    }
    const mission = await this.deps.missions.get(request.missionId);
    if (!mission) {
      return deny("MISSION_NOT_FOUND", `Mission "${request.missionId}" does not exist`);
    }
    let business: ResolvedBusiness | null = null;
    if (mission.businessId) {
      if (!this.deps.businesses) {
        return deny(
          "BUSINESS_SCOPE_DENIED",
          `Mission "${mission.id}" names business "${mission.businessId}", but no business registry is composed to verify it`,
        );
      }
      const resolved = await this.deps.businesses.resolve(mission.businessId);
      if (!resolved) {
        return deny(
          "BUSINESS_SCOPE_DENIED",
          `Mission "${mission.id}" names business "${mission.businessId}", which cannot be verified`,
        );
      }
      business = resolved;
    }
    try {
      // A payload business reference may NARROW the mission scope but never
      // widen it: the scope checked is the MISSION's canonical one.
      assertBusinessScope(request.authority, business);
    } catch (error) {
      return deny("BUSINESS_SCOPE_DENIED", message(error));
    }

    // ── GATE 1b. The AUTHORITATIVE task re-read (Step 5A-4 correction). ──
    // The caller's assertions are NOT the source of truth. Before executing, the
    // durable task is loaded and the request must match it exactly, so a
    // substituted actor / capability / version / attempt / input cannot ride a
    // request the orchestrator never built.
    const task = await this.deps.tasks.get(request.taskId);
    if (!task) {
      return deny("MISSION_NOT_FOUND", `Task "${request.taskId}" does not exist`);
    }
    if (task.missionId !== request.missionId) {
      return deny("EXECUTION_TASK_MISMATCH", `Task "${task.id}" belongs to mission "${task.missionId}", not "${request.missionId}"`);
    }
    if (task.assignedActorId !== request.assignedActorId) {
      return deny(
        "EXECUTION_TASK_MISMATCH",
        `Task "${task.id}" is assigned to actor "${task.assignedActorId ?? "-"}", not the requested "${request.assignedActorId}"`,
      );
    }
    if (task.requiredCapabilityId !== request.requiredCapabilityId) {
      return deny(
        "EXECUTION_TASK_MISMATCH",
        `Task "${task.id}" requires capability "${task.requiredCapabilityId ?? "-"}", not the requested "${request.requiredCapabilityId}"`,
      );
    }
    if ((task.requiredCapabilityVersion ?? null) !== (request.requiredCapabilityVersion ?? null)) {
      return deny(
        "EXECUTION_TASK_MISMATCH",
        `Task "${task.id}" pins capability version "${task.requiredCapabilityVersion ?? "-"}", but the request supplied "${request.requiredCapabilityVersion ?? "-"}"`,
      );
    }
    // The AUTHORITATIVE attempt, in two shapes (Step 5A-4 correction):
    //
    //   FRESH  `attempt + 1` — a NEW run. It may only be started from a task the
    //          state machine says is dispatchable (READY or RUNNING).
    //   KNOWN  an attempt this task has ALREADY entered (`1..task.attempt`) — a
    //          replay/adopt. It is admissible from ANY task state, because the
    //          DELIVERY LEDGER decides what becomes of it (REPLAYED, IN_PROGRESS,
    //          UNVERIFIED) and no new external run can start for an attempt that
    //          was already entered. The previous rule also demanded RUNNING here,
    //          which refused the legitimate replay of a task that had since
    //          reached a terminal state — a valid retry/read path, not an attack.
    //
    // Anything else fails closed.
    if (!Number.isInteger(request.attempt) || request.attempt < 1) {
      return deny("EXECUTION_TASK_MISMATCH", `Attempt ${request.attempt} is not a 1-based attempt number`);
    }
    const freshAttempt = task.attempt + 1;
    const isFreshAttempt = request.attempt === freshAttempt;
    const isKnownAttempt = request.attempt <= task.attempt;
    if (!isFreshAttempt && !isKnownAttempt) {
      return deny(
        "EXECUTION_TASK_MISMATCH",
        `Task "${task.id}" is at attempt ${task.attempt} (${task.state}); request attempt ${request.attempt} is neither the next attempt (${freshAttempt}) nor an attempt this task has already entered`,
      );
    }
    if (!sameJson(task.input, request.input)) {
      return deny("EXECUTION_TASK_MISMATCH", `The request input does not match the canonical input of task "${task.id}"`);
    }
    if (isFreshAttempt && task.state !== "READY" && task.state !== "RUNNING") {
      return deny(
        "INVALID_MISSION_TRANSITION",
        `Task "${task.id}" is ${task.state}; only a READY or RUNNING task may start a new attempt`,
      );
    }

    // ── GATE 2. The actor must be executable RIGHT NOW (lifecycle re-read). ──
    const actor = await this.deps.actors.get(request.assignedActorId);
    if (!actor) {
      return deny("ACTOR_NOT_FOUND", `Actor "${request.assignedActorId}" is not registered`);
    }
    if (actor.lifecycle === "DISABLED") {
      return deny("ACTOR_DISABLED", `Actor "${actor.slug}" is DISABLED and may not execute`);
    }
    if (actor.lifecycle === "DRAFT") {
      return deny("ACTOR_DISABLED", `Actor "${actor.slug}" is DRAFT and has not been commissioned`);
    }

    // ── GATE 3. The capability must be ACTIVE at the EXACT version. ──
    const capability = await this.deps.capabilities.get(
      request.requiredCapabilityId,
      request.requiredCapabilityVersion,
    );
    if (!capability) {
      return deny(
        "CAPABILITY_NOT_FOUND",
        `Capability "${request.requiredCapabilityId}${request.requiredCapabilityVersion ? `@${request.requiredCapabilityVersion}` : ""}" does not exist`,
      );
    }
    // A pinned version must resolve EXACTLY. `get()` already enforces that, but
    // the check is repeated against the resolved object so a registry that ever
    // loosened would still fail closed here.
    if (request.requiredCapabilityVersion && capability.version !== request.requiredCapabilityVersion) {
      return deny(
        "CAPABILITY_NOT_FOUND",
        `Capability "${capability.id}" resolved to version "${capability.version}", not the pinned "${request.requiredCapabilityVersion}"`,
      );
    }
    if (capability.status !== "ACTIVE") {
      return deny(
        "TOOL_DISABLED",
        `Capability "${capability.id}@${capability.version}" is ${capability.status} and cannot be dispatched`,
      );
    }
    Object.assign(capabilityView, {
      resolved: true,
      version: capability.version,
      kind: capability.kind,
      riskLevel: capability.riskLevel,
      readWriteMode: "READ" as const,
      approvalRequirement: capability.approvalRequirement,
      runtimeRequirements: capability.runtimeRequirements,
    });

    // ── GATE 4. The ASSIGNMENT edge, re-read (revocations win immediately). ──
    const assignment = this.findAssignment(actor, capability);
    if (!assignment) {
      return deny(
        "INVALID_ASSIGNMENT",
        `Actor "${actor.slug}" holds no ACTIVE assignment for capability "${capability.id}@${capability.version}"`,
      );
    }
    const constraintProblem = this.checkAssignmentConstraints(assignment, capability, business);
    if (constraintProblem) return deny(constraintProblem.code, constraintProblem.message);

    // ── GATE 5. Which leg executes, and its EXACT local binding. ──
    const binding = this.resolveBinding(capability, actor);
    let resolvedTool: ToolDefinition | null = null;
    if (binding === "DETERMINISTIC") {
      resolvedTool = this.deps.tools?.getDefinition(capability.id) ?? null;
      if (!resolvedTool) {
        return deny(
          "CAPABILITY_NOT_FOUND",
          `Capability "${capability.id}" is deterministic, but no local handler is registered for it`,
        );
      }
      // CAPABILITY IDENTITY IS id + version. A handler may run ONLY at the
      // authorised version: resolving by id and executing whatever is registered
      // would let an authorised `x@2.0.0` run the `x@1.0.0` contract.
      if (resolvedTool.version !== capability.version) {
        return deny(
          "CAPABILITY_VERSION_CONFLICT",
          `Capability "${capability.id}" was authorised at version "${capability.version}", but the local registry holds "${resolvedTool.version}"`,
        );
      }
    }
    const descriptor: ToolDefinition = resolvedTool ?? RUNTIME_DISPATCH_DEFINITION;

    if (binding === "RUNTIME") {
      // The RUNTIME leg must resolve to a live binding before anything else is
      // decided. The binding's identity is not copied into the preflight result:
      // the claim row already carries the runtime, and a second copy here could
      // only drift from it.
      const runtimeProblem = this.checkRuntimeBinding(capability, actor);
      if (runtimeProblem) return deny(runtimeProblem.code, runtimeProblem.message);
    }

    // ── GATE 6. Permission policy, over the SESSION-derived authority. ──
    const context = this.executionContextFor({ request, authority: request.authority, business, capability, assignment });
    const permission = this.permissions.evaluate(descriptor, context, request.input as Record<string, unknown>);
    if (!permission.allowed) {
      return deny(
        permission.reason === "SCOPE_DENIED" ? "SCOPE_DENIED" : permission.reason === "SCOPE_MISSING" ? "SCOPE_MISSING" : "PERMISSION_DENIED",
        permission.detail ?? `Permission denied for "${capability.id}"`,
        { permission },
      );
    }

    // ── GATE 7. Risk policy: a declared level below its own semantics is a lie. ──
    const minimumRisk = classifyRisk({
      readWriteMode: descriptor.readWriteMode,
      action: descriptor.action,
      moneySensitive: isMoneySensitive(descriptor),
    });
    if (RISK_RANK[descriptor.riskLevel] < RISK_RANK[minimumRisk]) {
      return deny(
        "INVALID_TOOL_DEFINITION",
        `Capability "${descriptor.id}" declares risk ${descriptor.riskLevel} but its semantics require at least ${minimumRisk}`,
        { permission },
      );
    }

    // ── GATE 8. Money safety, at dispatch time as well as registration. ──
    try {
      assertMoneySafety(descriptor);
    } catch (error) {
      return deny("MONEY_SAFETY_VIOLATION", message(error), { permission });
    }

    // ── The IMMUTABLE AUTHORITATIVE RESOLUTION (Step 5A-4 correction). ──
    // Built ONCE, from durable state re-read above. The receipt, the
    // descriptor binding, the handler invocation and the runtime submission all
    // read from THIS object — never from nullable caller fields — so authorisation
    // and execution cannot describe two different attempts.
    const spend = spendClassForBinding(binding, { runtimeDeclaresNoVariableCost: false });
    const resolution: ExecutionResolution = {
      missionId: mission.id,
      taskId: task.id,
      attempt: request.attempt,
      actorId: actor.id,
      capabilityId: capability.id,
      capabilityVersion: capability.version,
      assignmentId: assignment.id,
      businessId: business?.id ?? null,
      businessSlug: business?.slug ?? null,
      runtimeId: binding === "RUNTIME" ? actor.runtimeBinding?.runtimeId ?? null : this.deps.deterministic.id,
      toolDefinitionId: resolvedTool?.id ?? null,
      toolDefinitionVersion: resolvedTool?.version ?? null,
      binding,
      spend,
    };

    // ── GATE 9. Approval, BOUND to this exact authorization identity. ──
    const approvalBinding = this.approvalBindingFor(resolution);
    const boundApproval = this.deps.approvals
      ? await this.deps.approvals.findForAttempt(approvalBinding)
      : null;
    const approvalProblem = this.checkApprovalBinding(boundApproval, resolution);
    if (approvalProblem) return deny(approvalProblem.code, approvalProblem.message, { permission });

    // The MOST RESTRICTIVE approval requirement, computed from AUTHORITATIVE
    // sources: the capability contract, the assignment edge, the actor policy and
    // the tool/risk policy. A capability-REQUIRED / assignment-forced /
    // actor-demanded approval requires an EXPLICIT bound APPROVED record; human
    // presence can never stand in for it.
    //
    // ACTOR POLICY IS PART OF THAT CALCULATION (Step 5A-4 correction).
    // The actor's own `approvalPolicy` used to be consulted ONLY for `ALWAYS`, so
    // a `RISK_AT_LEAST` threshold an actor declared for itself was silently
    // IGNORED — the one control the actor's own owner set was the one the
    // execution boundary never read. It is merged here (most restrictive wins)
    // into the policy the evaluation actually uses, so it changes a decision.
    const effectiveApprovalPolicy = this.effectiveApprovalPolicy(actor);
    const explicitApprovalRequired =
      capability.approvalRequirement === "REQUIRED" ||
      assignment.constraints?.requireApproval === true ||
      effectiveApprovalPolicy.mode === "ALWAYS";

    let approval: ApprovalEvaluation;
    if (explicitApprovalRequired) {
      const approved = boundApproval?.status === "APPROVED" ? boundApproval : null;
      approval = approved
        ? {
            toolId: descriptor.id,
            riskLevel: descriptor.riskLevel,
            required: true,
            satisfied: true,
            reason: "APPROVAL_APPROVED",
            approvalId: approved.id,
          }
        : {
            toolId: descriptor.id,
            riskLevel: descriptor.riskLevel,
            required: true,
            satisfied: false,
            reason: boundApproval?.status === "REJECTED" ? "APPROVAL_REJECTED" : "APPROVAL_MISSING",
            ...(boundApproval ? { approvalId: boundApproval.id } : {}),
          };
    } else {
      approval = evaluateApproval({
        tool: descriptor,
        // The MERGED policy, not the composition's alone: an actor's declared
        // threshold must be able to require an approval the composition would
        // otherwise have let through.
        policy: effectiveApprovalPolicy,
        context: boundApproval ? { ...context, approvalId: boundApproval.id } : context,
        approval: boundApproval,
      });
    }

    // ── GATE 10. Budget. Any RUNTIME binding is variable provider cost. ──
    const budget = await this.budget.evaluate({
      capabilityId: capability.id,
      capabilityVersion: capability.version,
      spend,
      actorId: actor.id,
      missionId: request.missionId,
      taskId: request.taskId,
      attempt: request.attempt,
      riskLevel: descriptor.riskLevel,
      correlationId: request.authority.correlationId,
    });
    if (!budget.allowed) {
      // Deliberately BEFORE any approval shortcut: an approval can never turn a
      // budget refusal into a dispatch. TYPED as BUDGET_POLICY_DENIED so a
      // durable reader can tell "you may not SPEND" from "you may not" without
      // parsing a message; the governor's own reason is preserved in `budget`.
      return deny(
        "BUDGET_POLICY_DENIED",
        `Budget governor "${budget.policyRef}" refused this execution: ${budget.reason}`,
        { permission, approval, budget, budgetEvaluated: true, decision: "DENY" },
      );
    }

    const base: ExecutionPreflightResult = {
      capability: capabilityView,
      resolution,
      descriptor,
      binding,
      spend,
      permission,
      approval,
      budget,
      budgetEvaluated: true,
      decision: "DISPATCH",
    };

    if (binding === "HUMAN") {
      return {
        ...base,
        decision: "WAIT_HUMAN",
        blocked: {
          code: "NOT_IMPLEMENTED",
          message: `Capability "${capability.id}" requires a person; no execution attempt is created`,
        },
      };
    }
    if (!approval.satisfied) {
      if (approval.reason === "CRITICAL_FORBIDDEN_AUTONOMOUS") {
        return { ...base, decision: "DENY", blocked: { code: "CRITICAL_AUTONOMY_FORBIDDEN", message: "CRITICAL work may not run without a human decision" } };
      }
      if (approval.reason === "APPROVAL_REJECTED") {
        return { ...base, decision: "DENY", blocked: { code: "APPROVAL_REJECTED", message: "The bound approval was rejected" } };
      }
      return {
        ...base,
        decision: "WAIT_APPROVAL",
        blocked: {
          code: "APPROVAL_REQUIRED",
          message: `Capability "${capability.id}" requires an approval bound to this attempt (${approval.reason})`,
        },
      };
    }
    return base;
  }

  /* ═══════════════════════════════════════════════════
     Execute — the ONLY mutating entry point
     ═══════════════════════════════════════════════════ */

  async execute(request: ExecutionAttemptRequest): Promise<ExecutionOutcome> {
    // (0) IMMUTABLE ENVELOPE (Step 5A-4 correction, P1-9). Taken SYNCHRONOUSLY,
    //     before the first `await`, so everything below reads the boundary's own
    //     frozen copies of the canonical input and the authenticated authority.
    //     A caller that mutates `request.input` while a preflight awaits can
    //     therefore no longer change what is authorised, receipted or executed.
    const env = this.envelopeFor(request);

    // (1) The authority is checked BEFORE anything is written, so an
    //     unauthorised call creates no durable claim row at all.
    const authority = assertForegroundAuthority(env.authority, {
      now: this.deps.now(),
      ...(this.authorityMaxAgeMs ? { maxAgeMs: this.authorityMaxAgeMs } : {}),
    });
    const actorForClaim = await this.deps.actors.get(env.assignedActorId);
    const runtimeBindingId = actorForClaim?.runtimeBinding?.runtimeId;

    // (2) The idempotency identity is DERIVED, unconditionally, inside this
    //     boundary (Step 5A-4 correction, P1-2). A caller-supplied key is NOT
    //     consulted: it used to WIN over the derived one, which let a caller
    //     reserve `(task, attempt)` under an arbitrary key and then make the
    //     legitimate orchestration call fail with ATTEMPT_IDEMPOTENCY_MISMATCH.
    const idempotencyKey = env.idempotencyKey;

    // (3) CANONICAL AUTHORIZATION BEFORE THE CLAIM (Step 5A-4 correction, P1-3).
    //     `REPLAYED`, `IN_PROGRESS`, `UNVERIFIED` and `CANCELLED` all describe an
    //     EXISTING attempt, so they must not be reachable by a request whose
    //     mission/task/actor/capability/input does not match durable state. The
    //     identity gates are therefore evaluated FIRST, and only an identity
    //     refusal short-circuits here; every policy refusal (budget, approval,
    //     risk, permission) is still decided after the claim, so the attempt is
    //     recorded and RELEASED rather than left unaccounted for.
    const authorization = await this.preflight(env);
    if (authorization.resolution === null && authorization.blocked) {
      if (CANONICAL_IDENTITY_REFUSAL_CODES.includes(authorization.blocked.code)) {
        return { kind: "DENIED", code: authorization.blocked.code, message: authorization.blocked.message };
      }
    }

    // (4) A UNIQUE invocation token for THIS call — never a process id.
    const invocationToken = newInvocationToken({
      processId: this.processId,
      ids: this.deps.ids,
      now: this.deps.now,
    });

    // (5) Win or classify the durable claim BEFORE any external I/O.
    const outcome = await this.deps.claims.claim({
      missionId: env.missionId,
      taskId: env.taskId,
      attempt: env.attempt,
      idempotencyKey,
      actorId: env.assignedActorId,
      capabilityId: env.requiredCapabilityId,
      ...(runtimeBindingId ? { runtimeId: runtimeBindingId } : {}),
      leaseOwner: invocationToken,
      leaseTtlMs: this.leaseTtlMs,
    });

    // (5) Every non-dispatchable outcome is handled WITHOUT external execution.
    switch (outcome.kind) {
      case "REPLAYED":
        return {
          kind: "REPLAYED",
          claimId: outcome.claim.id,
          executionRecordId: outcome.claim.executionRecordId!,
          handleId: outcome.claim.handleId!,
          runtimeId: outcome.claim.runtimeId ?? "",
        };
      case "IN_PROGRESS":
        return { kind: "IN_PROGRESS", claimId: outcome.claim.id };
      case "UNVERIFIED":
        return { kind: "UNVERIFIED", claimId: outcome.claim.id, detail: outcome.detail };
      case "CANCELLED":
        // A cancellation WON this attempt's key before dispatch was entered, so
        // this invocation must not dispatch it. Fail closed and report it.
        return {
          kind: "DENIED",
          claimId: outcome.claim.id,
          code: "EXECUTION_RESERVATION_UNRESOLVED",
          message: "this attempt was cancelled before dispatch was entered and cannot execute",
        };
      case "CLAIMED":
      case "RECLAIMED":
        break;
      default:
        // Exhaustive by construction: a new outcome kind must be handled here.
        throw new AiWorkforceError("PERSISTENCE_UNAVAILABLE", "Unknown execution claim outcome", {
          kind: (outcome as { kind: string }).kind,
        });
    }

    const claim = outcome.claim;

    // (6) FINAL preflight, against state re-read NOW (not a planning snapshot).
    //     It is deliberately evaluated AGAIN rather than reusing the pass above:
    //     this is the authoritative decision, taken at the moment the attempt is
    //     entered, and every gate is re-read from durable state for it.
    const preflight = await this.preflight(env);
    if (preflight.decision !== "DISPATCH") {
      // (7) A refusal BEFORE dispatch: the claim is RELEASED, so no run exists
      //     and the attempt stays free. No adapter or runtime was touched.
      await this.deps.claims.release(claim.id, {
        invocationToken,
        detail: this.refusalDetail(preflight),
      });
      return this.outcomeForRefusal(claim.id, preflight);
    }

    // (8) The receipt + the CLAIMED → DISPATCHING transition, in ONE statement.
    //     THIS IS THE AUTHORIZATION LINEARIZATION POINT: nothing external may
    //     happen before it commits.
    const receipt = this.buildReceipt({ request: env, authority, preflight, claim, idempotencyKey });
    const entered = await this.deps.claims.markDispatching(claim.id, {
      invocationToken,
      leaseTtlMs: this.leaseTtlMs,
      // The ENVELOPE, not a bare receipt: only the envelope survives a later
      // doubt note intact (see `encodeReceiptDetail`).
      receiptDetail: encodeReceiptDetail(receipt),
    });
    if (!entered) {
      // Someone else moved the claim between the win and this CAS. Fail closed:
      // report in-progress rather than executing on a lease we no longer own.
      return { kind: "IN_PROGRESS", claimId: claim.id };
    }

    // (9) ONLY NOW may the external leg be entered — with the FROZEN envelope,
    //     so the input handed to the handler is the input that was authorised.
    const delivered = await this.deliver({ request: env, preflight, invocationToken });
    if (!delivered.handle) {
      // (10) Timeout / ambiguous transport / refusal with no handle: UNVERIFIED.
      //      NEVER RELEASED (a run may exist), NEVER redispatched.
      await this.deps.claims.markUnverified(claim.id, delivered.detail);
      return { kind: "UNVERIFIED", claimId: claim.id, detail: delivered.detail };
    }

    // (11) Finalize ATOMICALLY: execution record + DISPATCHED, one transaction.
    return this.finalize({
      request: env,
      preflight,
      claim,
      invocationToken,
      idempotencyKey,
      handle: delivered.handle,
    });
  }

  /* ═══════════════════════════════════════════════════
     Observe / cancel
     ═══════════════════════════════════════════════════ */

  /** Reads what became of an execution. Never dispatches. */
  async observe(
    ref: ExecutionHandleRef,
    options: ExecutionObserveOptions = {},
  ): Promise<ExecutionObservation> {
    const runtime = this.deps.runtimes.get(ref.runtimeId);
    if (!runtime) {
      return {
        kind: "NO_RUNTIME",
        status: "UNKNOWN",
        detail: `No runtime is registered for id "${ref.runtimeId}"`,
      };
    }
    try {
      if (isAgentExecutionRecovery(runtime)) {
        const adoption = await runtime.adoptExecution({
          handleId: ref.handleId,
          runtimeId: ref.runtimeId,
          ...(ref.missionId ? { missionId: ref.missionId } : {}),
          ...(ref.taskId ? { taskId: ref.taskId } : {}),
        });
        if (adoption.kind === "UNAVAILABLE") {
          return { kind: "UNAVAILABLE", status: "UNKNOWN", detail: adoption.detail };
        }
        if (adoption.kind === "UNKNOWN") {
          return { kind: "UNVERIFIED", status: "UNKNOWN", detail: adoption.detail };
        }
        // ADOPTION RESOLVES THE HANDLE, IT DOES NOT REPLACE THE WAIT. When the
        // caller asked to WAIT for an end state, a still-running adopted
        // execution must NOT be returned as an immediate non-terminal answer —
        // that is what silently turned `settleTask` into "report whatever is
        // true now". Fall through to the bounded wait path instead, which
        // honours `waitTimeoutMs`.
        if (!options.waitForTerminal || isTerminalExecutionStatus(adoption.record.status)) {
          return {
            kind: "ADOPTED",
            status: adoption.record.status,
            detail: `re-adopted from the runtime; it reports ${adoption.record.status}`,
            ...(adoption.record.providerExecutionId ? { providerExecutionId: adoption.record.providerExecutionId } : {}),
            // The adopted record IS the provider's own result, so its output is
            // carried back rather than left behind on a runtime the caller cannot
            // reach.
            ...(adoption.record.output !== undefined ? { output: adoption.record.output } : {}),
            ...(adoption.record.outputText !== undefined ? { outputText: adoption.record.outputText } : {}),
            ...(adoption.record.error ? { error: adoption.record.error } : {}),
          };
        }
      }

      // The wait leg is the SAME governed primitive the pre-cutover `settle`
      // used — still below this service, still never a dispatch. It exists so
      // `settleTask` keeps meaning "wait for the end state", instead of
      // reporting an in-flight run as a state a human must adjudicate.
      const outcome = options.waitForTerminal
        ? await this.deps.dispatcher.waitForExecution(
            { runtimeId: ref.runtimeId, handleId: ref.handleId },
            options.waitTimeoutMs ? { timeoutMs: options.waitTimeoutMs } : undefined,
          )
        : await this.deps.dispatcher.getExecution({
            runtimeId: ref.runtimeId,
            handleId: ref.handleId,
          });
      if (!outcome.dispatched) {
        const code = outcome.error?.code;
        // THE TYPED TIMEOUT ARRIVES HERE (Step 5A-4 correction, P1-2). The
        // dispatcher converts a runtime's own `RUNTIME_TIMEOUT` into a
        // non-dispatching outcome while PRESERVING the code — and this branch used
        // to flatten every such outcome into `UNAVAILABLE`, which is how "still in
        // flight" became "the provider is unreachable".
        if (code === "RUNTIME_TIMEOUT") {
          return await this.observeAfterTimeout(
            ref,
            outcome.error?.message ?? "the runtime did not reach an end state within the wait",
          );
        }
        if (code === "RUN_NOT_FOUND") {
          return {
            kind: "UNVERIFIED",
            status: "UNKNOWN",
            detail: outcome.error?.message ?? "the runtime no longer knows this execution",
          };
        }
        return {
          kind: "UNAVAILABLE",
          status: "UNKNOWN",
          detail: outcome.error?.message ?? "the runtime could not be asked about this execution",
        };
      }
      // The runtime's OWN record is used EXCLUSIVELY when it exists, because it
      // carries both the untruncated output and the RAW error — and the error's
      // `retryable` flag is what decides whether the orchestrator may take the
      // retry edge. The dispatcher's flattened `error` has already lost that
      // category (`TOOL_EXECUTION_FAILED`), so it is deliberately NOT used as a
      // fallback: inventing "retryable" from it would authorise a second run of
      // work that may only have failed once, which is exactly the duplicate this
      // cutover exists to prevent. A missing record therefore reports no error,
      // which fails closed (no retry).
      const reported = outcome.execution;
      return {
        kind: "KNOWN",
        status: outcome.status ?? outcome.handle?.status ?? "UNKNOWN",
        detail: "the runtime reported the current state",
        ...(reported?.providerExecutionId ? { providerExecutionId: reported.providerExecutionId } : {}),
        ...(reported
          ? reported.output !== undefined
            ? { output: reported.output }
            : {}
          : outcome.output !== undefined
            ? { output: outcome.output }
            : {}),
        ...(reported?.outputText !== undefined ? { outputText: reported.outputText } : {}),
        ...(reported?.error ? { error: reported.error } : {}),
      };
    } catch (error) {
      // A TYPED TIMEOUT IS NOT AN OUTAGE (Step 5A-4 correction, P1-2). The
      // bounded wait expiring says the runtime did not answer IN TIME — not that
      // it could not be reached. Flattening the two made a caller that asked to
      // WAIT see a runtime outage, and the orchestrator then threw
      // RUNTIME_UNAVAILABLE, turning "still working" into "the provider is
      // unreachable". The distinction is preserved and, where the runtime can
      // still be read non-blockingly, its real state is carried back.
      if (isRuntimeTimeout(error)) return await this.observeAfterTimeout(ref, message(error));
      // Any OTHER throw IS an outage: nothing is learned and nothing is fabricated.
      return { kind: "UNAVAILABLE", status: "UNKNOWN", detail: message(error) };
    }
  }

  /**
   * What to report when the bounded wait elapsed.
   *
   * ONE non-blocking read is attempted, because a runtime that timed out on the
   * LONG wait may answer the SHORT question immediately — and if it has in fact
   * finished, that is knowledge and is reported as such. The read never waits and
   * never resubmits, so it cannot delay the caller further or start anything.
   */
  private async observeAfterTimeout(ref: ExecutionHandleRef, detail: string): Promise<ExecutionObservation> {
    try {
      const outcome = await this.deps.dispatcher.getExecution({
        runtimeId: ref.runtimeId,
        handleId: ref.handleId,
      });
      if (outcome.dispatched) {
        const reported = outcome.execution;
        const status = outcome.status ?? outcome.handle?.status ?? "UNKNOWN";
        if (isTerminalExecutionStatus(status)) {
          return {
            kind: "KNOWN",
            status,
            detail: "the bounded wait elapsed, but the runtime reports the execution has since reached a terminal state",
            ...(reported?.providerExecutionId ? { providerExecutionId: reported.providerExecutionId } : {}),
            ...(reported?.output !== undefined ? { output: reported.output } : {}),
            ...(reported?.outputText !== undefined ? { outputText: reported.outputText } : {}),
            ...(reported?.error ? { error: reported.error } : {}),
          };
        }
        return {
          kind: "TIMEOUT",
          status,
          detail: `${detail}; the runtime still reports ${status}, so nothing was settled`,
        };
      }
    } catch {
      // Fall through: a failed follow-up read proves nothing either way.
    }
    return {
      kind: "TIMEOUT",
      status: "UNKNOWN",
      detail: `${detail}; the execution was NOT cancelled and can still be observed or cancelled`,
    };
  }

  /**
   * Cancels an execution THROUGH the runtime port, and only ever with an
   * authority.
   *
   * ORDER MATTERS AND IS AUDITED: the `CANCEL_REQUESTED` event is durable BEFORE
   * the external cancellation is attempted, so a crash mid-cancel leaves a
   * record of the intent rather than a silent no-op. An unauthenticated caller
   * cannot reach the runtime by this path at all.
   */
  async cancel(
    ref: ExecutionHandleRef,
    input: { reason: string; authority: ExecutionAuthority },
  ): Promise<ExecutionCancellation> {
    // AUTHORITY, RE-CHECKED (Step 5A-4 correction). This used to test only "is it
    // an object?", which is not an authority check at all: a hand-built look-alike,
    // an EXPIRED authority, a background RECONCILIATION authority, or a caller
    // whose session does not reach the mission's business all passed it. The same
    // foreground gate the dispatch path uses is applied here — including the
    // request deadline and the mission's canonical business scope.
    const authority = await this.assertCancellationAuthority(input.authority, ref.missionId);
    // Persist the INTENT first (audit spine), then perform the side effect.
    if (ref.executionRecordId) {
      await this.deps.executions.recordCancellationRequested(ref.executionRecordId, {
        requestedBy: authority.actorId,
        origin: authority.origin,
        reason: input.reason,
      });
    }

    const outcome = await this.deps.dispatcher.cancelJob(
      { runtimeId: ref.runtimeId, handleId: ref.handleId },
      input.reason,
    );
    if (!outcome.dispatched) {
      // The cancellation did NOT reach the runtime. The request stays recorded as
      // an intent; the attempt is not marked cancelled.
      return {
        cancelled: false,
        detail: outcome.error?.message ?? "the runtime could not be reached to cancel this execution",
      };
    }

    if (ref.executionRecordId) {
      await this.deps.executions.markCancelled(ref.executionRecordId, input.reason);
    }
    return {
      cancelled: true,
      detail: "the runtime accepted the cancellation request",
      ...(outcome.status ? { status: outcome.status } : {}),
    };
  }

  /**
   * Cancels the ATTEMPTS of a mission's non-terminal tasks on behalf of an
   * AUTHORISED foreground caller, and reports which attempts are UNRESOLVED.
   *
   * THE RACE THIS CLOSES. `cancelMission` used to terminalise a mission as soon
   * as no task happened to be RUNNING — while an attempt could be between its
   * pre-dispatch reservation and its external call. Cancelling then orphaned an
   * external run under a CANCELLED mission. This method consults the DELIVERY
   * LEDGER (the durable pre-dispatch reservation) FIRST:
   *
   *   DISPATCHED  an execution exists → cancel it through the runtime, then free.
   *   CLAIMED     dispatch was NOT entered → unresolved: a racing execute() could
   *               still enter dispatch, so the mission may not be terminalised.
   *   DISPATCHING dispatch WAS entered, outcome unknown → unresolved.
   *   UNVERIFIED  already parked for a human → unresolved.
   *   none        nothing is in flight for this task → free.
   *
   * It NEVER dispatches and NEVER fabricates a cancellation: an attempt that
   * cannot be confirmed is reported unresolved, and the orchestrator refuses to
   * terminalise the mission rather than orphan the run.
   */
  async cancelMissionAttempts(input: {
    missionId: MissionId;
    tasks: readonly { taskId: TaskId; state: string }[];
    reason: string;
    authority: ExecutionAuthority;
  }): Promise<MissionAttemptCancellation[]> {
    const authority = assertForegroundAuthority(input.authority, {
      now: this.deps.now(),
      ...(this.authorityMaxAgeMs ? { maxAgeMs: this.authorityMaxAgeMs } : {}),
    });
    // Business/object scope is re-checked, exactly as the dispatch path does.
    if (!this.deps.missions) {
      throw new AiWorkforceError(
        "PERSISTENCE_UNAVAILABLE",
        "No mission authority is composed; the canonical mission scope cannot be verified",
      );
    }
    const mission = await this.deps.missions.get(input.missionId);
    if (!mission) {
      throw new AiWorkforceError("MISSION_NOT_FOUND", `Mission "${input.missionId}" does not exist`);
    }
    if (mission.businessId) {
      const resolved = this.deps.businesses ? await this.deps.businesses.resolve(mission.businessId) : null;
      if (!resolved) {
        throw new AiWorkforceError(
          "BUSINESS_SCOPE_DENIED",
          `Mission "${mission.id}" names business "${mission.businessId}", which cannot be verified`,
        );
      }
      assertBusinessScope(authority, resolved);
    }

    const results: MissionAttemptCancellation[] = [];
    /**
     * The CANCELLED reservations THIS call made, so a cancellation that can only
     * partly resolve can UNDO them (see the compensation below). Cancelling a
     * mission is a multi-task operation: reserving some attempts `CANCELLED` and
     * then refusing to cancel the mission would leave those tasks unable to
     * dispatch AND unable to be cancelled — permanently stuck.
     */
    const reservations: { claimId: string; invocationToken: string }[] = [];
    for (const entry of input.tasks) {
      // Re-read the AUTHORITATIVE task: the reservation uses its actor, its
      // capability and its attempt, never the caller's summary.
      const task = await this.deps.tasks.get(entry.taskId);
      const taskState = task?.state ?? entry.state;
      const assignedActorId = task?.assignedActorId ?? null;
      const requiredCapabilityId = task?.requiredCapabilityId ?? null;
      // ── THE AUTHORITATIVE CURRENT ATTEMPT (Step 5A-4 correction) ──
      //
      //   RUNNING           attempt `task.attempt` is the live one.
      //   anything else     `task.attempt + 1` is the NEXT attempt — the only one
      //                     this task could still start.
      //
      // Selecting "the first DISPATCHED claim for the task" instead — what this
      // used to do — cancelled the handle of an attempt the task had already moved
      // PAST: with attempt 1 failed and the task READY for attempt 2, cancelling
      // the mission cancelled attempt 1's old handle and terminalised the task
      // while attempt 2 was entering dispatch. Historical attempts are therefore
      // never selected as "the attempt to cancel".
      const currentAttempt = taskState === "RUNNING" ? task?.attempt ?? 0 : (task?.attempt ?? 0) + 1;
      const claims = await this.deps.claims.listForTask(entry.taskId);
      const current = claims.find((claim) => claim.attempt === currentAttempt) ?? null;

      if (current) {
        // The ledger's OWN verdict for the CURRENT attempt decides, rather than a
        // state name read off a list. A lapse is what makes an attempt
        // cancellable, and it is the database's clock that says whether it lapsed.
        const recovery = await this.deps.claims.recoveryFor(current.id);

        // 1. An execution EXISTS for the current attempt: cancel it THROUGH the
        //    runtime. This is the ONLY case in which an external side effect is
        //    performed, and it is performed for the live attempt, never an old one.
        if (recovery?.kind === "ADOPT") {
          const cancellation = await this.cancel(
            {
              runtimeId: current.runtimeId ?? "",
              handleId: current.handleId ?? "",
              ...(current.executionRecordId ? { executionRecordId: current.executionRecordId } : {}),
              missionId: input.missionId,
              taskId: entry.taskId,
            },
            { reason: input.reason, authority },
          );
          results.push({
            taskId: entry.taskId,
            claimId: current.id,
            state: current.state,
            cancelled: cancellation.cancelled,
            unresolved: !cancellation.cancelled,
            detail: cancellation.detail,
          });
          continue;
        }

        // 2. A live reservation on the current attempt: an invocation is still
        //    working, so the mission may not be terminalised around it.
        if (recovery?.kind === "IN_PROGRESS") {
          results.push({
            taskId: entry.taskId,
            claimId: current.id,
            state: current.state,
            cancelled: false,
            unresolved: true,
            detail: `attempt ${current.attempt} holds a live "${current.state}" dispatch reservation; the mission must not be cancelled while an invocation may still be starting work`,
          });
          continue;
        }

        // 3. Dispatch was ENTERED and no handle exists: the run may exist. Only a
        //    human can resolve a doubt, and never this path.
        if (recovery?.kind === "UNVERIFIED") {
          results.push({
            taskId: entry.taskId,
            claimId: current.id,
            state: current.state,
            cancelled: false,
            unresolved: true,
            detail: `attempt ${current.attempt} is UNVERIFIED (${recovery.detail}); an external run may exist and requires operator resolution`,
          });
          continue;
        }

        // 4. Already terminal for cancellation: nothing to do.
        if (recovery?.kind === "CANCELLED") {
          results.push({
            taskId: entry.taskId,
            claimId: current.id,
            state: "CANCELLED",
            cancelled: true,
            unresolved: false,
            detail: "the current attempt is already cancelled",
          });
          continue;
        }
        // Otherwise RECLAIM: a lapsed CLAIMED attempt, or a RELEASED one. Dispatch
        // was never entered, so the attempt can be reserved below.
      } else if (taskState === "RUNNING") {
        // A RUNNING task with NO claim for its current attempt is a reservation
        // window or an anomaly: fail closed rather than terminalise a mission
        // around a run we cannot see.
        results.push({
          taskId: entry.taskId,
          cancelled: false,
          unresolved: true,
          detail: `the task is RUNNING at attempt ${task?.attempt ?? 0} but holds no delivery claim for it; an attempt may be entering dispatch`,
        });
        continue;
      }

      // 5. Otherwise the CURRENT attempt can be reserved CANCELLED — in ONE
      //    atomic write, never `claim()` followed by `markCancelled()`. The two-
      //    write sequence left an ordinary reclaimable `CLAIMED` row behind a
      //    crash, and once its lease lapsed a racing `execute()` could reclaim and
      //    dispatch the very attempt the operator had cancelled.
      const canReserve =
        (taskState === "READY" || taskState === "RUNNING") && !!assignedActorId && !!requiredCapabilityId;
      if (!canReserve) {
        results.push({
          taskId: entry.taskId,
          cancelled: true,
          unresolved: false,
          detail: "the task cannot dispatch from its current state",
        });
        continue;
      }

      const attempt = currentAttempt;
      const invocationToken = newInvocationToken({
        processId: this.processId,
        ids: this.deps.ids,
        now: this.deps.now,
      });
      const reservation = await this.deps.claims.reserveCancellation({
        missionId: input.missionId,
        taskId: entry.taskId,
        attempt,
        idempotencyKey: executionIdempotencyKeyForAttempt(entry.taskId, attempt),
        actorId: assignedActorId,
        capabilityId: requiredCapabilityId,
        leaseOwner: invocationToken,
        detail: `cancelled by ${authority.actorId}: ${input.reason}`,
      });

      switch (reservation.kind) {
        case "RESERVED":
          reservations.push({ claimId: reservation.claim.id, invocationToken });
          results.push({
            taskId: entry.taskId,
            claimId: reservation.claim.id,
            state: "CANCELLED",
            cancelled: true,
            unresolved: false,
            detail:
              "the current attempt was reserved as CANCELLED in one write, so no dispatch can start for it",
          });
          break;
        case "ALREADY_CANCELLED":
          results.push({
            taskId: entry.taskId,
            claimId: reservation.claim.id,
            state: "CANCELLED",
            cancelled: true,
            unresolved: false,
            detail: "the current attempt is already cancelled",
          });
          break;
        case "EXECUTION_EXISTS": {
          // A race: an execution appeared for this attempt between the reads.
          // Cancel it THROUGH the runtime, exactly as the ADOPT path does.
          const cancellation = await this.cancel(
            {
              runtimeId: reservation.claim.runtimeId ?? "",
              handleId: reservation.claim.handleId ?? "",
              ...(reservation.claim.executionRecordId
                ? { executionRecordId: reservation.claim.executionRecordId }
                : {}),
              missionId: input.missionId,
              taskId: entry.taskId,
            },
            { reason: input.reason, authority },
          );
          results.push({
            taskId: entry.taskId,
            claimId: reservation.claim.id,
            state: reservation.claim.state,
            cancelled: cancellation.cancelled,
            unresolved: !cancellation.cancelled,
            detail: cancellation.detail,
          });
          break;
        }
        case "IN_PROGRESS":
          results.push({
            taskId: entry.taskId,
            claimId: reservation.claim.id,
            state: reservation.claim.state,
            cancelled: false,
            unresolved: true,
            detail: `attempt ${attempt} holds a live "${reservation.claim.state}" dispatch reservation; the mission must not be cancelled while an invocation may still be starting work`,
          });
          break;
        case "UNVERIFIED":
          results.push({
            taskId: entry.taskId,
            claimId: reservation.claim.id,
            state: reservation.claim.state,
            cancelled: false,
            unresolved: true,
            detail: `attempt ${attempt} is UNVERIFIED (${reservation.detail}); an external run may exist and requires operator resolution`,
          });
          break;
        case "CONFLICT":
          results.push({
            taskId: entry.taskId,
            claimId: reservation.claimId,
            cancelled: false,
            unresolved: true,
            detail: `attempt ${reservation.attempt} is held under a different idempotency key; the ledger refused to reserve it rather than create a second authority`,
          });
          break;
        default: {
          // Exhaustive by construction: a new reservation kind must be handled.
          const exhaustive: never = reservation;
          throw new AiWorkforceError("PERSISTENCE_UNAVAILABLE", "Unknown cancellation reservation outcome", {
            outcome: (exhaustive as { kind: string }).kind,
          });
        }
      }
      continue;
    }

    // ── COMPENSATION ──
    // A mission cancellation that can only PARTLY resolve must not poison the
    // tasks it already reserved. Every reservation this call made is rolled back
    // to RELEASED ("no external run exists for this attempt"), and each affected
    // task is then reported UNRESOLVED — so the orchestrator refuses to
    // terminalise the mission AND the tasks are not left permanently dead.
    const unresolved = results.filter((row) => row.unresolved);
    if (unresolved.length > 0 && reservations.length > 0) {
      for (const reservation of reservations) {
        await this.deps.claims.rollbackCancellation(reservation.claimId, {
          invocationToken: reservation.invocationToken,
          detail: `cancellation rolled back: another attempt in mission "${input.missionId}" could not be resolved, so this attempt was left dispatchable rather than stranded`,
        });
      }
      const rolledBack = new Set(reservations.map((reservation) => reservation.claimId));
      for (const row of results) {
        if (row.claimId && rolledBack.has(row.claimId) && !row.unresolved) {
          row.cancelled = false;
          row.unresolved = true;
          row.state = "RELEASED";
          row.detail = `cancellation rolled back, so this attempt is still dispatchable: ${row.detail}`;
        }
      }
    }
    return results;
  }

  /* ═══════════════════════════════════════════════════
     Internals
     ═══════════════════════════════════════════════════ */

  /** The external leg. Never reached before a committed `DISPATCHING`. */
  private async deliver(input: {
    request: ExecutionAttemptRequest;
    preflight: ExecutionPreflightResult;
    invocationToken: string;
  }): Promise<
    | { handle: DeliveredHandle; detail?: undefined }
    | { handle: null; detail: string }
  > {
    const { request, preflight } = input;
    const actor = await this.deps.actors.get(request.assignedActorId);

    if (preflight.binding === "DETERMINISTIC") {
      if (this.deps.deterministic.externalCalls !== false) {
        // The invoker lies about what it is. Refuse instead of executing through
        // a component that claims to reach the network on a "free" leg.
        return {
          handle: null,
          detail: `the deterministic invoker "${this.deps.deterministic.id}" declares externalCalls=true; refused as a non-deterministic leg`,
        };
      }
      const resolution = preflight.resolution;
      const result = await this.deps.deterministic.invoke({
        descriptor: preflight.descriptor ?? RUNTIME_DISPATCH_DEFINITION,
        // The EXACT authorised version travels with the descriptor, so the
        // resolved handler is the one the preflight approved.
        ...(resolution?.toolDefinitionVersion ? { descriptorVersion: resolution.toolDefinitionVersion } : {}),
        input: request.input,
        // The SAME authorized business/capability/assignment context the
        // preflight approved — reconstructed from the immutable resolution, not
        // from nullable caller fields.
        context: this.executionContextFor({
          request,
          authority: request.authority,
          business:
            resolution?.businessId && resolution.businessSlug
              ? { id: resolution.businessId, slug: resolution.businessSlug }
              : null,
          capability: null,
          assignment: null,
        }),
        // The attempt key is DERIVED here too, never taken from the caller: the
        // only spelling of an attempt's identity is the deterministic one.
        attemptKey: resolution
          ? executionIdempotencyKeyForAttempt(resolution.taskId, resolution.attempt)
          : executionIdempotencyKeyForAttempt(request.taskId, request.attempt),
        missionId: request.missionId,
        taskId: request.taskId,
        ...(resolution ? { actorId: resolution.actorId } : actor ? { actorId: actor.id } : {}),
      });
      return {
        handle: {
          runtimeId: this.deps.deterministic.id,
          handleId: result.handleId,
          status: result.status,
          ...(result.output !== undefined ? { output: result.output } : {}),
          ...(result.outputText !== undefined ? { outputText: result.outputText } : {}),
          ...(result.error ? { error: result.error } : {}),
          ...(result.durationMs !== undefined ? { durationMs: result.durationMs } : {}),
          replayed: false,
        },
      };
    }

    const resolution = preflight.resolution;
    const runtimeId = resolution?.runtimeId ?? actor?.runtimeBinding?.runtimeId;
    if (!runtimeId) {
      return { handle: null, detail: "the actor has no runtime binding to dispatch to" };
    }

    // The submission is bounded by the CONFIGURED submission timeout. A timeout
    // is an AMBIGUOUS outcome, not a failure: the request may have arrived.
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<{ __timeout: true }>((resolve) => {
      timer = setTimeout(() => resolve({ __timeout: true }), this.submissionTimeoutMs);
    });
    try {
      const raced = await Promise.race([
        this.deps.dispatcher.startJob({
          actorId: resolution?.actorId ?? request.assignedActorId,
          runtimeId,
          capabilityId: resolution?.capabilityId ?? request.requiredCapabilityId,
          ...(resolution?.capabilityVersion ? { capabilityVersion: resolution.capabilityVersion } : {}),
          missionId: resolution?.missionId ?? request.missionId,
          jobId: resolution?.taskId ?? request.taskId,
          idempotencyKey: resolution
            ? executionIdempotencyKeyForAttempt(resolution.taskId, resolution.attempt)
            : executionIdempotencyKeyForAttempt(request.taskId, request.attempt),
          traceId: request.traceId,
          input: request.input,
        }),
        timeout,
      ]);
      if ("__timeout" in raced) {
        return {
          handle: null,
          detail: `the runtime did not answer within ${this.submissionTimeoutMs}ms; the run may have started and this attempt must not be re-dispatched automatically`,
        };
      }
      if (!raced.dispatched || !raced.handle) {
        return {
          handle: null,
          detail:
            raced.error?.message ??
            `the runtime refused the dispatch (${raced.reason ?? "UNKNOWN"}); the run may or may not exist`,
        };
      }
      return {
        handle: {
          runtimeId,
          handleId: raced.handle.handleId,
          status: raced.status ?? raced.handle.status,
          ...(raced.execution?.providerExecutionId ? { providerExecutionId: raced.execution.providerExecutionId } : {}),
          ...(raced.output !== undefined ? { output: raced.execution?.output ?? raced.output } : {}),
          ...(raced.execution?.outputText !== undefined ? { outputText: raced.execution.outputText } : {}),
          ...(raced.execution?.error ? { error: raced.execution.error } : {}),
          replayed: raced.execution?.replayed ?? false,
        },
      };
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  /** The atomic finalize, or the documented in-memory equivalent. */
  private async finalize(input: {
    request: ExecutionAttemptRequest;
    preflight: ExecutionPreflightResult;
    claim: ExecutionClaim;
    invocationToken: string;
    idempotencyKey: string;
    handle: DeliveredHandle;
  }): Promise<ExecutionOutcome> {
    const { request, preflight, claim, invocationToken, handle } = input;
    const recordId = this.deps.ids.next("execution");
    const at = this.deps.now().toISOString();

    const record: ExecutionRecord = {
      id: recordId,
      handleId: handle.handleId,
      runtimeId: handle.runtimeId,
      actorId: preflight.resolution?.actorId ?? request.assignedActorId,
      capabilityId: preflight.resolution?.capabilityId ?? request.requiredCapabilityId,
      attempt: preflight.resolution?.attempt ?? request.attempt,
      status: handle.status,
      startedAt: at,
      updatedAt: at,
      audit: [
        {
          seq: 1,
          at,
          type: "PREFLIGHT",
          detail: `authorised by ${request.authority.actorId} (${request.authority.origin}); binding=${preflight.binding}; budget=${preflight.budget.reason}; approval=${preflight.approval?.reason ?? "NONE"}`,
        },
        { seq: 2, at, type: "REQUESTED" },
        { seq: 3, at, type: "ACCEPTED", status: handle.status },
      ],
    };
    const recordVersion = preflight.resolution?.capabilityVersion ?? request.requiredCapabilityVersion;
    if (recordVersion) record.capabilityVersion = recordVersion;
    record.missionId = request.missionId;
    record.taskId = request.taskId;
    record.idempotencyKey = input.idempotencyKey;
    if (handle.providerExecutionId) record.providerExecutionId = handle.providerExecutionId;
    if (handle.output !== undefined) record.output = handle.output;
    if (handle.outputText !== undefined) record.outputText = handle.outputText;
    if (handle.error) record.error = handle.error;
    if (handle.replayed) record.replayed = true;
    if (handle.durationMs !== undefined) record.durationMs = handle.durationMs;
    if (handle.status === "SUCCEEDED" || handle.status === "FAILED" || handle.status === "CANCELLED") {
      record.completedAt = at;
      record.audit.push({ seq: 4, at, type: "TERMINAL", status: handle.status });
    }

    if (this.deps.committer) {
      const committed = await this.deps.committer.commitDispatched({
        claimId: claim.id,
        invocationToken,
        record,
        runtimeId: handle.runtimeId,
      });
      return {
        kind: "DISPATCHED",
        claimId: claim.id,
        executionRecordId: committed.record.id,
        handleId: committed.record.handleId,
        runtimeId: committed.record.runtimeId,
        status: committed.record.status,
      };
    }

    // ── The in-memory composition ──
    // There is no transaction to open against Maps, so the record is inserted
    // through the recorder and the claim is CAS'd afterwards. The invariant is
    // preserved in the direction that matters: if the CAS loses, the caller is
    // told the attempt is UNVERIFIED (never DISPATCHED) even though a record now
    // exists, and no code path can start a second run.
    const stored = await this.deps.executions.open({
      handleId: record.handleId,
      runtimeId: record.runtimeId,
      actorId: record.actorId,
      capabilityId: record.capabilityId,
      attempt: record.attempt,
      missionId: request.missionId,
      taskId: request.taskId,
      status: record.status,
      ...(record.capabilityVersion ? { capabilityVersion: record.capabilityVersion } : {}),
      ...(record.idempotencyKey ? { idempotencyKey: record.idempotencyKey } : {}),
    });
    const dispatched = await this.deps.claims.markDispatched(claim.id, {
      invocationToken,
      executionRecordId: stored.id,
      handleId: stored.handleId,
      runtimeId: stored.runtimeId,
    });
    if (!dispatched) {
      return {
        kind: "UNVERIFIED",
        claimId: claim.id,
        detail:
          "the execution was recorded but the claim could not be moved to DISPATCHED; the attempt must not be re-dispatched automatically",
      };
    }
    return {
      kind: "DISPATCHED",
      claimId: claim.id,
      executionRecordId: stored.id,
      handleId: stored.handleId,
      runtimeId: stored.runtimeId,
      status: stored.status,
    };
  }

  /**
   * The MOST RESTRICTIVE approval policy for one attempt.
   *
   * The composition's policy and the performing ACTOR's are merged, and the
   * stricter of each dimension wins:
   *
   *   mode           ALWAYS beats RISK_AT_LEAST, which beats NEVER/INHERIT.
   *   minRiskLevel   the LOWER threshold is the MORE restrictive one, because it
   *                  demands an approval at a risk level the other policy would
   *                  have waved through.
   *
   * `humanPresenceCountsAsApproval` stays the composition's, because whether a
   * signed-in human pressing the button IS the approval is a platform-wide
   * posture rather than a per-actor one — and no actor policy may relax it.
   */
  private effectiveApprovalPolicy(actor: Actor): ApprovalPolicy {
    const base = this.approvalPolicy;
    const actorPolicy = actor.approvalPolicy;
    if (actorPolicy.mode === "INHERIT" || actorPolicy.mode === "NEVER") return base;
    if (actorPolicy.mode === "ALWAYS" || base.mode === "ALWAYS") {
      return { mode: "ALWAYS", minRiskLevel: "LOW", humanPresenceCountsAsApproval: false };
    }
    const actorThreshold = actorPolicy.minRiskLevel ?? "LOW";
    if (base.mode !== "RISK_AT_LEAST") {
      return {
        mode: "RISK_AT_LEAST",
        minRiskLevel: actorThreshold,
        humanPresenceCountsAsApproval: base.humanPresenceCountsAsApproval,
      };
    }
    return {
      mode: "RISK_AT_LEAST",
      minRiskLevel: RISK_RANK[actorThreshold] <= RISK_RANK[base.minRiskLevel] ? actorThreshold : base.minRiskLevel,
      humanPresenceCountsAsApproval: base.humanPresenceCountsAsApproval,
    };
  }

  /**
   * The SAME foreground gate the dispatch path uses, for cancellation.
   *
   * Cancelling an execution is an external side effect, so it may never be
   * reachable with anything less than an authenticated REQUEST authority inside
   * its deadline — and, when the caller names a mission, one whose business scope
   * actually reaches it. A background/reconciliation authority can observe and
   * adopt; it cannot cancel.
   */
  private async assertCancellationAuthority(
    authority: ExecutionAuthority | null | undefined,
    missionId?: MissionId,
  ): Promise<ExecutionAuthority> {
    const asserted = assertForegroundAuthority(authority, {
      now: this.deps.now(),
      ...(this.authorityMaxAgeMs ? { maxAgeMs: this.authorityMaxAgeMs } : {}),
    });
    if (!missionId) return asserted;
    const mission = this.deps.missions ? await this.deps.missions.get(missionId) : null;
    if (mission?.businessId) {
      const resolved = this.deps.businesses ? await this.deps.businesses.resolve(mission.businessId) : null;
      if (!resolved) {
        throw new AiWorkforceError(
          "BUSINESS_SCOPE_DENIED",
          `Mission "${mission.id}" names business "${mission.businessId}", which cannot be verified`,
        );
      }
      assertBusinessScope(asserted, resolved);
    }
    return asserted;
  }

  /**
   * The boundary's OWN immutable copy of an attempt (Step 5A-4 correction,
   * P1-9).
   *
   * It is built SYNCHRONOUSLY — no `await` between reading the caller's object
   * and freezing the copies — so there is no window, however short, in which a
   * caller could swap the input or the authority out from under the checks that
   * follow. `idempotencyKey` is DERIVED here and never read from the request.
   */
  private envelopeFor(request: ExecutionAttemptRequest): ExecutionAttemptEnvelope {
    const authority = deepFreeze(cloneJson(request.authority)) as ExecutionAuthority;
    const input = deepFreeze(cloneJson(request.input)) as JsonObject;
    const env: ExecutionAttemptEnvelope = {
      missionId: request.missionId,
      taskId: request.taskId,
      attempt: request.attempt,
      idempotencyKey: executionIdempotencyKeyForAttempt(request.taskId, request.attempt),
      authority,
      assignedActorId: request.assignedActorId,
      requiredCapabilityId: request.requiredCapabilityId,
      input,
      traceId: request.traceId,
    };
    if (request.requiredCapabilityVersion !== undefined) {
      env.requiredCapabilityVersion = request.requiredCapabilityVersion;
    }
    if (request.businessScope !== undefined && request.businessScope !== null) {
      env.businessScope = deepFreeze(cloneJson(request.businessScope));
    } else if (request.businessScope === null) {
      env.businessScope = null;
    }
    if (request.source !== undefined) env.source = request.source;
    if (request.contextRefs !== undefined) env.contextRefs = Object.freeze([...request.contextRefs]);
    return Object.freeze(env);
  }

  /**
   * The durable one-line reason a refusal is recorded under, on the claim.
   *
   * The CODE alone is not enough for the budget gate: `permission` is checked
   * before `budget`, the shared error vocabulary has no budget code, and a
   * governor refusal is therefore typed `PERMISSION_DENIED`. Recorded bare, the
   * ledger could not tell "you may not" from "you may not SPEND" — which is the
   * single invariant this batch exists to hold. When the governor actually ran
   * and refused, its own machine-readable reason is appended.
   */
  private refusalDetail(preflight: ExecutionPreflightResult): string {
    const base = `${preflight.decision}:${preflight.blocked?.code ?? "REFUSED"}`;
    return preflight.budgetEvaluated && !preflight.budget.allowed
      ? `${base}:BUDGET:${preflight.budget.reason}`
      : base;
  }

  private outcomeForRefusal(claimId: string, preflight: ExecutionPreflightResult): ExecutionOutcome {
    const code = preflight.blocked?.code ?? "PERMISSION_DENIED";
    const text = preflight.blocked?.message ?? "the execution was refused before dispatch";
    switch (preflight.decision) {
      case "WAIT_APPROVAL":
        return {
          kind: "WAIT_APPROVAL",
          claimId,
          descriptorId: preflight.descriptor?.id ?? "unknown",
          ...(preflight.approval?.approvalId ? { approvalId: preflight.approval.approvalId } : {}),
        };
      case "WAIT_HUMAN":
        return { kind: "WAIT_HUMAN", claimId, detail: text };
      case "DENY":
        return { kind: "DENIED", claimId, code, message: text };
      default:
        return { kind: "BLOCKED", claimId, code, message: text };
    }
  }

  private buildReceipt(input: {
    request: ExecutionAttemptRequest;
    authority: ExecutionAuthority;
    preflight: ExecutionPreflightResult;
    claim: ExecutionClaim;
    idempotencyKey: string;
  }): DispatchPreflightReceipt {
    const { authority, preflight } = input;
    const resolution = preflight.resolution;
    if (!resolution) {
      throw new AiWorkforceError(
        "EXECUTION_TASK_MISMATCH",
        "A dispatch receipt requires the authoritative resolution produced by the preflight",
      );
    }
    return {
      v: 1,
      missionId: resolution.missionId,
      taskId: resolution.taskId,
      attempt: resolution.attempt,
      idempotencyKey: input.idempotencyKey,
      requestedBy: authority.userId,
      operatorActorId: authority.actorId,
      correlationId: authority.correlationId,
      binding: resolution.binding,
      actorId: resolution.actorId,
      capabilityId: resolution.capabilityId,
      capabilityVersion: resolution.capabilityVersion,
      assignmentId: resolution.assignmentId,
      runtimeId: input.claim.runtimeId ?? resolution.runtimeId,
      businessSlug: resolution.businessSlug,
      permission: { allowed: preflight.permission.allowed, reason: preflight.permission.reason },
      approval: {
        required: preflight.approval?.required ?? false,
        satisfied: preflight.approval?.satisfied ?? false,
        reason: preflight.approval?.reason ?? "NOT_EVALUATED",
        approvalId: preflight.approval?.approvalId ?? null,
      },
      budget: {
        allowed: preflight.budget.allowed,
        reason: preflight.budget.reason,
        policyRef: preflight.budget.policyRef,
        spend: preflight.budget.spend,
      },
      risk: { level: preflight.descriptor?.riskLevel ?? "UNKNOWN", decision: "WITHIN_DECLARED" },
      decision: preflight.decision,
      authorizedAt: this.deps.now().toISOString(),
    };
  }

  private approvalBindingFor(resolution: ExecutionResolution): ApprovalBinding {
    return {
      missionId: resolution.missionId,
      taskId: resolution.taskId,
      attempt: resolution.attempt,
      // The SERVER-derived key — never the caller's spelling — so an approval
      // cannot be bound to a forged attempt identity.
      idempotencyKey: executionIdempotencyKeyForAttempt(resolution.taskId, resolution.attempt),
      businessId: resolution.businessId,
      actorId: resolution.actorId,
      capabilityId: resolution.capabilityId,
      capabilityVersion: resolution.capabilityVersion,
    };
  }

  /**
   * An approval may only be used when it is BOUND to this attempt, at the right
   * capability and version, and still inside its TTL.
   */
  private checkApprovalBinding(
    approval: ApprovalRecord | null,
    resolution: ExecutionResolution,
  ): { code: AiWorkforceError["code"]; message: string } | null {
    if (!approval) return null;
    if (approval.toolId !== resolution.capabilityId) {
      return {
        code: "APPROVAL_WRONG_TOOL",
        message: `Approval "${approval.id}" authorises "${approval.toolId}", not "${resolution.capabilityId}"`,
      };
    }
    // A DECISION TIMESTAMP IS MANDATORY ON AN `APPROVED` RECORD (Step 5A-4
    // correction). `decidedAt` is optional on the record, and the TTL check below
    // used to run ONLY when it happened to be present — so an `APPROVED` row with
    // no timestamp bypassed expiry entirely and could authorise indefinitely. A
    // record that cannot say WHEN it was decided cannot be bounded by ANY
    // deadline, so it is refused rather than trusted.
    if (approval.status === "APPROVED") {
      const decidedAt = approval.decidedAt ? new Date(approval.decidedAt).getTime() : Number.NaN;
      if (!Number.isFinite(decidedAt)) {
        return {
          code: "APPROVAL_REQUIRED",
          message: `Approval "${approval.id}" carries no valid decision timestamp and cannot authorise an execution`,
        };
      }
      const now = this.deps.now().getTime();
      if (decidedAt - now > APPROVAL_CLOCK_SKEW_MS) {
        return {
          code: "APPROVAL_REQUIRED",
          message: `Approval "${approval.id}" is dated in the future and cannot authorise an execution`,
        };
      }
      // Expiry, checked BEFORE the binding, so a STALE approval is reported as
      // stale rather than as a binding error.
      if (now - decidedAt > this.approvalTtlMs) {
        return {
          code: "APPROVAL_REQUIRED",
          message: `Approval "${approval.id}" expired; an expired approval cannot authorise a new attempt`,
        };
      }
    }
    // An APPROVED record must carry an EXPLICIT binding to this exact attempt.
    // A REJECTED record is left to `evaluateApproval`, which reports the refusal
    // it actually is.
    if (approval.status === "APPROVED") {
      const ref = approval.metadata?.["bindingRef"];
      if (typeof ref !== "string" || ref === "") {
        return {
          code: "APPROVAL_WRONG_TOOL",
          message: `Approval "${approval.id}" carries no explicit attempt binding and cannot authorise this execution`,
        };
      }
      if (ref !== approvalBindingRef(this.approvalBindingFor(resolution))) {
        return {
          code: "APPROVAL_WRONG_TOOL",
          message: `Approval "${approval.id}" is bound to a different execution authorization identity`,
        };
      }
    }
    return null;
  }

  private findAssignment(actor: Actor, capability: Capability): ActorCapabilityAssignment | null {
    return (
      this.deps.assignments
        .listForActor(actor.id)
        .find(
          (row) =>
            row.status === "ACTIVE" &&
            row.capabilityId === capability.id &&
            row.capabilityVersion === capability.version,
        ) ?? null
    );
  }

  private checkAssignmentConstraints(
    assignment: ActorCapabilityAssignment,
    capability: Capability,
    business: ResolvedBusiness | null,
  ): { code: AiWorkforceError["code"]; message: string } | null {
    const constraints = assignment.constraints;
    if (!constraints) return null;
    if (constraints.maxRiskLevel && RISK_RANK[capability.riskLevel] > RISK_RANK[constraints.maxRiskLevel]) {
      return {
        code: "INVALID_ASSIGNMENT",
        message: `Capability "${capability.id}" is ${capability.riskLevel} risk but the assignment allows at most ${constraints.maxRiskLevel}`,
      };
    }
    if (constraints.businessSlugs && constraints.businessSlugs.length > 0) {
      if (!business) {
        return {
          code: "SCOPE_MISSING",
          message: `Assignment for "${capability.id}" is limited to specific businesses, but this mission names none`,
        };
      }
      if (!constraints.businessSlugs.includes(business.slug)) {
        return {
          code: "BUSINESS_SCOPE_DENIED",
          message: `Assignment for "${capability.id}" does not cover business "${business.slug}"`,
        };
      }
    }
    return null;
  }

  private resolveBinding(capability: Capability, actor: Actor): ExecutionBinding {
    if (capability.runtimeRequirements.requiresHuman) return "HUMAN";
    if (capability.kind === "TOOL" && this.deps.tools?.getDefinition(capability.id)) return "DETERMINISTIC";
    if (capability.kind !== "TOOL" && capability.runtimeRequirements.supportsDeterministic && capability.runtimeRequirements.requiresRuntime !== true) {
      return "DETERMINISTIC";
    }
    if (capability.kind !== "TOOL" && capability.runtimeRequirements.requiresRuntime !== true && !actor.runtimeBinding) {
      return "DETERMINISTIC";
    }
    return "RUNTIME";
  }

  private checkRuntimeBinding(capability: Capability, actor: Actor): { code: AiWorkforceError["code"]; message: string } | null {
    const runtimeId = actor.runtimeBinding?.runtimeId;
    if (!runtimeId) {
      return {
        code: "RUNTIME_UNSUPPORTED",
        message: `Capability "${capability.id}" requires a runtime, but actor "${actor.slug}" has no runtime binding`,
      };
    }
    const runtime = this.deps.runtimes.get(runtimeId);
    if (!runtime) {
      return {
        code: "RUNTIME_NOT_FOUND",
        message: `Actor "${actor.slug}" is bound to runtime "${runtimeId}", which is not registered`,
      };
    }
    const required = capability.runtimeRequirements.requiredRuntimeTypes;
    if (required && required.length > 0 && !required.includes(runtime.identity.type)) {
      return {
        code: "RUNTIME_UNSUPPORTED",
        message: `Capability "${capability.id}" requires runtime type(s) ${required.join(", ")}, but "${runtime.identity.type}" is bound`,
      };
    }
    return null;
  }

  /** The Phase-1 context the reused policies evaluate, built from the AUTHORITY. */
  private executionContextFor(input: {
    request: ExecutionAttemptRequest;
    authority: ExecutionAuthority;
    business: ResolvedBusiness | null;
    capability: Capability | null;
    assignment: ActorCapabilityAssignment | null;
  }): ExecutionContext {
    const { authority } = input;
    return createExecutionContext({
      serviceIdentity: {
        id: "workforce.capability-execution",
        name: "NEXUP Workforce Capability Execution Service",
        kind: "SERVICE",
        runtimeKind: input.capability ? input.capability.kind : "UNRESOLVED",
        // Never claimed as verified: nothing external has authenticated this.
        verified: false,
      },
      actor: {
        userId: authority.userId,
        name: authority.actorSlug,
        role: authority.actorType,
        isSuperAdmin: authority.isSuperAdmin,
        hasOfficeFinanceFull: authority.hasOfficeFinanceFull,
        accessibleBusinessSlugs: [...authority.accessibleBusinessSlugs],
        permissionTokens: [...authority.permissionTokens],
      },
      business: input.business ? { id: input.business.id, slug: input.business.slug } : null,
      workspace: null,
      // HUMAN autonomy: this attempt was started by an authenticated person.
      autonomy: "HUMAN",
      source: input.request.source === "AUTOMATIC" ? "SYSTEM" : "MANUAL",
      correlationId: authority.correlationId,
      now: this.deps.now(),
    });
  }
}

/* ═══════════════════════════════════════════════════════
   Helpers
   ═══════════════════════════════════════════════════════ */

type DeliveredHandle = {
  runtimeId: string;
  handleId: string;
  status: AgentExecutionStatus;
  providerExecutionId?: string;
  output?: unknown;
  outputText?: string;
  error?: AgentExecutionError;
  durationMs?: number;
  replayed: boolean;
};

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** True when a failure is the CALLER's bounded wait expiring, not an outage. */
function isRuntimeTimeout(error: unknown): boolean {
  return error instanceof AiWorkforceError && error.code === "RUNTIME_TIMEOUT";
}

/**
 * A structural clone of a JSON-shaped value.
 *
 * `structuredClone` when the runtime has it, `JSON` round-trip otherwise. Both
 * are adequate here because every field of a request is bounded, structured JSON
 * (the contracts forbid anything else), and the point is to DECOUPLE the copy
 * from the caller's object rather than to model object graphs.
 */
function cloneJson<T>(value: T): T {
  if (value === null || typeof value !== "object") return value;
  const sc = (globalThis as { structuredClone?: <U>(input: U) => U }).structuredClone;
  if (typeof sc === "function") return sc(value);
  return JSON.parse(JSON.stringify(value)) as T;
}

/** Freezes a value and everything reachable from it. */
function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== "object") return value;
  for (const nested of Object.values(value as Record<string, unknown>)) deepFreeze(nested);
  return Object.freeze(value);
}

/**
 * Canonical JSON equality, key-order independent.
 *
 * Used for the AUTHORITATIVE canonical-input check: the request input must match
 * the durable task input, and comparing two objects whose key order differs is
 * not a difference in meaning.
 */
function sameJson(left: unknown, right: unknown): boolean {
  return canonicalJson(left) === canonicalJson(right);
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([key, nested]) => `${JSON.stringify(key)}:${canonicalJson(nested)}`).join(",")}}`;
}

/** The application's composed service. */
export function createCapabilityExecutionService(
  deps: CapabilityExecutionServiceDeps,
): DefaultCapabilityExecutionService {
  return new DefaultCapabilityExecutionService(deps);
}
