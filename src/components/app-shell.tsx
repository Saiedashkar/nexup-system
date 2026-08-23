import Link from "next/link";
import { LogoutButton } from "@/components/logout-button";

export function AppShell({ children, isAdmin }: { children:React.ReactNode; isAdmin:boolean }) {
  return <main className="shell"><header className="topbar"><Link className="brand" href={isAdmin ? "/dashboard" : "/clients"}>Nexup</Link><nav className="nav" aria-label="التنقل الرئيسي"><Link href="/clients">إدارة العملاء</Link>{isAdmin && <Link href="/finance">إدارة الحسابات</Link>}</nav><LogoutButton /></header><section className="content">{children}</section></main>;
}
