import { NextResponse } from "next/server";
import { getCurrentSession, canAccessBusiness } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

export async function GET() {
  const session = await getCurrentSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  if (!canAccessBusiness(session, "rebound")) {
    return NextResponse.json({ error: "Access denied" }, { status: 403 });
  }

  const rebound = await prisma.business.findUnique({ where: { slug: "rebound" } });
  if (!rebound) return NextResponse.json({ error: "REBOUND not found" }, { status: 404 });

  const now = new Date();
  const currentMonth = now.getMonth();
  const currentYear = now.getFullYear();

  const [
    totalClients,
    totalProjects,
    activeProjects,
    completedProjects,
    revenueAgg,
    poolIn,
    poolOut,
    expenseAgg,
    totalTransferred,
    activeSubscriptions,
    totalSubscriptions,
    mrrResult,
    recentProjects,
    workStatusCounts,
    monthlyRevenueAgg,
    topClientsRaw,
  ] = await Promise.all([
    prisma.client.count({ where: { businessId: rebound.id } }),
    prisma.projectRecord.count({ where: { businessId: rebound.id } }),
    prisma.projectRecord.count({ where: { businessId: rebound.id, workStatus: { in: ["IN_PROGRESS", "WAITING"] } } }),
    prisma.projectRecord.count({ where: { businessId: rebound.id, workStatus: "COMPLETED" } }),
    prisma.projectRecord.aggregate({ where: { businessId: rebound.id }, _sum: { totalPrice: true, deposit: true } }),
    prisma.poolTransaction.aggregate({ where: { businessId: rebound.id, type: "IN" }, _sum: { amountSAR: true } }),
    prisma.poolTransaction.aggregate({ where: { businessId: rebound.id, type: "OUT" }, _sum: { amountSAR: true } }),
    prisma.expense.aggregate({ where: { businessId: rebound.id }, _sum: { cost: true } }),
    prisma.profitTransfer.aggregate({ where: { businessId: rebound.id }, _sum: { amount: true } }),
    prisma.subscription.count({ where: { businessId: rebound.id, status: "ACTIVE" } }),
    prisma.subscription.count({ where: { businessId: rebound.id } }),
    prisma.subscription.aggregate({ where: { businessId: rebound.id, status: "ACTIVE" }, _sum: { monthlyFee: true } }),
    prisma.projectRecord.findMany({
      where: { businessId: rebound.id },
      include: { client: { select: { name: true } } },
      orderBy: { date: "desc" },
      take: 10,
    }),
    prisma.projectRecord.groupBy({
      by: ["workStatus"],
      where: { businessId: rebound.id },
      _count: { id: true },
    }),
    prisma.$queryRaw`
      SELECT EXTRACT(MONTH FROM date)::int as month, EXTRACT(YEAR FROM date)::int as year,
             SUM(deposit)::float as revenue, COUNT(*)::int as projects
      FROM "ProjectRecord"
      WHERE "businessId" = ${rebound.id}
        AND date >= ${new Date(currentYear, currentMonth - 11, 1)}
      GROUP BY EXTRACT(MONTH FROM date), EXTRACT(YEAR FROM date)
      ORDER BY year DESC, month DESC
    `,
    prisma.$queryRaw`
      SELECT c.name, COUNT(p.id)::int as projects, SUM(p.deposit)::float as "totalPaid"
      FROM "ProjectRecord" p
      JOIN "Client" c ON c.id = p."clientId"
      WHERE p."businessId" = ${rebound.id}
      GROUP BY c.id, c.name
      ORDER BY "totalPaid" DESC
      LIMIT 5
    `,
  ]);

  const poolBalance = Number(poolIn._sum.amountSAR ?? 0) - Number(poolOut._sum.amountSAR ?? 0);
  const totalExpenses = Number(expenseAgg._sum.cost ?? 0);
  const totalTransferredVal = Number(totalTransferred._sum.amount ?? 0);
  const reboundBalance = poolBalance - totalExpenses - totalTransferredVal;
  const totalRevenue = Number(revenueAgg._sum.totalPrice ?? 0);
  const totalCollected = Number(revenueAgg._sum.deposit ?? 0);
  const mrr = Number(mrrResult._sum.monthlyFee ?? 0);
  const collectionRate = totalRevenue > 0 ? Math.round((totalCollected / totalRevenue) * 100) : 0;

  const workStatusBreakdown = workStatusCounts.map(w => ({ status: w.workStatus, count: w._count.id }));

  const monthlyRevenue = [];
  for (let i = 11; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const month = d.getMonth() + 1;
    const year = d.getFullYear();
    const found = (monthlyRevenueAgg as any[]).find(r => r.month === month && r.year === year);
    monthlyRevenue.push({
      month: d.toLocaleDateString("en-US", { month: "short", year: "numeric" }),
      revenue: found ? found.revenue : 0,
      projects: found ? found.projects : 0,
    });
  }

  const topClients = (topClientsRaw as any[]).map(c => ({ name: c.name, projects: c.projects, totalPaid: c.totalPaid }));

  const recentActivity = recentProjects.map(p => ({
    date: p.createdAt.toISOString(),
    text: `${p.client?.name || "—"} — ${p.projectName} (${p.workStatus})`,
  }));

  // Recent expenses and profit transfers
  const [recentExpenses, expenseByCategory, recentTransfers] = await Promise.all([
    prisma.expense.findMany({ where: { businessId: rebound.id }, orderBy: { date: "desc" }, take: 5, select: { id: true, description: true, cost: true, category: true, name: true, date: true } }),
    prisma.expense.groupBy({ by: ["category"], where: { businessId: rebound.id }, _sum: { cost: true }, _count: { id: true } }),
    prisma.profitTransfer.findMany({ where: { businessId: rebound.id }, orderBy: { date: "desc" }, take: 5, select: { id: true, amount: true, date: true, note: true } }),
  ]);

  return NextResponse.json({
    poolBalance,
    mrr,
    reboundBalance,
    totalExpenses,
    totalTransferred: totalTransferredVal,
    totalClients,
    totalProjects,
    totalRevenue,
    totalCollected,
    activeProjects,
    completedProjects,
    monthlyRevenue,
    workStatusBreakdown,
    topClients,
    recentActivity,
    collectionRate,
    activeSubscriptions,
    totalSubscriptions,
    recentExpenses,
    expenseByCategory: expenseByCategory.map(c => ({ category: c.category, total: Number(c._sum.cost ?? 0), count: c._count.id })),
    recentTransfers,
  });
}
