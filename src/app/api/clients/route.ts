import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentSession, canAccessBusiness, isSuperAdmin, getAccessibleBusinesses } from "@/lib/auth";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const session = await getCurrentSession();
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    // Get accessible business IDs
    const accessibleSlugs = getAccessibleBusinesses(session);
    const accessibleBusinesses = await prisma.business.findMany({
      where: { slug: { in: accessibleSlugs } },
      select: { id: true },
    });
    const accessibleIds = accessibleBusinesses.map(b => b.id);

    if (accessibleIds.length === 0) {
      return NextResponse.json([]);
    }

    const clients = await prisma.client.findMany({
      where: { businessId: { in: accessibleIds } },
      include: {
        projectRecords: {
          select: { id: true, projectName: true, totalPrice: true, deposit: true, workStatus: true, paymentStatus: true, date: true, businessId: true },
          orderBy: { date: "desc" },
        },
      },
      orderBy: { name: "asc" },
    });

    // Enrich with computed fields
    const enriched = clients.map(c => {
      const projectCount = c.projectRecords.length;
      const totalPaid = c.projectRecords.reduce((s, p) => s + Number(p.deposit), 0);
      const totalRemaining = c.projectRecords.reduce((s, p) => s + Number(p.totalPrice) - Number(p.deposit), 0);
      const isRepeatClient = projectCount > 1;
      const tier = totalPaid >= 5000 ? "VIP" : totalPaid >= 1000 ? "LOYAL" : isRepeatClient ? "LOYAL" : "NORMAL";
      return { ...c, projectCount, totalPaid, totalRemaining, isRepeatClient, tier };
    });

    return NextResponse.json(enriched);
  } catch (error) {
    console.error("Failed to fetch clients:", error);
    return NextResponse.json({ error: "Failed to fetch clients" }, { status: 500 });
  }
}
