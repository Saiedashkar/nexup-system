"use client";

import { EXECUTIVE, FOUNDER } from "../state/organization-model";
import { cssVars } from "../ui/css-vars";
import { STATUS_LABEL, type VisualNodeState } from "../state/visual-state";

/**
 * The Right-Hand Executive — the central intelligence and the router.
 *
 * It is an orb rather than a card because everything else in the composition
 * flows through it: cards sit on platforms around a centre, and a rectangle in
 * the middle of a ring reads like a peer, not like the thing all the wiring
 * terminates on. It owns its own status vocabulary (breathe while thinking or
 * working, still while idle), and it is a real control: pressing it opens the
 * Executive console.
 */
export function ExecutiveOrb({ visual, onOpen }: { visual: VisualNodeState; onOpen: () => void }) {
  return (
    <button
      type="button"
      className="nc-orb"
      data-status={visual.status}
      style={cssVars({ left: `${EXECUTIVE.x}%`, top: `${EXECUTIVE.y}%` })}
      onClick={onOpen}
      title={visual.activeJob ?? undefined}
      aria-label={`${EXECUTIVE.label} — ${STATUS_LABEL[visual.status]}${
        visual.activeJob ? `. ${visual.activeJob}` : ""
      }. Open the Executive console.`}
    >
      <span className="nc-orb__halo" aria-hidden="true" />
      <span className="nc-orb__portrait" aria-hidden="true">
        {FOUNDER.initials}
      </span>
      <span className="nc-orb__title">{EXECUTIVE.short}</span>
      <span className="nc-orb__role">{EXECUTIVE.label}</span>
      {/* Status only. The current work lives in the console and the List view,
          so the centre of the composition stays quiet. */}
      <span className="nc-orb__status">{STATUS_LABEL[visual.status]}</span>
    </button>
  );
}
