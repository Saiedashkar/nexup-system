"use client";

import { useState, useEffect, useCallback, useMemo } from "react";

/* ── Types ── */
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
      background: "var(--surface-hover, rgba(245,158,11,0.04))", cursor: "pointer",
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
function EditableCell({ value, onSave, type = "text", prefix, bold, color }: {
  value: string; onSave: (v: string) => void; type?: string; prefix?: string;
  bold?: boolean; color?: string;
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
          width: "100%", padding: "4px 8px", borderRadius: 4, border: "1px solid #f59e0b",
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
        display: "inline-block",
      }}
      onMouseEnter={e => (e.currentTarget.style.background = "rgba(245,158,11,0.08)")}
      onMouseLeave={e => (e.currentTarget.style.background = "transparent")}
    >
      {prefix}{value}
    </span>
  );
}

/* ══════════════════════════════════════════════════════ */
/*                    MAIN PAGE                          */
/* ══════════════════════════════════════════════════════ */
export default function AbomazenFinancePage() {
  const [tab, setTab] = useState<"income" | "expenses" | "summary">("income");

  /* ── Data ── */
  const [poolBalance, setPoolBalance] = useState(0);
  const [poolTotalIn, setPoolTotalIn] = useState(0);
  const [poolTotalOut, setPoolTotalOut] = useState(0);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  /* ── Forms ── */
  const [showExpForm, setShowExpForm] = useState(false);
  const [expForm, setExpForm] = useState({ date: new Date().toISOString().split("T")[0], description: "", cost: "", category: "FIXED" as "FIXED" | "VARIABLE", name: "", notes: "" });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  /* ── Fetch ── */
  const fetchData = useCallback(async () => {
    const [poolRes, eRes] = await Promise.all([
      fetch("/api/pool"), // This will need to be scoped to abomazen
      fetch("/api/expenses"), // Same
    ]);
    if (poolRes.ok) {
      const d = await poolRes.json();
      setPoolBalance(d.balance || 0);
      const txs: PoolTx[] = d.transactions || [];
      setPoolTotalIn(txs.filter(t => t.type === "IN").reduce((s, t) => s + Number(t.amountSAR), 0));
      setPoolTotalOut(txs.filter(t => t.type === "OUT").reduce((s, t) => s + Number(t.amountSAR), 0));
    }
    if (eRes.ok) { const d = await eRes.json(); setExpenses(d.expenses || []); }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  /* ── Computed ── */
  const totalExpenses = useMemo(() => expenses.reduce((s, e) => s + Number(e.cost), 0), [expenses]);
  const netProfit = poolTotalIn - totalExpenses;

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

  const expGroups = useMemo(() => groupByMonth(expenses), [expenses]);

  const monthlyData = useMemo(() => {
    const m: Record<string, { income: number; expenses: number; month: number; year: number }> = {};
    for (const e of expenses) { const k = monthKey(e.month, e.year); if (!m[k]) m[k] = { income: 0, expenses: 0, month: e.month, year: e.year }; m[k].expenses += Number(e.cost); }
    return Object.entries(m).sort(([a], [b]) => b.localeCompare(a));
  }, [expenses]);

  /* ── Handlers ── */
  const submitExp = async () => {
    if (!expForm.description || !expForm.cost || !expForm.name) { setError("Fill in description, cost, and name"); return; }
    setSaving(true); setError("");
    const r = await fetch("/api/expenses", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...expForm, cost: parseFloat(expForm.cost) }) });
    if (r.ok) { setShowExpForm(false); setExpForm({ date: new Date().toISOString().split("T")[0], description: "", cost: "", category: "FIXED", name: "", notes: "" }); fetchData(); }
    else { const d = await r.json(); setError(d.error || "Failed"); }
    setSaving(false);
  };

  const deleteItem = async (id: string) => {
    await fetch(`/api/expenses/${id}`, { method: "DELETE" });
    setConfirmDelete(null);
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
        display: "grid", gridTemplateColumns: "auto 1fr 1fr 1fr", alignItems: "center", gap: 0, padding: "16px 20px", marginBottom: 20,
        borderRadius: 14, background: "linear-gradient(135deg, rgba(245,158,11,0.1) 0%, rgba(245,158,11,0.03) 100%)",
        border: "1px solid rgba(245,158,11,0.2)", boxShadow: "0 2px 12px rgba(245,158,11,0.08)",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, paddingRight: 20 }}>
          <div style={{ width: 42, height: 42, borderRadius: 12, background: "rgba(245,158,11,0.15)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18 }}>💰</div>
          <div>
            <div style={{ fontSize: 9, color: "var(--muted)", textTransform: "uppercase", letterSpacing: 0.5 }}>الرصيد المتاح</div>
            <div style={{ fontSize: 9, color: "var(--muted)", textTransform: "uppercase", letterSpacing: 0.5 }}>Available Balance</div>
            <div style={{ fontSize: 22, fontWeight: 800, color: "#f59e0b", direction: "ltr", lineHeight: 1 }}>{fmt(poolBalance)} <span style={{ fontSize: 12, fontWeight: 600 }}>EGP</span></div>
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "0 16px", borderLeft: "1px solid var(--border)", height: 40 }}>
          <div style={{ width: 8, height: 8, borderRadius: 2, background: "#10b981" }} />
          <div>
            <div style={{ fontSize: 9, color: "var(--muted)" }}>الدخل الكلي · Total Income</div>
            <div style={{ fontSize: 16, fontWeight: 800, color: "#10b981", direction: "ltr" }}>{fmt(poolTotalIn)} <span style={{ fontSize: 10, fontWeight: 500 }}>EGP</span></div>
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "0 16px", borderLeft: "1px solid var(--border)", height: 40 }}>
          <div style={{ width: 8, height: 8, borderRadius: 2, background: "#ef4444" }} />
          <div>
            <div style={{ fontSize: 9, color: "var(--muted)" }}>إجمالي المصروفات · Total Expenses</div>
            <div style={{ fontSize: 16, fontWeight: 800, color: "#ef4444", direction: "ltr" }}>{fmt(totalExpenses)} <span style={{ fontSize: 10, fontWeight: 500 }}>EGP</span></div>
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "0 16px", borderLeft: "1px solid var(--border)", height: 40 }}>
          <div style={{ width: 8, height: 8, borderRadius: 2, background: netProfit >= 0 ? "#10b981" : "#ef4444" }} />
          <div>
            <div style={{ fontSize: 9, color: "var(--muted)" }}>صافي الربح · Net Profit</div>
            <div style={{ fontSize: 16, fontWeight: 800, color: netProfit >= 0 ? "#10b981" : "#ef4444", direction: "ltr" }}>{netProfit >= 0 ? "+" : ""}{fmt(netProfit)} <span style={{ fontSize: 10, fontWeight: 500 }}>EGP</span></div>
          </div>
        </div>
      </div>

      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
        <div>
          <h1 style={{ fontSize: 24, fontWeight: 800, color: "var(--text)", margin: 0 }}>الحسابات <span style={{ fontSize: 14, fontWeight: 500, color: "var(--muted)", marginLeft: 6 }}>Finance — ABOMAZEN</span></h1>
          <p style={{ fontSize: 12, color: "var(--muted)", margin: "4px 0 0" }}>المصروفات · الملخص الشهري — بالجنيه المصري مباشرة</p>
        </div>
      </div>

      {/* Tabs */}
      <div style={{ display: "flex", gap: 4, marginBottom: 20, background: "var(--surface)", padding: 4, borderRadius: 10, border: "1px solid var(--border)" }}>
        {([ { key: "expenses", label: "المصروفات", ar: "Expenses", icon: "🧾" }, { key: "summary", label: "الملخص الشهري", ar: "Monthly Summary", icon: "📊" }] as const).map(t => (
          <button key={t.key} onClick={() => setTab(t.key)} style={{
            padding: "8px 20px", borderRadius: 8, border: "none", display: "flex", alignItems: "center", gap: 6,
            background: tab === t.key ? "#f59e0b" : "transparent",
            color: tab === t.key ? "#fff" : "var(--muted)", fontSize: 13, fontWeight: 600, cursor: "pointer",
          }}><span>{t.icon}</span><span>{t.label}</span><span style={{ fontSize: 10, opacity: 0.7 }}>{t.ar}</span></button>
        ))}
      </div>

      {error && <div style={{ padding: "10px 16px", borderRadius: 8, background: "rgba(239,68,68,0.1)", color: "#ef4444", fontSize: 13, marginBottom: 16 }}>{error}</div>}

      {/* ═══════════════ EXPENSES TAB ═══════════════ */}
      {tab === "expenses" && (
        <div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
            <span style={{ fontSize: 14, fontWeight: 700, color: "var(--text)" }}>المصروفات · Expenses — ABOMAZEN <span style={{ fontSize: 10, fontWeight: 500, color: "var(--muted)", marginLeft: 4 }}>(مصر · Egypt)</span></span>
            <button onClick={() => setShowExpForm(!showExpForm)} style={{
              padding: "8px 18px", borderRadius: 8, border: "none",
              background: showExpForm ? "#6b7280" : "#ef4444", color: "#fff", fontSize: 13, fontWeight: 600, cursor: "pointer",
            }}>{showExpForm ? "✕ Cancel" : "＋ New Expense"}</button>
          </div>

          {showExpForm && (
            <div style={{ padding: 20, borderRadius: 12, background: "var(--surface)", border: "1px solid var(--border)", marginBottom: 20, boxShadow: "0 4px 12px rgba(0,0,0,0.06)" }}>
              <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 16 }}>مصروف جديد</div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 14, marginBottom: 14 }}>
                <div><label style={lbl}>التاريخ *</label><input type="date" value={expForm.date} onChange={e => setExpForm(f => ({ ...f, date: e.target.value }))} style={inp} /></div>
                <div><label style={lbl}>الوصف *</label><input value={expForm.description} onChange={e => setExpForm(f => ({ ...f, description: e.target.value }))} placeholder="إيجار، رواتب، مصاريف تشغيل" style={inp} /></div>
                <div><label style={lbl}>التكلفة (EGP) *</label><input type="number" value={expForm.cost} onChange={e => setExpForm(f => ({ ...f, cost: e.target.value }))} placeholder="7500" style={inp} /></div>
                <div>
                  <label style={lbl}>التصنيف *</label>
                  <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
                    {(["FIXED", "VARIABLE"] as const).map(c => (
                      <button key={c} type="button" onClick={() => setExpForm(f => ({ ...f, category: c }))} style={{
                        flex: 1, padding: "8px 0", borderRadius: 8,
                        border: expForm.category === c ? (c === "FIXED" ? "2px solid #f59e0b" : "2px solid #3b82f6") : "1px solid var(--border)",
                        background: expForm.category === c ? (c === "FIXED" ? "rgba(245,158,11,0.1)" : "rgba(59,130,246,0.1)") : "transparent",
                        color: expForm.category === c ? (c === "FIXED" ? "#f59e0b" : "#3b82f6") : "var(--muted)",
                        fontSize: 12, fontWeight: 600, cursor: "pointer",
                      }}>{c === "FIXED" ? "📌 ثابت" : "🔄 متغير"}</button>
                    ))}
                  </div>
                </div>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginBottom: 14 }}>
                <div><label style={lbl}>الاسم / المستلم *</label><input value={expForm.name} onChange={e => setExpForm(f => ({ ...f, name: e.target.value }))} placeholder="اسم الشخص أو الجهة" style={inp} /></div>
                <div><label style={lbl}>ملاحظات (اختياري)</label><input value={expForm.notes} onChange={e => setExpForm(f => ({ ...f, notes: e.target.value }))} placeholder="ملاحظات إضافية" style={inp} /></div>
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
              <div>التاريخ</div><div>الوصف</div><div style={{ textAlign: "right" }}>التكلفة</div><div>المستلم</div><div>ملاحظات</div><div style={{ textAlign: "right" }}>الإجمالي</div><div style={{ textAlign: "center" }}>الإجراءات</div>
            </div>

            {expGroups.length === 0 ? (
              <div style={{ textAlign: "center", padding: 48, color: "var(--muted)", fontSize: 13 }}>لا توجد مصروفات بعد.</div>
            ) : expGroups.map(([key, grp]) => {
              const col = collapsed[key];
              const sumCost = grp.items.reduce((s, e) => s + Number(e.cost), 0);
              return (
                <div key={key}>
                  <MonthGroup label={`${monthName(grp.month)} ${grp.year}`} count={grp.items.length} sumLabel="المجموع" sumValue={`${fmt(sumCost)} EGP`} collapsed={!!col} onToggle={() => toggle(key)} accent="#ef4444" />
                  {!col && grp.items.map(e => (
                    <div key={e.id} style={{ display: "grid", gridTemplateColumns: "80px 1fr 100px 100px 1fr 80px 100px", padding: "8px 16px", borderBottom: "1px solid var(--border)", fontSize: 13, alignItems: "center", transition: "background 0.1s" }}
                      onMouseEnter={ev => (ev.currentTarget.style.background = "var(--surface-hover, rgba(0,0,0,0.02))")} onMouseLeave={ev => (ev.currentTarget.style.background = "transparent")}>
                      <div style={{ fontSize: 12, color: "var(--muted)" }}>{toEN(e.date)}</div>
                      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                        <span style={{ fontSize: 9, padding: "2px 6px", borderRadius: 4, fontWeight: 600, background: e.category === "FIXED" ? "rgba(245,158,11,0.1)" : "rgba(59,130,246,0.1)", color: e.category === "FIXED" ? "#f59e0b" : "#3b82f6" }}>{e.category === "FIXED" ? "ثابت" : "متغير"}</span>
                        <EditableCell value={e.description} onSave={v => updateExpense(e.id, "description", v)} />
                      </div>
                      <div style={{ textAlign: "right" }}><EditableCell value={fmt(Number(e.cost))} onSave={v => updateExpense(e.id, "cost", v)} prefix="EGP " bold /></div>
                      <div><EditableCell value={e.name} onSave={v => updateExpense(e.id, "name", v)} /></div>
                      <div style={{ fontSize: 12, color: "var(--muted)" }}><EditableCell value={e.notes || ""} onSave={v => updateExpense(e.id, "notes", v)} /></div>
                      <div style={{ textAlign: "right", fontSize: 12, color: "var(--muted)" }}>{key}</div>
                      <div style={{ display: "flex", gap: 4, justifyContent: "center" }}>
                        {confirmDelete === `e-${e.id}` ? (
                          <><button onClick={() => deleteItem(e.id)} style={{ padding: "3px 8px", borderRadius: 4, border: "none", background: "#ef4444", color: "#fff", fontSize: 10, cursor: "pointer" }}>تأكيد</button>
                          <button onClick={() => setConfirmDelete(null)} style={{ padding: "3px 8px", borderRadius: 4, border: "1px solid var(--border)", background: "transparent", color: "var(--muted)", fontSize: 10, cursor: "pointer" }}>إلغاء</button></>
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
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 14, marginBottom: 24 }}>
            {[
              { labelAr: "إجمالي الدخل", labelEn: "Total Income", value: `${fmt(poolTotalIn)} EGP`, color: "#10b981", bg: "linear-gradient(135deg, rgba(16,185,129,0.12) 0%, rgba(16,185,129,0.04) 100%)", icon: "📈" },
              { labelAr: "إجمالي المصروفات", labelEn: "Total Expenses", value: `${fmt(totalExpenses)} EGP`, color: "#ef4444", bg: "linear-gradient(135deg, rgba(239,68,68,0.12) 0%, rgba(239,68,68,0.04) 100%)", icon: "📉" },
              { labelAr: "صافي الربح", labelEn: "Net Profit", value: `${netProfit >= 0 ? "+" : ""}${fmt(netProfit)} EGP`, color: netProfit >= 0 ? "#10b981" : "#ef4444", bg: netProfit >= 0 ? "linear-gradient(135deg, rgba(16,185,129,0.12) 0%, rgba(16,185,129,0.04) 100%)" : "linear-gradient(135deg, rgba(239,68,68,0.12) 0%, rgba(239,68,68,0.04) 100%)", icon: netProfit >= 0 ? "🎯" : "⚠️" },
            ].map(s => (
              <div key={s.labelEn} style={{ padding: "18px 20px", borderRadius: 14, background: s.bg, border: "1px solid var(--border)", position: "relative", overflow: "hidden" }}>
                <div style={{ position: "absolute", top: 12, left: 14, fontSize: 24, opacity: 0.3 }}>{s.icon}</div>
                <div style={{ fontSize: 11, color: "var(--muted)", marginBottom: 2 }}>{s.labelAr}</div>
                <div style={{ fontSize: 10, color: "var(--muted)", marginBottom: 8 }}>{s.labelEn}</div>
                <div style={{ fontSize: 24, fontWeight: 800, color: s.color, direction: "ltr", lineHeight: 1 }}>{s.value}</div>
              </div>
            ))}
          </div>

          <div style={{ borderRadius: 14, border: "1px solid var(--border)", overflow: "hidden" }}>
            <div style={{ display: "grid", gridTemplateColumns: "160px 1fr 1fr 1fr", padding: "12px 20px", background: "linear-gradient(135deg, rgba(245,158,11,0.08) 0%, transparent 100%)", borderBottom: "2px solid var(--border)", fontSize: 11, fontWeight: 700, color: "var(--text)" }}>
              <div>الشهر · MONTH</div>
              <div style={{ textAlign: "right" }}>الدخل · INCOME</div>
              <div style={{ textAlign: "right" }}>المصروفات · EXPENSES</div>
              <div style={{ textAlign: "right" }}>صافي الربح · NET PROFIT</div>
            </div>
            {monthlyData.length === 0 ? (
              <div style={{ textAlign: "center", padding: 48, color: "var(--muted)", fontSize: 13 }}>لا توجد بيانات بعد.</div>
            ) : monthlyData.map(([key, data]) => {
              const profit = data.income - data.expenses;
              return (
                <div key={key} style={{ display: "grid", gridTemplateColumns: "160px 1fr 1fr 1fr", padding: "14px 20px", borderBottom: "1px solid var(--border)", fontSize: 13, alignItems: "center" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <div style={{ width: 32, height: 32, borderRadius: 8, background: "rgba(245,158,11,0.1)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14, fontWeight: 800, color: "#f59e0b" }}>{data.month}</div>
                    <div>
                      <div style={{ fontWeight: 700, color: "var(--text)" }}>{monthName(data.month)} {data.year}</div>
                    </div>
                  </div>
                  <div style={{ textAlign: "right", fontWeight: 800, color: "#10b981", direction: "ltr" }}>{fmt(data.income)} EGP</div>
                  <div style={{ textAlign: "right", fontWeight: 800, color: "#ef4444", direction: "ltr" }}>{fmt(data.expenses)} EGP</div>
                  <div style={{ textAlign: "right", fontWeight: 800, color: profit >= 0 ? "#10b981" : "#ef4444", direction: "ltr" }}>{profit >= 0 ? "+" : ""}{fmt(profit)} EGP</div>
                </div>
              );
            })}
            {monthlyData.length > 0 && (
              <div style={{ display: "grid", gridTemplateColumns: "160px 1fr 1fr 1fr", padding: "16px 20px", background: "linear-gradient(135deg, rgba(245,158,11,0.06) 0%, rgba(245,158,11,0.02) 100%)", fontWeight: 800, fontSize: 15, borderTop: "2px solid var(--border)" }}>
                <div style={{ color: "var(--text)" }}>المجموع · TOTAL</div>
                <div style={{ textAlign: "right", color: "#10b981", direction: "ltr" }}>{fmt(poolTotalIn)} EGP</div>
                <div style={{ textAlign: "right", color: "#ef4444", direction: "ltr" }}>{fmt(totalExpenses)} EGP</div>
                <div style={{ textAlign: "right", color: netProfit >= 0 ? "#10b981" : "#ef4444", direction: "ltr" }}>{netProfit >= 0 ? "+" : ""}{fmt(netProfit)} EGP</div>
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
