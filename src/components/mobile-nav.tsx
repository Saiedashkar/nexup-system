"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

export type MobileNavItem = {
  href: string;
  label: string;
  sub?: string;
  icon: string;
  superAdminOnly?: boolean;
};

export function MobileNav({
  brandName,
  brandSub,
  brandHref = "/office",
  brandColor = "#8b5cf6",
  items,
  isSuperAdmin = false,
  theme,
  onToggleTheme,
}: {
  brandName: string;
  brandSub?: string;
  brandHref?: string;
  brandColor?: string;
  items: MobileNavItem[];
  isSuperAdmin?: boolean;
  theme: "light" | "dark";
  onToggleTheme: () => void;
}) {
  const [open, setOpen] = useState(false);

  // Close on route change or resize to desktop
  useEffect(() => {
    const handleResize = () => {
      if (window.innerWidth > 768) setOpen(false);
    };
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  // Lock body scroll when drawer is open
  useEffect(() => {
    if (open) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => { document.body.style.overflow = ""; };
  }, [open]);

  const filtered = items.filter(
    (item) => !item.superAdminOnly || isSuperAdmin
  );

  return (
    <>
      {/* ═══ Fixed Top Bar ═══ */}
      <div className="mobile-topbar">
        <button
          className="mobile-hamburger"
          onClick={() => setOpen(true)}
          aria-label="Open menu"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" width={22} height={22}>
            <line x1="3" y1="6" x2="21" y2="6" />
            <line x1="3" y1="12" x2="21" y2="12" />
            <line x1="3" y1="18" x2="21" y2="18" />
          </svg>
        </button>
        <Link href={brandHref} className="mobile-topbar-brand" style={{ color: brandColor }}>
          {brandName}
        </Link>
        <button
          className="mobile-topbar-theme"
          onClick={onToggleTheme}
          aria-label="Toggle theme"
        >
          {theme === "dark" ? "☀️" : "🌙"}
        </button>
      </div>

      {/* ═══ Backdrop ═══ */}
      {open && (
        <div className="mobile-drawer-backdrop" onClick={() => setOpen(false)} />
      )}

      {/* ═══ Slide-out Drawer ═══ */}
      <div className={`mobile-drawer ${open ? "open" : ""}`}>
        {/* Drawer Header */}
        <div className="mobile-drawer-header">
          <Link
            href={brandHref}
            className="mobile-drawer-brand"
            style={{ color: brandColor }}
            onClick={() => setOpen(false)}
          >
            {brandName}
          </Link>
          {brandSub && (
            <div className="mobile-drawer-brand-sub">{brandSub}</div>
          )}
          <button
            className="mobile-drawer-close"
            onClick={() => setOpen(false)}
            aria-label="Close menu"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" width={20} height={20}>
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {/* Drawer Nav */}
        <nav className="mobile-drawer-nav">
          {filtered.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="mobile-drawer-link"
              onClick={() => setOpen(false)}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" width={20} height={20}>
                <path d={item.icon} />
              </svg>
              <div>
                <div>{item.label}</div>
                {item.sub && <div className="mobile-drawer-link-sub">{item.sub}</div>}
              </div>
            </Link>
          ))}
        </nav>

        {/* Drawer Footer */}
        <div className="mobile-drawer-footer">
          <button className="mobile-drawer-theme-btn" onClick={onToggleTheme}>
            <span style={{ fontSize: 18 }}>{theme === "dark" ? "☀️" : "🌙"}</span>
            <span>{theme === "dark" ? "الوضع النهاري" : "الوضع الليلي"}</span>
          </button>
        </div>
      </div>
    </>
  );
}
