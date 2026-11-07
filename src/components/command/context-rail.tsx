"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useCommand } from "./state/command-store";
import { systemStateLabel, useLocale } from "./i18n/command-locale";
import { MOCK_PROJECTS } from "./state/demo-scenarios";
import { ACTORS, actorCounts } from "./state/actors";
import { ActorChip } from "./scene/actor-presence";
import { RecentActivity } from "./organization/command-center";
import { DEPARTMENTS, DEPARTMENT_BY_ID, FOUNDER, SYSTEMS } from "./state/organization-model";
import { workspaceHref } from "./state/department-workspace";
import type { RiskLevel } from "./state/demo/types";
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
import { isWorkingStatus, workerLevel, workerState } from "./state/visual-state";

/**
 * CONTEXT PANEL (visual-direction pass · restructured in Pass 2)
 * ─────────────────────────────────────────────────────────────
 * The reference asks for a quiet, CONTEXTUAL panel — and Pass 2 makes it behave
 * like one. Three changes, all of them about what a reader needs first:
 *
 *   1. PRIORITY FIRST. The panel now opens with "Needs your decision" and
 *      "Work in progress", before people, systems or history. Those two answers
 *      are why anyone opens this panel; everything else is context for them.
 *   2. CONTEXTUAL. When a space is open, the panel stops being a general
 *      overview and becomes that space's own panel (director, teams, missions,
 *      bottleneck). The level is always reversible and never requires hunting
 *      for a control.
 *   3. COLLAPSIBLE, AND IT SAYS SO. Both states announce themselves through
 *      localized accessible names, and the collapsed rail still carries the
 *      approval held-count as a dot, so collapsing never hides that something
 *      needs a human.
 *
 * Every figure is derived from the live snapshot; nothing here reads a session,
 * a runtime or a database. Department names, briefs and statuses come from the
 * dictionary, so the panel is bilingual like the rest of the product.
 */

export function ContextTopbar() {
  const { notify, toggleRight } = useCommand();
  const { t } = useLocale();

  return (
    <div className="nc-context__topbar">
      <button
        type="button"
        className="nc-cluster-icon"
        aria-label={t("shell.notifications")}
        onClick={() => notify(t("ctx.notificationsToast"))}
      >
        <IconBell size={18} />
        <span className="nc-cluster-icon__dot">{t("shell.notificationsSample")}</span>
      </button>

      <span className="nc-avatar" style={{ width: 38, height: 38, fontSize: 13 }} aria-hidden="true">
        {FOUNDER.initials}
      </span>
      <span className="nc-context__who">
        <span className="nc-context__who-name">{t("shell.founderName")}</span>
        <span className="nc-context__who-role">{t("ctx.roleExecutive")}</span>
      </span>

      <button
        type="button"
        className="nc-context__collapse"
        onClick={toggleRight}
        aria-label={t("ctx.collapse")}
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
  const { t } = useLocale();
  return (
    <div className="nc-context__label">
      {children}
      {count !== undefined && <span className="nc-context__count">{count}</span>}
      {onViewAll && (
        <button type="button" className="nc-context__viewall" onClick={onViewAll}>
          {t("common.viewAll")}
          <IconChevronRight size={12} />
        </button>
      )}
    </div>
  );
}

export function ContextRail() {
  const { snapshot, focus, clearFocus, rightCollapsed, toggleRight, notify } = useCommand();
  const { t, locale, formatTime, formatDate } = useLocale();
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(id);
  }, []);

  if (rightCollapsed) {
    return (
      <aside className="nc-context" aria-label={t("ctx.collapsedAria")}>
        <div className="nc-context__topbar" style={{ justifyContent: "center", padding: "16px 8px" }}>
          <button
            type="button"
            className="nc-context__collapse"
            onClick={toggleRight}
            aria-label={t("ctx.expand")}
            aria-expanded={false}
          >
            <IconPanel size={15} />
          </button>
        </div>
        <div className="nc-context__rail">
          {t("ctx.localContext")}
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
    <aside className="nc-context" data-level={focus ? "department" : "organization"} aria-label={t("ctx.panelAria")}>
      <ContextTopbar />

      <div className="nc-context__body">
        {/* A space is open: the rail re-titles itself, and the level is always
            reversible without hunting for a control. */}
        {focusDepartmentData && focusedVisual ? (
          <div
            className="nc-context__level"
            style={cssVars({ "--nc-accent": `var(${focusDepartmentData.accentVar})` })}
          >
            <span className="nc-context__level-kicker">{t(`dept.${focusDepartmentData.id}.space`)}</span>
            <span className="nc-context__level-name">{t(`dept.${focusDepartmentData.id}.name`)}</span>
            <button type="button" className="nc-context__level-back" onClick={clearFocus}>
              <IconArrowLeft size={12} />
              {t("common.organization")}
            </button>
          </div>
        ) : (
          <div className="nc-clock">
            <span>
              <span className="nc-clock__date" style={{ display: "block" }} suppressHydrationWarning>
                {formatDate(now)}
              </span>
              <span className="nc-clock__time" style={{ display: "block" }} suppressHydrationWarning>
                {formatTime(now)}
              </span>
            </span>
            <span className="nc-clock__zone">{locale === "ar" ? "محلي" : "Local"}</span>
          </div>
        )}

        {focusDepartmentData && focusedVisual ? (
          <DepartmentContext departmentId={focusDepartmentData.id} notify={notify} />
        ) : (
          <OverviewContext />
        )}

        <section className="nc-context__block">
          <p className="nc-context__hint">
            <IconGear size={12} /> {t("ctx.localHint")}
          </p>
        </section>
      </div>
    </aside>
  );
}

/* ── OVERVIEW MODE ─────────────────────────────────────────────────────── */

/**
 * The two answers the panel exists for, before anything else. Neither figure is
 * recomputed here: the decision list is the same approval queue the Decision
 * Center works, and the "moving" rows are the nodes the shell already marks as
 * working — so the panel cannot disagree with the surfaces it links to.
 */
function PriorityContext() {
  const { snapshot } = useCommand();
  const { t, tc } = useLocale();

  const held = snapshot.approvals;
  const moving = DEPARTMENTS.filter((department) => {
    const node = snapshot.visual.departments[department.id];
    return node ? isWorkingStatus(node.status) || node.needsApproval : false;
  });

  return (
    <>
      <section className="nc-context__block">
        <SectionLabel count={held.length}>
          <Link className="nc-context__link" href="/command/decisions">
            {t("cc.needsYourDecision")}
          </Link>
        </SectionLabel>
        {held.length === 0 ? (
          <p className="nc-context__hint">{t("ctx.noneHeld")}</p>
        ) : (
          <div className="nc-project">
            {held.slice(0, 3).map((approval) => {
              const department = DEPARTMENT_BY_ID[approval.department];
              return (
                <Link
                  key={approval.id}
                  className="nc-project__row"
                  href="/command/decisions"
                  style={cssVars({ "--nc-accent": `var(${department?.accentVar ?? "--nc-approval"})` })}
                >
                  <span className="nc-project__mark" aria-hidden="true">
                    <IconSpark size={14} />
                  </span>
                  <span style={{ minWidth: 0 }}>
                    <span className="nc-project__name" style={{ display: "block" }}>
                      {tc(approval.title)}
                    </span>
                    <span className="nc-project__meta" style={{ display: "block" }}>
                      {department ? t(`dept.${department.id}.name`) : t("cc.department")}
                    </span>
                  </span>
                  <span className="nc-project__pct">
                    {t(`status.risk.${approval.risk.toLowerCase() as RiskLevel}`)}
                  </span>
                </Link>
              );
            })}
          </div>
        )}
        <p className="nc-context__hint">{t("ctx.decisionsHint")}</p>
      </section>

      <section className="nc-context__block">
        <SectionLabel count={moving.length}>
          <Link className="nc-context__link" href="/command/missions">
            {t("cc.workInProgress")}
          </Link>
        </SectionLabel>
        {moving.length === 0 ? (
          <p className="nc-context__hint">{t("ctx.noneMoving")}</p>
        ) : (
          <div className="nc-project">
            {moving.slice(0, 4).map((department) => {
              const node = snapshot.visual.departments[department.id];
              const Icon = DEPARTMENT_ICONS[department.id];
              return (
                <Link
                  key={department.id}
                  className="nc-project__row"
                  href={workspaceHref(department.id)}
                  style={cssVars({ "--nc-accent": `var(${department.accentVar})` })}
                >
                  <span className="nc-project__mark" aria-hidden="true">
                    <Icon size={15} />
                  </span>
                  <span style={{ minWidth: 0 }}>
                    <span className="nc-project__name" style={{ display: "block" }}>
                      {t(`dept.${department.id}.name`)}
                    </span>
                    <span className="nc-project__meta" style={{ display: "block" }}>
                      {node?.activeJob ? tc(node.activeJob) : t(`dept.${department.id}.insight`)}
                    </span>
                  </span>
                  <span className="nc-project__pct">{t(`status.node.${node?.status ?? "IDLE"}`)}</span>
                </Link>
              );
            })}
          </div>
        )}
        <p className="nc-context__hint">{t("ctx.workHint")}</p>
      </section>
    </>
  );
}

function OverviewContext() {
  const { notify } = useCommand();
  const { t } = useLocale();

  /* The presence line is composed here, from the counts, so each part resolves
     from the dictionary instead of from English baked into a data module. */
  const { ai, human } = actorCounts(ACTORS);
  const presence = [
    human ? t("ctx.humanCount", { count: human }) : null,
    ai ? t("ctx.aiCount", { count: ai }) : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <>
      {/* Priority first: what needs a human, then what is moving. */}
      <PriorityContext />

      <section className="nc-context__block">
        <SectionLabel
          count={ACTORS.length}
          onViewAll={() => notify(t("ctx.workforceDirectoryToast"))}
        >
          {t("ctx.peopleActors")}
        </SectionLabel>
        <div className="nc-people">
          {ACTORS.map((actor) => (
            <ActorChip key={actor.id} actor={actor} />
          ))}
        </div>
        <button
          type="button"
          className="nc-syslist__connect"
          onClick={() => notify(t("ctx.inviteToast"))}
        >
          <IconPlus size={14} />
          {t("ctx.invitePeople")}
        </button>
        <p className="nc-context__hint">
          {presence} · {t("ctx.inviteHint")}
        </p>
      </section>

      <section className="nc-context__block">
        <SectionLabel count={SYSTEMS.length} onViewAll={() => notify(t("ctx.systemsAreaToast"))}>
          {t("ctx.connectedSystems")}
        </SectionLabel>
        <div className="nc-syslist">
          {SYSTEMS.map((system) => (
            <SystemRow key={system.id} system={system} notify={notify} />
          ))}
        </div>
        <button
          type="button"
          className="nc-syslist__connect"
          onClick={() => notify(t("ctx.addSystemToast"))}
        >
          <IconPlus size={14} />
          {t("ctx.addSystem")}
        </button>
      </section>

      <section className="nc-context__block">
        <SectionLabel onViewAll={() => notify(t("ctx.activityToast"))}>{t("ctx.recentActivity")}</SectionLabel>
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
  const { t } = useLocale();
  const reachedBy = system.linkedDepartments
    .map((id) => t(`dept.${id}.name`))
    .filter(Boolean)
    .join(" · ");

  const body = (
    <>
      <span className="nc-sysrow__mark">{system.mark}</span>
      <span className="nc-sysrow__text">
        <span className="nc-sysrow__name">{system.name}</span>
        <span className="nc-sysrow__meta" title={system.status}>
          <i aria-hidden="true" />
          {systemStateLabel(t, system.statusKind)}
          <span className="nc-sysrow__kind">{system.kind}</span>
        </span>
        {reachedBy && <span className="nc-sysrow__reached">{t("ctx.reachedBy", { names: reachedBy })}</span>}
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
        title={`${system.name} — ${t("ctx.opensExisting")}`}
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
      onClick={() => notify(t("ctx.endpointToast", { name: system.name }))}
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
  const { t, tc } = useLocale();
  const department = DEPARTMENT_BY_ID[departmentId];
  const visual = snapshot.visual.departments[departmentId];
  if (!department || !visual) return null;

  /* The rows this space owns, from the same projection the Active Missions panel
     reads — so the count below is always the number of rows actually shown. */
  const missions = MOCK_PROJECTS.filter((project) => project.department === department.id);

  return (
    <>
      <section className="nc-context__block">
        <SectionLabel>{t("ctx.director")}</SectionLabel>
        <div className="nc-director" style={cssVars({ "--nc-accent": `var(${department.accentVar})` })}>
          <span className="nc-director__mark" aria-hidden="true">
            <IconSpark size={16} />
          </span>
          <span style={{ minWidth: 0 }}>
            <span className="nc-director__name" style={{ display: "block" }}>
              {t(`dept.${department.id}.director`)}
            </span>
            <span className="nc-director__meta" style={{ display: "block" }}>
              {t(`status.node.${visual.status}`)} · {t(`dept.${department.id}.brief`)}
            </span>
          </span>
        </div>
      </section>

      <section className="nc-context__block">
        <SectionLabel count={department.workers.length}>{t("ctx.teams")}</SectionLabel>
        <div className="nc-focus__grid">
          {department.workers.map((worker) => {
            const level = visual.workerActivity?.[worker.id] ?? 0;
            const state = workerState(level);
            return (
              <div key={worker.id} className="nc-worker" data-state={state} data-level={workerLevel(level)}>
                <span className="nc-worker__avatar">{worker.name.slice(0, 2)}</span>
                <span style={{ minWidth: 0 }}>
                  <span className="nc-worker__name" style={{ display: "block" }}>
                    {tc(worker.name)}
                  </span>
                  <span className="nc-project__meta" style={{ display: "block" }}>
                    {tc(worker.role)}
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
        <SectionLabel count={missions.length}>{t("ctx.runningMissions")}</SectionLabel>
        {missions.length === 0 ? (
          <p className="nc-empty">{t("ctx.noMission")}</p>
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
                      {tc(project.name)}
                    </span>
                    <span className="nc-project__meta" style={{ display: "block" }}>
                      {tc(project.meta)}
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
        <SectionLabel>{t("ctx.currentBottleneck")}</SectionLabel>
        <div className="nc-bottleneck">
          <span className="nc-bottleneck__mark" aria-hidden="true" />
          <span style={{ minWidth: 0 }}>
            <span className="nc-bottleneck__title" style={{ display: "block" }}>
              {t(`dept.${department.id}.bottleneck`)}
            </span>
            <span className="nc-bottleneck__meta" style={{ display: "block" }}>
              {visual.activeJob
                ? tc(visual.activeJob)
                : t("ctx.nothingRunning", { space: t(`dept.${department.id}.space`) })}
            </span>
          </span>
        </div>
        <button
          type="button"
          className="nc-context__viewall"
          style={{ marginTop: 10 }}
          onClick={() => notify(t("ctx.openInWorkToast", { name: t(`dept.${department.id}.name`) }))}
        >
          {t("ctx.openInWork")}
          <IconChevronRight size={12} />
        </button>
      </section>
    </>
  );
}
