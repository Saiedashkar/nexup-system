import { NextRequest, NextResponse } from "next/server";
import { getCurrentSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const session = await getCurrentSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (session.role === "EMPLOYEE") return NextResponse.json({ error: "Access denied" }, { status: 403 });

  const { searchParams } = new URL(req.url);
  const type = searchParams.get("type") as "IN" | "OUT" | null;
  const from = searchParams.get("from");
  const to = searchParams.get("to");
  const businessSlug = searchParams.get("businessSlug");

  // Resolve businessId: explicit slug > session businessId > all for non-super-admin
  let filterBusinessId: string | undefined;
  if (businessSlug) {
    const biz = await prisma.business.findUnique({ where: { slug: businessSlug }, select: { id: true } });
    if (!biz) return NextResponse.json({ error: "Business not found" }, { status: 404 });
    filterBusinessId = biz.id;
  } else if (session.role !== "SUPER_ADMIN") {
    filterBusinessId = session.businessId;
  }
  // else: SUPER_ADMIN with no slug = all businesses (original behavior)

  const where: Record<string, unknown> = {};
  if (filterBusinessId) where.businessId = filterBusinessId;
  if (type) where.type = type;
  if (from || to) {
    where.date = {};
    if (from) (where.date as Record<string, unknown>).gte = new Date(from);
    if (to) (where.date as Record<string, unknown>).lte = new Date(to);
  }

  const transactions = await prisma.poolTransaction.findMany({
    where,
    include: { projectRecord: { include: { client: true } } },
    orderBy: { date: "desc" },
  });

  const balanceWhere: Record<string, unknown> = {};
  if (filterBusinessId) balanceWhere.businessId = filterBusinessId;
  const allTransactions = await prisma.poolTransaction.findMany({
    where: balanceWhere,
    select: { type: true, amountSAR: true },
  });

  let balance = 0;
  for (const t of allTransactions) {
    if (t.type === "IN") balance += Number(t.amountSAR);
    else balance -= Number(t.amountSAR);
  }

  return NextResponse.json({ transactions, balance });
}

export async function POST(req: NextRequest) {
  const session = await getCurrentSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (session.role === "EMPLOYEE") return NextResponse.json({ error: "Access denied" }, { status: 403 });

  const body = await req.json();
  const { projectRecordId, amountSAR, type, date, note } = body;

  if (!amountSAR || !type || !date) {
    return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
  }

  const transaction = await prisma.poolTransaction.create({
    data: {
      businessId: session.businessId,
      projectRecordId: projectRecordId || null,
      amountSAR: parseFloat(amountSAR),
      type,
      date: new Date(date),
      note: note || null,
    },
  });

  await prisma.activityLog.create({
    data: {
      userId: session.userId,
      action: "CREATE",
      entityType: "PoolTransaction",
      entityId: transaction.id,
    },
  });

  return NextResponse.json(transaction, { status: 201 });
}
