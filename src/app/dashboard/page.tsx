import Link from "next/link";
import { AppShell } from "@/components/app-shell";
import { getCurrentSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const session = await getCurrentSession();
  if (!session) return null;

  const [totalClients, totalProjects, pendingProjects, completedProjects, inProgressProjects, totalRevenue, totalPool, totalExpenses, totalWithdrawals, recentProjects, designers] = await Promise.all([
    prisma.client.count(),
    prisma.projectRecord.count(),
    prisma.projectRecord.count({ where: { workStatus: "WAITING" } }),
    prisma.projectRecord.count({ where: { workStatus: "COMPLETED" } }),
    prisma.projectRecord.count({ where: { workStatus: "IN_PROGRESS" } }),
    prisma.projectRecord.aggregate({ _sum: { totalPrice: true } }),
    prisma.poolTransaction.findMany({ select: { type: true, amountSAR: true } }),
    prisma.expense.aggregate({ _sum: { cost: true } }),
    prisma.withdrawal.aggregate({ _sum: { netEGP: true } }),
    prisma.projectRecord.findMany({
      take: 5,
      orderBy: { createdAt: "desc" },
      include: { client: true, designer: true },
    }),
    prisma.user.findMany({
      where: { role: "EMPLOYEE" },
      select: { id: true, name: true, _count: { select: { projectRecords: true } } },
    }),
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
  const unpaidProjects = await prisma.projectRecord.count({ where: { paymentStatus: "UNPAID" } });
  const partialPaid = await prisma.projectRecord.count({ where: { paymentStatus: "PARTIAL" } });

  const workStatusMap: Record<string, string> = {
    WAITING: "بانتظار البدء",
    IN_PROGRESS: "قيد التنفيذ",
    COMPLETED: "مكتمل",
    PAUSED: "متوقف",
  };
  const workStatusBadge: Record<string, string> = {
    WAITING: "badge-waiting",
    IN_PROGRESS: "badge-in-progress",
    COMPLETED: "badge-completed",
    PAUSED: "badge-paused",
  };

  return (
    <AppShell isAdmin={session.role === "ADMIN"} userName={session.name} activePage="dashboard">
      <div className="page-header">
        <div>
          <h1 className="page-title">لوحة التحكم</h1>
          <p className="page-subtitle">مرحبًا {session.name} — نظرة عامة على نشاط الشركة</p>
        </div>
      </div>

      {/* Row 1: Business Overview */}
      <div className="stats-grid">
        <div className="stat-card brand">
          <div className="stat-card-icon brand">👥</div>
          <div className="stat-card-value">{totalClients}</div>
          <div className="stat-card-label">إجمالي العملاء</div>
        </div>
        <div className="stat-card info">
          <div className="stat-card-icon info">📋</div>
          <div className="stat-card-value">{totalProjects}</div>
          <div className="stat-card-label">إجمالي المشاريع</div>
        </div>
        <div className="stat-card warning">
          <div className="stat-card-icon warning">⏳</div>
          <div className="stat-card-value">{pendingProjects}</div>
          <div className="stat-card-label">بانتظار البدء</div>
        </div>
        <div className="stat-card success">
          <div className="stat-card-icon success">✅</div>
          <div className="stat-card-value">{completedProjects}</div>
          <div className="stat-card-label">مشاريع مكتملة</div>
        </div>
      </div>

      {/* Row 2: Financial Overview */}
      <div className="stats-grid">
        <div className="stat-card brand">
          <div className="stat-card-icon brand">💰</div>
          <div className="stat-card-value">{Number(revenue).toLocaleString("ar-SA")} ر.س</div>
          <div className="stat-card-label">إجمالي الإيرادات</div>
        </div>
        <div className="stat-card info">
          <div className="stat-card-icon info">🏦</div>
          <div className="stat-card-value">{poolBalance.toLocaleString("ar-SA")} ر.س</div>
          <div className="stat-card-label">رصيد الخزينة</div>
        </div>
        <div className="stat-card danger">
          <div className="stat-card-icon danger">🧾</div>
          <div className="stat-card-value">{Number(expenseTotal).toLocaleString("ar-SA")} ر.س</div>
          <div className="stat-card-label">المصروفات</div>
        </div>
        <div className="stat-card success">
          <div className="stat-card-icon success">🇪🇬</div>
          <div className="stat-card-value">{Number(withdrawalTotal).toLocaleString("ar-SA")} ج.م</div>
          <div className="stat-card-label">المحول لمصر</div>
        </div>
      </div>

      {/* Row 3: Payment Status + Work in Progress */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: 16, marginBottom: 24 }}>
        {/* Payment Status */}
        <div className="card">
          <div className="card-header">
            <div className="card-title">حالة الدفع</div>
          </div>
          <div className="card-body">
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span style={{ fontSize: 14, color: "var(--ink-secondary)" }}>مشاريع مدفوعة بالكامل</span>
                <span className="badge badge-completed">{totalProjects - unpaidProjects - partialPaid}</span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span style={{ fontSize: 14, color: "var(--ink-secondary)" }}>دفعة جزئية</span>
                <span className="badge badge-partial">{partialPaid}</span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span style={{ fontSize: 14, color: "var(--ink-secondary)" }}>غير مدفوع</span>
                <span className="badge badge-unpaid">{unpaidProjects}</span>
              </div>
            </div>
          </div>
        </div>

        {/* Work in Progress */}
        <div className="card">
          <div className="card-header">
            <div className="card-title">قيد التنفيذ</div>
          </div>
          <div className="card-body">
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span style={{ fontSize: 14, color: "var(--ink-secondary)" }}>قيد التنفيذ حالياً</span>
                <span className="badge badge-in-progress">{inProgressProjects}</span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span style={{ fontSize: 14, color: "var(--ink-secondary)" }}>متوقف مؤقتاً</span>
                <span className="badge badge-paused">{await prisma.projectRecord.count({ where: { workStatus: "PAUSED" } })}</span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span style={{ fontSize: 14, color: "var(--ink-secondary)" }}>المصممون النشطون</span>
                <span className="badge badge-in-progress">{designers.length}</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Row 4: Recent Projects */}
      <div className="card" style={{ marginBottom: 24 }}>
        <div className="card-header">
          <div className="card-title">آخر المشاريع المسجلة</div>
          <Link href="/clients" className="btn btn-sm btn-secondary">عرض الكل</Link>
        </div>
        <div className="card-body" style={{ padding: 0 }}>
          {recentProjects.length === 0 ? (
            <div className="empty-state"><div className="empty-state-icon">📋</div><p>لا توجد مشاريع بعد</p></div>
          ) : (
            <div className="table-container">
              <table className="table">
                <thead>
                  <tr>
                    <th>العميل</th>
                    <th>المشروع</th>
                    <th>المصمم</th>
                    <th>السعر</th>
                    <th>حالة العمل</th>
                    <th>حالة الدفع</th>
                    <th>التاريخ</th>
                  </tr>
                </thead>
                <tbody>
                  {recentProjects.map((p) => (
                    <tr key={p.id}>
                      <td style={{ fontWeight: 600 }}>{p.client.name}</td>
                      <td>{p.projectName}</td>
                      <td>{p.designer?.name || p.designerName || '—'}</td>
                      <td style={{ fontWeight: 700 }}>{Number(p.totalPrice).toLocaleString("ar-SA")} ر.س</td>
                      <td><span className={`badge ${workStatusBadge[p.workStatus]}`}>{workStatusMap[p.workStatus]}</span></td>
                      <td><span className={`badge badge-${p.paymentStatus.toLowerCase()}`}>{p.paymentStatus === "FULL" ? "مدفوع" : p.paymentStatus === "PARTIAL" ? "جزئي" : "غير مدفوع"}</span></td>
                      <td className="muted">{new Date(p.date).toLocaleDateString("ar-EG")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* Row 5: Quick Actions */}
      <div className="card">
        <div className="card-header">
          <div className="card-title">وصول سريع</div>
        </div>
        <div className="card-body">
          <div className="actions-grid">
            <Link className="action-card" href="/clients">
              <div className="action-card-icon brand">👥</div>
              <div>
                <div className="action-card-title">إدارة العملاء</div>
                <div className="action-card-desc">عرض وإضافة سجلات المشاريع</div>
              </div>
            </Link>
            {session.role === "ADMIN" && (
              <Link className="action-card" href="/finance">
                <div className="action-card-icon info">🏦</div>
                <div>
                  <div className="action-card-title">الخزينة والمصروفات</div>
                  <div className="action-card-desc">إدارة الحسابات والسحوبات</div>
                </div>
              </Link>
            )}
          </div>
        </div>
      </div>
    </AppShell>
  );
}
