import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentSession } from "@/lib/auth";

export const runtime = "nodejs";

// GET — List payments for a project record
export async function GET(request: NextRequest) {
  try {
    const session = await getCurrentSession();
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { searchParams } = new URL(request.url);
    const projectRecordId = searchParams.get("projectRecordId");
    if (!projectRecordId) {
      return NextResponse.json({ error: "projectRecordId is required" }, { status: 400 });
    }

    const payments = await prisma.clientPayment.findMany({
      where: { projectRecordId },
      orderBy: { date: "asc" },
    });

    return NextResponse.json(payments);
  } catch (error) {
    console.error("Failed to fetch payments:", error);
    return NextResponse.json({ error: "Failed to fetch" }, { status: 500 });
  }
}

// POST — Create a new payment for a project record
export async function POST(request: NextRequest) {
  try {
    const session = await getCurrentSession();
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (session.role === "EMPLOYEE") return NextResponse.json({ error: "Access denied" }, { status: 403 });

    const body = await request.json();
    const { projectRecordId, amount, date, note } = body;

    if (!projectRecordId || !amount) {
      return NextResponse.json({ error: "projectRecordId and amount are required" }, { status: 400 });
    }

    const amountNum = parseFloat(String(amount));
    if (amountNum <= 0) {
      return NextResponse.json({ error: "Amount must be positive" }, { status: 400 });
    }

    // Get the project record
    const project = await prisma.projectRecord.findUnique({
      where: { id: projectRecordId },
      include: { client: true },
    });
    if (!project) {
      return NextResponse.json({ error: "Project not found" }, { status: 404 });
    }

    // Don't allow overpayment
    const currentRemaining = parseFloat(String(project.remaining));
    if (amountNum > currentRemaining) {
      return NextResponse.json({ error: `Amount exceeds remaining (${currentRemaining})` }, { status: 400 });
    }

    // Create the payment record
    const payment = await prisma.clientPayment.create({
      data: {
        projectRecordId,
        amount: amountNum,
        date: date ? new Date(date) : new Date(),
        note: note || null,
        createdByUserId: session.userId,
      },
    });

    // Update project: deposit += amount, remaining -= amount
    const newDeposit = parseFloat(String(project.deposit)) + amountNum;
    const newRemaining = Math.max(0, parseFloat(String(project.totalPrice)) - newDeposit);
    const newPaymentStatus = newRemaining <= 0 ? "FULL" : newDeposit > 0 ? "PARTIAL" : "UNPAID";

    await prisma.projectRecord.update({
      where: { id: projectRecordId },
      data: {
        deposit: newDeposit,
        remaining: newRemaining,
        paymentStatus: newPaymentStatus as "FULL" | "PARTIAL" | "UNPAID",
      },
    });

    // Auto-create PoolTransaction IN
    await prisma.poolTransaction.create({
      data: {
        businessId: project.businessId,
        projectRecordId,
        amountSAR: amountNum,
        type: "IN",
        date: date ? new Date(date) : new Date(),
        note: `Payment: ${project.client.name} — ${project.projectName}${note ? ` (${note})` : ""}`,
      },
    });

    // Recalculate client tier
    const projectCount = await prisma.projectRecord.count({ where: { clientId: project.clientId } });
    const totalPaidAgg = await prisma.projectRecord.aggregate({
      where: { clientId: project.clientId, paymentStatus: "FULL" },
      _sum: { totalPrice: true },
    });
    const totalRevenue = Number(totalPaidAgg._sum.totalPrice ?? 0);
    let tier: "VIP" | "LOYAL" | "NORMAL" | "DELINQUENT" = "NORMAL";
    if (totalRevenue > 1000 || projectCount >= 3) tier = "VIP";
    else if (totalRevenue > 500 || projectCount >= 2) tier = "LOYAL";
    await prisma.client.update({ where: { id: project.clientId }, data: { tier } });

    // Log activity
    await prisma.activityLog.create({
      data: {
        userId: session.userId,
        action: "CREATE",
        entityType: "ClientPayment",
        entityId: payment.id,
      },
    });

    return NextResponse.json(payment, { status: 201 });
  } catch (error) {
    console.error("Failed to create payment:", error);
    return NextResponse.json({ error: "Failed to create payment" }, { status: 500 });
  }
}
