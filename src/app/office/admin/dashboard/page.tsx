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

// Professional Donut chart component
function DonutChart({ segments, size = 160, thickness = 20 }: { segments: { value: number; color: string; label: string }[]; size?: number; thickness?: number }) {
  const total = segments.reduce((s, seg) => s + seg.value, 0);
  if (total === 0) return (
    <div style={{ width: size, height: size, borderRadius: "50%", background: "var(--surface-hover)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, color: "var(--muted)" }}>
      لا توجد بيانات
    </div>
  );

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
        boxShadow: "0 4px 20px rgba(0,0,0,0.3)",
      }}>
        <div style={{
          width: innerSize, height: innerSize, borderRadius: "50%",
          background: "var(--surface)",
          display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
          border: "2px solid var(--border)",
        }}>
          <div style={{ fontSize: 22, fontWeight: 800, color: "var(--text)", direction: "ltr" }}>{fmt(total)}</div>
          <div style={{ fontSize: 10, color: "var(--muted)", fontWeight: 500 }}>EGP</div>
        </div>
      </div>
    </div>
  );
}

// Professional Progress circle
function ProgressCircle({ value, max, color, size = 52, label }: { value: number; max: number; color: string; size?: number; label?: string }) {
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
      {label && <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, fontWeight: 700, color }}>{label}</div>}
    </div>
  );
}

// Mini sparkline for stat cards
function MiniSparkline({ data, color, width = 80, height = 32 }: { data: number[]; color: string; width?: number; height?: number }) {
  if (data.length < 2) return null;
  const max = Math.max(...data, 1);
  const points = data.map((v, i) => `${(i / (data.length - 1)) * width},${height - (v / max) * (height - 4)}`).join(" ");
  return (
    <svg width={width} height={height} style={{ opacity: 0.6 }}>
      <defs>
        <linearGradient id={`grad-${color.replace("#", "")}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.3" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <polygon
        points={`0,${height} ${points} ${width},${height}`}
        fill={`url(#grad-${color.replace("#", "")})`}
      />
      <polyline
        points={points}
        fill="none"
        stroke={color}
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export default function AdminDashboardPage() {
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/office/admin-stats").then(r => r.json()).then(d => { setStats(d); setLoading(false); }).catch(() => setLoading(false));
  }, []);

  if (loading) return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "60vh", flexDirection: "column", gap: 16 }}>
      <div style={{ width: 40, height: 40, border: "3px solid var(--border)", borderTopColor: "var(--brand)", borderRadius: "50%", animation: "spin 0.8s linear infinite" }} />
      <div style={{ color: "var(--muted)", fontSize: 14 }}>جاري تحميل البيانات...</div>
      <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
    </div>
  );
  if (!stats) return <div style={{ textAlign: "center", padding: 48, color: "var(--muted)" }}>فشل في تحميل البيانات</div>;

  const monthlyBreakdown = stats.monthlyBreakdown || [];
  const monthlyPartnerOutflows = stats.monthlyPartnerOutflows || [];
  const partnerSummary = stats.partnerSummary || [];
  const txByType = stats.txByType || {};
  const officeTreasury = stats.officeTreasury || { balance: 0, cashCapital: 0, profitTransfers: 0, partnerOutflows: 0, partnerInflows: 0 };
  const allTimeStats = stats.allTime || { totalExpenses: 0, totalCapital: 0, expenseCount: 0 };
  const expenseBreakdownStats = stats.expenseBreakdown || { fixed: 0, variable: 0 };
  const recentPartnerTx = stats.recentPartnerTx || [];
  const maxMonthly = monthlyBreakdown.length > 0 ? Math.max(...monthlyBreakdown.map(m => m.total), 1) : 1;

  // Treasury donut segments
  const treasuryInSegments = [
    { value: officeTreasury.cashCapital, color: "#3b82f6", label: "التمويل النقدي" },
    { value: officeTreasury.profitTransfers, color: "#0d9488", label: "تحويلات الأرباح" },
    { value: officeTreasury.partnerInflows, color: "#10b981", label: "تسوية سلف" },
  ].filter(s => s.value > 0);

  const treasuryOutSegments = [
    { value: allTimeStats.totalExpenses, color: "#ef4444", label: "مصاريف المكتب" },
    { value: officeTreasury.partnerOutflows, color: "#f59e0b", label: "صرف للشركاء" },
  ].filter(s => s.value > 0);

  // Partner balance donut
  const partnerBalanceSegments = partnerSummary.map((p, i) => ({
    value: Math.abs(p.balance),
    color: ["#8b5cf6", "#3b82f6", "#0d9488", "#f59e0b"][i % 4],
    label: p.name,
  })).filter(s => s.value > 0);

  // Sparkline data from monthly breakdown
  const expenseSparkline = monthlyBreakdown.slice(-6).map(m => m.total);

  return (
    <div style={{ maxWidth: 1440, margin: "0 auto", direction: "rtl" }}>
      {/* ═══ Header ═══ */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 32 }}>
        <div>
          <h1 style={{ fontSize: 28, fontWeight: 800, color: "var(--text)", margin: 0, letterSpacing: "-0.02em" }}>
            لوحة تحكم المكتب
          </h1>
          <p style={{ fontSize: 14, color: "var(--muted)", margin: "6px 0 0", fontWeight: 500 }}>
            نظرة تحليلية شاملة على أداء المكتب والشركاء
          </p>
        </div>
        <div style={{
          padding: "10px 20px", borderRadius: 12,
          background: "var(--surface)", border: "1px solid var(--border)",
          fontSize: 13, color: "var(--muted)", fontWeight: 500,
          display: "flex", alignItems: "center", gap: 8,
        }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--muted)" strokeWidth="2">
            <rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>
          </svg>
          {new Date().toLocaleDateString("ar-EG", { weekday: "long", year: "numeric", month: "long", day: "numeric" })}
        </div>
      </div>



      {/* ═══ Charts Row — 2 Donuts + 1 Donut ═══ */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 16, marginBottom: 24 }}>
        {/* Donut: Treasury Breakdown */}
        <div style={{ padding: "24px", borderRadius: 16, background: "var(--surface)", border: "1px solid var(--border)", boxShadow: "0 1px 3px rgba(0,0,0,0.2)" }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: "var(--text)", marginBottom: 20 }}>مُكوّنات الخزينة</div>
          <div style={{ display: "flex", alignItems: "center", gap: 24 }}>
            <DonutChart segments={treasuryInSegments.length > 0 ? treasuryInSegments : [{ value: 1, color: "var(--surface-hover)", label: "فارغ" }]} size={140} thickness={18} />
            <div style={{ flex: 1 }}>
              {treasuryInSegments.map(seg => (
                <div key={seg.label} style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
                  <div style={{ width: 12, height: 12, borderRadius: 4, background: seg.color, flexShrink: 0, boxShadow: `0 0 8px ${seg.color}40` }} />
                  <div style={{ flex: 1, fontSize: 12, color: "var(--muted)", fontWeight: 500 }}>{seg.label}</div>
                  <div style={{ fontSize: 13, fontWeight: 700, color: "var(--text)", direction: "ltr" }}>{fmt(seg.value)}</div>
                </div>
              ))}
              {treasuryOutSegments.map(seg => (
                <div key={seg.label} style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
                  <div style={{ width: 12, height: 12, borderRadius: 4, background: seg.color, flexShrink: 0, boxShadow: `0 0 8px ${seg.color}40` }} />
                  <div style={{ flex: 1, fontSize: 12, color: "var(--muted)", fontWeight: 500 }}>{seg.label}</div>
                  <div style={{ fontSize: 13, fontWeight: 700, color: seg.color, direction: "ltr" }}>-{fmt(seg.value)}</div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Donut: Partner Balances */}
        <div style={{ padding: "24px", borderRadius: 16, background: "var(--surface)", border: "1px solid var(--border)", boxShadow: "0 1px 3px rgba(0,0,0,0.2)" }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: "var(--text)", marginBottom: 4 }}>توزيع أرصدة الشركاء</div>
          <div style={{ fontSize: 11, color: "var(--muted)", marginBottom: 16, fontWeight: 500 }}>صافي المستحق لكل شريك</div>
          <div style={{ display: "flex", alignItems: "center", gap: 24 }}>
            <DonutChart segments={partnerBalanceSegments.length > 0 ? partnerBalanceSegments : [{ value: 1, color: "var(--surface-hover)", label: "فارغ" }]} size={140} thickness={18} />
            <div style={{ flex: 1 }}>
              {partnerSummary.map((p, i) => (
                <div key={p.id} style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
                  <div style={{ width: 12, height: 12, borderRadius: 4, background: ["#8b5cf6", "#3b82f6", "#0d9488", "#f59e0b"][i % 4], flexShrink: 0, boxShadow: `0 0 8px ${["#8b5cf6", "#3b82f6", "#0d9488", "#f59e0b"][i % 4]}40` }} />
                  <div style={{ flex: 1, fontSize: 12, color: "var(--muted)", fontWeight: 500 }}>{p.name}</div>
                  <div style={{ fontSize: 13, fontWeight: 700, color: p.balance >= 0 ? "#10b981" : "#ef4444", direction: "ltr" }}>
                    {p.balance >= 0 ? "+" : ""}{fmt(p.balance)}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Donut: Transaction Types */}
        <div style={{ padding: "24px", borderRadius: 16, background: "var(--surface)", border: "1px solid var(--border)", boxShadow: "0 1px 3px rgba(0,0,0,0.2)" }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: "var(--text)", marginBottom: 4 }}>توزيع حركات الشركاء</div>
          <div style={{ fontSize: 11, color: "var(--muted)", marginBottom: 16, fontWeight: 500 }}>حسب النوع — إجمالي القيم</div>
          <div style={{ display: "flex", alignItems: "center", gap: 24 }}>
            <DonutChart
              segments={Object.entries(txByType).map(([type, amount]) => ({ value: amount, color: TX_TYPE_COLOR[type] || "#6b7280", label: TX_TYPE_AR[type] || type })).filter(s => s.value > 0)}
              size={140} thickness={18}
            />
            <div style={{ flex: 1 }}>
              {Object.entries(txByType).map(([type, amount]) => (
                <div key={type} style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
                  <div style={{ width: 12, height: 12, borderRadius: 4, background: TX_TYPE_COLOR[type] || "#6b7280", flexShrink: 0, boxShadow: `0 0 8px ${TX_TYPE_COLOR[type] || "#6b7280"}40` }} />
                  <div style={{ flex: 1, fontSize: 12, color: "var(--muted)", fontWeight: 500 }}>{TX_TYPE_AR[type] || type}</div>
                  <div style={{ fontSize: 13, fontWeight: 700, color: "var(--text)", direction: "ltr" }}>{fmt(amount)}</div>
                </div>
              ))}
              {Object.keys(txByType).length === 0 && (
                <div style={{ fontSize: 12, color: "var(--muted)", textAlign: "center", padding: 16 }}>لا توجد حركات بعد</div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* ═══ Bar Charts + Recent Transactions ═══ */}
      <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 16, marginBottom: 24 }}>
        {/* Monthly Bar Chart */}
        <div style={{ padding: "24px", borderRadius: 16, background: "var(--surface)", border: "1px solid var(--border)", boxShadow: "0 1px 3px rgba(0,0,0,0.2)" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
            <div>
              <div style={{ fontSize: 15, fontWeight: 700, color: "var(--text)" }}>المصروفات الشهرية</div>
              <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 2, fontWeight: 500 }}>آخر 12 شهر — Monthly Expenses</div>
            </div>
            <div style={{ display: "flex", gap: 16, fontSize: 11 }}>
              <span style={{ display: "flex", alignItems: "center", gap: 6, fontWeight: 500 }}>
                <span style={{ width: 10, height: 10, borderRadius: 3, background: "linear-gradient(135deg, #ef4444, #dc2626)" }} />
                <span style={{ color: "var(--muted)" }}>مصروفات</span>
              </span>
              <span style={{ display: "flex", alignItems: "center", gap: 6, fontWeight: 500 }}>
                <span style={{ width: 10, height: 10, borderRadius: 3, background: "linear-gradient(135deg, #f59e0b, #d97706)" }} />
                <span style={{ color: "var(--muted)" }}>صرف شركاء</span>
              </span>
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "flex-end", gap: 4, height: 200, paddingBottom: 28, borderBottom: "1px solid var(--border)", position: "relative" }}>
            {monthlyBreakdown.slice().reverse().map((m, i) => {
              const partnerOut = monthlyPartnerOutflows.find(po => po.month === m.month && po.year === m.year)?.total || 0;
              const barH = maxMonthly > 0 ? (m.total / maxMonthly) * 160 : 0;
              const partnerH = maxMonthly > 0 ? (partnerOut / maxMonthly) * 160 : 0;
              return (
                <div key={i} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
                  <div style={{ display: "flex", alignItems: "flex-end", gap: 3, height: 170 }}>
                    <div style={{
                      width: "42%", borderRadius: "6px 6px 2px 2px",
                      background: m.total > 0 ? "linear-gradient(180deg, #ef4444 0%, #dc2626 100%)" : "transparent",
                      transition: "height 0.6s ease", position: "relative", minHeight: m.total > 0 ? 6 : 0,
                      boxShadow: m.total > 0 ? "0 -2px 8px rgba(239,68,68,0.3)" : "none",
                    }}>
                      {m.total > 0 && <div style={{ position: "absolute", top: -20, left: "50%", transform: "translateX(-50%)", fontSize: 9, color: "var(--muted)", whiteSpace: "nowrap", direction: "ltr", fontWeight: 600 }}>{fmt(m.total)}</div>}
                    </div>
                    <div style={{
                      width: "42%", borderRadius: "6px 6px 2px 2px",
                      background: partnerOut > 0 ? "linear-gradient(180deg, #f59e0b 0%, #d97706 100%)" : "transparent",
                      transition: "height 0.6s ease", minHeight: partnerOut > 0 ? 6 : 0,
                      boxShadow: partnerOut > 0 ? "0 -2px 8px rgba(245,158,11,0.3)" : "none",
                    }} />
                  </div>
                  <div style={{ fontSize: 10, color: "var(--muted)", whiteSpace: "nowrap", fontWeight: 500 }}>{MONTHS_AR_SHORT[m.month - 1]?.slice(0, 3)}</div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Recent Transactions */}
        <div style={{ padding: "24px", borderRadius: 16, background: "var(--surface)", border: "1px solid var(--border)", boxShadow: "0 1px 3px rgba(0,0,0,0.2)" }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: "var(--text)", marginBottom: 4 }}>آخر الحركات</div>
          <div style={{ fontSize: 11, color: "var(--muted)", marginBottom: 16, fontWeight: 500 }}>Recent Partner Transactions</div>
          {recentPartnerTx.length === 0 ? (
            <div style={{ textAlign: "center", padding: 32, color: "var(--muted)", fontSize: 12 }}>لا توجد حركات بعد</div>
          ) : recentPartnerTx.map(tx => (
            <div key={tx.id} style={{
              display: "flex", alignItems: "center", gap: 12, padding: "12px 0",
              borderBottom: "1px solid var(--border)",
            }}>
              <div style={{
                width: 36, height: 36, borderRadius: 10,
                background: `${TX_TYPE_COLOR[tx.type] || "#6b7280"}15`,
                display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
                border: `1px solid ${TX_TYPE_COLOR[tx.type] || "#6b7280"}25`,
              }}>
                <div style={{ width: 10, height: 10, borderRadius: "50%", background: TX_TYPE_COLOR[tx.type] || "#6b7280" }} />
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{tx.partnerName}</div>
                <div style={{ fontSize: 11, color: "var(--muted)", fontWeight: 500 }}>{TX_TYPE_AR[tx.type] || tx.type}</div>
              </div>
              <div style={{ textAlign: "right" }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: ["SALARY", "PROFIT_SHARE", "LOAN_SETTLEMENT"].includes(tx.type) ? "#10b981" : "#ef4444", direction: "ltr" }}>
                  {["SALARY", "PROFIT_SHARE", "LOAN_SETTLEMENT"].includes(tx.type) ? "+" : "-"}{fmt(tx.amount)}
                </div>
                <div style={{ fontSize: 10, color: "var(--muted)", fontWeight: 500 }}>{new Date(tx.date).toLocaleDateString("ar-EG", { day: "2-digit", month: "short" })}</div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* ═══ Expense Breakdown + Partner Summary ═══ */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
        {/* Expense Category Breakdown */}
        <div style={{ padding: "24px", borderRadius: 16, background: "var(--surface)", border: "1px solid var(--border)", boxShadow: "0 1px 3px rgba(0,0,0,0.2)" }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: "var(--text)", marginBottom: 20 }}>تصنيف المصاريف</div>
          <div style={{ display: "flex", gap: 16 }}>
            {/* Fixed */}
            <div style={{
              flex: 1, padding: 20, borderRadius: 14,
              background: "rgba(245,158,11,0.06)", border: "1px solid rgba(245,158,11,0.12)",
            }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
                <div>
                  <div style={{ fontSize: 13, color: "var(--text)", fontWeight: 600 }}>مصاريف ثابتة</div>
                  <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 2 }}>Fixed Expenses</div>
                </div>
                <ProgressCircle value={expenseBreakdownStats.fixed} max={allTimeStats.totalExpenses || 1} color="#f59e0b" label={allTimeStats.totalExpenses > 0 ? `${Math.round(expenseBreakdownStats.fixed / allTimeStats.totalExpenses * 100)}%` : "0%"} />
              </div>
              <div style={{ fontSize: 24, fontWeight: 800, color: "#f59e0b", direction: "ltr" }}>{fmt(expenseBreakdownStats.fixed)} EGP</div>
            </div>
            {/* Variable */}
            <div style={{
              flex: 1, padding: 20, borderRadius: 14,
              background: "rgba(59,130,246,0.06)", border: "1px solid rgba(59,130,246,0.12)",
            }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
                <div>
                  <div style={{ fontSize: 13, color: "var(--text)", fontWeight: 600 }}>مصاريف متغيرة</div>
                  <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 2 }}>Variable Expenses</div>
                </div>
                <ProgressCircle value={expenseBreakdownStats.variable} max={allTimeStats.totalExpenses || 1} color="#3b82f6" label={allTimeStats.totalExpenses > 0 ? `${Math.round(expenseBreakdownStats.variable / allTimeStats.totalExpenses * 100)}%` : "0%"} />
              </div>
              <div style={{ fontSize: 24, fontWeight: 800, color: "#3b82f6", direction: "ltr" }}>{fmt(expenseBreakdownStats.variable)} EGP</div>
            </div>
          </div>
        </div>

        {/* Partner Summary Table */}
        <div style={{ padding: "24px", borderRadius: 16, background: "var(--surface)", border: "1px solid var(--border)", boxShadow: "0 1px 3px rgba(0,0,0,0.2)" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
            <div>
              <div style={{ fontSize: 15, fontWeight: 700, color: "var(--text)" }}>ملخص الشركاء</div>
              <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 2 }}>Partner Balances</div>
            </div>
          </div>
          {/* Table header */}
          <div style={{
            display: "grid", gridTemplateColumns: "1fr 90px 90px 70px",
            padding: "10px 12px", borderRadius: 10, background: "var(--surface-hover)",
            fontSize: 11, fontWeight: 600, color: "var(--muted)", marginBottom: 8,
          }}>
            <div>الشريك</div><div style={{ textAlign: "right" }}>الرصيد</div><div style={{ textAlign: "right" }}>السلف</div><div style={{ textAlign: "right" }}>الحركات</div>
          </div>
          {partnerSummary.map((p, i) => (
            <div key={p.id} style={{
              display: "grid", gridTemplateColumns: "1fr 90px 90px 70px",
              padding: "12px", borderRadius: 10, marginBottom: 4,
              fontSize: 13, alignItems: "center",
              background: i % 2 === 0 ? "transparent" : "var(--surface-hover)",
              transition: "background 0.15s",
            }}>
              <div style={{ fontWeight: 600, color: "var(--text)", display: "flex", alignItems: "center", gap: 8 }}>
                <div style={{ width: 28, height: 28, borderRadius: 8, background: `${["#8b5cf6", "#3b82f6", "#0d9488", "#f59e0b"][i % 4]}20`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, fontWeight: 700, color: ["#8b5cf6", "#3b82f6", "#0d9488", "#f59e0b"][i % 4] }}>
                  {p.name.charAt(0)}
                </div>
                {p.name}
              </div>
              <div style={{ textAlign: "right", fontWeight: 700, color: p.balance >= 0 ? "#10b981" : "#ef4444", direction: "ltr" }}>
                {p.balance >= 0 ? "+" : ""}{fmt(p.balance)}
              </div>
              <div style={{ textAlign: "right", fontSize: 12, color: p.outstandingAdvances > 0 ? "#f59e0b" : "var(--muted)", direction: "ltr", fontWeight: p.outstandingAdvances > 0 ? 600 : 400 }}>
                {p.outstandingAdvances > 0 ? fmt(p.outstandingAdvances) : "—"}
              </div>
              <div style={{ textAlign: "right", fontSize: 12, color: "var(--muted)", fontWeight: 500 }}>{p.txCount}</div>
            </div>
          ))}
          {partnerSummary.length === 0 && (
            <div style={{ textAlign: "center", padding: 24, color: "var(--muted)", fontSize: 12 }}>لا يوجد شركاء بعد</div>
          )}
        </div>
      </div>
    </div>
  );
}
