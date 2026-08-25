"use client";

import { useState, useEffect, useCallback } from "react";

type Capital = { id: string; amount: number; type: string; description: string | null; date: string; partner: { name: string } };
type Partner = { id: string; name: string };

const fmt = (n: number) => n.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 });
const toEN = (d: string) => new Date(d).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });

export default function CapitalPage() {
  const [contributions, setContributions] = useState<Capital[]>([]);
  const [partners, setPartners] = useState<Partner[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [form, setForm] = useState({ partnerId: "", amount: "", type: "CASH", description: "", date: new Date().toISOString().split("T")[0] });
  const [editForm, setEditForm] = useState({ amount: "", type: "", description: "" });

  const fetchData = useCallback(async () => {
    setLoading(true);
    const [cRes, pRes] = await Promise.all([fetch("/api/office/capital-contributions"), fetch("/api/office/partners")]);
    if (cRes.ok) setContributions(await cRes.json());
    if (pRes.ok) setPartners(await pRes.json());
    setLoading(false);
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  const totalCapital = contributions.reduce((s, c) => s + c.amount, 0);

  const submit = async () => {
    if (!form.partnerId || !form.amount) return;
    await fetch("/api/office/capital-contributions", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...form, amount: parseFloat(form.amount) }),
    });
    setForm({ partnerId: "", amount: "", type: "CASH", description: "", date: new Date().toISOString().split("T")[0] });
    setShowForm(false); fetchData();
  };

  const update = async (id: string) => {
    await fetch(`/api/office/capital-contributions/${id}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ amount: parseFloat(editForm.amount), type: editForm.type, description: editForm.description || null }),
    });
    setEditing(null); fetchData();
  };

  const deleteItem = async (id: string) => {
    await fetch(`/api/office/capital-contributions/${id}`, { method: "DELETE" });
    setConfirmDelete(null); fetchData();
  };

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24 }}>
        <div>
          <h1 style={{ fontSize: 24, fontWeight: 800, color: "var(--text)", margin: 0 }}>رأس المال والتمويل</h1>
          <p style={{ fontSize: 13, color: "var(--muted)", margin: "4px 0 0" }}>تتبع مساهمات الشركاء في رأس المال — Capital & Funding</p>
        </div>
        <button onClick={() => setShowForm(true)} style={{ padding: "9px 18px", borderRadius: 8, border: "none", background: "#10b981", color: "#fff", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>＋ مساهمة جديدة</button>
      </div>

      <div style={{ padding: "18px 24px", borderRadius: 12, background: "rgba(16,185,129,0.06)", border: "1px solid var(--border)", marginBottom: 20 }}>
        <div style={{ fontSize: 11, color: "var(--muted)" }}>إجمالي رأس المال</div>
        <div style={{ fontSize: 28, fontWeight: 800, color: "#10b981", direction: "ltr" }}>{fmt(totalCapital)} EGP</div>
      </div>

      {showForm && (
        <div style={{ padding: 20, borderRadius: 12, background: "var(--surface)", border: "1px solid var(--border)", marginBottom: 16 }}>
          <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 12 }}>مساهمة رأس مال جديدة</div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12, marginBottom: 12 }}>
            <div><label style={{ fontSize: 10, fontWeight: 600, color: "var(--muted)" }}>الشريك *</label>
              <select value={form.partnerId} onChange={e => setForm(f => ({ ...f, partnerId: e.target.value }))} style={{ width: "100%", padding: "8px 10px", borderRadius: 6, border: "1px solid var(--border)", background: "var(--bg)", color: "var(--text)", fontSize: 12, outline: "none", marginTop: 4 }}>
                <option value="">اختر شريك</option>
                {partners.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </div>
            <div><label style={{ fontSize: 10, fontWeight: 600, color: "var(--muted)" }}>المبلغ (EGP) *</label><input type="number" value={form.amount} onChange={e => setForm(f => ({ ...f, amount: e.target.value }))} style={{ width: "100%", padding: "8px 10px", borderRadius: 6, border: "1px solid var(--border)", background: "var(--bg)", color: "var(--text)", fontSize: 12, outline: "none", marginTop: 4 }} /></div>
            <div><label style={{ fontSize: 10, fontWeight: 600, color: "var(--muted)" }}>النوع *</label>
              <select value={form.type} onChange={e => setForm(f => ({ ...f, type: e.target.value }))} style={{ width: "100%", padding: "8px 10px", borderRadius: 6, border: "1px solid var(--border)", background: "var(--bg)", color: "var(--text)", fontSize: 12, outline: "none", marginTop: 4 }}>
                <option value="CASH">💵 نقدي</option><option value="ASSET">📦 عقار/أصل</option>
              </select>
            </div>
            <div><label style={{ fontSize: 10, fontWeight: 600, color: "var(--muted)" }}>التاريخ *</label><input type="date" value={form.date} onChange={e => setForm(f => ({ ...f, date: e.target.value }))} style={{ width: "100%", padding: "8px 10px", borderRadius: 6, border: "1px solid var(--border)", background: "var(--bg)", color: "var(--text)", fontSize: 12, outline: "none", marginTop: 4 }} /></div>
          </div>
          <div style={{ marginBottom: 12 }}><label style={{ fontSize: 10, fontWeight: 600, color: "var(--muted)" }}>الوصف</label><input value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} placeholder="اختياري" style={{ width: "100%", padding: "8px 10px", borderRadius: 6, border: "1px solid var(--border)", background: "var(--bg)", color: "var(--text)", fontSize: 12, outline: "none", marginTop: 4 }} /></div>
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={submit} style={{ padding: "8px 20px", borderRadius: 8, border: "none", background: "#10b981", color: "#fff", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>حفظ</button>
            <button onClick={() => setShowForm(false)} style={{ padding: "8px 20px", borderRadius: 8, border: "1px solid var(--border)", background: "transparent", color: "var(--muted)", fontSize: 12, cursor: "pointer" }}>إلغاء</button>
          </div>
        </div>
      )}

      {/* Timeline */}
      {loading ? <div style={{ textAlign: "center", padding: 32, color: "var(--muted)" }}>جاري التحميل...</div> : (
        <div style={{ position: "relative", paddingLeft: 30 }}>
          <div style={{ position: "absolute", left: 14, top: 0, bottom: 0, width: 2, background: "var(--border)" }} />
          {contributions.map(c => (
            <div key={c.id} style={{ position: "relative", marginBottom: 20, padding: "14px 20px", borderRadius: 10, background: "var(--surface)", border: "1px solid var(--border)" }}>
              <div style={{ position: "absolute", left: -23, top: 18, width: 12, height: 12, borderRadius: "50%", background: c.type === "CASH" ? "#10b981" : "#3b82f6", border: "2px solid var(--bg)" }} />
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div>
                  <div style={{ fontWeight: 700, fontSize: 14 }}>{c.partner.name}</div>
                  <div style={{ fontSize: 12, color: "var(--muted)" }}>{toEN(c.date)} · {c.type === "CASH" ? "💵 نقدي" : "📦 عقار/أصل"}{c.description ? ` · ${c.description}` : ""}</div>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  {editing === c.id ? (
                    <>
                      <input type="number" value={editForm.amount} onChange={e => setEditForm(f => ({ ...f, amount: e.target.value }))} style={{ width: 100, padding: "4px 8px", borderRadius: 4, border: "1px solid #8b5cf6", background: "var(--bg)", color: "var(--text)", fontSize: 13, outline: "none", textAlign: "right" }} />
                      <button onClick={() => update(c.id)} style={{ padding: "4px 10px", borderRadius: 4, border: "none", background: "#8b5cf6", color: "#fff", fontSize: 11, cursor: "pointer" }}>حفظ</button>
                      <button onClick={() => setEditing(null)} style={{ padding: "4px 10px", borderRadius: 4, border: "1px solid var(--border)", background: "transparent", color: "var(--muted)", fontSize: 11, cursor: "pointer" }}>إلغاء</button>
                    </>
                  ) : confirmDelete === c.id ? (
                    <>
                      <button onClick={() => deleteItem(c.id)} style={{ padding: "4px 10px", borderRadius: 4, border: "none", background: "#ef4444", color: "#fff", fontSize: 11, cursor: "pointer" }}>تأكيد</button>
                      <button onClick={() => setConfirmDelete(null)} style={{ padding: "4px 10px", borderRadius: 4, border: "1px solid var(--border)", background: "transparent", color: "var(--muted)", fontSize: 11, cursor: "pointer" }}>إلغاء</button>
                    </>
                  ) : (
                    <>
                      <span style={{ fontSize: 18, fontWeight: 800, color: "#10b981", direction: "ltr" }}>+{fmt(c.amount)} EGP</span>
                      <button onClick={() => { setEditing(c.id); setEditForm({ amount: String(c.amount), type: c.type, description: c.description || "" }); }} style={{ padding: "4px 8px", borderRadius: 4, border: "1px solid var(--border)", background: "transparent", color: "var(--muted)", fontSize: 11, cursor: "pointer" }}>✏️</button>
                      <button onClick={() => setConfirmDelete(c.id)} style={{ padding: "4px 8px", borderRadius: 4, border: "1px solid rgba(239,68,68,0.3)", background: "rgba(239,68,68,0.05)", color: "#ef4444", fontSize: 11, cursor: "pointer" }}>🗑</button>
                    </>
                  )}
                </div>
              </div>
            </div>
          ))}
          {contributions.length === 0 && <div style={{ textAlign: "center", padding: 48, color: "var(--muted)" }}>لا توجد مساهمات بعد.</div>}
        </div>
      )}
    </div>
  );
}
