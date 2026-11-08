/**
 * RESOLVING THE SCOPE RULE AGAINST THE DATABASE
 * ─────────────────────────────────────────────
 * The rule itself is in `read-scope.ts` (pure). This file only turns the slugs it
 * returns into the company rows a query needs, so `/api/clients`, `/api/projects`
 * and `/api/auth/me` all answer with the SAME set — the one the surfaces print.
 */

import { prisma } from "@/lib/prisma";
import { readScopeSlugs, type ReadScopeMode, type ScopedSession } from "./read-scope";

export type BusinessRef = { id: string; name: string; slug: string };

export type ReadScope = {
  mode: ReadScopeMode;
  businesses: BusinessRef[];
  businessIds: string[];
};

/** The companies a session may read, resolved. An empty list means it reads none. */
export async function resolveReadScope(session: ScopedSession): Promise<ReadScope> {
  const { mode, slugs } = readScopeSlugs(session);
  if (slugs.length === 0) return { mode, businesses: [], businessIds: [] };

  const businesses = await prisma.business.findMany({
    where: { slug: { in: slugs } },
    select: { id: true, name: true, slug: true },
    orderBy: { name: "asc" },
  });

  return { mode, businesses, businessIds: businesses.map((business) => business.id) };
}

/** True when the id names a real company; a write may not invent one. */
export async function businessExists(businessId: string): Promise<boolean> {
  const business = await prisma.business.findUnique({
    where: { id: businessId },
    select: { id: true },
  });
  return Boolean(business);
}
