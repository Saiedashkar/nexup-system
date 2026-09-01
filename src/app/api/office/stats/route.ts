import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentSession, canAccessBusiness, isSuperAdmin } from "@/lib/auth";

export const runtime = "nodejs";

export async function GET() {
  try {
    const session = await getCurrentSession();
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const superAdmin = isSuperAdmin(session);

    // Filter businesses by what the user can access
    const allBusinesses = await prisma.business.findMany({
      include: {
        _count: {
          select: {
            clients: true,
            projectRecords: true,
            poolTransactions: true,
            expenses: true,
          },
        },
      },
      orderBy: { name: "asc" },
    });

    const accessibleSlugs = allBusinesses
      .filter(b => superAdmin || canAccessBusiness(session, b.slug))
      .map(b => b.slug);

    const businesses = allBusinesses.filter(b => accessibleSlugs.includes(b.slug));

    // Aggregate stats ONLY for accessible businesses
    // Separate SAR (NEXUP) and EGP (REBOUND, ABOMAZEN) currencies
    const sarBusinessIds = businesses.filter(b => b.currencyMode === "SAR_TO_EGP").map(b => b.id);
    const egpBusinessIds = businesses.filter(b => b.currencyMode === "EGP_DIRECT").map(b => b.id);

    const [totalClients, totalProjects, sarRevenueResult, egpRevenueResult, expenseResult] = await Promise.all([
      prisma.client.count({ where: { businessId: { in: businesses.map(b => b.id) } } }),
      prisma.projectRecord.count({ where: { businessId: { in: businesses.map(b => b.id) } } }),
      sarBusinessIds.length > 0
        ? prisma.poolTransaction.aggregate({
            where: { type: "IN", businessId: { in: sarBusinessIds } },
            _sum: { amountSAR: true },
          })
        : Promise.resolve({ _sum: { amountSAR: null } }),
      egpBusinessIds.length > 0
        ? prisma.poolTransaction.aggregate({
            where: { type: "IN", businessId: { in: egpBusinessIds } },
            _sum: { amountSAR: true },
          })
        : Promise.resolve({ _sum: { amountSAR: null } }),
      prisma.expense.aggregate({
        where: { businessId: { in: businesses.map(b => b.id) } },
        _sum: { cost: true },
      }),
    ]);

    const totalRevenueSAR = Number(sarRevenueResult._sum.amountSAR ?? 0);
    const totalRevenueEGP = Number(egpRevenueResult._sum.amountSAR ?? 0);
    const totalRevenue = totalRevenueSAR + totalRevenueEGP;
    const totalExpenses = Number(expenseResult._sum.cost ?? 0);

    // Office treasury balance (only for super admin or office finance access)
    let officeTreasury = null;
    if (superAdmin || session.canAccessOfficeFinanceFull) {
      const [capital, profitTransfers, officeExpenses, partnerTx] = await Promise.all([
        prisma.capitalContribution.findMany({ where: { type: "CASH" }, select: { amount: true } }),
        prisma.profitTransfer.findMany({ select: { amount: true } }),
        prisma.officeExpense.findMany({ select: { cost: true } }),
        prisma.partnerTransaction.findMany({ select: { type: true, amount: true } }),
      ]);

      const cashCapital = capital.reduce((s, c) => s + c.amount, 0);
      const totalProfitTransfers = profitTransfers.reduce((s, t) => s + t.amount, 0);
      const totalOfficeExpenses = officeExpenses.reduce((s, e) => s + e.cost, 0);
      const outflows = partnerTx
        .filter(t => ["SALARY", "ADVANCE", "WITHDRAWAL", "PROFIT_SHARE"].includes(t.type))
        .reduce((s, t) => s + t.amount, 0);
      const inflows = partnerTx
        .filter(t => t.type === "LOAN_SETTLEMENT")
        .reduce((s, t) => s + t.amount, 0);

      officeTreasury = {
        balance: cashCapital + totalProfitTransfers - totalOfficeExpenses - outflows + inflows,
        cashCapital,
        profitTransfers: totalProfitTransfers,
        officeExpenses: totalOfficeExpenses,
      };
    }

    return NextResponse.json({
      businesses,
      stats: {
        totalRevenue,
        totalRevenueSAR,
        totalRevenueEGP,
        totalExpenses,
        totalClients,
        totalProjects,
      },
      officeTreasury,
      userPermissions: {
        canAccessNexup: superAdmin || session.canAccessNexup,
        canAccessRebound: superAdmin || session.canAccessRebound,
        canAccessAbomazen: superAdmin || session.canAccessAbomazen,
        canAccessOffice: superAdmin || session.canAccessOfficeFinanceFull,
        isSuperAdmin: superAdmin,
      },
    });
  } catch (error) {
    console.error("Failed to fetch office stats:", error);
    return NextResponse.json({ error: "Failed to fetch stats" }, { status: 500 });
  }
}
