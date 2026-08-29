"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, useEffect } from "react";

function NavIcon({ d, size = 20 }: { d: string; size?: number }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" width={size} height={size}>
      <path d={d} />
    </svg>
  );
}

const icons = {
  dashboard: "M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z M9 22V12h6v10",
  partners: "M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2 M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z M23 21v-2a4 4 0 0 0-3-3.87 M16 3.13a4 4 0 0 1 0 7.75",
  ledger: "M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z M14 2v6h6 M16 13H8 M16 17H8 M10 9H8",
  expenses: "M9 5H2v7l6.29 6.29c.94.94 2.48.94 3.42 0l3.58-3.58c.94-.94.94-2.48 0-3.42L9 5z M6 9.01V9",
  capital: "M12 1v22M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6",
  profitTransfer: "M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5",
  settings: "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z",
  users: "M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2 M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z M23 21v-2a4 4 0 0 0-3-3.87 M16 3.13a4 4 0 0 1 0 7.75",
  back: "M19 12H5M12 19l-7-7 7-7",
};

const NAV = [
  { href: "/office/admin/dashboard", label: "لوحة التحكم", sub: "Dashboard", icon: icons.dashboard },
  { href: "/office/admin/partners", label: "الشركاء", sub: "Partners", icon: icons.partners },
  { href: "/office/admin/partner-ledger", label: "كشف حساب الشريك", sub: "Partner Ledger", icon: icons.ledger },
  { href: "/office/admin/profit-transfers", label: "تحويل الأرباح", sub: "Profit Transfers", icon: icons.profitTransfer },
  { href: "/office/admin/office-expenses", label: "مصاريف المكتب", sub: "Office Expenses", icon: icons.expenses },
  { href: "/office/admin/capital", label: "رأس المال والتمويل", sub: "Capital & Funding", icon: icons.capital },
  { href: "/office/admin/settings", label: "إعدادات التوزيع", sub: "Allocation Settings", icon: icons.settings },
  { href: "/office/admin/users", label: "إدارة المستخدمين", sub: "User Management", icon: icons.users, superAdminOnly: true },
];

export function AdminSidebar() {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);
  const [theme, setTheme] = useState<"light" | "dark">("dark");
  const [isSuperAdmin, setIsSuperAdmin] = useState(false);

  useEffect(() => {
    const saved = localStorage.getItem("nexup-theme") as "light" | "dark" | null;
    if (saved) { setTheme(saved); document.documentElement.setAttribute("data-theme", saved); }
    // Check if user is SUPER_ADMIN
    fetch("/api/auth/me").then(r => r.json()).then(d => {
      setIsSuperAdmin(d.user?.role === "SUPER_ADMIN");
    }).catch(() => {});
  }, []);

  const toggleTheme = () => {
    const next = theme === "light" ? "dark" : "light";
    setTheme(next);
    localStorage.setItem("nexup-theme", next);
    document.documentElement.setAttribute("data-theme", next);
  };

  return (
    <aside style={{
      width: collapsed ? 72 : 260, transition: "width 0.2s ease", background: "#0f172a",
      color: "#e2e8f0", display: "flex", flexDirection: "column", height: "100vh",
      position: "sticky", top: 0, overflow: "hidden", flexShrink: 0,
    }}>
      {/* Brand */}
      <div style={{ padding: collapsed ? "20px 12px" : "20px 20px", borderBottom: "1px solid rgba(255,255,255,0.08)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <Link href="/office" style={{ width: 36, height: 36, borderRadius: 10, background: "rgba(139,92,246,0.2)", display: "flex", alignItems: "center", justifyContent: "center", color: "#a78bfa", textDecoration: "none", flexShrink: 0 }} title="العودة للمكتب">
            <NavIcon d={icons.back} size={18} />
          </Link>
          {!collapsed && (
            <div>
              <div style={{ fontSize: 15, fontWeight: 800, color: "#fff", letterSpacing: "-0.02em" }}>إدارة المكتب</div>
              <div style={{ fontSize: 10, color: "#64748b", letterSpacing: "0.05em" }}>Office Management</div>
            </div>
          )}
        </div>
      </div>

      {/* Nav */}
      <nav style={{ padding: "12px 8px", flex: 1, overflowY: "auto" }}>
        {NAV.filter(item => !(item as Record<string, unknown>).superAdminOnly || isSuperAdmin).map(item => {
          const active = pathname === item.href || pathname.startsWith(item.href + "/");
          return (
            <Link key={item.href} href={item.href} style={{
              display: "flex", alignItems: "center", gap: 12, padding: collapsed ? "10px 0" : "10px 14px",
              justifyContent: collapsed ? "center" : "flex-start", borderRadius: 10,
              color: active ? "#a78bfa" : "#94a3b8", background: active ? "rgba(139,92,246,0.12)" : "transparent",
              textDecoration: "none", fontSize: 13, fontWeight: active ? 600 : 500, transition: "all 0.15s", marginBottom: 2,
            }}
              onMouseEnter={e => { if (!active) { e.currentTarget.style.background = "rgba(255,255,255,0.05)"; e.currentTarget.style.color = "#e2e8f0"; } }}
              onMouseLeave={e => { if (!active) { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = "#94a3b8"; } }}
              title={collapsed ? item.label : undefined}
            >
              <NavIcon d={item.icon} size={18} />
              {!collapsed && (
                <div>
                  <div style={{ lineHeight: 1.2 }}>{item.label}</div>
                  <div style={{ fontSize: 10, color: "#64748b", marginTop: 1 }}>{item.sub}</div>
                </div>
              )}
            </Link>
          );
        })}
      </nav>

      {/* Bottom controls */}
      <div style={{ padding: collapsed ? "12px 8px" : "12px 16px", borderTop: "1px solid rgba(255,255,255,0.08)" }}>
        {/* Theme toggle */}
        <button onClick={toggleTheme} style={{ display: "flex", alignItems: "center", justifyContent: collapsed ? "center" : "flex-start", gap: 10, width: "100%", padding: "8px 0", background: "none", border: "none", color: "#94a3b8", cursor: "pointer", fontSize: 12, borderRadius: 8, marginBottom: 4 }}
          onMouseEnter={e => (e.currentTarget.style.color = "#e2e8f0")}
          onMouseLeave={e => (e.currentTarget.style.color = "#94a3b8")}
        >
          <span style={{ fontSize: 16 }}>{theme === "dark" ? "☀️" : "🌙"}</span>
          {!collapsed && <span>{theme === "dark" ? "الوضع النهاري" : "الوضع الليلي"}</span>}
        </button>
        {/* Collapse toggle */}
        <button onClick={() => setCollapsed(!collapsed)} style={{ display: "flex", alignItems: "center", justifyContent: collapsed ? "center" : "flex-start", gap: 10, width: "100%", padding: "8px 0", background: "none", border: "none", color: "#64748b", cursor: "pointer", fontSize: 12, borderRadius: 8 }}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} width={16} height={16} style={{ transform: collapsed ? "rotate(180deg)" : "none", transition: "transform 0.2s" }}><path d="M15 18l-6-6 6-6" /></svg>
          {!collapsed && <span>طي</span>}
        </button>
      </div>
    </aside>
  );
}
