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
  projectRecord?: { projectName: string; client?: { name: string } } | null;
};

/* ── Helpers ── */
const fmt = (n: number) => n.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 });
const monthName = (m: number) => ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"][m - 1] || "";
const monthKey = (m: number, y: number) => `${y}-${String(m).padStart(2, "0")}`;

/* ── Reusable: Grouped month row ── */
function MonthGroupHeader({
  label, count, sumLabel, sumValue, collapsed, onToggle, accentColor,
}: {
  label: string; count: number; sumLabel: string; sumValue: string;
  collapsed: boolean; onToggle: () => void; accentColor: string;
}) {
  return (
    <div
      onClick={onToggle}
      style={{
        display: "flex", alignItems: "center", gap: 12, padding: "10px 16px",
        background: "var(--surface-hover, rgba(13,148,136,0.04))", cursor: "pointer",
        borderBottom: "1px solid var(--border)", userSelect: "none",
        borderLeft: `3px solid ${accentColor}`,
      }}
    >
      <span style={{ fontSize: 11, color: "var(--muted)", width: 14, textAlign: "center" }}>{collapsed ? "▶" : "▼"}</span>
      <span style={{ fontSize: 13, fontWeight: 700, color: "var(--text)" }}>{label}</span>
      <span style={{
        fontSize: 10, fontWeight: 600, padding: "2px 8px", borderRadius: 10,
        background: "rgba(13,148,136,0.1)", color: accentColor,
      }}>{count} record{count !== 1 ? "s" : ""}</span>
      <span style={{ flex: 1 }} />
      <span style={{ fontSize: 11, color: "var(--muted)" }}>{sumLabel}:</span>
      <span style={{ fontSize: 13, fontWeight: 700, color: accentColor, direction: "ltr" }}>{sumValue}</span>
    </div>
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
  const [withdrawals, setWithdrawals] = useState<Withdrawal[]>([]);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [collapsedMonths, setCollapsedMonths] = useState<Record<string, boolean>>({});

  /* ── Forms ── */
  const [showIncomeForm, setShowIncomeForm] = useState(false);
  const [showExpenseForm, setShowExpenseForm] = useState(false);
  const [incForm, setIncForm] = useState({ amountSAR: "", exchangeRate: "12.5", commissionPct: "10", notes: "", date: new Date().toISOString().split("T")[0] });
  const [expForm, setExpForm] = useState({ date: new Date().toISOString().split("T")[0], description: "", cost: "", category: "FIXED" as "FIXED" | "VARIABLE", name: "", notes: "" });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  /* ── Fetch ── */
  const fetchData = useCallback(async () => {
    const [poolRes, wRes, eRes] = await Promise.all([
      fetch("/api/pool"),
      fetch("/api/withdrawals"),
      fetch("/api/expenses"),
    ]);
    if (poolRes.ok) {
      const d = await poolRes.json();
      setPoolBalance(d.balance || 0);
      setPoolTotalIn((d.transactions || []).filter((t: PoolTx) => t.type === "IN").reduce((s: number, t: PoolTx) => s + Number(t.amountSAR), 0));
    }
    if (wRes.ok) setWithdrawals(await wRes.json());
    if (eRes.ok) {
      const d = await eRes.json();
      setExpenses(d.expenses || []);
    }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  /* ── Computed ── */
  const totalEGPIncome = useMemo(() => withdrawals.reduce((s, w) => s + Number(w.netEGP), 0), [withdrawals]);
  const totalEGPExpenses = useMemo(() => expenses.reduce((s, e) => s + Number(e.cost), 0), [expenses]);
  const netProfit = totalEGPIncome - totalEGPExpenses;

  const toggleMonth = (key: string) => setCollapsedMonths(prev => ({ ...prev, [key]: !prev[key] }));

  /* ── Group by month ── */
  function groupByMonth<T extends { month: number; year: number }>(items: T[]) {
    const groups: Record<string, { items: T[]; month: number; year: number }> = {};
    for (const item of items) {
      const key = monthKey(item.month, item.year);
      if (!groups[key]) groups[key] = { items: [], month: item.month, year: item.year };
      groups[key].items.push(item);
    }
    return Object.entries(groups).sort(([a], [b]) => b.localeCompare(a)); // newest first
  }

  const incGroups = useMemo(() => groupByMonth(withdrawals), [withdrawals]);
  const expGroups = useMemo(() => groupByMonth(expenses), [expenses]);

  /* ── Profit by month ── */
  const monthlyData = useMemo(() => {
    const map: Record<string, { income: number; expenses: number; month: number; year: number }> = {};
    for (const w of withdrawals) {
      const k = monthKey(w.month, w.year);
      if (!map[k]) map[k] = { income: 0, expenses: 0, month: w.month, year: w.year };
      map[k].income += Number(w.netEGP);
    }
    for (const e of expenses) {
      const k = monthKey(e.month, e.year);
      if (!map[k]) map[k] = { income: 0, expenses: 0, month: e.month, year: e.year };
      map[k].expenses += Number(e.cost);
    }
    return Object.entries(map).sort(([a], [b]) => b.localeCompare(a));
  }, [withdrawals, expenses]);

  /* ── Handlers ── */
  const submitIncome = async () => {
    if (!incForm.amountSAR || !incForm.exchangeRate) { setError("Fill in amount and exchange rate"); return; }
    setSaving(true); setError("");
    const r = await fetch("/api/withdrawals", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ amountSAR: parseFloat(incForm.amountSAR), exchangeRate: parseFloat(incForm.exchangeRate), commissionPct: parseFloat(incForm.commissionPct || "10"), date: incForm.date }),
    });
    if (r.ok) { setShowIncomeForm(false); setIncForm({ amountSAR: "", exchangeRate: "12.5", commissionPct: "10", notes: "", date: new Date().toISOString().split("T")[0] }); fetchData(); }
    else { const d = await r.json(); setError(d.error || "Failed"); }
    setSaving(false);
  };

  const submitExpense = async () => {
    if (!expForm.description || !expForm.cost || !expForm.name) { setError("Fill in description, cost, and name"); return; }
    setSaving(true); setError("");
    const r = await fetch("/api/expenses", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...expForm, cost: parseFloat(expForm.cost) }),
    });
    if (r.ok) { setShowExpenseForm(false); setExpForm({ date: new Date().toISOString().split("T")[0], description: "", cost: "", category: "FIXED", name: "", notes: "" }); fetchData(); }
    else { const d = await r.json(); setError(d.error || "Failed"); }
    setSaving(false);
  };

  /* ── Tabs ── */
  const tabs = [
    { key: "income", label: "Income", icon: "💰" },
    { key: "expenses", label: "Expenses", icon: "🧾" },
    { key: "summary", label: "Monthly Summary", icon: "📊" },
  ] as const;

  return (
    <div style={{ maxWidth: 1200, margin: "0 auto" }}>
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24 }}>
        <div>
          <h1 style={{ fontSize: 24, fontWeight: 800, color: "var(--text)", margin: 0 }}>Finance</h1>
          <p style={{ fontSize: 13, color: "var(--muted)", margin: "4px 0 0" }}>Income · Expenses · Monthly Summary</p>
        </div>
      </div>

      {/* Tabs */}
      <div style={{ display: "flex", gap: 4, marginBottom: 20, background: "var(--surface)", padding: 4, borderRadius: 10, border: "1px solid var(--border)" }}>
        {tabs.map(t => (
          <button key={t.key} onClick={() => setTab(t.key)} style={{
            padding: "8px 20px", borderRadius: 8, border: "none", display: "flex", alignItems: "center", gap: 6,
            background: tab === t.key ? "#0d9488" : "transparent",
            color: tab === t.key ? "#fff" : "var(--muted)", fontSize: 13, fontWeight: 600, cursor: "pointer", transition: "all 0.15s",
          }}><span>{t.icon}</span>{t.label}</button>
        ))}
      </div>

      {/* Error */}
      {error && <div style={{ padding: "10px 16px", borderRadius: 8, background: "rgba(239,68,68,0.1)", color: "#ef4444", fontSize: 13, marginBottom: 16 }}>{error}</div>}

      {/* ═══════════════════════════ INCOME TAB ═══════════════════════════ */}
      {tab === "income" && (
        <div>
          {/* Stats Row */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 14, marginBottom: 20 }}>
            {[
              { label: "Available Balance (SAR)", value: `${fmt(poolBalance)} SAR`, color: "#0d9488", bg: "rgba(13,148,136,0.06)" },
              { label: "Total Income (SAR)", value: `${fmt(poolTotalIn)} SAR`, color: "#10b981", bg: "rgba(16,185,129,0.06)" },
              { label: "Total Converted (EGP)", value: `${fmt(totalEGPIncome)} EGP`, color: "#3b82f6", bg: "rgba(59,130,246,0.06)" },
            ].map(s => (
              <div key={s.label} style={{ padding: "18px 20px", borderRadius: 12, background: s.bg, border: "1px solid var(--border)" }}>
                <div style={{ fontSize: 11, color: "var(--muted)", marginBottom: 6 }}>{s.label}</div>
                <div style={{ fontSize: 22, fontWeight: 800, color: s.color, direction: "ltr" }}>{s.value}</div>
              </div>
            ))}
          </div>

          {/* Action Bar */}
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
            <span style={{ fontSize: 14, fontWeight: 700, color: "var(--text)" }}>
              Income Record — SAR → EGP
            </span>
            <button onClick={() => setShowIncomeForm(!showIncomeForm)} style={{
              padding: "8px 18px", borderRadius: 8, border: "none",
              background: showIncomeForm ? "#6b7280" : "#0d9488", color: "#fff",
              fontSize: 13, fontWeight: 600, cursor: "pointer",
            }}>{showIncomeForm ? "✕ Cancel" : "＋ New Withdrawal"}</button>
          </div>

          {/* Withdrawal Form */}
          {showIncomeForm && (
            <div style={{
              padding: 20, borderRadius: 12, background: "var(--surface)", border: "1px solid var(--border)",
              marginBottom: 20, boxShadow: "0 4px 12px rgba(0,0,0,0.06)",
            }}>
              <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 16, color: "var(--text)" }}>
                Convert SAR → EGP
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 14, marginBottom: 14 }}>
                <div>
                  <label style={labelStyle}>Amount to Withdraw (SAR) *</label>
                  <input type="number" value={incForm.amountSAR} onChange={e => setIncForm(f => ({ ...f, amountSAR: e.target.value }))}
                    placeholder="3000" style={inputStyle} />
                </div>
                <div>
                  <label style={labelStyle}>Exchange Rate (EGP per 1 SAR) *</label>
                  <input type="number" step="0.01" value={incForm.exchangeRate} onChange={e => setIncForm(f => ({ ...f, exchangeRate: e.target.value }))}
                    placeholder="12.5" style={inputStyle} />
                </div>
                <div>
                  <label style={labelStyle}>Commission %</label>
                  <input type="number" step="0.5" value={incForm.commissionPct} onChange={e => setIncForm(f => ({ ...f, commissionPct: e.target.value }))}
                    style={inputStyle} />
                </div>
                <div>
                  <label style={labelStyle}>Date</label>
                  <input type="date" value={incForm.date} onChange={e => setIncForm(f => ({ ...f, date: e.target.value }))} style={inputStyle} />
                </div>
              </div>
              {/* Live Preview */}
              {incForm.amountSAR && incForm.exchangeRate && (
                <div style={{
                  display: "flex", gap: 20, padding: "12px 16px", borderRadius: 8,
                  background: "rgba(13,148,136,0.05)", border: "1px dashed rgba(13,148,136,0.3)", marginBottom: 14,
                }}>
                  <div style={{ fontSize: 12, color: "var(--muted)" }}>Preview:</div>
                  <div style={{ fontSize: 13, color: "var(--text)" }}>
                    <b style={{ direction: "ltr" }}>{fmt(Number(incForm.amountSAR))} SAR</b>
                    {" → commission: "}
                    <span style={{ color: "#ef4444" }}>-{incForm.commissionPct || "10"}%</span>
                    {" → "}
                    <b style={{ color: "#0d9488", direction: "ltr" }}>
                      {fmt(Number(incForm.amountSAR) * Number(incForm.exchangeRate || 0) * (1 - Number(incForm.commissionPct || 10) / 100))} EGP
                    </b>
                  </div>
                </div>
              )}
              <div style={{ display: "flex", gap: 10 }}>
                <button onClick={submitIncome} disabled={saving} style={{
                  padding: "10px 24px", borderRadius: 8, border: "none",
                  background: "#0d9488", color: "#fff", fontSize: 13, fontWeight: 700, cursor: "pointer", opacity: saving ? 0.6 : 1,
                }}>{saving ? "Saving..." : "Save Withdrawal"}</button>
                <button onClick={() => setShowIncomeForm(false)} style={{
                  padding: "10px 24px", borderRadius: 8, border: "1px solid var(--border)",
                  background: "transparent", color: "var(--muted)", fontSize: 13, cursor: "pointer",
                }}>Cancel</button>
              </div>
            </div>
          )}

          {/* Monthly Grouped Table */}
          <div style={{ borderRadius: 12, border: "1px solid var(--border)", overflow: "hidden" }}>
            {/* Table Header */}
            <div style={{
              display: "grid", gridTemplateColumns: "90px 120px 90px 120px 100px 1fr",
              padding: "10px 16px", background: "var(--surface)", borderBottom: "2px solid var(--border)", fontSize: 11,
              fontWeight: 600, color: "var(--muted)", textTransform: "uppercase", letterSpacing: 0.5,
            }}>
              <div>DATE</div>
              <div style={{ textAlign: "right" }}>INCOME SR</div>
              <div style={{ textAlign: "right" }}>CURRENCY</div>
              <div style={{ textAlign: "right" }}>INCOME EGP</div>
              <div>ACCOUNT</div>
              <div>NOTES</div>
            </div>

            {incGroups.length === 0 ? (
              <div style={{ textAlign: "center", padding: 48, color: "var(--muted)", fontSize: 13 }}>
                No withdrawals yet. Click "＋ New Withdrawal" to record your first SAR → EGP conversion.
              </div>
            ) : (
              incGroups.map(([key, group]) => {
                const collapsed = collapsedMonths[key] === true;
                const sumEGP = group.items.reduce((s, w) => s + Number(w.netEGP), 0);
                const sumSAR = group.items.reduce((s, w) => s + Number(w.amountSAR), 0);
                const avgRate = group.items.reduce((s, w) => s + Number(w.exchangeRate), 0) / group.items.length;
                return (
                  <div key={key}>
                    <MonthGroupHeader
                      label={`${monthName(group.month)} ${group.year}`}
                      count={group.items.length}
                      sumLabel="Sum EGP"
                      sumValue={`${fmt(sumEGP)} EGP`}
                      collapsed={collapsed}
                      onToggle={() => toggleMonth(key)}
                      accentColor="#0d9488"
                    />
                    {!collapsed && group.items.map(w => (
                      <div key={w.id} style={{
                        display: "grid", gridTemplateColumns: "90px 120px 90px 120px 100px 1fr",
                        padding: "10px 16px", borderBottom: "1px solid var(--border)", fontSize: 13,
                        color: "var(--text)", alignItems: "center", transition: "background 0.1s",
                      }}
                        onMouseEnter={e => (e.currentTarget.style.background = "var(--surface-hover, rgba(0,0,0,0.02))")}
                        onMouseLeave={e => (e.currentTarget.style.background = "transparent")}
                      >
                        <div style={{ fontSize: 12, color: "var(--muted)" }}>
                          {new Date(w.date).toLocaleDateString("en-GB", { day: "2-digit", month: "2-digit", year: "numeric" })}
                        </div>
                        <div style={{ textAlign: "right", fontWeight: 700, direction: "ltr" }}>
                          SAR{fmt(Number(w.amountSAR))}
                        </div>
                        <div style={{ textAlign: "right", fontSize: 12, color: "var(--muted)" }}>
                          {Number(w.exchangeRate).toFixed(1)}
                        </div>
                        <div style={{ textAlign: "right", fontWeight: 700, color: "#0d9488", direction: "ltr" }}>
                          EGP{fmt(Number(w.netEGP))}
                        </div>
                        <div style={{ fontSize: 11, color: "var(--muted)" }}>NEXUP</div>
                        <div style={{ fontSize: 12, color: "var(--muted)" }}>
                          {Number(w.commissionPct) > 0 ? `Commission: ${w.commissionPct}%` : "—"}
                        </div>
                      </div>
                    ))}
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}

      {/* ═══════════════════════════ EXPENSES TAB ═══════════════════════════ */}
      {tab === "expenses" && (
        <div>
          {/* Stats Row */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 14, marginBottom: 20 }}>
            {[
              { label: "Total Expenses (EGP)", value: `${fmt(totalEGPExpenses)} EGP`, color: "#ef4444", bg: "rgba(239,68,68,0.06)" },
              { label: "Fixed (Rent, Net, etc.)", value: `${fmt(expenses.filter(e => e.category === "FIXED").reduce((s, e) => s + Number(e.cost), 0))} EGP`, color: "#f59e0b", bg: "rgba(245,158,11,0.06)" },
              { label: "Variable (Salary, etc.)", value: `${fmt(expenses.filter(e => e.category === "VARIABLE").reduce((s, e) => s + Number(e.cost), 0))} EGP`, color: "#3b82f6", bg: "rgba(59,130,246,0.06)" },
            ].map(s => (
              <div key={s.label} style={{ padding: "18px 20px", borderRadius: 12, background: s.bg, border: "1px solid var(--border)" }}>
                <div style={{ fontSize: 11, color: "var(--muted)", marginBottom: 6 }}>{s.label}</div>
                <div style={{ fontSize: 22, fontWeight: 800, color: s.color, direction: "ltr" }}>{s.value}</div>
              </div>
            ))}
          </div>

          {/* Action Bar */}
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
            <span style={{ fontSize: 14, fontWeight: 700, color: "var(--text)" }}>
              All Expenses — NEXUP (Egypt)
            </span>
            <button onClick={() => setShowExpenseForm(!showExpenseForm)} style={{
              padding: "8px 18px", borderRadius: 8, border: "none",
              background: showExpenseForm ? "#6b7280" : "#ef4444", color: "#fff",
              fontSize: 13, fontWeight: 600, cursor: "pointer",
            }}>{showExpenseForm ? "✕ Cancel" : "＋ New Expense"}</button>
          </div>

          {/* Expense Form */}
          {showExpenseForm && (
            <div style={{
              padding: 20, borderRadius: 12, background: "var(--surface)", border: "1px solid var(--border)",
              marginBottom: 20, boxShadow: "0 4px 12px rgba(0,0,0,0.06)",
            }}>
              <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 16, color: "var(--text)" }}>New Expense</div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 14, marginBottom: 14 }}>
                <div>
                  <label style={labelStyle}>Date *</label>
                  <input type="date" value={expForm.date} onChange={e => setExpForm(f => ({ ...f, date: e.target.value }))} style={inputStyle} />
                </div>
                <div>
                  <label style={labelStyle}>Description *</label>
                  <input value={expForm.description} onChange={e => setExpForm(f => ({ ...f, description: e.target.value }))}
                    placeholder="e.g. Rent, Electricity, Salary" style={inputStyle} />
                </div>
                <div>
                  <label style={labelStyle}>Cost (EGP) *</label>
                  <input type="number" value={expForm.cost} onChange={e => setExpForm(f => ({ ...f, cost: e.target.value }))}
                    placeholder="7500" style={inputStyle} />
                </div>
                <div>
                  <label style={labelStyle}>Category *</label>
                  <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
                    {(["FIXED", "VARIABLE"] as const).map(c => (
                      <button key={c} type="button" onClick={() => setExpForm(f => ({ ...f, category: c }))} style={{
                        flex: 1, padding: "8px 0", borderRadius: 8, border: expForm.category === c
                          ? (c === "FIXED" ? "2px solid #f59e0b" : "2px solid #3b82f6")
                          : "1px solid var(--border)",
                        background: expForm.category === c
                          ? (c === "FIXED" ? "rgba(245,158,11,0.1)" : "rgba(59,130,246,0.1)")
                          : "transparent",
                        color: expForm.category === c
                          ? (c === "FIXED" ? "#f59e0b" : "#3b82f6")
                          : "var(--muted)",
                        fontSize: 12, fontWeight: 600, cursor: "pointer",
                      }}>{c === "FIXED" ? "📌 Fixed" : "🔄 Variable"}</button>
                    ))}
                  </div>
                </div>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginBottom: 14 }}>
                <div>
                  <label style={labelStyle}>Name / Recipient *</label>
                  <input value={expForm.name} onChange={e => setExpForm(f => ({ ...f, name: e.target.value }))}
                    placeholder="e.g. ALIAA, NOUR (for salary) or Rent, Net" style={inputStyle} />
                </div>
                <div>
                  <label style={labelStyle}>Notes (optional)</label>
                  <input value={expForm.notes} onChange={e => setExpForm(f => ({ ...f, notes: e.target.value }))}
                    placeholder="Any additional notes" style={inputStyle} />
                </div>
              </div>
              <div style={{ display: "flex", gap: 10 }}>
                <button onClick={submitExpense} disabled={saving} style={{
                  padding: "10px 24px", borderRadius: 8, border: "none",
                  background: "#ef4444", color: "#fff", fontSize: 13, fontWeight: 700, cursor: "pointer", opacity: saving ? 0.6 : 1,
                }}>{saving ? "Saving..." : "Save Expense"}</button>
                <button onClick={() => setShowExpenseForm(false)} style={{
                  padding: "10px 24px", borderRadius: 8, border: "1px solid var(--border)",
                  background: "transparent", color: "var(--muted)", fontSize: 13, cursor: "pointer",
                }}>Cancel</button>
              </div>
            </div>
          )}

          {/* Monthly Grouped Table */}
          <div style={{ borderRadius: 12, border: "1px solid var(--border)", overflow: "hidden" }}>
            <div style={{
              display: "grid", gridTemplateColumns: "90px 1fr 110px 120px 1fr 110px",
              padding: "10px 16px", background: "var(--surface)", borderBottom: "2px solid var(--border)", fontSize: 11,
              fontWeight: 600, color: "var(--muted)", textTransform: "uppercase", letterSpacing: 0.5,
            }}>
              <div>DATE</div>
              <div>DESCRIPTION</div>
              <div style={{ textAlign: "right" }}>COST</div>
              <div>NAME</div>
              <div>NOTES</div>
              <div style={{ textAlign: "right" }}>TOTAL MONTH</div>
            </div>

            {expGroups.length === 0 ? (
              <div style={{ textAlign: "center", padding: 48, color: "var(--muted)", fontSize: 13 }}>
                No expenses yet. Click "＋ New Expense" to record your first expense.
              </div>
            ) : (
              expGroups.map(([key, group]) => {
                const collapsed = collapsedMonths[key] === true;
                const sumCost = group.items.reduce((s, e) => s + Number(e.cost), 0);
                return (
                  <div key={key}>
                    <MonthGroupHeader
                      label={`${monthName(group.month)} ${group.year}`}
                      count={group.items.length}
                      sumLabel="Sum EGP"
                      sumValue={`${fmt(sumCost)} EGP`}
                      collapsed={collapsed}
                      onToggle={() => toggleMonth(key)}
                      accentColor="#ef4444"
                    />
                    {!collapsed && group.items.map(e => (
                      <div key={e.id} style={{
                        display: "grid", gridTemplateColumns: "90px 1fr 110px 120px 1fr 110px",
                        padding: "10px 16px", borderBottom: "1px solid var(--border)", fontSize: 13,
                        color: "var(--text)", alignItems: "center", transition: "background 0.1s",
                      }}
                        onMouseEnter={ev => (ev.currentTarget.style.background = "var(--surface-hover, rgba(0,0,0,0.02))")}
                        onMouseLeave={ev => (ev.currentTarget.style.background = "transparent")}
                      >
                        <div style={{ fontSize: 12, color: "var(--muted)" }}>
                          {new Date(e.date).toLocaleDateString("en-GB", { day: "2-digit", month: "2-digit", year: "numeric" })}
                        </div>
                        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                          <span style={{
                            fontSize: 10, padding: "2px 6px", borderRadius: 4, fontWeight: 600,
                            background: e.category === "FIXED" ? "rgba(245,158,11,0.1)" : "rgba(59,130,246,0.1)",
                            color: e.category === "FIXED" ? "#f59e0b" : "#3b82f6",
                          }}>{e.category === "FIXED" ? "FIXED" : "VARIABLE"}</span>
                          {e.description}
                        </div>
                        <div style={{ textAlign: "right", fontWeight: 700, direction: "ltr" }}>EGP{fmt(Number(e.cost))}</div>
                        <div style={{ fontSize: 12, color: "var(--text-secondary)" }}>{e.name}</div>
                        <div style={{ fontSize: 12, color: "var(--muted)" }}>{e.notes || "—"}</div>
                        <div style={{ textAlign: "right", fontSize: 12, color: "var(--muted)" }}>
                          {key}
                        </div>
                      </div>
                    ))}
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}

      {/* ═══════════════════════════ MONTHLY SUMMARY TAB ═══════════════════════════ */}
      {tab === "summary" && (
        <div>
          {/* Overall Stats */}
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

          {/* Monthly Breakdown */}
          <div style={{ borderRadius: 12, border: "1px solid var(--border)", overflow: "hidden" }}>
            <div style={{
              display: "grid", gridTemplateColumns: "140px 1fr 1fr 1fr",
              padding: "10px 16px", background: "var(--surface)", borderBottom: "2px solid var(--border)", fontSize: 11,
              fontWeight: 600, color: "var(--muted)", textTransform: "uppercase", letterSpacing: 0.5,
            }}>
              <div>MONTH</div>
              <div style={{ textAlign: "right" }}>INCOME (EGP)</div>
              <div style={{ textAlign: "right" }}>EXPENSES (EGP)</div>
              <div style={{ textAlign: "right" }}>NET PROFIT (EGP)</div>
            </div>

            {monthlyData.length === 0 ? (
              <div style={{ textAlign: "center", padding: 48, color: "var(--muted)", fontSize: 13 }}>
                No data yet. Record withdrawals and expenses to see the monthly summary.
              </div>
            ) : (
              monthlyData.map(([key, data]) => {
                const profit = data.income - data.expenses;
                return (
                  <div key={key} style={{
                    display: "grid", gridTemplateColumns: "140px 1fr 1fr 1fr",
                    padding: "12px 16px", borderBottom: "1px solid var(--border)", fontSize: 13,
                    color: "var(--text)", alignItems: "center", transition: "background 0.1s",
                  }}
                    onMouseEnter={e => (e.currentTarget.style.background = "var(--surface-hover, rgba(0,0,0,0.02))")}
                    onMouseLeave={e => (e.currentTarget.style.background = "transparent")}
                  >
                    <div style={{ fontWeight: 700 }}>{monthName(data.month)} {data.year}</div>
                    <div style={{ textAlign: "right", fontWeight: 700, color: "#10b981", direction: "ltr" }}>
                      {fmt(data.income)} EGP
                    </div>
                    <div style={{ textAlign: "right", fontWeight: 700, color: "#ef4444", direction: "ltr" }}>
                      {fmt(data.expenses)} EGP
                    </div>
                    <div style={{ textAlign: "right", fontWeight: 800, color: profit >= 0 ? "#10b981" : "#ef4444", direction: "ltr", fontSize: 14 }}>
                      {profit >= 0 ? "+" : ""}{fmt(profit)} EGP
                    </div>
                  </div>
                );
              })
            )}

            {/* Grand Total */}
            {monthlyData.length > 0 && (
              <div style={{
                display: "grid", gridTemplateColumns: "140px 1fr 1fr 1fr",
                padding: "14px 16px", background: "var(--surface)", fontWeight: 700, fontSize: 14,
                color: "var(--text)", borderTop: "2px solid var(--border)",
              }}>
                <div>TOTAL</div>
                <div style={{ textAlign: "right", color: "#10b981", direction: "ltr" }}>{fmt(totalEGPIncome)} EGP</div>
                <div style={{ textAlign: "right", color: "#ef4444", direction: "ltr" }}>{fmt(totalEGPExpenses)} EGP</div>
                <div style={{ textAlign: "right", color: netProfit >= 0 ? "#10b981" : "#ef4444", direction: "ltr", fontSize: 16 }}>
                  {netProfit >= 0 ? "+" : ""}{fmt(netProfit)} EGP
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/* ── Shared Styles ── */
const labelStyle: React.CSSProperties = { display: "block", fontSize: 11, fontWeight: 600, color: "var(--muted)", marginBottom: 4, textTransform: "uppercase", letterSpacing: 0.3 };
const inputStyle: React.CSSProperties = {
  width: "100%", padding: "10px 12px", borderRadius: 8, border: "1px solid var(--border)",
  background: "var(--bg)", color: "var(--text)", fontSize: 13, outline: "none", boxSizing: "border-box",
};
