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

  const existing = await prisma.nexupProfitLedger.findUnique({ where: { id } });
  if (!existing) return NextResponse.json({ error: "Entry not found" }, { status: 404 });

  const updateData: Record<string, unknown> = {};
  if (body.amount !== undefined) updateData.amount = parseFloat(body.amount);
  if (body.date !== undefined) updateData.date = new Date(body.date);
  if (body.note !== undefined) updateData.note = body.note;
  if (body.partnerId !== undefined) {
    const partner = await prisma.partner.findUnique({ where: { id: body.partnerId } });
    if (!partner || !["SAIED", "ADEL"].includes(partner.name.toUpperCase())) {
      return NextResponse.json({ error: "Partner must be SAIED or ADEL" }, { status: 403 });
    }
    updateData.partnerId = body.partnerId;
  }

  const updated = await prisma.nexupProfitLedger.update({
    where: { id },
    data: updateData,
    include: { partner: { select: { name: true } } },
  });

  await prisma.activityLog.create({
    data: { userId: session.userId, action: "UPDATE", entityType: "NexupProfitLedger", entityId: id },
  });

  return NextResponse.json(updated);
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getCurrentSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!isSuperAdmin(session)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { id } = await params;

  const existing = await prisma.nexupProfitLedger.findUnique({ where: { id } });
  if (!existing) return NextResponse.json({ error: "Entry not found" }, { status: 404 });

  await prisma.nexupProfitLedger.delete({ where: { id } });

  await prisma.activityLog.create({
    data: { userId: session.userId, action: "DELETE", entityType: "NexupProfitLedger", entityId: id },
  });

  return NextResponse.json({ success: true });
}
