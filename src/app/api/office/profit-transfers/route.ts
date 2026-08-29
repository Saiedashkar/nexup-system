import { NextResponse } from "next/server";
import { getCurrentSession, canAccessOfficeFinance } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

export async function GET() {
  const session = await getCurrentSession();
  if (!session || !canAccessOfficeFinance(session)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const transfers = await prisma.profitTransfer.findMany({
    include: { business: { select: { name: true, slug: true } } },
    orderBy: { date: "desc" },
  });
  return NextResponse.json(transfers);
}

export async function POST(request: Request) {
  const session = await getCurrentSession();
  if (!session || !canAccessOfficeFinance(session)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = await request.json();
  const { businessId, amount, date, note } = body;

  if (!businessId || !amount || !date) {
    return NextResponse.json({ error: "businessId, amount, and date are required" }, { status: 400 });
  }

  const parsedAmount = parseFloat(amount);
  if (isNaN(parsedAmount) || parsedAmount <= 0) {
    return NextResponse.json({ error: "Amount must be a positive number" }, { status: 400 });
  }

  // ─── Validate NEXUP treasury balance if transferring from NEXUP ───
  const business = await prisma.business.findUnique({ where: { id: businessId } });
  if (business && business.slug === "nexup") {
    // Calculate NEXUP treasury balance
    const [withdrawals, expenses, profitLedger, existingTransfers] = await Promise.all([
      prisma.withdrawal.findMany({ where: { businessId }, select: { netEGP: true } }),
      prisma.expense.findMany({ where: { businessId }, select: { cost: true } }),
      prisma.nexupProfitLedger.findMany({ select: { amount: true } }),
      prisma.profitTransfer.findMany({ where: { businessId }, select: { amount: true } }),
    ]);

    const totalWithdrawnEGP = withdrawals.reduce((s, w) => s + Number(w.netEGP), 0);
    const totalExpenses = expenses.reduce((s, e) => s + Number(e.cost), 0);
    const totalProfitDistributed = profitLedger.reduce((s, l) => s + l.amount, 0);
    const totalProfitTransferred = existingTransfers.reduce((s, t) => s + t.amount, 0);
    const treasuryBalance = totalWithdrawnEGP - totalExpenses - totalProfitDistributed - totalProfitTransferred;

    if (parsedAmount > treasuryBalance) {
      return NextResponse.json({
        error: `Insufficient NEXUP treasury balance. Available: ${treasuryBalance.toFixed(2)} EGP, Requested: ${parsedAmount.toFixed(2)} EGP`,
      }, { status: 400 });
    }
  }

  const transfer = await prisma.profitTransfer.create({
    data: {
      businessId,
      amount: parsedAmount,
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
