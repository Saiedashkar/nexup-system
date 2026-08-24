import { NextRequest, NextResponse } from "next/server";
import { getCurrentSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getCurrentSession();
  if (!session || session.role !== "SUPER_ADMIN") return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { id } = await params;
  const body = await req.json();
  const updateData: Record<string, unknown> = {};
  if (body.description) updateData.description = body.description;
  if (body.cost !== undefined) updateData.cost = parseFloat(body.cost);
  if (body.category) updateData.category = body.category;
  if (body.name) updateData.name = body.name;
  if (body.notes !== undefined) updateData.notes = body.notes || null;
  if (body.date) {
    const d = new Date(body.date);
    updateData.date = d; updateData.month = d.getMonth() + 1; updateData.year = d.getFullYear();
  }
  const updated = await prisma.officeExpense.update({ where: { id }, data: updateData });
  await prisma.activityLog.create({ data: { userId: session.userId, action: "UPDATE", entityType: "OfficeExpense", entityId: id } });
  return NextResponse.json(updated);
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getCurrentSession();
  if (!session || session.role !== "SUPER_ADMIN") return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { id } = await params;
  await prisma.officeExpense.delete({ where: { id } });
  await prisma.activityLog.create({ data: { userId: session.userId, action: "DELETE", entityType: "OfficeExpense", entityId: id } });
  return NextResponse.json({ success: true });
}
