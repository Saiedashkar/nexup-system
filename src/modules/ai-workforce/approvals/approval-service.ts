import { AiWorkforceError, isAiWorkforceError } from "../core/errors";
import type { Clock, IdFactory } from "../core/types";
import type { ActorContext } from "../core/execution-context";
import type { RunRecorder } from "../audit/run-recorder";
import type { ApprovalGate } from "./approval-gate";
import type { ApprovalRecord } from "./approval-repository";
import type { JobRunner } from "../jobs/job-runner";
import type { Job, JobOutcome } from "../jobs/job-contracts";
import { isTerminal } from "../jobs/job-state-machine";
import { isMoneyDomain } from "../policies/money-safety";
import type { ToolDefinition } from "../registry/tool-definition";
import type { ToolRegistry } from "../registry/tool-registry";

/**
 * Approval service — the human half of the control core.
 *
 * Turns a PENDING approval record into a decision, then closes the loop:
 *
 *   APPROVE → validate actor → record decision → resume the SAME job
 *           → re-check policy → execute ONCE → persist result → audit
 *   REJECT  → validate actor → record decision → block the job
 *           → the tool is NEVER executed → audit
 *
 * AUTHORISATION. An approval is not a free pass: the approver must already be
 * able to run the capability themselves, because approving something you could
 * not execute is not a control — it is a loophole. Rights come from the legacy
 * session (never re-implemented here), mirrored into permission tokens by
 * `policies/permission-policy.ts`.
 *
 * IDEMPOTENCY. The decision is a compare-and-set on PENDING inside the
 * repository, so the second click of an Approve button cannot authorise a
 * second execution — it can only observe the first one.
 */

export type ApprovalEligibility = {
  allowed: boolean;
  /** Tokens the actor is missing for this capability. */
  missing: string[];
  reason?: "MODULE_DISABLED" | "MISSING_TOKENS" | "MONEY_APPROVAL_REQUIRED" | "SEPARATION_OF_DUTIES";
  detail?: string;
};

export type ApprovalDecisionResult = {
  approval: ApprovalRecord;
  /** The job after the decision (null when the approval is not tied to a job). */
  job: Job | null;
  /** Present only when the decision actually drove an execution. */
  outcome: JobOutcome | null;
  /** True when the decision already existed and nothing new was executed. */
  idempotent: boolean;
};

export type ApprovalServiceDeps = {
  approvals: ApprovalGate;
  jobs: JobRunner;
  registry: ToolRegistry;
  recorder: RunRecorder;
  ids: IdFactory;
  now: Clock;
  /**
   * Separation of duties. OFF by default: this is a single-owner office, and a
   * mandatory second approver would deadlock every HIGH-risk job. Turn it on
   * when the workforce starts acting autonomously at scale.
   */
  requireDistinctApprover?: boolean;
};

export class ApprovalService {
  constructor(private readonly deps: ApprovalServiceDeps) {}

  /* ═══════════════════════════════════════════════════
     Reads
     ═══════════════════════════════════════════════════ */

  list(limit?: number): Promise<ApprovalRecord[]> {
    return this.deps.approvals.list(limit);
  }

  listPending(limit?: number): Promise<ApprovalRecord[]> {
    return this.deps.approvals.listPending(limit);
  }

  listForJob(jobId: string, limit?: number): Promise<ApprovalRecord[]> {
    return this.deps.approvals.listForJob(jobId, limit);
  }

  get(approvalId: string): Promise<ApprovalRecord> {
    return this.deps.approvals.get(approvalId);
  }

  /* ═══════════════════════════════════════════════════
     Eligibility (no side effects — used by the UI too)
     ═══════════════════════════════════════════════════ */

  evaluateEligibility(approval: ApprovalRecord, actor: ActorContext): ApprovalEligibility {
    const tool = this.deps.registry.getDefinition(approval.toolId);

    if (!actor.permissionTokens.includes("aiworkforce.access")) {
      return {
        allowed: false,
        missing: ["aiworkforce.access"],
        reason: "MODULE_DISABLED",
        detail: "Actor has no access to the AI Workforce module",
      };
    }

    const missing = (tool?.requiredPermissions ?? []).filter(
      (token) => !actor.permissionTokens.includes(token),
    );
    if (missing.length > 0) {
      return {
        allowed: false,
        missing,
        reason: "MISSING_TOKENS",
        detail: `Approving "${approval.toolId}" requires the permissions that capability needs`,
      };
    }

    // A money-writing capability needs an explicit money-approval right.
    const moneyWrite = !!tool && isMoneyDomain(tool.domain) && tool.readWriteMode === "WRITE";
    if (moneyWrite && !actor.permissionTokens.includes("capital.approve")) {
      return {
        allowed: false,
        missing: ["capital.approve"],
        reason: "MONEY_APPROVAL_REQUIRED",
        detail: "A money-writing capability needs the capital.approve right",
      };
    }

    if (this.deps.requireDistinctApprover && approval.requestedByUserId === actor.userId) {
      return {
        allowed: false,
        missing: [],
        reason: "SEPARATION_OF_DUTIES",
        detail: "The requester may not approve their own job while separation of duties is enabled",
      };
    }

    return { allowed: true, missing: [] };
  }

  /** @throws APPROVAL_NOT_FOUND | APPROVAL_FORBIDDEN | TOOL_NOT_FOUND */
  async assertCanDecide(approvalId: string, actor: ActorContext): Promise<ApprovalRecord> {
    const approval = await this.deps.approvals.get(approvalId);

    if (!this.deps.registry.has(approval.toolId)) {
      throw new AiWorkforceError(
        "TOOL_NOT_FOUND",
        `Capability "${approval.toolId}" is no longer registered — the approval cannot be honoured`,
        { approvalId, toolId: approval.toolId },
      );
    }

    const eligibility = this.evaluateEligibility(approval, actor);
    if (!eligibility.allowed) {
      throw new AiWorkforceError("APPROVAL_FORBIDDEN", eligibility.detail ?? "Actor may not decide this approval", {
        approvalId,
        toolId: approval.toolId,
        reason: eligibility.reason ?? "MISSING_TOKENS",
        missing: eligibility.missing,
      });
    }

    return approval;
  }

  /* ═══════════════════════════════════════════════════
     Decisions
     ═══════════════════════════════════════════════════ */

  async approve(input: { approvalId: string; actor: ActorContext; reason?: string }): Promise<ApprovalDecisionResult> {
    const approval = await this.assertCanDecide(input.approvalId, input.actor);
    const tool = this.deps.registry.getDefinition(approval.toolId) as ToolDefinition;

    let decided: ApprovalRecord;
    let idempotent = false;

    try {
      decided = await this.deps.approvals.decide({
        approvalId: approval.id,
        decision: "APPROVED",
        byUserId: input.actor.userId,
        reason: input.reason,
      });

      await this.deps.recorder.record({
        type: "approval.decided",
        jobId: decided.jobId,
        toolId: decided.toolId,
        actorUserId: input.actor.userId,
        businessId: approval.metadata?.businessId as string | undefined,
        correlationId: approval.metadata?.correlationId as string | undefined,
        payload: {
          approvalId: decided.id,
          decision: "APPROVED",
          riskLevel: decided.riskLevel,
          reason: input.reason ?? null,
          requestedByUserId: decided.requestedByUserId,
          requestedForUserId: decided.requestedForUserId,
        },
      });
    } catch (error) {
      // A retried / double-clicked approval: the decision already exists.
      if (!isAiWorkforceError(error) || error.code !== "APPROVAL_ALREADY_DECIDED") throw error;

      decided = await this.deps.approvals.get(approval.id);
      if (decided.status !== "APPROVED") {
        throw new AiWorkforceError(
          "APPROVAL_ALREADY_DECIDED",
          `Approval "${approval.id}" was already decided (${decided.status})`,
          { approvalId: approval.id, status: decided.status },
        );
      }
      idempotent = true;
    }

    /* ── Resume the SAME job, with the approval attached ──

       The call that RECORDED the decision owns the resume. A call that merely
       observed an existing decision never drives execution: that is what makes
       "one approval = at most one execution" true by construction rather than
       by timing. (If a decision is ever recorded and the resume then fails, the
       job stays resumable through the explicit `POST /jobs/:id/resume` path —
       recovering work is a worker concern, not a second human click.) */
    let job: Job | null = null;
    let outcome: JobOutcome | null = null;

    if (decided.jobId) {
      job = await this.deps.jobs.getJob(decided.jobId);

      if (!job || isTerminal(job.status)) {
        // Already executed by the winning call — never run it again.
        idempotent = true;
      } else if (idempotent) {
        // Observation only. Reported as-is so the caller sees the truth.
      } else {
        try {
          outcome = await this.deps.jobs.run(decided.jobId, { approvalId: decided.id });
          job = outcome.job;
        } catch (error) {
          // Another runner is already executing this job. Absorb it as an
          // idempotent outcome: a duplicated request must never execute a
          // capability a second time.
          if (
            isAiWorkforceError(error) &&
            (error.code === "JOB_CONCURRENT_UPDATE" || error.code === "JOB_ALREADY_FINISHED")
          ) {
            idempotent = true;
            job = await this.deps.jobs.getJob(decided.jobId);
          } else {
            throw error;
          }
        }
      }
    }

    // `tool` is read for the audit trail above; keeping the reference makes the
    // capability that was authorised explicit in the decision record.
    void tool;

    return { approval: decided, job, outcome, idempotent };
  }

  async reject(input: { approvalId: string; actor: ActorContext; reason?: string }): Promise<ApprovalDecisionResult> {
    const approval = await this.assertCanDecide(input.approvalId, input.actor);

    const decided = await this.deps.approvals.decide({
      approvalId: approval.id,
      decision: "REJECTED",
      byUserId: input.actor.userId,
      reason: input.reason,
    });

    await this.deps.recorder.record({
      type: "approval.denied",
      jobId: decided.jobId,
      toolId: decided.toolId,
      actorUserId: input.actor.userId,
      correlationId: approval.metadata?.correlationId as string | undefined,
      payload: {
        approvalId: decided.id,
        decision: "REJECTED",
        riskLevel: decided.riskLevel,
        reason: input.reason ?? null,
        requestedByUserId: decided.requestedByUserId,
        /** Explicit: a rejected approval must never be read as "not yet decided". */
        toolExecuted: false,
      },
    });

    /* The tool is NOT executed. The job is parked, not deleted. */
    let job: Job | null = null;
    if (decided.jobId) {
      job = await this.deps.jobs.block(decided.jobId, `APPROVAL_REJECTED: approval ${decided.id} was rejected`);
    }

    return { approval: decided, job, outcome: null, idempotent: false };
  }
}
