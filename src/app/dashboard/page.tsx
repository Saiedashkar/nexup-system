import Link from "next/link";
import { AppShell } from "@/components/app-shell";
import { getCurrentSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const session = await getCurrentSession();
  if (!session) return null;

  // Fetch stats
  const [totalClients, totalProjects, pendingProjects, completedProjects, totalRevenue] = await Promise.all([
    prisma.client.count(),
    prisma.projectRecord.count(),
    prisma.projectRecord.count({ where: { workStatus: "WAITING" } }),
    prisma.projectRecord.count({ where: { workStatus: "COMPLETED" } }),
    prisma.projectRecord.aggregate({ _sum: { totalPrice: true } }),
  ]);

  const revenue = totalRevenue._sum.totalPrice ?? 0;

  return (
    <AppShell isAdmin={session.role === "ADMIN"} userName={session.name} activePage="dashboard">
      <div className="page-header">
        <div>
          <h1 className="page-title">لوحة التحكم</h1>
          <p className="page-subtitle">مرحبًا {session.name} — نظرة عامة على النظام</p>
        </div>
      </div>

      {/* Stat Cards */}
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

      {/* Revenue Card */}
      <div className="card" style={{ marginBottom: 28 }}>
        <div className="card-header">
          <div className="card-title">إجمالي الإيرادات</div>
        </div>
        <div className="card-body">
          <div style={{ fontSize: "2rem", fontWeight: 800, color: "var(--brand)" }}>
            {Number(revenue).toLocaleString("ar-SA")} ر.س
          </div>
          <p className="muted" style={{ marginTop: 4 }}>من جميع سجلات الخدمات المسجلة</p>
        </div>
      </div>

      {/* Quick Actions */}
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
                  <div className="action-card-desc">الحركات والسحوبات والمصاريف</div>
                </div>
              </Link>
            )}
          </div>
        </div>
      </div>
    </AppShell>
  );
}
