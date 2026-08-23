"use client";

import { FormEvent, useState } from "react";

export function LoginForm() {
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError(""); setLoading(true);
    const form = new FormData(event.currentTarget);
    try {
      const response = await fetch("/api/auth/login", { method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify({ email:form.get("email"), password:form.get("password") }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "تعذر تسجيل الدخول.");
      window.location.assign(data.user.role === "ADMIN" ? "/dashboard" : "/clients");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "تعذر تسجيل الدخول."); } finally { setLoading(false); }
  }
  return <form onSubmit={submit}>
    <label className="field">البريد الإلكتروني<input name="email" type="email" autoComplete="email" required /></label>
    <label className="field">كلمة المرور<input name="password" type="password" autoComplete="current-password" required /></label>
    {error && <p className="error" role="alert">{error}</p>}
    <button className="button" style={{ marginTop:24, width:"100%" }} disabled={loading} type="submit">{loading ? "جارٍ التحقق..." : "تسجيل الدخول"}</button>
  </form>;
}
