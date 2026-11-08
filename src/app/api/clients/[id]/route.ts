import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentSession, isAdmin } from "@/lib/auth";
import { companyWriteDenial } from "@/lib/read-scope";
import { trialWriteDenial } from "@/lib/trial-lock";
import { softDeleteMany, softDeleteRecord, type LooseDb } from "@/lib/soft-delete";

export const runtime = "nodejs";

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getCurrentSession();
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    /* DELETING A CLIENT IS AN ADMIN OPERATION. It used to have no role check at
       all, so every employee of the company could remove a client and all of its
       projects, payments and subscriptions with one request. Refused before the
       row is even read. */
    if (!isAdmin(session)) return NextResponse.json({ error: "Access denied" }, { status: 403 });

    const trial = trialWriteDenial();
    if (trial) return NextResponse.json({ error: trial.error }, { status: trial.status });

    const { id } = await params;

    // Find the client and verify access
    const client = await prisma.client.findUnique({
      where: { id },
      include: { projectRecords: { select: { id: true } }, business: { select: { slug: true } } },
    });

    if (!client) {
      return NextResponse.json({ error: "Client not found" }, { status: 404 });
    }

    /* Role, then the client's company, then that company's access FLAG: carrying
       a `businessId` is not permission to delete inside it. */
    const denial = companyWriteDenial(session, {
      id: client.businessId,
      slug: client.business.slug,
    });
    if (denial) return NextResponse.json({ error: denial.error }, { status: denial.status });

    /* Soft-delete in order — ClientPayments → PoolTransactions → ProjectRecords →
       Subscriptions → Client — inside ONE transaction, together with the activity
       entries. Nothing is really removed (the recycle bin restores it), and a
       failure at any step leaves the client and every row under it untouched
       rather than half-hidden. */
    const projectIds = client.projectRecords.map(p => p.id);

    await prisma.$transaction(async (tx) => {
      const db = tx as unknown as LooseDb;

      if (projectIds.length > 0) {
        await softDeleteMany("ClientPayment", { projectRecordId: { in: projectIds } }, session.userId, db);
        await softDeleteMany("PoolTransaction", { projectRecordId: { in: projectIds } }, session.userId, db);
        await softDeleteMany("ProjectRecord", { id: { in: projectIds } }, session.userId, db);
      }

      await softDeleteMany("Subscription", { clientId: id }, session.userId, db);
      await softDeleteRecord("Client", id, session.userId, db);
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Failed to delete client:", error);
    return NextResponse.json({ error: "Failed to delete client" }, { status: 500 });
  }
}
