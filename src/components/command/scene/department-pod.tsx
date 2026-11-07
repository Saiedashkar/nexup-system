"use client";

import { useLocale } from "../i18n/command-locale";
import { DEPARTMENTS, type Department, type DepartmentId } from "../state/organization-model";
import type { Placement } from "../state/spatial-camera";
import { cssVars } from "../ui/css-vars";
import { DEPARTMENT_ICONS } from "../ui/icons";
import type { VisualNodeState } from "../state/visual-state";

/**
 * DEPARTMENT PLATE — one space in the company overview (champagne orbit)
 * ──────────────────────────────────────────────────────────────────────
 * The approved overview states a department the same way six times: a wide
 * smoked-glass lozenge, the identity disc on the INNER edge (facing EXEC), the
 * readable name, and ONE status. That is exactly what this renders, and nothing else:
 *
 *     [ disc ]  name  D1
 *               ● working
 *
 * WHAT THE PREVIOUS PASS HAD, AND WHY IT IS GONE
 * A badge, an uppercase code, a name and a status — close, but assembled as a
 * stacked card with the disc above the type, and with the identity disc carrying
 * the department's own hue. Two changes and no more: the disc moved beside the
 * type (the reference's plate is a lozenge, not a card) and the STATUS DOT now
 * reads the runtime status rather than the identity accent, so six plates in one
 * warm family still say what each space is actually doing. The horseshoe of
 * `face` rotation is gone with it: the approved plates face the reader flat.
 *
 * SELECTION, NOT NAVIGATION — unchanged. Clicking a plate SELECTS it: the store's
 * focus moves, the panel on the right becomes that space's panel, and the reader
 * stays in the composition. Opening the workspace is a deliberate second step
 * from the panel. The plate is therefore a toggle (`aria-pressed`), not a link —
 * a link would promise a navigation it does not perform.
 *
 * DOM ORDER IS READING ORDER ON BOTH SIDES. Plates left of centre put their disc
 * on their RIGHT and plates right of centre on their LEFT — but that is done in
 * CSS with a direction-aware `flex-direction`, so the mark is always FIRST in
 * the document and the accessible name always begins with the icon's meaning.
 * The `data-side` attribute carries the geometry; it changes no reading.
 */

type DepartmentPodProps = {
  department: Department;
  visual: VisualNodeState;
  /** Resolved position + depth, in percent of the stage and px. From the camera. */
  placement: Placement;
  /** This space is selected: the panel is reading it. */
  selected: boolean;
  /** Another space is selected. */
  receded: boolean;
  hovered: boolean;
  onHover: (id: DepartmentId | null) => void;
  onSelect: (id: DepartmentId) => void;
};

export function DepartmentPod({
  department,
  visual,
  placement,
  selected,
  receded,
  hovered,
  onHover,
  onSelect,
}: DepartmentPodProps) {
  const { status } = visual;
  const { t } = useLocale();
  const Icon = DEPARTMENT_ICONS[department.id];

  /* The side of the plate the disc sits on, and the side the network docks to:
     both are "away from the centre", and both are derived from the same
     configuration coordinate the router uses. Nothing else about a node is
     position-aware. */
  const side = department.x < 50 ? "left" : "right";

  /* The node's index in the organization — a stable identity code (D1…Dn) for
     the hierarchy, derived from configuration order, never invented content. */
  const code = `D${DEPARTMENTS.findIndex((entry) => entry.id === department.id) + 1}`;

  const name = t(`dept.${department.id}.name`);
  const statusLabel = t(`status.node.${status}`);

  return (
    <div
      className="nc-pod"
      data-department={department.id}
      data-status={status}
      data-side={side}
      data-depth={placement.depth > 0 ? "near" : "far"}
      data-dim={receded}
      data-selected={selected}
      data-hovered={hovered}
      style={cssVars({
        "--nc-pod-x": `${placement.x.toFixed(3)}%`,
        "--nc-pod-y": `${placement.y.toFixed(3)}%`,
        "--nc-pod-z": `${placement.depth}px`,
        "--nc-accent": `var(${department.accentVar})`,
      })}
      /* Hover is scene state, not per-node: moving the pointer across the
         composition must light exactly one space and quiet exactly the rest. */
      onPointerEnter={() => onHover(department.id)}
      onPointerLeave={() => onHover(null)}
    >
      {/* The network port: the physical place the routing field docks, on the
          edge facing the centre. One element, one side, both derived — it is what
          stops a plate reading as a card that merely sits near some lines. */}
      <span className="nc-pod__port" data-side={side} aria-hidden="true" />

      <button
        type="button"
        className="nc-pod__plate"
        onClick={() => onSelect(department.id)}
        aria-pressed={selected}
        aria-label={`${name} — ${statusLabel}. ${
          selected ? t("cc.selectedAria") : t("cc.selectAria")
        }`}
      >
        {/* The identity disc. Deliberately a dedicated element with a single
            icon slot, so the Agent Identity System can swap in an avatar here
            without touching structure or this file's geometry. */}
        <span className="nc-pod__badge" aria-hidden="true">
          <Icon size={19} />
        </span>

        <span className="nc-pod__head">
          <span className="nc-pod__namerow">
            {/* The full readable name — never an abbreviation, never clamped by
                a neighbouring figure, because there is no neighbouring figure. */}
            <span className="nc-pod__name">{name}</span>
            <span className="nc-pod__code" aria-hidden="true">
              {code}
            </span>
          </span>

          {/* ONE meaningful status. The dot carries the colour, the word carries
              the meaning, so the colour is never the only channel. */}
          <span className="nc-pod__state">
            <span className="nc-pod__led" aria-hidden="true" />
            <span className="nc-pod__state-label">{statusLabel}</span>
          </span>
        </span>
      </button>
    </div>
  );
}
