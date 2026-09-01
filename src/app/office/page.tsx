"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { AppShell } from "@/components/app-shell";

type Business = {
  id: string;
  name: string;
  slug: string;
  currencyMode: string;
  _count: { clients: number; projectRecords: number; poolTransactions: number; expenses: number };
};

type OfficeStats = {
  totalRevenue: number;
  totalRevenueSAR: number;
  totalRevenueEGP: number;
  totalExpenses: number;
  totalClients: number;
  totalProjects: number;
  perBusinessRevenue: Record<string, number>;
};

type OfficeTreasury = {
  balance: number;
  cashCapital: number;
  profitTransfers: number;
  officeExpenses: number;
};

type UserPermissions = {
  canAccessNexup: boolean;
  canAccessRebound: boolean;
  canAccessAbomazen: boolean;
  canAccessOffice: boolean;
  isSuperAdmin: boolean;
};

function formatNum(n: number) {
  return n.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}

const BUSINESS_CONFIG: Record<string, { color: string; gradient: string; descAr: string; desc: string; iconPath: string }> = {
  nexup: {
    color: "#0d9488",
    gradient: "linear-gradient(135deg, #0d9488 0%, #14b8a6 50%, #2dd4bf 100%)",
    descAr: "تصميم جرافيك وهوية بصرية",
    desc: "Graphic Design & Visual Identity",
    iconPath: "M12 19l7-7 3 3-7 7-3-3z M18 13l-1.5-7.5L2 2l3.5 14.5L13 18l5-5z M2 2l7.586 7.586",
  },
  rebound: {
    color: "#3b82f6",
    gradient: "linear-gradient(135deg, #3b82f6 0%, #60a5fa 50%, #93c5fd 100%)",
    descAr: "تسويق رقمي وطباعة",
    desc: "Digital Marketing & Printing",
    iconPath: "M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z M8 10h0 M12 10h0 M16 10h0",
  },
  abomazen: {
    color: "#8b5cf6",
    gradient: "linear-gradient(135deg, #8b5cf6 0%, #a78bfa 50%, #c4b5fd 100%)",
    descAr: "تسويق عقاري",
    desc: "Real Estate Marketing",
    iconPath: "M3 21h18 M5 21V7l7-4 7 4v14 M9 21v-6h6v6",
  },
};

const BUSINESS_HREF: Record<string, string> = {
  nexup: "/office/nexup/dashboard",
  rebound: "/office/rebound/dashboard",
  abomazen: "/office/abomazen/dashboard",
};

export default function OfficePage() {
  const [businesses, setBusinesses] = useState<Business[]>([]);
  const [stats, setStats] = useState<OfficeStats | null>(null);
  const [treasury, setTreasury] = useState<OfficeTreasury | null>(null);
  const [permissions, setPermissions] = useState<UserPermissions | null>(null);
  const [loading, setLoading] = useState(true);
  const [hoveredSlug, setHoveredSlug] = useState<string | null>(null);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const res = await fetch("/api/office/stats");
        if (res.ok) {
          const data = await res.json();
          const sorted = data.businesses.sort((a: Business, b: Business) =>
            ["nexup", "rebound", "abomazen"].indexOf(a.slug) - ["nexup", "rebound", "abomazen"].indexOf(b.slug)
          );
          setBusinesses(sorted);
          setStats(data.stats);
          setTreasury(data.officeTreasury);
          setPermissions(data.userPermissions);
        }
      } catch { /* ignore */ }
      setLoading(false);
    };
    fetchData();
  }, []);

  const accessibleSystems = businesses.length;
  const perms = permissions;

  return (
    <AppShell isAdmin={true} userName={perms?.isSuperAdmin ? "Super Admin" : "Admin"} activePage="office">
      <div style={{ direction: "rtl" }}>
        {/* Page Header */}
        <div style={{ marginBottom: 36 }}>
          <h1 style={{ fontSize: 30, fontWeight: 800, color: "var(--text)", margin: 0, letterSpacing: "-0.02em" }}>
            {perms?.isSuperAdmin ? "لوحة تحكم المكتب" : "لوحة التحكم"}
          </h1>
          <p style={{ fontSize: 14, color: "var(--muted)", margin: "8px 0 0", fontWeight: 500 }}>
            {perms?.isSuperAdmin
              ? "إدارة شاملة لجميع الأنشطة من مكان واحد"
              : `الوصول إلى ${accessibleSystems} ${accessibleSystems === 1 ? "نظام" : "أنظمة"} من أصل 3`}
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
            {/* ═══ Stat Cards — only for super admin ═══ */}
            {perms?.isSuperAdmin && stats && (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(6, 1fr)", gap: 14, marginBottom: 28 }}>
                {[
                  { label: "إجمالي العملاء", value: String(stats.totalClients), color: "#8b5cf6", bg: "rgba(139,92,246,0.12)", icon: "M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2 M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z" },
                  { label: "إجمالي المشاريع", value: String(stats.totalProjects), color: "#3b82f6", bg: "rgba(59,130,246,0.12)", icon: "M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" },
                  ...businesses.map(b => {
                    const revenue = stats.perBusinessRevenue?.[b.id] ?? 0;
                    const cfg = BUSINESS_CONFIG[b.slug];
                    return {
                      label: `إيرادات ${b.name}`,
                      value: b.currencyMode === "SAR_TO_EGP" ? `${formatNum(revenue)} SAR` : `${formatNum(revenue)} EGP`,
                      color: cfg?.color || "#6b7280",
                      bg: (cfg?.color || "#6b7280") + "14",
                      icon: "M12 1v22M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6",
                    };
                  }),
                  { label: "إجمالي المصروفات", value: `${formatNum(stats.totalExpenses)} EGP`, color: "#ef4444", bg: "rgba(239,68,68,0.12)", icon: "M9 5H2v7l6.29 6.29c.94.94 2.48.94 3.42 0l3.58-3.58c.94-.94.94-2.48 0-3.42L9 5z" },
                ].map((s) => (
                  <div key={s.label} style={{
                    padding: "18px 16px", borderRadius: 14,
                    background: "var(--surface)", border: "1px solid var(--border)",
                    display: "flex", alignItems: "center", gap: 12,
                    boxShadow: "0 1px 3px rgba(0,0,0,0.2)",
                  }}>
                    <div style={{
                      width: 44, height: 44, borderRadius: 12,
                      background: s.bg, color: s.color,
                      display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
                    }}>
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" width={20} height={20}>
                        <path d={s.icon} />
                      </svg>
                    </div>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 22, fontWeight: 800, color: "var(--text)", lineHeight: 1.1, direction: "ltr", textAlign: "right" }}>{s.value}</div>
                      <div style={{ fontSize: 11, color: "var(--muted)", fontWeight: 600, marginTop: 4 }}>{s.label}</div>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* ═══ Non-super-admin: compact stat summary ═══ */}
            {!perms?.isSuperAdmin && stats && (
              <div style={{ display: "grid", gridTemplateColumns: accessibleSystems <= 2 ? "repeat(2, 1fr)" : "repeat(3, 1fr)", gap: 16, marginBottom: 28 }}>
                <div style={{ padding: "20px 24px", borderRadius: 16, background: "var(--surface)", border: "1px solid var(--border)", display: "flex", alignItems: "center", gap: 14 }}>
                  <div style={{ width: 44, height: 44, borderRadius: 12, background: "rgba(16,185,129,0.12)", color: "#10b981", display: "flex", alignItems: "center", justifyContent: "center" }}>
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} width={20} height={20}><path d="M12 1v22M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" /></svg>
                  </div>
                  <div>
                    <div style={{ fontSize: 24, fontWeight: 800, color: "var(--text)", direction: "ltr" }}>{formatNum(stats.totalRevenue)} SAR</div>
                    <div style={{ fontSize: 12, color: "var(--muted)" }}>إجمالي الإيرادات</div>
                  </div>
                </div>
                <div style={{ padding: "20px 24px", borderRadius: 16, background: "var(--surface)", border: "1px solid var(--border)", display: "flex", alignItems: "center", gap: 14 }}>
                  <div style={{ width: 44, height: 44, borderRadius: 12, background: "rgba(59,130,246,0.12)", color: "#3b82f6", display: "flex", alignItems: "center", justifyContent: "center" }}>
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} width={20} height={20}><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" /></svg>
                  </div>
                  <div>
                    <div style={{ fontSize: 24, fontWeight: 800, color: "var(--text)" }}>{stats.totalProjects}</div>
                    <div style={{ fontSize: 12, color: "var(--muted)" }}>إجمالي المشاريع</div>
                  </div>
                </div>
                <div style={{ padding: "20px 24px", borderRadius: 16, background: "var(--surface)", border: "1px solid var(--border)", display: "flex", alignItems: "center", gap: 14 }}>
                  <div style={{ width: 44, height: 44, borderRadius: 12, background: "rgba(139,92,246,0.12)", color: "#8b5cf6", display: "flex", alignItems: "center", justifyContent: "center" }}>
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} width={20} height={20}><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2 M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z" /></svg>
                  </div>
                  <div>
                    <div style={{ fontSize: 24, fontWeight: 800, color: "var(--text)" }}>{stats.totalClients}</div>
                    <div style={{ fontSize: 12, color: "var(--muted)" }}>إجمالي العملاء</div>
                  </div>
                </div>
              </div>
            )}

            {/* ═══ Office Management Banner — super admin or office finance access ═══ */}
            {perms?.canAccessOffice && (
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
                  <div style={{ position: "absolute", top: -60, right: -60, width: 200, height: 200, borderRadius: "50%", background: "rgba(139,92,246,0.08)" }} />
                  <div style={{ position: "absolute", bottom: -40, left: -40, width: 160, height: 160, borderRadius: "50%", background: "rgba(59,130,246,0.06)" }} />
                  <div style={{ padding: "36px 40px", position: "relative", zIndex: 1 }}>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
                        <div style={{
                          width: 64, height: 64, borderRadius: 18,
                          background: "linear-gradient(135deg, #8b5cf6, #6366f1, #3b82f6)",
                          display: "flex", alignItems: "center", justifyContent: "center",
                          boxShadow: "0 8px 24px rgba(139,92,246,0.4)", flexShrink: 0,
                        }}>
                          <svg viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" width={32} height={32}>
                            <path d="M3 21h18M9 3h6M12 3v7M5 21V7l7-4 7 4v14M9 21v-4h6v4" />
                          </svg>
                        </div>
                        <div>
                          <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 6 }}>
                            <span style={{ fontSize: 22, fontWeight: 800, color: "#fff" }}>إدارة المكتب</span>
                            <span style={{ padding: "4px 12px", borderRadius: 8, background: "rgba(139,92,246,0.2)", border: "1px solid rgba(139,92,246,0.3)", fontSize: 12, fontWeight: 600, color: "#a78bfa" }}>Office Management</span>
                          </div>
                          <div style={{ fontSize: 14, color: "rgba(255,255,255,0.6)", fontWeight: 500 }}>
                            الشركاء · المصاريف · رأس المال · التوزيع · تحويل الأرباح
                          </div>
                        </div>
                      </div>
                      <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "14px 28px", borderRadius: 14, background: "rgba(139,92,246,0.15)", border: "1px solid rgba(139,92,246,0.3)" }}>
                        <span style={{ fontSize: 15, color: "#c4b5fd", fontWeight: 700 }}>دخول</span>
                        <div style={{ width: 36, height: 36, borderRadius: 10, background: "linear-gradient(135deg, #8b5cf6, #6366f1)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                          <svg viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" width="16" height="16" style={{ transform: "scaleX(-1)" }}>
                            <path d="M19 12H5M12 19l-7-7 7-7" />
                          </svg>
                        </div>
                      </div>
                    </div>
                    {/* Treasury quick glance */}
                    {treasury && (
                      <div style={{ display: "flex", gap: 20, marginTop: 20, paddingTop: 20, borderTop: "1px solid rgba(255,255,255,0.08)" }}>
                        {[
                          { label: "رصيد الخزينة", value: `${formatNum(treasury.balance)} EGP`, color: treasury.balance >= 0 ? "#10b981" : "#ef4444" },
                          { label: "رأس المال", value: `${formatNum(treasury.cashCapital)} EGP`, color: "#60a5fa" },
                          { label: "تحويلات الأرباح", value: `${formatNum(treasury.profitTransfers)} EGP`, color: "#a78bfa" },
                          { label: "المصروفات", value: `${formatNum(treasury.officeExpenses)} EGP`, color: "#f97316" },
                        ].map(item => (
                          <div key={item.label} style={{ flex: 1 }}>
                            <div style={{ fontSize: 11, color: "rgba(255,255,255,0.4)", marginBottom: 4 }}>{item.label}</div>
                            <div style={{ fontSize: 18, fontWeight: 700, color: item.color, direction: "ltr", textAlign: "right" }}>{item.value}</div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </Link>
            )}

            {/* ═══ Business Cards — only accessible ones ═══ */}
            {businesses.length > 0 && (
              <>
                <div style={{ marginBottom: 20 }}>
                  <h2 style={{ fontSize: 18, fontWeight: 700, color: "var(--text)", marginBottom: 0 }}>
                    {perms?.isSuperAdmin ? "الأنشطة التجارية" : "الأنظمة المتاحة"}
                    <span style={{ fontSize: 13, fontWeight: 500, color: "var(--muted)", marginInlineStart: 12 }}>
                      {perms?.isSuperAdmin ? "Your Businesses" : `${accessibleSystems} System${accessibleSystems > 1 ? "s" : ""}`}
                    </span>
                  </h2>
                </div>

                <div style={{ display: "grid", gridTemplateColumns: accessibleSystems === 1 ? "1fr" : accessibleSystems === 2 ? "repeat(2, 1fr)" : "repeat(3, 1fr)", gap: 20 }}>
                  {businesses.map((biz) => {
                    const config = BUSINESS_CONFIG[biz.slug] || { color: "#6b7280", gradient: "linear-gradient(135deg, #6b7280, #9ca3af)", descAr: "نشاط تجاري", desc: "Business", iconPath: "M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" };
                    const isHovered = hoveredSlug === biz.slug;
                    const totalTX = biz._count.poolTransactions;
                    const hasData = biz._count.clients > 0;

                    return (
                      <Link key={biz.id} href={BUSINESS_HREF[biz.slug] || "/office"} style={{ textDecoration: "none" }}>
                        <div
                          onMouseEnter={() => setHoveredSlug(biz.slug)}
                          onMouseLeave={() => setHoveredSlug(null)}
                          style={{
                            borderRadius: 20, overflow: "hidden", cursor: "pointer",
                            transition: "all 0.3s ease",
                            border: `2px solid ${isHovered ? config.color : "var(--border)"}`,
                            transform: isHovered ? "translateY(-8px)" : "translateY(0)",
                            boxShadow: isHovered ? `0 24px 48px ${config.color}25` : "0 1px 3px rgba(0,0,0,0.2)",
                            background: "var(--surface)",
                          }}
                        >
                          {/* Gradient Header */}
                          <div style={{
                            background: config.gradient, padding: "32px 28px 28px", color: "#fff",
                            position: "relative", overflow: "hidden", minHeight: 140,
                          }}>
                            <div style={{ position: "absolute", top: -50, left: -50, width: 160, height: 160, borderRadius: "50%", background: "rgba(255,255,255,0.1)" }} />
                            <div style={{ position: "absolute", bottom: -60, right: -40, width: 120, height: 120, borderRadius: "50%", background: "rgba(255,255,255,0.07)" }} />
                            <div style={{ display: "flex", alignItems: "flex-start", gap: 16, position: "relative", zIndex: 1 }}>
                              <div style={{ width: 60, height: 60, borderRadius: 18, background: "rgba(255,255,255,0.2)", display: "flex", alignItems: "center", justifyContent: "center", backdropFilter: "blur(8px)", border: "1px solid rgba(255,255,255,0.15)", flexShrink: 0 }}>
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
                            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10, marginBottom: 20 }}>
                              {[
                                { labelAr: "العملاء", value: biz._count.clients, color: "#8b5cf6" },
                                { labelAr: "المشاريع", value: biz._count.projectRecords, color: "#3b82f6" },
                                { labelAr: "المعاملات", value: totalTX, color: "#10b981" },
                              ].map((s) => (
                                <div key={s.labelAr} style={{ textAlign: "center", padding: "14px 8px", borderRadius: 12, background: "var(--surface-hover)" }}>
                                  <div style={{ fontSize: 26, fontWeight: 800, color: s.color, lineHeight: 1 }}>{s.value}</div>
                                  <div style={{ fontSize: 11, color: "var(--muted)", fontWeight: 600, marginTop: 6 }}>{s.labelAr}</div>
                                </div>
                              ))}
                            </div>

                            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
                              <span style={{ padding: "6px 14px", borderRadius: 10, background: config.color + "12", color: config.color, fontSize: 12, fontWeight: 700, border: `1px solid ${config.color}25` }}>
                                {biz.currencyMode === "SAR_TO_EGP" ? "SAR → EGP" : "EGP Direct"}
                              </span>
                              {!hasData && <span style={{ fontSize: 11, color: "var(--muted)", fontWeight: 500, opacity: 0.7 }}>جاهز للاستخدام</span>}
                              {hasData && <span style={{ fontSize: 11, fontWeight: 600, padding: "4px 10px", borderRadius: 8, background: "rgba(16,185,129,0.1)", color: "#10b981" }}>نشط ●</span>}
                            </div>

                            <div style={{
                              padding: "14px 20px",
                              background: isHovered ? config.color : "var(--surface-hover)",
                              borderRadius: 12,
                              color: isHovered ? "#fff" : config.color,
                              fontWeight: 700, fontSize: 14, textAlign: "center", transition: "all 0.25s",
                              display: "flex", alignItems: "center", justifyContent: "center", gap: 10,
                              border: isHovered ? "none" : `1px solid ${config.color}25`,
                            }}>
                              فتح نظام {biz.name}
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

            {/* No systems accessible */}
            {businesses.length === 0 && !loading && (
              <div style={{ textAlign: "center", padding: "80px 20px", color: "var(--muted)" }}>
                <div style={{ fontSize: 48, marginBottom: 16 }}>🔒</div>
                <div style={{ fontSize: 18, fontWeight: 700, color: "var(--text)", marginBottom: 8 }}>لا يوجد أنظمة متاحة</div>
                <div style={{ fontSize: 14 }}>لم يتم تخصيص أي نظام لك. تواصل مع المدير للحصول على صلاحيات.</div>
              </div>
            )}

            {/* ═══ Admin-only: User Management Link ═══ */}
            {perms?.isSuperAdmin && (
              <div style={{ marginTop: 32, display: "flex", gap: 16 }}>
                <Link href="/office/admin/users" style={{ textDecoration: "none" }}>
                  <div style={{
                    padding: "16px 28px", borderRadius: 14,
                    background: "var(--surface)", border: "1px solid var(--border)",
                    display: "flex", alignItems: "center", gap: 12,
                    cursor: "pointer", transition: "all 0.2s",
                  }}
                    onMouseEnter={e => { e.currentTarget.style.borderColor = "#60a5fa"; e.currentTarget.style.transform = "translateY(-2px)"; }}
                    onMouseLeave={e => { e.currentTarget.style.borderColor = "var(--border)"; e.currentTarget.style.transform = "translateY(0)"; }}
                  >
                    <div style={{ width: 40, height: 40, borderRadius: 10, background: "rgba(96,165,250,0.12)", color: "#60a5fa", display: "flex", alignItems: "center", justifyContent: "center" }}>
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} width={18} height={18}>
                        <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2 M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z M23 21v-2a4 4 0 0 0-3-3.87 M16 3.13a4 4 0 0 1 0 7.75" />
                      </svg>
                    </div>
                    <div>
                      <div style={{ fontSize: 14, fontWeight: 700, color: "var(--text)" }}>إدارة المستخدمين</div>
                      <div style={{ fontSize: 11, color: "var(--muted)" }}>Users Management</div>
                    </div>
                  </div>
                </Link>
              </div>
            )}
          </>
        )}
      </div>
    </AppShell>
  );
}
