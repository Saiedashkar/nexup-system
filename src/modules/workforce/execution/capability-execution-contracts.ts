import type { AiWorkforceErrorCode } from "@/modules/ai-workforce/core/errors";
import type { BusinessScope, JsonObject, ReadWriteMode, RiskLevel } from "@/modules/ai-workforce/core/types";
import type { PermissionDecision } from "@/modules/ai-workforce/policies/permission-policy";
import type { ApprovalEvaluation } from "@/modules/ai-workforce/approvals/approval-policy";
import type { BudgetDecision, BudgetSpendClass } from "@/modules/ai-workforce/policies/budget-governor";
import type { ToolDefinition } from "@/modules/ai-workforce/registry/tool-definition";
import type {
  CapabilityApprovalRequirement,
  CapabilityKind,
  CapabilityRuntimeRequirement,
} from "../capabilities/capability-contracts";
import type { ActorId, CapabilityId, ExecutionRecordId, MissionId, RuntimeId, TaskId, TraceId } from "../core/refs";
import type { AgentExecutionError, AgentExecutionStatus } from "../runtimes/agent-runtime";
import type { ExecutionAuthority } from "./execution-authority";

/**
 * CapabilityExecutionService CONTRACTS — the execution-policy boundary of
 * Step 5A.
 *
 * THE HOLE THESE CLOSE. `MissionOrchestrator.startTask` currently calls
 * `AgentRuntimeDispatcher.startJob` directly, and the only authority consulted on
 * the way is the actor registry plus the capability-assignment check. So a mission
 * can start a REAL external run without ever passing the Phase-1 controls the
 * rest of the platform obeys: no `PermissionPolicy` (business scope, permission
 * tokens), no `ApprovalGate` (HIGH-risk approval, the CRITICAL-under-AGENT
 * refusal), no money-safety rule, and no budget decision of any kind. Worse, the
 * dispatch happens BEFORE the durable execution record is written, so a crash in
 * that window leaves a real provider run nobody can adopt.
 *
 * THE SHAPE. ONE service that owns "may this attempt execute, and if so, execute
 * it exactly once":
 *
 *   preflight() → a pure decision (no writes, no I/O), so `advance()` can report
 *                 WHY a task did not move without touching a provider;
 *   execute()   → the ONLY mutating entry point: durable claim first, external
 *                 call last, never the other way round.
 *
 * The lifecycle stays where it is: `MissionOrchestrator` remains the sole
 * authority over mission/task/review state. This service decides and performs
 * DELIVERY of one attempt; it never moves a task.
 *
 * WHY THE CONTRACTS ARE HERE AND NOT IN THE ORCHESTRATOR. The orchestrator must
 * be able to talk about "this task did not start, and here is the reason" without
 * importing a dispatcher, a registry or a policy engine. These types are that
 * vocabulary. They are deliberately provider-neutral: no Hermes field, no
 * transport, no model name — everything provider-specific stays behind the
 * `AgentRuntime` port or in opaque `metadata`.
 */

/* ═══════════════════════════════════════════════════════
   Binding — which leg would execute
   ═══════════════════════════════════════════════════════

   `RUNTIME`        a governed AgentRuntime hosts it (provider-neutral; may or
                    may not incur variable cost — see `spendClassForBinding`).
   `DETERMINISTIC`  in-process deterministic/tool execution: the Phase-1
                    ToolRegistry + LocalRuntimeAdapter path, governed by the
                    SAME policies. No provider turn.
   `HUMAN`          a person must do the work. Never a dispatch, never an
                    execution attempt. It parks for review.

   Three legs, one interface, one claim, one audit spine. Adding a fourth leg
   (e.g. a batch/queue adapter) is a new binding plus an implementation — the
   orchestrator and the policies do not change. */

export const EXECUTION_BINDINGS = ["RUNTIME", "DETERMINISTIC", "HUMAN"] as const;
export type ExecutionBinding = (typeof EXECUTION_BINDINGS)[number];

export function isExecutionBinding(value: string): value is ExecutionBinding {
  return (EXECUTION_BINDINGS as readonly string[]).includes(value);
}

/* ═══════════════════════════════════════════════════════
   Spend classification — the budget question, answered once
   ═══════════════════════════════════════════════════════

   The BudgetGovernor speaks in terms of VARIABLE cost, never in terms of
   runtimes or providers (see `policies/budget-governor.ts`). Somebody has to
   translate a leg into that question, and it must happen in exactly ONE place,
   or two call sites will eventually disagree and one of them will be the
   permissive one.

   FAIL-CLOSED DIRECTION: a `RUNTIME` leg counts as VARIABLE_COST unless the
   runtime ITSELF declares otherwise, because an unknown runtime is exactly the
   case where guessing "it's free" is how money gets spent. A declaration must be
   explicit (`variableCost: false`), which is what the deterministic local
   adapter can honestly do and what a real provider adapter never should. */

/** Runtime identity metadata key a NON-SPENDING runtime sets to `false`. */
export const RUNTIME_VARIABLE_COST_METADATA_KEY = "variableCost";

/**
 * True only when a runtime's identity metadata EXPLICITLY declares that hosting
 * this work cannot incur per-use provider cost. Absent, malformed or `true`
 * means "treat as spending".
 */
export function runtimeDeclaresNoVariableCost(metadata: JsonObject | null | undefined): boolean {
  if (!metadata) return false;
  return metadata[RUNTIME_VARIABLE_COST_METADATA_KEY] === false;
}

/**
 * The spend class of a leg. Deterministic and human work cannot incur per-use
 * provider cost; a runtime leg is treated as spending unless the runtime declares
 * otherwise.
 */
export function spendClassForBinding(
  binding: ExecutionBinding,
  options: { runtimeDeclaresNoVariableCost?: boolean } = {},
): BudgetSpendClass {
  if (binding === "DETERMINISTIC" || binding === "HUMAN") return "NO_VARIABLE_COST";
  return options.runtimeDeclaresNoVariableCost === true ? "NO_VARIABLE_COST" : "VARIABLE_PROVIDER_COST";
}

/* ═══════════════════════════════════════════════════════
   The attempt
   ═══════════════════════════════════════════════════════

   Everything here is derived by the caller from durable state and the
   authenticated authority — nothing is taken from a request body. In particular
   `idempotencyKey` is COMPUTED (`task:<id>:attempt:<n>`), not accepted, so a
   caller cannot forge a key that makes two different attempts look like one, or
   two retries look like two attempts. */

export type ExecutionAttemptRequest = {
  missionId: MissionId;
  taskId: TaskId;
  /** 1-based attempt number inside the task. */
  attempt: number;
  /** Deterministic, server-built: `task:<taskId>:attempt:<attempt>`. */
  idempotencyKey: string;
  /** The authenticated caller. Never payload-supplied. */
  authority: ExecutionAuthority;
  /** The actor accountable for this task. */
  assignedActorId: ActorId;
  requiredCapabilityId: CapabilityId;
  requiredCapabilityVersion?: string;
  /** Bounded, structured input handed to the capability. */
  input: JsonObject;
  /** Correlation/trace id for the whole attempt. */
  traceId: TraceId;
  /** The mission's business scope, when it names one. */
  businessScope?: BusinessScope | null;
  /** How the attempt was triggered; feeds autonomy/approval evaluation. */
  source?: string;
  /** Extra, non-secret context an adapter MAY read. Never interpreted by policy. */
  contextRefs?: string[];
};

/**
 * The deterministic key for one attempt.
 *
 * `AiExecutionRecord` already carries `@@unique([taskId, attempt])`, so this
 * spelling matches the durable uniqueness that already exists rather than
 * inventing a second notion of "the same attempt".
 */
export function executionIdempotencyKeyForAttempt(taskId: TaskId, attempt: number): string {
  return `task:${taskId}:attempt:${attempt}`;
}

/* ═══════════════════════════════════════════════════════
   Preflight — the pure decision
   ═══════════════════════════════════════════════════════ */

export const EXECUTION_PREFLIGHT_DECISIONS = [
  /** Every control passed and no approval is outstanding: the attempt may be claimed. */
  "DISPATCH",
  /** An approval is required and not yet satisfied. Nothing was dispatched. */
  "WAIT_APPROVAL",
  /** The capability needs a person. Nothing was dispatched, and nothing will be. */
  "WAIT_HUMAN",
  /** A control refused with a recoverable/operational reason (e.g. unassigned). */
  "BLOCKED",
  /** A control refused on principle (permission, scope, money safety, budget). */
  "DENY",
] as const;
export type ExecutionPreflightDecision = (typeof EXECUTION_PREFLIGHT_DECISIONS)[number];

export type ExecutionPreflightResult = {
  capability: {
    id: CapabilityId;
    version?: string;
    /** False when the capability could not be resolved at all. */
    resolved: boolean;
    kind: CapabilityKind;
    riskLevel: RiskLevel;
    readWriteMode: ReadWriteMode;
    approvalRequirement: CapabilityApprovalRequirement;
    runtimeRequirements: CapabilityRuntimeRequirement;
  };
  /**
   * The descriptor the policies evaluated: the resolved `ToolDefinition` for a
   * TOOL capability, or the synthetic non-executable `RUNTIME_DISPATCH_DEFINITION`
   * for anything else. NEVER null when a decision was reached — a policy decision
   * that names no descriptor is not auditable.
   */
  descriptor: ToolDefinition | null;
  binding: ExecutionBinding;
  spend: BudgetSpendClass;
  permission: PermissionDecision;
  approval: ApprovalEvaluation | null;
  budget: BudgetDecision;
  decision: ExecutionPreflightDecision;
  /** Set for `BLOCKED`/`DENY`: the typed refusal, safe to surface to an operator. */
  blocked?: { code: AiWorkforceErrorCode; message: string };
};

/* ═══════════════════════════════════════════════════════
   Outcome — what `execute()` actually did
   ═══════════════════════════════════════════════════════

   A DISCRIMINATED UNION, not a boolean plus fields. "Did it execute?" has more
   than two answers, and collapsing them is how a restart turns into a duplicate
   provider run: `IN_PROGRESS` (someone else owns the attempt), `REPLAYED` (this
   attempt already exists) and `UNVERIFIED` (an external run MAY exist and we
   cannot prove either way) must be distinguishable from `DISPATCHED`, because the
   correct reaction to each is different. */

export const EXECUTION_OUTCOME_KINDS = [
  /** This call claimed the attempt and the external execution started. */
  "DISPATCHED",
  /** The attempt was already claimed and a durable execution exists: adopted. */
  "REPLAYED",
  /** Another process holds a live claim on this attempt. Nothing was started. */
  "IN_PROGRESS",
  /** An approval is outstanding. Nothing was started. */
  "WAIT_APPROVAL",
  /** The capability requires a person. Nothing was started, nothing will be. */
  "WAIT_HUMAN",
  /** A recoverable/operational refusal. Nothing was started. */
  "BLOCKED",
  /** A principle-level refusal (permission, scope, money safety, budget). */
  "DENIED",
  /**
   * Dispatch was ENTERED and no durable handle exists. The run may have started.
   * NEVER automatically re-dispatched — a human/operator resolves it.
   */
  "UNVERIFIED",
  /** The attempt failed in a way that is honestly reportable and not a duplicate risk. */
  "FAILED",
] as const;
export type ExecutionOutcomeKind = (typeof EXECUTION_OUTCOME_KINDS)[number];

export type ExecutionOutcome =
  | {
      kind: "DISPATCHED";
      claimId: string;
      executionRecordId: ExecutionRecordId;
      handleId: string;
      runtimeId: RuntimeId;
      status: AgentExecutionStatus;
    }
  | { kind: "REPLAYED"; claimId: string; executionRecordId: ExecutionRecordId; handleId: string; runtimeId: RuntimeId }
  | { kind: "IN_PROGRESS"; claimId: string }
  | { kind: "WAIT_APPROVAL"; claimId?: string; approvalId?: string; descriptorId: string }
  | { kind: "WAIT_HUMAN"; claimId?: string; detail: string }
  | { kind: "BLOCKED"; claimId?: string; code: AiWorkforceErrorCode; message: string }
  | { kind: "DENIED"; claimId?: string; code: AiWorkforceErrorCode; message: string }
  | { kind: "UNVERIFIED"; claimId: string; detail: string }
  | { kind: "FAILED"; claimId?: string; executionRecordId?: ExecutionRecordId; error: AgentExecutionError };

/* ═══════════════════════════════════════════════════════
   Observe / cancel — reachable through the SAME service
   ═══════════════════════════════════════════════════════

   Status and cancellation go through this service too, not around it. If a
   caller could reach a runtime by another route, it could reach an execution the
   claim does not know about, and the attempt ledger would stop being the truth. */

export type ExecutionHandleRef = {
  runtimeId: RuntimeId;
  handleId: string;
  executionRecordId?: ExecutionRecordId;
  missionId?: MissionId;
  taskId?: TaskId;
};

export const EXECUTION_OBSERVATION_KINDS = [
  /** The runtime reported a state, and said what this attempt is. */
  "KNOWN",
  /** A process that did not start it took responsibility for an existing execution. */
  "ADOPTED",
  /** The runtime answered and no longer knows this execution. Never a fake FAILED. */
  "UNVERIFIED",
  /** The runtime could not be asked at all. An outage is not evidence. */
  "UNAVAILABLE",
  /** No runtime is registered for the id the record names. */
  "NO_RUNTIME",
] as const;
export type ExecutionObservationKind = (typeof EXECUTION_OBSERVATION_KINDS)[number];

export type ExecutionObservation = {
  kind: ExecutionObservationKind;
  status: AgentExecutionStatus;
  detail: string;
  providerExecutionId?: string;
  error?: AgentExecutionError;
};

export type ExecutionCancellation = {
  cancelled: boolean;
  detail: string;
  status?: AgentExecutionStatus;
};

/* ═══════════════════════════════════════════════════════
   The port
   ═══════════════════════════════════════════════════════ */

export interface CapabilityExecutionService {
  /**
   * Decides without side effects: no writes, no claims, no network.
   *
   * It is what lets `MissionOrchestrator.advance()` report a truthful reason for
   * a task that did not move, from the SAME rules that would govern a dispatch —
   * rather than duplicating a guess about why, or performing a real run to find
   * out.
   */
  preflight(request: ExecutionAttemptRequest): Promise<ExecutionPreflightResult>;

  /**
   * Claims the attempt, then executes it. The only mutating entry point.
   *
   * ORDER IS THE CONTRACT: the durable claim is written BEFORE any external call
   * happens, and there is no path to a runtime that skips it. A caller that
   * cannot obtain the claim does not execute.
   */
  execute(request: ExecutionAttemptRequest): Promise<ExecutionOutcome>;

  /** Reads what became of an execution an attempt record names. Never dispatches. */
  observe(ref: ExecutionHandleRef): Promise<ExecutionObservation>;

  /** Requests cancellation through the runtime port. Never invents a cancelled run. */
  cancel(ref: ExecutionHandleRef, reason: string): Promise<ExecutionCancellation>;
}

/**
 * The dependencies an implementation MUST be given.
 *
 * Spelled out as a type so the fail-closed rule is visible in the contract
 * itself: there is no optional authorization source here, and an implementation
 * composed without one must refuse (`AUTHORIZATION_UNAVAILABLE`) rather than
 * allow — the same posture `AgentRuntimeDispatcher` already takes for actors and
 * assignments.
 */
export type CapabilityExecutionServiceRequirements = {
  permissions: "REQUIRED";
  approvals: "REQUIRED";
  capabilities: "REQUIRED";
  claims: "REQUIRED";
  executions: "REQUIRED";
  runtimes: "REQUIRED";
  budget: "REQUIRED";
};

/** The requirement set, as data, so a test can assert the posture did not relax. */
export const CAPABILITY_EXECUTION_REQUIREMENTS: CapabilityExecutionServiceRequirements = {
  permissions: "REQUIRED",
  approvals: "REQUIRED",
  capabilities: "REQUIRED",
  claims: "REQUIRED",
  executions: "REQUIRED",
  runtimes: "REQUIRED",
  budget: "REQUIRED",
};
