import { describe, expect, it } from "vitest";

import { AiWorkforceError } from "@/modules/ai-workforce/core/errors";
import { workforceErrorResponse } from "@/modules/ai-workforce/adapters/api-response";
import { createWorkforceDomain, type WorkforceDomain } from "@/modules/workforce";
import {
  authorityCanReachResolvedBusiness,
  createConfiguredHumanActorResolver,
  resolveRequestedBusiness,
  type ResolvedBusiness,
} from "@/modules/workforce/execution/authority-resolution";
import { createExecutionAuthority } from "@/modules/workforce/execution/execution-authority";
import { authorityFromAuthenticatedActor } from "@/modules/workforce/execution/session-authority";
import {
  buildAuthorizedMissionCommand,
  MissionAccessService,
} from "@/modules/workforce/application/mission-access";
import {
  commandFingerprint,
  parseMissionCommand,
} from "@/modules/workforce/application/command-contracts";
import {
  parseProofHumanActors,
  parseUserActorMap,
  resolveApplicationRuntime,
  WORKFORCE_PROOF_HUMAN_ACTORS_ENV,
  WORKFORCE_TEST_TRANSPORT_ENV,
} from "@/modules/workforce/application/runtime";
import type { PersistenceResolution } from "@/modules/ai-workforce/policies/persistence-safety";
import type { ActorContext } from "@/modules/ai-workforce/core/execution-context";

/**
 * STEP 5A-3 — authenticated authority + HUMAN actor resolution + business scope.
 *
 * These tests are the DEFECT REGRESSION SUITE for the two holes 5A-3 closes:
 *
 *   1. a human decision was attributed to the constant `"actor_founder"`;
 *   2. no mission read/advance/decide was checked against the caller's business.
 *
 * They run entirely OFFLINE, over the in-memory domain and a fake business
 * registry — the same seams the running application composes with Prisma. No
 * runtime, no provider, no database: this batch changes AUTHORITY, not dispatch.
 */

/* ══════════════════════════════════════════════════════
   Harness
   ══════════════════════════════════════════════════════ */

const NEXUP = "nexup";
const REBOUND = "rebound";

/** The authoritative registry, as a test double. The real one is Prisma-backed. */
const REGISTRY: Record<string, ResolvedBusiness> = {
  nexup: { id: "biz_nexup_1", slug: NEXUP },
  rebound: { id: "biz_rebound_1", slug: REBOUND },
};

const businesses = {
  async resolve(reference: string): Promise<ResolvedBusiness | null> {
    const value = reference.trim();
    return Object.values(REGISTRY).find((row) => row.id === value || row.slug === value) ?? null;
  },
};

function actorContext(overrides: Partial<ActorContext> = {}): ActorContext {
  return {
    userId: "user_ada",
    name: "Ada",
    role: "ADMIN",
    isSuperAdmin: false,
    hasOfficeFinanceFull: false,
    accessibleBusinessSlugs: [NEXUP],
    permissionTokens: ["aiworkforce.access", "clients.read"],
    ...overrides,
  };
}

async function domainWithHumans(): Promise<WorkforceDomain> {
  const domain = createWorkforceDomain({ seedExecutive: true });
  await domain.actors.register({
    id: "actor_ada",
    slug: "ada",
    displayName: "Ada",
    type: "HUMAN",
    role: "lead",
    department: null,
    reportsTo: null,
    collaborators: [],
    lifecycle: "APPROVED_AUTONOMY",
    runtimeBinding: null,
    modelPolicy: null,
    autonomyLevel: "AUTONOMOUS",
    memoryScope: { scope: "NONE", retention: "EPHEMERAL" },
    permissions: [{ permission: "aiworkforce.access" }],
    approvalPolicy: { mode: "NEVER" },
    escalationTarget: null,
    metadata: {},
  });
  return domain;
}

/** A mission with a business, written straight into the domain. */
async function missionIn(domain: WorkforceDomain, businessId: string | undefined) {
  return domain.missions.create({
    title: "Q3 brief",
    goal: "summarise Q3",
    createdBy: "user_ada",
    owner: "actor_ada",
    ...(businessId ? { businessId } : {}),
  });
}

function accessFor(domain: WorkforceDomain): MissionAccessService {
  return new MissionAccessService({
    missions: domain.missions,
    missionList: domain.missionRepository,
    reviews: domain.reviews,
    businesses,
  });
}

/* ══════════════════════════════════════════════════════
   1–3. user → HUMAN actor; authority from the session
   ══════════════════════════════════════════════════════ */

describe("Step 5A-3 — authority is derived from the authenticated session", () => {
  it("resolves the authenticated user to the correct HUMAN actor (3)", async () => {
    const domain = await domainWithHumans();
    const humanActors = createConfiguredHumanActorResolver({
      directory: domain.actors,
      mapping: { user_ada: ["actor_ada"] },
    });

    const authority = await authorityFromAuthenticatedActor({ actor: actorContext(), humanActors });

    expect(authority.userId).toBe("user_ada");
    expect(authority.actorId).toBe("actor_ada");
    expect(authority.actorSlug).toBe("ada");
    expect(authority.actorType).toBe("HUMAN");
  });

  it("takes permission tokens and business scope from the session, not the actor row (1)", async () => {
    const domain = await domainWithHumans();
    const humanActors = createConfiguredHumanActorResolver({
      directory: domain.actors,
      mapping: { user_ada: ["actor_ada"] },
    });

    const authority = await authorityFromAuthenticatedActor({
      actor: actorContext({ accessibleBusinessSlugs: [REBOUND], isSuperAdmin: false }),
      humanActors,
    });

    // The actor RECORD carries no business grant; the session does.
    expect(authority.accessibleBusinessSlugs).toEqual([REBOUND]);
    expect(authorityCanReachResolvedBusiness(authority, REGISTRY[REBOUND]!)).toBe(true);
    expect(authorityCanReachResolvedBusiness(authority, REGISTRY[NEXUP]!)).toBe(false);
  });

  it("fails closed when the user maps to no HUMAN actor (4)", async () => {
    const domain = await domainWithHumans();
    const empty = createConfiguredHumanActorResolver({ directory: domain.actors, mapping: {} });

    await expect(authorityFromAuthenticatedActor({ actor: actorContext(), humanActors: empty })).rejects.toMatchObject({
      code: "AUTHORITY_UNRESOLVED",
    });
  });

  it("refuses a mapping that resolves to a non-HUMAN actor (5)", async () => {
    const domain = await domainWithHumans();
    // `actor_exec` is a seeded EXECUTIVE — never a human decision authority.
    const toExec = createConfiguredHumanActorResolver({
      directory: domain.actors,
      mapping: { user_ada: ["actor_exec"] },
    });

    await expect(authorityFromAuthenticatedActor({ actor: actorContext(), humanActors: toExec })).rejects.toMatchObject({
      code: "AUTHORITY_UNRESOLVED",
    });
  });

  it("refuses an ambiguous mapping rather than choosing one (5)", async () => {
    const domain = await domainWithHumans();
    const ambiguous = createConfiguredHumanActorResolver({
      directory: domain.actors,
      mapping: { user_ada: ["actor_ada", "actor_founder"] },
    });

    await expect(
      authorityFromAuthenticatedActor({ actor: actorContext(), humanActors: ambiguous }),
    ).rejects.toMatchObject({ code: "AUTHORITY_UNRESOLVED" });
  });

  it("is NOT hard-coded to actor_founder: decidedBy follows the mapping (6)", async () => {
    const domain = await domainWithHumans();
    const humanActors = createConfiguredHumanActorResolver({
      directory: domain.actors,
      mapping: { user_ada: ["actor_ada"] },
    });

    const authority = await authorityFromAuthenticatedActor({ actor: actorContext(), humanActors });
    expect(authority.actorId).not.toBe("actor_founder");
    expect(authority.actorId).toBe("actor_ada");
  });
});

/* ══════════════════════════════════════════════════════
   2, 7, 13. a payload can never widen authority
   ══════════════════════════════════════════════════════ */

describe("Step 5A-3 — payload data cannot widen authority", () => {
  const authority = createExecutionAuthority({
    userId: "user_ada",
    actorId: "actor_ada",
    actorSlug: "ada",
    actorType: "HUMAN",
    permissionTokens: ["aiworkforce.access"],
    accessibleBusinessSlugs: [NEXUP],
    isSuperAdmin: false,
    hasOfficeFinanceFull: false,
  });

  it("ignores userId/actorId/permissions and takes identity from the authority (1, 2)", () => {
    const command = buildAuthorizedMissionCommand({
      body: {
        title: "t",
        goal: "g",
        requestedBy: "attacker",
        userId: "someone_else",
        actorId: "actor_root",
        permissions: ["aiworkforce.access", "capital.approve"],
        businessId: "biz_rebound_1",
      },
      authority,
      business: REGISTRY[NEXUP]!,
    });

    // VOCABULARY. `user_ada` (USER id) and `actor_ada` (ACTOR id) are deliberately
    // different strings, so a substitution of one for the other cannot pass.
    expect(command.requestedBy).toBe("user_ada");
    expect(command.createdBy).toBe("actor_ada");
    expect(command.owner).toBe("actor_ada");
    expect(command.requestedBy).not.toBe(command.createdBy);
    // The unverified payload business id is dropped in favour of the AUTHORIZED one.
    expect(command.businessId).toBe(REGISTRY[NEXUP]!.id);
    expect(command.permissions).toBeUndefined();
    expect(command.actorId).toBeUndefined();
  });

  it("refuses an arbitrary payload owner (7)", () => {
    let caught: unknown;
    try {
      buildAuthorizedMissionCommand({
        body: { title: "t", goal: "g", owner: "actor_founder" },
        authority,
        business: null,
      });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(AiWorkforceError);
    expect((caught as AiWorkforceError).code).toBe("PERMISSION_DENIED");
  });

  it("lets a payload NARROW scope but never widen it (13)", async () => {
    // NARROW: names a business the caller already reaches.
    const narrowed = await resolveRequestedBusiness(authority, businesses, NEXUP);
    expect(narrowed?.slug).toBe(NEXUP);

    // WIDEN: names one outside the caller's scope → refused.
    await expect(resolveRequestedBusiness(authority, businesses, REBOUND)).rejects.toMatchObject({
      code: "BUSINESS_SCOPE_DENIED",
    });

    // UNVERIFIABLE: names nothing registered → refused, never ignored.
    await expect(resolveRequestedBusiness(authority, businesses, "made-up")).rejects.toMatchObject({
      code: "INVALID_INPUT",
    });
  });
});

/* ══════════════════════════════════════════════════════
   8–14, 16. business scope over mission/review surfaces
   ══════════════════════════════════════════════════════ */

describe("Step 5A-3 — business scope on mission surfaces", () => {
  const nexupAuthority = createExecutionAuthority({
    userId: "user_ada",
    actorId: "actor_ada",
    actorSlug: "ada",
    actorType: "HUMAN",
    permissionTokens: ["aiworkforce.access"],
    accessibleBusinessSlugs: [NEXUP],
    isSuperAdmin: false,
    hasOfficeFinanceFull: false,
  });
  const reboundAuthority = createExecutionAuthority({
    userId: "user_bob",
    actorId: "actor_bob",
    actorSlug: "bob",
    actorType: "HUMAN",
    permissionTokens: ["aiworkforce.access"],
    accessibleBusinessSlugs: [REBOUND],
    isSuperAdmin: false,
    hasOfficeFinanceFull: false,
  });

  it("authorizes a mission inside the caller's business (8)", async () => {
    const domain = await domainWithHumans();
    const mission = await missionIn(domain, REGISTRY[NEXUP]!.id);
    const access = accessFor(domain);

    // Read, advance and cancel all sit behind the SAME authorization.
    await expect(access.authorizeMissionById(nexupAuthority, mission.id)).resolves.toMatchObject({ id: mission.id });
  });

  it("refuses a mission in another business — 404-alike externally (9, 10)", async () => {
    const domain = await domainWithHumans();
    const mission = await missionIn(domain, REGISTRY[NEXUP]!.id);
    const access = accessFor(domain);

    let caught: unknown;
    try {
      await access.authorizeMissionById(reboundAuthority, mission.id);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(AiWorkforceError);
    expect((caught as AiWorkforceError).code).toBe("BUSINESS_SCOPE_DENIED");

    // The SAME typed reason maps to 404 externally, so existence is not revealed.
    expect(workforceErrorResponse(caught, "fallback").status).toBe(404);
  });

  it("refuses a review in another business — 404-alike externally (11)", async () => {
    const domain = await domainWithHumans();
    const mission = await missionIn(domain, REGISTRY[NEXUP]!.id);
    const review = await domain.reviews.request({
      taskId: "task_1",
      missionId: mission.id,
      executionRecordId: "exec_1",
      summary: "a result to accept",
      requestedBy: "actor_ada",
    });
    const access = accessFor(domain);

    await expect(access.authorizeReview(reboundAuthority, review.id)).rejects.toMatchObject({
      code: "BUSINESS_SCOPE_DENIED",
    });
    // An UNKNOWN review and a cross-business one are both refusals — neither leaks.
    await expect(access.authorizeReview(reboundAuthority, "review_missing")).rejects.toMatchObject({
      code: "APPROVAL_NOT_FOUND",
    });
  });

  it("filters LIST surfaces to authorized businesses server-side (12)", async () => {
    const domain = await domainWithHumans();
    const nexupMission = await missionIn(domain, REGISTRY[NEXUP]!.id);
    const reboundMission = await missionIn(domain, REGISTRY[REBOUND]!.id);
    const access = accessFor(domain);

    const visible = await access.authorizedMissionIds(nexupAuthority, 50);
    expect(MissionAccessService.allows(visible, nexupMission.id)).toBe(true);
    expect(MissionAccessService.allows(visible, reboundMission.id)).toBe(false);
  });

  it("resolves ID ↔ slug canonically, so a mission may name either (14)", async () => {
    const domain = await domainWithHumans();
    const access = accessFor(domain);

    // Stored as a DATABASE ID — the session's SLUG must still authorize it.
    const byId = await missionIn(domain, REGISTRY[NEXUP]!.id);
    await expect(access.authorizeMission(nexupAuthority, byId)).resolves.toMatchObject({ slug: NEXUP });

    // Stored as a SLUG — the same authority still authorizes it.
    const bySlug = await missionIn(domain, NEXUP);
    await expect(access.authorizeMission(nexupAuthority, bySlug)).resolves.toMatchObject({ id: REGISTRY[NEXUP]!.id });
  });

  it("treats an office-wide mission (no business) as reachable (8, 17)", async () => {
    const domain = await domainWithHumans();
    const mission = await missionIn(domain, undefined);
    const access = accessFor(domain);
    await expect(access.authorizeMission(nexupAuthority, mission)).resolves.toBeNull();
  });

  it("fails closed when a mission names a business that cannot be verified (16)", async () => {
    const domain = await domainWithHumans();
    const mission = await missionIn(domain, "biz_that_does_not_exist");
    const access = accessFor(domain);

    await expect(access.authorizeMission(nexupAuthority, mission)).rejects.toMatchObject({
      code: "BUSINESS_SCOPE_DENIED",
    });
    // ...and a composition with NO registry at all cannot verify ANY business.
    const noRegistry = new MissionAccessService({
      missions: domain.missions,
      missionList: domain.missionRepository,
      reviews: domain.reviews,
    });
    await expect(noRegistry.authorizeMission(nexupAuthority, mission)).rejects.toMatchObject({
      code: "BUSINESS_SCOPE_DENIED",
    });
  });

  it("permits a super-admin across businesses, mirroring the legacy session (8)", async () => {
    const domain = await domainWithHumans();
    const mission = await missionIn(domain, REGISTRY[REBOUND]!.id);
    const access = accessFor(domain);

    const superAdmin = createExecutionAuthority({
      userId: "user_root",
      actorId: "actor_root",
      actorSlug: "root",
      actorType: "HUMAN",
      permissionTokens: ["aiworkforce.access"],
      accessibleBusinessSlugs: [],
      isSuperAdmin: true,
      hasOfficeFinanceFull: true,
    });
    await expect(access.authorizeMission(superAdmin, mission)).resolves.toMatchObject({ slug: REBOUND });
    expect(await access.authorizedMissionIds(superAdmin, 50)).toBeNull();
  });

  it("does not dispatch anything merely by authorizing (18)", async () => {
    const domain = await domainWithHumans();
    const mission = await missionIn(domain, REGISTRY[NEXUP]!.id);
    const access = accessFor(domain);

    await access.authorizeMission(nexupAuthority, mission);
    // Authorization is a READ. No execution record may appear as a side effect.
    expect(await domain.executionRecords.list()).toHaveLength(0);
  });
});

/* ══════════════════════════════════════════════════════
   15. the resolved HUMAN actor is what gets persisted
   ══════════════════════════════════════════════════════ */

describe("Step 5A-3 — a cross-business object is indistinguishable from a missing one", () => {
  const nexupAuthority = createExecutionAuthority({
    userId: "user_ada",
    actorId: "actor_ada",
    actorSlug: "ada",
    actorType: "HUMAN",
    permissionTokens: ["aiworkforce.access"],
    accessibleBusinessSlugs: [NEXUP],
    isSuperAdmin: false,
    hasOfficeFinanceFull: false,
  });
  const reboundAuthority = createExecutionAuthority({
    userId: "user_bob",
    actorId: "actor_bob",
    actorSlug: "bob",
    actorType: "HUMAN",
    permissionTokens: ["aiworkforce.access"],
    accessibleBusinessSlugs: [REBOUND],
    isSuperAdmin: false,
    hasOfficeFinanceFull: false,
  });

  it("reports a cross-business mission as MISSION_NOT_FOUND, exactly like a missing one", async () => {
    const domain = await domainWithHumans();
    const mission = await missionIn(domain, REGISTRY[NEXUP]!.id);
    const access = accessFor(domain);

    const cross = await access
      .authorizeMissionByIdForCaller(reboundAuthority, mission.id)
      .catch((error: unknown) => error);
    const missing = await access
      .authorizeMissionByIdForCaller(reboundAuthority, "mission_absent")
      .catch((error: unknown) => error);

    // The external vocabulary is identical: same code, so existence is not leaked.
    expect((cross as AiWorkforceError).code).toBe("MISSION_NOT_FOUND");
    expect((missing as AiWorkforceError).code).toBe("MISSION_NOT_FOUND");
    expect(workforceErrorResponse(cross, "x").status).toBe(404);
    expect(workforceErrorResponse(missing, "x").status).toBe(404);
  });

  it("reports a cross-business review as APPROVAL_NOT_FOUND, exactly like a missing one", async () => {
    const domain = await domainWithHumans();
    const mission = await missionIn(domain, REGISTRY[NEXUP]!.id);
    const review = await domain.reviews.request({
      taskId: "task_1",
      missionId: mission.id,
      executionRecordId: "exec_1",
      summary: "a result to accept",
      requestedBy: "actor_ada",
    });
    const access = accessFor(domain);

    const cross = await access
      .authorizeReviewForCaller(reboundAuthority, review.id)
      .catch((error: unknown) => error);
    const missing = await access
      .authorizeReviewForCaller(reboundAuthority, "review_absent")
      .catch((error: unknown) => error);

    expect((cross as AiWorkforceError).code).toBe("APPROVAL_NOT_FOUND");
    expect((missing as AiWorkforceError).code).toBe("APPROVAL_NOT_FOUND");
    // ...while the SAME authority still reaches its OWN business's review.
    const own = await domain.reviews.request({
      taskId: "task_2",
      missionId: (await missionIn(domain, REGISTRY[REBOUND]!.id)).id,
      executionRecordId: "exec_2",
      summary: "a rebound result",
      requestedBy: "actor_bob",
    });
    await expect(access.authorizeReviewForCaller(reboundAuthority, own.id)).resolves.toMatchObject({
      mission: { id: expect.any(String) },
    });
    // (and nexupAuthority is untouched by all of the above)
    await expect(access.authorizeMissionByIdForCaller(nexupAuthority, mission.id)).resolves.toMatchObject({
      id: mission.id,
    });
  });
});

describe("Step 5A-3 — the resolved HUMAN actor is persisted as decidedBy", () => {
  it("records the authenticated actor, and refuses a non-HUMAN decider (5, 15)", async () => {
    const domain = await domainWithHumans();
    const review = await domain.reviews.request({
      taskId: "task_1",
      missionId: "mission_1",
      executionRecordId: "exec_1",
      summary: "a result to accept",
      requestedBy: "actor_ada",
    });

    const stored = await domain.reviews.decide(review.id, { decision: "APPROVED", decidedBy: "actor_ada" });
    expect(stored.decidedBy).toBe("actor_ada");
    expect(stored.decidedBy).not.toBe("actor_founder");

    // A non-HUMAN actor may never decide, even if it exists.
    const second = await domain.reviews.request({
      taskId: "task_2",
      missionId: "mission_1",
      executionRecordId: "exec_2",
      summary: "another result",
      requestedBy: "actor_ada",
    });
    await expect(
      domain.reviews.decide(second.id, { decision: "APPROVED", decidedBy: "actor_exec" }),
    ).rejects.toMatchObject({ code: "APPROVAL_FORBIDDEN" });
  });
});

/* ══════════════════════════════════════════════════════
   The external refusal vocabulary
   ══════════════════════════════════════════════════════ */

describe("Step 5A-3 — external status for an internal typed denial", () => {
  it("maps a missing mission to 404 and a scope denial to a 404-alike", () => {
    expect(workforceErrorResponse(new AiWorkforceError("MISSION_NOT_FOUND", "gone"), "x").status).toBe(404);
    expect(workforceErrorResponse(new AiWorkforceError("BUSINESS_SCOPE_DENIED", "no"), "x").status).toBe(404);
    expect(workforceErrorResponse(new AiWorkforceError("AUTHORITY_UNRESOLVED", "no"), "x").status).toBe(403);
  });
});

/* ══════════════════════════════════════════════════════
   V. IDENTITY VOCABULARY — userId and actorId are not
      interchangeable, at parse, at fingerprint, at persist
   ══════════════════════════════════════════════════════ */

describe("Step 5A-3 — identity vocabulary is enforced, not assumed", () => {
  it("parses requestedBy (USER) and createdBy/owner (ACTOR) as separate fields", () => {
    const command = parseMissionCommand({
      idempotencyKey: "k",
      scope: "s",
      title: "t",
      goal: "g",
      requestedBy: "user_1",
      createdBy: "actor_1",
      owner: "actor_1",
      tasks: [{ title: "a", objective: "b" }],
    });
    expect(command.requestedBy).toBe("user_1");
    expect(command.createdBy).toBe("actor_1");
    expect(command.owner).toBe("actor_1");
  });

  it("fingerprints the two vocabularies differently, so a swap is a different command", () => {
    const base = {
      idempotencyKey: "k",
      scope: "s",
      title: "t",
      goal: "g",
      requestedBy: "user_1",
      createdBy: "actor_1",
      owner: "actor_1",
      tasks: [{ title: "a", objective: "b" }],
    };
    const correct = parseMissionCommand(base);
    const swapped = parseMissionCommand({ ...base, requestedBy: "actor_1", createdBy: "user_1" });
    expect(commandFingerprint(swapped)).not.toBe(commandFingerprint(correct));
  });

  it("persists the ACTOR id as createdBy/owner, never the USER id", async () => {
    const domain = await domainWithHumans();
    const authority = createExecutionAuthority({
      userId: "user_ada",
      actorId: "actor_ada",
      actorSlug: "ada",
      actorType: "HUMAN",
      permissionTokens: ["aiworkforce.access"],
      accessibleBusinessSlugs: [NEXUP],
      isSuperAdmin: false,
      hasOfficeFinanceFull: false,
    });
    const resolved = await resolveRequestedBusiness(authority, businesses, NEXUP);
    const command = buildAuthorizedMissionCommand({
      body: { title: "t", goal: "g" },
      authority,
      business: resolved,
    });

    // The edge builder is the one place the payload meets identity; the mission
    // it produces must carry the ACTOR id, not the USER id.
    const mission = await domain.missions.create({
      title: command.title as string,
      goal: command.goal as string,
      createdBy: command.createdBy as string,
      owner: command.owner as string,
      businessId: command.businessId as string,
    });
    expect(mission.createdBy).toBe("actor_ada");
    expect(mission.owner).toBe("actor_ada");
    expect(mission.createdBy).not.toBe("user_ada");
    expect(mission.businessId).toBe(REGISTRY[NEXUP]!.id);
  });
});

/* ══════════════════════════════════════════════════════
   VI. CANONICAL BUSINESS WRITE — slug and id converge
   ══════════════════════════════════════════════════════ */

describe("Step 5A-3 — new missions converge on the canonical Business identity", () => {
  const authority = createExecutionAuthority({
    userId: "user_ada",
    actorId: "actor_ada",
    actorSlug: "ada",
    actorType: "HUMAN",
    permissionTokens: ["aiworkforce.access"],
    accessibleBusinessSlugs: [NEXUP],
    isSuperAdmin: false,
    hasOfficeFinanceFull: false,
  });

  it("writes the SAME canonical id whether the request named the slug or the id", async () => {
    const bySlug = await resolveRequestedBusiness(authority, businesses, NEXUP);
    const byId = await resolveRequestedBusiness(authority, businesses, REGISTRY[NEXUP]!.id);

    expect(bySlug?.id).toBe(REGISTRY[NEXUP]!.id);
    expect(byId?.id).toBe(REGISTRY[NEXUP]!.id);
    // Same Business ⇒ same slug AND same id ⇒ identical authorization semantics.
    expect(bySlug?.slug).toBe(byId?.slug);

    const slugCommand = buildAuthorizedMissionCommand({
      body: { title: "t", goal: "g", businessId: NEXUP },
      authority,
      business: bySlug,
    });
    const idCommand = buildAuthorizedMissionCommand({
      body: { title: "t", goal: "g", businessId: REGISTRY[NEXUP]!.id },
      authority,
      business: byId,
    });
    expect(slugCommand.businessId).toBe(REGISTRY[NEXUP]!.id);
    expect(idCommand.businessId).toBe(REGISTRY[NEXUP]!.id);
    expect(slugCommand.businessId).toBe(idCommand.businessId);
  });

  it("refuses an unauthorized reference (by slug AND by id) and an unknown one", async () => {
    await expect(resolveRequestedBusiness(authority, businesses, REBOUND)).rejects.toMatchObject({
      code: "BUSINESS_SCOPE_DENIED",
    });
    await expect(resolveRequestedBusiness(authority, businesses, REGISTRY[REBOUND]!.id)).rejects.toMatchObject({
      code: "BUSINESS_SCOPE_DENIED",
    });
    await expect(resolveRequestedBusiness(authority, businesses, "not-a-business")).rejects.toMatchObject({
      code: "INVALID_INPUT",
    });
    await expect(resolveRequestedBusiness(authority, businesses, "biz_unknown_1")).rejects.toMatchObject({
      code: "INVALID_INPUT",
    });
  });

  it("cannot manufacture a business: an outside-scope payload id is dropped, never written", () => {
    // The caller is authorized for nexup, but names rebound in the payload.
    const authorized = REGISTRY[NEXUP]!;
    const command = buildAuthorizedMissionCommand({
      body: { title: "t", goal: "g", businessId: REGISTRY[REBOUND]!.id },
      authority,
      business: authorized,
    });
    // The unverified payload id is gone; only the AUTHORIZED canonical id remains.
    expect(command.businessId).toBe(REGISTRY[NEXUP]!.id);
    expect(command.businessId).not.toBe(REGISTRY[REBOUND]!.id);
  });

  it("a legacy slug in businessId stays readable ONLY when the caller is authorized", async () => {
    const domain = await domainWithHumans();
    const access = accessFor(domain);
    const legacy = await missionIn(domain, REBOUND); // historical row: a slug, not an id

    // Authorized for rebound → readable; the canonical id resolves from the slug.
    const reboundAuthority = createExecutionAuthority({
      userId: "user_bob",
      actorId: "actor_bob",
      actorSlug: "bob",
      actorType: "HUMAN",
      permissionTokens: ["aiworkforce.access"],
      accessibleBusinessSlugs: [REBOUND],
      isSuperAdmin: false,
      hasOfficeFinanceFull: false,
    });
    await expect(access.authorizeMission(reboundAuthority, legacy)).resolves.toMatchObject({
      id: REGISTRY[REBOUND]!.id,
      slug: REBOUND,
    });
    // Authorized for nexup only → the SAME legacy slug is refused.
    await expect(access.authorizeMission(authority, legacy)).rejects.toMatchObject({
      code: "BUSINESS_SCOPE_DENIED",
    });
  });
});

/* ══════════════════════════════════════════════════════
   VII. The actor-map configuration self-check
   ══════════════════════════════════════════════════════ */

describe("Step 5A-3 — actor-map configuration validation", () => {
  it("accepts a scalar or an array, and an empty string as the empty map", () => {
    expect(parseUserActorMap(undefined)).toEqual({});
    expect(parseUserActorMap("  ")).toEqual({});
    expect(parseUserActorMap('{"u1":"actor_founder"}')).toEqual({ u1: ["actor_founder"] });
    expect(parseUserActorMap('{"u1":["a","b"]}')).toEqual({ u1: ["a", "b"] });
  });

  it("refuses malformed configuration rather than silently dropping it", () => {
    expect(() => parseUserActorMap("{not json")).toThrow(/not valid JSON/);
    expect(() => parseUserActorMap("[1,2]")).toThrow(/must be a JSON object/);
    expect(() => parseUserActorMap('{"u1":42}')).toThrow(/string or an array of strings/);
  });

  it("validates the proof-only human-actor seeds the same way", () => {
    expect(parseProofHumanActors(undefined)).toEqual([]);
    expect(parseProofHumanActors('[{"id":"actor_ada","slug":"ada"}]')).toEqual([
      { id: "actor_ada", slug: "ada", displayName: "ada" },
    ]);
    expect(() => parseProofHumanActors("{not json")).toThrow(/not valid JSON/);
    expect(() => parseProofHumanActors('{"id":"x"}')).toThrow(/must be a JSON array/);
    expect(() => parseProofHumanActors('[{"slug":"ada"}]')).toThrow(/requires non-empty/);
  });
});

/* ══════════════════════════════════════════════════════
   VIII. The proof-only HUMAN actor posture fence
   ══════════════════════════════════════════════════════ */

/**
 * The proof seeds are test/proof INFRASTRUCTURE, never a production roster. The
 * invariant: they are honoured ONLY in the proof posture (deterministic TEST
 * transport + verified 127.0.0.1 database), and anywhere else the application
 * refuses to boot rather than quietly appearing to have registered them.
 */
describe("Step 5A-3 — proof HUMAN actors never reach a normal runtime", () => {
  const PROOF_SEEDS = '[{"id":"actor_proof_reviewer","slug":"proof-reviewer","displayName":"Proof Reviewer"}]';

  const loopback: PersistenceResolution = {
    kind: "DATABASE",
    reason: "local database verified (127.0.0.1/workforce_proof)",
    info: {
      url: "postgresql://postgres@127.0.0.1:5435/workforce_proof",
      host: "127.0.0.1",
      port: "5435",
      database: "workforce_proof",
      target: "local",
    },
  };
  const remote: PersistenceResolution = {
    kind: "DATABASE",
    reason: "production database verified (db.internal/nexup)",
    info: { ...loopback.info, url: "postgresql://u:p@db.internal:5432/nexup", host: "db.internal", database: "nexup", target: "production" },
  };
  const memory: PersistenceResolution = { kind: "IN_MEMORY", reason: 'persistence mode is "memory"' };

  const expectRefused = (resolution: ReturnType<typeof resolveApplicationRuntime>): string => {
    expect(resolution.kind).toBe("REFUSED");
    if (resolution.kind !== "REFUSED") throw new Error("expected a refusal");
    return resolution.reason;
  };

  it("refuses a normal runtime that has proof seeds configured", () => {
    // Every non-proof posture: no transport override, in-memory persistence, and
    // a remote database. None of them may silently take the seeds.
    for (const persistence of [memory, loopback, remote]) {
      const reason = expectRefused(
        resolveApplicationRuntime({ [WORKFORCE_PROOF_HUMAN_ACTORS_ENV]: PROOF_SEEDS }, persistence),
      );
      expect(reason).toMatch(/proof-only/);
      expect(reason).toMatch(new RegExp(WORKFORCE_TEST_TRANSPORT_ENV));
    }
  });

  it("refuses proof seeds even when the deterministic transport asks for a remote database", () => {
    const reason = expectRefused(
      resolveApplicationRuntime(
        { [WORKFORCE_PROOF_HUMAN_ACTORS_ENV]: PROOF_SEEDS, [WORKFORCE_TEST_TRANSPORT_ENV]: "deterministic" },
        remote,
      ),
    );
    expect(reason).toMatch(/127\.0\.0\.1/);
  });

  it("refuses an unsupported transport value regardless of the seeds", () => {
    const reason = expectRefused(
      resolveApplicationRuntime(
        { [WORKFORCE_PROOF_HUMAN_ACTORS_ENV]: PROOF_SEEDS, [WORKFORCE_TEST_TRANSPORT_ENV]: "production" },
        loopback,
      ),
    );
    expect(reason).toMatch(/not a supported value/);
  });

  it("honours the seeds ONLY in the verified proof posture", () => {
    expect(
      resolveApplicationRuntime(
        { [WORKFORCE_PROOF_HUMAN_ACTORS_ENV]: PROOF_SEEDS, [WORKFORCE_TEST_TRANSPORT_ENV]: "deterministic" },
        loopback,
      ).kind,
    ).toBe("RUNTIME");
    // …and the fence is not a blanket refusal: the ordinary postures still work.
    expect(resolveApplicationRuntime({}, loopback).kind).toBe("ENV");
    expect(
      resolveApplicationRuntime({ [WORKFORCE_TEST_TRANSPORT_ENV]: "deterministic" }, loopback).kind,
    ).toBe("RUNTIME");
  });
});
