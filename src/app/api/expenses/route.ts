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
  const category = searchParams.get("category") as "FIXED" | "VARIABLE" | null;
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
  if (category) where.category = category;

  const expenses = await prisma.expense.findMany({
    where,
    orderBy: { date: "desc" },
  });

  let total = 0;
  for (const e of expenses) {
    total += Number(e.cost);
  }

  return NextResponse.json({ expenses, total });
}

export async function POST(req: NextRequest) {
  const session = await getCurrentSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (session.role === "EMPLOYEE") return NextResponse.json({ error: "Access denied" }, { status: 403 });

  const body = await req.json();
  const { description, cost, category, name, notes, date, businessSlug } = body;

  if (!description || !cost || !category || !name || !date) {
    return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
  }

  // Resolve businessId
  let businessId = session.businessId;
  if (session.role === "SUPER_ADMIN" && (!businessId || businessId === "all")) {
    const slug = businessSlug || "nexup";
    const biz = await prisma.business.findUnique({ where: { slug }, select: { id: true } });
    if (biz) businessId = biz.id;
  }
  if (!businessId || businessId === "all") {
    return NextResponse.json({ error: "Could not determine business" }, { status: 400 });
  }

  const d = new Date(date);

  const expense = await prisma.expense.create({
    data: {
      businessId,
      description,
      cost: parseFloat(cost),
      category,
      name,
      notes: notes || null,
      date: d,
      month: d.getMonth() + 1,
      year: d.getFullYear(),
    },
  });

  await prisma.activityLog.create({
    data: {
      userId: session.userId,
      action: "CREATE",
      entityType: "Expense",
      entityId: expense.id,
    },
  });

  return NextResponse.json(expense, { status: 201 });
}
