import type { Clock } from "@/modules/ai-workforce/core/types";

import type { MissionId, TaskId } from "../core/refs";
import type { ExecutionRecordRepository } from "../execution/execution-record";
import type { Mission, MissionState } from "../missions/mission-contracts";
import { isTerminalMission } from "../missions/mission-contracts";
import type { MissionRepository } from "../missions/mission-repository";
import type { MissionTask, TaskState } from "../missions/task-contracts";
import type { TaskRepository } from "../missions/task-repository";
import type { ReviewRepository } from "../review/task-review";

/**
 * Command Center QUERY surfaces — READ-ONLY.
 *
 * Step 6 will draw Active Missions, agent/execution status, Recent Activity and
 * the Decision Queue. None of that needs to exist yet, and none of it may be
 * invented in the UI: the four questions have to be answerable from the
 * REPOSITORIES, over the same ports the orchestrator writes through, so a screen
 * and a mission can never disagree about what happened.
 *
 * So this module is deliberately narrow:
 *
 *   - it takes the four repository PORTS, not a database, so it works over the
 *     in-memory composition in a unit test and over Prisma in the application;
 *   - it only ever READS (`get`, `list`, `listForMission`, `forTask`,
 *     `listPending`). It has no write path at all, which is what makes it safe
 *     to expose to a page or an API route;
 *   - it sorts explicitly instead of trusting a repository's ordering, because
 *     the in-memory and durable implementations are not required to agree on it;
 *   - it returns plain, presentation-free rows. No formatting, no labels, no
 *     counts a component would have to recompute.
 *
 * It is NOT a UI and it replaces no mock: the existing Command Center screens
 * keep reading their demo model until Step 6 wires them to this.
 */

export type CommandCenterDeps = {
  missions: MissionRepository;
  tasks: TaskRepository;
  executionRecords: ExecutionRecordRepository;
  reviews: ReviewRepository;
  now?: Clock;
};

/* ── Active Missions ─────────────────────────────────────────────────── */

export type MissionTaskCounts = Record<TaskState, number> & { total: number };

export type MissionProgress = {
  missionId: MissionId;
  title: string;
  state: MissionState;
  priority: Mission["priority"];
  owner: string | null;
  createdBy: string;
  businessId?: string;
  workspaceRef?: string;
  projectRef?: string;
  clientRef?: string;
  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  finishedAt?: string;
  tasks: MissionTaskCounts;
  /** Execution attempts recorded for this mission. */
  attempts: number;
  /** Pending human decisions blocking this mission. */
  decisionQueue: number;
  /** The most recent timestamp on the mission, its tasks or its executions. */
  lastActivityAt: string;
};

/* ── Execution / agent status ────────────────────────────────────────── */

export type ExecutionStatusRow = {
  executionRecordId: string;
  missionId?: MissionId;
  taskId?: TaskId;
  attempt: number;
  status: string;
  /** The runtime's own handle (the bridge run id on BRIDGE). */
  handleId: string;
  /** The provider's private reference (the Hermes session). Never a handle. */
  providerExecutionId?: string;
  runtimeId: string;
  actorId: string;
  capabilityId: string;
  capabilityVersion?: string;
  startedAt: string;
  updatedAt: string;
  completedAt?: string;
  durationMs?: number;
  terminal: boolean;
  cancelled?: { at: string; reason?: string };
};

/* ── Recent Activity ─────────────────────────────────────────────────── */

export type ActivityRow = {
  at: string;
  executionRecordId: string;
  missionId?: MissionId;
  taskId?: TaskId;
  runtimeId: string;
  actorId: string;
  capabilityId: string;
  status: string;
  attempt: number;
  /** The last audit event's type: what actually happened. */
  lastEvent: string;
  summary: string;
};

/* ── Decision Queue ──────────────────────────────────────────────────── */

export type DecisionRow = {
  reviewId: string;
  missionId: MissionId;
  missionTitle: string | null;
  taskId: TaskId;
  taskTitle: string | null;
  executionRecordId: string;
  requestedAt: string;
  requestedBy: string;
  reviewerActorId: string | null;
  summary: string;
};

export type CommandCenterSnapshot = {
  generatedAt: string;
  activeMissions: MissionProgress[];
  executionStatus: ExecutionStatusRow[];
  recentActivity: ActivityRow[];
  decisionQueue: DecisionRow[];
};

export type CommandCenterQueries = {
  activeMissions(limit?: number): Promise<MissionProgress[]>;
  executionStatus(input?: { missionId?: MissionId; taskId?: TaskId; limit?: number }): Promise<ExecutionStatusRow[]>;
  recentActivity(limit?: number): Promise<ActivityRow[]>;
  decisionQueue(limit?: number): Promise<DecisionRow[]>;
  /** All four, in one read, for a dashboard that must not tear. */
  snapshot(limit?: number): Promise<CommandCenterSnapshot>;
};

const TERMINAL_EXECUTION_STATUSES = new Set(["SUCCEEDED", "FAILED", "CANCELLED"]);

function counted(tasks: readonly MissionTask[]): MissionTaskCounts {
  const counts: MissionTaskCounts = {
    total: tasks.length,
    PENDING: 0,
    READY: 0,
    RUNNING: 0,
    REVIEW: 0,
    COMPLETED: 0,
    FAILED: 0,
    REVISION: 0,
    CANCELLED: 0,
  };
  for (const task of tasks) counts[task.state] += 1;
  return counts;
}

function newest(...values: Array<string | undefined>): string {
  return values.filter((value): value is string => Boolean(value)).sort().at(-1) ?? new Date(0).toISOString();
}

export function createCommandCenterQueries(deps: CommandCenterDeps): CommandCenterQueries {
  const now = deps.now ?? (() => new Date());

  async function progressFor(mission: Mission): Promise<MissionProgress> {
    const tasks = await deps.tasks.listForMission(mission.id);
    const executions = await deps.executionRecords.listForMission(mission.id);
    const pending = [] as string[];
    for (const task of tasks) {
      for (const review of await deps.reviews.forTask(task.id)) {
        if (review.state === "PENDING") pending.push(review.id);
      }
    }

    const row: MissionProgress = {
      missionId: mission.id,
      title: mission.title,
      state: mission.state,
      priority: mission.priority,
      owner: mission.owner,
      createdBy: mission.createdBy,
      createdAt: mission.createdAt,
      updatedAt: mission.updatedAt,
      tasks: counted(tasks),
      attempts: executions.length,
      decisionQueue: pending.length,
      lastActivityAt: newest(
        mission.updatedAt,
        ...tasks.map((task) => task.updatedAt),
        ...executions.map((execution) => execution.updatedAt),
      ),
    };
    if (mission.businessId) row.businessId = mission.businessId;
    if (mission.workspaceRef) row.workspaceRef = mission.workspaceRef;
    if (mission.projectRef) row.projectRef = mission.projectRef;
    if (mission.clientRef) row.clientRef = mission.clientRef;
    if (mission.startedAt) row.startedAt = mission.startedAt;
    if (mission.finishedAt) row.finishedAt = mission.finishedAt;
    return row;
  }

  function statusRow(execution: Awaited<ReturnType<ExecutionRecordRepository["get"]>> & object): ExecutionStatusRow {
    const row: ExecutionStatusRow = {
      executionRecordId: execution.id,
      attempt: execution.attempt,
      status: execution.status,
      handleId: execution.handleId,
      runtimeId: execution.runtimeId,
      actorId: execution.actorId,
      capabilityId: execution.capabilityId,
      startedAt: execution.startedAt,
      updatedAt: execution.updatedAt,
      terminal: TERMINAL_EXECUTION_STATUSES.has(execution.status),
    };
    if (execution.missionId) row.missionId = execution.missionId;
    if (execution.taskId) row.taskId = execution.taskId;
    if (execution.providerExecutionId) row.providerExecutionId = execution.providerExecutionId;
    if (execution.capabilityVersion) row.capabilityVersion = execution.capabilityVersion;
    if (execution.completedAt) row.completedAt = execution.completedAt;
    if (execution.durationMs !== undefined) row.durationMs = execution.durationMs;
    if (execution.cancelled) row.cancelled = execution.cancelled;
    return row;
  }

  return {
    /** Every mission that has NOT reached a terminal state, most recently touched first. */
    async activeMissions(limit = 50) {
      const missions = await deps.missions.list(limit * 4);
      const active = missions.filter((mission) => !isTerminalMission(mission.state));
      const rows = await Promise.all(active.map(progressFor));
      return rows.sort((a, b) => b.lastActivityAt.localeCompare(a.lastActivityAt)).slice(0, limit);
    },

    /** The latest attempt per task, newest first. */
    async executionStatus(input = {}) {
      const limit = input.limit ?? 50;
      const executions = input.taskId
        ? await deps.executionRecords.listForTask(input.taskId)
        : input.missionId
          ? await deps.executionRecords.listForMission(input.missionId)
          : await deps.executionRecords.list(limit * 2);

      const latest = new Map<string, (typeof executions)[number]>();
      for (const execution of executions) {
        const key = execution.taskId ?? execution.id;
        const current = latest.get(key);
        if (!current || execution.attempt > current.attempt) latest.set(key, execution);
      }
      return [...latest.values()]
        .map(statusRow)
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
        .slice(0, limit);
    },

    /** Execution attempts, most recently updated first — what a feed would show. */
    async recentActivity(limit = 50) {
      const executions = await deps.executionRecords.list(limit * 2);
      return executions
        .slice()
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
        .slice(0, limit)
        .map((execution) => {
          const last = execution.audit.at(-1);
          const row: ActivityRow = {
            at: execution.updatedAt,
            executionRecordId: execution.id,
            runtimeId: execution.runtimeId,
            actorId: execution.actorId,
            capabilityId: execution.capabilityId,
            status: execution.status,
            attempt: execution.attempt,
            lastEvent: last?.type ?? "REQUESTED",
            summary: `${execution.capabilityId} ${execution.status.toLowerCase()} on attempt ${execution.attempt}${
              execution.providerExecutionId ? ` (provider session ${execution.providerExecutionId})` : ""
            }`,
          };
          if (execution.missionId) row.missionId = execution.missionId;
          if (execution.taskId) row.taskId = execution.taskId;
          return row;
        });
    },

    /** The human's queue: every review still waiting for a decision. */
    async decisionQueue(limit = 50) {
      const pending = await deps.reviews.listPending();
      const rows = await Promise.all(
        pending.map(async (review) => {
          const mission = await deps.missions.get(review.missionId);
          const task = await deps.tasks.get(review.taskId);
          return {
            reviewId: review.id,
            missionId: review.missionId,
            missionTitle: mission?.title ?? null,
            taskId: review.taskId,
            taskTitle: task?.title ?? null,
            executionRecordId: review.executionRecordId,
            requestedAt: review.requestedAt,
            requestedBy: review.requestedBy,
            reviewerActorId: review.reviewerActorId,
            summary: review.summary,
          } satisfies DecisionRow;
        }),
      );
      return rows.sort((a, b) => a.requestedAt.localeCompare(b.requestedAt)).slice(0, limit);
    },

    async snapshot(limit = 50) {
      const [activeMissions, executionStatus, recentActivity, decisionQueue] = await Promise.all([
        this.activeMissions(limit),
        this.executionStatus({ limit }),
        this.recentActivity(limit),
        this.decisionQueue(limit),
      ]);
      return { generatedAt: now().toISOString(), activeMissions, executionStatus, recentActivity, decisionQueue };
    },
  };
}
