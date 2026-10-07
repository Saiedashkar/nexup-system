import { AiWorkforceError } from "@/modules/ai-workforce/core/errors";
import type { Clock, IdFactory } from "@/modules/ai-workforce/core/types";
import type {
  AgentExecutionAdoption,
  AgentExecutionEvent,
  AgentExecutionRecord,
  AgentExecutionReference,
  AgentExecutionStatus,
  AgentExecutionWaitOptions,
  AgentJobHandle,
  AgentJobSubmission,
  AgentRuntime,
  AsyncAgentRuntime,
  RuntimeHealth,
  RuntimeHealthStatus,
  RuntimeIdentity,
} from "../agent-runtime";
import {
  executionIdempotencyKeyFor,
  isTerminalExecutionStatus,
} from "../agent-runtime";
import { HERMES_RUNTIME_TYPE, type HermesRuntimeCapabilities, type HermesRuntimeConfig } from "./hermes-config";
import {
  isHermesAsyncTransport,
  noopRuntimeEventSink,
  type HermesTransport,
  type HermesTransportResult,
  type RuntimeEvent,
  type RuntimeEventSink,
} from "./hermes-transport";
import {
  mapJobToHermesPayload,
  normalizeHermesTransportResult,
  parseHermesRaw,
  toGenericErrorCategory,
  type HermesExecutionRecord,
  type HermesJobRequest,
} from "./hermes-mapping";

/**
 * HermesRuntimeAdapter.
 *
 * Implements the Phase 2A `AgentRuntime` port AND the Phase-2B asynchronous
 * execution contract (`AsyncAgentRuntime`). The core sees only those ports —
 * there is no Hermes type in any core contract. Everything Hermes-specific
 * (profile, transport, payload shape, status vocabulary) lives behind this
 * class and its mapping/transport helpers.
 *
 * The lifecycle, when the transport can start a run without waiting for it:
 *
 *   startJob   → POST /v1/runs, return the bridge's run id as the handle
 *   (background) → drain the terminal frame, apply it ONCE
 *   status/events → readable while the run is alive
 *   cancel     → POST /v1/runs/:id/cancel, reachable in flight through the port
 *   wait       → resolve on the terminal record, with a CALLER-side timeout
 *
 * Two rules that keep it honest:
 *   - the FIRST terminal state wins: a cancelled or completed run is never
 *     overwritten by a later frame;
 *   - a replayed submission (same idempotency key) returns the SAME handle and
 *     performs NO second transport call.
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
  /**
   * Explicitly permit binding a `provenance: "TEST"` transport. TEST fixtures
   * set this; the production factory (`createHermesRuntimeFromEnv`) never does,
   * and neither does any application composition, so canned output cannot be
   * wired into a real actor execution by accident. Omitted ⇒ refused.
   */
  allowTestTransport?: boolean;
};

export class HermesRuntimeAdapter implements AgentRuntime, AsyncAgentRuntime {
  readonly identity: RuntimeIdentity;

  private readonly config: HermesRuntimeConfig;
  private readonly transport: HermesTransport;
  private readonly now: Clock;
  private readonly ids?: IdFactory;
  private readonly sink: RuntimeEventSink;
  private readonly capabilities: HermesRuntimeCapabilities;

  private readonly records = new Map<string, HermesExecutionRecord>();
  private readonly handles = new Map<string, AgentJobHandle>();
  private readonly events = new Map<string, AgentExecutionEvent[]>();
  /** In-flight background completions, by handle. */
  private readonly pending = new Map<string, Promise<void>>();
  /** Idempotency key → handle id. A retry must never create a second run. */
  private readonly idempotency = new Map<string, string>();
  /** Attribution captured at start, so a record names its actor/capability/mission. */
  private readonly contexts = new Map<
    string,
    { actorId?: string; missionId?: string; capabilityId?: string; jobId?: string }
  >();
  private localCounter = 0;

  constructor(options: HermesRuntimeAdapterOptions) {
    // PROVENANCE GATE — fail-closed. A transport must DECLARE that it reaches a
    // real runtime. Anything else (a test double, an object that simply forgot
    // the field) is refused unless the caller explicitly asked for test
    // transports, so a mock cannot silently become the production path. This is
    // a declared boundary, not a provider-name check on a generic contract.
    const provenance = (options.transport as { provenance?: string } | undefined)?.provenance;
    if (provenance !== "PRODUCTION" && !options.allowTestTransport) {
      throw new AiWorkforceError(
        "RUNTIME_UNSUPPORTED",
        `Refusing to bind a Hermes transport with provenance "${provenance ?? "undeclared"}" — real actor execution requires a PRODUCTION transport`,
        { reason: "NON_PRODUCTION_TRANSPORT", provenance: provenance ?? "UNDECLARED" },
      );
    }

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
        supportsAsync: isHermesAsyncTransport(options.transport),
        idempotentSubmit: true,
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
     Submit — the fused form (start + wait)
     ═══════════════════════════════════════════════════ */

  async submitJob(request: HermesJobRequest): Promise<AgentJobHandle> {
    const handle = await this.startJob(request);
    // Wait without a caller-side deadline: the transport's own timeout already
    // bounds the run, and the blocking form has always returned the terminal
    // handle it recorded.
    await this.waitForExecution(handle.handleId);
    return this.requireHandleCopy(handle.handleId);
  }

  /* ═══════════════════════════════════════════════════
     Start — returns as soon as the run EXISTS
     ═══════════════════════════════════════════════════ */

  async startJob(request: AgentJobSubmission): Promise<AgentJobHandle> {
    const key = executionIdempotencyKeyFor(request);

    // A retry is the SAME execution. No second transport call is made at all.
    if (key) {
      const knownHandleId = this.idempotency.get(key);
      if (knownHandleId) {
        const record = this.records.get(knownHandleId);
        if (record) record.replayed = true;
        const handle = this.requireHandleCopy(knownHandleId);
        if (record) {
          this.emit({
            type: "runtime.submit",
            status: handle.status,
            profile: this.config.profile,
            executionId: record.executionId ?? knownHandleId,
            jobId: request.jobId,
            missionId: request.missionId,
            actorId: request.actorId,
            traceId: request.traceId,
            detail: `replayed idempotency key ${key}`,
          });
        }
        return handle;
      }
    }

    const { payload, correlation } = mapJobToHermesPayload(request);
    const startedAt = Date.now();

    // The transport can own a run lifecycle: start it, keep its id, and apply
    // the terminal result in the background.
    if (isHermesAsyncTransport(this.transport)) {
      const start = await this.transport.startRun({
        operation: "submit",
        profile: this.config.profile,
        payload,
        timeoutMs: this.config.timeoutMs,
        maxOutputBytes: this.config.maxOutputBytes,
        correlation,
      });

      if (start.state === "STARTED") {
        const provisional: HermesExecutionRecord = {
          executionId: start.executionId,
          status: "ACCEPTED",
          runtime: { id: this.identity.id, type: this.identity.type },
          truncated: false,
        };
        const handle = this.remember(request.jobId, provisional);
        this.contexts.set(handle.handleId, {
          actorId: request.actorId,
          capabilityId: request.capabilityId,
          ...(request.missionId ? { missionId: request.missionId } : {}),
          ...(request.jobId ? { jobId: request.jobId } : {}),
        });
        if (key) this.idempotency.set(key, handle.handleId);
        this.emit({
          type: "runtime.submit",
          status: handle.status,
          profile: this.config.profile,
          executionId: start.executionId,
          jobId: request.jobId,
          missionId: request.missionId,
          actorId: request.actorId,
          traceId: request.traceId,
          durationMs: Date.now() - startedAt,
        });
        this.pushEvent(handle.handleId, "SUBMITTED", handle.status);

        const pending = start.completion
          .then((result) => {
            const record = normalizeHermesTransportResult({
              result,
              runtime: { id: this.identity.id, type: this.identity.type },
              now: this.now(),
              textOnly: this.transport.kind === "CLI_ONESHOT",
            });
            this.applyCompletion(handle.handleId, record, {
              jobId: request.jobId,
              missionId: request.missionId,
              actorId: request.actorId,
              traceId: request.traceId,
            });
          })
          .catch((error: unknown) => {
            // The background chain must never reject: a lost frame is a FAILED
            // record, not an unhandled rejection.
            this.applyCompletion(
              handle.handleId,
              {
                executionId: start.executionId,
                status: "FAILED",
                runtime: { id: this.identity.id, type: this.identity.type },
                truncated: false,
                error: {
                  category: "TRANSPORT",
                  message: error instanceof Error ? error.message : "background completion failed",
                  retryable: true,
                },
              },
              { jobId: request.jobId, missionId: request.missionId, actorId: request.actorId, traceId: request.traceId },
            );
          });
        this.pending.set(handle.handleId, pending);
        return handle;
      }

      // It never started. Record the honest failure and return it, exactly as
      // the blocking path would.
      const record = normalizeHermesTransportResult({
        result: start.result,
        runtime: { id: this.identity.id, type: this.identity.type },
        now: this.now(),
        textOnly: this.transport.kind === "CLI_ONESHOT",
      });
      return this.finish(request, record, startedAt);
    }

    // A transport with no run lifecycle: the only honest thing to do is the
    // blocking call, and then the handle is already terminal.
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
    return this.finish(request, record, startedAt);
  }

  /* ═══════════════════════════════════════════════════
     Status / record / events
     ═══════════════════════════════════════════════════ */

  async getExecutionStatus(handleId: string): Promise<AgentJobHandle> {
    const existing = this.records.get(handleId) ?? null;
    const executionId = existing?.executionId ?? handleId;

    // While WE are draining a run's stream, this runtime owns its state: the
    // handle came from the provider's own start and the terminal frame has not
    // arrived yet, so asking the provider again would only add latency and a
    // second race. A record learned from a status read has no background
    // completion and keeps polling the provider, exactly as before.
    if (existing && !isTerminalExecutionStatus(existing.status) && this.pending.has(handleId)) {
      return this.toHandle(handleId, existing);
    }

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
    this.pushEvent(handleId, "STATUS", record.status);
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

  async getExecution(handleId: string): Promise<AgentExecutionRecord | null> {
    const record = this.records.get(handleId);
    if (!record) return null;
    return this.toExecutionRecord(handleId, record);
  }

  async executionEvents(handleId: string): Promise<AgentExecutionEvent[]> {
    return (this.events.get(handleId) ?? []).map((event) => ({ ...event }));
  }

  async waitForExecution(handleId: string, options: AgentExecutionWaitOptions = {}): Promise<AgentExecutionRecord> {
    const record = this.records.get(handleId);
    if (!record) {
      throw new AiWorkforceError("RUNTIME_NOT_FOUND", `This runtime has no execution "${handleId}"`, { handleId });
    }
    // Wait for the run's OWN background work whenever there is any, even if the
    // handle already looks terminal: a cancel can make the status terminal
    // before the terminal frame arrives, and that frame is what carries the
    // provider's own execution reference. The wait is bounded by the transport
    // timeout (and by the caller's, when given).
    const pending = this.pending.get(handleId);
    if (!pending) {
      // No background lifecycle (a non-startable transport, or a record we only
      // know from a status read). Report what we have rather than inventing an
      // end state.
      return this.toExecutionRecord(handleId, record);
    }

    await this.awaitPending(handleId, pending, options.timeoutMs);
    const settled = this.records.get(handleId) ?? record;
    return this.toExecutionRecord(handleId, settled);
  }

  /* ═══════════════════════════════════════════════════
     Re-adoption — an execution this process did not start
     ═══════════════════════════════════════════════════ */

  /**
   * Takes responsibility for a run a PREVIOUS process submitted.
   *
   * It never resubmits and never starts a second run: the only outbound call is
   * a status READ against the run id the durable record already carried. That is
   * the whole point — the provider kept working while we were gone, and this is
   * how we look at it again.
   *
   * Three honest answers, and the reason each one matters:
   *
   *   ADOPTED     the provider answered with a state, and this adapter now holds
   *               the handle again, so the ordinary status/wait/cancel paths
   *               work exactly as they do for a run we started ourselves;
   *   UNKNOWN     the provider answered 404: it does not know this execution any
   *               more (the bridge restarted, the run was reaped). This is
   *               KNOWLEDGE, and it is reported as such — never as FAILED, since
   *               the run may have finished successfully before the record went
   *               away, and a retry would then duplicate real work;
   *   UNAVAILABLE the provider could not be asked at all (timeout, 5xx, no
   *               status surface). This is the ABSENCE of knowledge: nothing is
   *               changed and the caller is told it may retry the reconciliation.
   */
  async adoptExecution(reference: AgentExecutionReference): Promise<AgentExecutionAdoption> {
    const known = this.records.get(reference.handleId);
    if (known) {
      // Adopting something we already hold is a no-op, and must not become a
      // second read: a retried reconciliation has to be idempotent.
      return { kind: "ADOPTED", record: this.toExecutionRecord(reference.handleId, known) };
    }

    if (!this.capabilities.status) {
      return {
        kind: "UNAVAILABLE",
        retryable: false,
        detail: "this runtime exposes no status surface, so an execution started by another process cannot be observed",
      };
    }

    let result: HermesTransportResult;
    try {
      result = await this.transport.invoke({
        operation: "status",
        profile: this.config.profile,
        payload: { instruction: "", contextJson: "{}", executionId: reference.handleId },
        timeoutMs: this.config.timeoutMs,
        maxOutputBytes: this.config.maxOutputBytes,
        correlation: { actorId: "system", traceId: reference.handleId },
      });
    } catch (error) {
      return {
        kind: "UNAVAILABLE",
        retryable: true,
        detail: `the runtime could not be reached: ${error instanceof Error ? error.message : "unknown transport error"}`,
      };
    }

    // A 404 on a status read is the provider telling us the execution does not
    // exist any more — "not found" is knowledge about the REMOTE, not a failed
    // run, so it must never be normalized into FAILED.
    if (result.transportError === "HTTP_ERROR" && result.httpStatus === 404) {
      return {
        kind: "UNKNOWN",
        detail: `the runtime answered 404 for run "${reference.handleId}": it does not know this execution`,
      };
    }

    if (!result.ok) {
      const retryable =
        result.transportError === "TIMEOUT" ||
        result.transportError === "UNAVAILABLE" ||
        result.transportError === undefined ||
        (result.httpStatus ?? 0) >= 500;
      return {
        kind: "UNAVAILABLE",
        retryable,
        detail: `the runtime did not answer for run "${reference.handleId}" (${result.transportError ?? "no result"}${result.httpStatus ? ` ${result.httpStatus}` : ""})`,
      };
    }

    const record = normalizeHermesTransportResult({
      result,
      runtime: { id: this.identity.id, type: this.identity.type },
      now: this.now(),
      textOnly: this.transport.kind === "CLI_ONESHOT",
    });
    // The provider's own reference may only be in the DURABLE record we are
    // re-adopting; keep it, so audit does not lose the link across a restart.
    if (!record.providerExecutionId && reference.providerExecutionId) {
      record.providerExecutionId = reference.providerExecutionId;
    }

    const handle = this.remember(undefined, record, reference.handleId);
    const context: { actorId?: string; missionId?: string; capabilityId?: string; jobId?: string } = {};
    if (reference.actorId) context.actorId = reference.actorId;
    if (reference.capabilityId) context.capabilityId = reference.capabilityId;
    if (reference.missionId) context.missionId = reference.missionId;
    if (reference.taskId) context.jobId = reference.taskId;
    if (Object.keys(context).length > 0) this.contexts.set(reference.handleId, context);
    this.pushEvent(reference.handleId, "STATUS", record.status, "re-adopted after a restart");
    this.emit({
      type: "runtime.started",
      status: handle.status,
      profile: this.config.profile,
      executionId: record.executionId ?? reference.handleId,
      missionId: reference.missionId,
      actorId: "system",
      traceId: reference.handleId,
      detail: "re-adopted a run started by a previous process",
    });
    return { kind: "ADOPTED", record: this.toExecutionRecord(reference.handleId, record) };
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
    if (!this.handles.has(handleId) && !this.records.has(handleId)) {
      throw new AiWorkforceError("RUNTIME_NOT_FOUND", `This runtime has no execution "${handleId}"`, { handleId });
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
    // The cancel ack may not repeat the provider's own session reference; the
    // execution we already knew keeps it, so audit does not lose the link.
    const previous = this.records.get(handleId);
    const merged: HermesExecutionRecord = {
      ...record,
      executionId: record.executionId ?? previous?.executionId ?? handleId,
    };
    if (!merged.providerExecutionId && previous?.providerExecutionId) {
      merged.providerExecutionId = previous.providerExecutionId;
    }
    const handle = this.remember(undefined, { ...merged, status: "CANCELLED" }, handleId);
    this.pushEvent(handleId, "CANCELLED", "CANCELLED", reason);
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

  /**
   * Records a terminal result delivered by the FUSED path (`submitJob` without a
   * startable transport, or a start that failed). One emit, one remember.
   */
  private finish(
    request: HermesJobRequest,
    record: HermesExecutionRecord,
    startedAt: number,
  ): AgentJobHandle {
    const handle = this.remember(request.jobId, record);
    this.contexts.set(handle.handleId, {
      actorId: request.actorId,
      capabilityId: request.capabilityId,
      ...(request.missionId ? { missionId: request.missionId } : {}),
      ...(request.jobId ? { jobId: request.jobId } : {}),
    });
    const key = executionIdempotencyKeyFor(request);
    if (key) this.idempotency.set(key, handle.handleId);
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
    this.emitLifecycle(record, {
      jobId: request.jobId,
      missionId: request.missionId,
      actorId: request.actorId,
      traceId: request.traceId,
    });
    this.pushEvent(handle.handleId, "SUBMITTED", handle.status);
    this.pushEvent(
      handle.handleId,
      record.status === "SUCCEEDED" ? "COMPLETED" : record.status === "FAILED" ? "FAILED" : "CANCELLED",
      record.status,
    );
    return handle;
  }

  /**
   * Applies the terminal frame of a background run. The FIRST terminal state
   * wins: a run that was cancelled must not be reported SUCCEEDED because the
   * provider's stream finished at the same moment.
   */
  private applyCompletion(
    handleId: string,
    record: HermesExecutionRecord,
    correlation: { jobId?: string; missionId?: string; actorId?: string; traceId?: string },
  ): void {
    this.pending.delete(handleId);

    const current = this.handles.get(handleId);
    if (current && isTerminalExecutionStatus(current.status)) {
      // The execution already ended through another path (cancel). The STATUS
      // stands, but the provider metadata the terminal frame carries is still
      // merged in — audit must not lose which provider execution the run was.
      const existing = this.records.get(handleId);
      if (existing) {
        const enriched: HermesExecutionRecord = { ...existing };
        if (!enriched.providerExecutionId && record.providerExecutionId) {
          enriched.providerExecutionId = record.providerExecutionId;
        }
        if (!enriched.completedAt && record.completedAt) enriched.completedAt = record.completedAt;
        if (enriched.durationMs === undefined && record.durationMs !== undefined) enriched.durationMs = record.durationMs;
        this.records.set(handleId, enriched);
      }
      return;
    }

    const merged: HermesExecutionRecord = {
      ...record,
      executionId: record.executionId ?? this.records.get(handleId)?.executionId ?? handleId,
    };
    this.records.set(handleId, merged);
    this.remember(undefined, merged, handleId);
    this.pushEvent(
      handleId,
      merged.status === "SUCCEEDED" ? "COMPLETED" : merged.status === "FAILED" ? "FAILED" : "CANCELLED",
      merged.status,
    );
    this.emitLifecycle(merged, correlation);
  }

  private awaitPending(handleId: string, pending: Promise<void>, timeoutMs?: number): Promise<void> {
    if (!timeoutMs || timeoutMs <= 0) return pending;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const expiry = new Promise<never>((_, reject) => {
      timer = setTimeout(
        () =>
          reject(
            new AiWorkforceError(
              "RUNTIME_TIMEOUT",
              `Caller waited ${timeoutMs}ms for execution "${handleId}"; the execution was NOT cancelled and can still be observed or cancelled`,
              { handleId, timeoutMs },
            ),
          ),
        timeoutMs,
      );
    });
    return Promise.race([pending, expiry]).finally(() => {
      if (timer) clearTimeout(timer);
    }) as Promise<void>;
  }

  private toExecutionRecord(handleId: string, record: HermesExecutionRecord): AgentExecutionRecord {
    const handle = this.handles.get(handleId);
    const context = this.contexts.get(handleId);
    const at = this.now().toISOString();
    const execution: AgentExecutionRecord = {
      handleId,
      runtimeId: this.identity.id,
      status: record.status,
      submittedAt: handle?.submittedAt ?? at,
      updatedAt: at,
    };
    if (handle?.jobId) execution.jobId = handle.jobId;
    if (context?.actorId) execution.actorId = context.actorId;
    if (context?.missionId) execution.missionId = context.missionId;
    if (context?.capabilityId) execution.capabilityId = context.capabilityId;
    if (record.providerExecutionId) execution.providerExecutionId = record.providerExecutionId;
    if (record.completedAt) execution.completedAt = record.completedAt;
    if (record.durationMs !== undefined) execution.durationMs = record.durationMs;
    if (record.output !== undefined) execution.output = record.output;
    if (record.outputText !== undefined) execution.outputText = record.outputText;
    if (record.truncated !== undefined) execution.truncated = record.truncated;
    if (record.error) {
      execution.error = {
        category: toGenericErrorCategory(record.error.category),
        message: record.error.message,
        retryable: record.error.retryable,
      };
    }
    if (record.replayed) execution.replayed = true;
    const key = handle ? this.keyForHandle(handleId) : undefined;
    if (key) execution.idempotencyKey = key;
    return execution;
  }

  private keyForHandle(handleId: string): string | undefined {
    for (const [key, value] of this.idempotency) {
      if (value === handleId) return key;
    }
    return undefined;
  }

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

  private requireHandleCopy(handleId: string): AgentJobHandle {
    const handle = this.handles.get(handleId);
    if (!handle) {
      throw new AiWorkforceError("RUNTIME_NOT_FOUND", `This runtime has no execution "${handleId}"`, { handleId });
    }
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
      at: this.now().toISOString(),
      type,
      status,
    };
    if (detail) event.detail = detail;
    list.push(event);
    this.events.set(handleId, list);
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
