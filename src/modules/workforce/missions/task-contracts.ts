import { AiWorkforceError } from "@/modules/ai-workforce/core/errors";
import type { JsonObject } from "@/modules/ai-workforce/core/types";
import type { ActorId, CapabilityId, ExecutionRecordId, MissionId, ReviewId, TaskId } from "../core/refs";

/**
 * Mission TASK contracts.
 *
 * A Mission is a BUSINESS GOAL. A Task is ONE unit of work inside it, and it is
 * deliberately NOT a Job:
 *
 *   Mission (goal) ──1:N── Task (assigned unit of work) ──1:N── Execution (attempt)
 *                                                          └── Review (human authority)
 *
 * Why a Task exists at all, when Phase 1 already has a Job: a Job is a
 * capability invocation with a Phase-1 state machine tuned around tool runs
 * (READY / RUNNING / WAITING_APPROVAL ...). A mission needs something ABOVE
 * that: which actor is accountable, which capability it needs, what it depends
 * on, how many times it has been tried, and whether a human has signed off on
 * the result. Modelling that as a Job field would change the meaning of every
 * existing job row. So a Task REFERENCES an execution; it does not re-encode
 * one.
 *
 * Nothing here executes anything. The orchestrator does that.
 */

export const TASK_STATES = [
  /** Created, not yet dispatchable (dependencies unmet or nothing assigned). */
  "PENDING",
  /** Dependencies met, actor + capability assigned: dispatchable now. */
  "READY",
  /** An execution is in flight. */
  "RUNNING",
  /** The execution finished OK and a HUMAN must accept the result. */
  "REVIEW",
  /** Finished and accepted. */
  "COMPLETED",
  /** Finished unsuccessfully and out of attempts, or refused by a human. */
  "FAILED",
  /** A human asked for another attempt. */
  "REVISION",
  "CANCELLED",
] as const;
export type TaskState = (typeof TASK_STATES)[number];

export function isTaskState(value: string): value is TaskState {
  return (TASK_STATES as readonly string[]).includes(value);
}

/**
 * The task state machine.
 *
 * The two interesting edges:
 *   - FAILED → READY is the RETRY edge (the attempt counter increments);
 *   - REVIEW is only left by a human decision (approve → COMPLETED, reject →
 *     FAILED, needs-revision → REVISION → READY).
 */
export const TASK_TRANSITIONS: Record<TaskState, readonly TaskState[]> = {
  PENDING: ["READY", "CANCELLED"],
  READY: ["PENDING", "RUNNING", "CANCELLED"],
  RUNNING: ["REVIEW", "COMPLETED", "FAILED", "CANCELLED"],
  REVIEW: ["COMPLETED", "FAILED", "REVISION", "CANCELLED"],
  REVISION: ["READY", "CANCELLED"],
  COMPLETED: [],
  FAILED: ["READY", "CANCELLED"],
  CANCELLED: [],
};

export const TERMINAL_TASK_STATES: readonly TaskState[] = ["COMPLETED", "FAILED", "CANCELLED"];

export function isTerminalTask(state: TaskState): boolean {
  return TERMINAL_TASK_STATES.includes(state);
}

export function nextTaskStates(from: TaskState): readonly TaskState[] {
  return TASK_TRANSITIONS[from] ?? [];
}

export function canTransitionTask(from: TaskState, to: TaskState): boolean {
  if (from === to) return false;
  return nextTaskStates(from).includes(to);
}

/** @throws INVALID_MISSION_TRANSITION when the task edge does not exist */
export function assertTaskTransition(from: TaskState, to: TaskState): void {
  if (!canTransitionTask(from, to)) {
    throw new AiWorkforceError("INVALID_MISSION_TRANSITION", `Task cannot move from ${from} to ${to}`, {
      from,
      to,
      allowed: [...nextTaskStates(from)],
    });
  }
}

export type TaskTransition = {
  from: TaskState | null;
  to: TaskState;
  at: string;
  reason: string;
};

export const DEFAULT_MAX_TASK_ATTEMPTS = 2;

export type TaskError = {
  code: string;
  message: string;
  /** Whether another attempt could plausibly succeed. */
  retryable: boolean;
};

export type MissionTask = {
  id: TaskId;
  missionId: MissionId;
  /** Order inside the mission (1-based). Dependencies win over order. */
  sequence: number;
  title: string;
  /** What the task must achieve — the human-readable objective. */
  objective: string;
  /** Bounded, structured input handed to the capability (e.g. an instruction). */
  input: JsonObject;
  /** The actor accountable for this task. Null until assigned. */
  assignedActorId: ActorId | null;
  /** The capability the actor must be ASSIGNED to run. */
  requiredCapabilityId: CapabilityId | null;
  requiredCapabilityVersion?: string;
  /** Tasks that must be COMPLETED before this one may run. */
  dependsOn: TaskId[];
  state: TaskState;
  /** How many execution attempts have been made (0 before the first). */
  attempt: number;
  maxAttempts: number;
  /** The execution record of the CURRENT (or last) attempt. */
  executionRecordId?: ExecutionRecordId;
  /** The runtime handle of the current attempt, for status/cancel. */
  executionHandleId?: string;
  /** The review awaiting a human decision, when the task is in REVIEW. */
  reviewId?: ReviewId;
  result?: JsonObject;
  error?: TaskError;
  history: TaskTransition[];
  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  finishedAt?: string;
};

export type MissionTaskCreateInput = {
  /** Filled from the plan's mission when the task is registered through it. */
  missionId?: MissionId;
  title: string;
  objective: string;
  sequence?: number;
  input?: JsonObject;
  assignedActorId?: ActorId | null;
  requiredCapabilityId?: CapabilityId | null;
  requiredCapabilityVersion?: string;
  dependsOn?: TaskId[];
  maxAttempts?: number;
  /** Start directly in READY (when it is already dispatchable). */
  ready?: boolean;
};

/** @throws INVALID_MISSION when the task is not describable. */
export function assertTaskRegistration(input: MissionTaskCreateInput): void {
  const fail = (message: string, details?: JsonObject): never => {
    throw new AiWorkforceError("INVALID_MISSION", message, details);
  };
  if (!input.title?.trim()) fail("A task requires a title", { missionId: input.missionId ?? null });
  if (!input.objective?.trim()) fail("A task requires an objective", { title: input.title });
  if (input.sequence !== undefined && (!Number.isInteger(input.sequence) || input.sequence < 1)) {
    fail("A task sequence must be a positive integer", { sequence: input.sequence });
  }
  if (input.maxAttempts !== undefined && (!Number.isInteger(input.maxAttempts) || input.maxAttempts < 1)) {
    fail("maxAttempts must be a positive integer", { maxAttempts: input.maxAttempts });
  }
}

/** Pure transition — returns a new task with the transition appended. */
export function applyTaskTransition(
  task: MissionTask,
  to: TaskState,
  reason: string,
  at: string,
): MissionTask {
  assertTaskTransition(task.state, to);
  const next: MissionTask = {
    ...task,
    state: to,
    updatedAt: at,
    history: [...task.history, { from: task.state, to, at, reason }],
  };
  if (to === "RUNNING" && !next.startedAt) next.startedAt = at;
  if (isTerminalTask(to)) next.finishedAt = at;
  return next;
}

/** True when every dependency of the task has COMPLETED. */
export function dependenciesMet(task: MissionTask, all: readonly MissionTask[]): boolean {
  if (task.dependsOn.length === 0) return true;
  return task.dependsOn.every((id) => {
    const dependency = all.find((candidate) => candidate.id === id);
    return dependency?.state === "COMPLETED";
  });
}

/** Whether the task still has attempts left after the current one. */
export function canRetry(task: MissionTask): boolean {
  return task.attempt < task.maxAttempts;
}
