import type { ActorContext } from "@/modules/ai-workforce/core/execution-context";

import type { HumanActorResolver } from "./authority-resolution";
import { createExecutionAuthority, type ExecutionAuthority } from "./execution-authority";

/**
 * Authenticated facts → `ExecutionAuthority`.
 *
 * The API edge has already turned the session into an `ActorContext`
 * (`actorFromSession`) — that adapter is the ONLY thing that touches cookies.
 * This builder does the one remaining, load-bearing step: it resolves the
 * signed-in user to the HUMAN workforce actor that represents them, and returns
 * a COMPLETE authority built from server-derived facts only.
 *
 * It lives in the domain module rather than beside the session adapter so it
 * imports no Next.js and no HTTP: a test builds an `ActorContext` by hand and
 * exercises the same function the route does.
 *
 * NOTHING from a request payload appears here. The caller supplies the actor the
 * SESSION produced; this function never reads a body.
 *
 * @throws AUTHORITY_UNRESOLVED when the user maps to no single HUMAN actor.
 */
export async function authorityFromAuthenticatedActor(input: {
  actor: ActorContext;
  humanActors: HumanActorResolver;
  now?: Date;
  ids?: { next(kind: string): string };
}): Promise<ExecutionAuthority> {
  const human = await input.humanActors.resolve(input.actor.userId);

  return createExecutionAuthority({
    userId: input.actor.userId,
    // The mission/delegation identity is the resolved HUMAN actor — never a
    // literal, and never the raw user id.
    actorId: human.id,
    actorSlug: human.slug,
    actorType: human.type,
    // Rights come from the SESSION-derived actor, not from the actor record and
    // not from the payload.
    permissionTokens: input.actor.permissionTokens,
    accessibleBusinessSlugs: input.actor.accessibleBusinessSlugs,
    isSuperAdmin: input.actor.isSuperAdmin,
    hasOfficeFinanceFull: input.actor.hasOfficeFinanceFull,
    ...(input.now ? { now: input.now } : {}),
    ...(input.ids ? { ids: input.ids } : {}),
  });
}
