"use client";

import { useEffect, useState, useMemo } from "react";
import Link from "next/link";

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

const MONTHS_AR = ["يناير", "فبراير", "مارس", "أبريل", "مايو", "يونيو", "يوليو", "أغسطس", "سبتمبر", "أكتوبر", "نوفمبر", "ديسمبر"];
const MONTHS_EN = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const STATUS_COLORS: Record<string, string> = {
  WAITING: "#f59e0b", IN_PROGRESS: "#3b82f6", COMPLETED: "#10b981", PAUSED: "#6b7280",
};
const STATUS_LABELS: Record<string, string> = {
  WAITING: "بانتظار البدء", IN_PROGRESS: "قيد التنفيذ", COMPLETED: "مكتمل", PAUSED: "متوقف مؤقتاً",
};

// Animated Number Component
function AnimatedNumber({ value, suffix = "", prefix = "", duration = 1000 }: { value: number | string; suffix?: string; prefix?: string; duration?: number }) {
  const [displayValue, setDisplayValue] = useState(0);
  const numValue = typeof value === "string" ? parseFloat(value.replace(/,/g, "")) || 0 : value;

  useEffect(() => {
    let start = 0;
    const end = numValue;
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
  }, [numValue, duration]);

  return <>{prefix}{formatNum(Math.floor(displayValue))}{suffix}</>;
}

// Loading Skeleton
function Skeleton() {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", minHeight: "70vh", flexDirection: "column", gap: 20 }}>
      <div style={{
        width: 60, height: 60, border: "4px solid var(--border)",
        borderTopColor: "#3b82f6", borderRadius: "50%",
        animation: "spin 0.8s linear infinite",
      }} />
      <div style={{ color: "var(--muted)", fontSize: 14, fontWeight: 600 }}>جاري تحميل البيانات...</div>
      <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
    </div>
  );
}

// Hero Stats Card Component
function HeroStatCard({ label, labelEn, value, icon, gradient, iconBg, trend }: {
  label: string; labelEn: string; value: string | number; icon: string;
  gradient: string; iconBg: string; trend?: { value: number; isPositive: boolean };
}) {
  return (
    <div style={{
      padding: "24px 28px", borderRadius: 16,
      background: gradient,
      border: "1px solid rgba(59,130,246,0.15)",
      position: "relative", overflow: "hidden",
      transition: "all 0.3s ease",
      cursor: "pointer",
    }}
      onMouseEnter={e => {
        e.currentTarget.style.transform = "translateY(-4px)";
        e.currentTarget.style.boxShadow = "0 12px 32px rgba(59,130,246,0.2)";
      }}
      onMouseLeave={e => {
        e.currentTarget.style.transform = "translateY(0)";
        e.currentTarget.style.boxShadow = "none";
      }}
    >
      {/* Decorative gradient circles */}
      <div style={{ position: "absolute", top: -30, right: -30, width: 100, height: 100, borderRadius: "50%", background: "rgba(255,255,255,0.05)" }} />
      <div style={{ position: "absolute", bottom: -20, left: -20, width: 80, height: 80, borderRadius: "50%", background: "rgba(255,255,255,0.03)" }} />
      
      <div style={{ position: "relative", zIndex: 1 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
          <div style={{
            width: 50, height: 50, borderRadius: 14,
            background: iconBg,
            display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: 22, boxShadow: "0 4px 12px rgba(0,0,0,0.1)",
          }}>
            {icon}
          </div>
          {trend && (
            <div style={{
              padding: "4px 10px", borderRadius: 8,
              background: trend.isPositive ? "rgba(16,185,129,0.15)" : "rgba(239,68,68,0.15)",
              color: trend.isPositive ? "#10b981" : "#ef4444",
              fontSize: 11, fontWeight: 700,
              display: "flex", alignItems: "center", gap: 4,
            }}>
              {trend.isPositive ? "↗" : "↘"} {Math.abs(trend.value)}%
            </div>
          )}
        </div>
        <div style={{ fontSize: 32, fontWeight: 900, color: "var(--text)", marginBottom: 6, letterSpacing: "-0.03em", lineHeight: 1 }}>
          {typeof value === "number" ? <AnimatedNumber value={value} /> : value}
        </div>
        <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text-secondary)", marginBottom: 2 }}>{label}</div>
        <div style={{ fontSize: 11, color: "var(--muted)", opacity: 0.7 }}>{labelEn}</div>
      </div>
    </div>
  );
}

export default function ReboundDashboard() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [hoveredBar, setHoveredBar] = useState<number | null>(null);

  useEffect(() => {
    fetch("/api/rebound/dashboard")
      .then(r => r.json())
      .then(d => setData(d))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const collectionRate = useMemo(() => {
    if (!data || data.totalRevenue === 0) return 0;
    return Math.round((data.totalCollected / data.totalRevenue) * 100);
  }, [data]);

  const maxRevenue = useMemo(() => {
    if (!data) return 1;
    return Math.max(...data.monthlyRevenue.map(m => m.revenue), 1);
  }, [data]);

  if (loading) return <Skeleton />;

  if (!data) {
    return (
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", minHeight: "70vh", padding: 40 }}>
        <div style={{
          width: 120, height: 120, borderRadius: "50%",
          background: "linear-gradient(135deg, rgba(59,130,246,0.1), rgba(59,130,246,0.03))",
          display: "flex", alignItems: "center", justifyContent: "center",
          fontSize: 48, marginBottom: 24,
        }}>
          📊
        </div>
        <h2 style={{ fontSize: 24, fontWeight: 800, color: "var(--text)", marginBottom: 12, letterSpacing: "-0.02em" }}>
          مرحبًا بك في REBOUND
        </h2>
        <p style={{ color: "var(--muted)", fontSize: 14, maxWidth: 400, textAlign: "center", lineHeight: 1.6, marginBottom: 24 }}>
          ابدأ رحلتك في التسويق الرقمي بإضافة أول عميل أو اشتراك
        </p>
        <Link href="/office/rebound/clients" style={{
          padding: "12px 28px", borderRadius: 10,
          background: "#3b82f6", color: "#fff",
          fontSize: 14, fontWeight: 600,
          textDecoration: "none",
          boxShadow: "0 4px 12px rgba(59,130,246,0.3)",
        }}>
          إدارة العملاء →
        </Link>
      </div>
    );
  }

  return (
    <div style={{ paddingBottom: 40 }}>
      {/* ═══ Animated Header ═══ */}
      <div style={{ marginBottom: 32, position: "relative" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: 8 }}>
          <div style={{
            width: 48, height: 48, borderRadius: 14,
            background: "linear-gradient(135deg, #3b82f6, #60a5fa)",
            display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: 24, boxShadow: "0 4px 16px rgba(59,130,246,0.3)",
          }}>
            🚀
          </div>
          <div>
            <h1 style={{
              fontSize: 28, fontWeight: 900, color: "var(--text)",
              margin: 0, letterSpacing: "-0.03em",
              background: "linear-gradient(135deg, var(--text), var(--text-secondary))",
              WebkitBackgroundClip: "text",
              WebkitTextFillColor: "transparent",
            }}>
              لوحة تحكم REBOUND
            </h1>
            <p style={{ fontSize: 13, color: "var(--muted)", margin: "4px 0 0", fontWeight: 500 }}>
              التسويق الرقمي والطباعة · Dashboard Overview
            </p>
          </div>
        </div>
      </div>

      {/* ═══ Hero Stats Grid ═══ */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 16, marginBottom: 24 }}>
        <HeroStatCard
          label="الرصيد المتاح"
          labelEn="Available Balance"
          value={`${formatNum(data.poolBalance)} EGP`}
          icon="💰"
          gradient="linear-gradient(135deg, rgba(59,130,246,0.08) 0%, rgba(59,130,246,0.02) 100%)"
          iconBg="rgba(59,130,246,0.15)"
          trend={{ value: 12, isPositive: true }}
        />
        <HeroStatCard
          label="الدخل الشهري المتكرر"
          labelEn="Monthly Recurring Revenue"
          value={`${formatNum(data.mrr)} EGP`}
          icon="📈"
          gradient="linear-gradient(135deg, rgba(16,185,129,0.08) 0%, rgba(16,185,129,0.02) 100%)"
          iconBg="rgba(16,185,129,0.15)"
          trend={{ value: 8, isPositive: true }}
        />
      </div>

      {/* ═══ Quick Stats Row ═══ */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 12, marginBottom: 24 }}>
        {[
          { label: "إجمالي الإيرادات", value: `${formatNum(data.totalRevenue)} EGP`, color: "#3b82f6", icon: "💵" },
          { label: "العملاء", value: data.totalClients, color: "#8b5cf6", icon: "👥" },
          { label: "المشاريع النشطة", value: data.activeProjects, color: "#f59e0b", icon: "🔄" },
          { label: "المشاريع المكتملة", value: data.completedProjects, color: "#10b981", icon: "✅" },
          { label: "الاشتراكات النشطة", value: `${data.activeSubscriptions}/${data.totalSubscriptions}`, color: "#06b6d4", icon: "🎯" },
        ].map((stat, i) => (
          <div key={i} style={{
            padding: "16px 18px", borderRadius: 12,
            background: "var(--surface)", border: "1px solid var(--border)",
            transition: "all 0.2s ease", cursor: "pointer",
          }}
            onMouseEnter={e => {
              e.currentTarget.style.borderColor = stat.color;
              e.currentTarget.style.boxShadow = `0 4px 16px ${stat.color}25`;
            }}
            onMouseLeave={e => {
              e.currentTarget.style.borderColor = "var(--border)";
              e.currentTarget.style.boxShadow = "none";
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
              <div style={{
                width: 36, height: 36, borderRadius: 10,
                background: `${stat.color}12`,
                display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: 16,
              }}>
                {stat.icon}
              </div>
              <div style={{ fontSize: 11, color: "var(--muted)", fontWeight: 600, lineHeight: 1.3 }}>{stat.label}</div>
            </div>
            <div style={{ fontSize: 22, fontWeight: 800, color: stat.color, letterSpacing: "-0.02em" }}>
              {typeof stat.value === "number" ? <AnimatedNumber value={stat.value} /> : stat.value}
            </div>
          </div>
        ))}
      </div>

      {/* ═══ Main Grid: Chart + Status + Collection ═══ */}
      <div style={{ display: "grid", gridTemplateColumns: "1.8fr 1fr 0.8fr", gap: 16, marginBottom: 24 }}>
        {/* Monthly Revenue Chart - Enhanced */}
        <div style={{
          padding: "24px 28px", borderRadius: 16,
          background: "var(--surface)", border: "1px solid var(--border)",
          boxShadow: "0 2px 8px rgba(0,0,0,0.04)",
        }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20 }}>
            <div>
              <div style={{ fontSize: 15, fontWeight: 700, color: "var(--text)" }}>الإيرادات الشهرية</div>
              <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 2 }}>Monthly Revenue Trend</div>
            </div>
            <div style={{
              padding: "6px 12px", borderRadius: 8,
              background: "rgba(59,130,246,0.1)",
              fontSize: 12, fontWeight: 700, color: "#3b82f6",
            }}>
              {data.monthlyRevenue.reduce((sum, m) => sum + m.projects, 0)} مشاريع
            </div>
          </div>
          
          <div style={{ display: "flex", alignItems: "flex-end", gap: 6, height: 200, padding: "0 4px", position: "relative" }}>
            {data.monthlyRevenue.map((m, i) => {
              const height = maxRevenue > 0 ? (m.revenue / maxRevenue) * 160 : 0;
              const isHovered = hoveredBar === i;
              return (
                <div key={i} style={{
                  flex: 1, display: "flex", flexDirection: "column",
                  alignItems: "center", gap: 6, position: "relative",
                }}
                  onMouseEnter={() => setHoveredBar(i)}
                  onMouseLeave={() => setHoveredBar(null)}
                >
                  {/* Tooltip */}
                  {isHovered && m.revenue > 0 && (
                    <div style={{
                      position: "absolute", bottom: height + 45, left: "50%",
                      transform: "translateX(-50%)",
                      padding: "8px 12px", borderRadius: 8,
                      background: "var(--surface)", border: "1px solid var(--border)",
                      boxShadow: "0 8px 24px rgba(0,0,0,0.15)",
                      whiteSpace: "nowrap", zIndex: 10,
                      animation: "fadeIn 0.2s ease",
                    }}>
                      <div style={{ fontSize: 11, color: "var(--muted)", marginBottom: 2 }}>{MONTHS_AR[i]} 2026</div>
                      <div style={{ fontSize: 14, fontWeight: 800, color: "#3b82f6" }}>{formatNum(m.revenue)} EGP</div>
                      <div style={{ fontSize: 10, color: "var(--muted)", marginTop: 2 }}>{m.projects} مشاريع</div>
                    </div>
                  )}
                  
                  {/* Bar */}
                  <div style={{
                    width: "100%", maxWidth: 32,
                    height: Math.max(height, 3),
                    background: isHovered ? "linear-gradient(180deg, #3b82f6 0%, #2563eb 100%)" : "linear-gradient(180deg, #3b82f6 0%, #60a5fa 100%)",
                    borderRadius: "8px 8px 3px 3px",
                    transition: "all 0.25s ease",
                    transform: isHovered ? "scaleY(1.05)" : "scaleY(1)",
                    transformOrigin: "bottom",
                    cursor: "pointer",
                    boxShadow: isHovered ? "0 4px 12px rgba(59,130,246,0.4)" : "none",
                  }} />
                  
                  <span style={{ fontSize: 10, color: "var(--muted)", fontWeight: 600 }}>{MONTHS_EN[i]}</span>
                </div>
              );
            })}
          </div>
        </div>

        {/* Work Status Breakdown - Enhanced */}
        <div style={{
          padding: "24px 28px", borderRadius: 16,
          background: "var(--surface)", border: "1px solid var(--border)",
        }}>
          <div style={{ marginBottom: 20 }}>
            <div style={{ fontSize: 15, fontWeight: 700, color: "var(--text)" }}>حالة المشاريع</div>
            <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 2 }}>Project Status</div>
          </div>
          
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            {data.workStatusBreakdown.map((s) => {
              const pct = data.totalProjects > 0 ? (s.count / data.totalProjects) * 100 : 0;
              const color = STATUS_COLORS[s.status] || "#6b7280";
              const label = STATUS_LABELS[s.status] || s.status;
              
              return (
                <div key={s.status}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <div style={{ width: 8, height: 8, borderRadius: "50%", background: color }} />
                      <span style={{ fontSize: 12, color: "var(--text-secondary)", fontWeight: 600 }}>{label}</span>
                    </div>
                    <span style={{ fontSize: 13, fontWeight: 800, color }}>{s.count}</span>
                  </div>
                  <div style={{
                    height: 8, borderRadius: 4,
                    background: "var(--surface-hover)",
                    overflow: "hidden", position: "relative",
                  }}>
                    <div style={{
                      height: "100%", borderRadius: 4,
                      width: `${pct}%`, background: color,
                      transition: "width 0.8s ease",
                      boxShadow: `0 0 8px ${color}40`,
                    }} />
                  </div>
                  <div style={{ fontSize: 10, color: "var(--muted)", marginTop: 4, textAlign: "left" }}>
                    {Math.round(pct)}%
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Collection Rate Gauge */}
        <div style={{
          padding: "24px 20px", borderRadius: 16,
          background: "var(--surface)", border: "1px solid var(--border)",
          display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
        }}>
          <div style={{ marginBottom: 16, textAlign: "center" }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: "var(--text)" }}>نسبة التحصيل</div>
            <div style={{ fontSize: 10, color: "var(--muted)", marginTop: 2 }}>Collection Rate</div>
          </div>
          
          {/* Circular Progress */}
          <div style={{ position: "relative", width: 120, height: 120, marginBottom: 12 }}>
            <svg width="120" height="120" style={{ transform: "rotate(-90deg)" }}>
              <circle cx="60" cy="60" r="50" stroke="var(--border)" strokeWidth="10" fill="none" />
              <circle
                cx="60" cy="60" r="50"
                stroke="#3b82f6"
                strokeWidth="10"
                fill="none"
                strokeDasharray={`${(collectionRate / 100) * 314} 314`}
                strokeLinecap="round"
                style={{ transition: "stroke-dasharray 1s ease" }}
              />
            </svg>
            <div style={{
              position: "absolute", top: "50%", left: "50%",
              transform: "translate(-50%, -50%)",
              textAlign: "center",
            }}>
              <div style={{ fontSize: 28, fontWeight: 900, color: "#3b82f6", lineHeight: 1 }}>
                <AnimatedNumber value={collectionRate} suffix="%" />
              </div>
            </div>
          </div>
          
          <div style={{ textAlign: "center", width: "100%" }}>
            <div style={{ fontSize: 11, color: "var(--muted)", marginBottom: 4 }}>محصّل / إجمالي</div>
            <div style={{ fontSize: 12, fontWeight: 700, color: "#10b981" }}>
              {formatNum(data.totalCollected)}
            </div>
            <div style={{ fontSize: 10, color: "var(--muted)" }}>من {formatNum(data.totalRevenue)} EGP</div>
          </div>
        </div>
      </div>

      {/* ═══ Bottom Row: Top Clients + Recent Activity ═══ */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
        {/* Top Clients - Enhanced */}
        <div style={{
          padding: "24px 28px", borderRadius: 16,
          background: "var(--surface)", border: "1px solid var(--border)",
        }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20 }}>
            <div>
              <div style={{ fontSize: 15, fontWeight: 700, color: "var(--text)" }}>أفضل العملاء</div>
              <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 2 }}>Top Clients by Revenue</div>
            </div>
            <Link href="/office/rebound/clients" style={{
              padding: "6px 12px", borderRadius: 8,
              background: "var(--surface-hover)",
              fontSize: 11, fontWeight: 600, color: "var(--text-secondary)",
              textDecoration: "none",
            }}>
              عرض الكل →
            </Link>
          </div>
          
          {data.topClients.length === 0 ? (
            <div style={{ textAlign: "center", padding: 40 }}>
              <div style={{ fontSize: 32, marginBottom: 8 }}>👥</div>
              <p style={{ fontSize: 12, color: "var(--muted)" }}>لا يوجد عملاء بعد</p>
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              {data.topClients.map((c, i) => (
                <div key={i} style={{
                  display: "flex", alignItems: "center", gap: 14,
                  padding: "12px 14px", borderRadius: 12,
                  background: "var(--surface-hover)",
                  border: "1px solid transparent",
                  transition: "all 0.2s ease",
                  cursor: "pointer",
                }}
                  onMouseEnter={e => {
                    e.currentTarget.style.borderColor = "#3b82f6";
                    e.currentTarget.style.transform = "translateX(-4px)";
                  }}
                  onMouseLeave={e => {
                    e.currentTarget.style.borderColor = "transparent";
                    e.currentTarget.style.transform = "translateX(0)";
                  }}
                >
                  <div style={{
                    width: 40, height: 40, borderRadius: 12,
                    background: `linear-gradient(135deg, hsl(${220 + i * 30}, 65%, 55%), hsl(${220 + i * 30}, 65%, 45%))`,
                    display: "flex", alignItems: "center", justifyContent: "center",
                    color: "#fff", fontSize: 16, fontWeight: 800,
                    boxShadow: `0 4px 12px hsl(${220 + i * 30}, 65%, 55%)40`,
                  }}>
                    {c.name.charAt(0)}
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 14, fontWeight: 700, color: "var(--text)" }}>{c.name}</div>
                    <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 2 }}>
                      {c.projects} {c.projects === 1 ? "مشروع" : "مشاريع"}
                    </div>
                  </div>
                  <div style={{ textAlign: "left" }}>
                    <div style={{ fontSize: 16, fontWeight: 800, color: "#3b82f6", direction: "ltr" }}>
                      {formatNum(c.totalPaid)}
                    </div>
                    <div style={{ fontSize: 10, color: "var(--muted)" }}>EGP</div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Recent Activity - Enhanced */}
        <div style={{
          padding: "24px 28px", borderRadius: 16,
          background: "var(--surface)", border: "1px solid var(--border)",
        }}>
          <div style={{ marginBottom: 20 }}>
            <div style={{ fontSize: 15, fontWeight: 700, color: "var(--text)" }}>آخر النشاطات</div>
            <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 2 }}>Recent Activity Log</div>
          </div>
          
          {data.recentActivity.length === 0 ? (
            <div style={{ textAlign: "center", padding: 40 }}>
              <div style={{ fontSize: 32, marginBottom: 8 }}>📝</div>
              <p style={{ fontSize: 12, color: "var(--muted)" }}>لا يوجد نشاط بعد</p>
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
              {data.recentActivity.map((a, i) => (
                <div key={i} style={{
                  display: "flex", alignItems: "flex-start", gap: 12,
                  padding: "12px 0",
                  borderBottom: i < data.recentActivity.length - 1 ? "1px solid var(--border)" : "none",
                }}>
                  <div style={{
                    width: 8, height: 8, borderRadius: "50%",
                    background: "#3b82f6", marginTop: 6, flexShrink: 0,
                    boxShadow: "0 0 8px rgba(59,130,246,0.5)",
                  }} />
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 12, color: "var(--text-secondary)", lineHeight: 1.5, marginBottom: 4 }}>
                      {a.text}
                    </div>
                    <div style={{ fontSize: 10, color: "var(--muted)", fontWeight: 600 }}>
                      {new Date(a.date).toLocaleDateString("ar-EG", {
                        day: "2-digit",
                        month: "short",
                        year: "numeric",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Fade In Animation */}
      <style>{`
        @keyframes fadeIn {
          from { opacity: 0; transform: translateY(4px); }
          to { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </div>
  );
}
