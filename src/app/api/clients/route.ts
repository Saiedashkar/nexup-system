import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentSession, isAdmin } from "@/lib/auth";
import { softDeleteMany, softDeleteRecord, type LooseDb } from "@/lib/soft-delete";
import { resolveReadScope, resolveWriteTarget } from "@/lib/read-scope-db";

export const runtime = "nodejs";

export async function GET() {
  try {
    const session = await getCurrentSession();
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    /* ONE SCOPE RULE. `/api/projects` resolves the same set from the same helper,
       so the two reads can no longer disagree about the session's companies. */
    const scope = await resolveReadScope(session);
    if (scope.businessIds.length === 0) {
      return NextResponse.json([]);
    }

    const clients = await prisma.client.findMany({
      where: { businessId: { in: scope.businessIds } },
      include: {
        /* A NESTED include is not covered by the soft-delete extension (that
           runs on the top-level operation only), so a deleted project would
           otherwise reappear inside its client's own list. The filter is
           explicit here, which is why the row list and the totals agree. */
        projectRecords: {
          where: { deletedAt: null },
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
      /* `tier` is the STORED column — it travels through the spread above
         untouched. The classification this route derives is a different fact, so
         it has its own name and never shadows what the operator set. */
      const computedTier = totalPaid >= 5000 ? "VIP" : totalPaid >= 1000 ? "LOYAL" : isRepeatClient ? "LOYAL" : "NORMAL";
      return { ...c, projectCount, totalPaid, totalRemaining, isRepeatClient, computedTier };
    });

    return NextResponse.json(enriched);
  } catch (error) {
    console.error("Failed to fetch clients:", error);
    return NextResponse.json({ error: "Failed to fetch clients" }, { status: 500 });
  }
}

// DELETE — Clean up orphaned clients (clients with no projects)
export async function DELETE(request: Request) {
  try {
    const session = await getCurrentSession();
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (!isAdmin(session)) return NextResponse.json({ error: "Access denied" }, { status: 403 });

    /* A READ scope does not authorise a cleanup. The target company is named
       explicitly — a scoped admin may only clean its own, a super admin has to
       say which company it means — and it has to be a real company. */
    const scope = await resolveWriteTarget(session, new URL(request.url).searchParams.get("businessId"));
    if (!scope.ok) {
      return NextResponse.json({ error: scope.error }, { status: scope.status });
    }
    /* ONE TRANSACTION FOR THE WHOLE REQUEST. Choosing the orphans, hiding each
       one, its subscriptions and the activity entries are a single unit: if any
       client fails, every earlier one is rolled back instead of leaving the
       company half cleaned. The timeout is raised because the request is now one
       statement series, not N independent commits. */
    const deleted = await prisma.$transaction(async (tx) => {
      const db = tx as unknown as LooseDb;

      /* `tx` is the raw client, so the soft-delete extension does not filter for
         us: "live" is spelled out, exactly as the extended client would have
         applied it. An orphan is a client with no live project and no live
         subscription. */
      const liveClients = await tx.client.findMany({
        where: { businessId: scope.businessId, deletedAt: null },
        select: { id: true },
      });

      const orphaned: string[] = [];
      for (const c of liveClients) {
        const [projectCount, subscriptionCount] = await Promise.all([
          tx.projectRecord.count({ where: { clientId: c.id, deletedAt: null } }),
          tx.subscription.count({ where: { clientId: c.id, deletedAt: null } }),
        ]);
        if (projectCount === 0 && subscriptionCount === 0) orphaned.push(c.id);
      }

      for (const id of orphaned) {
        await softDeleteMany("Subscription", { clientId: id }, session.userId, db);
        await softDeleteRecord("Client", id, session.userId, db);
      }

      return orphaned.length;
    }, { timeout: 30_000 });

    if (deleted === 0) {
      return NextResponse.json({ deleted: 0, message: "No orphaned clients found" });
    }

    return NextResponse.json({ deleted, message: `Deleted ${deleted} orphaned client(s)` });
  } catch (error) {
    console.error("Failed to cleanup clients:", error);
    return NextResponse.json({ error: "Failed to cleanup" }, { status: 500 });
  }
}
