import { NextRequest, NextResponse } from "next/server";
import { getCurrentSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const session = await getCurrentSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (session.role === "EMPLOYEE") return NextResponse.json({ error: "Access denied" }, { status: 403 });

  const { searchParams } = new URL(req.url);
  const month = searchParams.get("month");
  const year = searchParams.get("year");

  const where: Record<string, unknown> = {};
  if (session.role !== "SUPER_ADMIN") {
    where.businessId = session.businessId;
  }
  if (month) where.month = parseInt(month);
  if (year) where.year = parseInt(year);

  const withdrawals = await prisma.withdrawal.findMany({
    where,
    include: { poolTransaction: true },
    orderBy: { date: "desc" },
  });

  return NextResponse.json(withdrawals);
}

export async function POST(req: NextRequest) {
  const session = await getCurrentSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (session.role === "EMPLOYEE") return NextResponse.json({ error: "Access denied" }, { status: 403 });

  const body = await req.json();
  const { amountSAR, exchangeRate, commissionPct, date } = body;

  if (!amountSAR || !exchangeRate || !date) {
    return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
  }

  const amount = parseFloat(amountSAR);
  const rate = parseFloat(exchangeRate);
  const commission = parseFloat(commissionPct || "10");
  const netEGP = amount * rate * (1 - commission / 100);

  const d = new Date(date);

  const withdrawal = await prisma.withdrawal.create({
    data: {
      businessId: session.businessId,
      amountSAR: amount,
      exchangeRate: rate,
      commissionPct: commission,
      netEGP,
      date: d,
      month: d.getMonth() + 1,
      year: d.getFullYear(),
    },
  });

  await prisma.poolTransaction.create({
    data: {
      businessId: session.businessId,
      withdrawalId: withdrawal.id,
      amountSAR: amount,
      type: "OUT",
      date: d,
      note: `Withdrawal to Egypt — ${netEGP.toFixed(2)} EGP`,
    },
  });

  await prisma.activityLog.create({
    data: {
      userId: session.userId,
      action: "CREATE",
      entityType: "Withdrawal",
      entityId: withdrawal.id,
    },
  });

  return NextResponse.json(withdrawal, { status: 201 });
}
