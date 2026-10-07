import { AiWorkforceError } from "@/modules/ai-workforce/core/errors";
import type { Clock, IdFactory } from "@/modules/ai-workforce/core/types";
import { assertNoCredentials } from "../core/credentials";
import type {
  AgentExecutionEvent,
  AgentExecutionRecord,
  AgentExecutionStatus,
  AgentJobHandle,
  AgentJobRequest,
  AgentJobSubmission,
  AsyncAgentRuntime,
  RuntimeHealth,
  RuntimeIdentity,
} from "./agent-runtime";
import {
  DETERMINISTIC_RUNTIME_TYPE,
  executionIdempotencyKeyFor,
  isTerminalExecutionStatus,
} from "./agent-runtime";

/**
 * Deterministic runtime adapter.
 *
 * In-process, no AI provider, no queue, no external call. It exists to prove
 * the `AgentRuntime` contract and to let tests drive the port. It NEVER runs a
 * real skill or tool — a submitted job is recorded and reported SUCCEEDED.
 *
 * It also satisfies the ASYNCHRONOUS contract (`AsyncAgentRuntime`) with the
 * degenerate timing: the execution completes on the same tick it starts. That
 * is deliberate — a runtime whose work is instant must not need a second
 * implementation of the lifecycle, and the core must not be able to tell it
 * apart from one whose work takes minutes.
 */

export type DeterministicRuntimeOptions = {
  id?: string;
  displayName?: string;
  capabilities?: string[];
  /** Force the reported health, so health handling can be tested. */
  health?: RuntimeHealth["status"];
  /** Force the terminal state of every execution (tests only). */
  executionOutcome?: "SUCCEEDED" | "FAILED";
  ids: IdFactory;
  now: Clock;
};

export class DeterministicRuntimeAdapter implements AsyncAgentRuntime {
  readonly identity: RuntimeIdentity;

  private readonly handles = new Map<string, AgentJobHandle>();
  private readonly records = new Map<string, AgentExecutionRecord>();
  private readonly events = new Map<string, AgentExecutionEvent[]>();
  private readonly idempotency = new Map<string, string>();
  private readonly health: RuntimeHealth["status"];
  private readonly outcome: "SUCCEEDED" | "FAILED";

  constructor(private readonly options: DeterministicRuntimeOptions) {
    this.health = options.health ?? "HEALTHY";
    this.outcome = options.executionOutcome ?? "SUCCEEDED";
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

  /* ═══════════════════════════════════════════════════
     The asynchronous lifecycle (degenerate timing)
     ═══════════════════════════════════════════════════ */

  async startJob(request: AgentJobSubmission): Promise<AgentJobHandle> {
    assertNoCredentials(request.input ?? {}, `Runtime job input for "${request.capabilityId}"`);

    const key = executionIdempotencyKeyFor(request);

    // A retry is the SAME execution. No second handle, no second record.
    if (key) {
      const known = this.idempotency.get(key);
      if (known) {
        const replayed = this.records.get(known);
        if (replayed) replayed.replayed = true;
        return this.requireHandle(known);
      }
    }

    const at = this.options.now().toISOString();
    const handleId = this.options.ids.next("handle");
    const status: AgentExecutionStatus = this.outcome;
    const handle: AgentJobHandle = {
      handleId,
      runtimeId: this.identity.id,
      jobId: request.jobId,
      // Deterministic: an accepted job is immediately "done" (no real work ran).
      status,
      submittedAt: at,
      updatedAt: at,
      detail: `deterministic no-op for ${request.capabilityId}`,
    };
    const record: AgentExecutionRecord = {
      handleId,
      runtimeId: this.identity.id,
      status,
      submittedAt: at,
      startedAt: at,
      updatedAt: at,
      completedAt: at,
      durationMs: 0,
      capabilityId: request.capabilityId,
    };
    if (request.jobId) record.jobId = request.jobId;
    if (request.missionId) record.missionId = request.missionId;
    if (request.actorId) record.actorId = request.actorId;
    if (key) {
      record.idempotencyKey = key;
      this.idempotency.set(key, handleId);
    }
    if (status === "FAILED") {
      record.error = { category: "RUNTIME_ERROR", message: "deterministic runtime configured to fail", retryable: false };
    }

    this.handles.set(handleId, handle);
    this.records.set(handleId, record);
    this.pushEvent(handleId, "SUBMITTED", "ACCEPTED");
    this.pushEvent(handleId, status === "SUCCEEDED" ? "COMPLETED" : "FAILED", status);
    return { ...handle };
  }

  async getExecution(handleId: string): Promise<AgentExecutionRecord | null> {
    const record = this.records.get(handleId);
    return record ? { ...record } : null;
  }

  async executionEvents(handleId: string): Promise<AgentExecutionEvent[]> {
    return (this.events.get(handleId) ?? []).map((event) => ({ ...event }));
  }

  async waitForExecution(handleId: string): Promise<AgentExecutionRecord> {
    const record = this.records.get(handleId);
    if (!record) throw this.notFound(handleId);
    if (!isTerminalExecutionStatus(record.status)) {
      // The deterministic runtime is instant; a non-terminal record is a bug in
      // this adapter, and saying so is better than inventing an end state.
      throw new AiWorkforceError("RUNTIME_UNSUPPORTED", "Deterministic runtime produced a non-terminal execution", {
        handleId,
        status: record.status,
      });
    }
    return { ...record };
  }

  /* ═══════════════════════════════════════════════════
     The blocking port — the fused form
     ═══════════════════════════════════════════════════ */

  async submitJob(request: AgentJobRequest): Promise<AgentJobHandle> {
    return this.startJob(request);
  }

  async resumeJob(handleId: string): Promise<AgentJobHandle> {
    const existing = this.requireHandle(handleId);
    const next: AgentJobHandle = {
      ...existing,
      status: existing.status === "CANCELLED" ? "CANCELLED" : "SUCCEEDED",
      updatedAt: this.options.now().toISOString(),
    };
    this.handles.set(handleId, next);
    const record = this.records.get(handleId);
    if (record) this.records.set(handleId, { ...record, status: next.status, updatedAt: next.updatedAt });
    return { ...next };
  }

  async cancelJob(handleId: string, reason?: string): Promise<AgentJobHandle> {
    const existing = this.requireHandle(handleId);
    const at = this.options.now().toISOString();
    const next: AgentJobHandle = {
      ...existing,
      status: "CANCELLED",
      updatedAt: at,
      detail: reason ?? existing.detail,
    };
    this.handles.set(handleId, next);
    const record = this.records.get(handleId);
    if (record) this.records.set(handleId, { ...record, status: "CANCELLED", updatedAt: at, completedAt: at });
    this.pushEvent(handleId, "CANCELLED", "CANCELLED", reason);
    return { ...next };
  }

  async getExecutionStatus(handleId: string): Promise<AgentJobHandle> {
    return { ...this.requireHandle(handleId) };
  }

  /* ═══════════════════════════════════════════════════
     Internals
     ═══════════════════════════════════════════════════ */

  private pushEvent(
    handleId: string,
    type: AgentExecutionEvent["type"],
    status: AgentExecutionStatus,
    detail?: string,
  ): void {
    const list = this.events.get(handleId) ?? [];
    const event: AgentExecutionEvent = {
      handleId,
      runtimeId: this.identity.id,
      seq: list.length + 1,
      at: this.options.now().toISOString(),
      type,
      status,
    };
    if (detail) event.detail = detail;
    list.push(event);
    this.events.set(handleId, list);
  }

  private requireHandle(handleId: string): AgentJobHandle {
    const handle = this.handles.get(handleId);
    if (!handle) throw this.notFound(handleId);
    return { ...handle };
  }

  private notFound(handleId: string): AiWorkforceError {
    return new AiWorkforceError("RUNTIME_NOT_FOUND", `This runtime has no handle "${handleId}"`, { handleId });
  }
}

export { isTerminalExecutionStatus };
