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
 * forgotten by one caller and remembered by another:
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
  async issueCommand(raw: unknown): Promise<CommandOutcome> {
    const command = parseMissionCommand(raw);
    return this.submit(command);
  }

  /** The typed form, for callers that build a Command in code. */
  async submit(command: MissionCommand): Promise<CommandOutcome> {
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
        createdBy: command.requestedBy,
        owner: command.owner ?? command.requestedBy,
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
  async advance(missionId: MissionId, options: { startNext?: boolean } = {}): Promise<MissionAdvanceResult> {
    return this.deps.orchestrator.advance(missionId, options);
  }

  /**
   * Waits for ONE running task through the runtime port and records what the
   * runtime reported. This is the operation a worker (or a restarted process)
   * uses to bring in-flight work to a decided state; without it the application
   * boundary could start a mission but never finish one.
   */
  async settle(missionId: MissionId, taskId: TaskId, options: { waitTimeoutMs?: number } = {}): Promise<TaskAdvanceOutcome> {
    return this.deps.orchestrator.settleTask(missionId, taskId, options);
  }

  /**
   * The resumption driver: settle every in-flight task, then reconcile.
   *
   * It reads the mission from the DATABASE first, so it works after a restart,
   * after a failed attempt, and for work another process started. It never
   * starts more than one task, so a retry cannot stampede the provider.
   */
  async drain(missionId: MissionId, options: { waitTimeoutMs?: number } = {}): Promise<MissionAdvanceResult> {
    const snapshot = await this.snapshot(missionId);
    for (const task of snapshot.tasks) {
      if (task.state === "RUNNING") {
        await this.deps.orchestrator.settleTask(
          missionId,
          task.id,
          options.waitTimeoutMs ? { waitTimeoutMs: options.waitTimeoutMs } : {},
        );
      }
    }
    return this.deps.orchestrator.advance(missionId);
  }

  /** The human authority path: an approve/reject/needs-revision decision. */
  async decide(reviewId: ReviewId, input: { decision: ReviewDecision; decidedBy: string; note?: string }): Promise<MissionAdvanceResult> {
    return this.deps.orchestrator.decide(reviewId, input);
  }

  async cancel(missionId: MissionId, reason = "cancelled by request"): Promise<MissionAdvanceResult> {
    return this.deps.orchestrator.cancelMission(missionId, reason);
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
