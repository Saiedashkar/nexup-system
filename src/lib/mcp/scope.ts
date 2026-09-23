import type { McpPrincipal } from "./auth";
import { isBusinessAllowed } from "./auth";

/**
 * Build the Prisma `businessId` filter for a principal.
 * Phase 1 (shared token): null = no extra filter (all three businesses).
 * Phase 2: per-profile principals will get an `IN (…)` list here,
 * and an unknown slug will resolve to an empty result set instead
 * of being rejected, so callers can't probe which slugs exist.
 */
export type BusinessScopeFilter = { businessId?: { in: string[] } } | undefined;

export function getBusinessScopeFilter(principal: McpPrincipal): BusinessScopeFilter {
  if (principal.allowedBusinesses.size >= 3) return undefined; // full access
  return { businessId: { in: [...principal.allowedBusinesses] } };
}

/** Slug → allowed for this principal? Used by handlers that take a slug input. */
export function slugAllowed(principal: McpPrincipal, slug: string): boolean {
  return isBusinessAllowed(principal, slug);
}
