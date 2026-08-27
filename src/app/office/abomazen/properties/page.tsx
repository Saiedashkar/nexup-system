"use client";

import { useState, useEffect, useCallback } from "react";

type Property = {
  id: string; ownerName: string; ownerPhone: string | null; propertyType: string;
  location: string; listingType: string; askingPrice: number | null;
  status: string; notes: string | null; createdAt: string;
  deals: { id: string }[];
};

function fmt(n: number | null) { return n ? n.toLocaleString("en-US") : "—"; }
function fmtDate(d: string) { return new Date(d).toLocaleDateString("ar-EG", { day: "2-digit", month: "short", year: "numeric" }); }

const STATUS: Record<string, { l: string; c: string; bg: string }> = {
  AVAILABLE: { l: "متاح", c: "#10b981", bg: "rgba(16,185,129,0.12)" },
  RENTED: { l: "مؤجر", c: "#f59e0b", bg: "rgba(245,158,11,0.12)" },
  SOLD: { l: "مباع", c: "#3b82f6", bg: "rgba(59,130,246,0.12)" },
};
const LISTING: Record<string, { l: string; c: string }> = {
  RENT: { l: "إيجار", c: "#f59e0b" },
  SALE: { l: "بيع", c: "#3b82f6" },
};

export default function PropertiesPage() {
  const [properties, setProperties] = useState<Property[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [form, setForm] = useState({ ownerName: "", ownerPhone: "", propertyType: "", location: "", listingType: "RENT", askingPrice: "", status: "AVAILABLE", notes: "" });

  const fetchData = useCallback(async () => {
    setLoading(true);
    const p = new URLSearchParams();
    if (search) p.set("search", search);
    try { const r = await fetch(`/api/abomazen/properties?${p}`); if (r.ok) setProperties(await r.json()); } catch {}
    setLoading(false);
  }, [search]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const resetForm = () => { setForm({ ownerName: "", ownerPhone: "", propertyType: "", location: "", listingType: "RENT", askingPrice: "", status: "AVAILABLE", notes: "" }); setEditId(null); setError(""); };

  const startEdit = (prop: Property) => {
    setEditId(prop.id);
    setForm({
      ownerName: prop.ownerName, ownerPhone: prop.ownerPhone || "", propertyType: prop.propertyType,
      location: prop.location, listingType: prop.listingType, askingPrice: prop.askingPrice ? String(prop.askingPrice) : "",
      status: prop.status, notes: prop.notes || "",
    });
    setShowForm(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.ownerName || !form.propertyType || !form.location) { setError("يجب ملء اسم المالك ونوع العقار والموقع"); return; }
    const url = editId ? `/api/abomazen/properties/${editId}` : "/api/abomazen/properties";
    const method = editId ? "PATCH" : "POST";
    const r = await fetch(url, { method, headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...form, askingPrice: form.askingPrice ? parseFloat(form.askingPrice) : null }) });
    if (r.ok) { setShowForm(false); resetForm(); fetchData(); }
    else { const d = await r.json(); setError(d.error || "حدث خطأ"); }
  };

  const handleDelete = async (id: string) => {
    await fetch(`/api/abomazen/properties/${id}`, { method: "DELETE" });
    setConfirmDelete(null); fetchData();
  };

  const updateField = async (id: string, field: string, value: string) => {
    await fetch(`/api/abomazen/properties/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ [field]: value }) });
    fetchData();
  };

  return (
    <div style={{ maxWidth: 1000, margin: "0 auto" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
        <div>
          <h1 style={{ fontSize: 24, fontWeight: 800, color: "var(--text)", margin: 0 }}>🏘️ العقارات</h1>
          <p style={{ fontSize: 13, color: "var(--muted)", margin: "4px 0 0" }}>قائمة كل العقارات المسجلة</p>
        </div>
        <button onClick={() => { setShowForm(true); resetForm(); }} style={{
          padding: "12px 24px", borderRadius: 12, background: "#f59e0b", color: "#fff",
          border: "none", fontSize: 15, fontWeight: 700, cursor: "pointer", boxShadow: "0 2px 8px rgba(245,158,11,0.3)",
        }}>+ إضافة عقار جديد</button>
      </div>

      {/* Search */}
      <div style={{ marginBottom: 16 }}>
        <input placeholder="🔍 بحث بالاسم أو الموقع..." value={search} onChange={e => setSearch(e.target.value)}
          style={{ width: "100%", padding: "10px 16px", borderRadius: 10, border: "1px solid var(--border)", background: "var(--surface)", color: "var(--text)", fontSize: 14, outline: "none" }} />
      </div>

      {/* Form */}
      {showForm && (
        <div style={{ padding: 24, borderRadius: 16, background: "var(--surface)", border: "2px solid #f59e0b", marginBottom: 20 }}>
          <h3 style={{ fontSize: 16, fontWeight: 700, color: "var(--text)", margin: "0 0 16px" }}>{editId ? "✏️ تعديل العقار" : "➕ عقار جديد"}</h3>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
            <div><label style={lbl}>اسم المالك *</label><input value={form.ownerName} onChange={e => setForm(f => ({ ...f, ownerName: e.target.value }))} placeholder="مثال: أحمد محمد" style={inp} /></div>
            <div><label style={lbl}>هاتف المالك</label><input value={form.ownerPhone} onChange={e => setForm(f => ({ ...f, ownerPhone: e.target.value }))} placeholder="مثال: 01012345678" style={inp} /></div>
            <div><label style={lbl}>نوع العقار *</label><input value={form.propertyType} onChange={e => setForm(f => ({ ...f, propertyType: e.target.value }))} placeholder="مثال: شقة، فيلا، محل" style={inp} /></div>
            <div><label style={lbl}>الموقع *</label><input value={form.location} onChange={e => setForm(f => ({ ...f, location: e.target.value }))} placeholder="مثال: المعادي، القاهرة" style={inp} /></div>
            <div>
              <label style={lbl}>النوع</label>
              <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
                {(["RENT", "SALE"] as const).map(t => (
                  <button key={t} type="button" onClick={() => setForm(f => ({ ...f, listingType: t }))} style={{
                    flex: 1, padding: "12px", borderRadius: 10,
                    border: form.listingType === t ? "2px solid #f59e0b" : "1px solid var(--border)",
                    background: form.listingType === t ? "rgba(245,158,11,0.1)" : "transparent",
                    color: form.listingType === t ? "#f59e0b" : "var(--muted)", fontSize: 14, fontWeight: 700, cursor: "pointer",
                  }}>{t === "RENT" ? "🔑 إيجار" : "🏷️ بيع"}</button>
                ))}
              </div>
            </div>
            <div>
              <label style={lbl}>الحالة</label>
              <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
                {(["AVAILABLE", "RENTED", "SOLD"] as const).map(s => {
                  const st = STATUS[s];
                  return (
                    <button key={s} type="button" onClick={() => setForm(f => ({ ...f, status: s }))} style={{
                      flex: 1, padding: "10px", borderRadius: 10,
                      border: form.status === s ? `2px solid ${st.c}` : "1px solid var(--border)",
                      background: form.status === s ? st.bg : "transparent",
                      color: form.status === s ? st.c : "var(--muted)", fontSize: 13, fontWeight: 700, cursor: "pointer",
                    }}>{st.l}</button>
                  );
                })}
              </div>
            </div>
            <div><label style={lbl}>السعر المطلوب (EGP)</label><input type="number" value={form.askingPrice} onChange={e => setForm(f => ({ ...f, askingPrice: e.target.value }))} placeholder="اختياري" style={inp} /></div>
            <div><label style={lbl}>ملاحظات</label><input value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} placeholder="ملاحظات إضافية" style={inp} /></div>
          </div>
          {error && <div style={{ color: "#ef4444", fontSize: 13, marginTop: 12 }}>{error}</div>}
          <div style={{ display: "flex", gap: 10, marginTop: 16 }}>
            <button onClick={handleSubmit} style={{ padding: "10px 24px", borderRadius: 10, border: "none", background: "#f59e0b", color: "#fff", fontSize: 14, fontWeight: 700, cursor: "pointer" }}>حفظ</button>
            <button onClick={() => { setShowForm(false); resetForm(); }} style={{ padding: "10px 24px", borderRadius: 10, border: "1px solid var(--border)", background: "transparent", color: "var(--muted)", fontSize: 14, cursor: "pointer" }}>إلغاء</button>
          </div>
        </div>
      )}

      {/* Table */}
      {loading ? <div style={{ textAlign: "center", padding: 40, color: "var(--muted)" }}>جاري التحميل...</div>
        : properties.length === 0 ? (
          <div style={{ textAlign: "center", padding: 48 }}>
            <div style={{ fontSize: 48, marginBottom: 12 }}>🏘️</div>
            <p style={{ color: "var(--muted)", fontSize: 16 }}>لسه معندكش أي عقارات مسجلة</p>
            <button onClick={() => { setShowForm(true); resetForm(); }} style={{ marginTop: 12, padding: "12px 24px", borderRadius: 10, background: "#f59e0b", color: "#fff", border: "none", fontSize: 14, fontWeight: 700, cursor: "pointer" }}>+ أضف أول عقار</button>
          </div>
        ) : (
          <div style={{ borderRadius: 12, border: "1px solid var(--border)", overflow: "hidden" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
              <thead>
                <tr style={{ background: "var(--surface)" }}>
                  {["المالك", "نوع العقار", "الموقع", "إيجار/بيع", "السعر", "الحالة", "الصفقات", "الإجراءات"].map((h, i) => (
                    <th key={i} style={{ padding: "12px 14px", textAlign: "right", borderBottom: "2px solid var(--border)", fontSize: 12, fontWeight: 700, color: "var(--text)" }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {properties.map(p => {
                  const st = STATUS[p.status] || STATUS.AVAILABLE;
                  const lt = LISTING[p.listingType] || LISTING.RENT;
                  return (
                    <tr key={p.id} style={{ borderBottom: "1px solid var(--border)" }}>
                      <td style={{ padding: "10px 14px", fontWeight: 600 }}>{p.ownerName}</td>
                      <td style={{ padding: "10px 14px" }}>{p.propertyType}</td>
                      <td style={{ padding: "10px 14px", color: "var(--muted)" }}>{p.location}</td>
                      <td style={{ padding: "10px 14px" }}><span style={{ color: lt.c, fontWeight: 700 }}>{lt.l}</span></td>
                      <td style={{ padding: "10px 14px", fontWeight: 600, direction: "ltr", textAlign: "left" }}>{fmt(p.askingPrice)} EGP</td>
                      <td style={{ padding: "10px 14px" }}><span style={{ padding: "4px 10px", borderRadius: 8, background: st.bg, color: st.c, fontSize: 12, fontWeight: 700 }}>{st.l}</span></td>
                      <td style={{ padding: "10px 14px", textAlign: "center" }}>{p.deals.length > 0 ? <span style={{ color: "#f59e0b", fontWeight: 700 }}>{p.deals.length}</span> : <span style={{ color: "var(--muted)" }}>—</span>}</td>
                      <td style={{ padding: "10px 14px" }}>
                        <div style={{ display: "flex", gap: 6 }}>
                          <button onClick={() => startEdit(p)} style={{ padding: "6px 12px", borderRadius: 6, border: "1px solid var(--border)", background: "var(--surface-hover)", color: "var(--text)", fontSize: 13, cursor: "pointer" }}>✏️</button>
                          {confirmDelete === p.id ? (
                            <><button onClick={() => handleDelete(p.id)} style={{ padding: "6px 12px", borderRadius: 6, border: "none", background: "#ef4444", color: "#fff", fontSize: 13, cursor: "pointer" }}>تأكيد</button>
                            <button onClick={() => setConfirmDelete(null)} style={{ padding: "6px 12px", borderRadius: 6, border: "1px solid var(--border)", background: "transparent", color: "var(--muted)", fontSize: 13, cursor: "pointer" }}>إلغاء</button></>
                          ) : (
                            <button onClick={() => setConfirmDelete(p.id)} style={{ padding: "6px 12px", borderRadius: 6, border: "1px solid rgba(239,68,68,0.3)", background: "rgba(239,68,68,0.05)", color: "#ef4444", fontSize: 13, cursor: "pointer" }}>🗑️</button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
    </div>
  );
}

const lbl: React.CSSProperties = { display: "block", fontSize: 12, fontWeight: 600, color: "var(--muted)", marginBottom: 6 };
const inp: React.CSSProperties = { width: "100%", padding: "10px 14px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--bg)", color: "var(--text)", fontSize: 14, outline: "none", boxSizing: "border-box" as const };
