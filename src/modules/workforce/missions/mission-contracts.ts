import { AiWorkforceError } from "@/modules/ai-workforce/core/errors";
import type { JobId, JsonObject } from "@/modules/ai-workforce/core/types";
import type { ActorId, MissionId, TaskId } from "../core/refs";

/**
 * Mission contracts.
 *
 * A Mission is a BUSINESS GOAL that may create MANY Jobs. It sits ABOVE the
 * Job and deliberately does not re-encode job semantics: where a Job has
 * capability-level states (READY / RUNNING / WAITING_APPROVAL / ...), a Mission
 * has goal-level states (PLANNING / RUNNING / WAITING / COMPLETED / ...).
 *
 *   Mission (goal) ──1:N── Job (capability run) ──1:1── Run (execution)
 *
 * Fields are references wherever possible (`jobRefs`, `contextRefs`,
 * `approvals`): a Mission points at Jobs, it does not embed them.
 */

export const MISSION_STATES = ["DRAFT", "PLANNING", "RUNNING", "WAITING", "COMPLETED", "FAILED", "CANCELLED"] as const;
export type MissionState = (typeof MISSION_STATES)[number];

export function isMissionState(value: string): value is MissionState {
  return (MISSION_STATES as readonly string[]).includes(value);
}

export const MISSION_PRIORITIES = ["LOW", "NORMAL", "HIGH", "CRITICAL"] as const;
export type MissionPriority = (typeof MISSION_PRIORITIES)[number];

export type MissionTransition = {
  from: MissionState | null;
  to: MissionState;
  at: string;
  reason: string;
};

export type Mission = {
  id: MissionId;
  title: string;
  goal: string;
  /** Business/workspace this mission belongs to (reference, not a scope object). */
  businessId?: string;
  workspaceRef?: string;
  /**
   * The project and client this mission serves, as opaque REFERENCES.
   *
   * The audit found the mission could name a business and a workspace but not
   * the project or client the work is actually for, which is exactly the link
   * the Command Center groups by. These stay references — never embedded scope
   * objects — so the core domain keeps no dependency on the project or client
   * modules.
   */
  projectRef?: string;
  clientRef?: string;
  /** Actor or user id that created the mission. */
  createdBy: string;
  /** Actor or user id accountable for the mission. */
  owner: string | null;
  participants: ActorId[];
  state: MissionState;
  priority: MissionPriority;
  contextRefs: string[];
  /** Phase-1 jobs attached to this mission (references, never embedded). */
  jobRefs: JobId[];
  /** Mission TASKS — the assigned units of work inside this goal. */
  taskRefs: TaskId[];
  /** Approval ids relevant to the mission (references, not policies). */
  approvals: string[];
  outputs: JsonObject[];
  history: MissionTransition[];
  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  finishedAt?: string;
};

export type MissionCreateInput = {
  title: string;
  goal: string;
  createdBy: string;
  owner?: string | null;
  businessId?: string;
  workspaceRef?: string;
  projectRef?: string;
  clientRef?: string;
  priority?: MissionPriority;
  participants?: ActorId[];
  contextRefs?: string[];
};

/* ═══════════════════════════════════════════════════════
   State machine
   ═══════════════════════════════════════════════════════

   DRAFT ─► PLANNING ─► RUNNING ⇄ WAITING ─► COMPLETED
      │        │          │         │
      └────────┴──────────┴─────────┴─► CANCELLED / FAILED
*/

export const MISSION_TRANSITIONS: Record<MissionState, readonly MissionState[]> = {
  DRAFT: ["PLANNING", "CANCELLED"],
  PLANNING: ["RUNNING", "WAITING", "FAILED", "CANCELLED"],
  RUNNING: ["WAITING", "COMPLETED", "FAILED", "CANCELLED"],
  WAITING: ["RUNNING", "COMPLETED", "FAILED", "CANCELLED"],
  COMPLETED: [],
  FAILED: [],
  CANCELLED: [],
};

export const TERMINAL_MISSION_STATES: readonly MissionState[] = ["COMPLETED", "FAILED", "CANCELLED"];

export function isTerminalMission(state: MissionState): boolean {
  return TERMINAL_MISSION_STATES.includes(state);
}

export function nextMissionStates(from: MissionState): readonly MissionState[] {
  return MISSION_TRANSITIONS[from] ?? [];
}

export function canTransitionMission(from: MissionState, to: MissionState): boolean {
  if (from === to) return false;
  return nextMissionStates(from).includes(to);
}

/** @throws INVALID_MISSION_TRANSITION */
export function assertMissionTransition(from: MissionState, to: MissionState): void {
  if (!canTransitionMission(from, to)) {
    throw new AiWorkforceError("INVALID_MISSION_TRANSITION", `Mission cannot move from ${from} to ${to}`, {
      from,
      to,
      allowed: [...nextMissionStates(from)],
    });
  }
}

/** Pure transition — returns a new mission with the transition appended. */
export function applyMissionTransition(mission: Mission, to: MissionState, reason: string, at: string): Mission {
  assertMissionTransition(mission.state, to);
  const next: Mission = {
    ...mission,
    state: to,
    updatedAt: at,
    history: [...mission.history, { from: mission.state, to, at, reason }],
  };
  if (to === "RUNNING" && !next.startedAt) next.startedAt = at;
  if (isTerminalMission(to)) next.finishedAt = at;
  return next;
}
