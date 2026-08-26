"use client";

import { useEffect, useState, useCallback, useMemo, useRef } from "react";

/* ───── Types ───── */
type Payment = { id: string; amount: number; date: string; note: string | null };
type ClientInfo = { id: string; name: string; phone: string; tier: string; projectCount: number; totalPaid: number; isRepeatClient: boolean };
type Project = { id: string; projectName: string; date: string; customServiceText: string | null; totalPrice: number; deposit: number; remaining: number; workStatus: string; paymentStatus: string; notes: string | null; createdAt: string; client: ClientInfo; designer: { id: string; name: string } | null; designerName: string | null; services: { id: string; name: string }[]; payments?: Payment[]; clientType: string };
type Service = { id: string; name: string; isCustom: boolean };
type User = { id: string; name: string; role: string };
type Subscription = { id: string; clientId: string; services: string; monthlyFee: number; startDate: string; billingDay: number; status: string; notes: string | null; client: ClientInfo; invoices: { id: string; month: number; year: number; amount: number; status: string; paidAmount: number; paidDate: string | null }[] };

/* ───── Constants ───── */
const REBOUND_SERVICES = [
  "تسويق إلكتروني", "إدارة سوشيال ميديا", "تصميم", "طباعة", "خدمة مخصصة",
];
const WS_LIST = [
  { v: "WAITING", l: "انتظار", c: "#f59e0b", bg: "rgba(245,158,11,0.12)" },
  { v: "IN_PROGRESS", l: "قيد التنفيذ", c: "#3b82f6", bg: "rgba(59,130,246,0.12)" },
  { v: "COMPLETED", l: "مكتمل", c: "#10b981", bg: "rgba(16,185,129,0.12)" },
  { v: "PAUSED", l: "متوقف", c: "#6b7280", bg: "rgba(107,114,128,0.1)" },
];
const WS_MAP = Object.fromEntries(WS_LIST.map(s => [s.v, s]));
const PS_MAP: Record<string, { l: string; c: string; bg: string }> = {
  FULL: { l: "مدفوع", c: "#10b981", bg: "rgba(16,185,129,0.12)" },
  PARTIAL: { l: "جزئي", c: "#f59e0b", bg: "rgba(245,158,11,0.12)" },
  UNPAID: { l: "غير مدفوع", c: "#ef4444", bg: "rgba(239,68,68,0.12)" },
};
const TIER: Record<string, { l: string; c: string; bg: string }> = {
  VIP: { l: "VIP", c: "#f59e0b", bg: "rgba(245,158,11,0.12)" },
  LOYAL: { l: "دائم", c: "#3b82f6", bg: "rgba(59,130,246,0.12)" },
  NORMAL: { l: "عادي", c: "#64748b", bg: "rgba(100,116,139,0.06)" },
  DELINQUENT: { l: "متأخر", c: "#ef4444", bg: "rgba(239,68,68,0.12)" },
};
const SUB_STATUS: Record<string, { l: string; c: string; bg: string }> = {
  ACTIVE: { l: "نشط", c: "#10b981", bg: "rgba(16,185,129,0.12)" },
  PAUSED: { l: "متوقف", c: "#f59e0b", bg: "rgba(245,158,11,0.12)" },
  CANCELLED: { l: "ملغى", c: "#ef4444", bg: "rgba(239,68,68,0.12)" },
};
const INV_STATUS: Record<string, { l: string; c: string; bg: string }> = {
  PAID: { l: "مدفوع", c: "#10b981", bg: "rgba(16,185,129,0.12)" },
  PARTIAL: { l: "جزئي", c: "#f59e0b", bg: "rgba(245,158,11,0.12)" },
  UNPAID: { l: "غير مدفوع", c: "#ef4444", bg: "rgba(239,68,68,0.12)" },
};

function fmt(n: number) { return n.toLocaleString("en-US"); }
function fmtDate(d: string) { return new Date(d).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }); }
function monthKey(d: string) { const dt = new Date(d); return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}`; }
function monthLabel(d: string) { return new Date(d).toLocaleDateString("en-US", { month: "long", year: "numeric" }); }
function invMonthLabel(m: number, y: number) { return new Date(y, m - 1).toLocaleDateString("en-US", { month: "long", year: "numeric" }); }

/* ═══ Inline Editable Text ═══ */
function InlineText({ value, onSave, style, placeholder }: { value: string; onSave: (v: string) => void; style?: React.CSSProperties; placeholder?: string }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  useEffect(() => { setDraft(value); }, [value]);
  const save = () => { setEditing(false); if (draft !== value) onSave(draft); };
  if (!editing) return (
    <div onClick={() => setEditing(true)} style={{ padding: "3px 6px", borderRadius: 4, cursor: "text", minHeight: 24, display: "flex", alignItems: "center", transition: "background 0.1s", ...style }}
      onMouseEnter={e => { e.currentTarget.style.background = "var(--surface-hover)"; }}
      onMouseLeave={e => { e.currentTarget.style.background = "transparent"; }}
      title="Click to edit">
      {value || <span style={{ color: "var(--muted)", fontSize: 10, fontStyle: "italic" }}>{placeholder || "—"}</span>}
    </div>
  );
  return <input autoFocus value={draft} onChange={e => setDraft(e.target.value)} onBlur={save}
    onKeyDown={e => { if (e.key === "Enter") save(); if (e.key === "Escape") { setDraft(value); setEditing(false); } }}
    style={{ padding: "3px 6px", borderRadius: 4, border: "1px solid #3b82f6", background: "var(--surface)", color: "var(--text)", fontSize: 12, outline: "none", width: "100%", ...style }} />;
}

/* ═══ Work Status Dropdown ═══ */
function WSToggle({ status, onToggle }: { status: string; onToggle: (next: string) => void }) {
  const [open, setOpen] = useState(false);
  const cur = WS_MAP[status] || WS_MAP.WAITING;
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => { const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); }; document.addEventListener("mousedown", h); return () => document.removeEventListener("mousedown", h); }, []);
  return (
    <div ref={ref} style={{ position: "relative" }}>
      <button onClick={() => setOpen(!open)} style={{ padding: "3px 8px", borderRadius: 5, border: "none", background: cur.bg, color: cur.c, fontSize: 11, fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap" }}>
        {cur.l} ▾
      </button>
      {open && (
        <div style={{ position: "absolute", top: "100%", left: 0, marginTop: 3, background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 8, padding: 3, zIndex: 100, minWidth: 120, boxShadow: "0 8px 24px rgba(0,0,0,0.15)" }}>
          {WS_LIST.map(s => (
            <button key={s.v} onClick={() => { onToggle(s.v); setOpen(false); }}
              style={{ display: "block", width: "100%", padding: "5px 8px", borderRadius: 5, border: "none", textAlign: "right", background: status === s.v ? s.bg : "transparent", color: s.c, fontSize: 11, fontWeight: 600, cursor: "pointer" }}
            >{s.l}</button>
          ))}
        </div>
      )}
    </div>
  );
}

/* ═══ Payment Button ═══ */
function PayButton({ remaining, projectId, onPay }: { remaining: number; projectId: string; onPay: (id: string, amount: number) => void }) {
  const [editing, setEditing] = useState(false);
  const [amount, setAmount] = useState("");
  if (remaining <= 0) return <span style={{ fontWeight: 700, color: "#10b981", fontSize: 12 }}>0 ✓</span>;
  if (!editing) return (
    <div style={{ display: "flex", alignItems: "center", gap: 3 }}>
      <span style={{ fontWeight: 700, color: "#ef4444", fontSize: 12 }}>{fmt(remaining)}</span>
      <button onClick={() => setEditing(true)} style={{ padding: "2px 6px", borderRadius: 4, border: "none", background: "rgba(16,185,129,0.12)", color: "#10b981", fontSize: 10, fontWeight: 600, cursor: "pointer" }} title="Pay partial">ادفع</button>
      <button onClick={() => onPay(projectId, remaining)} style={{ padding: "2px 6px", borderRadius: 4, border: "none", background: "rgba(59,130,246,0.1)", color: "#3b82f6", fontSize: 10, fontWeight: 600, cursor: "pointer" }} title="Pay all">الكل</button>
    </div>
  );
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 2 }}>
      <input autoFocus type="number" min="1" max={remaining} step="1" value={amount} onChange={e => setAmount(e.target.value)}
        placeholder={`≤ ${fmt(remaining)}`}
        onKeyDown={e => { if (e.key === "Enter" && amount) { onPay(projectId, Math.min(parseFloat(amount), remaining)); setEditing(false); setAmount(""); } if (e.key === "Escape") { setEditing(false); setAmount(""); } }}
        style={{ width: 60, padding: "2px 4px", borderRadius: 4, border: "1px solid #3b82f6", background: "var(--surface)", color: "var(--text)", fontSize: 11, outline: "none" }}
      />
      <button onClick={() => { if (amount) { onPay(projectId, Math.min(parseFloat(amount), remaining)); setEditing(false); setAmount(""); } }}
        style={{ padding: "2px 6px", borderRadius: 4, border: "none", background: "#3b82f6", color: "#fff", fontSize: 10, fontWeight: 600, cursor: "pointer" }}>✓</button>
    </div>
  );
}

/* ═══ Month Header ═══ */
function MonthHeader({ label, count, totalRevenue, totalCollected, totalRemaining, paidCount, collapsed, onToggle }: {
  label: string; count: number; totalRevenue: number; totalCollected: number; totalRemaining: number; paidCount: number;
  collapsed: boolean; onToggle: () => void;
}) {
  return (
    <div style={{ borderRadius: collapsed ? 8 : "8px 8px 0 0", overflow: "hidden", border: "1px solid var(--border)" }}>
      <div onClick={onToggle} style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 14px", background: "linear-gradient(135deg, rgba(59,130,246,0.08) 0%, rgba(59,130,246,0.02) 100%)", cursor: "pointer", borderBottom: collapsed ? "none" : "1px solid var(--border)" }}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} width={12} height={12} style={{ color: "#3b82f6", transform: collapsed ? "rotate(-90deg)" : "rotate(0)", transition: "transform 0.2s", flexShrink: 0 }}><path d="M6 9l6 6 6-6" /></svg>
        <span style={{ fontSize: 13, fontWeight: 800, color: "var(--text)" }}>{label}</span>
        <span style={{ fontSize: 9, fontWeight: 600, padding: "2px 7px", borderRadius: 10, background: "rgba(59,130,246,0.1)", color: "#3b82f6" }}>
          {count} سجل
        </span>
        {paidCount > 0 && (
          <span style={{ fontSize: 9, fontWeight: 600, padding: "2px 7px", borderRadius: 10, background: "rgba(16,185,129,0.1)", color: "#10b981" }}>
            {paidCount} مدفوع
          </span>
        )}
        <span style={{ flex: 1 }} />
        {collapsed && (
          <div style={{ display: "flex", alignItems: "center", gap: 16, marginRight: 8 }}>
            <div style={{ textAlign: "center" }}>
              <div style={{ fontSize: 8, color: "var(--muted)", letterSpacing: 0.5, marginBottom: 1 }}>الإجمالي</div>
              <div style={{ fontSize: 13, fontWeight: 800, color: "var(--text)", direction: "ltr" }}>{fmt(totalRevenue)} <span style={{ fontSize: 9, color: "var(--muted)" }}>EGP</span></div>
            </div>
            <div style={{ width: 1, height: 20, background: "var(--border)" }} />
            <div style={{ textAlign: "center" }}>
              <div style={{ fontSize: 8, color: "var(--muted)", letterSpacing: 0.5, marginBottom: 1 }}>محصّل</div>
              <div style={{ fontSize: 13, fontWeight: 800, color: "#10b981", direction: "ltr" }}>{fmt(totalCollected)} <span style={{ fontSize: 9, color: "var(--muted)" }}>EGP</span></div>
            </div>
            <div style={{ width: 1, height: 20, background: "var(--border)" }} />
            <div style={{ textAlign: "center" }}>
              <div style={{ fontSize: 8, color: "var(--muted)", letterSpacing: 0.5, marginBottom: 1 }}>المتبقي</div>
              <div style={{ fontSize: 13, fontWeight: 800, color: totalRemaining > 0 ? "#ef4444" : "#10b981", direction: "ltr" }}>{fmt(totalRemaining)} <span style={{ fontSize: 9, color: "var(--muted)" }}>EGP</span></div>
            </div>
          </div>
        )}
        {!collapsed && (
          <span style={{ fontSize: 11, color: "var(--muted)", direction: "ltr" }}>
            {fmt(totalCollected)} / {fmt(totalRevenue)} EGP محصّل
          </span>
        )}
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════
   ONE-TIME TAB
   ═══════════════════════════════════════════════════ */
function OneTimeTab() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [wsFilter, setWsFilter] = useState("");
  const [psFilter, setPsFilter] = useState("");
  const [collapsedMonths, setCollapsedMonths] = useState<Set<string>>(new Set());
  const [form, setForm] = useState({ clientPhone: "", clientName: "", projectName: "", date: new Date().toISOString().split("T")[0], customServiceText: "", totalPrice: "", deposit: "", workStatus: "WAITING", designerName: "", serviceIds: [] as string[], notes: "" });
  const [clientSuggestion, setClientSuggestion] = useState<ClientInfo | null>(null);

  const fetchProjects = useCallback(async () => {
    setLoading(true);
    const p = new URLSearchParams();
    if (search) p.set("search", search);
    if (wsFilter) p.set("workStatus", wsFilter);
    if (psFilter) p.set("paymentStatus", psFilter);
    p.set("clientType", "ONE_TIME");
    try { const r = await fetch(`/api/rebound/projects?${p}`); if (r.ok) setProjects(await r.json()); } catch {}
    setLoading(false);
  }, [search, wsFilter, psFilter]);

  const fetchUsers = async () => { try { const r = await fetch("/api/users"); if (r.ok) setUsers(await r.json()); } catch {} };
  useEffect(() => { fetchProjects(); }, [fetchProjects]);
  useEffect(() => { fetchUsers(); }, []);

  const checkPhone = async (phone: string) => {
    if (!phone || phone.length < 5) { setClientSuggestion(null); return; }
    try { const r = await fetch("/api/clients"); if (r.ok) { const c: ClientInfo[] = await r.json(); const m = c.find(x => x.phone === phone); if (m) { setClientSuggestion(m); setForm(f => ({ ...f, clientName: m.name })); } else setClientSuggestion(null); } } catch { setClientSuggestion(null); }
  };

  const grouped = useMemo(() => {
    const g = new Map<string, { label: string; items: Project[] }>();
    for (const p of projects) { const k = monthKey(p.date); if (!g.has(k)) g.set(k, { label: monthLabel(p.date), items: [] }); g.get(k)!.items.push(p); }
    return Array.from(g.entries()).sort((a, b) => b[0].localeCompare(a[0]));
  }, [projects]);

  const stats = useMemo(() => ({
    total: projects.length,
    inProgress: projects.filter(p => p.workStatus === "IN_PROGRESS").length,
    completed: projects.filter(p => p.workStatus === "COMPLETED").length,
    unpaid: projects.filter(p => p.paymentStatus === "UNPAID").length,
    clients: new Set(projects.map(p => p.client.id)).size,
    revenue: projects.reduce((s, p) => s + Number(p.totalPrice), 0),
    totalCollected: projects.reduce((s, p) => s + Number(p.deposit), 0),
    totalRemaining: projects.reduce((s, p) => s + Number(p.remaining), 0),
  }), [projects]);

  const patchProject = async (id: string, data: Record<string, unknown>) => {
    try { const r = await fetch(`/api/projects/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) }); if (r.ok) fetchProjects(); } catch {}
  };

  const handlePayPartial = async (id: string, amount: number) => {
    try {
      const r = await fetch("/api/client-payments", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ projectRecordId: id, amount, note: "Table quick pay" }) });
      if (r.ok) fetchProjects();
    } catch {}
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault(); setSubmitting(true); setError("");
    try {
      const r = await fetch("/api/rebound/projects", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientId: clientSuggestion?.id, clientPhone: form.clientPhone, clientName: form.clientName, projectName: form.projectName, date: form.date, customServiceText: form.customServiceText || undefined, totalPrice: parseFloat(form.totalPrice), deposit: parseFloat(form.deposit || "0"), workStatus: form.workStatus, designerName: form.designerName || undefined, serviceIds: form.serviceIds, notes: form.notes || undefined, clientType: "ONE_TIME" }) });
      if (!r.ok) { const d = await r.json(); throw new Error(d.error || "Failed"); }
      setShowForm(false); resetForm(); fetchProjects();
    } catch (err) { setError(err instanceof Error ? err.message : "Error"); }
    setSubmitting(false);
  };

  const handleDelete = async (id: string) => { try { await fetch(`/api/projects/${id}`, { method: "DELETE" }); setDeleteConfirm(null); fetchProjects(); } catch {} };

  const resetForm = () => { setForm({ clientPhone: "", clientName: "", projectName: "", date: new Date().toISOString().split("T")[0], customServiceText: "", totalPrice: "", deposit: "", workStatus: "WAITING", designerName: "", serviceIds: [], notes: "" }); setClientSuggestion(null); setError(""); };
  const toggleMonth = (key: string) => { setCollapsedMonths(prev => { const n = new Set(prev); n.has(key) ? n.delete(key) : n.add(key); return n; }); };

  return (
    <div>
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 16 }}>
        <div>
          <h2 style={{ fontSize: 18, fontWeight: 700, color: "var(--text)", margin: 0 }}>مشاريع لمرة واحدة</h2>
          <p style={{ fontSize: 12, color: "var(--muted)", margin: "3px 0 0" }}>One-time service projects</p>
        </div>
        <button onClick={() => { setShowForm(true); resetForm(); }} style={{ display: "flex", alignItems: "center", gap: 5, padding: "9px 16px", borderRadius: 8, background: "#3b82f6", color: "#fff", border: "none", fontSize: 12, fontWeight: 600, cursor: "pointer", boxShadow: "0 2px 6px rgba(59,130,246,0.3)" }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
          سجل جديد +
        </button>
      </div>

      {/* Stats */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(6, 1fr)", gap: 10, marginBottom: 16 }}>
        {[{ l: "الإجمالي", v: stats.total, c: "var(--text)" }, { l: "قيد التنفيذ", v: stats.inProgress, c: "#3b82f6" }, { l: "مكتمل", v: stats.completed, c: "#10b981" }, { l: "غير مدفوع", v: stats.unpaid, c: "#ef4444" }, { l: "العملاء", v: stats.clients, c: "#8b5cf6" }, { l: "الإيرادات", v: `${fmt(stats.revenue)} EGP`, c: "#3b82f6" }].map(s => (
          <div key={s.l} style={{ padding: "10px 12px", borderRadius: 8, background: "var(--surface)", border: "1px solid var(--border)", textAlign: "center" }}>
            <div style={{ fontSize: 16, fontWeight: 800, color: s.c }}>{s.v}</div>
            <div style={{ fontSize: 10, color: "var(--muted)", marginTop: 1 }}>{s.l}</div>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div style={{ display: "flex", gap: 8, marginBottom: 12, alignItems: "center" }}>
        <div style={{ flex: 1, minWidth: 180, position: "relative" }}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", width: 14, height: 14, color: "var(--muted)" }}><circle cx="11" cy="11" r="8" /><path d="m21 21-4.35-4.35" /></svg>
          <input placeholder="بحث..." value={search} onChange={e => setSearch(e.target.value)} style={{ width: "100%", padding: "7px 10px 7px 30px", borderRadius: 6, border: "1px solid var(--border)", background: "var(--surface)", color: "var(--text)", fontSize: 12, outline: "none" }} />
        </div>
        <select value={wsFilter} onChange={e => setWsFilter(e.target.value)} style={{ padding: "7px 10px", borderRadius: 6, border: "1px solid var(--border)", background: "var(--surface)", color: "var(--text)", fontSize: 11, outline: "none" }}>
          <option value="">كل الحالات</option>{WS_LIST.map(s => <option key={s.v} value={s.v}>{s.l}</option>)}
        </select>
        <select value={psFilter} onChange={e => setPsFilter(e.target.value)} style={{ padding: "7px 10px", borderRadius: 6, border: "1px solid var(--border)", background: "var(--surface)", color: "var(--text)", fontSize: 11, outline: "none" }}>
          <option value="">كل الدفعات</option><option value="FULL">✅ مدفوع</option><option value="PARTIAL">⚠️ جزئي</option><option value="UNPAID">❌ غير مدفوع</option>
        </select>
      </div>

      {/* Table */}
      {loading ? <div style={{ textAlign: "center", padding: 40, color: "var(--muted)" }}>جاري التحميل...</div>
        : projects.length === 0 ? <div style={{ textAlign: "center", padding: 40 }}><div style={{ fontSize: 36, marginBottom: 8 }}>📋</div><p style={{ color: "var(--muted)", fontSize: 13 }}>لا توجد سجلات بعد.</p><button onClick={() => { setShowForm(true); resetForm(); }} style={{ marginTop: 10, padding: "8px 16px", borderRadius: 8, background: "#3b82f6", color: "#fff", border: "none", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>إضافة أول سجل</button></div>
        : grouped.map(([key, group]) => {
          const collapsed = collapsedMonths.has(key);
          const gRevenue = group.items.reduce((s, p) => s + Number(p.totalPrice), 0);
          const gCollected = group.items.reduce((s, p) => s + Number(p.deposit), 0);
          const gRemaining = group.items.reduce((s, p) => s + Number(p.remaining), 0);
          const gPaid = group.items.filter(p => p.paymentStatus === "FULL").length;
          return (
            <div key={key} style={{ marginBottom: 16 }}>
              <MonthHeader label={group.label} count={group.items.length} totalRevenue={gRevenue} totalCollected={gCollected} totalRemaining={gRemaining} paidCount={gPaid} collapsed={collapsed} onToggle={() => toggleMonth(key)} />
              {!collapsed && (
                <div style={{ overflowX: "auto", border: "1px solid var(--border)", borderTop: "none", borderRadius: "0 0 6px 6px" }}>
                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12, minWidth: 1000 }}>
                    <thead>
                      <tr style={{ background: "linear-gradient(135deg, rgba(59,130,246,0.06) 0%, transparent 100%)" }}>
                        {[{ l: "التاريخ", w: 85 }, { l: "الهاتف", w: 100 }, { l: "العميل", w: 100 }, { l: "المشروع", w: 120 }, { l: "الخدمات", w: 90 }, { l: "السعر", w: 70 }, { l: "المدفوع", w: 65 }, { l: "المتبقي", w: 120 }, { l: "المصمم", w: 90 }, { l: "حالة العمل", w: 90 }, { l: "الدفع", w: 60 }, { l: "ملاحظات", w: 100 }, { l: "", w: 60 }].map((c, i) => (
                          <th key={i} style={{ padding: "7px 8px", width: c.w, textAlign: "right", borderBottom: "2px solid var(--border)", fontSize: 10, fontWeight: 700, color: "var(--text)" }}>
                            {c.l}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {group.items.map(p => {
                        const ws = WS_MAP[p.workStatus] || WS_MAP.WAITING;
                        const ps = PS_MAP[p.paymentStatus] || PS_MAP.UNPAID;
                        const tier = TIER[p.client.tier] || TIER.NORMAL;
                        const isDone = p.workStatus === "COMPLETED" && p.paymentStatus === "FULL";
                        return (
                          <tr key={p.id} style={{
                            background: isDone ? "rgba(16,185,129,0.04)" : "var(--surface)",
                            borderBottom: "1px solid var(--border)",
                            borderLeft: isDone ? "3px solid #10b981" : "3px solid transparent",
                            opacity: isDone ? 0.85 : 1,
                          }}>
                            <td style={{ padding: "5px 8px", fontSize: 11, color: "var(--muted)", whiteSpace: "nowrap" }}>{fmtDate(p.date)}</td>
                            <td style={{ padding: "5px 8px", fontSize: 11, color: "var(--text-secondary)", direction: "ltr" }}>{p.client.phone}</td>
                            <td style={{ padding: "5px 8px" }}>
                              <div style={{ fontWeight: 600, fontSize: 12, display: "flex", alignItems: "center", gap: 4 }}>
                                {p.client.name}
                                {p.client.isRepeatClient && <span style={{ fontSize: 8, padding: "1px 4px", borderRadius: 3, background: "rgba(139,92,246,0.1)", color: "#8b5cf6", fontWeight: 700 }}>×{p.client.projectCount}</span>}
                              </div>
                              <span style={{ fontSize: 9, padding: "1px 5px", borderRadius: 3, background: tier.bg, color: tier.c, fontWeight: 700 }}>{tier.l}</span>
                            </td>
                            <td style={{ padding: "5px 8px" }}><InlineText value={p.projectName} onSave={v => patchProject(p.id, { projectName: v })} style={{ fontWeight: 600, fontSize: 12 }} /></td>
                            <td style={{ padding: "5px 8px" }}>
                              <div style={{ display: "flex", flexWrap: "wrap", gap: 2 }}>
                                {p.services.map(s => <span key={s.id} style={{ padding: "1px 5px", borderRadius: 3, fontSize: 9, fontWeight: 600, background: "rgba(59,130,246,0.08)", color: "#3b82f6" }}>{s.name}</span>)}
                                {p.services.length === 0 && <span style={{ fontSize: 9, color: "var(--muted)" }}>{p.customServiceText || "—"}</span>}
                              </div>
                            </td>
                            <td style={{ padding: "5px 8px", fontWeight: 700, direction: "ltr", textAlign: "left", fontSize: 12 }}>{fmt(Number(p.totalPrice))}</td>
                            <td style={{ padding: "5px 8px", direction: "ltr", textAlign: "left", color: "var(--text-secondary)", fontSize: 12 }}>{fmt(Number(p.deposit))}</td>
                            <td style={{ padding: "5px 8px", direction: "ltr", textAlign: "left" }}>
                              <PayButton remaining={Number(p.remaining)} projectId={p.id} onPay={handlePayPartial} />
                            </td>
                            <td style={{ padding: "5px 8px" }}>
                              <InlineText value={p.designerName || ""} onSave={v => patchProject(p.id, { designerName: v || null })} placeholder="المصمم" style={{ fontSize: 11 }} />
                            </td>
                            <td style={{ padding: "5px 8px" }}><WSToggle status={p.workStatus} onToggle={next => patchProject(p.id, { workStatus: next })} /></td>
                            <td style={{ padding: "5px 8px" }}>
                              <span style={{ padding: "2px 6px", borderRadius: 4, background: ps.bg, color: ps.c, fontSize: 10, fontWeight: 600 }}>{ps.l}</span>
                            </td>
                            <td style={{ padding: "5px 8px" }}><InlineText value={p.notes || ""} onSave={v => patchProject(p.id, { notes: v || null })} placeholder="ملاحظة..." style={{ fontSize: 10, color: "var(--muted)" }} /></td>
                            <td style={{ padding: "5px 4px", textAlign: "center" }}>
                              <div style={{ display: "flex", gap: 3, justifyContent: "center" }}>
                                {deleteConfirm === p.id ? (
                                  <div style={{ display: "flex", gap: 2, justifyContent: "center" }}>
                                    <button onClick={() => handleDelete(p.id)} style={{ padding: "3px 6px", borderRadius: 4, border: "none", background: "#ef4444", color: "#fff", fontSize: 9, fontWeight: 600, cursor: "pointer" }}>تأكيد</button>
                                    <button onClick={() => setDeleteConfirm(null)} style={{ padding: "3px 6px", borderRadius: 4, border: "1px solid var(--border)", background: "transparent", color: "var(--muted)", fontSize: 9, cursor: "pointer" }}>إلغاء</button>
                                  </div>
                                ) : (
                                  <button onClick={() => setDeleteConfirm(p.id)} style={{ padding: "3px 6px", borderRadius: 4, border: "1px solid rgba(239,68,68,0.2)", background: "rgba(239,68,68,0.05)", color: "#ef4444", fontSize: 11, cursor: "pointer" }} title="حذف">🗑</button>
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
        })}

      {/* Sticky Totals Row */}
      {projects.length > 0 && (
        <div style={{ position: "sticky", bottom: 0, background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 8, padding: "8px 16px", display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12, marginTop: 16, boxShadow: "0 -2px 8px rgba(0,0,0,0.08)" }}>
          <div style={{ textAlign: "center" }}><div style={{ fontSize: 9, color: "var(--muted)", fontWeight: 600 }}>الإجمالي</div><div style={{ fontSize: 16, fontWeight: 800, color: "var(--text)" }}>{fmt(stats.revenue)} EGP</div></div>
          <div style={{ textAlign: "center" }}><div style={{ fontSize: 9, color: "var(--muted)", fontWeight: 600 }}>محصّل</div><div style={{ fontSize: 16, fontWeight: 800, color: "#10b981" }}>{fmt(stats.totalCollected)} EGP</div></div>
          <div style={{ textAlign: "center" }}><div style={{ fontSize: 9, color: "var(--muted)", fontWeight: 600 }}>المتبقي</div><div style={{ fontSize: 16, fontWeight: 800, color: stats.totalRemaining > 0 ? "#ef4444" : "#10b981" }}>{fmt(stats.totalRemaining)} EGP</div></div>
        </div>
      )}

      {/* Create Form Modal */}
      {showForm && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000 }} onClick={e => { if (e.target === e.currentTarget) { setShowForm(false); resetForm(); } }}>
          <div style={{ background: "var(--surface)", borderRadius: 14, maxWidth: 520, width: "95%", border: "1px solid var(--border)" }}>
            <div style={{ padding: "16px 20px", borderBottom: "1px solid var(--border)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <h3 style={{ fontSize: 15, fontWeight: 700, color: "var(--text)", margin: 0 }}>سجل جديد — لمرة واحدة</h3>
              <button onClick={() => { setShowForm(false); resetForm(); }} style={{ width: 28, height: 28, borderRadius: 6, border: "none", background: "var(--surface-hover)", color: "var(--muted)", fontSize: 14, cursor: "pointer" }}>✕</button>
            </div>
            <form onSubmit={handleSubmit} style={{ padding: "16px 20px" }}>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                <div>
                  <label style={{ fontSize: 10, fontWeight: 600, color: "var(--muted)" }}>رقم الهاتف *</label>
                  <input required value={form.clientPhone} onChange={e => { setForm(f => ({ ...f, clientPhone: e.target.value })); checkPhone(e.target.value); }} dir="ltr" style={{ width: "100%", padding: "7px 10px", borderRadius: 6, border: "1px solid var(--border)", background: "var(--surface)", color: "var(--text)", fontSize: 12, outline: "none", marginTop: 3 }} />
                  {clientSuggestion && <div style={{ fontSize: 10, color: "#10b981", marginTop: 3 }}>✓ العميل موجود: {clientSuggestion.name}</div>}
                </div>
                <div>
                  <label style={{ fontSize: 10, fontWeight: 600, color: "var(--muted)" }}>اسم العميل *</label>
                  <input required value={form.clientName} onChange={e => setForm(f => ({ ...f, clientName: e.target.value }))} style={{ width: "100%", padding: "7px 10px", borderRadius: 6, border: "1px solid var(--border)", background: "var(--surface)", color: "var(--text)", fontSize: 12, outline: "none", marginTop: 3 }} />
                </div>
                <div style={{ gridColumn: "1 / -1" }}>
                  <label style={{ fontSize: 10, fontWeight: 600, color: "var(--muted)" }}>اسم المشروع *</label>
                  <input required value={form.projectName} onChange={e => setForm(f => ({ ...f, projectName: e.target.value }))} style={{ width: "100%", padding: "7px 10px", borderRadius: 6, border: "1px solid var(--border)", background: "var(--surface)", color: "var(--text)", fontSize: 12, outline: "none", marginTop: 3 }} />
                </div>
                <div>
                  <label style={{ fontSize: 10, fontWeight: 600, color: "var(--muted)" }}>التاريخ</label>
                  <input type="date" value={form.date} onChange={e => setForm(f => ({ ...f, date: e.target.value }))} style={{ width: "100%", padding: "7px 10px", borderRadius: 6, border: "1px solid var(--border)", background: "var(--surface)", color: "var(--text)", fontSize: 12, outline: "none", marginTop: 3 }} />
                </div>
                <div>
                  <label style={{ fontSize: 10, fontWeight: 600, color: "var(--muted)" }}>الخدمات</label>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginTop: 4 }}>
                    {REBOUND_SERVICES.map(s => (
                      <button key={s} type="button" onClick={() => setForm(f => ({ ...f, customServiceText: f.customServiceText === s ? "" : s }))}
                        style={{ padding: "4px 8px", borderRadius: 5, border: form.customServiceText === s ? "1px solid #3b82f6" : "1px solid var(--border)", background: form.customServiceText === s ? "rgba(59,130,246,0.12)" : "transparent", color: form.customServiceText === s ? "#3b82f6" : "var(--muted)", fontSize: 10, fontWeight: 600, cursor: "pointer" }}>
                        {s}
                      </button>
                    ))}
                  </div>
                  <input value={form.customServiceText} onChange={e => setForm(f => ({ ...f, customServiceText: e.target.value }))} placeholder="أو اكتب خدمة مخصصة" style={{ width: "100%", padding: "6px 8px", borderRadius: 5, border: "1px solid var(--border)", background: "var(--surface)", color: "var(--text)", fontSize: 11, outline: "none", marginTop: 4 }} />
                </div>
                <div>
                  <label style={{ fontSize: 10, fontWeight: 600, color: "var(--muted)" }}>السعر الكلي (EGP) *</label>
                  <input required type="number" min="0" value={form.totalPrice} onChange={e => setForm(f => ({ ...f, totalPrice: e.target.value }))} dir="ltr" style={{ width: "100%", padding: "7px 10px", borderRadius: 6, border: "1px solid var(--border)", background: "var(--surface)", color: "var(--text)", fontSize: 12, outline: "none", marginTop: 3 }} />
                </div>
                <div>
                  <label style={{ fontSize: 10, fontWeight: 600, color: "var(--muted)" }}>العربون (EGP)</label>
                  <input type="number" min="0" value={form.deposit} onChange={e => setForm(f => ({ ...f, deposit: e.target.value }))} dir="ltr" style={{ width: "100%", padding: "7px 10px", borderRadius: 6, border: "1px solid var(--border)", background: "var(--surface)", color: "var(--text)", fontSize: 12, outline: "none", marginTop: 3 }} />
                </div>
                <div>
                  <label style={{ fontSize: 10, fontWeight: 600, color: "var(--muted)" }}>المصمم</label>
                  <input value={form.designerName} onChange={e => setForm(f => ({ ...f, designerName: e.target.value }))} list="rebound-designer-list" style={{ width: "100%", padding: "7px 10px", borderRadius: 6, border: "1px solid var(--border)", background: "var(--surface)", color: "var(--text)", fontSize: 12, outline: "none", marginTop: 3 }} />
                  <datalist id="rebound-designer-list">{users.map(u => <option key={u.id} value={u.name} />)}</datalist>
                </div>
                <div style={{ gridColumn: "1 / -1" }}>
                  <label style={{ fontSize: 10, fontWeight: 600, color: "var(--muted)" }}>ملاحظات</label>
                  <textarea rows={2} value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} style={{ width: "100%", padding: "7px 10px", borderRadius: 6, border: "1px solid var(--border)", background: "var(--surface)", color: "var(--text)", fontSize: 12, outline: "none", marginTop: 3, resize: "vertical" }} />
                </div>
              </div>
              {error && <div style={{ color: "#ef4444", fontSize: 12, marginTop: 8 }}>{error}</div>}
              <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 16 }}>
                <button type="button" onClick={() => { setShowForm(false); resetForm(); }} style={{ padding: "8px 16px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--surface)", color: "var(--text)", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>إلغاء</button>
                <button type="submit" disabled={submitting} style={{ padding: "8px 18px", borderRadius: 8, border: "none", background: "#3b82f6", color: "#fff", fontSize: 12, fontWeight: 600, cursor: "pointer", opacity: submitting ? 0.6 : 1 }}>{submitting ? "جاري الحفظ..." : "حفظ"}</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════════
   RECURRING (SUBSCRIPTIONS) TAB
   ═══════════════════════════════════════════════════ */
function RecurringTab() {
  const [subscriptions, setSubscriptions] = useState<Subscription[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [payModal, setPayModal] = useState<{ sub: Subscription; invoice: Subscription["invoices"][0] } | null>(null);
  const [payAmount, setPayAmount] = useState("");
  const [form, setForm] = useState({ clientPhone: "", clientName: "", services: "", monthlyFee: "", startDate: new Date().toISOString().split("T")[0], billingDay: "1", notes: "" });

  const fetchSubscriptions = useCallback(async () => {
    setLoading(true);
    const p = new URLSearchParams();
    if (statusFilter) p.set("status", statusFilter);
    try { const r = await fetch(`/api/rebound/subscriptions?${p}`); if (r.ok) setSubscriptions(await r.json()); } catch {}
    setLoading(false);
  }, [statusFilter]);

  useEffect(() => { fetchSubscriptions(); }, [fetchSubscriptions]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault(); setSubmitting(true); setError("");
    try {
      const r = await fetch("/api/rebound/subscriptions", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientPhone: form.clientPhone, clientName: form.clientName, services: form.services.split(",").map(s => s.trim()).filter(Boolean), monthlyFee: parseFloat(form.monthlyFee), startDate: form.startDate, billingDay: parseInt(form.billingDay), notes: form.notes }) });
      if (!r.ok) { const d = await r.json(); throw new Error(d.error || "Failed"); }
      setShowForm(false); setForm({ clientPhone: "", clientName: "", services: "", monthlyFee: "", startDate: new Date().toISOString().split("T")[0], billingDay: "1", notes: "" }); fetchSubscriptions();
    } catch (err) { setError(err instanceof Error ? err.message : "Error"); }
    setSubmitting(false);
  };

  const handlePay = async () => {
    if (!payModal || !payAmount) return;
    try {
      const r = await fetch("/api/rebound/subscription-invoices", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ invoiceId: payModal.invoice.id, amount: parseFloat(payAmount) }) });
      if (r.ok) { setPayModal(null); setPayAmount(""); fetchSubscriptions(); }
    } catch {}
  };

  const totalMRR = subscriptions.filter(s => s.status === "ACTIVE").reduce((sum, s) => sum + s.monthlyFee, 0);

  return (
    <div>
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 16 }}>
        <div>
          <h2 style={{ fontSize: 18, fontWeight: 700, color: "var(--text)", margin: 0 }}>اشتراكات شهرية</h2>
          <p style={{ fontSize: 12, color: "var(--muted)", margin: "3px 0 0" }}>Monthly recurring subscriptions</p>
        </div>
        <button onClick={() => setShowForm(true)} style={{ display: "flex", alignItems: "center", gap: 5, padding: "9px 16px", borderRadius: 8, background: "#3b82f6", color: "#fff", border: "none", fontSize: 12, fontWeight: 600, cursor: "pointer", boxShadow: "0 2px 6px rgba(59,130,246,0.3)" }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
          اشتراك جديد +
        </button>
      </div>

      {/* Stats */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12, marginBottom: 16 }}>
        {[
          { l: "MRR الشهري", v: `${fmt(totalMRR)} EGP`, c: "#10b981" },
          { l: "اشتراكات نشطة", v: subscriptions.filter(s => s.status === "ACTIVE").length, c: "#3b82f6" },
          { l: "متوقفة", v: subscriptions.filter(s => s.status === "PAUSED").length, c: "#f59e0b" },
          { l: "ملغاة", v: subscriptions.filter(s => s.status === "CANCELLED").length, c: "#ef4444" },
        ].map(s => (
          <div key={s.l} style={{ padding: "12px 16px", borderRadius: 10, background: "var(--surface)", border: "1px solid var(--border)", textAlign: "center" }}>
            <div style={{ fontSize: 20, fontWeight: 800, color: s.c }}>{s.v}</div>
            <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 2 }}>{s.l}</div>
          </div>
        ))}
      </div>

      {/* Filter */}
      <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
        <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} style={{ padding: "7px 10px", borderRadius: 6, border: "1px solid var(--border)", background: "var(--surface)", color: "var(--text)", fontSize: 11, outline: "none" }}>
          <option value="">كل الحالات</option>
          <option value="ACTIVE">نشط</option>
          <option value="PAUSED">متوقف</option>
          <option value="CANCELLED">ملغى</option>
        </select>
      </div>

      {/* Subscriptions Table */}
      {loading ? <div style={{ textAlign: "center", padding: 40, color: "var(--muted)" }}>جاري التحميل...</div>
        : subscriptions.length === 0 ? <div style={{ textAlign: "center", padding: 40 }}><div style={{ fontSize: 36, marginBottom: 8 }}>🔄</div><p style={{ color: "var(--muted)", fontSize: 13 }}>لا توجد اشتراكات بعد.</p></div>
        : (
          <div style={{ overflowX: "auto", border: "1px solid var(--border)", borderRadius: 8 }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
              <thead>
                <tr style={{ background: "linear-gradient(135deg, rgba(59,130,246,0.06) 0%, transparent 100%)" }}>
                  {["العميل", "الهاتف", "الباقة", "القيمة الشهرية", "تاريخ البدء", "يوم الفاتورة", "الحالة", "فاتورة الشهر", "الإجراءات"].map((h, i) => (
                    <th key={i} style={{ padding: "8px 10px", textAlign: "right", borderBottom: "2px solid var(--border)", fontSize: 10, fontWeight: 700, color: "var(--text)" }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {subscriptions.map(sub => {
                  const st = SUB_STATUS[sub.status] || SUB_STATUS.ACTIVE;
                  const currentInvoice = sub.invoices[0]; // Most recent
                  const invSt = currentInvoice ? INV_STATUS[currentInvoice.status] || INV_STATUS.UNPAID : null;
                  const isOverdue = currentInvoice && currentInvoice.status === "UNPAID" && new Date().getDate() > sub.billingDay;
                  return (
                    <tr key={sub.id} style={{ borderBottom: "1px solid var(--border)", background: isOverdue ? "rgba(239,68,68,0.04)" : "var(--surface)" }}>
                      <td style={{ padding: "6px 10px", fontWeight: 600 }}>{sub.client.name}</td>
                      <td style={{ padding: "6px 10px", direction: "ltr", color: "var(--text-secondary)" }}>{sub.client.phone}</td>
                      <td style={{ padding: "6px 10px" }}>
                        <div style={{ display: "flex", flexWrap: "wrap", gap: 2 }}>
                          {(() => { try { return JSON.parse(sub.services); } catch { return [sub.services]; } })().map((s: string, i: number) => (
                            <span key={i} style={{ padding: "1px 5px", borderRadius: 3, fontSize: 9, fontWeight: 600, background: "rgba(59,130,246,0.08)", color: "#3b82f6" }}>{s}</span>
                          ))}
                        </div>
                      </td>
                      <td style={{ padding: "6px 10px", fontWeight: 700, color: "#3b82f6", direction: "ltr" }}>{fmt(sub.monthlyFee)} EGP</td>
                      <td style={{ padding: "6px 10px", color: "var(--muted)", fontSize: 11 }}>{fmtDate(sub.startDate)}</td>
                      <td style={{ padding: "6px 10px", textAlign: "center" }}>
                        <span style={{ padding: "2px 8px", borderRadius: 10, background: "var(--surface-hover)", fontSize: 11, fontWeight: 700 }}>{sub.billingDay}</span>
                      </td>
                      <td style={{ padding: "6px 10px" }}><span style={{ padding: "2px 8px", borderRadius: 4, background: st.bg, color: st.c, fontSize: 10, fontWeight: 600 }}>{st.l}</span></td>
                      <td style={{ padding: "6px 10px" }}>
                        {currentInvoice && (
                          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                            <span style={{ padding: "2px 6px", borderRadius: 4, background: isOverdue ? "rgba(239,68,68,0.15)" : (invSt?.bg || ""), color: isOverdue ? "#ef4444" : (invSt?.c || ""), fontSize: 10, fontWeight: 600 }}>
                              {invMonthLabel(currentInvoice.month, currentInvoice.year)} — {isOverdue ? "متأخر ⚠️" : invSt?.l}
                            </span>
                            {currentInvoice.status !== "PAID" && (
                              <button onClick={() => { setPayModal({ sub, invoice: currentInvoice }); setPayAmount(String(currentInvoice.amount - currentInvoice.paidAmount)); }}
                                style={{ padding: "2px 8px", borderRadius: 4, border: "none", background: "rgba(16,185,129,0.12)", color: "#10b981", fontSize: 10, fontWeight: 600, cursor: "pointer" }}>
                                ادفع
                              </button>
                            )}
                          </div>
                        )}
                      </td>
                      <td style={{ padding: "6px 10px" }}>
                        <span style={{ padding: "2px 6px", borderRadius: 4, background: "var(--surface-hover)", fontSize: 10, color: "var(--muted)" }}>
                          {sub.invoices.filter(i => i.status === "PAID").length}/{sub.invoices.length}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

      {/* Pay Invoice Modal */}
      {payModal && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000 }} onClick={e => { if (e.target === e.currentTarget) { setPayModal(null); setPayAmount(""); } }}>
          <div style={{ background: "var(--surface)", borderRadius: 14, maxWidth: 400, width: "95%", border: "1px solid var(--border)" }}>
            <div style={{ padding: "16px 20px", borderBottom: "1px solid var(--border)" }}>
              <h3 style={{ fontSize: 15, fontWeight: 700, color: "var(--text)", margin: 0 }}>دفع فاتورة</h3>
              <p style={{ fontSize: 11, color: "var(--muted)", margin: "4px 0 0" }}>{payModal.sub.client.name} — {invMonthLabel(payModal.invoice.month, payModal.invoice.year)}</p>
            </div>
            <div style={{ padding: "16px 20px" }}>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8, marginBottom: 16 }}>
                <div style={{ textAlign: "center", padding: 8, borderRadius: 6, background: "var(--surface-hover)" }}>
                  <div style={{ fontSize: 16, fontWeight: 800, color: "var(--text)" }}>{fmt(payModal.invoice.amount)}</div>
                  <div style={{ fontSize: 9, color: "var(--muted)" }}>المبلغ</div>
                </div>
                <div style={{ textAlign: "center", padding: 8, borderRadius: 6, background: "var(--surface-hover)" }}>
                  <div style={{ fontSize: 16, fontWeight: 800, color: "#10b981" }}>{fmt(payModal.invoice.paidAmount)}</div>
                  <div style={{ fontSize: 9, color: "var(--muted)" }}>محصّل</div>
                </div>
                <div style={{ textAlign: "center", padding: 8, borderRadius: 6, background: "var(--surface-hover)" }}>
                  <div style={{ fontSize: 16, fontWeight: 800, color: "#ef4444" }}>{fmt(payModal.invoice.amount - payModal.invoice.paidAmount)}</div>
                  <div style={{ fontSize: 9, color: "var(--muted)" }}>المتبقي</div>
                </div>
              </div>
              <label style={{ fontSize: 10, fontWeight: 600, color: "var(--muted)" }}>المبلغ المدفوع (EGP)</label>
              <input type="number" min="1" max={payModal.invoice.amount - payModal.invoice.paidAmount} value={payAmount} onChange={e => setPayAmount(e.target.value)} dir="ltr"
                style={{ width: "100%", padding: "8px 10px", borderRadius: 6, border: "1px solid var(--border)", background: "var(--surface)", color: "var(--text)", fontSize: 14, fontWeight: 700, outline: "none", marginTop: 4 }} />
              <div style={{ display: "flex", gap: 8, marginTop: 16, justifyContent: "flex-end" }}>
                <button onClick={() => { setPayModal(null); setPayAmount(""); }} style={{ padding: "8px 16px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--surface)", color: "var(--text)", fontSize: 12, cursor: "pointer" }}>إلغاء</button>
                <button onClick={handlePay} style={{ padding: "8px 18px", borderRadius: 8, border: "none", background: "#10b981", color: "#fff", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>تأكيد الدفع</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Create Subscription Modal */}
      {showForm && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000 }} onClick={e => { if (e.target === e.currentTarget) setShowForm(false); }}>
          <div style={{ background: "var(--surface)", borderRadius: 14, maxWidth: 520, width: "95%", border: "1px solid var(--border)" }}>
            <div style={{ padding: "16px 20px", borderBottom: "1px solid var(--border)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <h3 style={{ fontSize: 15, fontWeight: 700, color: "var(--text)", margin: 0 }}>اشتراك شهري جديد</h3>
              <button onClick={() => setShowForm(false)} style={{ width: 28, height: 28, borderRadius: 6, border: "none", background: "var(--surface-hover)", color: "var(--muted)", fontSize: 14, cursor: "pointer" }}>✕</button>
            </div>
            <form onSubmit={handleCreate} style={{ padding: "16px 20px" }}>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                <div>
                  <label style={{ fontSize: 10, fontWeight: 600, color: "var(--muted)" }}>رقم الهاتف *</label>
                  <input required value={form.clientPhone} onChange={e => setForm(f => ({ ...f, clientPhone: e.target.value }))} dir="ltr" style={{ width: "100%", padding: "7px 10px", borderRadius: 6, border: "1px solid var(--border)", background: "var(--surface)", color: "var(--text)", fontSize: 12, outline: "none", marginTop: 3 }} />
                </div>
                <div>
                  <label style={{ fontSize: 10, fontWeight: 600, color: "var(--muted)" }}>اسم العميل *</label>
                  <input required value={form.clientName} onChange={e => setForm(f => ({ ...f, clientName: e.target.value }))} style={{ width: "100%", padding: "7px 10px", borderRadius: 6, border: "1px solid var(--border)", background: "var(--surface)", color: "var(--text)", fontSize: 12, outline: "none", marginTop: 3 }} />
                </div>
                <div style={{ gridColumn: "1 / -1" }}>
                  <label style={{ fontSize: 10, fontWeight: 600, color: "var(--muted)" }}>الخدمات (مفصولة بفاصلة)</label>
                  <input value={form.services} onChange={e => setForm(f => ({ ...f, services: e.target.value }))} placeholder="تسويق رقمي, إدارة سوشيال" style={{ width: "100%", padding: "7px 10px", borderRadius: 6, border: "1px solid var(--border)", background: "var(--surface)", color: "var(--text)", fontSize: 12, outline: "none", marginTop: 3 }} />
                </div>
                <div>
                  <label style={{ fontSize: 10, fontWeight: 600, color: "var(--muted)" }}>القيمة الشهرية (EGP) *</label>
                  <input required type="number" min="1" value={form.monthlyFee} onChange={e => setForm(f => ({ ...f, monthlyFee: e.target.value }))} dir="ltr" style={{ width: "100%", padding: "7px 10px", borderRadius: 6, border: "1px solid var(--border)", background: "var(--surface)", color: "var(--text)", fontSize: 12, outline: "none", marginTop: 3 }} />
                </div>
                <div>
                  <label style={{ fontSize: 10, fontWeight: 600, color: "var(--muted)" }}>تاريخ البدء</label>
                  <input type="date" value={form.startDate} onChange={e => setForm(f => ({ ...f, startDate: e.target.value }))} style={{ width: "100%", padding: "7px 10px", borderRadius: 6, border: "1px solid var(--border)", background: "var(--surface)", color: "var(--text)", fontSize: 12, outline: "none", marginTop: 3 }} />
                </div>
                <div>
                  <label style={{ fontSize: 10, fontWeight: 600, color: "var(--muted)" }}>يوم الفاتورة</label>
                  <input type="number" min="1" max="28" value={form.billingDay} onChange={e => setForm(f => ({ ...f, billingDay: e.target.value }))} style={{ width: "100%", padding: "7px 10px", borderRadius: 6, border: "1px solid var(--border)", background: "var(--surface)", color: "var(--text)", fontSize: 12, outline: "none", marginTop: 3 }} />
                </div>
                <div style={{ gridColumn: "1 / -1" }}>
                  <label style={{ fontSize: 10, fontWeight: 600, color: "var(--muted)" }}>ملاحظات</label>
                  <textarea rows={2} value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} style={{ width: "100%", padding: "7px 10px", borderRadius: 6, border: "1px solid var(--border)", background: "var(--surface)", color: "var(--text)", fontSize: 12, outline: "none", marginTop: 3, resize: "vertical" }} />
                </div>
              </div>
              {error && <div style={{ color: "#ef4444", fontSize: 12, marginTop: 8 }}>{error}</div>}
              <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 16 }}>
                <button type="button" onClick={() => setShowForm(false)} style={{ padding: "8px 16px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--surface)", color: "var(--text)", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>إلغاء</button>
                <button type="submit" disabled={submitting} style={{ padding: "8px 18px", borderRadius: 8, border: "none", background: "#3b82f6", color: "#fff", fontSize: 12, fontWeight: 600, cursor: "pointer", opacity: submitting ? 0.6 : 1 }}>{submitting ? "جاري الحفظ..." : "حفظ"}</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════════
   MAIN PAGE — TWO TABS
   ═══════════════════════════════════════════════════ */
export default function ReboundClientsPage() {
  const [tab, setTab] = useState<"one_time" | "recurring">("one_time");

  return (
    <div>
      {/* Page Header */}
      <div style={{ marginBottom: 20 }}>
        <h1 style={{ fontSize: 22, fontWeight: 800, color: "var(--text)", margin: 0 }}>إدارة العملاء</h1>
        <p style={{ fontSize: 12, color: "var(--muted)", margin: "4px 0 0" }}>REBOUND Client Management</p>
      </div>

      {/* Tab Buttons */}
      <div style={{ display: "flex", gap: 0, marginBottom: 20, borderBottom: "2px solid var(--border)" }}>
        {[
          { key: "one_time" as const, label: "مشاريع لمرة واحدة", labelEn: "One-Time Projects", icon: "📋" },
          { key: "recurring" as const, label: "اشتراكات شهرية", labelEn: "Subscriptions", icon: "🔄" },
        ].map(t => (
          <button key={t.key} onClick={() => setTab(t.key)} style={{
            padding: "10px 20px", borderRadius: "8px 8px 0 0", border: "none", cursor: "pointer",
            background: tab === t.key ? "rgba(59,130,246,0.12)" : "transparent",
            color: tab === t.key ? "#3b82f6" : "var(--muted)",
            fontWeight: tab === t.key ? 700 : 500, fontSize: 13,
            borderBottom: tab === t.key ? "2px solid #3b82f6" : "2px solid transparent",
            marginBottom: -2, transition: "all 0.15s",
          }}>
            {t.icon} {t.label} <span style={{ fontSize: 10, opacity: 0.6, marginInlineStart: 4 }}>{t.labelEn}</span>
          </button>
        ))}
      </div>

      {/* Tab Content */}
      {tab === "one_time" && <OneTimeTab />}
      {tab === "recurring" && <RecurringTab />}
    </div>
  );
}
