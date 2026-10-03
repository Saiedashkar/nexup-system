"use client";

import { useState } from "react";
import { useCommand } from "./state/command-store";
import { FOUNDER } from "./state/organization-model";
import { IconChevronRight, IconSpark } from "./ui/icons";

/**
 * ROOM IDENTITY — who is standing in this room (Phase UI-02.1)
 * ────────────────────────────────────────────────────────────
 * UI-01.1 opened /command with a 50px name, a greeting and a floating focus
 * card, above a separate bordered organization panel. Two problems: it ate the
 * top quarter of the screen, and it framed the environment as a page — the
 * heading of a dashboard.
 *
 * The identity belongs to the ROOM, so it is now an overlay standing in the
 * room's upper-left, at roughly the visual weight a person's own label has on a
 * control surface: the greeting is a quiet line, the name is legible but not a
 * banner, and the whole block is deliberately translucent because it is standing
 * in front of architecture, not above content.
 *
 * Authority is still not a node in the graph — the Founder sits above the
 * system, which is where a human actually sits.
 *
 * The greeting resolves from the clock through a lazy initialiser rather than an
 * effect, so there is no state cascade; `suppressHydrationWarning` covers the one
 * case where the render server and the browser disagree about the hour.
 */
function greetingForHour(hour: number) {
  if (hour < 12) return "Good morning,";
  if (hour < 18) return "Good afternoon,";
  return "Good evening,";
}

export function RoomIdentity() {
  const { notify } = useCommand();
  const [greeting] = useState(() => greetingForHour(new Date().getHours()));

  return (
    <div className="nc-ident" aria-label="Founder context">
      <div className="nc-ident__copy">
        <span className="nc-ident__greeting" suppressHydrationWarning>
          {greeting}
        </span>
        <h1 className="nc-ident__name">{FOUNDER.name}</h1>
        <p className="nc-ident__tagline">Build. Automate. Scale. What&apos;s next?</p>
      </div>

      <button
        type="button"
        className="nc-ident__focus"
        onClick={() => notify("Today's Focus opens the mission view in a later phase.")}
      >
        <span className="nc-ident__focus-icon">
          <IconSpark size={16} />
        </span>
        <span className="nc-ident__focus-copy">
          <span className="nc-ident__focus-label">{FOUNDER.focus.label}</span>
          <span className="nc-ident__focus-value">{FOUNDER.focus.value}</span>
        </span>
        <span className="nc-ident__focus-chev">
          <IconChevronRight size={16} />
        </span>
      </button>
    </div>
  );
}
