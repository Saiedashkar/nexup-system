"use client";

import { useEffect, useState, useCallback, useMemo, useRef } from "react";

/* ───── Types ───── */
type Payment = { id: string; amount: number; date: string; note: string | null };
type ClientInfo = { id: string; name: string; phone: string; tier: string; projectCount: number; totalPaid: number; isRepeatClient: boolean };
type Project = { id: string; projectName: string; date: string; customServiceText: string | null; totalPrice: number; deposit: number; remaining: number; workStatus: string; paymentStatus: string; notes: string | null; createdAt: string; client: ClientInfo; designer: { id: string; name: string } | null; designerName: string | null; services: { id: string; name: string }[]; payments?: Payment[] };
type Service = { id: string; name: string; isCustom: boolean };
type User = { id: string; name: string; role: string };

/* ───── Constants ───── */
const WS_LIST = [
  { v: "WAITING", l: "Waiting", c: "#f59e0b", bg: "rgba(245,158,11,0.12)" },
  { v: "IN_PROGRESS", l: "In Progress", c: "#3b82f6", bg: "rgba(59,130,246,0.12)" },
  { v: "COMPLETED", l: "Done", c: "#10b981", bg: "rgba(16,185,129,0.12)" },
  { v: "PAUSED", l: "Paused", c: "#6b7280", bg: "rgba(107,114,128,0.1)" },
];
const WS_MAP = Object.fromEntries(WS_LIST.map(s => [s.v, s]));
const PS_MAP: Record<string, { l: string; c: string; bg: string }> = {
  FULL: { l: "Paid", c: "#10b981", bg: "rgba(16,185,129,0.12)" },
  PARTIAL: { l: "Partial", c: "#f59e0b", bg: "rgba(245,158,11,0.12)" },
  UNPAID: { l: "Unpaid", c: "#ef4444", bg: "rgba(239,68,68,0.12)" },
};
const TIER: Record<string, { l: string; c: string; bg: string }> = {
  VIP: { l: "VIP", c: "#f59e0b", bg: "rgba(245,158,11,0.12)" },
  LOYAL: { l: "Loyal", c: "#3b82f6", bg: "rgba(59,130,246,0.12)" },
  NORMAL: { l: "Normal", c: "#64748b", bg: "rgba(100,116,139,0.06)" },
  DELINQUENT: { l: "At Risk", c: "#ef4444", bg: "rgba(239,68,68,0.12)" },
};

function fmt(n: number) { return n.toLocaleString("en-US"); }
function fmtDate(d: string) { return new Date(d).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }); }
function monthKey(d: string) { const dt = new Date(d); return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}`; }
function monthLabel(d: string) { return new Date(d).toLocaleDateString("en-US", { month: "long", year: "numeric" }); }

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
    style={{ padding: "3px 6px", borderRadius: 4, border: "1px solid #0d9488", background: "var(--surface)", color: "var(--text)", fontSize: 12, outline: "none", width: "100%", ...style }} />;
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
              style={{ display: "block", width: "100%", padding: "5px 8px", borderRadius: 5, border: "none", textAlign: "left", background: status === s.v ? s.bg : "transparent", color: s.c, fontSize: 11, fontWeight: 600, cursor: "pointer" }}
              onMouseEnter={e => { if (status !== s.v) e.currentTarget.style.background = "var(--surface-hover)"; }}
              onMouseLeave={e => { if (status !== s.v) e.currentTarget.style.background = "transparent"; }}
            >{s.l}</button>
          ))}
        </div>
      )}
    </div>
  );
}

/* ═══ Designer Input — dropdown + free text ═══ */
function DesignerInput({ designerId, designerName, users, onSave }: { designerId: string | null; designerName: string | null; users: User[]; onSave: (id: string | null, name: string | null) => void }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(designerName || "");
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const displayName = designerName || (users.find(u => u.id === designerId)?.name) || "—";
  useEffect(() => { const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) { setOpen(false); setEditing(false); } }; document.addEventListener("mousedown", h); return () => document.removeEventListener("mousedown", h); }, []);
  if (!editing) return (
    <div ref={ref} onClick={() => { setEditing(true); setOpen(true); }}
      style={{ padding: "3px 6px", borderRadius: 4, cursor: "text", fontSize: 11, color: "var(--text-secondary)", transition: "background 0.1s" }}
      onMouseEnter={e => { e.currentTarget.style.background = "var(--surface-hover)"; }}
      onMouseLeave={e => { e.currentTarget.style.background = "transparent"; }}
      title="Click to edit designer">
      {displayName}
    </div>
  );
  return (
    <div ref={ref} style={{ position: "relative" }}>
      <input autoFocus value={draft} onChange={e => { setDraft(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        onBlur={() => { if (!draft) { onSave(null, null); } else { onSave(null, draft); } setEditing(false); setOpen(false); }}
        onKeyDown={e => { if (e.key === "Enter") { onSave(null, draft); setEditing(false); setOpen(false); } if (e.key === "Escape") { setEditing(false); setOpen(false); } }}
        placeholder="Type name..."
        style={{ padding: "3px 6px", borderRadius: 4, border: "1px solid #0d9488", background: "var(--surface)", color: "var(--text)", fontSize: 11, outline: "none", width: "100%" }}
      />
      {open && users.length > 0 && (
        <div style={{ position: "absolute", top: "100%", left: 0, right: 0, marginTop: 2, background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 6, padding: 2, zIndex: 100, maxHeight: 120, overflow: "auto", boxShadow: "0 4px 12px rgba(0,0,0,0.1)" }}>
          {users.filter(u => u.name.toLowerCase().includes(draft.toLowerCase())).map(u => (
            <button key={u.id} onMouseDown={e => { e.preventDefault(); onSave(u.id, null); setEditing(false); setOpen(false); }}
              style={{ display: "block", width: "100%", padding: "4px 8px", borderRadius: 4, border: "none", textAlign: "left", background: "transparent", color: "var(--text)", fontSize: 11, cursor: "pointer" }}
              onMouseEnter={e => { e.currentTarget.style.background = "var(--surface-hover)"; }}
              onMouseLeave={e => { e.currentTarget.style.background = "transparent"; }}
            >{u.name}</button>
          ))}
        </div>
      )}
    </div>
  );
}

/* ═══ Payment Button with inline amount input ═══ */
function PayButton({ remaining, projectId, onPay }: { remaining: number; projectId: string; onPay: (id: string, amount: number) => void }) {
  const [editing, setEditing] = useState(false);
  const [amount, setAmount] = useState("");
  if (remaining <= 0) return <span style={{ fontWeight: 700, color: "#10b981", fontSize: 12 }}>0 ✓</span>;
  if (!editing) return (
    <div style={{ display: "flex", alignItems: "center", gap: 3 }}>
      <span style={{ fontWeight: 700, color: "#ef4444", fontSize: 12 }}>{fmt(remaining)}</span>
      <button onClick={() => setEditing(true)} style={{ padding: "2px 6px", borderRadius: 4, border: "none", background: "rgba(16,185,129,0.12)", color: "#10b981", fontSize: 10, fontWeight: 600, cursor: "pointer" }} title="Pay partial amount">Pay</button>
      <button onClick={() => onPay(projectId, remaining)} style={{ padding: "2px 6px", borderRadius: 4, border: "none", background: "rgba(13,148,136,0.1)", color: "#0d9488", fontSize: 10, fontWeight: 600, cursor: "pointer" }} title="Pay full remaining">All</button>
    </div>
  );
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 2 }}>
      <input autoFocus type="number" min="1" max={remaining} step="1" value={amount} onChange={e => setAmount(e.target.value)}
        placeholder={`≤ ${fmt(remaining)}`}
        onKeyDown={e => { if (e.key === "Enter" && amount) { onPay(projectId, Math.min(parseFloat(amount), remaining)); setEditing(false); setAmount(""); } if (e.key === "Escape") { setEditing(false); setAmount(""); } }}
        style={{ width: 60, padding: "2px 4px", borderRadius: 4, border: "1px solid #0d9488", background: "var(--surface)", color: "var(--text)", fontSize: 11, outline: "none" }}
      />
      <button onClick={() => { if (amount) { onPay(projectId, Math.min(parseFloat(amount), remaining)); setEditing(false); setAmount(""); } }}
        style={{ padding: "2px 6px", borderRadius: 4, border: "none", background: "#0d9488", color: "#fff", fontSize: 10, fontWeight: 600, cursor: "pointer" }}>✓</button>
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
      <div onClick={onToggle} style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 14px", background: "linear-gradient(135deg, rgba(13,148,136,0.08) 0%, rgba(13,148,136,0.02) 100%)", cursor: "pointer", borderBottom: collapsed ? "none" : "1px solid var(--border)" }}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} width={12} height={12} style={{ color: "#0d9488", transform: collapsed ? "rotate(-90deg)" : "rotate(0)", transition: "transform 0.2s", flexShrink: 0 }}><path d="M6 9l6 6 6-6" /></svg>
        <span style={{ fontSize: 13, fontWeight: 800, color: "var(--text)" }}>{label}</span>
        <span style={{ fontSize: 9, fontWeight: 600, padding: "2px 7px", borderRadius: 10, background: "rgba(13,148,136,0.1)", color: "#0d9488" }}>
          {count} record{count !== 1 ? "s" : ""}
        </span>
        {paidCount > 0 && (
          <span style={{ fontSize: 9, fontWeight: 600, padding: "2px 7px", borderRadius: 10, background: "rgba(16,185,129,0.1)", color: "#10b981" }}>
            {paidCount} paid
          </span>
        )}
        <span style={{ flex: 1 }} />
        {collapsed && (
          <div style={{ display: "flex", alignItems: "center", gap: 16, marginRight: 8 }}>
            <div style={{ textAlign: "center" }}>
              <div style={{ fontSize: 8, color: "var(--muted)", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 1 }}>Total</div>
              <div style={{ fontSize: 13, fontWeight: 800, color: "var(--text)", direction: "ltr" }}>{fmt(totalRevenue)} <span style={{ fontSize: 9, color: "var(--muted)" }}>SAR</span></div>
            </div>
            <div style={{ width: 1, height: 20, background: "var(--border)" }} />
            <div style={{ textAlign: "center" }}>
              <div style={{ fontSize: 8, color: "var(--muted)", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 1 }}>Collected</div>
              <div style={{ fontSize: 13, fontWeight: 800, color: "#10b981", direction: "ltr" }}>{fmt(totalCollected)} <span style={{ fontSize: 9, color: "var(--muted)" }}>SAR</span></div>
            </div>
            <div style={{ width: 1, height: 20, background: "var(--border)" }} />
            <div style={{ textAlign: "center" }}>
              <div style={{ fontSize: 8, color: "var(--muted)", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 1 }}>Remaining</div>
              <div style={{ fontSize: 13, fontWeight: 800, color: totalRemaining > 0 ? "#ef4444" : "#10b981", direction: "ltr" }}>{fmt(totalRemaining)} <span style={{ fontSize: 9, color: "var(--muted)" }}>SAR</span></div>
            </div>
          </div>
        )}
        {!collapsed && (
          <span style={{ fontSize: 11, color: "var(--muted)", direction: "ltr" }}>
            {fmt(totalCollected)} / {fmt(totalRevenue)} SAR collected
          </span>
        )}
      </div>
    </div>
  );
}

/* ═══ Payment Details Modal ═══ */
function PaymentDetailsModal({ project, onClose, onAddPayment, onDeletePayment }: { project: Project; onClose: () => void; onAddPayment: (id: string, amount: number, note: string) => void; onDeletePayment: (id: string) => void }) {
  const [addAmount, setAddAmount] = useState("");
  const [addNote, setAddNote] = useState("");
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const payments = project.payments || [];
  const totalPaid = payments.reduce((s, p) => s + Number(p.amount), 0);
  const remaining = Number(project.totalPrice) - totalPaid;

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000 }} onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={{ background: "var(--surface)", borderRadius: 14, maxWidth: 520, width: "95%", border: "1px solid var(--border)" }}>
        <div style={{ padding: "16px 20px", borderBottom: "1px solid var(--border)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <h3 style={{ fontSize: 15, fontWeight: 700, color: "var(--text)", margin: 0 }}>Payment Details</h3>
            <p style={{ fontSize: 11, color: "var(--muted)", margin: "2px 0 0" }}>{project.client.name} — {project.projectName}</p>
          </div>
          <button onClick={onClose} style={{ width: 28, height: 28, borderRadius: 6, border: "none", background: "var(--surface-hover)", color: "var(--muted)", fontSize: 14, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>✕</button>
        </div>

        {/* Summary */}
        <div style={{ padding: "12px 20px", display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
          {[
            { l: "Total Price", v: `${fmt(Number(project.totalPrice))} SAR`, c: "var(--text)" },
            { l: "Total Paid", v: `${fmt(totalPaid)} SAR`, c: "#10b981" },
            { l: "Remaining", v: `${fmt(remaining)} SAR`, c: remaining > 0 ? "#ef4444" : "#10b981" },
          ].map(s => (
            <div key={s.l} style={{ padding: "8px 10px", borderRadius: 6, background: "var(--surface-hover)", textAlign: "center" }}>
              <div style={{ fontSize: 14, fontWeight: 800, color: s.c }}>{s.v}</div>
              <div style={{ fontSize: 9, color: "var(--muted)", marginTop: 1 }}>{s.l}</div>
            </div>
          ))}
        </div>

        {/* Payment list */}
        <div style={{ padding: "0 20px 12px", maxHeight: 260, overflow: "auto" }}>
          {payments.length === 0 ? (
            <div style={{ textAlign: "center", padding: 20, color: "var(--muted)", fontSize: 12 }}>No payments yet.</div>
          ) : (
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
              <thead>
                <tr style={{ color: "var(--muted)", fontSize: 9, fontWeight: 600, textTransform: "uppercase" }}>
                  <th style={{ textAlign: "left", padding: "4px 6px" }}>Date</th>
                  <th style={{ textAlign: "left", padding: "4px 6px" }}>Amount (SAR)</th>
                  <th style={{ textAlign: "left", padding: "4px 6px" }}>Note</th>
                  <th style={{ textAlign: "center", padding: "4px 6px", width: 50 }}></th>
                </tr>
              </thead>
              <tbody>
                {payments.map((p, i) => (
                  <tr key={p.id} style={{ borderBottom: "1px solid var(--border)" }}>
                    <td style={{ padding: "5px 6px", color: "var(--text-secondary)" }}>{fmtDate(p.date)}</td>
                    <td style={{ padding: "5px 6px", fontWeight: 700, color: "#10b981" }}>{fmt(Number(p.amount))}</td>
                    <td style={{ padding: "5px 6px", color: "var(--muted)" }}>{p.note || "—"}</td>
                    <td style={{ padding: "5px 6px", textAlign: "center" }}>
                      {confirmDelete === p.id ? (
                        <div style={{ display: "flex", gap: 2, justifyContent: "center" }}>
                          <button onClick={() => { onDeletePayment(p.id); setConfirmDelete(null); }} style={{ padding: "2px 6px", borderRadius: 3, border: "none", background: "#ef4444", color: "#fff", fontSize: 9, fontWeight: 600, cursor: "pointer" }}>Yes</button>
                          <button onClick={() => setConfirmDelete(null)} style={{ padding: "2px 6px", borderRadius: 3, border: "1px solid var(--border)", background: "transparent", color: "var(--muted)", fontSize: 9, cursor: "pointer" }}>No</button>
                        </div>
                      ) : (
                        <button onClick={() => setConfirmDelete(p.id)} style={{ padding: "2px 5px", borderRadius: 3, border: "1px solid rgba(239,68,68,0.2)", background: "transparent", color: "#ef4444", fontSize: 10, cursor: "pointer" }}>🗑</button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* Add payment form */}
        {remaining > 0 && (
          <div style={{ padding: "12px 20px", borderTop: "1px solid var(--border)", display: "flex", gap: 8, alignItems: "flex-end" }}>
            <div style={{ flex: 1 }}>
              <label style={{ fontSize: 9, fontWeight: 600, color: "var(--muted)" }}>Amount</label>
              <input type="number" min="1" max={remaining} value={addAmount} onChange={e => setAddAmount(e.target.value)}
                placeholder={`≤ ${fmt(remaining)}`}
                style={{ width: "100%", padding: "6px 8px", borderRadius: 5, border: "1px solid var(--border)", background: "var(--surface)", color: "var(--text)", fontSize: 12, outline: "none", marginTop: 2 }}
              />
            </div>
            <div style={{ flex: 1 }}>
              <label style={{ fontSize: 9, fontWeight: 600, color: "var(--muted)" }}>Note</label>
              <input value={addNote} onChange={e => setAddNote(e.target.value)} placeholder="Optional"
                style={{ width: "100%", padding: "6px 8px", borderRadius: 5, border: "1px solid var(--border)", background: "var(--surface)", color: "var(--text)", fontSize: 12, outline: "none", marginTop: 2 }}
              />
            </div>
            <button onClick={() => { if (addAmount) { onAddPayment(project.id, Math.min(parseFloat(addAmount), remaining), addNote); setAddAmount(""); setAddNote(""); } }}
              style={{ padding: "6px 14px", borderRadius: 6, border: "none", background: "#0d9488", color: "#fff", fontSize: 11, fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap" }}>Add</button>
          </div>
        )}
      </div>
    </div>
  );
}

/* ═══ Edit Modal ═══ */
function EditModal({ project, users, services, onClose, onSave }: { project: Project; users: User[]; services: Service[]; onClose: () => void; onSave: (data: Record<string, unknown>) => void }) {
  const [form, setForm] = useState({
    projectName: project.projectName,
    date: project.date.split("T")[0],
    totalPrice: String(project.totalPrice),
    deposit: String(project.deposit),
    workStatus: project.workStatus,
    designerName: project.designerName || project.designer?.name || "",
    notes: project.notes || "",
  });
  const remaining = form.totalPrice && form.deposit ? Math.max(0, parseFloat(form.totalPrice) - parseFloat(form.deposit || "0")) : 0;

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000 }} onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={{ background: "var(--surface)", borderRadius: 14, maxWidth: 520, width: "95%", border: "1px solid var(--border)" }}>
        <div style={{ padding: "16px 20px", borderBottom: "1px solid var(--border)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <h3 style={{ fontSize: 15, fontWeight: 700, color: "var(--text)", margin: 0 }}>Edit Record</h3>
            <p style={{ fontSize: 11, color: "var(--muted)", margin: "2px 0 0" }}>{project.client.name} — {project.projectName}</p>
          </div>
          <button onClick={onClose} style={{ width: 28, height: 28, borderRadius: 6, border: "none", background: "var(--surface-hover)", color: "var(--muted)", fontSize: 14, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>✕</button>
        </div>
        <div style={{ padding: "16px 20px" }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <div style={{ gridColumn: "1 / -1" }}>
              <label style={{ fontSize: 10, fontWeight: 600, color: "var(--muted)" }}>Project Name</label>
              <input value={form.projectName} onChange={e => setForm(f => ({ ...f, projectName: e.target.value }))}
                style={{ width: "100%", padding: "7px 10px", borderRadius: 6, border: "1px solid var(--border)", background: "var(--surface)", color: "var(--text)", fontSize: 12, outline: "none", marginTop: 3 }} />
            </div>
            <div>
              <label style={{ fontSize: 10, fontWeight: 600, color: "var(--muted)" }}>Date</label>
              <input type="date" value={form.date} onChange={e => setForm(f => ({ ...f, date: e.target.value }))}
                style={{ width: "100%", padding: "7px 10px", borderRadius: 6, border: "1px solid var(--border)", background: "var(--surface)", color: "var(--text)", fontSize: 12, outline: "none", marginTop: 3 }} />
            </div>
            <div>
              <label style={{ fontSize: 10, fontWeight: 600, color: "var(--muted)" }}>Total Price (SAR)</label>
              <input type="number" value={form.totalPrice} onChange={e => setForm(f => ({ ...f, totalPrice: e.target.value }))} dir="ltr"
                style={{ width: "100%", padding: "7px 10px", borderRadius: 6, border: "1px solid var(--border)", background: "var(--surface)", color: "var(--text)", fontSize: 12, outline: "none", marginTop: 3, textAlign: "right" }} />
            </div>
            <div>
              <label style={{ fontSize: 10, fontWeight: 600, color: "var(--muted)" }}>Deposit (SAR)</label>
              <input type="number" value={form.deposit} onChange={e => setForm(f => ({ ...f, deposit: e.target.value }))} dir="ltr"
                style={{ width: "100%", padding: "7px 10px", borderRadius: 6, border: "1px solid var(--border)", background: "var(--surface)", color: "var(--text)", fontSize: 12, outline: "none", marginTop: 3, textAlign: "right" }} />
            </div>
            <div style={{ gridColumn: "1 / -1", display: "flex", alignItems: "center", gap: 8 }}>
              <label style={{ fontSize: 10, fontWeight: 600, color: "var(--muted)" }}>Remaining</label>
              <span style={{ fontWeight: 700, fontSize: 12, color: remaining > 0 ? "#ef4444" : "#10b981" }}>{fmt(remaining)} SAR</span>
            </div>
            <div>
              <label style={{ fontSize: 10, fontWeight: 600, color: "var(--muted)" }}>Work Status</label>
              <select value={form.workStatus} onChange={e => setForm(f => ({ ...f, workStatus: e.target.value }))}
                style={{ width: "100%", padding: "7px 10px", borderRadius: 6, border: "1px solid var(--border)", background: "var(--surface)", color: "var(--text)", fontSize: 12, outline: "none", marginTop: 3 }}>
                <option value="WAITING">⏳ Waiting</option>
                <option value="IN_PROGRESS">🔄 In Progress</option>
                <option value="COMPLETED">✅ Done</option>
                <option value="PAUSED">⏸ Paused</option>
              </select>
            </div>
            <div>
              <label style={{ fontSize: 10, fontWeight: 600, color: "var(--muted)" }}>Designer</label>
              <input value={form.designerName} onChange={e => setForm(f => ({ ...f, designerName: e.target.value }))} list="edit-designer-list"
                style={{ width: "100%", padding: "7px 10px", borderRadius: 6, border: "1px solid var(--border)", background: "var(--surface)", color: "var(--text)", fontSize: 12, outline: "none", marginTop: 3 }} />
              <datalist id="edit-designer-list">{users.map(u => <option key={u.id} value={u.name} />)}</datalist>
            </div>
            <div style={{ gridColumn: "1 / -1" }}>
              <label style={{ fontSize: 10, fontWeight: 600, color: "var(--muted)" }}>Notes</label>
              <textarea rows={2} value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
                style={{ width: "100%", padding: "7px 10px", borderRadius: 6, border: "1px solid var(--border)", background: "var(--surface)", color: "var(--text)", fontSize: 12, outline: "none", marginTop: 3, resize: "vertical" }} />
            </div>
          </div>
        </div>
        <div style={{ padding: "12px 20px", borderTop: "1px solid var(--border)", display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <button onClick={onClose} style={{ padding: "8px 16px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--surface)", color: "var(--text)", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>Cancel</button>
          <button onClick={() => onSave({
            projectName: form.projectName,
            date: form.date,
            totalPrice: parseFloat(form.totalPrice) || Number(project.totalPrice),
            workStatus: form.workStatus,
            designerName: form.designerName || null,
            notes: form.notes || null,
          })} style={{ padding: "8px 18px", borderRadius: 8, border: "none", background: "#0d9488", color: "#fff", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>Save</button>
        </div>
      </div>
    </div>
  );
}

/* ═══════════════════════ MAIN PAGE ═══════════════════════ */
export default function NexupClientsPage() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [services, setServices] = useState<Service[]>([]);
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
  const [form, setForm] = useState({ clientPhone: "", clientName: "", projectName: "", date: new Date().toISOString().split("T")[0], customServiceText: "", totalPrice: "", deposit: "", workStatus: "WAITING", designerId: "", designerName: "", serviceIds: [] as string[], notes: "" });
  const [clientSuggestion, setClientSuggestion] = useState<ClientInfo | null>(null);
  const [paymentModal, setPaymentModal] = useState<Project | null>(null);
  const [editModal, setEditModal] = useState<Project | null>(null);

  const fetchProjects = useCallback(async () => {
    setLoading(true);
    const p = new URLSearchParams();
    if (search) p.set("search", search);
    if (wsFilter) p.set("workStatus", wsFilter);
    if (psFilter) p.set("paymentStatus", psFilter);
    try { const r = await fetch(`/api/nexup/projects?${p}`); if (r.ok) setProjects(await r.json()); } catch {}
    setLoading(false);
  }, [search, wsFilter, psFilter]);

  const fetchMeta = async () => { try { const [s, u] = await Promise.all([fetch("/api/services"), fetch("/api/users")]); if (s.ok) setServices(await s.json()); if (u.ok) setUsers(await s.json()); } catch {} };
  useEffect(() => { fetchProjects(); }, [fetchProjects]);
  useEffect(() => { fetchMeta(); }, []);

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
    total: projects.length, inProgress: projects.filter(p => p.workStatus === "IN_PROGRESS").length,
    completed: projects.filter(p => p.workStatus === "COMPLETED").length, unpaid: projects.filter(p => p.paymentStatus === "UNPAID").length,
    clients: new Set(projects.map(p => p.client.id)).size, revenue: projects.reduce((s, p) => s + Number(p.totalPrice), 0),
    totalCollected: projects.reduce((s, p) => s + Number(p.deposit), 0),
    totalRemaining: projects.reduce((s, p) => s + Number(p.remaining), 0),
  }), [projects]);

  const remaining = form.totalPrice && form.deposit ? parseFloat(form.totalPrice) - parseFloat(form.deposit || "0") : form.totalPrice ? parseFloat(form.totalPrice) : 0;

  const patchProject = async (id: string, data: Record<string, unknown>) => {
    try { const r = await fetch(`/api/projects/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) }); if (r.ok) fetchProjects(); } catch {}
  };

  const handlePayPartial = async (id: string, amount: number) => {
    try {
      const r = await fetch("/api/client-payments", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ projectRecordId: id, amount, note: "Table quick pay" }) });
      if (r.ok) { fetchProjects(); if (paymentModal) { const updated = projects.find(p => p.id === id); if (updated) setPaymentModal({ ...updated, payments: [...(updated.payments || []), { id: "temp", amount, date: new Date().toISOString(), note: "Table quick pay" }] }); } }
    } catch {}
  };

  const handleAddPayment = async (projectId: string, amount: number, note: string) => {
    try {
      const r = await fetch("/api/client-payments", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ projectRecordId: projectId, amount, note: note || undefined }) });
      if (r.ok) fetchProjects();
    } catch {}
  };

  const handleDeletePayment = async (paymentId: string) => {
    try { await fetch(`/api/client-payments/${paymentId}`, { method: "DELETE" }); fetchProjects(); } catch {}
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault(); setSubmitting(true); setError("");
    try {
      const r = await fetch("/api/projects", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientId: clientSuggestion?.id, clientPhone: form.clientPhone, clientName: form.clientName, projectName: form.projectName, date: form.date, customServiceText: form.customServiceText || undefined, totalPrice: parseFloat(form.totalPrice), deposit: parseFloat(form.deposit || "0"), workStatus: form.workStatus, designerId: form.designerId || undefined, designerName: form.designerName || undefined, serviceIds: form.serviceIds, notes: form.notes || undefined }) });
      if (!r.ok) { const d = await r.json(); throw new Error(d.error || "Failed"); }
      setShowForm(false); resetForm(); fetchProjects();
    } catch (err) { setError(err instanceof Error ? err.message : "Error"); }
    setSubmitting(false);
  };

  const handleDelete = async (id: string) => { try { await fetch(`/api/projects/${id}`, { method: "DELETE" }); setDeleteConfirm(null); fetchProjects(); } catch {} };

  const handleEditSave = async (data: Record<string, unknown>) => {
    if (!editModal) return;
    await patchProject(editModal.id, data);
    setEditModal(null);
  };

  const resetForm = () => { setForm({ clientPhone: "", clientName: "", projectName: "", date: new Date().toISOString().split("T")[0], customServiceText: "", totalPrice: "", deposit: "", workStatus: "WAITING", designerId: "", designerName: "", serviceIds: [], notes: "" }); setClientSuggestion(null); setError(""); };

  const toggleMonth = (key: string) => { setCollapsedMonths(prev => { const n = new Set(prev); n.has(key) ? n.delete(key) : n.add(key); return n; }); };

  const getDesignerDisplay = (p: Project) => p.designerName || p.designer?.name || "—";

  return (
    <div>
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 16 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 800, color: "var(--text)", margin: 0 }}>Clients</h1>
          <p style={{ fontSize: 12, color: "var(--muted)", margin: "3px 0 0" }}>Manage client records & service projects</p>
        </div>
        <button onClick={() => { setShowForm(true); resetForm(); }} style={{ display: "flex", alignItems: "center", gap: 5, padding: "9px 16px", borderRadius: 8, background: "#0d9488", color: "#fff", border: "none", fontSize: 12, fontWeight: 600, cursor: "pointer", boxShadow: "0 2px 6px rgba(13,148,136,0.3)" }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
          New Record +
        </button>
      </div>

      {/* Stats */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(6, 1fr)", gap: 10, marginBottom: 16 }}>
        {[{ l: "Total", v: stats.total, c: "var(--text)" }, { l: "In Progress", v: stats.inProgress, c: "#3b82f6" }, { l: "Completed", v: stats.completed, c: "#10b981" }, { l: "Unpaid", v: stats.unpaid, c: "#ef4444" }, { l: "Clients", v: stats.clients, c: "#8b5cf6" }, { l: "Revenue", v: `${fmt(stats.revenue)} SAR`, c: "#0d9488" }].map(s => (
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
          <input placeholder="Search..." value={search} onChange={e => setSearch(e.target.value)} style={{ width: "100%", padding: "7px 10px 7px 30px", borderRadius: 6, border: "1px solid var(--border)", background: "var(--surface)", color: "var(--text)", fontSize: 12, outline: "none" }} />
        </div>
        <select value={wsFilter} onChange={e => setWsFilter(e.target.value)} style={{ padding: "7px 10px", borderRadius: 6, border: "1px solid var(--border)", background: "var(--surface)", color: "var(--text)", fontSize: 11, outline: "none" }}>
          <option value="">All Work</option><option value="WAITING">⏳ Waiting</option><option value="IN_PROGRESS">🔄 In Progress</option><option value="COMPLETED">✅ Done</option><option value="PAUSED">⏸ Paused</option>
        </select>
        <select value={psFilter} onChange={e => setPsFilter(e.target.value)} style={{ padding: "7px 10px", borderRadius: 6, border: "1px solid var(--border)", background: "var(--surface)", color: "var(--text)", fontSize: 11, outline: "none" }}>
          <option value="">All Payment</option><option value="FULL">✅ Paid</option><option value="PARTIAL">⚠️ Partial</option><option value="UNPAID">❌ Unpaid</option>
        </select>
      </div>

      {/* Table */}
      {loading ? <div style={{ textAlign: "center", padding: 40, color: "var(--muted)" }}>Loading...</div>
        : projects.length === 0 ? <div style={{ textAlign: "center", padding: 40 }}><div style={{ fontSize: 36, marginBottom: 8 }}>📋</div><p style={{ color: "var(--muted)", fontSize: 13 }}>No records yet.</p><button onClick={() => { setShowForm(true); resetForm(); }} style={{ marginTop: 10, padding: "8px 16px", borderRadius: 8, background: "#0d9488", color: "#fff", border: "none", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>Add First</button></div>
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
                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12, minWidth: 1100 }}>
                    <thead>
                      <tr style={{ background: "linear-gradient(135deg, rgba(13,148,136,0.06) 0%, transparent 100%)" }}>
                        {[{ l: "Date", ar: "التاريخ", w: 85 }, { l: "Phone", ar: "الهاتف", w: 100 }, { l: "Client", ar: "العميل", w: 100 }, { l: "Project", ar: "المشروع", w: 120 }, { l: "Services", ar: "الخدمات", w: 90 }, { l: "Price", ar: "السعر", w: 70 }, { l: "Deposit", ar: "العربون", w: 65 }, { l: "Remaining", ar: "المتبقي", w: 130 }, { l: "Designer", ar: "المصمم", w: 90 }, { l: "Work", ar: "الحالة", w: 95 }, { l: "Status", ar: "الدفع", w: 60 }, { l: "Notes", ar: "ملاحظات", w: 100 }, { l: "", ar: "", w: 60 }].map((c, i) => (
                          <th key={i} style={{ padding: "7px 8px", width: c.w, textAlign: "left", borderBottom: "2px solid var(--border)" }}>
                            <div style={{ fontSize: 10, fontWeight: 700, color: "var(--text)", letterSpacing: "0.02em" }}>{c.l}</div>
                            {c.ar && <div style={{ fontSize: 8, fontWeight: 500, color: "var(--muted)", marginTop: 1 }}>{c.ar}</div>}
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
                          }}
                            onMouseEnter={e => { if (!isDone) e.currentTarget.style.background = "var(--surface-hover)"; }}
                            onMouseLeave={e => { if (!isDone) e.currentTarget.style.background = "var(--surface)"; }}
                          >
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
                                {p.services.map(s => <span key={s.id} style={{ padding: "1px 5px", borderRadius: 3, fontSize: 9, fontWeight: 600, background: "rgba(13,148,136,0.08)", color: "#0d9488" }}>{s.name}</span>)}
                                {p.services.length === 0 && <span style={{ fontSize: 9, color: "var(--muted)" }}>{p.customServiceText || "—"}</span>}
                              </div>
                            </td>
                            <td style={{ padding: "5px 8px", fontWeight: 700, direction: "ltr", textAlign: "left", fontSize: 12 }}>{fmt(Number(p.totalPrice))}</td>
                            <td style={{ padding: "5px 8px", direction: "ltr", textAlign: "left", color: "var(--text-secondary)", fontSize: 12 }}>{fmt(Number(p.deposit))}</td>
                            <td style={{ padding: "5px 8px", direction: "ltr", textAlign: "left" }}>
                              <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                                <PayButton remaining={Number(p.remaining)} projectId={p.id} onPay={handlePayPartial} />
                                {(p.payments && p.payments.length > 0) && (
                                  <button onClick={() => setPaymentModal(p)} style={{ padding: "2px 5px", borderRadius: 3, border: "1px solid var(--border)", background: "transparent", color: "var(--muted)", fontSize: 9, cursor: "pointer" }} title="View payment history">📄 {p.payments.length}</button>
                                )}
                              </div>
                            </td>
                            <td style={{ padding: "5px 8px" }}>
                              <DesignerInput designerId={p.designer?.id || null} designerName={p.designerName} users={users}
                                onSave={(id, name) => patchProject(p.id, { designerId: id, designerName: name })} />
                            </td>
                            <td style={{ padding: "5px 8px" }}><WSToggle status={p.workStatus} onToggle={next => patchProject(p.id, { workStatus: next })} /></td>
                            <td style={{ padding: "5px 8px" }}>
                              <span style={{ padding: "2px 6px", borderRadius: 4, background: ps.bg, color: ps.c, fontSize: 10, fontWeight: 600 }}>{ps.l}</span>
                            </td>
                            <td style={{ padding: "5px 8px" }}><InlineText value={p.notes || ""} onSave={v => patchProject(p.id, { notes: v || null })} placeholder="note..." style={{ fontSize: 10, color: "var(--muted)" }} /></td>
                            <td style={{ padding: "5px 4px", textAlign: "center" }}>
                              <div style={{ display: "flex", gap: 3, justifyContent: "center" }}>
                                <button onClick={() => setEditModal(p)} style={{ padding: "3px 6px", borderRadius: 4, border: "1px solid var(--border)", background: "transparent", color: "var(--muted)", fontSize: 11, cursor: "pointer" }} title="Edit">✏️</button>
                                {deleteConfirm === p.id ? (
                                  <div style={{ display: "flex", gap: 2, justifyContent: "center" }}>
                                    <button onClick={() => handleDelete(p.id)} style={{ padding: "3px 6px", borderRadius: 4, border: "none", background: "#ef4444", color: "#fff", fontSize: 9, fontWeight: 600, cursor: "pointer" }}>OK</button>
                                    <button onClick={() => setDeleteConfirm(null)} style={{ padding: "3px 6px", borderRadius: 4, border: "1px solid var(--border)", background: "transparent", color: "var(--muted)", fontSize: 9, cursor: "pointer" }}>No</button>
                                  </div>
                                ) : (
                                  <button onClick={() => setDeleteConfirm(p.id)} style={{ padding: "3px 6px", borderRadius: 4, border: "1px solid rgba(239,68,68,0.2)", background: "rgba(239,68,68,0.05)", color: "#ef4444", fontSize: 11, cursor: "pointer" }} title="Delete">🗑</button>
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
          <div style={{ textAlign: "center" }}>
            <div style={{ fontSize: 9, color: "var(--muted)", fontWeight: 600, textTransform: "uppercase" }}>Total Price</div>
            <div style={{ fontSize: 16, fontWeight: 800, color: "var(--text)" }}>{fmt(stats.revenue)} SAR</div>
          </div>
          <div style={{ textAlign: "center" }}>
            <div style={{ fontSize: 9, color: "var(--muted)", fontWeight: 600, textTransform: "uppercase" }}>Collected</div>
            <div style={{ fontSize: 16, fontWeight: 800, color: "#10b981" }}>{fmt(stats.totalCollected)} SAR</div>
          </div>
          <div style={{ textAlign: "center" }}>
            <div style={{ fontSize: 9, color: "var(--muted)", fontWeight: 600, textTransform: "uppercase" }}>Remaining</div>
            <div style={{ fontSize: 16, fontWeight: 800, color: stats.totalRemaining > 0 ? "#ef4444" : "#10b981" }}>{fmt(stats.totalRemaining)} SAR</div>
          </div>
        </div>
      )}

      {/* Payment Details Modal */}
      {paymentModal && (
        <PaymentDetailsModal project={paymentModal} onClose={() => setPaymentModal(null)} onAddPayment={handleAddPayment} onDeletePayment={handleDeletePayment} />
      )}

      {/* Edit Modal */}
      {editModal && (
        <EditModal project={editModal} users={users} services={services} onClose={() => setEditModal(null)} onSave={handleEditSave} />
      )}

      {/* Create Form Modal */}
      {showForm && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000 }} onClick={e => { if (e.target === e.currentTarget) { setShowForm(false); resetForm(); } }}>
          <div style={{ background: "var(--surface)", borderRadius: 14, maxWidth: 620, width: "95%", maxHeight: "90vh", overflow: "auto", border: "1px solid var(--border)" }}>
            <div style={{ padding: "18px 24px", borderBottom: "1px solid var(--border)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div>
                <h3 style={{ fontSize: 16, fontWeight: 700, color: "var(--text)", margin: 0 }}>New Service Record</h3>
                <p style={{ fontSize: 11, color: "var(--muted)", margin: "2px 0 0" }}>Add client and project details</p>
              </div>
              <button onClick={() => { setShowForm(false); resetForm(); }} style={{ width: 28, height: 28, borderRadius: 6, border: "none", background: "var(--surface-hover)", color: "var(--muted)", fontSize: 14, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>✕</button>
            </div>
            <form onSubmit={handleSubmit}>
              <div style={{ padding: "20px 24px" }}>
                {error && <div style={{ padding: "10px 14px", borderRadius: 8, background: "rgba(239,68,68,0.1)", color: "#ef4444", fontSize: 12, marginBottom: 14 }}>{error}</div>}

                {/* Client Info */}
                <div style={{ marginBottom: 18 }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: "var(--text)", marginBottom: 10, display: "flex", alignItems: "center", gap: 6 }}>
                    <span style={{ width: 20, height: 20, borderRadius: 5, background: "rgba(59,130,246,0.1)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 10 }}>👤</span>
                    Client Info
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
                    <div>
                      <label style={{ display: "block", fontSize: 10, fontWeight: 600, color: "var(--muted)", marginBottom: 3 }}>Phone *</label>
                      <input required placeholder="05XXXXXXXX" value={form.clientPhone} dir="ltr" style={{ width: "100%", padding: "8px 10px", borderRadius: 6, border: "1px solid var(--border)", background: "var(--surface)", color: "var(--text)", fontSize: 12, outline: "none" }} onChange={e => { setForm(f => ({ ...f, clientPhone: e.target.value })); setClientSuggestion(null); }} onBlur={e => checkPhone(e.target.value)} />
                      {clientSuggestion && <div style={{ marginTop: 4, padding: "4px 8px", borderRadius: 4, background: "rgba(13,148,136,0.08)", fontSize: 10, color: "#0d9488" }}>✓ {clientSuggestion.name} ({clientSuggestion.projectCount} prev. projects, {fmt(clientSuggestion.totalPaid)} SAR)</div>}
                    </div>
                    <div>
                      <label style={{ display: "block", fontSize: 10, fontWeight: 600, color: "var(--muted)", marginBottom: 3 }}>Client Name *</label>
                      <input required placeholder="Name" value={form.clientName} readOnly={!!clientSuggestion} style={{ width: "100%", padding: "8px 10px", borderRadius: 6, border: "1px solid var(--border)", background: clientSuggestion ? "var(--surface-hover)" : "var(--surface)", color: "var(--text)", fontSize: 12, outline: "none" }} onChange={e => setForm(f => ({ ...f, clientName: e.target.value }))} />
                    </div>
                    <div>
                      <label style={{ display: "block", fontSize: 10, fontWeight: 600, color: "var(--muted)", marginBottom: 3 }}>Date *</label>
                      <input required type="date" value={form.date} style={{ width: "100%", padding: "8px 10px", borderRadius: 6, border: "1px solid var(--border)", background: "var(--surface)", color: "var(--text)", fontSize: 12, outline: "none" }} onChange={e => setForm(f => ({ ...f, date: e.target.value }))} />
                    </div>
                  </div>
                </div>

                {/* Project Details */}
                <div style={{ marginBottom: 18 }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: "var(--text)", marginBottom: 10, display: "flex", alignItems: "center", gap: 6 }}>
                    <span style={{ width: 20, height: 20, borderRadius: 5, background: "rgba(13,148,136,0.1)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 10 }}>📁</span>
                    Project Details
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                    <div style={{ gridColumn: "1 / -1" }}>
                      <label style={{ display: "block", fontSize: 10, fontWeight: 600, color: "var(--muted)", marginBottom: 3 }}>Project Name *</label>
                      <input required placeholder="e.g. Al-Furat Company Identity" value={form.projectName} style={{ width: "100%", padding: "8px 10px", borderRadius: 6, border: "1px solid var(--border)", background: "var(--surface)", color: "var(--text)", fontSize: 12, outline: "none" }} onChange={e => setForm(f => ({ ...f, projectName: e.target.value }))} />
                    </div>
                    <div>
                      <label style={{ display: "block", fontSize: 10, fontWeight: 600, color: "var(--muted)", marginBottom: 3 }}>Total Price (SAR) *</label>
                      <input required type="number" step="0.01" min="0" placeholder="0" value={form.totalPrice} dir="ltr" style={{ width: "100%", padding: "8px 10px", borderRadius: 6, border: "1px solid var(--border)", background: "var(--surface)", color: "var(--text)", fontSize: 12, outline: "none", textAlign: "right" }} onChange={e => setForm(f => ({ ...f, totalPrice: e.target.value }))} />
                    </div>
                    <div>
                      <label style={{ display: "block", fontSize: 10, fontWeight: 600, color: "var(--muted)", marginBottom: 3 }}>Deposit (SAR)</label>
                      <input type="number" step="0.01" min="0" placeholder="0" value={form.deposit} dir="ltr" style={{ width: "100%", padding: "8px 10px", borderRadius: 6, border: "1px solid var(--border)", background: "var(--surface)", color: "var(--text)", fontSize: 12, outline: "none", textAlign: "right" }} onChange={e => setForm(f => ({ ...f, deposit: e.target.value }))} />
                    </div>
                    <div style={{ gridColumn: "1 / -1", display: "flex", alignItems: "center", gap: 10 }}>
                      <label style={{ fontSize: 10, fontWeight: 600, color: "var(--muted)", whiteSpace: "nowrap" }}>Remaining</label>
                      <div style={{ flex: 1, padding: "6px 10px", borderRadius: 6, border: "1px solid var(--border)", background: "var(--surface-hover)", fontWeight: 700, fontSize: 12, direction: "ltr", textAlign: "right", color: remaining > 0 ? "#ef4444" : "#10b981" }}>{fmt(remaining)} SAR</div>
                    </div>
                  </div>
                </div>

                {/* Services */}
                <div style={{ marginBottom: 18 }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: "var(--text)", marginBottom: 10, display: "flex", alignItems: "center", gap: 6 }}>
                    <span style={{ width: 20, height: 20, borderRadius: 5, background: "rgba(245,158,11,0.1)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 10 }}>🎨</span>
                    Services
                  </div>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                    {services.map(s => (
                      <button key={s.id} type="button" onClick={() => setForm(f => ({ ...f, serviceIds: f.serviceIds.includes(s.id) ? f.serviceIds.filter(x => x !== s.id) : [...f.serviceIds, s.id] }))}
                        style={{ padding: "5px 12px", borderRadius: 20, border: "1.5px solid", borderColor: form.serviceIds.includes(s.id) ? "#0d9488" : "var(--border)", background: form.serviceIds.includes(s.id) ? "rgba(13,148,136,0.1)" : "var(--surface)", color: form.serviceIds.includes(s.id) ? "#0d9488" : "var(--text-secondary)", fontSize: 11, fontWeight: 600, cursor: "pointer", transition: "all 0.15s" }}>
                        {s.name}
                      </button>
                    ))}
                  </div>
                  <div style={{ marginTop: 8 }}>
                    <input placeholder="+ Add custom service (if not in the list)" value={form.customServiceText} onChange={e => setForm(f => ({ ...f, customServiceText: e.target.value }))}
                      style={{ width: "100%", padding: "7px 10px", borderRadius: 6, border: "1px dashed var(--border)", background: "transparent", color: "var(--text)", fontSize: 11, outline: "none" }} />
                  </div>
                </div>

                {/* Designer + Notes */}
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                  <div>
                    <label style={{ display: "block", fontSize: 10, fontWeight: 600, color: "var(--muted)", marginBottom: 3 }}>Designer</label>
                    <input placeholder="Type name or select..." value={form.designerName || form.designerId} onChange={e => setForm(f => ({ ...f, designerName: e.target.value, designerId: "" }))} list="designer-list"
                      style={{ width: "100%", padding: "8px 10px", borderRadius: 6, border: "1px solid var(--border)", background: "var(--surface)", color: "var(--text)", fontSize: 12, outline: "none" }} />
                    <datalist id="designer-list">{users.map(u => <option key={u.id} value={u.name} />)}</datalist>
                  </div>
                  <div>
                    <label style={{ display: "block", fontSize: 10, fontWeight: 600, color: "var(--muted)", marginBottom: 3 }}>Work Status</label>
                    <select value={form.workStatus} onChange={e => setForm(f => ({ ...f, workStatus: e.target.value }))}
                      style={{ width: "100%", padding: "8px 10px", borderRadius: 6, border: "1px solid var(--border)", background: "var(--surface)", color: "var(--text)", fontSize: 12, outline: "none" }}>
                      <option value="WAITING">⏳ Waiting</option>
                      <option value="IN_PROGRESS">🔄 In Progress</option>
                      <option value="COMPLETED">✅ Completed</option>
                      <option value="PAUSED">⏸ Paused</option>
                    </select>
                  </div>
                  <div style={{ gridColumn: "1 / -1" }}>
                    <label style={{ display: "block", fontSize: 10, fontWeight: 600, color: "var(--muted)", marginBottom: 3 }}>Notes</label>
                    <textarea rows={2} value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} placeholder="Optional notes..."
                      style={{ width: "100%", padding: "8px 10px", borderRadius: 6, border: "1px solid var(--border)", background: "var(--surface)", color: "var(--text)", fontSize: 12, outline: "none", resize: "vertical" }} />
                  </div>
                </div>
              </div>
              <div style={{ padding: "14px 24px", borderTop: "1px solid var(--border)", display: "flex", gap: 8, justifyContent: "flex-end" }}>
                <button type="button" onClick={() => { setShowForm(false); resetForm(); }} style={{ padding: "9px 18px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--surface)", color: "var(--text)", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>Cancel</button>
                <button type="submit" disabled={submitting} style={{ padding: "9px 22px", borderRadius: 8, border: "none", background: "#0d9488", color: "#fff", fontSize: 12, fontWeight: 600, cursor: submitting ? "not-allowed" : "pointer", opacity: submitting ? 0.6 : 1, boxShadow: "0 2px 6px rgba(13,148,136,0.3)" }}>{submitting ? "Saving..." : "Save Record"}</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
