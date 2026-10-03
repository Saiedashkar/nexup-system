"use client";

import { useEffect, useState } from "react";
import { useCommand } from "./state/command-store";
import { MOCK_PROJECTS } from "./state/demo-scenarios";
import { ACTORS, describeActors } from "./state/actors";
import { ActorChip } from "./scene/actor-presence";
import { DEPARTMENT_BY_ID, FOUNDER, SYSTEMS } from "./state/organization-model";
import {
  DEPARTMENT_ICONS,
  IconArrowLeft,
  IconBell,
  IconCheck,
  IconChevronDown,
  IconChevronRight,
  IconGear,
  IconPanel,
  IconPlus,
  IconSpark,
} from "./ui/icons";
import { cssVars } from "./ui/css-vars";
import { STATUS_LABEL, workerLevel, workerState } from "./state/visual-state";

/** Worker rows use the collapsed five-state vocabulary. */
const WORKER_STATE_LABEL: Record<string, string> = {
  IDLE: "Idle",
  WORKING: "Working",
  ACTIVE: "Active",
  WAITING: "Waiting",
  APPROVAL_REQUIRED: "Needs approval",
};

/**
 * CONTEXT RAIL (Phase UI-02.1)
 * ────────────────────────────
 * The rail answers "what should I know right now" — and it answers it
 * *differently depending on where the camera is*, which is the point of a
 * spatial environment: moving into a space should change everything you're
 * looking at, not just the thing you clicked.
 *
 *   overview    →  NOW · NEEDS YOU · PEOPLE · SYSTEM HEALTH
 *   department  →  DIRECTOR · TEAMS · RUNNING MISSIONS · BOTTLENECK
 *
 * Both modes are the same rail, the same blocks and the same live snapshot —
 * only the questions change. Department detail moved here from UI-01.1's modal
 * focus panel, so entering a space never covers the organization.
 *
 * Light by design: it is collapsible, it has no charts, and every number on it
 * is derived from the visual state instead of being typed in twice.
 */

const BUSINESS_CONTEXTS = ["All Companies", "NEXUP System", "REBOUND", "Abomazen"] as const;

const clockTime = (date: Date) => date.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
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
        onClick={() => notify("Notifications are visual only in this phase.")}
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
          Live context
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

/* ── OVERVIEW MODE ─────────────────────────────────────────────────────── */

function OverviewContext() {
  const { snapshot, focusDepartment, selectScenario, notify } = useCommand();

  const nodes = [snapshot.visual.executive, ...Object.values(snapshot.visual.departments)];
  const working = nodes.filter(
    (node) => node.status === "ACTIVE" || node.status === "THINKING" || node.status === "HANDOFF",
  ).length;
  const held = nodes.filter(
    (node) =>
      node.needsApproval ||
      node.status === "APPROVAL_REQUIRED" ||
      node.status === "BLOCKED" ||
      node.status === "ERROR",
  ).length;
  const failed = nodes.filter((node) => node.status === "ERROR" || node.status === "BLOCKED").length;

  const attention = snapshot.approvals.length + failed;

  return (
    <>
      <section className="nc-context__block">
        <div className="nc-context__label">Now</div>
        <div className="nc-now">
          <span className="nc-now__line">{snapshot.narrative}</span>
          <span className="nc-now__meta">
            {working} of {nodes.length} nodes working · {held} holding for a human
          </span>
        </div>
      </section>

      <section className="nc-context__block">
        <div className="nc-context__label">
          Needs you
          {attention > 0 && (
            <span className="nc-context__count" style={{ color: "var(--nc-approval)" }}>
              {attention}
            </span>
          )}
        </div>

        {snapshot.approvals.length === 0 && failed === 0 ? (
          <p className="nc-empty">Nothing is waiting on you.</p>
        ) : (
          <>
            {snapshot.approvals.map((approval) => (
              <div key={approval.id} className="nc-approval-row">
                <span className="nc-approval-row__avatar" aria-hidden="true">
                  {DEPARTMENT_BY_ID[approval.department]?.short.slice(0, 3) ?? "—"}
                </span>
                <button
                  type="button"
                  style={{ minWidth: 0, textAlign: "left", flex: 1 }}
                  onClick={() => {
                    /* Context stays actionable: show the held state, then walk
                       straight into the space that is waiting. */
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
                  title="Approve (mocked)"
                  onClick={() =>
                    notify(
                      "Approvals are visual in this phase — nothing was executed. The real approval loop is live at /office/ai-workforce.",
                    )
                  }
                >
                  <IconCheck size={15} />
                </button>
              </div>
            ))}

            {failed > 0 && (
              <button
                type="button"
                className="nc-attention-row"
                onClick={() => notify(`${failed} node(s) blocked or failed — visible on the wired space, never hidden.`)}
              >
                <span className="nc-attention-row__mark" aria-hidden="true" />
                {failed} blocked or failed
                <IconChevronRight size={12} />
              </button>
            )}
          </>
        )}
      </section>

      <section className="nc-context__block">
        <div className="nc-context__label">
          People
          <span className="nc-context__count">{ACTORS.length}</span>
        </div>
        <div className="nc-people">
          {ACTORS.map((actor) => (
            <ActorChip key={actor.id} actor={actor} />
          ))}
        </div>
        <p className="nc-context__hint">
          {describeActors(ACTORS)} — presence is visual only in this phase.
        </p>
      </section>

      {/* The Connected Systems Layer, in list form. The same four endpoints the
          room mounts on its perimeter, with the one thing a list can say better
          than a room can: which spaces actually reach them. */}
      <section className="nc-context__block">
        <div className="nc-context__label">
          Connected systems
          <span className="nc-context__count">{SYSTEMS.length}</span>
        </div>
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
          Connect a system
        </button>
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

  const missions = MOCK_PROJECTS.filter((project) => project.department === department.id);

  return (
    <>
      <section className="nc-context__block">
        <div className="nc-context__label">Director</div>
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
        <div className="nc-context__label">
          Teams
          <span className="nc-context__count">{department.workers.length}</span>
        </div>
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
                <span className="nc-worker__status">{WORKER_STATE_LABEL[state] ?? state}</span>
              </div>
            );
          })}
        </div>
      </section>

      <section className="nc-context__block">
        <div className="nc-context__label">
          Running missions
          <span className="nc-context__count">{department.missions}</span>
        </div>
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
        <div className="nc-context__label">Current bottleneck</div>
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
