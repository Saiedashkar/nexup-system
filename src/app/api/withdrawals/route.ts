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
  const businessSlug = searchParams.get("businessSlug");

  // Resolve business filter
  let filterBusinessId: string | undefined;
  if (businessSlug) {
    const biz = await prisma.business.findUnique({ where: { slug: businessSlug }, select: { id: true } });
    if (biz) filterBusinessId = biz.id;
  } else if (session.role !== "SUPER_ADMIN") {
    filterBusinessId = session.businessId;
  }

  const where: Record<string, unknown> = {};
  if (filterBusinessId) where.businessId = filterBusinessId;
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

  // Resolve real businessId — SUPER_ADMIN gets "all" from session which is not a valid FK
  let businessId = session.businessId;
  if (session.role === "SUPER_ADMIN" && (!businessId || businessId === "all")) {
    // NEXUP withdrawals go to the NEXUP business
    const biz = await prisma.business.findUnique({ where: { slug: "nexup" }, select: { id: true } });
    if (biz) businessId = biz.id;
  }
  if (!businessId || businessId === "all") {
    return NextResponse.json({ error: "Could not determine business for this operation" }, { status: 400 });
  }

  const withdrawal = await prisma.withdrawal.create({
    data: {
      businessId,
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
      businessId,
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
