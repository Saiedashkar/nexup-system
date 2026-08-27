"use client";

import { useEffect, useState } from "react";

type DashboardData = {
  totalClients: number;
  totalProjects: number;
  totalRevenue: number;
  totalCollected: number;
  activeProjects: number;
  completedProjects: number;
  monthlyRevenue: { month: string; revenue: number; projects: number }[];
  topClients: { name: string; projects: number; totalPaid: number }[];
  workStatusBreakdown: { status: string; count: number }[];
  poolBalance: number;
  mrr: number;
  activeSubscriptions: number;
  totalSubscriptions: number;
};

const fmt = (n: number) => n.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 });
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export default function ReboundAnalyticsPage() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/rebound/dashboard").then(r => r.ok ? r.json() : null).then(d => { setData(d); setLoading(false); }).catch(() => setLoading(false));
  }, []);

  if (loading) return <div style={{ textAlign: "center", padding: 60, color: "var(--muted)" }}>جاري تحميل التحليلات...</div>;
  if (!data) return <div style={{ textAlign: "center", padding: 60, color: "var(--muted)" }}>لا توجد بيانات كافية للتحليل</div>;

  const maxRev = Math.max(...data.monthlyRevenue.map(m => m.revenue), 1);
  const collectionRate = data.totalRevenue > 0 ? (data.totalCollected / data.totalRevenue) * 100 : 0;
  const avgPerClient = data.totalClients > 0 ? data.totalCollected / data.totalClients : 0;

  return (
    <div>
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ fontSize: 24, fontWeight: 800, color: "var(--text)", margin: 0 }}>📊 تحليلات REBOUND</h1>
        <p style={{ fontSize: 13, color: "var(--muted)", margin: "4px 0 0" }}>Analytics & Performance Insights</p>
      </div>

      {/* KPI Cards */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 16, marginBottom: 24 }}>
        {[
          { label: "معدل التحصيل", value: `${Math.round(collectionRate)}%`, color: collectionRate > 80 ? "#10b981" : "#f59e0b", icon: "📈" },
          { label: "متوسط الدخل لكل عميل", value: `${fmt(avgPerClient)} EGP`, color: "#3b82f6", icon: "👤" },
          { label: "الاشتراكات النشطة", value: data.activeSubscriptions || 0, color: "#10b981", icon: "🔄" },
          { label: "الدخل الشهري المتكرر", value: `${fmt(data.mrr || 0)} EGP`, color: "#8b5cf6", icon: "💰" },
        ].map((kpi, i) => (
          <div key={i} style={{ padding: "20px 24px", borderRadius: 14, background: "var(--surface)", border: "1px solid var(--border)" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
              <span style={{ fontSize: 20 }}>{kpi.icon}</span>
              <span style={{ fontSize: 12, color: "var(--muted)", fontWeight: 600 }}>{kpi.label}</span>
            </div>
            <div style={{ fontSize: 24, fontWeight: 800, color: kpi.color, direction: "ltr" }}>{kpi.value}</div>
          </div>
        ))}
      </div>

      {/* Revenue Chart */}
      <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 16, marginBottom: 24 }}>
        <div style={{ padding: "20px 24px", borderRadius: 14, background: "var(--surface)", border: "1px solid var(--border)" }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: "var(--text)", marginBottom: 20 }}>📈 الإيرادات الشهرية</div>
          <div style={{ display: "flex", alignItems: "flex-end", gap: 8, height: 200 }}>
            {data.monthlyRevenue.map((m, i) => {
              const h = maxRev > 0 ? (m.revenue / maxRev) * 160 : 0;
              return (
                <div key={i} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
                  {m.revenue > 0 && <span style={{ fontSize: 10, color: "var(--muted)", fontWeight: 600 }}>{fmt(m.revenue)}</span>}
                  <div style={{ width: "100%", maxWidth: 40, height: Math.max(h, 4), background: "linear-gradient(180deg, #2563eb, #3b82f6)", borderRadius: "6px 6px 2px 2px" }} />
                  <span style={{ fontSize: 10, color: "var(--muted)" }}>{MONTHS[i]}</span>
                </div>
              );
            })}
          </div>
        </div>

        <div style={{ padding: "20px 24px", borderRadius: 14, background: "var(--surface)", border: "1px solid var(--border)" }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: "var(--text)", marginBottom: 20 }}>🔄 حالة المشاريع</div>
          {data.workStatusBreakdown.map(s => {
            const pct = data.totalProjects > 0 ? (s.count / data.totalProjects) * 100 : 0;
            const colors: Record<string, string> = { WAITING: "#f59e0b", IN_PROGRESS: "#3b82f6", COMPLETED: "#10b981", PAUSED: "#6b7280" };
            const labels: Record<string, string> = { WAITING: "في الانتظار", IN_PROGRESS: "قيد التنفيذ", COMPLETED: "مكتمل", PAUSED: "متوقف" };
            return (
              <div key={s.status} style={{ marginBottom: 14 }}>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
                  <span style={{ fontSize: 12, color: "var(--text-secondary)" }}>{labels[s.status] || s.status}</span>
                  <span style={{ fontSize: 12, fontWeight: 700, color: colors[s.status] }}>{s.count} ({Math.round(pct)}%)</span>
                </div>
                <div style={{ height: 6, borderRadius: 3, background: "var(--border)", overflow: "hidden" }}>
                  <div style={{ height: "100%", borderRadius: 3, width: `${pct}%`, background: colors[s.status] }} />
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Top Clients */}
      <div style={{ padding: "20px 24px", borderRadius: 14, background: "var(--surface)", border: "1px solid var(--border)" }}>
        <div style={{ fontSize: 14, fontWeight: 700, color: "var(--text)", marginBottom: 16 }}>🏆 أفضل العملاء</div>
        {data.topClients.length === 0 ? (
          <p style={{ textAlign: "center", color: "var(--muted)", padding: 20 }}>لا يوجد عملاء بعد</p>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(250px, 1fr))", gap: 12 }}>
            {data.topClients.map((c, i) => (
              <div key={i} style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 16px", borderRadius: 10, background: "var(--surface-hover)" }}>
                <div style={{ width: 36, height: 36, borderRadius: 8, background: `hsl(${i * 60 + 200}, 60%, 50%)`, display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontSize: 14, fontWeight: 700 }}>{c.name.charAt(0)}</div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text)" }}>{c.name}</div>
                  <div style={{ fontSize: 11, color: "var(--muted)" }}>{c.projects} مشروع</div>
                </div>
                <div style={{ fontSize: 13, fontWeight: 700, color: "#2563eb" }}>{fmt(c.totalPaid)} <span style={{ fontSize: 10, color: "var(--muted)" }}>EGP</span></div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
