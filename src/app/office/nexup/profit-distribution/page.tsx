"use client";

import { useState, useEffect, useCallback } from "react";

type LedgerEntry = {
  id: string;
  partnerId: string;
  amount: number;
  date: string;
  note: string | null;
  createdAt: string;
  partner: { name: string };
};

type LedgerData = {
  ledger: LedgerEntry[];
  treasuryBalance: number;
  partnerTotals: Record<string, number>;
};

const fmt = (n: number) => n.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 });
const toEN = (d: string) => new Date(d).toLocaleDateString("en-GB", { day: "2-digit", month: "2-digit", year: "numeric" });

// Predefined partners (only SAIED and ADEL allowed)
const ALLOWED_PARTNERS = [
  { id: "", name: "SAIED" },
  { id: "", name: "ADEL" },
];

export default function NexupProfitDistributionPage() {
  const [data, setData] = useState<LedgerData | null>(null);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ partnerName: "SAIED", amount: "", date: new Date().toISOString().split("T")[0], note: "" });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [editId, setEditId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState({ amount: "", date: "", note: "" });

  const fetchData = useCallback(async () => {
    try {
      const res = await fetch("/api/nexup/profit-ledger");
      if (res.ok) setData(await res.json());
    } catch { /* ignore */ }
    setLoading(false);
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  const submitDistribution = async () => {
    if (!form.amount || !form.date) { setError("أدخل المبلغ والتاريخ"); return; }
    if (parseFloat(form.amount) <= 0) { setError("المبلغ يجب أن يكون أكبر من صفر"); return; }
    if (parseFloat(form.amount) > (data?.treasuryBalance || 0)) {
      setError(`المبلغ يتجاوز رصيد الخزنة المتاح (${fmt(data?.treasuryBalance || 0)} EGP)`);
      return;
    }

    setSaving(true); setError("");

    // Find partner ID by name
    const partnerRes = await fetch("/api/office/partners");
    if (!partnerRes.ok) { setError("خطأ في جلب الشركاء"); setSaving(false); return; }
    const partners = await partnerRes.json();
    const partner = partners.find((p: { name: string }) => p.name.toUpperCase() === form.partnerName.toUpperCase());
    if (!partner) { setError("الشريك غير موجود"); setSaving(false); return; }

    const res = await fetch("/api/nexup/profit-ledger", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ partnerId: partner.id, amount: parseFloat(form.amount), date: form.date, note: form.note || null }),
    });

    if (res.ok) {
      setShowForm(false);
      setForm({ partnerName: "SAIED", amount: "", date: new Date().toISOString().split("T")[0], note: "" });
      fetchData();
    } else {
      const d = await res.json();
      setError(d.error || "خطأ في الحفظ");
    }
    setSaving(false);
  };

  const deleteEntry = async (id: string) => {
    await fetch(`/api/nexup/profit-ledger/${id}`, { method: "DELETE" });
    setConfirmDelete(null);
    fetchData();
  };

  const startEdit = (entry: LedgerEntry) => {
    setEditId(entry.id);
    setEditForm({ amount: String(entry.amount), date: entry.date.split("T")[0], note: entry.note || "" });
  };

  const saveEdit = async () => {
    if (!editId) return;
    await fetch(`/api/nexup/profit-ledger/${editId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ amount: parseFloat(editForm.amount), date: editForm.date, note: editForm.note || null }),
    });
    setEditId(null);
    fetchData();
  };

  if (loading) {
    return (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "60vh" }}>
        <div style={{ textAlign: "center" }}>
          <div style={{ fontSize: 32, marginBottom: 12 }}>⏳</div>
          <p style={{ color: "var(--muted)" }}>جاري التحميل...</p>
        </div>
      </div>
    );
  }

  if (!data) {
    return (
      <div style={{ textAlign: "center", padding: 60 }}>
        <div style={{ fontSize: 48, marginBottom: 16 }}>📊</div>
        <h2 style={{ fontSize: 20, fontWeight: 700, color: "var(--text)", marginBottom: 8 }}>توزيع أرباح NEXUP</h2>
        <p style={{ color: "var(--muted)", fontSize: 14 }}>لم يتم العثور على بيانات</p>
      </div>
    );
  }

  const saiedTotal = data.partnerTotals["SAIED"] || 0;
  const adelTotal = data.partnerTotals["ADEL"] || 0;
  const totalDistributed = saiedTotal + adelTotal;

  return (
    <div style={{ maxWidth: 1200, margin: "0 auto" }}>
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24 }}>
        <div>
          <h1 style={{ fontSize: 24, fontWeight: 800, color: "var(--text)", margin: 0 }}>
            توزيع أرباح NEXUP
          </h1>
          <p style={{ fontSize: 12, color: "var(--muted)", margin: "4px 0 0" }}>
            Distribute NEXUP treasury profits — لـ SAIED و ADEL فقط
          </p>
        </div>
        <button
          onClick={() => setShowForm(!showForm)}
          style={{
            padding: "10px 20px", borderRadius: 10, border: "none",
            background: showForm ? "#6b7280" : "#0d9488", color: "#fff",
            fontSize: 13, fontWeight: 700, cursor: "pointer",
          }}
        >
          {showForm ? "✕ إلغاء" : "＋ توزيع جديد"}
        </button>
      </div>

      {error && (
        <div style={{ padding: "12px 16px", borderRadius: 10, background: "rgba(239,68,68,0.1)", color: "#ef4444", fontSize: 13, marginBottom: 16, border: "1px solid rgba(239,68,68,0.2)" }}>
          ⚠️ {error}
        </div>
      )}

      {/* ─── Summary Cards ─── */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 14, marginBottom: 24 }}>
        {[
          { label: "رصيد خزنة NEXUP", value: `${fmt(data.treasuryBalance)} EGP`, color: "#3b82f6", bg: "rgba(59,130,246,0.08)", icon: "🏦" },
          { label: "إجمالي الموزع", value: `${fmt(totalDistributed)} EGP`, color: "#8b5cf6", bg: "rgba(139,92,246,0.08)", icon: "📤" },
          { label: "نصيب SAIED", value: `${fmt(saiedTotal)} EGP`, color: "#0d9488", bg: "rgba(13,148,136,0.08)", icon: "👤" },
          { label: "نصيب ADEL", value: `${fmt(adelTotal)} EGP`, color: "#f59e0b", bg: "rgba(245,158,11,0.08)", icon: "👤" },
        ].map((s) => (
          <div key={s.label} style={{ padding: "18px 20px", borderRadius: 14, background: s.bg, border: "1px solid var(--border)" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
              <span style={{ fontSize: 18 }}>{s.icon}</span>
              <span style={{ fontSize: 11, color: "var(--muted)", fontWeight: 600 }}>{s.label}</span>
            </div>
            <div style={{ fontSize: 22, fontWeight: 800, color: s.color, direction: "ltr" }}>{s.value}</div>
          </div>
        ))}
      </div>

      {/* ─── Treasury Sufficiency Warning ─── */}
      {data.treasuryBalance <= 0 && (
        <div style={{ padding: "14px 18px", borderRadius: 10, background: "rgba(245,158,11,0.08)", border: "1px solid rgba(245,158,11,0.2)", marginBottom: 20, fontSize: 13, color: "#f59e0b" }}>
          ⚠️ رصيد خزنة NEXUP فارغ أو سالب — لا يمكن توزيع أرباح جديدة حتى يتم تحويل مبلغ جديد من السحوبات
        </div>
      )}

      {/* ─── Distribution Form ─── */}
      {showForm && (
        <div style={{ padding: 24, borderRadius: 14, background: "var(--surface)", border: "1px solid var(--border)", marginBottom: 20, boxShadow: "0 4px 16px rgba(0,0,0,0.08)" }}>
          <div style={{ fontSize: 16, fontWeight: 700, color: "var(--text)", marginBottom: 16 }}>تسجيل توزيع جديد</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 14, marginBottom: 14 }}>
            <div>
              <label style={lbl}>الشريك *</label>
              <select value={form.partnerName} onChange={e => setForm(f => ({ ...f, partnerName: e.target.value }))} style={inp}>
                <option value="SAIED">SAIED</option>
                <option value="ADEL">ADEL</option>
              </select>
            </div>
            <div>
              <label style={lbl}>المبلغ (EGP) *</label>
              <input type="number" value={form.amount} onChange={e => setForm(f => ({ ...f, amount: e.target.value }))}
                placeholder="0" style={inp} max={data.treasuryBalance} />
              <div style={{ fontSize: 10, color: "var(--muted)", marginTop: 2 }}>
                المتاح: {fmt(data.treasuryBalance)} EGP
              </div>
            </div>
            <div>
              <label style={lbl}>التاريخ *</label>
              <input type="date" value={form.date} onChange={e => setForm(f => ({ ...f, date: e.target.value }))} style={inp} />
            </div>
            <div>
              <label style={lbl}>ملاحظة</label>
              <input value={form.note} onChange={e => setForm(f => ({ ...f, note: e.target.value }))} placeholder="اختياري" style={inp} />
            </div>
          </div>
          {form.amount && parseFloat(form.amount) > 0 && (
            <div style={{ padding: "10px 14px", borderRadius: 8, background: "rgba(13,148,136,0.05)", border: "1px dashed rgba(13,148,136,0.3)", marginBottom: 14, fontSize: 13, color: "var(--text)" }}>
              سيتم خصم <b>{fmt(parseFloat(form.amount))} EGP</b> من رصيد الخزنة — المتاح بعد التوزيع: <b style={{ color: "#3b82f6" }}>{fmt(data.treasuryBalance - parseFloat(form.amount))} EGP</b>
            </div>
          )}
          <div style={{ display: "flex", gap: 10 }}>
            <button onClick={submitDistribution} disabled={saving} style={{ padding: "10px 24px", borderRadius: 8, border: "none", background: "#0d9488", color: "#fff", fontSize: 13, fontWeight: 700, cursor: "pointer", opacity: saving ? 0.6 : 1 }}>
              {saving ? "جاري الحفظ..." : "حفظ"}
            </button>
            <button onClick={() => setShowForm(false)} style={{ padding: "10px 24px", borderRadius: 8, border: "1px solid var(--border)", background: "transparent", color: "var(--muted)", fontSize: 13, cursor: "pointer" }}>
              إلغاء
            </button>
          </div>
        </div>
      )}

      {/* ─── Ledger Table ─── */}
      <div style={{ borderRadius: 14, border: "1px solid var(--border)", overflow: "hidden", boxShadow: "0 2px 8px rgba(0,0,0,0.06)" }}>
        {/* Table Header */}
        <div style={{ display: "grid", gridTemplateColumns: "100px 1fr 120px 1fr 200px 140px", padding: "12px 20px", background: "var(--surface)", borderBottom: "2px solid var(--border)", fontSize: 11, fontWeight: 700, color: "var(--text)", letterSpacing: 0.3 }}>
          <div>التاريخ</div>
          <div>الشريك</div>
          <div style={{ textAlign: "right" }}>المبلغ (EGP)</div>
          <div>ملاحظة</div>
          <div>التاريخ</div>
          <div style={{ textAlign: "center" }}>الإجراءات</div>
        </div>

        {data.ledger.length === 0 ? (
          <div style={{ textAlign: "center", padding: 48, color: "var(--muted)", fontSize: 13 }}>
            لا توجد توزيعات بعد — لم يتم توزيع أي أرباح من NEXUP
          </div>
        ) : (
          data.ledger.map((entry) => (
            <div key={entry.id} style={{
              display: "grid", gridTemplateColumns: "100px 1fr 120px 1fr 200px 140px",
              padding: "12px 20px", borderBottom: "1px solid var(--border)",
              fontSize: 13, alignItems: "center", transition: "background 0.1s",
            }}
              onMouseEnter={e => (e.currentTarget.style.background = "var(--surface-hover, rgba(0,0,0,0.02))")}
              onMouseLeave={e => (e.currentTarget.style.background = "transparent")}
            >
              <div style={{ fontSize: 12, color: "var(--muted)" }}>{toEN(entry.date)}</div>
              <div>
                <span style={{
                  display: "inline-flex", alignItems: "center", gap: 6,
                  padding: "3px 10px", borderRadius: 6, fontSize: 12, fontWeight: 600,
                  background: entry.partner.name.toUpperCase() === "SAIED" ? "rgba(13,148,136,0.1)" : "rgba(245,158,11,0.1)",
                  color: entry.partner.name.toUpperCase() === "SAIED" ? "#0d9488" : "#f59e0b",
                }}>
                  👤 {entry.partner.name}
                </span>
              </div>
              <div style={{ textAlign: "right", fontWeight: 800, color: "#ef4444", direction: "ltr" }}>
                {editId === entry.id ? (
                  <input type="number" value={editForm.amount} onChange={e => setEditForm(f => ({ ...f, amount: e.target.value }))}
                    style={{ width: 100, padding: "4px 8px", borderRadius: 4, border: "1px solid #0d9488", background: "var(--bg)", color: "var(--text)", fontSize: 12, textAlign: "right" }} />
                ) : (
                  `${fmt(entry.amount)} EGP`
                )}
              </div>
              <div style={{ fontSize: 12, color: "var(--muted)" }}>
                {editId === entry.id ? (
                  <input value={editForm.note} onChange={e => setEditForm(f => ({ ...f, note: e.target.value }))}
                    style={{ width: "100%", padding: "4px 8px", borderRadius: 4, border: "1px solid #0d9488", background: "var(--bg)", color: "var(--text)", fontSize: 12 }} />
                ) : (
                  entry.note || "—"
                )}
              </div>
              <div style={{ fontSize: 11, color: "var(--muted)" }}>{toEN(entry.createdAt)}</div>
              <div style={{ display: "flex", gap: 4, justifyContent: "center" }}>
                {editId === entry.id ? (
                  <>
                    <button onClick={saveEdit} style={{ padding: "4px 10px", borderRadius: 4, border: "none", background: "#10b981", color: "#fff", fontSize: 11, cursor: "pointer" }}>حفظ</button>
                    <button onClick={() => setEditId(null)} style={{ padding: "4px 10px", borderRadius: 4, border: "1px solid var(--border)", background: "transparent", color: "var(--muted)", fontSize: 11, cursor: "pointer" }}>إلغاء</button>
                  </>
                ) : confirmDelete === entry.id ? (
                  <>
                    <button onClick={() => deleteEntry(entry.id)} style={{ padding: "4px 10px", borderRadius: 4, border: "none", background: "#ef4444", color: "#fff", fontSize: 11, cursor: "pointer" }}>تأكيد</button>
                    <button onClick={() => setConfirmDelete(null)} style={{ padding: "4px 10px", borderRadius: 4, border: "1px solid var(--border)", background: "transparent", color: "var(--muted)", fontSize: 11, cursor: "pointer" }}>إلغاء</button>
                  </>
                ) : (
                  <>
                    <button onClick={() => startEdit(entry)} style={{ padding: "4px 8px", borderRadius: 4, border: "1px solid rgba(59,130,246,0.3)", background: "rgba(59,130,246,0.05)", color: "#3b82f6", fontSize: 11, cursor: "pointer" }}>✏️</button>
                    <button onClick={() => setConfirmDelete(entry.id)} style={{ padding: "4px 8px", borderRadius: 4, border: "1px solid rgba(239,68,68,0.3)", background: "rgba(239,68,68,0.05)", color: "#ef4444", fontSize: 11, cursor: "pointer" }}>🗑</button>
                  </>
                )}
              </div>
            </div>
          ))
        )}

        {/* Totals Row */}
        {data.ledger.length > 0 && (
          <div style={{ display: "grid", gridTemplateColumns: "100px 1fr 120px 1fr 200px 140px", padding: "14px 20px", background: "var(--surface)", fontWeight: 800, fontSize: 14, borderTop: "2px solid var(--border)" }}>
            <div style={{ color: "var(--text)" }}>المجموع</div>
            <div />
            <div style={{ textAlign: "right", color: "#ef4444", direction: "ltr" }}>{fmt(totalDistributed)} EGP</div>
            <div />
            <div />
            <div style={{ textAlign: "center", fontSize: 11, color: "var(--muted)" }}>{data.ledger.length} سجل</div>
          </div>
        )}
      </div>
    </div>
  );
}

const lbl: React.CSSProperties = { display: "block", fontSize: 11, fontWeight: 600, color: "var(--muted)", marginBottom: 4, textTransform: "uppercase", letterSpacing: 0.3 };
const inp: React.CSSProperties = { width: "100%", padding: "10px 12px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--bg)", color: "var(--text)", fontSize: 13, outline: "none", boxSizing: "border-box" as const };
