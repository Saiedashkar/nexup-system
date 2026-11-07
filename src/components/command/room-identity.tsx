"use client";

import { useState } from "react";
import { useCommand } from "./state/command-store";
import { useLocale, type MessageKey } from "./i18n/command-locale";
import { FOUNDER } from "./state/organization-model";
import { totalMissions } from "./state/department-workspace";
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
/*
 * Exported because the phone's EXEC seat greets the founder the same way this
 * overlay does. One function, one answer: two surfaces can never disagree about
 * what time of day it is, and the phone does not grow a second copy of the
 * boundary hours.
 */
export function greetingKeyForHour(hour: number): MessageKey {
  if (hour < 12) return "room.morning";
  if (hour < 18) return "room.afternoon";
  return "room.evening";
}

export function RoomIdentity() {
  const { notify } = useCommand();
  const { t, tc } = useLocale();
  const [greetingKey] = useState(() => greetingKeyForHour(new Date().getHours()));

  return (
    <div className="nc-ident" aria-label={t("room.contextAria")}>
      <div className="nc-ident__copy">
        <span className="nc-ident__greeting" suppressHydrationWarning>
          {t(greetingKey)}
        </span>
        <h1 className="nc-ident__name">{FOUNDER.name}</h1>
        <p className="nc-ident__tagline">{t("room.tagline")}</p>
      </div>

      <button
        type="button"
        className="nc-ident__focus"
        onClick={() => notify(t("room.focusToast"))}
      >
        <span className="nc-ident__focus-icon">
          <IconSpark size={16} />
        </span>
        <span className="nc-ident__focus-copy">
          <span className="nc-ident__focus-label">{tc(FOUNDER.focus.label)}</span>
          {/* Derived, not configured: this line and the Active Missions KPI read the
              same mission lists, so the room cannot greet you with a stale total. */}
          <span className="nc-ident__focus-value">
            {t("room.activeMissions", { count: totalMissions() })}
          </span>
        </span>
        <span className="nc-ident__focus-chev">
          <IconChevronRight size={16} />
        </span>
      </button>
    </div>
  );
}
