"use client";

import { useState } from "react";
import { useCommand } from "./state/command-store";
import { FOUNDER } from "./state/organization-model";
import { IconChevronRight, IconSpark } from "./ui/icons";

/**
 * Founder authority.
 *
 * The reference removes the Founder from the node graph. That is the right
 * call: authority is not a department, and drawing it as one made the ring
 * busier without saying anything new. Instead the human sits where a human
 * actually sits — above the whole system, as the greeting that opens the
 * environment.
 *
 * The greeting resolves from the clock through a lazy initialiser rather than
 * an effect, so there is no state cascade; `suppressHydrationWarning` covers
 * the one case where the render server and the browser disagree about the hour
 * (they agree when you run this locally).
 */
function greetingForHour(hour: number) {
  if (hour < 12) return "Good morning,";
  if (hour < 18) return "Good afternoon,";
  return "Good evening,";
}

export function FounderHero() {
  const { notify } = useCommand();
  const [greeting] = useState(() => greetingForHour(new Date().getHours()));

  return (
    <header className="nc-hero" aria-label="Founder context">
      <div className="nc-hero__copy">
        <div className="nc-hero__greeting" suppressHydrationWarning>
          {greeting}
        </div>
        <h1 className="nc-hero__name">{FOUNDER.name}</h1>
        <p className="nc-hero__tagline">Build. Automate. Scale. What&apos;s next?</p>
      </div>

      <div className="nc-hero__spacer" />

      <button
        type="button"
        className="nc-focus-card"
        onClick={() => notify("Today's Focus opens the mission view in a later phase.")}
      >
        <span className="nc-focus-card__icon">
          <IconSpark size={17} />
        </span>
        <span>
          <span className="nc-focus-card__label">{FOUNDER.focus.label}</span>
          <span className="nc-focus-card__value">{FOUNDER.focus.value}</span>
        </span>
        <span className="nc-focus-card__chev">
          <IconChevronRight size={17} />
        </span>
      </button>
    </header>
  );
}
