import { Prisma, type PrismaClient } from "@prisma/client";

import { AiWorkforceError } from "@/modules/ai-workforce/core/errors";
import type { AgentExecutionError, AgentExecutionStatus } from "../runtimes/agent-runtime";
import type {
  ExecutionAuditEvent,
  ExecutionRecord,
  ExecutionRecordRepository,
} from "../execution/execution-record";
import type { Mission, MissionState, MissionTransition } from "../missions/mission-contracts";
import type { MissionRepository } from "../missions/mission-repository";
import type { MissionTask, TaskError, TaskState, TaskTransition } from "../missions/task-contracts";
import type { TaskRepository } from "../missions/task-repository";
import type { ReviewRepository, ReviewState, TaskReview } from "../review/task-review";
import type { ExecutionRecordId, MissionId, ReviewId, TaskId } from "../core/refs";

/**
 * Durable repository adapters for the Step-5 lifecycle.
 *
 * These implement the EXISTING ports — `MissionRepository`, `TaskRepository`,
 * `ExecutionRecordRepository`, `ReviewRepository` — so the domain, the
 * orchestrator and the state machines are untouched by persistence. The
 * in-memory implementations stay in place for deterministic unit tests; this is
 * what a running application composes, so process memory is not the source of
 * truth.
 *
 * The three properties this file exists to guarantee:
 *
 *   * COMPARE-AND-SET. Every state transition is a single conditional UPDATE
 *     (`WHERE id = ? AND state IN (…expected)`), so two concurrent advances
 *     cannot both land — which is what the in-memory ports promised and only a
 *     database can actually keep across processes.
 *   * FIDELITY. Every domain field survives the round trip, including the
 *     per-attempt audit trail, the retry counters, the idempotency key and the
 *     handle/provider-execution split. Timestamps are normalized through
 *     `Date`, and this is the one documented lossy step: an ISO string without
 *     milliseconds comes back with them.
 *   * HONEST FAILURE. Reading a record that is not there is `null`; SAVING one
 *     that is not there is a typed `RUN_NOT_FOUND`, never a silent insert.
 *
 * Nothing here decides policy. The review boundary still refuses a non-HUMAN
 * decider in `ReviewService`; this file only makes the decision durable and
 * once-only.
 */

export type WorkforceLifecyclePrismaClient = Pick<
  PrismaClient,
  "aiMission" | "aiTask" | "aiExecutionRecord" | "aiTaskReview"
>;

const LIFECYCLE_DELEGATES = ["aiMission", "aiTask", "aiExecutionRecord", "aiTaskReview"] as const;

/**
 * Fails closed when the connected database does not expose the lifecycle
 * tables. An unmigrated database must be a clear error naming what is missing,
 * not `undefined.create` deep inside a mission advance.
 */
export function assertLifecycleSchema(client: unknown): void {
  const candidate = client as Record<string, unknown>;
  const missing = LIFECYCLE_DELEGATES.filter((model) => !candidate[model]);
  if (missing.length > 0) {
    throw new AiWorkforceError(
      "PERSISTENCE_UNAVAILABLE",
      `Mission lifecycle tables are not available on the connected database (missing delegates: ${missing.join(", ")}). Run "prisma generate" and apply the proposed AI_WORKFORCE_PHASE_2 migration locally.`,
      { missing },
    );
  }
}

/* ═══════════════════════════════════════════════════════
   Value mapping
   ═══════════════════════════════════════════════════════ */

/** A required JSON column: the domain always owns the whole value. */
function asJson(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value ?? null)) as Prisma.InputJsonValue;
}

/** A NULLABLE JSON column: absent means SQL NULL, never the JSON literal `null`. */
function optionalJson(value: unknown): Prisma.InputJsonValue | typeof Prisma.DbNull {
  return value === undefined || value === null ? Prisma.DbNull : asJson(value);
}

function fromJson<T>(value: Prisma.JsonValue | null | undefined): T | undefined {
  return value === null || value === undefined ? undefined : (value as T);
}

function toDate(iso: string): Date {
  return new Date(iso);
}

/* ═══════════════════════════════════════════════════════
   Missions
   ═══════════════════════════════════════════════════════ */

function missionRow(mission: Mission) {
  return {
    title: mission.title,
    goal: mission.goal,
    businessId: mission.businessId ?? null,
    workspaceRef: mission.workspaceRef ?? null,
    projectRef: mission.projectRef ?? null,
    clientRef: mission.clientRef ?? null,
    createdBy: mission.createdBy,
    owner: mission.owner ?? null,
    participants: asJson(mission.participants),
    state: mission.state,
    priority: mission.priority,
    contextRefs: asJson(mission.contextRefs),
    jobRefs: asJson(mission.jobRefs),
    taskRefs: asJson(mission.taskRefs),
    approvals: asJson(mission.approvals),
    outputs: asJson(mission.outputs),
    history: asJson(mission.history),
    createdAt: toDate(mission.createdAt),
    updatedAt: toDate(mission.updatedAt),
    startedAt: mission.startedAt ? toDate(mission.startedAt) : null,
    finishedAt: mission.finishedAt ? toDate(mission.finishedAt) : null,
  };
}

type MissionRow = MissionRowShape;
type MissionRowShape = Prisma.AiMissionGetPayload<Record<string, never>>;

function toMission(row: MissionRow): Mission {
  const mission: Mission = {
    id: row.id as Mission["id"],
    title: row.title,
    goal: row.goal,
    createdBy: row.createdBy,
    owner: row.owner,
    participants: fromJson<Mission["participants"]>(row.participants) ?? [],
    state: row.state as MissionState,
    priority: row.priority as Mission["priority"],
    contextRefs: fromJson<string[]>(row.contextRefs) ?? [],
    jobRefs: fromJson<Mission["jobRefs"]>(row.jobRefs) ?? [],
    taskRefs: fromJson<Mission["taskRefs"]>(row.taskRefs) ?? [],
    approvals: fromJson<string[]>(row.approvals) ?? [],
    outputs: fromJson<Mission["outputs"]>(row.outputs) ?? [],
    history: fromJson<MissionTransition[]>(row.history) ?? [],
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
  if (row.businessId) mission.businessId = row.businessId;
  if (row.workspaceRef) mission.workspaceRef = row.workspaceRef;
  if (row.projectRef) mission.projectRef = row.projectRef;
  if (row.clientRef) mission.clientRef = row.clientRef;
  if (row.startedAt) mission.startedAt = row.startedAt.toISOString();
  if (row.finishedAt) mission.finishedAt = row.finishedAt.toISOString();
  return mission;
}

export class PrismaMissionRepository implements MissionRepository {
  constructor(private readonly client: WorkforceLifecyclePrismaClient) {}

  async insert(mission: Mission): Promise<Mission> {
    const row = await this.client.aiMission.create({ data: { id: mission.id, ...missionRow(mission) } });
    return toMission(row);
  }

  async get(id: string): Promise<Mission | null> {
    const row = await this.client.aiMission.findUnique({ where: { id } });
    return row ? toMission(row) : null;
  }

  async list(limit = 50): Promise<Mission[]> {
    const rows = await this.client.aiMission.findMany({
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: limit,
    });
    return rows.map(toMission);
  }

  /**
   * Compare-and-set on the stored STATE. Returns `null` when the mission does
   * not exist OR when the stored state is no longer one of `expected` — the
   * caller cannot tell those apart, exactly like the in-memory port, and both
   * mean "your advance did not land".
   */
  async update(mission: Mission, expected: MissionState[]): Promise<Mission | null> {
    const { count } = await this.client.aiMission.updateMany({
      where: { id: mission.id, state: { in: [...expected] } },
      data: missionRow(mission),
    });
    if (count === 0) return null;
    return this.get(mission.id);
  }

  count(): Promise<number> {
    return this.client.aiMission.count();
  }
}

/* ═══════════════════════════════════════════════════════
   Tasks
   ═══════════════════════════════════════════════════════ */

function taskRow(task: MissionTask) {
  return {
    missionId: task.missionId,
    sequence: task.sequence,
    title: task.title,
    objective: task.objective,
    input: asJson(task.input),
    assignedActorId: task.assignedActorId ?? null,
    requiredCapabilityId: task.requiredCapabilityId ?? null,
    requiredCapabilityVersion: task.requiredCapabilityVersion ?? null,
    dependsOn: asJson(task.dependsOn),
    state: task.state,
    attempt: task.attempt,
    maxAttempts: task.maxAttempts,
    executionRecordId: task.executionRecordId ?? null,
    executionHandleId: task.executionHandleId ?? null,
    reviewId: task.reviewId ?? null,
    result: optionalJson(task.result),
    error: optionalJson(task.error),
    history: asJson(task.history),
    createdAt: toDate(task.createdAt),
    updatedAt: toDate(task.updatedAt),
    startedAt: task.startedAt ? toDate(task.startedAt) : null,
    finishedAt: task.finishedAt ? toDate(task.finishedAt) : null,
  };
}

type TaskRow = Prisma.AiTaskGetPayload<Record<string, never>>;

function toTask(row: TaskRow): MissionTask {
  const task: MissionTask = {
    id: row.id as TaskId,
    missionId: row.missionId as MissionId,
    sequence: row.sequence,
    title: row.title,
    objective: row.objective,
    input: (fromJson<MissionTask["input"]>(row.input) ?? {}) as MissionTask["input"],
    assignedActorId: row.assignedActorId,
    requiredCapabilityId: row.requiredCapabilityId,
    dependsOn: fromJson<TaskId[]>(row.dependsOn) ?? [],
    state: row.state as TaskState,
    attempt: row.attempt,
    maxAttempts: row.maxAttempts,
    history: fromJson<TaskTransition[]>(row.history) ?? [],
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
  if (row.requiredCapabilityVersion) task.requiredCapabilityVersion = row.requiredCapabilityVersion;
  if (row.executionRecordId) task.executionRecordId = row.executionRecordId as ExecutionRecordId;
  if (row.executionHandleId) task.executionHandleId = row.executionHandleId;
  if (row.reviewId) task.reviewId = row.reviewId as ReviewId;
  const result = fromJson<MissionTask["result"]>(row.result);
  if (result !== undefined) task.result = result;
  const error = fromJson<TaskError>(row.error);
  if (error !== undefined) task.error = error;
  if (row.startedAt) task.startedAt = row.startedAt.toISOString();
  if (row.finishedAt) task.finishedAt = row.finishedAt.toISOString();
  return task;
}

export class PrismaTaskRepository implements TaskRepository {
  constructor(private readonly client: WorkforceLifecyclePrismaClient) {}

  async insert(task: MissionTask): Promise<MissionTask> {
    const row = await this.client.aiTask.create({ data: { id: task.id, ...taskRow(task) } });
    return toTask(row);
  }

  async get(id: TaskId): Promise<MissionTask | null> {
    const row = await this.client.aiTask.findUnique({ where: { id } });
    return row ? toTask(row) : null;
  }

  async listForMission(missionId: MissionId): Promise<MissionTask[]> {
    const rows = await this.client.aiTask.findMany({
      where: { missionId },
      orderBy: [{ sequence: "asc" }, { id: "asc" }],
    });
    return rows.map(toTask);
  }

  /** Compare-and-set on the stored task STATE (see `PrismaMissionRepository.update`). */
  async update(task: MissionTask, expected: TaskState[]): Promise<MissionTask | null> {
    const { count } = await this.client.aiTask.updateMany({
      where: { id: task.id, state: { in: [...expected] } },
      data: taskRow(task),
    });
    if (count === 0) return null;
    return this.get(task.id);
  }

  count(): Promise<number> {
    return this.client.aiTask.count();
  }
}

/* ═══════════════════════════════════════════════════════
   Execution records
   ═══════════════════════════════════════════════════════ */

function executionRow(record: ExecutionRecord) {
  return {
    handleId: record.handleId,
    runtimeId: record.runtimeId,
    actorId: record.actorId,
    capabilityId: record.capabilityId,
    capabilityVersion: record.capabilityVersion ?? null,
    assignmentId: record.assignmentId ?? null,
    // `missionId`/`taskId` are foreign keys: an ABSENT one must be SQL NULL, not
    // an empty string, or the constraint would reject the row.
    missionId: record.missionId ?? null,
    taskId: record.taskId ?? null,
    attempt: record.attempt,
    providerExecutionId: record.providerExecutionId ?? null,
    status: record.status,
    idempotencyKey: record.idempotencyKey ?? null,
    replayed: record.replayed ?? false,
    startedAt: toDate(record.startedAt),
    updatedAt: toDate(record.updatedAt),
    completedAt: record.completedAt ? toDate(record.completedAt) : null,
    durationMs: record.durationMs ?? null,
    output: optionalJson(record.output),
    outputText: record.outputText ?? null,
    error: optionalJson(record.error),
    cancelledAt: record.cancelled?.at ? toDate(record.cancelled.at) : null,
    cancelledReason: record.cancelled?.reason ?? null,
    audit: asJson(record.audit),
    createdAt: toDate(record.startedAt),
  };
}

type ExecutionRow = Prisma.AiExecutionRecordGetPayload<Record<string, never>>;

function toExecution(row: ExecutionRow): ExecutionRecord {
  const record: ExecutionRecord = {
    id: row.id as ExecutionRecordId,
    handleId: row.handleId,
    runtimeId: row.runtimeId,
    actorId: row.actorId,
    capabilityId: row.capabilityId,
    attempt: row.attempt,
    status: row.status as AgentExecutionStatus,
    startedAt: row.startedAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    audit: fromJson<ExecutionAuditEvent[]>(row.audit) ?? [],
  };
  if (row.capabilityVersion) record.capabilityVersion = row.capabilityVersion;
  if (row.assignmentId) record.assignmentId = row.assignmentId;
  if (row.missionId) record.missionId = row.missionId as MissionId;
  if (row.taskId) record.taskId = row.taskId as TaskId;
  if (row.providerExecutionId) record.providerExecutionId = row.providerExecutionId;
  if (row.idempotencyKey) record.idempotencyKey = row.idempotencyKey;
  if (row.replayed) record.replayed = true;
  if (row.completedAt) record.completedAt = row.completedAt.toISOString();
  if (row.durationMs !== null) record.durationMs = row.durationMs;
  const output = fromJson<unknown>(row.output);
  if (output !== undefined) record.output = output;
  if (row.outputText !== null && row.outputText !== undefined) record.outputText = row.outputText;
  const error = fromJson<AgentExecutionError>(row.error);
  if (error !== undefined) record.error = error;
  if (row.cancelledAt) {
    record.cancelled = { at: row.cancelledAt.toISOString() };
    if (row.cancelledReason) record.cancelled.reason = row.cancelledReason;
  }
  return record;
}

export class PrismaExecutionRecordRepository implements ExecutionRecordRepository {
  constructor(private readonly client: WorkforceLifecyclePrismaClient) {}

  async insert(record: ExecutionRecord): Promise<ExecutionRecord> {
    const row = await this.client.aiExecutionRecord.create({ data: { id: record.id, ...executionRow(record) } });
    return toExecution(row);
  }

  async get(id: ExecutionRecordId): Promise<ExecutionRecord | null> {
    const row = await this.client.aiExecutionRecord.findUnique({ where: { id } });
    return row ? toExecution(row) : null;
  }

  /**
   * Updates an EXISTING attempt. Unlike the in-memory port (which can only see
   * its own map), a missing row here is authoritative, so it is always the
   * typed `RUN_NOT_FOUND`.
   */
  async save(record: ExecutionRecord): Promise<ExecutionRecord> {
    const { count } = await this.client.aiExecutionRecord.updateMany({
      where: { id: record.id },
      data: executionRow(record),
    });
    if (count === 0) {
      throw new AiWorkforceError("RUN_NOT_FOUND", `Execution record "${record.id}" does not exist`, {
        executionRecordId: record.id,
      });
    }
    const stored = await this.get(record.id);
    if (!stored) {
      throw new AiWorkforceError("RUN_NOT_FOUND", `Execution record "${record.id}" disappeared during save`, {
        executionRecordId: record.id,
      });
    }
    return stored;
  }

  async listForTask(taskId: TaskId): Promise<ExecutionRecord[]> {
    const rows = await this.client.aiExecutionRecord.findMany({
      where: { taskId },
      orderBy: [{ attempt: "asc" }, { startedAt: "asc" }],
    });
    return rows.map(toExecution);
  }

  async listForMission(missionId: MissionId): Promise<ExecutionRecord[]> {
    const rows = await this.client.aiExecutionRecord.findMany({
      where: { missionId },
      orderBy: [{ startedAt: "asc" }, { id: "asc" }],
    });
    return rows.map(toExecution);
  }

  /** Most recently touched first: this is the `Recent Activity` source. */
  async list(limit = 100): Promise<ExecutionRecord[]> {
    const rows = await this.client.aiExecutionRecord.findMany({
      orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
      take: limit,
    });
    return rows.map(toExecution);
  }

  count(): Promise<number> {
    return this.client.aiExecutionRecord.count();
  }
}

/* ═══════════════════════════════════════════════════════
   Reviews
   ═══════════════════════════════════════════════════════ */

function reviewRow(review: TaskReview) {
  return {
    taskId: review.taskId,
    missionId: review.missionId,
    executionRecordId: review.executionRecordId,
    state: review.state,
    summary: review.summary,
    reviewerActorId: review.reviewerActorId ?? null,
    requestedBy: review.requestedBy,
    requestedAt: toDate(review.requestedAt),
    decidedBy: review.decidedBy ?? null,
    decidedAt: review.decidedAt ? toDate(review.decidedAt) : null,
    note: review.note ?? null,
  };
}

type ReviewRow = Prisma.AiTaskReviewGetPayload<Record<string, never>>;

function toReview(row: ReviewRow): TaskReview {
  const review: TaskReview = {
    id: row.id as ReviewId,
    taskId: row.taskId as TaskId,
    missionId: row.missionId as MissionId,
    executionRecordId: row.executionRecordId as ExecutionRecordId,
    state: row.state as ReviewState,
    summary: row.summary,
    reviewerActorId: row.reviewerActorId,
    requestedBy: row.requestedBy,
    requestedAt: row.requestedAt.toISOString(),
  };
  if (row.decidedBy) review.decidedBy = row.decidedBy;
  if (row.decidedAt) review.decidedAt = row.decidedAt.toISOString();
  if (row.note) review.note = row.note;
  return review;
}

export class PrismaReviewRepository implements ReviewRepository {
  constructor(private readonly client: WorkforceLifecyclePrismaClient) {}

  async insert(review: TaskReview): Promise<TaskReview> {
    const row = await this.client.aiTaskReview.create({ data: { id: review.id, ...reviewRow(review) } });
    return toReview(row);
  }

  async get(id: ReviewId): Promise<TaskReview | null> {
    const row = await this.client.aiTaskReview.findUnique({ where: { id } });
    return row ? toReview(row) : null;
  }

  async forTask(taskId: TaskId): Promise<TaskReview[]> {
    const rows = await this.client.aiTaskReview.findMany({
      where: { taskId },
      orderBy: [{ requestedAt: "asc" }, { id: "asc" }],
    });
    return rows.map(toReview);
  }

  async listPending(): Promise<TaskReview[]> {
    const rows = await this.client.aiTaskReview.findMany({
      where: { state: "PENDING" },
      orderBy: [{ requestedAt: "asc" }, { id: "asc" }],
    });
    return rows.map(toReview);
  }

  /**
   * The decision CAS. `WHERE id = ? AND state IN (…expected)` means a second
   * decision — from another request, another process, another day — loses and
   * the person's first decision stands.
   */
  async decide(review: TaskReview, expected: ReviewState[]): Promise<TaskReview | null> {
    const { count } = await this.client.aiTaskReview.updateMany({
      where: { id: review.id, state: { in: [...expected] } },
      data: reviewRow(review),
    });
    if (count === 0) return null;
    return this.get(review.id);
  }

  count(): Promise<number> {
    return this.client.aiTaskReview.count();
  }
}

/* ═══════════════════════════════════════════════════════
   Composition
   ═══════════════════════════════════════════════════════ */

export type WorkforceLifecycleRepositories = {
  missions: MissionRepository;
  tasks: TaskRepository;
  executionRecords: ExecutionRecordRepository;
  reviews: ReviewRepository;
};

/**
 * Binds all four durable repositories to one client. The schema is asserted
 * first, so composing against an unmigrated database fails loudly at
 * composition time instead of on the first mission.
 */
export function createPrismaLifecycleRepositories(
  client: WorkforceLifecyclePrismaClient,
): WorkforceLifecycleRepositories {
  assertLifecycleSchema(client);
  return {
    missions: new PrismaMissionRepository(client),
    tasks: new PrismaTaskRepository(client),
    executionRecords: new PrismaExecutionRecordRepository(client),
    reviews: new PrismaReviewRepository(client),
  };
}
