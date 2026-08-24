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
      if (!response.ok) throw new Error(data.error ?? "Login failed.");
      // Store role and business info for AppShell
      sessionStorage.setItem("nexup-role", data.user.role);
      sessionStorage.setItem("nexup-business", data.user.businessId || "");
      // Navigate based on role
      if (data.user.role === "SUPER_ADMIN") window.location.assign("/office");
      else if (data.user.role === "ADMIN") window.location.assign("/dashboard");
      else window.location.assign("/clients");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Login failed."); } finally { setLoading(false); }
  }
  return <form onSubmit={submit}>
    <label className="field">Email<input name="email" type="email" autoComplete="email" required /></label>
    <label className="field">Password<input name="password" type="password" autoComplete="current-password" required /></label>
    {error && <p className="error" role="alert">{error}</p>}
    <button className="button" style={{ marginTop:24, width:"100%" }} disabled={loading} type="submit">{loading ? "Logging in..." : "Login"}</button>
  </form>;
}
