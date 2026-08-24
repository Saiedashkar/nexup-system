import { NextRequest, NextResponse } from "next/server";
import { getCurrentSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getCurrentSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (session.role === "EMPLOYEE") return NextResponse.json({ error: "Access denied" }, { status: 403 });

  const { id } = await params;
  const expense = await prisma.expense.findUnique({ where: { id } });
  if (!expense) return NextResponse.json({ error: "Not found" }, { status: 404 });

  await prisma.expense.delete({ where: { id } });

  await prisma.activityLog.create({
    data: { userId: session.userId, action: "DELETE", entityType: "Expense", entityId: id },
  });

  return NextResponse.json({ success: true });
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getCurrentSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (session.role === "EMPLOYEE") return NextResponse.json({ error: "Access denied" }, { status: 403 });

  const { id } = await params;
  const body = await req.json();

  const expense = await prisma.expense.findUnique({ where: { id } });
  if (!expense) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const updateData: Record<string, unknown> = {};
  if (body.description !== undefined) updateData.description = body.description;
  if (body.cost !== undefined) updateData.cost = parseFloat(body.cost);
  if (body.category !== undefined) updateData.category = body.category;
  if (body.name !== undefined) updateData.name = body.name;
  if (body.notes !== undefined) updateData.notes = body.notes || null;
  if (body.date !== undefined) {
    const d = new Date(body.date);
    updateData.date = d;
    updateData.month = d.getMonth() + 1;
    updateData.year = d.getFullYear();
  }

  const updated = await prisma.expense.update({ where: { id }, data: updateData });

  await prisma.activityLog.create({
    data: { userId: session.userId, action: "UPDATE", entityType: "Expense", entityId: id },
  });

  return NextResponse.json(updated);
}
