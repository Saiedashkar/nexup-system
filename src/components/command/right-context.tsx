"use client";

import { useEffect, useState } from "react";
import { useCommand } from "./state/command-store";
import { MOCK_PROJECTS } from "./state/demo-scenarios";
import { DEPARTMENTS, DEPARTMENT_BY_ID, FOUNDER, SYSTEMS } from "./state/organization-model";
import { DEPARTMENT_ICONS, IconBell, IconCheck, IconChevronDown, IconChevronRight, IconGear, IconPanel, IconPlus, IconSpark, IconWorkforce } from "./ui/icons";
import { cssVars } from "./ui/css-vars";

/**
 * Right context area.
 *
 * Four questions, in the order a founder actually asks them: what time is it
 * and what is happening · what is in flight · what am I running · what needs me.
 *
 * It is deliberately narrow and collapsible so the central Command experience
 * stays dominant. The only *pull* it has on the centre is the approval row,
 * which walks you straight into the department that is held — context should be
 * actionable, not noisy.
 */

const BUSINESS_CONTEXTS = ["All Companies", "NEXUP System", "REBOUND", "Abomazen"] as const;

const clockTime = (date: Date) =>
  date.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
const clockDate = (date: Date) =>
  date.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", year: "numeric" });

/** Top band of the context column — aligned with the global command bar. */
export function ContextTopbar() {
  const { notify, toggleRight } = useCommand();
  const [context, setContext] = useState(0);

  return (
    <div className="nc-context__topbar">
      <button
        type="button"
        className="nc-cluster-chip"
        onClick={() => setContext((c) => (c + 1) % BUSINESS_CONTEXTS.length)}
        title="Business context — mocked selector."
      >
        {BUSINESS_CONTEXTS[context]}
        <IconChevronDown size={14} />
      </button>

      <span style={{ flex: 1 }} />

      <button
        type="button"
        className="nc-cluster-icon"
        aria-label="Notifications"
        onClick={() => notify("Notifications are visual only in UI-01.")}
      >
        <IconBell size={17} />
        <span className="nc-cluster-icon__dot">2</span>
      </button>

      <span className="nc-avatar" style={{ width: 38, height: 38, fontSize: 13 }} aria-hidden="true">
        {FOUNDER.initials}
      </span>

      <button
        type="button"
        className="nc-context__collapse"
        onClick={toggleRight}
        aria-label="Collapse context panel"
        aria-expanded
      >
        <IconChevronRight size={15} />
      </button>
    </div>
  );
}

export function RightContext() {
  const { snapshot, focusDepartment, selectScenario, rightCollapsed, toggleRight, notify } = useCommand();
  const [now, setNow] = useState(() => new Date());

  /* The interval callback sets state, so the effect body itself stays empty. */
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(id);
  }, []);

  if (rightCollapsed) {
    return (
      <aside className="nc-context" aria-label="Context panel (collapsed)">
        <div className="nc-context__topbar" style={{ justifyContent: "center", padding: "16px 8px" }}>
          <button
            type="button"
            className="nc-context__collapse"
            onClick={toggleRight}
            aria-label="Expand context panel"
            aria-expanded={false}
          >
            <IconPanel size={15} />
          </button>
        </div>
        <div className="nc-context__rail">
          Live context
          {snapshot.approvals.length > 0 && (
            <span className="nc-org__legend-dot" style={{ background: "var(--nc-approval)" }} />
          )}
        </div>
      </aside>
    );
  }

  const nodes = [snapshot.visual.executive, ...Object.values(snapshot.visual.departments)];
  const agentsWorking = DEPARTMENTS.reduce(
    (total, department) =>
      total +
      department.workers.filter(
        (worker) => (snapshot.visual.departments[department.id]?.workerActivity?.[worker.id] ?? 0) >= 0.25,
      ).length,
    0,
  );
  const waitingApproval = snapshot.approvals.length;
  const needInput =
    snapshot.approvals.length + nodes.filter((n) => n.status === "BLOCKED" || n.status === "ERROR").length;
  const completed = nodes.filter((n) => n.status === "COMPLETED").length;

  const activity = [
    { id: "agents", label: "Agents working", value: agentsWorking, accent: "--nc-lime", Icon: IconWorkforce, hint: "Specialists currently active across departments." },
    { id: "waiting", label: "Waiting for approval", value: waitingApproval, accent: "--nc-approval", Icon: IconBell, hint: "Held at the approval gate until you decide." },
    { id: "input", label: "Need your input", value: needInput, accent: "--nc-handoff", Icon: IconSpark, hint: "Approvals plus blocked or failed work." },
    { id: "done", label: "Completed", value: completed, accent: "--nc-completed", Icon: IconCheck, hint: "Nodes that finished and are settling back to idle." },
  ];

  return (
    <aside className="nc-context" aria-label="Context panel">
      <ContextTopbar />

      <div className="nc-context__body">
        <div className="nc-clock">
          <span>
            <span className="nc-clock__date" style={{ display: "block" }} suppressHydrationWarning>
              {clockDate(now)}
            </span>
            <span className="nc-clock__time" style={{ display: "block" }} suppressHydrationWarning>
              {clockTime(now)}
            </span>
          </span>
          <span className="nc-clock__zone">Local</span>
        </div>

        <section className="nc-context__block">
          <div className="nc-context__label">
            Live activity
            <button
              type="button"
              className="nc-context__viewall"
              onClick={() => notify("The full activity stream arrives with the Work area.")}
            >
              View all
              <IconChevronRight size={12} />
            </button>
          </div>
          <div className="nc-activity">
            {activity.map(({ id, label, value, accent, Icon, hint }) => (
              <button
                key={id}
                type="button"
                className="nc-activity__row"
                style={cssVars({ "--nc-accent": `var(${accent})` })}
                title={hint}
                onClick={() => notify(`${label}: ${hint}`)}
              >
                <span className="nc-activity__icon">
                  <Icon size={15} />
                </span>
                <span className="nc-activity__label">{label}</span>
                <span className="nc-activity__count">{value}</span>
              </button>
            ))}
          </div>
        </section>

        <section className="nc-context__block">
          <div className="nc-context__label">
            Active projects
            <button
              type="button"
              className="nc-context__viewall"
              onClick={() => notify("The full Projects module is a later phase.")}
            >
              View all
              <IconChevronRight size={12} />
            </button>
          </div>
          <div className="nc-project">
            {MOCK_PROJECTS.map((project) => {
              const department = DEPARTMENT_BY_ID[project.department];
              const Icon = DEPARTMENT_ICONS[project.department];
              return (
                <div
                  key={project.id}
                  className="nc-project__row"
                  style={cssVars({ "--nc-accent": `var(${department?.accentVar ?? "--nc-lime"})` })}
                >
                  <span className="nc-project__mark" aria-hidden="true">
                    <Icon size={15} />
                  </span>
                  <span style={{ minWidth: 0 }}>
                    <span className="nc-project__name" style={{ display: "block" }}>
                      {project.name}
                    </span>
                    <span className="nc-project__meta" style={{ display: "block" }}>
                      {department?.short} · {project.meta}
                    </span>
                    <span className="nc-project__meter" aria-hidden="true">
                      <i style={{ width: `${project.progress}%` }} />
                    </span>
                  </span>
                  <span className="nc-project__pct">{project.progress}%</span>
                </div>
              );
            })}
          </div>
        </section>

        <section className="nc-context__block">
          <div className="nc-context__label">
            Your systems
            <span className="nc-context__count">{SYSTEMS.length}</span>
          </div>
          <div className="nc-systems-grid">
            {SYSTEMS.map((system) => {
              const body = (
                <>
                  <span className="nc-system-tile__mark">{system.mark}</span>
                  <span>
                    <span className="nc-system-tile__name" style={{ display: "block" }}>
                      {system.name}
                    </span>
                    <span className="nc-system-tile__status">
                      <i aria-hidden="true" />
                      {system.status}
                    </span>
                  </span>
                </>
              );

              return system.href ? (
                <a
                  key={system.id}
                  className="nc-system-tile nc-hover-depth"
                  data-kind={system.statusKind}
                  style={cssVars({ "--nc-accent": `var(${system.accentVar})` })}
                  href={system.href}
                  title={`${system.name} — opens the existing system`}
                >
                  {body}
                </a>
              ) : (
                <button
                  key={system.id}
                  type="button"
                  className="nc-system-tile nc-hover-depth"
                  data-kind={system.statusKind}
                  style={cssVars({ "--nc-accent": `var(${system.accentVar})` })}
                  onClick={() =>
                    notify(`${system.name} is a visual placeholder in UI-01 — no integration exists yet.`)
                  }
                >
                  {body}
                </button>
              );
            })}

            <button
              type="button"
              className="nc-system-tile nc-system-tile--connect"
              onClick={() => notify("Connecting a real system arrives with the Systems area in a later phase.")}
            >
              <IconPlus size={15} />
              Connect New System
            </button>
          </div>
        </section>

        <section className="nc-context__block">
          <div className="nc-context__label">
            Needs your approval
            {snapshot.approvals.length > 0 && (
              <span className="nc-context__count" style={{ color: "var(--nc-approval)" }}>
                {snapshot.approvals.length}
              </span>
            )}
          </div>

          {snapshot.approvals.length === 0 ? (
            <p className="nc-empty">Nothing is waiting on you.</p>
          ) : (
            snapshot.approvals.map((approval) => (
              <div key={approval.id} className="nc-approval-row">
                <span className="nc-approval-row__avatar" aria-hidden="true">
                  {DEPARTMENT_BY_ID[approval.department]?.short.slice(0, 3) ?? "—"}
                </span>
                <button
                  type="button"
                  style={{ minWidth: 0, textAlign: "left", flex: 1 }}
                  onClick={() => {
                    /* Context should be actionable: show the held state, then
                       walk straight into the department that is waiting. */
                    selectScenario("approval");
                    focusDepartment(approval.department);
                  }}
                  aria-label={`Open ${approval.title} in context`}
                >
                  <span className="nc-approval-row__title" style={{ display: "block" }}>
                    {approval.title}
                  </span>
                  <span className="nc-approval-row__meta" style={{ display: "block" }}>
                    {DEPARTMENT_BY_ID[approval.department]?.name} · risk {approval.risk}
                  </span>
                </button>
                <button
                  type="button"
                  className="nc-approval-row__act"
                  aria-label={`Approve: ${approval.title}`}
                  title="Approve (mocked in UI-01)"
                  onClick={() =>
                    notify(
                      "Approvals are visual in UI-01 — nothing was executed. The real approval loop is live at /office/ai-workforce (Phase 1B).",
                    )
                  }
                >
                  <IconCheck size={15} />
                </button>
              </div>
            ))
          )}
        </section>

        <section className="nc-context__block">
          <div className="nc-context__label">Runtime</div>
          <div className="nc-project__row" style={{ alignItems: "center" }}>
            <span className="nc-project__mark" style={cssVars({ "--nc-accent": "var(--nc-completed)" })}>
              <IconGear size={15} />
            </span>
            <span style={{ minWidth: 0 }}>
              <span className="nc-project__name" style={{ display: "block" }}>
                Local · no AI provider
              </span>
              <span className="nc-project__meta" style={{ display: "block" }}>
                All state on this screen is mocked and local.
              </span>
            </span>
          </div>
        </section>
      </div>
    </aside>
  );
}
