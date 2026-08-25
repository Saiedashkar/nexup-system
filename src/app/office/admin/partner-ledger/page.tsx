"use client";

import { useState, useEffect, useCallback } from "react";

type Partner = { id: string; name: string; runningBalance: number; outstandingAdvances: number; transactions: Tx[] };
type Tx = { id: string; type: string; amount: number; date: string; note: string | null; runningBalance: number; business: { name: string } | null };
type Business = { id: string; name: string };

const TX_TYPES = [
  { v: "SALARY", l: "راتب", c: "#10b981", bg: "rgba(16,185,129,0.1)" },
  { v: "PROFIT_SHARE", l: "نصيب أرباح", c: "#3b82f6", bg: "rgba(59,130,246,0.1)" },
  { v: "ADVANCE", l: "سلفة", c: "#f59e0b", bg: "rgba(245,158,11,0.1)" },
  { v: "WITHDRAWAL", l: "سحب", c: "#8b5cf6", bg: "rgba(139,92,246,0.1)" },
  { v: "LOAN_SETTLEMENT", l: "تسوية سلفة", c: "#ef4444", bg: "rgba(239,68,68,0.1)" },
] as const;
const TX_MAP = Object.fromEntries(TX_TYPES.map(t => [t.v, t]));
const fmt = (n: number) => n.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 });
const toEN = (d: string) => new Date(d).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });

export default function PartnerLedgerPage() {
  const [partners, setPartners] = useState<Partner[]>([]);
  const [selected, setSelected] = useState<string>("");
  const [businesses, setBusinesses] = useState<Business[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [form, setForm] = useState({ type: "SALARY", amount: "", date: new Date().toISOString().split("T")[0], businessId: "", note: "" });
  const [editForm, setEditForm] = useState({ type: "", amount: "", date: "", note: "" });

  const fetchAll = useCallback(async () => {
    setLoading(true);
    const [pRes, bRes] = await Promise.all([fetch("/api/office/partners"), fetch("/api/office/stats")]);
    if (pRes.ok) { const data = await pRes.json(); setPartners(data); if (data.length > 0 && !selected) setSelected(data[0].id); }
    if (bRes.ok) { const d = await bRes.json(); setBusinesses(d.businesses || []); }
    setLoading(false);
  }, [selected]);

  useEffect(() => { fetchAll(); }, []);

  const partner = partners.find(p => p.id === selected);

  const addTx = async () => {
    if (!selected || !form.amount) return;
    await fetch("/api/office/partner-transactions", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ partnerId: selected, type: form.type, amount: parseFloat(form.amount), date: form.date, businessId: form.businessId || null, note: form.note || null }),
    });
    setForm({ type: "SALARY", amount: "", date: new Date().toISOString().split("T")[0], businessId: "", note: "" });
    setShowForm(false); fetchAll();
  };

  const updateTx = async (id: string) => {
    await fetch(`/api/office/partner-transactions/${id}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: editForm.type, amount: parseFloat(editForm.amount), date: editForm.date, note: editForm.note || null }),
    });
    setEditing(null); fetchAll();
  };

  const deleteTx = async (id: string) => {
    await fetch(`/api/office/partner-transactions/${id}`, { method: "DELETE" });
    setConfirmDelete(null); fetchAll();
  };

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24 }}>
        <div>
          <h1 style={{ fontSize: 24, fontWeight: 800, color: "var(--text)", margin: 0 }}>كشف حساب الشريك</h1>
          <p style={{ fontSize: 13, color: "var(--muted)", margin: "4px 0 0" }}>تتبع كل حركات الشريك مع الرصيد الجاري — Partner Ledger</p>
        </div>
      </div>

      {/* Partner Selector */}
      <div style={{ display: "flex", gap: 12, marginBottom: 20, flexWrap: "wrap" }}>
        {partners.map(p => (
          <button key={p.id} onClick={() => setSelected(p.id)} style={{
            padding: "10px 20px", borderRadius: 10, border: selected === p.id ? "2px solid #8b5cf6" : "1px solid var(--border)",
            background: selected === p.id ? "rgba(139,92,246,0.1)" : "var(--surface)", cursor: "pointer", transition: "all 0.15s",
          }}>
            <div style={{ fontWeight: 700, fontSize: 14, color: selected === p.id ? "#8b5cf6" : "var(--text)" }}>{p.name}</div>
            <div style={{ fontSize: 11, color: p.runningBalance >= 0 ? "#10b981" : "#ef4444" }}>
              Balance: {fmt(p.runningBalance)} EGP
            </div>
          </button>
        ))}
      </div>

      {partner && (
        <>
          {/* Partner Summary Bar */}
          <div style={{ display: "flex", gap: 16, marginBottom: 16, padding: "14px 20px", borderRadius: 12, background: "var(--surface)", border: "1px solid var(--border)" }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 11, color: "var(--muted)" }}>الرصيد الجاري (صافي المستحق)</div>
              <div style={{ fontSize: 22, fontWeight: 800, color: partner.runningBalance >= 0 ? "#10b981" : "#ef4444", direction: "ltr" }}>{fmt(partner.runningBalance)} EGP</div>
            </div>
            <div style={{ width: 1, background: "var(--border)" }} />
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 11, color: "var(--muted)" }}>السلف المستحقة عليه</div>
              <div style={{ fontSize: 22, fontWeight: 800, color: partner.outstandingAdvances > 0 ? "#f59e0b" : "var(--muted)", direction: "ltr" }}>{fmt(partner.outstandingAdvances)} EGP</div>
            </div>
            <div style={{ width: 1, background: "var(--border)" }} />
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 11, color: "var(--muted)" }}>الحركات</div>
              <div style={{ fontSize: 22, fontWeight: 800, color: "var(--text)" }}>{partner.transactions.length}</div>
            </div>
            <div style={{ display: "flex", alignItems: "center" }}>
              <button onClick={() => setShowForm(true)} style={{ padding: "8px 16px", borderRadius: 8, border: "none", background: "#8b5cf6", color: "#fff", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>＋ حركة جديدة</button>
            </div>
          </div>

          {/* New Transaction Form */}
          {showForm && (
            <div style={{ padding: 20, borderRadius: 12, background: "var(--surface)", border: "1px solid var(--border)", marginBottom: 16 }}>
              <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 12 }}>حركة جديدة لـ {partner.name}</div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 12, marginBottom: 12 }}>
                <div>
                  <label style={{ display: "block", fontSize: 10, fontWeight: 600, color: "var(--muted)", marginBottom: 4 }}>النوع *</label>
                  <select value={form.type} onChange={e => setForm(f => ({ ...f, type: e.target.value }))} style={{ width: "100%", padding: "8px 10px", borderRadius: 6, border: "1px solid var(--border)", background: "var(--bg)", color: "var(--text)", fontSize: 12, outline: "none" }}>
                    {TX_TYPES.map(t => <option key={t.v} value={t.v}>{t.l}</option>)}
                  </select>
                </div>
                <div>
                  <label style={{ display: "block", fontSize: 10, fontWeight: 600, color: "var(--muted)", marginBottom: 4 }}>المبلغ (EGP) *</label>
                  <input type="number" value={form.amount} onChange={e => setForm(f => ({ ...f, amount: e.target.value }))} placeholder="0" style={{ width: "100%", padding: "8px 10px", borderRadius: 6, border: "1px solid var(--border)", background: "var(--bg)", color: "var(--text)", fontSize: 12, outline: "none" }} />
                </div>
                <div>
                  <label style={{ display: "block", fontSize: 10, fontWeight: 600, color: "var(--muted)", marginBottom: 4 }}>التاريخ *</label>
                  <input type="date" value={form.date} onChange={e => setForm(f => ({ ...f, date: e.target.value }))} style={{ width: "100%", padding: "8px 10px", borderRadius: 6, border: "1px solid var(--border)", background: "var(--bg)", color: "var(--text)", fontSize: 12, outline: "none" }} />
                </div>
                <div>
                  <label style={{ display: "block", fontSize: 10, fontWeight: 600, color: "var(--muted)", marginBottom: 4 }}>النشاط (اختياري)</label>
                  <select value={form.businessId} onChange={e => setForm(f => ({ ...f, businessId: e.target.value }))} style={{ width: "100%", padding: "8px 10px", borderRadius: 6, border: "1px solid var(--border)", background: "var(--bg)", color: "var(--text)", fontSize: 12, outline: "none" }}>
                    <option value="">عام — المكتب</option>
                    {businesses.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
                  </select>
                </div>
                <div>
                  <label style={{ display: "block", fontSize: 10, fontWeight: 600, color: "var(--muted)", marginBottom: 4 }}>ملاحظة</label>                    <input value={form.note} onChange={e => setForm(f => ({ ...f, note: e.target.value }))} placeholder="اختياري" style={{ width: "100%", padding: "8px 10px", borderRadius: 6, border: "1px solid var(--border)", background: "var(--bg)", color: "var(--text)", fontSize: 12, outline: "none" }} />
                </div>
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <button onClick={addTx} style={{ padding: "8px 20px", borderRadius: 8, border: "none", background: "#8b5cf6", color: "#fff", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>حفظ</button>
                <button onClick={() => setShowForm(false)} style={{ padding: "8px 20px", borderRadius: 8, border: "1px solid var(--border)", background: "transparent", color: "var(--muted)", fontSize: 12, cursor: "pointer" }}>إلغاء</button>
              </div>
            </div>
          )}

          {/* Transaction Table */}
          <div style={{ borderRadius: 12, border: "1px solid var(--border)", overflow: "hidden" }}>
            <div style={{ display: "grid", gridTemplateColumns: "90px 120px 100px 100px 1fr 120px 100px", padding: "10px 16px", background: "var(--surface)", borderBottom: "2px solid var(--border)", fontSize: 11, fontWeight: 600, color: "var(--muted)", textTransform: "uppercase", letterSpacing: 0.5 }}>
              <div>التاريخ</div><div>النوع</div><div style={{ textAlign: "right" }}>المبلغ</div><div style={{ textAlign: "right" }}>الرصيد</div><div>النشاط</div><div>ملاحظة</div><div style={{ textAlign: "center" }}>الإجراءات</div>
            </div>

            {partner.transactions.length === 0 ? (
              <div style={{ textAlign: "center", padding: 48, color: "var(--muted)", fontSize: 13 }}>لا توجد حركات بعد.</div>
            ) : partner.transactions.map(tx => {
              const txInfo = TX_MAP[tx.type] || TX_TYPES[0];
              const isCredit = ["SALARY", "PROFIT_SHARE"].includes(tx.type);
              return (
                <div key={tx.id} style={{ display: "grid", gridTemplateColumns: "90px 120px 100px 100px 1fr 120px 100px", padding: "10px 16px", borderBottom: "1px solid var(--border)", fontSize: 13, alignItems: "center", transition: "background 0.1s" }}
                  onMouseEnter={e => (e.currentTarget.style.background = "var(--surface-hover, rgba(0,0,0,0.02))")} onMouseLeave={e => (e.currentTarget.style.background = "transparent")}>
                  <div style={{ fontSize: 12, color: "var(--muted)" }}>{toEN(tx.date)}</div>
                  <div>
                    {editing === tx.id ? (
                      <select value={editForm.type} onChange={e => setEditForm(f => ({ ...f, type: e.target.value }))} style={{ padding: "4px 6px", borderRadius: 4, border: "1px solid #8b5cf6", background: "var(--bg)", color: "var(--text)", fontSize: 11, outline: "none" }}>
                        {TX_TYPES.map(t => <option key={t.v} value={t.v}>{t.l}</option>)}
                      </select>
                    ) : (
                      <span style={{ padding: "3px 8px", borderRadius: 6, fontSize: 11, fontWeight: 600, background: txInfo.bg, color: txInfo.c }}>{txInfo.l}</span>
                    )}
                  </div>
                  <div style={{ textAlign: "right", fontWeight: 700, color: isCredit ? "#10b981" : "#ef4444", direction: "ltr" }}>
                    {editing === tx.id ? (
                      <input type="number" value={editForm.amount} onChange={e => setEditForm(f => ({ ...f, amount: e.target.value }))} style={{ width: 80, padding: "3px 6px", borderRadius: 4, border: "1px solid #8b5cf6", background: "var(--bg)", color: "var(--text)", fontSize: 12, outline: "none", textAlign: "right" }} />
                    ) : (
                      <>{isCredit ? "+" : "-"}{fmt(tx.amount)}</>
                    )}
                  </div>
                  <div style={{ textAlign: "right", fontWeight: 600, color: tx.runningBalance >= 0 ? "#10b981" : "#ef4444", direction: "ltr" }}>{fmt(tx.runningBalance)}</div>
                  <div style={{ fontSize: 12, color: "var(--text-secondary)" }}>{tx.business?.name || "Office"}</div>
                  <div style={{ fontSize: 11, color: "var(--muted)" }}>
                    {editing === tx.id ? (
                      <input value={editForm.note || ""} onChange={e => setEditForm(f => ({ ...f, note: e.target.value }))} style={{ width: "100%", padding: "3px 6px", borderRadius: 4, border: "1px solid #8b5cf6", background: "var(--bg)", color: "var(--text)", fontSize: 11, outline: "none" }} />
                    ) : (tx.note || "—")}
                  </div>
                  <div style={{ display: "flex", gap: 4, justifyContent: "center" }}>
                    {editing === tx.id ? (
                      <>
                        <button onClick={() => updateTx(tx.id)} style={{ padding: "3px 8px", borderRadius: 4, border: "none", background: "#8b5cf6", color: "#fff", fontSize: 10, cursor: "pointer" }}>حفظ</button>
                        <button onClick={() => setEditing(null)} style={{ padding: "3px 8px", borderRadius: 4, border: "1px solid var(--border)", background: "transparent", color: "var(--muted)", fontSize: 10, cursor: "pointer" }}>إلغاء</button>
                      </>
                    ) : confirmDelete === tx.id ? (
                      <>
                        <button onClick={() => deleteTx(tx.id)} style={{ padding: "3px 8px", borderRadius: 4, border: "none", background: "#ef4444", color: "#fff", fontSize: 10, cursor: "pointer" }}>تأكيد</button>
                        <button onClick={() => setConfirmDelete(null)} style={{ padding: "3px 8px", borderRadius: 4, border: "1px solid var(--border)", background: "transparent", color: "var(--muted)", fontSize: 10, cursor: "pointer" }}>إلغاء</button>
                      </>
                    ) : (
                      <>
                        <button onClick={() => { setEditing(tx.id); setEditForm({ type: tx.type, amount: String(tx.amount), date: tx.date.split("T")[0], note: tx.note || "" }); }} style={{ padding: "3px 6px", borderRadius: 4, border: "1px solid var(--border)", background: "transparent", color: "var(--muted)", fontSize: 10, cursor: "pointer" }}>✏️</button>
                        <button onClick={() => setConfirmDelete(tx.id)} style={{ padding: "3px 6px", borderRadius: 4, border: "1px solid rgba(239,68,68,0.3)", background: "rgba(239,68,68,0.05)", color: "#ef4444", fontSize: 10, cursor: "pointer" }}>🗑</button>
                      </>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
