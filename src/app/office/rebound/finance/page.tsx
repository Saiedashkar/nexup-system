"use client";

import { useState, useEffect, useMemo } from "react";

type Expense = { id: string; description: string; cost: number; category: "FIXED" | "VARIABLE"; name: string; notes: string | null; date: string; month: number; year: number };
type DashboardData = { poolBalance: number; mrr: number; reboundBalance: number; totalExpenses: number; totalTransferred: number; totalRevenue: number; totalCollected: number; monthlyRevenue: { month: string; revenue: number; projects: number }[] };

const fmt = (n: number) => n.toLocaleString("en-US");
const monthName = (m: number) => ["يناير", "فبراير", "مارس", "أبريل", "مايو", "يونيو", "يوليو", "أغسطس", "سبتمبر", "أكتوبر", "نوفمبر", "ديسمبر"][m - 1] || "";
const CAT_MAP: Record<string, { l: string; c: string; bg: string }> = {
  FIXED: { l: "ثابتة", c: "#f59e0b", bg: "rgba(245,158,11,0.12)" },
  VARIABLE: { l: "متغيرة", c: "#3b82f6", bg: "rgba(59,130,246,0.12)" },
};

export default function ReboundFinancePage() {
  const [tab, setTab] = useState<"income" | "expenses" | "summary">("income");
  const [dashboardData, setDashboardData] = useState<DashboardData | null>(null);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      fetch("/api/rebound/dashboard").then(r => r.json()),
      fetch("/api/expenses").then(r => r.json()).catch(() => []),
    ]).then(([d, e]) => {
      setDashboardData(d);
      setExpenses(Array.isArray(e) ? e.filter((ex: Expense) => true) : []); // all expenses
    }).finally(() => setLoading(false));
  }, []);

  // Monthly breakdown
  const monthlyBreakdown = useMemo(() => {
    if (!dashboardData) return [];
    const months = new Map<string, { income: number; expenses: number }>();
    for (const m of dashboardData.monthlyRevenue) {
      if (!months.has(m.month)) months.set(m.month, { income: 0, expenses: 0 });
      months.get(m.month)!.income = m.revenue;
    }
    for (const e of expenses) {
      const key = new Date(e.date).toLocaleDateString("en-US", { month: "short", year: "numeric" });
      if (!months.has(key)) months.set(key, { income: 0, expenses: 0 });
      months.get(key)!.expenses += e.cost;
    }
    return Array.from(months.entries()).reverse().map(([month, data]) => ({
      month, ...data, profit: data.income - data.expenses,
    }));
  }, [dashboardData, expenses]);

  if (loading) return <div style={{ textAlign: "center", padding: 40, color: "var(--muted)" }}>جاري التحميل...</div>;

  return (
    <div>
      {/* Page Header */}
      <div style={{ marginBottom: 20 }}>
        <h1 style={{ fontSize: 22, fontWeight: 800, color: "var(--text)", margin: 0 }}>الحسابات</h1>
        <p style={{ fontSize: 12, color: "var(--muted)", margin: "4px 0 0" }}>REBOUND Finance — كل شيء بالجنيه المصري</p>
      </div>

      {/* Balance Bar */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 14, marginBottom: 24 }}>
        {[
          { labelAr: "الرصيد المتاح", labelEn: "Available Balance", value: dashboardData?.poolBalance || 0, color: "#3b82f6", bg: "rgba(59,130,246,0.1)", border: "rgba(59,130,246,0.2)" },
          { labelAr: "إجمالي المصروفات", labelEn: "Total Expenses", value: dashboardData?.totalExpenses || 0, color: "#ef4444", bg: "rgba(239,68,68,0.1)", border: "rgba(239,68,68,0.2)" },
          { labelAr: "صافي الربح", labelEn: "Net Profit", value: (dashboardData?.poolBalance || 0), color: "#10b981", bg: "rgba(16,185,129,0.1)", border: "rgba(16,185,129,0.2)" },
        ].map(s => (
          <div key={s.labelEn} style={{ padding: "16px 20px", borderRadius: 12, background: s.bg, border: `1px solid ${s.border}`, textAlign: "center" }}>
            <div style={{ fontSize: 11, color: "var(--muted)", fontWeight: 600 }}>{s.labelAr}</div>
            <div style={{ fontSize: 10, color: "var(--muted)", opacity: 0.6 }}>{s.labelEn}</div>
            <div style={{ fontSize: 24, fontWeight: 800, color: s.color, marginTop: 6, direction: "ltr" }}>
              {fmt(s.value)} <span style={{ fontSize: 12, fontWeight: 600 }}>EGP</span>
            </div>
          </div>
        ))}
      </div>

      {/* Tabs */}
      <div style={{ display: "flex", gap: 0, marginBottom: 20, borderBottom: "2px solid var(--border)" }}>
        {[
          { key: "income" as const, label: "💰 الدخل", labelEn: "Income" },
          { key: "expenses" as const, label: "🧾 المصروفات", labelEn: "Expenses" },
          { key: "summary" as const, label: "📊 الملخص الشهري", labelEn: "Monthly Summary" },
        ].map(t => (
          <button key={t.key} onClick={() => setTab(t.key)} style={{
            padding: "10px 20px", borderRadius: "8px 8px 0 0", border: "none", cursor: "pointer",
            background: tab === t.key ? "rgba(59,130,246,0.12)" : "transparent",
            color: tab === t.key ? "#3b82f6" : "var(--muted)",
            fontWeight: tab === t.key ? 700 : 500, fontSize: 13,
            borderBottom: tab === t.key ? "2px solid #3b82f6" : "2px solid transparent",
            marginBottom: -2,
          }}>
            {t.label} <span style={{ fontSize: 10, opacity: 0.6, marginInlineStart: 4 }}>{t.labelEn}</span>
          </button>
        ))}
      </div>

      {/* Tab Content */}
      {tab === "income" && (
        <div>
          <div style={{ padding: "20px", borderRadius: 12, background: "var(--surface)", border: "1px solid var(--border)" }}>
            <h3 style={{ fontSize: 14, fontWeight: 700, color: "var(--text)", marginBottom: 16 }}>الدخل — Income Records</h3>
            <p style={{ fontSize: 12, color: "var(--muted)", marginBottom: 16 }}>كل دفعة من العملاء (مشاريع لمرة واحدة + اشتراكات شهرية) تُسجَّل تلقائيًا هنا</p>
            {dashboardData && (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12 }}>
                <div style={{ padding: "16px", borderRadius: 10, background: "var(--surface-hover)", textAlign: "center" }}>
                  <div style={{ fontSize: 22, fontWeight: 800, color: "#3b82f6" }}>{fmt(dashboardData.totalCollected)}</div>
                  <div style={{ fontSize: 11, color: "var(--muted)" }}>إجمالي المحصّل (EGP)</div>
                </div>
                <div style={{ padding: "16px", borderRadius: 10, background: "var(--surface-hover)", textAlign: "center" }}>
                  <div style={{ fontSize: 22, fontWeight: 800, color: "#10b981" }}>{fmt(dashboardData.mrr)}</div>
                  <div style={{ fontSize: 11, color: "var(--muted)" }}>الدخل الشهري المتكرر (MRR)</div>
                </div>
                <div style={{ padding: "16px", borderRadius: 10, background: "var(--surface-hover)", textAlign: "center" }}>
                  <div style={{ fontSize: 22, fontWeight: 800, color: "#8b5cf6" }}>{fmt(dashboardData.totalRevenue)}</div>
                  <div style={{ fontSize: 11, color: "var(--muted)" }}>إجمالي الإيرادات (EGP)</div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {tab === "expenses" && (
        <div>
          <div style={{ padding: "20px", borderRadius: 12, background: "var(--surface)", border: "1px solid var(--border)" }}>
            <h3 style={{ fontSize: 14, fontWeight: 700, color: "var(--text)", marginBottom: 16 }}>مصاريف REBOUND — Expenses</h3>
            {expenses.length === 0 ? (
              <p style={{ textAlign: "center", color: "var(--muted)", padding: 20 }}>لا توجد مصاريف مسجلة</p>
            ) : (
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                  <thead>
                    <tr>
                      {["التاريخ", "الوصف", "الشخص/الجهة", "التصنيف", "المبلغ", "ملاحظات"].map((h, i) => (
                        <th key={i} style={{ padding: "8px 10px", textAlign: "right", borderBottom: "2px solid var(--border)", fontSize: 10, fontWeight: 700, color: "var(--text)" }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {expenses.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()).map(e => {
                      const cat = CAT_MAP[e.category] || CAT_MAP.FIXED;
                      return (
                        <tr key={e.id} style={{ borderBottom: "1px solid var(--border)" }}>
                          <td style={{ padding: "6px 10px", color: "var(--muted)", fontSize: 11 }}>{new Date(e.date).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })}</td>
                          <td style={{ padding: "6px 10px", fontWeight: 600 }}>{e.description}</td>
                          <td style={{ padding: "6px 10px", color: "var(--text-secondary)" }}>{e.name}</td>
                          <td style={{ padding: "6px 10px" }}><span style={{ padding: "2px 6px", borderRadius: 4, background: cat.bg, color: cat.c, fontSize: 10, fontWeight: 600 }}>{cat.l}</span></td>
                          <td style={{ padding: "6px 10px", fontWeight: 700, color: "#ef4444", direction: "ltr" }}>{fmt(e.cost)} EGP</td>
                          <td style={{ padding: "6px 10px", color: "var(--muted)", fontSize: 11 }}>{e.notes || "—"}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {tab === "summary" && (
        <div>
          <div style={{ padding: "20px", borderRadius: 12, background: "var(--surface)", border: "1px solid var(--border)" }}>
            <h3 style={{ fontSize: 14, fontWeight: 700, color: "var(--text)", marginBottom: 16 }}>الملخص الشهري — Monthly Summary</h3>
            {monthlyBreakdown.length === 0 ? (
              <p style={{ textAlign: "center", color: "var(--muted)", padding: 20 }}>لا توجد بيانات كافية</p>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                {monthlyBreakdown.map((m, i) => (
                  <div key={i} style={{ padding: "16px 20px", borderRadius: 12, background: "var(--surface-hover)", borderLeft: `4px solid ${m.profit >= 0 ? "#10b981" : "#ef4444"}` }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: 10 }}>
                      <span style={{ fontSize: 15, fontWeight: 800, color: "var(--text)" }}>{m.month}</span>
                      <span style={{ padding: "2px 8px", borderRadius: 10, background: m.profit >= 0 ? "rgba(16,185,129,0.12)" : "rgba(239,68,68,0.12)", color: m.profit >= 0 ? "#10b981" : "#ef4444", fontSize: 11, fontWeight: 700 }}>
                        {m.profit >= 0 ? "+" : ""}{fmt(m.profit)} EGP
                      </span>
                    </div>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
                      <div style={{ textAlign: "center", padding: "8px 12px", borderRadius: 8, background: "rgba(59,130,246,0.08)" }}>
                        <div style={{ fontSize: 16, fontWeight: 800, color: "#3b82f6" }}>{fmt(m.income)}</div>
                        <div style={{ fontSize: 10, color: "var(--muted)" }}>الدخل</div>
                      </div>
                      <div style={{ textAlign: "center", padding: "8px 12px", borderRadius: 8, background: "rgba(239,68,68,0.08)" }}>
                        <div style={{ fontSize: 16, fontWeight: 800, color: "#ef4444" }}>{fmt(m.expenses)}</div>
                        <div style={{ fontSize: 10, color: "var(--muted)" }}>المصروفات</div>
                      </div>
                      <div style={{ textAlign: "center", padding: "8px 12px", borderRadius: 8, background: m.profit >= 0 ? "rgba(16,185,129,0.08)" : "rgba(239,68,68,0.08)" }}>
                        <div style={{ fontSize: 16, fontWeight: 800, color: m.profit >= 0 ? "#10b981" : "#ef4444" }}>{fmt(m.profit)}</div>
                        <div style={{ fontSize: 10, color: "var(--muted)" }}>صافي الربح</div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
