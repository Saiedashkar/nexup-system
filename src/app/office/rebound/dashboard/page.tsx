"use client";

import { useEffect, useState } from "react";

type DashboardData = {
  poolBalance: number;
  mrr: number;
  reboundBalance: number;
  totalExpenses: number;
  totalTransferred: number;
  totalClients: number;
  totalProjects: number;
  totalRevenue: number;
  totalCollected: number;
  activeProjects: number;
  completedProjects: number;
  activeSubscriptions: number;
  totalSubscriptions: number;
  monthlyRevenue: { month: string; revenue: number; projects: number }[];
  workStatusBreakdown: { status: string; count: number }[];
  topClients: { name: string; projects: number; totalPaid: number }[];
  recentActivity: { date: string; text: string }[];
};

function formatNum(n: number) {
  return n.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const STATUS_COLORS: Record<string, string> = {
  WAITING: "#f59e0b", IN_PROGRESS: "#3b82f6", COMPLETED: "#10b981", PAUSED: "#6b7280",
};

export default function ReboundDashboard() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/rebound/dashboard")
      .then(r => r.json())
      .then(d => setData(d))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "60vh" }}>
        <div style={{ textAlign: "center" }}>
          <div style={{ fontSize: 32, marginBottom: 12 }}>⏳</div>
          <p style={{ color: "var(--muted)" }}>جاري التحميل...</p>
        </div>
      </div>
    );
  }

  if (!data) {
    return (
      <div style={{ textAlign: "center", padding: 60 }}>
        <div style={{ fontSize: 48, marginBottom: 16 }}>📊</div>
        <h2 style={{ fontSize: 20, fontWeight: 700, color: "var(--text)", marginBottom: 8 }}>مرحبًا بك في REBOUND</h2>
        <p style={{ color: "var(--muted)", fontSize: 14 }}>ابدأ بإضافة أول عميل في قسم إدارة العملاء</p>
      </div>
    );
  }

  const maxRevenue = Math.max(...data.monthlyRevenue.map(m => m.revenue), 1);

  return (
    <div>
      {/* Page Header */}
      <div style={{ marginBottom: 28 }}>
        <h1 style={{ fontSize: 26, fontWeight: 800, color: "var(--text)", margin: 0, letterSpacing: "-0.02em" }}>
          لوحة تحكم REBOUND
        </h1>
        <p style={{ fontSize: 13, color: "var(--muted)", margin: "4px 0 0" }}>
          نظرة عامة على الأداء والبيانات
        </p>
      </div>

      {/* ═══ Balance Cards ═══ */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 24 }}>
        {/* Pool Balance (EGP direct) */}
        <div style={{
          padding: "20px 24px", borderRadius: 14,
          background: "linear-gradient(135deg, rgba(59,130,246,0.1) 0%, rgba(59,130,246,0.03) 100%)",
          border: "1px solid rgba(59,130,246,0.2)",
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 8 }}>
            <div style={{ width: 40, height: 40, borderRadius: 10, background: "rgba(59,130,246,0.15)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18 }}>💰</div>
            <div>
              <div style={{ fontSize: 12, color: "var(--muted)", fontWeight: 600 }}>الرصيد المتاح</div>
              <div style={{ fontSize: 10, color: "var(--muted)" }}>Available Balance (EGP)</div>
            </div>
          </div>
          <div style={{ fontSize: 28, fontWeight: 800, color: "#3b82f6", direction: "ltr", marginTop: 4 }}>
            {formatNum(data.poolBalance)} <span style={{ fontSize: 14, fontWeight: 600 }}>EGP</span>
          </div>
          <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 6 }}>
            مجموع كل الدفعات الفعلية بعد خصم المصروفات والتحويلات
          </div>
        </div>

        {/* MRR Card */}
        <div style={{
          padding: "20px 24px", borderRadius: 14,
          background: "linear-gradient(135deg, rgba(16,185,129,0.1) 0%, rgba(16,185,129,0.03) 100%)",
          border: "1px solid rgba(16,185,129,0.2)",
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 8 }}>
            <div style={{ width: 40, height: 40, borderRadius: 10, background: "rgba(16,185,129,0.15)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18 }}>📈</div>
            <div>
              <div style={{ fontSize: 12, color: "var(--muted)", fontWeight: 600 }}>الدخل الشهري المتكرر</div>
              <div style={{ fontSize: 10, color: "var(--muted)" }}>Monthly Recurring Revenue</div>
            </div>
          </div>
          <div style={{ fontSize: 28, fontWeight: 800, color: "#10b981", direction: "ltr", marginTop: 4 }}>
            {formatNum(data.mrr)} <span style={{ fontSize: 14, fontWeight: 600 }}>EGP</span>
          </div>
          <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 6 }}>
            من {data.activeSubscriptions} اشتراك نشط من أصل {data.totalSubscriptions}
          </div>
        </div>
      </div>

      {/* Main Stats Cards */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 16, marginBottom: 24 }}>
        {[
          { label: "إجمالي الإيرادات", labelEn: "Revenue", value: `${formatNum(data.totalRevenue)} EGP`, color: "#3b82f6", icon: "💰", bg: "rgba(59,130,246,0.08)" },
          { label: "مشاريع نشطة", labelEn: "Active Projects", value: data.activeProjects, color: "#f59e0b", icon: "🔄", bg: "rgba(245,158,11,0.08)" },
          { label: "مشاريع مكتملة", labelEn: "Completed", value: data.completedProjects, color: "#10b981", icon: "✅", bg: "rgba(16,185,129,0.08)" },
          { label: "عدد العملاء", labelEn: "Clients", value: data.totalClients, color: "#8b5cf6", icon: "👥", bg: "rgba(139,92,246,0.08)" },
        ].map((s) => (
          <div key={s.labelEn} style={{
            padding: "20px 24px", borderRadius: 14,
            background: "var(--surface)", border: "1px solid var(--border)",
            boxShadow: "var(--card-shadow)",
          }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12 }}>
              <div style={{ width: 40, height: 40, borderRadius: 10, background: s.bg, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18 }}>
                {s.icon}
              </div>
              <div>
                <div style={{ fontSize: 12, color: "var(--muted)", fontWeight: 500 }}>{s.label}</div>
                <div style={{ fontSize: 10, color: "var(--muted)", opacity: 0.6 }}>{s.labelEn}</div>
              </div>
            </div>
            <div style={{ fontSize: 24, fontWeight: 800, color: s.color, letterSpacing: "-0.02em" }}>
              {s.value}
            </div>
          </div>
        ))}
      </div>

      {/* Revenue Chart + Status Breakdown */}
      <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 16, marginBottom: 24 }}>
        {/* Monthly Revenue Chart */}
        <div style={{
          padding: "20px 24px", borderRadius: 14,
          background: "var(--surface)", border: "1px solid var(--border)",
        }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: "var(--text)", marginBottom: 20 }}>
            الإيرادات الشهرية
          </div>
          <div style={{ display: "flex", alignItems: "flex-end", gap: 8, height: 180, padding: "0 4px" }}>
            {data.monthlyRevenue.map((m, i) => {
              const height = maxRevenue > 0 ? (m.revenue / maxRevenue) * 140 : 0;
              return (
                <div key={i} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
                  {m.revenue > 0 && (
                    <span style={{ fontSize: 10, color: "var(--muted)", fontWeight: 600 }}>
                      {formatNum(m.revenue)}
                    </span>
                  )}
                  <div style={{
                    width: "100%", maxWidth: 40, height: Math.max(height, 4),
                    background: "linear-gradient(180deg, #3b82f6 0%, #60a5fa 100%)",
                    borderRadius: "6px 6px 2px 2px",
                  }} />
                  <span style={{ fontSize: 10, color: "var(--muted)" }}>{MONTHS[i]}</span>
                </div>
              );
            })}
          </div>
        </div>

        {/* Work Status Breakdown */}
        <div style={{
          padding: "20px 24px", borderRadius: 14,
          background: "var(--surface)", border: "1px solid var(--border)",
        }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: "var(--text)", marginBottom: 20 }}>
            حالة المشاريع
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            {data.workStatusBreakdown.map((s) => {
              const pct = data.totalProjects > 0 ? (s.count / data.totalProjects) * 100 : 0;
              const color = STATUS_COLORS[s.status] || "#6b7280";
              const label = s.status === "WAITING" ? "انتظار" : s.status === "IN_PROGRESS" ? "قيد التنفيذ" : s.status === "COMPLETED" ? "مكتمل" : "متوقف";
              return (
                <div key={s.status}>
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
                    <span style={{ fontSize: 12, color: "var(--text-secondary)", fontWeight: 500 }}>{label}</span>
                    <span style={{ fontSize: 12, fontWeight: 700, color }}>{s.count} ({Math.round(pct)}%)</span>
                  </div>
                  <div style={{ height: 6, borderRadius: 3, background: "var(--border)", overflow: "hidden" }}>
                    <div style={{
                      height: "100%", borderRadius: 3,
                      width: `${pct}%`, background: color,
                    }} />
                  </div>
                </div>
              );
            })}
          </div>

          {/* Collection Rate */}
          <div style={{ marginTop: 20, padding: "12px 14px", borderRadius: 10, background: "var(--surface-hover)" }}>
            <div style={{ fontSize: 11, color: "var(--muted)", marginBottom: 4 }}>نسبة التحصيل</div>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <div style={{ flex: 1, height: 8, borderRadius: 4, background: "var(--border)", overflow: "hidden" }}>
                <div style={{
                  height: "100%", borderRadius: 4,
                  width: `${data.totalRevenue > 0 ? (data.totalCollected / data.totalRevenue) * 100 : 0}%`,
                  background: "linear-gradient(90deg, #3b82f6, #60a5fa)",
                }} />
              </div>
              <span style={{ fontSize: 13, fontWeight: 700, color: "#3b82f6" }}>
                {data.totalRevenue > 0 ? Math.round((data.totalCollected / data.totalRevenue) * 100) : 0}%
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Top Clients + Recent Activity */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
        {/* Top Clients */}
        <div style={{
          padding: "20px 24px", borderRadius: 14,
          background: "var(--surface)", border: "1px solid var(--border)",
        }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: "var(--text)", marginBottom: 16 }}>
            أفضل العملاء
          </div>
          {data.topClients.length === 0 ? (
            <p style={{ fontSize: 13, color: "var(--muted)", textAlign: "center", padding: 20 }}>لا يوجد عملاء بعد</p>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {data.topClients.map((c, i) => (
                <div key={i} style={{
                  display: "flex", alignItems: "center", gap: 12,
                  padding: "10px 12px", borderRadius: 10,
                  background: "var(--surface-hover)",
                }}>
                  <div style={{
                    width: 32, height: 32, borderRadius: 8,
                    background: `hsl(${220 + i * 30}, 60%, 50%)`,
                    display: "flex", alignItems: "center", justifyContent: "center",
                    color: "#fff", fontSize: 13, fontWeight: 700,
                  }}>
                    {c.name.charAt(0)}
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text)" }}>{c.name}</div>
                    <div style={{ fontSize: 11, color: "var(--muted)" }}>{c.projects} مشاريع</div>
                  </div>
                  <div style={{ fontSize: 13, fontWeight: 700, color: "#3b82f6" }}>
                    {formatNum(c.totalPaid)} <span style={{ fontSize: 10, color: "var(--muted)" }}>EGP</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Recent Activity */}
        <div style={{
          padding: "20px 24px", borderRadius: 14,
          background: "var(--surface)", border: "1px solid var(--border)",
        }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: "var(--text)", marginBottom: 16 }}>
            آخر النشاطات
          </div>
          {data.recentActivity.length === 0 ? (
            <p style={{ fontSize: 13, color: "var(--muted)", textAlign: "center", padding: 20 }}>لا يوجد نشاط بعد</p>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {data.recentActivity.map((a, i) => (
                <div key={i} style={{
                  display: "flex", alignItems: "flex-start", gap: 10,
                  padding: "8px 0", borderBottom: i < data.recentActivity.length - 1 ? "1px solid var(--border)" : "none",
                }}>
                  <div style={{
                    width: 6, height: 6, borderRadius: "50%",
                    background: "#3b82f6", marginTop: 6, flexShrink: 0,
                  }} />
                  <div>
                    <div style={{ fontSize: 12, color: "var(--text-secondary)" }}>{a.text}</div>
                    <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 2 }}>
                      {new Date(a.date).toLocaleDateString("ar-EG", { day: "2-digit", month: "short", year: "numeric" })}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
