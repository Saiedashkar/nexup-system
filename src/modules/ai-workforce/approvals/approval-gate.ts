import { AiWorkforceError } from "../core/errors";
import type { ApprovalId, Clock, IdFactory, JsonObject } from "../core/types";
import type { ExecutionContext } from "../core/execution-context";
import type { ToolDefinition } from "../registry/tool-definition";
import type {
  ApprovalRecord,
  ApprovalRepository,
  DecideApprovalInput,
} from "./approval-repository";
import { DEFAULT_APPROVAL_POLICY, evaluateApproval, type ApprovalEvaluation, type ApprovalPolicy } from "./approval-policy";

/**
 * Approval gate.
 *
 * Combines the approval POLICY (may this run right now?) with the approval
 * STORE (what has a human actually decided?). Storage lives behind
 * `ApprovalRepository`, so the gate is identical in memory and in a database.
 *
 * The gate never executes anything and never decides anything on a human's
 * behalf — it evaluates, enforces and raises requests.
 */

// Re-exported so callers that already import the gate keep working.
export type {
  ApprovalRecord,
  ApprovalRepository,
  ApprovalStatus,
  DecideApprovalInput,
  CreateApprovalInput,
} from "./approval-repository";

export class ApprovalGate {
  constructor(
    private readonly store: ApprovalRepository,
    private readonly policy: ApprovalPolicy = DEFAULT_APPROVAL_POLICY,
    private readonly deps?: { ids: IdFactory; now: Clock },
  ) {}

  /** Resolves the approval state for this execution without side effects. */
  async evaluate(tool: ToolDefinition, context: ExecutionContext): Promise<ApprovalEvaluation> {
    const approval = context.approvalId ? await this.store.get(context.approvalId) : null;
    return evaluateApproval({ tool, policy: this.policy, context, approval });
  }

  /**
   * Enforces the policy.
   * @throws APPROVAL_REQUIRED | APPROVAL_REJECTED | CRITICAL_AUTONOMY_FORBIDDEN
   */
  async enforce(tool: ToolDefinition, context: ExecutionContext): Promise<ApprovalEvaluation> {
    const evaluation = await this.evaluate(tool, context);
    if (evaluation.satisfied) return evaluation;

    const details: JsonObject = {
      toolId: tool.id,
      reason: evaluation.reason,
      riskLevel: tool.riskLevel,
      approvalId: evaluation.approvalId ?? null,
    };

    if (evaluation.reason === "CRITICAL_FORBIDDEN_AUTONOMOUS") {
      throw new AiWorkforceError(
        "CRITICAL_AUTONOMY_FORBIDDEN",
        `Tool "${tool.id}" is CRITICAL and may never run autonomously`,
        details,
      );
    }
    if (evaluation.reason === "APPROVAL_REJECTED") {
      throw new AiWorkforceError("APPROVAL_REJECTED", `Approval for "${tool.id}" was rejected`, details);
    }
    throw new AiWorkforceError("APPROVAL_REQUIRED", `Tool "${tool.id}" requires approval (${evaluation.reason})`, details);
  }

  /** Creates a PENDING approval request for a blocked execution. */
  async request(input: {
    tool: ToolDefinition;
    context: ExecutionContext;
    reason: string;
  }): Promise<ApprovalRecord> {
    const record = await this.store.create({
      toolId: input.tool.id,
      riskLevel: input.tool.riskLevel,
      requestedByUserId: input.context.actor.userId,
      requestedForUserId: input.context.actor.userId,
      requestReason: input.reason,
      jobId: input.context.jobId,
      runId: input.context.runId,
      metadata: { correlationId: input.context.correlationId, source: input.context.source },
    });
    return record;
  }

  /** Nullable read — never throws. Used by the worker when it inspects state. */
  find(approvalId: ApprovalId | undefined): Promise<ApprovalRecord | null> {
    if (!approvalId) return Promise.resolve(null);
    return this.store.get(approvalId);
  }

  /** @throws APPROVAL_NOT_FOUND */
  async get(approvalId: ApprovalId): Promise<ApprovalRecord> {
    const record = await this.store.get(approvalId);
    if (!record) {
      throw new AiWorkforceError("APPROVAL_NOT_FOUND", `Approval "${approvalId}" does not exist`, { approvalId });
    }
    return record;
  }

  /** Records a human decision. Compare-and-set: only one decision can win. */
  decide(input: DecideApprovalInput): Promise<ApprovalRecord> {
    return this.store.decide(input);
  }

  list(limit?: number): Promise<ApprovalRecord[]> {
    return this.store.list(limit);
  }

  listPending(limit?: number): Promise<ApprovalRecord[]> {
    return this.store.listPending(limit);
  }

  listForJob(jobId: string, limit?: number): Promise<ApprovalRecord[]> {
    return this.store.listForJob(jobId, limit);
  }
}
