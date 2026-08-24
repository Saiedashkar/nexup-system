"use client";

import { useEffect, useState, useCallback, useMemo } from "react";
import { AppShell } from "@/components/app-shell";

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
  client: ClientInfo;
  designer: { id: string; name: string };
  services: { id: string; name: string }[];
};

type Service = { id: string; name: string; isCustom: boolean };
type User = { id: string; name: string; role: string };

/* ───── Constants ───── */
const WORK_STATUS: Record<string, { label: string; color: string; icon: string }> = {
  WAITING: { label: "Waiting", color: "#f59e0b", icon: "⏳" },
  IN_PROGRESS: { label: "In Progress", color: "#3b82f6", icon: "🔄" },
  COMPLETED: { label: "Done", color: "#10b981", icon: "✅" },
  PAUSED: { label: "Paused", color: "#6b7280", icon: "⏸" },
};

const PAYMENT_STATUS: Record<string, { label: string; color: string }> = {
  FULL: { label: "Paid", color: "#10b981" },
  PARTIAL: { label: "Partial", color: "#f59e0b" },
  UNPAID: { label: "Unpaid", color: "#ef4444" },
};

const TIER_CONFIG: Record<string, { label: string; color: string; bg: string }> = {
  VIP: { label: "VIP", color: "#f59e0b", bg: "rgba(245,158,11,0.12)" },
  LOYAL: { label: "Loyal", color: "#3b82f6", bg: "rgba(59,130,246,0.12)" },
  NORMAL: { label: "Normal", color: "#6b7280", bg: "rgba(107,114,128,0.08)" },
  DELINQUENT: { label: "At Risk", color: "#ef4444", bg: "rgba(239,68,68,0.12)" },
};

/* ───── Helpers ───── */
function formatNum(n: number) {
  return n.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}
function formatDate(d: string) {
  return new Date(d).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

/* ───── Page ───── */
export default function ClientsPage() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [services, setServices] = useState<Service[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [showEditForm, setShowEditForm] = useState<Project | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);

  // Filters
  const [search, setSearch] = useState("");
  const [workStatusFilter, setWorkStatusFilter] = useState("");
  const [paymentStatusFilter, setPaymentStatusFilter] = useState("");
  const [tierFilter, setTierFilter] = useState("");

  // Sort
  const [sortBy, setSortBy] = useState("date");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

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
    designerId: "",
    serviceIds: [] as string[],
    notes: "",
  });

  // Client suggestion
  const [clientSuggestion, setClientSuggestion] = useState<ClientInfo | null>(null);
  const [checkingPhone, setCheckingPhone] = useState(false);

  /* ───── Data Fetching ───── */
  const fetchProjects = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams();
    if (search) params.set("search", search);
    if (workStatusFilter) params.set("workStatus", workStatusFilter);
    if (paymentStatusFilter) params.set("paymentStatus", paymentStatusFilter);
    params.set("sortBy", sortBy);
    params.set("sortDir", sortDir);

    try {
      const res = await fetch(`/api/projects?${params.toString()}`);
      if (res.ok) setProjects(await res.json());
    } catch { /* ignore */ }
    setLoading(false);
  }, [search, workStatusFilter, paymentStatusFilter, sortBy, sortDir]);

  const fetchServices = async () => {
    try {
      const res = await fetch("/api/services");
      if (res.ok) setServices(await res.json());
    } catch { /* ignore */ }
  };

  const fetchUsers = async () => {
    try {
      const res = await fetch("/api/users");
      if (res.ok) setUsers(await res.json());
    } catch { /* ignore */ }
  };

  useEffect(() => { fetchProjects(); }, [fetchProjects]);
  useEffect(() => { fetchServices(); fetchUsers(); }, []);

  /* ───── Phone Check ───── */
  const checkPhone = async (phone: string) => {
    if (!phone || phone.length < 5) { setClientSuggestion(null); return; }
    setCheckingPhone(true);
    try {
      const res = await fetch("/api/clients");
      if (res.ok) {
        const clients: ClientInfo[] = await res.json();
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

  /* ───── Computed ───── */
  const remaining = form.totalPrice && form.deposit
    ? (parseFloat(form.totalPrice) - parseFloat(form.deposit || "0"))
    : form.totalPrice
    ? parseFloat(form.totalPrice)
    : 0;

  const filteredProjects = useMemo(() => {
    let result = projects;
    if (tierFilter) {
      result = result.filter((p) => p.client.tier === tierFilter);
    }
    return result;
  }, [projects, tierFilter]);

  // Stats
  const stats = useMemo(() => {
    const total = projects.length;
    const completed = projects.filter((p) => p.workStatus === "COMPLETED").length;
    const inProgress = projects.filter((p) => p.workStatus === "IN_PROGRESS").length;
    const unpaid = projects.filter((p) => p.paymentStatus === "UNPAID").length;
    const totalRevenue = projects.reduce((s, p) => s + Number(p.totalPrice), 0);
    const totalCollected = projects.reduce((s, p) => s + Number(p.deposit), 0);
    const uniqueClients = new Set(projects.map((p) => p.client.id)).size;
    return { total, completed, inProgress, unpaid, totalRevenue, totalCollected, uniqueClients };
  }, [projects]);

  /* ───── Actions ───── */
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
          designerId: form.designerId || undefined,
          serviceIds: form.serviceIds,
          notes: form.notes || undefined,
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to save");
      }

      setShowForm(false);
      resetForm();
      fetchProjects();
    } catch (err) {
      setError(err instanceof Error ? err.message : "An error occurred");
    }
    setSubmitting(false);
  };

  const handleEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!showEditForm) return;
    setSubmitting(true);
    setError("");

    try {
      const res = await fetch(`/api/projects/${showEditForm.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectName: form.projectName,
          workStatus: form.workStatus,
          designerId: form.designerId,
          notes: form.notes,
        }),
      });

      if (!res.ok) throw new Error("Failed to update");
      setShowEditForm(null);
      resetForm();
      fetchProjects();
    } catch (err) {
      setError(err instanceof Error ? err.message : "An error occurred");
    }
    setSubmitting(false);
  };

  const handleDelete = async (id: string) => {
    try {
      const res = await fetch(`/api/projects/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Failed to delete");
      setDeleteConfirm(null);
      fetchProjects();
    } catch (err) {
      console.error(err);
    }
  };

  const toggleComplete = async (project: Project) => {
    try {
      const res = await fetch(`/api/projects/${project.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ toggleComplete: true }),
      });
      if (!res.ok) throw new Error("Failed to toggle");
      fetchProjects();
    } catch (err) {
      console.error(err);
    }
  };

  const resetForm = () => {
    setForm({
      clientPhone: "", clientName: "", projectName: "",
      date: new Date().toISOString().split("T")[0],
      customServiceText: "", totalPrice: "", deposit: "",
      workStatus: "WAITING", designerId: "", serviceIds: [], notes: "",
    });
    setClientSuggestion(null);
    setError("");
  };

  const openEdit = (p: Project) => {
    setForm({
      clientPhone: p.client.phone,
      clientName: p.client.name,
      projectName: p.projectName,
      date: new Date(p.date).toISOString().split("T")[0],
      customServiceText: p.customServiceText || "",
      totalPrice: String(p.totalPrice),
      deposit: String(p.deposit),
      workStatus: p.workStatus,
      designerId: p.designer.id,
      serviceIds: p.services.map((s) => s.id),
      notes: p.notes || "",
    });
    setShowEditForm(p);
  };

  const toggleSort = (field: string) => {
    if (sortBy === field) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortBy(field); setSortDir("desc"); }
  };

  const toggleService = (id: string) => {
    setForm((f) => ({
      ...f,
      serviceIds: f.serviceIds.includes(id) ? f.serviceIds.filter((s) => s !== id) : [...f.serviceIds, id],
    }));
  };

  /* ───── Render ───── */
  return (
    <AppShell isAdmin={true} userName="Admin" activePage="clients">
      {/* Page Header */}
      <div style={{ marginBottom: 24 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 20 }}>
          <div>
            <h1 style={{ fontSize: 24, fontWeight: 700, color: "var(--text)", margin: 0 }}>
              Client Records
            </h1>
            <p style={{ fontSize: 13, color: "var(--muted)", margin: "4px 0 0" }}>
              Manage clients, projects, and service records
            </p>
          </div>
          <button
            className="btn btn-primary"
            onClick={() => { setShowForm(true); setError(""); resetForm(); }}
            style={{ display: "flex", alignItems: "center", gap: 6 }}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
            New Record
          </button>
        </div>

        {/* Stats Row */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 12, marginBottom: 20 }}>
          {[
            { label: "Total", value: stats.total, color: "var(--text)" },
            { label: "In Progress", value: stats.inProgress, color: "#3b82f6" },
            { label: "Completed", value: stats.completed, color: "#10b981" },
            { label: "Unpaid", value: stats.unpaid, color: "#ef4444" },
            { label: "Clients", value: stats.uniqueClients, color: "#8b5cf6" },
            { label: "Revenue", value: `${formatNum(stats.totalRevenue)} SAR`, color: "var(--brand)" },
          ].map((s) => (
            <div key={s.label} className="card" style={{ padding: "12px 16px", textAlign: "center" }}>
              <div style={{ fontSize: 20, fontWeight: 700, color: s.color }}>{s.value}</div>
              <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 2 }}>{s.label}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Filters */}
      <div className="filters-bar" style={{ marginBottom: 16, display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
        <div className="search-wrapper" style={{ flex: 1, minWidth: 200 }}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", width: 16, height: 16, color: "var(--muted)" }}>
            <circle cx="11" cy="11" r="8" /><path d="m21 21-4.35-4.35" />
          </svg>
          <input
            className="search-input"
            style={{ paddingLeft: 36, width: "100%" }}
            placeholder="Search by name, phone, or project..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <select className="filter-select" value={workStatusFilter} onChange={(e) => setWorkStatusFilter(e.target.value)}>
          <option value="">All Work Status</option>
          <option value="WAITING">⏳ Waiting</option>
          <option value="IN_PROGRESS">🔄 In Progress</option>
          <option value="COMPLETED">✅ Completed</option>
          <option value="PAUSED">⏸ Paused</option>
        </select>
        <select className="filter-select" value={paymentStatusFilter} onChange={(e) => setPaymentStatusFilter(e.target.value)}>
          <option value="">All Payment Status</option>
          <option value="FULL">✅ Paid</option>
          <option value="PARTIAL">⚠️ Partial</option>
          <option value="UNPAID">❌ Unpaid</option>
        </select>
        <select className="filter-select" value={tierFilter} onChange={(e) => setTierFilter(e.target.value)}>
          <option value="">All Clients</option>
          <option value="VIP">⭐ VIP</option>
          <option value="LOYAL">💙 Loyal</option>
          <option value="NORMAL">👤 Normal</option>
          <option value="DELINQUENT">⚠️ At Risk</option>
        </select>
      </div>

      {/* Table */}
      {loading ? (
        <div className="empty-state">
          <div className="empty-state-icon">⏳</div>
          <p>Loading records...</p>
        </div>
      ) : filteredProjects.length === 0 ? (
        <div className="empty-state">
          <div className="empty-state-icon">📋</div>
          <p>{projects.length === 0 ? "No records yet" : "No matching records"}</p>
          {projects.length === 0 && (
            <button className="btn btn-primary" style={{ marginTop: 16 }} onClick={() => { setShowForm(true); resetForm(); }}>
              Add first record
            </button>
          )}
        </div>
      ) : (
        <div className="table-container" style={{ overflow: "auto" }}>
          <table className="table" style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                {[
                  { key: "client", label: "Client" },
                  { key: "projectName", label: "Project" },
                  { key: "date", label: "Date" },
                  { key: "totalPrice", label: "Price" },
                  { key: "deposit", label: "Deposit" },
                  { key: "remaining", label: "Remaining" },
                  { key: "progress", label: "Progress" },
                  { key: "workStatus", label: "Work" },
                  { key: "paymentStatus", label: "Payment" },
                  { key: "designer", label: "Designer" },
                  { key: "tier", label: "Tier" },
                  { key: "actions", label: "" },
                ].map((col) => (
                  <th
                    key={col.key}
                    onClick={col.key !== "actions" && col.key !== "progress" ? () => toggleSort(col.key) : undefined}
                    style={{
                      cursor: col.key !== "actions" && col.key !== "progress" ? "pointer" : "default",
                      whiteSpace: "nowrap",
                      userSelect: "none",
                    }}
                  >
                    {col.label}
                    {sortBy === col.key && (
                      <span style={{ marginRight: 4 }}>{sortDir === "asc" ? "↑" : "↓"}</span>
                    )}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filteredProjects.map((p) => {
                const ws = WORK_STATUS[p.workStatus] || WORK_STATUS.WAITING;
                const ps = PAYMENT_STATUS[p.paymentStatus] || PAYMENT_STATUS.UNPAID;
                const tier = TIER_CONFIG[p.client.tier] || TIER_CONFIG.NORMAL;
                const depositPct = p.totalPrice > 0 ? Math.min(100, (Number(p.deposit) / Number(p.totalPrice)) * 100) : 0;
                const isDone = p.workStatus === "COMPLETED" && p.paymentStatus === "FULL";

                return (
                  <tr
                    key={p.id}
                    style={{
                      background: isDone ? "rgba(16,185,129,0.04)" : undefined,
                      borderLeft: isDone ? "3px solid #10b981" : "3px solid transparent",
                    }}
                  >
                    {/* Client */}
                    <td>
                      <div style={{ fontWeight: 600, fontSize: 13 }}>{p.client.name}</div>
                      <div style={{ fontSize: 11, color: "var(--muted)", direction: "ltr", textAlign: "left" }}>{p.client.phone}</div>
                      {p.client.isRepeatClient && (
                        <span style={{ fontSize: 10, color: "#8b5cf6", fontWeight: 600 }}>🔄 Repeat</span>
                      )}
                    </td>

                    {/* Project */}
                    <td>
                      <div style={{ fontWeight: 600, fontSize: 13 }}>{p.projectName}</div>
                      {p.services.length > 0 && (
                        <div style={{ fontSize: 11, color: "var(--muted)" }}>
                          {p.services.map((s) => s.name).join(", ")}
                        </div>
                      )}
                    </td>

                    {/* Date */}
                    <td style={{ whiteSpace: "nowrap", fontSize: 12, color: "var(--muted)" }}>
                      {formatDate(p.date)}
                    </td>

                    {/* Price */}
                    <td style={{ fontWeight: 700, fontSize: 13, direction: "ltr", textAlign: "right" }}>
                      {formatNum(Number(p.totalPrice))} <span style={{ fontSize: 10, color: "var(--muted)" }}>SAR</span>
                    </td>

                    {/* Deposit */}
                    <td style={{ fontSize: 13, direction: "ltr", textAlign: "right" }}>
                      {formatNum(Number(p.deposit))} <span style={{ fontSize: 10, color: "var(--muted)" }}>SAR</span>
                    </td>

                    {/* Remaining */}
                    <td style={{
                      fontWeight: 700,
                      fontSize: 13,
                      color: Number(p.remaining) > 0 ? "#ef4444" : "#10b981",
                      direction: "ltr",
                      textAlign: "right",
                    }}>
                      {formatNum(Number(p.remaining))} <span style={{ fontSize: 10 }}>SAR</span>
                    </td>

                    {/* Progress Bar */}
                    <td style={{ minWidth: 100 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                        <div style={{
                          flex: 1, height: 6, borderRadius: 3,
                          background: "var(--border)", overflow: "hidden",
                        }}>
                          <div style={{
                            height: "100%", borderRadius: 3,
                            width: `${depositPct}%`,
                            background: depositPct >= 100 ? "#10b981" : depositPct > 0 ? "#f59e0b" : "#ef4444",
                            transition: "width 0.3s",
                          }} />
                        </div>
                        <span style={{ fontSize: 10, color: "var(--muted)", whiteSpace: "nowrap" }}>
                          {Math.round(depositPct)}%
                        </span>
                      </div>
                    </td>

                    {/* Work Status — Toggle Button */}
                    <td>
                      <button
                        onClick={() => toggleComplete(p)}
                        style={{
                          display: "inline-flex", alignItems: "center", gap: 4,
                          padding: "4px 10px", borderRadius: 6, border: "none",
                          background: ws.color + "18", color: ws.color,
                          fontSize: 11, fontWeight: 600, cursor: "pointer",
                          transition: "all 0.2s",
                        }}
                        title={p.workStatus === "COMPLETED" ? "Mark as In Progress" : "Mark as Complete"}
                      >
                        {ws.icon} {ws.label}
                      </button>
                    </td>

                    {/* Payment Status */}
                    <td>
                      <span style={{
                        display: "inline-block", padding: "3px 8px", borderRadius: 6,
                        background: ps.color + "18", color: ps.color,
                        fontSize: 11, fontWeight: 600,
                      }}>
                        {ps.label}
                      </span>
                    </td>

                    {/* Designer */}
                    <td style={{ fontSize: 12, color: "var(--muted)" }}>
                      {p.designer.name}
                    </td>

                    {/* Tier */}
                    <td>
                      <span style={{
                        display: "inline-block", padding: "2px 8px", borderRadius: 6,
                        background: tier.bg, color: tier.color,
                        fontSize: 11, fontWeight: 700,
                      }}>
                        {p.client.projectCount > 1 && `${p.client.projectCount}× `}
                        {tier.label}
                      </span>
                    </td>

                    {/* Actions */}
                    <td>
                      <div style={{ display: "flex", gap: 4 }}>
                        <button
                          onClick={() => openEdit(p)}
                          style={{
                            padding: "4px 8px", borderRadius: 6, border: "none",
                            background: "var(--brand-pale)", color: "var(--brand-dark)",
                            fontSize: 11, cursor: "pointer", fontWeight: 600,
                          }}
                          title="Edit"
                        >
                          ✏️
                        </button>
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
      )}

      {/* Delete Confirmation Modal */}
      {deleteConfirm && (
        <div className="modal-overlay" onClick={(e) => { if (e.target === e.currentTarget) setDeleteConfirm(null); }}>
          <div className="modal" style={{ maxWidth: 400 }}>
            <div className="modal-header">
              <div className="modal-title">Confirm Delete</div>
            </div>
            <div className="modal-body">
              <p style={{ margin: 0, color: "var(--text)" }}>Are you sure you want to delete this record? This action cannot be undone.</p>
            </div>
            <div className="modal-footer">
              <button className="btn btn-danger" onClick={() => handleDelete(deleteConfirm)}>Delete</button>
              <button className="btn btn-secondary" onClick={() => setDeleteConfirm(null)}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      {/* Create Form Modal */}
      {showForm && (
        <div className="modal-overlay" onClick={(e) => { if (e.target === e.currentTarget) { setShowForm(false); resetForm(); } }}>
          <div className="modal" style={{ maxWidth: 640 }}>
            <div className="modal-header">
              <div className="modal-title">New Service Record</div>
              <button className="modal-close" onClick={() => { setShowForm(false); resetForm(); }}>✕</button>
            </div>
            <form onSubmit={handleSubmit}>
              <div className="modal-body">
                {error && <div className="error" style={{ marginBottom: 16 }}>{error}</div>}
                <div className="form-grid">
                  {/* Phone */}
                  <div className="field">
                    <label className="field-label">Phone Number *</label>
                    <input
                      required placeholder="05XXXXXXXX"
                      value={form.clientPhone}
                      dir="ltr" style={{ textAlign: "left" }}
                      onChange={(e) => { setForm((f) => ({ ...f, clientPhone: e.target.value })); setClientSuggestion(null); }}
                      onBlur={(e) => checkPhone(e.target.value)}
                    />
                    {checkingPhone && <span style={{ fontSize: 11, color: "var(--muted)" }}>Searching...</span>}
                    {clientSuggestion && (
                      <div style={{ padding: "6px 10px", background: "var(--brand-pale)", borderRadius: 6, fontSize: 12, color: "var(--brand-dark)" }}>
                        ✓ Existing client: <strong>{clientSuggestion.name}</strong> — {TIER_CONFIG[clientSuggestion.tier]?.label}
                        {clientSuggestion.isRepeatClient && " 🔄 Repeat"}
                      </div>
                    )}
                  </div>

                  {/* Client Name */}
                  <div className="field">
                    <label className="field-label">Client Name *</label>
                    <input
                      required placeholder="Client name"
                      value={form.clientName}
                      onChange={(e) => setForm((f) => ({ ...f, clientName: e.target.value }))}
                      readOnly={!!clientSuggestion}
                      style={clientSuggestion ? { background: "var(--paper)" } : {}}
                    />
                  </div>

                  {/* Project Name */}
                  <div className="field full-width">
                    <label className="field-label">Project Name *</label>
                    <input required placeholder="Project name" value={form.projectName}
                      onChange={(e) => setForm((f) => ({ ...f, projectName: e.target.value }))} />
                  </div>

                  {/* Date & Work Status */}
                  <div className="field">
                    <label className="field-label">Date *</label>
                    <input required type="date" value={form.date}
                      onChange={(e) => setForm((f) => ({ ...f, date: e.target.value }))} />
                  </div>
                  <div className="field">
                    <label className="field-label">Work Status</label>
                    <select value={form.workStatus} onChange={(e) => setForm((f) => ({ ...f, workStatus: e.target.value }))}>
                      <option value="WAITING">⏳ Waiting</option>
                      <option value="IN_PROGRESS">🔄 In Progress</option>
                      <option value="COMPLETED">✅ Completed</option>
                      <option value="PAUSED">⏸ Paused</option>
                    </select>
                  </div>

                  {/* Designer */}
                  <div className="field">
                    <label className="field-label">Designer</label>
                    <select value={form.designerId} onChange={(e) => setForm((f) => ({ ...f, designerId: e.target.value }))}>
                      <option value="">Select designer...</option>
                      {users.map((u) => (
                        <option key={u.id} value={u.id}>{u.name}</option>
                      ))}
                    </select>
                  </div>

                  {/* Prices */}
                  <div className="field">
                    <label className="field-label">Total Price (SAR) *</label>
                    <input required type="number" step="0.01" min="0" placeholder="0"
                      value={form.totalPrice} dir="ltr" style={{ textAlign: "right" }}
                      onChange={(e) => setForm((f) => ({ ...f, totalPrice: e.target.value }))} />
                  </div>
                  <div className="field">
                    <label className="field-label">Deposit (SAR)</label>
                    <input type="number" step="0.01" min="0" placeholder="0"
                      value={form.deposit} dir="ltr" style={{ textAlign: "right" }}
                      onChange={(e) => setForm((f) => ({ ...f, deposit: e.target.value }))} />
                  </div>
                  <div className="field">
                    <label className="field-label">Remaining (Auto)</label>
                    <input readOnly value={`${formatNum(remaining)} SAR`}
                      style={{ background: "var(--paper)", fontWeight: 700, color: remaining > 0 ? "#ef4444" : "#10b981", direction: "ltr", textAlign: "right" }} />
                  </div>

                  {/* Services */}
                  <div className="field full-width">
                    <label className="field-label">Services</label>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 4 }}>
                      {services.map((s) => (
                        <button key={s.id} type="button"
                          className={`btn btn-sm ${form.serviceIds.includes(s.id) ? "btn-primary" : "btn-secondary"}`}
                          onClick={() => toggleService(s.id)}>
                          {s.name}
                        </button>
                      ))}
                      {services.length === 0 && <span style={{ fontSize: 12, color: "var(--muted)" }}>No services registered</span>}
                    </div>
                  </div>

                  {/* Custom Service */}
                  <div className="field full-width">
                    <label className="field-label">Custom Service</label>
                    <input placeholder="Unlisted service name" value={form.customServiceText}
                      onChange={(e) => setForm((f) => ({ ...f, customServiceText: e.target.value }))} />
                  </div>

                  {/* Notes */}
                  <div className="field full-width">
                    <label className="field-label">Notes</label>
                    <textarea rows={2} placeholder="Additional notes..." value={form.notes}
                      onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} style={{ resize: "vertical" }} />
                  </div>
                </div>
              </div>
              <div className="modal-footer">
                <button className="btn btn-primary" type="submit" disabled={submitting}>
                  {submitting ? "Saving..." : "Save Record"}
                </button>
                <button className="btn btn-secondary" type="button" onClick={() => { setShowForm(false); resetForm(); }}>Cancel</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Edit Form Modal */}
      {showEditForm && (
        <div className="modal-overlay" onClick={(e) => { if (e.target === e.currentTarget) { setShowEditForm(null); resetForm(); } }}>
          <div className="modal" style={{ maxWidth: 560 }}>
            <div className="modal-header">
              <div className="modal-title">Edit Record — {showEditForm.projectName}</div>
              <button className="modal-close" onClick={() => { setShowEditForm(null); resetForm(); }}>✕</button>
            </div>
            <form onSubmit={handleEdit}>
              <div className="modal-body">
                {error && <div className="error" style={{ marginBottom: 16 }}>{error}</div>}

                {/* Client Info (readonly) */}
                <div style={{ padding: "10px 14px", background: "var(--paper)", borderRadius: 8, marginBottom: 16, display: "flex", gap: 20, fontSize: 13 }}>
                  <div><strong>Client:</strong> {showEditForm.client.name}</div>
                  <div style={{ direction: "ltr" }}><strong>Phone:</strong> {showEditForm.client.phone}</div>
                  <div><strong>Price:</strong> {formatNum(Number(showEditForm.totalPrice))} SAR</div>
                </div>

                <div className="form-grid">
                  <div className="field full-width">
                    <label className="field-label">Project Name</label>
                    <input required value={form.projectName}
                      onChange={(e) => setForm((f) => ({ ...f, projectName: e.target.value }))} />
                  </div>

                  <div className="field">
                    <label className="field-label">Work Status</label>
                    <select value={form.workStatus} onChange={(e) => setForm((f) => ({ ...f, workStatus: e.target.value }))}>
                      <option value="WAITING">⏳ Waiting</option>
                      <option value="IN_PROGRESS">🔄 In Progress</option>
                      <option value="COMPLETED">✅ Completed</option>
                      <option value="PAUSED">⏸ Paused</option>
                    </select>
                  </div>

                  <div className="field">
                    <label className="field-label">Designer</label>
                    <select value={form.designerId} onChange={(e) => setForm((f) => ({ ...f, designerId: e.target.value }))}>
                      {users.map((u) => (
                        <option key={u.id} value={u.id}>{u.name}</option>
                      ))}
                    </select>
                  </div>

                  <div className="field full-width">
                    <label className="field-label">Notes</label>
                    <textarea rows={2} value={form.notes}
                      onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} style={{ resize: "vertical" }} />
                  </div>
                </div>
              </div>
              <div className="modal-footer">
                <button className="btn btn-primary" type="submit" disabled={submitting}>
                  {submitting ? "Updating..." : "Update Record"}
                </button>
                <button className="btn btn-secondary" type="button" onClick={() => { setShowEditForm(null); resetForm(); }}>Cancel</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </AppShell>
  );
}
