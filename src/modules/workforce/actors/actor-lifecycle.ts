import { AiWorkforceError } from "@/modules/ai-workforce/core/errors";
import type { Actor, ActorLifecycleState } from "./actor-contracts";

/**
 * Actor lifecycle state machine.
 *
 *   DRAFT ─► SHADOW ─► ASSISTED ─► APPROVED_AUTONOMY ─┐
 *     ▲         │          │              │            │
 *     │         ▼          ▼              ▼            ▼
 *     │       REVIEW ◄─────┴──────────────┴──────► REVIEW
 *     │         │                                    │
 *     └──── DISABLED ◄───────────────────────────────┘
 *
 * Meaning:
 *   DRAFT              registered, never observed
 *   SHADOW             runs beside a human, produces nothing live
 *   ASSISTED           runs with a human approving each output
 *   APPROVED_AUTONOMY  may run approved capabilities unattended
 *   REVIEW             parked for inspection; not executing
 *   DISABLED           off; may be re-activated back to DRAFT
 *
 * Transitions are explicit data — the registry never invents a rule.
 */

export const ACTOR_LIFECYCLE_TRANSITIONS: Record<ActorLifecycleState, readonly ActorLifecycleState[]> = {
  DRAFT: ["SHADOW", "DISABLED"],
  SHADOW: ["ASSISTED", "REVIEW", "DISABLED"],
  ASSISTED: ["APPROVED_AUTONOMY", "REVIEW", "DISABLED"],
  APPROVED_AUTONOMY: ["ASSISTED", "REVIEW", "DISABLED"],
  REVIEW: ["DRAFT", "ASSISTED", "APPROVED_AUTONOMY", "DISABLED"],
  DISABLED: ["DRAFT"],
};

/** States in which an actor may be handed live work. */
export const EXECUTABLE_LIFECYCLE_STATES: readonly ActorLifecycleState[] = ["SHADOW", "ASSISTED", "APPROVED_AUTONOMY"];

export function nextActorStates(from: ActorLifecycleState): readonly ActorLifecycleState[] {
  return ACTOR_LIFECYCLE_TRANSITIONS[from] ?? [];
}

export function canTransitionActor(from: ActorLifecycleState, to: ActorLifecycleState): boolean {
  if (from === to) return false;
  return nextActorStates(from).includes(to);
}

/** @throws INVALID_ACTOR_TRANSITION */
export function assertActorTransition(from: ActorLifecycleState, to: ActorLifecycleState): void {
  if (!canTransitionActor(from, to)) {
    throw new AiWorkforceError("INVALID_ACTOR_TRANSITION", `Actor cannot move from ${from} to ${to}`, {
      from,
      to,
      allowed: [...nextActorStates(from)],
    });
  }
}

export function isActorExecutable(actor: Actor): boolean {
  return EXECUTABLE_LIFECYCLE_STATES.includes(actor.lifecycle);
}

/** Pure transition — returns a new actor with the new lifecycle (no store). */
export function applyActorLifecycle(actor: Actor, to: ActorLifecycleState, at: string): Actor {
  assertActorTransition(actor.lifecycle, to);
  return { ...actor, lifecycle: to, updatedAt: at };
}
