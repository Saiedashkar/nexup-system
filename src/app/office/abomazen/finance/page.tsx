"use client";

import { useState, useEffect, useCallback, useMemo } from "react";

type Expense = { id: string; description: string; cost: string; category: "FIXED" | "VARIABLE"; name: string; notes: string | null; date: string; month: number; year: number };
type DashboardData = { availableBalance: number; totalDeals: number; totalDealsThisMonth: number };
type PoolTx = { id: string; amountSAR: string; type: "IN" | "OUT"; date: string; note: string | null };

const fmt = (n: number) => n.toLocaleString("en-US");
const monthName = (m: number) => ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"][m - 1] || "";
const monthNameAr = (m: number) => ["يناير","فبراير","مارس","أبريل","مايو","يونيو","يوليو","أغسطس","سبتمبر","أكتوبر","نوفمبر","ديسمبر"][m - 1] || "";
const toEN = (d: string) => new Date(d).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });

export default function AbomazenFinancePage() {
  const [tab, setTab] = useState<"income" | "expenses" | "summary">("income");
  const [poolBalance, setPoolBalance] = useState(0);
  const [poolTotalIn, setPoolTotalIn] = useState(0);
  const [poolTx, setPoolTx] = useState<PoolTx[]>([]);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [showExpForm, setShowExpForm] = useState(false);
  const [expForm, setExpForm] = useState({ date: new Date().toISOString().split("T")[0], description: "", cost: "", category: "FIXED" as "FIXED" | "VARIABLE", name: "", notes: "" });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    const [poolRes, eRes] = await Promise.all([fetch("/api/pool?businessSlug=abomazen"), fetch("/api/expenses?businessSlug=abomazen")]);
    if (poolRes.ok) { const d = await poolRes.json(); setPoolBalance(d.balance || 0); const txs: PoolTx[] = d.transactions || []; setPoolTx(txs); setPoolTotalIn(txs.filter(t => t.type === "IN").reduce((s, t) => s + Number(t.amountSAR), 0)); }
    if (eRes.ok) { const d = await eRes.json(); setExpenses(d.expenses || []); }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  const totalExpenses = useMemo(() => expenses.reduce((s, e) => s + Number(e.cost), 0), [expenses]);
  const availableBalance = poolBalance - totalExpenses;
  const netProfit = poolTotalIn - totalExpenses;
  const toggle = (k: string) => setCollapsed(p => ({ ...p, [k]: !p[k] }));

  function groupByMonth<T extends { date: string }>(items: T[]) {
    const g: Record<string, { items: T[]; month: number; year: number; label: string }> = {};
    for (const i of items) { const d = new Date(i.date); const k = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`; if (!g[k]) g[k] = { items: [], month: d.getMonth() + 1, year: d.getFullYear(), label: `${monthName(d.getMonth() + 1)} ${d.getFullYear()}` }; g[k].items.push(i); }
    return Object.entries(g).sort(([a], [b]) => b.localeCompare(a));
  }

  const incGroups = useMemo(() => groupByMonth(poolTx.filter(t => t.type === "IN")), [poolTx]);
  const expGroups = useMemo(() => groupByMonth(expenses), [expenses]);

  const monthlyData = useMemo(() => {
    const m: Record<string, { income: number; expenses: number; month: number; year: number; label: string }> = {};
    for (const t of poolTx.filter(t => t.type === "IN")) { const d = new Date(t.date); const k = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`; if (!m[k]) m[k] = { income: 0, expenses: 0, month: d.getMonth() + 1, year: d.getFullYear(), label: `${monthName(d.getMonth() + 1)} ${d.getFullYear()}` }; m[k].income += Number(t.amountSAR); }
    for (const e of expenses) { const d = new Date(e.date); const k = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`; if (!m[k]) m[k] = { income: 0, expenses: 0, month: d.getMonth() + 1, year: d.getFullYear(), label: `${monthName(d.getMonth() + 1)} ${d.getFullYear()}` }; m[k].expenses += Number(e.cost); }
    return Object.entries(m).sort(([a], [b]) => b.localeCompare(a));
  }, [poolTx, expenses]);

  const submitExp = async () => {
    if (!expForm.description || !expForm.cost || !expForm.name) { setError("يجب ملء الوصف والتكلفة والمستلم"); return; }
    setSaving(true); setError("");
    const r = await fetch("/api/expenses", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...expForm, cost: parseFloat(expForm.cost), businessSlug: "abomazen" }) });
    if (r.ok) { setShowExpForm(false); setExpForm({ date: new Date().toISOString().split("T")[0], description: "", cost: "", category: "FIXED", name: "", notes: "" }); fetchData(); }
    else { const d = await r.json(); setError(d.error || "حدث خطأ"); }
    setSaving(false);
  };

  const deleteItem = async (id: string) => { await fetch(`/api/expenses/${id}`, { method: "DELETE" }); setConfirmDelete(null); fetchData(); };
  const updateExpense = async (id: string, field: string, value: string) => { await fetch(`/api/expenses/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ [field]: value }) }); fetchData(); };

  return (
    <div style={{ maxWidth: 1100, margin: "0 auto" }}>
      {/* Balance Bar */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 14, marginBottom: 24 }}>
        {[
          { label: "💰 الرصيد المتاح", value: availableBalance, color: availableBalance >= 0 ? "#10b981" : "#ef4444", bg: availableBalance >= 0 ? "rgba(16,185,129,0.1)" : "rgba(239,68,68,0.1)", border: availableBalance >= 0 ? "rgba(16,185,129,0.2)" : "rgba(239,68,68,0.2)" },
          { label: "📈 إجمالي الدخل", value: poolTotalIn, color: "#10b981", bg: "rgba(16,185,129,0.1)", border: "rgba(16,185,129,0.2)" },
          { label: "📉 صافي الربح", value: netProfit, color: netProfit >= 0 ? "#10b981" : "#ef4444", bg: netProfit >= 0 ? "rgba(16,185,129,0.1)" : "rgba(239,68,68,0.1)", border: netProfit >= 0 ? "rgba(16,185,129,0.2)" : "rgba(239,68,68,0.2)" },
        ].map(s => (
          <div key={s.label} style={{ padding: "18px 20px", borderRadius: 14, background: s.bg, border: `1px solid ${s.border}`, textAlign: "center" }}>
            <div style={{ fontSize: 14, fontWeight: 600, color: "var(--muted)" }}>{s.label}</div>
            <div style={{ fontSize: 28, fontWeight: 900, color: s.color, marginTop: 8, direction: "ltr" }}>{fmt(s.value)} <span style={{ fontSize: 14, fontWeight: 600 }}>EGP</span></div>
          </div>
        ))}
      </div>

      <h1 style={{ fontSize: 24, fontWeight: 800, color: "var(--text)", margin: "0 0 20px" }}>💰 الحسابات</h1>

      {/* Tabs */}
      <div style={{ display: "flex", gap: 4, marginBottom: 20, background: "var(--surface)", padding: 4, borderRadius: 10, border: "1px solid var(--border)" }}>
        {([
          { key: "income" as const, label: "💰 الدخل", labelEn: "Income" },
          { key: "expenses" as const, label: "🧾 المصروفات", labelEn: "Expenses" },
          { key: "summary" as const, label: "📊 الملخص الشهري", labelEn: "Monthly Summary" },
        ]).map(t => (
          <button key={t.key} onClick={() => setTab(t.key)} style={{ padding: "10px 20px", borderRadius: 8, border: "none", background: tab === t.key ? "#f59e0b" : "transparent", color: tab === t.key ? "#fff" : "var(--muted)", fontSize: 14, fontWeight: 600, cursor: "pointer" }}>{t.label} <span style={{ fontSize: 10, opacity: 0.7 }}>{t.labelEn}</span></button>
        ))}
      </div>

      {error && <div style={{ padding: "10px 16px", borderRadius: 8, background: "rgba(239,68,68,0.1)", color: "#ef4444", fontSize: 14, marginBottom: 16 }}>{error}</div>}

      {/* INCOME TAB */}
      {tab === "income" && (
        <div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12, marginBottom: 20 }}>
            {[
              { label: "إجمالي المحصّل", value: poolTotalIn, color: "#10b981" },
              { label: "عدد المعاملات", value: poolTx.filter(t => t.type === "IN").length, color: "#8b5cf6" },
              { label: "الرصيد الحالي", value: availableBalance, color: availableBalance >= 0 ? "#10b981" : "#ef4444" },
            ].map(s => (
              <div key={s.label} style={{ padding: "16px", borderRadius: 12, background: "var(--surface)", border: "1px solid var(--border)", textAlign: "center" }}>
                <div style={{ fontSize: 22, fontWeight: 800, color: s.color, direction: "ltr" }}>{fmt(s.value)} {s.label !== "عدد المعاملات" ? <span style={{ fontSize: 12 }}>EGP</span> : ""}</div>
                <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 4 }}>{s.label}</div>
              </div>
            ))}
          </div>
          <div style={{ borderRadius: 12, border: "1px solid var(--border)", overflow: "hidden" }}>
            <div style={{ display: "grid", gridTemplateColumns: "100px 1fr 100px 1fr", padding: "10px 16px", background: "var(--surface)", borderBottom: "2px solid var(--border)", fontSize: 12, fontWeight: 600, color: "var(--muted)" }}>
              <div>التاريخ</div><div style={{ textAlign: "right" }}>المبلغ</div><div>النوع</div><div>ملاحظة</div>
            </div>
            {incGroups.length === 0 ? <div style={{ textAlign: "center", padding: 48, color: "var(--muted)", fontSize: 14 }}>لا توجد حركات دخل بعد</div>
              : incGroups.map(([key, grp]) => {
                const col = collapsed[key];
                const sum = grp.items.reduce((s, t) => s + Number(t.amountSAR), 0);
                return (
                  <div key={key}>
                    <div onClick={() => toggle(key)} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 16px", background: "rgba(245,158,11,0.04)", cursor: "pointer", borderBottom: "1px solid var(--border)", borderLeft: "3px solid #10b981" }}>
                      <span style={{ fontSize: 12 }}>{col ? "▶" : "▼"}</span>
                      <span style={{ fontSize: 14, fontWeight: 700 }}>{grp.label}</span>
                      <span style={{ flex: 1 }} />
                      <span style={{ fontSize: 14, fontWeight: 800, color: "#10b981", direction: "ltr" }}>{fmt(sum)} EGP</span>
                    </div>
                    {!col && grp.items.map(t => (
                      <div key={t.id} style={{ display: "grid", gridTemplateColumns: "100px 1fr 100px 1fr", padding: "10px 16px", borderBottom: "1px solid var(--border)", fontSize: 14 }}>
                        <div style={{ color: "var(--muted)", fontSize: 13 }}>{toEN(t.date)}</div>
                        <div style={{ textAlign: "right", fontWeight: 700, color: "#10b981", direction: "ltr" }}>{fmt(Number(t.amountSAR))} EGP</div>
                        <div><span style={{ padding: "3px 8px", borderRadius: 6, background: "rgba(245,158,11,0.1)", color: "#f59e0b", fontSize: 12, fontWeight: 600 }}>صفقة</span></div>
                        <div style={{ color: "var(--muted)", fontSize: 13 }}>{t.note || "—"}</div>
                      </div>
                    ))}
                  </div>
                );
              })}
          </div>
        </div>
      )}

      {/* EXPENSES TAB */}
      {tab === "expenses" && (
        <div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
            <span style={{ fontSize: 16, fontWeight: 700, color: "var(--text)" }}>🧾 مصاريف ABOMAZEN</span>
            <button onClick={() => setShowExpForm(!showExpForm)} style={{ padding: "10px 20px", borderRadius: 10, border: "none", background: showExpForm ? "#6b7280" : "#ef4444", color: "#fff", fontSize: 14, fontWeight: 700, cursor: "pointer" }}>{showExpForm ? "✕ إلغاء" : "＋ مصروف جديد"}</button>
          </div>

          {showExpForm && (
            <div style={{ padding: 20, borderRadius: 12, background: "var(--surface)", border: "2px solid #ef4444", marginBottom: 20 }}>
              <h3 style={{ fontSize: 16, fontWeight: 700, margin: "0 0 16px" }}>مصروف جديد</h3>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 14, marginBottom: 14 }}>
                <div><label style={{ fontSize: 12, fontWeight: 600, color: "var(--muted)", marginBottom: 4, display: "block" }}>التاريخ *</label><input type="date" value={expForm.date} onChange={e => setExpForm(f => ({ ...f, date: e.target.value }))} style={{ width: "100%", padding: "10px 12px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--bg)", color: "var(--text)", fontSize: 14, boxSizing: "border-box" as const }} /></div>
                <div><label style={{ fontSize: 12, fontWeight: 600, color: "var(--muted)", marginBottom: 4, display: "block" }}>الوصف *</label><input value={expForm.description} onChange={e => setExpForm(f => ({ ...f, description: e.target.value }))} placeholder="إيجار، رواتب..." style={{ width: "100%", padding: "10px 12px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--bg)", color: "var(--text)", fontSize: 14, boxSizing: "border-box" as const }} /></div>
                <div><label style={{ fontSize: 12, fontWeight: 600, color: "var(--muted)", marginBottom: 4, display: "block" }}>التكلفة (EGP) *</label><input type="number" value={expForm.cost} onChange={e => setExpForm(f => ({ ...f, cost: e.target.value }))} placeholder="5000" style={{ width: "100%", padding: "10px 12px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--bg)", color: "var(--text)", fontSize: 14, boxSizing: "border-box" as const }} /></div>
                <div>
                  <label style={{ fontSize: 12, fontWeight: 600, color: "var(--muted)", marginBottom: 4, display: "block" }}>التصنيف</label>
                  <div style={{ display: "flex", gap: 8 }}>
                    {(["FIXED", "VARIABLE"] as const).map(c => (
                      <button key={c} type="button" onClick={() => setExpForm(f => ({ ...f, category: c }))} style={{ flex: 1, padding: "10px", borderRadius: 8, border: expForm.category === c ? `2px solid ${c === "FIXED" ? "#f59e0b" : "#3b82f6"}` : "1px solid var(--border)", background: expForm.category === c ? (c === "FIXED" ? "rgba(245,158,11,0.1)" : "rgba(59,130,246,0.1)") : "transparent", color: expForm.category === c ? (c === "FIXED" ? "#f59e0b" : "#3b82f6") : "var(--muted)", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>{c === "FIXED" ? "📌 ثابتة" : "🔄 متغيرة"}</button>
                    ))}
                  </div>
                </div>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginBottom: 14 }}>
                <div><label style={{ fontSize: 12, fontWeight: 600, color: "var(--muted)", marginBottom: 4, display: "block" }}>المستلم *</label><input value={expForm.name} onChange={e => setExpForm(f => ({ ...f, name: e.target.value }))} placeholder="اسم الشخص أو الجهة" style={{ width: "100%", padding: "10px 12px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--bg)", color: "var(--text)", fontSize: 14, boxSizing: "border-box" as const }} /></div>
                <div><label style={{ fontSize: 12, fontWeight: 600, color: "var(--muted)", marginBottom: 4, display: "block" }}>ملاحظات</label><input value={expForm.notes} onChange={e => setExpForm(f => ({ ...f, notes: e.target.value }))} placeholder="اختياري" style={{ width: "100%", padding: "10px 12px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--bg)", color: "var(--text)", fontSize: 14, boxSizing: "border-box" as const }} /></div>
              </div>
              <div style={{ display: "flex", gap: 10 }}>
                <button onClick={submitExp} disabled={saving} style={{ padding: "10px 24px", borderRadius: 8, border: "none", background: "#ef4444", color: "#fff", fontSize: 14, fontWeight: 700, cursor: "pointer", opacity: saving ? 0.6 : 1 }}>حفظ</button>
                <button onClick={() => setShowExpForm(false)} style={{ padding: "10px 24px", borderRadius: 8, border: "1px solid var(--border)", background: "transparent", color: "var(--muted)", fontSize: 14, cursor: "pointer" }}>إلغاء</button>
              </div>
            </div>
          )}

          <div style={{ borderRadius: 12, border: "1px solid var(--border)", overflow: "hidden" }}>
            <div style={{ display: "grid", gridTemplateColumns: "85px 1fr 80px 100px 100px 1fr 80px", padding: "10px 16px", background: "var(--surface)", borderBottom: "2px solid var(--border)", fontSize: 12, fontWeight: 600, color: "var(--muted)" }}>
              <div>التاريخ</div><div>الوصف</div><div>التصنيف</div><div style={{ textAlign: "right" }}>التكلفة</div><div>المستلم</div><div>ملاحظات</div><div style={{ textAlign: "center" }}>إجراءات</div>
            </div>
            {expGroups.length === 0 ? <div style={{ textAlign: "center", padding: 48, color: "var(--muted)", fontSize: 14 }}>لا توجد مصروفات بعد</div>
              : expGroups.map(([key, grp]) => {
                const col = collapsed[key];
                const sum = grp.items.reduce((s, e) => s + Number(e.cost), 0);
                return (
                  <div key={key}>
                    <div onClick={() => toggle(key)} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 16px", background: "rgba(239,68,68,0.04)", cursor: "pointer", borderBottom: "1px solid var(--border)", borderLeft: "3px solid #ef4444" }}>
                      <span style={{ fontSize: 12 }}>{col ? "▶" : "▼"}</span>
                      <span style={{ fontSize: 14, fontWeight: 700 }}>{grp.label}</span>
                      <span style={{ flex: 1 }} />
                      <span style={{ fontSize: 14, fontWeight: 800, color: "#ef4444", direction: "ltr" }}>{fmt(sum)} EGP</span>
                    </div>
                    {!col && grp.items.map(e => (
                      <div key={e.id} style={{ display: "grid", gridTemplateColumns: "85px 1fr 80px 100px 100px 1fr 80px", padding: "10px 16px", borderBottom: "1px solid var(--border)", fontSize: 14, alignItems: "center" }}>
                        <div style={{ color: "var(--muted)", fontSize: 13 }}>{toEN(e.date)}</div>
                        <div style={{ fontWeight: 600 }}>{e.description}</div>
                        <div><span style={{ padding: "3px 8px", borderRadius: 6, background: e.category === "FIXED" ? "rgba(245,158,11,0.1)" : "rgba(59,130,246,0.1)", color: e.category === "FIXED" ? "#f59e0b" : "#3b82f6", fontSize: 12, fontWeight: 600 }}>{e.category === "FIXED" ? "ثابتة" : "متغيرة"}</span></div>
                        <div style={{ textAlign: "right", fontWeight: 700, color: "#ef4444", direction: "ltr" }}>{fmt(Number(e.cost))} EGP</div>
                        <div>{e.name}</div>
                        <div style={{ color: "var(--muted)", fontSize: 13 }}>{e.notes || "—"}</div>
                        <div style={{ display: "flex", gap: 4, justifyContent: "center" }}>
                          {confirmDelete === e.id ? (
                            <><button onClick={() => deleteItem(e.id)} style={{ padding: "4px 8px", borderRadius: 4, border: "none", background: "#ef4444", color: "#fff", fontSize: 12, cursor: "pointer" }}>تأكيد</button>
                            <button onClick={() => setConfirmDelete(null)} style={{ padding: "4px 8px", borderRadius: 4, border: "1px solid var(--border)", background: "transparent", color: "var(--muted)", fontSize: 12, cursor: "pointer" }}>إلغاء</button></>
                          ) : (
                            <button onClick={() => setConfirmDelete(e.id)} style={{ padding: "4px 8px", borderRadius: 4, border: "1px solid rgba(239,68,68,0.3)", background: "rgba(239,68,68,0.05)", color: "#ef4444", fontSize: 13, cursor: "pointer" }}>🗑️</button>
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

      {/* MONTHLY SUMMARY TAB */}
      {tab === "summary" && (
        <div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 14, marginBottom: 24 }}>
            {[
              { l: "إجمالي الدخل", v: `${fmt(poolTotalIn)} EGP`, c: "#10b981" },
              { l: "إجمالي المصروفات", v: `${fmt(totalExpenses)} EGP`, c: "#ef4444" },
              { l: "صافي الربح", v: `${netProfit >= 0 ? "+" : ""}${fmt(netProfit)} EGP`, c: netProfit >= 0 ? "#10b981" : "#ef4444" },
              { l: "هامش الربح", v: poolTotalIn > 0 ? `${((netProfit / poolTotalIn) * 100).toFixed(1)}%` : "—", c: "#8b5cf6" },
            ].map(s => (
              <div key={s.l} style={{ padding: "18px 20px", borderRadius: 14, background: "var(--surface)", border: "1px solid var(--border)", textAlign: "center" }}>
                <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 6 }}>{s.l}</div>
                <div style={{ fontSize: 22, fontWeight: 800, color: s.c, direction: "ltr" }}>{s.v}</div>
              </div>
            ))}
          </div>

          <div style={{ borderRadius: 14, border: "1px solid var(--border)", overflow: "hidden" }}>
            <div style={{ display: "grid", gridTemplateColumns: "160px 1fr 1fr 1fr", padding: "12px 20px", background: "rgba(245,158,11,0.06)", borderBottom: "2px solid var(--border)", fontSize: 12, fontWeight: 700, color: "var(--text)" }}>
              <div>الشهر</div><div style={{ textAlign: "right" }}>الدخل <span style={{ fontSize: 10, color: "var(--muted)" }}>EGP</span></div><div style={{ textAlign: "right" }}>المصروفات <span style={{ fontSize: 10, color: "var(--muted)" }}>EGP</span></div><div style={{ textAlign: "right" }}>صافي الربح <span style={{ fontSize: 10, color: "var(--muted)" }}>EGP</span></div>
            </div>
            {monthlyData.length === 0 ? <div style={{ textAlign: "center", padding: 48, color: "var(--muted)" }}>لا توجد بيانات بعد</div>
              : monthlyData.map(([key, data]) => {
                const profit = data.income - data.expenses;
                return (
                  <div key={key} style={{ display: "grid", gridTemplateColumns: "160px 1fr 1fr 1fr", padding: "14px 20px", borderBottom: "1px solid var(--border)", fontSize: 14, alignItems: "center" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <div style={{ width: 32, height: 32, borderRadius: 8, background: "rgba(245,158,11,0.1)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14, fontWeight: 800, color: "#f59e0b" }}>{data.month}</div>
                      <div style={{ fontWeight: 700 }}>{monthNameAr(data.month)} {data.year}</div>
                    </div>
                    <div style={{ textAlign: "right", fontWeight: 800, color: "#10b981", direction: "ltr" }}>{fmt(data.income)} EGP</div>
                    <div style={{ textAlign: "right", fontWeight: 800, color: "#ef4444", direction: "ltr" }}>{fmt(data.expenses)} EGP</div>
                    <div style={{ textAlign: "right", fontWeight: 800, color: profit >= 0 ? "#10b981" : "#ef4444", direction: "ltr" }}>{profit >= 0 ? "+" : ""}{fmt(profit)} EGP</div>
                  </div>
                );
              })}
            {monthlyData.length > 0 && (
              <div style={{ display: "grid", gridTemplateColumns: "160px 1fr 1fr 1fr", padding: "16px 20px", background: "rgba(245,158,11,0.04)", fontWeight: 800, fontSize: 16, borderTop: "2px solid var(--border)" }}>
                <div>المجموع</div>
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
