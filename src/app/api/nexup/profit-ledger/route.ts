import { NextRequest, NextResponse } from "next/server";
import { getCurrentSession, isSuperAdmin } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

// Allowed partner names for NEXUP profit distribution
const ALLOWED_PARTNERS = ["SAIED", "ADEL"];

/**
 * Calculate NEXUP Treasury Balance (EGP):
 * = sum(netEGP of all Withdrawals) - sum(NEXUP Expenses) - sum(NexupProfitLedger) - sum(ProfitTransfers from NEXUP)
 */
async function getNexupTreasuryBalance(): Promise<number> {
  const nexup = await prisma.business.findUnique({ where: { slug: "nexup" } });
  if (!nexup) return 0;

  const [withdrawals, expenses, profitLedger, profitTransfers] = await Promise.all([
    prisma.withdrawal.findMany({ where: { businessId: nexup.id }, select: { netEGP: true } }),
    prisma.expense.findMany({ where: { businessId: nexup.id }, select: { cost: true } }),
    prisma.nexupProfitLedger.findMany({ select: { amount: true } }),
    prisma.profitTransfer.findMany({ where: { businessId: nexup.id }, select: { amount: true } }),
  ]);

  const totalWithdrawnEGP = withdrawals.reduce((s, w) => s + Number(w.netEGP), 0);
  const totalExpenses = expenses.reduce((s, e) => s + Number(e.cost), 0);
  const totalProfitDistributed = profitLedger.reduce((s, l) => s + l.amount, 0);
  const totalProfitTransferred = profitTransfers.reduce((s, t) => s + t.amount, 0);

  return totalWithdrawnEGP - totalExpenses - totalProfitDistributed - totalProfitTransferred;
}

export async function GET() {
  const session = await getCurrentSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!isSuperAdmin(session)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const [ledger, treasuryBalance] = await Promise.all([
    prisma.nexupProfitLedger.findMany({
      include: { partner: { select: { name: true } } },
      orderBy: { date: "desc" },
    }),
    getNexupTreasuryBalance(),
  ]);

  // Per-partner totals
  const saiedTotal = ledger.filter(l => l.partner.name.toUpperCase() === "SAIED").reduce((s, l) => s + l.amount, 0);
  const adelTotal = ledger.filter(l => l.partner.name.toUpperCase() === "ADEL").reduce((s, l) => s + l.amount, 0);

  return NextResponse.json({
    ledger,
    treasuryBalance,
    partnerTotals: { SAIED: saiedTotal, ADEL: adelTotal },
  });
}

export async function POST(request: Request) {
  const session = await getCurrentSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!isSuperAdmin(session)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = await request.json();
  const { partnerId, amount, date, note } = body;

  if (!partnerId || !amount || !date) {
    return NextResponse.json({ error: "partnerId, amount, and date are required" }, { status: 400 });
  }

  const parsedAmount = parseFloat(amount);
  if (isNaN(parsedAmount) || parsedAmount <= 0) {
    return NextResponse.json({ error: "Amount must be a positive number" }, { status: 400 });
  }

  // Validate partner exists and is either SAIED or ADEL
  const partner = await prisma.partner.findUnique({ where: { id: partnerId } });
  if (!partner) return NextResponse.json({ error: "Partner not found" }, { status: 404 });

  if (!ALLOWED_PARTNERS.includes(partner.name.toUpperCase())) {
    return NextResponse.json({ error: "NEXUP profit distribution is restricted to SAIED and ADEL only" }, { status: 403 });
  }

  // Check treasury balance sufficiency
  const treasuryBalance = await getNexupTreasuryBalance();
  if (parsedAmount > treasuryBalance) {
    return NextResponse.json({
      error: `Insufficient NEXUP treasury balance. Available: ${treasuryBalance.toFixed(2)} EGP, Requested: ${parsedAmount.toFixed(2)} EGP`,
    }, { status: 400 });
  }

  const ledgerEntry = await prisma.nexupProfitLedger.create({
    data: {
      partnerId,
      amount: parsedAmount,
      date: new Date(date),
      note: note || null,
    },
    include: { partner: { select: { name: true } } },
  });

  await prisma.activityLog.create({
    data: {
      userId: session.userId,
      action: "CREATE",
      entityType: "NexupProfitLedger",
      entityId: ledgerEntry.id,
    },
  });

  return NextResponse.json(ledgerEntry, { status: 201 });
}
