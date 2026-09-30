import { AiWorkforceError } from "../core/errors";
import type { ApprovalId, Clock, IdFactory, JsonObject, RiskLevel } from "../core/types";

/* ═══════════════════════════════════════════════════════
   Contracts
   ═══════════════════════════════════════════════════════

   An approval is a RECORD, not a boolean. It carries who asked, for whom,
   which capability, at what risk, why, who decided, when, and why they said
   yes or no — because that decision is what authorises a HIGH-risk capability
   to touch business data.

   Phase 1A held these in memory. Table `AiApproval` (see the proposed
   additive migration) backs the same interface in Phase 1B. */

export const APPROVAL_STATUSES = ["PENDING", "APPROVED", "REJECTED", "EXPIRED"] as const;
export type ApprovalStatus = (typeof APPROVAL_STATUSES)[number];

export type ApprovalRecord = {
  id: ApprovalId;
  status: ApprovalStatus;
  toolId: string;
  jobId?: string;
  runId?: string;
  riskLevel: RiskLevel;
  /** The actor whose job is waiting (the requester). */
  requestedByUserId: string;
  /** The actor the decision is being taken FOR. Same as the requester unless
   *  an agent requested on someone's behalf. */
  requestedForUserId: string;
  requestReason: string;
  createdAt: string;
  decidedByUserId?: string;
  decidedAt?: string;
  decisionReason?: string;
  metadata?: JsonObject;
};

export type CreateApprovalInput = {
  toolId: string;
  riskLevel: RiskLevel;
  requestedByUserId: string;
  requestedForUserId?: string;
  requestReason: string;
  jobId?: string;
  runId?: string;
  metadata?: JsonObject;
};

export type DecideApprovalInput = {
  approvalId: ApprovalId;
  decision: Exclude<ApprovalStatus, "PENDING" | "EXPIRED">;
  byUserId: string;
  reason?: string;
};

/**
 * Approval repository port.
 *
 * `decide` is a compare-and-set on `PENDING`: the first decision wins and
 * every later attempt fails with APPROVAL_ALREADY_DECIDED. That is the second
 * half of the engine's idempotency guarantee — the same human decision can
 * never authorise two executions, however many times the request is retried.
 */
export interface ApprovalRepository {
  create(input: CreateApprovalInput): Promise<ApprovalRecord>;
  get(id: ApprovalId): Promise<ApprovalRecord | null>;
  list(limit?: number): Promise<ApprovalRecord[]>;
  listPending(limit?: number): Promise<ApprovalRecord[]>;
  listForJob(jobId: string, limit?: number): Promise<ApprovalRecord[]>;
  decide(input: DecideApprovalInput): Promise<ApprovalRecord>;
}

/* ═══════════════════════════════════════════════════════
   In-memory implementation
   ═══════════════════════════════════════════════════════ */

export class InMemoryApprovalRepository implements ApprovalRepository {
  private readonly records = new Map<ApprovalId, ApprovalRecord>();

  constructor(
    private readonly deps: { ids: IdFactory; now: Clock },
  ) {}

  async create(input: CreateApprovalInput): Promise<ApprovalRecord> {
    const record: ApprovalRecord = {
      id: this.deps.ids.next("approval"),
      status: "PENDING",
      toolId: input.toolId,
      jobId: input.jobId,
      runId: input.runId,
      riskLevel: input.riskLevel,
      requestedByUserId: input.requestedByUserId,
      requestedForUserId: input.requestedForUserId ?? input.requestedByUserId,
      requestReason: input.requestReason,
      createdAt: this.deps.now().toISOString(),
      metadata: input.metadata,
    };
    this.records.set(record.id, record);
    return record;
  }

  async get(id: ApprovalId): Promise<ApprovalRecord | null> {
    return this.records.get(id) ?? null;
  }

  async list(limit = 50): Promise<ApprovalRecord[]> {
    return [...this.records.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, limit);
  }

  async listPending(limit = 50): Promise<ApprovalRecord[]> {
    return (await this.list(Number.MAX_SAFE_INTEGER)).filter((record) => record.status === "PENDING").slice(0, limit);
  }

  async listForJob(jobId: string, limit = 20): Promise<ApprovalRecord[]> {
    return (await this.list(Number.MAX_SAFE_INTEGER))
      .filter((record) => record.jobId === jobId)
      .slice(0, limit);
  }

  async decide(input: DecideApprovalInput): Promise<ApprovalRecord> {
    const existing = this.records.get(input.approvalId);
    if (!existing) {
      throw new AiWorkforceError("APPROVAL_NOT_FOUND", `Approval "${input.approvalId}" does not exist`, {
        approvalId: input.approvalId,
      });
    }
    if (existing.status !== "PENDING") {
      throw new AiWorkforceError(
        "APPROVAL_ALREADY_DECIDED",
        `Approval "${input.approvalId}" was already decided (${existing.status})`,
        { approvalId: input.approvalId, status: existing.status },
      );
    }

    const decided: ApprovalRecord = {
      ...existing,
      status: input.decision,
      decidedByUserId: input.byUserId,
      decidedAt: this.deps.now().toISOString(),
      decisionReason: input.reason,
    };
    this.records.set(decided.id, decided);
    return decided;
  }

  count(): number {
    return this.records.size;
  }
}
