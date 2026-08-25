import { NextResponse } from "next/server";
import { getCurrentSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const session = await getCurrentSession();
  if (!session || session.role !== "SUPER_ADMIN") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { id } = await context.params;
  const body = await request.json();
  const data: Record<string, unknown> = {};
  if (body.amount !== undefined) data.amount = parseFloat(body.amount);
  if (body.date !== undefined) data.date = new Date(body.date);
  if (body.note !== undefined) data.note = body.note || null;
  if (body.businessId !== undefined) data.businessId = body.businessId;

  const transfer = await prisma.profitTransfer.update({
    where: { id },
    data,
    include: { business: { select: { name: true, slug: true } } },
  });

  await prisma.activityLog.create({
    data: { userId: session.userId, action: "UPDATE", entityType: "ProfitTransfer", entityId: id },
  });

  return NextResponse.json(transfer);
}

export async function DELETE(_request: Request, context: { params: Promise<{ id: string }> }) {
  const session = await getCurrentSession();
  if (!session || session.role !== "SUPER_ADMIN") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { id } = await context.params;

  await prisma.profitTransfer.delete({ where: { id } });

  await prisma.activityLog.create({
    data: { userId: session.userId, action: "DELETE", entityType: "ProfitTransfer", entityId: id },
  });

  return NextResponse.json({ ok: true });
}
