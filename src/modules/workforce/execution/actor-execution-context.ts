import {
  createExecutionContext,
  type ExecutionContext,
  type ExecutionContextInput,
} from "@/modules/ai-workforce/core/execution-context";
import { assertNoCredentials } from "../core/credentials";
import type { Actor, ActorType } from "../actors/actor-contracts";
import type { ActorId, CapabilityId, MissionId, RuntimeId, TraceId } from "../core/refs";

/**
 * Actor execution context.
 *
 * Phase 1's `ExecutionContext` already answers "which service is running, on
 * whose delegated session, in which business". Phase 2A adds the WORKFORCE
 * identity of the execution: a delegated actor, a mission, a capability, a
 * runtime, and an approval reference.
 *
 * DESIGN CHOICE — this is an INTERSECTION, not a mutation of the Phase-1 type.
 *
 *   ActorExecutionContext = ExecutionContext & { ...Phase 2A refs }
 *
 * Why: the Phase-1 type is the keystone of the whole engine (job creation,
 * context snapshots, every existing test). Extending it in place would ripple
 * through `context-snapshot.ts` and the persisted `AiJob.context` JSON for zero
 * behavioural gain. A typed superset delivers the exact same capability with
 * zero blast radius: existing code keeps its `ExecutionContext`; new code that
 * needs actor awareness asks for `ActorExecutionContext`.
 *
 * Two invariants:
 *   - The Phase-1 `serviceIdentity` + delegated session `actor` are PRESERVED
 *     (that decision stands: service identity ≠ actor rights).
 *   - The context NEVER carries credentials. Permissions travel as a reference
 *     id (`permissionsSnapshotRef`) and the approval as a reference
 *     (`approvalRef`) — never a token, header or key.
 */

/** The workforce actor this execution is delegated to. Identity only. */
export type DelegatedActorRef = {
  actorId: ActorId;
  actorType: ActorType;
  slug: string;
  /** The runtime that hosts this actor, if any. `null` for humans/services. */
  runtimeId?: RuntimeId | null;
  /** The capability assignment that authorised this execution, if any. */
  assignmentId?: string;
};

export type ActorExecutionContext = ExecutionContext & {
  missionId?: MissionId;
  capabilityId?: CapabilityId;
  runtimeId?: RuntimeId | null;
  delegatedActor?: DelegatedActorRef;
  /** Reference id of a permission snapshot — never the grants or a token. */
  permissionsSnapshotRef?: string;
  /** Reference id of the approving record — never the decision's credential. */
  approvalRef?: string;
  /** Correlation/trace id. Defaults to the Phase-1 `correlationId`. */
  traceId: TraceId;
};

export type ActorExecutionContextInput = ExecutionContextInput & {
  missionId?: MissionId;
  capabilityId?: CapabilityId;
  runtimeId?: RuntimeId | null;
  delegatedActor?: DelegatedActorRef;
  permissionsSnapshotRef?: string;
  approvalRef?: string;
  traceId?: TraceId;
};

/** Builds a delegated-actor reference from an actor record. */
export function delegatedActorFrom(
  actor: Actor,
  extras: { assignmentId?: string } = {},
): DelegatedActorRef {
  const ref: DelegatedActorRef = {
    actorId: actor.id,
    actorType: actor.type,
    slug: actor.slug,
    runtimeId: actor.runtimeBinding?.runtimeId ?? null,
  };
  if (extras.assignmentId) ref.assignmentId = extras.assignmentId;
  return ref;
}

/**
 * Creates an actor-aware execution context on top of the Phase-1 factory.
 * @throws INVALID_ACTOR when any part of the context carries a credential
 */
export function createActorExecutionContext(input: ActorExecutionContextInput): ActorExecutionContext {
  const base = createExecutionContext(input);

  const context: ActorExecutionContext = {
    ...base,
    traceId: input.traceId ?? base.correlationId,
  };
  if (input.missionId) context.missionId = input.missionId;
  if (input.capabilityId) context.capabilityId = input.capabilityId;
  if (input.runtimeId !== undefined) context.runtimeId = input.runtimeId;
  if (input.delegatedActor) context.delegatedActor = { ...input.delegatedActor };
  if (input.permissionsSnapshotRef) context.permissionsSnapshotRef = input.permissionsSnapshotRef;
  if (input.approvalRef) context.approvalRef = input.approvalRef;

  assertExecutionContextSafe(context);
  return context;
}

/** Returns a copy of the context with a delegated actor attached. */
export function withDelegatedActor(
  context: ActorExecutionContext,
  actor: Actor,
  extras: { assignmentId?: string } = {},
): ActorExecutionContext {
  const next: ActorExecutionContext = {
    ...context,
    delegatedActor: delegatedActorFrom(actor, extras),
    runtimeId: actor.runtimeBinding?.runtimeId ?? null,
  };
  assertExecutionContextSafe(next);
  return next;
}

/**
 * Credential guard for an execution context.
 *
 * Called on construction so a context that smuggled a token/header could never
 * reach a runtime or a snapshot.
 *
 * @throws INVALID_ACTOR when a secret-looking field is present
 */
export function assertExecutionContextSafe(context: ExecutionContext | ActorExecutionContext): void {
  assertNoCredentials(context, "Execution context");
}
