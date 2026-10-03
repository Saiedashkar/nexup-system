"use client";

import { useState, type ComponentType } from "react";
import Link from "next/link";
import { useCommand } from "../state/command-store";
import { DEPARTMENT_BY_ID } from "../state/organization-model";
import {
  WORKSPACE_MODES,
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
  const [mode, setMode] = useState<WorkspaceModeId>("overview");

  const department = DEPARTMENT_BY_ID[departmentId];
  if (!department) return null;

  const config = workspaceFor(department.id);
  const SpaceIcon = DEPARTMENT_ICONS[department.id];
  const activeMissions = config.missions.filter((mission) => mission.kind === "mission").length;

  return (
    <div
      className="nc-dw"
      style={cssVars({ "--nc-dw-accent": `var(${department.accentVar})` })}
    >
      <header className="nc-dw__head nc-anim-panel">
        <div className="nc-dw__head-top">
          <Link className="nc-dw__back" href="/command">
            <IconArrowLeft size={14} />
            Command
          </Link>

          <span className="nc-dw__mark" aria-hidden="true">
            <SpaceIcon size={19} />
          </span>

          <div className="nc-dw__titles">
            <span className="nc-dw__kicker">{department.space} · Department workspace</span>
            <h1 className="nc-dw__name">{department.name}</h1>
          </div>

          <span className="nc-dw__state">
            <i aria-hidden="true" />
            {config.state}
          </span>
        </div>

        <p className="nc-dw__purpose">{config.purpose}</p>

        <dl className="nc-dw__facts">
          <div className="nc-dw__fact">
            <dt>Ownership</dt>
            <dd>{config.ownership}</dd>
          </div>
          <div className="nc-dw__fact">
            <dt>Active missions</dt>
            <dd>{activeMissions}</dd>
          </div>
          <div className="nc-dw__fact" data-attention={config.attention.length > 0}>
            <dt>Needs attention</dt>
            <dd>{config.attention.length}</dd>
          </div>
          <div className="nc-dw__fact">
            <dt>Connected systems</dt>
            <dd>{config.systems.length}</dd>
          </div>
        </dl>
      </header>

      {/* Persistent Executive control. The full console lives in the shell (⌘K);
          these are the department-scoped entry points to it. */}
      <div className="nc-dw__exec" role="group" aria-label="Executive controls">
        <span className="nc-dw__exec-lead">
          <span className="nc-dw__exec-orb" aria-hidden="true" />
          <span className="nc-dw__exec-label">EXEC</span>
        </span>

        <button type="button" className="nc-dw__exec-btn nc-dw__exec-btn--primary" onClick={() => setExecOpen(true)}>
          Ask EXEC
        </button>
        <button
          type="button"
          className="nc-dw__exec-btn"
          onClick={() => notify(`Direct ${department.name}: the Executive takes a command in a later phase.`)}
        >
          Give command
        </button>
        <button
          type="button"
          className="nc-dw__exec-btn"
          onClick={() => notify(`Escalation from ${department.name} — routing arrives with the Executive console.`)}
        >
          Escalate
        </button>
        <button
          type="button"
          className="nc-dw__exec-btn nc-dw__exec-btn--soon"
          onClick={() => notify("War Room is a later phase — the department workspace keeps the slot.")}
        >
          <IconWarRoom size={14} />
          War Room
        </button>

        <span className="nc-dw__exec-note">No AI provider · mock content</span>
      </div>

      <nav className="nc-dw__modes" aria-label={`${department.name} workspace modes`}>
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
              title={item.hint}
              onClick={() => setMode(item.id)}
            >
              <ModeIcon size={15} />
              {item.label}
            </button>
          );
        })}
      </nav>

      <div className="nc-dw__body">
        <div className="nc-dw__modehead">
          <span className="nc-dw__modehead-title">
            {WORKSPACE_MODES.find((item) => item.id === mode)?.label}
          </span>
          <span className="nc-dw__modehead-hint">
            {WORKSPACE_MODES.find((item) => item.id === mode)?.hint}
          </span>
        </div>

        <DepartmentModeBody mode={mode} config={config} departmentName={department.name} />
      </div>
    </div>
  );
}
