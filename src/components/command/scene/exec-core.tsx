"use client";

import { useState } from "react";
import Link from "next/link";
import { useLocale } from "../i18n/command-locale";
import type { Placement } from "../state/spatial-camera";
import { cssVars } from "../ui/css-vars";
import { execPhase, type VisualNodeState } from "../state/visual-state";
import {
  EXEC_CHARACTER_BODY,
  EXEC_CHARACTER_BODY_SIZE,
  EXEC_CHARACTER_FALLBACK_LABEL,
  EXEC_CHARACTER_HEAD,
  EXEC_CHARACTER_HEAD_SIZE,
} from "../state/exec-character";

/**
 * EXEC ENTRY — the centre of the company overview (champagne-orbit pass)
 * ────────────────────────────────────────────────────────────────────────
 * WHAT CHANGED, AND WHY
 * The previous pass stood a violet sphere of dots here: a live, entirely-CSS
 * object that was right for the direction it belonged to and is wrong for this
 * one. The approved company overview puts the APPROVED CHARACTER at the centre
 * of the orbit, with its name and one line of role beneath it.
 *
 * So the sphere is gone. What replaced it is a SEAT: a champagne-rimmed disc
 * with the approved head cutout in it, sized to the reference's proportion
 * (roughly a fifth of the composition's width — see `--nc-seat`). The seat is
 * built to accept a full-body cutout the moment one exists; today it renders the
 * approved head, and the missing body cutout is reported rather than drawn. The
 * whole question is written down in `state/exec-character.ts`.
 *
 * WHAT DID NOT CHANGE
 *   · It is still a REAL LINK to EXEC's own destination, so it is focusable,
 *     middle-clickable and copyable as a URL. Product owns the way IN; the
 *     conversation itself is Agent Studio's (`/command/exec/**`).
 *   · It still takes the same one prop shape — a `VisualNodeState` — and still
 *     collapses the nine runtime states into four phases with a word, so the
 *     state is never carried by colour alone.
 *   · The ring and pearl geometry around it is the composition's, not this
 *     component's: see `.nc-orbit` in `orbit.css`.
 *
 * A broken or absent file is reported in the seat rather than silently leaving a
 * hole — the composition must never pretend to be complete.
 */
export function ExecCore({
  visual,
  placement,
  href,
}: {
  visual: VisualNodeState;
  /** Where the seat stands — a position, resolved by the camera. */
  placement: Placement;
  /** EXEC's destination. A navigation entry, never a second console. */
  href: string;
}) {
  const { t, tc } = useLocale();
  const [assetFailed, setAssetFailed] = useState(false);
  const phase = execPhase(visual.status);
  /* EXEC is an identifier and stays the same word in both languages; its PHASE
     is read aloud from the dictionary. */
  const phaseLabel = t(`status.phase.${phase}`);
  const bodySrc = EXEC_CHARACTER_BODY;
  const src = bodySrc ?? EXEC_CHARACTER_HEAD;

  return (
    <Link
      href={href}
      className="nc-core"
      data-phase={phase}
      data-status={visual.status}
      style={cssVars({
        "--nc-core-x": `${placement.x.toFixed(3)}%`,
        "--nc-core-y": `${placement.y.toFixed(3)}%`,
        "--nc-core-z": `${placement.depth}px`,
      })}
      title={visual.activeJob ? tc(visual.activeJob) : undefined}
      aria-label={`${t("cc.execEntry")}. ${phaseLabel}. ${t(`status.node.${visual.status}`)}${
        visual.activeJob ? `. ${tc(visual.activeJob)}` : ""
      }. ${t("cc.execEntryAria")}.`}
    >
      {/* The atmosphere that seats the character in the composition. */}
      <span className="nc-core__halo" aria-hidden="true" />

      {/* THE SEAT. Decorative to a screen reader: the link above already names
          EXEC, its state and what opening it does, so the figure adds nothing a
          reader needs and would only add a duplicated label. */}
      <span className="nc-execseat" aria-hidden="true">
        {assetFailed ? (
          <span className="nc-execseat__fallback">{EXEC_CHARACTER_FALLBACK_LABEL}</span>
        ) : (
          /* A plain <img>, deliberately: the asset is a fixed-size local file in
             `public/`, it needs no optimisation pipeline, and an `<img>` that
             fails reports it through `onError` — which is how the seat knows to
             say the asset is missing instead of rendering nothing. */
          <img
            className="nc-execseat__figure"
            src={src}
            width={(bodySrc ? EXEC_CHARACTER_BODY_SIZE : EXEC_CHARACTER_HEAD_SIZE).width}
            height={(bodySrc ? EXEC_CHARACTER_BODY_SIZE : EXEC_CHARACTER_HEAD_SIZE).height}
            alt=""
            draggable={false}
            decoding="async"
            onError={() => setAssetFailed(true)}
          />
        )}
      </span>

      {/* The identity: the identifier and its one-line role — the same two facts
          this entry has always stated, in the reference's own position. */}
      <span className="nc-core__identity">
        <span className="nc-core__title">{t("cc.execEntry")}</span>
        <span className="nc-core__role">{t("cc.execKicker")}</span>
      </span>

      {/* Integrated readout: one state word, on the object, with a dot so the
          colour is never the only channel. */}
      <span className="nc-core__readout">
        <span className="nc-core__readout-led" aria-hidden="true" />
        <span className="nc-core__readout-state">{phaseLabel}</span>
      </span>
    </Link>
  );
}
