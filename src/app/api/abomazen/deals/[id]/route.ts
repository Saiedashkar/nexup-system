import { NextRequest, NextResponse } from "next/server";
import { getCurrentSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getCurrentSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const body = await request.json();

  const deal = await prisma.deal.update({
    where: { id },
    data: body,
    include: { property: true },
  });

  if (session.userId) {
    await prisma.activityLog.create({
      data: { userId: session.userId, action: "UPDATE", entityType: "Deal", entityId: id },
    });
  }

  return NextResponse.json(deal);
}

export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getCurrentSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;

  // Delete associated pool transactions first
  await prisma.poolTransaction.deleteMany({ where: { dealId: id } });
  await prisma.deal.delete({ where: { id } });

  if (session.userId) {
    await prisma.activityLog.create({
      data: { userId: session.userId, action: "DELETE", entityType: "Deal", entityId: id },
    });
  }

  return NextResponse.json({ ok: true });
}
