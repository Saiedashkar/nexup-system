"use client";

import { useEffect, useState, useCallback, useMemo, useRef } from "react";

/* ───── Types ───── */
type Payment = { id: string; amount: number; date: string; note: string | null; receipts?: Receipt[] };
type Receipt = { id: string; imageUrl: string; fileName: string | null; mimeType: string | null; uploadedAt: string };
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

function fmt(n: number | undefined | null) { return (n ?? 0).toLocaleString("en-US"); }
function fmtDate(d: string) { return new Date(d).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }); }
function monthKey(d: string) { const dt = new Date(d); return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}`; }
function monthLabel(d: string) { return new Date(d).toLocaleDateString("en-US", { month: "long", year: "numeric" }); }

/* ═══ Receipt Upload & Display ═══ */
const ACCEPTED_RECEIPT_TYPES = "image/jpeg,image/png,image/webp,application/pdf";

async function uploadReceiptFile(file: File, clientPaymentId: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const fd = new FormData();
    fd.append("file", file);
    fd.append("clientPaymentId", clientPaymentId);
    const r = await fetch("/api/payment-receipts", { method: "POST", body: fd });
    if (r.ok) return { ok: true };
    const d = await r.json().catch(() => ({}));
    return { ok: false, error: d.error || "فشل رفع الإيصال" };
  } catch {
    return { ok: false, error: "فشل رفع الإيصال" };
  }
}

function ReceiptThumb({ receipt, onOpen, onDelete }: { receipt: Receipt; onOpen: () => void; onDelete: () => void }) {
  const isPdf = receipt.mimeType === "application/pdf";
  return (
    <div style={{ position: "relative", width: 42, height: 42, borderRadius: 6, overflow: "hidden", border: "1px solid var(--border)", background: "var(--surface-hover)", flexShrink: 0 }}>
      <button onClick={onOpen} title="عرض الإيصال" style={{ width: "100%", height: "100%", padding: 0, border: "none", background: "transparent", cursor: "zoom-in", display: "flex", alignItems: "center", justifyContent: "center" }}>
        {isPdf
          ? <span style={{ fontSize: 15 }}>📄</span>
          : <img src={receipt.imageUrl} alt="إيصال" style={{ width: "100%", height: "100%", objectFit: "cover" }} loading="lazy" />}
      </button>
      <button onClick={(e) => { e.stopPropagation(); onDelete(); }} title="حذف الإيصال"
        style={{ position: "absolute", top: 0, left: 0, width: 14, height: 14, borderRadius: "0 0 4px 0", border: "none", background: "rgba(239,68,68,0.85)", color: "#fff", fontSize: 8, lineHeight: "14px", textAlign: "center", cursor: "pointer", padding: 0 }}>✕</button>
    </div>
  );
}

function ReceiptLightbox({ receipt, onClose }: { receipt: Receipt; onClose: () => void }) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", h);
    return () => document.removeEventListener("keydown", h);
  }, [onClose]);
  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.85)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 2000, padding: 24 }}>
      <div onClick={e => e.stopPropagation()} style={{ maxWidth: "90vw", maxHeight: "90vh", display: "flex", flexDirection: "column", gap: 8 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", color: "#fff" }}>
          <span style={{ fontSize: 12, color: "#cbd5e1" }}>{receipt.fileName || "إيصال التحويل"}</span>
          <button onClick={onClose} style={{ width: 30, height: 30, borderRadius: 6, border: "none", background: "rgba(255,255,255,0.12)", color: "#fff", fontSize: 14, cursor: "pointer" }}>✕</button>
        </div>
        {receipt.mimeType === "application/pdf"
          ? <iframe src={receipt.imageUrl} title="receipt" style={{ width: "min(85vw, 800px)", height: "80vh", borderRadius: 8, border: "none", background: "#fff" }} />
          : <img src={receipt.imageUrl} alt="إيصال" style={{ maxWidth: "85vw", maxHeight: "80vh", borderRadius: 8, objectFit: "contain" }} />}
      </div>
    </div>
  );
}

/**
 * Drop zone + thumbnails for one payment's receipts.
 * mode="attached"  → payment already saved (uploads go straight to the API)
 * mode="pending"   → payment not yet saved (file held in memory, uploaded after save)
 */
function ReceiptDropZone({ paymentId, receipts, onUploaded, onDeleted, pendingFile, onPendingFile, compact }: {
  paymentId?: string;
  receipts?: Receipt[];
  onUploaded?: (r: Receipt) => void;
  onDeleted?: (id: string) => void;
  pendingFile?: File | null;
  onPendingFile?: (f: File | null) => void;
  compact?: boolean;
}) {
  const [dragOver, setDragOver] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [lightbox, setLightbox] = useState<Receipt | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFiles = async (files: FileList | null) => {
    const file = files?.[0];
    if (!file) return;
    setError("");
    if (!paymentId) { onPendingFile?.(file); return; }
    setBusy(true);
    // Upload via temp form; response gives the created receipt.
    const fd = new FormData();
    fd.append("file", file);
    fd.append("clientPaymentId", paymentId);
    try {
      const r = await fetch("/api/payment-receipts", { method: "POST", body: fd });
      if (r.ok) { const rec: Receipt = await r.json(); onUploaded?.(rec); }
      else { const d = await r.json().catch(() => ({})); setError(d.error || "فشل رفع الإيصال"); }
    } catch { setError("فشل رفع الإيصال"); }
    setBusy(false);
    if (inputRef.current) inputRef.current.value = "";
  };

  const pendingPreviewUrl = pendingFile && pendingFile.type !== "application/pdf" ? URL.createObjectURL(pendingFile) : null;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
        {(receipts && receipts.length > 0) && receipts.map(rec => (
          confirmDeleteId === rec.id ? (
            <div key={rec.id} style={{ display: "flex", gap: 3, alignItems: "center", fontSize: 9 }}>
              <span style={{ color: "#ef4444", fontWeight: 600 }}>حذف؟</span>
              <button onClick={() => { onDeleted?.(rec.id); setConfirmDeleteId(null); }} style={{ padding: "2px 6px", borderRadius: 3, border: "none", background: "#ef4444", color: "#fff", fontSize: 9, fontWeight: 600, cursor: "pointer" }}>نعم</button>
              <button onClick={() => setConfirmDeleteId(null)} style={{ padding: "2px 6px", borderRadius: 3, border: "1px solid var(--border)", background: "transparent", color: "var(--muted)", fontSize: 9, cursor: "pointer" }}>لا</button>
            </div>
          ) : (
            <ReceiptThumb key={rec.id} receipt={rec} onOpen={() => setLightbox(rec)}
              onDelete={() => setConfirmDeleteId(rec.id)} />
          )
        ))}
        {pendingFile && (
          <div style={{ position: "relative", width: 42, height: 42, borderRadius: 6, overflow: "hidden", border: "1px dashed #0d9488", background: "var(--surface-hover)", flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>
            {pendingFile.type === "application/pdf"
              ? <span style={{ fontSize: 15 }}>📄</span>
              : <img src={pendingPreviewUrl || ""} alt="إيصال" style={{ width: "100%", height: "100%", objectFit: "cover" }} />}
            <button onClick={() => onPendingFile?.(null)} title="إزالة"
              style={{ position: "absolute", top: 0, left: 0, width: 14, height: 14, borderRadius: "0 0 4px 0", border: "none", background: "rgba(239,68,68,0.85)", color: "#fff", fontSize: 8, lineHeight: "14px", textAlign: "center", cursor: "pointer", padding: 0 }}>✕</button>
          </div>
        )}
        <div
          onDragOver={e => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={e => { e.preventDefault(); setDragOver(false); handleFiles(e.dataTransfer.files); }}
          onClick={() => inputRef.current?.click()}
          style={{
            display: "flex", alignItems: "center", gap: 4, cursor: "pointer",
            padding: compact ? "3px 8px" : "6px 10px",
            borderRadius: 6, border: dragOver ? "1.5px dashed #0d9488" : "1px dashed var(--border)",
            background: dragOver ? "rgba(13,148,136,0.08)" : "transparent",
            fontSize: 10, color: "var(--muted)", whiteSpace: "nowrap", transition: "all 0.15s",
          }}>
          <span>📎</span>
          <span>إيصال التحويل</span>
          {busy && <span style={{ color: "#0d9488" }}>...جاري الرفع</span>}
        </div>
        <input ref={inputRef} type="file" accept={ACCEPTED_RECEIPT_TYPES} style={{ display: "none" }}
          onChange={e => handleFiles(e.target.files)} />
      </div>
      {error && <div style={{ fontSize: 9, color: "#ef4444" }}>{error}</div>}
      {lightbox && <ReceiptLightbox receipt={lightbox} onClose={() => setLightbox(null)} />}
    </div>
  );
}

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
  const [localPayments, setLocalPayments] = useState<Payment[]>(project.payments || []);
  const payments = localPayments;
  const totalPaid = payments.reduce((s, p) => s + Number(p.amount), 0);
  const remaining = Number(project.totalPrice) - totalPaid;

  const attachReceipt = (paymentId: string, rec: Receipt) => {
    setLocalPayments(prev => prev.map(p => p.id === paymentId ? { ...p, receipts: [...(p.receipts || []), rec] } : p));
  };
  const removeReceipt = async (paymentId: string, receiptId: string) => {
    try { await fetch(`/api/payment-receipts/${receiptId}`, { method: "DELETE" }); } catch {}
    setLocalPayments(prev => prev.map(p => p.id === paymentId ? { ...p, receipts: (p.receipts || []).filter(r => r.id !== receiptId) } : p));
  };

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

        {/* Payment list — chronological receipt collector */}
        <div style={{ padding: "0 20px 12px", maxHeight: 320, overflow: "auto", display: "flex", flexDirection: "column", gap: 8 }}>
          {payments.length === 0 ? (
            <div style={{ textAlign: "center", padding: 20, color: "var(--muted)", fontSize: 12 }}>لا توجد دفعات بعد.</div>
          ) : (
            payments.map(p => (
              <div key={p.id} style={{ border: "1px solid var(--border)", borderRadius: 8, padding: "8px 10px", background: "var(--surface-hover)", display: "flex", flexDirection: "column", gap: 6 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ fontSize: 10, color: "var(--text-secondary)", minWidth: 74 }}>{fmtDate(p.date)}</span>
                  <span style={{ fontSize: 12, fontWeight: 700, color: "#10b981", direction: "ltr" }}>{fmt(Number(p.amount))} SAR</span>
                  {p.note && <span style={{ fontSize: 9, color: "var(--muted)", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.note}</span>}
                  <span style={{ flex: 1 }} />
                  {confirmDelete === p.id ? (
                    <div style={{ display: "flex", gap: 2 }}>
                      <button onClick={() => { onDeletePayment(p.id); setConfirmDelete(null); setLocalPayments(prev => prev.filter(x => x.id !== p.id)); }} style={{ padding: "2px 6px", borderRadius: 3, border: "none", background: "#ef4444", color: "#fff", fontSize: 9, fontWeight: 600, cursor: "pointer" }}>تأكيد الحذف</button>
                      <button onClick={() => setConfirmDelete(null)} style={{ padding: "2px 6px", borderRadius: 3, border: "1px solid var(--border)", background: "transparent", color: "var(--muted)", fontSize: 9, cursor: "pointer" }}>لا</button>
                    </div>
                  ) : (
                    <button onClick={() => setConfirmDelete(p.id)} style={{ padding: "2px 5px", borderRadius: 3, border: "1px solid rgba(239,68,68,0.2)", background: "transparent", color: "#ef4444", fontSize: 10, cursor: "pointer" }}>🗑</button>
                  )}
                </div>
                <ReceiptDropZone paymentId={p.id} receipts={p.receipts || []}
                  onUploaded={rec => attachReceipt(p.id, rec)}
                  onDeleted={rid => removeReceipt(p.id, rid)} compact />
              </div>
            ))
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
function EditModal({ project, users, services, onClose, onSave, onPaymentsChanged }: { project: Project; users: User[]; services: Service[]; onClose: () => void; onSave: (data: Record<string, unknown>) => void; onPaymentsChanged?: () => void }) {
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
  const [localPayments, setLocalPayments] = useState<Payment[]>(project.payments || []);
  const [payAmount, setPayAmount] = useState("");
  const [payNote, setPayNote] = useState("");
  const [confirmDeletePayment, setConfirmDeletePayment] = useState<string | null>(null);
  const totalPaid = localPayments.reduce((s, p) => s + Number(p.amount), 0);
  const payRemaining = Math.max(0, Number(project.totalPrice) - totalPaid);

  const attachReceipt = (paymentId: string, rec: Receipt) => {
    setLocalPayments(prev => prev.map(p => p.id === paymentId ? { ...p, receipts: [...(p.receipts || []), rec] } : p));
  };
  const removeReceipt = async (paymentId: string, receiptId: string) => {
    try { await fetch(`/api/payment-receipts/${receiptId}`, { method: "DELETE" }); } catch {}
    setLocalPayments(prev => prev.map(p => p.id === paymentId ? { ...p, receipts: (p.receipts || []).filter(r => r.id !== receiptId) } : p));
  };
  const addPayment = async (amount: number, note: string) => {
    try {
      const r = await fetch("/api/client-payments", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ projectRecordId: project.id, amount, note: note || undefined }) });
      if (r.ok) {
        const created: Payment = await r.json();
        setLocalPayments(prev => [...prev, { ...created, receipts: [] }]);
        setForm(f => ({ ...f, deposit: String(Number(f.deposit || "0") + amount) }));
        setPayAmount(""); setPayNote("");
        onPaymentsChanged?.();
      }
    } catch {}
  };
  const deletePayment = async (paymentId: string) => {
    const target = localPayments.find(p => p.id === paymentId);
    try { await fetch(`/api/client-payments/${paymentId}`, { method: "DELETE" }); } catch {}
    setLocalPayments(prev => prev.filter(p => p.id !== paymentId));
    if (target) setForm(f => ({ ...f, deposit: String(Math.max(0, Number(f.deposit || "0") - Number(target.amount))) }));
    setConfirmDeletePayment(null);
    onPaymentsChanged?.();
  };

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000 }} onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={{ background: "var(--surface)", borderRadius: 14, maxWidth: 560, width: "95%", maxHeight: "92vh", overflow: "auto", border: "1px solid var(--border)" }}>
        <div style={{ padding: "16px 20px", borderBottom: "1px solid var(--border)", display: "flex", justifyContent: "space-between", alignItems: "center", position: "sticky", top: 0, background: "var(--surface)", zIndex: 5 }}>
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
            {/* ─── Payment history with transfer receipts ─── */}
            <div style={{ gridColumn: "1 / -1", borderTop: "1px solid var(--border)", paddingTop: 12, marginTop: 4 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: "var(--text)", marginBottom: 8, display: "flex", alignItems: "center", gap: 6 }}>
                💰 سجل الدفعات وإيصالات التحويل
                <span style={{ fontSize: 9, fontWeight: 600, color: "var(--muted)" }}>({fmt(totalPaid)} / {fmt(Number(project.totalPrice))} SAR)</span>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 10 }}>
                {localPayments.length === 0 ? (
                  <div style={{ fontSize: 11, color: "var(--muted)", padding: "6px 0" }}>لا توجد دفعات مسجلة بعد.</div>
                ) : localPayments.map(p => (
                  <div key={p.id} style={{ border: "1px solid var(--border)", borderRadius: 8, padding: "7px 10px", background: "var(--surface-hover)", display: "flex", flexDirection: "column", gap: 5 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <span style={{ fontSize: 10, color: "var(--text-secondary)", minWidth: 74 }}>{fmtDate(p.date)}</span>
                      <span style={{ fontSize: 12, fontWeight: 700, color: "#10b981", direction: "ltr" }}>{fmt(Number(p.amount))} SAR</span>
                      {p.note && <span style={{ fontSize: 9, color: "var(--muted)", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.note}</span>}
                      <span style={{ flex: 1 }} />
                      {confirmDeletePayment === p.id ? (
                        <>
                          <button onClick={() => deletePayment(p.id)} style={{ padding: "2px 6px", borderRadius: 3, border: "none", background: "#ef4444", color: "#fff", fontSize: 9, fontWeight: 600, cursor: "pointer" }}>تأكيد الحذف</button>
                          <button onClick={() => setConfirmDeletePayment(null)} style={{ padding: "2px 6px", borderRadius: 3, border: "1px solid var(--border)", background: "transparent", color: "var(--muted)", fontSize: 9, cursor: "pointer" }}>لا</button>
                        </>
                      ) : (
                        <button onClick={() => setConfirmDeletePayment(p.id)} style={{ padding: "2px 5px", borderRadius: 3, border: "1px solid rgba(239,68,68,0.2)", background: "transparent", color: "#ef4444", fontSize: 10, cursor: "pointer" }}>🗑</button>
                      )}
                    </div>
                    <ReceiptDropZone paymentId={p.id} receipts={p.receipts || []}
                      onUploaded={rec => attachReceipt(p.id, rec)}
                      onDeleted={rid => removeReceipt(p.id, rid)} compact />
                  </div>
                ))}
              </div>
              {payRemaining > 0 && (
                <div style={{ display: "flex", gap: 6, alignItems: "flex-end", flexWrap: "wrap" }}>
                  <div style={{ flex: 1, minWidth: 90 }}>
                    <label style={{ fontSize: 9, fontWeight: 600, color: "var(--muted)" }}>Amount (≤ {fmt(payRemaining)})</label>
                    <input type="number" min="1" max={payRemaining} value={payAmount} onChange={e => setPayAmount(e.target.value)} placeholder="0"
                      style={{ width: "100%", padding: "6px 8px", borderRadius: 5, border: "1px solid var(--border)", background: "var(--surface)", color: "var(--text)", fontSize: 12, outline: "none", marginTop: 2 }} />
                  </div>
                  <div style={{ flex: 1, minWidth: 90 }}>
                    <label style={{ fontSize: 9, fontWeight: 600, color: "var(--muted)" }}>Note</label>
                    <input value={payNote} onChange={e => setPayNote(e.target.value)} placeholder="Optional"
                      style={{ width: "100%", padding: "6px 8px", borderRadius: 5, border: "1px solid var(--border)", background: "var(--surface)", color: "var(--text)", fontSize: 12, outline: "none", marginTop: 2 }} />
                  </div>
                  <button type="button" onClick={() => { const a = parseFloat(payAmount); if (a > 0) addPayment(Math.min(a, payRemaining), payNote); }}
                    style={{ padding: "6px 14px", borderRadius: 6, border: "none", background: "#0d9488", color: "#fff", fontSize: 11, fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap" }}>إضافة دفعة</button>
                  <button type="button" onClick={() => addPayment(payRemaining, "تحصيل كامل المتبقي")}
                    style={{ padding: "6px 12px", borderRadius: 6, border: "1px solid #0d9488", background: "transparent", color: "#0d9488", fontSize: 11, fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap" }}>تحصيل الكل</button>
                </div>
              )}
              <p style={{ fontSize: 9, color: "var(--muted)", margin: "6px 0 0" }}>📎 أرفق إيصال التحويل بكل دفعة — اسحب الصورة أو اضغط للاختيار (JPG, PNG, WEBP, PDF).</p>
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

/* ═══ Subscription Types ═══ */
type SubInvoice = { id: string; month: number; year: number; amount: number; status: string; paidAmount: number; paidDate: string | null };
type Subscription = { id: string; clientId: string; businessId: string; services: string; monthlyFee: number; startDate: string; billingDay: number; status: string; notes: string | null; createdAt: string; client: ClientInfo; invoices: SubInvoice[] };

/* ═══ Recurring Tab ═══ */
function RecurringTab() {
  const [subs, setSubs] = useState<Subscription[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ clientPhone: "", clientName: "", monthlyFee: "", startDate: new Date().toISOString().split("T")[0], services: "", notes: "" });
  const [payModal, setPayModal] = useState<Subscription | null>(null);
  const [payAmount, setPayAmount] = useState("");

  const fetchSubs = useCallback(async () => {
    setLoading(true);
    try { const r = await fetch("/api/rebound/subscriptions?slug=nexup"); if (r.ok) setSubs(await r.json()); } catch {}
    setLoading(false);
  }, []);
  useEffect(() => { fetchSubs(); }, [fetchSubs]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const r = await fetch("/api/rebound/subscriptions", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ businessSlug: "nexup", clientPhone: form.clientPhone, clientName: form.clientName, monthlyFee: parseFloat(form.monthlyFee), startDate: form.startDate, services: form.services ? form.services.split(",").map(s => s.trim()) : [], notes: form.notes }) });
      if (r.ok) { setShowForm(false); setForm({ clientPhone: "", clientName: "", monthlyFee: "", startDate: new Date().toISOString().split("T")[0], services: "", notes: "" }); fetchSubs(); }
    } catch {}
  };

  const handlePay = async (subId: string, invoiceId: string, amount: number) => {
    try {
      const r = await fetch("/api/rebound/subscription-invoices", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subscriptionId: subId, invoiceId, amount }) });
      if (r.ok) { fetchSubs(); setPayModal(null); setPayAmount(""); }
    } catch {}
  };

  const handleToggleStatus = async (subId: string, newStatus: string) => {
    try {
      const r = await fetch("/api/rebound/subscriptions", { method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: subId, status: newStatus }) });
      if (r.ok) fetchSubs();
    } catch {}
  };

  const now = new Date();
  const currentMonth = now.getMonth() + 1;
  const currentYear = now.getFullYear();

  const activeSubs = subs.filter(s => s.status === "ACTIVE");
  const mrr = activeSubs.reduce((sum, s) => sum + s.monthlyFee, 0);

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 800, color: "var(--text)", margin: 0 }}>اشتراكات شهرية</h1>
          <p style={{ fontSize: 12, color: "var(--muted)", margin: "3px 0 0" }}>Monthly Subscriptions — NEXUP</p>
        </div>
        <button onClick={() => setShowForm(true)} style={{ display: "flex", alignItems: "center", gap: 5, padding: "9px 16px", borderRadius: 8, background: "#0d9488", color: "#fff", border: "none", fontSize: 12, fontWeight: 600, cursor: "pointer", boxShadow: "0 2px 6px rgba(13,148,136,0.3)" }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
          اشتراك جديد +
        </button>
      </div>

      {/* Stats */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 10, marginBottom: 16 }}>
        {[
          { l: "الإجمالي", v: subs.length, c: "var(--text)" },
          { l: "نشط", v: activeSubs.length, c: "#10b981" },
          { l: "متوقف", v: subs.filter(s => s.status !== "ACTIVE").length, c: "#f59e0b" },
          { l: "الدخل الشهري (MRR)", v: `${fmt(mrr)} EGP`, c: "#0d9488" },
        ].map(s => (
          <div key={s.l} style={{ padding: "10px 12px", borderRadius: 8, background: "var(--surface)", border: "1px solid var(--border)", textAlign: "center" }}>
            <div style={{ fontSize: 16, fontWeight: 800, color: s.c, direction: "ltr" }}>{s.v}</div>
            <div style={{ fontSize: 10, color: "var(--muted)", marginTop: 1 }}>{s.l}</div>
          </div>
        ))}
      </div>

      {loading ? <div style={{ textAlign: "center", padding: 40, color: "var(--muted)" }}>Loading...</div>
        : subs.length === 0 ? (
          <div style={{ textAlign: "center", padding: 40 }}>
            <div style={{ fontSize: 36, marginBottom: 8 }}>📋</div>
            <p style={{ color: "var(--muted)", fontSize: 13 }}>لا توجد اشتراكات بعد</p>
          </div>
        ) : (
          <div style={{ overflowX: "auto", border: "1px solid var(--border)", borderRadius: 8 }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12, minWidth: 900 }}>
              <thead>
                <tr style={{ background: "rgba(13,148,136,0.06)" }}>
                  {["العميل", "الهاتف", "الخدمات", "القيمة الشهرية", "تاريخ البداية", "يوم الاستحقاق", "الحالة", "فاتورة الشهر", "الإجراءات"].map(h => (
                    <th key={h} style={{ padding: "8px 10px", textAlign: "left", fontSize: 10, fontWeight: 700, color: "var(--text)", borderBottom: "2px solid var(--border)" }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {subs.map(sub => {
                  const currentInvoice = sub.invoices.find(i => i.month === currentMonth && i.year === currentYear);
                  const isOverdue = currentInvoice && currentInvoice.status === "UNPAID" && now.getDate() > sub.billingDay;
                  const services = sub.services ? JSON.parse(sub.services) : [];
                  return (
                    <tr key={sub.id} style={{ borderBottom: "1px solid var(--border)", background: sub.status !== "ACTIVE" ? "rgba(245,158,11,0.03)" : "var(--surface)" }}>
                      <td style={{ padding: "8px 10px", fontWeight: 600 }}>{sub.client.name}</td>
                      <td style={{ padding: "8px 10px", direction: "ltr", color: "var(--text-secondary)" }}>{sub.client.phone}</td>
                      <td style={{ padding: "8px 10px" }}>
                        <div style={{ display: "flex", flexWrap: "wrap", gap: 2 }}>
                          {services.map((s: string, i: number) => <span key={i} style={{ padding: "1px 6px", borderRadius: 3, fontSize: 9, fontWeight: 600, background: "rgba(13,148,136,0.08)", color: "#0d9488" }}>{s}</span>)}
                          {services.length === 0 && <span style={{ fontSize: 9, color: "var(--muted)" }}>—</span>}
                        </div>
                      </td>
                      <td style={{ padding: "8px 10px", fontWeight: 700, color: "#0d9488", direction: "ltr" }}>{fmt(sub.monthlyFee)} EGP</td>
                      <td style={{ padding: "8px 10px", color: "var(--text-secondary)", fontSize: 11 }}>{fmtDate(sub.startDate)}</td>
                      <td style={{ padding: "8px 10px", textAlign: "center", fontWeight: 700 }}>{sub.billingDay}</td>
                      <td style={{ padding: "8px 10px" }}>
                        <select value={sub.status} onChange={e => handleToggleStatus(sub.id, e.target.value)}
                          style={{ padding: "3px 6px", borderRadius: 4, border: "none", fontSize: 10, fontWeight: 600, cursor: "pointer", background: sub.status === "ACTIVE" ? "rgba(16,185,129,0.12)" : sub.status === "PAUSED" ? "rgba(245,158,11,0.12)" : "rgba(239,68,68,0.12)", color: sub.status === "ACTIVE" ? "#10b981" : sub.status === "PAUSED" ? "#f59e0b" : "#ef4444" }}>
                          <option value="ACTIVE">نشط</option>
                          <option value="PAUSED">متوقف</option>
                          <option value="CANCELLED">ملغي</option>
                        </select>
                      </td>
                      <td style={{ padding: "8px 10px" }}>
                        {currentInvoice ? (
                          <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                            <span style={{ padding: "2px 6px", borderRadius: 4, fontSize: 10, fontWeight: 600,
                              background: currentInvoice.status === "PAID" ? "rgba(16,185,129,0.12)" : isOverdue ? "rgba(239,68,68,0.12)" : "rgba(245,158,11,0.12)",
                              color: currentInvoice.status === "PAID" ? "#10b981" : isOverdue ? "#ef4444" : "#f59e0b" }}>
                              {currentInvoice.status === "PAID" ? "مدفوع" : isOverdue ? "متأخر" : "غير مدفوع"}
                            </span>
                            {currentInvoice.status !== "PAID" && (
                              <button onClick={() => { setPayModal(sub); setPayAmount(String(currentInvoice.amount - (currentInvoice.paidAmount || 0))); }}
                                style={{ padding: "2px 6px", borderRadius: 3, border: "none", background: "rgba(16,185,129,0.12)", color: "#10b981", fontSize: 9, fontWeight: 600, cursor: "pointer" }}>ادفع</button>
                            )}
                          </div>
                        ) : <span style={{ fontSize: 10, color: "var(--muted)" }}>—</span>}
                      </td>
                      <td style={{ padding: "8px 10px" }}>
                        <div style={{ display: "flex", gap: 3, justifyContent: "center" }}>
                          {currentInvoice && currentInvoice.status !== "PAID" && (
                            <button onClick={() => { setPayModal(sub); setPayAmount(String(currentInvoice.amount - (currentInvoice.paidAmount || 0))); }}
                              style={{ padding: "3px 8px", borderRadius: 4, border: "none", background: "rgba(16,185,129,0.12)", color: "#10b981", fontSize: 10, fontWeight: 600, cursor: "pointer" }}>💳 ادفع</button>
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

      {/* Pay Modal */}
      {payModal && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000 }} onClick={e => { if (e.target === e.currentTarget) { setPayModal(null); setPayAmount(""); } }}>
          <div style={{ background: "var(--surface)", borderRadius: 14, maxWidth: 400, width: "95%", border: "1px solid var(--border)" }}>
            <div style={{ padding: "16px 20px", borderBottom: "1px solid var(--border)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <h3 style={{ fontSize: 15, fontWeight: 700, color: "var(--text)", margin: 0 }}>دفع فاتورة</h3>
              <button onClick={() => { setPayModal(null); setPayAmount(""); }} style={{ width: 28, height: 28, borderRadius: 6, border: "none", background: "var(--surface-hover)", color: "var(--muted)", fontSize: 14, cursor: "pointer" }}>✕</button>
            </div>
            <div style={{ padding: "16px 20px" }}>
              <p style={{ fontSize: 12, color: "var(--text-secondary)", marginBottom: 12 }}>{payModal.client.name} — {fmt(payModal.monthlyFee)} EGP/شهر</p>
              <label style={{ fontSize: 10, fontWeight: 600, color: "var(--muted)" }}>المبلغ</label>
              <input type="number" value={payAmount} onChange={e => setPayAmount(e.target.value)}
                style={{ width: "100%", padding: "8px 10px", borderRadius: 6, border: "1px solid var(--border)", background: "var(--surface)", color: "var(--text)", fontSize: 12, outline: "none", marginTop: 4, direction: "ltr" }} />
            </div>
            <div style={{ padding: "12px 20px", borderTop: "1px solid var(--border)", display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button onClick={() => { setPayModal(null); setPayAmount(""); }} style={{ padding: "8px 16px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--surface)", color: "var(--text)", fontSize: 12, cursor: "pointer" }}>إلغاء</button>
              <button onClick={() => { if (payAmount && payModal) { const inv = payModal.invoices.find(i => i.month === currentMonth && i.year === currentYear); if (inv) handlePay(payModal.id, inv.id, parseFloat(payAmount)); } }}
                style={{ padding: "8px 18px", borderRadius: 8, border: "none", background: "#0d9488", color: "#fff", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>تأكيد الدفع</button>
            </div>
          </div>
        </div>
      )}

      {/* Create Form */}
      {showForm && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000 }} onClick={e => { if (e.target === e.currentTarget) setShowForm(false); }}>
          <div style={{ background: "var(--surface)", borderRadius: 14, maxWidth: 500, width: "95%", border: "1px solid var(--border)" }}>
            <div style={{ padding: "16px 20px", borderBottom: "1px solid var(--border)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <h3 style={{ fontSize: 15, fontWeight: 700, color: "var(--text)", margin: 0 }}>اشتراك شهر جديد</h3>
              <button onClick={() => setShowForm(false)} style={{ width: 28, height: 28, borderRadius: 6, border: "none", background: "var(--surface-hover)", color: "var(--muted)", fontSize: 14, cursor: "pointer" }}>✕</button>
            </div>
            <form onSubmit={handleCreate}>
              <div style={{ padding: "16px 20px", display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                <div>
                  <label style={{ fontSize: 10, fontWeight: 600, color: "var(--muted)" }}>هاتف العميل *</label>
                  <input required placeholder="05XXXXXXXX" value={form.clientPhone} dir="ltr"
                    style={{ width: "100%", padding: "7px 10px", borderRadius: 6, border: "1px solid var(--border)", background: "var(--surface)", color: "var(--text)", fontSize: 12, outline: "none", marginTop: 3 }}
                    onChange={e => setForm(f => ({ ...f, clientPhone: e.target.value }))} />
                </div>
                <div>
                  <label style={{ fontSize: 10, fontWeight: 600, color: "var(--muted)" }}>اسم العميل</label>
                  <input value={form.clientName} placeholder=" اختياري إذا كان العميل مسجل"
                    style={{ width: "100%", padding: "7px 10px", borderRadius: 6, border: "1px solid var(--border)", background: "var(--surface)", color: "var(--text)", fontSize: 12, outline: "none", marginTop: 3 }}
                    onChange={e => setForm(f => ({ ...f, clientName: e.target.value }))} />
                </div>
                <div>
                  <label style={{ fontSize: 10, fontWeight: 600, color: "var(--muted)" }}>القيمة الشهرية (EGP) *</label>
                  <input required type="number" min="1" value={form.monthlyFee} dir="ltr"
                    style={{ width: "100%", padding: "7px 10px", borderRadius: 6, border: "1px solid var(--border)", background: "var(--surface)", color: "var(--text)", fontSize: 12, outline: "none", marginTop: 3 }}
                    onChange={e => setForm(f => ({ ...f, monthlyFee: e.target.value }))} />
                </div>
                <div>
                  <label style={{ fontSize: 10, fontWeight: 600, color: "var(--muted)" }}>تاريخ البداية *</label>
                  <input required type="date" value={form.startDate}
                    style={{ width: "100%", padding: "7px 10px", borderRadius: 6, border: "1px solid var(--border)", background: "var(--surface)", color: "var(--text)", fontSize: 12, outline: "none", marginTop: 3 }}
                    onChange={e => setForm(f => ({ ...f, startDate: e.target.value }))} />
                </div>
                <div style={{ gridColumn: "1 / -1" }}>
                  <label style={{ fontSize: 10, fontWeight: 600, color: "var(--muted)" }}>الخدمات (مفصولة بفاصلة)</label>
                  <input placeholder="مثال: تسويق إلكتروني, إدارة سوشيال" value={form.services}
                    style={{ width: "100%", padding: "7px 10px", borderRadius: 6, border: "1px solid var(--border)", background: "var(--surface)", color: "var(--text)", fontSize: 12, outline: "none", marginTop: 3 }}
                    onChange={e => setForm(f => ({ ...f, services: e.target.value }))} />
                </div>
                <div style={{ gridColumn: "1 / -1" }}>
                  <label style={{ fontSize: 10, fontWeight: 600, color: "var(--muted)" }}>ملاحظات</label>
                  <textarea rows={2} value={form.notes}
                    style={{ width: "100%", padding: "7px 10px", borderRadius: 6, border: "1px solid var(--border)", background: "var(--surface)", color: "var(--text)", fontSize: 12, outline: "none", marginTop: 3, resize: "vertical" }}
                    onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} />
                </div>
              </div>
              <div style={{ padding: "12px 20px", borderTop: "1px solid var(--border)", display: "flex", gap: 8, justifyContent: "flex-end" }}>
                <button type="button" onClick={() => setShowForm(false)} style={{ padding: "8px 16px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--surface)", color: "var(--text)", fontSize: 12, cursor: "pointer" }}>إلغاء</button>
                <button type="submit" style={{ padding: "8px 18px", borderRadius: 8, border: "none", background: "#0d9488", color: "#fff", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>حفظ</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

/* ═══════════════════════ MAIN PAGE ═══════════════════════ */
export default function NexupClientsPage() {
  const [activeTab, setActiveTab] = useState<"one-time" | "recurring">("one-time");
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
  const [createReceiptFile, setCreateReceiptFile] = useState<File | null>(null);
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

  const fetchMeta = async () => { try { const [s, u] = await Promise.all([fetch("/api/services?businessSlug=nexup"), fetch("/api/users")]); if (s.ok) setServices(await s.json()); if (u.ok) setUsers(await u.json()); } catch {} };
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
      const r = await fetch("/api/nexup/projects", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientId: clientSuggestion?.id, clientPhone: form.clientPhone, clientName: form.clientName, projectName: form.projectName, date: form.date, customServiceText: form.customServiceText || undefined, totalPrice: parseFloat(form.totalPrice), deposit: parseFloat(form.deposit || "0"), workStatus: form.workStatus, designerId: form.designerId || undefined, designerName: form.designerName || undefined, serviceIds: form.serviceIds, notes: form.notes || undefined }) });
      if (!r.ok) { const d = await r.json(); throw new Error(d.error || "Failed"); }
      // Upload the pending deposit receipt (if any) to the auto-created deposit payment.
      const created = await r.json();
      if (createReceiptFile && created?.id && created?.payments?.length > 0) {
        const depositPayment = created.payments[created.payments.length - 1];
        const up = await uploadReceiptFile(createReceiptFile, depositPayment.id);
        if (!up.ok && up.error) setError(`تم حفظ السجل لكن فشل رفع الإيصال: ${up.error}`);
      }
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

  const resetForm = () => { setForm({ clientPhone: "", clientName: "", projectName: "", date: new Date().toISOString().split("T")[0], customServiceText: "", totalPrice: "", deposit: "", workStatus: "WAITING", designerId: "", designerName: "", serviceIds: [], notes: "" }); setClientSuggestion(null); setCreateReceiptFile(null); setError(""); };

  const toggleMonth = (key: string) => { setCollapsedMonths(prev => { const n = new Set(prev); n.has(key) ? n.delete(key) : n.add(key); return n; }); };

  const getDesignerDisplay = (p: Project) => p.designerName || p.designer?.name || "—";

  return (
    <div>
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 16 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 800, color: "var(--text)", margin: 0 }}>إدارة العملاء</h1>
          <p style={{ fontSize: 12, color: "var(--muted)", margin: "3px 0 0" }}>NEXUP Client Management</p>
        </div>
        {activeTab === "one-time" && (
          <button onClick={() => { setShowForm(true); resetForm(); }} style={{ display: "flex", alignItems: "center", gap: 5, padding: "9px 16px", borderRadius: 8, background: "#0d9488", color: "#fff", border: "none", fontSize: 12, fontWeight: 600, cursor: "pointer", boxShadow: "0 2px 6px rgba(13,148,136,0.3)" }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
            سجل جديد +
          </button>
        )}
      </div>

      {/* Tabs */}
      <div style={{ display: "flex", gap: 0, marginBottom: 16, borderBottom: "2px solid var(--border)" }}>
        {[{ k: "one-time", l: "لمرة واحدة", icon: "📋" }, { k: "recurring", l: "اشتراكات شهرية", icon: "🔄" }].map(tab => (
          <button key={tab.k} onClick={() => setActiveTab(tab.k as typeof activeTab)}
            style={{ padding: "10px 20px", border: "none", borderBottom: activeTab === tab.k ? "2px solid #0d9488" : "2px solid transparent", marginBottom: -2, background: "transparent", color: activeTab === tab.k ? "#0d9488" : "var(--muted)", fontSize: 12, fontWeight: activeTab === tab.k ? 700 : 500, cursor: "pointer", display: "flex", alignItems: "center", gap: 6, transition: "all 0.15s" }}>
            <span>{tab.icon}</span> {tab.l}
          </button>
        ))}
      </div>

      {activeTab === "recurring" && <RecurringTab />}

      {activeTab === "one-time" && (
      <>
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
                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12, minWidth: 1100, tableLayout: "fixed" }}>
                    <colgroup>
                      {[85, 100, 110, 130, 100, 70, 70, 130, 95, 100, 62, 110, 62].map((w, i) => <col key={i} style={{ width: w }} />)}
                    </colgroup>
                    <thead>
                      <tr style={{ background: "linear-gradient(135deg, rgba(13,148,136,0.06) 0%, transparent 100%)" }}>
                        {[{ l: "Date", ar: "التاريخ" }, { l: "Phone", ar: "الهاتف" }, { l: "Client", ar: "العميل" }, { l: "Project", ar: "المشروع" }, { l: "Services", ar: "الخدمات" }, { l: "Price", ar: "السعر" }, { l: "Deposit", ar: "العربون" }, { l: "Remaining", ar: "المتبقي" }, { l: "Designer", ar: "المصمم" }, { l: "Work", ar: "الحالة" }, { l: "Status", ar: "الدفع" }, { l: "Notes", ar: "ملاحظات" }, { l: "Actions", ar: "إجراءات" }].map((c, i) => (
                          <th key={i} style={{ padding: "7px 8px", textAlign: "left", borderBottom: "2px solid var(--border)", borderLeft: i < 12 ? "1px solid var(--border)" : "none", verticalAlign: "middle" }}>
                            <div style={{ fontSize: 10, fontWeight: 700, color: "var(--text)", letterSpacing: "0.02em", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{c.l}</div>
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
                            <td style={{ padding: "5px 8px", fontSize: 11, color: "var(--muted)", whiteSpace: "nowrap", verticalAlign: "middle", borderLeft: "1px solid var(--border)" }}>{fmtDate(p.date)}</td>
                            <td style={{ padding: "5px 8px", fontSize: 11, color: "var(--text-secondary)", direction: "ltr", verticalAlign: "middle", borderLeft: "1px solid var(--border)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.client.phone}</td>
                            <td style={{ padding: "5px 8px", verticalAlign: "middle", borderLeft: "1px solid var(--border)" }}>
                              <div style={{ fontWeight: 600, fontSize: 12, display: "flex", alignItems: "center", gap: 4 }}>
                                <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.client.name}</span>
                                {p.client.isRepeatClient && <span style={{ fontSize: 8, padding: "1px 4px", borderRadius: 3, background: "rgba(139,92,246,0.1)", color: "#8b5cf6", fontWeight: 700, flexShrink: 0 }}>×{p.client.projectCount}</span>}
                              </div>
                              <span style={{ fontSize: 9, padding: "1px 5px", borderRadius: 3, background: tier.bg, color: tier.c, fontWeight: 700 }}>{tier.l}</span>
                            </td>
                            <td style={{ padding: "5px 8px", verticalAlign: "middle", borderLeft: "1px solid var(--border)" }}><InlineText value={p.projectName} onSave={v => patchProject(p.id, { projectName: v })} style={{ fontWeight: 600, fontSize: 12 }} /></td>
                            <td style={{ padding: "5px 8px", verticalAlign: "middle", borderLeft: "1px solid var(--border)" }}>
                              <div style={{ display: "flex", flexWrap: "wrap", gap: 2 }}>
                                {p.services.map(s => <span key={s.id} style={{ padding: "1px 5px", borderRadius: 3, fontSize: 9, fontWeight: 600, background: "rgba(13,148,136,0.08)", color: "#0d9488" }}>{s.name}</span>)}
                                {p.services.length === 0 && <span style={{ fontSize: 9, color: "var(--muted)" }}>{p.customServiceText || "—"}</span>}
                              </div>
                            </td>
                            <td style={{ padding: "5px 8px", fontWeight: 700, direction: "ltr", textAlign: "left", fontSize: 12, verticalAlign: "middle", borderLeft: "1px solid var(--border)" }}>{fmt(Number(p.totalPrice))}</td>
                            <td style={{ padding: "5px 8px", direction: "ltr", textAlign: "left", color: "var(--text-secondary)", fontSize: 12, verticalAlign: "middle", borderLeft: "1px solid var(--border)" }}>{fmt(Number(p.deposit))}</td>
                            <td style={{ padding: "5px 8px", direction: "ltr", textAlign: "left", verticalAlign: "middle", borderLeft: "1px solid var(--border)" }}>
                              <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                                <PayButton remaining={Number(p.remaining)} projectId={p.id} onPay={handlePayPartial} />
                                {(p.payments && p.payments.length > 0) && (
                                  <button onClick={() => setPaymentModal(p)} style={{ padding: "2px 5px", borderRadius: 3, border: "1px solid var(--border)", background: "transparent", color: "var(--muted)", fontSize: 9, cursor: "pointer" }} title="View payment history & receipts">📄 {p.payments.length}</button>
                                )}
                              </div>
                            </td>
                            <td style={{ padding: "5px 8px", verticalAlign: "middle", borderLeft: "1px solid var(--border)" }}>
                              <DesignerInput designerId={p.designer?.id || null} designerName={p.designerName} users={users}
                                onSave={(id, name) => patchProject(p.id, { designerId: id, designerName: name })} />
                            </td>
                            <td style={{ padding: "5px 8px", verticalAlign: "middle", borderLeft: "1px solid var(--border)" }}><WSToggle status={p.workStatus} onToggle={next => patchProject(p.id, { workStatus: next })} /></td>
                            <td style={{ padding: "5px 8px", verticalAlign: "middle", borderLeft: "1px solid var(--border)" }}>
                              <span style={{ padding: "2px 6px", borderRadius: 4, background: ps.bg, color: ps.c, fontSize: 10, fontWeight: 600 }}>{ps.l}</span>
                            </td>
                            <td style={{ padding: "5px 8px", verticalAlign: "middle", borderLeft: "1px solid var(--border)" }}><InlineText value={p.notes || ""} onSave={v => patchProject(p.id, { notes: v || null })} placeholder="note..." style={{ fontSize: 10, color: "var(--muted)" }} /></td>
                            <td style={{ padding: "5px 4px", textAlign: "center", verticalAlign: "middle" }}>
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
        <EditModal project={editModal} users={users} services={services} onClose={() => setEditModal(null)} onSave={handleEditSave} onPaymentsChanged={fetchProjects} />
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
                    {parseFloat(form.deposit || "0") > 0 && (
                      <div style={{ gridColumn: "1 / -1" }}>
                        <label style={{ display: "block", fontSize: 10, fontWeight: 600, color: "var(--muted)", marginBottom: 4 }}>إيصال التحويل 📎 (اختياري — يُرفع مع العربون)</label>
                        <ReceiptDropZone pendingFile={createReceiptFile} onPendingFile={setCreateReceiptFile} />
                      </div>
                    )}
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
      </>
      )}
    </div>
  );
}
