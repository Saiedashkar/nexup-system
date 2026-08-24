"use client";

import { useEffect, useState, useCallback, useMemo } from "react";

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
const WORK_STATUS: Record<string, { label: string; color: string; bg: string }> = {
  WAITING: { label: "Waiting", color: "#f59e0b", bg: "rgba(245,158,11,0.1)" },
  IN_PROGRESS: { label: "In Progress", color: "#3b82f6", bg: "rgba(59,130,246,0.1)" },
  COMPLETED: { label: "Done", color: "#10b981", bg: "rgba(16,185,129,0.1)" },
  PAUSED: { label: "Paused", color: "#6b7280", bg: "rgba(107,114,128,0.1)" },
};

const PAYMENT_STATUS: Record<string, { label: string; color: string; bg: string }> = {
  FULL: { label: "Paid", color: "#10b981", bg: "rgba(16,185,129,0.1)" },
  PARTIAL: { label: "Partial", color: "#f59e0b", bg: "rgba(245,158,11,0.1)" },
  UNPAID: { label: "Unpaid", color: "#ef4444", bg: "rgba(239,68,68,0.1)" },
};

const TIER_CONFIG: Record<string, { label: string; color: string; bg: string; icon: string }> = {
  VIP: { label: "VIP", color: "#f59e0b", bg: "rgba(245,158,11,0.1)", icon: "⭐" },
  LOYAL: { label: "Loyal", color: "#3b82f6", bg: "rgba(59,130,246,0.1)", icon: "💎" },
  NORMAL: { label: "Normal", color: "#64748b", bg: "rgba(100,116,139,0.08)", icon: "" },
  DELINQUENT: { label: "At Risk", color: "#ef4444", bg: "rgba(239,68,68,0.1)", icon: "⚠️" },
};

/* ───── Helpers ───── */
function formatNum(n: number) {
  return n.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}
function formatDate(d: string) {
  return new Date(d).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}
function getMonthYear(d: string) {
  const date = new Date(d);
  return { month: date.toLocaleDateString("en-US", { month: "long" }), year: date.getFullYear(), key: `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}` };
}

/* ───── Month Group Component ───── */
function MonthGroup({
  monthKey, monthLabel, yearLabel, projects, children,
}: {
  monthKey: string; monthLabel: string; yearLabel: number;
  projects: Project[]; children: React.ReactNode;
}) {
  const [collapsed, setCollapsed] = useState(false);
  const totalRevenue = projects.reduce((s, p) => s + Number(p.totalPrice), 0);
  const totalCollected = projects.reduce((s, p) => s + Number(p.deposit), 0);

  return (
    <div style={{ marginBottom: 24 }}>
      {/* Month Header */}
      <div
        onClick={() => setCollapsed(!collapsed)}
        style={{
          display: "flex", alignItems: "center", gap: 12,
          padding: "10px 16px", borderRadius: 10,
          background: "var(--surface-hover)", cursor: "pointer",
          marginBottom: collapsed ? 0 : 8, transition: "all 0.15s",
          borderBottomLeftRadius: collapsed ? 10 : 0, borderBottomRightRadius: collapsed ? 10 : 0,
        }}
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} width={14} height={14}
          style={{ color: "var(--muted)", transform: collapsed ? "rotate(-90deg)" : "rotate(0deg)", transition: "transform 0.2s" }}>
          <path d="M6 9l6 6 6-6" />
        </svg>
        <span style={{ fontSize: 13, fontWeight: 700, color: "var(--text)" }}>
          {monthLabel} {yearLabel}
        </span>
        <span style={{ fontSize: 11, color: "var(--muted)", marginLeft: "auto" }}>
          {projects.length} records · {formatNum(totalRevenue)} SAR
        </span>
      </div>

      {/* Month Content */}
      {!collapsed && <div>{children}</div>}
    </div>
  );
}

/* ───── Main Page ───── */
export default function NexupClientsPage() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [services, setServices] = useState<Service[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingProject, setEditingProject] = useState<Project | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);

  // Inline editing
  const [inlineEdit, setInlineEdit] = useState<{ id: string; field: string; value: string } | null>(null);

  // Filters
  const [search, setSearch] = useState("");
  const [workStatusFilter, setWorkStatusFilter] = useState("");
  const [paymentStatusFilter, setPaymentStatusFilter] = useState("");

  // Form state
  const [form, setForm] = useState({
    clientPhone: "", clientName: "", projectName: "",
    date: new Date().toISOString().split("T")[0],
    customServiceText: "", totalPrice: "", deposit: "",
    workStatus: "WAITING", designerId: "", serviceIds: [] as string[],
    notes: "",
  });
  const [clientSuggestion, setClientSuggestion] = useState<ClientInfo | null>(null);

  /* ───── Data Fetching ───── */
  const fetchProjects = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams();
    if (search) params.set("search", search);
    if (workStatusFilter) params.set("workStatus", workStatusFilter);
    if (paymentStatusFilter) params.set("paymentStatus", paymentStatusFilter);
    try {
      const res = await fetch(`/api/nexup/projects?${params.toString()}`);
      if (res.ok) setProjects(await res.json());
    } catch { /* ignore */ }
    setLoading(false);
  }, [search, workStatusFilter, paymentStatusFilter]);

  const fetchServices = async () => {
    try { const res = await fetch("/api/services"); if (res.ok) setServices(await res.json()); } catch { /* */ }
  };
  const fetchUsers = async () => {
    try { const res = await fetch("/api/users"); if (res.ok) setUsers(await res.json()); } catch { /* */ }
  };

  useEffect(() => { fetchProjects(); }, [fetchProjects]);
  useEffect(() => { fetchServices(); fetchUsers(); }, []);

  /* ───── Computed ───── */
  const filteredProjects = useMemo(() => projects, [projects]);

  // Group by month
  const groupedByMonth = useMemo(() => {
    const groups = new Map<string, { month: string; year: number; projects: Project[] }>();
    for (const p of filteredProjects) {
      const { month, year, key } = getMonthYear(p.date);
      if (!groups.has(key)) groups.set(key, { month, year, projects: [] });
      groups.get(key)!.projects.push(p);
    }
    return Array.from(groups.entries()).sort((a, b) => b[0].localeCompare(a[0]));
  }, [filteredProjects]);

  const stats = useMemo(() => {
    const total = projects.length;
    const completed = projects.filter(p => p.workStatus === "COMPLETED").length;
    const inProgress = projects.filter(p => p.workStatus === "IN_PROGRESS").length;
    const unpaid = projects.filter(p => p.paymentStatus === "UNPAID").length;
    const totalRevenue = projects.reduce((s, p) => s + Number(p.totalPrice), 0);
    const uniqueClients = new Set(projects.map(p => p.client.id)).size;
    return { total, completed, inProgress, unpaid, totalRevenue, uniqueClients };
  }, [projects]);

  const remaining = form.totalPrice && form.deposit
    ? parseFloat(form.totalPrice) - parseFloat(form.deposit || "0")
    : form.totalPrice ? parseFloat(form.totalPrice) : 0;

  /* ───── Phone Check ───── */
  const checkPhone = async (phone: string) => {
    if (!phone || phone.length < 5) { setClientSuggestion(null); return; }
    try {
      const res = await fetch("/api/clients");
      if (res.ok) {
        const clients: ClientInfo[] = await res.json();
        const match = clients.find(c => c.phone === phone);
        if (match) { setClientSuggestion(match); setForm(f => ({ ...f, clientName: match.name })); }
        else setClientSuggestion(null);
      }
    } catch { setClientSuggestion(null); }
  };

  /* ───── Actions ───── */
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault(); setSubmitting(true); setError("");
    try {
      const res = await fetch("/api/projects", {
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
      if (!res.ok) { const d = await res.json(); throw new Error(d.error || "Failed"); }
      setShowForm(false); resetForm(); fetchProjects();
    } catch (err) { setError(err instanceof Error ? err.message : "Error"); }
    setSubmitting(false);
  };

  const handleDelete = async (id: string) => {
    try {
      const res = await fetch(`/api/projects/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Failed");
      setDeleteConfirm(null); fetchProjects();
    } catch (err) { console.error(err); }
  };

  const toggleWorkStatus = async (project: Project) => {
    const next = project.workStatus === "COMPLETED" ? "IN_PROGRESS" : "COMPLETED";
    try {
      const res = await fetch(`/api/projects/${project.id}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workStatus: next }),
      });
      if (res.ok) fetchProjects();
    } catch { /* */ }
  };

  const updateRemaining = async (project: Project) => {
    try {
      const res = await fetch(`/api/projects/${project.id}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ deposit: Number(project.totalPrice), workStatus: "COMPLETED" }),
      });
      if (res.ok) fetchProjects();
    } catch { /* */ }
  };

  const updateField = async (id: string, field: string, value: string | number) => {
    try {
      const res = await fetch(`/api/projects/${id}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ [field]: value }),
      });
      if (res.ok) { setInlineEdit(null); fetchProjects(); }
    } catch { /* */ }
  };

  const resetForm = () => {
    setForm({
      clientPhone: "", clientName: "", projectName: "",
      date: new Date().toISOString().split("T")[0],
      customServiceText: "", totalPrice: "", deposit: "",
      workStatus: "WAITING", designerId: "", serviceIds: [], notes: "",
    });
    setClientSuggestion(null); setError("");
  };

  /* ───── Render ───── */
  return (
    <div>
      {/* Page Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 20 }}>
        <div>
          <h1 style={{ fontSize: 24, fontWeight: 800, color: "var(--text)", margin: 0, letterSpacing: "-0.02em" }}>
            Clients
          </h1>
          <p style={{ fontSize: 13, color: "var(--muted)", margin: "4px 0 0" }}>
            Manage client records, projects & service records
          </p>
        </div>
        <button
          onClick={() => { setShowForm(true); resetForm(); }}
          style={{
            display: "flex", alignItems: "center", gap: 6,
            padding: "10px 18px", borderRadius: 10,
            background: "#0d9488", color: "#fff",
            border: "none", fontSize: 13, fontWeight: 600,
            cursor: "pointer", boxShadow: "0 2px 8px rgba(13,148,136,0.3)",
          }}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
          </svg>
          New Record
        </button>
      </div>

      {/* Stats Row */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(6, 1fr)", gap: 12, marginBottom: 20 }}>
        {[
          { label: "Total", value: stats.total, color: "var(--text)" },
          { label: "In Progress", value: stats.inProgress, color: "#3b82f6" },
          { label: "Completed", value: stats.completed, color: "#10b981" },
          { label: "Unpaid", value: stats.unpaid, color: "#ef4444" },
          { label: "Clients", value: stats.uniqueClients, color: "#8b5cf6" },
          { label: "Revenue", value: `${formatNum(stats.totalRevenue)} SAR`, color: "#0d9488" },
        ].map(s => (
          <div key={s.label} style={{
            padding: "12px 16px", borderRadius: 10,
            background: "var(--surface)", border: "1px solid var(--border)",
            textAlign: "center",
          }}>
            <div style={{ fontSize: 18, fontWeight: 800, color: s.color }}>{s.value}</div>
            <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 2 }}>{s.label}</div>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div style={{ display: "flex", gap: 10, marginBottom: 16, alignItems: "center", flexWrap: "wrap" }}>
        <div style={{ flex: 1, minWidth: 200, position: "relative" }}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", width: 16, height: 16, color: "var(--muted)" }}>
            <circle cx="11" cy="11" r="8" /><path d="m21 21-4.35-4.35" />
          </svg>
          <input
            placeholder="Search by name, phone, or project..."
            value={search} onChange={e => setSearch(e.target.value)}
            style={{
              width: "100%", padding: "9px 12px 9px 36px",
              borderRadius: 10, border: "1px solid var(--border)",
              background: "var(--surface)", color: "var(--text)",
              fontSize: 13, outline: "none",
            }}
          />
        </div>
        <select value={workStatusFilter} onChange={e => setWorkStatusFilter(e.target.value)}
          style={{ padding: "9px 12px", borderRadius: 10, border: "1px solid var(--border)", background: "var(--surface)", color: "var(--text)", fontSize: 13, outline: "none" }}>
          <option value="">All Work Status</option>
          <option value="WAITING">⏳ Waiting</option>
          <option value="IN_PROGRESS">🔄 In Progress</option>
          <option value="COMPLETED">✅ Done</option>
          <option value="PAUSED">⏸ Paused</option>
        </select>
        <select value={paymentStatusFilter} onChange={e => setPaymentStatusFilter(e.target.value)}
          style={{ padding: "9px 12px", borderRadius: 10, border: "1px solid var(--border)", background: "var(--surface)", color: "var(--text)", fontSize: 13, outline: "none" }}>
          <option value="">All Payment Status</option>
          <option value="FULL">✅ Paid</option>
          <option value="PARTIAL">⚠️ Partial</option>
          <option value="UNPAID">❌ Unpaid</option>
        </select>
      </div>

      {/* Table */}
      {loading ? (
        <div style={{ textAlign: "center", padding: 60, color: "var(--muted)" }}>Loading...</div>
      ) : filteredProjects.length === 0 ? (
        <div style={{ textAlign: "center", padding: 60 }}>
          <div style={{ fontSize: 48, marginBottom: 12 }}>📋</div>
          <p style={{ color: "var(--muted)", fontSize: 14 }}>No records yet. Add your first client record.</p>
          <button onClick={() => { setShowForm(true); resetForm(); }} style={{
            marginTop: 16, padding: "10px 20px", borderRadius: 10,
            background: "#0d9488", color: "#fff", border: "none",
            fontSize: 13, fontWeight: 600, cursor: "pointer",
          }}>Add First Record</button>
        </div>
      ) : (
        groupedByMonth.map(([key, group]) => (
          <MonthGroup key={key} monthKey={key} monthLabel={group.month} yearLabel={group.year} projects={group.projects}>
            <div style={{ overflowX: "auto", borderRadius: "0 0 10px 10px", border: "1px solid var(--border)", borderTop: "none" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                <thead>
                  <tr style={{ background: "var(--surface-hover)" }}>
                    {[
                      "Client", "Project", "Date", "Price (SAR)", "Deposit", "Remaining",
                      "Work Status", "Payment", "Designer", "Tier", "",
                    ].map((h, i) => (
                      <th key={i} style={{
                        padding: "10px 12px", textAlign: i <= 1 ? "right" : i >= 3 && i <= 5 ? "left" : "center",
                        fontSize: 11, fontWeight: 600, color: "var(--muted)",
                        textTransform: "uppercase", letterSpacing: "0.05em",
                        whiteSpace: "nowrap", borderBottom: "1px solid var(--border)",
                      }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {group.projects.map(p => {
                    const ws = WORK_STATUS[p.workStatus] || WORK_STATUS.WAITING;
                    const ps = PAYMENT_STATUS[p.paymentStatus] || PAYMENT_STATUS.UNPAID;
                    const tier = TIER_CONFIG[p.client.tier] || TIER_CONFIG.NORMAL;
                    const depositPct = p.totalPrice > 0 ? Math.min(100, (Number(p.deposit) / Number(p.totalPrice)) * 100) : 0;
                    const isDone = p.workStatus === "COMPLETED" && p.paymentStatus === "FULL";

                    return (
                      <tr key={p.id} style={{
                        background: isDone ? "rgba(16,185,129,0.04)" : "var(--surface)",
                        borderBottom: "1px solid var(--border)",
                        borderLeft: isDone ? "3px solid #10b981" : "3px solid transparent",
                        transition: "background 0.15s",
                      }}
                        onMouseEnter={e => { if (!isDone) e.currentTarget.style.background = "var(--surface-hover)"; }}
                        onMouseLeave={e => { if (!isDone) e.currentTarget.style.background = "var(--surface)"; }}
                      >
                        {/* Client */}
                        <td style={{ padding: "10px 12px", textAlign: "right" }}>
                          <div style={{ fontWeight: 600, fontSize: 13, color: "var(--text)" }}>{p.client.name}</div>
                          <div style={{ fontSize: 11, color: "var(--muted)", direction: "ltr", textAlign: "right" }}>{p.client.phone}</div>
                        </td>

                        {/* Project */}
                        <td style={{ padding: "10px 12px", textAlign: "right" }}>
                          <div style={{ fontWeight: 600, fontSize: 13, color: "var(--text)" }}>{p.projectName}</div>
                          {p.services.length > 0 && (
                            <div style={{ fontSize: 11, color: "var(--muted)" }}>
                              {p.services.map(s => s.name).join(", ")}
                            </div>
                          )}
                        </td>

                        {/* Date */}
                        <td style={{ padding: "10px 12px", textAlign: "center", whiteSpace: "nowrap", fontSize: 12, color: "var(--muted)" }}>
                          {formatDate(p.date)}
                        </td>

                        {/* Total Price */}
                        <td style={{ padding: "10px 12px", textAlign: "left", direction: "ltr", fontWeight: 700, color: "var(--text)" }}>
                          {formatNum(Number(p.totalPrice))}
                        </td>

                        {/* Deposit */}
                        <td style={{ padding: "10px 12px", textAlign: "left", direction: "ltr", color: "var(--text-secondary)" }}>
                          {formatNum(Number(p.deposit))}
                        </td>

                        {/* Remaining */}
                        <td style={{ padding: "10px 12px", textAlign: "left", direction: "ltr" }}>
                          <span style={{
                            fontWeight: 700,
                            color: Number(p.remaining) > 0 ? "#ef4444" : "#10b981",
                          }}>
                            {formatNum(Number(p.remaining))}
                          </span>
                        </td>

                        {/* Work Status — Toggle Button */}
                        <td style={{ padding: "10px 12px", textAlign: "center" }}>
                          <button
                            onClick={() => toggleWorkStatus(p)}
                            style={{
                              padding: "4px 10px", borderRadius: 6,
                              border: "none", background: ws.bg, color: ws.color,
                              fontSize: 11, fontWeight: 600, cursor: "pointer",
                              transition: "all 0.15s",
                            }}
                            title={`Click to change to ${p.workStatus === "COMPLETED" ? "In Progress" : "Completed"}`}
                          >
                            {ws.label}
                          </button>
                        </td>

                        {/* Payment Status */}
                        <td style={{ padding: "10px 12px", textAlign: "center" }}>
                          <span style={{
                            padding: "3px 8px", borderRadius: 6,
                            background: ps.bg, color: ps.color,
                            fontSize: 11, fontWeight: 600,
                          }}>
                            {ps.label}
                          </span>
                        </td>

                        {/* Designer */}
                        <td style={{ padding: "10px 12px", textAlign: "center", fontSize: 12, color: "var(--muted)" }}>
                          {p.designer?.name || "—"}
                        </td>

                        {/* Tier */}
                        <td style={{ padding: "10px 12px", textAlign: "center" }}>
                          <span style={{
                            padding: "2px 8px", borderRadius: 6,
                            background: tier.bg, color: tier.color,
                            fontSize: 11, fontWeight: 700,
                          }}>
                            {tier.icon} {p.client.projectCount > 1 && `${p.client.projectCount}× `}{tier.label}
                          </span>
                        </td>

                        {/* Actions */}
                        <td style={{ padding: "10px 8px", textAlign: "center" }}>
                          <div style={{ display: "flex", gap: 4, justifyContent: "center" }}>
                            {/* Pay Remaining Quick Action */}
                            {Number(p.remaining) > 0 && (
                              <button
                                onClick={() => updateRemaining(p)}
                                style={{
                                  padding: "4px 8px", borderRadius: 6, border: "none",
                                  background: "rgba(16,185,129,0.1)", color: "#10b981",
                                  fontSize: 11, cursor: "pointer", fontWeight: 600,
                                }}
                                title="Mark as fully paid"
                              >
                                💰 Pay
                              </button>
                            )}
                            <button
                              onClick={() => setDeleteConfirm(p.id)}
                              style={{
                                padding: "4px 8px", borderRadius: 6, border: "none",
                                background: "rgba(239,68,68,0.1)", color: "#ef4444",
                                fontSize: 11, cursor: "pointer", fontWeight: 600,
                              }}
                              title="Delete"
                            >
                              🗑
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </MonthGroup>
        ))
      )}

      {/* Delete Confirmation Modal */}
      {deleteConfirm && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000 }}
          onClick={e => { if (e.target === e.currentTarget) setDeleteConfirm(null); }}>
          <div style={{ background: "var(--surface)", borderRadius: 14, padding: 24, maxWidth: 400, width: "90%", border: "1px solid var(--border)" }}>
            <h3 style={{ fontSize: 16, fontWeight: 700, color: "var(--text)", marginBottom: 12 }}>Confirm Delete</h3>
            <p style={{ fontSize: 13, color: "var(--muted)", margin: 0 }}>Are you sure? This cannot be undone.</p>
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 20 }}>
              <button onClick={() => setDeleteConfirm(null)} style={{
                padding: "8px 16px", borderRadius: 8, border: "1px solid var(--border)",
                background: "var(--surface)", color: "var(--text)", fontSize: 13, fontWeight: 600, cursor: "pointer",
              }}>Cancel</button>
              <button onClick={() => handleDelete(deleteConfirm)} style={{
                padding: "8px 16px", borderRadius: 8, border: "none",
                background: "#ef4444", color: "#fff", fontSize: 13, fontWeight: 600, cursor: "pointer",
              }}>Delete</button>
            </div>
          </div>
        </div>
      )}

      {/* Create Form Modal */}
      {showForm && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000 }}
          onClick={e => { if (e.target === e.currentTarget) { setShowForm(false); resetForm(); } }}>
          <div style={{ background: "var(--surface)", borderRadius: 14, maxWidth: 640, width: "95%", maxHeight: "90vh", overflow: "auto", border: "1px solid var(--border)" }}>
            <div style={{ padding: "20px 24px", borderBottom: "1px solid var(--border)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <h3 style={{ fontSize: 16, fontWeight: 700, color: "var(--text)", margin: 0 }}>New Service Record</h3>
              <button onClick={() => { setShowForm(false); resetForm(); }} style={{ background: "none", border: "none", fontSize: 18, color: "var(--muted)", cursor: "pointer" }}>✕</button>
            </div>
            <form onSubmit={handleSubmit}>
              <div style={{ padding: "20px 24px" }}>
                {error && <div style={{ padding: "10px 14px", borderRadius: 8, background: "rgba(239,68,68,0.1)", color: "#ef4444", fontSize: 13, marginBottom: 16 }}>{error}</div>}
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
                  {/* Phone */}
                  <div>
                    <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "var(--text-secondary)", marginBottom: 4 }}>Phone Number *</label>
                    <input required placeholder="05XXXXXXXX" value={form.clientPhone} dir="ltr" style={{ width: "100%", padding: "9px 12px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--surface)", color: "var(--text)", fontSize: 13, outline: "none" }}
                      onChange={e => { setForm(f => ({ ...f, clientPhone: e.target.value })); setClientSuggestion(null); }}
                      onBlur={e => checkPhone(e.target.value)} />
                    {clientSuggestion && (
                      <div style={{ marginTop: 6, padding: "6px 10px", borderRadius: 6, background: "rgba(13,148,136,0.1)", fontSize: 12, color: "#0d9488" }}>
                        ✓ Existing: <strong>{clientSuggestion.name}</strong>
                      </div>
                    )}
                  </div>

                  {/* Client Name */}
                  <div>
                    <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "var(--text-secondary)", marginBottom: 4 }}>Client Name *</label>
                    <input required placeholder="Client name" value={form.clientName}
                      readOnly={!!clientSuggestion}
                      style={{ width: "100%", padding: "9px 12px", borderRadius: 8, border: "1px solid var(--border)", background: clientSuggestion ? "var(--surface-hover)" : "var(--surface)", color: "var(--text)", fontSize: 13, outline: "none" }}
                      onChange={e => setForm(f => ({ ...f, clientName: e.target.value }))} />
                  </div>

                  {/* Project Name */}
                  <div style={{ gridColumn: "1 / -1" }}>
                    <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "var(--text-secondary)", marginBottom: 4 }}>Project Name *</label>
                    <input required placeholder="Project name" value={form.projectName}
                      style={{ width: "100%", padding: "9px 12px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--surface)", color: "var(--text)", fontSize: 13, outline: "none" }}
                      onChange={e => setForm(f => ({ ...f, projectName: e.target.value }))} />
                  </div>

                  {/* Date */}
                  <div>
                    <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "var(--text-secondary)", marginBottom: 4 }}>Date *</label>
                    <input required type="date" value={form.date}
                      style={{ width: "100%", padding: "9px 12px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--surface)", color: "var(--text)", fontSize: 13, outline: "none" }}
                      onChange={e => setForm(f => ({ ...f, date: e.target.value }))} />
                  </div>

                  {/* Work Status */}
                  <div>
                    <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "var(--text-secondary)", marginBottom: 4 }}>Work Status</label>
                    <select value={form.workStatus} onChange={e => setForm(f => ({ ...f, workStatus: e.target.value }))}
                      style={{ width: "100%", padding: "9px 12px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--surface)", color: "var(--text)", fontSize: 13, outline: "none" }}>
                      <option value="WAITING">⏳ Waiting</option>
                      <option value="IN_PROGRESS">🔄 In Progress</option>
                      <option value="COMPLETED">✅ Completed</option>
                      <option value="PAUSED">⏸ Paused</option>
                    </select>
                  </div>

                  {/* Designer */}
                  <div>
                    <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "var(--text-secondary)", marginBottom: 4 }}>Designer</label>
                    <select value={form.designerId} onChange={e => setForm(f => ({ ...f, designerId: e.target.value }))}
                      style={{ width: "100%", padding: "9px 12px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--surface)", color: "var(--text)", fontSize: 13, outline: "none" }}>
                      <option value="">Select designer...</option>
                      {users.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
                    </select>
                  </div>

                  {/* Total Price */}
                  <div>
                    <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "var(--text-secondary)", marginBottom: 4 }}>Total Price (SAR) *</label>
                    <input required type="number" step="0.01" min="0" placeholder="0" value={form.totalPrice} dir="ltr"
                      style={{ width: "100%", padding: "9px 12px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--surface)", color: "var(--text)", fontSize: 13, outline: "none", textAlign: "right" }}
                      onChange={e => setForm(f => ({ ...f, totalPrice: e.target.value }))} />
                  </div>

                  {/* Deposit */}
                  <div>
                    <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "var(--text-secondary)", marginBottom: 4 }}>Deposit (SAR)</label>
                    <input type="number" step="0.01" min="0" placeholder="0" value={form.deposit} dir="ltr"
                      style={{ width: "100%", padding: "9px 12px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--surface)", color: "var(--text)", fontSize: 13, outline: "none", textAlign: "right" }}
                      onChange={e => setForm(f => ({ ...f, deposit: e.target.value }))} />
                  </div>

                  {/* Remaining (Auto) */}
                  <div>
                    <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "var(--text-secondary)", marginBottom: 4 }}>Remaining (Auto)</label>
                    <div style={{
                      padding: "9px 12px", borderRadius: 8,
                      border: "1px solid var(--border)", background: "var(--surface-hover)",
                      fontWeight: 700, fontSize: 13, direction: "ltr", textAlign: "right",
                      color: remaining > 0 ? "#ef4444" : "#10b981",
                    }}>
                      {formatNum(remaining)} SAR
                    </div>
                  </div>

                  {/* Services */}
                  <div style={{ gridColumn: "1 / -1" }}>
                    <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "var(--text-secondary)", marginBottom: 4 }}>Services</label>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                      {services.map(s => (
                        <button key={s.id} type="button" onClick={() => {
                          setForm(f => ({ ...f, serviceIds: f.serviceIds.includes(s.id) ? f.serviceIds.filter(x => x !== s.id) : [...f.serviceIds, s.id] }));
                        }} style={{
                          padding: "5px 12px", borderRadius: 6, border: "1px solid",
                          borderColor: form.serviceIds.includes(s.id) ? "#0d9488" : "var(--border)",
                          background: form.serviceIds.includes(s.id) ? "rgba(13,148,136,0.1)" : "var(--surface)",
                          color: form.serviceIds.includes(s.id) ? "#0d9488" : "var(--text-secondary)",
                          fontSize: 12, fontWeight: 600, cursor: "pointer",
                        }}>{s.name}</button>
                      ))}
                      {services.length === 0 && <span style={{ fontSize: 12, color: "var(--muted)" }}>No services registered</span>}
                    </div>
                  </div>

                  {/* Custom Service */}
                  <div style={{ gridColumn: "1 / -1" }}>
                    <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "var(--text-secondary)", marginBottom: 4 }}>Custom Service</label>
                    <input placeholder="Unlisted service name" value={form.customServiceText}
                      style={{ width: "100%", padding: "9px 12px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--surface)", color: "var(--text)", fontSize: 13, outline: "none" }}
                      onChange={e => setForm(f => ({ ...f, customServiceText: e.target.value }))} />
                  </div>

                  {/* Notes */}
                  <div style={{ gridColumn: "1 / -1" }}>
                    <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "var(--text-secondary)", marginBottom: 4 }}>Notes</label>
                    <textarea rows={2} placeholder="Additional notes..." value={form.notes}
                      style={{ width: "100%", padding: "9px 12px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--surface)", color: "var(--text)", fontSize: 13, outline: "none", resize: "vertical" }}
                      onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} />
                  </div>
                </div>
              </div>
              <div style={{ padding: "16px 24px", borderTop: "1px solid var(--border)", display: "flex", gap: 8, justifyContent: "flex-end" }}>
                <button type="button" onClick={() => { setShowForm(false); resetForm(); }} style={{
                  padding: "9px 18px", borderRadius: 8, border: "1px solid var(--border)",
                  background: "var(--surface)", color: "var(--text)", fontSize: 13, fontWeight: 600, cursor: "pointer",
                }}>Cancel</button>
                <button type="submit" disabled={submitting} style={{
                  padding: "9px 18px", borderRadius: 8, border: "none",
                  background: "#0d9488", color: "#fff", fontSize: 13, fontWeight: 600,
                  cursor: submitting ? "not-allowed" : "pointer", opacity: submitting ? 0.6 : 1,
                }}>{submitting ? "Saving..." : "Save Record"}</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
