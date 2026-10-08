import { AiWorkforceError } from "@/modules/ai-workforce/core/errors";
import type { PermissionToken } from "@/modules/ai-workforce/core/execution-context";
import { assertNoCredentials } from "../core/credentials";
import type { ActorId } from "../core/refs";
import type { ActorType } from "../actors/actor-contracts";

/**
 * ExecutionAuthority — WHO is asking, established from the AUTHENTICATED session.
 *
 * This type exists because the live mission path had no authenticated authority
 * at all. `POST /api/ai-workforce/decisions` attributed every human decision to
 * the constant `"actor_founder"`, `POST /api/ai-workforce/missions` defaulted
 * `owner` to the same constant, and no mission read/advance/decide was checked
 * against the caller's business scope. An authenticated caller could read,
 * advance, decide or cancel a mission belonging to any business.
 *
 * The rule this type encodes, and the reason it is a distinct type rather than
 * another `ExecutionContext`:
 *
 *   EVERY field here is derived at the API EDGE from the session. NONE of it is
 *   payload-settable.
 *
 * `ExecutionContext` (Phase 1) describes "which service is running, on whose
 * delegated session, in which business" and is built per execution. This
 * describes the CALLER and their authority, and it is built once per request,
 * before any domain object is touched. Keeping them separate means a mission
 * advance cannot silently inherit a scope from a request body, and it gives the
 * scope check one object to consult instead of three.
 *
 * TWO CONCEPTS THAT WERE CONFLATED, NOW SEPARATED:
 *
 *   actorId     the registered workforce ACTOR the work is attributed to and
 *               which the runtime dispatcher authorizes. Identity.
 *   (decidedBy) the HUMAN who decided a review — also an actor id today, but
 *               resolved from THIS object's `userId`, never a constant.
 *
 * Credentials: an authority carries permission TOKENS (named rights, e.g.
 * "clients.read"), never a session token, cookie, JWT or bearer value. The
 * credential guard below enforces that on construction, exactly as
 * `assertExecutionContextSafe` does for the Phase-1 context.
 */

export type ExecutionAuthority = {
  /** The signed-in user id — the only link back to the legacy session. */
  userId: string;
  /** The workforce actor this request acts as. Resolved, never payload-supplied. */
  actorId: ActorId;
  actorSlug: string;
  actorType: ActorType;
  /** Named rights mirrored from the legacy session. Never a credential. */
  permissionTokens: PermissionToken[];
  /** Business slugs this caller may reach. */
  accessibleBusinessSlugs: string[];
  isSuperAdmin: boolean;
  hasOfficeFinanceFull: boolean;
  correlationId: string;
  /** When the authority was established (ISO-8601). */
  requestedAt: string;
};

/**
 * The inputs an edge adapter supplies. Deliberately explicit rather than a
 * `Partial<ExecutionAuthority>`: a missing field must be a compile error, because
 * every one of them is load-bearing for an authorization decision.
 */
export type ExecutionAuthorityInput = {
  userId: string;
  actorId: ActorId;
  actorSlug: string;
  actorType: ActorType;
  permissionTokens: readonly PermissionToken[];
  accessibleBusinessSlugs: readonly string[];
  isSuperAdmin: boolean;
  hasOfficeFinanceFull: boolean;
  correlationId?: string;
  requestedAt?: string;
  /** Injectable clock, so a test can produce a deterministic authority. */
  now?: Date;
  ids?: { next(kind: string): string };
};

/**
 * Builds an authority from already-authenticated session facts.
 *
 * @throws INVALID_INPUT when an identity field is missing or empty — an
 *         authority with no user is not a weaker authority, it is not one.
 * @throws INVALID_ACTOR when a credential-looking field is present.
 */
export function createExecutionAuthority(input: ExecutionAuthorityInput): ExecutionAuthority {
  // Check the INPUT first. This builder copies only known fields, so a smuggled
  // key would be silently DROPPED rather than caught — and a silent drop is the
  // wrong outcome for an edge adapter that spread a whole session object in:
  // the caller would never learn that it was passing a credential at all. The
  // check is repeated on the built value below so the object that LEAVES this
  // module is also provably clean, independently of the builder.
  assertNoCredentials(input, "Execution authority input");

  const userId = requireText(input.userId, "userId");
  const actorId = requireText(input.actorId, "actorId");
  const actorSlug = requireText(input.actorSlug, "actorSlug");

  const now = input.now ?? new Date();
  const requestedAt = input.requestedAt ?? now.toISOString();
  const correlationId =
    input.correlationId ?? input.ids?.next("corr") ?? `corr_${now.getTime().toString(36)}`;

  const authority: ExecutionAuthority = {
    userId,
    actorId,
    actorSlug,
    actorType: input.actorType,
    permissionTokens: [...input.permissionTokens],
    accessibleBusinessSlugs: [...input.accessibleBusinessSlugs],
    isSuperAdmin: input.isSuperAdmin === true,
    hasOfficeFinanceFull: input.hasOfficeFinanceFull === true,
    correlationId,
    requestedAt,
  };

  assertNoCredentials(authority, "Execution authority");
  return authority;
}

/**
 * Whether this caller may reach a business.
 *
 * TRUE for `null`/`undefined` scope: an office-wide capability has no business
 * to be denied, and inventing one would refuse legitimate global work. A scoped
 * capability supplies a slug, and then this is the check.
 *
 * SUPER_ADMIN bypasses, mirroring `PermissionPolicy` — the legacy session stays
 * the single source of truth for who may do what, and this must not be stricter
 * than the module gate it mirrors (a divergence would be a bug in itself).
 */
export function authorityCanReachBusiness(
  authority: ExecutionAuthority,
  businessSlug: string | null | undefined,
): boolean {
  if (!businessSlug) return true;
  if (authority.isSuperAdmin) return true;
  return authority.accessibleBusinessSlugs.includes(businessSlug);
}

/**
 * Whether this caller may decide a review.
 *
 * HUMAN AUTHORITY is not configurable: an AI agent, a service identity or the
 * EXEC orchestrator cannot approve work. `ReviewService` enforces the same rule
 * against the registered actor; this predicate is the authority-side half, so a
 * refusal can be reached BEFORE the review row is even read.
 */
export function authorityIsHumanDecisionActor(authority: ExecutionAuthority): boolean {
  return authority.actorType === "HUMAN";
}

/** A bounded, JSON-safe summary (never a credential, safe to log or audit). */
export function summarizeExecutionAuthority(authority: ExecutionAuthority): {
  userId: string;
  actorId: string;
  actorSlug: string;
  actorType: ActorType;
  correlationId: string;
  isSuperAdmin: boolean;
  businessCount: number;
} {
  return {
    userId: authority.userId,
    actorId: authority.actorId,
    actorSlug: authority.actorSlug,
    actorType: authority.actorType,
    correlationId: authority.correlationId,
    isSuperAdmin: authority.isSuperAdmin,
    businessCount: authority.accessibleBusinessSlugs.length,
  };
}

function requireText(value: string | undefined | null, field: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new AiWorkforceError("INVALID_INPUT", `An execution authority requires ${field}`, { field });
  }
  return value.trim();
}
