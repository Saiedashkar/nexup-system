"use client";

import { useState, useEffect, useCallback, useMemo, useRef } from "react";

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
  spendType?: "EXPENSE" | "PERSON_WITHDRAWAL" | "CUSTODY" | null;
  recipientPartnerId?: string | null;
  recipientName?: string | null;
};
type Summary = {
  totalReceived: number;
  totalSpent: number;
  available: number;
  /** عدد المساهمات النقدية فقط — يطابق المبلغ الذي يُعرض بجانبه */
  contributionCount: number;
  spendCount: number;
  funderCount: number;
  /* تعريفات مشتركة مع الشريط العلوي وواجهات الـAPI (capital-metrics) */
  cashFundingInTreasury: number;
  cashFundingSpentAlready: number;
  /** مصروف مدفوع فعلًا من النقد الذي دخل الخزينة */
  spentFromTreasury: number;
  assetFunding: number;
  assetContributionCount: number;
  availableCashInTreasury: number;
  reconciliationWarnings: string[];
};
type Partner = { id: string; name: string };
type ContributionOpt = { id: string; amount: number; date: string; type: string; partner: { name: string } };
type SpendType = "EXPENSE" | "PERSON_WITHDRAWAL" | "CUSTODY";
type PersonWithdrawalTotal = {
  recipientPartnerId: string | null;
  name: string;
  total: number;
  count: number;
  lastDate: string | null;
};

// Movement-type badge for CAPITAL_SPEND rows — withdrawal (orange) and
// custody (blue) are visually distinct from a normal capital expense.
const spendBadge = (t: SpendType | null | undefined) =>
  t === "PERSON_WITHDRAWAL"
    ? { text: "سحب من رأس المال", color: "#f59e0b", bg: "rgba(245,158,11,0.12)" }
    : t === "CUSTODY"
      ? { text: "عهدة", color: "#3b82f6", bg: "rgba(59,130,246,0.12)" }
      : { text: "مصروف رأس مال", color: "#ef4444", bg: "rgba(239,68,68,0.12)" };

const fmt = (n: number) =>
  n.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 2 });
const toEN = (d: string) =>
  new Date(d).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });

const inputStyle = {
  width: "100%", padding: "9px 11px", borderRadius: 9, border: "1px solid var(--border)",
  background: "var(--bg)", color: "var(--text)", fontSize: 12.5, outline: "none", marginTop: 5,
};
const labelStyle = { fontSize: 10.5, fontWeight: 600, color: "var(--muted)" };
const dialogErrorStyle = {
  padding: "9px 13px", borderRadius: 10, background: "rgba(239,68,68,0.08)",
  border: "1px solid rgba(239,68,68,0.3)", color: "#ef4444", fontSize: 12, marginBottom: 12, whiteSpace: "pre-line",
} as const;

const IconPencil = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 20h9" /><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
  </svg>
);
const IconTrash = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="3 6 5 6 21 6" /><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
    <path d="M10 11v6M14 11v6" /><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
  </svg>
);
const IconArrowDownLeft = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
    <path d="M17 7 7 17" /><polyline points="17 17 7 17 7 7" />
  </svg>
);
const IconArrowUpRight = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
    <path d="M7 17 17 7" /><polyline points="7 7 17 7 17 17" />
  </svg>
);

/* كل التنسيق في مكان واحد: الأزرار والشرائط لا يمكن كتابة hover لها inline */
const CSS = `
.cap-root { direction: rtl; max-width: 1240px; margin: 0 auto; }
.cap-head { display: flex; align-items: flex-end; justify-content: space-between; gap: 16px; flex-wrap: wrap; margin-bottom: 20px; }
.cap-title { font-size: 26px; font-weight: 800; letter-spacing: -0.02em; color: var(--text); margin: 0; }
.cap-sub { font-size: 13px; color: var(--muted); margin: 5px 0 0; }
.cap-head__actions { display: flex; gap: 10px; }

.cap-btn {
  display: inline-flex; align-items: center; gap: 8px;
  padding: 11px 20px; border-radius: 12px; border: 1px solid transparent;
  font-size: 13px; font-weight: 700; cursor: pointer; white-space: nowrap;
  transition: transform .16s ease, box-shadow .22s ease, background .22s ease, border-color .22s ease;
}
.cap-btn:active { transform: translateY(1px) scale(.99); }
.cap-btn:focus-visible { outline: 2px solid #2dd4bf; outline-offset: 2px; }
.cap-btn:disabled { opacity: .55; cursor: not-allowed; transform: none; }
.cap-btn--in { background: linear-gradient(135deg, #10b981, #047857); color: #fff; box-shadow: 0 8px 20px -10px rgba(16,185,129,.9); }
.cap-btn--in:hover:not(:disabled) { transform: translateY(-1px); box-shadow: 0 14px 26px -12px rgba(16,185,129,1); }
.cap-btn--out { background: linear-gradient(135deg, rgba(244,63,94,.16), rgba(190,18,60,.16)); border-color: rgba(244,63,94,.45); color: #fb7185; }
.cap-btn--out:hover:not(:disabled) { background: linear-gradient(135deg, #f43f5e, #be123c); border-color: transparent; color: #fff; transform: translateY(-1px); box-shadow: 0 14px 26px -12px rgba(244,63,94,.95); }
.cap-btn--purple { background: linear-gradient(135deg, #8b5cf6, #6d28d9); color: #fff; box-shadow: 0 8px 20px -10px rgba(139,92,246,.9); }
.cap-btn--purple:hover:not(:disabled) { transform: translateY(-1px); box-shadow: 0 14px 26px -12px rgba(139,92,246,1); }
.cap-btn--warn { background: linear-gradient(135deg, #f59e0b, #b45309); color: #fff; box-shadow: 0 8px 20px -10px rgba(245,158,11,.9); }
.cap-btn--warn:hover:not(:disabled) { transform: translateY(-1px); }
.cap-btn--danger { background: linear-gradient(135deg, #ef4444, #b91c1c); color: #fff; box-shadow: 0 8px 20px -10px rgba(239,68,68,.9); }
.cap-btn--danger:hover:not(:disabled) { transform: translateY(-1px); }
.cap-btn--ghost { background: transparent; border-color: var(--border); color: var(--text-muted); }
.cap-btn--ghost:hover:not(:disabled) { background: rgba(148,163,184,.1); color: var(--text); }
.cap-btn--sm { padding: 8px 15px; border-radius: 10px; font-size: 12px; }

.cap-card { padding: 20px; border-radius: 16px; background: var(--surface); border: 1px solid var(--border); margin-bottom: 16px; }
.cap-card__title { font-size: 14px; font-weight: 700; color: var(--text); margin: 0; }
.cap-card__note { font-size: 11.5px; color: var(--muted); margin: 4px 0 14px; line-height: 1.7; }
.cap-form-actions { display: flex; gap: 8px; }
.cap-grid-4 { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin-bottom: 12px; }
.cap-grid-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 12px; }
.cap-grid-3 { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; margin-bottom: 12px; }
.cap-grid-3b { display: grid; grid-template-columns: 1fr 1fr 2fr; gap: 12px; margin-bottom: 12px; }
.cap-grid-2b { display: grid; grid-template-columns: 2fr 1fr; gap: 12px; margin-bottom: 12px; }
.cap-hint { padding: 10px 14px; border-radius: 10px; font-size: 11.5px; line-height: 1.75; margin-bottom: 12px; }

.cap-alert { padding: 11px 16px; border-radius: 12px; font-size: 13px; margin-bottom: 14px; }
.cap-alert--err { background: rgba(239,68,68,.08); border: 1px solid rgba(239,68,68,.3); color: #ef4444; }
.cap-alert--ok { background: rgba(16,185,129,.08); border: 1px solid rgba(16,185,129,.3); color: #10b981; }

/* ═══ Hero: كل أرقام رأس المال في بطاقة واحدة ═══ */
.cap-hero {
  position: relative; overflow: hidden; padding: 22px 24px; border-radius: 20px; margin-bottom: 16px;
  background: linear-gradient(135deg, rgba(16,185,129,.10) 0%, rgba(14,165,233,.06) 48%, rgba(148,163,184,.03) 100%);
  border: 1px solid rgba(16,185,129,.22);
  box-shadow: 0 24px 50px -34px rgba(16,185,129,.75);
}
.cap-hero::after {
  content: ""; position: absolute; inset-inline-start: -70px; top: -110px; width: 260px; height: 260px;
  background: radial-gradient(circle, rgba(45,212,191,.16), transparent 68%); pointer-events: none;
}
.cap-hero__top { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; flex-wrap: wrap; }
.cap-kicker { font-size: 11.5px; font-weight: 700; color: var(--muted); letter-spacing: .02em; }
.cap-hero__value {
  font-size: 42px; font-weight: 800; line-height: 1.05; direction: ltr; text-align: right; margin-top: 4px;
  font-variant-numeric: tabular-nums;
  background: linear-gradient(180deg, var(--text) 30%, #34d399); -webkit-background-clip: text; background-clip: text;
  color: #34d399; -webkit-text-fill-color: transparent;
}
.cap-hero__value span { font-size: 15px; font-weight: 700; -webkit-text-fill-color: var(--muted); }
.cap-hero__meta { font-size: 11.5px; color: var(--muted); margin-top: 6px; }
.cap-chip-asset {
  display: inline-flex; align-items: center; gap: 8px; padding: 8px 14px; border-radius: 12px;
  background: rgba(234,179,8,.1); border: 1px solid rgba(234,179,8,.3); color: #eab308;
  font-size: 11.5px; font-weight: 700;
}

.cap-bar { display: flex; height: 12px; border-radius: 999px; overflow: hidden; margin-top: 20px; background: rgba(148,163,184,.14); }
.cap-bar__seg { height: 100%; transition: width .5s cubic-bezier(.4,0,.2,1); }
.cap-bar__seg--treasury { background: linear-gradient(90deg, #10b981, #2dd4bf); }
.cap-bar__seg--spent { background: linear-gradient(90deg, #f97316, #ef4444); }
.cap-legend { display: flex; gap: 20px; flex-wrap: wrap; margin-top: 10px; }
.cap-legend span { display: inline-flex; align-items: center; gap: 7px; font-size: 11.5px; color: var(--muted); }
.cap-legend i { width: 9px; height: 9px; border-radius: 3px; display: inline-block; }
.cap-legend b { color: var(--text); font-weight: 700; direction: ltr; font-variant-numeric: tabular-nums; }

.cap-tiles { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; margin-top: 18px; }
.cap-tile { padding: 15px 16px; border-radius: 14px; background: rgba(148,163,184,.08); border: 1px solid var(--border); }
.cap-tile__label { font-size: 11px; color: var(--muted); font-weight: 600; }
.cap-tile__value { font-size: 23px; font-weight: 800; direction: ltr; text-align: right; margin-top: 5px; font-variant-numeric: tabular-nums; }
.cap-tile__hint { font-size: 10.5px; color: var(--muted); margin-top: 5px; line-height: 1.6; }
.cap-hero__asset-note { font-size: 11px; color: var(--muted); margin-top: 12px; }

.cap-warn {
  padding: 14px 16px; border-radius: 16px; margin-bottom: 16px;
  background: rgba(245,158,11,.07); border: 1px solid rgba(245,158,11,.3);
}
.cap-warn__title { font-size: 12.5px; font-weight: 700; color: #f59e0b; margin-bottom: 7px; display: flex; align-items: center; gap: 7px; }
.cap-warn__row { font-size: 11.5px; color: var(--muted); line-height: 1.75; padding-inline-start: 14px; position: relative; }
.cap-warn__row::before { content: "•"; position: absolute; inset-inline-start: 3px; color: #f59e0b; }

.cap-withdrawals { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; padding: 12px 16px; border-radius: 14px; background: rgba(245,158,11,.06); border: 1px solid rgba(245,158,11,.25); margin-bottom: 16px; }
.cap-withdrawals__title { font-size: 12px; font-weight: 700; color: #f59e0b; }
.cap-withdrawals__note { font-size: 10.5px; color: var(--muted); }
.cap-withdrawals__chip { display: inline-flex; align-items: center; gap: 7px; padding: 5px 11px; border-radius: 10px; background: var(--surface); border: 1px solid var(--border); font-size: 12px; }
.cap-withdrawals__chip b { color: #f59e0b; direction: ltr; font-variant-numeric: tabular-nums; }

/* ═══ الدفتر ═══ */
.cap-ledger { border-radius: 16px; border: 1px solid var(--border); background: var(--surface); overflow: hidden; }
.cap-ledger__head { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; padding: 14px 16px; border-bottom: 1px solid var(--border); }
.cap-filters { display: flex; gap: 7px; }
.cap-filter {
  padding: 7px 15px; border-radius: 999px; border: 1px solid var(--border); background: transparent;
  color: var(--muted); font-size: 12px; font-weight: 700; cursor: pointer;
  transition: background .18s ease, color .18s ease, border-color .18s ease;
}
.cap-filter:hover { color: var(--text); background: rgba(148,163,184,.1); }
.cap-filter:focus-visible { outline: 2px solid #2dd4bf; outline-offset: 2px; }
.cap-filter--on { background: rgba(45,212,191,.14); border-color: rgba(45,212,191,.5); color: #2dd4bf; }
.cap-ledger__count { font-size: 11.5px; color: var(--muted); }

.cap-table__head, .cap-row { display: grid; grid-template-columns: 96px 116px minmax(0,1fr) 124px 112px 78px; align-items: center; gap: 6px; padding: 10px 16px; }
.cap-table__head { background: rgba(148,163,184,.06); border-bottom: 1px solid var(--border); font-size: 11px; font-weight: 700; color: var(--muted); }
.cap-row { border-bottom: 1px solid var(--border); font-size: 13px; transition: background .16s ease; }
.cap-row:last-child { border-bottom: none; }
.cap-row:hover { background: rgba(148,163,184,.06); }
.cap-badge { display: inline-block; padding: 3px 9px; border-radius: 999px; font-size: 10px; font-weight: 700; }
.cap-row__desc { font-weight: 600; color: var(--text); }
.cap-row__meta { font-size: 10.5px; color: var(--muted); margin-top: 3px; line-height: 1.7; }
.cap-amount { text-align: right; font-weight: 800; direction: ltr; font-variant-numeric: tabular-nums; }
.cap-balance { text-align: right; font-weight: 700; direction: ltr; font-variant-numeric: tabular-nums; color: var(--text); }
.cap-balance--neg { color: #ef4444; }
.cap-actions { display: flex; gap: 5px; justify-content: flex-end; }
.cap-icon-btn {
  width: 29px; height: 29px; border-radius: 9px; display: inline-flex; align-items: center; justify-content: center;
  border: 1px solid var(--border); background: transparent; color: var(--muted); cursor: pointer;
  transition: background .16s ease, color .16s ease, border-color .16s ease;
}
.cap-icon-btn:hover { background: rgba(148,163,184,.14); color: var(--text); }
.cap-icon-btn:focus-visible { outline: 2px solid #2dd4bf; outline-offset: 1px; }
.cap-icon-btn--danger:hover { background: rgba(239,68,68,.12); border-color: rgba(239,68,68,.4); color: #ef4444; }
.cap-empty { padding: 46px 18px; text-align: center; color: var(--muted); font-size: 13px; }
.cap-link { padding: 2px 9px; border-radius: 8px; border: 1px solid rgba(245,158,11,.4); background: rgba(245,158,11,.07); color: #f59e0b; font-size: 10px; font-weight: 700; cursor: pointer; margin-inline-start: 6px; }
.cap-link:hover { background: rgba(245,158,11,.18); }
.cap-flow-pill { padding: 1px 8px; border-radius: 999px; font-size: 9.5px; font-weight: 700; margin-inline-start: 6px; }

.cap-toggle { padding: 13px 16px; border-radius: 12px; background: rgba(139,92,246,.05); border: 1px solid rgba(139,92,246,.18); margin-bottom: 12px; display: flex; align-items: center; gap: 14px; }
.cap-toggle__title { font-size: 12.5px; font-weight: 700; color: var(--text); }
.cap-toggle__note { font-size: 10.5px; color: var(--muted); margin-top: 3px; line-height: 1.7; }
.cap-switch { width: 54px; height: 29px; border-radius: 999px; border: none; cursor: pointer; position: relative; flex-shrink: 0; transition: background .22s ease; }
.cap-switch__knob { width: 23px; height: 23px; border-radius: 50%; background: #fff; position: absolute; top: 3px; transition: left .22s ease; box-shadow: 0 1px 4px rgba(0,0,0,.35); }
.cap-impact { padding: 11px 15px; border-radius: 12px; background: rgba(148,163,184,.07); border: 1px solid var(--border); margin-bottom: 12px; }
.cap-impact__title { font-size: 11px; font-weight: 700; color: var(--text); margin-bottom: 5px; }
.cap-impact__body { font-size: 11.5px; color: var(--muted); line-height: 1.8; }
.cap-impact b { direction: ltr; display: inline-block; }

@media (max-width: 1080px) {
  .cap-tiles { grid-template-columns: 1fr 1fr; }
  .cap-grid-4 { grid-template-columns: 1fr 1fr; }
  .cap-table__head, .cap-row { grid-template-columns: 88px 108px minmax(0,1fr) 112px 100px 74px; }
}
@media (max-width: 760px) {
  .cap-tiles, .cap-grid-4, .cap-grid-3, .cap-grid-2, .cap-grid-3b, .cap-grid-2b { grid-template-columns: 1fr; }
  .cap-hero__value { font-size: 34px; }
}
`;

function FundFlowToggle({ value, onToggle }: { value: string; onToggle: () => void }) {
  const on = value === "STILL_IN_TREASURY";
  return (
    <div className="cap-toggle">
      <button
        type="button"
        className="cap-switch"
        onClick={onToggle}
        aria-pressed={on}
        aria-label="تبديل حالة التمويل: دخل الخزينة أم مصروف بالفعل"
        style={{ background: on ? "#8b5cf6" : "rgba(107,114,128,.35)" }}
      >
        <span className="cap-switch__knob" style={{ left: on ? 28 : 3 }} />
      </button>
      <div style={{ flex: 1 }}>
        <div className="cap-toggle__title">
          {on ? "💰 النقد دخل خزينة المكتب فعلًا — يزيد المتاح" : "✅ الممول صرفه مباشرة — لا يزيد المتاح"}
        </div>
        <div className="cap-toggle__note">
          {on
            ? "المبلغ استلمه المكتب وسيظهر ضمن النقد المتاح في الخزينة، ويُخصم منه أي صرف مرتبط به."
            : "المبلغ صُرف على شيء محدد بمعرفة الممول: يُحسب في إجمالي التمويل فقط، ولا يدخل خزينة المكتب ولا يُسجَّل كمصروف مكتب."}
        </div>
      </div>
    </div>
  );
}

export default function CapitalPage() {
  const [entries, setEntries] = useState<LedgerEntry[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [partners, setPartners] = useState<Partner[]>([]);
  const [contributions, setContributions] = useState<ContributionOpt[]>([]);
  const [withdrawalsByPerson, setWithdrawalsByPerson] = useState<PersonWithdrawalTotal[]>([]);
  const [loading, setLoading] = useState(true);
  const [showInForm, setShowInForm] = useState(false);
  const [showSpendForm, setShowSpendForm] = useState(false);
  const [convertTarget, setConvertTarget] = useState<LedgerEntry | null>(null);
  const [filter, setFilter] = useState<"ALL" | "CAPITAL_IN" | "CAPITAL_SPEND">("ALL");
  const [monthFilter, setMonthFilter] = useState("");
  const [ledgerSearch, setLedgerSearch] = useState("");
  const [movementFilter, setMovementFilter] = useState("ALL");
  const [error, setError] = useState<string | null>(null);
  const [inForm, setInForm] = useState({
    partnerId: "", amount: "", type: "CASH", fundFlow: "SPENT_ALREADY",
    description: "", reference: "", date: new Date().toISOString().split("T")[0],
  });
  const [spendForm, setSpendForm] = useState({
    amount: "", category: "", description: "", notes: "", reference: "", contributionId: "",
    spendType: "EXPENSE", recipientPartnerId: "", recipientName: "",
    date: new Date().toISOString().split("T")[0],
  });
  const [recurringForm, setRecurringForm] = useState({ amount: "", name: "" });
  const [editIn, setEditIn] = useState<LedgerEntry | null>(null);
  const [editInForm, setEditInForm] = useState({ partnerId: "", amount: "", type: "CASH", fundFlow: "SPENT_ALREADY", description: "", reference: "", date: "" });
  const [editSpend, setEditSpend] = useState<LedgerEntry | null>(null);
  const [editSpendForm, setEditSpendForm] = useState({ amount: "", date: "", category: "", description: "", notes: "", reference: "", contributionId: "", spendType: "EXPENSE", recipientPartnerId: "", recipientName: "" });
  const [confirmDeleteId, setConfirmDeleteId] = useState<{ id: string; kind: "in" | "spend"; force: boolean } | null>(null);
  const [dialogError, setDialogError] = useState<string | null>(null);
  // Save-state: a request in flight can never be fired twice from this form,
  // and the user always gets a message about what happened.
  const [savingIn, setSavingIn] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const lastSavedRef = useRef<{ key: string; at: number } | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    const [lRes, pRes, cRes] = await Promise.all([
      fetch("/api/office/capital-ledger"),
      fetch("/api/office/partners"),
      fetch("/api/office/capital-contributions"),
    ]);
    if (lRes.ok) {
      const d = await lRes.json();
      setEntries(d.entries || []); setSummary(d.summary || null);
      setWithdrawalsByPerson(d.withdrawalsByPerson || []);
    }
    if (pRes.ok) setPartners(await pRes.json());
    if (cRes.ok) {
      // Only CASH contributions are spendable money — attribution targets.
      setContributions(((await cRes.json()) as ContributionOpt[]).filter(c => c.type === "CASH"));
    }
    setLoading(false);
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  const months = useMemo(() => [...new Set(entries.map(e => e.date.slice(0, 7)))].sort().reverse(), [entries]);
  const visible = useMemo(() => {
    const q = ledgerSearch.trim().toLowerCase();
    return entries.filter(e =>
      (filter === "ALL" || e.type === filter) &&
      (!monthFilter || e.date.slice(0, 7) === monthFilter) &&
      (movementFilter === "ALL" || (e.type === "CAPITAL_SPEND" && (e.spendType || "EXPENSE") === movementFilter)) &&
      (!q || [e.description, e.category, e.funder, e.recipientName, e.reference, e.notes, String(e.amount)].some(v => v?.toLowerCase().includes(q)))
    );
  }, [entries, filter, monthFilter, ledgerSearch, movementFilter]);
  const visibleFunding = visible.filter(e => e.type === "CAPITAL_IN" && e.contributionType !== "ASSET").reduce((sum, e) => sum + e.amount, 0);
  const visibleSpending = visible.filter(e => e.type === "CAPITAL_SPEND").reduce((sum, e) => sum + e.amount, 0);

  /* ما سيحدث للمؤشرات عند الحفظ — يُعرض للمستخدم قبل الضغط على «حفظ» */
  const inFormImpact = useMemo(() => {
    const amt = parseFloat(inForm.amount || "0") || 0;
    if (inForm.type === "ASSET") {
      return { funding: amt, cash: 0, note: "أصل عيني: يُوثّق في السجل التاريخي ولا يزيد النقد المتاح." };
    }
    if (inForm.fundFlow === "STILL_IN_TREASURY") {
      return { funding: amt, cash: amt, note: "نقد دخل الخزينة فعلًا: يزيد النقد المتاح عند الحفظ." };
    }
    return { funding: amt, cash: 0, note: "صرفه الممول مباشرة: يزيد إجمالي التمويل فقط؛ النقد المتاح لا يتغير." };
  }, [inForm.amount, inForm.type, inForm.fundFlow]);

  const submitIn = async () => {
    // In-flight guard: a double click (or an impatient second click) must not
    // write a second row for the same request.
    if (savingIn) return;
    setError(null); setNotice(null);
    if (!inForm.partnerId) { setError("اختر الممول"); return; }
    if (!inForm.amount) { setError("أدخل المبلغ"); return; }
    const amount = parseFloat(inForm.amount);
    if (!Number.isFinite(amount) || amount <= 0) { setError("المبلغ يجب أن يكون رقمًا أكبر من صفر"); return; }
    // fundFlow is a CASH-only distinction; an in-kind row is never treasury cash.
    const fundFlow = inForm.type === "ASSET" ? "SPENT_ALREADY" : inForm.fundFlow;
    const key = `${inForm.partnerId}|${amount}|${inForm.type}|${inForm.date}`;
    setSavingIn(true);
    try {
      const res = await fetch("/api/office/capital-contributions", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...inForm, fundFlow, amount }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        setError(j.message || j.error || `فشل الحفظ (${res.status}) — لم يُسجّل شيء.`);
        return;
      }
      const saved = await res.json().catch(() => ({}));
      const prev = lastSavedRef.current;
      // Same partner/amount/type/date just saved? Say it plainly — but never
      // block it: two real payments of the same amount are legitimate.
      setNotice(
        prev && prev.key === key && Date.now() - prev.at < 120_000
          ? `تم الحفظ ✓${saved?.id ? ` (رقم السجل ${saved.id})` : ""} — تنبيه: نفس الممول والمبلغ والنوع والتاريخ سُجّل قبل لحظات. إن كانت دفعة ثانية حقيقية فهي مسجّلة بشكل صحيح.`
          : `تم الحفظ ✓${saved?.id ? ` — رقم السجل ${saved.id}` : ""}`,
      );
      lastSavedRef.current = { key, at: Date.now() };
      setShowInForm(false);
      await fetchData();
    } catch {
      setError("تعذّر الوصول إلى الخادم — لم يُحفظ أي شيء. تحقق من الاتصال ثم أعد المحاولة.");
    } finally {
      setSavingIn(false);
    }
  };

  const submitSpend = async () => {
    setError(null);
    // The category field is only rendered for EXPENSE — withdrawals and
    // custody classify via the recipient instead, and the service defaults
    // their category. Requiring category here made the Save button silently
    // do nothing for PERSON_WITHDRAWAL / CUSTODY; every validation failure
    // now surfaces a visible error instead of a silent return.
    if (!spendForm.amount) { setError("أدخل مبلغ الصرف"); return; }
    if (!spendForm.description.trim()) { setError("أدخل وصف الصرف"); return; }
    if (spendForm.spendType === "EXPENSE" && !spendForm.category.trim()) { setError("أدخل تصنيف الصرف"); return; }
    const wantsRecipient = spendForm.spendType === "PERSON_WITHDRAWAL" || spendForm.spendType === "CUSTODY";
    if (wantsRecipient && !spendForm.recipientPartnerId && !spendForm.recipientName.trim()) {
      setError(spendForm.spendType === "PERSON_WITHDRAWAL" ? "حدد الشخص المستلم لسحب رأس المال" : "حدد مستلم العهدة");
      return;
    }
    const res = await fetch("/api/office/capital-spends", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...spendForm,
        amount: parseFloat(spendForm.amount),
        contributionId: spendForm.contributionId || null,
        recipientPartnerId: wantsRecipient ? spendForm.recipientPartnerId || null : null,
        recipientName: wantsRecipient ? spendForm.recipientName.trim() || null : null,
      }),
    });
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      setError(j.message || j.error || "فشل الحفظ");
      return;
    }
    setSpendForm(f => ({ ...f, amount: "", description: "", notes: "", reference: "", recipientPartnerId: "", recipientName: "" }));
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
      spendType: e.spendType || "EXPENSE",
      recipientPartnerId: e.recipientPartnerId || "",
      recipientName: e.recipientName || "",
    });
  };

  const submitEditSpend = async () => {
    if (!editSpend) return;
    setDialogError(null);
    const wantsRecipient = editSpendForm.spendType === "PERSON_WITHDRAWAL" || editSpendForm.spendType === "CUSTODY";
    const res = await fetch(`/api/office/capital-spends/${editSpend.id}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...editSpendForm,
        amount: parseFloat(editSpendForm.amount),
        contributionId: editSpendForm.contributionId || null,
        // Explicit nulls when the type is EXPENSE clear the stored recipient.
        spendType: editSpendForm.spendType,
        recipientPartnerId: wantsRecipient ? editSpendForm.recipientPartnerId || null : null,
        recipientName: wantsRecipient ? editSpendForm.recipientName.trim() || null : null,
      }),
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

  /* أرقام البطاقة الرئيسية — كلها من summary (مصدر واحد: capital-metrics) */
  const received = summary?.totalReceived ?? 0;
  const inTreasury = summary?.cashFundingInTreasury ?? 0;
  const spentAlready = summary?.cashFundingSpentAlready ?? 0;
  const barTotal = Math.max(1, received);
  const assetFunding = summary?.assetFunding ?? 0;
  const spentFromTreasury = summary?.spentFromTreasury ?? 0;
  /* قد يكون سالبًا (سحب على المكشوف) — المتاح لا يظهر سالبًا، فالعجز يُعلن صراحةً
     بدل أن يبدو الرقم متناقصًا مع معادلته. */
  const treasuryNet = inTreasury - spentFromTreasury;

  return (
    <div className="cap-root">
      <style>{CSS}</style>

      <header className="cap-head">
        <div>
          <h1 className="cap-title">رأس المال والتمويل</h1>
          <p className="cap-sub">دخل رأس المال · ما صُرف منه · ما تبقّى — كلها من سجل واحد.</p>
        </div>
        <div className="cap-head__actions">
          <button className="cap-btn cap-btn--out" onClick={() => { setShowSpendForm(true); setShowInForm(false); }}>
            <IconArrowDownLeft /> تسجيل صرف
          </button>
          <button className="cap-btn cap-btn--in" onClick={() => { setShowInForm(true); setShowSpendForm(false); }}>
            <IconArrowUpRight /> تسجيل تمويل
          </button>
        </div>
      </header>

      {error && <div className="cap-alert cap-alert--err">{error}</div>}
      {notice && <div className="cap-alert cap-alert--ok">{notice}</div>}

      {/* ═══ البطاقة الرئيسية: إجمالي التمويل + من أين جاء + الثلاثة أرقام ═══ */}
      <section className="cap-hero">
        <div className="cap-hero__top">
          <div>
            <div className="cap-kicker">إجمالي التمويل النقدي</div>
            <div className="cap-hero__value">{fmt(received)} <span>EGP</span></div>
            <div className="cap-hero__meta">
              {summary?.contributionCount ?? 0} مساهمة نقدية · {summary?.funderCount ?? 0} ممول · لا ينقص بالصرف
            </div>
          </div>
          {assetFunding > 0 && (
            <div className="cap-chip-asset" title="مساهمات عينية: توثيق تاريخي فقط، لا تزيد النقد المتاح.">
              📦 عيني {fmt(assetFunding)} EGP · {summary?.assetContributionCount ?? 0} مساهمة
            </div>
          )}
        </div>

        <div
          className="cap-bar"
          role="img"
          aria-label={`من إجمالي ${fmt(received)}: دخل خزينة المكتب ${fmt(inTreasury)}، وصرفه الممول مباشرة ${fmt(spentAlready)}`}
        >
          <div className="cap-bar__seg cap-bar__seg--treasury" style={{ width: `${(inTreasury / barTotal) * 100}%` }} />
          <div className="cap-bar__seg cap-bar__seg--spent" style={{ width: `${(spentAlready / barTotal) * 100}%` }} />
        </div>
        <div className="cap-legend">
          <span><i style={{ background: "#2dd4bf" }} /> دخل خزينة المكتب <b>{fmt(inTreasury)}</b></span>
          <span><i style={{ background: "#f97316" }} /> صرفه الممول مباشرة <b>{fmt(spentAlready)}</b></span>
        </div>

        <div className="cap-tiles">
          <div className="cap-tile">
            <div className="cap-tile__label">المصروف من رأس المال</div>
            <div className="cap-tile__value" style={{ color: "#ef4444" }}>{fmt(summary?.totalSpent ?? 0)}</div>
            <div className="cap-tile__hint">{summary?.spendCount ?? 0} حركة صرف</div>
          </div>
          <div className="cap-tile" style={{ borderColor: "rgba(139,92,246,.38)", background: "rgba(139,92,246,.08)" }}>
            <div className="cap-tile__label">المتاح في الصندوق</div>
            <div className="cap-tile__value" style={{ color: "#a78bfa" }}>{fmt(summary?.available ?? 0)}</div>
            <div className="cap-tile__hint">التمويل النقدي − المصروف</div>
          </div>
          <div className="cap-tile">
            <div className="cap-tile__label">النقد في الخزينة من رأس المال</div>
            <div className="cap-tile__value" style={{ color: "#38bdf8" }}>{fmt(summary?.availableCashInTreasury ?? 0)}</div>
            <div className="cap-tile__hint">
              {treasuryNet < 0
                ? `دخل ${fmt(inTreasury)} − مصروف منها ${fmt(spentFromTreasury)} = عجز ${fmt(-treasuryNet)} — النقد المتاح لا يظهر سالبًا، والعجز مُعلن في التنبيه أدناه.`
                : `دخل ${fmt(inTreasury)} − مصروف منها ${fmt(spentFromTreasury)}`}
            </div>
          </div>
        </div>

        {assetFunding > 0 && (
          <div className="cap-hero__asset-note">
            المساهمات العينية موثّقة تاريخيًا ولا تدخل أي رصيد نقدي — تظهر مفصولة عن النقدي دائمًا.
          </div>
        )}
      </section>

      {/* فروق مشتقة من السجلات — تُعرض صراحة بدل أن تُدفن في رقم واحد */}
      {(summary?.reconciliationWarnings?.length ?? 0) > 0 && (
        <div className="cap-warn">
          <div className="cap-warn__title">⚠ فروق تحتاج قرارًا ({summary?.reconciliationWarnings.length})</div>
          {summary?.reconciliationWarnings.map(w => (
            <div key={w} className="cap-warn__row">{w}</div>
          ))}
        </div>
      )}

      {/* سحوبات رأس المال حسب الشخص — تقرير مشتق يظهر عند وجوده فقط */}
      {withdrawalsByPerson.length > 0 && (
        <div className="cap-withdrawals">
          <span className="cap-withdrawals__title">سحوبات رأس المال حسب الشخص</span>
          {withdrawalsByPerson.map(w => (
            <span key={w.recipientPartnerId ?? w.name} className="cap-withdrawals__chip">
              <b style={{ color: "var(--text)" }}>{w.name}</b>
              <b>{fmt(w.total)} EGP</b>
              <span className="cap-withdrawals__note">({w.count} حركة)</span>
            </span>
          ))}
          <span className="cap-withdrawals__note" style={{ marginInlineStart: "auto" }}>
            سحوبات شخصية فقط — بدون المصروفات ولا العُهد
          </span>
        </div>
      )}

      {/* ═══ نموذج تسجيل تمويل ═══ */}
      {showInForm && (
        <div className="cap-card">
          <h2 className="cap-card__title">تمويل جديد</h2>
          <p className="cap-card__note">نقدي قابل للصرف، أو أصل عيني للتوثيق فقط.</p>
          <div className="cap-grid-4">
            <div><label style={labelStyle}>الممول / المستثمر *</label>
              <select value={inForm.partnerId} onChange={e => setInForm(f => ({ ...f, partnerId: e.target.value }))} style={inputStyle}>
                <option value="">اختر ممول</option>
                {partners.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </div>
            <div><label style={labelStyle}>المبلغ (EGP) *</label><input type="number" value={inForm.amount} onChange={e => setInForm(f => ({ ...f, amount: e.target.value }))} style={inputStyle} /></div>
            <div><label style={labelStyle}>النوع *</label>
              <select value={inForm.type} onChange={e => setInForm(f => ({ ...f, type: e.target.value }))} style={inputStyle}>
                <option value="CASH">💵 نقدي — قابل للصرف</option>
                <option value="ASSET">📦 أصل عيني — توثيق فقط (لا يزيد النقد)</option>
              </select>
            </div>
            <div><label style={labelStyle}>تاريخ الاستلام *</label><input type="date" value={inForm.date} onChange={e => setInForm(f => ({ ...f, date: e.target.value }))} style={inputStyle} /></div>
          </div>
          <div className="cap-grid-2">
            <div><label style={labelStyle}>الوصف / ملاحظات</label><input value={inForm.description} onChange={e => setInForm(f => ({ ...f, description: e.target.value }))} placeholder="مثال: رأس مال للمكتب" style={inputStyle} /></div>
            <div><label style={labelStyle}>مرجع (اختياري)</label><input value={inForm.reference} onChange={e => setInForm(f => ({ ...f, reference: e.target.value }))} placeholder="رقم إيصال / تحويل" style={inputStyle} /></div>
          </div>

          {/* حالة التمويل — تخص النقد فقط، فالنوع العيني لا يدخل الخزينة إطلاقًا */}
          {inForm.type === "CASH" ? (
            <FundFlowToggle
              value={inForm.fundFlow}
              onToggle={() => setInForm(f => ({ ...f, fundFlow: f.fundFlow === "SPENT_ALREADY" ? "STILL_IN_TREASURY" : "SPENT_ALREADY" }))}
            />
          ) : (
            <div className="cap-hint" style={{ background: "rgba(234,179,8,.06)", border: "1px solid rgba(234,179,8,.28)", color: "#ca8a04" }}>
              📦 مساهمة عينية: تُحفظ في السجل التاريخي كأصل ولا تزيد النقد المتاح ولا رصيد الخزينة.
            </div>
          )}

          {/* أثر الحفظ قبل تنفيذه — يمنع الالتباس الذي أدى لمحاولات التسجيل المكررة */}
          <div className="cap-impact">
            <div className="cap-impact__title">أثر هذا الحفظ</div>
            <div className="cap-impact__body">
              إجمالي التمويل <b style={{ color: "#10b981" }}>+{fmt(inFormImpact.funding)} EGP</b>
              {" · "}النقد المتاح{" "}
              <b style={{ color: inFormImpact.cash > 0 ? "#38bdf8" : "var(--text)" }}>
                {inFormImpact.cash > 0 ? `+${fmt(inFormImpact.cash)} EGP` : "بلا تغيير"}
              </b>
              <div style={{ marginTop: 4 }}>{inFormImpact.note}</div>
            </div>
          </div>

          <div className="cap-form-actions">
            <button className="cap-btn cap-btn--in cap-btn--sm" onClick={submitIn} disabled={savingIn}>
              {savingIn ? "جارٍ الحفظ..." : "حفظ"}
            </button>
            <button className="cap-btn cap-btn--ghost cap-btn--sm" onClick={() => { if (!savingIn) setShowInForm(false); }}>إلغاء</button>
          </div>
        </div>
      )}

      {/* ═══ نموذج تسجيل صرف ═══ */}
      {showSpendForm && (
        <div className="cap-card">
          <h2 className="cap-card__title">صرف من رأس المال</h2>
          <p className="cap-card__note">يُخصم من رأس المال المتاح مباشرة — لا يُسجَّل كمصروف مكتب ولا يمس خزينة التشغيل.</p>
          <div className="cap-grid-3b">
            <div><label style={labelStyle}>المبلغ (EGP) *</label><input type="number" value={spendForm.amount} onChange={e => setSpendForm(f => ({ ...f, amount: e.target.value }))} style={inputStyle} /></div>
            <div><label style={labelStyle}>التاريخ *</label><input type="date" value={spendForm.date} onChange={e => setSpendForm(f => ({ ...f, date: e.target.value }))} style={inputStyle} /></div>
            <div><label style={labelStyle}>نوع الصرف *</label>
              <select value={spendForm.spendType} onChange={e => setSpendForm(f => ({ ...f, spendType: e.target.value }))} style={inputStyle}>
                <option value="EXPENSE">مصروف</option>
                <option value="PERSON_WITHDRAWAL">سحب شخص من رأس المال</option>
                <option value="CUSTODY">عهدة</option>
              </select>
            </div>
          </div>
          {spendForm.spendType === "PERSON_WITHDRAWAL" && (
            <div className="cap-hint" style={{ background: "rgba(245,158,11,.07)", border: "1px solid rgba(245,158,11,.28)", color: "#f59e0b" }}>
              سحب شخصي من صندوق رأس المال — لا يمس أرباح الشريك ولا التحويلات ولا خزينة التشغيل، ويُخصم من رأس المال المتاح فقط.
            </div>
          )}
          {spendForm.spendType !== "EXPENSE" && (
            <div className="cap-grid-2">
              <div><label style={labelStyle}>{spendForm.spendType === "CUSTODY" ? "مستلم العهدة" : "الشخص المستلم"} *</label>
                <select value={spendForm.recipientPartnerId} onChange={e => setSpendForm(f => ({ ...f, recipientPartnerId: e.target.value }))} style={inputStyle}>
                  <option value="">— اختر شخصًا مسجلًا —</option>
                  {partners.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </div>
              <div><label style={labelStyle}>أو اسم يدوي (إن لم يكن مسجلًا)</label><input value={spendForm.recipientName} onChange={e => setSpendForm(f => ({ ...f, recipientName: e.target.value }))} placeholder="مثال: عادل" style={inputStyle} /></div>
            </div>
          )}
          <div className="cap-grid-3">
            {spendForm.spendType === "EXPENSE" && (
              <div><label style={labelStyle}>التصنيف *</label><input value={spendForm.category} onChange={e => setSpendForm(f => ({ ...f, category: e.target.value }))} placeholder="مثال: تجهيزات، اشتراكات" style={inputStyle} /></div>
            )}
            <div><label style={labelStyle}>مرتبط بتمويل (اختياري)</label>
              <select value={spendForm.contributionId} onChange={e => setSpendForm(f => ({ ...f, contributionId: e.target.value }))} style={inputStyle}>
                <option value="">من الصندوق العام</option>
                {contributions.map(c => <option key={c.id} value={c.id}>{c.partner.name} — {fmt(c.amount)} EGP ({toEN(c.date)})</option>)}
              </select>
            </div>
            <div><label style={labelStyle}>مرجع (اختياري)</label><input value={spendForm.reference} onChange={e => setSpendForm(f => ({ ...f, reference: e.target.value }))} style={inputStyle} /></div>
          </div>
          <div className="cap-grid-2b">
            <div><label style={labelStyle}>{spendForm.spendType === "EXPENSE" ? "الوصف / التفاصيل *" : "البيان / السبب *"}</label><input value={spendForm.description} onChange={e => setSpendForm(f => ({ ...f, description: e.target.value }))} placeholder={spendForm.spendType === "EXPENSE" ? "مثال: تجهيزات تأسيس المكتب" : "مثال: سحب نقدي شخصي"} style={inputStyle} /></div>
            <div><label style={labelStyle}>ملاحظات</label><input value={spendForm.notes} onChange={e => setSpendForm(f => ({ ...f, notes: e.target.value }))} style={inputStyle} /></div>
          </div>
          <div className="cap-form-actions">
            <button className="cap-btn cap-btn--danger cap-btn--sm" onClick={submitSpend}>حفظ الصرف</button>
            <button className="cap-btn cap-btn--ghost cap-btn--sm" onClick={() => setShowSpendForm(false)}>إلغاء</button>
          </div>
        </div>
      )}

      {/* ═══ تحويل إلى مصروف ثابت متكرر ═══ */}
      {convertTarget && (
        <div className="cap-card" style={{ background: "rgba(245,158,11,.05)", borderColor: "rgba(245,158,11,.32)" }}>
          <h2 className="cap-card__title">تحويل إلى مصروف ثابت متكرر</h2>
          <p className="cap-card__note">
            سيبدأ التكرار من الشهر <b>التالي</b> لشهر الصرف ({toEN(convertTarget.date)}) — لن يُحتسب الشهر الحالي مرتين.
          </p>
          <div className="cap-grid-3">
            <div><label style={labelStyle}>المبلغ الشهري (EGP) *</label><input type="number" value={recurringForm.amount} onChange={e => setRecurringForm(f => ({ ...f, amount: e.target.value }))} style={inputStyle} /></div>
            <div><label style={labelStyle}>الاسم (اختياري)</label><input value={recurringForm.name} onChange={e => setRecurringForm(f => ({ ...f, name: e.target.value }))} placeholder={convertTarget.description} style={inputStyle} /></div>
            <div><label style={labelStyle}>التكرار</label>
              <select defaultValue="MONTHLY" style={inputStyle}>
                <option value="MONTHLY">شهري</option>
              </select>
            </div>
          </div>
          <div className="cap-form-actions">
            <button className="cap-btn cap-btn--warn cap-btn--sm" onClick={submitConvert}>تفعيل التكرار</button>
            <button className="cap-btn cap-btn--ghost cap-btn--sm" onClick={() => setConvertTarget(null)}>إلغاء</button>
          </div>
        </div>
      )}

      {/* ═══ تعديل مساهمة رأس مال ═══ */}
      {editIn && (
        <div className="cap-card" style={{ borderColor: "rgba(139,92,246,.4)" }}>
          <h2 className="cap-card__title">تعديل مساهمة رأس مال</h2>
          <p className="cap-card__note">
            التعديل يُطبَّق على نفس المساهمة المسجلة{editIn.funder ? ` (${editIn.funder})` : ""} — لن يتم إنشاء سجل جديد.
            تعديل المبلغ أو النوع مرفوض إذا كان سيجعل رأس المال المتاح سالبًا.
          </p>
          {dialogError && <div style={dialogErrorStyle}>{dialogError}</div>}
          <div className="cap-grid-4">
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
          <div className="cap-grid-2">
            <div><label style={labelStyle}>الوصف / ملاحظات</label><input value={editInForm.description} onChange={e => setEditInForm(f => ({ ...f, description: e.target.value }))} style={inputStyle} /></div>
            <div><label style={labelStyle}>مرجع (اختياري)</label><input value={editInForm.reference} onChange={e => setEditInForm(f => ({ ...f, reference: e.target.value }))} style={inputStyle} /></div>
          </div>
          <FundFlowToggle
            value={editInForm.fundFlow}
            onToggle={() => setEditInForm(f => ({ ...f, fundFlow: f.fundFlow === "SPENT_ALREADY" ? "STILL_IN_TREASURY" : "SPENT_ALREADY" }))}
          />
          <div className="cap-form-actions">
            <button className="cap-btn cap-btn--purple cap-btn--sm" onClick={submitEditIn}>حفظ التعديل</button>
            <button className="cap-btn cap-btn--ghost cap-btn--sm" onClick={closeDialogs}>إلغاء</button>
          </div>
        </div>
      )}

      {/* ═══ تعديل حركة صرف ═══ */}
      {editSpend && (
        <div className="cap-card" style={{ borderColor: "rgba(239,68,68,.4)" }}>
          <h2 className="cap-card__title">تعديل حركة صرف</h2>
          <p className="cap-card__note">
            زيادة المبلغ مرفوضة إذا تجاوزت رأس المال المتاح ({fmt(summary?.available ?? 0)} EGP).
            {editSpend.recurring && " 🔁 هذا الصرف مرتبط بمصروف ثابت متكرر — التعديل لا يغيّر التعريف ولا الشهور المُنشأة مسبقًا."}
          </p>
          {dialogError && <div style={dialogErrorStyle}>{dialogError}</div>}
          <div className="cap-grid-3b">
            <div><label style={labelStyle}>المبلغ (EGP) *</label><input type="number" value={editSpendForm.amount} onChange={e => setEditSpendForm(f => ({ ...f, amount: e.target.value }))} style={inputStyle} /></div>
            <div><label style={labelStyle}>التاريخ *</label><input type="date" value={editSpendForm.date} onChange={e => setEditSpendForm(f => ({ ...f, date: e.target.value }))} style={inputStyle} /></div>
            <div><label style={labelStyle}>نوع الصرف *</label>
              <select value={editSpendForm.spendType} onChange={e => setEditSpendForm(f => ({ ...f, spendType: e.target.value }))} style={inputStyle}>
                <option value="EXPENSE">مصروف</option>
                <option value="PERSON_WITHDRAWAL">سحب شخص من رأس المال</option>
                <option value="CUSTODY">عهدة</option>
              </select>
            </div>
          </div>
          {editSpendForm.spendType !== "EXPENSE" && (
            <div className="cap-grid-2">
              <div><label style={labelStyle}>{editSpendForm.spendType === "CUSTODY" ? "مستلم العهدة" : "الشخص المستلم"} *</label>
                <select value={editSpendForm.recipientPartnerId} onChange={e => setEditSpendForm(f => ({ ...f, recipientPartnerId: e.target.value }))} style={inputStyle}>
                  <option value="">— اختر شخصًا مسجلًا —</option>
                  {partners.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </div>
              <div><label style={labelStyle}>أو اسم يدوي (إن لم يكن مسجلًا)</label><input value={editSpendForm.recipientName} onChange={e => setEditSpendForm(f => ({ ...f, recipientName: e.target.value }))} placeholder="مثال: عادل" style={inputStyle} /></div>
            </div>
          )}
          <div className="cap-grid-3">
            {editSpendForm.spendType === "EXPENSE" && (
              <div><label style={labelStyle}>التصنيف *</label><input value={editSpendForm.category} onChange={e => setEditSpendForm(f => ({ ...f, category: e.target.value }))} style={inputStyle} /></div>
            )}
            <div><label style={labelStyle}>مرتبط بتمويل (اختياري)</label>
              <select value={editSpendForm.contributionId} onChange={e => setEditSpendForm(f => ({ ...f, contributionId: e.target.value }))} style={inputStyle}>
                <option value="">من الصندوق العام</option>
                {contributions.map(c => <option key={c.id} value={c.id}>{c.partner.name} — {fmt(c.amount)} EGP ({toEN(c.date)})</option>)}
              </select>
            </div>
            <div><label style={labelStyle}>مرجع (اختياري)</label><input value={editSpendForm.reference} onChange={e => setEditSpendForm(f => ({ ...f, reference: e.target.value }))} style={inputStyle} /></div>
          </div>
          <div className="cap-grid-2b">
            <div><label style={labelStyle}>{editSpendForm.spendType === "EXPENSE" ? "الوصف / التفاصيل *" : "البيان / السبب *"}</label><input value={editSpendForm.description} onChange={e => setEditSpendForm(f => ({ ...f, description: e.target.value }))} style={inputStyle} /></div>
            <div><label style={labelStyle}>ملاحظات</label><input value={editSpendForm.notes} onChange={e => setEditSpendForm(f => ({ ...f, notes: e.target.value }))} style={inputStyle} /></div>
          </div>
          <div className="cap-form-actions">
            <button className="cap-btn cap-btn--purple cap-btn--sm" onClick={submitEditSpend}>حفظ التعديل</button>
            <button className="cap-btn cap-btn--ghost cap-btn--sm" onClick={closeDialogs}>إلغاء</button>
          </div>
        </div>
      )}

      {/* ═══ تأكيد الحذف — حذف ناعم فقط ═══ */}
      {confirmDeleteId && (
        <div className="cap-card" style={{ background: "rgba(239,68,68,.05)", borderColor: "rgba(239,68,68,.32)" }}>
          <h2 className="cap-card__title">
            {confirmDeleteId.kind === "in" ? "تأكيد حذف مساهمة رأس مال" : "تأكيد حذف حركة صرف"}
          </h2>
          {deleteTarget && (
            <p className="cap-card__note">
              {toEN(deleteTarget.date)} · {deleteTarget.funder ? `${deleteTarget.funder} · ` : ""}{deleteTarget.description} ·{" "}
              <b style={{ direction: "ltr", display: "inline-block", color: "var(--text)" }}>{fmt(deleteTarget.amount)} EGP</b>
            </p>
          )}
          <div className="cap-hint" style={{ background: "rgba(148,163,184,.07)", border: "1px solid var(--border)", color: "var(--muted)", marginTop: -6 }}>
            حذف ناعم: السجل يُحفظ تاريخيًا ويُستبعد فقط من الإجماليات والدفتر، ويُعاد أثره للرصيد تلقائيًا.
            {confirmDeleteId.kind === "in" && " إذا كان المبلغ قد صُرف من رأس المال فسيتم رفض الحذف حمايةً للرصيد التاريخي."}
            {confirmDeleteId.kind === "spend" && deleteTarget?.recurring && " ⚠️ هذا الصرف مرتبط بمصروف ثابت متكرر."}
          </div>
          {dialogError && <div style={dialogErrorStyle}>{dialogError}</div>}
          <div className="cap-form-actions">
            <button className="cap-btn cap-btn--danger cap-btn--sm" onClick={performDelete}>
              {confirmDeleteId.force ? "تأكيد الحذف وإيقاف التكرار" : "تأكيد الحذف"}
            </button>
            <button className="cap-btn cap-btn--ghost cap-btn--sm" onClick={closeDialogs}>إلغاء</button>
          </div>
        </div>
      )}

      {/* ═══ الدفتر ═══ */}
      <section className="cap-ledger">
        <div className="cap-ledger__head">
          <div className="cap-filters">
            {([["ALL", "الكل"], ["CAPITAL_IN", "تمويل"], ["CAPITAL_SPEND", "صرف"]] as const).map(([k, label]) => (
              <button key={k} className={`cap-filter${filter === k ? " cap-filter--on" : ""}`} onClick={() => { setFilter(k); setMovementFilter("ALL"); }}>{label}</button>
            ))}
          </div>
          <div className="cap-ledger__count">
            {loading ? "جارٍ التحميل..." : `${visible.length} حركة${filter === "ALL" ? "" : " في هذا التصنيف"}`}
          </div>
        </div>

        <div style={{ padding: "12px 16px", borderBottom: "1px solid var(--border)" }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 10 }}>
            <label style={labelStyle}>الشهر
              <select style={inputStyle} value={monthFilter} onChange={e => setMonthFilter(e.target.value)}>
                <option value="">كل الشهور</option>
                {months.map(m => <option key={m} value={m}>{new Intl.DateTimeFormat("ar-EG", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(m + "-01T00:00:00Z"))}</option>)}
              </select>
            </label>
            <label style={labelStyle}>نوع الصرف
              <select style={inputStyle} value={movementFilter} onChange={e => { setMovementFilter(e.target.value); setFilter("ALL"); }}>
                <option value="ALL">كل الأنواع</option><option value="EXPENSE">مصروف</option><option value="PERSON_WITHDRAWAL">سحب شخصي</option><option value="CUSTODY">عهدة</option>
              </select>
            </label>
            <label style={labelStyle}>بحث في السجل
              <input style={inputStyle} value={ledgerSearch} onChange={e => setLedgerSearch(e.target.value)} placeholder="اسم، وصف، مبلغ..." />
            </label>
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 14, marginTop: 12, fontSize: 12 }}>
            <b>إجمالي التمويل الظاهر: {fmt(visibleFunding)} ج.م</b>
            <b>إجمالي الصرف الظاهر: {fmt(visibleSpending)} ج.م</b>
            <button className="cap-btn cap-btn--ghost cap-btn--sm" onClick={() => { setMonthFilter(""); setLedgerSearch(""); setMovementFilter("ALL"); setFilter("ALL"); }}>إلغاء الفلاتر</button>
          </div>
          <p style={{ color: "var(--muted)", fontSize: 11, marginBottom: 0 }}>الرصيد بجانب كل حركة هو الرصيد التراكمي التاريخي؛ إجماليات الفلتر تخص الحركات الظاهرة فقط.</p>
        </div>
        <div className="cap-table">
          <div className="cap-table__head">
            <div>التاريخ</div><div>النوع</div><div>البيان / المصدر</div>
            <div style={{ textAlign: "right" }}>المبلغ</div>
            <div style={{ textAlign: "right" }}>الرصيد</div>
            <div style={{ textAlign: "left" }}>إجراءات</div>
          </div>

          {loading ? (
            <div className="cap-empty">جارٍ التحميل...</div>
          ) : visible.length === 0 ? (
            <div className="cap-empty">لا توجد حركات مطابقة للفلاتر الحالية.</div>
          ) : visible.map(e => {
            const badge = spendBadge(e.spendType);
            // An in-kind contribution belongs in the ledger but moves no cash:
            // it must be VISIBLE (hiding it is what made a saved row look like
            // a failed save) and clearly marked as non-cash.
            const isAssetIn = !isSpend(e.type) && e.contributionType === "ASSET";
            const rowBadge = isAssetIn
              ? { text: "📦 أصل عيني — غير نقدي", color: "#eab308", bg: "rgba(234,179,8,.12)" }
              : badge;
            const accent = isSpend(e.type) ? badge.color : isAssetIn ? "#eab308" : "#10b981";
            return (
              <div
                key={`${e.type}-${e.id}`}
                className="cap-row"
                style={{ borderInlineStart: `3px solid ${accent}` }}
              >
                <div style={{ fontSize: 12, color: "var(--muted)" }}>{toEN(e.date)}</div>
                <div>
                  <span className="cap-badge" style={{ background: rowBadge.bg, color: rowBadge.color }}>
                    {isSpend(e.type) ? rowBadge.text : isAssetIn ? "أصل عيني" : "تمويل"}
                  </span>
                </div>
                <div>
                  <div className="cap-row__desc">{e.description}</div>
                  <div className="cap-row__meta">
                    {e.funder && <>الممول: {e.funder}</>}
                    {e.recipientName && <span style={{ color: badge.color, fontWeight: 700 }}>{e.funder ? " · " : ""}المستلم: {e.recipientName}</span>}
                    {e.category && <>{e.funder || e.recipientName ? " · " : ""}التصنيف: {e.category}</>}
                    {e.reference && <> · مرجع: {e.reference}</>}
                    {e.recurring && <> · 🔁 متكرر</>}
                    {!isSpend(e.type) && e.fundFlow && (
                      <span
                        className="cap-flow-pill"
                        style={{
                          background: e.fundFlow === "SPENT_ALREADY" ? "rgba(239,68,68,.12)" : "rgba(45,212,191,.14)",
                          color: e.fundFlow === "SPENT_ALREADY" ? "#ef4444" : "#2dd4bf",
                        }}
                      >
                        {e.fundFlow === "SPENT_ALREADY" ? "صرفه الممول مباشرة" : "دخل الخزينة"}
                      </span>
                    )}
                    {isSpend(e.type) && !e.recurring && (e.spendType ?? "EXPENSE") === "EXPENSE" && (
                      <button className="cap-link" onClick={() => setConvertTarget(e)}>🔁 اجعله مصروفًا ثابتًا</button>
                    )}
                  </div>
                </div>
                <div className="cap-amount" style={{ color: isSpend(e.type) ? badge.color : isAssetIn ? "#eab308" : "#10b981" }}>
                  {isSpend(e.type) ? "−" : "+"}{fmt(e.amount)} EGP
                  {isAssetIn && <div style={{ fontSize: 9, color: "var(--muted)", fontWeight: 500 }}>لا يدخل الرصيد النقدي</div>}
                </div>
                <div className={`cap-balance${!isAssetIn && e.balanceAfter < 0 ? " cap-balance--neg" : ""}`}>
                  {isAssetIn ? "—" : fmt(e.balanceAfter)}
                </div>
                <div className="cap-actions">
                  <button
                    className="cap-icon-btn"
                    onClick={() => (isSpend(e.type) ? startEditSpend(e) : startEditIn(e))}
                    title="تعديل"
                    aria-label="تعديل"
                  ><IconPencil /></button>
                  <button
                    className="cap-icon-btn cap-icon-btn--danger"
                    onClick={() => requestDelete(e)}
                    title="حذف"
                    aria-label="حذف"
                  ><IconTrash /></button>
                </div>
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}
