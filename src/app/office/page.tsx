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

/* ─── Business Config: NEXUP (right) → REBOUND (middle) → ABOMAZEN (left) in RTL ─── */
const BUSINESS_ORDER = ["nexup", "rebound", "abomazen"];

const BUSINESS_CONFIG: Record<string, { color: string; gradient: string; desc: string; iconPath: string }> = {
  nexup: {
    color: "#0d9488",
    gradient: "linear-gradient(135deg, #0d9488 0%, #14b8a6 100%)",
    desc: "Graphic design & visual identity",
    iconPath: "M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5", // design/layers icon
  },
  rebound: {
    color: "#3b82f6",
    gradient: "linear-gradient(135deg, #3b82f6 0%, #60a5fa 100%)",
    desc: "Digital marketing & printing",
    iconPath: "M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9M13.73 21a2 2 0 0 1-3.46 0", // megaphone
  },
  abomazen: {
    color: "#8b5cf6",
    gradient: "linear-gradient(135deg, #8b5cf6 0%, #a78bfa 100%)",
    desc: "Real estate marketing",
    iconPath: "M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z M9 22V12h6v10", // building/home
  },
};

/* ─── SVG Icon Component ─── */
function BizIcon({ path, size = 28 }: { path: string; size?: number }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" width={size} height={size}>
      <path d={path} />
    </svg>
  );
}

/* ─── Small stat icon ─── */
function MiniIcon({ d }: { d: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" width="16" height="16">
      <path d={d} />
    </svg>
  );
}

const miniIcons = {
  clients: "M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2 M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z",
  projects: "M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z",
  transactions: "M12 1v22M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6",
  currency: "M12 1v22M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6",
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
          // Sort businesses by defined order
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
      {/* Page Header */}
      <div style={{ marginBottom: 32 }}>
        <h1 style={{ fontSize: 28, fontWeight: 800, color: "var(--text)", margin: 0 }}>
          Office Dashboard
        </h1>
        <p style={{ fontSize: 14, color: "var(--muted)", margin: "6px 0 0" }}>
          Manage all your businesses from one place
        </p>
      </div>

      {loading ? (
        <div className="empty-state">
          <div className="empty-state-icon">⏳</div>
          <p>Loading...</p>
        </div>
      ) : (
        <>
          {/* Office Overview Stats */}
          {stats && (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 16, marginBottom: 32 }}>
              {[
                { label: "Total Clients", value: stats.totalClients, color: "#8b5cf6", icon: miniIcons.clients },
                { label: "Total Projects", value: stats.totalProjects, color: "#3b82f6", icon: miniIcons.projects },
                { label: "Total Revenue", value: `${formatNum(stats.totalRevenue)} SAR`, color: "#10b981", icon: miniIcons.transactions },
                { label: "Total Expenses", value: `${formatNum(stats.totalExpenses)} EGP`, color: "#ef4444", icon: miniIcons.currency },
              ].map((s) => (
                <div key={s.label} className="card" style={{ padding: "20px 24px", display: "flex", alignItems: "center", gap: 16 }}>
                  <div style={{
                    width: 44, height: 44, borderRadius: 12,
                    background: s.color + "15", color: s.color,
                    display: "flex", alignItems: "center", justifyContent: "center",
                  }}>
                    <MiniIcon d={s.icon} />
                  </div>
                  <div>
                    <div style={{ fontSize: 24, fontWeight: 800, color: "var(--text)" }}>{s.value}</div>
                    <div style={{ fontSize: 12, color: "var(--muted)" }}>{s.label}</div>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Business Cards */}
          <h2 style={{ fontSize: 18, fontWeight: 700, color: "var(--text)", marginBottom: 20 }}>
            Your Businesses
          </h2>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 20 }}>
            {businesses.map((biz) => {
              const config = BUSINESS_CONFIG[biz.slug] || { color: "#6b7280", gradient: "linear-gradient(135deg, #6b7280, #9ca3af)", desc: "Business", iconPath: "M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" };
              const isHovered = hoveredSlug === biz.slug;
              const totalStats = biz._count.clients + biz._count.projectRecords + biz._count.poolTransactions;

              return (
                <Link
                  key={biz.id}
                  href={`/office/${biz.slug}`}
                  style={{ textDecoration: "none" }}
                >
                  <div
                    onMouseEnter={() => setHoveredSlug(biz.slug)}
                    onMouseLeave={() => setHoveredSlug(null)}
                    style={{
                      borderRadius: 16,
                      overflow: "hidden",
                      cursor: "pointer",
                      transition: "all 0.25s ease",
                      border: `2px solid ${isHovered ? config.color : "var(--border)"}`,
                      transform: isHovered ? "translateY(-6px)" : "translateY(0)",
                      boxShadow: isHovered ? `0 16px 32px ${config.color}25` : "var(--card-shadow)",
                      background: "var(--surface)",
                    }}
                  >
                    {/* Gradient Header */}
                    <div style={{
                      background: config.gradient,
                      padding: "28px 24px",
                      color: "#fff",
                      position: "relative",
                      overflow: "hidden",
                    }}>
                      {/* Decorative circle */}
                      <div style={{
                        position: "absolute", top: -30, left: -30,
                        width: 120, height: 120, borderRadius: "50%",
                        background: "rgba(255,255,255,0.1)",
                      }} />
                      <div style={{
                        position: "absolute", bottom: -40, right: -20,
                        width: 80, height: 80, borderRadius: "50%",
                        background: "rgba(255,255,255,0.08)",
                      }} />

                      <div style={{ display: "flex", alignItems: "center", gap: 14, position: "relative", zIndex: 1 }}>
                        <div style={{
                          width: 52, height: 52, borderRadius: 14,
                          background: "rgba(255,255,255,0.2)",
                          display: "flex", alignItems: "center", justifyContent: "center",
                          backdropFilter: "blur(4px)",
                        }}>
                          <BizIcon path={config.iconPath} size={28} />
                        </div>
                        <div>
                          <div style={{ fontSize: 24, fontWeight: 800, letterSpacing: "-0.02em" }}>{biz.name}</div>
                          <div style={{ fontSize: 13, opacity: 0.85, marginTop: 2 }}>{config.desc}</div>
                        </div>
                      </div>
                    </div>

                    {/* Stats Body */}
                    <div style={{ padding: "20px 24px" }}>
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12, marginBottom: 16 }}>
                        {[
                          { label: "Clients", value: biz._count.clients, color: "#8b5cf6" },
                          { label: "Projects", value: biz._count.projectRecords, color: "#3b82f6" },
                          { label: "TX", value: biz._count.poolTransactions, color: "#10b981" },
                        ].map((s) => (
                          <div key={s.label} style={{ textAlign: "center" }}>
                            <div style={{ fontSize: 22, fontWeight: 700, color: s.color }}>{s.value}</div>
                            <div style={{ fontSize: 11, color: "var(--muted)" }}>{s.label}</div>
                          </div>
                        ))}
                      </div>

                      {/* Currency Badge */}
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
                        <span style={{
                          padding: "4px 10px", borderRadius: 8,
                          background: config.color + "15", color: config.color,
                          fontSize: 12, fontWeight: 700,
                        }}>
                          {biz.currencyMode === "SAR_TO_EGP" ? "SAR → EGP" : "EGP Direct"}
                        </span>
                        {totalStats === 0 && (
                          <span style={{ fontSize: 11, color: "var(--muted)", fontStyle: "italic" }}>
                            Empty — ready to use
                          </span>
                        )}
                      </div>

                      {/* Open Button */}
                      <div style={{
                        padding: "11px 16px",
                        background: isHovered ? config.color : "var(--surface-hover)",
                        borderRadius: 10,
                        color: isHovered ? "#fff" : config.color,
                        fontWeight: 700,
                        fontSize: 14,
                        textAlign: "center",
                        transition: "all 0.2s",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        gap: 8,
                      }}>
                        Open {biz.name}
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
    </AppShell>
  );
}
