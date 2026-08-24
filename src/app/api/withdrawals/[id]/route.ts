import { NextRequest, NextResponse } from "next/server";
import { getCurrentSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getCurrentSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (session.role === "EMPLOYEE") return NextResponse.json({ error: "Access denied" }, { status: 403 });

  const { id } = await params;

  // Find the withdrawal
  const withdrawal = await prisma.withdrawal.findUnique({ where: { id } });
  if (!withdrawal) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // Delete linked pool transaction first
  await prisma.poolTransaction.deleteMany({ where: { withdrawalId: id } });

  // Delete the withdrawal
  await prisma.withdrawal.delete({ where: { id } });

  await prisma.activityLog.create({
    data: {
      userId: session.userId,
      action: "DELETE",
      entityType: "Withdrawal",
      entityId: id,
    },
  });

  return NextResponse.json({ success: true });
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getCurrentSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (session.role === "EMPLOYEE") return NextResponse.json({ error: "Access denied" }, { status: 403 });

  const { id } = await params;
  const body = await req.json();

  const withdrawal = await prisma.withdrawal.findUnique({ where: { id } });
  if (!withdrawal) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const updateData: Record<string, unknown> = {};
  if (body.amountSAR !== undefined) updateData.amountSAR = parseFloat(body.amountSAR);
  if (body.exchangeRate !== undefined) updateData.exchangeRate = parseFloat(body.exchangeRate);
  if (body.commissionPct !== undefined) updateData.commissionPct = parseFloat(body.commissionPct);
  if (body.date !== undefined) {
    const d = new Date(body.date);
    updateData.date = d;
    updateData.month = d.getMonth() + 1;
    updateData.year = d.getFullYear();
  }

  // Recalculate netEGP if any of the 3 values changed
  const newAmount = updateData.amountSAR !== undefined ? Number(updateData.amountSAR) : Number(withdrawal.amountSAR);
  const newRate = updateData.exchangeRate !== undefined ? Number(updateData.exchangeRate) : Number(withdrawal.exchangeRate);
  const newCommission = updateData.commissionPct !== undefined ? Number(updateData.commissionPct) : Number(withdrawal.commissionPct);
  updateData.netEGP = newAmount * newRate * (1 - newCommission / 100);

  const updated = await prisma.withdrawal.update({ where: { id }, data: updateData });

  // Update linked pool transaction
  await prisma.poolTransaction.updateMany({
    where: { withdrawalId: id },
    data: {
      amountSAR: newAmount,
      date: updateData.date || withdrawal.date,
      note: `Withdrawal to Egypt — ${Number(updated.netEGP).toFixed(2)} EGP`,
    },
  });

  await prisma.activityLog.create({
    data: {
      userId: session.userId,
      action: "UPDATE",
      entityType: "Withdrawal",
      entityId: id,
    },
  });

  return NextResponse.json(updated);
}
