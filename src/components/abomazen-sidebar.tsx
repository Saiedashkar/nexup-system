"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, useEffect } from "react";

const NAV_ITEMS = [
  { href: "/office/abomazen/dashboard", label: "🏠 لوحة التحكم", icon: "🏠" },
  { href: "/office/abomazen/new-deal", label: "📝 تسجيل صفقة جديدة", icon: "📝" },
  { href: "/office/abomazen/deals", label: "📋 كل الصفقات", icon: "📋" },
  { href: "/office/abomazen/properties", label: "🏘️ العقارات", icon: "🏘️" },
  { href: "/office/abomazen/finance", label: "💰 الحسابات", icon: "💰" },
  { href: "/office/abomazen/guide", label: "❓ إزاي أستخدم النظام؟", icon: "❓" },
];

export function AbomazenSidebar() {
  const pathname = usePathname();
  const [theme, setTheme] = useState<"light" | "dark">("dark");
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    const saved = localStorage.getItem("abomazen-theme") as "light" | "dark" | null;
    if (saved) {
      setTheme(saved);
      document.documentElement.setAttribute("data-theme", saved);
    }
  }, []);

  const toggleTheme = () => {
    const next = theme === "light" ? "dark" : "light";
    setTheme(next);
    localStorage.setItem("abomazen-theme", next);
    document.documentElement.setAttribute("data-theme", next);
  };

  return (
    <aside
      className="abomazen-sidebar"
      style={{
        width: collapsed ? 72 : 250,
        transition: "width 0.2s ease",
        background: "var(--sidebar-bg, #0f172a)",
        borderLeft: "1px solid rgba(255,255,255,0.06)",
        display: "flex",
        flexDirection: "column",
        flexShrink: 0,
      }}
    >
      {/* Brand */}
      <div style={{ padding: collapsed ? "20px 12px" : "20px 20px", borderBottom: "1px solid rgba(255,255,255,0.08)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <Link
            href="/office"
            style={{
              width: 36, height: 36, borderRadius: 10,
              background: "rgba(245,158,11,0.2)",
              display: "flex", alignItems: "center", justifyContent: "center",
              color: "#f59e0b", textDecoration: "none", flexShrink: 0,
            }}
            title="العودة للمكتب"
          >
            <span style={{ fontSize: 18 }}>◀</span>
          </Link>
          {!collapsed && (
            <div>
              <div style={{ fontSize: 18, fontWeight: 800, color: "#fff", letterSpacing: "-0.02em" }}>
                ABOMAZEN
              </div>
              <div style={{ fontSize: 11, color: "#f59e0b", fontWeight: 600 }}>
                وساطة عقارية
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Navigation */}
      <nav style={{ padding: "12px 8px", flex: 1 }}>
        {NAV_ITEMS.map((item) => {
          const isActive = pathname === item.href || pathname.startsWith(item.href + "/");
          return (
            <Link
              key={item.href}
              href={item.href}
              style={{
                display: "flex", alignItems: "center", gap: 12,
                padding: collapsed ? "12px 0" : "12px 16px",
                justifyContent: collapsed ? "center" : "flex-start",
                borderRadius: 10,
                color: isActive ? "#f59e0b" : "#94a3b8",
                background: isActive ? "rgba(245,158,11,0.12)" : "transparent",
                textDecoration: "none",
                fontSize: 14, fontWeight: isActive ? 700 : 500,
                transition: "all 0.15s",
                marginBottom: 4,
              }}
              onMouseEnter={(e) => {
                if (!isActive) {
                  e.currentTarget.style.background = "rgba(255,255,255,0.05)";
                  e.currentTarget.style.color = "#e2e8f0";
                }
              }}
              onMouseLeave={(e) => {
                if (!isActive) {
                  e.currentTarget.style.background = "transparent";
                  e.currentTarget.style.color = "#94a3b8";
                }
              }}
              title={collapsed ? item.label : undefined}
            >
              <span style={{ fontSize: 18 }}>{item.icon}</span>
              {!collapsed && <span>{item.label}</span>}
            </Link>
          );
        })}
      </nav>

      {/* Bottom Controls */}
      <div style={{ padding: collapsed ? "12px 8px" : "12px 16px", borderTop: "1px solid rgba(255,255,255,0.08)" }}>
        <button
          onClick={() => setCollapsed(!collapsed)}
          style={{
            display: "flex", alignItems: "center", justifyContent: collapsed ? "center" : "flex-start",
            gap: 10, width: "100%", padding: "8px 0",
            background: "none", border: "none", color: "#64748b",
            cursor: "pointer", fontSize: 12, borderRadius: 8,
          }}
        >
          <span style={{ fontSize: 14 }}>{collapsed ? "◀" : "▶"}</span>
          {!collapsed && <span>طي القائمة</span>}
        </button>
        <button
          onClick={toggleTheme}
          style={{
            display: "flex", alignItems: "center", justifyContent: collapsed ? "center" : "flex-start",
            gap: 10, width: "100%", padding: "8px 0",
            background: "none", border: "none", color: "#64748b",
            cursor: "pointer", fontSize: 12, borderRadius: 8,
          }}
        >
          <span style={{ fontSize: 14 }}>{theme === "light" ? "🌙" : "☀️"}</span>
          {!collapsed && <span>{theme === "light" ? "وضع داكن" : "وضع فاتح"}</span>}
        </button>
      </div>
    </aside>
  );
}
