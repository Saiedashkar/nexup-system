import { getCurrentSession } from "@/lib/auth";
import { getControlCore, getWorkforceBootstrap } from "@/modules/ai-workforce";
import { actorFromSession, canUseWorkforce } from "@/modules/ai-workforce/adapters/session-actor";
import { ApprovalActions } from "./approval-actions";

/**
 * NEXUP COMMAND → AI WORKFORCE — module status skeleton (Phase 1B).
 *
 * Still deliberately isolated:
 *   - no sidebar entry, no shared layout change;
 *   - rendered on the server straight from the control core (no client fetch,
 *     no client state beyond the Approve/Reject buttons);
 *   - it renders registry / persistence / jobs / approvals / runs, and executes
 *     nothing except a human pressing Approve.
 *
 * The full Command Center arrives in a later phase.
 */

export const dynamic = "force-dynamic";

const RISK_COLOR: Record<string, string> = {
  LOW: "#10b981",
  MEDIUM: "#f59e0b",
  HIGH: "#ef4444",
  CRITICAL: "#7f1d1d",
};

const STATUS_COLOR: Record<string, string> = {
  COMPLETED: "#10b981",
  SUCCEEDED: "#10b981",
  APPROVED: "#10b981",
  RUNNING: "#3b82f6",
  READY: "#3b82f6",
  STARTED: "#3b82f6",
  PLANNED: "#8b5cf6",
  CREATED: "#64748b",
  PENDING: "#f59e0b",
  WAITING_APPROVAL: "#f59e0b",
  WAITING_HUMAN: "#f59e0b",
  BLOCKED: "#ef4444",
  REJECTED: "#ef4444",
  FAILED: "#ef4444",
  CANCELLED: "#64748b",
};

const card: React.CSSProperties = {
  background: "#ffffff",
  border: "1px solid #e2e8f0",
  borderRadius: 16,
  padding: 20,
  boxShadow: "0 1px 3px rgba(15, 23, 42, 0.04)",
};

function badge(color: string): React.CSSProperties {
  return {
    display: "inline-flex",
    alignItems: "center",
    padding: "3px 10px",
    borderRadius: 20,
    fontSize: 12,
    fontWeight: 600,
    color,
    background: `${color}1a`,
  };
}

function StatCard({ label, value, hint, color }: { label: string; value: string; hint: string; color: string }) {
  return (
    <div style={card}>
      <div style={{ fontSize: 12, color: "#94a3b8", fontWeight: 600, textTransform: "uppercase" }}>{label}</div>
      <div style={{ fontSize: 24, fontWeight: 800, color, marginTop: 6 }}>{value}</div>
      <div style={{ fontSize: 12, color: "#475569", marginTop: 4 }}>{hint}</div>
    </div>
  );
}

export default async function AiWorkforcePage() {
  const session = await getCurrentSession();
  const actor = session ? actorFromSession(session) : null;

  if (!actor || !canUseWorkforce(actor)) {
    return (
      <div dir="rtl" style={{ minHeight: "100vh", background: "#f1f5f9", padding: "48px 24px", fontFamily: "'Inter','Segoe UI',Tahoma,Arial,sans-serif" }}>
        <div style={{ maxWidth: 720, margin: "0 auto", ...card, borderColor: "#fecaca", background: "#fef2f2" }}>
          <h1 style={{ margin: 0, fontSize: 22, fontWeight: 800, color: "#b91c1c" }}>NEXUP COMMAND — AI WORKFORCE</h1>
          <p style={{ margin: "10px 0 0", color: "#b91c1c", fontSize: 14 }}>
            لا تملك صلاحية الوصول إلى وحدة AI Workforce في هذه المرحلة.
          </p>
        </div>
      </div>
    );
  }

  const core = getControlCore();
  const bootstrap = getWorkforceBootstrap();
  const runtime = core.runtime.describe();
  const tools = core.registry.list();
  const jobs = await core.jobs.listJobs(6);
  const runs = await core.recorder.listRuns(6);
  const pending = await core.approvalService.listPending(10);

  const persistenceLabel = bootstrap.persistence === "DATABASE" ? "DATABASE (ISOLATED)" : "IN_MEMORY";

  return (
    <div dir="rtl" style={{ minHeight: "100vh", background: "#f1f5f9", padding: "32px 24px", fontFamily: "'Inter','Segoe UI',Tahoma,Arial,sans-serif" }}>
      <div style={{ maxWidth: 1200, margin: "0 auto" }}>
        <header style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 24, gap: 16 }}>
          <div>
            <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: 1, color: "#0d9488", textTransform: "uppercase" }}>
              NEXUP COMMAND
            </div>
            <h1 style={{ margin: "4px 0 0", fontSize: 30, fontWeight: 800, color: "#0f172a" }}>AI WORKFORCE</h1>
            <p style={{ margin: "6px 0 0", color: "#475569", fontSize: 14 }}>
              وحدة داخل NEXUP COMMAND — Phase 1B: Persistence + Approval Loop (بدون مزوّد AI)
            </p>
          </div>
          <span style={badge("#10b981")}>OPERATIONAL</span>
        </header>

        <section style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 16, marginBottom: 24 }}>
          <StatCard label="Runtime" value={runtime.kind} hint={`AI Provider: ${runtime.aiProvider}`} color="#0d9488" />
          <StatCard
            label="Persistence"
            value={persistenceLabel}
            hint={bootstrap.reason.length > 70 ? `${bootstrap.reason.slice(0, 70)}…` : bootstrap.reason}
            color={bootstrap.persistence === "DATABASE" ? "#0d9488" : "#475569"}
          />
          <StatCard
            label="Registered Tools"
            value={String(tools.length)}
            hint={`${runtime.tools.read} read · ${runtime.tools.write} write`}
            color="#0f172a"
          />
          <StatCard label="Pending Approvals" value={String(pending.length)} hint={`${jobs.length} jobs · ${runs.length} runs`} color={pending.length ? "#f59e0b" : "#0f172a"} />
          <StatCard label="Production Impact" value="ISOLATED" hint="Legacy DB writes: NONE" color="#10b981" />
        </section>

        <section style={{ ...card, marginBottom: 24 }}>
          <h2 style={{ margin: "0 0 16px", fontSize: 20, fontWeight: 700, color: "#0f172a" }}>Registered Tools</h2>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr>
                  {["Tool", "Domain", "Mode", "Risk", "Approval", "Scope", "Enabled"].map((header) => (
                    <th
                      key={header}
                      style={{
                        textAlign: "right",
                        padding: "10px 12px",
                        fontSize: 12,
                        color: "#94a3b8",
                        textTransform: "uppercase",
                        borderBottom: "1px solid #e2e8f0",
                      }}
                    >
                      {header}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {tools.map((tool) => (
                  <tr key={tool.id}>
                    <td style={{ padding: 12, borderBottom: "1px solid #e2e8f0" }}>
                      <div style={{ fontWeight: 600, color: "#0f172a", fontFamily: "monospace", fontSize: 13 }}>
                        {tool.id}@{tool.version}
                      </div>
                      <div style={{ fontSize: 12, color: "#475569", marginTop: 2 }}>{tool.name}</div>
                    </td>
                    <td style={{ padding: 12, fontSize: 13, color: "#475569", borderBottom: "1px solid #e2e8f0" }}>{tool.domain}</td>
                    <td style={{ padding: 12, fontSize: 13, color: "#475569", borderBottom: "1px solid #e2e8f0" }}>
                      {tool.readWriteMode}
                    </td>
                    <td style={{ padding: 12, borderBottom: "1px solid #e2e8f0" }}>
                      <span style={badge(RISK_COLOR[tool.riskLevel] ?? "#64748b")}>{tool.riskLevel}</span>
                    </td>
                    <td style={{ padding: 12, fontSize: 13, color: "#475569", borderBottom: "1px solid #e2e8f0" }}>
                      {tool.requiresApproval ? "إلزامية" : "حسب السياسة"}
                    </td>
                    <td style={{ padding: 12, fontSize: 13, color: "#475569", borderBottom: "1px solid #e2e8f0" }}>
                      {tool.businessScoped ? "Business" : "Office-wide"}
                    </td>
                    <td style={{ padding: 12, fontSize: 13, borderBottom: "1px solid #e2e8f0", color: tool.enabled ? "#10b981" : "#ef4444" }}>
                      {tool.enabled ? "نشط" : "معطّل"}
                    </td>
                  </tr>
                ))}
                {tools.length === 0 && (
                  <tr>
                    <td colSpan={7} style={{ padding: 16, color: "#94a3b8", fontSize: 14 }}>
                      لا توجد أدوات مسجّلة.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>

        <section style={{ ...card, marginBottom: 24, borderColor: pending.length ? "#fde68a" : "#e2e8f0", background: pending.length ? "#fffbeb" : "#ffffff" }}>
          <h2 style={{ margin: "0 0 6px", fontSize: 20, fontWeight: 700, color: "#0f172a" }}>Pending Approvals</h2>
          <p style={{ margin: "0 0 16px", color: "#475569", fontSize: 13 }}>
            الموافقة قرار مُسجَّل (من طلب، لأي قدرة، بأي خطورة، من قرر ومتى) وليست boolean — وبعدها يُستأنف نفس الـJob ويُنفَّذ مرة واحدة فقط.
          </p>
          {pending.length === 0 ? (
            <p style={{ color: "#94a3b8", fontSize: 14, margin: 0 }}>لا توجد موافقات معلّقة.</p>
          ) : (
            <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 12 }}>
              {pending.map((approval) => {
                const eligibility = core.approvalService.evaluateEligibility(approval, actor);
                return (
                  <li
                    key={approval.id}
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      gap: 12,
                      border: "1px solid #fde68a",
                      borderRadius: 12,
                      padding: 12,
                      background: "#ffffff",
                    }}
                  >
                    <div>
                      <div style={{ fontFamily: "monospace", fontSize: 13, color: "#0f172a" }}>{approval.toolId}</div>
                      <div style={{ fontSize: 12, color: "#475569", marginTop: 4 }}>{approval.requestReason}</div>
                      <div style={{ fontSize: 11, color: "#94a3b8", marginTop: 4, fontFamily: "monospace" }}>
                        {approval.id} · job {approval.jobId ?? "—"} · طلبها {approval.requestedByUserId}
                      </div>
                      {!eligibility.allowed && (
                        <div style={{ fontSize: 11, color: "#b45309", marginTop: 4 }}>
                          {eligibility.reason}: {eligibility.missing.join(", ") || eligibility.detail}
                        </div>
                      )}
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                      <span style={badge(RISK_COLOR[approval.riskLevel] ?? "#64748b")}>{approval.riskLevel}</span>
                      <ApprovalActions approvalId={approval.id} canDecide={eligibility.allowed} />
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <section style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: 16, marginBottom: 24 }}>
          <div style={card}>
            <h2 style={{ margin: "0 0 14px", fontSize: 18, fontWeight: 700, color: "#0f172a" }}>
              Persistent Jobs
            </h2>
            {jobs.length === 0 ? (
              <p style={{ color: "#94a3b8", fontSize: 14, margin: 0 }}>لا توجد Jobs بعد — تُنشأ يدويًّا عبر POST /api/ai-workforce/jobs.</p>
            ) : (
              <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 10 }}>
                {jobs.map((job) => (
                  <li
                    key={job.id}
                    style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, borderBottom: "1px solid #f1f5f9", paddingBottom: 8 }}
                  >
                    <div>
                      <div style={{ fontFamily: "monospace", fontSize: 13, color: "#0f172a" }}>{job.capability}</div>
                      <div style={{ fontSize: 12, color: "#94a3b8" }}>
                        {job.trigger} · {job.autonomy} · {job.history.map((step) => step.to).join(" → ") || "CREATED"}
                      </div>
                      <div style={{ fontSize: 11, color: "#cbd5f5", fontFamily: "monospace" }}>{job.id}</div>
                    </div>
                    <span style={badge(STATUS_COLOR[job.status] ?? "#64748b")}>{job.status}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div style={card}>
            <h2 style={{ margin: "0 0 14px", fontSize: 18, fontWeight: 700, color: "#0f172a" }}>Recent Runs</h2>
            {runs.length === 0 ? (
              <p style={{ color: "#94a3b8", fontSize: 14, margin: 0 }}>لا توجد Runs بعد.</p>
            ) : (
              <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 10 }}>
                {runs.map((run) => (
                  <li
                    key={run.id}
                    style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, borderBottom: "1px solid #f1f5f9", paddingBottom: 8 }}
                  >
                    <div>
                      <div style={{ fontFamily: "monospace", fontSize: 13, color: "#0f172a" }}>{run.toolId ?? "—"}</div>
                      <div style={{ fontSize: 12, color: "#94a3b8" }}>
                        {new Date(run.startedAt).toLocaleString("en-GB")} · {run.id}
                      </div>
                    </div>
                    <span style={badge(STATUS_COLOR[run.status] ?? "#64748b")}>{run.status}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>

        <section style={{ ...card, borderColor: "#ccfbf1", background: "#f0fdfa" }}>
          <h2 style={{ margin: "0 0 10px", fontSize: 16, fontWeight: 700, color: "#0f766e" }}>وضع العزل (Phase 1B)</h2>
          <ul style={{ margin: 0, paddingInlineStart: 20, color: "#0f766e", fontSize: 14, lineHeight: 2 }}>
            <li>Runtime = Local (deterministic) — لا يوجد أي مزوّد AI ولا استهلاك Tokens.</li>
            <li>
              Persistence = {persistenceLabel} — {bootstrap.reason}
            </li>
            <li>Legacy database = untouched — لا قراءة ولا كتابة ولا migration على قاعدة النظام الحالي.</li>
            <li>Production Impact = Isolated — لا deploy ولا تغيير على master.</li>
            <li>External calls = None — لا Hermes، ولا MCP، ولا webhooks، ولا تكاملات اجتماعية.</li>
            <li>Jobs تُنشأ يدويًّا فقط (Manual) وتُنفَّذ عند الطلب — لا Scheduler ولا Queue.</li>
            <li>كل تنفيذ محمي بـcompare-and-set: نفس الـJob أو نفس الموافقة لا يُنفَّذ مرتين أبدًا.</li>
          </ul>
        </section>
      </div>
    </div>
  );
}
