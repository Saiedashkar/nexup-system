import { AiWorkforceError } from "@/modules/ai-workforce/core/errors";

import type { MissionId, ReviewId } from "../core/refs";
import type { Mission } from "../missions/mission-contracts";
import type { MissionRepository } from "../missions/mission-repository";
import type { MissionService } from "../missions/mission-service";
import type { ReviewService, TaskReview } from "../review/task-review";
import {
  assertBusinessScope,
  type BusinessScopeResolver,
  type ResolvedBusiness,
} from "../execution/authority-resolution";
import type { ExecutionAuthority } from "../execution/execution-authority";

/**
 * MISSION ACCESS — the application-boundary business-scope gate.
 *
 * This is where an `ExecutionAuthority` meets a mission, a review, or a query
 * result and is authorised against the object's BUSINESS. It sits ABOVE the
 * domain (it reads missions and reviews through their ports) and BELOW the API
 * edge (the edge supplies the authority). Nothing here reads a session or an
 * HTTP request, so the domain stays testable without either.
 *
 * THE CANONICAL SCOPE QUESTION. A mission stores an opaque `businessId`; the
 * session speaks business SLUGS. Those are two vocabularies, and they are NOT
 * interchangeable. So this service never compares them directly: it asks the
 * authoritative registry to resolve the mission's reference to `{ id, slug }`
 * and authorises the resolved SLUG. A mission that carries no business is
 * office-wide (there is no business to be denied), matching `PermissionPolicy`.
 *
 * FAIL CLOSED. If a mission names a business the server cannot resolve — because
 * no registry is configured, or the reference matches no registered business —
 * the mission is NOT treated as unscoped. It is refused (single object) or
 * excluded (list), because an unverifiable scope is not an absent one.
 */

export type MissionAccessDeps = {
  missions: MissionService;
  missionList: MissionRepository;
  reviews: ReviewService;
  /** The authoritative business registry. Absent = no business can be verified. */
  businesses?: BusinessScopeResolver;
};

export type ReviewAccess = {
  review: TaskReview;
  mission: Mission;
};

export class MissionAccessService {
  constructor(private readonly deps: MissionAccessDeps) {}

  /** Resolve a caller-supplied business reference (slug or id). Null when none supplied. */
  async resolveBusiness(reference: string | undefined): Promise<ResolvedBusiness | null> {
    if (!reference) return null;
    if (!this.deps.businesses) {
      throw new AiWorkforceError(
        "PERSISTENCE_UNAVAILABLE",
        "A business reference was supplied but no business registry is configured to verify it",
        { reference },
      );
    }
    return this.deps.businesses.resolve(reference);
  }

  /**
   * The canonical business of a mission, or `null` for an office-wide mission.
   * @throws BUSINESS_SCOPE_DENIED when the mission names a business that cannot
   *         be resolved (an unverifiable scope is refused, never assumed open).
   */
  async businessOf(mission: Mission): Promise<ResolvedBusiness | null> {
    if (!mission.businessId) return null;
    const resolved = this.deps.businesses ? await this.deps.businesses.resolve(mission.businessId) : null;
    if (!resolved) {
      throw new AiWorkforceError(
        "BUSINESS_SCOPE_DENIED",
        `Mission "${mission.id}" names business "${mission.businessId}", which cannot be verified against the business registry`,
        { missionId: mission.id, businessRef: mission.businessId, reason: "BUSINESS_SCOPE_DENIED" },
      );
    }
    return resolved;
  }

  /** @throws BUSINESS_SCOPE_DENIED when the authority does not cover the mission's business. */
  async authorizeMission(authority: ExecutionAuthority, mission: Mission): Promise<ResolvedBusiness | null> {
    const business = await this.businessOf(mission);
    assertBusinessScope(authority, business);
    return business;
  }

  /**
   * Loads a mission and authorises it in one step.
   * @throws MISSION_NOT_FOUND | BUSINESS_SCOPE_DENIED
   */
  async authorizeMissionById(authority: ExecutionAuthority, missionId: MissionId): Promise<Mission> {
    const mission = await this.deps.missions.require(missionId);
    await this.authorizeMission(authority, mission);
    return mission;
  }

  /**
   * `authorizeMissionById`, but a scope refusal is reported with the SAME
   * external shape as a mission that does not exist.
   *
   * The route returns the error CODE in its body, so leaving them distinct
   * would reveal that the mission EXISTS but is out of scope — the very thing a
   * 404-alike is meant to hide. Redacting here keeps the typed reason available
   * (via `authorizeMissionById`) for safe internal logging while making "not
   * yours" and "does not exist" indistinguishable on the wire.
   *
   * @throws MISSION_NOT_FOUND for both an unknown mission and a cross-business one.
   */
  async authorizeMissionByIdForCaller(authority: ExecutionAuthority, missionId: MissionId): Promise<Mission> {
    try {
      return await this.authorizeMissionById(authority, missionId);
    } catch (error) {
      if (error instanceof AiWorkforceError && error.code === "BUSINESS_SCOPE_DENIED") {
        throw new AiWorkforceError("MISSION_NOT_FOUND", `Mission "${missionId}" does not exist`, { missionId });
      }
      throw error;
    }
  }

  /**
   * `authorizeReview`, but a scope refusal is reported with the SAME external
   * shape as a review that does not exist (`APPROVAL_NOT_FOUND`).
   *
   * @throws APPROVAL_NOT_FOUND for an unknown review, a review whose mission is
   *         unknown, and a cross-business one.
   */
  async authorizeReviewForCaller(authority: ExecutionAuthority, reviewId: ReviewId): Promise<ReviewAccess> {
    try {
      return await this.authorizeReview(authority, reviewId);
    } catch (error) {
      if (error instanceof AiWorkforceError && error.code === "BUSINESS_SCOPE_DENIED") {
        throw new AiWorkforceError("APPROVAL_NOT_FOUND", `Review "${reviewId}" does not exist`, { reviewId });
      }
      throw error;
    }
  }

  /**
   * Loads a review, its mission, and authorises the mission's business.
   *
   * The review → mission → business walk is done SERVER-SIDE, so a cross-business
   * review id cannot leak object existence: an unknown review and a review in
   * another business are both refused (the edge makes them both 404-alike).
   *
   * @throws APPROVAL_NOT_FOUND | MISSION_NOT_FOUND | BUSINESS_SCOPE_DENIED
   */
  async authorizeReview(authority: ExecutionAuthority, reviewId: ReviewId): Promise<ReviewAccess> {
    const review = await this.deps.reviews.get(reviewId);
    if (!review) {
      throw new AiWorkforceError("APPROVAL_NOT_FOUND", `Review "${reviewId}" does not exist`, { reviewId });
    }
    const mission = await this.deps.missions.require(review.missionId);
    await this.authorizeMission(authority, mission);
    return { review, mission };
  }

  /**
   * The mission IDs this authority may see, for filtering LIST surfaces
   * server-side. `null` means "all" (super-admin, whose legacy session already
   * covers every business).
   *
   * A mission whose business cannot be resolved is EXCLUDED, never included.
   */
  async authorizedMissionIds(authority: ExecutionAuthority, limit = 200): Promise<Set<MissionId> | null> {
    if (authority.isSuperAdmin) return null;
    const missions = await this.deps.missionList.list(limit);
    const allowed = new Set<MissionId>();
    for (const mission of missions) {
      try {
        const business = await this.businessOf(mission);
        if (!mission.businessId || (business && this.covers(authority, business))) allowed.add(mission.id);
      } catch {
        // Unverifiable business → excluded. Fail closed, silently for the list.
      }
    }
    return allowed;
  }

  /** True when `ids` is null (all) or contains the id. */
  static allows(ids: Set<MissionId> | null, missionId: MissionId | undefined): boolean {
    if (!missionId) return false;
    return ids === null || ids.has(missionId);
  }

  private covers(authority: ExecutionAuthority, business: ResolvedBusiness): boolean {
    return authority.isSuperAdmin || authority.accessibleBusinessSlugs.includes(business.slug);
  }
}

/**
 * The EDGE's command builder — the one place payload meets authority for a
 * mission command.
 *
 * The rule the Command Center already stated for `requestedBy` is extended to
 * every identity field: the SESSION owns identity, the PAYLOAD owns the work.
 * The returned raw command therefore takes `requestedBy` from the authority and
 * IGNORES any payload value, drops payload `userId`/`actorId`/`permissions`
 * entirely (they are not part of a command), and accepts `owner` ONLY when it
 * already equals the resolved caller. `businessId` is set from the business that
 * was resolved AND authorised — never from the raw payload string.
 *
 * VOCABULARY. Three identity fields are set here, and the two vocabularies are
 * kept apart deliberately:
 *
 *   requestedBy — the authenticated USER id   (`authority.userId`)
 *   createdBy   — the resolved ACTOR id       (`authority.actorId`)
 *   owner       — the resolved ACTOR id       (`authority.actorId`)
 *
 * `createdBy`/`owner` are actor fields (a mission's `owner` is resolved to a
 * HUMAN actor when its review is raised), so putting a UserId in either would be
 * the exact mixture the architecture audit flagged. They are never the same
 * string by accident — the focused tests use ids that differ.
 *
 * @throws PERMISSION_DENIED when a payload tries to widen `owner` (there is no
 *         server-side delegation policy to permit it).
 * @throws INVALID_INPUT when there is no authenticated user to attribute to.
 */
export function buildAuthorizedMissionCommand(input: {
  body: Record<string, unknown>;
  authority: ExecutionAuthority;
  business: ResolvedBusiness | null;
  defaultScope?: string;
}): Record<string, unknown> {
  const { body, authority, business } = input;

  if (!authority.userId) {
    throw new AiWorkforceError("AUTHORITY_UNRESOLVED", "A mission command requires an authenticated user");
  }

  // `owner`: server-derived from the resolved authorized actor. A payload may
  // repeat it, but it may not name anyone else — that would be impersonation,
  // and no delegation rule exists to authorise it.
  const requestedOwner = typeof body.owner === "string" ? body.owner.trim() : "";
  if (requestedOwner && requestedOwner !== authority.actorId) {
    throw new AiWorkforceError(
      "PERMISSION_DENIED",
      "A mission owner may not be chosen by the caller; it is derived from the authenticated actor",
      { requestedOwner, actorId: authority.actorId },
    );
  }

  const scope =
    typeof body.scope === "string" && body.scope.trim() ? body.scope : (input.defaultScope ?? `user:${authority.userId}`);

  // Drop the raw reference: `businessId` is taken ONLY from the business that
  // was resolved and authorised, never from the payload string. A caller cannot
  // smuggle an unverified business id past the scope check this way.
  const rest: Record<string, unknown> = { ...body };
  delete rest.businessId;
  delete rest.businessSlug;
  // Identity-looking payload keys are dropped entirely. They are not part of a
  // command, and leaving them on the object would invite a later field to be
  // read from the payload by accident.
  for (const key of ["userId", "actorId", "actorSlug", "actorType", "permissions", "permissionTokens"]) {
    delete rest[key];
  }

  return {
    ...rest,
    // Identity, from the session and the resolved actor — never from the body.
    // `requestedBy` is the USER id; `createdBy`/`owner` are the ACTOR id, so the
    // two vocabularies can never be collapsed into one field.
    requestedBy: authority.userId,
    createdBy: authority.actorId,
    owner: authority.actorId,
    scope,
    // The CANONICAL registry id, from the business that was resolved AND
    // authorised — never the raw payload reference.
    ...(business ? { businessId: business.id } : {}),
  };
}
