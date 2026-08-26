import { NextResponse } from "next/server";
import { getCurrentSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

export async function GET() {
  const session = await getCurrentSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Get NEXUP business
  const nexup = await prisma.business.findUnique({ where: { slug: "nexup" } });
  if (!nexup) return NextResponse.json({ error: "NEXUP business not found" }, { status: 404 });

  // For SUPER_ADMIN or ADMIN with access to nexup
  if (session.role !== "SUPER_ADMIN" && session.businessId !== nexup.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // Fetch all data for NEXUP
  const [projects, clients, poolTransactions, withdrawals, expenses, profitLedger, profitTransfers] = await Promise.all([
    prisma.projectRecord.findMany({
      where: { businessId: nexup.id },
      include: { client: true, designer: true, services: true },
      orderBy: { date: "desc" },
    }),
    prisma.client.findMany({
      where: { businessId: nexup.id },
    }),
    prisma.poolTransaction.findMany({ where: { businessId: nexup.id }, select: { type: true, amountSAR: true } }),
    prisma.withdrawal.findMany({ where: { businessId: nexup.id }, select: { netEGP: true } }),
    prisma.expense.findMany({ where: { businessId: nexup.id }, select: { cost: true } }),
    prisma.nexupProfitLedger.findMany({ select: { amount: true } }),
    prisma.profitTransfer.findMany({ where: { businessId: nexup.id }, select: { amount: true } }),
  ]);

  // Compute stats
  const totalRevenue = projects.reduce((s, p) => s + Number(p.totalPrice), 0);
  const totalCollected = projects.reduce((s, p) => s + Number(p.deposit), 0);
  const activeProjects = projects.filter(p => p.workStatus === "IN_PROGRESS" || p.workStatus === "WAITING").length;
  const completedProjects = projects.filter(p => p.workStatus === "COMPLETED").length;
  const unpaidProjects = projects.filter(p => p.paymentStatus === "UNPAID").length;

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

  // Top clients by total paid
  const clientMap = new Map<string, { name: string; projects: number; totalPaid: number }>();
  for (const p of projects) {
    const existing = clientMap.get(p.clientId) || { name: p.client.name, projects: 0, totalPaid: 0 };
    existing.projects += 1;
    existing.totalPaid += Number(p.deposit);
    clientMap.set(p.clientId, existing);
  }
  const topClients = Array.from(clientMap.values())
    .sort((a, b) => b.totalPaid - a.totalPaid)
    .slice(0, 5);

  // Work status breakdown
  const statusCount = new Map<string, number>();
  for (const p of projects) {
    statusCount.set(p.workStatus, (statusCount.get(p.workStatus) || 0) + 1);
  }
  const workStatusBreakdown = ["WAITING", "IN_PROGRESS", "COMPLETED", "PAUSED"]
    .filter(s => statusCount.has(s))
    .map(s => ({ status: s, count: statusCount.get(s)! }));

  // Recent activity (last 10 projects)
  const recentActivity = projects.slice(0, 10).map(p => ({
    date: p.createdAt.toISOString(),
    text: `${p.client.name} — ${p.projectName} (${p.workStatus})`,
  }));

  // ─── Pool Balance (SAR available — not yet withdrawn) ───
  let poolBalance = 0;
  for (const t of poolTransactions) {
    if (t.type === "IN") poolBalance += Number(t.amountSAR);
    else poolBalance -= Number(t.amountSAR);
  }

  // ─── NEXUP Treasury Balance (EGP) ───
  // = sum(netEGP withdrawals) - sum(expenses) - sum(nexupProfitLedger) - sum(profitTransfers from NEXUP)
  const totalWithdrawnEGP = withdrawals.reduce((s, w) => s + Number(w.netEGP), 0);
  const totalExpensesEGP = expenses.reduce((s, e) => s + Number(e.cost), 0);
  const totalProfitDistributed = profitLedger.reduce((s, l) => s + l.amount, 0);
  const totalProfitTransferred = profitTransfers.reduce((s, t) => s + t.amount, 0);
  const nexupTreasuryEGP = totalWithdrawnEGP - totalExpensesEGP - totalProfitDistributed - totalProfitTransferred;

  return NextResponse.json({
    totalClients: clients.length,
    totalProjects: projects.length,
    totalRevenue,
    totalCollected,
    activeProjects,
    completedProjects,
    unpaidProjects,
    monthlyRevenue,
    topClients,
    workStatusBreakdown,
    recentActivity,
    poolBalance,
    nexupTreasuryEGP,
  });
}
