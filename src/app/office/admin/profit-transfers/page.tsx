"use client";

import { useState, useEffect, useCallback, useMemo } from "react";

type Transfer = {
  id: string; amount: number; date: string; note: string | null;
  business: { name: string; slug: string };
};
type Business = { id: string; name: string; slug: string };
type MonthlySummary = { month: number; year: number; income: number; expenses: number; netProfit: number };

const BIZ_COLORS: Record<string, string> = { nexup: "#0d9488", rebound: "#3b82f6", abomazen: "#8b5cf6" };
const BIZ_AR: Record<string, string> = { nexup: "نيكسوب", rebound: "ريباوند", abomazen: "أبومازن" };
const fmt = (n: number) => n.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 });
const toAR = (d: string) => {
  const dt = new Date(d);
  return dt.toLocaleDateString("ar-EG", { day: "2-digit", month: "short", year: "numeric" });
};
const MONTHS_AR = ["يناير","فبراير","مارس","أبريل","مايو","يونيو","يوليو","أغسطس","سبتمبر","أكتوبر","نوفمبر","ديسمبر"];

export default function ProfitTransfersPage() {
  const [transfers, setTransfers] = useState<Transfer[]>([]);
  const [businesses, setBusinesses] = useState<Business[]>([]);
  const [monthlyData, setMonthlyData] = useState<Record<string, MonthlySummary[]>>({});
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [editForm, setEditForm] = useState({ amount: "", date: "", note: "" });
  const [form, setForm] = useState({
    businessId: "", amount: "", date: new Date().toISOString().split("T")[0], note: "",
  });
  const [selectedMonth, setSelectedMonth] = useState<string>("");

  const fetchData = useCallback(async () => {
    setLoading(true);
    const [tRes, bRes] = await Promise.all([
      fetch("/api/office/profit-transfers"),
      fetch("/api/office/stats"),
    ]);
    if (tRes.ok) setTransfers(await tRes.json());
    if (bRes.ok) {
      const d = await bRes.json();
      setBusinesses(d.businesses || []);
      // Fetch monthly summaries for each business
      const summaries: Record<string, MonthlySummary[]> = {};
      for (const b of d.businesses || []) {
        try {
          const sRes = await fetch(`/api/office/stats?businessId=${b.id}`);
          if (sRes.ok) {
            const sd = await sRes.json();
            summaries[b.id] = sd.monthlySummaries || [];
          }
        } catch { /* skip */ }
      }
      setMonthlyData(summaries);
    }
    setLoading(false);
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  const totalTransferred = transfers.reduce((s, t) => s + t.amount, 0);

  // Get unique months from transfers
  const transferMonths = useMemo(() => {
    const months = new Map<string, { label: string; total: number; count: number }>();
    for (const t of transfers) {
      const dt = new Date(t.date);
      const key = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}`;
      const existing = months.get(key) || { label: `${MONTHS_AR[dt.getMonth()]} ${dt.getFullYear()}`, total: 0, count: 0 };
      existing.total += t.amount;
      existing.count++;
      months.set(key, existing);
    }
    return Array.from(months.entries()).sort(([a], [b]) => b.localeCompare(a));
  }, [transfers]);

  // Filter transfers by selected month
  const filteredTransfers = useMemo(() => {
    if (!selectedMonth) return transfers;
    return transfers.filter(t => {
      const dt = new Date(t.date);
      const key = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}`;
      return key === selectedMonth;
    });
  }, [transfers, selectedMonth]);

  const submit = async () => {
    if (!form.businessId || !form.amount) return;
    await fetch("/api/office/profit-transfers", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...form, amount: parseFloat(form.amount) }),
    });
    setForm({ businessId: "", amount: "", date: new Date().toISOString().split("T")[0], note: "" });
    setShowForm(false); fetchData();
  };

  const updateTransfer = async (id: string) => {
    await fetch(`/api/office/profit-transfers/${id}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ amount: parseFloat(editForm.amount), date: editForm.date, note: editForm.note || null }),
    });
    setEditing(null); fetchData();
  };

  const deleteTransfer = async (id: string) => {
    await fetch(`/api/office/profit-transfers/${id}`, { method: "DELETE" });
    setConfirmDelete(null); fetchData();
  };

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24 }}>
        <div>
          <h1 style={{ fontSize: 24, fontWeight: 800, color: "var(--text)", margin: 0 }}>تحويل الأرباح</h1>
          <p style={{ fontSize: 13, color: "var(--muted)", margin: "4px 0 0" }}>نقل أرباح الأنشطة إلى خزينة المكتب — Profit Transfers</p>
        </div>
        <button onClick={() => setShowForm(true)} style={{ padding: "9px 18px", borderRadius: 8, border: "none", background: "#0d9488", color: "#fff", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>＋ تحويل جديد</button>
      </div>

      {/* Business Profit Summary Cards */}
      <div style={{ display: "grid", gridTemplateColumns: `repeat(${Math.max(businesses.length, 1)}, 1fr)`, gap: 14, marginBottom: 20 }}>
        {businesses.map(b => {
          const summaries = monthlyData[b.id] || [];
          const latestMonth = summaries[0];
          return (
            <div key={b.id} style={{ padding: "18px 20px", borderRadius: 12, background: `${BIZ_COLORS[b.slug] || "#6b7280"}15`, border: `1px solid ${BIZ_COLORS[b.slug] || "#6b7280"}40` }}>
              <div style={{ fontSize: 11, color: "var(--muted)", marginBottom: 4 }}>{b.name} — {BIZ_AR[b.slug] || b.name}</div>
              {latestMonth ? (
                <>
                  <div style={{ fontSize: 18, fontWeight: 800, color: latestMonth.netProfit >= 0 ? "#10b981" : "#ef4444", direction: "ltr" }}>
                    {latestMonth.netProfit >= 0 ? "+" : ""}{fmt(latestMonth.netProfit)} EGP
                  </div>
                  <div style={{ fontSize: 10, color: "var(--muted)" }}>صافي الربح — {MONTHS_AR[latestMonth.month - 1]} {latestMonth.year}</div>
                </>
              ) : (
                <div style={{ fontSize: 13, color: "var(--muted)" }}>لا توجد بيانات بعد</div>
              )}
            </div>
          );
        })}
      </div>

      {/* Total transferred */}
      <div style={{ padding: "14px 20px", borderRadius: 12, background: "rgba(13,148,136,0.06)", border: "1px solid var(--border)", marginBottom: 20, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div>
          <div style={{ fontSize: 11, color: "var(--muted)" }}>إجمالي المحول إلى الخزينة</div>
          <div style={{ fontSize: 22, fontWeight: 800, color: "#0d9488", direction: "ltr" }}>{fmt(totalTransferred)} EGP</div>
        </div>
        <div style={{ fontSize: 12, color: "var(--muted)" }}>{transfers.length} عملية تحويل</div>
      </div>

      {/* Form */}
      {showForm && (
        <div style={{ padding: 20, borderRadius: 12, background: "var(--surface)", border: "1px solid var(--border)", marginBottom: 16 }}>
          <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 12, color: "var(--text)" }}>تحويل ربح جديد</div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12, marginBottom: 12 }}>
            <div>
              <label style={{ fontSize: 10, fontWeight: 600, color: "var(--muted)" }}>النشاط *</label>
              <select value={form.businessId} onChange={e => {
                const bizId = e.target.value;
                // Auto-suggest latest net profit as default amount
                const summaries = monthlyData[bizId] || [];
                const latestNet = summaries[0]?.netProfit || 0;
                setForm(f => ({ ...f, businessId: bizId, amount: latestNet > 0 ? String(latestNet) : f.amount }));
              }} style={{ width: "100%", padding: "8px 10px", borderRadius: 6, border: "1px solid var(--border)", background: "var(--bg)", color: "var(--text)", fontSize: 12, outline: "none", marginTop: 4 }}>
                <option value="">اختر نشاط</option>
                {businesses.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
            </div>
            <div>
              <label style={{ fontSize: 10, fontWeight: 600, color: "var(--muted)" }}>المبلغ (EGP) *</label>
              <input type="number" value={form.amount} onChange={e => setForm(f => ({ ...f, amount: e.target.value }))} placeholder="0" style={{ width: "100%", padding: "8px 10px", borderRadius: 6, border: "1px solid var(--border)", background: "var(--bg)", color: "var(--text)", fontSize: 12, outline: "none", marginTop: 4 }} />
            </div>
            <div>
              <label style={{ fontSize: 10, fontWeight: 600, color: "var(--muted)" }}>التاريخ *</label>
              <input type="date" value={form.date} onChange={e => setForm(f => ({ ...f, date: e.target.value }))} style={{ width: "100%", padding: "8px 10px", borderRadius: 6, border: "1px solid var(--border)", background: "var(--bg)", color: "var(--text)", fontSize: 12, outline: "none", marginTop: 4 }} />
            </div>
            <div>
              <label style={{ fontSize: 10, fontWeight: 600, color: "var(--muted)" }}>ملاحظة</label>
              <input value={form.note} onChange={e => setForm(f => ({ ...f, note: e.target.value }))} placeholder="اختياري" style={{ width: "100%", padding: "8px 10px", borderRadius: 6, border: "1px solid var(--border)", background: "var(--bg)", color: "var(--text)", fontSize: 12, outline: "none", marginTop: 4 }} />
            </div>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={submit} style={{ padding: "8px 20px", borderRadius: 8, border: "none", background: "#0d9488", color: "#fff", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>حفظ</button>
            <button onClick={() => setShowForm(false)} style={{ padding: "8px 20px", borderRadius: 8, border: "1px solid var(--border)", background: "transparent", color: "var(--muted)", fontSize: 12, cursor: "pointer" }}>إلغاء</button>
          </div>
        </div>
      )}

      {/* Month filters */}
      {transferMonths.length > 0 && (
        <div style={{ display: "flex", gap: 8, marginBottom: 16, flexWrap: "wrap" }}>
          <button onClick={() => setSelectedMonth("")} style={{ padding: "6px 14px", borderRadius: 8, border: selectedMonth === "" ? "2px solid #0d9488" : "1px solid var(--border)", background: selectedMonth === "" ? "rgba(13,148,136,0.1)" : "var(--surface)", color: selectedMonth === "" ? "#0d9488" : "var(--muted)", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>الكل</button>
          {transferMonths.map(([key, info]) => (
            <button key={key} onClick={() => setSelectedMonth(key)} style={{ padding: "6px 14px", borderRadius: 8, border: selectedMonth === key ? "2px solid #0d9488" : "1px solid var(--border)", background: selectedMonth === key ? "rgba(13,148,136,0.1)" : "var(--surface)", color: selectedMonth === key ? "#0d9488" : "var(--muted)", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>
              {info.label} ({info.count})
            </button>
          ))}
        </div>
      )}

      {/* Transfers Table */}
      <div style={{ borderRadius: 12, border: "1px solid var(--border)", overflow: "hidden" }}>
        <div style={{ display: "grid", gridTemplateColumns: "100px 140px 1fr 100px 140px", padding: "10px 16px", background: "var(--surface)", borderBottom: "2px solid var(--border)", fontSize: 11, fontWeight: 600, color: "var(--muted)", textTransform: "uppercase" }}>
          <div>التاريخ</div><div>النشاط</div><div>الملاحظة</div><div style={{ textAlign: "right" }}>المبلغ</div><div style={{ textAlign: "center" }}>الإجراءات</div>
        </div>

        {loading ? (
          <div style={{ textAlign: "center", padding: 32, color: "var(--muted)" }}>جاري التحميل...</div>
        ) : filteredTransfers.length === 0 ? (
          <div style={{ textAlign: "center", padding: 48, color: "var(--muted)" }}>لا توجد عمليات تحويل بعد.</div>
        ) : filteredTransfers.map(t => (
          <div key={t.id} style={{ display: "grid", gridTemplateColumns: "100px 140px 1fr 100px 140px", padding: "10px 16px", borderBottom: "1px solid var(--border)", fontSize: 13, alignItems: "center" }}
            onMouseEnter={e => (e.currentTarget.style.background = "var(--surface-hover, rgba(0,0,0,0.02))")} onMouseLeave={e => (e.currentTarget.style.background = "transparent")}>
            <div style={{ fontSize: 12, color: "var(--muted)" }}>{toAR(t.date)}</div>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <div style={{ width: 8, height: 8, borderRadius: 3, background: BIZ_COLORS[t.business.slug] || "#6b7280" }} />
              <span style={{ fontWeight: 600, fontSize: 12 }}>{t.business.name}</span>
            </div>
            <div style={{ fontSize: 12, color: "var(--muted)" }}>
              {editing === t.id ? (
                <input value={editForm.note || ""} onChange={e => setEditForm(f => ({ ...f, note: e.target.value }))} style={{ width: "100%", padding: "3px 6px", borderRadius: 4, border: "1px solid #0d9488", background: "var(--bg)", color: "var(--text)", fontSize: 11, outline: "none" }} />
              ) : (t.note || "—")}
            </div>
            <div style={{ textAlign: "right", fontWeight: 700, color: "#0d9488", direction: "ltr" }}>
              {editing === t.id ? (
                <input type="number" value={editForm.amount} onChange={e => setEditForm(f => ({ ...f, amount: e.target.value }))} style={{ width: 80, padding: "3px 6px", borderRadius: 4, border: "1px solid #0d9488", background: "var(--bg)", color: "var(--text)", fontSize: 12, outline: "none", textAlign: "right" }} />
              ) : `+${fmt(t.amount)} EGP`}
            </div>
            <div style={{ display: "flex", gap: 4, justifyContent: "center" }}>
              {editing === t.id ? (
                <>
                  <button onClick={() => updateTransfer(t.id)} style={{ padding: "3px 8px", borderRadius: 4, border: "none", background: "#0d9488", color: "#fff", fontSize: 10, cursor: "pointer" }}>حفظ</button>
                  <button onClick={() => setEditing(null)} style={{ padding: "3px 8px", borderRadius: 4, border: "1px solid var(--border)", background: "transparent", color: "var(--muted)", fontSize: 10, cursor: "pointer" }}>إلغاء</button>
                </>
              ) : confirmDelete === t.id ? (
                <>
                  <button onClick={() => deleteTransfer(t.id)} style={{ padding: "3px 8px", borderRadius: 4, border: "none", background: "#ef4444", color: "#fff", fontSize: 10, cursor: "pointer" }}>تأكيد</button>
                  <button onClick={() => setConfirmDelete(null)} style={{ padding: "3px 8px", borderRadius: 4, border: "1px solid var(--border)", background: "transparent", color: "var(--muted)", fontSize: 10, cursor: "pointer" }}>إلغاء</button>
                </>
              ) : (
                <>
                  <button onClick={() => { setEditing(t.id); setEditForm({ amount: String(t.amount), date: t.date.split("T")[0], note: t.note || "" }); }} style={{ padding: "3px 6px", borderRadius: 4, border: "1px solid var(--border)", background: "transparent", color: "var(--muted)", fontSize: 10, cursor: "pointer" }}>✏️</button>
                  <button onClick={() => setConfirmDelete(t.id)} style={{ padding: "3px 6px", borderRadius: 4, border: "1px solid rgba(239,68,68,0.3)", background: "rgba(239,68,68,0.05)", color: "#ef4444", fontSize: 10, cursor: "pointer" }}>🗑</button>
                </>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
