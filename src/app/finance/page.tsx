"use client";

import { useState, useEffect, useCallback } from "react";
import { AppShell } from "@/components/app-shell";

type PoolTx = { id: string; amountSAR: string; type: "IN" | "OUT"; date: string; note: string | null; projectRecord?: { projectName: string; client?: { name: string } } | null; withdrawal?: { netEGP: string } | null; };
type Withdrawal = { id: string; amountSAR: string; exchangeRate: string; commissionPct: string; netEGP: string; date: string; month: number; year: number; };
type Expense = { id: string; description: string; cost: string; category: "FIXED" | "VARIABLE"; name: string; notes: string | null; date: string; };
type Session = { userId: string; name: string; role: string };
const AR_MONTHS = ["يناير","فبراير","مارس","أبريل","مايو","يونيو","يوليو","أغسطس","سبتمبر","أكتوبر","نوفمبر","ديسمبر"];

export default function FinancePage() {
  const [session, setSession] = useState<Session | null>(null);
  const [activeTab, setActiveTab] = useState<"pool" | "withdrawals" | "expenses">("pool");
  const [poolTx, setPoolTx] = useState<PoolTx[]>([]);
  const [poolBalance, setPoolBalance] = useState(0);
  const [poolFilter, setPoolFilter] = useState<"ALL" | "IN" | "OUT">("ALL");
  const [withdrawals, setWithdrawals] = useState<Withdrawal[]>([]);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [expenseTotal, setExpenseTotal] = useState(0);
  const [expenseFilter, setExpenseFilter] = useState<"ALL" | "FIXED" | "VARIABLE">("ALL");
  const [showPoolModal, setShowPoolModal] = useState(false);
  const [showWithdrawModal, setShowWithdrawModal] = useState(false);
  const [showExpenseModal, setShowExpenseModal] = useState(false);
  const [poolForm, setPoolForm] = useState({ amountSAR: "", type: "IN" as "IN" | "OUT", date: new Date().toISOString().split("T")[0], note: "" });
  const [withdrawForm, setWithdrawForm] = useState({ amountSAR: "", exchangeRate: "48.5", commissionPct: "10", date: new Date().toISOString().split("T")[0] });
  const [expenseForm, setExpenseForm] = useState({ description: "", cost: "", category: "FIXED" as "FIXED" | "VARIABLE", name: "", notes: "", date: new Date().toISOString().split("T")[0] });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const m = document.cookie.match(/nexup_session=([^;]+)/);
    if (m) { try { const p = JSON.parse(atob(m[1].split(".")[1])); setSession({ userId: p.sub||"", name: p.name||"", role: p.role||"" }); } catch {} }
  }, []);

  const fetchPool = useCallback(async () => {
    const u = poolFilter==="ALL" ? "/api/pool" : `/api/pool?type=${poolFilter}`;
    const r = await fetch(u);
    if (r.ok) { const d = await r.json(); setPoolTx(d.transactions||[]); setPoolBalance(d.balance||0); }
  }, [poolFilter]);

  const fetchWithdrawals = useCallback(async () => {
    const r = await fetch("/api/withdrawals");
    if (r.ok) setWithdrawals(await r.json());
  }, []);

  const fetchExpenses = useCallback(async () => {
    const u = expenseFilter==="ALL" ? "/api/expenses" : `/api/expenses?category=${expenseFilter}`;
    const r = await fetch(u);
    if (r.ok) { const d = await r.json(); setExpenses(d.expenses||[]); setExpenseTotal(d.total||0); }
  }, [expenseFilter]);

  useEffect(() => {
    if (session?.role==="ADMIN") {
      if (activeTab==="pool") fetchPool();
      if (activeTab==="withdrawals") fetchWithdrawals();
      if (activeTab==="expenses") fetchExpenses();
    }
  }, [activeTab, session, fetchPool, fetchWithdrawals, fetchExpenses]);

  const handlePoolSubmit = async (e: React.FormEvent) => {
    e.preventDefault(); setLoading(true); setError("");
    try {
      const r = await fetch("/api/pool", { method: "POST", headers: {"Content-Type":"application/json"}, body: JSON.stringify(poolForm) });
      if (r.ok) { setShowPoolModal(false); setPoolForm({amountSAR:"",type:"IN",date:new Date().toISOString().split("T")[0],note:""}); fetchPool(); }
      else { const d = await r.json(); setError(d.error||"خطأ"); }
    } catch { setError("خطأ"); }
    setLoading(false);
  };

  const handleWithdrawSubmit = async (e: React.FormEvent) => {
    e.preventDefault(); setLoading(true); setError("");
    try {
      const r = await fetch("/api/withdrawals", { method: "POST", headers: {"Content-Type":"application/json"}, body: JSON.stringify(withdrawForm) });
      if (r.ok) { setShowWithdrawModal(false); setWithdrawForm({amountSAR:"",exchangeRate:"48.5",commissionPct:"10",date:new Date().toISOString().split("T")[0]}); fetchWithdrawals(); fetchPool(); }
      else { const d = await r.json(); setError(d.error||"خطأ"); }
    } catch { setError("خطأ"); }
    setLoading(false);
  };

  const handleExpenseSubmit = async (e: React.FormEvent) => {
    e.preventDefault(); setLoading(true); setError("");
    try {
      const r = await fetch("/api/expenses", { method: "POST", headers: {"Content-Type":"application/json"}, body: JSON.stringify(expenseForm) });
      if (r.ok) { setShowExpenseModal(false); setExpenseForm({description:"",cost:"",category:"FIXED",name:"",notes:"",date:new Date().toISOString().split("T")[0]}); fetchExpenses(); }
      else { const d = await r.json(); setError(d.error||"خطأ"); }
    } catch { setError("خطأ"); }
    setLoading(false);
  };

  if (session && session.role !== "ADMIN") return <AppShell isAdmin={false} userName={session.name} activePage="finance"><div className="empty-state"><div className="empty-state-icon">🔒</div><h2>غير مصرح</h2></div></AppShell>;

  const pIn = poolTx.filter(t=>t.type==="IN").reduce((s,t)=>s+Number(t.amountSAR),0);
  const pOut = poolTx.filter(t=>t.type==="OUT").reduce((s,t)=>s+Number(t.amountSAR),0);
  const eFixed = expenses.filter(e=>e.category==="FIXED").reduce((s,e)=>s+Number(e.cost),0);
  const eVar = expenses.filter(e=>e.category==="VARIABLE").reduce((s,e)=>s+Number(e.cost),0);
  const wEGP = withdrawals.reduce((s,w)=>s+Number(w.netEGP),0);
  const wSAR = withdrawals.reduce((s,w)=>s+Number(w.amountSAR),0);

  return (
    <AppShell isAdmin={true} userName={session?.name} activePage="finance">
      <div className="page-header"><div><h1 className="page-title">إدارة الحسابات</h1><p className="page-subtitle">البول — السحوبات — المصاريف</p></div></div>

      <div style={{display:"flex",gap:8,marginBottom:24}}>
        {(["pool","withdrawals","expenses"] as const).map(t => (
          <button key={t} className={`btn ${activeTab===t?"btn-primary":"btn-secondary"}`} onClick={()=>setActiveTab(t)}>
            {t==="pool"?"💎 حركات البول":t==="withdrawals"?"💸 السحوبات":"🧾 المصاريف"}
          </button>
        ))}
      </div>

      {/* Pool Tab */}
      {activeTab==="pool" && <>
        <div className="stats-grid" style={{marginBottom:24}}>
          <div className="stat-card brand"><div className="stat-card-icon brand">💎</div><div className="stat-card-value">{Number(poolBalance).toLocaleString("ar-SA")} ر.س</div><div className="stat-card-label">رصيد البول</div></div>
          <div className="stat-card success"><div className="stat-card-icon success">📥</div><div className="stat-card-value">{pIn.toLocaleString("ar-SA")} ر.س</div><div className="stat-card-label">الوارد</div></div>
          <div className="stat-card danger"><div className="stat-card-icon danger">📤</div><div className="stat-card-value">{pOut.toLocaleString("ar-SA")} ر.س</div><div className="stat-card-label">الصادر</div></div>
        </div>
        <div className="card">
          <div className="card-header"><div className="card-title">حركات البول</div><div style={{display:"flex",gap:8,alignItems:"center"}}><select className="filter-select" value={poolFilter} onChange={e=>setPoolFilter(e.target.value as typeof poolFilter)}><option value="ALL">الكل</option><option value="IN">وارد</option><option value="OUT">صادر</option></select><button className="btn btn-primary btn-sm" onClick={()=>setShowPoolModal(true)}>+ حركة</button></div></div>
          <div className="card-body" style={{padding:0}}>{poolTx.length===0 ? <div className="empty-state"><p>لا توجد حركات</p></div> : <div className="table-container"><table className="table"><thead><tr><th>التاريخ</th><th>النوع</th><th>المبلغ</th><th>العميل</th><th>ملاحظات</th></tr></thead><tbody>{poolTx.map(tx=><tr key={tx.id}><td>{new Date(tx.date).toLocaleDateString("ar-EG")}</td><td><span className={`badge ${tx.type==="IN"?"badge-completed":"badge-unpaid"}`}>{tx.type==="IN"?"📥 وارد":"📤 صادر"}</span></td><td style={{fontWeight:700}}>{Number(tx.amountSAR).toLocaleString("ar-SA")}</td><td>{tx.projectRecord ? `${tx.projectRecord.client?.name} — ${tx.projectRecord.projectName}` : tx.withdrawal ? "سحب" : "—"}</td><td className="muted">{tx.note||"—"}</td></tr>)}</tbody></table></div>}</div>
        </div>
      </>}

      {/* Withdrawals Tab */}
      {activeTab==="withdrawals" && <>
        <div className="stats-grid" style={{marginBottom:24}}>
          <div className="stat-card info"><div className="stat-card-icon info">💸</div><div className="stat-card-value">{withdrawals.length}</div><div className="stat-card-label">السحوبات</div></div>
          <div className="stat-card brand"><div className="stat-card-icon brand">🇪🇬</div><div className="stat-card-value">{wEGP.toLocaleString("ar-SA")} ج.م</div><div className="stat-card-label">المحول</div></div>
          <div className="stat-card warning"><div className="stat-card-icon warning">📉</div><div className="stat-card-value">{wSAR.toLocaleString("ar-SA")} ر.س</div><div className="stat-card-label">المسحوب</div></div>
        </div>
        <div className="card">
          <div className="card-header"><div className="card-title">السحوبات</div><button className="btn btn-primary btn-sm" onClick={()=>setShowWithdrawModal(true)}>+ سحبة</button></div>
          <div className="card-body" style={{padding:0}}>{withdrawals.length===0 ? <div className="empty-state"><p>لا توجد سحوبات</p></div> : <div className="table-container"><table className="table"><thead><tr><th>التاريخ</th><th>المبلغ</th><th>الصرف</th><th>العمولة</th><th>الصافي</th><th>الشهر</th></tr></thead><tbody>{withdrawals.map(w=><tr key={w.id}><td>{new Date(w.date).toLocaleDateString("ar-EG")}</td><td style={{fontWeight:700}}>{Number(w.amountSAR).toLocaleString("ar-SA")}</td><td>{w.exchangeRate}</td><td>{w.commissionPct}%</td><td style={{fontWeight:700,color:"var(--brand)"}}>{Number(w.netEGP).toLocaleString("ar-SA")} ج.م</td><td>{AR_MONTHS[w.month-1]} {w.year}</td></tr>)}</tbody></table></div>}</div>
        </div>
      </>}

      {/* Expenses Tab */}
      {activeTab==="expenses" && <>
        <div className="stats-grid" style={{marginBottom:24}}>
          <div className="stat-card warning"><div className="stat-card-icon warning">🧾</div><div className="stat-card-value">{Number(expenseTotal).toLocaleString("ar-SA")} ر.س</div><div className="stat-card-label">المصاريف</div></div>
          <div className="stat-card danger"><div className="stat-card-icon danger">📌</div><div className="stat-card-value">{eFixed.toLocaleString("ar-SA")} ر.س</div><div className="stat-card-label">ثابتة</div></div>
          <div className="stat-card info"><div className="stat-card-icon info">🔄</div><div className="stat-card-value">{eVar.toLocaleString("ar-SA")} ر.س</div><div className="stat-card-label">متغيرة</div></div>
        </div>
        <div className="card">
          <div className="card-header"><div className="card-title">المصاريف</div><div style={{display:"flex",gap:8}}><select className="filter-select" value={expenseFilter} onChange={e=>setExpenseFilter(e.target.value as typeof expenseFilter)}><option value="ALL">الكل</option><option value="FIXED">ثابتة</option><option value="VARIABLE">متغيرة</option></select><button className="btn btn-primary btn-sm" onClick={()=>setShowExpenseModal(true)}>+ مصروف</button></div></div>
          <div className="card-body" style={{padding:0}}>{expenses.length===0 ? <div className="empty-state"><p>لا توجد مصاريف</p></div> : <div className="table-container"><table className="table"><thead><tr><th>التاريخ</th><th>الاسم</th><th>الوصف</th><th>المبلغ</th><th>النوع</th></tr></thead><tbody>{expenses.map(ex=><tr key={ex.id}><td>{new Date(ex.date).toLocaleDateString("ar-EG")}</td><td style={{fontWeight:600}}>{ex.name}</td><td>{ex.description}</td><td style={{fontWeight:700}}>{Number(ex.cost).toLocaleString("ar-SA")}</td><td><span className={`badge ${ex.category==="FIXED"?"badge-unpaid":"badge-in-progress"}`}>{ex.category==="FIXED"?"📌 ثابت":"🔄 متغير"}</span></td></tr>)}</tbody></table></div>}</div>
        </div>
      </>}

      {/* Pool Modal */}
      {showPoolModal && <div className="modal-overlay" onClick={()=>setShowPoolModal(false)}><div className="modal" onClick={e=>e.stopPropagation()}><div className="modal-header"><div className="modal-title">حركة بول جديدة</div><button className="modal-close" onClick={()=>setShowPoolModal(false)}>✕</button></div><form onSubmit={handlePoolSubmit}><div className="modal-body"><div className="form-grid"><div className="field"><label className="field-label">النوع</label><select className="field" value={poolForm.type} onChange={e=>setPoolForm({...poolForm,type:e.target.value as "IN"|"OUT"})} required><option value="IN">📥 وارد</option><option value="OUT">📤 صادر</option></select></div><div className="field"><label className="field-label">المبلغ</label><input type="number" step="0.01" value={poolForm.amountSAR} onChange={e=>setPoolForm({...poolForm,amountSAR:e.target.value})} required /></div><div className="field"><label className="field-label">التاريخ</label><input type="date" value={poolForm.date} onChange={e=>setPoolForm({...poolForm,date:e.target.value})} required /></div><div className="field full-width"><label className="field-label">ملاحظات</label><input type="text" value={poolForm.note} onChange={e=>setPoolForm({...poolForm,note:e.target.value})} /></div></div>{error&&<div className="error">{error}</div>}</div><div className="modal-footer"><button type="submit" className="btn btn-primary" disabled={loading}>{loading?"جارٍ...":"إضافة"}</button><button type="button" className="btn btn-secondary" onClick={()=>setShowPoolModal(false)}>إلغاء</button></div></form></div></div>}

      {/* Withdraw Modal */}
      {showWithdrawModal && <div className="modal-overlay" onClick={()=>setShowWithdrawModal(false)}><div className="modal" onClick={e=>e.stopPropagation()}><div className="modal-header"><div className="modal-title">سحبة جديدة</div><button className="modal-close" onClick={()=>setShowWithdrawModal(false)}>✕</button></div><form onSubmit={handleWithdrawSubmit}><div className="modal-body"><div className="form-grid"><div className="field"><label className="field-label">المبلغ</label><input type="number" step="0.01" value={withdrawForm.amountSAR} onChange={e=>setWithdrawForm({...withdrawForm,amountSAR:e.target.value})} required /></div><div className="field"><label className="field-label">الصرف</label><input type="number" step="0.0001" value={withdrawForm.exchangeRate} onChange={e=>setWithdrawForm({...withdrawForm,exchangeRate:e.target.value})} required /></div><div className="field"><label className="field-label">العمولة %</label><input type="number" step="0.01" value={withdrawForm.commissionPct} onChange={e=>setWithdrawForm({...withdrawForm,commissionPct:e.target.value})} required /></div><div className="field"><label className="field-label">التاريخ</label><input type="date" value={withdrawForm.date} onChange={e=>setWithdrawForm({...withdrawForm,date:e.target.value})} required /></div><div className="field full-width" style={{padding:16,background:"var(--brand-pale)",borderRadius:12}}><div style={{fontSize:"0.8125rem",color:"var(--brand-dark)",fontWeight:600}}>💡 الصافي: {withdrawForm.amountSAR&&withdrawForm.exchangeRate&&withdrawForm.commissionPct ? (parseFloat(withdrawForm.amountSAR)*parseFloat(withdrawForm.exchangeRate)*(1-parseFloat(withdrawForm.commissionPct)/100)).toLocaleString("ar-SA")+" ج.م" : "—"}</div></div></div>{error&&<div className="error">{error}</div>}</div><div className="modal-footer"><button type="submit" className="btn btn-primary" disabled={loading}>{loading?"جارٍ...":"إضافة"}</button><button type="button" className="btn btn-secondary" onClick={()=>setShowWithdrawModal(false)}>إلغاء</button></div></form></div></div>}

      {/* Expense Modal */}
      {showExpenseModal && <div className="modal-overlay" onClick={()=>setShowExpenseModal(false)}><div className="modal" onClick={e=>e.stopPropagation()}><div className="modal-header"><div className="modal-title">مصروف جديد</div><button className="modal-close" onClick={()=>setShowExpenseModal(false)}>✕</button></div><form onSubmit={handleExpenseSubmit}><div className="modal-body"><div className="form-grid"><div className="field"><label className="field-label">الاسم</label><input type="text" value={expenseForm.name} onChange={e=>setExpenseForm({...expenseForm,name:e.target.value})} required placeholder="اشتراك كنفرانس" /></div><div className="field"><label className="field-label">النوع</label><select className="field" value={expenseForm.category} onChange={e=>setExpenseForm({...expenseForm,category:e.target.value as "FIXED"|"VARIABLE"})} required><option value="FIXED">📌 ثابت</option><option value="VARIABLE">🔄 متغير</option></select></div><div className="field"><label className="field-label">المبلغ</label><input type="number" step="0.01" value={expenseForm.cost} onChange={e=>setExpenseForm({...expenseForm,cost:e.target.value})} required /></div><div className="field"><label className="field-label">التاريخ</label><input type="date" value={expenseForm.date} onChange={e=>setExpenseForm({...expenseForm,date:e.target.value})} required /></div><div className="field full-width"><label className="field-label">الوصف</label><input type="text" value={expenseForm.description} onChange={e=>setExpenseForm({...expenseForm,description:e.target.value})} required /></div><div className="field full-width"><label className="field-label">ملاحظات</label><input type="text" value={expenseForm.notes} onChange={e=>setExpenseForm({...expenseForm,notes:e.target.value})} /></div></div>{error&&<div className="error">{error}</div>}</div><div className="modal-footer"><button type="submit" className="btn btn-primary" disabled={loading}>{loading?"جارٍ...":"إضافة"}</button><button type="button" className="btn btn-secondary" onClick={()=>setShowExpenseModal(false)}>إلغاء</button></div></form></div></div>}
    </AppShell>
  );
}