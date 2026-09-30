import { getAccessibleBusinesses, isSuperAdmin, type Session } from "@/lib/auth";
import type { ActorContext } from "../core/execution-context";
import { derivePermissionTokens } from "../policies/permission-policy";

/**
 * Delegated actor.
 *
 * The legacy session is the source of truth: this adapter only translates it
 * into the actor shape the workforce policy engine speaks. It never widens
 * rights — an actor can never do more through a tool than through the UI.
 *
 * Server-only (`@/lib/auth` reads cookies); tests build actors directly.
 */
export function actorFromSession(session: Session): ActorContext {
  const superAdmin = isSuperAdmin(session);
  const accessibleBusinessSlugs = getAccessibleBusinesses(session);

  return {
    userId: session.userId,
    name: session.name,
    role: session.role,
    isSuperAdmin: superAdmin,
    hasOfficeFinanceFull: superAdmin || session.canAccessOfficeFinanceFull === true,
    accessibleBusinessSlugs,
    permissionTokens: derivePermissionTokens({
      role: session.role,
      isSuperAdmin: superAdmin,
      hasOfficeFinanceFull: superAdmin || session.canAccessOfficeFinanceFull === true,
      accessibleBusinessSlugs,
    }),
  };
}

/** True when the actor may touch the AI Workforce module at all. */
export function canUseWorkforce(actor: ActorContext): boolean {
  return actor.permissionTokens.includes("aiworkforce.access");
}
