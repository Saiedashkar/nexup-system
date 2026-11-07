import { AiWorkforceError } from "@/modules/ai-workforce/core/errors";
import type { Clock, IdFactory } from "@/modules/ai-workforce/core/types";
import type { CapabilityExecutionService, ExecutionOutcome } from "../execution/capability-execution-contracts";
import type { ExecutionAuthority } from "../execution/execution-authority";
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

import type { ReviewDecision, ReviewService, TaskReview } from "../review/task-review";
import { isTerminalExecutionStatus, type AgentExecutionError } from "../runtimes/agent-runtime";
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
 * Three deliberate boundaries:
 *
 *   1. It does not authorise an EXECUTION. Since Step 5A-4 it holds no runtime,
 *      no dispatcher and no provider adapter: EVERY attempt goes through
 *      `CapabilityExecutionService`, which owns the durable claim, the final
 *      policy preflight and the `DISPATCHING` authorization point. A refusal is
 *      surfaced as a typed outcome, and the task is NOT silently completed.
 *   2. It does not decide the outcome of an agent's work. With the default
 *      review policy a successful execution parks the task in REVIEW and stops
 *      there until a HUMAN decides.
 *   3. It never performs external I/O. After the cutover the orchestrator's only
 *      reachable execution surfaces are `execute`, `observe` and `cancel` on the
 *      execution service, so "the orchestrator called a runtime directly" is no
 *      longer expressible in this file.
 */

export const REVIEW_POLICY = ["ALWAYS", "NEVER"] as const;
export type ReviewPolicy = (typeof REVIEW_POLICY)[number];

export type MissionOrchestratorDeps = {
  missions: MissionService;
  tasks: TaskRepository;
  /**
   * The ONLY way this orchestrator can reach an execution. It replaced the
   * direct `AgentRuntimeDispatcher` dependency in Step 5A-4, which is what makes
   * the claim, the final preflight and the `DISPATCHING` boundary unavoidable
   * rather than merely conventional.
   */
  execution: CapabilityExecutionService;
  /**
   * NOT PRESENT, deliberately: there is no runtime registry, no dispatcher and no
   * provider adapter on this dependency list. Runtime resolution happens inside
   * the execution service at its own final preflight, so the orchestrator has no
   * way to observe a runtime even if it wanted to.
   */
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

/** The authority-carrying options every foreground operation accepts. */
export type ForegroundOptions = {
  /**
   * The server-created authority for this request. REQUIRED for anything that
   * can start a new attempt or reach a runtime (see `assertForegroundAuthority`
   * inside the execution service): a missing authority is a REFUSAL, never an
   * implicit system identity.
   */
  authority?: ExecutionAuthority;
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
  async plan(
    missionId: MissionId,
    inputs: readonly MissionTaskCreateInput[],
    options: ForegroundOptions = {},
  ): Promise<MissionAdvanceResult> {
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

    return this.advance(missionId, options);
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
  async advance(
    missionId: MissionId,
    options: { startNext?: boolean; authority?: ExecutionAuthority } = {},
  ): Promise<MissionAdvanceResult> {
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
        const outcome = await this.startTask(missionId, next.id, {
          ...(options.authority ? { authority: options.authority } : {}),
        });
        // A refusal is REPORTED, never swallowed: an operator staring at a
        // mission that will not progress must be able to read WHY from the same
        // result that told them it did not progress. The task state alone cannot
        // carry it (a blocked task has not moved).
        changes.push(
          outcome.blocked ? `task:${next.id}:BLOCKED:${outcome.blocked}` : `task:${next.id}:${outcome.state}`,
        );
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
   * Hands one READY task to the Capability Execution Service and, only after the
   * attempt is durably DISPATCHED, moves the task to RUNNING.
   *
   * WHAT CHANGED IN 5A-4, and why the order matters:
   *
   *   BEFORE: read task → assert READY → `dispatcher.startJob` (a REAL external
   *           call) → open the execution record → CAS the task.
   *   AFTER:  read task → assert READY → `execution.execute` (claim → final
   *           preflight → committed DISPATCHING → external call → atomic record
   *           + DISPATCHED) → CAS the task.
   *
   * The task CAS is deliberately the LAST step and deliberately NOT inside the
   * execution transaction: a mission's task state is the orchestrator's, and the
   * attempt's durability is the execution service's. If the CAS loses, the
   * durable claim and execution record remain authoritative and adoptable — a
   * retry REPLAYS them (`REPLAYED`) and never starts a second run.
   *
   * Refusals are reported as a BLOCKED outcome: the task is not completed, not
   * failed, and not silently retried.
   */
  async startTask(
    missionId: MissionId,
    taskId: TaskId,
    options: ForegroundOptions = {},
  ): Promise<TaskAdvanceOutcome> {
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
    // ── Foreground authority is REQUIRED to start work. ──
    // Reported as a BLOCKED outcome rather than thrown, so an operator reading an
    // advance result learns WHY a mission did not move instead of receiving a 500.
    if (!options.authority) {
      return {
        taskId,
        state: task.state,
        blocked: "AUTHORITY_UNRESOLVED: starting an execution attempt requires an authenticated request authority",
      };
    }

    const attempt = task.attempt + 1;
    const idempotencyKey = `task:${task.id}:attempt:${attempt}`;

    const outcome = await this.deps.execution.execute({
      missionId,
      taskId: task.id,
      attempt,
      idempotencyKey,
      authority: options.authority,
      assignedActorId: task.assignedActorId,
      requiredCapabilityId: task.requiredCapabilityId,
      ...(task.requiredCapabilityVersion ? { requiredCapabilityVersion: task.requiredCapabilityVersion } : {}),
      input: task.input,
      traceId: `mission:${missionId}:task:${task.id}:attempt:${attempt}`,
      businessScope: null,
      source: "MANUAL",
    });

    if (outcome.kind !== "DISPATCHED" && outcome.kind !== "REPLAYED") {
      return { taskId, state: task.state, blocked: describeExecutionOutcome(outcome) };
    }

    const running: MissionTask = {
      ...applyTaskTransition(task, "RUNNING", `dispatch attempt ${attempt}`, this.deps.now().toISOString()),
      attempt,
      executionRecordId: outcome.executionRecordId,
      executionHandleId: outcome.handleId,
    };
    // A NEW attempt clears the previous attempt's failure.
    delete running.error;
    const stored = await this.deps.tasks.update(running, [task.state]);
    if (!stored) {
      // The attempt IS durably dispatched; only the task row moved under us. That
      // is not a reason to dispatch again — and the caller must not try.
      throw new AiWorkforceError(
        "MISSION_CONFLICT",
        `Task "${taskId}" changed while its attempt was being dispatched; the durable execution record remains authoritative and a retry will re-adopt it`,
        { taskId, executionRecordId: outcome.executionRecordId },
      );
    }
    return { taskId, state: stored.state, executionRecordId: outcome.executionRecordId };
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
    options: { waitTimeoutMs?: number; authority?: ExecutionAuthority } = {},
  ): Promise<TaskAdvanceOutcome> {
    const task = await requireTask(this.deps.tasks, taskId);
    if (task.state !== "RUNNING" || !task.executionHandleId || !task.executionRecordId) {
      throw new AiWorkforceError("INVALID_MISSION_TRANSITION", `Task "${taskId}" is not running`, { taskId, state: task.state });
    }
    const record = await this.deps.executionRecords.get(task.executionRecordId);
    if (!record) {
      throw new AiWorkforceError("RUN_NOT_FOUND", `Task "${taskId}" has no execution record`, { taskId });
    }

    // Ask the runtime FIRST: while it can answer it is the AUTHORITY, and a
    // fresh report can carry a retryable classification the stored record does
    // not. But a restarted process may host a runtime that never minted this
    // handle, and then `waitForExecution` cannot answer at all. In that ONE
    // case, if the durable record is ALREADY TERMINAL, the outcome was still
    // OBSERVED and written down (by this process's dispatch, or by a previous
    // process / the reconciler), so settle from the record instead of failing a
    // mission that has an answer. Nothing is resubmitted, and a NON-terminal
    // record keeps failing loudly — "we cannot verify it" is never turned into
    // success.
    const alreadyDecided = isTerminalExecutionStatus(record.status);
    let execution = record;

    // Observation goes through the GOVERNED abstraction, never to a runtime
    // directly. It never dispatches and never resubmits: `observe` re-adopts the
    // execution from the runtime that knows the handle, or reports honestly that
    // it could not be asked.
    const observation = await this.deps.execution.observe(
      {
        runtimeId: record.runtimeId,
        handleId: task.executionHandleId,
        executionRecordId: record.id,
        missionId,
        taskId,
      },
      // "Settle" means WAIT for the end state, exactly as it did before the
      // cutover: bounded by the runtime's own timeout, or by the caller's
      // `waitTimeoutMs`. Without this, a run that is simply still working would
      // be escalated to a human for the crime of not being finished yet.
      {
        waitForTerminal: true,
        ...(options.waitTimeoutMs ? { waitTimeoutMs: options.waitTimeoutMs } : {}),
      },
    );

    if (observation.kind === "UNAVAILABLE" || observation.kind === "NO_RUNTIME") {
      if (!alreadyDecided) {
        throw new AiWorkforceError("RUNTIME_UNAVAILABLE", observation.detail, { taskId, code: observation.kind });
      }
      // The runtime cannot answer, but the attempt is already decided durably.
    } else if (observation.kind === "UNVERIFIED") {
      // The runtime answered and no longer knows this execution: the run may have
      // succeeded before we lost track of it. That is a HUMAN decision — never a
      // fabricated FAILED and never an automatic retry.
      return this.escalateUnverifiedExecution(missionId, taskId, { detail: observation.detail });
    } else if (observation.kind === "TIMEOUT" && !alreadyDecided) {
      // A BOUNDED WAIT EXPIRING IS NOT AN OUTAGE (Step 5A-4 correction, P1-2).
      //
      // The execution is simply still in flight. Nothing is settled and nothing is
      // parked for review — presenting an unfinished run as a result a human must
      // adjudicate is exactly what the still-running branch below refuses to do.
      // Flattening `RUNTIME_TIMEOUT` into `UNAVAILABLE` used to route this into the
      // throw above, turning "still working" into "the provider is unreachable".
      return {
        taskId,
        state: task.state,
        blocked: `RUNTIME_TIMEOUT: the execution did not reach an end state within the wait; it is still ${observation.status} and nothing was settled`,
      };
    } else {
      execution = await this.deps.executions.apply(record.id, {
        status: observation.status,
        ...(observation.providerExecutionId ? { providerExecutionId: observation.providerExecutionId } : {}),
        // The observation carries the provider's RESULT, and persisting it is
        // what keeps a settled mission reviewable: the review below points at
        // this record, so an output dropped here would hand a human an empty
        // brief. It is written onto the SAME record, in the same patch.
        ...(observation.output !== undefined ? { output: observation.output } : {}),
        ...(observation.outputText !== undefined ? { outputText: observation.outputText } : {}),
        ...(observation.error ? { error: observation.error } : {}),
      });
    }

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
    } else if (execution.status !== "UNKNOWN") {
      // STILL RUNNING (Step 5A-4 correction). The caller asked to WAIT and the
      // bounded wait elapsed without an end state. A still-running execution is
      // NOT a review item: moving it to REVIEW would present an unfinished run
      // as a result a human must adjudicate. Report honestly, settle nothing.
      return {
        taskId,
        state: task.state,
        blocked: `RUNTIME_TIMEOUT: the execution is still ${execution.status}; nothing was settled`,
      };
    } else {
      // UNKNOWN / other non-terminal: a state the provider did not explain is a
      // HUMAN decision, not one this service may guess.
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
     Unverifiable attempts
     ═══════════════════════════════════════════════════ */

  /**
   * Parks a RUNNING task for a HUMAN because its attempt could not be confirmed
   * after a restart (the runtime no longer knows the execution).
   *
   * It deliberately does NOT fail the task and does NOT retry it. Both would be
   * guesses: the run may have finished successfully before we lost track of it,
   * and an automatic retry would then execute the same work a second time. So
   * the task goes to REVIEW with a review row that says exactly what happened,
   * and the decision is a human's — retry (REVISION → READY) or cancel.
   */
  async escalateUnverifiedExecution(
    missionId: MissionId,
    taskId: TaskId,
    input: { detail: string },
  ): Promise<TaskAdvanceOutcome> {
    const task = await requireTask(this.deps.tasks, taskId);
    if (task.state !== "RUNNING" || !task.executionRecordId) {
      throw new AiWorkforceError(
        "INVALID_MISSION_TRANSITION",
        `Task "${taskId}" is ${task.state}; only a RUNNING attempt can be escalated`,
        { taskId, state: task.state },
      );
    }
    await this.parkForReview(task, missionId, task.executionRecordId, {
      reason: input.detail,
      summary: `Attempt ${task.attempt} of "${task.title}" could not be verified after a restart: ${input.detail}. The provider may have finished this run — decide whether to retry or cancel.`,
    });
    // Let the mission state follow the task, without dispatching anything.
    await this.advance(missionId, { startNext: false });
    const settled = await requireTask(this.deps.tasks, taskId);
    return { taskId, state: settled.state, executionRecordId: task.executionRecordId };
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
    input: { decision: ReviewDecision; decidedBy: string; note?: string; authority?: ExecutionAuthority },
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

    // A decision can immediately re-open work (NEEDS_REVISION → READY), so the
    // authority travels with it: the advance that follows may start an attempt.
    return this.advance(review.missionId, {
      ...(input.authority ? { authority: input.authority } : {}),
    });
  }

  /* ═══════════════════════════════════════════════════
     Cancellation and read models
     ═══════════════════════════════════════════════════ */

  /**
   * Cancels a mission: every in-flight execution is cancelled THROUGH the
   * governed execution service, remaining tasks are cancelled, then the mission
   * is.
   *
   * CANCELLATION REQUIRES AN AUTHORITY. It is an external side effect, and the
   * execution service persists a `CANCEL_REQUESTED` audit event BEFORE it asks
   * the runtime, so there is no unauthenticated and no unaudited way to reach a
   * provider.
   *
   * @throws AUTHORITY_UNRESOLVED when no authority is supplied.
   */
  async cancelMission(
    missionId: MissionId,
    reason = "cancelled by request",
    options: ForegroundOptions = {},
  ): Promise<MissionAdvanceResult> {
    const mission = await this.deps.missions.require(missionId);
    const tasks = await this.deps.tasks.listForMission(missionId);
    const outstanding = tasks.filter((task) => !isTerminalTaskState(task.state));

    // CANCELLING A MISSION WITH OUTSTANDING WORK REQUIRES AN AUTHORITY — for
    // EVERY non-terminal task, not only a RUNNING one. A READY task may hold a
    // dispatch reservation the task row does not show.
    if (outstanding.length > 0 && !options.authority) {
      throw new AiWorkforceError(
        "AUTHORITY_UNRESOLVED",
        "Cancelling a mission with outstanding work requires an authenticated authority",
        { missionId, tasks: outstanding.map((task) => task.id) },
      );
    }

    // Ask the DELIVERY LEDGER, through the governed service, what is in flight —
    // and let it RESERVE the next attempt of every dispatchable task as
    // CANCELLED so a racing `execute()` cannot enter dispatch. Anything it cannot
    // confirm is reported `unresolved`.
    const cancellations =
      outstanding.length > 0 && options.authority
        ? await this.deps.execution.cancelMissionAttempts({
            missionId,
            tasks: outstanding.map((task) => ({ taskId: task.id, state: task.state })),
            reason,
            authority: options.authority,
          })
        : [];

    const unresolved = cancellations.filter((cancellation) => cancellation.unresolved);
    if (unresolved.length > 0) {
      // DO NOT TERMINALISE THE MISSION. An external run may exist; cancelling
      // now would orphan it under a CANCELLED mission with nothing to adopt it.
      // The operator can cancel again once the attempt finalises or is parked.
      const latest = await this.deps.missions.require(missionId);
      return {
        mission: latest,
        tasks: await this.deps.tasks.listForMission(missionId),
        changes: unresolved.map((c) => `task:${c.taskId}:CANCEL_BLOCKED:${c.detail}`),
        pendingReviews: await this.deps.reviews.listPending(),
      };
    }

    for (const task of outstanding) {
      const current = await this.deps.tasks.get(task.id);
      if (!current || isTerminalTaskState(current.state)) continue;
      await this.moveTask(current, "CANCELLED", reason);
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

  private async parkForReview(
    task: MissionTask,
    missionId: MissionId,
    executionRecordId: string,
    /**
     * Override for the escalation that is NOT an acceptance request — an attempt
     * that could not be verified. A review row is still created, because the
     * Decision Queue is built from pending reviews: parking a task in REVIEW
     * without one would hide it from the human who has to decide.
     */
    escalation?: { reason: string; summary: string },
  ): Promise<MissionTask> {
    const mission = await this.deps.missions.require(missionId);
    const reviewer = await this.resolveReviewer(mission);
    const review = await this.deps.reviews.request({
      taskId: task.id,
      missionId,
      executionRecordId,
      summary:
        escalation?.summary ??
        `Task "${task.title}" produced a result; ${reviewer ? `${reviewer.displayName} must accept it` : "a human must accept it"}`,
      reviewerActorId: reviewer?.id ?? null,
      requestedBy: task.assignedActorId ?? "orchestrator",
    });

    const inReview: MissionTask = {
      ...applyTaskTransition(
        task,
        "REVIEW",
        escalation?.reason ?? "execution succeeded; awaiting human authority",
        this.deps.now().toISOString(),
      ),
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

/*
   THE COMPOSITION FACTORY LIVES ELSEWHERE. `createMissionOrchestrator` moved to
   `./create-mission-orchestrator` in Step 5A-4, because assembling the DEFAULT
   execution boundary requires naming the internal runtime dispatcher — and this
   module must not be able to name a runtime, a dispatcher or a provider adapter
   at all. The dispatcher is constructed there, handed to
   `CapabilityExecutionService`, and from then on it lives BELOW the execution
   boundary; this file only ever sees `CapabilityExecutionService`.
*/

/** A bounded, operator-readable reason for an attempt that did not start. */
export function describeExecutionOutcome(outcome: ExecutionOutcome): string {
  switch (outcome.kind) {
    case "IN_PROGRESS":
      return `IN_PROGRESS: another invocation owns attempt ${outcome.claimId}; nothing was started here`;
    case "WAIT_APPROVAL":
      return `APPROVAL_REQUIRED: an approval bound to this attempt is still outstanding`;
    case "WAIT_HUMAN":
      return `WAIT_HUMAN: ${outcome.detail}`;
    case "BLOCKED":
      return `BLOCKED ${outcome.code}: ${outcome.message}`;
    case "DENIED":
      return `DENIED ${outcome.code}: ${outcome.message}`;
    case "UNVERIFIED":
      return `UNVERIFIED: ${outcome.detail}`;
    case "FAILED":
      return `FAILED ${outcome.error.category}: ${outcome.error.message}`;
    default:
      return "the execution service returned an outcome this version does not understand";
  }
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
