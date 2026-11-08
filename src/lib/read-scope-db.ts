/**
 * RESOLVING THE SCOPE RULE AGAINST THE DATABASE
 * ─────────────────────────────────────────────
 * The rule itself is in `read-scope.ts` (pure). This file only turns the slugs it
 * returns into the company rows a query needs, so `/api/clients`, `/api/projects`
 * and `/api/auth/me` all answer with the SAME set — the one the surfaces print.
 */

import { prisma } from "@/lib/prisma";
import {
  companyWriteDenial,
  readScopeSlugs,
  resolveWriteScope,
  type ReadScopeMode,
  type ScopedSession,
} from "./read-scope";

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

/**
 * WHO A WRITE TARGETS, AND MAY IT — the whole answer, in one call.
 *
 * Order matters: role and target selection first (`resolveWriteScope`), then the
 * company row, then that company's access FLAG (`companyWriteDenial`). A foreign
 * or invented id therefore cannot be written to, and a `businessId` the session
 * merely carries is not a permission of its own.
 */
export type WriteTarget =
  | {
      ok: true;
      businessId: string;
      slug: string;
      explicit: boolean;
      status?: undefined;
      error?: undefined;
    }
  | {
      ok: false;
      status: 400 | 403 | 404;
      error: string;
      businessId?: undefined;
      slug?: undefined;
      explicit?: undefined;
    };

export async function resolveWriteTarget(
  session: ScopedSession,
  explicitBusinessId?: string | null,
): Promise<WriteTarget> {
  const scope = resolveWriteScope(session, explicitBusinessId);
  if (!scope.ok) return { ok: false, status: scope.status, error: scope.error };

  const company = await prisma.business.findUnique({
    where: { id: scope.businessId },
    select: { id: true, slug: true },
  });
  if (!company) return { ok: false, status: 404, error: "Unknown company" };

  const denial = companyWriteDenial(session, company);
  if (denial) return { ok: false, status: denial.status, error: denial.error };

  return { ok: true, businessId: company.id, slug: company.slug, explicit: scope.explicit };
}
