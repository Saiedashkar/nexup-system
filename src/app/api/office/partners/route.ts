import { NextRequest, NextResponse } from "next/server";
import { getCurrentSession, canAccessOfficeFinance } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

export async function GET() {
  const session = await getCurrentSession();
  if (!session || !canAccessOfficeFinance(session)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const partners = await prisma.partner.findMany({
    include: {
      ownerships: { include: { business: true }, orderBy: { effectiveDate: "desc" } },
      transactions: { orderBy: { date: "desc" } },
      capitalContributions: { orderBy: { date: "desc" } },
    },
    orderBy: { name: "asc" },
  });

  // Compute running balance for each partner
  const result = partners.map(p => {
    let balance = 0;
    // Sort transactions oldest first for running balance
    const sorted = [...p.transactions].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
    const withBalance = sorted.map(t => {
      if (["SALARY", "PROFIT_SHARE"].includes(t.type)) balance += t.amount;
      else balance -= t.amount;
      return { ...t, runningBalance: balance };
    });

    const totalCapital = p.capitalContributions.reduce((s, c) => s + c.amount, 0);
    const totalAdvances = p.transactions.filter(t => t.type === "ADVANCE").reduce((s, t) => s + t.amount, 0);
    const totalSettled = p.transactions.filter(t => t.type === "LOAN_SETTLEMENT").reduce((s, t) => s + t.amount, 0);
    const outstandingAdvances = totalAdvances - totalSettled;

    return {
      ...p,
      runningBalance: balance,
      totalCapital,
      outstandingAdvances,
      transactions: withBalance.reverse(), // newest first for display
    };
  });

  return NextResponse.json(result);
}

export async function POST(req: NextRequest) {
  const session = await getCurrentSession();
  if (!session || !canAccessOfficeFinance(session)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = await req.json();
  if (!body.name) return NextResponse.json({ error: "Name is required" }, { status: 400 });

  const partner = await prisma.partner.create({ data: { name: body.name.toUpperCase() } });

  await prisma.activityLog.create({
    data: { userId: session.userId, action: "CREATE", entityType: "Partner", entityId: partner.id },
  });

  return NextResponse.json(partner, { status: 201 });
}
