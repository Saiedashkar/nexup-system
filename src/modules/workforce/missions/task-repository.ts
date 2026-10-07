import { AiWorkforceError } from "@/modules/ai-workforce/core/errors";
import type { MissionId, TaskId } from "../core/refs";
import type { MissionTask, TaskState } from "./task-contracts";

/**
 * Task repository port.
 *
 * Mirrors the mission/job repositories, including the compare-and-set `update`
 * on the TASK STATE. That CAS is what stops two concurrent advances (a retry
 * racing a human decision, two orchestrator ticks) from both moving one task.
 *
 * Phase 2A/Step 5 ships the in-memory implementation; a persisted one would
 * implement this same interface.
 */

export interface TaskRepository {
  insert(task: MissionTask): Promise<MissionTask>;
  get(id: TaskId): Promise<MissionTask | null>;
  listForMission(missionId: MissionId): Promise<MissionTask[]>;
  /** @returns the stored task on success, or null when the CAS lost. */
  update(task: MissionTask, expected: TaskState[]): Promise<MissionTask | null>;
}

function clone(task: MissionTask): MissionTask {
  return JSON.parse(JSON.stringify(task)) as MissionTask;
}

export class InMemoryTaskRepository implements TaskRepository {
  private readonly rows = new Map<TaskId, MissionTask>();

  async insert(task: MissionTask): Promise<MissionTask> {
    this.rows.set(task.id, clone(task));
    return clone(task);
  }

  async get(id: TaskId): Promise<MissionTask | null> {
    const row = this.rows.get(id);
    return row ? clone(row) : null;
  }

  /** @throws MISSION_NOT_FOUND when the mission has no tasks at all. */
  async listForMission(missionId: MissionId): Promise<MissionTask[]> {
    return [...this.rows.values()]
      .filter((task) => task.missionId === missionId)
      .map(clone)
      .sort((a, b) => a.sequence - b.sequence || a.id.localeCompare(b.id));
  }

  async update(task: MissionTask, expected: TaskState[]): Promise<MissionTask | null> {
    const current = this.rows.get(task.id);
    if (!current) return null;
    if (!expected.includes(current.state)) return null;
    const next = clone(task);
    this.rows.set(next.id, next);
    return clone(next);
  }

  count(): number {
    return this.rows.size;
  }
}

/** Reads a task or fails with the domain's own error code. */
export async function requireTask(repository: TaskRepository, id: TaskId): Promise<MissionTask> {
  const task = await repository.get(id);
  if (!task) {
    throw new AiWorkforceError("MISSION_NOT_FOUND", `Task "${id}" does not exist`, { taskId: id });
  }
  return task;
}
