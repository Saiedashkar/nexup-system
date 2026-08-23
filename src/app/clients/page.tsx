"use client";

import { useEffect, useState, useCallback } from "react";
import { AppShell } from "@/components/app-shell";

type Client = {
  id: string;
  name: string;
  phone: string;
  tier: string;
  projectRecords: { id: string; projectName: string; totalPrice: number; workStatus: string; paymentStatus: string; date: string }[];
};

type Project = {
  id: string;
  projectName: string;
  date: string;
  customServiceText: string | null;
  totalPrice: number;
  deposit: number;
  remaining: number;
  workStatus: string;
  paymentStatus: string;
  notes: string | null;
  client: { id: string; name: string; phone: string; tier: string };
  designer: { id: string; name: string };
  services: { id: string; name: string }[];
};

type Service = { id: string; name: string; isCustom: boolean };

const workStatusMap: Record<string, string> = {
  WAITING: "قيد الانتظار",
  IN_PROGRESS: "قيد التنفيذ",
  COMPLETED: "مكتمل",
  PAUSED: "متوقف",
};

const paymentStatusMap: Record<string, string> = {
  FULL: "مدفوع بالكامل",
  PARTIAL: "دفع جزئي",
  UNPAID: "غير مدفوع",
};

const tierMap: Record<string, string> = {
  VIP: "VIP",
  LOYAL: "دائم",
  NORMAL: "عادي",
  DELINQUENT: "متعثر",
};

export default function ClientsPage() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [services, setServices] = useState<Service[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  // Filters
  const [search, setSearch] = useState("");
  const [workStatusFilter, setWorkStatusFilter] = useState("");
  const [paymentStatusFilter, setPaymentStatusFilter] = useState("");

  // Form state
  const [form, setForm] = useState({
    clientPhone: "",
    clientName: "",
    projectName: "",
    date: new Date().toISOString().split("T")[0],
    customServiceText: "",
    totalPrice: "",
    deposit: "",
    workStatus: "WAITING",
    serviceIds: [] as string[],
    notes: "",
  });

  // Client suggestion
  const [clientSuggestion, setClientSuggestion] = useState<Client | null>(null);
  const [checkingPhone, setCheckingPhone] = useState(false);

  const fetchProjects = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams();
    if (search) params.set("search", search);
    if (workStatusFilter) params.set("workStatus", workStatusFilter);
    if (paymentStatusFilter) params.set("paymentStatus", paymentStatusFilter);

    try {
      const res = await fetch(`/api/projects?${params.toString()}`);
      if (res.ok) setProjects(await res.json());
    } catch { /* ignore */ }
    setLoading(false);
  }, [search, workStatusFilter, paymentStatusFilter]);

  const fetchServices = async () => {
    try {
      const res = await fetch("/api/services");
      if (res.ok) setServices(await res.json());
    } catch { /* ignore */ }
  };

  useEffect(() => { fetchProjects(); }, [fetchProjects]);
  useEffect(() => { fetchServices(); }, []);

  // Check phone on blur
  const checkPhone = async (phone: string) => {
    if (!phone || phone.length < 5) { setClientSuggestion(null); return; }
    setCheckingPhone(true);
    try {
      const res = await fetch("/api/clients");
      if (res.ok) {
        const clients: Client[] = await res.json();
        const match = clients.find((c) => c.phone === phone);
        if (match) {
          setClientSuggestion(match);
          setForm((f) => ({ ...f, clientName: match.name }));
        } else {
          setClientSuggestion(null);
        }
      }
    } catch { setClientSuggestion(null); }
    setCheckingPhone(false);
  };

  const remaining = form.totalPrice && form.deposit
    ? (parseFloat(form.totalPrice) - parseFloat(form.deposit || "0")).toFixed(2)
    : form.totalPrice
      ? parseFloat(form.totalPrice).toFixed(2)
      : "0";

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError("");

    try {
      const res = await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clientId: clientSuggestion?.id,
          clientPhone: form.clientPhone,
          clientName: form.clientName,
          projectName: form.projectName,
          date: form.date,
          customServiceText: form.customServiceText || undefined,
          totalPrice: parseFloat(form.totalPrice),
          deposit: parseFloat(form.deposit || "0"),
          workStatus: form.workStatus,
          serviceIds: form.serviceIds,
          notes: form.notes || undefined,
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "فشل حفظ السجل");
      }

      setShowForm(false);
      setForm({
        clientPhone: "", clientName: "", projectName: "",
        date: new Date().toISOString().split("T")[0],
        customServiceText: "", totalPrice: "", deposit: "",
        workStatus: "WAITING", serviceIds: [], notes: "",
      });
      setClientSuggestion(null);
      fetchProjects();
    } catch (err) {
      setError(err instanceof Error ? err.message : "حدث خطأ");
    }
    setSubmitting(false);
  };

  const toggleService = (id: string) => {
    setForm((f) => ({
      ...f,
      serviceIds: f.serviceIds.includes(id)
        ? f.serviceIds.filter((s) => s !== id)
        : [...f.serviceIds, id],
    }));
  };

  return (
    <AppShell isAdmin={true} userName="مستخدم" activePage="clients">
      <div className="page-header">
        <div>
          <h1 className="page-title">إدارة العملاء وسجلات الخدمات</h1>
          <p className="page-subtitle">{projects.length} سجل مسجل</p>
        </div>
        <button className="btn btn-primary" onClick={() => { setShowForm(true); setError(""); }}>+ سجل جديد</button>
      </div>

      {/* Filters */}
      <div className="filters-bar">
        <div className="search-wrapper">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><circle cx="11" cy="11" r="8" /><path d="m21 21-4.35-4.35" /></svg>
          <input
            className="search-input"
            style={{ paddingLeft: 40 }}
            placeholder="بحث بالاسم أو رقم الهاتف..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <select className="filter-select" value={workStatusFilter} onChange={(e) => setWorkStatusFilter(e.target.value)}>
          <option value="">جميع حالات العمل</option>
          <option value="WAITING">⏳ قيد الانتظار</option>
          <option value="IN_PROGRESS">🔄 قيد التنفيذ</option>
          <option value="COMPLETED">✅ مكتمل</option>
          <option value="PAUSED">⏸️ متوقف</option>
        </select>
        <select className="filter-select" value={paymentStatusFilter} onChange={(e) => setPaymentStatusFilter(e.target.value)}>
          <option value="">جميع حالات الدفع</option>
          <option value="FULL">✅ مدفوع بالكامل</option>
          <option value="PARTIAL">⚠️ دفع جزئي</option>
          <option value="UNpaid">❌ غير مدفوع</option>
        </select>
      </div>

      {/* Table */}
      {loading ? (
        <div className="empty-state"><div className="empty-state-icon">⏳</div><p>جاري التحميل...</p></div>
      ) : projects.length === 0 ? (
        <div className="empty-state">
          <div className="empty-state-icon">📋</div>
          <p>لا توجد سجلات بعد</p>
          <button className="btn btn-primary" style={{ marginTop: 16 }} onClick={() => setShowForm(true)}>أضف أول سجل</button>
        </div>
      ) : (
        <div className="table-container">
          <table className="table">
            <thead>
              <tr>
                <th>العميل</th>
                <th>المشروع</th>
                <th>التاريخ</th>
                <th>السعر</th>
                <th>ال العربون</th>
                <th>المتبقي</th>
                <th>حالة العمل</th>
                <th>حالة الدفع</th>
                <th>التصنيف</th>
                <th>المصمم</th>
              </tr>
            </thead>
            <tbody>
              {projects.map((p) => (
                <tr key={p.id}>
                  <td>
                    <div style={{ fontWeight: 600 }}>{p.client.name}</div>
                    <div style={{ fontSize: "0.75rem", color: "var(--muted)" }}>{p.client.phone}</div>
                  </td>
                  <td>
                    <div style={{ fontWeight: 600 }}>{p.projectName}</div>
                    {p.services.length > 0 && (
                      <div style={{ fontSize: "0.75rem", color: "var(--muted)" }}>
                        {p.services.map((s) => s.name).join("، ")}
                      </div>
                    )}
                    {p.customServiceText && (
                      <div style={{ fontSize: "0.75rem", color: "var(--muted)" }}>{p.customServiceText}</div>
                    )}
                  </td>
                  <td style={{ whiteSpace: "nowrap" }}>{new Date(p.date).toLocaleDateString("ar-SA")}</td>
                  <td style={{ fontWeight: 600 }}>{Number(p.totalPrice).toLocaleString("ar-SA")} ر.س</td>
                  <td>{Number(p.deposit).toLocaleString("ar-SA")} ر.س</td>
                  <td style={{ fontWeight: 600, color: p.remaining > 0 ? "var(--danger)" : "var(--success)" }}>
                    {Number(p.remaining).toLocaleString("ar-SA")} ر.س
                  </td>
                  <td><span className={`badge badge-${p.workStatus.toLowerCase().replace("_", "-")}`}>{workStatusMap[p.workStatus] || p.workStatus}</span></td>
                  <td><span className={`badge badge-${p.paymentStatus.toLowerCase()}`}>{paymentStatusMap[p.paymentStatus] || p.paymentStatus}</span></td>
                  <td><span className={`badge badge-${p.client.tier.toLowerCase()}`}>{tierMap[p.client.tier] || p.client.tier}</span></td>
                  <td style={{ color: "var(--muted)" }}>{p.designer.name}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Modal Form */}
      {showForm && (
        <div className="modal-overlay" onClick={(e) => { if (e.target === e.currentTarget) setShowForm(false); }}>
          <div className="modal">
            <div className="modal-header">
              <div className="modal-title">إضافة سجل خدمة جديد</div>
              <button className="modal-close" onClick={() => setShowForm(false)}>✕</button>
            </div>
            <form onSubmit={handleSubmit}>
              <div className="modal-body">
                {error && <div className="error" style={{ marginBottom: 16 }}>{error}</div>}

                <div className="form-grid">
                  {/* Client Phone */}
                  <div className="field">
                    <label className="field-label">رقم الهاتف *</label>
                    <input
                      required
                      placeholder="05XXXXXXXX"
                      value={form.clientPhone}
                      onChange={(e) => { setForm((f) => ({ ...f, clientPhone: e.target.value })); setClientSuggestion(null); }}
                      onBlur={(e) => checkPhone(e.target.value)}
                    />
                    {checkingPhone && <span style={{ fontSize: "0.75rem", color: "var(--muted)" }}>جاري البحث...</span>}
                    {clientSuggestion && (
                      <div style={{ padding: "8px 12px", background: "var(--brand-pale)", borderRadius: 8, fontSize: "0.8125rem", color: "var(--brand-dark)" }}>
                        ✓ عميل موجود: <strong>{clientSuggestion.name}</strong> — تصنيف: {tierMap[clientSuggestion.tier]}
                      </div>
                    )}
                  </div>

                  {/* Client Name */}
                  <div className="field">
                    <label className="field-label">اسم العميل *</label>
                    <input
                      required
                      placeholder="اسم العميل"
                      value={form.clientName}
                      onChange={(e) => setForm((f) => ({ ...f, clientName: e.target.value }))}
                      readOnly={!!clientSuggestion}
                      style={clientSuggestion ? { background: "var(--paper)" } : {}}
                    />
                  </div>

                  {/* Project Name */}
                  <div className="field full-width">
                    <label className="field-label">اسم المشروع *</label>
                    <input
                      required
                      placeholder="اسم المشروع"
                      value={form.projectName}
                      onChange={(e) => setForm((f) => ({ ...f, projectName: e.target.value }))}
                    />
                  </div>

                  {/* Date */}
                  <div className="field">
                    <label className="field-label">التاريخ *</label>
                    <input
                      required
                      type="date"
                      value={form.date}
                      onChange={(e) => setForm((f) => ({ ...f, date: e.target.value }))}
                    />
                  </div>

                  {/* Work Status */}
                  <div className="field">
                    <label className="field-label">حالة العمل</label>
                    <select value={form.workStatus} onChange={(e) => setForm((f) => ({ ...f, workStatus: e.target.value }))}>
                      <option value="WAITING">⏳ قيد الانتظار</option>
                      <option value="IN_PROGRESS">🔄 قيد التنفيذ</option>
                      <option value="COMPLETED">✅ مكتمل</option>
                      <option value="PAUSED">⏸️ متوقف</option>
                    </select>
                  </div>

                  {/* Total Price */}
                  <div className="field">
                    <label className="field-label">السعر الإجمالي (ر.س) *</label>
                    <input
                      required
                      type="number"
                      step="0.01"
                      min="0"
                      placeholder="0.00"
                      value={form.totalPrice}
                      onChange={(e) => setForm((f) => ({ ...f, totalPrice: e.target.value }))}
                    />
                  </div>

                  {/* Deposit */}
                  <div className="field">
                    <label className="field-label">العربون (ر.س)</label>
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      placeholder="0.00"
                      value={form.deposit}
                      onChange={(e) => setForm((f) => ({ ...f, deposit: e.target.value }))}
                    />
                  </div>

                  {/* Remaining (auto-calculated) */}
                  <div className="field">
                    <label className="field-label">المتبقي (محسوب تلقائيًا)</label>
                    <input
                      readOnly
                      value={`${parseFloat(remaining).toLocaleString("ar-SA")} ر.س`}
                      style={{ background: "var(--paper)", fontWeight: 700, color: parseFloat(remaining) > 0 ? "var(--danger)" : "var(--success)" }}
                    />
                  </div>

                  {/* Services */}
                  <div className="field full-width">
                    <label className="field-label">الخدمات</label>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 4 }}>
                      {services.map((s) => (
                        <button
                          key={s.id}
                          type="button"
                          className={`btn btn-sm ${form.serviceIds.includes(s.id) ? "btn-primary" : "btn-secondary"}`}
                          onClick={() => toggleService(s.id)}
                        >
                          {s.name}
                        </button>
                      ))}
                      {services.length === 0 && <span style={{ fontSize: "0.8125rem", color: "var(--muted)" }}>لا توجد خدمات مسجلة</span>}
                    </div>
                  </div>

                  {/* Custom Service */}
                  <div className="field full-width">
                    <label className="field-label">خدمة مخصصة</label>
                    <input
                      placeholder="اسم خدمة غير مسجلة"
                      value={form.customServiceText}
                      onChange={(e) => setForm((f) => ({ ...f, customServiceText: e.target.value }))}
                    />
                  </div>

                  {/* Notes */}
                  <div className="field full-width">
                    <label className="field-label">ملاحظات</label>
                    <textarea
                      rows={3}
                      placeholder="ملاحظات إضافية..."
                      value={form.notes}
                      onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
                      style={{ resize: "vertical" }}
                    />
                  </div>
                </div>
              </div>

              <div className="modal-footer">
                <button className="btn btn-primary" type="submit" disabled={submitting}>
                  {submitting ? "جارٍ الحفظ..." : "💾 حفظ السجل"}
                </button>
                <button className="btn btn-secondary" type="button" onClick={() => setShowForm(false)}>إلغاء</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </AppShell>
  );
}
