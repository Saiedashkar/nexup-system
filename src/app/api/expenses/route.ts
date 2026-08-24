import { NextRequest, NextResponse } from "next/server";
import { getCurrentSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function GET(req: NextRequest) {
  const session = await getCurrentSession();
  if (!session || session.role !== "ADMIN") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const month = searchParams.get("month");
  const year = searchParams.get("year");
  const category = searchParams.get("category") as "FIXED" | "VARIABLE" | null;

  const where: Record<string, unknown> = {};
  if (month) where.month = parseInt(month);
  if (year) where.year = parseInt(year);
  if (category) where.category = category;

  const expenses = await prisma.expense.findMany({
    where,
    orderBy: { date: "desc" },
  });

  // Calculate total
  let total = 0;
  for (const e of expenses) {
    total += Number(e.cost);
  }

  return NextResponse.json({ expenses, total });
}

export async function POST(req: NextRequest) {
  const session = await getCurrentSession();
  if (!session || session.role !== "ADMIN") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json();
  const { description, cost, category, name, notes, date } = body;

  if (!description || !cost || !category || !name || !date) {
    return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
  }

  const d = new Date(date);

  const expense = await prisma.expense.create({
    data: {
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
