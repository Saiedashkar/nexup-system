"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export type BottomNavItem = {
  href: string;
  label: string;
  icon: string; // SVG path
  /** If true, this is the center "add" button */
  isPrimary?: boolean;
};

export function BottomNavBar({
  items,
  brandColor = "var(--brand)",
}: {
  items: BottomNavItem[];
  brandColor?: string;
}) {
  const pathname = usePathname();

  return (
    <nav className="bottom-nav-bar" style={{ "--bottom-nav-color": brandColor } as React.CSSProperties}>
      {items.map((item) => {
        const isActive = pathname === item.href || pathname.startsWith(item.href + "/");
        
        if (item.isPrimary) {
          return (
            <Link
              key={item.href}
              href={item.href}
              className="bottom-nav-item bottom-nav-primary"
              style={{ color: "#fff" }}
            >
              <div className="bottom-nav-primary-btn" style={{ background: brandColor }}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" width={24} height={24}>
                  <path d={item.icon} />
                </svg>
              </div>
              <span>{item.label}</span>
            </Link>
          );
        }

        return (
          <Link
            key={item.href}
            href={item.href}
            className={`bottom-nav-item ${isActive ? "active" : ""}`}
            style={isActive ? { color: brandColor } : undefined}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={isActive ? 2.2 : 1.8} strokeLinecap="round" strokeLinejoin="round" width={22} height={22}>
              <path d={item.icon} />
            </svg>
            <span>{item.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
