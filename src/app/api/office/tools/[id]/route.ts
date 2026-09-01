import { NextRequest, NextResponse } from "next/server";
import { getCurrentSession, isSuperAdmin } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getCurrentSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!isSuperAdmin(session)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { id } = await params;
  const body = await req.json();

  const tool = await prisma.officeTool.findUnique({ where: { id } });
  if (!tool) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const updateData: Record<string, unknown> = {};
  if (body.name !== undefined) updateData.name = body.name;
  if (body.type !== undefined) updateData.type = body.type;
  if (body.category !== undefined) updateData.category = body.category;
  if (body.cost !== undefined) updateData.cost = parseFloat(body.cost);
  if (body.status !== undefined) updateData.status = body.status;
  if (body.paidBy !== undefined) updateData.paidBy = body.paidBy;
  if (body.notes !== undefined) updateData.notes = body.notes;
  if (body.nextDueDate !== undefined) updateData.nextDueDate = body.nextDueDate ? new Date(body.nextDueDate) : null;
  if (body.intervalDays !== undefined) updateData.intervalDays = body.intervalDays ? parseInt(body.intervalDays) : null;

  const updated = await prisma.officeTool.update({ where: { id }, data: updateData });

  await prisma.activityLog.create({
    data: { userId: session.userId, action: "UPDATE", entityType: "OfficeTool", entityId: id },
  });

  return NextResponse.json(updated);
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getCurrentSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!isSuperAdmin(session)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { id } = await params;

  const tool = await prisma.officeTool.findUnique({ where: { id } });
  if (!tool) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // Delete payments first
  await prisma.officeToolPayment.deleteMany({ where: { toolId: id } });
  await prisma.officeTool.delete({ where: { id } });

  await prisma.activityLog.create({
    data: { userId: session.userId, action: "DELETE", entityType: "OfficeTool", entityId: id },
  });

  return NextResponse.json({ success: true });
}

// POST: Record a payment for a tool
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getCurrentSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!isSuperAdmin(session)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { id } = await params;
  const body = await req.json();
  const { amount, paidDate, notes } = body;

  if (!amount || !paidDate) {
    return NextResponse.json({ error: "Missing required fields: amount, paidDate" }, { status: 400 });
  }

  const tool = await prisma.officeTool.findUnique({ where: { id } });
  if (!tool) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const payment = await prisma.officeToolPayment.create({
    data: {
      toolId: id,
      amount: parseFloat(amount),
      paidDate: new Date(paidDate),
      notes: notes || null,
    },
  });

  // Auto-update nextDueDate for MONTHLY_SUBSCRIPTION
  if (tool.type === "MONTHLY_SUBSCRIPTION" && tool.nextDueDate) {
    const next = new Date(tool.nextDueDate);
    next.setMonth(next.getMonth() + 1);
    await prisma.officeTool.update({ where: { id }, data: { nextDueDate: next } });
  }

  // Auto-update nextDueDate for PERIODIC
  if (tool.type === "PERIODIC" && tool.intervalDays && tool.nextDueDate) {
    const next = new Date(tool.nextDueDate);
    next.setDate(next.getDate() + tool.intervalDays);
    await prisma.officeTool.update({ where: { id }, data: { nextDueDate: next } });
  }

  await prisma.activityLog.create({
    data: { userId: session.userId, action: "CREATE", entityType: "OfficeToolPayment", entityId: payment.id },
  });

  return NextResponse.json(payment, { status: 201 });
}
