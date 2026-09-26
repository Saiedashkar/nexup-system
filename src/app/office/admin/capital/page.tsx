"use client";

import { useState, useEffect, useCallback, useMemo } from "react";

type LedgerEntry = {
  id: string;
  type: "CAPITAL_IN" | "CAPITAL_SPEND";
  date: string;
  funder: string | null;
  contributionId: string | null;
  description: string;
  category: string | null;
  amount: number;
  balanceAfter: number;
  notes: string | null;
  reference: string | null;
  recurring: boolean;
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

const fmt = (n: number) =>
  n.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 2 });
const toEN = (d: string) =>
  new Date(d).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });

export default function CapitalPage() {
  const [entries, setEntries] = useState<LedgerEntry[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [partners, setPartners] = useState<Partner[]>([]);
  const [loading, setLoading] = useState(true);
  const [showInForm, setShowInForm] = useState(false);
  const [showSpendForm, setShowSpendForm] = useState(false);
  const [convertTarget, setConvertTarget] = useState<LedgerEntry | null>(null);
  const [filter, setFilter] = useState<"ALL" | "CAPITAL_IN" | "CAPITAL_SPEND">("ALL");
  const [error, setError] = useState<string | null>(null);
  const [inForm, setInForm] = useState({
    partnerId: "", amount: "", type: "CASH", fundFlow: "STILL_IN_TREASURY",
    description: "", reference: "", date: new Date().toISOString().split("T")[0],
  });
  const [spendForm, setSpendForm] = useState({
    amount: "", category: "", description: "", notes: "", reference: "", contributionId: "",
    date: new Date().toISOString().split("T")[0],
  });
  const [recurringForm, setRecurringForm] = useState({ amount: "", name: "" });

  const fetchData = useCallback(async () => {
    setLoading(true);
    const [lRes, pRes] = await Promise.all([
      fetch("/api/office/capital-ledger"),
      fetch("/api/office/partners"),
    ]);
    if (lRes.ok) { const d = await lRes.json(); setEntries(d.entries || []); setSummary(d.summary || null); }
    if (pRes.ok) setPartners(await pRes.json());
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
            <div><label style={{ fontSize: 10, fontWeight: 600, color: "var(--muted)" }}>الممول / المستثمر *</label>
              <select value={inForm.partnerId} onChange={e => setInForm(f => ({ ...f, partnerId: e.target.value }))} style={{ width: "100%", padding: "8px 10px", borderRadius: 6, border: "1px solid var(--border)", background: "var(--bg)", color: "var(--text)", fontSize: 12, outline: "none", marginTop: 4 }}>
                <option value="">اختر ممول</option>
                {partners.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </div>
            <div><label style={{ fontSize: 10, fontWeight: 600, color: "var(--muted)" }}>المبلغ (EGP) *</label><input type="number" value={inForm.amount} onChange={e => setInForm(f => ({ ...f, amount: e.target.value }))} style={{ width: "100%", padding: "8px 10px", borderRadius: 6, border: "1px solid var(--border)", background: "var(--bg)", color: "var(--text)", fontSize: 12, outline: "none", marginTop: 4 }} /></div>
            <div><label style={{ fontSize: 10, fontWeight: 600, color: "var(--muted)" }}>النوع *</label>
              <select value={inForm.type} onChange={e => setInForm(f => ({ ...f, type: e.target.value }))} style={{ width: "100%", padding: "8px 10px", borderRadius: 6, border: "1px solid var(--border)", background: "var(--bg)", color: "var(--text)", fontSize: 12, outline: "none", marginTop: 4 }}>
                <option value="CASH">💵 نقدي (قابل للصرف)</option><option value="ASSET">📦 أصل (توثيق فقط)</option>
              </select>
            </div>
            <div><label style={{ fontSize: 10, fontWeight: 600, color: "var(--muted)" }}>تاريخ الاستلام *</label><input type="date" value={inForm.date} onChange={e => setInForm(f => ({ ...f, date: e.target.value }))} style={{ width: "100%", padding: "8px 10px", borderRadius: 6, border: "1px solid var(--border)", background: "var(--bg)", color: "var(--text)", fontSize: 12, outline: "none", marginTop: 4 }} /></div>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 12 }}>
            <div><label style={{ fontSize: 10, fontWeight: 600, color: "var(--muted)" }}>الوصف / ملاحظات</label><input value={inForm.description} onChange={e => setInForm(f => ({ ...f, description: e.target.value }))} placeholder="مثال: رأس مال للمكتب" style={{ width: "100%", padding: "8px 10px", borderRadius: 6, border: "1px solid var(--border)", background: "var(--bg)", color: "var(--text)", fontSize: 12, outline: "none", marginTop: 4 }} /></div>
            <div><label style={{ fontSize: 10, fontWeight: 600, color: "var(--muted)" }}>مرجع (اختياري)</label><input value={inForm.reference} onChange={e => setInForm(f => ({ ...f, reference: e.target.value }))} placeholder="رقم إيصال / تحويل" style={{ width: "100%", padding: "8px 10px", borderRadius: 6, border: "1px solid var(--border)", background: "var(--bg)", color: "var(--text)", fontSize: 12, outline: "none", marginTop: 4 }} /></div>
          </div>
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
            <div><label style={{ fontSize: 10, fontWeight: 600, color: "var(--muted)" }}>المبلغ (EGP) *</label><input type="number" value={spendForm.amount} onChange={e => setSpendForm(f => ({ ...f, amount: e.target.value }))} style={{ width: "100%", padding: "8px 10px", borderRadius: 6, border: "1px solid var(--border)", background: "var(--bg)", color: "var(--text)", fontSize: 12, outline: "none", marginTop: 4 }} /></div>
            <div><label style={{ fontSize: 10, fontWeight: 600, color: "var(--muted)" }}>التاريخ *</label><input type="date" value={spendForm.date} onChange={e => setSpendForm(f => ({ ...f, date: e.target.value }))} style={{ width: "100%", padding: "8px 10px", borderRadius: 6, border: "1px solid var(--border)", background: "var(--bg)", color: "var(--text)", fontSize: 12, outline: "none", marginTop: 4 }} /></div>
            <div><label style={{ fontSize: 10, fontWeight: 600, color: "var(--muted)" }}>التصنيف *</label><input value={spendForm.category} onChange={e => setSpendForm(f => ({ ...f, category: e.target.value }))} placeholder="مثال: تجهيزات، اشتراكات" style={{ width: "100%", padding: "8px 10px", borderRadius: 6, border: "1px solid var(--border)", background: "var(--bg)", color: "var(--text)", fontSize: 12, outline: "none", marginTop: 4 }} /></div>
            <div><label style={{ fontSize: 10, fontWeight: 600, color: "var(--muted)" }}>مرتبط بممول (اختياري)</label>
              <select value={spendForm.contributionId} onChange={e => setSpendForm(f => ({ ...f, contributionId: e.target.value }))} style={{ width: "100%", padding: "8px 10px", borderRadius: 6, border: "1px solid var(--border)", background: "var(--bg)", color: "var(--text)", fontSize: 12, outline: "none", marginTop: 4 }}>
                <option value="">من الصندوق العام</option>
                {partners.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </div>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr", gap: 12, marginBottom: 12 }}>
            <div><label style={{ fontSize: 10, fontWeight: 600, color: "var(--muted)" }}>الوصف / التفاصيل *</label><input value={spendForm.description} onChange={e => setSpendForm(f => ({ ...f, description: e.target.value }))} placeholder="مثال: تجهيزات تأسيس المكتب" style={{ width: "100%", padding: "8px 10px", borderRadius: 6, border: "1px solid var(--border)", background: "var(--bg)", color: "var(--text)", fontSize: 12, outline: "none", marginTop: 4 }} /></div>
            <div><label style={{ fontSize: 10, fontWeight: 600, color: "var(--muted)" }}>ملاحظات</label><input value={spendForm.notes} onChange={e => setSpendForm(f => ({ ...f, notes: e.target.value }))} style={{ width: "100%", padding: "8px 10px", borderRadius: 6, border: "1px solid var(--border)", background: "var(--bg)", color: "var(--text)", fontSize: 12, outline: "none", marginTop: 4 }} /></div>
            <div><label style={{ fontSize: 10, fontWeight: 600, color: "var(--muted)" }}>مرجع (اختياري)</label><input value={spendForm.reference} onChange={e => setSpendForm(f => ({ ...f, reference: e.target.value }))} style={{ width: "100%", padding: "8px 10px", borderRadius: 6, border: "1px solid var(--border)", background: "var(--bg)", color: "var(--text)", fontSize: 12, outline: "none", marginTop: 4 }} /></div>
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
            <div><label style={{ fontSize: 10, fontWeight: 600, color: "var(--muted)" }}>المبلغ الشهري (EGP) *</label><input type="number" value={recurringForm.amount} onChange={e => setRecurringForm(f => ({ ...f, amount: e.target.value }))} style={{ width: "100%", padding: "8px 10px", borderRadius: 6, border: "1px solid var(--border)", background: "var(--bg)", color: "var(--text)", fontSize: 12, outline: "none", marginTop: 4 }} /></div>
            <div><label style={{ fontSize: 10, fontWeight: 600, color: "var(--muted)" }}>الاسم (اختياري)</label><input value={recurringForm.name} onChange={e => setRecurringForm(f => ({ ...f, name: e.target.value }))} placeholder={convertTarget.description} style={{ width: "100%", padding: "8px 10px", borderRadius: 6, border: "1px solid var(--border)", background: "var(--bg)", color: "var(--text)", fontSize: 12, outline: "none", marginTop: 4 }} /></div>
            <div><label style={{ fontSize: 10, fontWeight: 600, color: "var(--muted)" }}>التكرار</label>
              <select defaultValue="MONTHLY" style={{ width: "100%", padding: "8px 10px", borderRadius: 6, border: "1px solid var(--border)", background: "var(--bg)", color: "var(--text)", fontSize: 12, outline: "none", marginTop: 4 }}>
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

      {/* Filters */}
      <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
        {([["ALL", "الكل"], ["CAPITAL_IN", "دخل رأس مال"], ["CAPITAL_SPEND", "صرف من رأس المال"]] as const).map(([k, label]) => (
          <button key={k} onClick={() => setFilter(k)} style={{ padding: "6px 14px", borderRadius: 8, border: filter === k ? "1px solid #8b5cf6" : "1px solid var(--border)", background: filter === k ? "rgba(139,92,246,0.1)" : "transparent", color: filter === k ? "#8b5cf6" : "var(--muted)", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>{label}</button>
        ))}
      </div>

      {/* Ledger */}
      <div style={{ borderRadius: 12, border: "1px solid var(--border)", overflow: "hidden" }}>
        <div style={{ display: "grid", gridTemplateColumns: "100px 110px 1fr 1fr 110px 110px", padding: "10px 16px", background: "var(--surface)", borderBottom: "2px solid var(--border)", fontSize: 11, fontWeight: 600, color: "var(--muted)" }}>
          <div>التاريخ</div><div>النوع</div><div>البيان / المصدر</div><div>التفاصيل</div><div style={{ textAlign: "right" }}>المبلغ</div><div style={{ textAlign: "right" }}>الرصيد بعدها</div>
        </div>
        {loading ? <div style={{ textAlign: "center", padding: 32, color: "var(--muted)" }}>جاري التحميل...</div> :
          visible.length === 0 ? <div style={{ textAlign: "center", padding: 48, color: "var(--muted)" }}>لا توجد حركات بعد.</div> :
          visible.map(e => (
            <div key={`${e.type}-${e.id}`} style={{ display: "grid", gridTemplateColumns: "100px 110px 1fr 1fr 110px 110px", padding: "10px 16px", borderBottom: "1px solid var(--border)", fontSize: 13, alignItems: "center", borderRight: `3px solid ${isSpend(e.type) ? "#ef4444" : "#10b981"}` }}>
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
                {isSpend(e.type) && !e.recurring && (
                  <button onClick={() => setConvertTarget(e)} style={{ marginRight: 6, padding: "1px 8px", borderRadius: 6, border: "1px solid rgba(245,158,11,0.4)", background: "rgba(245,158,11,0.06)", color: "#f59e0b", fontSize: 10, cursor: "pointer" }}>＋ تحويل لمصروف ثابت</button>
                )}
              </div>
              <div style={{ textAlign: "right", fontWeight: 700, direction: "ltr", color: isSpend(e.type) ? "#ef4444" : "#10b981" }}>
                {isSpend(e.type) ? "−" : "+"}{fmt(e.amount)} EGP
              </div>
              <div style={{ textAlign: "right", fontWeight: 700, direction: "ltr", color: e.balanceAfter < 0 ? "#ef4444" : "var(--text)" }}>{fmt(e.balanceAfter)}</div>
            </div>
          ))}
      </div>
    </div>
  );
}
