"use client";

import { useState } from "react";
import { useCommand } from "../state/command-store";
import { DEPARTMENT_BY_ID } from "../state/organization-model";
import {
  IconChevronDown,
  IconGraph,
  IconList,
  IconMap,
  IconPanel,
  IconWorkflow,
} from "../ui/icons";
import { OrganizationListView, OrganizationMapView } from "./organization-list-view";
import { CommandScene } from "../scene/command-scene";
import { CommandHeader, CommandKpis, CommandMissionsPanels } from "./command-center";

/**
 * LIVING ORGANIZATION — the command center (visual-direction pass)
 * ──────────────────────────────────────────────────────────────
 * The room used to be the whole screen, with its instrumentation floating inside
 * it. The approved direction is a calm, spacious operating surface, so the page
 * now composes in reading order:
 *
 *   · a HEADING BAND with the atlas behind it;
 *   · a row of live FIGURES;
 *   · a quiet TOOLBAR (the Graph / List / Map readings, plus the live filters);
 *   · the GRAPH itself — the spatial organization, now a defined panel rather
 *     than a full-bleed void;
 *   · two OPERATIVE TABLES: active missions and the decision queue.
 *
 * Everything is derived from the same live snapshot as before, so the spatial
 * scene, the list, the rail and the tables can never disagree. The scene stays
 * mounted across readings, so switching to List and back never re-runs the
 * entrance transition or resets the camera.
 */

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
  const { focus, notify } = useCommand();
  const [view, setView] = useState<ViewMode>("graph");

  const focusedDepartment = focus ? DEPARTMENT_BY_ID[focus] : null;
  const inRoom = view === "graph";

  return (
    <section
      className="nc-room"
      data-level={focusedDepartment ? "department" : "organization"}
      data-view={view}
      aria-label="Living organization"
    >
      <CommandHeader />
      <CommandKpis />

      <div className="nc-cc-toolbar">
        <div className="nc-cc-tabs" role="group" aria-label="Organization view">
          {VIEWS.map(({ id, label, Icon }) => (
            <button
              key={id}
              type="button"
              className="nc-cc-tab"
              data-active={view === id}
              aria-pressed={view === id}
              onClick={() => setView(id)}
            >
              <Icon size={14} />
              {label}
            </button>
          ))}
        </div>

        <div className="nc-cc-tools">
          <button
            type="button"
            className="nc-cc-tool"
            onClick={() => notify("Local view follows the running scenario — visual only in this phase.")}
          >
            <span className="nc-cc-tool__dot" aria-hidden="true" />
            Local View
            <IconChevronDown size={13} />
          </button>
          <button
            type="button"
            className="nc-cc-tool"
            onClick={() => notify("Mission routing follows the running scenario on the graph — visual only in this phase.")}
          >
            <IconWorkflow size={14} />
            Mission Routing
          </button>
          <button
            type="button"
            className="nc-cc-tool"
            onClick={() => notify("Filters arrive with the Work area.")}
          >
            <IconPanel size={14} />
            Filter
          </button>
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
                  ? "The same organization state, as rows."
                  : "Not built in this phase — reserved for the organization map."}
              </span>
            </div>
            {view === "list" ? <OrganizationListView /> : <OrganizationMapView />}
          </div>
        )}

        {/* The one piece of in-room instrumentation that still belongs on the
            panel rather than in a band: what the colours mean. */}
        <div className="nc-room__overlay" data-active={inRoom}>
          <div className="nc-room__key">
            <span className="nc-room__legend" aria-hidden="true">
              {LEGEND.map((item) => (
                <span key={item.label} className="nc-room__legend-item">
                  <span className="nc-room__legend-dot" style={{ background: item.color }} />
                  {item.label}
                </span>
              ))}
            </span>
          </div>
        </div>
      </div>

      <CommandMissionsPanels />
    </section>
  );
}
