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

const BUSINESS_CONFIG: Record<string, { color: string; icon: string; desc: string }> = {
  nexup: { color: "#0d9488", icon: "🎨", desc: "Graphic design & visual identity services" },
  rebound: { color: "#3b82f6", icon: "📱", desc: "Digital marketing & printing services" },
  abomazen: { color: "#8b5cf6", icon: "🚀", desc: "Digital marketing & e-commerce" },
};

export default function OfficePage() {
  const [businesses, setBusinesses] = useState<Business[]>([]);
  const [stats, setStats] = useState<OfficeStats | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const res = await fetch("/api/office/stats");
        if (res.ok) {
          const data = await res.json();
          setBusinesses(data.businesses);
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
                { label: "Total Clients", value: stats.totalClients, color: "#8b5cf6" },
                { label: "Total Projects", value: stats.totalProjects, color: "#3b82f6" },
                { label: "Total Revenue (EGP)", value: `${formatNum(stats.totalRevenue)} EGP`, color: "#10b981" },
                { label: "Total Expenses (EGP)", value: `${formatNum(stats.totalExpenses)} EGP`, color: "#ef4444" },
              ].map((s) => (
                <div key={s.label} className="card" style={{ padding: "20px 24px" }}>
                  <div style={{ fontSize: 28, fontWeight: 800, color: s.color }}>{s.value}</div>
                  <div style={{ fontSize: 13, color: "var(--muted)", marginTop: 4 }}>{s.label}</div>
                </div>
              ))}
            </div>
          )}

          {/* Business Cards */}
          <h2 style={{ fontSize: 18, fontWeight: 700, color: "var(--text)", marginBottom: 16 }}>
            Your Businesses
          </h2>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: 20 }}>
            {businesses.map((biz) => {
              const config = BUSINESS_CONFIG[biz.slug] || { color: "#6b7280", icon: "🏢", desc: "Business" };
              return (
                <Link
                  key={biz.id}
                  href={`/office/${biz.slug}`}
                  style={{ textDecoration: "none" }}
                >
                  <div
                    className="card"
                    style={{
                      padding: 0,
                      overflow: "hidden",
                      cursor: "pointer",
                      transition: "all 0.2s",
                      border: `2px solid transparent`,
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.borderColor = config.color;
                      e.currentTarget.style.transform = "translateY(-4px)";
                      e.currentTarget.style.boxShadow = "0 12px 24px rgba(0,0,0,0.12)";
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.borderColor = "transparent";
                      e.currentTarget.style.transform = "translateY(0)";
                      e.currentTarget.style.boxShadow = "";
                    }}
                  >
                    {/* Color Header */}
                    <div style={{
                      background: config.color,
                      padding: "20px 24px",
                      color: "#fff",
                      display: "flex",
                      alignItems: "center",
                      gap: 12,
                    }}>
                      <span style={{ fontSize: 32 }}>{config.icon}</span>
                      <div>
                        <div style={{ fontSize: 22, fontWeight: 800 }}>{biz.name}</div>
                        <div style={{ fontSize: 12, opacity: 0.85 }}>{config.desc}</div>
                      </div>
                    </div>

                    {/* Stats */}
                    <div style={{ padding: "20px 24px" }}>
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
                        <div>
                          <div style={{ fontSize: 24, fontWeight: 700, color: "var(--text)" }}>
                            {biz._count.clients}
                          </div>
                          <div style={{ fontSize: 12, color: "var(--muted)" }}>Clients</div>
                        </div>
                        <div>
                          <div style={{ fontSize: 24, fontWeight: 700, color: "var(--text)" }}>
                            {biz._count.projectRecords}
                          </div>
                          <div style={{ fontSize: 12, color: "var(--muted)" }}>Projects</div>
                        </div>
                        <div>
                          <div style={{ fontSize: 24, fontWeight: 700, color: "var(--text)" }}>
                            {biz._count.poolTransactions}
                          </div>
                          <div style={{ fontSize: 12, color: "var(--muted)" }}>Transactions</div>
                        </div>
                        <div>
                          <div style={{ fontSize: 24, fontWeight: 700, color: "var(--text)" }}>
                            {biz.currencyMode === "SAR_TO_EGP" ? "SAR→EGP" : "EGP"}
                          </div>
                          <div style={{ fontSize: 12, color: "var(--muted)" }}>Currency</div>
                        </div>
                      </div>

                      <div style={{
                        marginTop: 16,
                        padding: "10px 16px",
                        background: config.color + "12",
                        borderRadius: 8,
                        color: config.color,
                        fontWeight: 600,
                        fontSize: 14,
                        textAlign: "center",
                      }}>
                        Open {biz.name} →
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
