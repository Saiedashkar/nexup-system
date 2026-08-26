"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { AppShell } from "@/components/app-shell";

type Business = {
  id: string;
  name: string;
  slug: string;
  currencyMode: string;
  _count: {
    clients: number;
    projectRecords: number;
    poolTransactions: number;
    expenses: number;
  };
};

type OfficeStats = {
  totalRevenue: number;
  totalExpenses: number;
  totalClients: number;
  totalProjects: number;
};

function formatNum(n: number) {
  return n.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}

const BUSINESS_ORDER = ["nexup", "rebound", "abomazen"];

const BUSINESS_CONFIG: Record<string, { color: string; gradient: string; iconGradient: string; desc: string; descAr: string; iconPath: string }> = {
  nexup: {
    color: "#0d9488",
    gradient: "linear-gradient(135deg, #0d9488 0%, #14b8a6 50%, #2dd4bf 100%)",
    iconGradient: "linear-gradient(135deg, #0d9488, #0f766e)",
    desc: "Graphic Design & Visual Identity",
    descAr: "تصميم جرافيك وهوية بصرية",
    iconPath: "M12 19l7-7 3 3-7 7-3-3z M18 13l-1.5-7.5L2 2l3.5 14.5L13 18l5-5z M2 2l7.586 7.586",
  },
  rebound: {
    color: "#3b82f6",
    gradient: "linear-gradient(135deg, #3b82f6 0%, #60a5fa 50%, #93c5fd 100%)",
    iconGradient: "linear-gradient(135deg, #3b82f6, #2563eb)",
    desc: "Digital Marketing & Printing",
    descAr: "تسويق رقمي وطباعة",
    iconPath: "M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z M8 10h0 M12 10h0 M16 10h0",
  },
  abomazen: {
    color: "#8b5cf6",
    gradient: "linear-gradient(135deg, #8b5cf6 0%, #a78bfa 50%, #c4b5fd 100%)",
    iconGradient: "linear-gradient(135deg, #8b5cf6, #7c3aed)",
    desc: "Real Estate Marketing",
    descAr: "تسويق عقاري",
    iconPath: "M3 21h18 M5 21V7l7-4 7 4v14 M9 21v-6h6v6",
  },
};

export default function OfficePage() {
  const [businesses, setBusinesses] = useState<Business[]>([]);
  const [stats, setStats] = useState<OfficeStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [hoveredSlug, setHoveredSlug] = useState<string | null>(null);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const res = await fetch("/api/office/stats");
        if (res.ok) {
          const data = await res.json();
          const sorted = data.businesses.sort((a: Business, b: Business) =>
            BUSINESS_ORDER.indexOf(a.slug) - BUSINESS_ORDER.indexOf(b.slug)
          );
          setBusinesses(sorted);
          setStats(data.stats);
        }
      } catch { /* ignore */ }
      setLoading(false);
    };
    fetchData();
  }, []);

  return (
    <AppShell isAdmin={true} userName="Super Admin" activePage="office">
      <div style={{ direction: "rtl" }}>
        {/* ═══ Page Header ═══ */}
        <div style={{ marginBottom: 36 }}>
          <h1 style={{ fontSize: 30, fontWeight: 800, color: "var(--text)", margin: 0, letterSpacing: "-0.02em" }}>
            لوحة تحكم المكتب
          </h1>
          <p style={{ fontSize: 14, color: "var(--muted)", margin: "8px 0 0", fontWeight: 500 }}>
            إدارة شاملة لجميع الأنشطة من مكان واحد — Office Dashboard
          </p>
        </div>

        {loading ? (
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "50vh", flexDirection: "column", gap: 16 }}>
            <div style={{ width: 40, height: 40, border: "3px solid var(--border)", borderTopColor: "var(--brand)", borderRadius: "50%", animation: "spin 0.8s linear infinite" }} />
            <div style={{ color: "var(--muted)", fontSize: 14 }}>جاري تحميل البيانات...</div>
            <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
          </div>
        ) : (
          <>
            {/* ═══════════════════════════════════════════════
                SECTION 1: STAT CARDS — 4 key metrics
               ═══════════════════════════════════════════════ */}
            {stats && (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 16, marginBottom: 28 }}>
                {[
                  { label: "إجمالي العملاء", labelEn: "Clients", value: String(stats.totalClients), color: "#8b5cf6", icon: "M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2 M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z", bg: "rgba(139,92,246,0.12)" },
                  { label: "إجمالي المشاريع", labelEn: "Projects", value: String(stats.totalProjects), color: "#3b82f6", icon: "M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z", bg: "rgba(59,130,246,0.12)" },
                  { label: "إجمالي الإيرادات", labelEn: "Revenue", value: `${formatNum(stats.totalRevenue)} SAR`, color: "#10b981", icon: "M12 1v22M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6", bg: "rgba(16,185,129,0.12)" },
                  { label: "إجمالي المصروفات", labelEn: "Expenses", value: `${formatNum(stats.totalExpenses)} EGP`, color: "#ef4444", icon: "M9 5H2v7l6.29 6.29c.94.94 2.48.94 3.42 0l3.58-3.58c.94-.94.94-2.48 0-3.42L9 5z", bg: "rgba(239,68,68,0.12)" },
                ].map((s) => (
                  <div key={s.label} style={{
                    padding: "22px 24px", borderRadius: 16,
                    background: "var(--surface)", border: "1px solid var(--border)",
                    display: "flex", alignItems: "center", gap: 16,
                    boxShadow: "0 1px 3px rgba(0,0,0,0.2)", transition: "all 0.2s",
                  }}>
                    <div style={{
                      width: 50, height: 50, borderRadius: 14,
                      background: s.bg, color: s.color,
                      display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
                    }}>
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" width={22} height={22}>
                        <path d={s.icon} />
                      </svg>
                    </div>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 28, fontWeight: 800, color: "var(--text)", lineHeight: 1.1, direction: "ltr", textAlign: "right" }}>{s.value}</div>
                      <div style={{ fontSize: 13, color: "var(--muted)", fontWeight: 600, marginTop: 4 }}>{s.label}</div>
                      <div style={{ fontSize: 11, color: "var(--muted)", opacity: 0.6, marginTop: 1 }}>{s.labelEn}</div>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* ═══════════════════════════════════════════════
                SECTION 2: OFFICE MANAGEMENT — Big Prominent Banner
               ═══════════════════════════════════════════════ */}
            <Link href="/office/admin/dashboard" style={{ textDecoration: "none" }}>
              <div
                style={{
                  borderRadius: 20, marginBottom: 36, padding: 0,
                  background: "linear-gradient(135deg, #0f172a 0%, #1e1b4b 50%, #0f172a 100%)",
                  border: "1px solid rgba(139,92,246,0.2)",
                  cursor: "pointer", transition: "all 0.3s ease",
                  position: "relative", overflow: "hidden",
                  boxShadow: "0 4px 24px rgba(0,0,0,0.3)",
                }}
                onMouseEnter={e => {
                  e.currentTarget.style.borderColor = "rgba(139,92,246,0.5)";
                  e.currentTarget.style.transform = "translateY(-4px)";
                  e.currentTarget.style.boxShadow = "0 12px 40px rgba(139,92,246,0.25)";
                }}
                onMouseLeave={e => {
                  e.currentTarget.style.borderColor = "rgba(139,92,246,0.2)";
                  e.currentTarget.style.transform = "translateY(0)";
                  e.currentTarget.style.boxShadow = "0 4px 24px rgba(0,0,0,0.3)";
                }}
              >
                {/* Background decorative elements */}
                <div style={{ position: "absolute", top: -60, right: -60, width: 200, height: 200, borderRadius: "50%", background: "rgba(139,92,246,0.08)" }} />
                <div style={{ position: "absolute", bottom: -40, left: -40, width: 160, height: 160, borderRadius: "50%", background: "rgba(59,130,246,0.06)" }} />
                <div style={{ position: "absolute", top: 30, left: "40%", width: 100, height: 100, borderRadius: "50%", background: "rgba(13,148,136,0.06)" }} />

                <div style={{ padding: "36px 40px", position: "relative", zIndex: 1 }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
                      <div style={{
                        width: 64, height: 64, borderRadius: 18,
                        background: "linear-gradient(135deg, #8b5cf6, #6366f1, #3b82f6)",
                        display: "flex", alignItems: "center", justifyContent: "center",
                        boxShadow: "0 8px 24px rgba(139,92,246,0.4)",
                        flexShrink: 0,
                      }}>
                        <svg viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" width={32} height={32}>
                          <path d="M3 21h18M9 3h6M12 3v7M5 21V7l7-4 7 4v14M9 21v-4h6v4" />
                        </svg>
                      </div>
                      <div>
                        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 6 }}>
                          <span style={{ fontSize: 22, fontWeight: 800, color: "#fff", letterSpacing: "-0.01em" }}>إدارة المكتب</span>
                          <span style={{
                            padding: "4px 12px", borderRadius: 8,
                            background: "rgba(139,92,246,0.2)", border: "1px solid rgba(139,92,246,0.3)",
                            fontSize: 12, fontWeight: 600, color: "#a78bfa",
                          }}>Office Management</span>
                        </div>
                        <div style={{ fontSize: 14, color: "rgba(255,255,255,0.6)", fontWeight: 500 }}>
                          الشركاء · المصاريف · رأس المال · التوزيع · تحويل الأرباح
                        </div>
                        <div style={{ fontSize: 12, color: "rgba(255,255,255,0.35)", marginTop: 4 }}>
                          Partners · Expenses · Capital · Allocation · Profit Transfers
                        </div>
                      </div>
                    </div>

                    <div style={{
                      display: "flex", alignItems: "center", gap: 12,
                      padding: "14px 28px", borderRadius: 14,
                      background: "rgba(139,92,246,0.15)", border: "1px solid rgba(139,92,246,0.3)",
                      transition: "all 0.25s",
                    }}>
                      <span style={{ fontSize: 15, color: "#c4b5fd", fontWeight: 700 }}>دخول</span>
                      <div style={{
                        width: 36, height: 36, borderRadius: 10,
                        background: "linear-gradient(135deg, #8b5cf6, #6366f1)",
                        display: "flex", alignItems: "center", justifyContent: "center",
                      }}>
                        <svg viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" width="16" height="16" style={{ transform: "scaleX(-1)" }}>
                          <path d="M19 12H5M12 19l-7-7 7-7" />
                        </svg>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </Link>

            {/* ═══════════════════════════════════════════════
                SECTION 3: BUSINESS CARDS
               ═══════════════════════════════════════════════ */}
            <div style={{ marginBottom: 12 }}>
              <h2 style={{ fontSize: 18, fontWeight: 700, color: "var(--text)", marginBottom: 20 }}>
                الأنشطة التجارية
                <span style={{ fontSize: 13, fontWeight: 500, color: "var(--muted)", marginInlineStart: 12 }}>Your Businesses</span>
              </h2>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 20 }}>
              {businesses.map((biz) => {
                const config = BUSINESS_CONFIG[biz.slug] || { color: "#6b7280", gradient: "linear-gradient(135deg, #6b7280, #9ca3af)", iconGradient: "linear-gradient(135deg, #6b7280, #4b5563)", desc: "Business", descAr: "نشاط تجاري", iconPath: "M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" };
                const isHovered = hoveredSlug === biz.slug;
                const totalTX = biz._count.poolTransactions;
                const hasData = biz._count.clients > 0;

                return (
                  <Link
                    key={biz.id}
                    href={biz.slug === "nexup" ? "/office/nexup/dashboard" : biz.slug === "rebound" ? "/office/rebound/dashboard" : `/office/${biz.slug}`}
                    style={{ textDecoration: "none" }}
                  >
                    <div
                      onMouseEnter={() => setHoveredSlug(biz.slug)}
                      onMouseLeave={() => setHoveredSlug(null)}
                      style={{
                        borderRadius: 20,
                        overflow: "hidden",
                        cursor: "pointer",
                        transition: "all 0.3s ease",
                        border: `2px solid ${isHovered ? config.color : "var(--border)"}`,
                        transform: isHovered ? "translateY(-8px)" : "translateY(0)",
                        boxShadow: isHovered ? `0 24px 48px ${config.color}25` : "0 1px 3px rgba(0,0,0,0.2)",
                        background: "var(--surface)",
                      }}
                    >
                      {/* Gradient Header */}
                      <div style={{
                        background: config.gradient,
                        padding: "32px 28px 28px",
                        color: "#fff",
                        position: "relative",
                        overflow: "hidden",
                        minHeight: 140,
                      }}>
                        {/* Decorative circles */}
                        <div style={{ position: "absolute", top: -50, left: -50, width: 160, height: 160, borderRadius: "50%", background: "rgba(255,255,255,0.1)" }} />
                        <div style={{ position: "absolute", bottom: -60, right: -40, width: 120, height: 120, borderRadius: "50%", background: "rgba(255,255,255,0.07)" }} />
                        <div style={{ position: "absolute", top: 15, right: 80, width: 70, height: 70, borderRadius: "50%", background: "rgba(255,255,255,0.05)" }} />

                        <div style={{ display: "flex", alignItems: "flex-start", gap: 16, position: "relative", zIndex: 1 }}>
                          <div style={{
                            width: 60, height: 60, borderRadius: 18,
                            background: "rgba(255,255,255,0.2)",
                            display: "flex", alignItems: "center", justifyContent: "center",
                            backdropFilter: "blur(8px)",
                            border: "1px solid rgba(255,255,255,0.15)",
                            flexShrink: 0,
                          }}>
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" width={30} height={30}>
                              <path d={config.iconPath} />
                            </svg>
                          </div>
                          <div style={{ flex: 1 }}>
                            <div style={{ fontSize: 28, fontWeight: 800, letterSpacing: "-0.02em", marginBottom: 4 }}>{biz.name}</div>
                            <div style={{ fontSize: 14, opacity: 0.95, fontWeight: 600 }}>{config.descAr}</div>
                            <div style={{ fontSize: 12, opacity: 0.7, marginTop: 2 }}>{config.desc}</div>
                          </div>
                        </div>
                      </div>

                      {/* Stats Body */}
                      <div style={{ padding: "24px 28px 28px" }}>
                        {/* 3 stat boxes */}
                        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10, marginBottom: 20 }}>
                          {[
                            { labelAr: "العملاء", labelEn: "Clients", value: biz._count.clients, color: "#8b5cf6" },
                            { labelAr: "المشاريع", labelEn: "Projects", value: biz._count.projectRecords, color: "#3b82f6" },
                            { labelAr: "المعاملات", labelEn: "TX", value: totalTX, color: "#10b981" },
                          ].map((s) => (
                            <div key={s.labelAr} style={{
                              textAlign: "center", padding: "14px 8px", borderRadius: 12,
                              background: "var(--surface-hover)", transition: "all 0.2s",
                            }}>
                              <div style={{ fontSize: 26, fontWeight: 800, color: s.color, lineHeight: 1 }}>{s.value}</div>
                              <div style={{ fontSize: 11, color: "var(--muted)", fontWeight: 600, marginTop: 6 }}>{s.labelAr}</div>
                              <div style={{ fontSize: 9, color: "var(--muted)", opacity: 0.6, marginTop: 1 }}>{s.labelEn}</div>
                            </div>
                          ))}
                        </div>

                        {/* Currency + Status */}
                        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
                          <span style={{
                            padding: "6px 14px", borderRadius: 10,
                            background: config.color + "12", color: config.color,
                            fontSize: 12, fontWeight: 700,
                            border: `1px solid ${config.color}25`,
                          }}>
                            {biz.currencyMode === "SAR_TO_EGP" ? "SAR → EGP" : "EGP Direct"}
                          </span>
                          {!hasData && (
                            <span style={{ fontSize: 11, color: "var(--muted)", fontWeight: 500, opacity: 0.7 }}>
                              جاهز للاستخدام
                            </span>
                          )}
                          {hasData && (
                            <span style={{
                              fontSize: 11, fontWeight: 600, padding: "4px 10px", borderRadius: 8,
                              background: "rgba(16,185,129,0.1)", color: "#10b981",
                            }}>
                              نشط ●
                            </span>
                          )}
                        </div>

                        {/* Open Button */}
                        <div style={{
                          padding: "14px 20px",
                          background: isHovered ? config.color : "var(--surface-hover)",
                          borderRadius: 12,
                          color: isHovered ? "#fff" : config.color,
                          fontWeight: 700,
                          fontSize: 14,
                          textAlign: "center",
                          transition: "all 0.25s",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          gap: 10,
                          border: isHovered ? "none" : `1px solid ${config.color}25`,
                        }}>
                          فتح نظام {biz.slug === "nexup" ? "NEXUP" : biz.name}
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" width="16" height="16" style={{ transform: "scaleX(-1)" }}>
                            <path d="M19 12H5M12 19l-7-7 7-7" />
                          </svg>
                        </div>
                      </div>
                    </div>
                  </Link>
                );
              })}
            </div>
          </>
        )}
      </div>
    </AppShell>
  );
}
