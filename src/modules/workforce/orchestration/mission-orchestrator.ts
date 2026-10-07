import { AiWorkforceError } from "@/modules/ai-workforce/core/errors";
import type { Clock, IdFactory } from "@/modules/ai-workforce/core/types";
import type { WorkforceDomain } from "../index";
import { AgentRuntimeDispatcher } from "../runtimes/agent-runtime-dispatcher";
import type { Actor } from "../actors/actor-contracts";
import type { ActorRegistry } from "../actors/actor-registry";
import type { ActorAssignmentService } from "../assignments/actor-assignment-service";
import type { Mission, MissionCreateInput, MissionState } from "../missions/mission-contracts";
import type { MissionService } from "../missions/mission-service";
import { requireTask, type TaskRepository } from "../missions/task-repository";
import {
  DEFAULT_MAX_TASK_ATTEMPTS,
  applyTaskTransition,
  assertTaskRegistration,
  canRetry,
  dependenciesMet,
  type MissionTask,
  type MissionTaskCreateInput,
  type TaskState,
} from "../missions/task-contracts";

import type { RuntimeRegistry } from "../runtimes/runtime-registry";
import type { ReviewDecision, ReviewService, TaskReview } from "../review/task-review";
import type { AgentExecutionError } from "../runtimes/agent-runtime";
import type {
  ExecutionRecorder,
  ExecutionRecord,
  ExecutionRecordRepository,
} from "../execution/execution-record";
import type { MissionId, ReviewId, TaskId } from "../core/refs";

/**
 * MissionOrchestrator — the ONE place the lifecycle state is advanced.
 *
 *   Command → Mission → Task → Agent → Capability → Runtime → Execution
 *           → Result → Review → (human) → Mission
 *
 * Every state change in that chain goes through this service. UI components and
 * API routes may READ a snapshot (`snapshot()`), but they never walk the state
 * machine themselves — that is what keeps one truth instead of one per caller.
 *
 * Two deliberate boundaries:
 *
 *   1. It does not authorise anything. The dispatcher still enforces the
 *      capability assignment and the runtime binding; a refusal is surfaced as
 *      a typed outcome, and the task is NOT silently completed.
 *   2. It does not decide the outcome of an agent's work. With the default
 *      review policy a successful execution parks the task in REVIEW and stops
 *      there until a HUMAN decides.
 */

export const REVIEW_POLICY = ["ALWAYS", "NEVER"] as const;
export type ReviewPolicy = (typeof REVIEW_POLICY)[number];

export type MissionOrchestratorDeps = {
  missions: MissionService;
  tasks: TaskRepository;
  dispatcher: AgentRuntimeDispatcher;
  runtime: RuntimeRegistry;
  executions: ExecutionRecorder;
  executionRecords: ExecutionRecordRepository;
  reviews: ReviewService;
  ids: IdFactory;
  now: Clock;
  actors?: ActorRegistry;
  assignments?: ActorAssignmentService;
  /**
   * Whether a successful execution needs a human. ALWAYS is the default and the
   * safe posture at this stage of the platform.
   */
  reviewPolicy?: ReviewPolicy;
  /** The human who must decide, when the mission owner is not a person. */
  defaultReviewerActorId?: string;
};

/** Every mission state has a shortest ALLOWED path from any other state. */
const MISSION_PATHS: Record<MissionState, Partial<Record<MissionState, MissionState[]>>> = {
  DRAFT: {
    PLANNING: ["PLANNING"],
    RUNNING: ["PLANNING", "RUNNING"],
    WAITING: ["PLANNING", "WAITING"],
    COMPLETED: ["PLANNING", "RUNNING", "COMPLETED"],
    FAILED: ["PLANNING", "FAILED"],
    CANCELLED: ["CANCELLED"],
  },
  PLANNING: {
    RUNNING: ["RUNNING"],
    WAITING: ["WAITING"],
    COMPLETED: ["RUNNING", "COMPLETED"],
    FAILED: ["FAILED"],
    CANCELLED: ["CANCELLED"],
  },
  RUNNING: {
    WAITING: ["WAITING"],
    COMPLETED: ["COMPLETED"],
    FAILED: ["FAILED"],
    CANCELLED: ["CANCELLED"],
  },
  WAITING: {
    RUNNING: ["RUNNING"],
    COMPLETED: ["COMPLETED"],
    FAILED: ["FAILED"],
    CANCELLED: ["CANCELLED"],
  },
  COMPLETED: {},
  FAILED: {},
  CANCELLED: {},
};

export type TaskAdvanceOutcome = {
  taskId: TaskId;
  state: TaskState;
  /** Set when the orchestrator refused to move (nothing was executed). */
  blocked?: string;
  executionRecordId?: string;
};

export type MissionAdvanceResult = {
  mission: Mission;
  tasks: MissionTask[];
  /** What this tick changed, so a caller can log it instead of guessing. */
  changes: string[];
  /** The pending reviews a human still has to decide. */
  pendingReviews: TaskReview[];
};

export type MissionSnapshot = {
  mission: Mission;
  tasks: MissionTask[];
  executions: ExecutionRecord[];
  reviews: TaskReview[];
};

export class MissionOrchestrator {
  private readonly reviewPolicy: ReviewPolicy;
  private readonly defaultReviewerActorId?: string;

  constructor(private readonly deps: MissionOrchestratorDeps) {
    this.reviewPolicy = deps.reviewPolicy ?? "ALWAYS";
    if (deps.defaultReviewerActorId) this.defaultReviewerActorId = deps.defaultReviewerActorId;
  }

  /* ═══════════════════════════════════════════════════
     Create + plan
     ═══════════════════════════════════════════════════ */

  /** A mission starts as a DRAFT goal; planning is a separate, recorded step. */
  async createMission(input: MissionCreateInput): Promise<Mission> {
    return this.deps.missions.create(input);
  }

  /**
   * Registers the mission's tasks, attaches them and moves the mission into
   * PLANNING. Dependencies are honoured: a task whose dependencies are unmet
   * stays PENDING rather than being dispatched early.
   */
  async plan(missionId: MissionId, inputs: readonly MissionTaskCreateInput[]): Promise<MissionAdvanceResult> {
    const mission = await this.deps.missions.require(missionId);
    if (inputs.length === 0) {
      throw new AiWorkforceError("INVALID_MISSION", "A plan needs at least one task", { missionId });
    }
    if (mission.state !== "DRAFT" && mission.state !== "PLANNING") {
      throw new AiWorkforceError("INVALID_MISSION_TRANSITION", `Mission "${missionId}" is ${mission.state}; plans are added while DRAFT or PLANNING`, {
        missionId,
        state: mission.state,
      });
    }
    if (mission.state === "DRAFT") await this.deps.missions.transition(missionId, "PLANNING", "plan");

    const existing = await this.deps.tasks.listForMission(missionId);
    const byKey = new Map(existing.map((task) => [task.title, task.id]));

    let sequence = existing.length;
    for (const input of inputs) {
      sequence += 1;
      assertTaskRegistration({ ...input, missionId });
      const resolvedDeps = (input.dependsOn ?? []).map((ref) => byKey.get(ref) ?? ref);
      const at = this.deps.now().toISOString();
      const task: MissionTask = {
        id: this.deps.ids.next("task"),
        missionId,
        sequence: input.sequence ?? sequence,
        title: input.title,
        objective: input.objective,
        input: input.input ?? {},
        assignedActorId: input.assignedActorId ?? null,
        requiredCapabilityId: input.requiredCapabilityId ?? null,
        dependsOn: resolvedDeps,
        state: "PENDING",
        attempt: 0,
        maxAttempts: input.maxAttempts ?? DEFAULT_MAX_TASK_ATTEMPTS,
        history: [{ from: null, to: "PENDING", at, reason: "planned" }],
        createdAt: at,
        updatedAt: at,
      };
      if (input.requiredCapabilityVersion) task.requiredCapabilityVersion = input.requiredCapabilityVersion;
      const stored = await this.deps.tasks.insert(task);
      byKey.set(input.title, stored.id);
      await this.deps.missions.attachTask(missionId, stored.id);
    }

    return this.advance(missionId);
  }

  /* ═══════════════════════════════════════════════════
     The stepper
     ═══════════════════════════════════════════════════ */

  /**
   * Advances the mission by AT MOST one execution per call: promote what is
   * dispatchable, start the next task, then let the mission state follow the
   * tasks. Safe to call repeatedly — it is a reconciliation, not a script.
   *
   * `startNext: false` reconciles the MISSION state without dispatching
   * anything. Settling a task uses it, so a retryable failure becomes a READY
   * task the caller chooses to act on rather than an automatic second run —
   * with a real provider, an automatic retry costs a real turn.
   */
  async advance(missionId: MissionId, options: { startNext?: boolean } = {}): Promise<MissionAdvanceResult> {
    const changes: string[] = [];
    let mission = await this.deps.missions.require(missionId);
    if (isTerminalMissionState(mission.state)) {
      const tasksAtRest = await this.deps.tasks.listForMission(missionId);
      return { mission, tasks: tasksAtRest, changes, pendingReviews: await this.deps.reviews.listPending() };
    }

    if (mission.state === "DRAFT") {
      mission = await this.deps.missions.transition(missionId, "PLANNING", "advance");
      changes.push("mission:PLANNING");
    }

    let tasks = await this.deps.tasks.listForMission(missionId);
    if (tasks.length === 0) {
      return { mission, tasks, changes, pendingReviews: await this.deps.reviews.listPending() };
    }

    // 1. Promote what became dispatchable.
    for (const task of tasks) {
      if (task.state !== "PENDING") continue;
      if (!dependenciesMet(task, tasks)) continue;
      if (!task.assignedActorId || !task.requiredCapabilityId) continue;
      const moved = await this.moveTask(task, "READY", "dependencies met and actor+capability assigned");
      changes.push(`task:${task.id}:READY`);
      tasks = replaceTask(tasks, moved);
    }

    // 2. Start the next dispatchable task when nothing is running.
    const running = tasks.find((task) => task.state === "RUNNING");
    if (!running && options.startNext !== false) {
      const next = tasks.find((task) => task.state === "READY" && dependenciesMet(task, tasks));
      if (next) {
        const outcome = await this.startTask(missionId, next.id);
        changes.push(`task:${next.id}:${outcome.state}`);
        tasks = await this.deps.tasks.listForMission(missionId);
      }
    }

    // 3. Let the mission state follow the tasks.
    const before = mission.state;
    mission = await this.syncMissionState(mission, tasks);
    if (mission.state !== before) changes.push(`mission:${mission.state}`);

    mission = await this.deps.missions.require(missionId);
    tasks = await this.deps.tasks.listForMission(missionId);
    return { mission, tasks, changes, pendingReviews: await this.deps.reviews.listPending() };
  }

  /* ═══════════════════════════════════════════════════
     Dispatch one task
     ═══════════════════════════════════════════════════ */

  /**
   * Hands one READY task to its actor's runtime and opens its execution record.
   * Refusals are reported as a BLOCKED outcome: the task is not completed, not
   * failed, and not silently retried.
   */
  async startTask(missionId: MissionId, taskId: TaskId): Promise<TaskAdvanceOutcome> {
    await this.deps.missions.require(missionId);
    const task = await requireTask(this.deps.tasks, taskId);
    if (task.missionId !== missionId) {
      throw new AiWorkforceError("MISSION_NOT_FOUND", `Task "${taskId}" does not belong to mission "${missionId}"`, {
        taskId,
        missionId,
      });
    }
    if (task.state !== "READY") {
      throw new AiWorkforceError("INVALID_MISSION_TRANSITION", `Task "${taskId}" is ${task.state}; only a READY task can start`, {
        taskId,
        state: task.state,
      });
    }
    if (!task.assignedActorId || !task.requiredCapabilityId) {
      throw new AiWorkforceError("INVALID_MISSION", `Task "${taskId}" has no assigned actor or capability`, { taskId });
    }

    const actor = this.deps.actors ? await this.deps.actors.require(task.assignedActorId) : null;
    if (this.deps.actors && !actor) {
      return { taskId, state: task.state, blocked: `actor "${task.assignedActorId}" is not registered` };
    }
    const runtime = actor ? this.deps.runtime.runtimeForActor(actor) : null;
    if (!runtime) {
      return { taskId, state: task.state, blocked: `actor "${task.assignedActorId}" has no usable runtime` };
    }
    if (this.deps.assignments && !this.deps.assignments.hasCapability(task.assignedActorId, task.requiredCapabilityId, task.requiredCapabilityVersion)) {
      return {
        taskId,
        state: task.state,
        blocked: `actor "${task.assignedActorId}" is not assigned capability "${task.requiredCapabilityId}"`,
      };
    }

    const attempt = task.attempt + 1;
    const idempotencyKey = `task:${task.id}:attempt:${attempt}`;

    const started = await this.deps.dispatcher.startJob({
      actorId: task.assignedActorId,
      runtimeId: runtime.identity.id,
      capabilityId: task.requiredCapabilityId,
      capabilityVersion: task.requiredCapabilityVersion,
      missionId,
      jobId: task.id,
      idempotencyKey,
      traceId: `mission:${missionId}:task:${task.id}:attempt:${attempt}`,
      input: task.input,
    });

    if (!started.dispatched || !started.handle) {
      return {
        taskId,
        state: task.state,
        blocked: started.error?.message ?? started.reason ?? "runtime refused the dispatch",
      };
    }

    const execution = await this.deps.executions.open({
      handleId: started.handle.handleId,
      runtimeId: runtime.identity.id,
      actorId: task.assignedActorId,
      capabilityId: task.requiredCapabilityId,
      attempt,
      idempotencyKey,
      missionId,
      taskId: task.id,
      status: started.status ?? started.handle.status,
      replayed: started.execution?.replayed ?? false,
      ...(task.requiredCapabilityVersion ? { capabilityVersion: task.requiredCapabilityVersion } : {}),
    });

    const running: MissionTask = {
      ...applyTaskTransition(task, "RUNNING", `dispatch attempt ${attempt}`, this.deps.now().toISOString()),
      attempt,
      executionRecordId: execution.id,
      executionHandleId: started.handle.handleId,
    };
    // A NEW attempt clears the previous attempt's failure.
    delete running.error;
    const stored = await this.deps.tasks.update(running, [task.state]);
    if (!stored) {
      throw new AiWorkforceError("MISSION_CONFLICT", `Task "${taskId}" changed while it was being started`, { taskId });
    }
    return { taskId, state: stored.state, executionRecordId: execution.id };
  }

  /* ═══════════════════════════════════════════════════
     Settle one task
     ═══════════════════════════════════════════════════ */

  /**
   * Waits for the task's execution through the runtime port, records what the
   * runtime reported, and moves the task accordingly:
   *
   *   SUCCEEDED → REVIEW (a human must accept it)   or COMPLETED when review is off
   *   FAILED    → READY again while attempts remain, else FAILED
   *   CANCELLED → CANCELLED
   */
  async settleTask(
    missionId: MissionId,
    taskId: TaskId,
    options: { waitTimeoutMs?: number } = {},
  ): Promise<TaskAdvanceOutcome> {
    const task = await requireTask(this.deps.tasks, taskId);
    if (task.state !== "RUNNING" || !task.executionHandleId || !task.executionRecordId) {
      throw new AiWorkforceError("INVALID_MISSION_TRANSITION", `Task "${taskId}" is not running`, { taskId, state: task.state });
    }
    const record = await this.deps.executionRecords.get(task.executionRecordId);
    if (!record) {
      throw new AiWorkforceError("RUN_NOT_FOUND", `Task "${taskId}" has no execution record`, { taskId });
    }

    const outcome = await this.deps.dispatcher.waitForExecution(
      { runtimeId: record.runtimeId, handleId: task.executionHandleId },
      options.waitTimeoutMs ? { timeoutMs: options.waitTimeoutMs } : undefined,
    );
    if (!outcome.dispatched && outcome.error) {
      throw new AiWorkforceError("RUNTIME_UNAVAILABLE", outcome.error.message, { taskId, code: outcome.error.code });
    }

    const execution = await this.deps.executions.apply(record.id, {
      status: outcome.status ?? "UNKNOWN",
      ...(outcome.execution?.providerExecutionId ? { providerExecutionId: outcome.execution.providerExecutionId } : {}),
      ...(outcome.execution?.completedAt ? { completedAt: outcome.execution.completedAt } : {}),
      ...(outcome.execution?.durationMs !== undefined ? { durationMs: outcome.execution.durationMs } : {}),
      ...(outcome.output !== undefined ? { output: outcome.output } : {}),
      ...(outcome.execution?.outputText !== undefined ? { outputText: outcome.execution.outputText } : {}),
      ...(outcome.execution?.error ? { error: outcome.execution.error } : {}),
    });

    if (execution.status === "SUCCEEDED") {
      if (this.reviewPolicy === "NEVER") {
        await this.moveTask(task, "COMPLETED", "execution succeeded; review not required");
      } else {
        await this.parkForReview(task, missionId, execution.id);
      }
    } else if (execution.status === "CANCELLED") {
      await this.moveTask(task, "CANCELLED", "execution was cancelled");
    } else if (execution.status === "FAILED") {
      const retryable = execution.error?.retryable ?? false;
      if (retryable && canRetry(task)) {
        // Record the failure HONESTLY, then take the retry edge back to READY.
        // Reaching READY does not start anything: a retry is a decision the
        // caller makes with `advance()`, because a real retry costs a real run.
        const failed = await this.moveTask(
          task,
          "FAILED",
          `attempt ${task.attempt} failed (retryable)`,
          toTaskError(execution.error),
        );
        await this.moveTask(failed, "READY", "ready to retry");
      } else {
        await this.moveTask(task, "FAILED", "execution failed", toTaskError(execution.error));
      }
    } else {
      // UNKNOWN / non-terminal: a state the provider did not explain is a HUMAN
      // decision, not one this service may guess.
      await this.moveTask(
        task,
        "REVIEW",
        `provider reported ${execution.status}; a human must decide`,
        toTaskError(execution.error),
      );
    }

    // Reconcile the MISSION state with the tasks, without dispatching anything.
    await this.advance(missionId, { startNext: false });
    const settledTask = await requireTask(this.deps.tasks, taskId);
    return { taskId, state: settledTask.state, executionRecordId: execution.id };
  }

  /* ═══════════════════════════════════════════════════
     Human authority
     ═══════════════════════════════════════════════════ */

  /**
   * Records a human's decision and applies it to the task:
   *   APPROVED        → COMPLETED
   *   REJECTED        → FAILED (the human refused the result)
   *   NEEDS_REVISION  → REVISION → READY (another attempt)
   */
  async decide(
    reviewId: ReviewId,
    input: { decision: ReviewDecision; decidedBy: string; note?: string },
  ): Promise<MissionAdvanceResult> {
    const review = await this.deps.reviews.get(reviewId);
    if (!review) {
      throw new AiWorkforceError("APPROVAL_NOT_FOUND", `Review "${reviewId}" does not exist`, { reviewId });
    }
    await this.deps.reviews.decide(reviewId, input);
    const task = await requireTask(this.deps.tasks, review.taskId);

    if (input.decision === "APPROVED") {
      const withResult: MissionTask = {
        ...task,
        result: {
          executionRecordId: review.executionRecordId,
          reviewId: review.id,
          summary: review.summary,
        },
      };
      await this.writeTask(withResult, [task.state]);
      await this.moveTask(withResult, "COMPLETED", `approved by ${input.decidedBy}`);
    } else if (input.decision === "REJECTED") {
      await this.deps.executions.markRejected(review.executionRecordId, input.note ?? `rejected by ${input.decidedBy}`);
      await this.moveTask(
        task,
        "FAILED",
        `rejected by ${input.decidedBy}`,
        { code: "APPROVAL_REJECTED", message: input.note ?? "a human rejected the result", retryable: false },
      );
    } else {
      const revised = await this.moveTask(task, "REVISION", `revision requested by ${input.decidedBy}`);
      await this.moveTask(revised, "READY", "ready for another attempt");
    }

    return this.advance(review.missionId);
  }

  /* ═══════════════════════════════════════════════════
     Cancellation and read models
     ═══════════════════════════════════════════════════ */

  /**
   * Cancels a mission: every in-flight execution is cancelled THROUGH the
   * runtime port, remaining tasks are cancelled, then the mission is.
   */
  async cancelMission(missionId: MissionId, reason = "cancelled by request"): Promise<MissionAdvanceResult> {
    const mission = await this.deps.missions.require(missionId);
    const tasks = await this.deps.tasks.listForMission(missionId);

    for (const task of tasks) {
      if (task.state === "RUNNING" && task.executionHandleId && task.executionRecordId) {
        const record = await this.deps.executionRecords.get(task.executionRecordId);
        if (record) {
          const cancelled = await this.deps.dispatcher.cancelJob(
            { runtimeId: record.runtimeId, handleId: task.executionHandleId },
            reason,
          );
          if (cancelled.dispatched) await this.deps.executions.markCancelled(record.id, reason);
        }
      }
      if (!isTerminalTaskState(task.state)) {
        await this.moveTask(task, "CANCELLED", reason);
      }
    }

    if (!isTerminalMissionState(mission.state)) {
      await this.deps.missions.cancel(missionId, reason);
    }

    const finalMission = await this.deps.missions.require(missionId);
    return {
      mission: finalMission,
      tasks: await this.deps.tasks.listForMission(missionId),
      changes: [`mission:CANCELLED`],
      pendingReviews: await this.deps.reviews.listPending(),
    };
  }

  /** Everything a UI needs, in one read. It never advances anything. */
  async snapshot(missionId: MissionId): Promise<MissionSnapshot> {
    const mission = await this.deps.missions.require(missionId);
    const tasks = await this.deps.tasks.listForMission(missionId);
    const executions = await this.deps.executionRecords.listForMission(missionId);
    const reviews: TaskReview[] = [];
    for (const task of tasks) reviews.push(...(await this.deps.reviews.forTask(task.id)));
    return { mission, tasks, executions, reviews };
  }

  /* ═══════════════════════════════════════════════════
     Internals
     ═══════════════════════════════════════════════════ */

  private async parkForReview(task: MissionTask, missionId: MissionId, executionRecordId: string): Promise<MissionTask> {
    const mission = await this.deps.missions.require(missionId);
    const reviewer = await this.resolveReviewer(mission);
    const review = await this.deps.reviews.request({
      taskId: task.id,
      missionId,
      executionRecordId,
      summary: `Task "${task.title}" produced a result; ${reviewer ? `${reviewer.displayName} must accept it` : "a human must accept it"}`,
      reviewerActorId: reviewer?.id ?? null,
      requestedBy: task.assignedActorId ?? "orchestrator",
    });

    const inReview: MissionTask = {
      ...applyTaskTransition(task, "REVIEW", "execution succeeded; awaiting human authority", this.deps.now().toISOString()),
      reviewId: review.id,
    };
    const stored = await this.deps.tasks.update(inReview, [task.state]);
    if (!stored) {
      throw new AiWorkforceError("MISSION_CONFLICT", `Task "${task.id}" changed while parking for review`, { taskId: task.id });
    }
    return stored;
  }

  /** The human who must decide: the mission's owner when it is a person. */
  private async resolveReviewer(mission: Mission): Promise<Actor | null> {
    if (this.deps.actors && mission.owner) {
      const owner = await this.deps.actors.get(mission.owner);
      if (owner && owner.type === "HUMAN") return owner;
    }
    if (this.deps.actors && this.defaultReviewerActorId) {
      return this.deps.actors.get(this.defaultReviewerActorId);
    }
    return null;
  }

  private async moveTask(
    task: MissionTask,
    to: TaskState,
    reason: string,
    error?: { code: string; message: string; retryable: boolean },
  ): Promise<MissionTask> {
    const at = this.deps.now().toISOString();
    const applied = applyTaskTransition(task, to, reason, at);
    const next: MissionTask = { ...applied };
    if (error) next.error = error;
    // A task that is READY to retry KEEPS the failure that sent it back — the
    // operator needs to see why. Completing clears it.
    else if (to === "COMPLETED") delete next.error;
    const stored = await this.deps.tasks.update(next, [task.state]);
    if (!stored) {
      throw new AiWorkforceError("MISSION_CONFLICT", `Task "${task.id}" was advanced by another caller`, {
        taskId: task.id,
        from: task.state,
        to,
      });
    }
    return stored;
  }

  private async writeTask(task: MissionTask, expected: TaskState[]): Promise<MissionTask> {
    const stored = await this.deps.tasks.update(task, expected);
    if (!stored) {
      throw new AiWorkforceError("MISSION_CONFLICT", `Task "${task.id}" was advanced by another caller`, { taskId: task.id });
    }
    return stored;
  }

  /** Moves the mission along the shortest ALLOWED path to the state the tasks imply. */
  private async syncMissionState(mission: Mission, tasks: readonly MissionTask[]): Promise<Mission> {
    const states = tasks.map((task) => task.state);
    const anyStarted = tasks.some((task) => task.startedAt);
    const anyRunning = states.some((state) => state === "RUNNING");
    const anyReview = states.some((state) => state === "REVIEW");
    const anyFailed = states.some((state) => state === "FAILED");
    const allDone = states.every((state) => state === "COMPLETED" || state === "CANCELLED");
    const allCancelled = states.every((state) => state === "CANCELLED");

    let target: MissionState | null = null;
    if (allCancelled) target = "CANCELLED";
    else if (allDone) target = "COMPLETED";
    else if (anyFailed) target = "FAILED";
    else if (anyReview) target = "WAITING";
    else if (anyRunning || anyStarted) target = "RUNNING";

    if (!target || target === mission.state) return mission;
    return this.walkTo(mission, target);
  }

  private async walkTo(mission: Mission, target: MissionState): Promise<Mission> {
    const path = MISSION_PATHS[mission.state]?.[target];
    if (!path) {
      // No allowed path (e.g. a terminal mission) — leave it exactly as it is.
      return mission;
    }
    let current = mission;
    for (const step of path) {
      current = await this.deps.missions.transition(current.id, step, `orchestrator:${target}`);
    }
    return current;
  }
}

/**
 * The orchestrator wired from a workforce domain.
 *
 * The dispatcher it uses is the SAME one the rest of the platform uses, so the
 * assignment and runtime-binding rules are not re-implemented here.
 */
export function createMissionOrchestrator(
  domain: WorkforceDomain,
  options: {
    reviewPolicy?: ReviewPolicy;
    defaultReviewerActorId?: string;
    dispatcher?: AgentRuntimeDispatcher;
  } = {},
): MissionOrchestrator {
  const dispatcher =
    options.dispatcher ??
    new AgentRuntimeDispatcher({
      runtimes: domain.runtimes,
      actors: domain.actors,
      assignments: domain.assignments,
    });
  return new MissionOrchestrator({
    missions: domain.missions,
    tasks: domain.tasks,
    dispatcher,
    runtime: domain.runtimes,
    executions: domain.executions,
    executionRecords: domain.executionRecords,
    reviews: domain.reviews,
    ids: domain.ids,
    now: domain.now,
    actors: domain.actors,
    assignments: domain.assignments,
    ...(options.reviewPolicy ? { reviewPolicy: options.reviewPolicy } : {}),
    ...(options.defaultReviewerActorId ? { defaultReviewerActorId: options.defaultReviewerActorId } : {}),
  });
}

/** Maps a runtime error into the task's own error shape. */
function toTaskError(error?: AgentExecutionError): { code: string; message: string; retryable: boolean } | undefined {
  if (!error) return undefined;
  return { code: error.category, message: error.message, retryable: error.retryable };
}

function replaceTask(tasks: readonly MissionTask[], next: MissionTask): MissionTask[] {
  return tasks.map((task) => (task.id === next.id ? next : task));
}

function isTerminalMissionState(state: MissionState): boolean {
  return state === "COMPLETED" || state === "FAILED" || state === "CANCELLED";
}

function isTerminalTaskState(state: TaskState): boolean {
  return state === "COMPLETED" || state === "FAILED" || state === "CANCELLED";
}
