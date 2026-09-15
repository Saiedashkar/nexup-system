import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentSession, canAccessBusiness, isSuperAdmin } from "@/lib/auth";
import { softDeleteRecord } from "@/lib/soft-delete";

export const runtime = "nodejs";

export async function GET() {
  try {
    const session = await getCurrentSession();
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const superAdmin = isSuperAdmin(session);

    // Auto-hide clients that have neither projects nor subscriptions left.
    // (Soft delete only — recoverable from the recycle bin.)
    try {
      const liveClients = await prisma.client.findMany({ select: { id: true } });
      for (const c of liveClients) {
        const [projectCount, subscriptionCount] = await Promise.all([
          prisma.projectRecord.count({ where: { clientId: c.id } }),
          prisma.subscription.count({ where: { clientId: c.id } }),
        ]);
        if (projectCount === 0 && subscriptionCount === 0) {
          await softDeleteRecord("Client", c.id, session.userId);
        }
      }
    } catch { /* ignore cleanup errors */ }

    const allBusinesses = await prisma.business.findMany({ orderBy: { name: "asc" } });

    // Counts must ignore soft-deleted rows, so they are computed with the
    // soft-delete-aware client instead of relation `_count`.
    const [clientCounts, projectCounts, poolCounts, expenseCounts] = await Promise.all([
      prisma.client.groupBy({ by: ["businessId"], _count: { _all: true } }),
      prisma.projectRecord.groupBy({ by: ["businessId"], _count: { _all: true } }),
      prisma.poolTransaction.groupBy({ by: ["businessId"], _count: { _all: true } }),
      prisma.expense.groupBy({ by: ["businessId"], _count: { _all: true } }),
    ]);
    const toCountMap = (rows: { businessId: string; _count: { _all: number } }[]) =>
      new Map(rows.map(r => [r.businessId, r._count._all]));
    const clientMap = toCountMap(clientCounts);
    const projectMap = toCountMap(projectCounts);
    const poolMap = toCountMap(poolCounts);
    const expenseMap = toCountMap(expenseCounts);

    const accessibleSlugs = allBusinesses
      .filter(b => superAdmin || canAccessBusiness(session, b.slug))
      .map(b => b.slug);

    const businesses = allBusinesses
      .filter(b => accessibleSlugs.includes(b.slug))
      .map(b => ({
        ...b,
        _count: {
          clients: clientMap.get(b.id) ?? 0,
          projectRecords: projectMap.get(b.id) ?? 0,
          poolTransactions: poolMap.get(b.id) ?? 0,
          expenses: expenseMap.get(b.id) ?? 0,
        },
      }));

    // Aggregate stats per-business for accessible businesses
    const allBizIds = businesses.map(b => b.id);

    const [totalClients, totalProjects, expenseResult] = await Promise.all([
      prisma.client.count({ where: { businessId: { in: allBizIds } } }),
      prisma.projectRecord.count({ where: { businessId: { in: allBizIds } } }),
      prisma.expense.aggregate({
        where: { businessId: { in: allBizIds } },
        _sum: { cost: true },
      }),
      // (soft-deleted expenses are excluded automatically)
    ]);

    // Per-business revenue and balance (pool IN - OUT)
    const perBusinessRevenue: Record<string, number> = {};
    const perBusinessBalance: Record<string, number> = {};
    const revenueAggByBiz = await prisma.poolTransaction.groupBy({
      by: ["businessId", "type"],
      where: { businessId: { in: allBizIds } },
      _sum: { amountSAR: true },
    });
    for (const row of revenueAggByBiz) {
      const amt = Number(row._sum.amountSAR ?? 0);
      if (row.type === "IN") {
        perBusinessRevenue[row.businessId] = (perBusinessRevenue[row.businessId] || 0) + amt;
        perBusinessBalance[row.businessId] = (perBusinessBalance[row.businessId] || 0) + amt;
      } else {
        perBusinessBalance[row.businessId] = (perBusinessBalance[row.businessId] || 0) - amt;
      }
    }

    // Deduct expenses from balance for EGP businesses
    const expByBiz = await prisma.expense.groupBy({
      by: ["businessId"],
      where: { businessId: { in: allBizIds } },
      _sum: { cost: true },
    });
    for (const row of expByBiz) {
      perBusinessBalance[row.businessId] = (perBusinessBalance[row.businessId] || 0) - Number(row._sum.cost ?? 0);
    }

    const totalRevenueSAR = Number(perBusinessRevenue[businesses.find(b => b.currencyMode === "SAR_TO_EGP")?.id ?? ""] ?? 0);
    const totalRevenueEGP = businesses
      .filter(b => b.currencyMode === "EGP_DIRECT")
      .reduce((s, b) => s + (perBusinessRevenue[b.id] ?? 0), 0);
    const totalRevenue = totalRevenueSAR + totalRevenueEGP;
    const totalExpenses = Number(expenseResult._sum.cost ?? 0);

    // Office treasury balance (only for super admin or office finance access)
    // Wrapped in its own try/catch so a missing DB column (e.g. fundFlow before migration)
    // never takes down the whole dashboard — businesses & stats still load.
    let officeTreasury = null;
    if (superAdmin || session.canAccessOfficeFinanceFull) {
      try {
        const [capital, profitTransfers, officeExpenses, partnerTx] = await Promise.all([
          prisma.capitalContribution.findMany({ where: { type: "CASH" }, select: { amount: true, fundFlow: true } }),
          prisma.profitTransfer.findMany({ select: { amount: true } }),
          prisma.officeExpense.findMany({ select: { cost: true } }),
          prisma.partnerTransaction.findMany({ select: { type: true, amount: true } }),
        ]);

        // Only STILL_IN_TREASURY contributions count as real cash in the treasury
        const cashCapital = capital
          .filter(c => c.fundFlow === "STILL_IN_TREASURY")
          .reduce((s, c) => s + c.amount, 0);
        const totalCashCapitalAll = capital.reduce((s, c) => s + c.amount, 0);
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
          totalCashCapitalAll,
          profitTransfers: totalProfitTransfers,
          officeExpenses: totalOfficeExpenses,
        };
      } catch (treasuryErr) {
        console.error("Failed to compute office treasury (migration pending?):", treasuryErr);
        officeTreasury = null;
      }
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
        perBusinessRevenue,
        perBusinessBalance,
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
