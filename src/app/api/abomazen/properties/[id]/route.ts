import { NextRequest, NextResponse } from "next/server";
import { getCurrentSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { softDeleteRecord } from "@/lib/soft-delete";

export const runtime = "nodejs";

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getCurrentSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const body = await request.json();

  const property = await prisma.property.update({
    where: { id },
    data: body,
  });

  if (session.userId) {
    await prisma.activityLog.create({
      data: { userId: session.userId, action: "UPDATE", entityType: "Property", entityId: id },
    });
  }

  return NextResponse.json(property);
}

export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getCurrentSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;

  await softDeleteRecord("Property", id, session.userId);

  return NextResponse.json({ ok: true });
}
