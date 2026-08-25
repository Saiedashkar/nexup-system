import { NextResponse } from "next/server";
import { getCurrentSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

export async function GET() {
  const session = await getCurrentSession();
  if (!session || session.role !== "SUPER_ADMIN") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const now = new Date();
  const currentMonth = now.getMonth() + 1;
  const currentYear = now.getFullYear();

  // Office expenses this month
  const monthExpenses = await prisma.officeExpense.findMany({
    where: { month: currentMonth, year: currentYear },
  });
  const totalMonthExpenses = monthExpenses.reduce((s, e) => s + e.cost, 0);

  // All office expenses
  const allExpenses = await prisma.officeExpense.findMany();
  const totalAllExpenses = allExpenses.reduce((s, e) => s + e.cost, 0);

  // Capital contributions (CASH only for treasury)
  const capital = await prisma.capitalContribution.findMany({ include: { partner: true } });
  const totalCapital = capital.reduce((s, c) => s + c.amount, 0);
  const cashCapital = capital.filter(c => c.type === "CASH").reduce((s, c) => s + c.amount, 0);

  // Profit transfers from businesses to office treasury
  const profitTransfers = await prisma.profitTransfer.findMany();
  const totalProfitTransfers = profitTransfers.reduce((s, t) => s + t.amount, 0);

  // Partner transactions that take money OUT of treasury
  const allPartnerTx = await prisma.partnerTransaction.findMany();
  const partnerOutflows = allPartnerTx
    .filter(t => ["SALARY", "ADVANCE", "WITHDRAWAL", "PROFIT_SHARE"].includes(t.type))
    .reduce((s, t) => s + t.amount, 0);
  // LOAN_SETTLEMENT puts money BACK into treasury
  const partnerInflows = allPartnerTx
    .filter(t => t.type === "LOAN_SETTLEMENT")
    .reduce((s, t) => s + t.amount, 0);

  // OFFICE TREASURY BALANCE = Cash Capital + Profit Transfers - Expenses - Partner Outflows + Loan Settlements
  const officeTreasuryBalance = cashCapital + totalProfitTransfers - totalAllExpenses - partnerOutflows + partnerInflows;

  // Partner summary
  const partners = await prisma.partner.findMany({ include: { transactions: true, capitalContributions: true } });
  const partnerSummary = partners.map(p => {
    let balance = 0;
    const sorted = [...p.transactions].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
    for (const t of sorted) {
      if (["SALARY", "PROFIT_SHARE"].includes(t.type)) balance += t.amount;
      else balance -= t.amount;
    }
    const totalAdvances = p.transactions.filter(t => t.type === "ADVANCE").reduce((s, t) => s + t.amount, 0);
    const totalSettled = p.transactions.filter(t => t.type === "LOAN_SETTLEMENT").reduce((s, t) => s + t.amount, 0);
    return {
      id: p.id, name: p.name, balance, outstandingAdvances: totalAdvances - totalSettled,
      totalCapital: p.capitalContributions.reduce((s, c) => s + c.amount, 0),
      txCount: p.transactions.length,
    };
  });

  // Monthly expenses breakdown (last 6 months)
  const monthlyBreakdown: { month: number; year: number; total: number }[] = [];
  for (let i = 0; i < 6; i++) {
    const d = new Date(currentYear, currentMonth - 1 - i, 1);
    const m = d.getMonth() + 1;
    const y = d.getFullYear();
    const mExpenses = allExpenses.filter(e => e.month === m && e.year === y);
    monthlyBreakdown.push({ month: m, year: y, total: mExpenses.reduce((s, e) => s + e.cost, 0) });
  }

  return NextResponse.json({
    currentMonth: { totalExpenses: totalMonthExpenses, expenseCount: monthExpenses.length },
    allTime: { totalExpenses: totalAllExpenses, totalCapital, expenseCount: allExpenses.length },
    officeTreasury: {
      balance: officeTreasuryBalance,
      cashCapital,
      profitTransfers: totalProfitTransfers,
      partnerOutflows,
      partnerInflows,
    },
    partnerSummary,
    monthlyBreakdown: monthlyBreakdown.reverse(),
  });
}
