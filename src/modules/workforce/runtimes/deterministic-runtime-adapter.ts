import { AiWorkforceError } from "@/modules/ai-workforce/core/errors";
import type { Clock, IdFactory } from "@/modules/ai-workforce/core/types";
import { assertNoCredentials } from "../core/credentials";
import type {
  AgentExecutionStatus,
  AgentJobHandle,
  AgentJobRequest,
  AgentRuntime,
  RuntimeHealth,
  RuntimeIdentity,
} from "./agent-runtime";
import { DETERMINISTIC_RUNTIME_TYPE } from "./agent-runtime";

/**
 * Deterministic runtime adapter.
 *
 * In-process, no AI provider, no queue, no external call. It exists to prove
 * the `AgentRuntime` contract and to let tests drive the port. It NEVER runs a
 * real skill or tool — a submitted job is recorded and reported SUCCEEDED.
 *
 * A future `HermesRuntimeAdapter` implements the same interface; the core
 * cannot tell the two apart, which is the whole point of the port.
 */

export type DeterministicRuntimeOptions = {
  id?: string;
  displayName?: string;
  capabilities?: string[];
  /** Force the reported health, so health handling can be tested. */
  health?: RuntimeHealth["status"];
  ids: IdFactory;
  now: Clock;
};

export class DeterministicRuntimeAdapter implements AgentRuntime {
  readonly identity: RuntimeIdentity;

  private readonly handles = new Map<string, AgentJobHandle>();
  private readonly health: RuntimeHealth["status"];

  constructor(private readonly options: DeterministicRuntimeOptions) {
    this.health = options.health ?? "HEALTHY";
    this.identity = {
      id: options.id ?? "runtime_deterministic",
      type: DETERMINISTIC_RUNTIME_TYPE,
      displayName: options.displayName ?? "Deterministic Local Runtime",
      capabilities: options.capabilities ? [...options.capabilities] : [],
      metadata: { deterministic: true, externalCalls: false },
    };
  }

  async healthCheck(): Promise<RuntimeHealth> {
    return {
      status: this.health,
      checkedAt: this.options.now().toISOString(),
      latencyMs: 0,
      detail: this.health === "HEALTHY" ? "in-process deterministic runtime" : "runtime reported unhealthy in configuration",
    };
  }

  async submitJob(request: AgentJobRequest): Promise<AgentJobHandle> {
    assertNoCredentials(request.input ?? {}, `Runtime job input for "${request.capabilityId}"`);

    const handle: AgentJobHandle = {
      handleId: this.options.ids.next("handle"),
      runtimeId: this.identity.id,
      jobId: request.jobId,
      // Deterministic: an accepted job is immediately "done" (no real work ran).
      status: "SUCCEEDED",
      submittedAt: this.options.now().toISOString(),
      updatedAt: this.options.now().toISOString(),
      detail: `deterministic no-op for ${request.capabilityId}`,
    };
    this.handles.set(handle.handleId, handle);
    return { ...handle };
  }

  async resumeJob(handleId: string): Promise<AgentJobHandle> {
    const existing = this.requireHandle(handleId);
    const next: AgentJobHandle = {
      ...existing,
      status: existing.status === "CANCELLED" ? "CANCELLED" : "SUCCEEDED",
      updatedAt: this.options.now().toISOString(),
    };
    this.handles.set(handleId, next);
    return { ...next };
  }

  async cancelJob(handleId: string, reason?: string): Promise<AgentJobHandle> {
    const existing = this.requireHandle(handleId);
    const next: AgentJobHandle = {
      ...existing,
      status: "CANCELLED",
      updatedAt: this.options.now().toISOString(),
      detail: reason ?? existing.detail,
    };
    this.handles.set(handleId, next);
    return { ...next };
  }

  async getExecutionStatus(handleId: string): Promise<AgentJobHandle> {
    return { ...this.requireHandle(handleId) };
  }

  private requireHandle(handleId: string): AgentJobHandle {
    const handle = this.handles.get(handleId);
    if (!handle) {
      throw new AiWorkforceError("RUNTIME_NOT_FOUND", `This runtime has no handle "${handleId}"`, { handleId });
    }
    return handle;
  }
}

/** Small helper for tests: does this status mean "finished, one way or another"? */
export function isTerminalExecutionStatus(status: AgentExecutionStatus): boolean {
  return status === "SUCCEEDED" || status === "FAILED" || status === "CANCELLED";
}
