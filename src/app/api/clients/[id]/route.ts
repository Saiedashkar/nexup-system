import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentSession, isSuperAdmin } from "@/lib/auth";

export const runtime = "nodejs";

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getCurrentSession();
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { id } = await params;

    // Find the client and verify access
    const client = await prisma.client.findUnique({
      where: { id },
      include: { projectRecords: { select: { id: true } } },
    });

    if (!client) {
      return NextResponse.json({ error: "Client not found" }, { status: 404 });
    }

    // Only super admin or matching business admin can delete
    if (!isSuperAdmin(session) && session.businessId !== client.businessId) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 });
    }

    // Delete in order: ClientPayments → PoolTransactions → ProjectRecords → Client
    const projectIds = client.projectRecords.map(p => p.id);

    if (projectIds.length > 0) {
      // Delete ClientPayments for all projects
      await prisma.clientPayment.deleteMany({
        where: { projectRecordId: { in: projectIds } },
      });

      // Delete PoolTransactions for all projects
      await prisma.poolTransaction.deleteMany({
        where: { projectRecordId: { in: projectIds } },
      });

      // Delete ProjectRecords
      await prisma.projectRecord.deleteMany({
        where: { id: { in: projectIds } },
      });
    }

    // Delete Subscriptions
    await prisma.subscription.deleteMany({
      where: { clientId: id },
    });

    // Delete the client
    await prisma.client.delete({ where: { id } });

    // Log the action
    if (session.userId) {
      await prisma.activityLog.create({
        data: {
          userId: session.userId,
          action: "DELETE",
          entityType: "Client",
          entityId: id,
        },
      });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Failed to delete client:", error);
    return NextResponse.json({ error: "Failed to delete client" }, { status: 500 });
  }
}
