"use client";

import { useState, useEffect, useCallback, useMemo } from "react";

type OfficeExp = { id: string; description: string; cost: number; category: string; name: string; notes: string | null; date: string; month: number; year: number };

const fmt = (n: number) => n.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 });
const toEN = (d: string) => new Date(d).toLocaleDateString("en-GB", { day: "2-digit", month: "2-digit", year: "numeric" });
const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
const monthKey = (m: number, y: number) => `${y}-${String(m).padStart(2, "0")}`;

export default function OfficeExpensesPage() {
  const [expenses, setExpenses] = useState<OfficeExp[]>([]);
  const [officeIncome, setOfficeIncome] = useState(0);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [form, setForm] = useState({ date: new Date().toISOString().split("T")[0], description: "", cost: "", category: "FIXED", name: "", notes: "" });
  const [editing, setEditing] = useState<string | null>(null);
  const [editForm, setEditForm] = useState({ description: "", cost: "", category: "", name: "", notes: "" });

  const fetchData = useCallback(async () => {
    setLoading(true);
    const [eRes, sRes] = await Promise.all([fetch("/api/office/office-expenses"), fetch("/api/office/admin-stats")]);
    if (eRes.ok) setExpenses(await eRes.json());
    if (sRes.ok) { const d = await sRes.json(); setOfficeIncome(d.allTime?.totalCapital || 0); }
    setLoading(false);
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  const now = new Date();
  const currentMonth = now.getMonth() + 1;
  const currentYear = now.getFullYear();
  const monthExpenses = expenses.filter(e => e.month === currentMonth && e.year === currentYear);
  const totalMonthExpenses = monthExpenses.reduce((s, e) => s + e.cost, 0);
  const totalAllExpenses = expenses.reduce((s, e) => s + e.cost, 0);
  const surplus = officeIncome - totalAllExpenses;

  const groups = useMemo(() => {
    const g: Record<string, { items: OfficeExp[]; month: number; year: number }> = {};
    for (const e of expenses) {
      const k = monthKey(e.month, e.year);
      if (!g[k]) g[k] = { items: [], month: e.month, year: e.year };
      g[k].items.push(e);
    }
    return Object.entries(g).sort(([a], [b]) => b.localeCompare(a));
  }, [expenses]);

  const submit = async () => {
    if (!form.description || !form.cost || !form.name) return;
    await fetch("/api/office/office-expenses", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...form, cost: parseFloat(form.cost), category: form.category }),
    });
    setForm({ date: new Date().toISOString().split("T")[0], description: "", cost: "", category: "FIXED", name: "", notes: "" });
    setShowForm(false); fetchData();
  };

  const update = async (id: string) => {
    await fetch(`/api/office/office-expenses/${id}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...editForm, cost: parseFloat(editForm.cost) }),
    });
    setEditing(null); fetchData();
  };

  const deleteItem = async (id: string) => {
    await fetch(`/api/office/office-expenses/${id}`, { method: "DELETE" });
    setConfirmDelete(null); fetchData();
  };

  const toggle = (k: string) => setCollapsed(p => ({ ...p, [k]: !p[k] }));

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24 }}>
        <div>
          <h1 style={{ fontSize: 24, fontWeight: 800, color: "var(--text)", margin: 0 }}>مصاريف المكتب</h1>
          <p style={{ fontSize: 13, color: "var(--muted)", margin: "4px 0 0" }}>مصروفات المكتب العامة (ليست مخصصة لنشاط معين) — Office Expenses</p>
        </div>
        <button onClick={() => setShowForm(true)} style={{ padding: "9px 18px", borderRadius: 8, border: "none", background: "#ef4444", color: "#fff", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>＋ مصروف جديد</button>
      </div>

      {/* Stats */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 14, marginBottom: 20 }}>
        {[
          { label: "هذا الشهر", value: `${fmt(totalMonthExpenses)} EGP`, color: "#ef4444", bg: "rgba(239,68,68,0.06)" },
          { label: "إجمالي المصاريف", value: `${fmt(totalAllExpenses)} EGP`, color: "#f59e0b", bg: "rgba(245,158,11,0.06)" },
          { label: "دخل المكتب", value: `${fmt(officeIncome)} EGP`, color: "#10b981", bg: "rgba(16,185,129,0.06)" },
          { label: "فائض / عجز", value: `${surplus >= 0 ? "+" : ""}${fmt(surplus)} EGP`, color: surplus >= 0 ? "#10b981" : "#ef4444", bg: surplus >= 0 ? "rgba(16,185,129,0.06)" : "rgba(239,68,68,0.06)" },
        ].map(s => (
          <div key={s.label} style={{ padding: "18px 20px", borderRadius: 12, background: s.bg, border: "1px solid var(--border)" }}>
            <div style={{ fontSize: 11, color: "var(--muted)", marginBottom: 6 }}>{s.label}</div>
            <div style={{ fontSize: 22, fontWeight: 800, color: s.color, direction: "ltr" }}>{s.value}</div>
          </div>
        ))}
      </div>

      {/* Form */}
      {showForm && (
        <div style={{ padding: 20, borderRadius: 12, background: "var(--surface)", border: "1px solid var(--border)", marginBottom: 16 }}>
          <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 12 }}>مصروف مكتب جديد</div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12, marginBottom: 12 }}>
            <div><label style={{ fontSize: 10, fontWeight: 600, color: "var(--muted)" }}>التاريخ *</label><input type="date" value={form.date} onChange={e => setForm(f => ({ ...f, date: e.target.value }))} style={{ width: "100%", padding: "8px 10px", borderRadius: 6, border: "1px solid var(--border)", background: "var(--bg)", color: "var(--text)", fontSize: 12, outline: "none", marginTop: 4 }} /></div>
            <div><label style={{ fontSize: 10, fontWeight: 600, color: "var(--muted)" }}>الوصف *</label><input value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} placeholder="e.g. Rent, Net, Electricity" style={{ width: "100%", padding: "8px 10px", borderRadius: 6, border: "1px solid var(--border)", background: "var(--bg)", color: "var(--text)", fontSize: 12, outline: "none", marginTop: 4 }} /></div>
            <div><label style={{ fontSize: 10, fontWeight: 600, color: "var(--muted)" }}>التكلفة (EGP) *</label><input type="number" value={form.cost} onChange={e => setForm(f => ({ ...f, cost: e.target.value }))} style={{ width: "100%", padding: "8px 10px", borderRadius: 6, border: "1px solid var(--border)", background: "var(--bg)", color: "var(--text)", fontSize: 12, outline: "none", marginTop: 4 }} /></div>
            <div><label style={{ fontSize: 10, fontWeight: 600, color: "var(--muted)" }}>المستلم *</label><input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="Recipient" style={{ width: "100%", padding: "8px 10px", borderRadius: 6, border: "1px solid var(--border)", background: "var(--bg)", color: "var(--text)", fontSize: 12, outline: "none", marginTop: 4 }} /></div>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 12 }}>
            <div><label style={{ fontSize: 10, fontWeight: 600, color: "var(--muted)" }}>Category *</label>
              <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
                {(["FIXED", "VARIABLE"] as const).map(c => (
                  <button key={c} type="button" onClick={() => setForm(f => ({ ...f, category: c }))} style={{ flex: 1, padding: "8px 0", borderRadius: 8, border: form.category === c ? (c === "FIXED" ? "2px solid #f59e0b" : "2px solid #3b82f6") : "1px solid var(--border)", background: form.category === c ? (c === "FIXED" ? "rgba(245,158,11,0.1)" : "rgba(59,130,246,0.1)") : "transparent", color: form.category === c ? (c === "FIXED" ? "#f59e0b" : "#3b82f6") : "var(--muted)", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>{c === "FIXED" ? "📌 ثابت" : "🔄 متغير"}</button>
                ))}
              </div>
            </div>
            <div><label style={{ fontSize: 10, fontWeight: 600, color: "var(--muted)" }}>ملاحظات</label><input value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} style={{ width: "100%", padding: "8px 10px", borderRadius: 6, border: "1px solid var(--border)", background: "var(--bg)", color: "var(--text)", fontSize: 12, outline: "none", marginTop: 4 }} /></div>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={submit} style={{ padding: "8px 20px", borderRadius: 8, border: "none", background: "#ef4444", color: "#fff", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>حفظ</button>
            <button onClick={() => setShowForm(false)} style={{ padding: "8px 20px", borderRadius: 8, border: "1px solid var(--border)", background: "transparent", color: "var(--muted)", fontSize: 12, cursor: "pointer" }}>إلغاء</button>
          </div>
        </div>
      )}

      {/* Monthly Grouped Table */}
      <div style={{ borderRadius: 12, border: "1px solid var(--border)", overflow: "hidden" }}>
        <div style={{ display: "grid", gridTemplateColumns: "80px 1fr 100px 100px 1fr 80px 100px", padding: "10px 16px", background: "var(--surface)", borderBottom: "2px solid var(--border)", fontSize: 11, fontWeight: 600, color: "var(--muted)", textTransform: "uppercase" }}>
          <div>التاريخ</div><div>الوصف</div><div style={{ textAlign: "right" }}>التكلفة</div><div>المستلم</div><div>ملاحظات</div><div style={{ textAlign: "right" }}>الإجمالي</div><div style={{ textAlign: "center" }}>الإجراءات</div>
        </div>

        {loading ? <div style={{ textAlign: "center", padding: 32, color: "var(--muted)" }}>جاري التحميل...</div> :
          groups.length === 0 ? <div style={{ textAlign: "center", padding: 48, color: "var(--muted)" }}>لا توجد مصاريف بعد.</div> :
          groups.map(([key, grp]) => {
            const col = collapsed[key];
            const sum = grp.items.reduce((s, e) => s + e.cost, 0);
            return (
              <div key={key}>
                <div onClick={() => toggle(key)} style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 16px", background: "var(--surface-hover, rgba(139,92,246,0.04))", cursor: "pointer", borderBottom: "1px solid var(--border)", borderLeft: "3px solid #ef4444" }}>
                  <span style={{ fontSize: 11, color: "var(--muted)" }}>{col ? "▶" : "▼"}</span>
                  <span style={{ fontSize: 13, fontWeight: 700 }}>{MONTHS[grp.month - 1]} {grp.year}</span>
                  <span style={{ fontSize: 10, padding: "2px 8px", borderRadius: 10, background: "rgba(239,68,68,0.1)", color: "#ef4444" }}>{grp.items.length} سجل</span>
                  <span style={{ flex: 1 }} />
                  <span style={{ fontSize: 13, fontWeight: 700, color: "#ef4444", direction: "ltr" }}>EGP{fmt(sum)}</span>
                </div>
                {!col && grp.items.map(e => (
                  <div key={e.id} style={{ display: "grid", gridTemplateColumns: "80px 1fr 100px 100px 1fr 80px 100px", padding: "8px 16px", borderBottom: "1px solid var(--border)", fontSize: 13, alignItems: "center" }}
                    onMouseEnter={ev => (ev.currentTarget.style.background = "var(--surface-hover, rgba(0,0,0,0.02))")} onMouseLeave={ev => (ev.currentTarget.style.background = "transparent")}>
                    <div style={{ fontSize: 12, color: "var(--muted)" }}>{toEN(e.date)}</div>
                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <span style={{ fontSize: 9, padding: "2px 6px", borderRadius: 4, fontWeight: 600, background: e.category === "FIXED" ? "rgba(245,158,11,0.1)" : "rgba(59,130,246,0.1)", color: e.category === "FIXED" ? "#f59e0b" : "#3b82f6" }}>{e.category === "FIXED" ? "ثابت" : "متغير"}</span>
                      {editing === e.id ? <input value={editForm.description} onChange={ev => setEditForm(f => ({ ...f, description: ev.target.value }))} style={{ flex: 1, padding: "3px 6px", borderRadius: 4, border: "1px solid #8b5cf6", background: "var(--bg)", color: "var(--text)", fontSize: 12, outline: "none" }} /> : e.description}
                    </div>
                    <div style={{ textAlign: "right", fontWeight: 700, direction: "ltr" }}>{editing === e.id ? <input type="number" value={editForm.cost} onChange={ev => setEditForm(f => ({ ...f, cost: ev.target.value }))} style={{ width: 80, padding: "3px 6px", borderRadius: 4, border: "1px solid #8b5cf6", background: "var(--bg)", color: "var(--text)", fontSize: 12, outline: "none", textAlign: "right" }} /> : `EGP${fmt(e.cost)}`}</div>
                    <div>{editing === e.id ? <input value={editForm.name} onChange={ev => setEditForm(f => ({ ...f, name: ev.target.value }))} style={{ padding: "3px 6px", borderRadius: 4, border: "1px solid #8b5cf6", background: "var(--bg)", color: "var(--text)", fontSize: 12, outline: "none" }} /> : e.name}</div>
                    <div style={{ fontSize: 12, color: "var(--muted)" }}>{editing === e.id ? <input value={editForm.notes || ""} onChange={ev => setEditForm(f => ({ ...f, notes: ev.target.value }))} style={{ width: "100%", padding: "3px 6px", borderRadius: 4, border: "1px solid #8b5cf6", background: "var(--bg)", color: "var(--text)", fontSize: 11, outline: "none" }} /> : (e.notes || "—")}</div>
                    <div style={{ textAlign: "right", fontSize: 12, color: "var(--muted)" }}>{key}</div>
                    <div style={{ display: "flex", gap: 4, justifyContent: "center" }}>
                      {editing === e.id ? (
                        <><button onClick={() => update(e.id)} style={{ padding: "3px 8px", borderRadius: 4, border: "none", background: "#8b5cf6", color: "#fff", fontSize: 10, cursor: "pointer" }}>حفظ</button>
                        <button onClick={() => setEditing(null)} style={{ padding: "3px 8px", borderRadius: 4, border: "1px solid var(--border)", background: "transparent", color: "var(--muted)", fontSize: 10, cursor: "pointer" }}>إلغاء</button></>
                      ) : confirmDelete === e.id ? (
                        <><button onClick={() => deleteItem(e.id)} style={{ padding: "3px 8px", borderRadius: 4, border: "none", background: "#ef4444", color: "#fff", fontSize: 10, cursor: "pointer" }}>تأكيد</button>
                        <button onClick={() => setConfirmDelete(null)} style={{ padding: "3px 8px", borderRadius: 4, border: "1px solid var(--border)", background: "transparent", color: "var(--muted)", fontSize: 10, cursor: "pointer" }}>إلغاء</button></>
                      ) : (
                        <><button onClick={() => { setEditing(e.id); setEditForm({ description: e.description, cost: String(e.cost), category: e.category, name: e.name, notes: e.notes || "" }); }} style={{ padding: "3px 6px", borderRadius: 4, border: "1px solid var(--border)", background: "transparent", color: "var(--muted)", fontSize: 10, cursor: "pointer" }}>✏️</button>
                        <button onClick={() => setConfirmDelete(e.id)} style={{ padding: "3px 6px", borderRadius: 4, border: "1px solid rgba(239,68,68,0.3)", background: "rgba(239,68,68,0.05)", color: "#ef4444", fontSize: 10, cursor: "pointer" }}>🗑</button></>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            );
          })}
      </div>
    </div>
  );
}
