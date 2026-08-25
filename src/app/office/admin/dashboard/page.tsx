"use client";

import { useState, useEffect } from "react";

type PartnerSummary = { id: string; name: string; balance: number; outstandingAdvances: number; totalCapital: number; txCount: number };
type OfficeTreasury = { balance: number; cashCapital: number; profitTransfers: number; partnerOutflows: number; partnerInflows: number };
type RecentTx = { id: string; type: string; amount: number; date: string; note: string | null; partnerName: string; businessName: string | null };
type AdminStats = {
  currentMonth: { totalExpenses: number; expenseCount: number };
  prevMonth: { totalExpenses: number };
  expenseTrend: number;
  allTime: { totalExpenses: number; totalCapital: number; expenseCount: number };
  expenseBreakdown: { fixed: number; variable: number };
  capitalBreakdown: { cash: number; asset: number };
  officeTreasury: OfficeTreasury;
  partnerSummary: PartnerSummary[];
  monthlyBreakdown: { month: number; year: number; total: number }[];
  monthlyPartnerOutflows: { month: number; year: number; total: number }[];
  txByType: Record<string, number>;
  recentPartnerTx: RecentTx[];
};

const fmt = (n: number) => Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 });
const MONTHS_AR_SHORT = ["يناير","فبراير","مارس","أبريل","مايو","يونيو","يوليو","أغسطس","سبتمبر","أكتوبر","نوفمبر","ديسمبر"];
const TX_TYPE_AR: Record<string, string> = { SALARY: "راتب", PROFIT_SHARE: "نصيب أرباح", ADVANCE: "سلفة", WITHDRAWAL: "سحب", LOAN_SETTLEMENT: "تسوية سلفة" };
const TX_TYPE_COLOR: Record<string, string> = { SALARY: "#10b981", PROFIT_SHARE: "#3b82f6", ADVANCE: "#f59e0b", WITHDRAWAL: "#8b5cf6", LOAN_SETTLEMENT: "#ef4444" };

// SVG Icon components
function IconExpenses() { return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#ef4444" strokeWidth="2" strokeLinecap="round"><path d="M9 5H2v7l6.29 6.29c.94.94 2.48.94 3.42 0l3.58-3.58c.94-.94.94-2.48 0-3.42L9 5z"/><circle cx="6" cy="9" r="1" fill="#ef4444"/></svg>; }
function IconTreasury() { return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#10b981" strokeWidth="2" strokeLinecap="round"><rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 3v4M8 3v4M2 11h20"/></svg>; }
function IconCapital() { return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#3b82f6" strokeWidth="2" strokeLinecap="round"><circle cx="12" cy="12" r="10"/><path d="M12 6v12M8 10l4-4 4 4"/></svg>; }
function IconPartners() { return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#8b5cf6" strokeWidth="2" strokeLinecap="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>; }

// Donut chart component (pure CSS)
function DonutChart({ segments, size = 140, thickness = 18 }: { segments: { value: number; color: string; label: string }[]; size?: number; thickness?: number }) {
  const total = segments.reduce((s, seg) => s + seg.value, 0);
  if (total === 0) return <div style={{ width: size, height: size, borderRadius: "50%", background: "var(--surface-hover)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, color: "var(--muted)" }}>لا توجد بيانات</div>;

  let cumulative = 0;
  const gradientParts: string[] = [];
  for (const seg of segments) {
    const pct = (seg.value / total) * 100;
    gradientParts.push(`${seg.color} ${cumulative}% ${cumulative + pct}%`);
    cumulative += pct;
  }

  const innerSize = size - thickness * 2;
  return (
    <div style={{ position: "relative", width: size, height: size }}>
      <div style={{
        width: size, height: size, borderRadius: "50%",
        background: `conic-gradient(${gradientParts.join(", ")})`,
        display: "flex", alignItems: "center", justifyContent: "center",
      }}>
        <div style={{ width: innerSize, height: innerSize, borderRadius: "50%", background: "var(--bg)", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
          <div style={{ fontSize: 18, fontWeight: 800, color: "var(--text)", direction: "ltr" }}>{fmt(total)}</div>
          <div style={{ fontSize: 9, color: "var(--muted)" }}>EGP</div>
        </div>
      </div>
    </div>
  );
}

// SVG Progress circle
function ProgressCircle({ value, max, color, size = 48, label }: { value: number; max: number; color: string; size?: number; label?: string }) {
  const pct = max > 0 ? Math.min((value / max) * 100, 100) : 0;
  const r = (size - 6) / 2;
  const circumference = 2 * Math.PI * r;
  const offset = circumference - (pct / 100) * circumference;
  return (
    <div style={{ position: "relative", width: size, height: size }}>
      <svg width={size} height={size} style={{ transform: "rotate(-90deg)" }}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--surface-hover)" strokeWidth="4" />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth="4" strokeDasharray={circumference} strokeDashoffset={offset} strokeLinecap="round" style={{ transition: "stroke-dashoffset 0.8s ease" }} />
      </svg>
      {label && <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 10, fontWeight: 700, color }}>{label}</div>}
    </div>
  );
}

export default function AdminDashboardPage() {
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/office/admin-stats").then(r => r.json()).then(d => { setStats(d); setLoading(false); }).catch(() => setLoading(false));
  }, []);

  if (loading) return <div style={{ textAlign: "center", padding: 48, color: "var(--muted)" }}>جاري التحميل...</div>;
  if (!stats) return <div style={{ textAlign: "center", padding: 48, color: "var(--muted)" }}>فشل في تحميل البيانات</div>;

  const maxMonthly = Math.max(...stats.monthlyBreakdown.map(m => m.total), 1);
  const maxPartnerOutflow = Math.max(...stats.monthlyPartnerOutflows.map(m => m.total), 1);

  // Treasury donut segments
  const treasurySegments = [
    { value: stats.officeTreasury.cashCapital, color: "#3b82f6", label: "التمويل النقدي" },
    { value: stats.officeTreasury.profitTransfers, color: "#0d9488", label: "تحويلات الأرباح" },
    { value: stats.officeTreasury.partnerInflows, color: "#10b981", label: "تسوية سلف" },
  ].filter(s => s.value > 0);

  const treasuryOutSegments = [
    { value: stats.allTime.totalExpenses, color: "#ef4444", label: "مصاريف المكتب" },
    { value: stats.officeTreasury.partnerOutflows, color: "#f59e0b", label: "صرف للشركاء" },
  ].filter(s => s.value > 0);

  // Partner balance donut
  const partnerBalanceSegments = stats.partnerSummary.map((p, i) => ({
    value: Math.abs(p.balance),
    color: ["#8b5cf6", "#3b82f6", "#0d9488", "#f59e0b"][i % 4],
    label: p.name,
  })).filter(s => s.value > 0);

  return (
    <div style={{ maxWidth: 1400, margin: "0 auto" }}>
      {/* ═══ Header ═══ */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24 }}>
        <div>
          <h1 style={{ fontSize: 24, fontWeight: 800, color: "var(--text)", margin: 0 }}>لوحة تحكم المكتب</h1>
          <p style={{ fontSize: 13, color: "var(--muted)", margin: "4px 0 0" }}>نظرة تحليلية شاملة على أداء المكتب والشركاء</p>
        </div>
        <div style={{ padding: "8px 16px", borderRadius: 8, background: "var(--surface)", border: "1px solid var(--border)", fontSize: 12, color: "var(--muted)" }}>
          {new Date().toLocaleDateString("ar-EG", { weekday: "long", year: "numeric", month: "long", day: "numeric" })}
        </div>
      </div>

      {/* ═══ Stat Cards Row ═══ */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 14, marginBottom: 20 }}>
        {/* Treasury Balance */}
        <div style={{ padding: "20px", borderRadius: 14, background: "var(--surface)", border: "1px solid var(--border)", position: "relative", overflow: "hidden" }}>
          <div style={{ position: "absolute", top: 16, right: 16, width: 40, height: 40, borderRadius: 10, background: "rgba(16,185,129,0.1)", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <IconTreasury />
          </div>
          <div style={{ fontSize: 11, color: "var(--muted)", marginBottom: 8 }}>الرصيد المتاح بالخزينة</div>
          <div style={{ fontSize: 26, fontWeight: 800, color: stats.officeTreasury.balance >= 0 ? "#10b981" : "#ef4444", direction: "ltr", lineHeight: 1 }}>
            {stats.officeTreasury.balance >= 0 ? "+" : "-"}{fmt(stats.officeTreasury.balance)}
          </div>
          <div style={{ fontSize: 10, color: "var(--muted)", marginTop: 2 }}>EGP — Available Balance</div>
          <div style={{ marginTop: 10, display: "flex", gap: 12 }}>
            <div style={{ fontSize: 10, color: "#3b82f6" }}>转入: {fmt(stats.officeTreasury.cashCapital + stats.officeTreasury.profitTransfers)}</div>
            <div style={{ fontSize: 10, color: "#ef4444" }}>支出: {fmt(stats.allTime.totalExpenses + stats.officeTreasury.partnerOutflows)}</div>
          </div>
        </div>

        {/* Monthly Expenses */}
        <div style={{ padding: "20px", borderRadius: 14, background: "var(--surface)", border: "1px solid var(--border)", position: "relative", overflow: "hidden" }}>
          <div style={{ position: "absolute", top: 16, right: 16, width: 40, height: 40, borderRadius: 10, background: "rgba(239,68,68,0.1)", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <IconExpenses />
          </div>
          <div style={{ fontSize: 11, color: "var(--muted)", marginBottom: 8 }}>مصاريف هذا الشهر</div>
          <div style={{ fontSize: 26, fontWeight: 800, color: "#ef4444", direction: "ltr", lineHeight: 1 }}>
            {fmt(stats.currentMonth.totalExpenses)}
          </div>
          <div style={{ fontSize: 10, color: "var(--muted)", marginTop: 2 }}>EGP — {stats.currentMonth.expenseCount} مصروف</div>
          <div style={{ marginTop: 10, display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ fontSize: 11, fontWeight: 600, color: stats.expenseTrend > 0 ? "#ef4444" : "#10b981" }}>
              {stats.expenseTrend > 0 ? "▲" : "▼"} {Math.abs(stats.expenseTrend)}%
            </span>
            <span style={{ fontSize: 10, color: "var(--muted)" }}>من الشهر السابق</span>
          </div>
        </div>

        {/* Total Capital */}
        <div style={{ padding: "20px", borderRadius: 14, background: "var(--surface)", border: "1px solid var(--border)", position: "relative", overflow: "hidden" }}>
          <div style={{ position: "absolute", top: 16, right: 16, width: 40, height: 40, borderRadius: 10, background: "rgba(59,130,246,0.1)", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <IconCapital />
          </div>
          <div style={{ fontSize: 11, color: "var(--muted)", marginBottom: 8 }}>رأس المال الكلي</div>
          <div style={{ fontSize: 26, fontWeight: 800, color: "#3b82f6", direction: "ltr", lineHeight: 1 }}>
            {fmt(stats.allTime.totalCapital)}
          </div>
          <div style={{ fontSize: 10, color: "var(--muted)", marginTop: 2 }}>EGP — Total Capital</div>
          <div style={{ marginTop: 10, display: "flex", gap: 12 }}>
            <div style={{ fontSize: 10, color: "#3b82f6" }}>💵 نقدي: {fmt(stats.capitalBreakdown.cash)}</div>
            <div style={{ fontSize: 10, color: "#8b5cf6" }}>📦 عقار: {fmt(stats.capitalBreakdown.asset)}</div>
          </div>
        </div>

        {/* Partners Count */}
        <div style={{ padding: "20px", borderRadius: 14, background: "var(--surface)", border: "1px solid var(--border)", position: "relative", overflow: "hidden" }}>
          <div style={{ position: "absolute", top: 16, right: 16, width: 40, height: 40, borderRadius: 10, background: "rgba(139,92,246,0.1)", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <IconPartners />
          </div>
          <div style={{ fontSize: 11, color: "var(--muted)", marginBottom: 8 }}>عدد الشركاء</div>
          <div style={{ fontSize: 26, fontWeight: 800, color: "#8b5cf6", lineHeight: 1 }}>
            {stats.partnerSummary.length}
          </div>
          <div style={{ fontSize: 10, color: "var(--muted)", marginTop: 2 }}>Partners — {stats.partnerSummary.reduce((s, p) => s + p.txCount, 0)} حركة</div>
          <div style={{ marginTop: 10, fontSize: 10, color: "#f59e0b" }}>
            سلف معلقة: {fmt(stats.partnerSummary.reduce((s, p) => s + p.outstandingAdvances, 0))} EGP
          </div>
        </div>
      </div>

      {/* ═══ Charts Row ═══ */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 14, marginBottom: 20 }}>
        {/* Donut: Treasury Breakdown */}
        <div style={{ padding: "20px", borderRadius: 14, background: "var(--surface)", border: "1px solid var(--border)" }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: "var(--text)", marginBottom: 16 }}>مُكوّنات الخزينة</div>
          <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
            <DonutChart segments={treasurySegments.length > 0 ? treasurySegments : [{ value: 1, color: "var(--surface-hover)", label: "فارغ" }]} size={120} thickness={16} />
            <div style={{ flex: 1 }}>
              {treasurySegments.map(seg => (
                <div key={seg.label} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                  <div style={{ width: 10, height: 10, borderRadius: 3, background: seg.color, flexShrink: 0 }} />
                  <div style={{ flex: 1, fontSize: 11, color: "var(--muted)" }}>{seg.label}</div>
                  <div style={{ fontSize: 12, fontWeight: 700, color: "var(--text)", direction: "ltr" }}>{fmt(seg.value)}</div>
                </div>
              ))}
              {treasuryOutSegments.map(seg => (
                <div key={seg.label} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                  <div style={{ width: 10, height: 10, borderRadius: 3, background: seg.color, flexShrink: 0 }} />
                  <div style={{ flex: 1, fontSize: 11, color: "var(--muted)" }}>{seg.label}</div>
                  <div style={{ fontSize: 12, fontWeight: 700, color: seg.color, direction: "ltr" }}>-{fmt(seg.value)}</div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Donut: Partner Balances */}
        <div style={{ padding: "20px", borderRadius: 14, background: "var(--surface)", border: "1px solid var(--border)" }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: "var(--text)", marginBottom: 4 }}>توزيع أرصدة الشركاء</div>
          <div style={{ fontSize: 10, color: "var(--muted)", marginBottom: 12 }}>صافي المستحق لكل شريك</div>
          <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
            <DonutChart segments={partnerBalanceSegments.length > 0 ? partnerBalanceSegments : [{ value: 1, color: "var(--surface-hover)", label: "فارغ" }]} size={120} thickness={16} />
            <div style={{ flex: 1 }}>
              {stats.partnerSummary.map((p, i) => (
                <div key={p.id} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                  <div style={{ width: 10, height: 10, borderRadius: 3, background: ["#8b5cf6", "#3b82f6", "#0d9488", "#f59e0b"][i % 4], flexShrink: 0 }} />
                  <div style={{ flex: 1, fontSize: 11, color: "var(--muted)" }}>{p.name}</div>
                  <div style={{ fontSize: 12, fontWeight: 700, color: p.balance >= 0 ? "#10b981" : "#ef4444", direction: "ltr" }}>
                    {p.balance >= 0 ? "+" : ""}{fmt(p.balance)}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Donut: Transaction Types */}
        <div style={{ padding: "20px", borderRadius: 14, background: "var(--surface)", border: "1px solid var(--border)" }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: "var(--text)", marginBottom: 4 }}>توزيع حركات الشركاء</div>
          <div style={{ fontSize: 10, color: "var(--muted)", marginBottom: 12 }}>حسب النوع — إجمالي القيم</div>
          <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
            <DonutChart
              segments={Object.entries(stats.txByType).map(([type, amount]) => ({ value: amount, color: TX_TYPE_COLOR[type] || "#6b7280", label: TX_TYPE_AR[type] || type })).filter(s => s.value > 0)}
              size={120} thickness={16}
            />
            <div style={{ flex: 1 }}>
              {Object.entries(stats.txByType).map(([type, amount]) => (
                <div key={type} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                  <div style={{ width: 10, height: 10, borderRadius: 3, background: TX_TYPE_COLOR[type] || "#6b7280", flexShrink: 0 }} />
                  <div style={{ flex: 1, fontSize: 11, color: "var(--muted)" }}>{TX_TYPE_AR[type] || type}</div>
                  <div style={{ fontSize: 12, fontWeight: 700, color: "var(--text)", direction: "ltr" }}>{fmt(amount)}</div>
                </div>
              ))}
              {Object.keys(stats.txByType).length === 0 && (
                <div style={{ fontSize: 11, color: "var(--muted)" }}>لا توجد حركات بعد</div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* ═══ Bar Charts + Table Row ═══ */}
      <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 14, marginBottom: 20 }}>
        {/* Monthly Bar Chart */}
        <div style={{ padding: "20px", borderRadius: 14, background: "var(--surface)", border: "1px solid var(--border)" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
            <div>
              <div style={{ fontSize: 13, fontWeight: 700, color: "var(--text)" }}>المصروفات الشهرية</div>
              <div style={{ fontSize: 10, color: "var(--muted)" }}>آخر 12 شهر — Monthly Expenses</div>
            </div>
            <div style={{ display: "flex", gap: 12, fontSize: 10 }}>
              <span style={{ display: "flex", alignItems: "center", gap: 4 }}><span style={{ width: 8, height: 8, borderRadius: 2, background: "#ef4444" }} />مصروفات</span>
              <span style={{ display: "flex", alignItems: "center", gap: 4 }}><span style={{ width: 8, height: 8, borderRadius: 2, background: "#f59e0b" }} />صرف شركاء</span>
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "flex-end", gap: 6, height: 180, paddingBottom: 24, borderBottom: "1px solid var(--border)", position: "relative" }}>
            {stats.monthlyBreakdown.slice().reverse().map((m, i) => {
              const partnerOut = stats.monthlyPartnerOutflows.find(po => po.month === m.month && po.year === m.year)?.total || 0;
              const barH = maxMonthly > 0 ? (m.total / maxMonthly) * 140 : 0;
              const partnerH = maxPartnerOutflow > 0 ? (partnerOut / maxPartnerOutflow) * 140 : 0;
              return (
                <div key={i} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 2 }}>
                  <div style={{ display: "flex", alignItems: "flex-end", gap: 2, height: 150 }}>
                    <div style={{ width: "45%", height: barH, borderRadius: "4px 4px 0 0", background: m.total > 0 ? "linear-gradient(180deg, #ef4444, #dc2626)" : "transparent", transition: "height 0.5s ease", position: "relative", minHeight: m.total > 0 ? 4 : 0 }}>
                      {m.total > 0 && <div style={{ position: "absolute", top: -16, left: "50%", transform: "translateX(-50%)", fontSize: 8, color: "var(--muted)", whiteSpace: "nowrap", direction: "ltr" }}>{fmt(m.total)}</div>}
                    </div>
                    <div style={{ width: "45%", height: partnerH, borderRadius: "4px 4px 0 0", background: partnerOut > 0 ? "linear-gradient(180deg, #f59e0b, #d97706)" : "transparent", transition: "height 0.5s ease", minHeight: partnerOut > 0 ? 4 : 0 }} />
                  </div>
                  <div style={{ fontSize: 9, color: "var(--muted)", whiteSpace: "nowrap" }}>{MONTHS_AR_SHORT[m.month - 1]?.slice(0, 3)}</div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Recent Transactions */}
        <div style={{ padding: "20px", borderRadius: 14, background: "var(--surface)", border: "1px solid var(--border)" }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: "var(--text)", marginBottom: 4 }}>آخر الحركات</div>
          <div style={{ fontSize: 10, color: "var(--muted)", marginBottom: 12 }}>Recent Partner Transactions</div>
          {stats.recentPartnerTx.length === 0 ? (
            <div style={{ textAlign: "center", padding: 32, color: "var(--muted)", fontSize: 12 }}>لا توجد حركات بعد</div>
          ) : stats.recentPartnerTx.map(tx => (
            <div key={tx.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 0", borderBottom: "1px solid var(--border)" }}>
              <div style={{ width: 32, height: 32, borderRadius: 8, background: `${TX_TYPE_COLOR[tx.type] || "#6b7280"}20`, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                <div style={{ width: 8, height: 8, borderRadius: "50%", background: TX_TYPE_COLOR[tx.type] || "#6b7280" }} />
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{tx.partnerName}</div>
                <div style={{ fontSize: 10, color: "var(--muted)" }}>{TX_TYPE_AR[tx.type] || tx.type}</div>
              </div>
              <div style={{ textAlign: "right" }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: ["SALARY", "PROFIT_SHARE", "LOAN_SETTLEMENT"].includes(tx.type) ? "#10b981" : "#ef4444", direction: "ltr" }}>
                  {["SALARY", "PROFIT_SHARE", "LOAN_SETTLEMENT"].includes(tx.type) ? "+" : "-"}{fmt(tx.amount)}
                </div>
                <div style={{ fontSize: 9, color: "var(--muted)" }}>{new Date(tx.date).toLocaleDateString("ar-EG", { day: "2-digit", month: "short" })}</div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* ═══ Expense Breakdown + Partner Summary ═══ */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
        {/* Expense Category Breakdown */}
        <div style={{ padding: "20px", borderRadius: 14, background: "var(--surface)", border: "1px solid var(--border)" }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: "var(--text)", marginBottom: 16 }}>تصنيف المصاريف</div>
          <div style={{ display: "flex", gap: 16 }}>
            {/* Fixed */}
            <div style={{ flex: 1, padding: 16, borderRadius: 12, background: "rgba(245,158,11,0.06)", border: "1px solid rgba(245,158,11,0.15)" }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
                <div>
                  <div style={{ fontSize: 11, color: "var(--muted)" }}>مصاريف ثابتة</div>
                  <div style={{ fontSize: 10, color: "var(--muted)" }}>Fixed Expenses</div>
                </div>
                <ProgressCircle value={stats.expenseBreakdown.fixed} max={stats.allTime.totalExpenses || 1} color="#f59e0b" label={stats.allTime.totalExpenses > 0 ? `${Math.round(stats.expenseBreakdown.fixed / stats.allTime.totalExpenses * 100)}%` : "0%"} />
              </div>
              <div style={{ fontSize: 20, fontWeight: 800, color: "#f59e0b", direction: "ltr" }}>{fmt(stats.expenseBreakdown.fixed)} EGP</div>
            </div>
            {/* Variable */}
            <div style={{ flex: 1, padding: 16, borderRadius: 12, background: "rgba(59,130,246,0.06)", border: "1px solid rgba(59,130,246,0.15)" }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
                <div>
                  <div style={{ fontSize: 11, color: "var(--muted)" }}>مصاريف متغيرة</div>
                  <div style={{ fontSize: 10, color: "var(--muted)" }}>Variable Expenses</div>
                </div>
                <ProgressCircle value={stats.expenseBreakdown.variable} max={stats.allTime.totalExpenses || 1} color="#3b82f6" label={stats.allTime.totalExpenses > 0 ? `${Math.round(stats.expenseBreakdown.variable / stats.allTime.totalExpenses * 100)}%` : "0%"} />
              </div>
              <div style={{ fontSize: 20, fontWeight: 800, color: "#3b82f6", direction: "ltr" }}>{fmt(stats.expenseBreakdown.variable)} EGP</div>
            </div>
          </div>
        </div>

        {/* Partner Summary Table */}
        <div style={{ padding: "20px", borderRadius: 14, background: "var(--surface)", border: "1px solid var(--border)" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
            <div>
              <div style={{ fontSize: 13, fontWeight: 700, color: "var(--text)" }}>ملخص الشركاء</div>
              <div style={{ fontSize: 10, color: "var(--muted)" }}>Partner Balances</div>
            </div>
          </div>
          {/* Table header */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 80px 80px 80px", padding: "6px 0", borderBottom: "1px solid var(--border)", fontSize: 10, fontWeight: 600, color: "var(--muted)", textTransform: "uppercase" }}>
            <div>الشريك</div><div style={{ textAlign: "right" }}>الرصيد</div><div style={{ textAlign: "right" }}>السلف</div><div style={{ textAlign: "right" }}>الحركات</div>
          </div>
          {stats.partnerSummary.map(p => (
            <div key={p.id} style={{ display: "grid", gridTemplateColumns: "1fr 80px 80px 80px", padding: "10px 0", borderBottom: "1px solid var(--border)", fontSize: 12, alignItems: "center" }}
              onMouseEnter={e => (e.currentTarget.style.background = "var(--surface-hover)")} onMouseLeave={e => (e.currentTarget.style.background = "transparent")}>
              <div style={{ fontWeight: 600, color: "var(--text)" }}>{p.name}</div>
              <div style={{ textAlign: "right", fontWeight: 700, color: p.balance >= 0 ? "#10b981" : "#ef4444", direction: "ltr" }}>
                {p.balance >= 0 ? "+" : ""}{fmt(p.balance)}
              </div>
              <div style={{ textAlign: "right", fontSize: 11, color: p.outstandingAdvances > 0 ? "#f59e0b" : "var(--muted)", direction: "ltr" }}>
                {p.outstandingAdvances > 0 ? fmt(p.outstandingAdvances) : "—"}
              </div>
              <div style={{ textAlign: "right", fontSize: 11, color: "var(--muted)" }}>{p.txCount}</div>
            </div>
          ))}
          {stats.partnerSummary.length === 0 && (
            <div style={{ textAlign: "center", padding: 24, color: "var(--muted)", fontSize: 12 }}>لا يوجد شركاء بعد</div>
          )}
        </div>
      </div>
    </div>
  );
}
