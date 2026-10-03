"use client";

import { useState } from "react";
import { useCommand } from "../state/command-store";
import { DEPARTMENT_BY_ID } from "../state/organization-model";
import { isWorkingStatus, needsHumanStatus, type VisualNodeState } from "../state/visual-state";
import { IconGraph, IconList, IconMap } from "../ui/icons";
import { OrganizationListView, OrganizationMapView } from "./organization-list-view";
import { CommandScene } from "../scene/command-scene";
import { RoomIdentity } from "../room-identity";

/**
 * LIVING ORGANIZATION — the room (Phase UI-02.1)
 * ──────────────────────────────────────────────
 * In UI-01.1 this was a bordered box with a header strip ("Where the work is"),
 * a legend, a stage, and a footer with a view switcher — four horizontal bands
 * stacked on a page, which is precisely what made the environment read as a
 * dashboard full of disconnected sections.
 *
 * It is now ONE room with no frame of its own:
 *
 *   · the scene is full-bleed, edge to edge of the working area, and fills the
 *     height it is given (no fixed 530px stage, no scrolling, no clipped dock);
 *   · everything that used to be a band — identity, today's focus, the legend,
 *     the narrative, the view switcher — is an overlay standing IN the room, at
 *     the visual weight of instrumentation rather than of page furniture;
 *   · the List and Map readings still exist, and they still share the same live
 *     snapshot, but they are now clearly a different *reading* of the room rather
 *     than a second section of a page.
 *
 * The spatial scene stays mounted across readings, so switching to List and back
 * never re-runs the entrance transition or resets the camera.
 */

type ViewMode = "graph" | "list" | "map";

const VIEWS: Array<{ id: ViewMode; label: string; Icon: typeof IconGraph }> = [
  { id: "graph", label: "Room", Icon: IconGraph },
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
  const { snapshot, focus } = useCommand();
  const { visual } = snapshot;
  const [view, setView] = useState<ViewMode>("graph");

  const focusedDepartment = focus ? DEPARTMENT_BY_ID[focus] : null;
  const inRoom = view === "graph";
  /* The overlays describe the ROOM, so they stand down in the table readings,
     where the panel's own header does the same job. */
  const overlaid = inRoom;

  return (
    <section
      className="nc-room"
      data-level={focusedDepartment ? "department" : "organization"}
      data-view={view}
      aria-label="Living organization"
    >
      {/* In-room instrumentation. Every one of these used to be a page band. */}
      <div className="nc-room__overlay" data-active={overlaid}>
        <RoomIdentity />

        <div className="nc-room__key">
          <span className="nc-room__key-line">{snapshot.narrative}</span>
          <span className="nc-room__legend" aria-hidden="true">
            {LEGEND.map((item) => (
              <span key={item.label} className="nc-room__legend-item">
                <span className="nc-room__legend-dot" style={{ background: item.color }} />
                {item.label}
              </span>
            ))}
          </span>
        </div>

        <div className="nc-room__controls">
          <span className="nc-room__summary">{summarizeLine(visual)}</span>

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
                <Icon size={13} />
                {label}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="nc-room__stage">
        <div className="nc-room__view" data-active={inRoom}>
          <CommandScene />
        </div>

        {view !== "graph" && (
          <div className="nc-room__panel nc-anim-panel">
            <div className="nc-room__panel-head">
              <h2 className="nc-room__panel-title">Living Organization</h2>
              <span className="nc-room__panel-note">
                {view === "list"
                  ? "The same live state, as rows."
                  : "Not built in this phase — reserved for the organization map."}
              </span>
            </div>
            {view === "list" ? <OrganizationListView /> : <OrganizationMapView />}
          </div>
        )}
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
    `${working} working`,
    `${attention} needing you`,
    `${idle} idle`,
    visual.handoffs.length ? `${visual.handoffs.length} handoff` : "no handoffs",
  ].join(" · ");
}
