"use client";

import { useState, useEffect } from "react";

type PartnerSummary = { id: string; name: string; balance: number; outstandingAdvances: number; totalCapital: number; txCount: number };
type OfficeTreasury = { balance: number; cashCapital: number; profitTransfers: number; partnerOutflows: number; partnerInflows: number };
type AdminStats = {
  currentMonth: { totalExpenses: number; expenseCount: number };
  allTime: { totalExpenses: number; totalCapital: number; expenseCount: number };
  officeTreasury: OfficeTreasury;
  partnerSummary: PartnerSummary[];
  monthlyBreakdown: { month: number; year: number; total: number }[];
};

const fmt = (n: number) => n.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 });
const MONTHS_AR = ["يناير","فبراير","مارس","أبريل","مايو","يونيو","يوليو","أغسطس","سبتمبر","أكتوبر","نوفمبر","ديسمبر"];

export default function AdminDashboardPage() {
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/office/admin-stats").then(r => r.json()).then(d => { setStats(d); setLoading(false); }).catch(() => setLoading(false));
  }, []);

  if (loading) return <div style={{ textAlign: "center", padding: 48, color: "var(--muted)" }}>جاري التحميل...</div>;
  if (!stats) return <div style={{ textAlign: "center", padding: 48, color: "var(--muted)" }}>فشل في تحميل البيانات</div>;

  const maxExpense = Math.max(...stats.monthlyBreakdown.map(m => m.total), 1);

  return (
    <div>
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ fontSize: 24, fontWeight: 800, color: "var(--text)", margin: 0 }}>لوحة تحكم المكتب</h1>
        <p style={{ fontSize: 13, color: "var(--muted)", margin: "4px 0 0" }}>نظرة شاملة على المالية والشركاء والمصاريف — Office Dashboard</p>
      </div>

      {/* ═══ Office Treasury Balance ═══ */}
      <div style={{ padding: "20px 24px", borderRadius: 14, background: "linear-gradient(135deg, rgba(13,148,136,0.08), rgba(13,148,136,0.02))", border: "1px solid rgba(13,148,136,0.2)", marginBottom: 20 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
          <div>
            <div style={{ fontSize: 13, fontWeight: 700, color: "var(--text)", marginBottom: 2 }}>💰 رصيد خزينة المكتب</div>
            <div style={{ fontSize: 10, color: "var(--muted)" }}>الفلوس المتاحة فعليًا في المكتب الآن — Office Treasury Balance</div>
          </div>
          <div style={{ fontSize: 28, fontWeight: 800, color: stats.officeTreasury.balance >= 0 ? "#10b981" : "#ef4444", direction: "ltr" }}>
            {stats.officeTreasury.balance >= 0 ? "+" : ""}{fmt(stats.officeTreasury.balance)} EGP
          </div>
        </div>
        <div style={{ display: "flex", gap: 20, marginTop: 14, borderTop: "1px solid rgba(13,148,136,0.15)", paddingTop: 12 }}>
          <div>
            <div style={{ fontSize: 10, color: "var(--muted)" }}>التمويل النقدي</div>
            <div style={{ fontSize: 14, fontWeight: 700, color: "#3b82f6", direction: "ltr" }}>{fmt(stats.officeTreasury.cashCapital)} EGP</div>
          </div>
          <div>
            <div style={{ fontSize: 10, color: "var(--muted)" }}>تحويلات الأرباح</div>
            <div style={{ fontSize: 14, fontWeight: 700, color: "#0d9488", direction: "ltr" }}>{fmt(stats.officeTreasury.profitTransfers)} EGP</div>
          </div>
          <div>
            <div style={{ fontSize: 10, color: "var(--muted)" }}>مصاريف المكتب</div>
            <div style={{ fontSize: 14, fontWeight: 700, color: "#ef4444", direction: "ltr" }}>-{fmt(stats.allTime.totalExpenses)} EGP</div>
          </div>
          <div>
            <div style={{ fontSize: 10, color: "var(--muted)" }}>صرف للشركاء</div>
            <div style={{ fontSize: 14, fontWeight: 700, color: "#f59e0b", direction: "ltr" }}>-{fmt(stats.officeTreasury.partnerOutflows)} EGP</div>
          </div>
          {stats.officeTreasury.partnerInflows > 0 && (
            <div>
              <div style={{ fontSize: 10, color: "var(--muted)" }}>تسوية سلف</div>
              <div style={{ fontSize: 14, fontWeight: 700, color: "#10b981", direction: "ltr" }}>+{fmt(stats.officeTreasury.partnerInflows)} EGP</div>
            </div>
          )}
        </div>
      </div>

      {/* ═══ Top Stats ═══ */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 14, marginBottom: 24 }}>
        {[
          { label: "مصاريف هذا الشهر", sub: "Current Month Expenses", value: `${fmt(stats.currentMonth.totalExpenses)} EGP`, color: "#ef4444", bg: "rgba(239,68,68,0.06)" },
          { label: "إجمالي المصاريف", sub: "All Time Expenses", value: `${fmt(stats.allTime.totalExpenses)} EGP`, color: "#f59e0b", bg: "rgba(245,158,11,0.06)" },
          { label: "رأس المال", sub: "Total Capital", value: `${fmt(stats.allTime.totalCapital)} EGP`, color: "#10b981", bg: "rgba(16,185,129,0.06)" },
          { label: "عدد الشركاء", sub: "Partners", value: stats.partnerSummary.length, color: "#8b5cf6", bg: "rgba(139,92,246,0.06)" },
        ].map(s => (
          <div key={s.label} style={{ padding: "18px 20px", borderRadius: 12, background: s.bg, border: "1px solid var(--border)" }}>
            <div style={{ fontSize: 11, color: "var(--muted)", marginBottom: 2 }}>{s.label}</div>
            <div style={{ fontSize: 10, color: "var(--muted)", marginBottom: 6 }}>{s.sub}</div>
            <div style={{ fontSize: 22, fontWeight: 800, color: s.color, direction: "ltr" }}>{s.value}</div>
          </div>
        ))}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}>
        {/* ═══ Partner Balances ═══ */}
        <div style={{ borderRadius: 12, border: "1px solid var(--border)", overflow: "hidden" }}>
          <div style={{ padding: "14px 20px", background: "var(--surface)", borderBottom: "1px solid var(--border)" }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: "var(--text)" }}>أرصدة الشركاء</div>
            <div style={{ fontSize: 10, color: "var(--muted)", marginTop: 2 }}>صافي المستحق له/عليه شخصيًا — لا يمثل فلوسًا فعلية في الخزينة</div>
          </div>
          {stats.partnerSummary.length === 0 ? (
            <div style={{ textAlign: "center", padding: 32, color: "var(--muted)", fontSize: 13 }}>لا يوجد شركاء بعد</div>
          ) : stats.partnerSummary.map(p => (
            <div key={p.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 20px", borderBottom: "1px solid var(--border)" }}>
              <div>
                <div style={{ fontWeight: 700, fontSize: 13, color: "var(--text)" }}>{p.name}</div>
                <div style={{ fontSize: 11, color: "var(--muted)" }}>{p.txCount} حركة</div>
              </div>
              <div style={{ textAlign: "right" }}>
                <div style={{ fontWeight: 700, fontSize: 14, color: p.balance >= 0 ? "#10b981" : "#ef4444", direction: "ltr" }}>
                  {p.balance >= 0 ? "+" : ""}{fmt(p.balance)} EGP
                </div>
                {p.outstandingAdvances > 0 && (
                  <div style={{ fontSize: 10, color: "#f59e0b" }}>سلف مستحقة: {fmt(p.outstandingAdvances)} EGP</div>
                )}
              </div>
            </div>
          ))}
        </div>

        {/* ═══ Monthly Expense Chart ═══ */}
        <div style={{ borderRadius: 12, border: "1px solid var(--border)", overflow: "hidden" }}>
          <div style={{ padding: "14px 20px", background: "var(--surface)", borderBottom: "1px solid var(--border)", fontSize: 14, fontWeight: 700, color: "var(--text)" }}>
            مصروفات المكتب الشهرية
          </div>
          <div style={{ padding: 20 }}>
            {stats.monthlyBreakdown.map((m, i) => (
              <div key={i} style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 10 }}>
                <div style={{ width: 60, fontSize: 12, color: "var(--muted)", flexShrink: 0 }}>{MONTHS_AR[m.month - 1]?.slice(0, 3)} {m.year}</div>
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
