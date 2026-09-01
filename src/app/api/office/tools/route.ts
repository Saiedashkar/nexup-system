import { NextRequest, NextResponse } from "next/server";
import { getCurrentSession, isSuperAdmin } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

export async function GET() {
  const session = await getCurrentSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!isSuperAdmin(session)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const tools = await prisma.officeTool.findMany({
    include: {
      payments: { orderBy: { paidDate: "desc" }, take: 5 },
    },
    orderBy: { createdAt: "desc" },
  });

  // Compute totals
  const totalCost = tools.reduce((s, t) => s + t.cost, 0);
  const monthlyTotal = tools
    .filter(t => t.type === "MONTHLY_SUBSCRIPTION" && t.status === "ACTIVE")
    .reduce((s, t) => s + t.cost, 0);
  const totalPaid = tools.reduce((s, t) =>
    s + t.payments.reduce((ps, p) => ps + p.amount, 0), 0);

  return NextResponse.json({ tools, totalCost, monthlyTotal, totalPaid });
}

export async function POST(req: NextRequest) {
  const session = await getCurrentSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!isSuperAdmin(session)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = await req.json();
  const { name, type, category, cost, purchaseDate, nextDueDate, intervalDays, paidBy, notes } = body;

  if (!name || !type || !cost || !purchaseDate) {
    return NextResponse.json({ error: "Missing required fields: name, type, cost, purchaseDate" }, { status: 400 });
  }

  const tool = await prisma.officeTool.create({
    data: {
      name,
      type,
      category: category || "General",
      cost: parseFloat(cost),
      purchaseDate: new Date(purchaseDate),
      nextDueDate: nextDueDate ? new Date(nextDueDate) : null,
      intervalDays: intervalDays ? parseInt(intervalDays) : null,
      paidBy: paidBy || "CAPITAL",
      notes: notes || null,
    },
  });

  await prisma.activityLog.create({
    data: {
      userId: session.userId,
      action: "CREATE",
      entityType: "OfficeTool",
      entityId: tool.id,
    },
  });

  return NextResponse.json(tool, { status: 201 });
}
