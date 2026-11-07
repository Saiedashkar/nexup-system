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
  /**
   * WHERE this authority came from, and therefore WHAT it may authorise.
   *
   *   REQUEST         built at the API edge from an AUTHENTICATED session. The
   *                   only origin that may start NEW work.
   *   RECONCILIATION  built by the recovery sweep for an attempt that was already
   *                   authorised. It may OBSERVE and ADOPT; it may never start a
   *                   new execution attempt.
   *
   * This field exists because the audit's standing rule is that unattended
   * background execution authority is NOT invented in this phase. A recovery
   * process genuinely needs an authority to settle work (otherwise a restart
   * could never finish anything), so instead of leaving "who is calling"
   * implicit, the origin is DECLARED and the execution path REFUSES the
   * background origin for anything that would start new work.
   */
  origin: ExecutionAuthorityOrigin;
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
export const EXECUTION_AUTHORITY_ORIGINS = ["REQUEST", "RECONCILIATION"] as const;
export type ExecutionAuthorityOrigin = (typeof EXECUTION_AUTHORITY_ORIGINS)[number];

/**
 * How long an edge-built authority stays usable.
 *
 * The request deadline the final preflight checks: an authority minted for one
 * HTTP request must not still be authorising a dispatch much later, because the
 * session facts it mirrors (scope, rights, role) may have changed in between.
 * 15 minutes is deliberately generous for a slow interactive request and far
 * shorter than any human decision cadence.
 */
export const AUTHORITY_MAX_AGE_MS = 15 * 60_000;

export type ExecutionAuthorityInput = {
  userId: string;
  /** Defaults to REQUEST — an authority is REQUEST unless it says otherwise. */
  origin?: ExecutionAuthorityOrigin;
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
    origin: input.origin ?? "REQUEST",
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
 * Builds the narrowly typed RECONCILIATION authority.
 *
 * It is NOT an authenticated user and NOT a session: it says, in the type, that
 * the caller is the recovery path acting on work that was already authorised.
 * `assertForegroundAuthority` (below) is what turns that declaration into an
 * enforceable rule, so this builder cannot be used to smuggle background start
 * authority into a dispatch.
 */
export function createReconciliationAuthority(input: {
  /** The recovery component taking responsibility (a code identifier). */
  component: string;
  correlationId?: string;
  requestedAt?: string;
}): ExecutionAuthority {
  const at = input.requestedAt ?? new Date().toISOString();
  return createExecutionAuthority({
    userId: `reconciler:${input.component}`,
    origin: "RECONCILIATION",
    // System identity, not a person: it can never satisfy human authority.
    actorId: `system:${input.component}`,
    actorSlug: `system-${input.component}`,
    actorType: "SYSTEM",
    permissionTokens: [],
    accessibleBusinessSlugs: [],
    isSuperAdmin: false,
    hasOfficeFinanceFull: false,
    requestedAt: at,
    ...(input.correlationId ? { correlationId: input.correlationId } : {}),
  });
}

/** True when this authority may start NEW work. */
export function isForegroundAuthority(authority: ExecutionAuthority): boolean {
  return authority.origin === "REQUEST";
}

/**
 * The fail-closed gate in front of anything that can START a new execution
 * attempt.
 *
 * @throws AUTHORITY_UNRESOLVED when the authority is not an authenticated
 *         REQUEST (a reconciliation authority, or a hand-built object claiming a
 *         shape it did not come from).
 * @throws AUTHORITY_UNRESOLVED when the authority is stale past its deadline.
 */
export function assertForegroundAuthority(
  authority: ExecutionAuthority | null | undefined,
  options: { now?: Date; maxAgeMs?: number } = {},
): ExecutionAuthority {
  if (!authority || typeof authority !== "object") {
    throw new AiWorkforceError(
      "AUTHORITY_UNRESOLVED",
      "Starting a new execution attempt requires a server-created execution authority",
    );
  }
  if (authority.origin !== "REQUEST") {
    throw new AiWorkforceError(
      "AUTHORITY_UNRESOLVED",
      `A "${authority.origin}" authority may observe and adopt work but may never start a new execution attempt`,
      { origin: authority.origin, actorId: authority.actorId ?? null },
    );
  }
  const now = options.now ?? new Date();
  const mintedAt = new Date(authority.requestedAt).getTime();
  if (!Number.isFinite(mintedAt)) {
    throw new AiWorkforceError("AUTHORITY_UNRESOLVED", "The execution authority carries no usable timestamp", {
      requestedAt: authority.requestedAt ?? null,
    });
  }
  const maxAgeMs = options.maxAgeMs ?? AUTHORITY_MAX_AGE_MS;
  if (now.getTime() - mintedAt > maxAgeMs) {
    throw new AiWorkforceError(
      "AUTHORITY_UNRESOLVED",
      `The execution authority expired ${Math.round((now.getTime() - mintedAt - maxAgeMs) / 1000)}s ago; it must be rebuilt from the session`,
      { requestedAt: authority.requestedAt, maxAgeMs },
    );
  }
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
  origin: ExecutionAuthorityOrigin;
  actorId: string;
  actorSlug: string;
  actorType: ActorType;
  correlationId: string;
  isSuperAdmin: boolean;
  businessCount: number;
} {
  return {
    userId: authority.userId,
    origin: authority.origin,
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
