"use client";

import { useCommand } from "../state/command-store";
import {
  ACTORS,
  EXEC_ACTOR,
  type Actor,
} from "../state/actors";
import {
  DEPARTMENTS,
  DEPARTMENT_BY_ID,
  EXECUTIVE,
  FOUNDER,
} from "../state/organization-model";
import { MOCK_PROJECTS, type ProjectEntry } from "../state/demo-scenarios";
import { isWorkingStatus, needsHumanStatus } from "../state/visual-state";
import {
  IconActivity,
  IconAgent,
  IconArrowLeft,
  IconChevronRight,
  IconMission,
  IconRun,
  IconSpark,
  IconWarRoom,
} from "../ui/icons";
import { cssVars } from "../ui/css-vars";

/**
 * COMMAND CENTER CHROME (visual-direction pass)
 * ─────────────────────────────────────────────
 * The reading the reference asks for: a heading band with an atlas behind it, a
 * row of live figures, and two operative tables under the graph. All three are
 * *derived* from the state the environment already has — the visual contract,
 * the organization configuration, the mock mission list and the real approval
 * queue. Nothing here invents a data source, a backend call or a permission.
 *
 * Mock-only, like everything else on this screen: every figure is computed
 * locally and labelled as such where it could be mistaken for real execution.
 */

/* ── Heading band ───────────────────────────────────────────────────────── */

export function CommandHeader() {
  const { snapshot, clearFocus, focus } = useCommand();
  const focused = focus ? DEPARTMENT_BY_ID[focus] : null;

  return (
    <header className="nc-cc-head">
      <span className="nc-cc-head__banner" aria-hidden="true">
        <span className="nc-cc-head__globe" />
        <span className="nc-cc-head__atmos" />
      </span>

      <div className="nc-cc-head__copy">
        <span className="nc-cc-head__mark" aria-hidden="true">
          <IconSpark size={18} />
        </span>
        <div className="nc-cc-head__titles">
          <h1 className="nc-cc-head__title">
            {focused ? focused.name : "Executive Command Center"}
          </h1>
          <p className="nc-cc-head__sub">
            {focused
              ? `${focused.brief} — ${snapshot.narrative}`
              : "A unified view of your organization, people, work, and performance."}
          </p>
        </div>

        {focused && (
          <button type="button" className="nc-cc-head__back" onClick={clearFocus}>
            <IconArrowLeft size={13} />
            Organization
          </button>
        )}
      </div>

      <div className="nc-cc-head__chips">
        <HeadChip label="Local time" value={clockLabel()} />
        <HeadChip label="Authority" value={FOUNDER.role.includes("/") ? "Human" : FOUNDER.role} />
        <span className="nc-cc-head__presence">
          <span className="nc-cc-head__dot" aria-hidden="true" />
          Live
        </span>
      </div>
    </header>
  );
}

function HeadChip({ label, value }: { label: string; value: string }) {
  return (
    <span className="nc-cc-chip">
      <span className="nc-cc-chip__label">{label}</span>
      <span className="nc-cc-chip__value" suppressHydrationWarning>
        {value}
      </span>
    </span>
  );
}

const clockLabel = () =>
  new Date().toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });

/* ── KPI row ────────────────────────────────────────────────────────────── */

const KPI_TONE = {
  missions: "--nc-growth",
  approval: "--nc-approval",
  progress: "--nc-thinking",
  rate: "--nc-completed",
  agents: "--nc-product",
} as const;

export function CommandKpis() {
  const { snapshot } = useCommand();
  const { visual } = snapshot;

  const nodes = [visual.executive, ...Object.values(visual.departments)];
  const working = nodes.filter((node) => isWorkingStatus(node.status)).length;
  const attention = nodes.filter(
    (node) => node.needsApproval || needsHumanStatus(node.status),
  ).length;

  const missions = DEPARTMENTS.reduce((sum, department) => sum + department.missions, 0);
  const aiAgents = ACTORS.filter((actor) => actor.kind === "ai").length;
  const executionRate = Math.round(
    (nodes.reduce((sum, node) => sum + node.activityLevel, 0) / nodes.length) * 100,
  );

  const items = [
    { id: "missions", Icon: IconMission, value: missions, label: "Active Missions", note: "across 5 departments" },
    { id: "approval", Icon: IconWarRoom, value: attention, label: "Awaiting Approval", note: "needs a human" },
    { id: "progress", Icon: IconRun, value: working, label: "In Progress", note: "nodes working" },
    { id: "rate", Icon: IconActivity, value: `${executionRate}%`, label: "Execution Rate", note: "rolling" },
    { id: "agents", Icon: IconAgent, value: aiAgents, label: "AI Agents Online", note: "all systems operational" },
  ] as const;

  return (
    <div className="nc-cc-kpis" role="list" aria-label="Organization figures">
      {items.map(({ id, Icon, value, label, note }) => (
        <div
          key={id}
          role="listitem"
          className="nc-cc-kpi"
          style={cssVars({ "--nc-accent": `var(${KPI_TONE[id]})` })}
        >
          <span className="nc-cc-kpi__icon" aria-hidden="true">
            <Icon size={18} />
          </span>
          <span className="nc-cc-kpi__body">
            <span className="nc-cc-kpi__value">{value}</span>
            <span className="nc-cc-kpi__label">{label}</span>
            <span className="nc-cc-kpi__note">{note}</span>
          </span>
        </div>
      ))}
    </div>
  );
}

/* ── Lower panels: Active Missions + Decision Queue ─────────────────────── */

const RISK_TONE: Record<string, string> = {
  LOW: "--nc-thinking",
  MEDIUM: "--nc-approval",
  HIGH: "--nc-error",
  CRITICAL: "--nc-error",
};

function missionStatus(progress: number): { label: string; tone: string } {
  if (progress >= 80) return { label: "On Track", tone: "--nc-completed" };
  if (progress >= 50) return { label: "In Progress", tone: "--nc-thinking" };
  return { label: "At Risk", tone: "--nc-approval" };
}

export function CommandMissionsPanels() {
  const { snapshot, notify } = useCommand();
  const approvals = snapshot.approvals;

  return (
    <div className="nc-cc-panels">
      <section className="nc-cc-panel" aria-label="Active missions">
        <div className="nc-cc-panel__head">
          <span className="nc-cc-panel__icon" aria-hidden="true">
            <IconMission size={16} />
          </span>
          <h2 className="nc-cc-panel__title">Active Missions</h2>
          <span className="nc-cc-panel__count">{MOCK_PROJECTS.length}</span>
          <button type="button" className="nc-cc-panel__viewall" onClick={() => notify("The full mission list arrives with the Work area.")}>
            View all
            <IconChevronRight size={12} />
          </button>
        </div>

        <div className="nc-cc-table" role="table" aria-label="Active missions">
          <div className="nc-cc-table__head" role="row">
            <span>Mission</span>
            <span>Department</span>
            <span>Progress</span>
            <span>Status</span>
          </div>
          {MOCK_PROJECTS.map((project) => (
            <MissionRow key={project.id} project={project} />
          ))}
        </div>
      </section>

      <section className="nc-cc-panel" aria-label="Decision queue">
        <div className="nc-cc-panel__head">
          <span className="nc-cc-panel__icon" aria-hidden="true">
            <IconWarRoom size={16} />
          </span>
          <h2 className="nc-cc-panel__title">Decision Queue</h2>
          <span className="nc-cc-panel__count">{approvals.length}</span>
          <button type="button" className="nc-cc-panel__viewall" onClick={() => notify("The full decision queue arrives with Control.")}>
            View all
            <IconChevronRight size={12} />
          </button>
        </div>

        <div className="nc-cc-table nc-cc-table--decisions" role="table" aria-label="Decision queue">
          <div className="nc-cc-table__head" role="row">
            <span>Decision</span>
            <span>Impact</span>
            <span>Requested by</span>
          </div>

          {approvals.length === 0 ? (
            <p className="nc-cc-empty">
              Nothing is waiting on your authority. Held decisions appear here the moment a
              node reaches the approval gate.
            </p>
          ) : (
            approvals.map((approval) => {
              const department = DEPARTMENT_BY_ID[approval.department];
              const requester: Actor = EXEC_ACTOR;
              return (
                <button
                  key={approval.id}
                  type="button"
                  role="row"
                  className="nc-cc-table__row nc-cc-table__row--action"
                  onClick={() =>
                    notify(
                      "Approvals are visual in this phase — nothing was executed. The real approval loop is live at /office/ai-workforce.",
                    )
                  }
                >
                  <span className="nc-cc-table__cell nc-cc-table__cell--lead">
                    <span
                      className="nc-cc-table__mark"
                      style={cssVars({ "--nc-accent": `var(${department?.accentVar ?? "--nc-product"})` })}
                      aria-hidden="true"
                    >
                      {department?.short.slice(0, 2) ?? "—"}
                    </span>
                    <span className="nc-cc-table__col">
                      <span className="nc-cc-table__name" style={{ display: "block" }}>
                        {approval.title}
                      </span>
                      <span className="nc-cc-table__meta" style={{ display: "block" }}>
                        {approval.detail}
                      </span>
                    </span>
                  </span>
                  <span className="nc-cc-table__cell">
                    <span
                      className="nc-cc-tag"
                      style={cssVars({ "--nc-accent": `var(${RISK_TONE[approval.risk] ?? "--nc-approval"})` })}
                    >
                      {approval.risk.toLowerCase()}
                    </span>
                  </span>
                  <span className="nc-cc-table__cell nc-cc-table__cell--who">
                    <span className="nc-cc-who" aria-hidden="true">
                      {requester.initials}
                    </span>
                    <span className="nc-cc-who__name">{requester.name}</span>
                  </span>
                </button>
              );
            })
          )}
        </div>
      </section>
    </div>
  );
}

function MissionRow({ project }: { project: ProjectEntry }) {
  const department = DEPARTMENT_BY_ID[project.department];
  const status = missionStatus(project.progress);
  return (
    <div
      className="nc-cc-table__row"
      role="row"
      style={cssVars({ "--nc-accent": `var(${department?.accentVar ?? "--nc-product"})` })}
    >
      <span className="nc-cc-table__cell nc-cc-table__cell--lead">
        <span className="nc-cc-table__mark" aria-hidden="true">
          {department?.short.slice(0, 2) ?? "—"}
        </span>
        <span className="nc-cc-table__col">
          <span className="nc-cc-table__name" style={{ display: "block" }}>
            {project.name}
          </span>
          <span className="nc-cc-table__meta" style={{ display: "block" }}>
            {project.meta}
          </span>
        </span>
      </span>
      <span className="nc-cc-table__cell nc-cc-table__cell--dept">{department?.name}</span>
      <span className="nc-cc-table__cell">
        <span className="nc-cc-progress" aria-hidden="true">
          <i style={{ width: `${project.progress}%` }} />
        </span>
        <span className="nc-cc-progress__pct">{project.progress}%</span>
      </span>
      <span className="nc-cc-table__cell">
        <span className="nc-cc-status" style={cssVars({ "--nc-accent": `var(${status.tone})` })}>
          <i aria-hidden="true" />
          {status.label}
        </span>
      </span>
    </div>
  );
}

/* ── Recent activity (used by the context rail) ─────────────────────────── */

export function RecentActivity() {
  const { snapshot } = useCommand();
  return (
    <div className="nc-cc-activity">
      {snapshot.activity.map((entry) => {
        const department = entry.departmentId ? DEPARTMENT_BY_ID[entry.departmentId] : null;
        return (
          <div
            key={entry.id}
            className="nc-cc-activity__row"
            style={cssVars({
              "--nc-accent": department ? `var(${department.accentVar})` : "var(--nc-completed)",
            })}
          >
            <span className="nc-cc-activity__icon" aria-hidden="true">
              {department ? <IconActivity size={14} /> : <IconSpark size={14} />}
            </span>
            <span className="nc-cc-activity__text">{entry.text}</span>
            <span className="nc-cc-activity__time">{entry.time}</span>
          </div>
        );
      })}
    </div>
  );
}

/** Exported for the rail so the two read the same executive identity. */
export const EXEC_IDENTITY = {
  name: EXEC_ACTOR.name,
  role: EXECUTIVE.kicker,
} as const;
