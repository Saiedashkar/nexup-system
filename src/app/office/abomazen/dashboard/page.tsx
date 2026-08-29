"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

type DashboardData = {
  availableBalance: number;
  totalDealsThisMonth: number;
  availableProperties: number;
  totalDeals: number;
  totalRevenue: number;
  totalExpenses: number;
  recentDeals: { id: string; dealType: string; date: string; abomazenNetAmount: number; propertyName: string }[];
  monthlyRevenue: { month: string; revenue: number; deals: number }[];
};

function fmt(n: number) { return n.toLocaleString("en-US"); }
function fmtDate(d: string) { return new Date(d).toLocaleDateString("ar-EG", { day: "2-digit", month: "short" }); }

// SVG Icons
const DollarIcon = () => (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <line x1="12" y1="1" x2="12" y2="23"></line>
    <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"></path>
  </svg>
);

const TrendUpIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="23 6 13.5 15.5 8.5 10.5 1 18"></polyline>
    <polyline points="17 6 23 6 23 12"></polyline>
  </svg>
);

const TrendDownIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="23 18 13.5 8.5 8.5 13.5 1 6"></polyline>
    <polyline points="17 18 23 18 23 12"></polyline>
  </svg>
);

const FileTextIcon = () => (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
    <polyline points="14 2 14 8 20 8"></polyline>
    <line x1="16" y1="13" x2="8" y2="13"></line>
    <line x1="16" y1="17" x2="8" y2="17"></line>
    <polyline points="10 9 9 9 8 9"></polyline>
  </svg>
);

const HomeIcon = () => (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"></path>
    <polyline points="9 22 9 12 15 12 15 22"></polyline>
  </svg>
);

const ActivityIcon = () => (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="22 12 18 12 15 21 9 3 6 12 2 12"></polyline>
  </svg>
);

// Animated Number
function AnimatedNumber({ value, duration = 1000 }: { value: number; duration?: number }) {
  const [displayValue, setDisplayValue] = useState(0);
  useEffect(() => {
    let start = 0;
    const end = value;
    const increment = end / (duration / 16);
    const timer = setInterval(() => {
      start += increment;
      if (start >= end) {
        setDisplayValue(end);
        clearInterval(timer);
      } else {
        setDisplayValue(start);
      }
    }, 16);
    return () => clearInterval(timer);
  }, [value, duration]);
  return <>{fmt(Math.floor(displayValue))}</>;
}

// Loading
function LoadingSkeleton() {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", minHeight: "80vh", flexDirection: "column", gap: 20 }}>
      <div style={{ width: 60, height: 60, border: "4px solid var(--border)", borderTopColor: "#8b5cf6", borderRadius: "50%", animation: "spin 0.8s linear infinite" }} />
      <div style={{ color: "var(--muted)", fontSize: 14, fontWeight: 600 }}>جاري تحميل البيانات...</div>
      <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
    </div>
  );
}

export default function AbomazenDashboard() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/abomazen/dashboard")
      .then(r => r.json())
      .then(d => {
        setData({
          ...d,
          totalRevenue: d.availableBalance + (d.totalExpenses || 0),
          totalExpenses: d.totalExpenses || 0,
          monthlyRevenue: d.monthlyRevenue || []
        });
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <LoadingSkeleton />;
  if (!data) return null;

  const growthRate = data.totalDeals > 0 ? ((data.totalDealsThisMonth / data.totalDeals) * 100) : 0;
  const profitMargin = data.totalRevenue > 0 ? ((data.availableBalance / data.totalRevenue) * 100) : 0;

  return (
    <div style={{ paddingBottom: 40, maxWidth: 1400, margin: "0 auto" }}>
      {/* Header */}
      <div style={{ marginBottom: 32 }}>
        <h1 style={{ fontSize: 32, fontWeight: 900, color: "var(--text)", margin: 0, letterSpacing: "-0.04em" }}>
          لوحة تحكم ABOMAZEN
        </h1>
        <p style={{ fontSize: 14, color: "var(--muted)", margin: "8px 0 0", fontWeight: 500 }}>
          نظرة شاملة على أداء الوساطة العقارية
        </p>
      </div>

      {/* Top KPI Cards */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 20, marginBottom: 32 }}>
        {/* Available Balance */}
        <div style={{
          padding: "24px", borderRadius: 16, 
          background: "linear-gradient(135deg, #8b5cf6 0%, #7c3aed 100%)",
          color: "#fff", position: "relative", overflow: "hidden",
          boxShadow: "0 8px 24px rgba(139,92,246,0.25)"
        }}>
          <div style={{ position: "absolute", top: -20, right: -20, width: 100, height: 100, borderRadius: "50%", background: "rgba(255,255,255,0.1)" }} />
          <div style={{ position: "relative", zIndex: 1 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 16, opacity: 0.9 }}>
              <DollarIcon />
              <span style={{ fontSize: 13, fontWeight: 600 }}>الرصيد المتاح</span>
            </div>
            <div style={{ fontSize: 36, fontWeight: 900, marginBottom: 4, letterSpacing: "-0.03em" }}>
              <AnimatedNumber value={data.availableBalance} />
            </div>
            <div style={{ fontSize: 13, opacity: 0.85, fontWeight: 500 }}>جنيه مصري</div>
          </div>
        </div>

        {/* Total Revenue */}
        <div style={{ padding: "24px", borderRadius: 16, background: "var(--surface)", border: "1px solid var(--border)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 16, color: "#10b981" }}>
            <TrendUpIcon />
            <span style={{ fontSize: 13, fontWeight: 600, color: "var(--muted)" }}>إجمالي الإيرادات</span>
          </div>
          <div style={{ fontSize: 32, fontWeight: 900, color: "var(--text)", marginBottom: 4, letterSpacing: "-0.03em" }}>
            <AnimatedNumber value={data.totalRevenue} />
          </div>
          <div style={{ fontSize: 12, color: "#10b981", fontWeight: 600, display: "flex", alignItems: "center", gap: 4 }}>
            <TrendUpIcon />
            <span>+{growthRate.toFixed(1)}% هذا الشهر</span>
          </div>
        </div>

        {/* Total Deals */}
        <div style={{ padding: "24px", borderRadius: 16, background: "var(--surface)", border: "1px solid var(--border)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 16, color: "#3b82f6" }}>
            <FileTextIcon />
            <span style={{ fontSize: 13, fontWeight: 600, color: "var(--muted)" }}>إجمالي الصفقات</span>
          </div>
          <div style={{ fontSize: 32, fontWeight: 900, color: "var(--text)", marginBottom: 4, letterSpacing: "-0.03em" }}>
            <AnimatedNumber value={data.totalDeals} />
          </div>
          <div style={{ fontSize: 12, color: "var(--muted)", fontWeight: 500 }}>
            {data.totalDealsThisMonth} صفقة هذا الشهر
          </div>
        </div>

        {/* Properties */}
        <div style={{ padding: "24px", borderRadius: 16, background: "var(--surface)", border: "1px solid var(--border)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 16, color: "#f59e0b" }}>
            <HomeIcon />
            <span style={{ fontSize: 13, fontWeight: 600, color: "var(--muted)" }}>عقارات متاحة</span>
          </div>
          <div style={{ fontSize: 32, fontWeight: 900, color: "var(--text)", marginBottom: 4, letterSpacing: "-0.03em" }}>
            <AnimatedNumber value={data.availableProperties} />
          </div>
          <div style={{ fontSize: 12, color: "var(--muted)", fontWeight: 500 }}>
            جاهزة للعرض والتسويق
          </div>
        </div>
      </div>

      {/* Middle Section: Charts & Stats */}
      <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 20, marginBottom: 32 }}>
        {/* Revenue Chart */}
        <div style={{ padding: "28px", borderRadius: 16, background: "var(--surface)", border: "1px solid var(--border)" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24 }}>
            <div>
              <h3 style={{ fontSize: 18, fontWeight: 700, color: "var(--text)", margin: 0 }}>الإيرادات الشهرية</h3>
              <p style={{ fontSize: 12, color: "var(--muted)", margin: "4px 0 0" }}>نمو الإيرادات على مدار الأشهر</p>
            </div>
            <div style={{ padding: "6px 12px", borderRadius: 8, background: "rgba(139,92,246,0.1)", color: "#8b5cf6", fontSize: 12, fontWeight: 600 }}>
              2024
            </div>
          </div>
          
          {/* Bar Chart */}
          <div style={{ display: "flex", alignItems: "flex-end", gap: 12, height: 200, marginBottom: 12 }}>
            {data.monthlyRevenue.slice(0, 6).map((m, i) => {
              const maxRevenue = Math.max(...data.monthlyRevenue.map(r => r.revenue), 1);
              const height = (m.revenue / maxRevenue) * 100;
              return (
                <div key={i} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 8 }}>
                  <div style={{ 
                    width: "100%", 
                    height: `${height}%`, 
                    background: "linear-gradient(180deg, #8b5cf6 0%, #a78bfa 100%)",
                    borderRadius: "8px 8px 0 0",
                    minHeight: 10,
                    position: "relative",
                    transition: "all 0.3s",
                    cursor: "pointer"
                  }}
                    onMouseEnter={e => {
                      e.currentTarget.style.background = "linear-gradient(180deg, #7c3aed 0%, #8b5cf6 100%)";
                      e.currentTarget.style.transform = "scaleY(1.05)";
                    }}
                    onMouseLeave={e => {
                      e.currentTarget.style.background = "linear-gradient(180deg, #8b5cf6 0%, #a78bfa 100%)";
                      e.currentTarget.style.transform = "scaleY(1)";
                    }}
                  >
                    <div style={{ 
                      position: "absolute", 
                      top: -30, 
                      left: "50%", 
                      transform: "translateX(-50%)",
                      fontSize: 11,
                      fontWeight: 700,
                      color: "#8b5cf6",
                      whiteSpace: "nowrap"
                    }}>
                      {fmt(m.revenue)}
                    </div>
                  </div>
                  <div style={{ fontSize: 11, fontWeight: 600, color: "var(--muted)" }}>{m.month}</div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Performance Metrics */}
        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          {/* Profit Margin */}
          <div style={{ padding: "24px", borderRadius: 16, background: "var(--surface)", border: "1px solid var(--border)" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 16 }}>
              <ActivityIcon />
              <span style={{ fontSize: 13, fontWeight: 600, color: "var(--muted)" }}>هامش الربح</span>
            </div>
            <div style={{ position: "relative", marginBottom: 12 }}>
              <svg width="120" height="120" style={{ transform: "rotate(-90deg)" }}>
                <circle cx="60" cy="60" r="50" fill="none" stroke="var(--border)" strokeWidth="10" />
                <circle 
                  cx="60" 
                  cy="60" 
                  r="50" 
                  fill="none" 
                  stroke="#10b981" 
                  strokeWidth="10"
                  strokeDasharray={`${(profitMargin / 100) * 314} 314`}
                  strokeLinecap="round"
                />
              </svg>
              <div style={{ 
                position: "absolute", 
                top: "50%", 
                left: "50%", 
                transform: "translate(-50%, -50%)",
                textAlign: "center"
              }}>
                <div style={{ fontSize: 28, fontWeight: 900, color: "#10b981" }}>{profitMargin.toFixed(1)}%</div>
              </div>
            </div>
            <div style={{ fontSize: 12, color: "var(--muted)", textAlign: "center" }}>من إجمالي الإيرادات</div>
          </div>

          {/* Expenses */}
          <div style={{ padding: "24px", borderRadius: 16, background: "var(--surface)", border: "1px solid var(--border)" }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: "var(--muted)", marginBottom: 12 }}>المصروفات</div>
            <div style={{ fontSize: 28, fontWeight: 900, color: "#ef4444", marginBottom: 8 }}>
              {fmt(data.totalExpenses)}
            </div>
            <div style={{ fontSize: 12, color: "var(--muted)" }}>جنيه مصري</div>
          </div>
        </div>
      </div>

      {/* Recent Deals Table */}
      <div style={{ padding: "28px", borderRadius: 16, background: "var(--surface)", border: "1px solid var(--border)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24 }}>
          <div>
            <h3 style={{ fontSize: 18, fontWeight: 700, color: "var(--text)", margin: 0 }}>آخر الصفقات</h3>
            <p style={{ fontSize: 12, color: "var(--muted)", margin: "4px 0 0" }}>نشاط الصفقات الأخير</p>
          </div>
          <Link href="/office/abomazen/deals" style={{
            padding: "8px 16px", borderRadius: 8,
            background: "var(--surface-hover)", border: "1px solid var(--border)",
            fontSize: 13, fontWeight: 600, color: "var(--text)",
            textDecoration: "none", transition: "all 0.2s"
          }}
            onMouseEnter={e => {
              e.currentTarget.style.borderColor = "#8b5cf6";
              e.currentTarget.style.color = "#8b5cf6";
            }}
            onMouseLeave={e => {
              e.currentTarget.style.borderColor = "var(--border)";
              e.currentTarget.style.color = "var(--text)";
            }}
          >
            عرض الكل →
          </Link>
        </div>

        {data.recentDeals.length === 0 ? (
          <div style={{ textAlign: "center", padding: 48, color: "var(--muted)" }}>
            <div style={{ fontSize: 48, marginBottom: 12, opacity: 0.5 }}>📋</div>
            <p style={{ fontSize: 14 }}>لا توجد صفقات مسجلة بعد</p>
          </div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ borderBottom: "2px solid var(--border)" }}>
                  <th style={{ padding: "12px 16px", textAlign: "right", fontSize: 12, fontWeight: 600, color: "var(--muted)" }}>العقار</th>
                  <th style={{ padding: "12px 16px", textAlign: "right", fontSize: 12, fontWeight: 600, color: "var(--muted)" }}>التاريخ</th>
                  <th style={{ padding: "12px 16px", textAlign: "right", fontSize: 12, fontWeight: 600, color: "var(--muted)" }}>النوع</th>
                  <th style={{ padding: "12px 16px", textAlign: "right", fontSize: 12, fontWeight: 600, color: "var(--muted)" }}>المبلغ</th>
                  <th style={{ padding: "12px 16px", textAlign: "right", fontSize: 12, fontWeight: 600, color: "var(--muted)" }}>الحالة</th>
                </tr>
              </thead>
              <tbody>
                {data.recentDeals.map(d => (
                  <tr key={d.id} style={{ borderBottom: "1px solid var(--border)", transition: "background 0.15s" }}
                    onMouseEnter={e => e.currentTarget.style.background = "var(--surface-hover)"}
                    onMouseLeave={e => e.currentTarget.style.background = "transparent"}
                  >
                    <td style={{ padding: "14px 16px", fontSize: 14, fontWeight: 600, color: "var(--text)" }}>
                      {d.propertyName || "صفقة سريعة"}
                    </td>
                    <td style={{ padding: "14px 16px", fontSize: 13, color: "var(--muted)" }}>{fmtDate(d.date)}</td>
                    <td style={{ padding: "14px 16px" }}>
                      <span style={{
                        padding: "4px 12px", borderRadius: 6,
                        background: d.dealType === "RENT" ? "rgba(139,92,246,0.1)" : "rgba(59,130,246,0.1)",
                        color: d.dealType === "RENT" ? "#8b5cf6" : "#3b82f6",
                        fontSize: 12, fontWeight: 600
                      }}>
                        {d.dealType === "RENT" ? "إيجار" : "بيع"}
                      </span>
                    </td>
                    <td style={{ padding: "14px 16px", fontSize: 16, fontWeight: 800, color: "#8b5cf6", direction: "ltr" }}>
                      {fmt(d.abomazenNetAmount)} EGP
                    </td>
                    <td style={{ padding: "14px 16px" }}>
                      <span style={{
                        padding: "4px 12px", borderRadius: 6,
                        background: "rgba(16,185,129,0.1)",
                        color: "#10b981",
                        fontSize: 12, fontWeight: 600
                      }}>
                        مكتملة
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Quick Actions */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20, marginTop: 32 }}>
        <Link href="/office/abomazen/new-deal" style={{ textDecoration: "none" }}>
          <div style={{
            padding: "24px", borderRadius: 16, 
            background: "linear-gradient(135deg, #8b5cf6 0%, #7c3aed 100%)",
            color: "#fff", cursor: "pointer", transition: "all 0.3s",
            boxShadow: "0 4px 16px rgba(139,92,246,0.3)",
            display: "flex", alignItems: "center", justifyContent: "space-between"
          }}
            onMouseEnter={e => {
              e.currentTarget.style.transform = "translateY(-4px)";
              e.currentTarget.style.boxShadow = "0 12px 32px rgba(139,92,246,0.4)";
            }}
            onMouseLeave={e => {
              e.currentTarget.style.transform = "translateY(0)";
              e.currentTarget.style.boxShadow = "0 4px 16px rgba(139,92,246,0.3)";
            }}
          >
            <div>
              <div style={{ fontSize: 18, fontWeight: 800, marginBottom: 4 }}>تسجيل صفقة جديدة</div>
              <div style={{ fontSize: 13, opacity: 0.9 }}>سجّل صفقة إيجار أو بيع</div>
            </div>
            <FileTextIcon />
          </div>
        </Link>

        <Link href="/office/abomazen/properties" style={{ textDecoration: "none" }}>
          <div style={{
            padding: "24px", borderRadius: 16,
            background: "var(--surface)", border: "2px solid var(--border)",
            color: "var(--text)", cursor: "pointer", transition: "all 0.3s",
            display: "flex", alignItems: "center", justifyContent: "space-between"
          }}
            onMouseEnter={e => {
              e.currentTarget.style.transform = "translateY(-4px)";
              e.currentTarget.style.borderColor = "#8b5cf6";
              e.currentTarget.style.boxShadow = "0 12px 32px rgba(139,92,246,0.15)";
            }}
            onMouseLeave={e => {
              e.currentTarget.style.transform = "translateY(0)";
              e.currentTarget.style.borderColor = "var(--border)";
              e.currentTarget.style.boxShadow = "none";
            }}
          >
            <div>
              <div style={{ fontSize: 18, fontWeight: 800, marginBottom: 4 }}>إضافة عقار جديد</div>
              <div style={{ fontSize: 13, color: "var(--muted)" }}>سجّل عقار في القائمة</div>
            </div>
            <HomeIcon />
          </div>
        </Link>
      </div>
    </div>
  );
}
