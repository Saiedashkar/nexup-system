"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

type DashboardData = {
  availableBalance: number;
  totalDealsThisMonth: number;
  availableProperties: number;
  totalDeals: number;
  recentDeals: { id: string; dealType: string; date: string; abomazenNetAmount: number; propertyName: string }[];
};

function fmt(n: number) { return n.toLocaleString("en-US"); }
function fmtDate(d: string) { return new Date(d).toLocaleDateString("ar-EG", { day: "2-digit", month: "short", year: "numeric" }); }

export default function AbomazenDashboard() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/abomazen/dashboard")
      .then(r => r.json())
      .then(d => setData(d))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  if (loading) return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "60vh" }}>
      <div style={{ textAlign: "center" }}>
        <div style={{ fontSize: 40, marginBottom: 12 }}>⏳</div>
        <p style={{ color: "var(--muted)", fontSize: 16 }}>جاري تحميل البيانات...</p>
      </div>
    </div>
  );

  if (!data) return (
    <div style={{ textAlign: "center", padding: 60 }}>
      <div style={{ fontSize: 64, marginBottom: 16 }}>🏠</div>
      <h2 style={{ fontSize: 24, fontWeight: 800, color: "var(--text)", marginBottom: 8 }}>مرحبًا بيك في ABOMAZEN</h2>
      <p style={{ color: "var(--muted)", fontSize: 16, marginBottom: 24 }}>نظام إدارة وساطة عقارية بسيط ومباشر</p>
      <div style={{ display: "flex", gap: 16, justifyContent: "center" }}>
        <Link href="/office/abomazen/new-deal" style={{ padding: "14px 28px", borderRadius: 12, background: "#f59e0b", color: "#fff", fontSize: 16, fontWeight: 700, textDecoration: "none" }}>📝 سجّل أول صفقة</Link>
        <Link href="/office/abomazen/guide" style={{ padding: "14px 28px", borderRadius: 12, background: "var(--surface)", border: "1px solid var(--border)", color: "var(--text)", fontSize: 16, fontWeight: 700, textDecoration: "none" }}>❓ إزاي أستخدم النظام؟</Link>
      </div>
    </div>
  );

  return (
    <div style={{ maxWidth: 900, margin: "0 auto" }}>
      {/* Welcome */}
      <div style={{ marginBottom: 28, textAlign: "center" }}>
        <h1 style={{ fontSize: 28, fontWeight: 800, color: "var(--text)", margin: 0 }}>مرحبًا 👋</h1>
        <p style={{ fontSize: 14, color: "var(--muted)", margin: "6px 0 0" }}>ABOMAZEN — وساطة عقارية</p>
      </div>

      {/* Big Action Buttons */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 28 }}>
        <Link href="/office/abomazen/new-deal" style={{ textDecoration: "none" }}>
          <div style={{
            padding: "24px 20px", borderRadius: 16, textAlign: "center",
            background: "linear-gradient(135deg, #f59e0b 0%, #d97706 100%)",
            color: "#fff", cursor: "pointer", transition: "transform 0.2s", boxShadow: "0 4px 16px rgba(245,158,11,0.3)",
          }}
            onMouseEnter={e => (e.currentTarget.style.transform = "translateY(-4px)")}
            onMouseLeave={e => (e.currentTarget.style.transform = "translateY(0)")}
          >
            <div style={{ fontSize: 40, marginBottom: 8 }}>📝</div>
            <div style={{ fontSize: 20, fontWeight: 800 }}>تسجيل صفقة جديدة</div>
            <div style={{ fontSize: 13, opacity: 0.85, marginTop: 4 }}>اضغط هنا لتسجيل صفقة إيجار أو بيع</div>
          </div>
        </Link>
        <Link href="/office/abomazen/properties" style={{ textDecoration: "none" }}>
          <div style={{
            padding: "24px 20px", borderRadius: 16, textAlign: "center",
            background: "var(--surface)", border: "2px solid var(--border)",
            color: "var(--text)", cursor: "pointer", transition: "transform 0.2s",
          }}
            onMouseEnter={e => (e.currentTarget.style.transform = "translateY(-4px)")}
            onMouseLeave={e => (e.currentTarget.style.transform = "translateY(0)")}
          >
            <div style={{ fontSize: 40, marginBottom: 8 }}>🏘️</div>
            <div style={{ fontSize: 20, fontWeight: 800 }}>إضافة عقار جديد</div>
            <div style={{ fontSize: 13, color: "var(--muted)", marginTop: 4 }}>سجّل عقار جديد في القائمة</div>
          </div>
        </Link>
      </div>

      {/* Balance Card - BIG */}
      <div style={{
        padding: "28px 32px", borderRadius: 16, marginBottom: 24,
        background: "linear-gradient(135deg, rgba(245,158,11,0.12) 0%, rgba(245,158,11,0.03) 100%)",
        border: "1px solid rgba(245,158,11,0.25)", textAlign: "center",
      }}>
        <div style={{ fontSize: 14, color: "var(--muted)", fontWeight: 600, marginBottom: 8 }}>💰 رصيد ABOMAZEN المتاح حاليًا</div>
        <div style={{ fontSize: 48, fontWeight: 900, color: data.availableBalance >= 0 ? "#f59e0b" : "#ef4444", direction: "ltr" }}>
          {fmt(data.availableBalance)} <span style={{ fontSize: 20, fontWeight: 600 }}>EGP</span>
        </div>
        <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 8 }}>صافي مبلغ الصفقات بعد خصم المصروفات والتحويلات</div>
      </div>

      {/* Stats Row */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 28 }}>
        <div style={{ padding: "20px", borderRadius: 14, background: "var(--surface)", border: "1px solid var(--border)", textAlign: "center" }}>
          <div style={{ fontSize: 32, fontWeight: 800, color: "#f59e0b" }}>{data.totalDealsThisMonth}</div>
          <div style={{ fontSize: 13, color: "var(--muted)", marginTop: 4 }}>صفقات هذا الشهر</div>
        </div>
        <div style={{ padding: "20px", borderRadius: 14, background: "var(--surface)", border: "1px solid var(--border)", textAlign: "center" }}>
          <div style={{ fontSize: 32, fontWeight: 800, color: "#10b981" }}>{data.availableProperties}</div>
          <div style={{ fontSize: 13, color: "var(--muted)", marginTop: 4 }}>عقارات متاحة حاليًا</div>
        </div>
      </div>

      {/* Recent Deals */}
      <div style={{ padding: "20px 24px", borderRadius: 14, background: "var(--surface)", border: "1px solid var(--border)", marginBottom: 20 }}>
        <div style={{ fontSize: 16, fontWeight: 700, color: "var(--text)", marginBottom: 16 }}>آخر 5 صفقات</div>
        {data.recentDeals.length === 0 ? (
          <div style={{ textAlign: "center", padding: 24 }}>
            <div style={{ fontSize: 36, marginBottom: 8 }}>📋</div>
            <p style={{ color: "var(--muted)", fontSize: 14 }}>لسه معندكش أي صفقات، <Link href="/office/abomazen/new-deal" style={{ color: "#f59e0b", fontWeight: 600 }}>دوس هنا عشان تسجل أول صفقة</Link></p>
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {data.recentDeals.map(d => (
              <div key={d.id} style={{
                display: "flex", alignItems: "center", gap: 14, padding: "12px 16px",
                borderRadius: 10, background: "var(--surface-hover)", transition: "background 0.1s",
              }}>
                <span style={{ fontSize: 24 }}>{d.dealType === "RENT" ? "🔑" : "🏷️"}</span>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 14, fontWeight: 600, color: "var(--text)" }}>{d.propertyName}</div>
                  <div style={{ fontSize: 12, color: "var(--muted)" }}>{fmtDate(d.date)}</div>
                </div>
                <div style={{ textAlign: "left" }}>
                  <div style={{ fontSize: 16, fontWeight: 800, color: "#f59e0b", direction: "ltr" }}>{fmt(d.abomazenNetAmount)} EGP</div>
                  <div style={{ fontSize: 11, color: "var(--muted)" }}>صافي ABOMAZEN</div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Quick Links */}
      <div style={{ display: "flex", gap: 12, justifyContent: "center" }}>
        <Link href="/office/abomazen/deals" style={{ padding: "10px 20px", borderRadius: 8, background: "var(--surface)", border: "1px solid var(--border)", color: "var(--text)", fontSize: 14, fontWeight: 600, textDecoration: "none" }}>عرض كل الصفقات ←</Link>
        <Link href="/office/abomazen/properties" style={{ padding: "10px 20px", borderRadius: 8, background: "var(--surface)", border: "1px solid var(--border)", color: "var(--text)", fontSize: 14, fontWeight: 600, textDecoration: "none" }}>عرض كل العقارات ←</Link>
      </div>
    </div>
  );
}
