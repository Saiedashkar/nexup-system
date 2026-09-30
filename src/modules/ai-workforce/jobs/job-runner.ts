import { AiWorkforceError, isAiWorkforceError, type AiWorkforceErrorCode } from "../core/errors";
import type { Clock, IdFactory } from "../core/types";
import type { ExecutionContext } from "../core/execution-context";
import { fromContextSnapshot, toContextSnapshot, type ExecutionContextSnapshot } from "../core/context-snapshot";
import type { RunRecorder } from "../audit/run-recorder";
import type { ApprovalGate } from "../approvals/approval-gate";
import type { RuntimeAdapter } from "../runtime/runtime-adapter";
import type { Job, JobOutcome, JobRequest, JobStatus } from "./job-contracts";
import type { JobRepository } from "./job-repository";
import { applyTransition, isTerminal } from "./job-state-machine";

/**
 * Job runner.
 *
 * Owns the lifecycle of a job and is the only place that advances job state:
 *
 *   Human / UI / Event → Job → Runtime → Capability Lookup → Policy Check
 *   → Approval Gate → Tool Execution → Result → Audit / Run Record
 *
 * PHASE 1B: the runner is STATELESS. Jobs, runs, approvals and audit events
 * all live behind repositories, so a job survives a restart, a cold start, or
 * a different serverless instance — and, more importantly, so the runner can
 * no longer "remember" a job that the database has already advanced.
 *
 * IDEMPOTENCY. Every state change is a compare-and-set (`update(job, [from])`)
 * against the status that was read. Consequences:
 *
 *   - two concurrent resumes: exactly one wins the transition, the other gets
 *     JOB_CONCURRENT_UPDATE and never reaches the tool;
 *   - a retried request after a successful run: the job is terminal, so
 *     JOB_ALREADY_FINISHED is raised instead of re-executing;
 *   - a double-clicked Approve button: the approval compare-and-set refuses
 *     the second decision.
 */

export type JobRunnerDeps = {
  runtime: RuntimeAdapter;
  recorder: RunRecorder;
  approvals: ApprovalGate;
  jobs: JobRepository;
  ids: IdFactory;
  now: Clock;
};

/** Statuses that mean "this job got past whatever blocked it" — a stale error
 *  from a parked/failed attempt must not survive them. */
const CLEARS_ERROR: readonly JobStatus[] = ["PLANNED", "READY", "RUNNING", "COMPLETED"];

export type RunOptions = {
  /** Replacement context — used to resume a job with a live session. */
  context?: ExecutionContext;
  /** Resume with this approval attached (policies are re-checked). */
  approvalId?: string;
};

export class JobRunner {
  constructor(private readonly deps: JobRunnerDeps) {}

  /* ═══════════════════════════════════════════════════
     Creation
     ═══════════════════════════════════════════════════ */

  async create(request: JobRequest): Promise<Job> {
    const at = this.deps.now().toISOString();
    const id = this.deps.ids.next("job");

    const job: Job = {
      id,
      status: "CREATED",
      trigger: request.context.source,
      autonomy: request.context.autonomy,
      capability: request.capability,
      input: request.input ?? {},
      actorUserId: request.context.actor.userId,
      businessId: request.context.business?.id,
      correlationId: request.context.correlationId,
      createdAt: at,
      updatedAt: at,
      history: [],
      contextSnapshot: toContextSnapshot({ ...request.context, jobId: id }),
    };

    const stored = await this.deps.jobs.insert(job);

    await this.deps.recorder.record({
      type: "job.created",
      jobId: id,
      actorUserId: job.actorUserId,
      businessId: job.businessId,
      correlationId: job.correlationId,
      payload: { capability: job.capability, trigger: job.trigger, autonomy: job.autonomy },
    });

    return stored;
  }

  /* ═══════════════════════════════════════════════════
     Execution
     ═══════════════════════════════════════════════════ */

  async run(jobId: string, options: RunOptions = {}): Promise<JobOutcome> {
    let job = await this.requireJob(jobId);

    if (isTerminal(job.status)) {
      throw new AiWorkforceError("JOB_ALREADY_FINISHED", `Job "${jobId}" already finished as ${job.status}`, {
        jobId,
        status: job.status,
      });
    }

    // A job that is already RUNNING has an execution in flight. Refusing here —
    // before the capability is resolved and long before the handler runs — is
    // what keeps a concurrent resume from executing a write capability twice.
    if (job.status === "RUNNING") {
      throw new AiWorkforceError("JOB_CONCURRENT_UPDATE", `Job "${jobId}" is already running`, {
        jobId,
        status: job.status,
      });
    }

    const context = this.resolveContext(job, options);

    /* ── 1. Plan: resolve the capability and check the request ── */
    const preflight = await this.deps.runtime.preflight({ capability: job.capability, input: job.input, context });

    if (job.status === "CREATED") {
      job = await this.maybeTransition(job, "PLANNED", "capability resolved and request validated");
    }
    if (preflight.tool && job.resolvedToolId !== preflight.tool.id) {
      job = await this.save({ ...job, resolvedToolId: preflight.tool.id }, [job.status]);
    }

    /* ── 2. Nothing can run — report why ────────────────── */
    if (preflight.blocked) {
      const code = preflight.blockedCode ?? "TOOL_EXECUTION_FAILED";
      const message = preflight.blockedMessage ?? "Execution blocked";

      const approvalBlocked =
        code === "APPROVAL_REQUIRED" || code === "APPROVAL_REJECTED" || code === "CRITICAL_AUTONOMY_FORBIDDEN";

      if (approvalBlocked) {
        // CRITICAL under AGENT autonomy can never be approved — it is refused.
        if (code === "CRITICAL_AUTONOMY_FORBIDDEN" || code === "APPROVAL_REJECTED") {
          job = await this.maybeTransition(job, "BLOCKED", code);
        } else {
          job = await this.maybeTransition(job, "WAITING_APPROVAL", "approval policy requires a human decision");
          if (preflight.tool) {
            // One PENDING request per job. Re-running a parked job must not
            // mint a second approval request — the first one is still the
            // decision being waited on.
            const existing = await this.deps.approvals.find(job.approvalId);
            if (existing && existing.status === "PENDING") {
              job = await this.save({ ...job, approvalId: existing.id }, [job.status]);
            } else {
              const approval = await this.deps.approvals.request({
                tool: preflight.tool,
                context,
                reason: "Approval policy requires a human decision before execution",
              });
              job = await this.save(
                { ...job, approvalId: approval.id, approvalReason: approval.requestReason },
                [job.status],
              );
              await this.deps.recorder.record({
                type: "approval.requested",
                jobId,
                toolId: preflight.tool.id,
                actorUserId: job.actorUserId,
                businessId: job.businessId,
                correlationId: job.correlationId,
                payload: { approvalId: approval.id, riskLevel: approval.riskLevel },
              });
            }
          }
        }
      } else {
        job = await this.maybeTransition(job, "BLOCKED", `${code}: ${message}`);
      }

      job = await this.save({ ...job, error: { code, message } }, [job.status]);
      return { job, run: null, status: job.status, error: { code, message } };
    }

    /* ── 3. Ready to execute ──────────────────────────────
       A previously BLOCKED job re-enters planning before it may run again. */
    if (job.status === "BLOCKED") {
      job = await this.maybeTransition(job, "PLANNED", "re-planned after unblock");
    }
    if (job.status === "WAITING_APPROVAL") {
      job = await this.maybeTransition(job, "READY", "approval satisfied");
    }
    if (job.status === "PLANNED" || job.status === "WAITING_HUMAN") {
      job = await this.maybeTransition(job, "READY", "ready to execute");
    }
    // This transition is the execution CLAIM: it only lands for one runner.
    job = await this.maybeTransition(job, "RUNNING", "handing to runtime");

    try {
      const result = await this.deps.runtime.execute({ capability: job.capability, input: job.input, context });
      const finished = await this.maybeTransition(job, "COMPLETED", "tool executed successfully");
      const completed: Job = await this.save({ ...finished, runId: result.run?.id }, [finished.status]);

      return { job: completed, run: result.run, status: completed.status, output: result.output };
    } catch (error) {
      const payload = isAiWorkforceError(error)
        ? error.toJSON()
        : { code: "TOOL_EXECUTION_FAILED" as AiWorkforceErrorCode, message: error instanceof Error ? error.message : String(error) };

      const current = await this.deps.jobs.get(jobId);
      const from = current?.status ?? job.status;

      const target: JobStatus =
        payload.code === "APPROVAL_REQUIRED"
          ? "WAITING_APPROVAL"
          : payload.code === "APPROVAL_REJECTED" || payload.code === "CRITICAL_AUTONOMY_FORBIDDEN"
            ? "BLOCKED"
            : payload.code === "PERMISSION_DENIED" || payload.code === "SCOPE_DENIED" || payload.code === "SCOPE_MISSING"
              ? "BLOCKED"
              : "FAILED";

      const base = current ?? job;
      const failed = await this.maybeTransition({ ...base, status: from }, target, `${payload.code}: ${payload.message}`);
      const finished: Job = await this.save(
        {
          ...failed,
          error: { code: payload.code, message: payload.message },
          runId: (payload.details?.runId as string | undefined) ?? failed.runId,
        },
        [failed.status],
      );

      return { job: finished, run: null, status: finished.status, error: payload };
    }
  }

  /* ═══════════════════════════════════════════════════
     Accessors + transitions
     ═══════════════════════════════════════════════════ */

  /** @throws JOB_NOT_FOUND */
  async requireJob(jobId: string): Promise<Job> {
    const job = await this.deps.jobs.get(jobId);
    if (!job) {
      throw new AiWorkforceError("JOB_NOT_FOUND", `Job "${jobId}" does not exist`, { jobId });
    }
    return job;
  }

  getJob(jobId: string): Promise<Job | null> {
    return this.deps.jobs.get(jobId);
  }

  /** The stored execution context, rebuilt from the job's snapshot. */
  async getContext(jobId: string): Promise<ExecutionContext | null> {
    const job = await this.deps.jobs.get(jobId);
    if (!job?.contextSnapshot) return null;
    return fromContextSnapshot(job.contextSnapshot, { jobId });
  }

  listJobs(limit = 50): Promise<Job[]> {
    return this.deps.jobs.list(limit);
  }

  /** Cancels a job that has not reached a terminal state. */
  async cancel(jobId: string, reason = "cancelled by request"): Promise<Job> {
    const job = await this.requireJob(jobId);
    return this.maybeTransition(job, "CANCELLED", reason);
  }

  /**
   * Parks a job that must not proceed (a rejected approval).
   * BLOCKED is deliberately not terminal: an operator can re-plan it.
   */
  async block(jobId: string, reason: string): Promise<Job> {
    const job = await this.requireJob(jobId);
    if (job.status === "BLOCKED") return job;
    if (isTerminal(job.status)) return job;
    return this.maybeTransition(job, "BLOCKED", reason);
  }

  /* ═══════════════════════════════════════════════════
     Internals
     ═══════════════════════════════════════════════════ */

  private resolveContext(job: Job, options: RunOptions): ExecutionContext {
    const snapshot: ExecutionContextSnapshot | undefined = job.contextSnapshot;
    let context: ExecutionContext;

    if (options.context) {
      context = options.context;
    } else if (snapshot) {
      context = fromContextSnapshot(snapshot);
    } else {
      throw new AiWorkforceError("JOB_CONTEXT_MISSING", `Job "${job.id}" has no execution context to resume from`, {
        jobId: job.id,
      });
    }

    context = { ...context, jobId: job.id };
    // The approval already attached to the job travels with every resume: a
    // rejected approval is therefore enforced by the policy even if a caller
    // forgets to pass it again.
    const approvalId = options.approvalId ?? job.approvalId;
    if (approvalId) context = { ...context, approvalId };
    return context;
  }

  /** Compare-and-set write. Losing the race is a hard error, never a retry. */
  private async save(job: Job, expected: JobStatus[]): Promise<Job> {
    const stored = await this.deps.jobs.update(job, expected);
    if (stored) return stored;

    const current = await this.deps.jobs.get(job.id);
    throw new AiWorkforceError(
      "JOB_CONCURRENT_UPDATE",
      `Job "${job.id}" was advanced by another execution (expected ${expected.join("|")}, found ${current?.status ?? "MISSING"})`,
      { jobId: job.id, expected, currentStatus: current?.status ?? null },
    );
  }

  /** Transition only when the job is not already in the target status. */
  private async maybeTransition(job: Job, to: JobStatus, reason: string): Promise<Job> {
    if (job.status === to) return job;
    return this.transition(job, to, reason);
  }

  private async transition(job: Job, to: JobStatus, reason: string): Promise<Job> {
    const at = this.deps.now().toISOString();
    const applied = applyTransition(job, to, reason, at); // throws INVALID_JOB_TRANSITION
    // Moving forward clears a previous blocker's error; the reason stays in the
    // transition history and in the append-only audit trail either way.
    const next: Job = CLEARS_ERROR.includes(to) ? { ...applied, error: undefined } : applied;
    const stored = await this.save(next, [job.status]);

    await this.deps.recorder.record({
      type: "job.transitioned",
      jobId: stored.id,
      toolId: stored.resolvedToolId,
      actorUserId: stored.actorUserId,
      businessId: stored.businessId,
      correlationId: stored.correlationId,
      payload: { from: job.status, to, reason, at },
      at,
    });

    return stored;
  }
}
