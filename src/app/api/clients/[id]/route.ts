import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentSession, isSuperAdmin } from "@/lib/auth";
import { softDeleteMany, softDeleteRecord } from "@/lib/soft-delete";

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

    // Soft-delete in order: ClientPayments → PoolTransactions → ProjectRecords → Subscriptions → Client.
    // Nothing is really removed — everything is restorable from the recycle bin.
    const projectIds = client.projectRecords.map(p => p.id);

    if (projectIds.length > 0) {
      await softDeleteMany("ClientPayment", { projectRecordId: { in: projectIds } }, session.userId);
      await softDeleteMany("PoolTransaction", { projectRecordId: { in: projectIds } }, session.userId);
      await softDeleteMany("ProjectRecord", { id: { in: projectIds } }, session.userId);
    }

    await softDeleteMany("Subscription", { clientId: id }, session.userId);
    await softDeleteRecord("Client", id, session.userId);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Failed to delete client:", error);
    return NextResponse.json({ error: "Failed to delete client" }, { status: 500 });
  }
}
