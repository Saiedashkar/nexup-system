import { AiWorkforceError } from "../core/errors";
import type { Clock, IdFactory, JsonObject } from "../core/types";
import type { ExecutionContextSnapshot } from "../core/context-snapshot";
import type { AuditEvent, RunRecord } from "../audit/run-recorder";
import type { AuditEventRepository } from "../audit/audit-event-repository";
import type { RunRepository } from "../audit/run-repository";
import type { ApprovalRecord, ApprovalRepository, CreateApprovalInput, DecideApprovalInput } from "../approvals/approval-repository";
import type { Job, JobStatus, JobTransition } from "../jobs/job-contracts";
import type { JobRepository } from "../jobs/job-repository";
import type {
  AiApprovalRow,
  AiJobRow,
  AiRunEventRow,
  AiRunRow,
  WorkforceDatabaseClient,
} from "./prisma-workforce-db";

/**
 * Prisma repository adapters.
 *
 * Four thin translations between the engine's contracts and the four `ai_*`
 * tables. Rules held here:
 *
 *   - NOTHING in the legacy schema is read or written. The workforce engine
 *     owns its own tables and reaches business data only through read ports.
 *   - Every state-changing write is a compare-and-set (`updateMany` with the
 *     expected status in the WHERE clause), so idempotency does not depend on
 *     the application being single-threaded.
 *   - No soft-delete columns: audit and approval records are immutable.
 */

const iso = (value: Date | null): string | undefined => (value ? new Date(value).toISOString() : undefined);

function asObject(value: unknown): JsonObject {
  return (value && typeof value === "object" ? value : {}) as JsonObject;
}

function asHistory(value: unknown): JobTransition[] {
  return Array.isArray(value) ? (value as JobTransition[]) : [];
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

/* ═══════════════════════════════════════════════════════
   Jobs
   ═══════════════════════════════════════════════════════ */

export class PrismaJobRepository implements JobRepository {
  constructor(private readonly db: WorkforceDatabaseClient) {}

  async insert(job: Job): Promise<Job> {
    await this.db.aiJob.create({ data: fromJob(job) });
    return clone(job);
  }

  async get(id: string): Promise<Job | null> {
    const row = await this.db.aiJob.findUnique({ where: { id } });
    return row ? toJob(row) : null;
  }

  async list(limit = 50): Promise<Job[]> {
    const rows = await this.db.aiJob.findMany({ orderBy: { createdAt: "desc" }, take: limit });
    return rows.map(toJob);
  }

  async update(job: Job, expected: JobStatus[]): Promise<Job | null> {
    const result = await this.db.aiJob.updateMany({
      where: { id: job.id, status: { in: expected } },
      data: fromJob(job),
    });
    // count === 0 means the row moved on (or vanished): the compare-and-set lost.
    return result.count > 0 ? clone(job) : null;
  }
}

/** Row payload for `ai_jobs` — used for both insert and compare-and-set update. */
function fromJob(job: Job) {
  return {
    // The engine owns its identifiers (`createIdFactory`) so ids are identical
    // whether the row lands in memory or in a database.
    id: job.id,
    status: job.status,
    trigger: job.trigger,
    autonomy: job.autonomy,
    capability: job.capability,
    resolvedToolId: job.resolvedToolId ?? null,
    input: job.input ?? {},
    actorUserId: job.actorUserId,
    businessId: job.businessId ?? null,
    correlationId: job.correlationId,
    approvalId: job.approvalId ?? null,
    runId: job.runId ?? null,
    errorCode: job.error?.code ?? null,
    errorMessage: job.error?.message ?? null,
    context: job.contextSnapshot ?? {},
    history: job.history ?? [],
    startedAt: job.startedAt ? new Date(job.startedAt) : null,
    finishedAt: job.finishedAt ? new Date(job.finishedAt) : null,
    createdAt: new Date(job.createdAt),
    updatedAt: new Date(job.updatedAt),
  };
}

function toJob(row: AiJobRow): Job {
  const job: Job = {
    id: row.id,
    status: row.status as JobStatus,
    trigger: row.trigger as Job["trigger"],
    autonomy: row.autonomy as Job["autonomy"],
    capability: row.capability,
    input: asObject(row.input),
    actorUserId: row.actorUserId,
    correlationId: row.correlationId,
    createdAt: iso(row.createdAt) as string,
    updatedAt: iso(row.updatedAt) as string,
    history: asHistory(row.history),
  };

  if (row.resolvedToolId) job.resolvedToolId = row.resolvedToolId;
  if (row.businessId) job.businessId = row.businessId;
  if (row.startedAt) job.startedAt = iso(row.startedAt);
  if (row.finishedAt) job.finishedAt = iso(row.finishedAt);
  if (row.runId) job.runId = row.runId;
  if (row.approvalId) job.approvalId = row.approvalId;
  if (row.errorCode) job.error = { code: row.errorCode as never, message: row.errorMessage ?? "" };
  if (row.context && typeof row.context === "object" && Object.keys(row.context as object).length > 0) {
    job.contextSnapshot = row.context as ExecutionContextSnapshot;
  }

  return job;
}

/* ═══════════════════════════════════════════════════════
   Runs
   ═══════════════════════════════════════════════════════ */

export class PrismaRunRepository implements RunRepository {
  constructor(private readonly db: WorkforceDatabaseClient) {}

  async insert(run: RunRecord): Promise<RunRecord> {
    await this.db.aiRun.create({ data: fromRun(run) });
    return clone(run);
  }

  async update(run: RunRecord): Promise<RunRecord | null> {
    const result = await this.db.aiRun.updateMany({ where: { id: run.id }, data: fromRun(run) });
    return result.count > 0 ? clone(run) : null;
  }

  async get(id: string): Promise<RunRecord | null> {
    const row = await this.db.aiRun.findUnique({ where: { id } });
    return row ? toRun(row) : null;
  }

  async list(limit = 50): Promise<RunRecord[]> {
    const rows = await this.db.aiRun.findMany({ orderBy: { startedAt: "desc" }, take: limit });
    return rows.map(toRun);
  }
}

function fromRun(run: RunRecord) {
  return {
    id: run.id,
    jobId: run.jobId ?? null,
    toolId: run.toolId ?? null,
    status: run.status,
    runtimeKind: run.runtimeKind,
    serviceIdentityId: run.serviceIdentityId,
    actorUserId: run.actorUserId,
    businessId: run.businessId ?? null,
    correlationId: run.correlationId,
    errorCode: run.errorCode ?? null,
    errorMessage: run.errorMessage ?? null,
    startedAt: new Date(run.startedAt),
    finishedAt: run.finishedAt ? new Date(run.finishedAt) : null,
    durationMs: run.durationMs ?? null,
    input: run.input ?? {},
    output: run.output === undefined ? null : run.output,
  };
}

function toRun(row: AiRunRow): RunRecord {
  const run: RunRecord = {
    id: row.id,
    status: row.status as RunRecord["status"],
    runtimeKind: row.runtimeKind,
    actorUserId: row.actorUserId,
    serviceIdentityId: row.serviceIdentityId,
    correlationId: row.correlationId,
    startedAt: iso(row.startedAt) as string,
  };

  if (row.toolId) run.toolId = row.toolId;
  if (row.jobId) run.jobId = row.jobId;
  if (row.businessId) run.businessId = row.businessId;
  if (row.finishedAt) run.finishedAt = iso(row.finishedAt);
  if (row.durationMs !== null && row.durationMs !== undefined) run.durationMs = row.durationMs;
  if (row.errorCode) run.errorCode = row.errorCode;
  if (row.errorMessage) run.errorMessage = row.errorMessage;
  if (row.input) run.input = asObject(row.input);
  if (row.output !== null && row.output !== undefined) run.output = row.output;

  return run;
}

/* ═══════════════════════════════════════════════════════
   Audit events
   ═══════════════════════════════════════════════════════ */

export class PrismaAuditEventRepository implements AuditEventRepository {
  constructor(private readonly db: WorkforceDatabaseClient) {}

  async append(event: AuditEvent): Promise<AuditEvent> {
    await this.db.aiRunEvent.create({
      data: {
        id: event.id,
        type: event.type,
        runId: event.runId ?? null,
        jobId: event.jobId ?? null,
        toolId: event.toolId ?? null,
        actorUserId: event.actorUserId ?? null,
        businessId: event.businessId ?? null,
        correlationId: event.correlationId ?? null,
        payload: event.payload ?? {},
        at: new Date(event.at),
      },
    });
    return clone(event);
  }

  async list(limit = 100): Promise<AuditEvent[]> {
    const rows = await this.db.aiRunEvent.findMany({ orderBy: { at: "desc" }, take: limit });
    return rows.map(toAuditEvent);
  }

  async listForJob(jobId: string, limit = 200): Promise<AuditEvent[]> {
    const rows = await this.db.aiRunEvent.findMany({
      where: { jobId },
      orderBy: { at: "asc" },
      take: limit,
    });
    return rows.map(toAuditEvent);
  }
}

function toAuditEvent(row: AiRunEventRow): AuditEvent {
  const event: AuditEvent = {
    id: row.id,
    at: iso(row.at) as string,
    type: row.type as AuditEvent["type"],
    payload: asObject(row.payload),
  };
  if (row.runId) event.runId = row.runId;
  if (row.jobId) event.jobId = row.jobId;
  if (row.toolId) event.toolId = row.toolId;
  if (row.actorUserId) event.actorUserId = row.actorUserId;
  if (row.businessId) event.businessId = row.businessId;
  if (row.correlationId) event.correlationId = row.correlationId;
  return event;
}

/* ═══════════════════════════════════════════════════════
   Approvals
   ═══════════════════════════════════════════════════════ */

export class PrismaApprovalRepository implements ApprovalRepository {
  constructor(
    private readonly db: WorkforceDatabaseClient,
    private readonly deps: { ids: IdFactory; now: Clock },
  ) {}

  async create(input: CreateApprovalInput): Promise<ApprovalRecord> {
    const row = await this.db.aiApproval.create({
      data: {
        // Engine-generated id, exactly like the in-memory adapter.
        id: this.deps.ids.next("approval"),
        status: "PENDING",
        toolId: input.toolId,
        jobId: input.jobId ?? null,
        runId: input.runId ?? null,
        riskLevel: input.riskLevel,
        requestedByUserId: input.requestedByUserId,
        requestedForUserId: input.requestedForUserId ?? input.requestedByUserId,
        requestReason: input.requestReason,
        correlationId: (input.metadata?.correlationId as string | undefined) ?? null,
      },
    });
    return toApproval(row);
  }

  async get(id: string): Promise<ApprovalRecord | null> {
    const row = await this.db.aiApproval.findUnique({ where: { id } });
    return row ? toApproval(row) : null;
  }

  async list(limit = 50): Promise<ApprovalRecord[]> {
    const rows = await this.db.aiApproval.findMany({ orderBy: { createdAt: "desc" }, take: limit });
    return rows.map(toApproval);
  }

  async listPending(limit = 50): Promise<ApprovalRecord[]> {
    const rows = await this.db.aiApproval.findMany({
      where: { status: "PENDING" },
      orderBy: { createdAt: "desc" },
      take: limit,
    });
    return rows.map(toApproval);
  }

  async listForJob(jobId: string, limit = 20): Promise<ApprovalRecord[]> {
    const rows = await this.db.aiApproval.findMany({ where: { jobId }, orderBy: { createdAt: "desc" }, take: limit });
    return rows.map(toApproval);
  }

  /** Compare-and-set on PENDING: exactly one decision can ever win. */
  async decide(input: DecideApprovalInput): Promise<ApprovalRecord> {
    const decidedAt = new Date();
    const result = await this.db.aiApproval.updateMany({
      where: { id: input.approvalId, status: "PENDING" },
      data: {
        status: input.decision,
        decidedByUserId: input.byUserId,
        decidedAt,
        decisionReason: input.reason ?? null,
      },
    });

    if (result.count === 0) {
      // Diagnose the failure instead of guessing.
      const current = await this.db.aiApproval.findUnique({ where: { id: input.approvalId } });
      if (!current) {
        throw new AiWorkforceError("APPROVAL_NOT_FOUND", `Approval "${input.approvalId}" does not exist`, {
          approvalId: input.approvalId,
        });
      }
      throw new AiWorkforceError(
        "APPROVAL_ALREADY_DECIDED",
        `Approval "${input.approvalId}" was already decided (${current.status})`,
        { approvalId: input.approvalId, status: current.status },
      );
    }

    const row = await this.db.aiApproval.findUnique({ where: { id: input.approvalId } });
    if (!row) {
      throw new AiWorkforceError("APPROVAL_NOT_FOUND", `Approval "${input.approvalId}" vanished after the decision`, {
        approvalId: input.approvalId,
      });
    }
    return toApproval(row);
  }
}

function toApproval(row: AiApprovalRow): ApprovalRecord {
  const approval: ApprovalRecord = {
    id: row.id,
    status: row.status as ApprovalRecord["status"],
    toolId: row.toolId,
    riskLevel: row.riskLevel as ApprovalRecord["riskLevel"],
    requestedByUserId: row.requestedByUserId,
    requestedForUserId: row.requestedForUserId ?? row.requestedByUserId,
    requestReason: row.requestReason,
    createdAt: iso(row.createdAt) as string,
  };

  if (row.jobId) approval.jobId = row.jobId;
  if (row.runId) approval.runId = row.runId;
  if (row.decidedByUserId) approval.decidedByUserId = row.decidedByUserId;
  if (row.decidedAt) approval.decidedAt = iso(row.decidedAt);
  if (row.decisionReason) approval.decisionReason = row.decisionReason;
  if (row.correlationId) approval.metadata = { correlationId: row.correlationId };

  return approval;
}

/* ═══════════════════════════════════════════════════════
   Factory
   ═══════════════════════════════════════════════════════ */

export type PrismaWorkforceRepositories = {
  jobs: PrismaJobRepository;
  runs: PrismaRunRepository;
  events: PrismaAuditEventRepository;
  approvals: PrismaApprovalRepository;
};

/**
 * Binds the adapters to a client. The single cast is the seam described in
 * `prisma-workforce-db.ts`: the running app passes the Prisma client,
 * tests pass a client bound to a throwaway database.
 */
export function createPrismaRepositories(
  client: unknown,
  deps: { ids: IdFactory; now: Clock },
): PrismaWorkforceRepositories {
  const db = client as WorkforceDatabaseClient;
  return {
    jobs: new PrismaJobRepository(db),
    runs: new PrismaRunRepository(db),
    events: new PrismaAuditEventRepository(db),
    approvals: new PrismaApprovalRepository(db, deps),
  };
}
