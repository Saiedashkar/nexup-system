"use client";

import { useState, useEffect, useCallback } from "react";

type ToolPayment = { id: string; amount: number; paidDate: string; notes: string | null };
type Tool = {
  id: string; name: string; type: string; category: string; cost: number;
  purchaseDate: string; nextDueDate: string | null; intervalDays: number | null;
  status: string; paidBy: string; notes: string | null; createdAt: string;
  payments: ToolPayment[];
};

const TYPE_LABELS: Record<string, { ar: string; en: string; color: string; icon: string }> = {
  ONE_TIME: { ar: "شراء مباشر", en: "One-Time", color: "#10b981", icon: "🛒" },
  MONTHLY_SUBSCRIPTION: { ar: "اشتراك شهري", en: "Monthly", color: "#3b82f6", icon: "🔄" },
  PERIODIC: { ar: "كل فترة", en: "Periodic", color: "#f59e0b", icon: "⏰" },
};

const STATUS_COLORS: Record<string, string> = { ACTIVE: "#10b981", INACTIVE: "#6b7280", EXPIRED: "#ef4444" };
const CATEGORIES = ["Software", "Hardware", "Furniture", "Services", "General"];

const fmt = (n: number) => n.toLocaleString("en-US");
const toEN = (d: string) => new Date(d).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });

export default function OfficeToolsPage() {
  const [tools, setTools] = useState<Tool[]>([]);
  const [totalCost, setTotalCost] = useState(0);
  const [monthlyTotal, setMonthlyTotal] = useState(0);
  const [totalPaid, setTotalPaid] = useState(0);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [showPaymentFor, setShowPaymentFor] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [filter, setFilter] = useState<string>("ALL");
  const [editingId, setEditingId] = useState<string | null>(null);

  const [form, setForm] = useState({
    name: "", type: "ONE_TIME", category: "General", cost: "",
    purchaseDate: new Date().toISOString().split("T")[0],
    nextDueDate: "", intervalDays: "", paidBy: "CAPITAL", notes: "",
  });
  const [payForm, setPayForm] = useState({ amount: "", paidDate: new Date().toISOString().split("T")[0], notes: "" });

  const fetchData = useCallback(async () => {
    try {
      const res = await fetch("/api/office/tools");
      if (res.ok) {
        const d = await res.json();
        setTools(d.tools || []);
        setTotalCost(d.totalCost || 0);
        setMonthlyTotal(d.monthlyTotal || 0);
        setTotalPaid(d.totalPaid || 0);
      }
    } catch { /* ignore */ }
    setLoading(false);
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  const submitTool = async () => {
    if (!form.name || !form.cost) { setError("أدخل الاسم والتكلفة"); return; }
    setSaving(true); setError("");
    try {
      const url = editingId ? `/api/office/tools/${editingId}` : "/api/office/tools";
      const method = editingId ? "PATCH" : "POST";
      const res = await fetch(url, {
        method, headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, cost: parseFloat(form.cost), intervalDays: form.intervalDays || null }),
      });
      if (res.ok) {
        setShowForm(false); setEditingId(null);
        setForm({ name: "", type: "ONE_TIME", category: "General", cost: "", purchaseDate: new Date().toISOString().split("T")[0], nextDueDate: "", intervalDays: "", paidBy: "CAPITAL", notes: "" });
        fetchData();
      } else { const d = await res.json(); setError(d.error || "خطأ"); }
    } catch { setError("خطأ في الشبكة"); }
    setSaving(false);
  };

  const submitPayment = async (toolId: string) => {
    if (!payForm.amount || !payForm.paidDate) { setError("أدخل المبلغ والتاريخ"); return; }
    setSaving(true); setError("");
    try {
      const res = await fetch(`/api/office/tools/${toolId}`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ amount: parseFloat(payForm.amount), paidDate: payForm.paidDate, notes: payForm.notes }),
      });
      if (res.ok) { setShowPaymentFor(null); setPayForm({ amount: "", paidDate: new Date().toISOString().split("T")[0], notes: "" }); fetchData(); }
      else { const d = await res.json(); setError(d.error || "خطأ"); }
    } catch { setError("خطأ في الشبكة"); }
    setSaving(false);
  };

  const deleteTool = async (id: string) => {
    await fetch(`/api/office/tools/${id}`, { method: "DELETE" });
    fetchData();
  };

  const startEdit = (tool: Tool) => {
    setEditingId(tool.id);
    setForm({
      name: tool.name, type: tool.type, category: tool.category, cost: String(tool.cost),
      purchaseDate: tool.purchaseDate.split("T")[0],
      nextDueDate: tool.nextDueDate ? tool.nextDueDate.split("T")[0] : "",
      intervalDays: tool.intervalDays ? String(tool.intervalDays) : "",
      paidBy: tool.paidBy, notes: tool.notes || "",
    });
    setShowForm(true);
  };

  const filtered = filter === "ALL" ? tools : tools.filter(t => t.type === filter);
  const overdueTools = tools.filter(t => t.status === "ACTIVE" && t.nextDueDate && new Date(t.nextDueDate) < new Date());

  return (
    <div style={{ direction: "rtl", maxWidth: 1200, margin: "0 auto" }}>
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24 }}>
        <div>
          <h1 style={{ fontSize: 26, fontWeight: 800, color: "var(--text)", margin: 0 }}>🛠️ الادوات — Office Tools</h1>
          <p style={{ fontSize: 12, color: "var(--muted)", margin: "4px 0 0" }}>إدارة أدوات المكتب — مشتريات + اشتراكات دورية</p>
        </div>
        <button onClick={() => { setShowForm(!showForm); setEditingId(null); setForm({ name: "", type: "ONE_TIME", category: "General", cost: "", purchaseDate: new Date().toISOString().split("T")[0], nextDueDate: "", intervalDays: "", paidBy: "CAPITAL", notes: "" }); }}
          style={{ padding: "10px 20px", borderRadius: 10, border: "none", background: showForm ? "#6b7280" : "#0d9488", color: "#fff", fontSize: 14, fontWeight: 700, cursor: "pointer" }}>
          {showForm ? "✕ إلغاء" : "＋ أداة جديدة"}
        </button>
      </div>

      {error && <div style={{ padding: "10px 16px", borderRadius: 8, background: "rgba(239,68,68,0.1)", color: "#ef4444", fontSize: 13, marginBottom: 16 }}>⚠️ {error}</div>}

      {/* Summary Cards */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 14, marginBottom: 24 }}>
        {[
          { label: "اجمالي التكلفة", value: `${fmt(totalCost)} EGP`, color: "#ef4444", icon: "💰" },
          { label: "اشتراكات شهرية", value: `${fmt(monthlyTotal)} EGP`, color: "#3b82f6", icon: "🔄" },
          { label: "اجمالي المدفوع", value: `${fmt(totalPaid)} EGP`, color: "#10b981", icon: "✅" },
          { label: "ادوات نشطة", value: String(tools.filter(t => t.status === "ACTIVE").length), color: "#8b5cf6", icon: "🛠️" },
        ].map(s => (
          <div key={s.label} style={{ padding: "18px 20px", borderRadius: 14, background: "var(--surface)", border: "1px solid var(--border)" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
              <span style={{ fontSize: 18 }}>{s.icon}</span>
              <span style={{ fontSize: 11, color: "var(--muted)", fontWeight: 600 }}>{s.label}</span>
            </div>
            <div style={{ fontSize: 22, fontWeight: 800, color: s.color, direction: "ltr" }}>{s.value}</div>
          </div>
        ))}
      </div>

      {/* Overdue Alert */}
      {overdueTools.length > 0 && (
        <div style={{ padding: "12px 20px", borderRadius: 10, background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.2)", marginBottom: 20, display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ fontSize: 18 }}>⚠️</span>
          <span style={{ fontSize: 13, color: "#ef4444", fontWeight: 600 }}>{overdueTools.length} أداة متأخرة في الدفع</span>
        </div>
      )}

      {/* Form */}
      {showForm && (
        <div style={{ padding: 24, borderRadius: 14, background: "var(--surface)", border: "2px solid #0d9488", marginBottom: 24 }}>
          <h3 style={{ fontSize: 16, fontWeight: 700, margin: "0 0 16px", color: "var(--text)" }}>{editingId ? "تعديل أداة" : "أداة جديدة"}</h3>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 14, marginBottom: 14 }}>
            <div><label style={lbl}>الاسم *</label><input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="مثال: Adobe Photoshop" style={inp} /></div>
            <div><label style={lbl}>النوع *</label>
              <select value={form.type} onChange={e => setForm(f => ({ ...f, type: e.target.value }))} style={inp}>
                <option value="ONE_TIME">🛒 شراء مباشر (One-Time)</option>
                <option value="MONTHLY_SUBSCRIPTION">🔄 اشتراك شهري (Monthly)</option>
                <option value="PERIODIC">⏰ كل فترة (Periodic)</option>
              </select>
            </div>
            <div><label style={lbl}>التصنيف</label>
              <select value={form.category} onChange={e => setForm(f => ({ ...f, category: e.target.value }))} style={inp}>
                {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div><label style={lbl}>التكلفة (EGP) *</label><input type="number" value={form.cost} onChange={e => setForm(f => ({ ...f, cost: e.target.value }))} placeholder="5000" style={inp} /></div>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 14, marginBottom: 14 }}>
            <div><label style={lbl}>تاريخ الشراء *</label><input type="date" value={form.purchaseDate} onChange={e => setForm(f => ({ ...f, purchaseDate: e.target.value }))} style={inp} /></div>
            {form.type !== "ONE_TIME" && (
              <div><label style={lbl}>{form.type === "MONTHLY_SUBSCRIPTION" ? "تاريخ التجديد" : "الدفعة القادمة"}</label><input type="date" value={form.nextDueDate} onChange={e => setForm(f => ({ ...f, nextDueDate: e.target.value }))} style={inp} /></div>
            )}
            {form.type === "PERIODIC" && (
              <div><label style={lbl}>عدد ايام الفترة</label><input type="number" value={form.intervalDays} onChange={e => setForm(f => ({ ...f, intervalDays: e.target.value }))} placeholder="90" style={inp} /></div>
            )}
            <div><label style={lbl}>المدفوع من</label>
              <select value={form.paidBy} onChange={e => setForm(f => ({ ...f, paidBy: e.target.value }))} style={inp}>
                <option value="CAPITAL">💰 رأس المال</option>
                <option value="SAIED">SAIED</option>
                <option value="ADEL">ADEL</option>
              </select>
            </div>
          </div>
          <div style={{ marginBottom: 14 }}><label style={lbl}>ملاحظات</label><input value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} placeholder="تفاصيل إضافية" style={inp} /></div>
          <div style={{ display: "flex", gap: 10 }}>
            <button onClick={submitTool} disabled={saving} style={{ padding: "10px 28px", borderRadius: 8, border: "none", background: "#0d9488", color: "#fff", fontSize: 14, fontWeight: 700, cursor: "pointer", opacity: saving ? 0.6 : 1 }}>{saving ? "جاري الحفظ..." : editingId ? "تحديث" : "حفظ"}</button>
            <button onClick={() => { setShowForm(false); setEditingId(null); }} style={{ padding: "10px 28px", borderRadius: 8, border: "1px solid var(--border)", background: "transparent", color: "var(--muted)", fontSize: 14, cursor: "pointer" }}>إلغاء</button>
          </div>
        </div>
      )}

      {/* Payment Form */}
      {showPaymentFor && (
        <div style={{ padding: 20, borderRadius: 12, background: "var(--surface)", border: "2px solid #3b82f6", marginBottom: 20 }}>
          <h3 style={{ fontSize: 15, fontWeight: 700, margin: "0 0 12px", color: "var(--text)" }}>💸 تسجيل دفعة — {tools.find(t => t.id === showPaymentFor)?.name}</h3>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr auto", gap: 12, alignItems: "end" }}>
            <div><label style={lbl}>المبلغ (EGP) *</label><input type="number" value={payForm.amount} onChange={e => setPayForm(f => ({ ...f, amount: e.target.value }))} style={inp} /></div>
            <div><label style={lbl}>التاريخ *</label><input type="date" value={payForm.paidDate} onChange={e => setPayForm(f => ({ ...f, paidDate: e.target.value }))} style={inp} /></div>
            <div><label style={lbl}>ملاحظات</label><input value={payForm.notes} onChange={e => setPayForm(f => ({ ...f, notes: e.target.value }))} style={inp} /></div>
            <button onClick={() => submitPayment(showPaymentFor)} disabled={saving} style={{ padding: "10px 20px", borderRadius: 8, border: "none", background: "#3b82f6", color: "#fff", fontSize: 13, fontWeight: 700, cursor: "pointer" }}>حفظ الدفعة</button>
          </div>
        </div>
      )}

      {/* Filters */}
      <div style={{ display: "flex", gap: 8, marginBottom: 20 }}>
        {[{ key: "ALL", label: "الكل" }, ...Object.entries(TYPE_LABELS).map(([k, v]) => ({ key: k, label: `${v.icon} ${v.ar}` }))].map(f => (
          <button key={f.key} onClick={() => setFilter(f.key)} style={{
            padding: "8px 16px", borderRadius: 8, border: filter === f.key ? "2px solid #0d9488" : "1px solid var(--border)",
            background: filter === f.key ? "rgba(13,148,136,0.1)" : "transparent",
            color: filter === f.key ? "#0d9488" : "var(--muted)", fontSize: 13, fontWeight: 600, cursor: "pointer",
          }}>{f.label}</button>
        ))}
      </div>

      {/* Tools Table */}
      {loading ? (
        <div style={{ textAlign: "center", padding: 48, color: "var(--muted)" }}>⏳ جاري التحميل...</div>
      ) : filtered.length === 0 ? (
        <div style={{ textAlign: "center", padding: 60, color: "var(--muted)" }}>
          <div style={{ fontSize: 48, marginBottom: 12 }}>🛠️</div>
          <div style={{ fontSize: 16, fontWeight: 700, color: "var(--text)" }}>لا توجد ادوات بعد</div>
          <div style={{ fontSize: 13, marginTop: 4 }}>اضف اول اداة للمكتب</div>
        </div>
      ) : (
        <div style={{ borderRadius: 14, border: "1px solid var(--border)", overflow: "hidden" }}>
          {/* Header */}
          <div style={{ display: "grid", gridTemplateColumns: "1.5fr 1fr 80px 100px 100px 100px 80px 120px", padding: "12px 16px", background: "var(--surface)", borderBottom: "2px solid var(--border)", fontSize: 11, fontWeight: 600, color: "var(--muted)" }}>
            <div>الاسم · Name</div>
            <div>النوع · Type</div>
            <div>التصنيف</div>
            <div style={{ textAlign: "right" }}>التكلفة</div>
            <div style={{ textAlign: "right" }}>المدفوع</div>
            <div>الحالة</div>
            <div>التجديد</div>
            <div style={{ textAlign: "center" }}>الاجراءات</div>
          </div>

          {filtered.map(tool => {
            const typeInfo = TYPE_LABELS[tool.type] || TYPE_LABELS.ONE_TIME;
            const totalPaidForTool = tool.payments.reduce((s, p) => s + p.amount, 0);
            const isOverdue = tool.status === "ACTIVE" && tool.nextDueDate && new Date(tool.nextDueDate) < new Date();

            return (
              <div key={tool.id} style={{ display: "grid", gridTemplateColumns: "1.5fr 1fr 80px 100px 100px 100px 80px 120px", padding: "14px 16px", borderBottom: "1px solid var(--border)", fontSize: 13, alignItems: "center", background: isOverdue ? "rgba(239,68,68,0.04)" : "transparent" }}>
                <div>
                  <div style={{ fontWeight: 700, color: "var(--text)" }}>{tool.name}</div>
                  <div style={{ fontSize: 10, color: "var(--muted)", marginTop: 2 }}>{tool.paidBy === "CAPITAL" ? "💰 رأس المال" : tool.paidBy}</div>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <span style={{ fontSize: 14 }}>{typeInfo.icon}</span>
                  <div>
                    <div style={{ fontSize: 12, fontWeight: 600, color: typeInfo.color }}>{typeInfo.ar}</div>
                    {tool.intervalDays && <div style={{ fontSize: 9, color: "var(--muted)" }}>كل {tool.intervalDays} يوم</div>}
                  </div>
                </div>
                <div><span style={{ padding: "2px 8px", borderRadius: 6, background: "var(--surface-hover)", fontSize: 11, fontWeight: 600 }}>{tool.category}</span></div>
                <div style={{ textAlign: "right", fontWeight: 700, direction: "ltr" }}>{fmt(tool.cost)} <span style={{ fontSize: 10, color: "var(--muted)" }}>EGP</span></div>
                <div style={{ textAlign: "right", fontWeight: 700, color: "#10b981", direction: "ltr" }}>{fmt(totalPaidForTool)} <span style={{ fontSize: 10, color: "var(--muted)" }}>EGP</span></div>
                <div>
                  <span style={{ padding: "3px 10px", borderRadius: 8, background: `${STATUS_COLORS[tool.status]}15`, color: STATUS_COLORS[tool.status], fontSize: 11, fontWeight: 600 }}>
                    {tool.status === "ACTIVE" ? "نشط" : tool.status === "EXPIRED" ? "منتهي" : "معطل"}
                  </span>
                </div>
                <div style={{ fontSize: 11, color: isOverdue ? "#ef4444" : "var(--muted)", fontWeight: isOverdue ? 700 : 400 }}>
                  {tool.nextDueDate ? toEN(tool.nextDueDate) : "—"}
                  {isOverdue && <span style={{ fontSize: 9, display: "block", color: "#ef4444" }}>⚠️ متأخر</span>}
                </div>
                <div style={{ display: "flex", gap: 4, justifyContent: "center" }}>
                  {tool.type !== "ONE_TIME" && (
                    <button onClick={() => { setShowPaymentFor(tool.id); setPayForm({ amount: String(tool.cost), paidDate: new Date().toISOString().split("T")[0], notes: "" }); }}
                      style={{ padding: "4px 8px", borderRadius: 4, border: "none", background: "#3b82f6", color: "#fff", fontSize: 10, cursor: "pointer" }} title="تسجيل دفعة">💸</button>
                  )}
                  <button onClick={() => startEdit(tool)} style={{ padding: "4px 8px", borderRadius: 4, border: "1px solid var(--border)", background: "transparent", color: "var(--muted)", fontSize: 10, cursor: "pointer" }} title="تعديل">✏️</button>
                  <button onClick={() => { if (confirm(`حذف "${tool.name}"?`)) deleteTool(tool.id); }}
                    style={{ padding: "4px 8px", borderRadius: 4, border: "1px solid rgba(239,68,68,0.3)", background: "rgba(239,68,68,0.05)", color: "#ef4444", fontSize: 10, cursor: "pointer" }} title="حذف">🗑</button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

const lbl: React.CSSProperties = { display: "block", fontSize: 11, fontWeight: 600, color: "var(--muted)", marginBottom: 4, textTransform: "uppercase", letterSpacing: 0.3 };
const inp: React.CSSProperties = { width: "100%", padding: "10px 12px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--bg)", color: "var(--text)", fontSize: 13, outline: "none", boxSizing: "border-box" as const };
