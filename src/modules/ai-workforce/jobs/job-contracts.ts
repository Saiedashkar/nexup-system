import type { AiWorkforceErrorCode } from "../core/errors";
import type { AutonomyLevel, Clock, IdFactory, JsonObject, TriggerType } from "../core/types";
// Phase 2A — leaf identifier aliases (no runtime dependency, no cycle).
import type { ActorId, CapabilityId, MissionId, RuntimeId } from "@/modules/workforce/core/refs";
import type { ExecutionContext } from "../core/execution-context";
import type { ExecutionContextSnapshot } from "../core/context-snapshot";
import type { RunRecord } from "../audit/run-recorder";

/**
 * Job contracts.
 *
 * Phase 1A only ever *creates* MANUAL jobs (and SYSTEM ones from the API), but
 * the whole trigger vocabulary is part of the contract, so the job engine does
 * not need redesigning when schedules, events and webhooks arrive.
 */

export const JOB_STATUSES = [
  "CREATED",
  "PLANNED",
  "WAITING_APPROVAL",
  "READY",
  "RUNNING",
  "WAITING_HUMAN",
  "COMPLETED",
  "FAILED",
  "CANCELLED",
  "BLOCKED",
] as const;

export type JobStatus = (typeof JOB_STATUSES)[number];

export type JobTransition = {
  from: JobStatus | null;
  to: JobStatus;
  at: string;
  reason: string;
};

export type Job = {
  id: string;
  status: JobStatus;
  trigger: TriggerType;
  autonomy: AutonomyLevel;
  /** Requested capability (tool id or shorthand). */
  capability: string;
  /** Resolved tool id once the capability was resolved. */
  resolvedToolId?: string;
  input: JsonObject;
  actorUserId: string;
  businessId?: string;
  correlationId: string;
  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  finishedAt?: string;
  runId?: string;
  approvalId?: string;
  approvalReason?: string;
  error?: { code: AiWorkforceErrorCode; message: string };
  /** Append-only transition history. */
  history: JobTransition[];
  /**
   * The execution context this job was created with, persisted so the job can
   * be resumed (after a restart, or by an approval) without a live session.
   * Permission tokens are never stored — they are re-derived on load.
   */
  contextSnapshot?: ExecutionContextSnapshot;

  /* ── Phase 2A ownership references (all optional, purely additive) ──
     A legacy Phase-1 job carries none of these and behaves exactly as before.
     When present they are REFERENCES (ids), never embedded definitions, and
     they never carry credentials. The runner's behaviour is unchanged by
     them — they record WHO/WHAT/FOR-WHAT owns the job, not how it runs. */
  actorId?: ActorId;
  runtimeId?: RuntimeId;
  capabilityId?: CapabilityId;
  missionId?: MissionId;
  /**
   * Phase 2B — the handle an agent runtime returned for this job (e.g. a
   * Hermes execution id). Present only when the job was dispatched to an
   * agent runtime; absent for local/tool jobs.
   */
  runtimeHandleId?: string;
};

export type JobRequest = {
  capability: string;
  input?: JsonObject;
  context: ExecutionContext;
  /** Phase 2A ownership references — optional, backward compatible. */
  actorId?: ActorId;
  runtimeId?: RuntimeId;
  capabilityId?: CapabilityId;
  missionId?: MissionId;
};

export type JobOutcome = {
  job: Job;
  run: RunRecord | null;
  status: JobStatus;
  output?: unknown;
  error?: { code: AiWorkforceErrorCode; message: string; details?: JsonObject };
};

export type JobRunnerDeps = {
  ids: IdFactory;
  now: Clock;
  /** Waits between retry attempts; injected so tests stay instant. */
  sleep?: (ms: number) => Promise<void>;
};

/** Default no-op-safe sleep. */
export function defaultSleep(ms: number): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, ms));
}
