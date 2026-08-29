"use client";

import { useEffect, useState, useMemo } from "react";

type DashboardData = {
  totalClients: number;
  totalProjects: number;
  totalRevenue: number;
  totalCollected: number;
  totalRemaining: number;
  activeProjects: number;
  completedProjects: number;
  unpaidProjects: number;
  monthlyRevenue: { month: string; revenue: number; projects: number }[];
  topClients: { name: string; projects: number; totalPaid: number }[];
  workStatusBreakdown: { status: string; count: number }[];
  recentActivity: { date: string; text: string }[];
  poolBalance: number;
  nexupTreasuryEGP: number;
  totalProfitTransferred: number;
  mrr: number;
  activeSubscriptions: number;
  totalSubscriptions: number;
};

function fmt(n: number | undefined | null) {
  return (n ?? 0).toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}

const STATUS_COLORS: Record<string, string> = {
  WAITING: "#f59e0b", IN_PROGRESS: "#3b82f6", COMPLETED: "#10b981", PAUSED: "#6b7280",
};
const STATUS_LABELS: Record<string, string> = {
  WAITING: "In Queue", IN_PROGRESS: "Working", COMPLETED: "Done", PAUSED: "On Hold",
};

/* ═══ Donut Chart (CSS-only) ═══ */
function DonutChart({ segments, size = 140 }: { segments: { label: string; value: number; color: string }[]; size?: number }) {
  const total = segments.reduce((s, seg) => s + seg.value, 0);
  let cumulativePercent = 0;
  const gradientParts: string[] = [];
  for (const seg of segments) {
    const pct = total > 0 ? (seg.value / total) * 100 : 0;
    gradientParts.push(`${seg.color} ${cumulativePercent}% ${cumulativePercent + pct}%`);
    cumulativePercent += pct;
  }
  const gradient = total > 0
    ? `conic-gradient(${gradientParts.join(", ")})`
    : "conic-gradient(#333 0% 100%)";

  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 12 }}>
      <div style={{
        width: size, height: size, borderRadius: "50%",
        background: gradient,
        display: "flex", alignItems: "center", justifyContent: "center",
        position: "relative",
      }}>
        <div style={{
          width: size * 0.55, height: size * 0.55, borderRadius: "50%",
          background: "var(--surface)", display: "flex", alignItems: "center", justifyContent: "center",
          flexDirection: "column",
        }}>
          <div style={{ fontSize: 22, fontWeight: 800, color: "var(--text)" }}>{total}</div>
          <div style={{ fontSize: 9, color: "var(--muted)" }}>Total</div>
        </div>
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "6px 16px", justifyContent: "center" }}>
        {segments.map((seg, i) => (
          <div key={i} style={{ display: "flex", alignItems: "center", gap: 5 }}>
            <div style={{ width: 8, height: 8, borderRadius: 2, background: seg.color }} />
            <span style={{ fontSize: 11, color: "var(--muted)" }}>{seg.label}</span>
            <span style={{ fontSize: 11, fontWeight: 700, color: "var(--text)" }}>{seg.value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ═══ Bar Chart ═══ */
function BarChart({ data, height = 160, color = "#0d9488" }: { data: { label: string; value: number }[]; height?: number; color?: string }) {
  const maxVal = Math.max(...data.map(d => d.value), 1);
  return (
    <div style={{ display: "flex", alignItems: "flex-end", gap: 6, height, padding: "0 4px" }}>
      {data.map((d, i) => {
        const h = maxVal > 0 ? (d.value / maxVal) * (height - 30) : 0;
        return (
          <div key={i} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 3 }}>
            {d.value > 0 && <span style={{ fontSize: 9, fontWeight: 600, color: "var(--muted)" }}>{fmt(d.value)}</span>}
            <div style={{
              width: "100%", maxWidth: 32, minHeight: 3, height: Math.max(h, 3),
              background: `linear-gradient(180deg, ${color} 0%, ${color}99 100%)`,
              borderRadius: "4px 4px 1px 1px", transition: "height 0.4s ease",
            }} />
            <span style={{ fontSize: 9, color: "var(--muted)", whiteSpace: "nowrap" }}>{d.label}</span>
          </div>
        );
      })}
    </div>
  );
}

/* ═══ Mini Stat Card ═══ */
function MiniCard({ label, sublabel, value, unit, color, icon, bg }: {
  label: string; sublabel: string; value: string | number; unit: string; color: string; icon: string; bg: string;
}) {
  return (
    <div style={{
      padding: "16px 18px", borderRadius: 12, position: "relative", overflow: "hidden",
      background: `linear-gradient(135deg, ${bg} 0%, transparent 100%)`,
      border: `1px solid ${color}22`,
    }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 8 }}>
        <div>
          <div style={{ fontSize: 11, fontWeight: 600, color: "var(--muted)" }}>{label}</div>
          <div style={{ fontSize: 9, color: "var(--muted)", marginTop: 1 }}>{sublabel}</div>
        </div>
        <div style={{ width: 32, height: 32, borderRadius: 8, background: `${color}18`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 15 }}>{icon}</div>
      </div>
      <div style={{ fontSize: 24, fontWeight: 800, color, direction: "ltr", display: "flex", alignItems: "baseline", gap: 4 }}>
        {value} <span style={{ fontSize: 12, fontWeight: 600 }}>{unit}</span>
      </div>
    </div>
  );
}

export default function NexupDashboard() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/nexup/dashboard").then(r => r.ok ? r.json() : null).then(d => { if (d) setData(d); setLoading(false); }).catch(() => setLoading(false));
  }, []);

  if (loading) return <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "60vh" }}><div style={{ textAlign: "center" }}><div style={{ fontSize: 32, marginBottom: 12 }}>⏳</div><p style={{ color: "var(--muted)" }}>Loading dashboard...</p></div></div>;

  if (!data) return <div style={{ textAlign: "center", padding: 60 }}><div style={{ fontSize: 48, marginBottom: 16 }}>📊</div><h2 style={{ fontSize: 20, fontWeight: 700, color: "var(--text)" }}>Welcome to NEXUP</h2><p style={{ color: "var(--muted)", fontSize: 14 }}>Start by adding your first client</p></div>;

  const collectionRate = data.totalRevenue > 0 ? Math.round((data.totalCollected / data.totalRevenue) * 100) : 0;
  const profitMargin = data.totalRevenue > 0 ? Math.round(((data.totalCollected - data.totalRemaining) / data.totalRevenue) * 100) : 0;
  const avgProjectValue = data.totalProjects > 0 ? Math.round(data.totalRevenue / data.totalProjects) : 0;
  const avgPerClient = data.totalClients > 0 ? Math.round(data.totalRevenue / data.totalClients) : 0;

  const statusSegments = data.workStatusBreakdown.map(s => ({
    label: STATUS_LABELS[s.status] || s.status, value: s.count, color: STATUS_COLORS[s.status] || "#6b7280",
  }));

  return (
    <div>
      {/* Header */}
      <div style={{ marginBottom: 24, display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <div>
          <h1 style={{ fontSize: 26, fontWeight: 800, color: "var(--text)", margin: 0 }}>📊 Dashboard</h1>
          <p style={{ fontSize: 12, color: "var(--muted)", margin: "4px 0 0" }}>NEXUP Design Studio — Overview & Analytics</p>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <div style={{ padding: "6px 12px", borderRadius: 8, background: collectionRate >= 80 ? "rgba(16,185,129,0.1)" : "rgba(245,158,11,0.1)", border: `1px solid ${collectionRate >= 80 ? "rgba(16,185,129,0.2)" : "rgba(245,158,11,0.2)"}` }}>
            <span style={{ fontSize: 10, color: "var(--muted)" }}>Collection </span>
            <span style={{ fontSize: 13, fontWeight: 800, color: collectionRate >= 80 ? "#10b981" : "#f59e0b" }}>{collectionRate}%</span>
          </div>
        </div>
      </div>

      {/* ═══ Row 1: Balance Cards ═══ */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 12, marginBottom: 16 }}>
        <MiniCard label="الرصيد المتاح" sublabel="Available Balance" value={fmt(data.poolBalance)} unit="SAR" color="#0d9488" icon="💰" bg="rgba(13,148,136,0.06)" />
        <MiniCard label="المحول للمكتب" sublabel="Transferred to Office" value={fmt(data.totalProfitTransferred)} unit="EGP" color="#8b5cf6" icon="🏦" bg="rgba(139,92,246,0.06)" />
        <MiniCard label="المتبقي من العملاء" sublabel="Clients Unpaid" value={fmt(data.totalRemaining)} unit="SAR" color="#ef4444" icon="⚠️" bg="rgba(239,68,68,0.06)" />
        <MiniCard label="خزنة NEXUP" sublabel="Treasury (EGP)" value={fmt(data.nexupTreasuryEGP)} unit="EGP" color="#3b82f6" icon="🏛️" bg="rgba(59,130,246,0.06)" />
        <MiniCard label="الدخل المتكرر" sublabel="Monthly Recurring" value={fmt(data.mrr)} unit="EGP" color="#10b981" icon="📈" bg="rgba(16,185,129,0.06)" />
      </div>

      {/* ═══ Row 2: Key Metrics ═══ */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12, marginBottom: 16 }}>
        {[
          { label: "Total Revenue", value: `${fmt(data.totalRevenue)} SAR`, color: "#0d9488", icon: "💰", sub: `Avg: ${fmt(avgProjectValue)} SAR/project` },
          { label: "Active Projects", value: data.activeProjects, color: "#3b82f6", icon: "🔄", sub: `${data.completedProjects} completed` },
          { label: "Total Clients", value: data.totalClients, color: "#8b5cf6", icon: "👥", sub: `${fmt(avgPerClient)} SAR/client avg` },
          { label: "Collection Rate", value: `${collectionRate}%`, color: collectionRate >= 80 ? "#10b981" : "#f59e0b", icon: "📊", sub: `${fmt(data.totalCollected)} / ${fmt(data.totalRevenue)} SAR` },
        ].map((s) => (
          <div key={s.label} style={{ padding: "18px 20px", borderRadius: 12, background: "var(--surface)", border: "1px solid var(--border)", boxShadow: "var(--card-shadow)" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
              <div style={{ width: 36, height: 36, borderRadius: 9, background: `${s.color}12`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16 }}>{s.icon}</div>
              <div style={{ fontSize: 11, color: "var(--muted)", fontWeight: 500 }}>{s.label}</div>
            </div>
            <div style={{ fontSize: 22, fontWeight: 800, color: s.color, letterSpacing: "-0.02em" }}>{s.value}</div>
            <div style={{ fontSize: 10, color: "var(--muted)", marginTop: 4 }}>{s.sub}</div>
          </div>
        ))}
      </div>

      {/* ═══ Row 3: Charts ═══ */}
      <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr", gap: 16, marginBottom: 16 }}>
        {/* Monthly Revenue Chart */}
        <div style={{ padding: "20px 24px", borderRadius: 12, background: "var(--surface)", border: "1px solid var(--border)", boxShadow: "var(--card-shadow)" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
            <div>
              <div style={{ fontSize: 14, fontWeight: 700, color: "var(--text)" }}>Monthly Revenue</div>
              <div style={{ fontSize: 11, color: "var(--muted)" }}>Last 12 months performance</div>
            </div>
            <div style={{ fontSize: 13, fontWeight: 800, color: "#0d9488" }}>{fmt(data.totalRevenue)} SAR</div>
          </div>
          <BarChart
            data={data.monthlyRevenue.map(m => ({ label: m.month.split(" ")[0], value: m.revenue }))}
            color="#0d9488"
          />
        </div>

        {/* Project Status Donut */}
        <div style={{ padding: "20px 24px", borderRadius: 12, background: "var(--surface)", border: "1px solid var(--border)", boxShadow: "var(--card-shadow)" }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: "var(--text)", marginBottom: 16, textAlign: "center" }}>Project Status</div>
          <DonutChart segments={statusSegments} size={130} />
        </div>

        {/* Quick Stats */}
        <div style={{ padding: "20px 24px", borderRadius: 12, background: "var(--surface)", border: "1px solid var(--border)", boxShadow: "var(--card-shadow)" }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: "var(--text)", marginBottom: 16 }}>Quick Stats</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {[
              { label: "Avg Project Value", value: `${fmt(avgProjectValue)} SAR`, color: "#0d9488" },
              { label: "Avg per Client", value: `${fmt(avgPerClient)} SAR`, color: "#3b82f6" },
              { label: "Profit Margin", value: `${profitMargin}%`, color: profitMargin >= 50 ? "#10b981" : "#f59e0b" },
              { label: "Unpaid Projects", value: data.unpaidProjects, color: data.unpaidProjects > 0 ? "#ef4444" : "#10b981" },
              { label: "Active Subscriptions", value: data.activeSubscriptions, color: "#8b5cf6" },
              { label: "Treasury (EGP)", value: fmt(data.nexupTreasuryEGP), color: "#3b82f6" },
            ].map((s, i) => (
              <div key={i} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 10px", borderRadius: 8, background: "var(--surface-hover)" }}>
                <span style={{ fontSize: 11, color: "var(--muted)" }}>{s.label}</span>
                <span style={{ fontSize: 13, fontWeight: 700, color: s.color }}>{s.value}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ═══ Row 4: Top Clients + Recent Activity ═══ */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
        {/* Top Clients */}
        <div style={{ padding: "20px 24px", borderRadius: 12, background: "var(--surface)", border: "1px solid var(--border)", boxShadow: "var(--card-shadow)" }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: "var(--text)", marginBottom: 14 }}>🏆 Top Clients</div>
          {data.topClients.length === 0 ? (
            <p style={{ fontSize: 12, color: "var(--muted)", textAlign: "center", padding: 20 }}>No clients yet</p>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {data.topClients.map((c, i) => {
                const maxPaid = data.topClients[0]?.totalPaid || 1;
                const pct = (c.totalPaid / maxPaid) * 100;
                return (
                  <div key={i} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 10px", borderRadius: 8, background: "var(--surface-hover)" }}>
                    <div style={{ width: 28, height: 28, borderRadius: 7, background: `hsl(${i * 70}, 55%, 45%)`, display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontSize: 11, fontWeight: 700, flexShrink: 0 }}>{c.name.charAt(0)}</div>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text)" }}>{c.name}</div>
                      <div style={{ fontSize: 9, color: "var(--muted)" }}>{c.projects} project{c.projects > 1 ? "s" : ""}</div>
                    </div>
                    <div style={{ width: 60, height: 4, borderRadius: 2, background: "var(--border)", overflow: "hidden" }}>
                      <div style={{ height: "100%", width: `${pct}%`, borderRadius: 2, background: "#0d9488" }} />
                    </div>
                    <div style={{ fontSize: 12, fontWeight: 700, color: "#0d9488", direction: "ltr" }}>{fmt(c.totalPaid)} <span style={{ fontSize: 9, color: "var(--muted)" }}>SAR</span></div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Recent Activity */}
        <div style={{ padding: "20px 24px", borderRadius: 12, background: "var(--surface)", border: "1px solid var(--border)", boxShadow: "var(--card-shadow)" }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: "var(--text)", marginBottom: 14 }}>📋 Recent Activity</div>
          {data.recentActivity.length === 0 ? (
            <p style={{ fontSize: 12, color: "var(--muted)", textAlign: "center", padding: 20 }}>No recent activity</p>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
              {data.recentActivity.map((a, i) => {
                const isDone = a.text.includes("COMPLETED");
                return (
                  <div key={i} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 0", borderBottom: i < data.recentActivity.length - 1 ? "1px solid var(--border)" : "none" }}>
                    <div style={{ width: 6, height: 6, borderRadius: "50%", background: isDone ? "#10b981" : "#3b82f6", flexShrink: 0 }} />
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 11, color: "var(--text-secondary)", lineHeight: 1.4 }}>{a.text}</div>
                      <div style={{ fontSize: 10, color: "var(--muted)", marginTop: 2 }}>
                        {new Date(a.date).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
