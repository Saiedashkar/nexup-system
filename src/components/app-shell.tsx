import Link from "next/link";
import { LogoutButton } from "@/components/logout-button";

function NavIcon({ d }: { d: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <path d={d} />
    </svg>
  );
}

const icons = {
  dashboard: "M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z M9 22V12h6v10",
  clients: "M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2 M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z M23 21v-2a4 4 0 0 0-3-3.87 M16 3.13a4 4 0 0 1 0 7.75",
  finance: "M12 2v20 M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6",
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

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="sidebar-brand">
          <Link className="sidebar-brand-text" href={isAdmin ? "/dashboard" : "/clients"}>Nexup</Link>
          <div className="sidebar-brand-sub">نظام إدارة الأعمال</div>
        </div>

        <nav className="sidebar-nav">
          <div className="sidebar-section">
            <div className="sidebar-section-title">الرئيسية</div>
            {isAdmin && (
              <Link className={`sidebar-link ${activePage === "dashboard" ? "active" : ""}`} href="/dashboard">
                <NavIcon d={icons.dashboard} />
                لوحة التحكم
              </Link>
            )}
            <Link className={`sidebar-link ${activePage === "clients" ? "active" : ""}`} href="/clients">
              <NavIcon d={icons.clients} />
              إدارة العملاء
            </Link>
          </div>

          {isAdmin && (
            <div className="sidebar-section">
              <div className="sidebar-section-title">المالية</div>
              <Link className={`sidebar-link ${activePage === "finance" ? "active" : ""}`} href="/finance">
                <NavIcon d={icons.finance} />
                إدارة الحسابات
              </Link>
            </div>
          )}
        </nav>

        <div className="sidebar-footer">
          <div className="sidebar-user">
            <div className="sidebar-avatar">{initial}</div>
            <div className="sidebar-user-info">
              <div className="sidebar-user-name">{userName || "مستخدم"}</div>
              <div className="sidebar-user-role">{isAdmin ? "مدير" : "موظف"}</div>
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
