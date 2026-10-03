"use client";

import { useCommand } from "../state/command-store";
import {
  WORKSPACE_MODES,
  systemsForDepartment,
  type Department,
  type DepartmentId,
} from "../state/organization-model";
import type { Placement } from "../state/spatial-camera";
import { cssVars } from "../ui/css-vars";
import { DECK_ICONS, DEPARTMENT_ICONS, IconChevronRight } from "../ui/icons";
import { ActorCluster, ActorList } from "./actor-presence";
import { STATUS_LABEL, needsHumanStatus, workerLevel, type VisualNodeState } from "../state/visual-state";

/**
 * DEPARTMENT POD — an operational bay, and then a workspace (Phase UI-02.1)
 * ────────────────────────────────────────────────────────────────────────
 * UI-01.1's department was a rounded rectangle with an icon tile and a progress
 * meter. UI-02.1's first pass chamfered it and added a lit floor — better, but
 * the reviewer still read five rectangles arranged around an orb, and that was
 * the correct reading, because the *content* was still "a card with information
 * inside it".
 *
 * The rest state is now built as a BAY. Four architectural layers, in order:
 *
 *   · FLOOR   — the lit platform it stands on, on the same plane as the core's deck;
 *   · BAY     — a rear slab, offset back and up, which is what stops the pod's
 *     silhouette from being one rectangle: the structure continues past the
 *     surface you read;
 *   · STRUT   — the leg that physically connects the surface to the floor, so
 *     the surface is *supported* rather than floating;
 *   · SURFACE — the readable console. Its top edge (the "ledge") runs wider than
 *     the surface itself and its material dissolves at the bottom, so it ends in
 *     architecture rather than in a border.
 *
 * Each bay also faces the centre of the room by a few degrees, derived from its
 * own position — one shared rule, no per-department styling — which is what
 * gives the ring its perspective.
 *
 * The ENTERED state is not a bigger card. It is a different object: a workspace
 * with an internal mode rail (Work · Map · Flow · Assets — three of them marked
 * as later phases, because the point of this phase is to make the scene
 * *capable* of hosting them), a live work surface, the space's signals, and the
 * systems this space reaches. It reads as walking into the department.
 *
 * Nothing in this file knows what "Growth" is. It renders whatever the
 * configuration describes, so a sixth department renders identically.
 */

export type PodSignals = {
  missions: number;
  activeActors: number;
  attention: number;
};

type DepartmentPodProps = {
  department: Department;
  visual: VisualNodeState;
  /** Resolved position + depth, in percent of the stage and px. From the camera. */
  placement: Placement;
  /** This space is entered: everything else recedes and dims. */
  focused: boolean;
  /** Another space is entered. */
  receded: boolean;
  hovered: boolean;
  /** Signals shown while hovered or entered. */
  signals: PodSignals;
  onHover: (id: DepartmentId | null) => void;
  onOpen: (id: DepartmentId) => void;
};

export function DepartmentPod({
  department,
  visual,
  placement,
  focused,
  receded,
  hovered,
  signals,
  onHover,
  onOpen,
}: DepartmentPodProps) {
  const { status, activityLevel, activeJob, needsApproval } = visual;

  /* One insight only. Live work always wins over the configured headline,
     because "what is happening now" is the more useful truth. */
  const insight = activeJob ?? department.insight;
  const insightIsLive = Boolean(activeJob);

  const attention = needsApproval || needsHumanStatus(status) ? 1 : 0;
  const reveal = hovered || focused;

  /* Bays face the centre of the room. Derived from configuration, applied as one
     rule: a space left of centre turns right, a space right of centre turns
     left. Nothing else about a pod is position-aware. */
  const face = (50 - department.x) * 0.22;

  return (
    <div
      className="nc-pod"
      data-status={status}
      data-depth={placement.depth > 0 ? "near" : "far"}
      data-dim={receded}
      data-focused={focused}
      data-hovered={hovered}
      style={cssVars({
        "--nc-pod-x": `${placement.x.toFixed(3)}%`,
        "--nc-pod-y": `${placement.y.toFixed(3)}%`,
        "--nc-pod-z": `${placement.depth}px`,
        "--nc-pod-face": `${face.toFixed(2)}deg`,
        "--nc-accent": `var(${department.accentVar})`,
      })}
      /* Hover is scene state, not per-pod: moving the pointer across the room
         must light exactly one space and dim exactly the rest. */
      onPointerEnter={() => onHover(department.id)}
      onPointerLeave={() => onHover(null)}
    >
      <span className="nc-pod__floor" aria-hidden="true" />
      <span className="nc-pod__bay" aria-hidden="true" />
      <span className="nc-pod__strut" aria-hidden="true" />

      {focused ? (
        <Workspace department={department} visual={visual} signals={signals} attention={attention} insight={insight} />
      ) : (
        <>
          <button
            type="button"
            className="nc-pod__plate"
            onClick={() => onOpen(department.id)}
            aria-label={`${department.name} — ${STATUS_LABEL[status]}${
              insight ? `. ${insight}` : ""
            }${attention ? ". Needs you." : ""}. Enter this space.`}
          >
            <span className="nc-pod__spine" aria-hidden="true" />
            <span className="nc-pod__ledge" aria-hidden="true" />

            <span className="nc-pod__kicker">{department.space}</span>

            <span className="nc-pod__head">
              <span className="nc-pod__name">{department.name}</span>
              <span className="nc-pod__state">
                <span className="nc-pod__led" aria-hidden="true" />
                {STATUS_LABEL[status]}
              </span>
            </span>

            <span className="nc-pod__insight" data-live={insightIsLive}>
              {insight}
            </span>

            <span className="nc-pod__foot">
              <ActorCluster ids={department.presence} />
              <span className="nc-pod__enter">
                Enter space
                <IconChevronRight size={13} />
              </span>
            </span>

            <span className="nc-pod__meter" aria-hidden="true">
              <i style={{ width: `${Math.round(activityLevel * 100)}%` }} />
            </span>
          </button>

          {/* The console lip: three machined readout slots that continue the
              surface past its own edge. */}
          <span className="nc-pod__rib" aria-hidden="true">
            <i />
            <i />
            <i />
          </span>
        </>
      )}

      {/* Exactly three signals — never four. */}
      <div className="nc-pod__signals" data-reveal={reveal} aria-hidden={!reveal}>
        <span className="nc-pod__signal">
          <span className="nc-pod__signal-key">Missions</span>
          <span className="nc-pod__signal-val">{signals.missions}</span>
        </span>
        <span className="nc-pod__signal">
          <span className="nc-pod__signal-key">Active actors</span>
          <span className="nc-pod__signal-val">{signals.activeActors}</span>
        </span>
        <span className="nc-pod__signal" data-attention={attention > 0}>
          <span className="nc-pod__signal-key">Attention</span>
          <span className="nc-pod__signal-val">{attention > 0 ? "Needs you" : "Clear"}</span>
        </span>
      </div>
    </div>
  );
}

/**
 * The entered state. Not a panel: a workspace with rooms in it, one of which is
 * live now and three of which are reserved for later phases. The live surface is
 * assembled entirely from state the environment already has — the visual
 * contract, the worker list, the mission count and the systems this space
 * reaches — so nothing here needs a business layer to exist.
 */
function Workspace({
  department,
  visual,
  signals,
  attention,
  insight,
}: {
  department: Department;
  visual: VisualNodeState;
  signals: PodSignals;
  attention: number;
  insight: string;
}) {
  const { notify } = useCommand();
  const SpaceIcon = DEPARTMENT_ICONS[department.id];
  const linked = systemsForDepartment(department.id);

  return (
    <div className="nc-ws">
      <header className="nc-ws__head">
        <span className="nc-ws__mark" aria-hidden="true">
          <SpaceIcon size={16} />
        </span>
        <span className="nc-ws__titles">
          <span className="nc-ws__kicker">{department.space}</span>
          <span className="nc-ws__name">{department.name}</span>
        </span>
        <span className="nc-ws__state">
          <span className="nc-ws__led" aria-hidden="true" />
          {STATUS_LABEL[visual.status]}
        </span>
        <span className="nc-ws__meter" aria-hidden="true">
          <i style={{ width: `${Math.round(visual.activityLevel * 100)}%` }} />
        </span>
      </header>

      {/* The internal mode rail. Work is live; the rest are the slots this
          workspace is built to host. */}
      <nav className="nc-ws__modes" aria-label={`${department.name} internal surfaces`}>
        {WORKSPACE_MODES.map((mode) => {
          const ModeIcon = DECK_ICONS[mode.icon];
          const current = mode.id === "work";
          return (
            <button
              key={mode.id}
              type="button"
              className="nc-ws__mode"
              data-current={current}
              onClick={() => (current ? notify(`${mode.hint}.`) : notify(`${mode.label} inside ${department.name}: ${mode.hint}`))}
            >
              <ModeIcon size={14} />
              {mode.label}
            </button>
          );
        })}
      </nav>

      <div className="nc-ws__surface">
        <section className="nc-ws__panel" data-panel="work">
          <span className="nc-ws__panel-kicker">Live work</span>
          <span className="nc-ws__job" data-live={Boolean(visual.activeJob)}>
            {insight}
          </span>
          <span className="nc-ws__workers">
            {department.workers.map((worker) => {
              const level = visual.workerActivity?.[worker.id] ?? 0;
              return (
                <span key={worker.id} className="nc-ws__worker" data-level={workerLevel(level)}>
                  <span className="nc-ws__worker-name">{worker.name}</span>
                  <span className="nc-ws__worker-meter" aria-hidden="true">
                    <i style={{ width: `${Math.round(level * 100)}%` }} />
                  </span>
                </span>
              );
            })}
          </span>
        </section>

        <section className="nc-ws__panel" data-panel="signals">
          <span className="nc-ws__panel-kicker">Signals</span>
          <span className="nc-ws__figure">
            <b>{signals.missions}</b>
            <span>Missions</span>
          </span>
          <span className="nc-ws__figure">
            <b>{signals.activeActors}</b>
            <span>Active actors</span>
          </span>
          <span className="nc-ws__figure" data-attention={attention > 0}>
            <b>{attention > 0 ? "Needs you" : "Clear"}</b>
            <span>Attention</span>
          </span>
        </section>

        <section className="nc-ws__panel" data-panel="reaches">
          <span className="nc-ws__panel-kicker">Reaches</span>
          {linked.length === 0 ? (
            <span className="nc-ws__none">No system is wired to this space yet.</span>
          ) : (
            linked.map((system) => (
              <button
                key={system.id}
                type="button"
                className="nc-ws__system"
                style={cssVars({ "--nc-accent": `var(${system.accentVar})` })}
                onClick={() =>
                  notify(`${system.name} — ${system.kind}. Visual only in this phase; nothing is connected.`)
                }
                title={`${system.name} — ${system.capabilities.join(" · ")}`}
              >
                <span className="nc-ws__system-mark">{system.mark}</span>
                <span className="nc-ws__system-name">{system.name}</span>
                <span className="nc-ws__system-status">
                  <i aria-hidden="true" />
                  {system.status}
                </span>
              </button>
            ))
          )}
          <span className="nc-ws__bottleneck">
            <span className="nc-ws__bottleneck-mark" aria-hidden="true" />
            {department.bottleneck}
          </span>
        </section>
      </div>

      <footer className="nc-ws__foot">
        <ActorList ids={department.presence} max={2} />
        <span className="nc-ws__capability">{department.capability}</span>
      </footer>
    </div>
  );
}
