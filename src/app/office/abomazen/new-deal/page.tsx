"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";

type Property = { id: string; ownerName: string; propertyType: string; location: string; listingType: string };

function fmt(n: number) { return n.toLocaleString("en-US"); }

export default function NewDealPage() {
  const router = useRouter();
  const [properties, setProperties] = useState<Property[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);
  const [useProperty, setUseProperty] = useState(true);
  const [propSearch, setPropSearch] = useState("");
  const [form, setForm] = useState({
    dealType: "RENT",
    propertyId: "",
    seekerName: "",
    seekerPhone: "",
    dealValue: "",
    totalCommission: "",
    externalOfficeAmount: "",
    personalAmount: "",
    abomazenNetAmount: "",
    date: new Date().toISOString().split("T")[0],
    notes: "",
  });

  useEffect(() => {
    fetch("/api/abomazen/properties?status=AVAILABLE")
      .then(r => r.json())
      .then(d => setProperties(Array.isArray(d) ? d : []))
      .catch(() => {});
  }, []);

  const filteredProps = properties.filter(p =>
    p.ownerName.toLowerCase().includes(propSearch.toLowerCase()) ||
    p.location.toLowerCase().includes(propSearch.toLowerCase()) ||
    p.propertyType.toLowerCase().includes(propSearch.toLowerCase())
  );

  // Auto-suggest abomazenNetAmount when commission fields change
  useEffect(() => {
    const total = parseFloat(form.totalCommission) || 0;
    const ext = parseFloat(form.externalOfficeAmount) || 0;
    const personal = parseFloat(form.personalAmount) || 0;
    if (total > 0 && !form.abomazenNetAmount) {
      const suggested = total - ext - personal;
      if (suggested > 0) setForm(f => ({ ...f, abomazenNetAmount: String(suggested) }));
    }
  }, [form.totalCommission, form.externalOfficeAmount, form.personalAmount]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.totalCommission || !form.abomazenNetAmount) {
      setError("يجب إدخال إجمالي العمولة وصافي ABOMAZEN");
      return;
    }
    setSubmitting(true); setError("");
    try {
      const r = await fetch("/api/abomazen/deals", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...form,
          propertyId: useProperty && form.propertyId ? form.propertyId : null,
          dealValue: form.dealValue ? parseFloat(form.dealValue) : null,
          totalCommission: parseFloat(form.totalCommission),
          externalOfficeAmount: form.externalOfficeAmount ? parseFloat(form.externalOfficeAmount) : null,
          personalAmount: form.personalAmount ? parseFloat(form.personalAmount) : null,
          abomazenNetAmount: parseFloat(form.abomazenNetAmount),
        }),
      });
      if (!r.ok) { const d = await r.json(); throw new Error(d.error || "حدث خطأ"); }
      setSuccess(true);
      setTimeout(() => router.push("/office/abomazen/deals"), 1500);
    } catch (err) { setError(err instanceof Error ? err.message : "حدث خطأ"); }
    setSubmitting(false);
  };

  if (success) return (
    <div style={{ textAlign: "center", padding: 60 }}>
      <div style={{ fontSize: 64, marginBottom: 16 }}>✅</div>
      <h2 style={{ fontSize: 24, fontWeight: 800, color: "#10b981", marginBottom: 8 }}>تم حفظ الصفقة بنجاح!</h2>
      <p style={{ color: "var(--muted)", fontSize: 16 }}>جاري التوجيه لصفحة الصفقات...</p>
    </div>
  );

  return (
    <div style={{ maxWidth: 700, margin: "0 auto" }}>
      <h1 style={{ fontSize: 24, fontWeight: 800, color: "var(--text)", margin: "0 0 8px" }}>📝 تسجيل صفقة جديدة</h1>
      <p style={{ fontSize: 13, color: "var(--muted)", marginBottom: 24 }}>سجّل تفاصيل الصفقة هنا — الحقول الإلزامية فقط: نوع الصفقة، العمولة، صافي ABOMAZEN</p>

      <form onSubmit={handleSubmit} style={{ background: "var(--surface)", borderRadius: 16, border: "1px solid var(--border)", padding: "24px 28px" }}>
        {/* Deal Type - Big Buttons */}
        <label style={lbl}>نوع الصفقة *</label>
        <div style={{ display: "flex", gap: 12, marginBottom: 20 }}>
          {(["RENT", "SALE"] as const).map(t => (
            <button key={t} type="button" onClick={() => setForm(f => ({ ...f, dealType: t }))} style={{
              flex: 1, padding: "16px", borderRadius: 12,
              border: form.dealType === t ? "2px solid #f59e0b" : "1px solid var(--border)",
              background: form.dealType === t ? "rgba(245,158,11,0.1)" : "transparent",
              color: form.dealType === t ? "#f59e0b" : "var(--muted)", fontSize: 18, fontWeight: 800, cursor: "pointer",
              display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
            }}>{t === "RENT" ? "🔑 صفقة إيجار" : "🏷️ صفقة بيع"}</button>
          ))}
        </div>

        {/* Property Selection */}
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16 }}>
          <label style={{ fontSize: 14, fontWeight: 600, color: "var(--text)", cursor: "pointer", display: "flex", alignItems: "center", gap: 8 }}>
            <input type="checkbox" checked={useProperty} onChange={e => setUseProperty(e.target.checked)} style={{ width: 18, height: 18 }} />
            ربط بعقار مسجل
          </label>
          {!useProperty && <span style={{ fontSize: 13, color: "#f59e0b", fontWeight: 600 }}>صفقة سريعة بدون عقار مسجل</span>}
        </div>

        {useProperty && (
          <div style={{ marginBottom: 16 }}>
            <label style={lbl}>اختر العقار</label>
            <input placeholder="🔍 بحث بالاسم أو الموقع..." value={propSearch} onChange={e => setPropSearch(e.target.value)} style={{ ...inp, marginBottom: 8 }} />
            <div style={{ display: "flex", flexDirection: "column", gap: 6, maxHeight: 200, overflowY: "auto" }}>
              {filteredProps.map(p => (
                <div key={p.id} onClick={() => setForm(f => ({ ...f, propertyId: p.id }))} style={{
                  padding: "10px 14px", borderRadius: 8, cursor: "pointer",
                  border: form.propertyId === p.id ? "2px solid #f59e0b" : "1px solid var(--border)",
                  background: form.propertyId === p.id ? "rgba(245,158,11,0.08)" : "var(--surface-hover)",
                  display: "flex", justifyContent: "space-between", alignItems: "center",
                }}>
                  <div>
                    <span style={{ fontWeight: 600, fontSize: 14 }}>{p.ownerName}</span>
                    <span style={{ fontSize: 13, color: "var(--muted)", marginInlineStart: 8 }}>{p.propertyType} — {p.location}</span>
                  </div>
                  <span style={{ fontSize: 12, color: p.listingType === "RENT" ? "#f59e0b" : "#3b82f6", fontWeight: 600 }}>{p.listingType === "RENT" ? "🔑 إيجار" : "🏷️ بيع"}</span>
                </div>
              ))}
              {filteredProps.length === 0 && <p style={{ color: "var(--muted)", fontSize: 13, textAlign: "center", padding: 12 }}>لا توجد عقارات متاحة</p>}
            </div>
          </div>
        )}

        {/* Seeker */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginBottom: 16 }}>
          <div><label style={lbl}>اسم الباحث</label><input value={form.seekerName} onChange={e => setForm(f => ({ ...f, seekerName: e.target.value }))} placeholder="مثال: سيد أحمد" style={inp} /></div>
          <div><label style={lbl}>هاتف الباحث</label><input value={form.seekerPhone} onChange={e => setForm(f => ({ ...f, seekerPhone: e.target.value }))} placeholder="مثال: 01012345678" style={inp} /></div>
        </div>

        {/* Deal Value */}
        <div style={{ marginBottom: 16 }}>
          <label style={lbl}>قيمة الصفقة الكاملة (اختياري)</label>
          <input type="number" value={form.dealValue} onChange={e => setForm(f => ({ ...f, dealValue: e.target.value }))} placeholder="مثال: 500000" style={inp} />
        </div>

        {/* Commission - Required */}
        <div style={{ padding: "16px 20px", borderRadius: 12, background: "rgba(245,158,11,0.06)", border: "1px solid rgba(245,158,11,0.2)", marginBottom: 16 }}>
          <label style={{ ...lbl, color: "#f59e0b", fontSize: 14 }}>💰 إجمالي العمولة المقبوضة *</label>
          <input type="number" required value={form.totalCommission} onChange={e => setForm(f => ({ ...f, totalCommission: e.target.value }))} placeholder="المبلغ الكامل للعمولة" style={{ ...inp, fontSize: 18, fontWeight: 700, borderColor: "#f59e0b" }} />
        </div>

        {/* Distribution (Optional) */}
        <details style={{ marginBottom: 16 }}>
          <summary style={{ fontSize: 14, fontWeight: 600, color: "var(--muted)", cursor: "pointer", padding: "8px 0" }}>
            📊 توزيع العمولة (اختياري — للاسترشاد فقط)
          </summary>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginTop: 12 }}>
            <div><label style={lbl}>نصيب المكتب الأساسي</label><input type="number" value={form.externalOfficeAmount} onChange={e => setForm(f => ({ ...f, externalOfficeAmount: e.target.value }))} placeholder="اختياري" style={inp} /></div>
            <div><label style={lbl}>نصيب موسى الشخصي</label><input type="number" value={form.personalAmount} onChange={e => setForm(f => ({ ...f, personalAmount: e.target.value }))} placeholder="اختياري" style={inp} /></div>
          </div>
          {form.totalCommission && (form.externalOfficeAmount || form.personalAmount) && (
            <div style={{ marginTop: 8, padding: "8px 12px", borderRadius: 8, background: "rgba(16,185,129,0.08)", fontSize: 13, color: "#10b981" }}>
              💡 المقترح: صافي ABOMAZEN = {fmt(parseFloat(form.totalCommission) - (parseFloat(form.externalOfficeAmount) || 0) - (parseFloat(form.personalAmount) || 0))} EGP
            </div>
          )}
        </details>

        {/* ABOMAZEN Net - Required */}
        <div style={{ padding: "16px 20px", borderRadius: 12, background: "rgba(245,158,11,0.06)", border: "1px solid rgba(245,158,11,0.2)", marginBottom: 16 }}>
          <label style={{ ...lbl, color: "#f59e0b", fontSize: 14 }}>🏠 صافي ABOMAZEN *</label>
          <input type="number" required value={form.abomazenNetAmount} onChange={e => setForm(f => ({ ...f, abomazenNetAmount: e.target.value }))} placeholder="المبلغ الذي يدخل رصيد ABOMAZEN" style={{ ...inp, fontSize: 18, fontWeight: 700, borderColor: "#f59e0b" }} />
          <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 4 }}>هذا المبلغ يُضاف تلقائيًا لرصيد ABOMAZEN</div>
        </div>

        {/* Date & Notes */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginBottom: 20 }}>
          <div><label style={lbl}>التاريخ</label><input type="date" value={form.date} onChange={e => setForm(f => ({ ...f, date: e.target.value }))} style={inp} /></div>
          <div><label style={lbl}>ملاحظات</label><input value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} placeholder="ملاحظات إضافية" style={inp} /></div>
        </div>

        {error && <div style={{ padding: "10px 16px", borderRadius: 8, background: "rgba(239,68,68,0.1)", color: "#ef4444", fontSize: 14, marginBottom: 16 }}>{error}</div>}

        <button type="submit" disabled={submitting} style={{
          width: "100%", padding: "14px 24px", borderRadius: 12, border: "none",
          background: "#f59e0b", color: "#fff", fontSize: 18, fontWeight: 800, cursor: "pointer",
          opacity: submitting ? 0.6 : 1, boxShadow: "0 4px 12px rgba(245,158,11,0.3)",
        }}>{submitting ? "جاري الحفظ..." : "✅ حفظ الصفقة"}</button>
      </form>
    </div>
  );
}

const lbl: React.CSSProperties = { display: "block", fontSize: 13, fontWeight: 600, color: "var(--muted)", marginBottom: 6 };
const inp: React.CSSProperties = { width: "100%", padding: "10px 14px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--bg)", color: "var(--text)", fontSize: 14, outline: "none", boxSizing: "border-box" as const };
