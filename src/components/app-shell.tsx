"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { LogoutButton } from "@/components/logout-button";

function NavIcon({ d }: { d: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <path d={d} />
    </svg>
  );
}

function SunIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" width="18" height="18">
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
}

function MoonIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" width="18" height="18">
      <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
    </svg>
  );
}

const icons = {
  office: "M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z M9 22V12h6v10",
  dashboard: "M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z M9 22V12h6v10",
  clients: "M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2 M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z M23 21v-2a4 4 0 0 0-3-3.87 M16 3.13a4 4 0 0 1 0 7.75",
  treasury: "M21 12V7H5a2 2 0 0 1 0-4h14v4 M3 5v14a2 2 0 0 0 2 2h16v-5 M18 12a2 2 0 0 0 0 4h4v-4z",
  logout: "M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4 M16 17l5-5-5-5 M21 12H9",
};

export function AppShell({
  children,
  isAdmin,
  userName,
  activePage,
}: {
  children: React.ReactNode;
  isAdmin: boolean;
  userName?: string;
  activePage?: string;
}) {
  const initial = userName ? userName.charAt(0) : "N";
  const [theme, setTheme] = useState<"light" | "dark">("dark");
  const [userRole, setUserRole] = useState<string>("");

  useEffect(() => {
    const saved = localStorage.getItem("nexup-theme") as "light" | "dark" | null;
    if (saved) {
      setTheme(saved);
      document.documentElement.setAttribute("data-theme", saved);
    }
    // Get role from login response stored in sessionStorage
    const role = sessionStorage.getItem("nexup-role");
    if (role) setUserRole(role);
  }, []);

  const toggleTheme = () => {
    const next = theme === "light" ? "dark" : "light";
    setTheme(next);
    localStorage.setItem("nexup-theme", next);
    document.documentElement.setAttribute("data-theme", next);
  };

  const isSuperAdmin = userRole === "SUPER_ADMIN";

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="sidebar-brand">
          <Link className="sidebar-brand-text" href={isSuperAdmin ? "/office" : isAdmin ? "/dashboard" : "/clients"}>
            {isSuperAdmin ? "Office" : "Nexup"}
          </Link>
          <div className="sidebar-brand-sub">
            {isSuperAdmin ? "Multi-Business Management" : "Business Management"}
          </div>
        </div>

        <nav className="sidebar-nav">
          <div className="sidebar-section">
            <div className="sidebar-section-title">Main Menu</div>

            {/* SUPER_ADMIN: Office link */}
            {isSuperAdmin && (
              <Link className={`sidebar-link ${activePage === "office" ? "active" : ""}`} href="/office">
                <NavIcon d={icons.office} />
                Office Dashboard
              </Link>
            )}

            {/* ADMIN/EMPLOYEE: Dashboard link */}
            {isAdmin && !isSuperAdmin && (
              <Link className={`sidebar-link ${activePage === "dashboard" ? "active" : ""}`} href="/dashboard">
                <NavIcon d={icons.dashboard} />
                Dashboard
              </Link>
            )}

            {/* Clients link — visible to all */}
            <Link className={`sidebar-link ${activePage === "clients" ? "active" : ""}`} href="/clients">
              <NavIcon d={icons.clients} />
              Clients
            </Link>
          </div>

          {/* Finance section — ADMIN and SUPER_ADMIN */}
          {isAdmin && (
            <div className="sidebar-section">
              <div className="sidebar-section-title">Finance</div>
              <Link className={`sidebar-link ${activePage === "finance" ? "active" : ""}`} href="/finance">
                <NavIcon d={icons.treasury} />
                Treasury & Expenses
              </Link>
            </div>
          )}
        </nav>

        {/* Theme Toggle */}
        <button className="theme-toggle" onClick={toggleTheme}>
          {theme === "light" ? <MoonIcon /> : <SunIcon />}
          <span>{theme === "light" ? "Dark Mode" : "Light Mode"}</span>
        </button>

        <div className="sidebar-footer">
          <div className="sidebar-user">
            <div className="sidebar-avatar">{initial}</div>
            <div className="sidebar-user-info">
              <div className="sidebar-user-name">{userName || "User"}</div>
              <div className="sidebar-user-role">
                {isSuperAdmin ? "Super Admin" : isAdmin ? "Admin" : "Employee"}
              </div>
            </div>
          </div>
          <div style={{ marginTop: 12 }}>
            <LogoutButton />
          </div>
        </div>
      </aside>

      <main className="main-content">
        {children}
      </main>
    </div>
  );
}
