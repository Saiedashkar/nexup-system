"use client";

import { useState, useEffect, useCallback, useMemo } from "react";

/* ── Types ── */
type Withdrawal = {
  id: string; amountSAR: string; exchangeRate: string; commissionPct: string;
  netEGP: string; date: string; month: number; year: number;
};
type Expense = {
  id: string; description: string; cost: string; category: "FIXED" | "VARIABLE";
  name: string; notes: string | null; date: string; month: number; year: number;
};
type PoolTx = {
  id: string; amountSAR: string; type: "IN" | "OUT"; date: string; note: string | null;
};

/* ── Helpers ── */
const fmt = (n: number) => n.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 });
const monthName = (m: number) => ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"][m - 1] || "";
const monthKey = (m: number, y: number) => `${y}-${String(m).padStart(2, "0")}`;
const toEN = (d: string) => new Date(d).toLocaleDateString("en-GB", { day: "2-digit", month: "2-digit", year: "numeric" });

/* ── Reusable: Group Header ── */
function MonthGroup({ label, count, sumLabel, sumValue, collapsed, onToggle, accent }: {
  label: string; count: number; sumLabel: string; sumValue: string;
  collapsed: boolean; onToggle: () => void; accent: string;
}) {
  return (
    <div onClick={onToggle} style={{
      display: "flex", alignItems: "center", gap: 12, padding: "10px 16px",
      background: "var(--surface-hover, rgba(13,148,136,0.04))", cursor: "pointer",
      borderBottom: "1px solid var(--border)", userSelect: "none", borderLeft: `3px solid ${accent}`,
    }}>
      <span style={{ fontSize: 11, color: "var(--muted)", width: 14 }}>{collapsed ? "▶" : "▼"}</span>
      <span style={{ fontSize: 13, fontWeight: 700, color: "var(--text)" }}>{label}</span>
      <span style={{ fontSize: 10, fontWeight: 600, padding: "2px 8px", borderRadius: 10, background: `${accent}15`, color: accent }}>
        {count} record{count !== 1 ? "s" : ""}
      </span>
      <span style={{ flex: 1 }} />
      <span style={{ fontSize: 11, color: "var(--muted)" }}>{sumLabel}:</span>
      <span style={{ fontSize: 13, fontWeight: 700, color: accent, direction: "ltr" }}>{sumValue}</span>
    </div>
  );
}

/* ── Inline Edit Cell ── */
function EditableCell({ value, onSave, type = "text", prefix, suffix, align = "left", bold, color }: {
  value: string; onSave: (v: string) => void; type?: string; prefix?: string;
  suffix?: string; align?: string; bold?: boolean; color?: string;
}) {
  const [editing, setEditing] = useState(false);
  const [temp, setTemp] = useState(value);

  const commit = () => {
    setEditing(false);
    if (temp !== value) onSave(temp);
  };

  if (editing) {
    return (
      <input
        type={type} value={temp} autoFocus
        onChange={e => setTemp(e.target.value)}
        onBlur={commit}
        onKeyDown={e => { if (e.key === "Enter") commit(); if (e.key === "Escape") { setTemp(value); setEditing(false); } }}
        style={{
          width: "100%", padding: "4px 8px", borderRadius: 4, border: "1px solid #0d9488",
          background: "var(--bg)", color: "var(--text)", fontSize: 12, outline: "none", boxSizing: "border-box",
        }}
      />
    );
  }

  return (
    <span
      onClick={() => setEditing(true)}
      title="Click to edit"
      style={{
        cursor: "pointer", padding: "2px 6px", borderRadius: 4, transition: "background 0.15s",
        fontWeight: bold ? 700 : 400, color: color || "var(--text)", direction: "ltr",
        display: "inline-block", textAlign: align as "left" | "right",
      }}
      onMouseEnter={e => (e.currentTarget.style.background = "rgba(13,148,136,0.08)")}
      onMouseLeave={e => (e.currentTarget.style.background = "transparent")}
    >
      {prefix}{value}{suffix}
    </span>
  );
}

/* ══════════════════════════════════════════════════════ */
/*                    MAIN PAGE                          */
/* ══════════════════════════════════════════════════════ */
export default function NexupFinancePage() {
  const [tab, setTab] = useState<"income" | "expenses" | "summary">("income");

  /* ── Data ── */
  const [poolBalance, setPoolBalance] = useState(0);
  const [poolTotalIn, setPoolTotalIn] = useState(0);
  const [poolTotalOut, setPoolTotalOut] = useState(0);
  const [withdrawals, setWithdrawals] = useState<Withdrawal[]>([]);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  /* ── Forms ── */
  const [showIncForm, setShowIncForm] = useState(false);
  const [showExpForm, setShowExpForm] = useState(false);
  const [incForm, setIncForm] = useState({ amountSAR: "", exchangeRate: "12.5", commissionPct: "10", date: new Date().toISOString().split("T")[0] });
  const [expForm, setExpForm] = useState({ date: new Date().toISOString().split("T")[0], description: "", cost: "", category: "FIXED" as "FIXED" | "VARIABLE", name: "", notes: "" });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  /* ── Fetch ── */
  const fetchData = useCallback(async () => {
    const [poolRes, wRes, eRes] = await Promise.all([fetch("/api/pool"), fetch("/api/withdrawals"), fetch("/api/expenses")]);
    if (poolRes.ok) {
      const d = await poolRes.json();
      setPoolBalance(d.balance || 0);
      const txs: PoolTx[] = d.transactions || [];
      setPoolTotalIn(txs.filter(t => t.type === "IN").reduce((s, t) => s + Number(t.amountSAR), 0));
      setPoolTotalOut(txs.filter(t => t.type === "OUT").reduce((s, t) => s + Number(t.amountSAR), 0));
    }
    if (wRes.ok) setWithdrawals(await wRes.json());
    if (eRes.ok) { const d = await eRes.json(); setExpenses(d.expenses || []); }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  /* ── Computed ── */
  const totalEGPIncome = useMemo(() => withdrawals.reduce((s, w) => s + Number(w.netEGP), 0), [withdrawals]);
  const totalEGPExpenses = useMemo(() => expenses.reduce((s, e) => s + Number(e.cost), 0), [expenses]);
  const netProfit = totalEGPIncome - totalEGPExpenses;

  const toggle = (k: string) => setCollapsed(p => ({ ...p, [k]: !p[k] }));

  /* ── Group by month (newest first) ── */
  function groupByMonth<T extends { month: number; year: number }>(items: T[]) {
    const g: Record<string, { items: T[]; month: number; year: number }> = {};
    for (const i of items) {
      const k = monthKey(i.month, i.year);
      if (!g[k]) g[k] = { items: [], month: i.month, year: i.year };
      g[k].items.push(i);
    }
    return Object.entries(g).sort(([a], [b]) => b.localeCompare(a));
  }

  const incGroups = useMemo(() => groupByMonth(withdrawals), [withdrawals]);
  const expGroups = useMemo(() => groupByMonth(expenses), [expenses]);

  const monthlyData = useMemo(() => {
    const m: Record<string, { income: number; expenses: number; month: number; year: number }> = {};
    for (const w of withdrawals) { const k = monthKey(w.month, w.year); if (!m[k]) m[k] = { income: 0, expenses: 0, month: w.month, year: w.year }; m[k].income += Number(w.netEGP); }
    for (const e of expenses) { const k = monthKey(e.month, e.year); if (!m[k]) m[k] = { income: 0, expenses: 0, month: e.month, year: e.year }; m[k].expenses += Number(e.cost); }
    return Object.entries(m).sort(([a], [b]) => b.localeCompare(a));
  }, [withdrawals, expenses]);

  /* ── Handlers ── */
  const submitInc = async () => {
    if (!incForm.amountSAR || !incForm.exchangeRate) { setError("Fill in amount and exchange rate"); return; }
    setSaving(true); setError("");
    const r = await fetch("/api/withdrawals", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ amountSAR: parseFloat(incForm.amountSAR), exchangeRate: parseFloat(incForm.exchangeRate), commissionPct: parseFloat(incForm.commissionPct || "10"), date: incForm.date }) });
    if (r.ok) { setShowIncForm(false); setIncForm({ amountSAR: "", exchangeRate: "12.5", commissionPct: "10", date: new Date().toISOString().split("T")[0] }); fetchData(); }
    else { const d = await r.json(); setError(d.error || "Failed"); }
    setSaving(false);
  };

  const submitExp = async () => {
    if (!expForm.description || !expForm.cost || !expForm.name) { setError("Fill in description, cost, and name"); return; }
    setSaving(true); setError("");
    const r = await fetch("/api/expenses", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...expForm, cost: parseFloat(expForm.cost) }) });
    if (r.ok) { setShowExpForm(false); setExpForm({ date: new Date().toISOString().split("T")[0], description: "", cost: "", category: "FIXED", name: "", notes: "" }); fetchData(); }
    else { const d = await r.json(); setError(d.error || "Failed"); }
    setSaving(false);
  };

  const deleteItem = async (type: "withdrawal" | "expense", id: string) => {
    const url = type === "withdrawal" ? `/api/withdrawals/${id}` : `/api/expenses/${id}`;
    await fetch(url, { method: "DELETE" });
    setConfirmDelete(null);
    fetchData();
  };

  const updateWithdrawal = async (id: string, field: string, value: string) => {
    await fetch(`/api/withdrawals/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ [field]: value }) });
    fetchData();
  };

  const updateExpense = async (id: string, field: string, value: string) => {
    await fetch(`/api/expenses/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ [field]: value }) });
    fetchData();
  };

  /* ── Render ── */
  return (
    <div style={{ maxWidth: 1200, margin: "0 auto" }}>
      {/* ═══ PERMANENT BALANCE BAR ═══ */}
      <div style={{
        display: "flex", alignItems: "center", gap: 24, padding: "14px 24px", marginBottom: 20,
        borderRadius: 12, background: "linear-gradient(135deg, rgba(13,148,136,0.08) 0%, rgba(13,148,136,0.02) 100%)",
        border: "1px solid rgba(13,148,136,0.2)",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <div style={{ width: 36, height: 36, borderRadius: 10, background: "rgba(13,148,136,0.15)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16 }}>💰</div>
          <div>
            <div style={{ fontSize: 10, color: "var(--muted)", textTransform: "uppercase", letterSpacing: 0.5 }}>Available Balance</div>
            <div style={{ fontSize: 20, fontWeight: 800, color: "#0d9488", direction: "ltr" }}>{fmt(poolBalance)} <span style={{ fontSize: 12, fontWeight: 600 }}>SAR</span></div>
          </div>
        </div>
        <div style={{ width: 1, height: 32, background: "var(--border)" }} />
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <div style={{ fontSize: 10, color: "var(--muted)" }}>Total Income</div>
          <div style={{ fontSize: 14, fontWeight: 700, color: "#10b981", direction: "ltr" }}>{fmt(poolTotalIn)} SAR</div>
        </div>
        <div style={{ width: 1, height: 32, background: "var(--border)" }} />
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <div style={{ fontSize: 10, color: "var(--muted)" }}>Total Withdrawn</div>
          <div style={{ fontSize: 14, fontWeight: 700, color: "#ef4444", direction: "ltr" }}>{fmt(poolTotalOut)} SAR</div>
        </div>
        <div style={{ width: 1, height: 32, background: "var(--border)" }} />
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <div style={{ fontSize: 10, color: "var(--muted)" }}>Converted (EGP)</div>
          <div style={{ fontSize: 14, fontWeight: 700, color: "#3b82f6", direction: "ltr" }}>{fmt(totalEGPIncome)} EGP</div>
        </div>
      </div>

      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
        <div>
          <h1 style={{ fontSize: 24, fontWeight: 800, color: "var(--text)", margin: 0 }}>Finance</h1>
          <p style={{ fontSize: 13, color: "var(--muted)", margin: "4px 0 0" }}>Income · Expenses · Monthly Summary</p>
        </div>
      </div>

      {/* Tabs */}
      <div style={{ display: "flex", gap: 4, marginBottom: 20, background: "var(--surface)", padding: 4, borderRadius: 10, border: "1px solid var(--border)" }}>
        {([ { key: "income", label: "Income", icon: "💰" }, { key: "expenses", label: "Expenses", icon: "🧾" }, { key: "summary", label: "Monthly Summary", icon: "📊" }] as const).map(t => (
          <button key={t.key} onClick={() => setTab(t.key)} style={{
            padding: "8px 20px", borderRadius: 8, border: "none", display: "flex", alignItems: "center", gap: 6,
            background: tab === t.key ? "#0d9488" : "transparent",
            color: tab === t.key ? "#fff" : "var(--muted)", fontSize: 13, fontWeight: 600, cursor: "pointer",
          }}><span>{t.icon}</span>{t.label}</button>
        ))}
      </div>

      {error && <div style={{ padding: "10px 16px", borderRadius: 8, background: "rgba(239,68,68,0.1)", color: "#ef4444", fontSize: 13, marginBottom: 16 }}>{error}</div>}

      {/* ═══════════════ INCOME TAB ═══════════════ */}
      {tab === "income" && (
        <div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
            <span style={{ fontSize: 14, fontWeight: 700, color: "var(--text)" }}>Income Record — SAR → EGP</span>
            <button onClick={() => setShowIncForm(!showIncForm)} style={{
              padding: "8px 18px", borderRadius: 8, border: "none",
              background: showIncForm ? "#6b7280" : "#0d9488", color: "#fff", fontSize: 13, fontWeight: 600, cursor: "pointer",
            }}>{showIncForm ? "✕ Cancel" : "＋ New Withdrawal"}</button>
          </div>

          {showIncForm && (
            <div style={{ padding: 20, borderRadius: 12, background: "var(--surface)", border: "1px solid var(--border)", marginBottom: 20, boxShadow: "0 4px 12px rgba(0,0,0,0.06)" }}>
              <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 16, color: "var(--text)" }}>Convert SAR → EGP</div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 14, marginBottom: 14 }}>
                <div><label style={lbl}>Amount to Withdraw (SAR) *</label><input type="number" value={incForm.amountSAR} onChange={e => setIncForm(f => ({ ...f, amountSAR: e.target.value }))} placeholder="3000" style={inp} /></div>
                <div><label style={lbl}>Exchange Rate (EGP per 1 SAR) *</label><input type="number" step="0.01" value={incForm.exchangeRate} onChange={e => setIncForm(f => ({ ...f, exchangeRate: e.target.value }))} style={inp} /></div>
                <div><label style={lbl}>Commission %</label><input type="number" step="0.5" value={incForm.commissionPct} onChange={e => setIncForm(f => ({ ...f, commissionPct: e.target.value }))} style={inp} /></div>
                <div><label style={lbl}>Date</label><input type="date" value={incForm.date} onChange={e => setIncForm(f => ({ ...f, date: e.target.value }))} style={inp} /></div>
              </div>
              {incForm.amountSAR && incForm.exchangeRate && (
                <div style={{ padding: "12px 16px", borderRadius: 8, background: "rgba(13,148,136,0.05)", border: "1px dashed rgba(13,148,136,0.3)", marginBottom: 14, fontSize: 13, color: "var(--text)" }}>
                  Preview: <b>{fmt(Number(incForm.amountSAR))} SAR</b> → commission: <span style={{ color: "#ef4444" }}>-{incForm.commissionPct || "10"}%</span> → <b style={{ color: "#0d9488" }}>{fmt(Number(incForm.amountSAR) * Number(incForm.exchangeRate || 0) * (1 - Number(incForm.commissionPct || 10) / 100))} EGP</b>
                </div>
              )}
              <div style={{ display: "flex", gap: 10 }}>
                <button onClick={submitInc} disabled={saving} style={{ padding: "10px 24px", borderRadius: 8, border: "none", background: "#0d9488", color: "#fff", fontSize: 13, fontWeight: 700, cursor: "pointer", opacity: saving ? 0.6 : 1 }}>{saving ? "Saving..." : "Save"}</button>
                <button onClick={() => setShowIncForm(false)} style={{ padding: "10px 24px", borderRadius: 8, border: "1px solid var(--border)", background: "transparent", color: "var(--muted)", fontSize: 13, cursor: "pointer" }}>Cancel</button>
              </div>
            </div>
          )}

          {/* Table */}
          <div style={{ borderRadius: 12, border: "1px solid var(--border)", overflow: "hidden" }}>
            <div style={{ display: "grid", gridTemplateColumns: "80px 1fr 80px 1fr 80px 1fr 100px", padding: "10px 16px", background: "var(--surface)", borderBottom: "2px solid var(--border)", fontSize: 11, fontWeight: 600, color: "var(--muted)", textTransform: "uppercase", letterSpacing: 0.5 }}>
              <div>DATE</div><div style={{ textAlign: "right" }}>INCOME SR</div><div style={{ textAlign: "right" }}>RATE</div>
              <div style={{ textAlign: "right" }}>INCOME EGP</div><div>ACCOUNT</div><div>NOTES</div><div style={{ textAlign: "center" }}>ACTIONS</div>
            </div>

            {incGroups.length === 0 ? (
              <div style={{ textAlign: "center", padding: 48, color: "var(--muted)", fontSize: 13 }}>No withdrawals yet.</div>
            ) : incGroups.map(([key, grp]) => {
              const col = collapsed[key];
              const sumEGP = grp.items.reduce((s, w) => s + Number(w.netEGP), 0);
              return (
                <div key={key}>
                  <MonthGroup label={`${monthName(grp.month)} ${grp.year}`} count={grp.items.length} sumLabel="Sum EGP" sumValue={`${fmt(sumEGP)} EGP`} collapsed={!!col} onToggle={() => toggle(key)} accent="#0d9488" />
                  {!col && grp.items.map(w => (
                    <div key={w.id} style={{ display: "grid", gridTemplateColumns: "80px 1fr 80px 1fr 80px 1fr 100px", padding: "8px 16px", borderBottom: "1px solid var(--border)", fontSize: 13, alignItems: "center", transition: "background 0.1s" }}
                      onMouseEnter={e => (e.currentTarget.style.background = "var(--surface-hover, rgba(0,0,0,0.02))")} onMouseLeave={e => (e.currentTarget.style.background = "transparent")}>
                      <div style={{ fontSize: 12, color: "var(--muted)" }}>{toEN(w.date)}</div>
                      <div style={{ textAlign: "right" }}><EditableCell value={fmt(Number(w.amountSAR))} onSave={v => updateWithdrawal(w.id, "amountSAR", v)} prefix="SAR" bold /></div>
                      <div style={{ textAlign: "right" }}><EditableCell value={String(Number(w.exchangeRate))} onSave={v => updateWithdrawal(w.id, "exchangeRate", v)} /></div>
                      <div style={{ textAlign: "right", fontWeight: 700, color: "#0d9488" }}>EGP{fmt(Number(w.netEGP))}</div>
                      <div style={{ fontSize: 11, color: "var(--muted)" }}>NEXUP</div>
                      <div style={{ fontSize: 12, color: "var(--muted)" }}>{Number(w.commissionPct) > 0 ? `Comm: ${w.commissionPct}%` : "—"}</div>
                      <div style={{ display: "flex", gap: 4, justifyContent: "center" }}>
                        {confirmDelete === `w-${w.id}` ? (
                          <><button onClick={() => deleteItem("withdrawal", w.id)} style={{ padding: "3px 8px", borderRadius: 4, border: "none", background: "#ef4444", color: "#fff", fontSize: 10, cursor: "pointer" }}>Confirm</button>
                          <button onClick={() => setConfirmDelete(null)} style={{ padding: "3px 8px", borderRadius: 4, border: "1px solid var(--border)", background: "transparent", color: "var(--muted)", fontSize: 10, cursor: "pointer" }}>Cancel</button></>
                        ) : (
                          <button onClick={() => setConfirmDelete(`w-${w.id}`)} style={{ padding: "3px 8px", borderRadius: 4, border: "1px solid rgba(239,68,68,0.3)", background: "rgba(239,68,68,0.05)", color: "#ef4444", fontSize: 10, cursor: "pointer" }}>🗑</button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ═══════════════ EXPENSES TAB ═══════════════ */}
      {tab === "expenses" && (
        <div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
            <span style={{ fontSize: 14, fontWeight: 700, color: "var(--text)" }}>All Expenses — NEXUP (Egypt)</span>
            <button onClick={() => setShowExpForm(!showExpForm)} style={{
              padding: "8px 18px", borderRadius: 8, border: "none",
              background: showExpForm ? "#6b7280" : "#ef4444", color: "#fff", fontSize: 13, fontWeight: 600, cursor: "pointer",
            }}>{showExpForm ? "✕ Cancel" : "＋ New Expense"}</button>
          </div>

          {showExpForm && (
            <div style={{ padding: 20, borderRadius: 12, background: "var(--surface)", border: "1px solid var(--border)", marginBottom: 20, boxShadow: "0 4px 12px rgba(0,0,0,0.06)" }}>
              <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 16 }}>New Expense</div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 14, marginBottom: 14 }}>
                <div><label style={lbl}>Date *</label><input type="date" value={expForm.date} onChange={e => setExpForm(f => ({ ...f, date: e.target.value }))} style={inp} /></div>
                <div><label style={lbl}>Description *</label><input value={expForm.description} onChange={e => setExpForm(f => ({ ...f, description: e.target.value }))} placeholder="e.g. Rent, Electricity, Salary" style={inp} /></div>
                <div><label style={lbl}>Cost (EGP) *</label><input type="number" value={expForm.cost} onChange={e => setExpForm(f => ({ ...f, cost: e.target.value }))} placeholder="7500" style={inp} /></div>
                <div>
                  <label style={lbl}>Category *</label>
                  <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
                    {(["FIXED", "VARIABLE"] as const).map(c => (
                      <button key={c} type="button" onClick={() => setExpForm(f => ({ ...f, category: c }))} style={{
                        flex: 1, padding: "8px 0", borderRadius: 8,
                        border: expForm.category === c ? (c === "FIXED" ? "2px solid #f59e0b" : "2px solid #3b82f6") : "1px solid var(--border)",
                        background: expForm.category === c ? (c === "FIXED" ? "rgba(245,158,11,0.1)" : "rgba(59,130,246,0.1)") : "transparent",
                        color: expForm.category === c ? (c === "FIXED" ? "#f59e0b" : "#3b82f6") : "var(--muted)",
                        fontSize: 12, fontWeight: 600, cursor: "pointer",
                      }}>{c === "FIXED" ? "📌 Fixed" : "🔄 Variable"}</button>
                    ))}
                  </div>
                </div>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginBottom: 14 }}>
                <div><label style={lbl}>Name / Recipient *</label><input value={expForm.name} onChange={e => setExpForm(f => ({ ...f, name: e.target.value }))} placeholder="e.g. ALIAA, NOUR (salary) or Rent, Net" style={inp} /></div>
                <div><label style={lbl}>Notes (optional)</label><input value={expForm.notes} onChange={e => setExpForm(f => ({ ...f, notes: e.target.value }))} placeholder="Additional notes" style={inp} /></div>
              </div>
              <div style={{ display: "flex", gap: 10 }}>
                <button onClick={submitExp} disabled={saving} style={{ padding: "10px 24px", borderRadius: 8, border: "none", background: "#ef4444", color: "#fff", fontSize: 13, fontWeight: 700, cursor: "pointer", opacity: saving ? 0.6 : 1 }}>{saving ? "Saving..." : "Save"}</button>
                <button onClick={() => setShowExpForm(false)} style={{ padding: "10px 24px", borderRadius: 8, border: "1px solid var(--border)", background: "transparent", color: "var(--muted)", fontSize: 13, cursor: "pointer" }}>Cancel</button>
              </div>
            </div>
          )}

          {/* Table */}
          <div style={{ borderRadius: 12, border: "1px solid var(--border)", overflow: "hidden" }}>
            <div style={{ display: "grid", gridTemplateColumns: "80px 1fr 100px 100px 1fr 80px 100px", padding: "10px 16px", background: "var(--surface)", borderBottom: "2px solid var(--border)", fontSize: 11, fontWeight: 600, color: "var(--muted)", textTransform: "uppercase", letterSpacing: 0.5 }}>
              <div>DATE</div><div>DESCRIPTION</div><div style={{ textAlign: "right" }}>COST</div><div>NAME</div><div>NOTES</div><div style={{ textAlign: "right" }}>TOTAL</div><div style={{ textAlign: "center" }}>ACTIONS</div>
            </div>

            {expGroups.length === 0 ? (
              <div style={{ textAlign: "center", padding: 48, color: "var(--muted)", fontSize: 13 }}>No expenses yet.</div>
            ) : expGroups.map(([key, grp]) => {
              const col = collapsed[key];
              const sumCost = grp.items.reduce((s, e) => s + Number(e.cost), 0);
              return (
                <div key={key}>
                  <MonthGroup label={`${monthName(grp.month)} ${grp.year}`} count={grp.items.length} sumLabel="Sum EGP" sumValue={`${fmt(sumCost)} EGP`} collapsed={!!col} onToggle={() => toggle(key)} accent="#ef4444" />
                  {!col && grp.items.map(e => (
                    <div key={e.id} style={{ display: "grid", gridTemplateColumns: "80px 1fr 100px 100px 1fr 80px 100px", padding: "8px 16px", borderBottom: "1px solid var(--border)", fontSize: 13, alignItems: "center", transition: "background 0.1s" }}
                      onMouseEnter={ev => (ev.currentTarget.style.background = "var(--surface-hover, rgba(0,0,0,0.02))")} onMouseLeave={ev => (ev.currentTarget.style.background = "transparent")}>
                      <div style={{ fontSize: 12, color: "var(--muted)" }}>{toEN(e.date)}</div>
                      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                        <span style={{ fontSize: 9, padding: "2px 6px", borderRadius: 4, fontWeight: 600, background: e.category === "FIXED" ? "rgba(245,158,11,0.1)" : "rgba(59,130,246,0.1)", color: e.category === "FIXED" ? "#f59e0b" : "#3b82f6" }}>{e.category === "FIXED" ? "FIXED" : "VAR"}</span>
                        <EditableCell value={e.description} onSave={v => updateExpense(e.id, "description", v)} />
                      </div>
                      <div style={{ textAlign: "right" }}><EditableCell value={fmt(Number(e.cost))} onSave={v => updateExpense(e.id, "cost", v)} prefix="EGP" bold /></div>
                      <div><EditableCell value={e.name} onSave={v => updateExpense(e.id, "name", v)} /></div>
                      <div style={{ fontSize: 12, color: "var(--muted)" }}><EditableCell value={e.notes || ""} onSave={v => updateExpense(e.id, "notes", v)} /></div>
                      <div style={{ textAlign: "right", fontSize: 12, color: "var(--muted)" }}>{key}</div>
                      <div style={{ display: "flex", gap: 4, justifyContent: "center" }}>
                        {confirmDelete === `e-${e.id}` ? (
                          <><button onClick={() => deleteItem("expense", e.id)} style={{ padding: "3px 8px", borderRadius: 4, border: "none", background: "#ef4444", color: "#fff", fontSize: 10, cursor: "pointer" }}>Confirm</button>
                          <button onClick={() => setConfirmDelete(null)} style={{ padding: "3px 8px", borderRadius: 4, border: "1px solid var(--border)", background: "transparent", color: "var(--muted)", fontSize: 10, cursor: "pointer" }}>Cancel</button></>
                        ) : (
                          <button onClick={() => setConfirmDelete(`e-${e.id}`)} style={{ padding: "3px 8px", borderRadius: 4, border: "1px solid rgba(239,68,68,0.3)", background: "rgba(239,68,68,0.05)", color: "#ef4444", fontSize: 10, cursor: "pointer" }}>🗑</button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ═══════════════ MONTHLY SUMMARY TAB ═══════════════ */}
      {tab === "summary" && (
        <div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 14, marginBottom: 20 }}>
            {[
              { label: "Total Income (EGP)", value: `${fmt(totalEGPIncome)} EGP`, color: "#10b981", bg: "rgba(16,185,129,0.06)" },
              { label: "Total Expenses (EGP)", value: `${fmt(totalEGPExpenses)} EGP`, color: "#ef4444", bg: "rgba(239,68,68,0.06)" },
              { label: "Net Profit (EGP)", value: `${fmt(netProfit)} EGP`, color: netProfit >= 0 ? "#10b981" : "#ef4444", bg: netProfit >= 0 ? "rgba(16,185,129,0.06)" : "rgba(239,68,68,0.06)" },
              { label: "Profit Margin", value: totalEGPIncome > 0 ? `${((netProfit / totalEGPIncome) * 100).toFixed(1)}%` : "—", color: "#3b82f6", bg: "rgba(59,130,246,0.06)" },
            ].map(s => (
              <div key={s.label} style={{ padding: "18px 20px", borderRadius: 12, background: s.bg, border: "1px solid var(--border)" }}>
                <div style={{ fontSize: 11, color: "var(--muted)", marginBottom: 6 }}>{s.label}</div>
                <div style={{ fontSize: 22, fontWeight: 800, color: s.color, direction: "ltr" }}>{s.value}</div>
              </div>
            ))}
          </div>

          <div style={{ borderRadius: 12, border: "1px solid var(--border)", overflow: "hidden" }}>
            <div style={{ display: "grid", gridTemplateColumns: "140px 1fr 1fr 1fr", padding: "10px 16px", background: "var(--surface)", borderBottom: "2px solid var(--border)", fontSize: 11, fontWeight: 600, color: "var(--muted)", textTransform: "uppercase", letterSpacing: 0.5 }}>
              <div>MONTH</div><div style={{ textAlign: "right" }}>INCOME (EGP)</div><div style={{ textAlign: "right" }}>EXPENSES (EGP)</div><div style={{ textAlign: "right" }}>NET PROFIT (EGP)</div>
            </div>

            {monthlyData.length === 0 ? (
              <div style={{ textAlign: "center", padding: 48, color: "var(--muted)", fontSize: 13 }}>No data yet.</div>
            ) : monthlyData.map(([key, data]) => {
              const profit = data.income - data.expenses;
              return (
                <div key={key} style={{ display: "grid", gridTemplateColumns: "140px 1fr 1fr 1fr", padding: "12px 16px", borderBottom: "1px solid var(--border)", fontSize: 13, alignItems: "center" }}
                  onMouseEnter={e => (e.currentTarget.style.background = "var(--surface-hover, rgba(0,0,0,0.02))")} onMouseLeave={e => (e.currentTarget.style.background = "transparent")}>
                  <div style={{ fontWeight: 700 }}>{monthName(data.month)} {data.year}</div>
                  <div style={{ textAlign: "right", fontWeight: 700, color: "#10b981", direction: "ltr" }}>{fmt(data.income)} EGP</div>
                  <div style={{ textAlign: "right", fontWeight: 700, color: "#ef4444", direction: "ltr" }}>{fmt(data.expenses)} EGP</div>
                  <div style={{ textAlign: "right", fontWeight: 800, color: profit >= 0 ? "#10b981" : "#ef4444", direction: "ltr", fontSize: 14 }}>{profit >= 0 ? "+" : ""}{fmt(profit)} EGP</div>
                </div>
              );
            })}

            {monthlyData.length > 0 && (
              <div style={{ display: "grid", gridTemplateColumns: "140px 1fr 1fr 1fr", padding: "14px 16px", background: "var(--surface)", fontWeight: 700, fontSize: 14, borderTop: "2px solid var(--border)" }}>
                <div>TOTAL</div>
                <div style={{ textAlign: "right", color: "#10b981", direction: "ltr" }}>{fmt(totalEGPIncome)} EGP</div>
                <div style={{ textAlign: "right", color: "#ef4444", direction: "ltr" }}>{fmt(totalEGPExpenses)} EGP</div>
                <div style={{ textAlign: "right", color: netProfit >= 0 ? "#10b981" : "#ef4444", direction: "ltr", fontSize: 16 }}>{netProfit >= 0 ? "+" : ""}{fmt(netProfit)} EGP</div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/* ── Shared Styles ── */
const lbl: React.CSSProperties = { display: "block", fontSize: 11, fontWeight: 600, color: "var(--muted)", marginBottom: 4, textTransform: "uppercase", letterSpacing: 0.3 };
const inp: React.CSSProperties = { width: "100%", padding: "10px 12px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--bg)", color: "var(--text)", fontSize: 13, outline: "none", boxSizing: "border-box" as const };
