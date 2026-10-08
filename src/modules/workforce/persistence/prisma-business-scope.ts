import { prisma } from "@/lib/prisma";

import type { BusinessScopeResolver, ResolvedBusiness } from "../execution/authority-resolution";

/**
 * The AUTHORITATIVE business-scope resolver, over the existing `Business` table.
 *
 * The registry is not invented here: `Business` already owns both `id` and
 * `slug`, and this adapter merely resolves an opaque reference to that row. It
 * deliberately accepts EITHER form, because the two vocabularies genuinely
 * differ in this system — the legacy session speaks slugs
 * (`getAccessibleBusinesses`), while a mission row may carry a database id — and
 * the whole point of 5A-3 is to stop comparing the two by accident.
 *
 * Server-only (`@/lib/prisma` owns the pool). It performs a single read and
 * never writes.
 */
export const prismaBusinessScopeResolver: BusinessScopeResolver = {
  async resolve(reference: string): Promise<ResolvedBusiness | null> {
    const value = typeof reference === "string" ? reference.trim() : "";
    if (!value) return null;

    const row = await prisma.business.findFirst({
      where: { OR: [{ id: value }, { slug: value }] },
      select: { id: true, slug: true },
    });
    return row ? { id: row.id, slug: row.slug } : null;
  },
};
