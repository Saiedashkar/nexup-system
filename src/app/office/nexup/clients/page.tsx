"use client";

import { useEffect, useState, useCallback, useMemo, useRef } from "react";

/* ───── Types ───── */
type ClientInfo = {
  id: string;
  name: string;
  phone: string;
  tier: string;
  projectCount: number;
  totalPaid: number;
  isRepeatClient: boolean;
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
  createdAt: string;
  client: ClientInfo;
  designer: { id: string; name: string };
  services: { id: string; name: string }[];
};

type Service = { id: string; name: string; isCustom: boolean };
type User = { id: string; name: string; role: string };

/* ───── Constants ───── */
const WORK_STATUS_LIST = [
  { value: "WAITING", label: "Waiting", color: "#f59e0b", bg: "rgba(245,158,11,0.12)" },
  { value: "IN_PROGRESS", label: "In Progress", color: "#3b82f6", bg: "rgba(59,130,246,0.12)" },
  { value: "COMPLETED", label: "Done", color: "#10b981", bg: "rgba(16,185,129,0.12)" },
  { value: "PAUSED", label: "Paused", color: "#6b7280", bg: "rgba(107,114,128,0.1)" },
];
const WORK_STATUS_MAP = Object.fromEntries(WORK_STATUS_LIST.map(s => [s.value, s]));

const PAYMENT_STATUS_MAP: Record<string, { label: string; color: string; bg: string }> = {
  FULL: { label: "Paid", color: "#10b981", bg: "rgba(16,185,129,0.12)" },
  PARTIAL: { label: "Partial", color: "#f59e0b", bg: "rgba(245,158,11,0.12)" },
  UNPAID: { label: "Unpaid", color: "#ef4444", bg: "rgba(239,68,68,0.12)" },
};

const TIER_MAP: Record<string, { label: string; color: string; bg: string }> = {
  VIP: { label: "VIP", color: "#f59e0b", bg: "rgba(245,158,11,0.1)" },
  LOYAL: { label: "Loyal", color: "#3b82f6", bg: "rgba(59,130,246,0.1)" },
  NORMAL: { label: "Normal", color: "#64748b", bg: "rgba(100,116,139,0.06)" },
  DELINQUENT: { label: "At Risk", color: "#ef4444", bg: "rgba(239,68,68,0.1)" },
};

/* ───── Helpers ───── */
function fmt(n: number) {
  return n.toLocaleString("en-US");
}
function fmtDate(d: string) {
  return new Date(d).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}
function monthKey(d: string) {
  const dt = new Date(d);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}`;
}
function monthLabel(d: string) {
  return new Date(d).toLocaleDateString("en-US", { month: "long", year: "numeric" });
}

/* ═══════════════════════════════════════════════════════
   Inline Editable Cell — click to edit, blur to save
   ═══════════════════════════════════════════════════════ */
function InlineText({
  value, onSave, style, placeholder,
}: {
  value: string; onSave: (v: string) => void;
  style?: React.CSSProperties; placeholder?: string;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => { setDraft(value); }, [value]);

  const save = () => {
    setEditing(false);
    if (draft !== value) onSave(draft);
  };

  if (!editing) {
    return (
      <div
        ref={ref}
        onClick={() => setEditing(true)}
        style={{
          padding: "4px 8px", borderRadius: 6, cursor: "text",
          minHeight: 28, display: "flex", alignItems: "center",
          transition: "background 0.15s",
          ...style,
        }}
        onMouseEnter={e => { e.currentTarget.style.background = "var(--surface-hover)"; }}
        onMouseLeave={e => { e.currentTarget.style.background = "transparent"; }}
        title="Click to edit"
      >
        {value || <span style={{ color: "var(--muted)", fontSize: 11, fontStyle: "italic" }}>{placeholder || "—"}</span>}
      </div>
    );
  }

  return (
    <input
      autoFocus
      value={draft}
      onChange={e => setDraft(e.target.value)}
      onBlur={save}
      onKeyDown={e => { if (e.key === "Enter") save(); if (e.key === "Escape") { setDraft(value); setEditing(false); } }}
      style={{
        padding: "4px 8px", borderRadius: 6, border: "1px solid #0d9488",
        background: "var(--surface)", color: "var(--text)", fontSize: 13,
        outline: "none", width: "100%", ...style,
      }}
    />
  );
}

/* ═══════════════════════════════════════════════════════
   Work Status Toggle — cycle through statuses
   ═══════════════════════════════════════════════════════ */
function WorkStatusToggle({ status, onToggle }: { status: string; onToggle: (next: string) => void }) {
  const [open, setOpen] = useState(false);
  const current = WORK_STATUS_MAP[status] || WORK_STATUS_MAP.WAITING;
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  return (
    <div ref={ref} style={{ position: "relative" }}>
      <button
        onClick={() => setOpen(!open)}
        style={{
          padding: "4px 10px", borderRadius: 6, border: "none",
          background: current.bg, color: current.color,
          fontSize: 11, fontWeight: 600, cursor: "pointer",
          transition: "all 0.15s", whiteSpace: "nowrap",
        }}
      >
        {current.label} ▾
      </button>
      {open && (
        <div style={{
          position: "absolute", top: "100%", left: 0, marginTop: 4,
          background: "var(--surface)", border: "1px solid var(--border)",
          borderRadius: 8, padding: 4, zIndex: 100, minWidth: 130,
          boxShadow: "0 8px 24px rgba(0,0,0,0.15)",
        }}>
          {WORK_STATUS_LIST.map(s => (
            <button
              key={s.value}
              onClick={() => { onToggle(s.value); setOpen(false); }}
              style={{
                display: "block", width: "100%", padding: "6px 10px",
                borderRadius: 6, border: "none", textAlign: "left",
                background: status === s.value ? s.bg : "transparent",
                color: s.color, fontSize: 12, fontWeight: 600,
                cursor: "pointer", marginBottom: 1,
              }}
              onMouseEnter={e => { if (status !== s.value) e.currentTarget.style.background = "var(--surface-hover)"; }}
              onMouseLeave={e => { if (status !== s.value) e.currentTarget.style.background = "transparent"; }}
            >
              {s.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════
   Month Group Header — collapsible
   ═══════════════════════════════════════════════════════ */
function MonthHeader({ label, count, revenue, collapsed, onToggle }: {
  label: string; count: number; revenue: number;
  collapsed: boolean; onToggle: () => void;
}) {
  return (
    <div
      onClick={onToggle}
      style={{
        display: "flex", alignItems: "center", gap: 10,
        padding: "8px 14px", borderRadius: collapsed ? 8 : "8px 8px 0 0",
        background: "var(--surface-hover)", cursor: "pointer",
        border: "1px solid var(--border)", borderBottom: collapsed ? "1px solid var(--border)" : "none",
        transition: "all 0.15s",
      }}
    >
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} width={12} height={12}
        style={{ color: "var(--muted)", transform: collapsed ? "rotate(-90deg)" : "rotate(0)", transition: "transform 0.2s", flexShrink: 0 }}>
        <path d="M6 9l6 6 6-6" />
      </svg>
      <span style={{ fontSize: 13, fontWeight: 700, color: "var(--text)" }}>{label}</span>
      <span style={{ fontSize: 11, color: "var(--muted)", marginLeft: "auto" }}>
        {count} records · {fmt(revenue)} SAR
      </span>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════
   MAIN PAGE
   ═══════════════════════════════════════════════════════ */
export default function NexupClientsPage() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [services, setServices] = useState<Service[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);

  // Filters
  const [search, setSearch] = useState("");
  const [workStatusFilter, setWorkStatusFilter] = useState("");
  const [paymentStatusFilter, setPaymentStatusFilter] = useState("");

  // Collapsed months
  const [collapsedMonths, setCollapsedMonths] = useState<Set<string>>(new Set());

  // Form
  const [form, setForm] = useState({
    clientPhone: "", clientName: "", projectName: "",
    date: new Date().toISOString().split("T")[0],
    customServiceText: "", totalPrice: "", deposit: "",
    workStatus: "WAITING", designerId: "", serviceIds: [] as string[],
    notes: "",
  });
  const [clientSuggestion, setClientSuggestion] = useState<ClientInfo | null>(null);

  /* ───── Fetch ───── */
  const fetchProjects = useCallback(async () => {
    setLoading(true);
    const p = new URLSearchParams();
    if (search) p.set("search", search);
    if (workStatusFilter) p.set("workStatus", workStatusFilter);
    if (paymentStatusFilter) p.set("paymentStatus", paymentStatusFilter);
    try { const r = await fetch(`/api/nexup/projects?${p}`); if (r.ok) setProjects(await r.json()); } catch {}
    setLoading(false);
  }, [search, workStatusFilter, paymentStatusFilter]);

  const fetchMeta = async () => {
    try { const [s, u] = await Promise.all([fetch("/api/services"), fetch("/api/users")]);
      if (s.ok) setServices(await s.json());
      if (u.ok) setUsers(await u.json());
    } catch {}
  };

  useEffect(() => { fetchProjects(); }, [fetchProjects]);
  useEffect(() => { fetchMeta(); }, []);

  /* ───── Phone Check ───── */
  const checkPhone = async (phone: string) => {
    if (!phone || phone.length < 5) { setClientSuggestion(null); return; }
    try {
      const r = await fetch("/api/clients");
      if (r.ok) {
        const c: ClientInfo[] = await r.json();
        const m = c.find(x => x.phone === phone);
        if (m) { setClientSuggestion(m); setForm(f => ({ ...f, clientName: m.name })); }
        else setClientSuggestion(null);
      }
    } catch { setClientSuggestion(null); }
  };

  /* ───── Computed ───── */
  const grouped = useMemo(() => {
    const g = new Map<string, { label: string; items: Project[] }>();
    for (const p of projects) {
      const k = monthKey(p.date);
      if (!g.has(k)) g.set(k, { label: monthLabel(p.date), items: [] });
      g.get(k)!.items.push(p);
    }
    return Array.from(g.entries()).sort((a, b) => b[0].localeCompare(a[0]));
  }, [projects]);

  const stats = useMemo(() => ({
    total: projects.length,
    inProgress: projects.filter(p => p.workStatus === "IN_PROGRESS").length,
    completed: projects.filter(p => p.workStatus === "COMPLETED").length,
    unpaid: projects.filter(p => p.paymentStatus === "UNPAID").length,
    clients: new Set(projects.map(p => p.client.id)).size,
    revenue: projects.reduce((s, p) => s + Number(p.totalPrice), 0),
  }), [projects]);

  const remaining = form.totalPrice && form.deposit
    ? parseFloat(form.totalPrice) - parseFloat(form.deposit || "0")
    : form.totalPrice ? parseFloat(form.totalPrice) : 0;

  /* ───── Inline Update ───── */
  const patchProject = async (id: string, data: Record<string, unknown>) => {
    try {
      const r = await fetch(`/api/projects/${id}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (r.ok) fetchProjects();
    } catch {}
  };

  /* ───── Actions ───── */
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault(); setSubmitting(true); setError("");
    try {
      const r = await fetch("/api/projects", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clientId: clientSuggestion?.id, clientPhone: form.clientPhone,
          clientName: form.clientName, projectName: form.projectName,
          date: form.date, customServiceText: form.customServiceText || undefined,
          totalPrice: parseFloat(form.totalPrice), deposit: parseFloat(form.deposit || "0"),
          workStatus: form.workStatus, designerId: form.designerId || undefined,
          serviceIds: form.serviceIds, notes: form.notes || undefined,
        }),
      });
      if (!r.ok) { const d = await r.json(); throw new Error(d.error || "Failed"); }
      setShowForm(false); resetForm(); fetchProjects();
    } catch (err) { setError(err instanceof Error ? err.message : "Error"); }
    setSubmitting(false);
  };

  const handleDelete = async (id: string) => {
    try { await fetch(`/api/projects/${id}`, { method: "DELETE" }); setDeleteConfirm(null); fetchProjects(); } catch {}
  };

  const resetForm = () => {
    setForm({ clientPhone: "", clientName: "", projectName: "", date: new Date().toISOString().split("T")[0], customServiceText: "", totalPrice: "", deposit: "", workStatus: "WAITING", designerId: "", serviceIds: [], notes: "" });
    setClientSuggestion(null); setError("");
  };

  const toggleMonth = (key: string) => {
    setCollapsedMonths(prev => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  };

  /* ═══════════════════ RENDER ═══════════════════ */
  return (
    <div>
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 20 }}>
        <div>
          <h1 style={{ fontSize: 24, fontWeight: 800, color: "var(--text)", margin: 0 }}>Clients</h1>
          <p style={{ fontSize: 13, color: "var(--muted)", margin: "4px 0 0" }}>Manage client records & service projects</p>
        </div>
        <button onClick={() => { setShowForm(true); resetForm(); }} style={{
          display: "flex", alignItems: "center", gap: 6, padding: "10px 18px",
          borderRadius: 10, background: "#0d9488", color: "#fff", border: "none",
          fontSize: 13, fontWeight: 600, cursor: "pointer", boxShadow: "0 2px 8px rgba(13,148,136,0.3)",
        }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
          New Record +
        </button>
      </div>

      {/* Stats */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(6, 1fr)", gap: 12, marginBottom: 20 }}>
        {[
          { l: "Total", v: stats.total, c: "var(--text)" },
          { l: "In Progress", v: stats.inProgress, c: "#3b82f6" },
          { l: "Completed", v: stats.completed, c: "#10b981" },
          { l: "Unpaid", v: stats.unpaid, c: "#ef4444" },
          { l: "Clients", v: stats.clients, c: "#8b5cf6" },
          { l: "Revenue", v: `${fmt(stats.revenue)} SAR`, c: "#0d9488" },
        ].map(s => (
          <div key={s.l} style={{ padding: "12px 14px", borderRadius: 10, background: "var(--surface)", border: "1px solid var(--border)", textAlign: "center" }}>
            <div style={{ fontSize: 18, fontWeight: 800, color: s.c }}>{s.v}</div>
            <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 2 }}>{s.l}</div>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div style={{ display: "flex", gap: 10, marginBottom: 16, alignItems: "center" }}>
        <div style={{ flex: 1, minWidth: 200, position: "relative" }}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", width: 15, height: 15, color: "var(--muted)" }}>
            <circle cx="11" cy="11" r="8" /><path d="m21 21-4.35-4.35" />
          </svg>
          <input placeholder="Search by name, phone, or project..." value={search} onChange={e => setSearch(e.target.value)}
            style={{ width: "100%", padding: "8px 12px 8px 34px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--surface)", color: "var(--text)", fontSize: 13, outline: "none" }} />
        </div>
        <select value={workStatusFilter} onChange={e => setWorkStatusFilter(e.target.value)}
          style={{ padding: "8px 12px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--surface)", color: "var(--text)", fontSize: 12, outline: "none" }}>
          <option value="">All Work Status</option>
          <option value="WAITING">⏳ Waiting</option>
          <option value="IN_PROGRESS">🔄 In Progress</option>
          <option value="COMPLETED">✅ Done</option>
          <option value="PAUSED">⏸ Paused</option>
        </select>
        <select value={paymentStatusFilter} onChange={e => setPaymentStatusFilter(e.target.value)}
          style={{ padding: "8px 12px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--surface)", color: "var(--text)", fontSize: 12, outline: "none" }}>
          <option value="">All Payment Status</option>
          <option value="FULL">✅ Paid</option>
          <option value="PARTIAL">⚠️ Partial</option>
          <option value="UNPAID">❌ Unpaid</option>
        </select>
      </div>

      {/* Table */}
      {loading ? (
        <div style={{ textAlign: "center", padding: 50, color: "var(--muted)" }}>Loading...</div>
      ) : projects.length === 0 ? (
        <div style={{ textAlign: "center", padding: 50 }}>
          <div style={{ fontSize: 40, marginBottom: 12 }}>📋</div>
          <p style={{ color: "var(--muted)", fontSize: 14 }}>No records yet. Add your first client.</p>
          <button onClick={() => { setShowForm(true); resetForm(); }} style={{ marginTop: 14, padding: "10px 20px", borderRadius: 10, background: "#0d9488", color: "#fff", border: "none", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>Add First Record</button>
        </div>
      ) : (
        grouped.map(([key, group]) => {
          const collapsed = collapsedMonths.has(key);
          const monthRev = group.items.reduce((s, p) => s + Number(p.deposit), 0);
          return (
            <div key={key} style={{ marginBottom: 20 }}>
              <MonthHeader label={group.label} count={group.items.length} revenue={monthRev} collapsed={collapsed} onToggle={() => toggleMonth(key)} />
              {!collapsed && (
                <div style={{ overflowX: "auto", border: "1px solid var(--border)", borderTop: "none", borderRadius: "0 0 8px 8px" }}>
                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13, minWidth: 1100 }}>
                    <thead>
                      <tr style={{ background: "var(--surface-hover)" }}>
                        {[
                          { l: "Date", w: 95 },
                          { l: "Phone", w: 110 },
                          { l: "Client Name", w: 120 },
                          { l: "Project", w: 140 },
                          { l: "Services", w: 110 },
                          { l: "Price (SAR)", w: 90 },
                          { l: "Deposit", w: 80 },
                          { l: "Remaining", w: 85 },
                          { l: "Designer", w: 90 },
                          { l: "Work Status", w: 110 },
                          { l: "Payment", w: 75 },
                          { l: "Notes", w: 120 },
                          { l: "", w: 50 },
                        ].map((c, i) => (
                          <th key={i} style={{
                            padding: "8px 10px", fontSize: 10, fontWeight: 600,
                            color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.05em",
                            whiteSpace: "nowrap", width: c.w, textAlign: "left",
                            borderBottom: "1px solid var(--border)",
                          }}>{c.l}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {group.items.map(p => {
                        const ws = WORK_STATUS_MAP[p.workStatus] || WORK_STATUS_MAP.WAITING;
                        const ps = PAYMENT_STATUS_MAP[p.paymentStatus] || PAYMENT_STATUS_MAP.UNPAID;
                        const tier = TIER_MAP[p.client.tier] || TIER_MAP.NORMAL;
                        const isDone = p.workStatus === "COMPLETED" && p.paymentStatus === "FULL";
                        const hasRemaining = Number(p.remaining) > 0;

                        return (
                          <tr key={p.id} style={{
                            background: isDone ? "rgba(16,185,129,0.05)" : "var(--surface)",
                            borderBottom: "1px solid var(--border)",
                            borderLeft: isDone ? "3px solid #10b981" : "3px solid transparent",
                          }}
                            onMouseEnter={e => { if (!isDone) e.currentTarget.style.background = "var(--surface-hover)"; }}
                            onMouseLeave={e => { if (!isDone) e.currentTarget.style.background = isDone ? "rgba(16,185,129,0.05)" : "var(--surface)"; }}
                          >
                            {/* Date */}
                            <td style={{ padding: "6px 10px" }}>
                              <span style={{ fontSize: 12, color: "var(--muted)", whiteSpace: "nowrap" }}>
                                {fmtDate(p.date)}
                              </span>
                            </td>

                            {/* Phone */}
                            <td style={{ padding: "6px 10px" }}>
                              <span style={{ fontSize: 12, color: "var(--text-secondary)", direction: "ltr", display: "block" }}>
                                {p.client.phone}
                              </span>
                            </td>

                            {/* Client Name */}
                            <td style={{ padding: "6px 10px" }}>
                              <div style={{ fontWeight: 600, fontSize: 13, color: "var(--text)" }}>{p.client.name}</div>
                              {p.client.isRepeatClient && (
                                <span style={{ fontSize: 9, color: "#8b5cf6", fontWeight: 600 }}>🔄 Repeat</span>
                              )}
                            </td>

                            {/* Project */}
                            <td style={{ padding: "6px 10px" }}>
                              <InlineText
                                value={p.projectName}
                                onSave={(v) => patchProject(p.id, { projectName: v })}
                                style={{ fontWeight: 600, fontSize: 13 }}
                              />
                            </td>

                            {/* Services */}
                            <td style={{ padding: "6px 10px" }}>
                              <div style={{ display: "flex", flexWrap: "wrap", gap: 3 }}>
                                {p.services.map(s => (
                                  <span key={s.id} style={{
                                    padding: "1px 6px", borderRadius: 4, fontSize: 10, fontWeight: 600,
                                    background: "rgba(13,148,136,0.08)", color: "#0d9488",
                                  }}>{s.name}</span>
                                ))}
                                {p.services.length === 0 && p.customServiceText && (
                                  <span style={{ fontSize: 10, color: "var(--muted)" }}>{p.customServiceText}</span>
                                )}
                                {p.services.length === 0 && !p.customServiceText && (
                                  <span style={{ fontSize: 10, color: "var(--muted)" }}>—</span>
                                )}
                              </div>
                            </td>

                            {/* Total Price */}
                            <td style={{ padding: "6px 10px", fontWeight: 700, direction: "ltr", textAlign: "left" }}>
                              {fmt(Number(p.totalPrice))}
                            </td>

                            {/* Deposit */}
                            <td style={{ padding: "6px 10px", direction: "ltr", textAlign: "left", color: "var(--text-secondary)" }}>
                              {fmt(Number(p.deposit))}
                            </td>

                            {/* Remaining — with Pay button */}
                            <td style={{ padding: "6px 10px", direction: "ltr", textAlign: "left" }}>
                              {hasRemaining ? (
                                <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                                  <span style={{ fontWeight: 700, color: "#ef4444", fontSize: 12 }}>{fmt(Number(p.remaining))}</span>
                                  <button
                                    onClick={() => patchProject(p.id, { deposit: Number(p.totalPrice), workStatus: "COMPLETED" })}
                                    style={{
                                      padding: "2px 6px", borderRadius: 4, border: "none",
                                      background: "rgba(16,185,129,0.12)", color: "#10b981",
                                      fontSize: 10, fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap",
                                    }}
                                    title="Mark as fully paid"
                                  >Pay</button>
                                </div>
                              ) : (
                                <span style={{ fontWeight: 700, color: "#10b981", fontSize: 12 }}>0 ✓</span>
                              )}
                            </td>

                            {/* Designer */}
                            <td style={{ padding: "6px 10px" }}>
                              <select
                                value={p.designer?.id || ""}
                                onChange={e => patchProject(p.id, { designerId: e.target.value || null })}
                                style={{
                                  padding: "3px 6px", borderRadius: 4, border: "1px solid var(--border)",
                                  background: "var(--surface)", color: "var(--text)", fontSize: 11,
                                  cursor: "pointer", outline: "none", maxWidth: 90,
                                }}
                              >
                                <option value="">—</option>
                                {users.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
                              </select>
                            </td>

                            {/* Work Status — Toggle Dropdown */}
                            <td style={{ padding: "6px 10px" }}>
                              <WorkStatusToggle
                                status={p.workStatus}
                                onToggle={(next) => patchProject(p.id, { workStatus: next })}
                              />
                            </td>

                            {/* Payment Status */}
                            <td style={{ padding: "6px 10px" }}>
                              <span style={{
                                padding: "3px 8px", borderRadius: 6,
                                background: ps.bg, color: ps.color,
                                fontSize: 11, fontWeight: 600,
                              }}>{ps.label}</span>
                            </td>

                            {/* Notes — Inline Editable */}
                            <td style={{ padding: "6px 10px" }}>
                              <InlineText
                                value={p.notes || ""}
                                onSave={(v) => patchProject(p.id, { notes: v || null })}
                                placeholder="Add note..."
                                style={{ fontSize: 11, color: "var(--muted)" }}
                              />
                            </td>

                            {/* Delete */}
                            <td style={{ padding: "6px 6px", textAlign: "center" }}>
                              <button
                                onClick={() => setDeleteConfirm(p.id)}
                                style={{
                                  padding: "4px 8px", borderRadius: 5, border: "none",
                                  background: "rgba(239,68,68,0.08)", color: "#ef4444",
                                  fontSize: 12, cursor: "pointer",
                                }}
                                title="Delete"
                              >🗑</button>
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
        })
      )}

      {/* Delete Confirm Modal */}
      {deleteConfirm && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000 }}
          onClick={e => { if (e.target === e.currentTarget) setDeleteConfirm(null); }}>
          <div style={{ background: "var(--surface)", borderRadius: 14, padding: 24, maxWidth: 380, width: "90%", border: "1px solid var(--border)" }}>
            <h3 style={{ fontSize: 16, fontWeight: 700, color: "var(--text)", marginBottom: 10 }}>Delete Record?</h3>
            <p style={{ fontSize: 13, color: "var(--muted)", margin: 0 }}>This action cannot be undone.</p>
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 18 }}>
              <button onClick={() => setDeleteConfirm(null)} style={{ padding: "8px 16px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--surface)", color: "var(--text)", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>Cancel</button>
              <button onClick={() => handleDelete(deleteConfirm)} style={{ padding: "8px 16px", borderRadius: 8, border: "none", background: "#ef4444", color: "#fff", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>Delete</button>
            </div>
          </div>
        </div>
      )}

      {/* Create Form Modal */}
      {showForm && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000 }}
          onClick={e => { if (e.target === e.currentTarget) { setShowForm(false); resetForm(); } }}>
          <div style={{ background: "var(--surface)", borderRadius: 14, maxWidth: 640, width: "95%", maxHeight: "90vh", overflow: "auto", border: "1px solid var(--border)" }}>
            <div style={{ padding: "18px 24px", borderBottom: "1px solid var(--border)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <h3 style={{ fontSize: 16, fontWeight: 700, color: "var(--text)", margin: 0 }}>New Service Record</h3>
              <button onClick={() => { setShowForm(false); resetForm(); }} style={{ background: "none", border: "none", fontSize: 18, color: "var(--muted)", cursor: "pointer" }}>✕</button>
            </div>
            <form onSubmit={handleSubmit}>
              <div style={{ padding: "18px 24px" }}>
                {error && <div style={{ padding: "10px 14px", borderRadius: 8, background: "rgba(239,68,68,0.1)", color: "#ef4444", fontSize: 13, marginBottom: 14 }}>{error}</div>}
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                  {[
                    { label: "Date *", el: <input required type="date" value={form.date} onChange={e => setForm(f => ({ ...f, date: e.target.value }))} /> },
                    { label: "Phone Number *", el: <input required placeholder="05XXXXXXXX" value={form.clientPhone} dir="ltr" onChange={e => { setForm(f => ({ ...f, clientPhone: e.target.value })); setClientSuggestion(null); }} onBlur={e => checkPhone(e.target.value)} /> },
                    { label: "Client Name *", el: <input required placeholder="Client name" value={form.clientName} readOnly={!!clientSuggestion} style={clientSuggestion ? { background: "var(--surface-hover)" } : {}} onChange={e => setForm(f => ({ ...f, clientName: e.target.value }))} /> },
                    { label: "Project Name *", el: <input required placeholder="Project name" value={form.projectName} onChange={e => setForm(f => ({ ...f, projectName: e.target.value }))} /> },
                    { label: "Total Price (SAR) *", el: <input required type="number" step="0.01" min="0" placeholder="0" value={form.totalPrice} dir="ltr" style={{ textAlign: "right" }} onChange={e => setForm(f => ({ ...f, totalPrice: e.target.value }))} /> },
                    { label: "Deposit (SAR)", el: <input type="number" step="0.01" min="0" placeholder="0" value={form.deposit} dir="ltr" style={{ textAlign: "right" }} onChange={e => setForm(f => ({ ...f, deposit: e.target.value }))} /> },
                    { label: "Remaining (Auto)", el: <div style={{ padding: "9px 12px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--surface-hover)", fontWeight: 700, fontSize: 13, direction: "ltr", textAlign: "right", color: remaining > 0 ? "#ef4444" : "#10b981" }}>{fmt(remaining)} SAR</div> },
                    { label: "Designer", el: <select value={form.designerId} onChange={e => setForm(f => ({ ...f, designerId: e.target.value }))}><option value="">Select...</option>{users.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}</select> },
                  ].map(({ label, el }, i) => (
                    <div key={i}>
                      <label style={{ display: "block", fontSize: 11, fontWeight: 600, color: "var(--muted)", marginBottom: 3 }}>{label}</label>
                      <div style={{ fontSize: 13 }}>{el}</div>
                    </div>
                  ))}
                  {/* Services */}
                  <div style={{ gridColumn: "1 / -1" }}>
                    <label style={{ display: "block", fontSize: 11, fontWeight: 600, color: "var(--muted)", marginBottom: 3 }}>Services</label>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
                      {services.map(s => (
                        <button key={s.id} type="button" onClick={() => setForm(f => ({ ...f, serviceIds: f.serviceIds.includes(s.id) ? f.serviceIds.filter(x => x !== s.id) : [...f.serviceIds, s.id] }))} style={{
                          padding: "4px 10px", borderRadius: 6, border: "1px solid",
                          borderColor: form.serviceIds.includes(s.id) ? "#0d9488" : "var(--border)",
                          background: form.serviceIds.includes(s.id) ? "rgba(13,148,136,0.1)" : "var(--surface)",
                          color: form.serviceIds.includes(s.id) ? "#0d9488" : "var(--muted)",
                          fontSize: 12, fontWeight: 600, cursor: "pointer",
                        }}>{s.name}</button>
                      ))}
                    </div>
                  </div>
                  {/* Notes */}
                  <div style={{ gridColumn: "1 / -1" }}>
                    <label style={{ display: "block", fontSize: 11, fontWeight: 600, color: "var(--muted)", marginBottom: 3 }}>Notes</label>
                    <textarea rows={2} value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} placeholder="Additional notes..."
                      style={{ width: "100%", padding: "8px 12px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--surface)", color: "var(--text)", fontSize: 13, outline: "none", resize: "vertical" }} />
                  </div>
                </div>
                {clientSuggestion && (
                  <div style={{ marginTop: 10, padding: "8px 12px", borderRadius: 6, background: "rgba(13,148,136,0.08)", fontSize: 12, color: "#0d9488" }}>
                    ✓ Existing client: <strong>{clientSuggestion.name}</strong> — {TIER_MAP[clientSuggestion.tier]?.label} {clientSuggestion.isRepeatClient && "🔄 Repeat"}
                  </div>
                )}
              </div>
              <div style={{ padding: "14px 24px", borderTop: "1px solid var(--border)", display: "flex", gap: 8, justifyContent: "flex-end" }}>
                <button type="button" onClick={() => { setShowForm(false); resetForm(); }} style={{ padding: "8px 16px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--surface)", color: "var(--text)", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>Cancel</button>
                <button type="submit" disabled={submitting} style={{ padding: "8px 16px", borderRadius: 8, border: "none", background: "#0d9488", color: "#fff", fontSize: 13, fontWeight: 600, cursor: submitting ? "not-allowed" : "pointer", opacity: submitting ? 0.6 : 1 }}>{submitting ? "Saving..." : "Save Record"}</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
