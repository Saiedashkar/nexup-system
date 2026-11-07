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
  /**
   * IGNORED, and kept only so an older caller still type-checks.
   *
   * The execution key is DERIVED inside the boundary, unconditionally, as
   * `executionIdempotencyKeyForAttempt(taskId, attempt)` (Step 5A-4 correction).
   * A caller-supplied value used to WIN over the derived one, which let a
   * defective or hostile caller reserve `(task, attempt)` under an arbitrary key
   * — after which the legitimate orchestration call supplied the canonical key
   * and was refused with `ATTEMPT_IDEMPOTENCY_MISMATCH`. Caller input is no
   * longer part of the attempt's identity at all.
   */
  idempotencyKey?: string;
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
  contextRefs?: readonly string[];
};

/**
 * The IMMUTABLE EXECUTION ENVELOPE (Step 5A-4 correction, P1-9).
 *
 * WHY IT EXISTS. The preflight deliberately re-reads durable state, `await`ing
 * several times along the way. The request object it was handed, however, was the
 * CALLER's: a caller could mutate `request.input` (or swap the authority) after
 * calling `execute()` and before the deterministic handler consumed it, so the
 * work that RAN would not be the work that was AUTHORISED. Every awaited check in
 * between is a window for exactly that.
 *
 * The envelope is therefore the boundary's own copy, taken SYNCHRONOUSLY on
 * entry, deep-cloned and frozen. Authorisation, the receipt, the deterministic
 * invocation, the runtime submission and finalization all read from it
 * exclusively, and the caller's object is never consulted again. Mutating the
 * request afterwards is then provably incapable of changing what executes.
 */
export type ExecutionAttemptEnvelope = {
  missionId: MissionId;
  taskId: TaskId;
  attempt: number;
  /** DERIVED inside the boundary; never taken from the request. */
  idempotencyKey: string;
  /** A frozen clone of the authenticated caller. */
  authority: ExecutionAuthority;
  assignedActorId: ActorId;
  requiredCapabilityId: CapabilityId;
  requiredCapabilityVersion?: string;
  /** A frozen clone of the canonical input. */
  input: JsonObject;
  traceId: TraceId;
  businessScope?: BusinessScope | null;
  source?: string;
  contextRefs?: readonly string[];
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

/**
 * The IMMUTABLE AUTHORITATIVE RESOLUTION a preflight produced (Step 5A-4
 * correction).
 *
 * Everything the execution path later needs — the receipt, the deterministic
 * invocation, the runtime submission — is read from THIS object and never
 * reconstructed from nullable caller fields. Authorisation and execution must
 * therefore describe the same attempt: the actor, capability, version,
 * assignment and business the policies actually approved, not whatever a later
 * code path could re-derive (and possibly re-derive differently).
 *
 * Every field is derived from DURABLE server-side state re-read during the
 * preflight; none comes from the request body.
 */
export type ExecutionResolution = {
  missionId: MissionId;
  taskId: TaskId;
  attempt: number;
  actorId: ActorId;
  capabilityId: CapabilityId;
  capabilityVersion: string;
  assignmentId: string | null;
  businessId: string | null;
  businessSlug: string | null;
  /** The runtime identity that would host this attempt (deterministic invoker id for a local leg). */
  runtimeId: string | null;
  /** The resolved local handler, when the leg is DETERMINISTIC. */
  toolDefinitionId: string | null;
  toolDefinitionVersion: string | null;
  binding: ExecutionBinding;
  spend: BudgetSpendClass;
};

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
   * The authoritative identity resolved for this attempt. `null` only when no
   * resolution was reached (an early refusal) — never null on a `DISPATCH`.
   */
  resolution: ExecutionResolution | null;
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
  /**
   * Whether the governor ACTUALLY ran.
   *
   * An earlier gate may refuse before the budget is reached, and then `budget`
   * holds the fail-closed placeholder rather than a decision. Without this flag a
   * reader cannot tell "the governor refused" from "the governor was never
   * asked", and the durable refusal reason would name whichever gate happened to
   * fire first.
   */
  budgetEvaluated: boolean;
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
  /** Its mission execution record, so cancellation can be AUDITED before it is attempted. */
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
  /**
   * THE BOUNDED WAIT ELAPSED (Step 5A-4 correction, P1-2).
   *
   * A `RUNTIME_TIMEOUT` is NOT an outage: the runtime answered nothing in time,
   * but the execution is simply still in flight and almost certainly healthy.
   * Collapsing it into `UNAVAILABLE` made a caller that had asked to WAIT see a
   * runtime outage instead, and the orchestrator then threw `RUNTIME_UNAVAILABLE`
   * — turning "still working" into "we could not reach the provider at all". The
   * typed kind keeps the two apart, and its `status` carries the last state the
   * runtime reported, which is NON-TERMINAL.
   */
  "TIMEOUT",
] as const;
export type ExecutionObservationKind = (typeof EXECUTION_OBSERVATION_KINDS)[number];

/**
 * How `observe` should look at an execution.
 *
 * The cutover replaced a blocking `dispatcher.waitForExecution` with a single
 * read, which silently turned `settleTask` into "report whatever is true right
 * now" — an in-flight run would then be escalated to a human for looking
 * unfinished. Rather than keep a `waitTimeoutMs` option that no longer did
 * anything, the governed port states the wait explicitly:
 *
 *   waitForTerminal ABSENT/false — report what is known NOW. What a
 *                                  reconciliation sweep wants.
 *   waitForTerminal true         — wait for an end state first, bounded by the
 *                                  runtime's own timeout, or by `waitTimeoutMs`
 *                                  when the caller supplies one. What `settle`
 *                                  has always meant.
 */
export type ExecutionObserveOptions = {
  waitForTerminal?: boolean;
  waitTimeoutMs?: number;
};

export type ExecutionObservation = {
  kind: ExecutionObservationKind;
  status: AgentExecutionStatus;
  detail: string;
  providerExecutionId?: string;
  /**
   * What the provider reported as the RESULT, when it reported one.
   *
   * It travels with the observation because the runtime is the only authority
   * for an execution's output: an observation that dropped it would let a
   * settled mission lose the very work a human is being asked to review. The
   * orchestrator persists it onto the same execution record it already updates,
   * so nothing is written twice and nothing is invented.
   */
  output?: unknown;
  outputText?: string;
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
  observe(ref: ExecutionHandleRef, options?: ExecutionObserveOptions): Promise<ExecutionObservation>;

  /**
   * Requests cancellation through the runtime port. Never invents a cancelled
   * run.
   *
   * AN AUTHORITY IS REQUIRED (Step 5A-4): cancellation is an external side
   * effect, so an unauthenticated or background caller must not be able to reach
   * a provider by this path. The implementation persists a `CANCEL_REQUESTED`
   * audit event BEFORE it asks the runtime, so a crash mid-cancel leaves the
   * intent on the record rather than a silent no-op.
   */
  cancel(
    ref: ExecutionHandleRef,
    input: { reason: string; authority: ExecutionAuthority },
  ): Promise<ExecutionCancellation>;

  /**
   * Cancels the ATTEMPTS of a mission's outstanding tasks, on behalf of an
   * AUTHORISED caller, and reports which attempts are UNRESOLVED.
   *
   * It is the cancellation-side linearization against irreversible dispatch: it
   * WINS the next attempt's durable claim as `CANCELLED` for a dispatchable task,
   * so a racing `execute()` finds the attempt dead and cannot reach an external
   * run; an attempt it can only observe is reported `unresolved` so the mission
   * is NOT terminalised around a run that may still be starting.
   */
  cancelMissionAttempts(input: {
    missionId: MissionId;
    tasks: readonly { taskId: TaskId; state: string }[];
    reason: string;
    authority: ExecutionAuthority;
  }): Promise<MissionAttemptCancellation[]>;
}

/** What cancelling one mission attempt resolved to. See the service for the rules. */
export type MissionAttemptCancellation = {
  taskId: TaskId;
  claimId?: string;
  state?: string;
  cancelled: boolean;
  unresolved: boolean;
  detail: string;
};

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
