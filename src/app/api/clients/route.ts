import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentSession, getAccessibleBusinesses } from "@/lib/auth";
import { softDeleteMany, softDeleteRecord } from "@/lib/soft-delete";

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

// DELETE — Clean up orphaned clients (clients with no projects)
export async function DELETE() {
  try {
    const session = await getCurrentSession();
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (session.role === "EMPLOYEE") return NextResponse.json({ error: "Access denied" }, { status: 403 });

    // Find all clients with no projects AND no subscriptions.
    // Counts are computed with the soft-delete-aware client so a client whose
    // rows were only soft-deleted still counts as orphaned.
    const liveClients = await prisma.client.findMany({ select: { id: true } });
    const orphaned: { id: string }[] = [];
    for (const c of liveClients) {
      const [projectCount, subscriptionCount] = await Promise.all([
        prisma.projectRecord.count({ where: { clientId: c.id } }),
        prisma.subscription.count({ where: { clientId: c.id } }),
      ]);
      if (projectCount === 0 && subscriptionCount === 0) orphaned.push(c);
    }

    if (orphaned.length === 0) {
      return NextResponse.json({ deleted: 0, message: "No orphaned clients found" });
    }

    // Soft-delete subscriptions and clients (recoverable from the recycle bin)
    for (const c of orphaned) {
      await softDeleteMany("Subscription", { clientId: c.id }, session.userId);
      await softDeleteRecord("Client", c.id, session.userId);
    }

    return NextResponse.json({ deleted: orphaned.length, message: `Deleted ${orphaned.length} orphaned client(s)` });
  } catch (error) {
    console.error("Failed to cleanup clients:", error);
    return NextResponse.json({ error: "Failed to cleanup" }, { status: 500 });
  }
}
