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

  // Previous month for comparison
  const prevMonth = currentMonth === 1 ? 12 : currentMonth - 1;
  const prevYear = currentMonth === 1 ? currentYear - 1 : currentYear;

  // Office expenses this month
  const monthExpenses = await prisma.officeExpense.findMany({ where: { month: currentMonth, year: currentYear } });
  const totalMonthExpenses = monthExpenses.reduce((s, e) => s + e.cost, 0);

  // Office expenses last month (for comparison)
  const prevMonthExpenses = await prisma.officeExpense.findMany({ where: { month: prevMonth, year: prevYear } });
  const totalPrevMonthExpenses = prevMonthExpenses.reduce((s, e) => s + e.cost, 0);

  // All office expenses
  const allExpenses = await prisma.officeExpense.findMany();
  const totalAllExpenses = allExpenses.reduce((s, e) => s + e.cost, 0);

  // Expense breakdown by category
  const fixedExpenses = allExpenses.filter(e => e.category === "FIXED").reduce((s, e) => s + e.cost, 0);
  const variableExpenses = allExpenses.filter(e => e.category === "VARIABLE").reduce((s, e) => s + e.cost, 0);

  // Capital contributions
  const capital = await prisma.capitalContribution.findMany({ include: { partner: true } });
  const totalCapital = capital.reduce((s, c) => s + c.amount, 0);
  const cashCapital = capital.filter(c => c.type === "CASH").reduce((s, c) => s + c.amount, 0);
  const assetCapital = capital.filter(c => c.type === "ASSET").reduce((s, c) => s + c.amount, 0);

  // Profit transfers
  const profitTransfers = await prisma.profitTransfer.findMany();
  const totalProfitTransfers = profitTransfers.reduce((s, t) => s + t.amount, 0);

  // Partner transactions
  const allPartnerTx = await prisma.partnerTransaction.findMany();
  const partnerOutflows = allPartnerTx
    .filter(t => ["SALARY", "ADVANCE", "WITHDRAWAL", "PROFIT_SHARE"].includes(t.type))
    .reduce((s, t) => s + t.amount, 0);
  const partnerInflows = allPartnerTx
    .filter(t => t.type === "LOAN_SETTLEMENT")
    .reduce((s, t) => s + t.amount, 0);

  // Partner transaction breakdown by type
  const txByType = allPartnerTx.reduce((acc, t) => {
    acc[t.type] = (acc[t.type] || 0) + t.amount;
    return acc;
  }, {} as Record<string, number>);

  // Office Treasury Balance
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

  // Monthly expenses breakdown (last 12 months for better chart)
  const monthlyBreakdown: { month: number; year: number; total: number }[] = [];
  for (let i = 0; i < 12; i++) {
    const d = new Date(currentYear, currentMonth - 1 - i, 1);
    const m = d.getMonth() + 1;
    const y = d.getFullYear();
    const mExpenses = allExpenses.filter(e => e.month === m && e.year === y);
    monthlyBreakdown.push({ month: m, year: y, total: mExpenses.reduce((s, e) => s + e.cost, 0) });
  }

  // Monthly partner outflows (last 12 months)
  const monthlyPartnerOutflows: { month: number; year: number; total: number }[] = [];
  for (let i = 0; i < 12; i++) {
    const d = new Date(currentYear, currentMonth - 1 - i, 1);
    const m = d.getMonth() + 1;
    const y = d.getFullYear();
    const mTx = allPartnerTx.filter(t => {
      const td = new Date(t.date);
      return td.getMonth() + 1 === m && td.getFullYear() === y && ["SALARY", "ADVANCE", "WITHDRAWAL", "PROFIT_SHARE"].includes(t.type);
    });
    monthlyPartnerOutflows.push({ month: m, year: y, total: mTx.reduce((s, t) => s + t.amount, 0) });
  }

  // Recent partner transactions (last 5)
  const recentPartnerTx = allPartnerTx
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
    .slice(0, 5)
    .map(t => ({
      id: t.id, type: t.type, amount: t.amount, date: t.date, note: t.note,
      partnerName: partners.find(p => p.id === t.partnerId)?.name || "—",
      businessName: null as string | null,
    }));

  // Expense trend percentage
  const expenseTrend = totalPrevMonthExpenses > 0
    ? ((totalMonthExpenses - totalPrevMonthExpenses) / totalPrevMonthExpenses * 100)
    : 0;

  return NextResponse.json({
    currentMonth: { totalExpenses: totalMonthExpenses, expenseCount: monthExpenses.length },
    prevMonth: { totalExpenses: totalPrevMonthExpenses, expenseCount: prevMonthExpenses.length },
    expenseTrend: Math.round(expenseTrend * 10) / 10,
    allTime: { totalExpenses: totalAllExpenses, totalCapital, expenseCount: allExpenses.length },
    expenseBreakdown: { fixed: fixedExpenses, variable: variableExpenses },
    capitalBreakdown: { cash: cashCapital, asset: assetCapital },
    officeTreasury: {
      balance: officeTreasuryBalance,
      cashCapital,
      profitTransfers: totalProfitTransfers,
      partnerOutflows,
      partnerInflows,
    },
    partnerSummary,
    monthlyBreakdown: monthlyBreakdown.reverse(),
    monthlyPartnerOutflows: monthlyPartnerOutflows.reverse(),
    txByType,
    recentPartnerTx,
  });
}
