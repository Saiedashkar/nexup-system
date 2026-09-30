"use client";

import { useState } from "react";
import { useCommand } from "../state/command-store";
import { DEPARTMENTS, DEPARTMENT_BY_ID, type DepartmentId } from "../state/organization-model";
import { isWorkingStatus, needsHumanStatus, type VisualNodeState } from "../state/visual-state";
import { IconArrowLeft, IconChevronRight, IconExpand, IconGraph, IconList, IconMap } from "../ui/icons";
import { ConnectionLayer } from "./connection-layer";
import { DepartmentCard } from "./department-card";
import { DepartmentFocusPanel } from "./department-focus-panel";
import { OrganizationListView, OrganizationMapView } from "./organization-list-view";
import { ExecutiveOrb } from "./executive-orb";

/**
 * LIVING ORGANIZATION — the hero of Phase UI-01.
 *
 * The Executive sits at the centre as the router and the five departments ring
 * it, each on its own lit platform, driven entirely by the visual state
 * snapshot. Idle is genuinely calm; motion appears only when the state says
 * something is actually happening.
 *
 * Contextual zoom is real geometry, not a page swap: cards and the connection
 * layer are percent-anchored in one canvas, so translating and scaling that
 * canvas moves the organization — and its wiring — as a single body. The same
 * transform is what will carry Overview → Department → Team → Agent → Job in
 * later phases.
 */

/** Where a focused department lands inside the stage (percent). */
const FOCAL = { x: 30, y: 52 };
const ZOOM_SCALE = 1.34;

type ViewMode = "graph" | "list" | "map";

const VIEWS: Array<{ id: ViewMode; label: string; Icon: typeof IconGraph }> = [
  { id: "graph", label: "Graph", Icon: IconGraph },
  { id: "list", label: "List", Icon: IconList },
  { id: "map", label: "Map", Icon: IconMap },
];

const LEGEND: Array<{ label: string; color: string }> = [
  { label: "Working", color: "var(--nc-active)" },
  { label: "Thinking", color: "var(--nc-thinking)" },
  { label: "Waiting", color: "var(--nc-waiting)" },
  { label: "Needs you", color: "var(--nc-approval)" },
  { label: "Error", color: "var(--nc-error)" },
];

export function LivingOrganization() {
  const { snapshot, focus, focusDepartment, clearFocus, setExecOpen } = useCommand();
  const { visual } = snapshot;
  const [view, setView] = useState<ViewMode>("graph");

  const focusedDepartment = focus ? DEPARTMENT_BY_ID[focus] : null;
  const focusedVisual = focus ? visual.departments[focus] : null;

  /* Contextual zoom: solve translate/scale so the focused department's anchor
     lands exactly on the focal point. transform-origin is 0 0 (see CSS), which
     makes this plain arithmetic. */
  const transform = focusedDepartment
    ? `translate(${FOCAL.x - ZOOM_SCALE * focusedDepartment.x}%, ${
        FOCAL.y - ZOOM_SCALE * focusedDepartment.y
      }%) scale(${ZOOM_SCALE})`
    : "translate(0%, 0%) scale(1)";

  const isDimmed = (id: DepartmentId) => Boolean(focus) && focus !== id;

  return (
    <section className="nc-section" aria-label="Living organization">
      <div className="nc-section__head">
        <h2 className="nc-section__title">Living Organization</h2>
        <div className="nc-org__crumbs">
          {focusedDepartment ? (
            <>
              <button type="button" className="nc-org__crumb nc-org__crumb--link" onClick={clearFocus}>
                Organization
              </button>
              <IconChevronRight size={12} />
              <span className="nc-org__crumb nc-org__crumb--current">{focusedDepartment.name}</span>
            </>
          ) : (
            <span className="nc-org__crumb nc-org__crumb--current">Organization overview</span>
          )}
        </div>
        <div className="nc-section__spacer" />
        <div className="nc-section__note">
          {focusedDepartment
            ? "Back returns you to the organization overview."
            : view === "graph"
              ? "Click a department to move into it."
              : view === "list"
                ? "The same live state, as rows."
                : "Not built in this phase."}
        </div>
      </div>

      <div className="nc-org">
        <div className="nc-org__head">
          <span className="nc-org__title">Where the work is</span>
          <span className="nc-org__sub">{snapshot.narrative}</span>
          <div className="nc-org__legend">
            {LEGEND.map((item) => (
              <span key={item.label} className="nc-org__legend-item">
                <span className="nc-org__legend-dot" style={{ background: item.color }} />
                {item.label}
              </span>
            ))}
          </div>
        </div>

        {view === "graph" && (
          <div className="nc-org__stage">
            <div
              className="nc-org__canvas"
              style={{
                transform,
                /* Zoomed content must not capture clicks outside the focused card. */
                pointerEvents: focus ? "none" : undefined,
              }}
            >
              <ConnectionLayer visual={visual} />

              <ExecutiveOrb visual={visual.executive} onOpen={() => setExecOpen(true)} />

              {DEPARTMENTS.map((department) => (
                <DepartmentCard
                  key={department.id}
                  department={department}
                  visual={visual.departments[department.id]}
                  dimmed={isDimmed(department.id)}
                  onOpen={focusDepartment}
                />
              ))}
            </div>

            {focusedDepartment && focusedVisual && (
              <>
                <DepartmentFocusPanel
                  department={focusedDepartment}
                  visual={focusedVisual}
                  onBack={clearFocus}
                />
                <button
                  type="button"
                  className="nc-btn"
                  style={{ position: "absolute", left: 14, top: 14, zIndex: 9 }}
                  onClick={clearFocus}
                >
                  <IconArrowLeft size={14} />
                  Back to Organization
                </button>
              </>
            )}
          </div>
        )}

        {view === "list" && <OrganizationListView />}
        {view === "map" && <OrganizationMapView />}

        <div className="nc-org__foot">
          <div className="nc-viewswitch" role="group" aria-label="Organization view">
            {VIEWS.map(({ id, label, Icon }) => (
              <button
                key={id}
                type="button"
                className="nc-viewswitch__btn"
                data-active={view === id}
                aria-pressed={view === id}
                onClick={() => setView(id)}
              >
                <Icon size={14} />
                {label}
              </button>
            ))}
          </div>

          <div className="nc-org__foot-spacer" />

          <span className="nc-section__note">{summarizeLine(visual)}</span>

          <button
            type="button"
            className="nc-context__collapse"
            aria-label="Expand organization view"
            onClick={() => setView("graph")}
          >
            <IconExpand size={14} />
          </button>
        </div>
      </div>
    </section>
  );
}

function summarizeLine(visual: {
  executive: VisualNodeState;
  departments: Record<string, VisualNodeState>;
  handoffs: Array<{ id: string }>;
}): string {
  const nodes = [visual.executive, ...Object.values(visual.departments)];
  const working = nodes.filter((node) => isWorkingStatus(node.status)).length;
  const attention = nodes.filter((node) => node.needsApproval || needsHumanStatus(node.status)).length;
  const idle = nodes.length - working - attention;

  return [
    `${working} node${working === 1 ? "" : "s"} working`,
    `${attention} needing you`,
    `${idle} idle`,
    visual.handoffs.length ? `${visual.handoffs.length} handoff in flight` : "no handoffs",
  ].join(" · ");
}
