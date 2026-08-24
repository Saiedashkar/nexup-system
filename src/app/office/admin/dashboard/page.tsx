"use client";

import { useState, useEffect } from "react";

type PartnerSummary = { id: string; name: string; balance: number; outstandingAdvances: number; totalCapital: number; txCount: number };
type AdminStats = {
  currentMonth: { totalExpenses: number; expenseCount: number };
  allTime: { totalExpenses: number; totalCapital: number; expenseCount: number };
  partnerSummary: PartnerSummary[];
  monthlyBreakdown: { month: number; year: number; total: number }[];
};

const fmt = (n: number) => n.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 });
const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

export default function AdminDashboardPage() {
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/office/admin-stats").then(r => r.json()).then(d => { setStats(d); setLoading(false); }).catch(() => setLoading(false));
  }, []);

  if (loading) return <div style={{ textAlign: "center", padding: 48, color: "var(--muted)" }}>Loading...</div>;
  if (!stats) return <div style={{ textAlign: "center", padding: 48, color: "var(--muted)" }}>Failed to load</div>;

  const maxExpense = Math.max(...stats.monthlyBreakdown.map(m => m.total), 1);

  return (
    <div>
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ fontSize: 24, fontWeight: 800, color: "var(--text)", margin: 0 }}>Office Dashboard</h1>
        <p style={{ fontSize: 13, color: "var(--muted)", margin: "4px 0 0" }}>Overview of office finances, partners & expenses</p>
      </div>

      {/* Top Stats */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 14, marginBottom: 24 }}>
        {[
          { label: "Office Expenses (Month)", value: `${fmt(stats.currentMonth.totalExpenses)} EGP`, color: "#ef4444", bg: "rgba(239,68,68,0.06)" },
          { label: "Office Expenses (All Time)", value: `${fmt(stats.allTime.totalExpenses)} EGP`, color: "#f59e0b", bg: "rgba(245,158,11,0.06)" },
          { label: "Total Capital", value: `${fmt(stats.allTime.totalCapital)} EGP`, color: "#10b981", bg: "rgba(16,185,129,0.06)" },
          { label: "Partners", value: stats.partnerSummary.length, color: "#8b5cf6", bg: "rgba(139,92,246,0.06)" },
        ].map(s => (
          <div key={s.label} style={{ padding: "18px 20px", borderRadius: 12, background: s.bg, border: "1px solid var(--border)" }}>
            <div style={{ fontSize: 11, color: "var(--muted)", marginBottom: 6 }}>{s.label}</div>
            <div style={{ fontSize: 22, fontWeight: 800, color: s.color, direction: "ltr" }}>{s.value}</div>
          </div>
        ))}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}>
        {/* Partner Balances */}
        <div style={{ borderRadius: 12, border: "1px solid var(--border)", overflow: "hidden" }}>
          <div style={{ padding: "14px 20px", background: "var(--surface)", borderBottom: "1px solid var(--border)", fontSize: 14, fontWeight: 700, color: "var(--text)" }}>
            Partner Balances
          </div>
          {stats.partnerSummary.length === 0 ? (
            <div style={{ textAlign: "center", padding: 32, color: "var(--muted)", fontSize: 13 }}>No partners yet</div>
          ) : stats.partnerSummary.map(p => (
            <div key={p.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 20px", borderBottom: "1px solid var(--border)" }}>
              <div>
                <div style={{ fontWeight: 700, fontSize: 13, color: "var(--text)" }}>{p.name}</div>
                <div style={{ fontSize: 11, color: "var(--muted)" }}>{p.txCount} transactions</div>
              </div>
              <div style={{ textAlign: "right" }}>
                <div style={{ fontWeight: 700, fontSize: 14, color: p.balance >= 0 ? "#10b981" : "#ef4444", direction: "ltr" }}>
                  {p.balance >= 0 ? "+" : ""}{fmt(p.balance)} EGP
                </div>
                {p.outstandingAdvances > 0 && (
                  <div style={{ fontSize: 10, color: "#f59e0b" }}>Advances: {fmt(p.outstandingAdvances)} EGP</div>
                )}
              </div>
            </div>
          ))}
        </div>

        {/* Monthly Expense Chart */}
        <div style={{ borderRadius: 12, border: "1px solid var(--border)", overflow: "hidden" }}>
          <div style={{ padding: "14px 20px", background: "var(--surface)", borderBottom: "1px solid var(--border)", fontSize: 14, fontWeight: 700, color: "var(--text)" }}>
            Monthly Office Expenses
          </div>
          <div style={{ padding: 20 }}>
            {stats.monthlyBreakdown.map((m, i) => (
              <div key={i} style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 10 }}>
                <div style={{ width: 50, fontSize: 12, color: "var(--muted)", flexShrink: 0 }}>{MONTHS[m.month - 1]} {m.year}</div>
                <div style={{ flex: 1, height: 24, borderRadius: 6, background: "var(--surface-hover)", overflow: "hidden" }}>
                  <div style={{ height: "100%", borderRadius: 6, background: m.total > 0 ? "linear-gradient(90deg, #ef4444, #f97316)" : "transparent", width: `${(m.total / maxExpense) * 100}%`, transition: "width 0.5s ease", display: "flex", alignItems: "center", paddingLeft: 8 }}>
                    {m.total > 0 && <span style={{ fontSize: 11, fontWeight: 600, color: "#fff" }}>{fmt(m.total)}</span>}
                  </div>
                </div>
                <div style={{ width: 80, textAlign: "right", fontSize: 12, fontWeight: 600, color: "var(--text)", direction: "ltr" }}>{fmt(m.total)} EGP</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
