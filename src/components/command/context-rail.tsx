"use client";

import { useEffect, useState } from "react";
import { useCommand } from "./state/command-store";
import { MOCK_PROJECTS } from "./state/demo-scenarios";
import { ACTORS, describeActors } from "./state/actors";
import { ActorChip } from "./scene/actor-presence";
import { RecentActivity } from "./organization/command-center";
import { DEPARTMENT_BY_ID, FOUNDER, SYSTEMS } from "./state/organization-model";
import {
  DEPARTMENT_ICONS,
  IconArrowLeft,
  IconBell,
  IconChevronRight,
  IconGear,
  IconPanel,
  IconPlus,
  IconSpark,
} from "./ui/icons";
import { cssVars } from "./ui/css-vars";
import { STATUS_LABEL, workerLevel, workerState } from "./state/visual-state";

/**
 * CONTEXT RAIL (visual-direction pass)
 * ────────────────────────────────────
 * The reference asks for a quieter rail: who is on the team, what the
 * organization runs on, and what just happened — in that order, with room to
 * breathe. So the rail is now three sections rather than five, the label row is
 * title-case instead of a wall of tiny all-caps, and the department reading
 * still takes over the rail when a space is open.
 *
 * Every figure is derived from the live snapshot; nothing here reads a session,
 * a runtime or a database.
 */

const clockTime = (date: Date) => date.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
const clockDate = (date: Date) =>
  date.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", year: "numeric" });

/** Top band of the context column — notifications and identity. */
export function ContextTopbar() {
  const { notify, toggleRight } = useCommand();

  return (
    <div className="nc-context__topbar">
      <button
        type="button"
        className="nc-cluster-icon"
        aria-label="Notifications"
        onClick={() => notify("Notifications are visual only in this phase.")}
      >
        <IconBell size={18} />
        <span className="nc-cluster-icon__dot">2</span>
      </button>

      <span className="nc-avatar" style={{ width: 38, height: 38, fontSize: 13 }} aria-hidden="true">
        {FOUNDER.initials}
      </span>
      <span className="nc-context__who">
        <span className="nc-context__who-name">{FOUNDER.name}</span>
        <span className="nc-context__who-role">Executive</span>
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

function SectionLabel({
  children,
  count,
  onViewAll,
}: {
  children: React.ReactNode;
  count?: number;
  onViewAll?: () => void;
}) {
  return (
    <div className="nc-context__label">
      {children}
      {count !== undefined && <span className="nc-context__count">{count}</span>}
      {onViewAll && (
        <button type="button" className="nc-context__viewall" onClick={onViewAll}>
          View all
          <IconChevronRight size={12} />
        </button>
      )}
    </div>
  );
}

export function ContextRail() {
  const { snapshot, focus, clearFocus, rightCollapsed, toggleRight, notify } = useCommand();
  const [now, setNow] = useState(() => new Date());

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
          Local context
          {snapshot.approvals.length > 0 && (
            <span className="nc-room__legend-dot" style={{ background: "var(--nc-approval)" }} />
          )}
        </div>
      </aside>
    );
  }

  const focusDepartmentData = focus ? DEPARTMENT_BY_ID[focus] : null;
  const focusedVisual = focus ? snapshot.visual.departments[focus] : null;

  return (
    <aside className="nc-context" data-level={focus ? "department" : "organization"} aria-label="Context panel">
      <ContextTopbar />

      <div className="nc-context__body">
        {/* A space is open: the rail re-titles itself, and the level is always
            reversible without hunting for a control. */}
        {focusDepartmentData && focusedVisual ? (
          <div className="nc-context__level" style={cssVars({ "--nc-accent": `var(${focusDepartmentData.accentVar})` })}>
            <span className="nc-context__level-kicker">{focusDepartmentData.space}</span>
            <span className="nc-context__level-name">{focusDepartmentData.name}</span>
            <button type="button" className="nc-context__level-back" onClick={clearFocus}>
              <IconArrowLeft size={12} />
              Organization
            </button>
          </div>
        ) : (
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
        )}

        {focusDepartmentData && focusedVisual ? (
          <DepartmentContext departmentId={focusDepartmentData.id} notify={notify} />
        ) : (
          <OverviewContext />
        )}

        <section className="nc-context__block">
          <p className="nc-context__hint">
            <IconGear size={12} /> Local · no AI provider. Everything on this screen is mocked and local.
          </p>
        </section>
      </div>
    </aside>
  );
}

/* ── OVERVIEW MODE ─────────────────────────────────────────────────────── */

function OverviewContext() {
  const { notify } = useCommand();

  return (
    <>
      <section className="nc-context__block">
        <SectionLabel count={ACTORS.length} onViewAll={() => notify("The full workforce directory arrives with the Workforce area.")}>
          People &amp; Actors
        </SectionLabel>
        <div className="nc-people">
          {ACTORS.map((actor) => (
            <ActorChip key={actor.id} actor={actor} />
          ))}
        </div>
        <button
          type="button"
          className="nc-syslist__connect"
          onClick={() => notify("Inviting people or agents arrives with the Workforce area.")}
        >
          <IconPlus size={14} />
          Invite people or agents
        </button>
        <p className="nc-context__hint">{describeActors(ACTORS)} · presence is visual only in this phase.</p>
      </section>

      <section className="nc-context__block">
        <SectionLabel count={SYSTEMS.length} onViewAll={() => notify("The Systems area arrives in a later phase.")}>
          Connected Systems
        </SectionLabel>
        <div className="nc-syslist">
          {SYSTEMS.map((system) => (
            <SystemRow key={system.id} system={system} notify={notify} />
          ))}
        </div>
        <button
          type="button"
          className="nc-syslist__connect"
          onClick={() => notify("Connecting a real system arrives with the Systems area in a later phase.")}
        >
          <IconPlus size={14} />
          Add a system
        </button>
      </section>

      <section className="nc-context__block">
        <SectionLabel onViewAll={() => notify("The activity log arrives with the Work area.")}>
          Recent Activity
        </SectionLabel>
        <RecentActivity />
      </section>
    </>
  );
}

function SystemRow({
  system,
  notify,
}: {
  system: (typeof SYSTEMS)[number];
  notify: (message: string) => void;
}) {
  const reachedBy = system.linkedDepartments
    .map((id) => DEPARTMENT_BY_ID[id]?.name)
    .filter(Boolean)
    .join(" · ");

  const body = (
    <>
      <span className="nc-sysrow__mark">{system.mark}</span>
      <span className="nc-sysrow__text">
        <span className="nc-sysrow__name">{system.name}</span>
        <span className="nc-sysrow__meta">
          <i aria-hidden="true" />
          {system.status}
          <span className="nc-sysrow__kind">{system.kind}</span>
        </span>
        {reachedBy && <span className="nc-sysrow__reached">Reached by {reachedBy}</span>}
      </span>
    </>
  );

  if (system.href) {
    return (
      <a
        className="nc-sysrow"
        data-kind={system.statusKind}
        style={cssVars({ "--nc-accent": `var(${system.accentVar})` })}
        href={system.href}
        title={`${system.name} — opens the existing system`}
      >
        {body}
      </a>
    );
  }

  return (
    <button
      type="button"
      className="nc-sysrow"
      data-kind={system.statusKind}
      style={cssVars({ "--nc-accent": `var(${system.accentVar})` })}
      onClick={() =>
        notify(`${system.name} is a perimeter endpoint in the model — no integration exists yet.`)
      }
    >
      {body}
    </button>
  );
}

/* ── DEPARTMENT MODE ───────────────────────────────────────────────────── */

function DepartmentContext({
  departmentId,
  notify,
}: {
  departmentId: string;
  notify: (message: string) => void;
}) {
  const { snapshot } = useCommand();
  const department = DEPARTMENT_BY_ID[departmentId];
  const visual = snapshot.visual.departments[departmentId];
  if (!department || !visual) return null;

  /* The rows this space owns, from the same projection the Active Missions panel
     reads — so the count below is always the number of rows actually shown. */
  const missions = MOCK_PROJECTS.filter((project) => project.department === department.id);

  return (
    <>
      <section className="nc-context__block">
        <SectionLabel>Director</SectionLabel>
        <div className="nc-director" style={cssVars({ "--nc-accent": `var(${department.accentVar})` })}>
          <span className="nc-director__mark" aria-hidden="true">
            <IconSpark size={16} />
          </span>
          <span style={{ minWidth: 0 }}>
            <span className="nc-director__name" style={{ display: "block" }}>
              {department.director}
            </span>
            <span className="nc-director__meta" style={{ display: "block" }}>
              {STATUS_LABEL[visual.status]} · {department.brief}
            </span>
          </span>
        </div>
      </section>

      <section className="nc-context__block">
        <SectionLabel count={department.workers.length}>Teams</SectionLabel>
        <div className="nc-focus__grid">
          {department.workers.map((worker) => {
            const level = visual.workerActivity?.[worker.id] ?? 0;
            const state = workerState(level);
            return (
              <div key={worker.id} className="nc-worker" data-state={state} data-level={workerLevel(level)}>
                <span className="nc-worker__avatar">{worker.name.slice(0, 2)}</span>
                <span style={{ minWidth: 0 }}>
                  <span className="nc-worker__name" style={{ display: "block" }}>
                    {worker.name}
                  </span>
                  <span className="nc-project__meta" style={{ display: "block" }}>
                    {worker.role}
                  </span>
                </span>
                <span className="nc-worker__spacer" />
                <span className="nc-worker__status">{state.replace(/_/g, " ").toLowerCase()}</span>
              </div>
            );
          })}
        </div>
      </section>

      <section className="nc-context__block">
        <SectionLabel count={missions.length}>Running missions</SectionLabel>
        {missions.length === 0 ? (
          <p className="nc-empty">No mission in this space is currently tracked.</p>
        ) : (
          <div className="nc-project">
            {missions.map((project) => {
              const Icon = DEPARTMENT_ICONS[project.department];
              return (
                <div
                  key={project.id}
                  className="nc-project__row"
                  style={cssVars({ "--nc-accent": `var(${department.accentVar})` })}
                >
                  <span className="nc-project__mark" aria-hidden="true">
                    <Icon size={15} />
                  </span>
                  <span style={{ minWidth: 0 }}>
                    <span className="nc-project__name" style={{ display: "block" }}>
                      {project.name}
                    </span>
                    <span className="nc-project__meta" style={{ display: "block" }}>
                      {project.meta}
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
        )}
      </section>

      <section className="nc-context__block">
        <SectionLabel>Current bottleneck</SectionLabel>
        <div className="nc-bottleneck">
          <span className="nc-bottleneck__mark" aria-hidden="true" />
          <span style={{ minWidth: 0 }}>
            <span className="nc-bottleneck__title" style={{ display: "block" }}>
              {department.bottleneck}
            </span>
            <span className="nc-bottleneck__meta" style={{ display: "block" }}>
              {visual.activeJob ?? `Nothing is running in ${department.space}.`}
            </span>
          </span>
        </div>
        <button
          type="button"
          className="nc-context__viewall"
          style={{ marginTop: 10 }}
          onClick={() => notify(`${department.name}: opening the real Work surface is a later phase.`)}
        >
          Open in Work
          <IconChevronRight size={12} />
        </button>
      </section>
    </>
  );
}
