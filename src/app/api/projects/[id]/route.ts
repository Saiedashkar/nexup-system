import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentSession } from "@/lib/auth";

export const runtime = "nodejs";

// PATCH - Update a project record
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

    const existing = await prisma.projectRecord.findUnique({
      where: { id },
      include: { client: true },
    });
    if (!existing) {
      return NextResponse.json({ error: "Record not found" }, { status: 404 });
    }

    const updateData: Record<string, unknown> = {};

    if (body.workStatus !== undefined) updateData.workStatus = body.workStatus;
    if (body.designerId !== undefined) updateData.designerId = body.designerId;
    if (body.projectName !== undefined) updateData.projectName = body.projectName;
    if (body.notes !== undefined) updateData.notes = body.notes;

    // Handle payment updates
    if (body.deposit !== undefined) {
      const newDeposit = parseFloat(String(body.deposit));
      const newRemaining = parseFloat(String(existing.totalPrice)) - newDeposit;
      updateData.deposit = newDeposit;
      updateData.remaining = Math.max(0, newRemaining);
      updateData.paymentStatus = newDeposit >= parseFloat(String(existing.totalPrice))
        ? "FULL"
        : newDeposit > 0
        ? "PARTIAL"
        : "UNPAID";

      const depositDiff = newDeposit - parseFloat(String(existing.deposit));
      if (depositDiff > 0) {
        await prisma.poolTransaction.create({
          data: {
            businessId: existing.businessId,
            projectRecordId: id,
            amountSAR: depositDiff,
            type: "IN",
            date: new Date(),
            note: `Payment — ${existing.client.name} — ${existing.projectName}`,
          },
        });
      }
    }

    // Auto-complete work status toggle
    if (body.toggleComplete) {
      updateData.workStatus = existing.workStatus === "COMPLETED" ? "IN_PROGRESS" : "COMPLETED";
      if (updateData.workStatus === "COMPLETED") {
        if (parseFloat(String(existing.remaining)) > 0) {
          updateData.paymentStatus = "FULL";
          updateData.remaining = 0;
          const remainingAmount = parseFloat(String(existing.remaining));
          if (remainingAmount > 0) {
            await prisma.poolTransaction.create({
              data: {
                businessId: existing.businessId,
                projectRecordId: id,
                amountSAR: remainingAmount,
                type: "IN",
                date: new Date(),
                note: `Final payment — ${existing.client.name} — ${existing.projectName}`,
              },
            });
          }
        }
      }
    }

    const updated = await prisma.projectRecord.update({
      where: { id },
      data: updateData,
      include: {
        client: { select: { id: true, name: true, phone: true, tier: true } },
        designer: { select: { id: true, name: true } },
        services: { select: { id: true, name: true } },
      },
    });

    // Recalculate client tier
    const projectCount = await prisma.projectRecord.count({
      where: { clientId: existing.clientId },
    });
    const totalPaid = await prisma.projectRecord.aggregate({
      where: { clientId: existing.clientId, paymentStatus: "FULL" },
      _sum: { totalPrice: true },
    });
    const totalRevenue = Number(totalPaid._sum.totalPrice ?? 0);

    let tier: "VIP" | "LOYAL" | "NORMAL" | "DELINQUENT" = "NORMAL";
    if (totalRevenue > 1000 || projectCount >= 3) tier = "VIP";
    else if (totalRevenue > 500 || projectCount >= 2) tier = "LOYAL";

    await prisma.client.update({
      where: { id: existing.clientId },
      data: { tier },
    });

    await prisma.activityLog.create({
      data: {
        userId: session.userId,
        action: "UPDATE",
        entityType: "ProjectRecord",
        entityId: id,
      },
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
    if (session.role === "EMPLOYEE") return NextResponse.json({ error: "Access denied" }, { status: 403 });

    const { id } = await params;

    const existing = await prisma.projectRecord.findUnique({
      where: { id },
      include: { poolTransactions: true },
    });
    if (!existing) {
      return NextResponse.json({ error: "Record not found" }, { status: 404 });
    }

    await prisma.poolTransaction.deleteMany({
      where: { projectRecordId: id },
    });

    await prisma.projectRecord.delete({ where: { id } });

    await prisma.activityLog.create({
      data: {
        userId: session.userId,
        action: "DELETE",
        entityType: "ProjectRecord",
        entityId: id,
      },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Failed to delete project:", error);
    return NextResponse.json({ error: "Failed to delete" }, { status: 500 });
  }
}
