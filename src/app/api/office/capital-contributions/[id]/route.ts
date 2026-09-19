import { NextRequest, NextResponse } from "next/server";
import { getCurrentSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { softDeleteRecord } from "@/lib/soft-delete";

export const runtime = "nodejs";

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getCurrentSession();
  if (!session || session.role !== "SUPER_ADMIN") return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { id } = await params;
  const body = await req.json();

  const existing = await prisma.capitalContribution.findUnique({ where: { id } });
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const updateData: Record<string, unknown> = {};
  if (body.amount !== undefined) updateData.amount = parseFloat(body.amount);
  if (body.type) updateData.type = body.type;
  if (body.description !== undefined) updateData.description = body.description || null;
  if (body.date) updateData.date = new Date(body.date);
  if (body.fundFlow === "SPENT_ALREADY" || body.fundFlow === "STILL_IN_TREASURY") {
    updateData.fundFlow = body.fundFlow;
  }

  const updated = await prisma.capitalContribution.update({ where: { id }, data: updateData });

  // Legacy cleanup: if this record still has a paired OfficeExpense from the old
  // behaviour (capital → auto expense), detach it so it stops double-counting.
  // The old paired row is soft-deleted and can be restored from the recycle bin.
  if (updated.linkedExpenseId) {
    const linked = await prisma.officeExpense.findUnique({ where: { id: updated.linkedExpenseId } }).catch(() => null);
    if (linked && linked.notes?.includes(updated.id)) {
      await softDeleteRecord("OfficeExpense", linked.id, session.userId).catch(() => {});
    }
    await prisma.capitalContribution.update({ where: { id }, data: { linkedExpenseId: null } });
  }

  await prisma.activityLog.create({ data: { userId: session.userId, action: "UPDATE", entityType: "CapitalContribution", entityId: id } });
  return NextResponse.json(updated);
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getCurrentSession();
  if (!session || session.role !== "SUPER_ADMIN") return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { id } = await params;

  const existing = await prisma.capitalContribution.findUnique({ where: { id } });
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // Soft-delete the contribution (recoverable from the recycle bin).
  await softDeleteRecord("CapitalContribution", id, session.userId);
  return NextResponse.json({ success: true });
}
