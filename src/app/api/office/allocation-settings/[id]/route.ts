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
  if (body.allocationPct !== undefined) updateData.allocationPct = parseFloat(body.allocationPct);
  if (body.effectiveDate) updateData.effectiveDate = new Date(body.effectiveDate);
  const updated = await prisma.officeAllocationSetting.update({ where: { id }, data: updateData });
  await prisma.activityLog.create({ data: { userId: session.userId, action: "UPDATE", entityType: "OfficeAllocationSetting", entityId: id } });
  return NextResponse.json(updated);
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getCurrentSession();
  if (!session || session.role !== "SUPER_ADMIN") return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { id } = await params;
  await prisma.officeAllocationSetting.delete({ where: { id } });
  await prisma.activityLog.create({ data: { userId: session.userId, action: "DELETE", entityType: "OfficeAllocationSetting", entityId: id } });
  return NextResponse.json({ success: true });
}
