"use client";

import { useState, useEffect, useCallback } from "react";

type PoolTx = { id: string; amountSAR: string; type: "IN" | "OUT"; date: string; note: string | null; projectRecord?: { projectName: string; client?: { name: string } } | null; };
type Withdrawal = { id: string; amountSAR: string; exchangeRate: string; commissionPct: string; netEGP: string; date: string; month: number; year: number; };
type Expense = { id: string; description: string; cost: string; category: "FIXED" | "VARIABLE"; name: string; notes: string | null; date: string; };

function formatNum(n: number) {
  return n.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}

export default function NexupFinancePage() {
  const [activeTab, setActiveTab] = useState<"balance" | "withdrawals" | "expenses" | "profit">("balance");
  const [poolTx, setPoolTx] = useState<PoolTx[]>([]);
  const [poolBalance, setPoolBalance] = useState(0);
  const [poolFilter, setPoolFilter] = useState<"ALL" | "IN" | "OUT">("ALL");
  const [withdrawals, setWithdrawals] = useState<Withdrawal[]>([]);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [expenseTotal, setExpenseTotal] = useState(0);
  const [showModal, setShowModal] = useState("");
  const [form, setForm] = useState<Record<string, string>>({});

  const fetchPool = useCallback(async () => {
    const u = poolFilter === "ALL" ? "/api/pool" : `/api/pool?type=${poolFilter}`;
    const r = await fetch(u);
    if (r.ok) { const d = await r.json(); setPoolTx(d.transactions || []); setPoolBalance(d.balance || 0); }
  }, [poolFilter]);

  const fetchWithdrawals = useCallback(async () => {
    const r = await fetch("/api/withdrawals");
    if (r.ok) setWithdrawals(await r.json());
  }, []);

  const fetchExpenses = useCallback(async () => {
    const r = await fetch("/api/expenses");
    if (r.ok) { const d = await r.json(); setExpenses(d.expenses || []); setExpenseTotal(d.total || 0); }
  }, []);

  useEffect(() => {
    if (activeTab === "balance") fetchPool();
    if (activeTab === "withdrawals") fetchWithdrawals();
    if (activeTab === "expenses") fetchExpenses();
  }, [activeTab, fetchPool, fetchWithdrawals, fetchExpenses]);

  const pIn = poolTx.filter(t => t.type === "IN").reduce((s, t) => s + Number(t.amountSAR), 0);
  const pOut = poolTx.filter(t => t.type === "OUT").reduce((s, t) => s + Number(t.amountSAR), 0);
  const wEGP = withdrawals.reduce((s, w) => s + Number(w.netEGP), 0);
  const monthlyProfit = wEGP - Number(expenseTotal);

  const tabs = [
    { key: "balance", label: "💰 Available Balance" },
    { key: "withdrawals", label: "💸 Withdrawals" },
    { key: "expenses", label: "🧾 Expenses" },
    { key: "profit", label: "📊 Monthly Profit" },
  ] as const;

  return (
    <div>
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ fontSize: 24, fontWeight: 800, color: "var(--text)", margin: 0 }}>Finance</h1>
        <p style={{ fontSize: 13, color: "var(--muted)", margin: "4px 0 0" }}>Available balance, withdrawals, expenses & profit</p>
      </div>

      {/* Tabs */}
      <div style={{ display: "flex", gap: 4, marginBottom: 20, background: "var(--surface)", padding: 4, borderRadius: 10, border: "1px solid var(--border)" }}>
        {tabs.map(t => (
          <button key={t.key} onClick={() => setActiveTab(t.key)} style={{
            padding: "8px 16px", borderRadius: 8, border: "none",
            background: activeTab === t.key ? "#0d9488" : "transparent",
            color: activeTab === t.key ? "#fff" : "var(--muted)",
            fontSize: 13, fontWeight: 600, cursor: "pointer", transition: "all 0.15s",
          }}>{t.label}</button>
        ))}
      </div>

      {/* Balance Tab */}
      {activeTab === "balance" && (
        <div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 16, marginBottom: 20 }}>
            {[
              { label: "Available Balance", value: `${formatNum(poolBalance)} SAR`, color: "#0d9488" },
              { label: "Total Income", value: `${formatNum(pIn)} SAR`, color: "#10b981" },
              { label: "Total Withdrawn", value: `${formatNum(pOut)} SAR`, color: "#ef4444" },
            ].map(s => (
              <div key={s.label} style={{ padding: "20px 24px", borderRadius: 14, background: "var(--surface)", border: "1px solid var(--border)" }}>
                <div style={{ fontSize: 11, color: "var(--muted)", marginBottom: 6 }}>{s.label}</div>
                <div style={{ fontSize: 22, fontWeight: 800, color: s.color }}>{s.value}</div>
              </div>
            ))}
          </div>
          <div style={{ padding: "20px 24px", borderRadius: 14, background: "var(--surface)", border: "1px solid var(--border)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
              <span style={{ fontSize: 14, fontWeight: 700, color: "var(--text)" }}>Transactions</span>
              <div style={{ display: "flex", gap: 8 }}>
                <select value={poolFilter} onChange={e => setPoolFilter(e.target.value as typeof poolFilter)}
                  style={{ padding: "6px 10px", borderRadius: 6, border: "1px solid var(--border)", background: "var(--surface)", color: "var(--text)", fontSize: 12 }}>
                  <option value="ALL">All</option><option value="IN">Income Only</option><option value="OUT">Withdrawals Only</option>
                </select>
              </div>
            </div>
            {poolTx.length === 0 ? (
              <div style={{ textAlign: "center", padding: 40, color: "var(--muted)" }}>No transactions yet</div>
            ) : (
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                <thead>
                  <tr style={{ borderBottom: "1px solid var(--border)" }}>
                    {["Date", "Type", "Amount (SAR)", "Project / Client", "Notes"].map(h => (
                      <th key={h} style={{ padding: "8px 12px", fontSize: 11, fontWeight: 600, color: "var(--muted)", textAlign: "right" }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {poolTx.map(tx => (
                    <tr key={tx.id} style={{ borderBottom: "1px solid var(--border)" }}>
                      <td style={{ padding: "10px 12px", fontSize: 12, color: "var(--muted)" }}>
                        {new Date(tx.date).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })}
                      </td>
                      <td style={{ padding: "10px 12px" }}>
                        <span style={{ padding: "3px 8px", borderRadius: 6, fontSize: 11, fontWeight: 600,
                          background: tx.type === "IN" ? "rgba(16,185,129,0.1)" : "rgba(239,68,68,0.1)",
                          color: tx.type === "IN" ? "#10b981" : "#ef4444" }}>
                          {tx.type === "IN" ? "📥 Income" : "📤 Withdrawal"}
                        </span>
                      </td>
                      <td style={{ padding: "10px 12px", fontWeight: 700, direction: "ltr", textAlign: "left" }}>
                        {formatNum(Number(tx.amountSAR))} <span style={{ fontSize: 10, color: "var(--muted)" }}>SAR</span>
                      </td>
                      <td style={{ padding: "10px 12px", fontSize: 12, color: "var(--text-secondary)" }}>
                        {tx.projectRecord ? `${tx.projectRecord.client?.name} — ${tx.projectRecord.projectName}` : "—"}
                      </td>
                      <td style={{ padding: "10px 12px", fontSize: 12, color: "var(--muted)" }}>{tx.note || "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}

      {/* Withdrawals Tab */}
      {activeTab === "withdrawals" && (
        <div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 16, marginBottom: 20 }}>
            {[
              { label: "Total Withdrawals", value: withdrawals.length, color: "#3b82f6" },
              { label: "Total (EGP)", value: `${formatNum(wEGP)} EGP`, color: "#0d9488" },
              { label: "Total (SAR)", value: `${formatNum(withdrawals.reduce((s, w) => s + Number(w.amountSAR), 0))} SAR`, color: "#f59e0b" },
            ].map(s => (
              <div key={s.label} style={{ padding: "20px 24px", borderRadius: 14, background: "var(--surface)", border: "1px solid var(--border)" }}>
                <div style={{ fontSize: 11, color: "var(--muted)", marginBottom: 6 }}>{s.label}</div>
                <div style={{ fontSize: 22, fontWeight: 800, color: s.color }}>{s.value}</div>
              </div>
            ))}
          </div>
          <div style={{ padding: "20px 24px", borderRadius: 14, background: "var(--surface)", border: "1px solid var(--border)" }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: "var(--text)", marginBottom: 16 }}>Withdrawal History</div>
            {withdrawals.length === 0 ? (
              <div style={{ textAlign: "center", padding: 40, color: "var(--muted)" }}>No withdrawals yet</div>
            ) : (
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                <thead>
                  <tr style={{ borderBottom: "1px solid var(--border)" }}>
                    {["Date", "Amount (SAR)", "Rate", "Commission", "Net (EGP)", "Month"].map(h => (
                      <th key={h} style={{ padding: "8px 12px", fontSize: 11, fontWeight: 600, color: "var(--muted)", textAlign: "right" }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {withdrawals.map(w => (
                    <tr key={w.id} style={{ borderBottom: "1px solid var(--border)" }}>
                      <td style={{ padding: "10px 12px", fontSize: 12, color: "var(--muted)" }}>
                        {new Date(w.date).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })}
                      </td>
                      <td style={{ padding: "10px 12px", fontWeight: 700, direction: "ltr", textAlign: "left" }}>{formatNum(Number(w.amountSAR))} SAR</td>
                      <td style={{ padding: "10px 12px", fontSize: 12, color: "var(--text-secondary)" }}>{w.exchangeRate}</td>
                      <td style={{ padding: "10px 12px", fontSize: 12, color: "var(--text-secondary)" }}>{w.commissionPct}%</td>
                      <td style={{ padding: "10px 12px", fontWeight: 700, color: "#0d9488", direction: "ltr", textAlign: "left" }}>{formatNum(Number(w.netEGP))} EGP</td>
                      <td style={{ padding: "10px 12px", fontSize: 12, color: "var(--muted)" }}>{w.month}/{w.year}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}

      {/* Expenses Tab */}
      {activeTab === "expenses" && (
        <div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 16, marginBottom: 20 }}>
            {[
              { label: "Total Expenses", value: `${formatNum(Number(expenseTotal))} SAR`, color: "#ef4444" },
              { label: "Fixed", value: `${formatNum(expenses.filter(e => e.category === "FIXED").reduce((s, e) => s + Number(e.cost), 0))} SAR`, color: "#f59e0b" },
              { label: "Variable", value: `${formatNum(expenses.filter(e => e.category === "VARIABLE").reduce((s, e) => s + Number(e.cost), 0))} SAR`, color: "#3b82f6" },
            ].map(s => (
              <div key={s.label} style={{ padding: "20px 24px", borderRadius: 14, background: "var(--surface)", border: "1px solid var(--border)" }}>
                <div style={{ fontSize: 11, color: "var(--muted)", marginBottom: 6 }}>{s.label}</div>
                <div style={{ fontSize: 22, fontWeight: 800, color: s.color }}>{s.value}</div>
              </div>
            ))}
          </div>
          <div style={{ padding: "20px 24px", borderRadius: 14, background: "var(--surface)", border: "1px solid var(--border)" }}>
            {expenses.length === 0 ? (
              <div style={{ textAlign: "center", padding: 40, color: "var(--muted)" }}>No expenses yet</div>
            ) : (
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                <thead>
                  <tr style={{ borderBottom: "1px solid var(--border)" }}>
                    {["Date", "Name", "Description", "Amount", "Type"].map(h => (
                      <th key={h} style={{ padding: "8px 12px", fontSize: 11, fontWeight: 600, color: "var(--muted)", textAlign: "right" }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {expenses.map(ex => (
                    <tr key={ex.id} style={{ borderBottom: "1px solid var(--border)" }}>
                      <td style={{ padding: "10px 12px", fontSize: 12, color: "var(--muted)" }}>
                        {new Date(ex.date).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })}
                      </td>
                      <td style={{ padding: "10px 12px", fontWeight: 600 }}>{ex.name}</td>
                      <td style={{ padding: "10px 12px", fontSize: 12, color: "var(--text-secondary)" }}>{ex.description}</td>
                      <td style={{ padding: "10px 12px", fontWeight: 700, direction: "ltr", textAlign: "left" }}>{formatNum(Number(ex.cost))} SAR</td>
                      <td style={{ padding: "10px 12px" }}>
                        <span style={{ padding: "3px 8px", borderRadius: 6, fontSize: 11, fontWeight: 600,
                          background: ex.category === "FIXED" ? "rgba(245,158,11,0.1)" : "rgba(59,130,246,0.1)",
                          color: ex.category === "FIXED" ? "#f59e0b" : "#3b82f6" }}>
                          {ex.category === "FIXED" ? "📌 Fixed" : "🔄 Variable"}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}

      {/* Profit Tab */}
      {activeTab === "profit" && (
        <div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 16, marginBottom: 20 }}>
            {[
              { label: "Net Profit", value: `${formatNum(monthlyProfit)} EGP`, color: monthlyProfit >= 0 ? "#10b981" : "#ef4444" },
              { label: "Income (EGP)", value: `${formatNum(wEGP)} EGP`, color: "#0d9488" },
              { label: "Expenses (SAR)", value: `${formatNum(Number(expenseTotal))} SAR`, color: "#ef4444" },
            ].map(s => (
              <div key={s.label} style={{ padding: "20px 24px", borderRadius: 14, background: "var(--surface)", border: "1px solid var(--border)" }}>
                <div style={{ fontSize: 11, color: "var(--muted)", marginBottom: 6 }}>{s.label}</div>
                <div style={{ fontSize: 22, fontWeight: 800, color: s.color }}>{s.value}</div>
              </div>
            ))}
          </div>
          <div style={{ padding: "24px", borderRadius: 14, background: "var(--surface)", border: "1px solid var(--border)", textAlign: "center" }}>
            <div style={{ fontSize: 13, color: "var(--muted)", marginBottom: 8 }}>Monthly Net Profit</div>
            <div style={{ fontSize: 36, fontWeight: 800, color: monthlyProfit >= 0 ? "#10b981" : "#ef4444" }}>
              {formatNum(monthlyProfit)} EGP
            </div>
            <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 8 }}>
              = Withdrawals ({formatNum(wEGP)} EGP) − Expenses ({formatNum(Number(expenseTotal))} SAR)
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
