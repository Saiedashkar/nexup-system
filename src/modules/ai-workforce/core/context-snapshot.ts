import { derivePermissionTokens } from "../policies/permission-policy";
import type { ActorContext, ExecutionContext, ServiceIdentity, WorkspaceContext } from "./execution-context";
import type { ApprovalId, AutonomyLevel, BusinessScope, CorrelationId, TriggerType } from "./types";

/**
 * Execution-context snapshot.
 *
 * Phase 1A kept the execution context (and therefore every job) in memory. A
 * persistent job must be resumable after a restart — including a resume that
 * happens later, from a different request, triggered by the approver. So the
 * job row carries a self-contained snapshot of the context it was created
 * with.
 *
 * Two deliberate rules:
 *
 *   1. PERMISSION TOKENS ARE NEVER STORED. Only the actor's *claims* are
 *      snapshotted (role + flags + businesses) and the tokens are re-derived on
 *      every load through the same `derivePermissionTokens` rules the running
 *      session uses. Stored tokens could silently outlive a revoked right;
 *      re-derivation cannot.
 *
 *   2. THE SNAPSHOT IS THE FALLBACK, NOT THE AUTHORITY. Approved resumes still
 *      re-check the permission policy and the approval policy before anything
 *      executes, so a snapshot can never be used to escalate.
 *
 * KNOWN LIMITATION (Phase 1C): the claims themselves are a snapshot taken at
 * creation time. Re-reading the user row is the next hardening step and is
 * logged as such in the report.
 */

export type ActorSnapshot = {
  userId: string;
  name: string;
  role: string;
  isSuperAdmin: boolean;
  hasOfficeFinanceFull: boolean;
  accessibleBusinessSlugs: string[];
};

export type ExecutionContextSnapshot = {
  serviceIdentity: ServiceIdentity;
  actor: ActorSnapshot;
  business: BusinessScope | null;
  workspace: WorkspaceContext | null;
  source: TriggerType;
  autonomy: AutonomyLevel;
  correlationId: CorrelationId;
  requestedAt: string;
  approvalId?: ApprovalId;
};

export function toActorSnapshot(actor: ActorContext): ActorSnapshot {
  return {
    userId: actor.userId,
    name: actor.name,
    role: actor.role,
    isSuperAdmin: actor.isSuperAdmin,
    hasOfficeFinanceFull: actor.hasOfficeFinanceFull,
    accessibleBusinessSlugs: [...actor.accessibleBusinessSlugs],
  };
}

export function fromActorSnapshot(snapshot: ActorSnapshot): ActorContext {
  return {
    userId: snapshot.userId,
    name: snapshot.name,
    role: snapshot.role,
    isSuperAdmin: snapshot.isSuperAdmin,
    hasOfficeFinanceFull: snapshot.hasOfficeFinanceFull,
    accessibleBusinessSlugs: [...(snapshot.accessibleBusinessSlugs ?? [])],
    // Re-derived, never restored: the tokens follow today's rules, not the
    // rules in force when the job was created.
    permissionTokens: derivePermissionTokens({
      role: snapshot.role,
      isSuperAdmin: snapshot.isSuperAdmin,
      hasOfficeFinanceFull: snapshot.hasOfficeFinanceFull,
      accessibleBusinessSlugs: snapshot.accessibleBusinessSlugs ?? [],
    }),
  };
}

export function toContextSnapshot(context: ExecutionContext): ExecutionContextSnapshot {
  const snapshot: ExecutionContextSnapshot = {
    serviceIdentity: { ...context.serviceIdentity },
    actor: toActorSnapshot(context.actor),
    business: context.business ? { ...context.business } : null,
    workspace: context.workspace ? { ...context.workspace } : null,
    source: context.source,
    autonomy: context.autonomy,
    correlationId: context.correlationId,
    requestedAt: context.requestedAt,
  };
  if (context.approvalId) snapshot.approvalId = context.approvalId;
  return snapshot;
}

/**
 * Rebuilds a live execution context from a stored snapshot.
 * `patch` is applied last and is how a resume attaches the approval decision.
 */
export function fromContextSnapshot(
  snapshot: ExecutionContextSnapshot,
  patch: Partial<ExecutionContext> = {},
): ExecutionContext {
  const context: ExecutionContext = {
    serviceIdentity: { ...snapshot.serviceIdentity },
    actor: fromActorSnapshot(snapshot.actor),
    business: snapshot.business ? { ...snapshot.business } : null,
    workspace: snapshot.workspace ? { ...snapshot.workspace } : null,
    source: snapshot.source,
    autonomy: snapshot.autonomy,
    correlationId: snapshot.correlationId,
    requestedAt: snapshot.requestedAt,
  };
  if (snapshot.approvalId) context.approvalId = snapshot.approvalId;
  return { ...context, ...patch };
}

/** Defensive parse for values that came out of a JSON column. */
export function isContextSnapshot(value: unknown): value is ExecutionContextSnapshot {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<ExecutionContextSnapshot>;
  return (
    typeof candidate.correlationId === "string" &&
    typeof candidate.source === "string" &&
    !!candidate.actor &&
    typeof candidate.actor === "object" &&
    typeof candidate.actor.userId === "string"
  );
}
