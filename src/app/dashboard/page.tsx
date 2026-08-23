import Link from "next/link";
import { AppShell } from "@/components/app-shell";

export default function DashboardPage() {
  return <AppShell isAdmin><div className="placeholder"><p className="brand">لوحة Nexup</p><h1>مرحبًا بك في النظام الإداري</h1><p className="muted">تم تجهيز الأساس الآمن للنظام. ستُبنى الوحدات والتقارير في المراحل التالية.</p><div className="actions"><Link className="action-card" href="/clients">إدارة العملاء</Link><Link className="action-card" href="/finance">إدارة الحسابات</Link></div></div></AppShell>;
}
