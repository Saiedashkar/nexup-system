import { AiWorkforceError } from "@/modules/ai-workforce/core/errors";
import type { Clock, IdFactory, JsonObject } from "@/modules/ai-workforce/core/types";
import type {
  ActorId,
  AssignmentId,
  CapabilityId,
  ExecutionRecordId,
  MissionId,
  RuntimeId,
  TaskId,
} from "../core/refs";
import {
  isTerminalExecutionStatus,
  type AgentExecutionError,
  type AgentExecutionStatus,
} from "../runtimes/agent-runtime";

/**
 * Execution RECORDS.
 *
 * One record per execution ATTEMPT. It is the audit spine of the mission
 * lifecycle, and it deliberately REUSES the Step-4 provider-neutral vocabulary
 * (`AgentExecutionStatus`, `AgentExecutionError`, and the handle/provider split)
 * rather than inventing a second one:
 *
 *   handleId             the runtime's own handle (the bridge run id on BRIDGE)
 *   providerExecutionId  the provider's private reference (the Hermes session)
 *
 * What it adds is the mission context a bare runtime record cannot know:
 * which task and attempt it belongs to, which assignment authorised it, the
 * retry/idempotency story, and an ordered audit trail.
 *
 * Storage is a port, exactly like missions and tasks. Nothing here talks to a
 * database in this phase.
 */

export const EXECUTION_AUDIT_EVENT_TYPES = [
  "REQUESTED",
  "ACCEPTED",
  "STATUS",
  "TERMINAL",
  "CANCELLED",
  "RETRY",
  "REJECTED",
] as const;
export type ExecutionAuditEventType = (typeof EXECUTION_AUDIT_EVENT_TYPES)[number];

export type ExecutionAuditEvent = {
  seq: number;
  at: string;
  type: ExecutionAuditEventType;
  status?: AgentExecutionStatus;
  detail?: string;
};

export type ExecutionRecord = {
  id: ExecutionRecordId;
  /** The runtime's own handle for this attempt (bridge run id on BRIDGE). */
  handleId: string;
  runtimeId: RuntimeId;
  actorId: ActorId;
  capabilityId: CapabilityId;
  capabilityVersion?: string;
  /** The assignment edge that authorised this attempt. */
  assignmentId?: AssignmentId;
  missionId?: MissionId;
  taskId?: TaskId;
  /** 1-based attempt number inside the task. */
  attempt: number;
  /** Provider's private reference (Hermes session). Never a handle. */
  providerExecutionId?: string;
  status: AgentExecutionStatus;
  /** The key that made this attempt idempotent, when one applied. */
  idempotencyKey?: string;
  /** True when the runtime answered an idempotent replay: no new real run. */
  replayed?: boolean;
  startedAt: string;
  updatedAt: string;
  completedAt?: string;
  durationMs?: number;
  output?: unknown;
  outputText?: string;
  error?: AgentExecutionError;
  cancelled?: { at: string; reason?: string };
  /** Ordered, structured audit events for THIS attempt. */
  audit: ExecutionAuditEvent[];
};

/**
 * What a runtime told us about an attempt. A PATCH rather than a full
 * `AgentExecutionRecord`: the record owns its identity and its own timestamps,
 * so a caller reporting an outcome never has to fabricate them.
 */
export type ExecutionOutcomePatch = {
  status: AgentExecutionStatus;
  providerExecutionId?: string;
  completedAt?: string;
  durationMs?: number;
  output?: unknown;
  outputText?: string;
  error?: AgentExecutionError;
  replayed?: boolean;
};

export type ExecutionRecordOpenInput = {
  handleId: string;
  runtimeId: RuntimeId;
  actorId: ActorId;
  capabilityId: CapabilityId;
  capabilityVersion?: string;
  assignmentId?: string;
  missionId?: MissionId;
  taskId?: TaskId;
  attempt?: number;
  status?: AgentExecutionStatus;
  idempotencyKey?: string;
  replayed?: boolean;
};

export interface ExecutionRecordRepository {
  insert(record: ExecutionRecord): Promise<ExecutionRecord>;
  get(id: ExecutionRecordId): Promise<ExecutionRecord | null>;
  save(record: ExecutionRecord): Promise<ExecutionRecord>;
  listForTask(taskId: TaskId): Promise<ExecutionRecord[]>;
  listForMission(missionId: MissionId): Promise<ExecutionRecord[]>;
  list(limit?: number): Promise<ExecutionRecord[]>;
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export class InMemoryExecutionRecordRepository implements ExecutionRecordRepository {
  private readonly rows = new Map<ExecutionRecordId, ExecutionRecord>();

  async insert(record: ExecutionRecord): Promise<ExecutionRecord> {
    this.rows.set(record.id, clone(record));
    return clone(record);
  }

  async get(id: ExecutionRecordId): Promise<ExecutionRecord | null> {
    const row = this.rows.get(id);
    return row ? clone(row) : null;
  }

  async save(record: ExecutionRecord): Promise<ExecutionRecord> {
    if (!this.rows.has(record.id)) {
      throw new AiWorkforceError("RUN_NOT_FOUND", `Execution record "${record.id}" does not exist`, {
        executionRecordId: record.id,
      });
    }
    this.rows.set(record.id, clone(record));
    return clone(record);
  }

  async listForTask(taskId: TaskId): Promise<ExecutionRecord[]> {
    return [...this.rows.values()]
      .filter((row) => row.taskId === taskId)
      .map(clone)
      .sort((a, b) => a.attempt - b.attempt || a.startedAt.localeCompare(b.startedAt));
  }

  async listForMission(missionId: MissionId): Promise<ExecutionRecord[]> {
    return [...this.rows.values()]
      .filter((row) => row.missionId === missionId)
      .map(clone)
      .sort((a, b) => a.startedAt.localeCompare(b.startedAt) || a.id.localeCompare(b.id));
  }

  async list(limit = 100): Promise<ExecutionRecord[]> {
    return [...this.rows.values()].map(clone).slice(0, limit);
  }

  count(): number {
    return this.rows.size;
  }
}

export type ExecutionRecorderDeps = {
  records: ExecutionRecordRepository;
  ids: IdFactory;
  now: Clock;
};

/**
 * Turns runtime outcomes into execution records.
 *
 * The orchestrator never builds a record by hand: it opens one when it hands
 * work to a runtime and settles it from what the runtime reports. That keeps
 * "what the provider said" in exactly one place.
 */
export class ExecutionRecorder {
  constructor(private readonly deps: ExecutionRecorderDeps) {}

  async open(input: ExecutionRecordOpenInput): Promise<ExecutionRecord> {
    const at = this.deps.now().toISOString();
    const record: ExecutionRecord = {
      id: this.deps.ids.next("execution"),
      handleId: input.handleId,
      runtimeId: input.runtimeId,
      actorId: input.actorId,
      capabilityId: input.capabilityId,
      attempt: input.attempt ?? 1,
      status: input.status ?? "ACCEPTED",
      startedAt: at,
      updatedAt: at,
      audit: [],
    };
    if (input.capabilityVersion) record.capabilityVersion = input.capabilityVersion;
    if (input.assignmentId) record.assignmentId = input.assignmentId;
    if (input.missionId) record.missionId = input.missionId;
    if (input.taskId) record.taskId = input.taskId;
    if (input.idempotencyKey) record.idempotencyKey = input.idempotencyKey;
    if (input.replayed) record.replayed = true;
    this.push(record, "REQUESTED", record.status);
    if (isTerminalExecutionStatus(record.status)) {
      // A runtime may report an outcome in the same breath as the handle (the
      // deterministic transport does). Say that instead of pretending the
      // attempt was merely accepted.
      this.push(record, "TERMINAL", record.status, "terminal at dispatch");
    } else {
      this.push(record, "ACCEPTED", record.status);
    }
    return this.deps.records.insert(record);
  }

  /**
   * Applies the runtime's own view of the execution to the record.
   *
   * The FIRST terminal state wins here too: a cancelled attempt must not be
   * reported SUCCEEDED by a frame that arrived afterwards. Provider metadata
   * (the session id, timings) is still merged in, so audit never loses it.
   */
  async apply(recordId: ExecutionRecordId, execution: ExecutionOutcomePatch): Promise<ExecutionRecord> {
    const existing = await this.deps.records.get(recordId);
    if (!existing) {
      throw new AiWorkforceError("RUN_NOT_FOUND", `Execution record "${recordId}" does not exist`, {
        executionRecordId: recordId,
      });
    }
    const at = this.deps.now().toISOString();
    const next: ExecutionRecord = { ...existing, updatedAt: at };

    if (!next.providerExecutionId && execution.providerExecutionId) {
      next.providerExecutionId = execution.providerExecutionId;
    }
    if (execution.durationMs !== undefined) next.durationMs = execution.durationMs;
    if (execution.output !== undefined) next.output = execution.output;
    if (execution.outputText !== undefined) next.outputText = execution.outputText;
    if (execution.error) next.error = execution.error;
    if (execution.replayed) next.replayed = true;

    const alreadyTerminal = isTerminalExecutionStatus(existing.status);
    const arriving = execution.status;
    if (!alreadyTerminal) {
      next.status = arriving;
      if (execution.completedAt) next.completedAt = execution.completedAt;
      else if (isTerminalExecutionStatus(arriving)) next.completedAt = at;
      if (isTerminalExecutionStatus(arriving)) this.push(next, "TERMINAL", arriving, execution.error?.message);
      else this.push(next, "STATUS", arriving);
    } else if (existing.status !== arriving) {
      // The status stands; only say what the provider also reported.
      this.push(next, "STATUS", arriving, "provider reported a different terminal state after the fact");
    }

    return this.deps.records.save(next);
  }

  /** Records a cancellation requested through the runtime port. */
  async markCancelled(recordId: ExecutionRecordId, reason?: string): Promise<ExecutionRecord> {
    const existing = await this.deps.records.get(recordId);
    if (!existing) {
      throw new AiWorkforceError("RUN_NOT_FOUND", `Execution record "${recordId}" does not exist`, {
        executionRecordId: recordId,
      });
    }
    const at = this.deps.now().toISOString();
    const next: ExecutionRecord = {
      ...existing,
      status: "CANCELLED",
      updatedAt: at,
      completedAt: existing.completedAt ?? at,
      cancelled: { at, ...(reason ? { reason } : {}) },
    };
    this.push(next, "CANCELLED", "CANCELLED", reason);
    return this.deps.records.save(next);
  }

  /** Records a human's refusal of the result (task FAILED by review). */
  async markRejected(recordId: ExecutionRecordId, note: string): Promise<ExecutionRecord> {
    const existing = await this.deps.records.get(recordId);
    if (!existing) {
      throw new AiWorkforceError("RUN_NOT_FOUND", `Execution record "${recordId}" does not exist`, {
        executionRecordId: recordId,
      });
    }
    const next: ExecutionRecord = { ...existing, updatedAt: this.deps.now().toISOString() };
    this.push(next, "REJECTED", next.status, note);
    return this.deps.records.save(next);
  }

  private push(
    record: ExecutionRecord,
    type: ExecutionAuditEvent["type"],
    status?: AgentExecutionStatus,
    detail?: string,
  ): void {
    const event: ExecutionAuditEvent = {
      seq: record.audit.length + 1,
      at: this.deps.now().toISOString(),
      type,
    };
    if (status) event.status = status;
    if (detail) event.detail = detail;
    record.audit.push(event);
  }
}

/** Convenience: the terminal status of an attempt, or null while it is open. */
export function executionTerminalStatus(record: ExecutionRecord): AgentExecutionStatus | null {
  return isTerminalExecutionStatus(record.status) ? record.status : null;
}

/** A bounded, JSON-safe summary of an attempt (never secrets, never raw prompts). */
export function summarizeExecution(record: ExecutionRecord): JsonObject {
  const summary: JsonObject = {
    executionRecordId: record.id,
    handleId: record.handleId,
    runtimeId: record.runtimeId,
    actorId: record.actorId,
    capabilityId: record.capabilityId,
    attempt: record.attempt,
    status: record.status,
    startedAt: record.startedAt,
    updatedAt: record.updatedAt,
  };
  if (record.taskId) summary.taskId = record.taskId;
  if (record.providerExecutionId) summary.providerExecutionId = record.providerExecutionId;
  if (record.completedAt) summary.completedAt = record.completedAt;
  if (record.error) summary.error = { code: record.error.category, message: record.error.message };
  return summary;
}
