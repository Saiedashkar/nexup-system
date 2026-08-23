import { AppShell } from "@/components/app-shell";

export default function FinancePage() {
  return <AppShell isAdmin><div className="placeholder"><p className="brand">إدارة الحسابات</p><h1>وحدة الحسابات محمية وجاهزة للبناء</h1><p className="muted">لا يمكن للموظفين الوصول إلى هذه الصفحة أو أي API مالي. ستُبنى الحركات والسحوبات والمصاريف في Phase 2.</p></div></AppShell>;
}
