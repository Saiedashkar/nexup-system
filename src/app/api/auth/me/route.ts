import { NextResponse } from "next/server";
import { getCurrentSession } from "@/lib/auth";

export const runtime = "nodejs";

export async function GET() {
  const session = await getCurrentSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  return NextResponse.json({
    user: {
      userId: session.userId,
      name: session.name,
      role: session.role,
      businessId: session.businessId,
      canAccessNexup: session.canAccessNexup,
      canAccessRebound: session.canAccessRebound,
      canAccessAbomazen: session.canAccessAbomazen,
      canAccessOfficeFinanceFull: session.canAccessOfficeFinanceFull,
    },
  });
}
