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
  if (body.type) updateData.type = body.type;
  if (body.amount !== undefined) updateData.amount = parseFloat(body.amount);
  if (body.date) updateData.date = new Date(body.date);
  if (body.note !== undefined) updateData.note = body.note;
  if (body.businessId !== undefined) updateData.businessId = body.businessId || null;
  const updated = await prisma.partnerTransaction.update({ where: { id }, data: updateData });
  await prisma.activityLog.create({ data: { userId: session.userId, action: "UPDATE", entityType: "PartnerTransaction", entityId: id } });
  return NextResponse.json(updated);
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getCurrentSession();
  if (!session || session.role !== "SUPER_ADMIN") return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { id } = await params;
  await prisma.partnerTransaction.delete({ where: { id } });
  await prisma.activityLog.create({ data: { userId: session.userId, action: "DELETE", entityType: "PartnerTransaction", entityId: id } });
  return NextResponse.json({ success: true });
}
