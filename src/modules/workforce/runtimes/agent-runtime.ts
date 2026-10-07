import type { Clock, IdFactory, JobId, JsonObject } from "@/modules/ai-workforce/core/types";
import type { Actor, ActorRuntimeBinding } from "../actors/actor-contracts";
import type { ActorId, CapabilityId, MissionId, RuntimeId, TaskId, TraceId } from "../core/refs";

/**
 * AgentRuntime — the provider-neutral execution port.
 *
 * This is the seam that keeps NEXUP COMMAND the owner of orchestration. A
 * runtime HOSTS execution; it does not define it. Hermes will later be ONE
 * adapter implementing exactly this interface, with no Hermes-specific field
 * leaking into the core: anything provider-specific belongs in `metadata`
 * (opaque `JsonObject`) or behind `profileRef` (an opaque string).
 *
 * Phase 2A ships only a deterministic adapter, used to prove the contract. The
 * core never talks to a model, a queue or an external service here.
 *
 *   Agent decides. Tool executes. Runtime hosts execution.
 *   Database remembers. Human owns authority.
 */

/**
 * Provider-neutral runtime type. Open vocabulary: "DETERMINISTIC_LOCAL",
 * "LOCAL_MODEL", "HUMAN", and — later — "HERMES", without a core change.
 */
export type RuntimeType = string;

export const DETERMINISTIC_RUNTIME_TYPE = "DETERMINISTIC_LOCAL";
export const HUMAN_RUNTIME_TYPE = "HUMAN";

export type RuntimeIdentity = {
  id: RuntimeId;
  type: RuntimeType;
  displayName: string;
  /** Capability ids/kinds this runtime is able to host. */
  capabilities: string[];
  /** Provider-specific detail. Opaque to the core; never contains credentials. */
  metadata: JsonObject;
};

export type RuntimeHealthStatus = "HEALTHY" | "DEGRADED" | "UNAVAILABLE";

export type RuntimeHealth = {
  status: RuntimeHealthStatus;
  checkedAt: string;
  latencyMs?: number;
  detail?: string;
};

export type AgentJobRequest = {
  jobId?: JobId;
  missionId?: MissionId;
  actorId: ActorId;
  capabilityId: CapabilityId;
  capabilityVersion?: string;
  input?: JsonObject;
  traceId: TraceId;
};

export const AGENT_EXECUTION_STATUSES = [
  "ACCEPTED",
  "RUNNING",
  "WAITING",
  "SUCCEEDED",
  "FAILED",
  "CANCELLED",
  /**
   * A real provider may report a state this neutral vocabulary does not know.
   * Adding UNKNOWN (Phase 2B adapter seam) lets an adapter be HONEST about an
   * unrecognized status instead of inventing SUCCEEDED/FAILED or mirroring a
   * provider's private terminology. The deterministic adapter never emits it.
   */
  "UNKNOWN",
] as const;
export type AgentExecutionStatus = (typeof AGENT_EXECUTION_STATUSES)[number];

export type AgentJobHandle = {
  handleId: string;
  runtimeId: RuntimeId;
  jobId?: JobId;
  status: AgentExecutionStatus;
  submittedAt: string;
  updatedAt?: string;
  /** Free-form provider note; never a credential. */
  detail?: string;
};

/**
 * The execution port.
 *
 *   submitJob           hand a capability to the runtime AND wait for the end
 *   resumeJob           continue a parked execution
 *   cancelJob           request cancellation
 *   getExecutionStatus  observe state
 *   healthCheck         is this runtime usable right now
 *
 * `submitJob` is the FUSED form (start + wait) and stays for callers that cannot
 * hold a handle across turns. A runtime with its own lifecycle also implements
 * `AsyncAgentRuntime` below, where `startJob` returns immediately and status,
 * events, waiting and cancellation are separately reachable.
 */
export interface AgentRuntime {
  readonly identity: RuntimeIdentity;
  healthCheck(): Promise<RuntimeHealth>;
  submitJob(request: AgentJobRequest): Promise<AgentJobHandle>;
  resumeJob(handleId: string, request?: Partial<AgentJobRequest>): Promise<AgentJobHandle>;
  cancelJob(handleId: string, reason?: string): Promise<AgentJobHandle>;
  getExecutionStatus(handleId: string): Promise<AgentJobHandle>;
}

export type RuntimeFactoryDeps = {
  ids: IdFactory;
  now: Clock;
};

/* ═══════════════════════════════════════════════════════
   The ASYNCHRONOUS execution contract
   ═══════════════════════════════════════════════════════

   `submitJob` fuses "start it" with "and wait for the terminal frame". A real
   runtime has its OWN lifecycle: it accepts the work, runs it on its own
   schedule, can be observed while it runs, and can be cancelled. This is that
   lifecycle, expressed with no provider vocabulary in it.

       startJob → handle → status/events → terminal result → cancel

   `AsyncAgentRuntime extends AgentRuntime` rather than replacing it, so a
   runtime that only implements the blocking port keeps working and callers ask
   for the richer contract with `isAsyncAgentRuntime()` instead of testing for a
   provider class. */

/**
 * Neutral error vocabulary. A provider adapter maps its own richer categories
 * INTO this set — the generic record never grows a provider field.
 */
export const AGENT_EXECUTION_ERROR_CATEGORIES = [
  "NONE",
  "INVALID_REQUEST",
  "TRANSPORT",
  "TIMEOUT",
  "BLOCKED",
  "UNSUPPORTED",
  "MALFORMED_OUTPUT",
  "RUNTIME_ERROR",
  /**
   * Reconciliation could NOT confirm the remote execution's state: the runtime
   * answered, and no longer knows this execution at all (a bridge restarted, a
   * provider dropped the run). This is deliberately NOT `TRANSPORT` (nothing
   * was unreachable) and deliberately NOT a terminal FAILED (the run may have
   * completed successfully before the record was lost). A caller must treat it
   * as "unverified", and a human decides whether to retry.
   */
  "UNKNOWN_REMOTE",
] as const;
export type AgentExecutionErrorCategory = (typeof AGENT_EXECUTION_ERROR_CATEGORIES)[number];

export type AgentExecutionError = {
  category: AgentExecutionErrorCategory;
  message: string;
  /** Whether an identical retry could plausibly succeed. */
  retryable: boolean;
};

/**
 * A submission may carry an idempotency key. Two submissions with the same key
 * to the SAME runtime must resolve to the SAME execution: a retry can never
 * create a second real run.
 */
export type AgentJobSubmission = AgentJobRequest & {
  idempotencyKey?: string;
};

/**
 * The derived key a runtime uses when the caller supplied none. A retried
 * dispatch of the same job IS the same execution, so `jobId` is a safe key;
 * with neither field there is no key and each submission is a new run.
 */
export function executionIdempotencyKeyFor(request: AgentJobSubmission): string | undefined {
  if (request.idempotencyKey) return request.idempotencyKey;
  if (request.jobId) return `job:${request.jobId}`;
  return undefined;
}

/**
 * The structured, provider-neutral record of ONE execution.
 *
 * `handleId` is the runtime's own reference (the id its control routes accept);
 * `providerExecutionId` is the provider's private reference (e.g. a session id)
 * — reported for audit, never used as a handle.
 */
export type AgentExecutionRecord = {
  handleId: string;
  runtimeId: RuntimeId;
  jobId?: JobId;
  missionId?: MissionId;
  actorId?: ActorId;
  capabilityId?: CapabilityId;
  status: AgentExecutionStatus;
  submittedAt: string;
  startedAt?: string;
  updatedAt: string;
  completedAt?: string;
  durationMs?: number;
  /** Provider's own reference when it differs from the handle. Never a handle. */
  providerExecutionId?: string;
  output?: unknown;
  outputText?: string;
  error?: AgentExecutionError;
  truncated?: boolean;
  /** The key this execution was deduplicated by, when one applied. */
  idempotencyKey?: string;
  /** True when this handle was returned for an ALREADY-known key: no new run. */
  replayed?: boolean;
};

/* Ordered, per-execution events. Adapter-owned observability (the push sink on
   the transport port) is unchanged; this is the pull side a caller can read. */
export const AGENT_EXECUTION_EVENT_TYPES = [
  "SUBMITTED",
  "STARTED",
  "PROGRESS",
  "STATUS",
  "COMPLETED",
  "FAILED",
  "CANCELLED",
] as const;
export type AgentExecutionEventType = (typeof AGENT_EXECUTION_EVENT_TYPES)[number];

export type AgentExecutionEvent = {
  handleId: string;
  runtimeId: RuntimeId;
  /** Monotonic within one execution, starting at 1. */
  seq: number;
  at: string;
  type: AgentExecutionEventType;
  status: AgentExecutionStatus;
  /** Bounded, non-secret note. */
  detail?: string;
};

export type AgentExecutionWaitOptions = {
  /**
   * How long the CALLER is willing to wait. On expiry `waitForExecution`
   * throws RUNTIME_TIMEOUT — it does NOT cancel the execution. Omitted = wait
   * until the runtime reaches a terminal state (the transport timeout still
   * bounds the run itself).
   */
  timeoutMs?: number;
  /** Advisory poll interval for runtimes that poll rather than subscribe. */
  pollMs?: number;
};

export const DEFAULT_EXECUTION_WAIT_TIMEOUT_MS = 120_000;

/** Terminal = finished, one way or another. `UNKNOWN` is NOT terminal. */
export function isTerminalExecutionStatus(status: AgentExecutionStatus): boolean {
  return status === "SUCCEEDED" || status === "FAILED" || status === "CANCELLED";
}

/** The asynchronous half of the port. */
export interface AgentExecutionLifecycle {
  /** Accept the work and return a usable handle. Does NOT wait for the end. */
  startJob(request: AgentJobSubmission): Promise<AgentJobHandle>;
  /** The full record, whether or not the execution has finished. */
  getExecution(handleId: string): Promise<AgentExecutionRecord | null>;
  /** Ordered events observed for this execution (empty for an unknown handle). */
  executionEvents(handleId: string): Promise<AgentExecutionEvent[]>;
  /**
   * The terminal record, waiting if necessary.
   * @throws RUNTIME_NOT_FOUND for an unstarted handle
   * @throws RUNTIME_TIMEOUT when the CALLER's wait expires (execution continues)
   */
  waitForExecution(handleId: string, options?: AgentExecutionWaitOptions): Promise<AgentExecutionRecord>;
}

/** A runtime that hosts work with its own lifecycle — the production shape. */
export interface AsyncAgentRuntime extends AgentRuntime, AgentExecutionLifecycle {}

/** Whether a runtime implements the asynchronous contract, without a cast. */
export function isAsyncAgentRuntime(runtime: AgentRuntime): runtime is AsyncAgentRuntime {
  const candidate = runtime as Partial<AsyncAgentRuntime>;
  return (
    typeof candidate.startJob === "function" &&
    typeof candidate.waitForExecution === "function" &&
    typeof candidate.getExecution === "function" &&
    typeof candidate.executionEvents === "function"
  );
}

/* ═══════════════════════════════════════════════════════
   Re-adoption — taking responsibility for work started elsewhere
   ═══════════════════════════════════════════════════════

   A process restart loses the adapter's in-memory handle bookkeeping, but NOT
   the work: a real runtime (the bridge, a provider) keeps running what it was
   asked to run, and the execution record is durable. The gap this closes is
   purely one of RESPONSIBILITY: after a restart nobody is watching the handle
   any more, and the mission cannot move because the runtime no longer knows the
   handle it minted in a previous life.

   `adoptExecution` is that hand-over, expressed provider-neutrally:

     - it NEVER resubmits the job and NEVER starts a second run: adopting is
       observing an execution that already exists, nothing else;
     - it reports what the runtime actually knows, in three honest shapes:
         ADOPTED      the runtime answered and its record is now readable here
         UNKNOWN      the runtime answered, and does not know this execution
         UNAVAILABLE  the runtime could not be asked (outage, timeout, no
                      status surface): nothing was learned, retry later

   The distinction between UNKNOWN and UNAVAILABLE is the whole point: the first
   is knowledge (“it is gone”), the second is the absence of knowledge (“we could
   not look”). A caller that conflates them will either retry work that actually
   succeeded or wait forever on a run nobody remembers.
 */

export type AgentExecutionReference = {
  /** The runtime's own handle — on BRIDGE this is the run id. */
  handleId: string;
  runtimeId?: RuntimeId;
  /** The provider's private reference, when the record carried one. */
  providerExecutionId?: string;
  /** Attribution, carried so an adopted record names the same work order. */
  actorId?: ActorId;
  capabilityId?: CapabilityId;
  missionId?: MissionId;
  taskId?: TaskId;
  attempt?: number;
};

export const AGENT_EXECUTION_ADOPTION_KINDS = ["ADOPTED", "UNKNOWN", "UNAVAILABLE"] as const;
export type AgentExecutionAdoptionKind = (typeof AGENT_EXECUTION_ADOPTION_KINDS)[number];

export type AgentExecutionAdoption =
  | { kind: "ADOPTED"; record: AgentExecutionRecord }
  | { kind: "UNKNOWN"; detail: string }
  | { kind: "UNAVAILABLE"; detail: string; retryable: boolean };

/** The re-adoption half of the port. Optional: not every runtime has a memory. */
export interface AgentExecutionRecovery {
  adoptExecution(reference: AgentExecutionReference): Promise<AgentExecutionAdoption>;
}

/** A runtime that can both host a run and be asked about one it did not start. */
export type AdoptableAgentRuntime = AsyncAgentRuntime & AgentExecutionRecovery;

export function isAgentExecutionRecovery(runtime: AgentRuntime): runtime is AgentRuntime & AgentExecutionRecovery {
  return typeof (runtime as Partial<AgentExecutionRecovery>).adoptExecution === "function";
}

/**
 * The full contract the reconciler needs in one check, so a caller can decide
 * between "this runtime can be reconciled" and "it cannot" WITHOUT probing two
 * interfaces and accidentally treating a partial runtime as adoptable.
 */
export function isReconcilableRuntime(runtime: AgentRuntime): runtime is AdoptableAgentRuntime {
  return isAsyncAgentRuntime(runtime) && isAgentExecutionRecovery(runtime);
}

/**
 * The runtime an actor should execute on.
 *
 * `null` is a FIRST-CLASS answer: a human actor (or a service identity) has no
 * AgentRuntime, and the system must be able to represent that without
 * fabricating one.
 */
export function runtimeRefForActor(actor: Actor): ActorRuntimeBinding | null {
  return actor.runtimeBinding;
}
