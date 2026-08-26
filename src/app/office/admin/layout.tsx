"use client";

import { useEffect, useState } from "react";
import { AdminSidebar } from "@/components/admin-sidebar";

type TreasuryData = {
  balance: number;
  totalRevenue: number;
  totalExpenses: number;
  netProfit: number;
  // Monthly data
  monthlyRevenue: number;
  monthlyExpenses: number;
  monthlyNetProfit: number;
  currentMonth: string;
};

function fmt(n: number) {
  return Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const [treasury, setTreasury] = useState<TreasuryData | null>(null);

  useEffect(() => {
    fetch("/api/office/admin-stats")
      .then(r => r.json())
      .then(d => {
        if (d.officeTreasury) {
          const totalRevenue = d.officeTreasury.cashCapital + d.officeTreasury.profitTransfers;
          const totalExpenses = d.allTime?.totalExpenses || 0;
          // Monthly data (current month)
          const now = new Date();
          const currentMonth = now.toLocaleDateString("ar-EG", { month: "long", year: "numeric" });
          const monthlyRevenue = d.monthlyPartnerOutflows?.find((m: {month:number;year:number;total:number}) => m.month === now.getMonth()+1 && m.year === now.getFullYear())?.total || 0;
          const monthlyExpenses = d.currentMonth?.totalExpenses || 0;
          setTreasury({
            balance: d.officeTreasury.balance,
            totalRevenue,
            totalExpenses,
            netProfit: totalRevenue - totalExpenses,
            monthlyRevenue,
            monthlyExpenses,
            monthlyNetProfit: monthlyRevenue - monthlyExpenses,
            currentMonth,
          });
        }
      })
      .catch(() => {});
  }, []);

  return (
    <div style={{ display: "flex", minHeight: "100vh" }}>
      <AdminSidebar />
      <main style={{ flex: 1, overflow: "auto" }}>
        {/* ═══ Fixed Treasury Bar — appears on ALL admin pages ═══ */}
        <div style={{
          position: "sticky", top: 0, zIndex: 40,
          background: "var(--surface)",
          borderBottom: "1px solid var(--border)",
          boxShadow: "0 1px 4px rgba(0,0,0,0.15)",
        }}>
          <div style={{
            display: "grid", gridTemplateColumns: "1.3fr 1fr 1fr 1fr",
            maxWidth: 1440, margin: "0 auto", padding: "16px 28px", gap: 16,
          }}>
            {/* رصيد الخزينة — Main */}
            <div style={{
              display: "flex", alignItems: "center", gap: 14,
              padding: "14px 20px", borderRadius: 14,
              background: treasury && treasury.balance >= 0
                ? "rgba(16,185,129,0.08)"
                : "rgba(239,68,68,0.08)",
              border: `1px solid ${treasury && treasury.balance >= 0 ? "rgba(16,185,129,0.2)" : "rgba(239,68,68,0.2)"}`,
            }}>
              <div style={{
                width: 42, height: 42, borderRadius: 12,
                background: treasury && treasury.balance >= 0 ? "rgba(16,185,129,0.15)" : "rgba(239,68,68,0.15)",
                display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
              }}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={treasury && treasury.balance >= 0 ? "#10b981" : "#ef4444"} strokeWidth="2" strokeLinecap="round">
                  <rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 3v4M8 3v4M2 11h20"/>
                </svg>
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 11, color: "var(--muted)", fontWeight: 600 }}>رصيد الخزينة</div>
                <div style={{
                  fontSize: 24, fontWeight: 800, lineHeight: 1.1,
                  color: treasury && treasury.balance >= 0 ? "#10b981" : "#ef4444",
                  direction: "ltr",
                }}>
                  {treasury ? `${treasury.balance >= 0 ? "+" : "-"}${fmt(treasury.balance)} EGP` : "—"}
                </div>
              </div>
            </div>

            {/* توتال الإيرادات */}
            <div style={{
              display: "flex", alignItems: "center", gap: 14,
              padding: "14px 20px", borderRadius: 14,
              background: "rgba(59,130,246,0.06)",
              border: "1px solid rgba(59,130,246,0.15)",
            }}>
              <div style={{
                width: 42, height: 42, borderRadius: 12,
                background: "rgba(59,130,246,0.12)",
                display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
              }}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#3b82f6" strokeWidth="2" strokeLinecap="round">
                  <polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/>
                  <polyline points="17 6 23 6 23 12"/>
                </svg>
              </div>
              <div>
                <div style={{ fontSize: 11, color: "var(--muted)", fontWeight: 600 }}>إجمالي الدخل</div>
                <div style={{ fontSize: 22, fontWeight: 800, color: "#3b82f6", direction: "ltr", lineHeight: 1.1 }}>
                  {treasury ? `${fmt(treasury.totalRevenue)} EGP` : "—"}
                </div>
              </div>
            </div>

            {/* توتال المصروفات */}
            <div style={{
              display: "flex", alignItems: "center", gap: 14,
              padding: "14px 20px", borderRadius: 14,
              background: "rgba(239,68,68,0.06)",
              border: "1px solid rgba(239,68,68,0.15)",
            }}>
              <div style={{
                width: 42, height: 42, borderRadius: 12,
                background: "rgba(239,68,68,0.12)",
                display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
              }}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#ef4444" strokeWidth="2" strokeLinecap="round">
                  <polyline points="23 18 13.5 8.5 8.5 13.5 1 6"/>
                  <polyline points="17 18 23 18 23 12"/>
                </svg>
              </div>
              <div>
                <div style={{ fontSize: 11, color: "var(--muted)", fontWeight: 600 }}>إجمالي المصروفات</div>
                <div style={{ fontSize: 22, fontWeight: 800, color: "#ef4444", direction: "ltr", lineHeight: 1.1 }}>
                  {treasury ? `${fmt(treasury.totalExpenses)} EGP` : "—"}
                </div>
              </div>
            </div>

            {/* صافي الربح — Net Profit */}
            <div style={{
              display: "flex", alignItems: "center", gap: 14,
              padding: "14px 20px", borderRadius: 14,
              background: treasury && treasury.netProfit >= 0
                ? "rgba(16,185,129,0.06)"
                : "rgba(239,68,68,0.06)",
              border: `1px solid ${treasury && treasury.netProfit >= 0 ? "rgba(16,185,129,0.15)" : "rgba(239,68,68,0.15)"}`,
            }}>
              <div style={{
                width: 42, height: 42, borderRadius: 12,
                background: treasury && treasury.netProfit >= 0 ? "rgba(16,185,129,0.12)" : "rgba(239,68,68,0.12)",
                display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
              }}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={treasury && treasury.netProfit >= 0 ? "#10b981" : "#ef4444"} strokeWidth="2" strokeLinecap="round">
                  <circle cx="12" cy="12" r="10"/><path d="M16 8l-4 4-4-4M12 12v6"/>
                </svg>
              </div>
              <div>
                <div style={{ fontSize: 11, color: "var(--muted)", fontWeight: 600 }}>صافي الربح</div>
                <div style={{ fontSize: 22, fontWeight: 800, color: treasury && treasury.netProfit >= 0 ? "#10b981" : "#ef4444", direction: "ltr", lineHeight: 1.1 }}>
                  {treasury ? `${treasury.netProfit >= 0 ? "+" : "-"}${fmt(treasury.netProfit)} EGP` : "—"}
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Page content */}
        <div style={{ padding: 24 }}>
          {children}
        </div>
      </main>
    </div>
  );
}
