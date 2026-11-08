import { NextResponse } from "next/server";
import { getCurrentSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { resolveReadScope } from "@/lib/read-scope-db";

export const runtime = "nodejs";

/**
 * The session as the client reads it.
 *
 * `business` is the session's own company, resolved from the id the token
 * carries. `scope` is the set the READ routes actually use — resolved by the same
 * helper (`read-scope.ts`) they resolve — so the surfaces can print the scope
 * they are really looking at instead of a guess. A super admin whose session
 * spans every company (`businessId === "all"`) has no single business and gets
 * `null` there, while `scope.mode` is `"all"`.
 */
export async function GET() {
  const session = await getCurrentSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const [business, scope] = await Promise.all([
    session.businessId && session.businessId !== "all"
      ? prisma.business.findUnique({
          where: { id: session.businessId },
          select: { id: true, name: true, slug: true },
        })
      : Promise.resolve(null),
    resolveReadScope(session),
  ]);

  return NextResponse.json({
    user: {
      userId: session.userId,
      name: session.name,
      role: session.role,
      businessId: session.businessId,
      business,
      scope: { mode: scope.mode, businesses: scope.businesses },
      canAccessNexup: session.canAccessNexup,
      canAccessRebound: session.canAccessRebound,
      canAccessAbomazen: session.canAccessAbomazen,
      canAccessOfficeFinanceFull: session.canAccessOfficeFinanceFull,
    },
  });
}
