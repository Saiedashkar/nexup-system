import { AiWorkforceError } from "@/modules/ai-workforce/core/errors";
import type { Clock, IdFactory } from "@/modules/ai-workforce/core/types";
import type {
  AgentJobHandle,
  AgentRuntime,
  RuntimeHealth,
  RuntimeHealthStatus,
  RuntimeIdentity,
} from "../agent-runtime";
import { HERMES_RUNTIME_TYPE, type HermesRuntimeCapabilities, type HermesRuntimeConfig } from "./hermes-config";
import { noopRuntimeEventSink, type HermesTransport, type RuntimeEvent, type RuntimeEventSink } from "./hermes-transport";
import {
  mapJobToHermesPayload,
  normalizeHermesTransportResult,
  parseHermesRaw,
  type HermesExecutionRecord,
  type HermesJobRequest,
} from "./hermes-mapping";

/**
 * HermesRuntimeAdapter.
 *
 * Implements the Phase 2A `AgentRuntime` port. The core sees only that port —
 * there is no Hermes type in any core contract. Everything Hermes-specific
 * (profile, transport, payload shape, status vocabulary) lives behind this
 * class and its mapping/transport helpers.
 *
 * Safety posture:
 *   - it addresses exactly ONE configured profile; other profiles are never
 *     referenced, enumerated or modified;
 *   - it never authorises anything — it receives an already-authorized request
 *     and hosts execution;
 *   - it never fakes an unsupported operation: cancel/resume throw a typed
 *     NOT_IMPLEMENTED unless the environment explicitly enables them;
 *   - it never mutates Hermes during a health check.
 */

export type HermesRuntimeAdapterOptions = {
  config: HermesRuntimeConfig;
  transport: HermesTransport;
  now?: Clock;
  /** Optional id factory for locally-minted handle ids. */
  ids?: IdFactory;
  eventSink?: RuntimeEventSink;
  /** Adapter-local capability overrides (tests use this to disable cancel). */
  capabilities?: Partial<HermesRuntimeCapabilities>;
};

export class HermesRuntimeAdapter implements AgentRuntime {
  readonly identity: RuntimeIdentity;

  private readonly config: HermesRuntimeConfig;
  private readonly transport: HermesTransport;
  private readonly now: Clock;
  private readonly ids?: IdFactory;
  private readonly sink: RuntimeEventSink;
  private readonly capabilities: HermesRuntimeCapabilities;

  private readonly records = new Map<string, HermesExecutionRecord>();
  private readonly handles = new Map<string, AgentJobHandle>();
  private localCounter = 0;

  constructor(options: HermesRuntimeAdapterOptions) {
    this.config = options.config;
    this.transport = options.transport;
    this.now = options.now ?? (() => new Date());
    this.ids = options.ids;
    this.sink = options.eventSink ?? noopRuntimeEventSink;
    this.capabilities = { ...options.config.capabilities, ...options.capabilities };

    // `profileRef` is the opaque reference the core may carry; the actual
    // profile string lives only in adapter-owned metadata.
    this.identity = {
      id: options.config.runtimeId,
      type: HERMES_RUNTIME_TYPE,
      displayName: options.config.displayName,
      capabilities: ["TOOL", "SKILL", "WORKFLOW"],
      metadata: {
        transport: options.config.transport,
        profileRef: options.config.profile,
        supportsCancel: this.capabilities.cancel,
        supportsResume: this.capabilities.resume,
        timeoutMs: options.config.timeoutMs,
      },
    };
  }

  /* ═══════════════════════════════════════════════════
     Health
     ═══════════════════════════════════════════════════ */

  async healthCheck(): Promise<RuntimeHealth> {
    const checkedAt = this.now().toISOString();

    // A synchronous one-shot transport exposes NO health surface. Report that
    // honestly (DEGRADED = configured but not probeable) instead of spawning a
    // probe or inventing a status.
    if (!this.capabilities.health) {
      this.emit({
        type: "runtime.health",
        status: "DEGRADED",
        profile: this.config.profile,
        detail: "transport exposes no health probe",
      });
      return {
        status: "DEGRADED",
        checkedAt,
        latencyMs: 0,
        detail: "Runtime exposes no health probe; verify with a submit.",
      };
    }

    const startedAt = Date.now();

    const result = await this.transport.invoke({
      operation: "health",
      profile: this.config.profile,
      timeoutMs: this.config.timeoutMs,
      maxOutputBytes: this.config.maxOutputBytes,
      correlation: { actorId: "system", traceId: "health" },
    });

    const { parsed } = parseHermesRaw(result.raw);
    const rawStatus = typeof parsed?.status === "string" ? parsed.status.toLowerCase() : "";
    const version = typeof parsed?.version === "string" ? parsed.version : undefined;

    let status: RuntimeHealthStatus = "UNAVAILABLE";
    if (result.ok) {
      if (["healthy", "ok", "ready", "up"].includes(rawStatus)) status = "HEALTHY";
      else if (["degraded", "warning", "warn"].includes(rawStatus)) status = "DEGRADED";
      else status = "DEGRADED";
    } else if (result.transportError === "TIMEOUT" || result.transportError === "UNAVAILABLE") {
      status = "UNAVAILABLE";
    }

    this.emit({
      type: "runtime.health",
      status,
      profile: this.config.profile,
      durationMs: Date.now() - startedAt,
      detail: version ? `version ${version}` : undefined,
    });

    const health: RuntimeHealth = { status, checkedAt, latencyMs: Date.now() - startedAt };
    if (status !== "HEALTHY") health.detail = "Hermes runtime did not report a usable status";
    return health;
  }

  /* ═══════════════════════════════════════════════════
     Submit
     ═══════════════════════════════════════════════════ */

  async submitJob(request: HermesJobRequest): Promise<AgentJobHandle> {
    const { payload, correlation } = mapJobToHermesPayload(request);
    const startedAt = Date.now();

    const result = await this.transport.invoke({
      operation: "submit",
      profile: this.config.profile,
      payload,
      timeoutMs: this.config.timeoutMs,
      maxOutputBytes: this.config.maxOutputBytes,
      correlation,
    });

    const record = normalizeHermesTransportResult({
      result,
      runtime: { id: this.identity.id, type: this.identity.type },
      now: this.now(),
      textOnly: this.transport.kind === "CLI_ONESHOT",
    });

    const handle = this.remember(request.jobId, record);
    this.emit({
      type: "runtime.submit",
      status: record.status,
      profile: this.config.profile,
      executionId: record.executionId ?? undefined,
      jobId: request.jobId,
      missionId: request.missionId,
      actorId: request.actorId,
      traceId: request.traceId,
      durationMs: Date.now() - startedAt,
    });
    this.emitLifecycle(record, { jobId: request.jobId, missionId: request.missionId, actorId: request.actorId, traceId: request.traceId });

    return handle;
  }

  /* ═══════════════════════════════════════════════════
     Status
     ═══════════════════════════════════════════════════ */

  async getExecutionStatus(handleId: string): Promise<AgentJobHandle> {
    const existing = this.records.get(handleId) ?? null;
    const executionId = existing?.executionId ?? handleId;

    if (!this.capabilities.status) {
      // No live status surface: report what we last knew, honestly.
      if (existing) return this.toHandle(handleId, existing);
      throw new AiWorkforceError("NOT_IMPLEMENTED", "Hermes runtime does not expose execution status", { handleId });
    }

    const result = await this.transport.invoke({
      operation: "status",
      profile: this.config.profile,
      payload: { instruction: "", contextJson: "{}", executionId },
      timeoutMs: this.config.timeoutMs,
      maxOutputBytes: this.config.maxOutputBytes,
      correlation: { actorId: "system", traceId: handleId },
    });

    const record = normalizeHermesTransportResult({
      result,
      runtime: { id: this.identity.id, type: this.identity.type },
      now: this.now(),
      textOnly: this.transport.kind === "CLI_ONESHOT",
    });
    const handle = this.remember(undefined, record, handleId);
    this.emit({
      type: "runtime.started",
      status: record.status,
      profile: this.config.profile,
      executionId: record.executionId ?? executionId,
      actorId: "system",
      traceId: handleId,
    });
    return handle;
  }

  /* ═══════════════════════════════════════════════════
     Cancel / resume — never faked
     ═══════════════════════════════════════════════════ */

  async cancelJob(handleId: string, reason?: string): Promise<AgentJobHandle> {
    if (!this.capabilities.cancel) {
      throw new AiWorkforceError(
        "NOT_IMPLEMENTED",
        "Hermes runtime does not support cancellation (enable HERMES_RUNTIME_SUPPORTS_CANCEL to claim it)",
        { handleId, operation: "cancel" },
      );
    }
    const executionId = this.records.get(handleId)?.executionId ?? handleId;
    const result = await this.transport.invoke({
      operation: "cancel",
      profile: this.config.profile,
      payload: { instruction: "", contextJson: "{}", executionId },
      timeoutMs: this.config.timeoutMs,
      maxOutputBytes: this.config.maxOutputBytes,
      correlation: { actorId: "system", traceId: handleId },
    });
    const record = normalizeHermesTransportResult({
      result,
      runtime: { id: this.identity.id, type: this.identity.type },
      now: this.now(),
      textOnly: this.transport.kind === "CLI_ONESHOT",
    });
    const handle = this.remember(undefined, { ...record, status: "CANCELLED" }, handleId);
    this.emit({ type: "runtime.cancelled", status: "CANCELLED", profile: this.config.profile, executionId, detail: reason });
    return handle;
  }

  async resumeJob(handleId: string): Promise<AgentJobHandle> {
    if (!this.capabilities.resume) {
      throw new AiWorkforceError(
        "NOT_IMPLEMENTED",
        "Hermes runtime does not support resuming an execution (enable HERMES_RUNTIME_SUPPORTS_RESUME to claim it)",
        { handleId, operation: "resume" },
      );
    }
    const executionId = this.records.get(handleId)?.executionId ?? handleId;
    const result = await this.transport.invoke({
      operation: "resume",
      profile: this.config.profile,
      payload: { instruction: "", contextJson: "{}", executionId },
      timeoutMs: this.config.timeoutMs,
      maxOutputBytes: this.config.maxOutputBytes,
      correlation: { actorId: "system", traceId: handleId },
    });
    const record = normalizeHermesTransportResult({
      result,
      runtime: { id: this.identity.id, type: this.identity.type },
      now: this.now(),
      textOnly: this.transport.kind === "CLI_ONESHOT",
    });
    return this.remember(undefined, record, handleId);
  }

  /* ═══════════════════════════════════════════════════
     Adapter-owned accessors (NOT part of the core port)
     ═══════════════════════════════════════════════════ */

  /** The normalized execution record behind a handle. */
  getExecutionRecord(handleId: string): HermesExecutionRecord | null {
    return this.records.get(handleId) ?? null;
  }

  /** Whether a given operation is supported, without try/catch. */
  supports(operation: "submit" | "status" | "cancel" | "resume" | "health"): boolean {
    return this.capabilities[operation];
  }

  /* ═══════════════════════════════════════════════════
     Internals
     ═══════════════════════════════════════════════════ */

  private remember(jobId: string | undefined, record: HermesExecutionRecord, forcedHandleId?: string): AgentJobHandle {
    const handleId = forcedHandleId ?? record.executionId ?? this.mintHandleId();
    const previous = this.handles.get(handleId);
    const at = this.now().toISOString();

    const handle: AgentJobHandle = {
      handleId,
      runtimeId: this.identity.id,
      jobId: jobId ?? previous?.jobId,
      status: record.status,
      submittedAt: previous?.submittedAt ?? at,
      updatedAt: at,
    };
    if (record.error) handle.detail = record.error.message;

    this.records.set(handleId, record);
    this.handles.set(handleId, handle);
    return { ...handle };
  }

  private toHandle(handleId: string, record: HermesExecutionRecord): AgentJobHandle {
    const existing = this.handles.get(handleId);
    return {
      handleId,
      runtimeId: this.identity.id,
      jobId: existing?.jobId,
      status: record.status,
      submittedAt: existing?.submittedAt ?? this.now().toISOString(),
      updatedAt: this.now().toISOString(),
      detail: record.error?.message,
    };
  }

  private mintHandleId(): string {
    if (this.ids) return this.ids.next("hermes");
    this.localCounter += 1;
    return `hermes_handle_${String(this.localCounter).padStart(4, "0")}`;
  }

  private emitLifecycle(
    record: HermesExecutionRecord,
    correlation: { jobId?: string; missionId?: string; actorId?: string; traceId?: string },
  ): void {
    const base = {
      profile: this.config.profile,
      executionId: record.executionId ?? undefined,
      jobId: correlation.jobId,
      missionId: correlation.missionId,
      actorId: correlation.actorId,
      traceId: correlation.traceId,
      durationMs: record.durationMs,
    };
    if (record.status === "SUCCEEDED") this.emit({ type: "runtime.completed", status: record.status, ...base });
    else if (record.status === "FAILED") {
      this.emit({ type: "runtime.failed", status: record.status, ...base, detail: record.error?.message });
    }
  }

  private emit(event: Omit<RuntimeEvent, "at" | "runtimeId">): void {
    // Only ids, a non-secret profile slug, statuses and timings are emitted.
    this.sink({ ...event, at: this.now().toISOString(), runtimeId: this.identity.id });
  }
}
