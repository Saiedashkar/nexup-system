import { NextResponse } from "next/server";
import { getCurrentSession, canAccessOfficeFinance } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getCapitalMetrics } from "@/lib/capital-metrics";

export const runtime = "nodejs";

export async function GET() {
  const session = await getCurrentSession();
  if (!session || !canAccessOfficeFinance(session)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

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

  /* Capital — ONE source of truth (src/lib/capital-metrics.ts).
     Nothing on this endpoint recomputes a capital figure any more: the
     capital page, the admin top bar and /api/office/stats all read the same
     definitions, which is what stops a number from meaning two different
     things in two places. A previously silent fallback here (used when the
     fundFlow column was missing) reported a DIFFERENT definition of the same
     metric; a real failure now surfaces instead of answering with a figure
     nobody can reconcile. */
  const capitalMetrics = await getCapitalMetrics();
  const totalCapital = capitalMetrics.cashFundingReceived;
  const assetCapital = capitalMetrics.assetFunding;
  // تمويل نقدي دخل الخزينة فعلًا — لا يُخلط مع رأس المال الكلي ولا مع العيني
  const cashCapital = capitalMetrics.availableCashInTreasury;

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

  // إجمالي التمويل النقدي التاريخي (لا ينقص بالصرف، ولا يشمل العيني)
  const totalHistoricalCapital = capitalMetrics.cashFundingReceived;

  // Office Treasury Balance — النقد الذي دخل المكتب فعلًا (بعد خصم ما صُرف
  // منه) لا مجرد إجمالي ما سُجّل كتمويل.
  const officeTreasuryBalance =
    capitalMetrics.availableCashInTreasury + totalProfitTransfers - totalAllExpenses - partnerOutflows + partnerInflows;

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

  // Monthly income breakdown (profit transfers per month, last 12 months)
  const monthlyIncome: { month: number; year: number; total: number }[] = [];
  for (let i = 0; i < 12; i++) {
    const d = new Date(currentYear, currentMonth - 1 - i, 1);
    const m = d.getMonth() + 1;
    const y = d.getFullYear();
    const mIncome = profitTransfers.filter(t => {
      const td = new Date(t.date);
      return td.getMonth() + 1 === m && td.getFullYear() === y;
    });
    monthlyIncome.push({ month: m, year: y, total: mIncome.reduce((s, t) => s + t.amount, 0) });
  }

  // Current month income
  const currentMonthIncome = profitTransfers.filter(t => {
    const td = new Date(t.date);
    return td.getMonth() + 1 === currentMonth && td.getFullYear() === currentYear;
  }).reduce((s, t) => s + t.amount, 0);

  return NextResponse.json({
    currentMonth: { totalExpenses: totalMonthExpenses, totalIncome: currentMonthIncome, expenseCount: monthExpenses.length },
    prevMonth: { totalExpenses: totalPrevMonthExpenses, expenseCount: prevMonthExpenses.length },
    expenseTrend: Math.round(expenseTrend * 10) / 10,
    allTime: { totalExpenses: totalAllExpenses, totalCapital, expenseCount: allExpenses.length },
    expenseBreakdown: { fixed: fixedExpenses, variable: variableExpenses },
    capitalBreakdown: {
      cash: totalCapital,                        // إجمالي التمويل النقدي
      asset: assetCapital,                       // عيني — سطر مستقل
      totalHistorical: totalCapital,
      inTreasury: capitalMetrics.cashFundingInTreasury,
      spentAlready: capitalMetrics.cashFundingSpentAlready,
      availableFund: capitalMetrics.availableFund,
      spentFromTreasury: capitalMetrics.treasuryDrawSpend,
      cashContributionCount: capitalMetrics.cashContributionCount,
      assetContributionCount: capitalMetrics.assetContributionCount,
    },
    officeTreasury: {
      balance: officeTreasuryBalance,
      cashCapital,
      totalHistoricalCapital,
      totalCashCapitalAll: totalCapital,
      availableFund: capitalMetrics.availableFund,
      cashFundingInTreasury: capitalMetrics.cashFundingInTreasury,
      cashFundingSpentAlready: capitalMetrics.cashFundingSpentAlready,
      assetFunding: capitalMetrics.assetFunding,
      availableCashInTreasury: capitalMetrics.availableCashInTreasury,
      cashInTreasuryNet: capitalMetrics.cashInTreasuryNet,
      spentFromTreasury: capitalMetrics.treasuryDrawSpend,
      unfundedFromTreasury: capitalMetrics.unfundedFromTreasury,
      unmatchedAlreadySpentFunding: capitalMetrics.unmatchedAlreadySpentFunding,
      reconciliationWarnings: capitalMetrics.reconciliationWarnings,
      profitTransfers: totalProfitTransfers,
      officeExpenses: totalAllExpenses,
      partnerOutflows,
      partnerInflows,
    },
    partnerSummary,
    monthlyBreakdown: monthlyBreakdown.reverse(),
    monthlyPartnerOutflows: monthlyPartnerOutflows.reverse(),
    monthlyIncome: monthlyIncome.reverse(),
    txByType,
    recentPartnerTx,
  });
}
