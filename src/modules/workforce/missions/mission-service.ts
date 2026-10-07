import { AiWorkforceError } from "@/modules/ai-workforce/core/errors";
import type { Clock, IdFactory, JobId, JsonObject } from "@/modules/ai-workforce/core/types";
import type { ActorId, TaskId } from "../core/refs";
import {
  applyMissionTransition,
  isTerminalMission,
  type Mission,
  type MissionCreateInput,
  type MissionState,
} from "./mission-contracts";
import type { MissionRepository } from "./mission-repository";

/**
 * Mission service.
 *
 * Owns mission lifecycle and the mission↔job edge. Every mutation that changes
 * state goes through the repository's compare-and-set; every mutation that only
 * adds a reference (a job, a participant, an output) still rewrites through the
 * CAS so a concurrent advance is never silently lost.
 *
 * It does not run anything. Attaching a job to a mission is a REFERENCE, not an
 * execution — the JobRunner stays the only thing that advances a job.
 */

export type MissionServiceDeps = {
  missions: MissionRepository;
  ids: IdFactory;
  now: Clock;
};

export class MissionService {
  constructor(private readonly deps: MissionServiceDeps) {}

  async create(input: MissionCreateInput): Promise<Mission> {
    if (!input.title?.trim() || !input.goal?.trim()) {
      throw new AiWorkforceError("INVALID_MISSION", "A mission requires a title and a goal", {
        title: input.title,
        goal: input.goal,
      });
    }
    if (!input.createdBy?.trim()) {
      throw new AiWorkforceError("INVALID_MISSION", "A mission requires a createdBy actor", {});
    }

    const at = this.deps.now().toISOString();
    const mission: Mission = {
      id: this.deps.ids.next("mission"),
      title: input.title,
      goal: input.goal,
      createdBy: input.createdBy,
      owner: input.owner ?? null,
      participants: input.participants ? [...input.participants] : [],
      state: "DRAFT",
      priority: input.priority ?? "NORMAL",
      contextRefs: input.contextRefs ? [...input.contextRefs] : [],
      jobRefs: [],
      taskRefs: [],
      approvals: [],
      outputs: [],
      history: [],
      createdAt: at,
      updatedAt: at,
    };
    if (input.businessId) mission.businessId = input.businessId;
    if (input.workspaceRef) mission.workspaceRef = input.workspaceRef;

    return this.deps.missions.insert(mission);
  }

  get(id: string): Promise<Mission | null> {
    return this.deps.missions.get(id);
  }

  /** @throws MISSION_NOT_FOUND */
  async require(id: string): Promise<Mission> {
    const mission = await this.deps.missions.get(id);
    if (!mission) {
      throw new AiWorkforceError("MISSION_NOT_FOUND", `Mission "${id}" does not exist`, { missionId: id });
    }
    return mission;
  }

  list(limit?: number): Promise<Mission[]> {
    return this.deps.missions.list(limit);
  }

  /** @throws INVALID_MISSION_TRANSITION | MISSION_CONFLICT | MISSION_NOT_FOUND */
  async transition(id: string, to: MissionState, reason = "transition"): Promise<Mission> {
    const mission = await this.require(id);
    const applied = applyMissionTransition(mission, to, reason, this.deps.now().toISOString());
    return this.save(applied, [mission.state]);
  }

  async cancel(id: string, reason = "cancelled by request"): Promise<Mission> {
    const mission = await this.require(id);
    if (isTerminalMission(mission.state)) return mission;
    return this.transition(id, "CANCELLED", reason);
  }

  /** Attaches an existing job to the mission (idempotent — no duplicate refs). */
  async attachJob(id: string, jobId: JobId): Promise<Mission> {
    const mission = await this.require(id);
    if (mission.jobRefs.includes(jobId)) return mission;
    return this.save({ ...mission, jobRefs: [...mission.jobRefs, jobId] }, [mission.state]);
  }

  async detachJob(id: string, jobId: JobId): Promise<Mission> {
    const mission = await this.require(id);
    if (!mission.jobRefs.includes(jobId)) return mission;
    return this.save({ ...mission, jobRefs: mission.jobRefs.filter((ref) => ref !== jobId) }, [mission.state]);
  }

  /** Attaches a task to the mission (idempotent — no duplicate refs). */
  async attachTask(id: string, taskId: TaskId): Promise<Mission> {
    const mission = await this.require(id);
    if (mission.taskRefs.includes(taskId)) return mission;
    return this.save({ ...mission, taskRefs: [...mission.taskRefs, taskId] }, [mission.state]);
  }

  async addParticipant(id: string, actorId: ActorId): Promise<Mission> {
    const mission = await this.require(id);
    if (mission.participants.includes(actorId)) return mission;
    return this.save({ ...mission, participants: [...mission.participants, actorId] }, [mission.state]);
  }

  async removeParticipant(id: string, actorId: ActorId): Promise<Mission> {
    const mission = await this.require(id);
    if (!mission.participants.includes(actorId)) return mission;
    return this.save({ ...mission, participants: mission.participants.filter((ref) => ref !== actorId) }, [mission.state]);
  }

  async setOwner(id: string, owner: string | null): Promise<Mission> {
    const mission = await this.require(id);
    return this.save({ ...mission, owner }, [mission.state]);
  }

  async addApprovalRef(id: string, approvalId: string): Promise<Mission> {
    const mission = await this.require(id);
    if (mission.approvals.includes(approvalId)) return mission;
    return this.save({ ...mission, approvals: [...mission.approvals, approvalId] }, [mission.state]);
  }

  async addOutput(id: string, output: JsonObject): Promise<Mission> {
    const mission = await this.require(id);
    return this.save({ ...mission, outputs: [...mission.outputs, output] }, [mission.state]);
  }

  private async save(mission: Mission, expected: MissionState[]): Promise<Mission> {
    const stored = await this.deps.missions.update(mission, expected);
    if (stored) return stored;

    const current = await this.deps.missions.get(mission.id);
    throw new AiWorkforceError(
      "MISSION_CONFLICT",
      `Mission "${mission.id}" was advanced by another caller (expected ${expected.join("|")}, found ${current?.state ?? "MISSING"})`,
      { missionId: mission.id, expected, currentState: current?.state ?? null },
    );
  }
}
