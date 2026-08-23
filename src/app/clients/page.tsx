import { AppShell } from "@/components/app-shell";
import { getCurrentSession } from "@/lib/auth";

export default async function ClientsPage() {
  const session = await getCurrentSession();
  return <AppShell isAdmin={session?.role === "ADMIN"}><div className="placeholder"><p className="brand">إدارة العملاء</p><h1>وحدة العملاء جاهزة للبناء</h1><p className="muted">سيُضاف نموذج سجلات الخدمات، البحث، حالات العمل، واحتساب المتبقي في Phase 1.</p></div></AppShell>;
}
