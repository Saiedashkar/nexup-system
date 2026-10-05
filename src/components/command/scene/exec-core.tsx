"use client";

import { EXECUTIVE } from "../state/organization-model";
import type { Placement } from "../state/spatial-camera";
import { EXEC_ACTOR } from "../state/actors";
import { cssVars } from "../ui/css-vars";
import { EXEC_PHASE_LABEL, STATUS_LABEL, execPhase, type VisualNodeState } from "../state/visual-state";

/**
 * EXEC CORE — the Intelligence Core (Phase UI-02.1)
 * ─────────────────────────────────────────────────
 * In UI-01.1 the Executive was a glowing lime circle, and the first pass of
 * UI-02.1 turned it into a layered sphere. Both read as *avatars*: the first
 * because it was a circle, the second because a glowing ball is the most
 * generic object in this whole visual language.
 *
 * The approved direction calls for calm, premium central intelligence — not a
 * glowing green gaming orb. So the body is now a GLOBE: a soft lit sphere with
 * an internal atmosphere, wrapped in three orbiting rings that turn only while
 * the core is actually working. Its identity sits beneath it, and its readout is
 * a quiet plate rather than a floating pill.
 *
 * The sphere is deliberately a single, replaceable slot (`.nc-core__globe`):
 * when the Agent Identity System lands, EXEC can carry a real character/avatar
 * at the centre without any structural change here.
 *
 * The state contract is untouched: it still receives one `VisualNodeState`, the
 * nine runtime states still collapse into four phases, and it is still a real
 * control that opens the Executive console. Status is no longer a pill floating
 * under the object — it is a readout plate attached to the housing, which is
 * where a status light belongs on a machine.
 *
 * The rings live here rather than in the wiring layer because they belong to the
 * core's own volume — they are its physical scale, not a connection.
 */
export function ExecCore({
  visual,
  placement,
  onOpen,
}: {
  visual: VisualNodeState;
  /** Where the core stands right now — the camera relocates it when a space is entered. */
  placement: Placement;
  onOpen: () => void;
}) {
  const phase = execPhase(visual.status);
  const busy = phase === "thinking" || phase === "running";

  return (
    <button
      type="button"
      className="nc-core"
      data-phase={phase}
      data-status={visual.status}
      style={cssVars({
        "--nc-core-x": `${placement.x.toFixed(3)}%`,
        "--nc-core-y": `${placement.y.toFixed(3)}%`,
        "--nc-core-z": `${placement.depth}px`,
      })}
      onClick={onOpen}
      title={visual.activeJob ?? undefined}
      aria-label={`${EXECUTIVE.label} — ${EXEC_PHASE_LABEL[phase]}. Runtime state ${STATUS_LABEL[visual.status]}${
        visual.activeJob ? `. ${visual.activeJob}` : ""
      }. ${EXECUTIVE.level}. Open the Executive console.`}
    >
      {/* Rings are part of the core's volume: they tilt with the camera and only
          turn while the core is actually working. */}
      <span className="nc-core__rings" aria-hidden="true">
        <svg viewBox="0 0 200 200" width="100%" height="100%">
          <ellipse className={`nc-core__ring${busy ? " nc-core__ring--live" : ""}`} cx="100" cy="100" rx="92" ry="26" />
          <ellipse
            className={`nc-core__ring${busy ? " nc-core__ring--live" : ""}`}
            cx="100"
            cy="100"
            rx="72"
            ry="42"
            data-tilt="back"
          />
          <ellipse
            className={`nc-core__ring${busy ? " nc-core__ring--live nc-core__ring--spin" : ""}`}
            cx="100"
            cy="100"
            rx="50"
            ry="58"
            data-tilt="front"
          />
        </svg>
      </span>

      {/* A second, oblique orbit. The equatorial rings are the core's own gauge;
          this one crosses them, which is what gives a globe "orbit" instead of
          "gauge". Static on purpose — only the equatorial band turns. */}
      <span className="nc-core__orbit" aria-hidden="true">
        <svg viewBox="0 0 200 200" width="100%" height="100%">
          <ellipse className="nc-core__orbit-ring" cx="100" cy="100" rx="88" ry="34" />
        </svg>
      </span>

      {/* The atmosphere: an outer halo that seats the sphere in the room and
          gives the centre a light source of its own. */}
      <span className="nc-core__halo" aria-hidden="true" />

      {/* The body: a calm, intelligent sphere. Deliberately NOT a gamer orb —
          a soft lit globe whose inner atmosphere is the only saturated thing in
          the scene. The structure leaves room for a future character/avatar
          identity to sit at its centre without a rebuild: `.nc-core__nucleus`
          is that slot, and it is hidden behind the identity until an avatar
          exists. */}
      <span className="nc-core__body" aria-hidden="true">
        <span className="nc-core__globe" />
        <span className="nc-core__grid" />
        <span className="nc-core__nucleus" />
      </span>

      {/* Integrated readout: the machine states its own condition, on itself. */}
      <span className="nc-core__readout">
        <span className="nc-core__readout-led" aria-hidden="true" />
        <span className="nc-core__readout-state">{EXEC_PHASE_LABEL[phase]}</span>
        <span className="nc-core__readout-sep" aria-hidden="true" />
        <span className="nc-core__readout-level">{EXECUTIVE.level}</span>
      </span>

      <span className="nc-core__identity">
        <span className="nc-core__title">{EXEC_ACTOR.name}</span>
        <span className="nc-core__role">{EXECUTIVE.kicker}</span>
      </span>
    </button>
  );
}
