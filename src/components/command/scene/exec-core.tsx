"use client";

import { EXECUTIVE } from "../state/organization-model";
import type { Placement } from "../state/spatial-camera";
import { EXEC_ACTOR } from "../state/actors";
import { IconAgent } from "../ui/icons";
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
 * So the body is now an INSTRUMENT rather than an orb. It is assembled the way
 * a piece of equipment is assembled, in four layers the eye can separate:
 *
 *   · the DECK      — the lit concentric platform the core stands on. This is
 *     what grounds it in the room and ties it to the departments' floors, which
 *     sit on the same plane;
 *   · the GANTRY    — two slim pillars and a top arc: the frame the instrument
 *     hangs in. Nothing in a dashboard has a frame;
 *   · the BODY      — a machined optical housing: a dark dome, an equatorial
 *     band with cut tick marks, a dark lower housing. Geometry, not glow;
 *   · the APERTURE  — a recessed dark chamber with iris blades and a SMALL lime
 *     intelligence source inside it. The only saturated object in the scene,
 *     and it is roughly a seventh of the core's width, because the material
 *     around it is what has to look expensive.
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
      {/* The platform. Concentric rings on the floor plane, plus tick marks, so
          the core reads as standing IN the room rather than floating in it. */}
      <span className="nc-core__deck" aria-hidden="true">
        <span className="nc-core__deck-ring" data-ring="outer" />
        <span className="nc-core__deck-ring" data-ring="mid" />
        <span className="nc-core__deck-ring" data-ring="inner" />
      </span>

      {/* The frame. Two pillars and an arc: the instrument is mounted, the way
          real equipment is, and the silhouette stops being a circle. */}
      <span className="nc-core__gantry" aria-hidden="true">
        <span className="nc-core__pillar" data-side="left" />
        <span className="nc-core__pillar" data-side="right" />
        <span className="nc-core__gantry-arc" />
      </span>

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

      <span className="nc-core__body" aria-hidden="true">
        <span className="nc-core__casing" />
        <span className="nc-core__band" />
        <span className="nc-core__housing" />
        <span className="nc-core__vent" data-side="left" />
        <span className="nc-core__vent" data-side="right" />

        <span className="nc-core__lens">
          <span className="nc-core__iris" />
          <span className="nc-core__energy" data-energy={busy ? "live" : "rest"} />
        </span>

        <span className="nc-core__mark">
          <IconAgent size={13} />
        </span>
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
