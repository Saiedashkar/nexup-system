import { AiWorkforceError } from "@/modules/ai-workforce/core/errors";
import type { Clock, IdFactory } from "@/modules/ai-workforce/core/types";
import type { ActorRegistry } from "../actors/actor-registry";
import type { ActorId, ExecutionRecordId, MissionId, ReviewId, TaskId } from "../core/refs";

/**
 * Review repository port.
 *
 * The review boundary had no persistence seam: `ReviewService` held the rows in
 * a private map, so a restart silently forgot every pending human decision. The
 * port is deliberately the same shape as the mission/task/execution ports,
 * including a compare-and-set `decide` on the review STATE — that is what makes
 * "exactly one decision" true across two processes, not just two calls.
 */
export interface ReviewRepository {
  insert(review: TaskReview): Promise<TaskReview>;
  get(id: ReviewId): Promise<TaskReview | null>;
  forTask(taskId: TaskId): Promise<TaskReview[]>;
  listPending(): Promise<TaskReview[]>;
  /** @returns the stored review on success, or null when the CAS lost. */
  decide(review: TaskReview, expected: ReviewState[]): Promise<TaskReview | null>;
}

function cloneReview(review: TaskReview): TaskReview {
  return { ...review };
}

export class InMemoryReviewRepository implements ReviewRepository {
  private readonly rows = new Map<ReviewId, TaskReview>();

  async insert(review: TaskReview): Promise<TaskReview> {
    this.rows.set(review.id, cloneReview(review));
    return cloneReview(review);
  }

  async get(id: ReviewId): Promise<TaskReview | null> {
    const row = this.rows.get(id);
    return row ? cloneReview(row) : null;
  }

  async forTask(taskId: TaskId): Promise<TaskReview[]> {
    return [...this.rows.values()]
      .filter((row) => row.taskId === taskId)
      .map(cloneReview)
      .sort((a, b) => a.requestedAt.localeCompare(b.requestedAt));
  }

  async listPending(): Promise<TaskReview[]> {
    return [...this.rows.values()]
      .filter((row) => row.state === "PENDING")
      .map(cloneReview)
      .sort((a, b) => a.requestedAt.localeCompare(b.requestedAt));
  }

  async decide(review: TaskReview, expected: ReviewState[]): Promise<TaskReview | null> {
    const current = this.rows.get(review.id);
    if (!current) return null;
    if (!expected.includes(current.state)) return null;
    this.rows.set(review.id, cloneReview(review));
    return cloneReview(review);
  }
}

/**
 * REVIEW — the explicit HUMAN AUTHORITY boundary.
 *
 * An agent's result is not a decision. A task that produced output does not
 * complete itself: it parks in REVIEW and waits for a person. This module is
 * that boundary, and it is deliberately small and strict:
 *
 *   PENDING ──► APPROVED | REJECTED | NEEDS_REVISION
 *
 *   - exactly ONE decision per review (a second is APPROVAL_ALREADY_DECIDED);
 *   - only a HUMAN actor may decide — an AI agent's approval is refused with
 *     APPROVAL_FORBIDDEN even if it is the mission's owner;
 *   - a decided review is immutable.
 *
 * No agent autonomy setting can bypass this: the decision path exists on the
 * human side only.
 */

export const REVIEW_STATES = ["PENDING", "APPROVED", "REJECTED", "NEEDS_REVISION"] as const;
export type ReviewState = (typeof REVIEW_STATES)[number];

export const REVIEW_DECISIONS = ["APPROVED", "REJECTED", "NEEDS_REVISION"] as const;
export type ReviewDecision = (typeof REVIEW_DECISIONS)[number];

export function isReviewDecision(value: string): value is ReviewDecision {
  return (REVIEW_DECISIONS as readonly string[]).includes(value);
}

export type TaskReview = {
  id: ReviewId;
  taskId: TaskId;
  missionId: MissionId;
  /** The attempt whose result is under review. */
  executionRecordId: ExecutionRecordId;
  state: ReviewState;
  /** Why the review exists (what the agent produced, in one bounded line). */
  summary: string;
  /** Who must decide. */
  reviewerActorId: ActorId | null;
  requestedBy: string;
  requestedAt: string;
  decidedBy?: string;
  decidedAt?: string;
  note?: string;
};

export type ReviewRequestInput = {
  taskId: TaskId;
  missionId: MissionId;
  executionRecordId: ExecutionRecordId;
  summary: string;
  reviewerActorId?: ActorId | null;
  requestedBy: string;
};

export type ReviewDecisionInput = {
  decision: ReviewDecision;
  decidedBy: string;
  note?: string;
};

export type ReviewServiceDeps = {
  ids: IdFactory;
  now: Clock;
  /**
   * When supplied, the decider is resolved and must be a HUMAN actor. The
   * review boundary is the one place where that check is not optional in
   * practice: it is the reason the boundary exists.
   */
  actors?: ActorRegistry;
  /**
   * Where reviews are stored. Defaults to memory, so existing tests and the
   * in-memory composition are unchanged; the application composition passes a
   * durable repository so a pending decision survives a restart.
   */
  reviews?: ReviewRepository;
};

export interface ReviewServiceLike {
  request(input: ReviewRequestInput): Promise<TaskReview>;
  decide(reviewId: ReviewId, input: ReviewDecisionInput): Promise<TaskReview>;
  get(id: ReviewId): Promise<TaskReview | null>;
  forTask(taskId: TaskId): Promise<TaskReview[]>;
  listPending(): Promise<TaskReview[]>;
}

export class ReviewService implements ReviewServiceLike {
  private readonly rows: ReviewRepository;

  constructor(private readonly deps: ReviewServiceDeps) {
    this.rows = deps.reviews ?? new InMemoryReviewRepository();
  }

  async request(input: ReviewRequestInput): Promise<TaskReview> {
    if (!input.summary?.trim()) {
      throw new AiWorkforceError("INVALID_MISSION", "A review requires a summary of what is being reviewed", {
        taskId: input.taskId,
      });
    }
    const at = this.deps.now().toISOString();
    const review: TaskReview = {
      id: this.deps.ids.next("review"),
      taskId: input.taskId,
      missionId: input.missionId,
      executionRecordId: input.executionRecordId,
      state: "PENDING",
      summary: input.summary,
      reviewerActorId: input.reviewerActorId ?? null,
      requestedBy: input.requestedBy,
      requestedAt: at,
    };
    return this.rows.insert(review);
  }

  async get(id: ReviewId): Promise<TaskReview | null> {
    return this.rows.get(id);
  }

  async forTask(taskId: TaskId): Promise<TaskReview[]> {
    return this.rows.forTask(taskId);
  }

  async listPending(): Promise<TaskReview[]> {
    return this.rows.listPending();
  }

  /**
   * Records the human decision. Exactly once.
   *
   * @throws APPROVAL_NOT_FOUND | APPROVAL_ALREADY_DECIDED | APPROVAL_FORBIDDEN
   */
  async decide(reviewId: ReviewId, input: ReviewDecisionInput): Promise<TaskReview> {
    const existing = await this.rows.get(reviewId);
    if (!existing) {
      throw new AiWorkforceError("APPROVAL_NOT_FOUND", `Review "${reviewId}" does not exist`, { reviewId });
    }
    if (existing.state !== "PENDING") {
      throw new AiWorkforceError(
        "APPROVAL_ALREADY_DECIDED",
        `Review "${reviewId}" was already decided (${existing.state})`,
        { reviewId, state: existing.state },
      );
    }
    if (!isReviewDecision(input.decision)) {
      throw new AiWorkforceError("APPROVAL_REJECTED", `Unknown review decision "${input.decision}"`, {
        reviewId,
        decision: input.decision as string,
      });
    }
    if (!input.decidedBy?.trim()) {
      throw new AiWorkforceError("APPROVAL_FORBIDDEN", "A review decision must name who made it", { reviewId });
    }

    // HUMAN AUTHORITY. An AI agent, a service or the mission's own owner cannot
    // approve its own work when the actor registry is available to check.
    if (this.deps.actors) {
      const actor = await this.deps.actors.get(input.decidedBy);
      if (!actor) {
        throw new AiWorkforceError("APPROVAL_FORBIDDEN", `Review decider "${input.decidedBy}" is not a known actor`, {
          reviewId,
          decidedBy: input.decidedBy,
        });
      }
      if (actor.type !== "HUMAN") {
        throw new AiWorkforceError(
          "APPROVAL_FORBIDDEN",
          `Actor "${actor.slug}" (${actor.type}) may not decide a review — human authority is required`,
          { reviewId, decidedBy: input.decidedBy, actorType: actor.type },
        );
      }
    }

    const at = this.deps.now().toISOString();
    const decided: TaskReview = {
      ...existing,
      state: input.decision,
      decidedBy: input.decidedBy,
      decidedAt: at,
      ...(input.note ? { note: input.note } : {}),
    };
    // The decision is a COMPARE-AND-SET on PENDING, not a blind write: if a
    // second decision raced this one, the CAS loses and the caller is told the
    // review was already decided instead of overwriting a person's decision.
    const stored = await this.rows.decide(decided, ["PENDING"]);
    if (!stored) {
      const now = await this.rows.get(reviewId);
      throw new AiWorkforceError(
        "APPROVAL_ALREADY_DECIDED",
        `Review "${reviewId}" was decided concurrently (now ${now?.state ?? "unknown"})`,
        { reviewId, state: now?.state ?? "UNKNOWN" },
      );
    }
    return stored;
  }

  async count(): Promise<number> {
    return (await this.rows.listPending()).length;
  }
}
