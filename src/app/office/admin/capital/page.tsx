"use client";

import { useState, useEffect, useCallback, useMemo } from "react";

type LedgerEntry = {
  id: string;
  type: "CAPITAL_IN" | "CAPITAL_SPEND";
  date: string;
  funder: string | null;
  partnerId?: string | null;
  contributionId: string | null;
  description: string;
  category: string | null;
  amount: number;
  balanceAfter: number;
  notes: string | null;
  reference: string | null;
  recurring: boolean;
  fundFlow?: string | null;
  contributionType?: "CASH" | "ASSET" | null;
};
type Summary = {
  totalReceived: number;
  totalSpent: number;
  available: number;
  contributionCount: number;
  spendCount: number;
  funderCount: number;
};
type Partner = { id: string; name: string };
type ContributionOpt = { id: string; amount: number; date: string; type: string; partner: { name: string } };

const fmt = (n: number) =>
  n.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 2 });
const toEN = (d: string) =>
  new Date(d).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });

const inputStyle = {
  width: "100%", padding: "8px 10px", borderRadius: 6, border: "1px solid var(--border)",
  background: "var(--bg)", color: "var(--text)", fontSize: 12, outline: "none", marginTop: 4,
};
const labelStyle = { fontSize: 10, fontWeight: 600, color: "var(--muted)" };
const dialogErrorStyle = {
  padding: "8px 12px", borderRadius: 8, background: "rgba(239,68,68,0.08)",
  border: "1px solid rgba(239,68,68,0.3)", color: "#ef4444", fontSize: 12, marginBottom: 12, whiteSpace: "pre-line",
};

function FundFlowToggle({ value, onToggle }: { value: string; onToggle: () => void }) {
  return (
    <div style={{ padding: "12px 16px", borderRadius: 8, background: "rgba(139,92,246,0.04)", border: "1px solid rgba(139,92,246,0.15)", marginBottom: 12 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: "var(--text)" }}>
            {value === "SPENT_ALREADY" ? "✅ مصروف بالفعل" : "💰 متاح في الخزينة"}
          </div>
          <div style={{ fontSize: 10, color: "var(--muted)", marginTop: 2 }}>
            {value === "SPENT_ALREADY"
              ? "المبلغ صُرف من قِبل الشريك على شيء محدد — يُسجَّل في رأس المال فقط ولا يُحتسب ضمن رصيد الخزينة، ولا يُسجَّل كمصروف مكتب."
              : "سيُضاف هذا المبلغ كسيولة حقيقية في خزينة المكتب ويُحتسب ضمن الرصيد المتاح."}
          </div>
        </div>
        <button
          onClick={onToggle}
          style={{
            width: 52, height: 28, borderRadius: 14, border: "none", cursor: "pointer", position: "relative",
            background: value === "STILL_IN_TREASURY" ? "#8b5cf6" : "rgba(107,114,128,0.3)",
            transition: "background 0.2s",
          }}
        >
          <div style={{
            width: 22, height: 22, borderRadius: "50%", background: "#fff", position: "absolute", top: 3,
            left: value === "STILL_IN_TREASURY" ? 27 : 3,
            transition: "left 0.2s", boxShadow: "0 1px 3px rgba(0,0,0,0.2)",
          }} />
        </button>
      </div>
    </div>
  );
}

export default function CapitalPage() {
  const [entries, setEntries] = useState<LedgerEntry[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [partners, setPartners] = useState<Partner[]>([]);
  const [contributions, setContributions] = useState<ContributionOpt[]>([]);
  const [loading, setLoading] = useState(true);
  const [showInForm, setShowInForm] = useState(false);
  const [showSpendForm, setShowSpendForm] = useState(false);
  const [convertTarget, setConvertTarget] = useState<LedgerEntry | null>(null);
  const [filter, setFilter] = useState<"ALL" | "CAPITAL_IN" | "CAPITAL_SPEND">("ALL");
  const [error, setError] = useState<string | null>(null);
  const [inForm, setInForm] = useState({
    partnerId: "", amount: "", type: "CASH", fundFlow: "SPENT_ALREADY",
    description: "", reference: "", date: new Date().toISOString().split("T")[0],
  });
  const [spendForm, setSpendForm] = useState({
    amount: "", category: "", description: "", notes: "", reference: "", contributionId: "",
    date: new Date().toISOString().split("T")[0],
  });
  const [recurringForm, setRecurringForm] = useState({ amount: "", name: "" });
  const [editIn, setEditIn] = useState<LedgerEntry | null>(null);
  const [editInForm, setEditInForm] = useState({ partnerId: "", amount: "", type: "CASH", fundFlow: "SPENT_ALREADY", description: "", reference: "", date: "" });
  const [editSpend, setEditSpend] = useState<LedgerEntry | null>(null);
  const [editSpendForm, setEditSpendForm] = useState({ amount: "", date: "", category: "", description: "", notes: "", reference: "", contributionId: "" });
  const [confirmDeleteId, setConfirmDeleteId] = useState<{ id: string; kind: "in" | "spend"; force: boolean } | null>(null);
  const [dialogError, setDialogError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    const [lRes, pRes, cRes] = await Promise.all([
      fetch("/api/office/capital-ledger"),
      fetch("/api/office/partners"),
      fetch("/api/office/capital-contributions"),
    ]);
    if (lRes.ok) { const d = await lRes.json(); setEntries(d.entries || []); setSummary(d.summary || null); }
    if (pRes.ok) setPartners(await pRes.json());
    if (cRes.ok) {
      // Only CASH contributions are spendable money — attribution targets.
      setContributions(((await cRes.json()) as ContributionOpt[]).filter(c => c.type === "CASH"));
    }
    setLoading(false);
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  const visible = useMemo(
    () => entries.filter(e => filter === "ALL" || e.type === filter),
    [entries, filter],
  );

  const submitIn = async () => {
    setError(null);
    if (!inForm.partnerId || !inForm.amount) return;
    const res = await fetch("/api/office/capital-contributions", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...inForm, amount: parseFloat(inForm.amount) }),
    });
    if (!res.ok) { setError((await res.json().catch(() => ({}))).error || "فشل الحفظ"); return; }
    setShowInForm(false); fetchData();
  };

  const submitSpend = async () => {
    setError(null);
    if (!spendForm.amount || !spendForm.description || !spendForm.category) return;
    const res = await fetch("/api/office/capital-spends", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...spendForm,
        amount: parseFloat(spendForm.amount),
        contributionId: spendForm.contributionId || null,
      }),
    });
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      setError(j.message || j.error || "فشل الحفظ");
      return;
    }
    setSpendForm(f => ({ ...f, amount: "", description: "", notes: "", reference: "" }));
    setShowSpendForm(false); fetchData();
  };

  const submitConvert = async () => {
    if (!convertTarget || !recurringForm.amount) return;
    const res = await fetch("/api/office/fixed-expenses", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "convert", spendId: convertTarget.id,
        recurringAmount: parseFloat(recurringForm.amount),
        name: recurringForm.name || convertTarget.description,
      }),
    });
    if (res.ok) { setConvertTarget(null); setRecurringForm({ amount: "", name: "" }); fetchData(); }
  };

  const isSpend = (t: LedgerEntry["type"]) => t === "CAPITAL_SPEND";

  const closeDialogs = () => { setEditIn(null); setEditSpend(null); setConfirmDeleteId(null); setDialogError(null); };

  const startEditIn = (e: LedgerEntry) => {
    setError(null); setDialogError(null);
    setEditSpend(null); setConfirmDeleteId(null);
    setEditIn(e);
    setEditInForm({
      partnerId: e.partnerId || "",
      amount: String(e.amount),
      type: e.contributionType || "CASH",
      fundFlow: e.fundFlow || "SPENT_ALREADY",
      description: e.description === "مساهمة رأس مال" ? "" : e.description,
      reference: e.reference || "",
      date: e.date.split("T")[0],
    });
  };

  // Edits the EXISTING contribution row in place — never creates a new one.
  const submitEditIn = async () => {
    if (!editIn) return;
    setDialogError(null);
    const { partnerId, ...rest } = editInForm;
    const res = await fetch(`/api/office/capital-contributions/${editIn.id}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...rest, ...(partnerId ? { partnerId } : {}), amount: parseFloat(editInForm.amount) }),
    });
    if (!res.ok) { const j = await res.json().catch(() => ({})); setDialogError(j.message || j.error || "فشل التعديل"); return; }
    setEditIn(null); fetchData();
  };

  const startEditSpend = (e: LedgerEntry) => {
    setError(null); setDialogError(null);
    setEditIn(null); setConfirmDeleteId(null);
    setEditSpend(e);
    setEditSpendForm({
      amount: String(e.amount), date: e.date.split("T")[0], category: e.category || "",
      description: e.description, notes: e.notes || "", reference: e.reference || "",
      contributionId: e.contributionId || "",
    });
  };

  const submitEditSpend = async () => {
    if (!editSpend) return;
    setDialogError(null);
    const res = await fetch(`/api/office/capital-spends/${editSpend.id}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...editSpendForm, amount: parseFloat(editSpendForm.amount), contributionId: editSpendForm.contributionId || null }),
    });
    if (!res.ok) { const j = await res.json().catch(() => ({})); setDialogError(j.message || j.error || "فشل التعديل"); return; }
    setEditSpend(null); fetchData();
  };

  const requestDelete = (e: LedgerEntry) => {
    setError(null); setDialogError(null);
    setEditIn(null); setEditSpend(null);
    setConfirmDeleteId({ id: e.id, kind: e.type === "CAPITAL_IN" ? "in" : "spend", force: false });
  };

  // SOFT delete only. If a converted spend is linked to a recurring
  // definition, the first attempt surfaces what is linked and a second
  // explicit confirmation (force) also deactivates the recurrence.
  const performDelete = async () => {
    if (!confirmDeleteId) return;
    setDialogError(null);
    const qs = confirmDeleteId.kind === "spend" && confirmDeleteId.force ? "?force=1" : "";
    const url = confirmDeleteId.kind === "in"
      ? `/api/office/capital-contributions/${confirmDeleteId.id}`
      : `/api/office/capital-spends/${confirmDeleteId.id}${qs}`;
    const res = await fetch(url, { method: "DELETE" });
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      if (j.error === "RECURRING_LINKED") {
        setConfirmDeleteId({ ...confirmDeleteId, force: true });
        setDialogError(j.message || "");
        return;
      }
      setDialogError(j.message || j.error || "فشل الحذف");
      return;
    }
    setConfirmDeleteId(null); fetchData();
  };

  const deleteTarget = confirmDeleteId ? entries.find(x => x.id === confirmDeleteId.id) : null;

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24 }}>
        <div>
          <h1 style={{ fontSize: 24, fontWeight: 800, color: "var(--text)", margin: 0 }}>رأس المال والتمويل</h1>
          <p style={{ fontSize: 13, color: "var(--muted)", margin: "4px 0 0" }}>
            سجل رأس المال: دخل كام؟ اتصرف كام؟ فاضل كام؟ — Capital Ledger
          </p>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={() => { setShowSpendForm(true); setShowInForm(false); }} style={{ padding: "9px 18px", borderRadius: 8, border: "none", background: "#ef4444", color: "#fff", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>− صرف من رأس المال</button>
          <button onClick={() => { setShowInForm(true); setShowSpendForm(false); }} style={{ padding: "9px 18px", borderRadius: 8, border: "none", background: "#10b981", color: "#fff", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>＋ إضافة رأس مال</button>
        </div>
      </div>

      {error && (
        <div style={{ padding: "10px 16px", borderRadius: 8, background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.3)", color: "#ef4444", fontSize: 13, marginBottom: 16 }}>{error}</div>
      )}

      {/* Summary cards */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 14, marginBottom: 20 }}>
        {[
          { label: "إجمالي رأس المال المُستلم", value: fmt(summary?.totalReceived ?? 0), sub: `${summary?.contributionCount ?? 0} مساهمة · ${summary?.funderCount ?? 0} ممول`, color: "#10b981", bg: "rgba(16,185,129,0.06)" },
          { label: "إجمالي المصروف من رأس المال", value: fmt(summary?.totalSpent ?? 0), sub: `${summary?.spendCount ?? 0} حركة صرف`, color: "#ef4444", bg: "rgba(239,68,68,0.06)" },
          { label: "رأس المال المتاح", value: fmt(summary?.available ?? 0), sub: "المستلم − المصروف", color: "#8b5cf6", bg: "rgba(139,92,246,0.06)" },
          { label: "عدد الممولين", value: String(summary?.funderCount ?? 0), sub: "المساهمون برأس المال النقدي", color: "#3b82f6", bg: "rgba(59,130,246,0.06)" },
        ].map(c => (
          <div key={c.label} style={{ padding: "18px 20px", borderRadius: 12, background: c.bg, border: "1px solid var(--border)" }}>
            <div style={{ fontSize: 11, color: "var(--muted)", marginBottom: 6 }}>{c.label}</div>
            <div style={{ fontSize: 24, fontWeight: 800, color: c.color, direction: "ltr" }}>{c.value} EGP</div>
            <div style={{ fontSize: 10, color: "var(--muted)", marginTop: 4 }}>{c.sub}</div>
          </div>
        ))}
      </div>

      {/* CAPITAL IN form */}
      {showInForm && (
        <div style={{ padding: 20, borderRadius: 12, background: "var(--surface)", border: "1px solid var(--border)", marginBottom: 16 }}>
          <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 12 }}>مساهمة رأس مال جديدة — Capital IN</div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12, marginBottom: 12 }}>
            <div><label style={labelStyle}>الممول / المستثمر *</label>
              <select value={inForm.partnerId} onChange={e => setInForm(f => ({ ...f, partnerId: e.target.value }))} style={inputStyle}>
                <option value="">اختر ممول</option>
                {partners.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </div>
            <div><label style={labelStyle}>المبلغ (EGP) *</label><input type="number" value={inForm.amount} onChange={e => setInForm(f => ({ ...f, amount: e.target.value }))} style={inputStyle} /></div>
            <div><label style={labelStyle}>النوع *</label>
              <select value={inForm.type} onChange={e => setInForm(f => ({ ...f, type: e.target.value }))} style={inputStyle}>
                <option value="CASH">💵 نقدي (قابل للصرف)</option><option value="ASSET">📦 أصل (توثيق فقط)</option>
              </select>
            </div>
            <div><label style={labelStyle}>تاريخ الاستلام *</label><input type="date" value={inForm.date} onChange={e => setInForm(f => ({ ...f, date: e.target.value }))} style={inputStyle} /></div>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 12 }}>
            <div><label style={labelStyle}>الوصف / ملاحظات</label><input value={inForm.description} onChange={e => setInForm(f => ({ ...f, description: e.target.value }))} placeholder="مثال: رأس مال للمكتب" style={inputStyle} /></div>
            <div><label style={labelStyle}>مرجع (اختياري)</label><input value={inForm.reference} onChange={e => setInForm(f => ({ ...f, reference: e.target.value }))} placeholder="رقم إيصال / تحويل" style={inputStyle} /></div>
          </div>

          {/* Fund Flow Toggle — restored from the previous capital page */}
          <FundFlowToggle
            value={inForm.fundFlow}
            onToggle={() => setInForm(f => ({ ...f, fundFlow: f.fundFlow === "SPENT_ALREADY" ? "STILL_IN_TREASURY" : "SPENT_ALREADY" }))}
          />

          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={submitIn} style={{ padding: "8px 20px", borderRadius: 8, border: "none", background: "#10b981", color: "#fff", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>حفظ</button>
            <button onClick={() => setShowInForm(false)} style={{ padding: "8px 20px", borderRadius: 8, border: "1px solid var(--border)", background: "transparent", color: "var(--muted)", fontSize: 12, cursor: "pointer" }}>إلغاء</button>
          </div>
        </div>
      )}

      {/* CAPITAL SPEND form */}
      {showSpendForm && (
        <div style={{ padding: 20, borderRadius: 12, background: "var(--surface)", border: "1px solid var(--border)", marginBottom: 16 }}>
          <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 4 }}>صرف من رأس المال — CAPITAL SPEND</div>
          <div style={{ fontSize: 11, color: "var(--muted)", marginBottom: 12 }}>يُخصم من رأس المال المتاح مباشرة — لا يُسجَّل كمصروف مكتب ولا يمس خزينة التشغيل.</div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12, marginBottom: 12 }}>
            <div><label style={labelStyle}>المبلغ (EGP) *</label><input type="number" value={spendForm.amount} onChange={e => setSpendForm(f => ({ ...f, amount: e.target.value }))} style={inputStyle} /></div>
            <div><label style={labelStyle}>التاريخ *</label><input type="date" value={spendForm.date} onChange={e => setSpendForm(f => ({ ...f, date: e.target.value }))} style={inputStyle} /></div>
            <div><label style={labelStyle}>التصنيف *</label><input value={spendForm.category} onChange={e => setSpendForm(f => ({ ...f, category: e.target.value }))} placeholder="مثال: تجهيزات، اشتراكات" style={inputStyle} /></div>
            <div><label style={labelStyle}>مرتبط بمساهمة (اختياري)</label>
              <select value={spendForm.contributionId} onChange={e => setSpendForm(f => ({ ...f, contributionId: e.target.value }))} style={inputStyle}>
                <option value="">من الصندوق العام</option>
                {contributions.map(c => <option key={c.id} value={c.id}>{c.partner.name} — {fmt(c.amount)} EGP ({toEN(c.date)})</option>)}
              </select>
            </div>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr", gap: 12, marginBottom: 12 }}>
            <div><label style={labelStyle}>الوصف / التفاصيل *</label><input value={spendForm.description} onChange={e => setSpendForm(f => ({ ...f, description: e.target.value }))} placeholder="مثال: تجهيزات تأسيس المكتب" style={inputStyle} /></div>
            <div><label style={labelStyle}>ملاحظات</label><input value={spendForm.notes} onChange={e => setSpendForm(f => ({ ...f, notes: e.target.value }))} style={inputStyle} /></div>
            <div><label style={labelStyle}>مرجع (اختياري)</label><input value={spendForm.reference} onChange={e => setSpendForm(f => ({ ...f, reference: e.target.value }))} style={inputStyle} /></div>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={submitSpend} style={{ padding: "8px 20px", borderRadius: 8, border: "none", background: "#ef4444", color: "#fff", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>حفظ الصرف</button>
            <button onClick={() => setShowSpendForm(false)} style={{ padding: "8px 20px", borderRadius: 8, border: "1px solid var(--border)", background: "transparent", color: "var(--muted)", fontSize: 12, cursor: "pointer" }}>إلغاء</button>
          </div>
        </div>
      )}

      {/* Convert-to-recurring dialog */}
      {convertTarget && (
        <div style={{ padding: 20, borderRadius: 12, background: "rgba(245,158,11,0.04)", border: "1px solid rgba(245,158,11,0.3)", marginBottom: 16 }}>
          <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 4 }}>تحويل إلى مصروف ثابت متكرر</div>
          <div style={{ fontSize: 11, color: "var(--muted)", marginBottom: 12 }}>
            سيبدأ التكرار من الشهر <b>التالي</b> لشهر الصرف ({toEN(convertTarget.date)}) — لن يُحتسب الشهر الحالي مرتين.
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12, marginBottom: 12 }}>
            <div><label style={labelStyle}>المبلغ الشهري (EGP) *</label><input type="number" value={recurringForm.amount} onChange={e => setRecurringForm(f => ({ ...f, amount: e.target.value }))} style={inputStyle} /></div>
            <div><label style={labelStyle}>الاسم (اختياري)</label><input value={recurringForm.name} onChange={e => setRecurringForm(f => ({ ...f, name: e.target.value }))} placeholder={convertTarget.description} style={inputStyle} /></div>
            <div><label style={labelStyle}>التكرار</label>
              <select defaultValue="MONTHLY" style={inputStyle}>
                <option value="MONTHLY">شهري</option>
              </select>
            </div>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={submitConvert} style={{ padding: "8px 20px", borderRadius: 8, border: "none", background: "#f59e0b", color: "#fff", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>تفعيل التكرار</button>
            <button onClick={() => setConvertTarget(null)} style={{ padding: "8px 20px", borderRadius: 8, border: "1px solid var(--border)", background: "transparent", color: "var(--muted)", fontSize: 12, cursor: "pointer" }}>إلغاء</button>
          </div>
        </div>
      )}

      {/* Edit CAPITAL IN dialog — updates the existing contribution */}
      {editIn && (
        <div style={{ padding: 20, borderRadius: 12, background: "var(--surface)", border: "1px solid rgba(139,92,246,0.35)", marginBottom: 16 }}>
          <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 4 }}>تعديل مساهمة رأس مال</div>
          <div style={{ fontSize: 11, color: "var(--muted)", marginBottom: 12 }}>
            التعديل يُطبَّق على نفس المساهمة المسجلة{editIn.funder ? ` (${editIn.funder})` : ""} — لن يتم إنشاء سجل جديد.
            تعديل المبلغ أو النوع مرفوض إذا كان سيجعل رأس المال المتاح سالبًا.
          </div>
          {dialogError && <div style={dialogErrorStyle}>{dialogError}</div>}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12, marginBottom: 12 }}>
            <div><label style={labelStyle}>الممول / المستثمر *</label>
              <select value={editInForm.partnerId} onChange={e => setEditInForm(f => ({ ...f, partnerId: e.target.value }))} style={inputStyle}>
                <option value="">اختر ممول</option>
                {partners.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </div>
            <div><label style={labelStyle}>المبلغ (EGP) *</label><input type="number" value={editInForm.amount} onChange={e => setEditInForm(f => ({ ...f, amount: e.target.value }))} style={inputStyle} /></div>
            <div><label style={labelStyle}>النوع *</label>
              <select value={editInForm.type} onChange={e => setEditInForm(f => ({ ...f, type: e.target.value }))} style={inputStyle}>
                <option value="CASH">💵 نقدي (قابل للصرف)</option><option value="ASSET">📦 أصل (توثيق فقط)</option>
              </select>
            </div>
            <div><label style={labelStyle}>تاريخ الاستلام *</label><input type="date" value={editInForm.date} onChange={e => setEditInForm(f => ({ ...f, date: e.target.value }))} style={inputStyle} /></div>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 12 }}>
            <div><label style={labelStyle}>الوصف / ملاحظات</label><input value={editInForm.description} onChange={e => setEditInForm(f => ({ ...f, description: e.target.value }))} style={inputStyle} /></div>
            <div><label style={labelStyle}>مرجع (اختياري)</label><input value={editInForm.reference} onChange={e => setEditInForm(f => ({ ...f, reference: e.target.value }))} style={inputStyle} /></div>
          </div>
          <FundFlowToggle
            value={editInForm.fundFlow}
            onToggle={() => setEditInForm(f => ({ ...f, fundFlow: f.fundFlow === "SPENT_ALREADY" ? "STILL_IN_TREASURY" : "SPENT_ALREADY" }))}
          />
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={submitEditIn} style={{ padding: "8px 20px", borderRadius: 8, border: "none", background: "#8b5cf6", color: "#fff", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>حفظ التعديل</button>
            <button onClick={closeDialogs} style={{ padding: "8px 20px", borderRadius: 8, border: "1px solid var(--border)", background: "transparent", color: "var(--muted)", fontSize: 12, cursor: "pointer" }}>إلغاء</button>
          </div>
        </div>
      )}

      {/* Edit CAPITAL SPEND dialog */}
      {editSpend && (
        <div style={{ padding: 20, borderRadius: 12, background: "var(--surface)", border: "1px solid rgba(239,68,68,0.35)", marginBottom: 16 }}>
          <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 4 }}>تعديل حركة صرف من رأس المال</div>
          <div style={{ fontSize: 11, color: "var(--muted)", marginBottom: 12 }}>
            زيادة المبلغ مرفوضة إذا تجاوزت رأس المال المتاح ({fmt(summary?.available ?? 0)} EGP).
            {editSpend.recurring && (
              <div style={{ marginTop: 6, padding: "6px 10px", borderRadius: 6, background: "rgba(245,158,11,0.08)", border: "1px solid rgba(245,158,11,0.3)", color: "#f59e0b" }}>
                🔁 هذا الصرف مرتبط بمصروف ثابت متكرر — التعديل لا يغيّر التعريف ولا الشهور المُنشأة مسبقًا.
              </div>
            )}
          </div>
          {dialogError && <div style={dialogErrorStyle}>{dialogError}</div>}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12, marginBottom: 12 }}>
            <div><label style={labelStyle}>المبلغ (EGP) *</label><input type="number" value={editSpendForm.amount} onChange={e => setEditSpendForm(f => ({ ...f, amount: e.target.value }))} style={inputStyle} /></div>
            <div><label style={labelStyle}>التاريخ *</label><input type="date" value={editSpendForm.date} onChange={e => setEditSpendForm(f => ({ ...f, date: e.target.value }))} style={inputStyle} /></div>
            <div><label style={labelStyle}>التصنيف *</label><input value={editSpendForm.category} onChange={e => setEditSpendForm(f => ({ ...f, category: e.target.value }))} style={inputStyle} /></div>
            <div><label style={labelStyle}>مرتبط بمساهمة (اختياري)</label>
              <select value={editSpendForm.contributionId} onChange={e => setEditSpendForm(f => ({ ...f, contributionId: e.target.value }))} style={inputStyle}>
                <option value="">من الصندوق العام</option>
                {contributions.map(c => <option key={c.id} value={c.id}>{c.partner.name} — {fmt(c.amount)} EGP ({toEN(c.date)})</option>)}
              </select>
            </div>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr", gap: 12, marginBottom: 12 }}>
            <div><label style={labelStyle}>الوصف / التفاصيل *</label><input value={editSpendForm.description} onChange={e => setEditSpendForm(f => ({ ...f, description: e.target.value }))} style={inputStyle} /></div>
            <div><label style={labelStyle}>ملاحظات</label><input value={editSpendForm.notes} onChange={e => setEditSpendForm(f => ({ ...f, notes: e.target.value }))} style={inputStyle} /></div>
            <div><label style={labelStyle}>مرجع (اختياري)</label><input value={editSpendForm.reference} onChange={e => setEditSpendForm(f => ({ ...f, reference: e.target.value }))} style={inputStyle} /></div>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={submitEditSpend} style={{ padding: "8px 20px", borderRadius: 8, border: "none", background: "#8b5cf6", color: "#fff", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>حفظ التعديل</button>
            <button onClick={closeDialogs} style={{ padding: "8px 20px", borderRadius: 8, border: "1px solid var(--border)", background: "transparent", color: "var(--muted)", fontSize: 12, cursor: "pointer" }}>إلغاء</button>
          </div>
        </div>
      )}

      {/* Delete confirmation dialog — soft delete only */}
      {confirmDeleteId && (
        <div style={{ padding: 20, borderRadius: 12, background: "rgba(239,68,68,0.04)", border: "1px solid rgba(239,68,68,0.3)", marginBottom: 16 }}>
          <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 4 }}>
            {confirmDeleteId.kind === "in" ? "تأكيد حذف مساهمة رأس مال" : "تأكيد حذف حركة صرف"}
          </div>
          {deleteTarget && (
            <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 8 }}>
              {toEN(deleteTarget.date)} · {deleteTarget.funder ? `${deleteTarget.funder} · ` : ""}{deleteTarget.description} ·{" "}
              <b style={{ direction: "ltr", display: "inline-block", color: "var(--text)" }}>{fmt(deleteTarget.amount)} EGP</b>
            </div>
          )}
          <div style={{ fontSize: 11, color: "var(--muted)", marginBottom: 12 }}>
            الحذف حذف ناعم (Soft Delete) — السجل يُحفظ تاريخيًا ويُستبعد فقط من الإجماليات والدفتر، ويُعاد أثره للرصيد تلقائيًا.
            {confirmDeleteId.kind === "in" && " إذا كان المبلغ قد صُرف من رأس المال فسيتم رفض الحذف حمايةً للرصيد التاريخي."}
            {confirmDeleteId.kind === "spend" && deleteTarget?.recurring && " ⚠️ هذا الصرف مرتبط بمصروف ثابت متكرر — راجع التنبيه أدناه."}
          </div>
          {dialogError && <div style={dialogErrorStyle}>{dialogError}</div>}
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={performDelete} style={{ padding: "8px 20px", borderRadius: 8, border: "none", background: "#ef4444", color: "#fff", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>
              {confirmDeleteId.force ? "تأكيد الحذف وإيقاف التكرار" : "تأكيد الحذف"}
            </button>
            <button onClick={closeDialogs} style={{ padding: "8px 20px", borderRadius: 8, border: "1px solid var(--border)", background: "transparent", color: "var(--muted)", fontSize: 12, cursor: "pointer" }}>إلغاء</button>
          </div>
        </div>
      )}

      {/* Filters */}
      <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
        {([["ALL", "الكل"], ["CAPITAL_IN", "دخل رأس مال"], ["CAPITAL_SPEND", "صرف من رأس المال"]] as const).map(([k, label]) => (
          <button key={k} onClick={() => setFilter(k)} style={{ padding: "6px 14px", borderRadius: 8, border: filter === k ? "1px solid #8b5cf6" : "1px solid var(--border)", background: filter === k ? "rgba(139,92,246,0.1)" : "transparent", color: filter === k ? "#8b5cf6" : "var(--muted)", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>{label}</button>
        ))}
      </div>

      {/* Ledger */}
      <div style={{ borderRadius: 12, border: "1px solid var(--border)", overflow: "hidden" }}>
        <div style={{ display: "grid", gridTemplateColumns: "100px 110px 1fr 1fr 110px 110px 90px", padding: "10px 16px", background: "var(--surface)", borderBottom: "2px solid var(--border)", fontSize: 11, fontWeight: 600, color: "var(--muted)" }}>
          <div>التاريخ</div><div>النوع</div><div>البيان / المصدر</div><div>التفاصيل</div><div style={{ textAlign: "right" }}>المبلغ</div><div style={{ textAlign: "right" }}>الرصيد بعدها</div><div>إجراءات</div>
        </div>
        {loading ? <div style={{ textAlign: "center", padding: 32, color: "var(--muted)" }}>جاري التحميل...</div> :
          visible.length === 0 ? <div style={{ textAlign: "center", padding: 48, color: "var(--muted)" }}>لا توجد حركات بعد.</div> :
          visible.map(e => (
            <div key={`${e.type}-${e.id}`} style={{ display: "grid", gridTemplateColumns: "100px 110px 1fr 1fr 110px 110px 90px", padding: "10px 16px", borderBottom: "1px solid var(--border)", fontSize: 13, alignItems: "center", borderRight: `3px solid ${isSpend(e.type) ? "#ef4444" : "#10b981"}` }}>
              <div style={{ fontSize: 12, color: "var(--muted)" }}>{toEN(e.date)}</div>
              <div>
                <span style={{ padding: "2px 8px", borderRadius: 10, fontSize: 10, fontWeight: 700, background: isSpend(e.type) ? "rgba(239,68,68,0.1)" : "rgba(16,185,129,0.1)", color: isSpend(e.type) ? "#ef4444" : "#10b981" }}>
                  {isSpend(e.type) ? "− صرف" : "+ دخل رأس مال"}
                </span>
              </div>
              <div>
                <div style={{ fontWeight: 600 }}>{e.description}</div>
                {e.funder && <div style={{ fontSize: 11, color: "var(--muted)" }}>الممول: {e.funder}</div>}
              </div>
              <div style={{ fontSize: 11, color: "var(--muted)" }}>
                {e.category ? `التصنيف: ${e.category}` : ""}
                {e.reference ? ` · مرجع: ${e.reference}` : ""}
                {e.recurring ? " · 🔁 متكرر" : ""}
                {!isSpend(e.type) && e.fundFlow && (
                  <span style={{
                    padding: "1px 8px", borderRadius: 10, fontSize: 9, fontWeight: 700, marginRight: 6,
                    background: e.fundFlow === "SPENT_ALREADY" ? "rgba(239,68,68,0.1)" : "rgba(139,92,246,0.1)",
                    color: e.fundFlow === "SPENT_ALREADY" ? "#ef4444" : "#8b5cf6",
                  }}>
                    {e.fundFlow === "SPENT_ALREADY" ? "✅ مصروف بالفعل" : "💰 متاح في الخزينة"}
                  </span>
                )}
                {isSpend(e.type) && !e.recurring && (
                  <button onClick={() => setConvertTarget(e)} style={{ marginRight: 6, padding: "1px 8px", borderRadius: 6, border: "1px solid rgba(245,158,11,0.4)", background: "rgba(245,158,11,0.06)", color: "#f59e0b", fontSize: 10, cursor: "pointer" }}>＋ تحويل لمصروف ثابت</button>
                )}
              </div>
              <div style={{ textAlign: "right", fontWeight: 700, direction: "ltr", color: isSpend(e.type) ? "#ef4444" : "#10b981" }}>
                {isSpend(e.type) ? "−" : "+"}{fmt(e.amount)} EGP
              </div>
              <div style={{ textAlign: "right", fontWeight: 700, direction: "ltr", color: e.balanceAfter < 0 ? "#ef4444" : "var(--text)" }}>{fmt(e.balanceAfter)}</div>
              <div style={{ display: "flex", gap: 4 }}>
                <button
                  onClick={() => (isSpend(e.type) ? startEditSpend(e) : startEditIn(e))}
                  title="تعديل"
                  style={{ padding: "2px 7px", borderRadius: 5, border: "1px solid var(--border)", background: "transparent", color: "var(--muted)", fontSize: 11, cursor: "pointer", lineHeight: 1.4 }}
                >✏️</button>
                <button
                  onClick={() => requestDelete(e)}
                  title="حذف"
                  style={{ padding: "2px 7px", borderRadius: 5, border: "1px solid rgba(239,68,68,0.3)", background: "rgba(239,68,68,0.05)", color: "#ef4444", fontSize: 11, cursor: "pointer", lineHeight: 1.4 }}
                >🗑</button>
              </div>
            </div>
          ))}
      </div>
    </div>
  );
}
