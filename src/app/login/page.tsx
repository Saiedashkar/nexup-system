import { LoginForm } from "@/components/login-form";

export default function LoginPage() {
  return <main className="auth-page"><section className="auth-card" aria-labelledby="login-title"><p className="brand">Nexup</p><h1 id="login-title">مرحبًا بعودتك</h1><p className="muted">سجّل الدخول للوصول إلى نظام إدارة Nexup.</p><LoginForm /></section></main>;
}
