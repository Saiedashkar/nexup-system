import { NextResponse } from "next/server";
import { getCurrentSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

/**
 * The session as the client reads it.
 *
 * `business` is the session's own company, resolved from the id the token
 * carries. The bound surfaces print this name as their scope, so a reader is
 * looking at the company the SESSION was scoped to rather than at the demo
 * scope label in the shell. A super admin whose session spans every company
 * (`businessId === "all"`) has no single business, and gets `null` on purpose.
 */
export async function GET() {
  const session = await getCurrentSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const business =
    session.businessId && session.businessId !== "all"
      ? await prisma.business.findUnique({
          where: { id: session.businessId },
          select: { id: true, name: true, slug: true },
        })
      : null;

  return NextResponse.json({
    user: {
      userId: session.userId,
      name: session.name,
      role: session.role,
      businessId: session.businessId,
      business,
      canAccessNexup: session.canAccessNexup,
      canAccessRebound: session.canAccessRebound,
      canAccessAbomazen: session.canAccessAbomazen,
      canAccessOfficeFinanceFull: session.canAccessOfficeFinanceFull,
    },
  });
}
