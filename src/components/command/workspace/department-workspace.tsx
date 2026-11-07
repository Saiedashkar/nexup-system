"use client";

import { useState, type ComponentType } from "react";
import Link from "next/link";
import { useCommand } from "../state/command-store";
import { DEPARTMENT_BY_ID } from "../state/organization-model";
import {
  WORKSPACE_MODES,
  departmentAttention,
  departmentMissions,
  workspaceFor,
  type WorkspaceModeId,
} from "../state/department-workspace";
import { cssVars } from "../ui/css-vars";
import {
  DEPARTMENT_ICONS,
  IconArrowLeft,
  IconCapabilities,
  IconMap,
  IconSpark,
  IconStack,
  IconSystems,
  IconWarRoom,
  IconWorkforce,
  IconWorkflow,
  IconRun,
  type IconProps,
} from "../ui/icons";
import { useLocale } from "../i18n/command-locale";
import { DepartmentModeBody } from "./workspace-modes";

/**
 * DEPARTMENT WORKSPACE (Phase UI-03)
 * ──────────────────────────────────
 * The reusable shell every department opens into. It owns exactly three
 * decisions — who I am, which mode I am showing, and how I leave — and it
 * renders everything else from configuration.
 *
 * Composition, top to bottom:
 *   1. HEADER      — back to Command, identity, state, purpose, ownership and
 *                    the four facts an operator scans for (missions, attention,
 *                    systems, ownership);
 *   2. EXEC        — a persistent, lightweight Executive control, visually
 *                    consistent with the overview but never dominating;
 *   3. MODES       — the eight internal surfaces (Overview … Systems);
 *   4. BODY        — the current mode, from `workspace-modes.tsx`.
 *
 * Nothing here fetches data, calls an AI or touches a database. All content is
 * mock configuration and the header says so.
 */

const MODE_ICONS: Record<WorkspaceModeId, ComponentType<IconProps>> = {
  overview: IconSpark,
  work: IconRun,
  team: IconWorkforce,
  map: IconMap,
  flow: IconWorkflow,
  capabilities: IconCapabilities,
  memory: IconStack,
  systems: IconSystems,
};

export function DepartmentWorkspace({ departmentId }: { departmentId: string }) {
  const { notify, setExecOpen } = useCommand();
  const { t, tc } = useLocale();
  const [mode, setMode] = useState<WorkspaceModeId>("overview");

  const department = DEPARTMENT_BY_ID[departmentId];
  if (!department) return null;

  const config = workspaceFor(department.id);
  const SpaceIcon = DEPARTMENT_ICONS[department.id];
  /* Department identity is translated from the id, never from the English
     configuration name, so every surface agrees on one Arabic name. */
  const departmentName = t(`dept.${department.id}.name`);
  const departmentSpace = t(`dept.${department.id}.space`);
  /* The same derived count the graph node, the rail, the panel and the KPI use. */
  const activeMissions = departmentMissions(department.id).length;

  return (
    <div
      className="nc-dw"
      style={cssVars({ "--nc-dw-accent": `var(${department.accentVar})` })}
    >
      <header className="nc-dw__head nc-anim-panel">
        <div className="nc-dw__head-top">
          <Link className="nc-dw__back" href="/command">
            <IconArrowLeft size={14} />
            {t("dws.backToCommand")}
          </Link>

          <span className="nc-dw__mark" aria-hidden="true">
            <SpaceIcon size={19} />
          </span>

          <div className="nc-dw__titles">
            <span className="nc-dw__kicker">{t("dws.kicker", { space: departmentSpace })}</span>
            <h1 className="nc-dw__name">{departmentName}</h1>
          </div>

          <span className="nc-dw__state">
            <i aria-hidden="true" />
            {tc(config.state)}
          </span>
        </div>

        <p className="nc-dw__purpose">{tc(config.purpose)}</p>

        <dl className="nc-dw__facts">
          <div className="nc-dw__fact">
            <dt>{t("dws.factOwnership")}</dt>
            <dd>{tc(config.ownership)}</dd>
          </div>
          <div className="nc-dw__fact">
            <dt>{t("dws.factActiveMissions")}</dt>
            <dd>{activeMissions}</dd>
          </div>
          <div className="nc-dw__fact" data-attention={departmentAttention(department.id) > 0}>
            <dt>{t("dws.factAttention")}</dt>
            <dd>{departmentAttention(department.id)}</dd>
          </div>
          <div className="nc-dw__fact">
            <dt>{t("dws.factSystems")}</dt>
            <dd>{config.systems.length}</dd>
          </div>
        </dl>
      </header>

      {/* Persistent Executive control. The full console lives in the shell (⌘K);
          these are the department-scoped entry points to it. */}
      <div className="nc-dw__exec" role="group" aria-label={t("dws.execGroupAria")}>
        <span className="nc-dw__exec-lead">
          <span className="nc-dw__exec-orb" aria-hidden="true" />
          <span className="nc-dw__exec-label">EXEC</span>
        </span>

        <button type="button" className="nc-dw__exec-btn nc-dw__exec-btn--primary" onClick={() => setExecOpen(true)}>
          {t("dws.askExec")}
        </button>
        <button
          type="button"
          className="nc-dw__exec-btn"
          onClick={() => notify(t("dws.giveCommandToast", { name: departmentName }))}
        >
          {t("dws.giveCommand")}
        </button>
        <button
          type="button"
          className="nc-dw__exec-btn"
          onClick={() => notify(t("dws.escalateToast", { name: departmentName }))}
        >
          {t("dws.escalate")}
        </button>
        <button
          type="button"
          className="nc-dw__exec-btn nc-dw__exec-btn--soon"
          onClick={() => notify(t("dws.warRoomToast"))}
        >
          <IconWarRoom size={14} />
          {t("dws.warRoom")}
        </button>

        <span className="nc-dw__exec-note">{t("dws.execNote")}</span>
      </div>

      <nav className="nc-dw__modes" aria-label={t("dws.modesAria", { name: departmentName })}>
        {WORKSPACE_MODES.map((item) => {
          const ModeIcon = MODE_ICONS[item.id];
          const current = item.id === mode;
          return (
            <button
              key={item.id}
              type="button"
              className="nc-dw__mode"
              data-current={current}
              aria-pressed={current}
              title={tc(item.hint)}
              onClick={() => setMode(item.id)}
            >
              <ModeIcon size={15} />
              {tc(item.label)}
            </button>
          );
        })}
      </nav>

      <div className="nc-dw__body">
        <div className="nc-dw__modehead">
          <span className="nc-dw__modehead-title">
            {tc(WORKSPACE_MODES.find((item) => item.id === mode)?.label ?? "")}
          </span>
          <span className="nc-dw__modehead-hint">
            {tc(WORKSPACE_MODES.find((item) => item.id === mode)?.hint ?? "")}
          </span>
        </div>

        <DepartmentModeBody mode={mode} config={config} departmentName={departmentName} />
      </div>
    </div>
  );
}
