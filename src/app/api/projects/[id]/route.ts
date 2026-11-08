import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentSession } from "@/lib/auth";
import { canUseProjectsFeature, companyWriteDenial } from "@/lib/read-scope";
import { softDeleteMany, softDeleteRecord, type LooseDb } from "@/lib/soft-delete";

export const runtime = "nodejs";

// PATCH - Update a project record
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getCurrentSession();
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    /* BEFORE loading the record: an employee is refused identically whether the id
       exists or not, so the route cannot be used to probe project ids. */
    if (!canUseProjectsFeature(session)) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 });
    }

    const { id } = await params;
    const body = await request.json();

    const existing = await prisma.projectRecord.findUnique({
      where: { id },
      include: { client: true, business: { select: { slug: true } } },
    });
    if (!existing) {
      return NextResponse.json({ error: "Record not found" }, { status: 404 });
    }

    /* ISOLATION + PERMISSION: the project's company has to be one this session
       may write to — its own, with that company's flag on (or any company for a
       super admin). A matching id alone would not be enough. */
    const denial = companyWriteDenial(session, {
      id: existing.businessId,
      slug: existing.business.slug,
    });
    if (denial) return NextResponse.json({ error: denial.error }, { status: denial.status });

    /* ONE TRANSACTION: the money movements, the project row and the client's tier
       either all land or none do — a refused or failing patch leaves no payment
       behind. Nothing below writes before the checks above have passed. */
    const updated = await prisma.$transaction(async (tx) => {
      const updateData: Record<string, unknown> = {};

      if (body.workStatus !== undefined) updateData.workStatus = body.workStatus;
      if (body.projectName !== undefined) updateData.projectName = body.projectName;
      if (body.notes !== undefined) updateData.notes = body.notes;

      // Handle designer — support both designerId (from dropdown) and designerName (free text)
      if (body.designerId !== undefined) {
        updateData.designerId = body.designerId || null;
      }
      if (body.designerName !== undefined) {
        updateData.designerName = body.designerName || null;
      }

      const movements: { amount: number; note: string }[] = [];

      // Handle payment updates — supports both full and partial payments
      if (body.deposit !== undefined) {
        const newDeposit = parseFloat(String(body.deposit));
        const oldDeposit = parseFloat(String(existing.deposit));
        const newRemaining = parseFloat(String(existing.totalPrice)) - newDeposit;
        updateData.deposit = newDeposit;
        updateData.remaining = Math.max(0, newRemaining);
        updateData.paymentStatus = newDeposit >= parseFloat(String(existing.totalPrice))
          ? "FULL"
          : newDeposit > 0
          ? "PARTIAL"
          : "UNPAID";

        const depositDiff = newDeposit - oldDeposit;
        if (depositDiff > 0) movements.push({ amount: depositDiff, note: `Payment — ${existing.client.name} — ${existing.projectName}` });
      }

      // Quick pay remaining — sets deposit to full totalPrice
      if (body.payRemaining) {
        const remaining = parseFloat(String(existing.remaining));
        if (remaining > 0) {
          const newDeposit = parseFloat(String(existing.totalPrice));
          updateData.deposit = newDeposit;
          updateData.remaining = 0;
          updateData.paymentStatus = "FULL";
          movements.push({ amount: remaining, note: `Full payment — ${existing.client.name} — ${existing.projectName}` });
        }
      }

      for (const movement of movements) {
        await tx.poolTransaction.create({
          data: {
            businessId: existing.businessId,
            projectRecordId: id,
            amountSAR: movement.amount,
            type: "IN",
            date: new Date(),
            note: movement.note,
          },
        });
        // Mirror the difference as a ClientPayment row so a transfer receipt
        // can be attached to it (receipts attach to ClientPayment records).
        await tx.clientPayment.create({
          data: {
            projectRecordId: id,
            amount: movement.amount,
            date: new Date(),
            note: "دفعة",
            createdByUserId: session.userId,
          },
        });
      }

      const row = await tx.projectRecord.update({
        where: { id },
        data: updateData,
        include: {
          client: { select: { id: true, name: true, phone: true, tier: true } },
          designer: { select: { id: true, name: true } },
          services: { select: { id: true, name: true } },
        },
      });

      // Recalculate client tier
      const projectCount = await tx.projectRecord.count({
        where: { clientId: existing.clientId },
      });
      const totalPaid = await tx.projectRecord.aggregate({
        where: { clientId: existing.clientId, paymentStatus: "FULL" },
        _sum: { totalPrice: true },
      });
      const totalRevenue = Number(totalPaid._sum.totalPrice ?? 0);

      let tier: "VIP" | "LOYAL" | "NORMAL" | "DELINQUENT" = "NORMAL";
      if (totalRevenue > 1000 || projectCount >= 3) tier = "VIP";
      else if (totalRevenue > 500 || projectCount >= 2) tier = "LOYAL";

      await tx.client.update({
        where: { id: existing.clientId },
        data: { tier },
      });

      /* The activity log is written INSIDE the same transaction: if it fails, the
         payment, the project row and the tier change roll back together, and no
         request fails with 500 after its save already landed. */
      await tx.activityLog.create({
        data: {
          userId: session.userId,
          action: "UPDATE",
          entityType: "ProjectRecord",
          entityId: id,
        },
      });

      return row;
    });

    return NextResponse.json(updated);
  } catch (error) {
    console.error("Failed to update project:", error);
    return NextResponse.json({ error: "Failed to update" }, { status: 500 });
  }
}

// DELETE - Remove a project record
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getCurrentSession();
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (!canUseProjectsFeature(session)) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 });
    }

    const { id } = await params;

    const existing = await prisma.projectRecord.findUnique({
      where: { id },
      include: { poolTransactions: true, business: { select: { slug: true } } },
    });
    if (!existing) {
      return NextResponse.json({ error: "Record not found" }, { status: 404 });
    }

    /* ISOLATION + PERMISSION: same rule on the delete path — role, then the
       project's company, then that company's access flag. */
    const denial = companyWriteDenial(session, {
      id: existing.businessId,
      slug: existing.business.slug,
    });
    if (denial) return NextResponse.json({ error: denial.error }, { status: denial.status });

    /* ONE TRANSACTION for the whole deletion: the payments, the treasury
       movements, the project row, the client auto-hide and every activity entry
       land together or not at all. A failure halfway rolls everything back
       instead of leaving a half-deleted project. */
    await prisma.$transaction(async (tx) => {
      const db = tx as unknown as LooseDb;

      // Soft-delete related rows first (recoverable — nothing is destroyed)
      await softDeleteMany("ClientPayment", { projectRecordId: id }, session.userId, db);
      await softDeleteMany("PoolTransaction", { projectRecordId: id }, session.userId, db);

      const clientId = existing.clientId;
      await softDeleteRecord("ProjectRecord", id, session.userId, db);

      // Auto-hide the client when it has no projects left (restored together on undo)
      const remainingProjects = await tx.projectRecord.count({ where: { clientId } });
      if (remainingProjects === 0) {
        await softDeleteMany("Subscription", { clientId }, session.userId, db);
        await softDeleteRecord("Client", clientId, session.userId, db);
      }
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Failed to delete project:", error);
    return NextResponse.json({ error: "Failed to delete" }, { status: 500 });
  }
}
