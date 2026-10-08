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
      // Same-origin navigation only: honor ?next= when it is a relative path
      // (never a protocol-relative "//host" or absolute URL), else /office.
      const next = new URLSearchParams(window.location.search).get("next");
      const target = next && next.startsWith("/") && !next.startsWith("//") ? next : "/office";
      window.location.assign(target);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Login failed."); } finally { setLoading(false); }
  }
  // method="post" is a safety net, not the real flow: the real login is the
  // fetch POST in `submit`. But if this component ever fails to hydrate, the
  // browser performs the native form action instead — and the default is a GET
  // that would put the password in the URL and the server logs. POST keeps the
  // credentials out of the query string.
  return <form onSubmit={submit} method="post">
    <label className="field">Email<input name="email" type="email" autoComplete="email" required /></label>
    <label className="field">Password<input name="password" type="password" autoComplete="current-password" required /></label>
    {error && <p className="error" role="alert">{error}</p>}
    <button className="button" style={{ marginTop:24, width:"100%" }} disabled={loading} type="submit">{loading ? "Logging in..." : "Login"}</button>
  </form>;
}
