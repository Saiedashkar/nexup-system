import Link from "next/link";
import { AppShell } from "@/components/app-shell";
import { getCurrentSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const session = await getCurrentSession();
  if (!session) return null;

  const [totalClients, totalProjects, pendingProjects, completedProjects, totalRevenue, totalPool, totalExpenses, totalWithdrawals] = await Promise.all([
    prisma.client.count(),
    prisma.projectRecord.count(),
    prisma.projectRecord.count({ where: { workStatus: "WAITING" } }),
    prisma.projectRecord.count({ where: { workStatus: "COMPLETED" } }),
    prisma.projectRecord.aggregate({ _sum: { totalPrice: true } }),
    prisma.poolTransaction.findMany({ select: { type: true, amountSAR: true } }),
    prisma.expense.aggregate({ _sum: { cost: true } }),
    prisma.withdrawal.aggregate({ _sum: { netEGP: true } }),
  ]);

  const revenue = totalRevenue._sum.totalPrice ?? 0;
  
  let poolIn = 0, poolOut = 0;
  for (const t of totalPool) {
    if (t.type === "IN") poolIn += Number(t.amountSAR);
    else poolOut += Number(t.amountSAR);
  }
  const poolBalance = poolIn - poolOut;
  
  const expenseTotal = totalExpenses._sum.cost ?? 0;
  const withdrawalTotal = totalWithdrawals._sum.netEGP ?? 0;

  return (
    <AppShell isAdmin={session.role === "ADMIN"} userName={session.name} activePage="dashboard">
      <div className="page-header">
        <div>
          <h1 className="page-title">لوحة التحكم</h1>
          <p className="page-subtitle">مرحبًا {session.name} — نظرة عامة على النظام</p>
        </div>
      </div>

      <div className="stats-grid">
        <div className="stat-card brand">
          <div className="stat-card-icon brand">👥</div>
          <div className="stat-card-value">{totalClients}</div>
          <div className="stat-card-label">إجمالي العملاء</div>
        </div>
        <div className="stat-card info">
          <div className="stat-card-icon info">📋</div>
          <div className="stat-card-value">{totalProjects}</div>
          <div className="stat-card-label">إجمالي السجلات</div>
        </div>
        <div className="stat-card warning">
          <div className="stat-card-icon warning">⏳</div>
          <div className="stat-card-value">{pendingProjects}</div>
          <div className="stat-card-label">قيد الانتظار</div>
        </div>
        <div className="stat-card success">
          <div className="stat-card-icon success">✅</div>
          <div className="stat-card-value">{completedProjects}</div>
          <div className="stat-card-label">مكتملة</div>
        </div>
      </div>

      <div className="stats-grid" style={{ marginBottom: 28 }}>
        <div className="stat-card brand">
          <div className="stat-card-icon brand">💰</div>
          <div className="stat-card-value">{Number(revenue).toLocaleString("ar-SA")} ر.س</div>
          <div className="stat-card-label">إجمالي الإيرادات</div>
        </div>
        <div className="stat-card info">
          <div className="stat-card-icon info">💎</div>
          <div className="stat-card-value">{poolBalance.toLocaleString("ar-SA")} ر.س</div>
          <div className="stat-card-label">رصيد البول</div>
        </div>
        <div className="stat-card danger">
          <div className="stat-card-icon danger">🧾</div>
          <div className="stat-card-value">{Number(expenseTotal).toLocaleString("ar-SA")} ر.س</div>
          <div className="stat-card-label">المصاريف</div>
        </div>
        <div className="stat-card success">
          <div className="stat-card-icon success">🇪🇬</div>
          <div className="stat-card-value">{Number(withdrawalTotal).toLocaleString("ar-SA")} ج.م</div>
          <div className="stat-card-label">المحول لمصر</div>
        </div>
      </div>

      <div className="card">
        <div className="card-header">
          <div className="card-title">الوصول السريع</div>
        </div>
        <div className="card-body">
          <div className="actions-grid">
            <Link className="action-card" href="/clients">
              <div className="action-card-icon brand">👥</div>
              <div>
                <div className="action-card-title">إدارة العملاء</div>
                <div className="action-card-desc">عرض وإضافة سجلات الخدمات</div>
              </div>
            </Link>
            {session.role === "ADMIN" && (
              <Link className="action-card" href="/finance">
                <div className="action-card-icon info">💰</div>
                <div>
                  <div className="action-card-title">إدارة الحسابات</div>
                  <div className="action-card-desc">البول — السحوبات — المصاريف</div>
                </div>
              </Link>
            )}
          </div>
        </div>
      </div>
    </AppShell>
  );
}
