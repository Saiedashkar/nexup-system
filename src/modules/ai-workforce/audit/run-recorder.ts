import type { Clock, IdFactory, JsonObject, RunId } from "../core/types";
import type { AuditEventRepository } from "./audit-event-repository";
import { InMemoryAuditEventRepository } from "./audit-event-repository";
import type { RunRepository } from "./run-repository";
import { InMemoryRunRepository } from "./run-repository";

/**
 * Audit — runs + events.
 *
 * The legacy `ActivityLog` table records a narrow slice of user actions and is
 * NOT reused here: workforce executions need their own immutable trail
 * (who/what/why, policy decisions, approvals, tool invocations).
 *
 * Phase 1A kept everything in memory. Phase 1B keeps the SAME `RunRecorder`
 * contract but moves storage behind `RunRepository` + `AuditEventRepository`,
 * so the recorder itself is storage-agnostic.
 */

export const RUN_STATUSES = ["STARTED", "SUCCEEDED", "FAILED", "BLOCKED", "WAITING_APPROVAL"] as const;
export type RunStatus = (typeof RUN_STATUSES)[number];

export const AUDIT_EVENT_TYPES = [
  "job.created",
  "job.transitioned",
  "capability.resolved",
  "policy.checked",
  "approval.evaluated",
  "approval.requested",
  "approval.decided",
  "approval.denied",
  "input.rejected",
  "tool.invoked",
  "tool.succeeded",
  "tool.failed",
  "run.started",
  "run.finished",
] as const;
export type AuditEventType = (typeof AUDIT_EVENT_TYPES)[number];

export type RunRecord = {
  id: RunId;
  status: RunStatus;
  toolId?: string;
  jobId?: string;
  runtimeKind: string;
  actorUserId: string;
  serviceIdentityId: string;
  businessId?: string;
  correlationId: string;
  startedAt: string;
  finishedAt?: string;
  durationMs?: number;
  errorCode?: string;
  errorMessage?: string;
  /**
   * The exact call and its result, persisted with the run.
   *
   * Phase 1B review decision: a run IS the tool invocation here (the runtime
   * calls exactly one capability per run), so the separate
   * `AiToolInvocation` table proposed in Phase 1A would have duplicated these
   * rows 1:1 — it was removed instead of being carried "just in case".
   */
  input?: JsonObject;
  output?: unknown;
};

export type AuditEvent = {
  id: string;
  at: string;
  type: AuditEventType;
  runId?: string;
  jobId?: string;
  toolId?: string;
  actorUserId?: string;
  businessId?: string;
  correlationId?: string;
  payload: JsonObject;
};

export type StartRunInput = {
  toolId?: string;
  jobId?: string;
  runtimeKind: string;
  actorUserId: string;
  serviceIdentityId: string;
  businessId?: string;
  correlationId: string;
  input?: JsonObject;
};

export type FinishRunInput = {
  runId: RunId;
  status: Exclude<RunStatus, "STARTED">;
  errorCode?: string;
  errorMessage?: string;
  output?: unknown;
};

export interface RunRecorder {
  startRun(input: StartRunInput): Promise<RunRecord>;
  finishRun(input: FinishRunInput): Promise<RunRecord>;
  record(event: Omit<AuditEvent, "id" | "at"> & { at?: string }): Promise<AuditEvent>;
  getRun(id: RunId): Promise<RunRecord | null>;
  listRuns(limit?: number): Promise<RunRecord[]>;
  listEvents(limit?: number): Promise<AuditEvent[]>;
  /** Oldest first — the ordered audit trail of a single job. */
  listJobEvents(jobId: string, limit?: number): Promise<AuditEvent[]>;
}

/* ═══════════════════════════════════════════════════════
   Repository-backed recorder (the Phase 1B implementation)
   ═══════════════════════════════════════════════════════ */

export type RunRecorderDeps = {
  runs: RunRepository;
  events: AuditEventRepository;
  ids: IdFactory;
  now: Clock;
};

export class RepositoryRunRecorder implements RunRecorder {
  constructor(private readonly deps: RunRecorderDeps) {}

  async startRun(input: StartRunInput): Promise<RunRecord> {
    const run: RunRecord = {
      id: this.deps.ids.next("run"),
      status: "STARTED",
      toolId: input.toolId,
      jobId: input.jobId,
      runtimeKind: input.runtimeKind,
      actorUserId: input.actorUserId,
      serviceIdentityId: input.serviceIdentityId,
      businessId: input.businessId,
      correlationId: input.correlationId,
      startedAt: this.deps.now().toISOString(),
      input: input.input,
    };
    return this.deps.runs.insert(run);
  }

  async finishRun(input: FinishRunInput): Promise<RunRecord> {
    const existing = await this.deps.runs.get(input.runId);
    if (!existing) {
      throw new Error(`Run "${input.runId}" was never started`);
    }
    const finishedAt = this.deps.now().toISOString();
    const finished: RunRecord = {
      ...existing,
      status: input.status,
      finishedAt,
      durationMs: new Date(finishedAt).getTime() - new Date(existing.startedAt).getTime(),
      errorCode: input.errorCode,
      errorMessage: input.errorMessage,
      output: input.output,
    };
    const stored = await this.deps.runs.update(finished);
    if (!stored) {
      throw new Error(`Run "${input.runId}" disappeared before it could be finished`);
    }
    return stored;
  }

  async record(event: Omit<AuditEvent, "id" | "at"> & { at?: string }): Promise<AuditEvent> {
    const stored: AuditEvent = {
      ...event,
      id: this.deps.ids.next("event"),
      at: event.at ?? this.deps.now().toISOString(),
    };
    return this.deps.events.append(stored);
  }

  getRun(id: RunId): Promise<RunRecord | null> {
    return this.deps.runs.get(id);
  }

  listRuns(limit = 50): Promise<RunRecord[]> {
    return this.deps.runs.list(limit);
  }

  listEvents(limit = 100): Promise<AuditEvent[]> {
    return this.deps.events.list(limit);
  }

  listJobEvents(jobId: string, limit = 200): Promise<AuditEvent[]> {
    return this.deps.events.listForJob(jobId, limit);
  }
}

/**
 * In-memory recorder — Phase 1A surface kept intact.
 *
 * Accepts optional stores so several recorders (i.e. a "restarted" process)
 * can share one ledger when a test needs to observe persistence.
 */
export class InMemoryRunRecorder extends RepositoryRunRecorder {
  constructor(deps: {
    ids: IdFactory;
    now: Clock;
    runs?: RunRepository;
    events?: AuditEventRepository;
  }) {
    super({
      runs: deps.runs ?? new InMemoryRunRepository(),
      events: deps.events ?? new InMemoryAuditEventRepository(),
      ids: deps.ids,
      now: deps.now,
    });
  }
}
