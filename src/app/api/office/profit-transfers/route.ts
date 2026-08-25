import { NextResponse } from "next/server";
import { getCurrentSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

export async function GET() {
  const session = await getCurrentSession();
  if (!session || session.role !== "SUPER_ADMIN") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const transfers = await prisma.profitTransfer.findMany({
    include: { business: { select: { name: true, slug: true } } },
    orderBy: { date: "desc" },
  });
  return NextResponse.json(transfers);
}

export async function POST(request: Request) {
  const session = await getCurrentSession();
  if (!session || session.role !== "SUPER_ADMIN") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = await request.json();
  const { businessId, amount, date, note } = body;

  if (!businessId || !amount || !date) {
    return NextResponse.json({ error: "businessId, amount, and date are required" }, { status: 400 });
  }

  const transfer = await prisma.profitTransfer.create({
    data: {
      businessId,
      amount: parseFloat(amount),
      date: new Date(date),
      note: note || null,
    },
    include: { business: { select: { name: true, slug: true } } },
  });

  await prisma.activityLog.create({
    data: { userId: session.userId, action: "CREATE", entityType: "ProfitTransfer", entityId: transfer.id },
  });

  return NextResponse.json(transfer, { status: 201 });
}
