"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, useEffect } from "react";
import { MobileNav } from "@/components/mobile-nav";
import { BottomNavBar, BottomNavItem } from "@/components/bottom-nav-bar";

// Check if current user is SUPER_ADMIN (from session)
function useIsSuperAdmin() {
  const [isSuperAdmin, setIsSuperAdmin] = useState(false);
  useEffect(() => {
    fetch("/api/auth/me").then(r => r.json()).then(d => {
      setIsSuperAdmin(d.user?.role === "SUPER_ADMIN");
    }).catch(() => {});
  }, []);
  return isSuperAdmin;
}

function NavIcon({ d, size = 20 }: { d: string; size?: number }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" width={size} height={size}>
      <path d={d} />
    </svg>
  );
}

const icons = {
  dashboard: "M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z M9 22V12h6v10",
  clients: "M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2 M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z M23 21v-2a4 4 0 0 0-3-3.87 M16 3.13a4 4 0 0 1 0 7.75",
  finance: "M21 12V7H5a2 2 0 0 1 0-4h14v4 M3 5v14a2 2 0 0 0 2 2h16v-5 M18 12a2 2 0 0 0 0 4h4v-4z",
  analytics: "M18 20V10 M12 20V4 M6 20v-6",
  settings: "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z",
  back: "M19 12H5M12 19l-7-7 7-7",
  sun: "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z",
  moon: "M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z",
};

const NAV_ITEMS = [
  { href: "/office/nexup/dashboard", label: "لوحة التحكم", sub: "Dashboard", icon: icons.dashboard },
  { href: "/office/nexup/clients", label: "العملاء", sub: "Clients", icon: icons.clients },
  { href: "/office/nexup/finance", label: "الحسابات", sub: "Finance", icon: icons.finance },
  { href: "/office/nexup/analytics", label: "التحليلات", sub: "Analytics", icon: icons.analytics },
  { href: "/office/nexup/profit-distribution", label: "توزيع الأرباح", sub: "Profit Distribution", icon: icons.finance, superAdminOnly: true },
  { href: "/office/nexup/settings", label: "الإعدادات", sub: "Settings", icon: icons.settings },
];

const BOTTOM_NAV_ITEMS: BottomNavItem[] = [
  { href: "/office/nexup/dashboard", label: "الرئيسية", icon: icons.dashboard },
  { href: "/office/nexup/clients", label: "العملاء", icon: icons.clients },
  { href: "/office/nexup/clients", label: "إضافة", icon: "M12 5v14M5 12h14", isPrimary: true },
  { href: "/office/nexup/finance", label: "الحسابات", icon: icons.finance },
  { href: "/office/nexup/settings", label: "المزيد", icon: icons.settings },
];

export function NexupSidebar() {
  const pathname = usePathname();
  const [theme, setTheme] = useState<"light" | "dark">("dark");
  const [collapsed, setCollapsed] = useState(false);
  const isSuperAdmin = useIsSuperAdmin();

  useEffect(() => {
    const saved = localStorage.getItem("nexup-theme") as "light" | "dark" | null;
    if (saved) {
      setTheme(saved);
      document.documentElement.setAttribute("data-theme", saved);
    }
  }, []);

  const toggleTheme = () => {
    const next = theme === "light" ? "dark" : "light";
    setTheme(next);
    localStorage.setItem("nexup-theme", next);
    document.documentElement.setAttribute("data-theme", next);
  };

  return (
    <>
      {/* Mobile Navigation */}
      <MobileNav
        brandName="NEXUP"
        brandSub="Design Studio"
        brandHref="/office"
        brandColor="#14b8a6"
        items={NAV_ITEMS.map(item => ({
          href: item.href,
          label: item.label,
          sub: item.sub,
          icon: item.icon,
          superAdminOnly: item.superAdminOnly,
        }))}
        isSuperAdmin={isSuperAdmin}
        theme={theme}
        onToggleTheme={toggleTheme}
      />
      {/* Desktop Sidebar */}
      <aside
        className="nexup-sidebar"
        style={{
          width: collapsed ? 72 : 240,
          transition: "width 0.2s ease",
        }}
      >
        {/* Brand */}
        <div style={{ padding: collapsed ? "20px 12px" : "20px 20px", borderBottom: "1px solid rgba(255,255,255,0.08)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <Link
              href="/office"
              style={{
                width: 36, height: 36, borderRadius: 10,
                background: "rgba(13,148,136,0.2)",
                display: "flex", alignItems: "center", justifyContent: "center",
                color: "#14b8a6", textDecoration: "none", flexShrink: 0,
              }}
              title="Back to Office"
            >
              <NavIcon d={icons.back} size={18} />
            </Link>
            {!collapsed && (
              <div>
                <div style={{ fontSize: 16, fontWeight: 800, color: "#fff", letterSpacing: "-0.02em" }}>
                  NEXUP
                </div>
                <div style={{ fontSize: 10, color: "#64748b", letterSpacing: "0.05em", textTransform: "uppercase" }}>
                  Design Studio
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Navigation */}
        <nav style={{ padding: "12px 8px", flex: 1 }}>
          {NAV_ITEMS.filter(item => !(item as Record<string, unknown>).superAdminOnly || isSuperAdmin).map((item) => {
            const isActive = pathname === item.href || pathname.startsWith(item.href + "/");
            return (
              <Link
                key={item.href}
                href={item.href}
                style={{
                  display: "flex", alignItems: "center", gap: 12,
                  padding: collapsed ? "10px 0" : "10px 14px",
                  justifyContent: collapsed ? "center" : "flex-start",
                  borderRadius: 10,
                  color: isActive ? "#14b8a6" : "#94a3b8",
                  background: isActive ? "rgba(13,148,136,0.12)" : "transparent",
                  textDecoration: "none",
                  fontSize: 13, fontWeight: isActive ? 600 : 500,
                  transition: "all 0.15s",
                  marginBottom: 2,
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
                <NavIcon d={item.icon} size={18} />
                {!collapsed && <span>{item.label}</span>}
              </Link>
            );
          })}
        </nav>

        {/* Bottom Controls */}
        <div style={{ padding: collapsed ? "12px 8px" : "12px 16px", borderTop: "1px solid rgba(255,255,255,0.08)" }}>
          {/* Collapse Toggle */}
          <button
            onClick={() => setCollapsed(!collapsed)}
            style={{
              display: "flex", alignItems: "center", justifyContent: collapsed ? "center" : "flex-start",
              gap: 10, width: "100%", padding: "8px 0",
              background: "none", border: "none", color: "#64748b",
              cursor: "pointer", fontSize: 12, borderRadius: 8,
            }}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} width={16} height={16}
              style={{ transform: collapsed ? "rotate(180deg)" : "none", transition: "transform 0.2s" }}>
              <path d="M15 18l-6-6 6-6" />
            </svg>
            {!collapsed && <span>طي</span>}
          </button>

          {/* Theme Toggle */}
          <button
            onClick={toggleTheme}
            style={{
              display: "flex", alignItems: "center", justifyContent: collapsed ? "center" : "flex-start",
              gap: 10, width: "100%", padding: "8px 0",
              background: "none", border: "none", color: "#64748b",
              cursor: "pointer", fontSize: 12, borderRadius: 8,
            }}
          >
            <NavIcon d={theme === "light" ? icons.moon : icons.sun} size={16} />
            {!collapsed && <span>{theme === "light" ? "Dark Mode" : "Light Mode"}</span>}
          </button>
        </div>
      </aside>
      {/* Bottom Nav Bar for mobile */}
      <BottomNavBar items={BOTTOM_NAV_ITEMS} brandColor="#14b8a6" />
    </>
  );
}
