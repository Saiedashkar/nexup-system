"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";

type Deal = {
  id: string; dealType: string; dealValue: number | null; totalCommission: number;
  externalOfficeAmount: number | null; personalAmount: number | null;
  abomazenNetAmount: number; date: string; seekerName: string | null;
  seekerPhone: string | null; notes: string | null;
  property: { id: string; ownerName: string; propertyType: string; location: string } | null;
};

function fmt(n: number | null) { return n ? n.toLocaleString("en-US") : "—"; }
function fmtDate(d: string) { return new Date(d).toLocaleDateString("ar-EG", { day: "2-digit", month: "short", year: "numeric" }); }

export default function AllDealsPage() {
  const router = useRouter();
  const [deals, setDeals] = useState<Deal[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState("");
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [editDeal, setEditDeal] = useState<Deal | null>(null);
  const [editForm, setEditForm] = useState({ totalCommission: "", externalOfficeAmount: "", personalAmount: "", abomazenNetAmount: "", notes: "" });
  const [error, setError] = useState("");

  const fetchData = useCallback(async () => {
    setLoading(true);
    const p = new URLSearchParams();
    if (search) p.set("search", search);
    if (typeFilter) p.set("dealType", typeFilter);
    try { const r = await fetch(`/api/abomazen/deals?${p}`); if (r.ok) setDeals(await r.json()); } catch {}
    setLoading(false);
  }, [search, typeFilter]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const handleDelete = async (id: string) => {
    await fetch(`/api/abomazen/deals/${id}`, { method: "DELETE" });
    setConfirmDelete(null); fetchData();
  };

  const startEdit = (d: Deal) => {
    setEditDeal(d);
    setEditForm({
      totalCommission: String(d.totalCommission),
      externalOfficeAmount: d.externalOfficeAmount ? String(d.externalOfficeAmount) : "",
      personalAmount: d.personalAmount ? String(d.personalAmount) : "",
      abomazenNetAmount: String(d.abomazenNetAmount),
      notes: d.notes || "",
    });
  };

  const saveEdit = async () => {
    if (!editDeal) return;
    setError("");
    const r = await fetch(`/api/abomazen/deals/${editDeal.id}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        totalCommission: parseFloat(editForm.totalCommission),
        externalOfficeAmount: editForm.externalOfficeAmount ? parseFloat(editForm.externalOfficeAmount) : null,
        personalAmount: editForm.personalAmount ? parseFloat(editForm.personalAmount) : null,
        abomazenNetAmount: parseFloat(editForm.abomazenNetAmount),
        notes: editForm.notes || null,
      }),
    });
    if (r.ok) { setEditDeal(null); fetchData(); }
    else { const d = await r.json(); setError(d.error || "حدث خطأ"); }
  };

  const totalNet = deals.reduce((s, d) => s + d.abomazenNetAmount, 0);
  const totalCommission = deals.reduce((s, d) => s + d.totalCommission, 0);

  return (
    <div style={{ maxWidth: 1100, margin: "0 auto" }}>
      <h1 style={{ fontSize: 24, fontWeight: 800, color: "var(--text)", margin: "0 0 20px" }}>📋 كل الصفقات</h1>

      {/* Filters */}
      <div style={{ display: "flex", gap: 12, marginBottom: 16 }}>
        <input placeholder="🔍 بحث بالاسم..." value={search} onChange={e => setSearch(e.target.value)}
          style={{ flex: 1, padding: "10px 16px", borderRadius: 10, border: "1px solid var(--border)", background: "var(--surface)", color: "var(--text)", fontSize: 14, outline: "none" }} />
        <select value={typeFilter} onChange={e => setTypeFilter(e.target.value)} style={{ padding: "10px 16px", borderRadius: 10, border: "1px solid var(--border)", background: "var(--surface)", color: "var(--text)", fontSize: 14, outline: "none" }}>
          <option value="">كل الصفقات</option>
          <option value="RENT">🔑 إيجار</option>
          <option value="SALE">🏷️ بيع</option>
        </select>
      </div>

      {/* Table */}
      {loading ? <div style={{ textAlign: "center", padding: 40, color: "var(--muted)" }}>جاري التحميل...</div>
        : deals.length === 0 ? (
          <div style={{ textAlign: "center", padding: 48 }}>
            <div style={{ fontSize: 48, marginBottom: 12 }}>📋</div>
            <p style={{ color: "var(--muted)", fontSize: 16 }}>لسه معندكش أي صفقات</p>
            <button onClick={() => router.push("/office/abomazen/new-deal")} style={{ marginTop: 12, padding: "12px 24px", borderRadius: 10, background: "#f59e0b", color: "#fff", border: "none", fontSize: 14, fontWeight: 700, cursor: "pointer" }}>📝 سجّل أول صفقة</button>
          </div>
        ) : (
          <div style={{ borderRadius: 12, border: "1px solid var(--border)", overflow: "hidden" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
              <thead>
                <tr style={{ background: "var(--surface)" }}>
                  {["النوع", "العقار", "التاريخ", "العمولة", "صافي ABOMAZEN", "الباحث", "الإجراءات"].map((h, i) => (
                    <th key={i} style={{ padding: "12px 14px", textAlign: "right", borderBottom: "2px solid var(--border)", fontSize: 12, fontWeight: 700, color: "var(--text)" }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {deals.map(d => (
                  <tr key={d.id} style={{ borderBottom: "1px solid var(--border)" }}>
                    <td style={{ padding: "10px 14px" }}>
                      <span style={{ padding: "4px 10px", borderRadius: 8, background: d.dealType === "RENT" ? "rgba(245,158,11,0.12)" : "rgba(59,130,246,0.12)", color: d.dealType === "RENT" ? "#f59e0b" : "#3b82f6", fontWeight: 700, fontSize: 13 }}>
                        {d.dealType === "RENT" ? "🔑 إيجار" : "🏷️ بيع"}
                      </span>
                    </td>
                    <td style={{ padding: "10px 14px", fontSize: 13 }}>
                      {d.property ? <><span style={{ fontWeight: 600 }}>{d.property.ownerName}</span><br /><span style={{ color: "var(--muted)" }}>{d.property.location}</span></> : <span style={{ color: "var(--muted)", fontStyle: "italic" }}>صفقة سريعة</span>}
                    </td>
                    <td style={{ padding: "10px 14px", color: "var(--muted)", fontSize: 13 }}>{fmtDate(d.date)}</td>
                    <td style={{ padding: "10px 14px", fontWeight: 600, direction: "ltr", textAlign: "left" }}>{fmt(d.totalCommission)} EGP</td>
                    <td style={{ padding: "10px 14px", fontWeight: 800, color: "#f59e0b", direction: "ltr", textAlign: "left", fontSize: 15 }}>{fmt(d.abomazenNetAmount)} EGP</td>
                    <td style={{ padding: "10px 14px", fontSize: 13 }}>{d.seekerName || "—"}</td>
                    <td style={{ padding: "10px 14px" }}>
                      <div style={{ display: "flex", gap: 6 }}>
                        <button onClick={() => startEdit(d)} style={{ padding: "6px 12px", borderRadius: 6, border: "1px solid var(--border)", background: "var(--surface-hover)", color: "var(--text)", fontSize: 13, cursor: "pointer" }}>✏️</button>
                        {confirmDelete === d.id ? (
                          <><button onClick={() => handleDelete(d.id)} style={{ padding: "6px 12px", borderRadius: 6, border: "none", background: "#ef4444", color: "#fff", fontSize: 13, cursor: "pointer" }}>تأكيد</button>
                          <button onClick={() => setConfirmDelete(null)} style={{ padding: "6px 12px", borderRadius: 6, border: "1px solid var(--border)", background: "transparent", color: "var(--muted)", fontSize: 13, cursor: "pointer" }}>إلغاء</button></>
                        ) : (
                          <button onClick={() => setConfirmDelete(d.id)} style={{ padding: "6px 12px", borderRadius: 6, border: "1px solid rgba(239,68,68,0.3)", background: "rgba(239,68,68,0.05)", color: "#ef4444", fontSize: 13, cursor: "pointer" }}>🗑️</button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {/* Totals */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", padding: "14px 20px", background: "rgba(245,158,11,0.06)", borderTop: "2px solid var(--border)", fontWeight: 800, fontSize: 14 }}>
              <div>إجمالي العمولات: <span style={{ direction: "ltr" }}>{fmt(totalCommission)} EGP</span></div>
              <div style={{ textAlign: "center" }}>عدد الصفقات: {deals.length}</div>
              <div style={{ textAlign: "left", color: "#f59e0b" }}>إجمالي صافي ABOMAZEN: {fmt(totalNet)} EGP</div>
            </div>
          </div>
        )}

      {/* Edit Modal */}
      {editDeal && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000 }} onClick={e => { if (e.target === e.currentTarget) setEditDeal(null); }}>
          <div style={{ background: "var(--surface)", borderRadius: 16, maxWidth: 500, width: "95%", border: "1px solid var(--border)", padding: "24px" }}>
            <h3 style={{ fontSize: 18, fontWeight: 700, color: "var(--text)", margin: "0 0 20px" }}>✏️ تعديل الصفقة</h3>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginBottom: 16 }}>
              <div><label style={{ fontSize: 12, fontWeight: 600, color: "var(--muted)", marginBottom: 4, display: "block" }}>العمولة الإجمالية</label><input type="number" value={editForm.totalCommission} onChange={e => setEditForm(f => ({ ...f, totalCommission: e.target.value }))} style={{ width: "100%", padding: "8px 12px", borderRadius: 6, border: "1px solid var(--border)", background: "var(--bg)", color: "var(--text)", fontSize: 14, boxSizing: "border-box" as const }} /></div>
              <div><label style={{ fontSize: 12, fontWeight: 600, color: "var(--muted)", marginBottom: 4, display: "block" }}>صافي ABOMAZEN</label><input type="number" value={editForm.abomazenNetAmount} onChange={e => setEditForm(f => ({ ...f, abomazenNetAmount: e.target.value }))} style={{ width: "100%", padding: "8px 12px", borderRadius: 6, border: "1px solid var(--border)", background: "var(--bg)", color: "var(--text)", fontSize: 14, boxSizing: "border-box" as const }} /></div>
              <div><label style={{ fontSize: 12, fontWeight: 600, color: "var(--muted)", marginBottom: 4, display: "block" }}>نصيب المكتب</label><input type="number" value={editForm.externalOfficeAmount} onChange={e => setEditForm(f => ({ ...f, externalOfficeAmount: e.target.value }))} style={{ width: "100%", padding: "8px 12px", borderRadius: 6, border: "1px solid var(--border)", background: "var(--bg)", color: "var(--text)", fontSize: 14, boxSizing: "border-box" as const }} /></div>
              <div><label style={{ fontSize: 12, fontWeight: 600, color: "var(--muted)", marginBottom: 4, display: "block" }}>نصيب موسى</label><input type="number" value={editForm.personalAmount} onChange={e => setEditForm(f => ({ ...f, personalAmount: e.target.value }))} style={{ width: "100%", padding: "8px 12px", borderRadius: 6, border: "1px solid var(--border)", background: "var(--bg)", color: "var(--text)", fontSize: 14, boxSizing: "border-box" as const }} /></div>
            </div>
            <div style={{ marginBottom: 16 }}>
              <label style={{ fontSize: 12, fontWeight: 600, color: "var(--muted)", marginBottom: 4, display: "block" }}>ملاحظات</label>
              <input value={editForm.notes} onChange={e => setEditForm(f => ({ ...f, notes: e.target.value }))} style={{ width: "100%", padding: "8px 12px", borderRadius: 6, border: "1px solid var(--border)", background: "var(--bg)", color: "var(--text)", fontSize: 14, boxSizing: "border-box" as const }} />
            </div>
            {error && <div style={{ color: "#ef4444", fontSize: 13, marginBottom: 12 }}>{error}</div>}
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button onClick={() => setEditDeal(null)} style={{ padding: "8px 16px", borderRadius: 8, border: "1px solid var(--border)", background: "transparent", color: "var(--muted)", fontSize: 13, cursor: "pointer" }}>إلغاء</button>
              <button onClick={saveEdit} style={{ padding: "8px 20px", borderRadius: 8, border: "none", background: "#f59e0b", color: "#fff", fontSize: 14, fontWeight: 700, cursor: "pointer" }}>حفظ التعديلات</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
