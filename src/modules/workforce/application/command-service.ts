import { AiWorkforceError } from "@/modules/ai-workforce/core/errors";

import type { WorkforceDomain } from "../index";
import type { Mission } from "../missions/mission-contracts";
import type { MissionTask } from "../missions/task-contracts";
import type {
  MissionAdvanceResult,
  MissionOrchestrator,
  MissionSnapshot,
  TaskAdvanceOutcome,
} from "../orchestration/mission-orchestrator";
import type { ReviewDecision, TaskReview } from "../review/task-review";
import type { MissionId, ReviewId, TaskId } from "../core/refs";

import type { ExecutionReconciler, ExecutionReconciliation } from "../execution/execution-reconciler";
import type { ExecutionClaim } from "../execution/execution-claim";
import type { ExecutionAuthority } from "../execution/execution-authority";

import {
  commandFingerprint,
  parseMissionCommand,
  toMissionTaskInputs,
  type CommandTaskRouter,
  type MissionCommand,
} from "./command-contracts";
import type { CommandIntent, CommandIntentRepository } from "./command-intent";

/**
 * WorkforceCommandService — the APPLICATION boundary.
 *
 * This is what a running NEXUP calls. It is deliberately the ONLY place that
 * pairs "a request arrived" with "the lifecycle moved", so idempotency cannot be
 * forgotten by one caller and remembered by another.
 *
 * AUTHORITY IS THREADED, NOT RE-DERIVED (Step 5A-4). Every operation that can
 * start, advance, settle or cancel work accepts the SAME server-created
 * `ExecutionAuthority` the API edge built, and forwards it to the orchestrator
 * and on to the Capability Execution Service. Nothing here reconstructs an
 * authority from a task, a mission owner, `actor_founder`, a payload id or a
 * stored requester string — there is no code path that could.
 *
 *   Command (with an idempotency key)
 *     → claim the key in the durable ledger
 *     → Mission → Task plan → Actor → Capability → Runtime → Execution
 *     → Result → Review → (human) → completed Mission
 *
 * What it does NOT do:
 *
 *   - it does not authorise anything (the dispatcher still owns the capability
 *     and runtime-binding checks, and a refusal surfaces as a BLOCKED task);
 *   - it does not decide an agent's work (a successful execution parks in REVIEW
 *     until a HUMAN decides — `decide()`);
 *   - it does not replan a retry. A replayed Command returns the mission it
 *     already owns and advances NOTHING, because a retry must not be able to
 *     cause a second real execution.
 */

export type WorkforceCommandServiceDeps = {
  domain: WorkforceDomain;
  orchestrator: MissionOrchestrator;
  intents: CommandIntentRepository;
  /** Where a task with no explicit actor/capability is routed. */
  route: CommandTaskRouter;
  /**
   * Re-adopts executions this process did not start. It is a dependency of the
   * APPLICATION boundary, not of the orchestrator, because "who is watching the
   * handle" is a property of the process, and the process is what restarts.
   */
  reconciler: ExecutionReconciler;
};

export type CommandIssued = {
  kind: "issued";
  replayed: false;
  intent: CommandIntent;
  mission: Mission;
  tasks: MissionTask[];
  changes: string[];
  pendingReviews: TaskReview[];
};

/** The same Command arrived twice: the mission already exists, untouched. */
export type CommandReplayed = {
  kind: "replayed";
  replayed: true;
  intent: CommandIntent;
  mission: Mission;
  tasks: MissionTask[];
  changes: [];
  pendingReviews: TaskReview[];
};

/** The key is claimed but its mission is not recorded yet — ask again shortly. */
export type CommandInProgress = {
  kind: "in-progress";
  replayed: false;
  intent: CommandIntent;
};

export type CommandOutcome = CommandIssued | CommandReplayed | CommandInProgress;

export class WorkforceCommandService {
  constructor(private readonly deps: WorkforceCommandServiceDeps) {}

  /**
   * The single entry point: a raw payload becomes a Command, and a Command
   * becomes (or re-finds) a Mission.
   *
   * @throws INVALID_INPUT before the ledger is touched, so a malformed request
   *         never burns a key.
   * @throws COMMAND_KEY_REUSED when the key arrives with a different payload.
   */
  async issueCommand(raw: unknown, options: { authority?: ExecutionAuthority } = {}): Promise<CommandOutcome> {
    const command = parseMissionCommand(raw);
    return this.submit(command, options);
  }

  /** The typed form, for callers that build a Command in code. */
  async submit(command: MissionCommand, options: { authority?: ExecutionAuthority } = {}): Promise<CommandOutcome> {
    const fingerprint = commandFingerprint(command);
    const claim = await this.deps.intents.claim({
      scope: command.scope,
      idempotencyKey: command.idempotencyKey,
      commandHash: fingerprint,
      requestedBy: command.requestedBy,
      ...(command.tasks[0]?.requiredCapabilityId ? { capabilityId: command.tasks[0].requiredCapabilityId } : {}),
    });

    if (claim.kind === "conflict") {
      throw new AiWorkforceError(
        "COMMAND_KEY_REUSED",
        `Idempotency key "${command.idempotencyKey}" was already used for a different command in scope "${command.scope}"`,
        { scope: command.scope, intentId: claim.intent.id },
      );
    }
    if (claim.kind === "in-progress") {
      return { kind: "in-progress", replayed: false, intent: claim.intent };
    }
    if (claim.kind === "replay") {
      // A retry must not advance the mission: it already produced these tasks,
      // and advancing could start work the original request never started.
      return {
        kind: "replayed",
        replayed: true,
        intent: claim.intent,
        mission: await this.deps.domain.missions.require(claim.intent.missionId!),
        tasks: await this.deps.domain.tasks.listForMission(claim.intent.missionId!),
        changes: [],
        pendingReviews: await this.deps.domain.reviews.listPending(),
      };
    }

    try {
      const mission = await this.deps.orchestrator.createMission({
        title: command.title,
        goal: command.goal,
        // IDENTITY VOCABULARY. `createdBy` and `owner` are ACTOR ids; only the
        // command's `requestedBy` is a USER id (and it is used for the intent
        // ledger, not written into the mission's actor fields). The fallback
        // chain exists so a caller that supplies only actor identities keeps the
        // pre-existing behaviour, while the live path supplies `createdBy`
        // explicitly from the resolved authenticated actor.
        createdBy: command.createdBy ?? command.owner ?? command.requestedBy,
        owner: command.owner ?? command.createdBy ?? command.requestedBy,
        priority: command.priority ?? "NORMAL",
        ...(command.businessId ? { businessId: command.businessId } : {}),
        ...(command.workspaceRef ? { workspaceRef: command.workspaceRef } : {}),
        ...(command.projectRef ? { projectRef: command.projectRef } : {}),
        ...(command.clientRef ? { clientRef: command.clientRef } : {}),
      });

      // Record the mission BEFORE advancing: if the process dies mid-advance,
      // the key resolves to a real mission rather than an empty claim, and the
      // next `advance()` reconciles whatever is left — no work is lost and no
      // duplicate mission is created.
      await this.deps.intents.complete(claim.intent.id, mission.id);

      const advanced = await this.deps.orchestrator.plan(
        mission.id,
        toMissionTaskInputs(command, this.deps.route),
        { ...(options.authority ? { authority: options.authority } : {}) },
      );

      return {
        kind: "issued",
        replayed: false,
        intent: claim.intent,
        mission: advanced.mission,
        tasks: advanced.tasks,
        changes: advanced.changes,
        pendingReviews: advanced.pendingReviews,
      };
    } catch (error) {
      // Resolve the key honestly so a retry can claim it again.
      await this.deps.intents.fail(claim.intent.id, error instanceof Error ? error.message : "command submission failed");
      throw error;
    }
  }

  /** Reconciles a mission: promote what is dispatchable, start at most one task. */
  async advance(
    missionId: MissionId,
    options: { startNext?: boolean; authority?: ExecutionAuthority } = {},
  ): Promise<MissionAdvanceResult> {
    // Deliberately no reconciliation here: `advance` is the read-only reconciler
    // of MISSION STATE and must stay free of provider calls, so a caller can
    // look at a mission without touching a runtime. Recovery is `drain`/`reconcile`.
    return this.deps.orchestrator.advance(missionId, options);
  }

  /**
   * Re-adopts every in-flight attempt of this mission through the runtime port.
   *
   * This is what makes a restart survivable: the durable records name the
   * handle, the provider execution and the attempt, so a NEW process can ask the
   * runtime what became of work it never submitted — without resubmitting it.
   * Nothing is dispatched, and an attempt that cannot be verified is escalated
   * to a human rather than guessed at.
   */
  async reconcile(missionId: MissionId): Promise<ExecutionReconciliation[]> {
    // NO AUTHORITY IS ACCEPTED HERE, deliberately. Reconciliation observes and
    // adopts attempts that were ALREADY authorised and cannot start work at all,
    // so there is nothing a caller's authority could authorise on this path.
    // Taking one and ignoring it would imply the opposite — that this is a
    // second way in — which is exactly the ambiguity the cutover removes.
    return this.deps.reconciler.reconcileMission(missionId);
  }

  /** The same re-adoption sweep, across the most recently touched missions. */
  async reconcileInFlight(limit?: number): Promise<ExecutionReconciliation[]> {
    return this.deps.reconciler.reconcileInFlight(limit);
  }

  /**
   * The mission's still-OPEN claim incidents — a READ, from the durable ledger.
   *
   * `reconcile` reports what a sweep FOUND; this answers what is still unresolved
   * right now, so an operator surface can show a crash claim (a `READY` task whose
   * dispatch was entered and never identified, say) without having to run a sweep
   * to find out. It observes only: it can never dispatch, release or resolve.
   */
  async claimIncidents(missionId: MissionId): Promise<ExecutionClaim[]> {
    return this.deps.reconciler.openClaimIncidents(missionId);
  }

  /**
   * Waits for ONE running task through the runtime port and records what the
   * runtime reported. This is the operation a worker (or a restarted process)
   * uses to bring in-flight work to a decided state; without it the application
   * boundary could start a mission but never finish one.
   */
  async settle(
    missionId: MissionId,
    taskId: TaskId,
    options: { waitTimeoutMs?: number; authority?: ExecutionAuthority } = {},
  ): Promise<TaskAdvanceOutcome> {
    return this.deps.orchestrator.settleTask(missionId, taskId, options);
  }

  /**
   * The resumption driver: settle every in-flight task, then reconcile.
   *
   * It reads the mission from the DATABASE first, so it works after a restart,
   * after a failed attempt, and for work another process started. It never
   * starts more than one task, so a retry cannot stampede the provider.
   */
  async drain(
    missionId: MissionId,
    options: { waitTimeoutMs?: number; authority?: ExecutionAuthority } = {},
  ): Promise<MissionAdvanceResult> {
    // 1. ADOPT FIRST. A task left RUNNING by a previous process has a handle
    //    this process never minted, so settling it directly would fail with
    //    RUNTIME_NOT_FOUND. Re-adoption puts the handle back under our watch
    //    (and settles anything the runtime has already finished) without ever
    //    resubmitting the job.
    const reconciliations = await this.deps.reconciler.reconcileMission(missionId);

    // 2. Then settle whatever is STILL running through the ordinary port path.
    const snapshot = await this.snapshot(missionId);
    for (const task of snapshot.tasks) {
      if (task.state === "RUNNING") {
        await this.deps.orchestrator.settleTask(missionId, task.id, {
          ...(options.waitTimeoutMs ? { waitTimeoutMs: options.waitTimeoutMs } : {}),
          ...(options.authority ? { authority: options.authority } : {}),
        });
      }
    }

    // 3. Then let the mission follow its tasks and promote the next dispatchable
    //    one. A replayed Command never gets here, which is why a retry cannot
    //    cause a second execution.
    const advanced = await this.deps.orchestrator.advance(missionId, {
      ...(options.authority ? { authority: options.authority } : {}),
    });
    const notes = reconciliations.map(
      (row) => `execution:${row.executionRecordId}:${row.kind} (${row.status})`,
    );
    return notes.length > 0 ? { ...advanced, changes: [...notes, ...advanced.changes] } : advanced;
  }

  /** The human authority path: an approve/reject/needs-revision decision. */
  async decide(
    reviewId: ReviewId,
    input: { decision: ReviewDecision; decidedBy: string; note?: string; authority?: ExecutionAuthority },
  ): Promise<MissionAdvanceResult> {
    return this.deps.orchestrator.decide(reviewId, input);
  }

  async cancel(
    missionId: MissionId,
    reason = "cancelled by request",
    options: { authority?: ExecutionAuthority } = {},
  ): Promise<MissionAdvanceResult> {
    return this.deps.orchestrator.cancelMission(missionId, reason, options);
  }

  /** Everything about one mission, in one read. Never advances anything. */
  async snapshot(missionId: MissionId): Promise<MissionSnapshot> {
    return this.deps.orchestrator.snapshot(missionId);
  }

  /** What this key resolved to, for a caller that lost its own bookkeeping. */
  async intentFor(scope: string, idempotencyKey: string): Promise<CommandIntent | null> {
    return this.deps.intents.findByKey(scope, idempotencyKey);
  }
}
