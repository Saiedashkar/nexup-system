import { notFound } from "next/navigation";
import { ActorWorkspace } from "@/components/command/workspace/actor-workspace";
import { actorForSlug } from "@/components/command/state/actor-workspace";

/**
 * ACTOR WORKSPACE — one route, every human and AI actor (Phase UI-04)
 * ─────────────────────────────────────────────────────────────────────
 * ROUTE: `/command/actors/[actorId]`
 *
 * This is the ONE implementation of an actor workspace. It resolves the route
 * slug through the actor configuration model and hands that to a single client
 * component — there is no per-actor page, so `/command/actors/ai-growth-director`
 * and `/command/actors/growth-lead` are the same page reading different
 * configuration. Humans and AI agents share the structure.
 *
 * It sits under the existing `/command` layout, so the shell, the command bar
 * and the Executive console stay mounted: EXEC remains reachable from inside
 * any actor's workspace without this route re-implementing the shell.
 *
 * No data fetching, no database access, no AI provider. `notFound()` is the
 * only exit for an unknown slug, so a bad URL cannot render an empty workspace.
 */
export default async function ActorWorkspacePage({
  params,
}: {
  params: Promise<{ actorId: string }>;
}) {
  const { actorId } = await params;
  const actor = actorForSlug(actorId);
  if (!actor) notFound();

  return <ActorWorkspace actor={actor} />;
}
