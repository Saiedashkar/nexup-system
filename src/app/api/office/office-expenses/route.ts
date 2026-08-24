import { NextRequest, NextResponse } from "next/server";
import { getCurrentSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

export async function GET() {
  const session = await getCurrentSession();
  if (!session || session.role !== "SUPER_ADMIN") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const expenses = await prisma.officeExpense.findMany({ orderBy: { date: "desc" } });
  return NextResponse.json(expenses);
}

export async function POST(req: NextRequest) {
  const session = await getCurrentSession();
  if (!session || session.role !== "SUPER_ADMIN") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = await req.json();
  if (!body.description || !body.cost || !body.category || !body.name || !body.date) {
    return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
  }

  const d = new Date(body.date);
  const expense = await prisma.officeExpense.create({
    data: {
      description: body.description,
      cost: parseFloat(body.cost),
      category: body.category,
      name: body.name,
      notes: body.notes || null,
      date: d,
      month: d.getMonth() + 1,
      year: d.getFullYear(),
    },
  });

  await prisma.activityLog.create({
    data: { userId: session.userId, action: "CREATE", entityType: "OfficeExpense", entityId: expense.id },
  });

  return NextResponse.json(expense, { status: 201 });
}
