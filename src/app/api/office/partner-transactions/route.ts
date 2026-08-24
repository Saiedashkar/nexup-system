import { NextRequest, NextResponse } from "next/server";
import { getCurrentSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const session = await getCurrentSession();
  if (!session || session.role !== "SUPER_ADMIN") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { searchParams } = new URL(req.url);
  const partnerId = searchParams.get("partnerId");

  const where: Record<string, unknown> = {};
  if (partnerId) where.partnerId = partnerId;

  const transactions = await prisma.partnerTransaction.findMany({
    where,
    include: { partner: true, business: true },
    orderBy: { date: "desc" },
  });

  return NextResponse.json(transactions);
}

export async function POST(req: NextRequest) {
  const session = await getCurrentSession();
  if (!session || session.role !== "SUPER_ADMIN") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = await req.json();
  if (!body.partnerId || !body.type || !body.amount || !body.date) {
    return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
  }

  const tx = await prisma.partnerTransaction.create({
    data: {
      partnerId: body.partnerId,
      type: body.type,
      amount: parseFloat(body.amount),
      date: new Date(body.date),
      businessId: body.businessId || null,
      note: body.note || null,
    },
  });

  await prisma.activityLog.create({
    data: { userId: session.userId, action: "CREATE", entityType: "PartnerTransaction", entityId: tx.id },
  });

  return NextResponse.json(tx, { status: 201 });
}
