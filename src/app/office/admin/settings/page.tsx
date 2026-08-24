"use client";

import { useState, useEffect, useCallback } from "react";

type Allocation = { id: string; allocationPct: number; effectiveDate: string; business: { name: string; slug: string } };
type Business = { id: string; name: string; slug: string };

const fmt = (n: number) => n.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 });
const toEN = (d: string) => new Date(d).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
const BIZ_COLORS: Record<string, string> = { nexup: "#0d9488", rebound: "#3b82f6", abomazen: "#8b5cf6" };

export default function AllocationSettingsPage() {
  const [settings, setSettings] = useState<Allocation[]>([]);
  const [businesses, setBusinesses] = useState<Business[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [form, setForm] = useState({ businessId: "", allocationPct: "", effectiveDate: new Date().toISOString().split("T")[0] });
  const [editPct, setEditPct] = useState("");

  const fetchData = useCallback(async () => {
    setLoading(true);
    const [sRes, bRes] = await Promise.all([fetch("/api/office/allocation-settings"), fetch("/api/office/stats")]);
    if (sRes.ok) setSettings(await sRes.json());
    if (bRes.ok) { const d = await bRes.json(); setBusinesses(d.businesses || []); }
    setLoading(false);
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  // Get latest setting per business
  const latestByBusiness = new Map<string, Allocation>();
  for (const s of settings) {
    const existing = latestByBusiness.get(s.business.slug);
    if (!existing || new Date(s.effectiveDate) > new Date(existing.effectiveDate)) {
      latestByBusiness.set(s.business.slug, s);
    }
  }
  const totalPct = Array.from(latestByBusiness.values()).reduce((s, a) => s + a.allocationPct, 0);

  const submit = async () => {
    if (!form.businessId || !form.allocationPct) return;
    await fetch("/api/office/allocation-settings", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...form, allocationPct: parseFloat(form.allocationPct) }),
    });
    setForm({ businessId: "", allocationPct: "", effectiveDate: new Date().toISOString().split("T")[0] });
    setShowForm(false); fetchData();
  };

  const update = async (id: string) => {
    await fetch(`/api/office/allocation-settings/${id}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ allocationPct: parseFloat(editPct) }),
    });
    setEditing(null); fetchData();
  };

  const deleteItem = async (id: string) => {
    await fetch(`/api/office/allocation-settings/${id}`, { method: "DELETE" });
    setConfirmDelete(null); fetchData();
  };

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24 }}>
        <div>
          <h1 style={{ fontSize: 24, fontWeight: 800, color: "var(--text)", margin: 0 }}>إعدادات التوزيع</h1>
          <p style={{ fontSize: 13, color: "var(--muted)", margin: "4px 0 0" }}>تحديد نسبة كل نشاط من تحمّل مصاريف المكتب — Allocation Settings</p>
        </div>
        <button onClick={() => setShowForm(true)} style={{ padding: "9px 18px", borderRadius: 8, border: "none", background: "#f59e0b", color: "#fff", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>＋ إعداد جديد</button>
      </div>

      {/* Current Allocation Visual */}
      <div style={{ padding: 20, borderRadius: 12, background: "var(--surface)", border: "1px solid var(--border)", marginBottom: 20 }}>
        <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 16 }}>التوزيع الحالي</div>
        <div style={{ display: "flex", height: 32, borderRadius: 8, overflow: "hidden", marginBottom: 12 }}>
          {Array.from(latestByBusiness.values()).map(a => (
            <div key={a.business.slug} style={{ width: `${a.allocationPct}%`, background: BIZ_COLORS[a.business.slug] || "#6b7280", display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontSize: 12, fontWeight: 700, transition: "width 0.3s" }}>
              {a.allocationPct > 5 && `${a.business.name} ${a.allocationPct}%`}
            </div>
          ))}
        </div>
        <div style={{ display: "flex", gap: 16 }}>
          {Array.from(latestByBusiness.values()).map(a => (
            <div key={a.business.slug} style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <div style={{ width: 12, height: 12, borderRadius: 3, background: BIZ_COLORS[a.business.slug] || "#6b7280" }} />
              <span style={{ fontSize: 12, color: "var(--text)" }}>{a.business.name}: <b>{a.allocationPct}%</b></span>
            </div>
          ))}
          <span style={{ fontSize: 12, color: totalPct === 100 ? "#10b981" : "#ef4444", fontWeight: 700 }}>Total: {totalPct}%{totalPct !== 100 && " ⚠️"}</span>
        </div>
      </div>

      {showForm && (
        <div style={{ padding: 20, borderRadius: 12, background: "var(--surface)", border: "1px solid var(--border)", marginBottom: 16 }}>
          <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 12 }}>إعداد توزيع جديد</div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12, marginBottom: 12 }}>
            <div><label style={{ fontSize: 10, fontWeight: 600, color: "var(--muted)" }}>النشاط *</label>
              <select value={form.businessId} onChange={e => setForm(f => ({ ...f, businessId: e.target.value }))} style={{ width: "100%", padding: "8px 10px", borderRadius: 6, border: "1px solid var(--border)", background: "var(--bg)", color: "var(--text)", fontSize: 12, outline: "none", marginTop: 4 }}>
                <option value="">اختر نشاط</option>
                {businesses.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
            </div>
            <div><label style={{ fontSize: 10, fontWeight: 600, color: "var(--muted)" }}>النسبة % *</label><input type="number" min="0" max="100" value={form.allocationPct} onChange={e => setForm(f => ({ ...f, allocationPct: e.target.value }))} style={{ width: "100%", padding: "8px 10px", borderRadius: 6, border: "1px solid var(--border)", background: "var(--bg)", color: "var(--text)", fontSize: 12, outline: "none", marginTop: 4 }} /></div>
            <div><label style={{ fontSize: 10, fontWeight: 600, color: "var(--muted)" }}>تاريخ السريان</label><input type="date" value={form.effectiveDate} onChange={e => setForm(f => ({ ...f, effectiveDate: e.target.value }))} style={{ width: "100%", padding: "8px 10px", borderRadius: 6, border: "1px solid var(--border)", background: "var(--bg)", color: "var(--text)", fontSize: 12, outline: "none", marginTop: 4 }} /></div>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={submit} style={{ padding: "8px 20px", borderRadius: 8, border: "none", background: "#f59e0b", color: "#fff", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>حفظ</button>
            <button onClick={() => setShowForm(false)} style={{ padding: "8px 20px", borderRadius: 8, border: "1px solid var(--border)", background: "transparent", color: "var(--muted)", fontSize: 12, cursor: "pointer" }}>إلغاء</button>
          </div>
        </div>
      )}

      {/* History Table */}
      <div style={{ borderRadius: 12, border: "1px solid var(--border)", overflow: "hidden" }}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 120px 120px 100px", padding: "10px 16px", background: "var(--surface)", borderBottom: "2px solid var(--border)", fontSize: 11, fontWeight: 600, color: "var(--muted)", textTransform: "uppercase" }}>
          <div>BUSINESS</div><div style={{ textAlign: "right" }}>ALLOCATION</div><div>EFFECTIVE DATE</div><div style={{ textAlign: "center" }}>ACTIONS</div>
        </div>
        {loading ? <div style={{ textAlign: "center", padding: 32, color: "var(--muted)" }}>Loading...</div> :
          settings.length === 0 ? <div style={{ textAlign: "center", padding: 48, color: "var(--muted)" }}>No settings yet.</div> :
          settings.map(s => (
            <div key={s.id} style={{ display: "grid", gridTemplateColumns: "1fr 120px 120px 100px", padding: "10px 16px", borderBottom: "1px solid var(--border)", fontSize: 13, alignItems: "center" }}
              onMouseEnter={e => (e.currentTarget.style.background = "var(--surface-hover, rgba(0,0,0,0.02))")} onMouseLeave={e => (e.currentTarget.style.background = "transparent")}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <div style={{ width: 10, height: 10, borderRadius: 3, background: BIZ_COLORS[s.business.slug] || "#6b7280" }} />
                <span style={{ fontWeight: 600 }}>{s.business.name}</span>
              </div>
              <div style={{ textAlign: "right", fontWeight: 700 }}>
                {editing === s.id ? (
                  <input type="number" value={editPct} onChange={e => setEditPct(e.target.value)} style={{ width: 60, padding: "3px 6px", borderRadius: 4, border: "1px solid #f59e0b", background: "var(--bg)", color: "var(--text)", fontSize: 12, outline: "none", textAlign: "right" }} />
                ) : `${s.allocationPct}%`}
              </div>
              <div style={{ fontSize: 12, color: "var(--muted)" }}>{toEN(s.effectiveDate)}</div>
              <div style={{ display: "flex", gap: 4, justifyContent: "center" }}>
                {editing === s.id ? (
                  <><button onClick={() => update(s.id)} style={{ padding: "3px 8px", borderRadius: 4, border: "none", background: "#f59e0b", color: "#fff", fontSize: 10, cursor: "pointer" }}>Save</button>
                  <button onClick={() => setEditing(null)} style={{ padding: "3px 8px", borderRadius: 4, border: "1px solid var(--border)", background: "transparent", color: "var(--muted)", fontSize: 10, cursor: "pointer" }}>Cancel</button></>
                ) : confirmDelete === s.id ? (
                  <><button onClick={() => deleteItem(s.id)} style={{ padding: "3px 8px", borderRadius: 4, border: "none", background: "#ef4444", color: "#fff", fontSize: 10, cursor: "pointer" }}>Confirm</button>
                  <button onClick={() => setConfirmDelete(null)} style={{ padding: "3px 8px", borderRadius: 4, border: "1px solid var(--border)", background: "transparent", color: "var(--muted)", fontSize: 10, cursor: "pointer" }}>Cancel</button></>
                ) : (
                  <><button onClick={() => { setEditing(s.id); setEditPct(String(s.allocationPct)); }} style={{ padding: "3px 6px", borderRadius: 4, border: "1px solid var(--border)", background: "transparent", color: "var(--muted)", fontSize: 10, cursor: "pointer" }}>✏️</button>
                  <button onClick={() => setConfirmDelete(s.id)} style={{ padding: "3px 6px", borderRadius: 4, border: "1px solid rgba(239,68,68,0.3)", background: "rgba(239,68,68,0.05)", color: "#ef4444", fontSize: 10, cursor: "pointer" }}>🗑</button></>
                )}
              </div>
            </div>
          ))}
      </div>
    </div>
  );
}
