import { NextResponse } from "next/server";
import { getCurrentSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

export async function GET() {
  const session = await getCurrentSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const rebound = await prisma.business.findUnique({ where: { slug: "rebound" } });
  if (!rebound) return NextResponse.json({ error: "REBOUND not found" }, { status: 404 });

  // Access check
  if (session.role !== "SUPER_ADMIN" && !session.canAccessRebound) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const [projects, clients, poolTransactions, expenses, profitTransfers, subscriptions] = await Promise.all([
    prisma.projectRecord.findMany({
      where: { businessId: rebound.id },
      include: { client: true, designer: true, services: true, payments: true },
      orderBy: { date: "desc" },
    }),
    prisma.client.findMany({ where: { businessId: rebound.id } }),
    prisma.poolTransaction.findMany({ where: { businessId: rebound.id }, select: { type: true, amountSAR: true } }),
    prisma.expense.findMany({ where: { businessId: rebound.id }, select: { cost: true, month: true, year: true } }),
    prisma.profitTransfer.findMany({ where: { businessId: rebound.id }, select: { amount: true } }),
    prisma.subscription.findMany({
      where: { businessId: rebound.id },
      include: { invoices: true },
    }),
  ]);

  // Pool balance (EGP — direct, no conversion)
  let poolBalance = 0;
  for (const t of poolTransactions) {
    if (t.type === "IN") poolBalance += Number(t.amountSAR);
    else poolBalance -= Number(t.amountSAR);
  }

  // MRR = sum monthlyFee of ACTIVE subscriptions
  const activeSubscriptions = subscriptions.filter(s => s.status === "ACTIVE");
  const mrr = activeSubscriptions.reduce((s, sub) => s + Number(sub.monthlyFee), 0);

  // Total expenses
  const totalExpenses = expenses.reduce((s, e) => s + Number(e.cost), 0);

  // Total transferred to office
  const totalTransferred = profitTransfers.reduce((s, t) => s + Number(t.amount), 0);

  // REBOUND available balance = poolBalance - expenses - profitTransfers
  const reboundBalance = poolBalance - totalExpenses - totalTransferred;

  // Stats
  const totalRevenue = projects.reduce((s, p) => s + Number(p.totalPrice), 0);
  const totalCollected = projects.reduce((s, p) => s + Number(p.deposit), 0);
  const activeProjects = projects.filter(p => p.workStatus === "IN_PROGRESS" || p.workStatus === "WAITING").length;
  const completedProjects = projects.filter(p => p.workStatus === "COMPLETED").length;

  // Monthly revenue (last 12 months)
  const now = new Date();
  const monthlyRevenue = [];
  for (let i = 11; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const monthStr = d.toLocaleDateString("en-US", { month: "short", year: "numeric" });
    const monthProjects = projects.filter(p => {
      const pd = new Date(p.date);
      return pd.getMonth() === d.getMonth() && pd.getFullYear() === d.getFullYear();
    });
    monthlyRevenue.push({
      month: monthStr,
      revenue: monthProjects.reduce((s, p) => s + Number(p.deposit), 0),
      projects: monthProjects.length,
    });
  }

  // Work status breakdown
  const statusCount = new Map<string, number>();
  for (const p of projects) statusCount.set(p.workStatus, (statusCount.get(p.workStatus) || 0) + 1);
  const workStatusBreakdown = ["WAITING", "IN_PROGRESS", "COMPLETED", "PAUSED"]
    .filter(s => statusCount.has(s)).map(s => ({ status: s, count: statusCount.get(s)! }));

  // Top clients
  const clientMap = new Map<string, { name: string; projects: number; totalPaid: number }>();
  for (const p of projects) {
    const existing = clientMap.get(p.clientId) || { name: p.client.name, projects: 0, totalPaid: 0 };
    existing.projects += 1;
    existing.totalPaid += Number(p.deposit);
    clientMap.set(p.clientId, existing);
  }
  const topClients = Array.from(clientMap.values()).sort((a, b) => b.totalPaid - a.totalPaid).slice(0, 5);

  // Recent activity
  const recentActivity = projects.slice(0, 10).map(p => ({
    date: p.createdAt.toISOString(),
    text: `${p.client.name} — ${p.projectName} (${p.workStatus})`,
  }));

  return NextResponse.json({
    poolBalance,
    mrr,
    reboundBalance,
    totalExpenses,
    totalTransferred,
    totalClients: clients.length,
    totalProjects: projects.length,
    totalRevenue,
    totalCollected,
    activeProjects,
    completedProjects,
    monthlyRevenue,
    workStatusBreakdown,
    topClients,
    recentActivity,
    activeSubscriptions: activeSubscriptions.length,
    totalSubscriptions: subscriptions.length,
  });
}
