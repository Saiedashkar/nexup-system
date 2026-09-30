import { AiWorkforceError } from "../core/errors";
import type { Job, JobStatus, JobTransition } from "./job-contracts";
import { JOB_STATUSES } from "./job-contracts";

/**
 * Job state machine.
 *
 *                ┌──────────────────────► CANCELLED
 *                │
 *   CREATED ─► PLANNED ─┬─► READY ─► RUNNING ─┬─► COMPLETED
 *                       │         ▲          ├─► FAILED
 *                       │         │          └─► WAITING_HUMAN ─┐
 *                       ├─► WAITING_APPROVAL ─► READY           │
 *                       │        │                               │
 *                       └─► BLOCKED ─► PLANNED ──────────────────┘
 *
 * Transitions are explicit data — never ad-hoc strings in the runner.
 */

export const JOB_TRANSITIONS: Record<JobStatus, readonly JobStatus[]> = {
  CREATED: ["PLANNED", "CANCELLED", "BLOCKED"],
  PLANNED: ["READY", "WAITING_APPROVAL", "WAITING_HUMAN", "CANCELLED", "BLOCKED"],
  WAITING_APPROVAL: ["READY", "CANCELLED", "FAILED", "BLOCKED"],
  READY: ["RUNNING", "CANCELLED", "BLOCKED"],
  RUNNING: ["COMPLETED", "FAILED", "WAITING_HUMAN", "CANCELLED"],
  WAITING_HUMAN: ["READY", "RUNNING", "CANCELLED", "FAILED"],
  BLOCKED: ["PLANNED", "CANCELLED"],
  COMPLETED: [],
  FAILED: [],
  CANCELLED: [],
};

/** Statuses a job can never leave. */
export const TERMINAL_JOB_STATUSES: readonly JobStatus[] = ["COMPLETED", "FAILED", "CANCELLED"];

export function isJobStatus(value: string): value is JobStatus {
  return (JOB_STATUSES as readonly string[]).includes(value);
}

export function isTerminal(status: JobStatus): boolean {
  return TERMINAL_JOB_STATUSES.includes(status);
}

export function nextStatuses(from: JobStatus): readonly JobStatus[] {
  return JOB_TRANSITIONS[from] ?? [];
}

export function canTransition(from: JobStatus, to: JobStatus): boolean {
  if (from === to) return false;
  return nextStatuses(from).includes(to);
}

/** @throws INVALID_JOB_TRANSITION */
export function assertTransition(from: JobStatus, to: JobStatus): void {
  if (!canTransition(from, to)) {
    throw new AiWorkforceError("INVALID_JOB_TRANSITION", `Cannot move a job from ${from} to ${to}`, {
      from,
      to,
      allowed: [...nextStatuses(from)],
    });
  }
}

/**
 * Pure transition application — returns a new job with the transition appended
 * to its history. Does not touch any store (the runner owns persistence).
 */
export function applyTransition(job: Job, to: JobStatus, reason: string, at: string): Job {
  assertTransition(job.status, to);

  const transition: JobTransition = { from: job.status, to, at, reason };
  const next: Job = {
    ...job,
    status: to,
    updatedAt: at,
    history: [...job.history, transition],
  };

  if (to === "RUNNING" && !next.startedAt) next.startedAt = at;
  if (isTerminal(to)) next.finishedAt = at;

  return next;
}

/** Initial status for a freshly created job. */
export function initialJobStatus(): JobStatus {
  return "CREATED";
}
