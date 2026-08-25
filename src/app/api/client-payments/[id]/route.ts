import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentSession } from "@/lib/auth";

export const runtime = "nodejs";

// PATCH — Update a payment
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getCurrentSession();
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (session.role === "EMPLOYEE") return NextResponse.json({ error: "Access denied" }, { status: 403 });

    const { id } = await params;
    const body = await request.json();

    const existing = await prisma.clientPayment.findUnique({
      where: { id },
      include: { projectRecord: { include: { client: true } } },
    });
    if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const updateData: Record<string, unknown> = {};
    if (body.amount !== undefined) {
      const newAmount = parseFloat(String(body.amount));
      const oldAmount = parseFloat(String(existing.amount));
      const diff = newAmount - oldAmount;
      
      updateData.amount = newAmount;

      // Update project deposit/remaining
      const project = existing.projectRecord;
      const newDeposit = parseFloat(String(project.deposit)) + diff;
      const newRemaining = Math.max(0, parseFloat(String(project.totalPrice)) - newDeposit);
      const newPaymentStatus = newRemaining <= 0 ? "FULL" : newDeposit > 0 ? "PARTIAL" : "UNPAID";

      await prisma.projectRecord.update({
        where: { id: project.id },
        data: {
          deposit: newDeposit,
          remaining: newRemaining,
          paymentStatus: newPaymentStatus as "FULL" | "PARTIAL" | "UNPAID",
        },
      });
    }
    if (body.date !== undefined) updateData.date = new Date(body.date);
    if (body.note !== undefined) updateData.note = body.note || null;

    const updated = await prisma.clientPayment.update({ where: { id }, data: updateData });

    await prisma.activityLog.create({
      data: { userId: session.userId, action: "UPDATE", entityType: "ClientPayment", entityId: id },
    });

    return NextResponse.json(updated);
  } catch (error) {
    console.error("Failed to update payment:", error);
    return NextResponse.json({ error: "Failed to update" }, { status: 500 });
  }
}

// DELETE — Remove a payment and reverse its effect on the project
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getCurrentSession();
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (session.role === "EMPLOYEE") return NextResponse.json({ error: "Access denied" }, { status: 403 });

    const { id } = await params;

    const existing = await prisma.clientPayment.findUnique({
      where: { id },
      include: { projectRecord: true },
    });
    if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

    // Reverse the payment amount from the project
    const amount = parseFloat(String(existing.amount));
    const project = existing.projectRecord;
    const newDeposit = Math.max(0, parseFloat(String(project.deposit)) - amount);
    const newRemaining = parseFloat(String(project.totalPrice)) - newDeposit;
    const newPaymentStatus = newRemaining <= 0 ? "FULL" : newDeposit > 0 ? "PARTIAL" : "UNPAID";

    await prisma.projectRecord.update({
      where: { id: project.id },
      data: {
        deposit: newDeposit,
        remaining: newRemaining,
        paymentStatus: newPaymentStatus as "FULL" | "PARTIAL" | "UNPAID",
      },
    });

    // Delete the corresponding PoolTransaction
    await prisma.poolTransaction.deleteMany({
      where: {
        projectRecordId: project.id,
        type: "IN",
        amountSAR: amount,
      },
    });

    await prisma.clientPayment.delete({ where: { id } });

    await prisma.activityLog.create({
      data: { userId: session.userId, action: "DELETE", entityType: "ClientPayment", entityId: id },
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Failed to delete payment:", error);
    return NextResponse.json({ error: "Failed to delete" }, { status: 500 });
  }
}
