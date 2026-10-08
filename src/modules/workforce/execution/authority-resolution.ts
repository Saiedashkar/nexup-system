import { AiWorkforceError } from "@/modules/ai-workforce/core/errors";
import type { Actor } from "../actors/actor-contracts";
import type { ActorRegistry } from "../actors/actor-registry";
import { authorityCanReachBusiness, type ExecutionAuthority } from "./execution-authority";

/**
 * AUTHORITY RESOLUTION — from an authenticated request to a scoped authority.
 *
 * This module is PROVIDER-NEUTRAL and imports nothing server-specific: no
 * Prisma, no Next.js, no session. The edge supplies the authenticated facts and
 * the two resolvers below; the domain never reads a global session.
 *
 * The two defects it closes, stated precisely:
 *
 *   1. DECISION IDENTITY WAS A CONSTANT. `POST /api/ai-workforce/decisions`
 *      attributed every human decision to the literal `"actor_founder"`, and a
 *      mission's `owner` defaulted to the same constant. A signed-in user was
 *      therefore irrelevant to who "made" a decision.
 *   2. NO BUSINESS SCOPE EVERYWHERE ELSE. No mission read/advance/cancel/decide
 *      was checked against the caller's business scope, so any authenticated
 *      caller could reach any mission.
 *
 * Both answers are now RESOLVED, and both FAIL CLOSED:
 *
 *   user → HUMAN actor   exactly one, or refuse (no fallback impersonation);
 *   object → business    resolved through the authoritative registry, or refuse.
 *
 * Nothing here trusts a payload. The edge builds an `ExecutionAuthority` from
 * the session and hands THIS module only what it should decrypt.
 */

/* ═══════════════════════════════════════════════════════
   user → HUMAN workforce actor
   ═══════════════════════════════════════════════════════ */

/** The registry surface a resolver needs. Structural, so a test can stub it. */
export type ActorDirectory = Pick<ActorRegistry, "get" | "findBySlug">;

/**
 * Resolves one authenticated user id to the single HUMAN workforce actor that
 * represents them.
 *
 * @throws AUTHORITY_UNRESOLVED when there is no mapping, the mapping is
 *         ambiguous, the target actor does not exist, or it is not HUMAN.
 */
export interface HumanActorResolver {
  resolve(userId: string): Promise<Actor>;
}

/**
 * A config-seeded mapping — the documented interim until a durable actor roster
 * exists (which is a later architecture gap, deliberately NOT invented here).
 *
 * `mapping` is `userId → actorId[]`. A list rather than a single id so that
 * AMBIGUITY is representable and therefore refusable: a user mapped to two
 * actors is an inconsistent configuration, not a preference to be resolved.
 *
 * The default (no mapping) maps NOBODY. That is the point: an unmapped user
 * fails closed, rather than silently becoming the Founder.
 */
export function createConfiguredHumanActorResolver(input: {
  directory: ActorDirectory;
  /** userId → one actor id. More than one is an ambiguity and is refused. */
  mapping: Record<string, readonly string[]>;
}): HumanActorResolver {
  return {
    async resolve(userId: string): Promise<Actor> {
      const fail = (message: string, details: Record<string, unknown> = {}): never => {
        throw new AiWorkforceError("AUTHORITY_UNRESOLVED", message, { userId, ...details });
      };

      const actorIds = input.mapping[userId];
      if (!actorIds || actorIds.length === 0) {
        return fail("No workforce actor is mapped to this authenticated user");
      }
      if (actorIds.length > 1) {
        // Ambiguous: refusing is the only safe answer. Choosing one would be an
        // authorisation decision made by a dictionary.
        return fail("More than one workforce actor is mapped to this authenticated user", {
          candidates: [...actorIds],
        });
      }

      const actor = await input.directory.get(actorIds[0]!);
      if (!actor) {
        return fail(`Mapped actor "${actorIds[0]}" is not registered`, { actorId: actorIds[0] });
      }
      if (actor.type !== "HUMAN") {
        // An AI agent, executive or service identity may NEVER be the human
        // authority that decides a review. This is the same rule `ReviewService`
        // enforces on the decider; here it is enforced BEFORE a review is read.
        return fail(`Mapped actor "${actor.slug}" is ${actor.type}; human authority requires a HUMAN actor`, {
          actorId: actor.id,
          actorType: actor.type,
        });
      }
      return actor;
    },
  };
}

/* ═══════════════════════════════════════════════════════
   object → canonical business
   ═══════════════════════════════════════════════════════ */

/**
 * A registered business, as the AUTHORITATIVE registry knows it: a database id
 * AND its slug.
 *
 * Both are kept because the two vocabularies genuinely differ and must not be
 * confused: the session speaks SLUGS (`getAccessibleBusinesses`), while a
 * mission row may carry either. Comparing a raw id to a slug because the fields
 * happen to be named similarly is exactly the bug this type prevents.
 */
export type ResolvedBusiness = {
  id: string;
  slug: string;
};

/**
 * Resolves an opaque business REFERENCE (a slug or a database id) to the
 * registered business it names, or `null` when it names none.
 *
 * The implementation must consult the authoritative business registry (the
 * `Business` table, which owns both id and slug). It must NOT invent a mapping.
 */
export interface BusinessScopeResolver {
  resolve(reference: string): Promise<ResolvedBusiness | null>;
}

/** True when the authority may reach a resolved business. Super-admin mirrors the legacy session. */
export function authorityCanReachResolvedBusiness(
  authority: ExecutionAuthority,
  business: ResolvedBusiness | null | undefined,
): boolean {
  if (!business) return true;
  return authorityCanReachBusiness(authority, business.slug);
}

/**
 * The scope gate for a mission/object's business.
 *
 * @throws BUSINESS_SCOPE_DENIED when the authority does not cover the business.
 *         Externally this becomes a 404-alike; internally the typed reason is
 *         preserved so safe logging can record a scope refusal.
 */
export function assertBusinessScope(
  authority: ExecutionAuthority,
  business: ResolvedBusiness | null | undefined,
): void {
  if (authorityCanReachResolvedBusiness(authority, business)) return;
  throw new AiWorkforceError(
    "BUSINESS_SCOPE_DENIED",
    `This caller's authenticated business scope does not cover "${business?.slug ?? "unknown"}"`,
    {
      actorId: authority.actorId,
      actorType: authority.actorType,
      scope: business?.slug ?? null,
      reason: "BUSINESS_SCOPE_DENIED",
    },
  );
}

/**
 * Narrows a caller-supplied business reference to the authority's own scope.
 *
 * A payload may NARROW its own scope (name a business it already reaches) but may
 * never WIDEN it. Returning the canonical business rather than a boolean keeps
 * the caller honest about which representation it actually authorised.
 *
 * @throws INVALID_INPUT when a reference was supplied but names no registered
 *         business — an unverifiable scope is refused, not ignored.
 * @throws BUSINESS_SCOPE_DENIED when it names a business outside the scope.
 */
export function resolveRequestedBusiness(
  authority: ExecutionAuthority,
  resolver: BusinessScopeResolver | undefined,
  reference: string | undefined,
): Promise<ResolvedBusiness | null> {
  if (!reference) return Promise.resolve(null);
  if (!resolver) {
    // No trusted way to verify the reference: refuse rather than accept a scope
    // the server cannot confirm.
    throw new AiWorkforceError(
      "PERSISTENCE_UNAVAILABLE",
      "A business reference was supplied but no business registry is configured to verify it",
      { reference },
    );
  }
  return resolver.resolve(reference).then((business) => {
    if (!business) {
      throw new AiWorkforceError(
        "INVALID_INPUT",
        `"${reference}" does not name a registered business`,
        { reference },
      );
    }
    assertBusinessScope(authority, business);
    return business;
  });
}
