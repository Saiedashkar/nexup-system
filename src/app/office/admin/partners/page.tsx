"use client";

import { useState, useEffect, useCallback } from "react";

type Partner = { id: string; name: string; ownerships: { id: string; businessId: string; ownershipPct: number; effectiveDate: string; business: { name: string; slug: string } }[]; transactions: unknown[]; capitalContributions: unknown[]; runningBalance: number; totalCapital: number; outstandingAdvances: number; };
type Business = { id: string; name: string; slug: string };

const fmt = (n: number) => n.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 });

export default function PartnersPage() {
  const [partners, setPartners] = useState<Partner[]>([]);
  const [businesses, setBusinesses] = useState<Business[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [showOwnershipForm, setShowOwnershipForm] = useState<string | null>(null);
  const [form, setForm] = useState({ name: "" });
  const [ownershipForm, setOwnershipForm] = useState({ businessId: "", ownershipPct: "" });
  const [editing, setEditing] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    const [pRes, bRes] = await Promise.all([fetch("/api/office/partners"), fetch("/api/office/stats")]);
    if (pRes.ok) setPartners(await pRes.json());
    // Get businesses from office stats
    const statsRes = await fetch("/api/office/stats");
    if (statsRes.ok) { const d = await statsRes.json(); setBusinesses(d.businesses || []); }
    setLoading(false);
  }, []);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  const addPartner = async () => {
    if (!form.name) return;
    await fetch("/api/office/partners", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(form) });
    setForm({ name: "" }); setShowForm(false); fetchAll();
  };

  const updatePartner = async (id: string) => {
    await fetch(`/api/office/partners/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: editName }) });
    setEditing(null); fetchAll();
  };

  const deletePartner = async (id: string) => {
    await fetch(`/api/office/partners/${id}`, { method: "DELETE" });
    setConfirmDelete(null); fetchAll();
  };

  const addOwnership = async (partnerId: string) => {
    if (!ownershipForm.businessId || !ownershipForm.ownershipPct) return;
    await fetch("/api/office/partners", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ partnerId, ...ownershipForm }) }).catch(() => {});
    // Actually need a separate endpoint for ownership - use partner-transactions approach
    // For now, we'll add via a direct patch approach
    setShowOwnershipForm(null); fetchAll();
  };

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24 }}>
        <div>
          <h1 style={{ fontSize: 24, fontWeight: 800, color: "var(--text)", margin: 0 }}>الشركاء</h1>
          <p style={{ fontSize: 13, color: "var(--muted)", margin: "4px 0 0" }}>إدارة الشركاء ونسب الملكية — Partners</p>
        </div>
        <button onClick={() => setShowForm(true)} style={{ padding: "9px 18px", borderRadius: 8, border: "none", background: "#8b5cf6", color: "#fff", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>＋ شريك جديد</button>
      </div>

      {showForm && (
        <div style={{ padding: 20, borderRadius: 12, background: "var(--surface)", border: "1px solid var(--border)", marginBottom: 20 }}>
          <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 12 }}>شريك جديد</div>
          <div style={{ display: "flex", gap: 10 }}>
            <input value={form.name} onChange={e => setForm({ name: e.target.value })} placeholder="اسم الشريك (مثال: SAIED)" style={{ flex: 1, padding: "10px 12px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--bg)", color: "var(--text)", fontSize: 13, outline: "none" }} />              <button onClick={addPartner} style={{ padding: "10px 20px", borderRadius: 8, border: "none", background: "#8b5cf6", color: "#fff", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>حفظ</button>
              <button onClick={() => setShowForm(false)} style={{ padding: "10px 20px", borderRadius: 8, border: "1px solid var(--border)", background: "transparent", color: "var(--muted)", fontSize: 13, cursor: "pointer" }}>إلغاء</button>
          </div>
        </div>
      )}

      {loading ? <div style={{ textAlign: "center", padding: 48, color: "var(--muted)" }}>Loading...</div> : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 16 }}>
          {partners.map(p => (
            <div key={p.id} style={{ borderRadius: 12, border: "1px solid var(--border)", overflow: "hidden", background: "var(--surface)" }}>
              <div style={{ padding: "16px 20px", borderBottom: "1px solid var(--border)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                {editing === p.id ? (
                  <div style={{ display: "flex", gap: 6, flex: 1 }}>
                    <input value={editName} onChange={e => setEditName(e.target.value)} autoFocus style={{ flex: 1, padding: "6px 10px", borderRadius: 6, border: "1px solid #8b5cf6", background: "var(--bg)", color: "var(--text)", fontSize: 14, fontWeight: 700, outline: "none" }} />
                    <button onClick={() => updatePartner(p.id)} style={{ padding: "4px 10px", borderRadius: 6, border: "none", background: "#8b5cf6", color: "#fff", fontSize: 11, cursor: "pointer" }}>Save</button>
                    <button onClick={() => setEditing(null)} style={{ padding: "4px 10px", borderRadius: 6, border: "1px solid var(--border)", background: "transparent", color: "var(--muted)", fontSize: 11, cursor: "pointer" }}>Cancel</button>
                  </div>
                ) : (
                  <>
                    <div style={{ fontSize: 18, fontWeight: 800, color: "var(--text)" }}>{p.name}</div>
                    <div style={{ display: "flex", gap: 4 }}>
                      <button onClick={() => { setEditing(p.id); setEditName(p.name); }} style={{ padding: "4px 8px", borderRadius: 4, border: "1px solid var(--border)", background: "transparent", color: "var(--muted)", fontSize: 11, cursor: "pointer" }}>✏️</button>
                      {confirmDelete === p.id ? (
                        <>
                          <button onClick={() => deletePartner(p.id)} style={{ padding: "4px 8px", borderRadius: 4, border: "none", background: "#ef4444", color: "#fff", fontSize: 11, cursor: "pointer" }}>Confirm</button>
                          <button onClick={() => setConfirmDelete(null)} style={{ padding: "4px 8px", borderRadius: 4, border: "1px solid var(--border)", background: "transparent", color: "var(--muted)", fontSize: 11, cursor: "pointer" }}>Cancel</button>
                        </>
                      ) : (
                        <button onClick={() => setConfirmDelete(p.id)} style={{ padding: "4px 8px", borderRadius: 4, border: "1px solid rgba(239,68,68,0.3)", background: "rgba(239,68,68,0.05)", color: "#ef4444", fontSize: 11, cursor: "pointer" }}>🗑</button>
                      )}
                    </div>
                  </>
                )}
              </div>
              <div style={{ padding: 16 }}>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10, marginBottom: 12 }}>
                  <div style={{ textAlign: "center" }}>
                    <div style={{ fontSize: 18, fontWeight: 700, color: p.runningBalance >= 0 ? "#10b981" : "#ef4444" }}>{fmt(p.runningBalance)}</div>
                    <div style={{ fontSize: 10, color: "var(--muted)" }}>الرصيد</div>
                  </div>
                  <div style={{ textAlign: "center" }}>
                    <div style={{ fontSize: 18, fontWeight: 700, color: "#3b82f6" }}>{fmt(p.totalCapital)}</div>
                    <div style={{ fontSize: 10, color: "var(--muted)" }}>رأس المال</div>
                  </div>
                  <div style={{ textAlign: "center" }}>
                    <div style={{ fontSize: 18, fontWeight: 700, color: p.outstandingAdvances > 0 ? "#f59e0b" : "var(--muted)" }}>{fmt(p.outstandingAdvances)}</div>
                    <div style={{ fontSize: 10, color: "var(--muted)" }}>السلف</div>
                  </div>
                </div>

                {/* Ownership */}
                <div style={{ borderTop: "1px solid var(--border)", paddingTop: 10 }}>
                  <div style={{ fontSize: 11, fontWeight: 600, color: "var(--muted)", marginBottom: 6 }}>الملكية</div>
                  {p.ownerships.length > 0 ? p.ownerships.map(o => (
                    <div key={o.id} style={{ display: "flex", justifyContent: "space-between", fontSize: 12, padding: "3px 0" }}>
                      <span style={{ color: "var(--text)" }}>{o.business.name}</span>
                      <span style={{ fontWeight: 700, color: "#8b5cf6" }}>{o.ownershipPct}%</span>
                    </div>
                  )) :                    <div style={{ fontSize: 11, color: "var(--muted)", fontStyle: "italic" }}>لم تُحدد بعد</div>}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
