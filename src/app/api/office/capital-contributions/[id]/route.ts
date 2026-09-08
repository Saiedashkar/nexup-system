import { NextRequest, NextResponse } from "next/server";
import { getCurrentSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

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

  const newFundFlow = body.fundFlow as string | undefined;

  // Handle fundFlow transitions
  if (newFundFlow && newFundFlow !== existing.fundFlow) {
    if (newFundFlow === "SPENT_ALREADY" && existing.fundFlow === "STILL_IN_TREASURY") {
      // Transition: STILL_IN_TREASURY → SPENT_ALREADY → Create paired expense
      const partner = await prisma.partner.findUnique({ where: { id: existing.partnerId }, select: { name: true } });
      const desc = body.description || existing.description || `مساهمة رأس مال — ${partner?.name || "شريك"}`;
      const amt = body.amount !== undefined ? parseFloat(body.amount) : existing.amount;
      const dt = body.date ? new Date(body.date) : existing.date;
      const expense = await prisma.officeExpense.create({
        data: {
          description: desc,
          cost: amt,
          category: "VARIABLE",
          name: partner?.name || "شريك",
          notes: `مساهمة رأس مال رقم ${id} — مصروف بالفعل (fundFlow: SPENT_ALREADY)`,
          date: dt,
          month: dt.getMonth() + 1,
          year: dt.getFullYear(),
        },
      });
      updateData.fundFlow = "SPENT_ALREADY";
      updateData.linkedExpenseId = expense.id;
    } else if (newFundFlow === "STILL_IN_TREASURY" && existing.fundFlow === "SPENT_ALREADY") {
      // Transition: SPENT_ALREADY → STILL_IN_TREASURY → Delete paired expense
      if (existing.linkedExpenseId) {
        await prisma.officeExpense.delete({ where: { id: existing.linkedExpenseId } }).catch(() => {});
      }
      updateData.fundFlow = "STILL_IN_TREASURY";
      updateData.linkedExpenseId = null;
    }
  }

  const updated = await prisma.capitalContribution.update({ where: { id }, data: updateData });

  // If SPENT_ALREADY and amount/date/description changed, update the linked expense
  if (updated.fundFlow === "SPENT_ALREADY" && updated.linkedExpenseId) {
    const expenseUpdate: Record<string, unknown> = {};
    if (body.amount !== undefined) expenseUpdate.cost = parseFloat(body.amount);
    if (body.description !== undefined) expenseUpdate.description = body.description || `مساهمة رأس مال — مصروف بالفعل`;
    if (body.date) {
      const dt = new Date(body.date);
      expenseUpdate.date = dt;
      expenseUpdate.month = dt.getMonth() + 1;
      expenseUpdate.year = dt.getFullYear();
    }
    if (Object.keys(expenseUpdate).length > 0) {
      await prisma.officeExpense.update({ where: { id: updated.linkedExpenseId }, data: expenseUpdate }).catch(() => {});
    }
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

  // Delete paired OfficeExpense if SPENT_ALREADY
  if (existing.fundFlow === "SPENT_ALREADY" && existing.linkedExpenseId) {
    await prisma.officeExpense.delete({ where: { id: existing.linkedExpenseId } }).catch(() => {});
  }

  await prisma.capitalContribution.delete({ where: { id } });
  await prisma.activityLog.create({ data: { userId: session.userId, action: "DELETE", entityType: "CapitalContribution", entityId: id } });
  return NextResponse.json({ success: true });
}
