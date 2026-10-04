import type { Clock, IdFactory, JobId, JsonObject } from "@/modules/ai-workforce/core/types";
import type { Actor, ActorRuntimeBinding } from "../actors/actor-contracts";
import type { ActorId, CapabilityId, MissionId, RuntimeId, TraceId } from "../core/refs";

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
 *   submitJob           hand a capability to the runtime
 *   resumeJob           continue a parked execution
 *   cancelJob           request cancellation
 *   getExecutionStatus  observe state
 *   healthCheck         is this runtime usable right now
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
