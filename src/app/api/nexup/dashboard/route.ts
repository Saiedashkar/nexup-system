import { NextResponse } from "next/server";
import { getCurrentSession, canAccessBusiness } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

export async function GET() {
  const session = await getCurrentSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Enforce permission
  if (!canAccessBusiness(session, "nexup")) {
    return NextResponse.json({ error: "Access denied" }, { status: 403 });
  }

  const nexup = await prisma.business.findUnique({ where: { slug: "nexup" } });
  if (!nexup) return NextResponse.json({ error: "NEXUP not found" }, { status: 404 });

  // Use aggregations instead of fetching all rows for performance
  const now = new Date();
  const currentMonth = now.getMonth();
  const currentYear = now.getFullYear();

  const [
    totalClients,
    totalProjects,
    activeProjects,
    completedProjects,
    unpaidProjects,
    revenueAgg,
    collectedAgg,
    remainingAgg,
    poolIn,
    poolOut,
    withdrawalEgp,
    expenseCost,
    profitDistributed,
    profitTransferred,
    activeSubscriptions,
    totalSubscriptions,
    mrrResult,
    recentProjects,
    workStatusCounts,
    monthlyRevenueAgg,
    topClientsRaw,
  ] = await Promise.all([
    prisma.client.count({ where: { businessId: nexup.id } }),
    prisma.projectRecord.count({ where: { businessId: nexup.id } }),
    prisma.projectRecord.count({ where: { businessId: nexup.id, workStatus: { in: ["IN_PROGRESS", "WAITING"] } } }),
    prisma.projectRecord.count({ where: { businessId: nexup.id, workStatus: "COMPLETED" } }),
    prisma.projectRecord.count({ where: { businessId: nexup.id, paymentStatus: "UNPAID" } }),
    prisma.projectRecord.aggregate({ where: { businessId: nexup.id }, _sum: { totalPrice: true } }),
    prisma.projectRecord.aggregate({ where: { businessId: nexup.id }, _sum: { deposit: true } }),
    prisma.projectRecord.aggregate({ where: { businessId: nexup.id }, _sum: { remaining: true } }),
    prisma.poolTransaction.aggregate({ where: { businessId: nexup.id, type: "IN" }, _sum: { amountSAR: true } }),
    prisma.poolTransaction.aggregate({ where: { businessId: nexup.id, type: "OUT" }, _sum: { amountSAR: true } }),
    prisma.withdrawal.aggregate({ where: { businessId: nexup.id }, _sum: { netEGP: true } }),
    prisma.expense.aggregate({ where: { businessId: nexup.id }, _sum: { cost: true } }),
    prisma.nexupProfitLedger.aggregate({ _sum: { amount: true } }),
    prisma.profitTransfer.aggregate({ where: { businessId: nexup.id }, _sum: { amount: true } }),
    prisma.subscription.count({ where: { businessId: nexup.id, status: "ACTIVE" } }),
    prisma.subscription.count({ where: { businessId: nexup.id } }),
    prisma.subscription.aggregate({ where: { businessId: nexup.id, status: "ACTIVE" }, _sum: { monthlyFee: true } }),
    // Recent projects (limited to 10 for performance)
    prisma.projectRecord.findMany({
      where: { businessId: nexup.id },
      include: { client: { select: { name: true } } },
      orderBy: { date: "desc" },
      take: 10,
    }),
    // Work status counts using groupBy for performance
    prisma.projectRecord.groupBy({
      by: ["workStatus"],
      where: { businessId: nexup.id },
      _count: { id: true },
    }),
    // Monthly revenue for last 12 months
    prisma.$queryRaw`
      SELECT EXTRACT(MONTH FROM date)::int as month, EXTRACT(YEAR FROM date)::int as year,
             SUM(deposit)::float as revenue, COUNT(*)::int as projects
      FROM "ProjectRecord"
      WHERE "businessId" = ${nexup.id}
        AND date >= ${new Date(currentYear, currentMonth - 11, 1)}
      GROUP BY EXTRACT(MONTH FROM date), EXTRACT(YEAR FROM date)
      ORDER BY year DESC, month DESC
    `,
    // Top 5 clients by total paid
    prisma.$queryRaw`
      SELECT c.name, COUNT(p.id)::int as projects, SUM(p.deposit)::float as "totalPaid"
      FROM "ProjectRecord" p
      JOIN "Client" c ON c.id = p."clientId"
      WHERE p."businessId" = ${nexup.id}
      GROUP BY c.id, c.name
      ORDER BY "totalPaid" DESC
      LIMIT 5
    `,
  ]);

  // Compute derived values
  const totalRevenue = Number(revenueAgg._sum.totalPrice ?? 0);
  const totalCollected = Number(collectedAgg._sum.deposit ?? 0);
  const totalRemaining = Number(remainingAgg._sum.remaining ?? 0);
  const poolBalance = Number(poolIn._sum.amountSAR ?? 0) - Number(poolOut._sum.amountSAR ?? 0);
  const totalWithdrawnEGP = Number(withdrawalEgp._sum.netEGP ?? 0);
  const totalExpensesEGP = Number(expenseCost._sum.cost ?? 0);
  const totalProfitDistributed = Number(profitDistributed._sum.amount ?? 0);
  const totalProfitTransferred = Number(profitTransferred._sum.amount ?? 0);
  const nexupTreasuryEGP = totalWithdrawnEGP - totalExpensesEGP - totalProfitDistributed - totalProfitTransferred;
  const mrr = Number(mrrResult._sum.monthlyFee ?? 0);
  const collectionRate = totalRevenue > 0 ? Math.round((totalCollected / totalRevenue) * 100) : 0;

  // Work status breakdown
  const workStatusBreakdown = workStatusCounts.map(w => ({ status: w.workStatus, count: w._count.id }));

  // Format monthly revenue for chart
  const now2 = new Date();
  const monthlyRevenue = [];
  for (let i = 11; i >= 0; i--) {
    const d = new Date(now2.getFullYear(), now2.getMonth() - i, 1);
    const month = d.getMonth() + 1;
    const year = d.getFullYear();
    const found = (monthlyRevenueAgg as any[]).find(r => r.month === month && r.year === year);
    monthlyRevenue.push({
      month: d.toLocaleDateString("en-US", { month: "short", year: "numeric" }),
      revenue: found ? found.revenue : 0,
      projects: found ? found.projects : 0,
    });
  }

  // Top clients
  const topClients = (topClientsRaw as any[]).map(c => ({
    name: c.name,
    projects: c.projects,
    totalPaid: c.totalPaid,
  }));

  // Recent activity
  const recentActivity = recentProjects.map(p => ({
    date: p.createdAt.toISOString(),
    text: `${p.client?.name || "—"} — ${p.projectName} (${p.workStatus})`,
  }));

  // Subscription stats
  const totalRemainingClients = totalClients - totalProjects;

  return NextResponse.json({
    totalClients,
    totalProjects,
    totalRevenue,
    totalCollected,
    totalRemaining,
    activeProjects,
    completedProjects,
    unpaidProjects,
    monthlyRevenue,
    topClients,
    workStatusBreakdown,
    recentActivity,
    poolBalance,
    nexupTreasuryEGP,
    mrr,
    totalProfitTransferred,
    activeSubscriptions,
    totalSubscriptions,
    collectionRate,
  });
}
