"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, useEffect } from "react";
import { MobileNav } from "@/components/mobile-nav";
import { BottomNavBar, BottomNavItem } from "@/components/bottom-nav-bar";

// SVG Icons
const HomeIcon = ({ size = 20 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
    <polyline points="9 22 9 12 15 12 15 22" />
  </svg>
);

const PlusCircleIcon = ({ size = 20 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="10" />
    <line x1="12" y1="8" x2="12" y2="16" />
    <line x1="8" y1="12" x2="16" y2="12" />
  </svg>
);

const FileTextIcon = ({ size = 20 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
    <polyline points="14 2 14 8 20 8" />
    <line x1="16" y1="13" x2="8" y2="13" />
    <line x1="16" y1="17" x2="8" y2="17" />
  </svg>
);

const BuildingIcon = ({ size = 20 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="4" y="2" width="16" height="20" rx="2" ry="2" />
    <path d="M9 22v-4h6v4" />
    <path d="M8 6h.01" />
    <path d="M16 6h.01" />
    <path d="M12 6h.01" />
    <path d="M12 10h.01" />
    <path d="M12 14h.01" />
    <path d="M16 10h.01" />
    <path d="M16 14h.01" />
    <path d="M8 10h.01" />
    <path d="M8 14h.01" />
  </svg>
);

const DollarSignIcon = ({ size = 20 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <line x1="12" y1="1" x2="12" y2="23" />
    <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
  </svg>
);

const HelpCircleIcon = ({ size = 20 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="10" />
    <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
    <line x1="12" y1="17" x2="12.01" y2="17" />
  </svg>
);

const ChevronLeftIcon = ({ size = 20 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="15 18 9 12 15 6" />
  </svg>
);

const SunIcon = ({ size = 20 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="5" />
    <line x1="12" y1="1" x2="12" y2="3" />
    <line x1="12" y1="21" x2="12" y2="23" />
    <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" />
    <line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
    <line x1="1" y1="12" x2="3" y2="12" />
    <line x1="21" y1="12" x2="23" y2="12" />
    <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" />
    <line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
  </svg>
);

const MoonIcon = ({ size = 20 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
  </svg>
);

const NAV_ITEMS = [
  { href: "/office/abomazen/dashboard", label: "لوحة التحكم", icon: HomeIcon },
  { href: "/office/abomazen/new-deal", label: "تسجيل صفقة جديدة", icon: PlusCircleIcon },
  { href: "/office/abomazen/deals", label: "كل الصفقات", icon: FileTextIcon },
  { href: "/office/abomazen/properties", label: "العقارات", icon: BuildingIcon },
  { href: "/office/abomazen/finance", label: "الحسابات", icon: DollarSignIcon },
  { href: "/office/abomazen/guide", label: "إزاي أستخدم النظام؟", icon: HelpCircleIcon },
];

const iconPaths = {
  home: "M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z M9 22V12h6v10",
  deal: "M12 5v14M5 12h14",
  deals: "M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z M14 2v6h6",
  building: "M3 21h18M9 3h6M12 3v7M5 21V7l7-4 7 4v14M9 21v-6h6v6",
  finance: "M12 1v22M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6",
  help: "M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3 M12 17h.01",
};

const MOBILE_NAV = [
  { href: "/office/abomazen/dashboard", label: "لوحة التحكم", sub: "Dashboard", icon: iconPaths.home },
  { href: "/office/abomazen/new-deal", label: "تسجيل صفقة جديدة", sub: "New Deal", icon: iconPaths.deal },
  { href: "/office/abomazen/deals", label: "كل الصفقات", sub: "All Deals", icon: iconPaths.deals },
  { href: "/office/abomazen/properties", label: "العقارات", sub: "Properties", icon: iconPaths.building },
  { href: "/office/abomazen/finance", label: "الحسابات", sub: "Finance", icon: iconPaths.finance },
  { href: "/office/abomazen/guide", label: "إزاي أستخدم النظام؟", sub: "Guide", icon: iconPaths.help },
];

const BOTTOM_NAV_ITEMS: BottomNavItem[] = [
  { href: "/office/abomazen/dashboard", label: "الرئيسية", icon: iconPaths.home },
  { href: "/office/abomazen/deals", label: "الصفقات", icon: iconPaths.deals },
  { href: "/office/abomazen/new-deal", label: "صفقة جديدة", icon: "M12 5v14M5 12h14", isPrimary: true },
  { href: "/office/abomazen/properties", label: "العقارات", icon: iconPaths.building },
  { href: "/office/abomazen/finance", label: "الحسابات", icon: iconPaths.finance },
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
    <>
    {/* Mobile Navigation */}
    <MobileNav
      brandName="ABOMAZEN"
      brandSub="وساطة عقارية"
      brandHref="/office"
      brandColor="#8b5cf6"
      items={MOBILE_NAV}
      isSuperAdmin={false}
      theme={theme}
      onToggleTheme={toggleTheme}
    />
    {/* Desktop Sidebar */}
    <aside
      style={{
        width: collapsed ? 80 : 280,
        transition: "width 0.3s cubic-bezier(0.4, 0, 0.2, 1)",
        background: "var(--sidebar-bg, #0f172a)",
        borderLeft: "1px solid rgba(139,92,246,0.15)",
        display: "flex",
        flexDirection: "column",
        flexShrink: 0,
        position: "relative",
      }}
    >
      {/* Gradient overlay */}
      <div style={{
        position: "absolute",
        top: 0,
        left: 0,
        right: 0,
        height: 200,
        background: "linear-gradient(180deg, rgba(139,92,246,0.08) 0%, transparent 100%)",
        pointerEvents: "none",
        zIndex: 0,
      }} />

      {/* Brand */}
      <div style={{ 
        padding: collapsed ? "24px 16px" : "24px 24px", 
        borderBottom: "1px solid rgba(139,92,246,0.1)",
        position: "relative",
        zIndex: 1,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: collapsed ? 0 : 12 }}>
          <div style={{
            width: 48, height: 48, borderRadius: 14,
            background: "linear-gradient(135deg, #8b5cf6 0%, #7c3aed 100%)",
            display: "flex", alignItems: "center", justifyContent: "center",
            color: "#fff", fontSize: 24, fontWeight: 900,
            boxShadow: "0 4px 16px rgba(139,92,246,0.3)",
            flexShrink: 0,
          }}>
            A
          </div>
          {!collapsed && (
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 20, fontWeight: 900, color: "#fff", letterSpacing: "-0.03em" }}>
                ABOMAZEN
              </div>
              <div style={{ fontSize: 12, color: "#8b5cf6", fontWeight: 600, marginTop: 2 }}>
                وساطة عقارية
              </div>
            </div>
          )}
        </div>
        {!collapsed && (
          <Link
            href="/office"
            style={{
              display: "flex", alignItems: "center", gap: 8,
              padding: "8px 12px", borderRadius: 8,
              background: "rgba(139,92,246,0.1)",
              border: "1px solid rgba(139,92,246,0.2)",
              color: "#8b5cf6", textDecoration: "none",
              fontSize: 13, fontWeight: 600,
              transition: "all 0.2s",
            }}
            onMouseEnter={e => {
              e.currentTarget.style.background = "rgba(139,92,246,0.15)";
              e.currentTarget.style.borderColor = "rgba(139,92,246,0.3)";
            }}
            onMouseLeave={e => {
              e.currentTarget.style.background = "rgba(139,92,246,0.1)";
              e.currentTarget.style.borderColor = "rgba(139,92,246,0.2)";
            }}
          >
            <ChevronLeftIcon size={16} />
            <span>العودة للمكتب</span>
          </Link>
        )}
      </div>

      {/* Navigation */}
      <nav style={{ padding: "16px 12px", flex: 1, position: "relative", zIndex: 1 }}>
        {NAV_ITEMS.map((item) => {
          const isActive = pathname === item.href || pathname.startsWith(item.href + "/");
          const Icon = item.icon;
          
          return (
            <Link
              key={item.href}
              href={item.href}
              style={{
                display: "flex", 
                alignItems: "center", 
                gap: 14,
                padding: collapsed ? "14px 0" : "14px 18px",
                justifyContent: collapsed ? "center" : "flex-start",
                borderRadius: 12,
                color: isActive ? "#8b5cf6" : "#94a3b8",
                background: isActive ? "rgba(139,92,246,0.12)" : "transparent",
                textDecoration: "none",
                fontSize: 14, 
                fontWeight: isActive ? 700 : 500,
                transition: "all 0.2s cubic-bezier(0.4, 0, 0.2, 1)",
                marginBottom: 6,
                position: "relative",
                border: isActive ? "1px solid rgba(139,92,246,0.2)" : "1px solid transparent",
              }}
              onMouseEnter={(e) => {
                if (!isActive) {
                  e.currentTarget.style.background = "rgba(255,255,255,0.05)";
                  e.currentTarget.style.color = "#e2e8f0";
                  e.currentTarget.style.transform = "translateX(-2px)";
                }
              }}
              onMouseLeave={(e) => {
                if (!isActive) {
                  e.currentTarget.style.background = "transparent";
                  e.currentTarget.style.color = "#94a3b8";
                  e.currentTarget.style.transform = "translateX(0)";
                }
              }}
              title={collapsed ? item.label : undefined}
            >
              {isActive && (
                <div style={{
                  position: "absolute",
                  left: 0,
                  top: "50%",
                  transform: "translateY(-50%)",
                  width: 3,
                  height: 20,
                  background: "#8b5cf6",
                  borderRadius: "0 4px 4px 0",
                }} />
              )}
              <div style={{
                width: 20,
                height: 20,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                flexShrink: 0,
              }}>
                <Icon size={20} />
              </div>
              {!collapsed && <span>{item.label}</span>}
            </Link>
          );
        })}
      </nav>

      {/* Bottom Controls */}
      <div style={{ 
        padding: collapsed ? "16px 12px" : "16px 20px", 
        borderTop: "1px solid rgba(139,92,246,0.1)",
        position: "relative",
        zIndex: 1,
      }}>
        <button
          onClick={toggleTheme}
          style={{
            display: "flex", 
            alignItems: "center", 
            justifyContent: collapsed ? "center" : "flex-start",
            gap: 12, 
            width: "100%", 
            padding: collapsed ? "12px 0" : "12px 16px",
            background: "rgba(139,92,246,0.08)", 
            border: "1px solid rgba(139,92,246,0.15)", 
            color: "#8b5cf6",
            cursor: "pointer", 
            fontSize: 13, 
            fontWeight: 600,
            borderRadius: 10,
            transition: "all 0.2s",
            marginBottom: 8,
          }}
          onMouseEnter={e => {
            e.currentTarget.style.background = "rgba(139,92,246,0.15)";
            e.currentTarget.style.borderColor = "rgba(139,92,246,0.25)";
          }}
          onMouseLeave={e => {
            e.currentTarget.style.background = "rgba(139,92,246,0.08)";
            e.currentTarget.style.borderColor = "rgba(139,92,246,0.15)";
          }}
        >
          <div style={{ width: 20, height: 20, display: "flex", alignItems: "center", justifyContent: "center" }}>
            {theme === "light" ? <MoonIcon size={18} /> : <SunIcon size={18} />}
          </div>
          {!collapsed && <span>{theme === "light" ? "وضع داكن" : "وضع فاتح"}</span>}
        </button>
        
        <button
          onClick={() => setCollapsed(!collapsed)}
          style={{
            display: "flex", 
            alignItems: "center", 
            justifyContent: collapsed ? "center" : "flex-start",
            gap: 12, 
            width: "100%", 
            padding: collapsed ? "12px 0" : "12px 16px",
            background: "transparent", 
            border: "1px solid rgba(255,255,255,0.08)", 
            color: "#64748b",
            cursor: "pointer", 
            fontSize: 13, 
            fontWeight: 600,
            borderRadius: 10,
            transition: "all 0.2s",
          }}
          onMouseEnter={e => {
            e.currentTarget.style.background = "rgba(255,255,255,0.05)";
            e.currentTarget.style.color = "#94a3b8";
          }}
          onMouseLeave={e => {
            e.currentTarget.style.background = "transparent";
            e.currentTarget.style.color = "#64748b";
          }}
        >
          <div style={{ 
            width: 20, 
            height: 20, 
            display: "flex", 
            alignItems: "center", 
            justifyContent: "center",
            transform: collapsed ? "rotate(180deg)" : "rotate(0)",
            transition: "transform 0.3s",
          }}>
            <ChevronLeftIcon size={18} />
          </div>
          {!collapsed && <span>طي القائمة</span>}
        </button>
      </div>
    </aside>
      {/* Bottom Nav Bar for mobile */}
      <BottomNavBar items={BOTTOM_NAV_ITEMS} brandColor="#8b5cf6" />
    </>
  );
}
