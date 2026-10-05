import { randomBytes } from "node:crypto";

import { DEFAULT_HERMES_RPC_PROTOCOL } from "@/modules/workforce/runtimes/hermes/hermes-protocol";
import type { HermesRpcEvent } from "@/modules/workforce/runtimes/hermes/hermes-rpc-transport";
import type {
  HermesTransport,
  HermesTransportRequest,
} from "@/modules/workforce/runtimes/hermes/hermes-transport";

import { BridgeError, mapTransportErrorKind, type BridgeErrorCode } from "../api/errors";
import type { AuditLog } from "../observability/audit";
import type { Logger } from "../observability/logger";
import type { Metrics } from "../observability/metrics";
import type { BridgeTransportFactory } from "./client";

/**
 * Run manager.
 *
 * Owns the lifecycle of a NEXUP run against Hermes: submit, stream, cancel. It
 * NEVER chooses a profile or a method — the profile is pinned by config and the
 * method sequence is the transport's (session.create → prompt.submit → terminal
 * event). It adds:
 *
 *   - bounded concurrency (excess is rejected, never queued without limit);
 *   - an event fan-out so SSE clients stream deltas;
 *   - a bounded replay buffer so a client that connects late is not starved;
 *   - cancellation via the verified `session.interrupt`.
 *
 * Completion is driven by the transport's terminal-event contract — never by
 * matching response text.
 */

export type RunStatus = "STARTING" | "RUNNING" | "COMPLETED" | "FAILED" | "CANCELLED";

export type RunEventName = "delta" | "complete" | "error";

export type RunEvent = { event: RunEventName; data: Record<string, unknown> };

export type RunCorrelation = {
  jobId?: string;
  missionId?: string;
  actorId: string;
  traceId: string;
};

export type RunSpec = {
  /** The authenticated bridge key id, carried for audit attribution. */
  keyId: string;
  instruction: string;
  contextJson?: string;
  correlation: RunCorrelation;
  timeoutMs?: number;
};

export type RunRecord = {
  runId: string;
  /** The authenticated key id that submitted this run. */
  keyId: string;
  status: RunStatus;
  executionId?: string;
  startedAt: string;
  endedAt?: string;
  bytesOut: number;
  cancelled: boolean;
  errorCode?: BridgeErrorCode;
  /** Bounded replay buffer of emitted events. */
  events: RunEvent[];
  /** Live SSE listeners. */
  listeners: Set<(event: RunEvent) => void>;
  /** Internal: the transport hosting this run. */
  transport?: HermesTransport;
};

export type RunManagerDeps = {
  profile: string;
  timeoutMs: number;
  maxOutputBytes: number;
  maxConcurrency: number;
  transportFactory: BridgeTransportFactory;
  logger: Logger;
  metrics: Metrics;
  audit?: AuditLog;
  now?: () => Date;
  /** Max events retained per run for replay. */
  maxBufferedEvents?: number;
  /** Max terminal runs retained for status lookups. */
  maxRetainedRuns?: number;
};

export type RunHealth = {
  status: "healthy" | "degraded" | "unavailable";
  detail: string;
  profile: string;
};

export function isTerminalRunStatus(status: RunStatus): boolean {
  return status === "COMPLETED" || status === "FAILED" || status === "CANCELLED";
}

function parseResult(raw: string): Record<string, unknown> {
  try {
    const value = JSON.parse(raw);
    return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

const PROTOCOL = DEFAULT_HERMES_RPC_PROTOCOL;

export class RunManager {
  private readonly runs = new Map<string, RunRecord>();
  private readonly deps: RunManagerDeps;
  private readonly now: () => Date;
  private readonly maxBufferedEvents: number;
  private readonly maxRetainedRuns: number;

  constructor(deps: RunManagerDeps) {
    this.deps = deps;
    this.now = deps.now ?? (() => new Date());
    this.maxBufferedEvents = deps.maxBufferedEvents ?? 2_000;
    this.maxRetainedRuns = deps.maxRetainedRuns ?? 500;
  }

  activeCount(): number {
    let active = 0;
    for (const run of this.runs.values()) if (!isTerminalRunStatus(run.status)) active += 1;
    return active;
  }

  get(runId: string): RunRecord | undefined {
    return this.runs.get(runId);
  }

  list(): RunRecord[] {
    return [...this.runs.values()];
  }

  /** Starts a run. Returns immediately; the run proceeds in the background. */
  submit(spec: RunSpec): RunRecord {
    if (this.activeCount() >= this.deps.maxConcurrency) {
      this.deps.metrics.inc("bridge_runs_rejected");
      throw new BridgeError("RATE_LIMITED", "Bridge is at maximum concurrent runs");
    }
    const record: RunRecord = {
      runId: this.mintRunId(),
      keyId: spec.keyId,
      status: "STARTING",
      startedAt: this.now().toISOString(),
      bytesOut: 0,
      cancelled: false,
      events: [],
      listeners: new Set(),
    };
    this.runs.set(record.runId, record);
    this.deps.metrics.inc("bridge_runs_submitted");
    this.deps.metrics.setGauge("bridge_runs_active", this.activeCount());
    this.deps.logger.info("run submitted", { runId: record.runId, traceId: spec.correlation.traceId });
    void this.execute(record, spec);
    return record;
  }

  /**
   * Replays buffered events to `listener`, then keeps it subscribed while the
   * run is live. Returns an unsubscribe function.
   */
  subscribe(runId: string, listener: (event: RunEvent) => void): () => void {
    const record = this.runs.get(runId);
    if (!record) throw new BridgeError("RUN_NOT_FOUND", `No run "${runId}"`);
    for (const event of record.events) listener(event);
    if (isTerminalRunStatus(record.status)) return () => {};
    record.listeners.add(listener);
    return () => {
      record.listeners.delete(listener);
    };
  }

  /** Requests cancellation; maps to the verified `session.interrupt`. */
  async abort(runId: string, reason = "cancelled by request"): Promise<RunRecord> {
    const record = this.runs.get(runId);
    if (!record) throw new BridgeError("RUN_NOT_FOUND", `No run "${runId}"`);
    if (isTerminalRunStatus(record.status)) return record;

    record.cancelled = true;
    record.status = "CANCELLED";
    this.emit(record, "complete", { status: "cancelled", executionId: record.executionId ?? null, reason });
    this.finalize(record, "cancelled");

    const executionId = record.executionId;
    const transport = record.transport;
    if (transport && executionId) {
      const request: HermesTransportRequest = {
        operation: "cancel",
        profile: this.deps.profile,
        payload: { instruction: "", contextJson: "{}", executionId },
        timeoutMs: Math.min(this.deps.timeoutMs, 10_000),
        maxOutputBytes: 4_096,
        correlation: { actorId: "system", traceId: runId },
      };
      try {
        await transport.invoke(request);
      } catch {
        /* best effort; the socket is closed below regardless */
      }
    }
    this.closeTransport(transport);
    return record;
  }

  /** Liveness probe: `gateway.ping` through a throwaway transport. */
  async health(): Promise<RunHealth> {
    const transport = this.deps.transportFactory({});
    try {
      const result = await transport.invoke({
        operation: "health",
        profile: this.deps.profile,
        timeoutMs: Math.min(this.deps.timeoutMs, 10_000),
        maxOutputBytes: 8_192,
        correlation: { actorId: "system", traceId: "health" },
      });
      if (!result.ok) {
        return { status: "unavailable", detail: result.transportError ?? "unknown", profile: this.deps.profile };
      }
      const parsed = parseResult(result.raw);
      const state = typeof parsed.status === "string" ? parsed.status.toLowerCase() : "degraded";
      return {
        status: state === "healthy" ? "healthy" : "degraded",
        detail: typeof parsed.detail === "string" ? parsed.detail : "gateway.ready",
        profile: this.deps.profile,
      };
    } finally {
      this.closeTransport(transport);
    }
  }

  /* ── internals ─────────────────────────────────────── */

  private async execute(record: RunRecord, spec: RunSpec): Promise<void> {
    const transport = this.deps.transportFactory({
      onEvent: (event) => this.onTransportEvent(record, event),
      // Learn the session id as soon as `session.create` returns, so a turn that
      // has not streamed anything yet can still be interrupted.
      onSession: (sessionId) => {
        if (!record.executionId) record.executionId = sessionId;
      },
    });
    record.transport = transport;
    record.status = "RUNNING";

    try {
      const result = await transport.invoke({
        operation: "submit",
        profile: this.deps.profile,
        payload: { instruction: spec.instruction, contextJson: spec.contextJson ?? "{}" },
        timeoutMs: spec.timeoutMs ?? this.deps.timeoutMs,
        maxOutputBytes: this.deps.maxOutputBytes,
        correlation: spec.correlation,
      });

      if (record.cancelled) return;

      if (!result.ok) {
        record.status = "FAILED";
        record.errorCode = mapTransportErrorKind(result.transportError);
        this.deps.metrics.inc("bridge_runs_failed");
        this.emit(record, "error", {
          code: record.errorCode,
          message: `Hermes transport error (${result.transportError ?? "UNKNOWN"})`,
        });
        return;
      }

      const parsed = parseResult(result.raw);
      const providerStatus = typeof parsed.status === "string" ? parsed.status.toLowerCase() : "";
      if (providerStatus === "failed") {
        record.status = "FAILED";
        record.errorCode = "HERMES_PROTOCOL_ERROR";
        this.deps.metrics.inc("bridge_runs_failed");
        this.emit(record, "error", {
          code: record.errorCode,
          message: typeof parsed.error === "string" ? parsed.error : "Hermes reported a failed turn",
        });
      } else {
        record.status = "COMPLETED";
        this.deps.metrics.inc("bridge_runs_completed");
        this.emit(record, "complete", {
          status: "succeeded",
          text: typeof parsed.text === "string" ? parsed.text : "",
          executionId: record.executionId ?? (typeof parsed.executionId === "string" ? parsed.executionId : null),
        });
      }
    } catch (error) {
      if (record.cancelled) return;
      record.status = "FAILED";
      // Preserve a bridge-owned code (e.g. METHOD_NOT_ALLOWED from the runtime
      // method guard) instead of flattening every failure to INTERNAL.
      record.errorCode = error instanceof BridgeError ? error.code : "INTERNAL";
      this.deps.metrics.inc("bridge_runs_failed");
      this.emit(record, "error", {
        code: record.errorCode,
        message: error instanceof Error ? error.message : "bridge run failed",
      });
    } finally {
      this.closeTransport(transport);
      this.finalize(record, record.status === "COMPLETED" ? "completed" : "failed");
    }
  }

  private onTransportEvent(record: RunRecord, event: HermesRpcEvent): void {
    if (event.sessionId) {
      if (!record.executionId) record.executionId = event.sessionId;
      else if (record.executionId !== event.sessionId) return; // another session's traffic
    }
    if (event.type === PROTOCOL.deltaEvent) {
      const text = typeof event.payload?.text === "string" ? event.payload.text : "";
      if (!text) return;
      record.bytesOut += Buffer.byteLength(text, "utf8");
      this.emit(record, "delta", { text });
    }
  }

  private emit(record: RunRecord, event: RunEventName, data: Record<string, unknown>): void {
    const entry: RunEvent = { event, data };
    record.events.push(entry);
    while (record.events.length > this.maxBufferedEvents) record.events.shift();
    this.deps.metrics.inc("bridge_run_events");
    for (const listener of [...record.listeners]) {
      try {
        listener(entry);
      } catch {
        /* a broken listener must not stop the run */
      }
    }
  }

  private finalize(record: RunRecord, outcome: "completed" | "failed" | "cancelled"): void {
    if (record.endedAt) return; // idempotent
    record.endedAt = this.now().toISOString();
    record.listeners.clear();
    this.deps.metrics.setGauge("bridge_runs_active", this.activeCount());
    this.deps.audit?.record({
      action: "run",
      keyId: record.keyId,
      profile: this.deps.profile,
      outcome,
      runId: record.runId,
      detail: record.errorCode,
    });
    this.evict();
  }

  private evict(): void {
    const terminal = [...this.runs.values()].filter((run) => isTerminalRunStatus(run.status));
    if (terminal.length <= this.maxRetainedRuns) return;
    terminal.sort((a, b) => a.startedAt.localeCompare(b.startedAt));
    const excess = terminal.length - this.maxRetainedRuns;
    for (let i = 0; i < excess; i += 1) {
      const victim = terminal[i];
      if (victim && victim.listeners.size === 0) this.runs.delete(victim.runId);
    }
  }

  private closeTransport(transport: HermesTransport | undefined): void {
    if (!transport) return;
    const closable = transport as { close?: () => void };
    try {
      closable.close?.();
    } catch {
      /* ignore */
    }
  }

  private mintRunId(): string {
    return `run_${Date.now().toString(36)}_${randomBytes(4).toString("hex")}`;
  }
}
