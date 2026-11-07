"use client";

/** NEXUP COMMAND — EXEC EXPERIENCE · NAVIGATION
 * ────────────────────────────────────────────
 * The navigation this surface OWNS.
 *
 * WHY IT EXISTS. The shell's own rail (`global-nav.tsx`) belongs to the shared
 * Command chrome: it lists the six Command areas, and modifying it would change
 * every page under `/command`. The EXEC room needs different contents — EXEC,
 * Sessions, Tools, the recent sessions, New session and Settings, as the approved
 * reference lays them out — so this rail is built here, out of this track's own
 * components, and the shell's rail is stood down in `exec-lab.css` under a scope
 * that only exists while this page is mounted (`:has(.nce[data-mode])`). Nothing
 * shared is touched, and on every other route the shell is exactly as it was.
 *
 * ONE OWNER FOR "WHAT IS ON SCREEN". The rail does not hold UI state of its own:
 * it reports a target (`NavTarget`) and the page decides what that means, because
 * the same target is also reached from the header menu and from the phone's tab
 * bar. Arrow-of-truth, not a second copy of the panel state.
 *
 * THREE SURFACES, ONE COMPONENT SET:
 *   · a wide window gets the sidebar, which folds to a 64px spine of icons;
 *   · a narrow one gets the tab bar instead (Chat · Sessions · Tools) — the
 *     sidebar is not shrunk, it is replaced, because a 64px spine on a phone is a
 *     column of unlabelled glyphs;
 *   · both are driven by the same `NavTarget`s and the same labels.
 */

import Image from "next/image";
import { useState } from "react";

import { EXEC_STATUS_META } from "./catalog";
import { conversationRows, conversationRowTitle, filterConversationRows } from "./engine";
import { Icon, type IconName } from "./icons";
import { formatNumber, t, type Locale } from "./i18n";
import type { ExperienceState } from "./types";

/** What a navigation control asks for. The page maps it to a panel or a view. */
export type NavTarget = "chat" | "sessions" | "plugins" | "workspace";

/* ═══════════════════════════════════════════════════════
   The sidebar
   ═══════════════════════════════════════════════════════ */

export function ExecRail({
  locale,
  state,
  avatarSrc,
  collapsed,
  active,
  onToggleCollapsed,
  onSelect,
  onNewSession,
  onOpenConversation,
  effects,
  onToggleLocale,
  onToggleEffects,
}: {
  locale: Locale;
  state: ExperienceState;
  avatarSrc: string;
  collapsed: boolean;
  active: NavTarget;
  onToggleCollapsed: () => void;
  onSelect: (target: NavTarget) => void;
  onNewSession: () => void;
  onOpenConversation: (id: string) => void;
  effects: string;
  onToggleLocale: () => void;
  onToggleEffects: () => void;
}) {
  const rows = conversationRows(state);
  const [query, setQuery] = useState("");
  const visibleRows = filterConversationRows(rows, query, locale);
  const status = state.run ? state.run.execStatus : "available";
  const meta = EXEC_STATUS_META[status];

  return (
    <nav className="nce-rail" data-collapsed={collapsed ? "true" : "false"} aria-label={t(locale, "nav.aria")}>
      <div className="nce-rail__brand">
        <span className="nce-rail__head" aria-hidden="true">
          <Image
            className="nce-rail__headimg"
            src={avatarSrc}
            alt=""
            width={212}
            height={212}
            unoptimized
            loading="eager"
          />
        </span>
        <span className="nce-rail__brandtext">
          <span className="nce-rail__wordmark">NEXUP</span>
          <span className="nce-rail__sub">COMMAND</span>
        </span>
      </div>

      <button
        type="button"
        className="nce-rail__fold"
        aria-expanded={!collapsed}
        aria-label={t(locale, collapsed ? "nav.expand" : "nav.collapse")}
        title={t(locale, collapsed ? "nav.expand" : "nav.collapse")}
        data-tip={t(locale, collapsed ? "nav.expand" : "nav.collapse")}
        onClick={onToggleCollapsed}
      >
        <Icon name="chevron" className="nce-rail__fold__icon" />
      </button>

      <button
        type="button"
        className="nce-btn nce-btn--primary nce-rail__new nce-rail__new--top"
        title={t(locale, "nav.newSession")}
        data-tip={t(locale, "nav.newSession")}
        onClick={onNewSession}
      >
        <Icon name="attach" className="nce-rail__new__glyph" />
        <span className="nce-rail__newtext">{t(locale, "nav.newSession")}</span>
      </button>

      <ul className="nce-rail__list">
        <li>
          <RailItem
            className="nce-rail__exec"
            icon="exec"
            label="EXEC"
            dot={meta.tone}
            active={active === "chat"}
            onClick={() => onSelect("chat")}
          />
        </li>
        <li>
          <RailItem
            icon="sessions"
            label={t(locale, "nav.sessions")}
            count={rows.length}
            active={active === "sessions"}
            onClick={() => onSelect("sessions")}
          />
        </li>
        <li>
          <RailItem
            icon="tools"
            label={t(locale, "nav.plugins")}
            active={active === "plugins"}
            onClick={() => onSelect("plugins")}
          />
        </li>
        <li>
          <RailItem
            icon="live"
            label={t(locale, "workspace.title")}
            active={active === "workspace"}
            onClick={() => onSelect("workspace")}
          />
        </li>
      </ul>

      {rows.length > 0 && (
        <details className="nce-rail__recent" open>
          <summary className="nce-rail__caption">{t(locale, "nav.recent")}</summary>
          <label className="nce-rail__search">
            <span className="nce-sr-only">{t(locale, "nav.sessionSearch")}</span>
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t(locale, "nav.sessionSearch")}
            />
          </label>
          <ul className="nce-rail__rows">
            {visibleRows.map((row) => (
              <li key={row.id}>
                {row.isOpen ? (
                  <span className="nce-rail__row" data-open="true" aria-current="true">
                    <span className="nce-rail__rowtitle" dir="auto">
                      {conversationRowTitle(row, locale)}
                    </span>
                    <span className="nce-rail__rowmeta" dir="ltr">
                      {row.taskCode ?? row.code}
                    </span>
                  </span>
                ) : (
                  <button
                    type="button"
                    className="nce-rail__row"
                    data-open="false"
                    title={t(locale, "history.restore")}
                    onClick={() => onOpenConversation(row.id)}
                  >
                    <span className="nce-rail__rowtitle" dir="auto">
                      {conversationRowTitle(row, locale)}
                    </span>
                    <span className="nce-rail__rowmeta" dir="ltr">
                      {row.taskCode ?? row.code}
                    </span>
                  </button>
                )}
              </li>
            ))}
          </ul>
          {visibleRows.length === 0 && <p className="nce-rail__empty">{t(locale, "nav.sessionNoResults")}</p>}
        </details>
      )}

      <div className="nce-rail__spacer" aria-hidden="true" />

      <div className="nce-rail__foot">
        <details className="nce-account">
          <summary className="nce-account__trigger" aria-label={t(locale, "nav.account")}>
            <span className="nce-account__avatar" aria-hidden="true">S</span>
            <span className="nce-account__copy">
              <strong>{t(locale, "nav.accountDemo")}</strong>
              <small>{t(locale, "nav.memoryOnly")}</small>
            </span>
            <Icon name="chevron" />
          </summary>
          <div className="nce-account__menu">
            <button type="button" className="nce-menu__item" onClick={onToggleLocale}>
              {t(locale, "menu.language")}
            </button>
            <p className="nce-account__static">
              <span>{t(locale, "nav.appearance")}</span>
              <strong>{t(locale, "nav.appearanceDark")}</strong>
            </p>
            <button type="button" className="nce-menu__item" onClick={onToggleEffects}>
              {t(locale, effects === "calm" ? "menu.effects.on" : "menu.effects.off")}
            </button>
          </div>
        </details>

        {/* What is on screen, stated on the surface itself and not only in a note
            at the foot of the composer. */}
        <span className="nce-tag nce-rail__badge" data-tone="off" title={t(locale, "app.demoNote")}>
          {t(locale, "app.demoBadge")}
        </span>
      </div>
    </nav>
  );
}

/** One navigation row: a glyph, a label, and optionally a count or a state dot.
 * The label is the accessible name in both folds — when the rail collapses the
 * CSS hides the label VISUALLY and the name stays on the button, so a screen
 * reader hears the same navigation at either width.
 */
function RailItem({
  icon,
  label,
  count,
  dot,
  active,
  disabled = false,
  className,
  onClick,
}: {
  icon: IconName;
  label: string;
  count?: number;
  dot?: string;
  active: boolean;
  disabled?: boolean;
  className?: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={`nce-navrow${className ? ` ${className}` : ""}`}
      data-active={active ? "true" : "false"}
      aria-current={active ? "true" : undefined}
      aria-label={label}
      title={label}
      data-tip={label}
      disabled={disabled}
      onClick={onClick}
    >
      <span className="nce-navrow__glyph" aria-hidden="true">
        <Icon name={icon} />
      </span>
      <span className="nce-navrow__label">{label}</span>
      {dot && <span className="nce-navrow__dot" data-tone={dot} aria-hidden="true" />}
      {count !== undefined && count > 0 && (
        <span className="nce-navrow__count" aria-hidden="true">
          {count}
        </span>
      )}
    </button>
  );
}

/* ═══════════════════════════════════════════════════════
   The phone's tab bar
   ═══════════════════════════════════════════════════════ */

/** Three tabs, as the reference's phone frame has them. It carries the same three
 * destinations as the rail and nothing else: the recent sessions and the settings
 * are one level in, behind Sessions and Tools, so the bar never grows a fifth
 * item on a small screen.
 *
 * It is a `nav` with buttons rather than links: these switch the panel INSIDE the
 * room, they do not navigate away from it.
 */
export function ExecTabBar({
  locale,
  active,
  onSelect,
}: {
  locale: Locale;
  active: NavTarget;
  onSelect: (target: NavTarget) => void;
}) {
  const tabs: { id: NavTarget; icon: IconName; key: "nav.chat" | "nav.sessions" | "nav.plugins" }[] = [
    { id: "chat", icon: "chat", key: "nav.chat" },
    { id: "sessions", icon: "sessions", key: "nav.sessions" },
    { id: "plugins", icon: "tools", key: "nav.plugins" },
  ];

  return (
    <nav className="nce-tabbar" aria-label={t(locale, "nav.aria")}>
      {tabs.map((tab) => (
        <button
          key={tab.id}
          type="button"
          className="nce-tabbar__tab"
          data-active={active === tab.id ? "true" : "false"}
          aria-current={active === tab.id ? "true" : undefined}
          onClick={() => onSelect(tab.id)}
        >
          <Icon name={tab.icon} className="nce-tabbar__glyph" />
          <span className="nce-tabbar__label">{t(locale, tab.key)}</span>
        </button>
      ))}

      {/* The demo state travels with the bar, because on a phone this is the only
          chrome that is always on screen. */}
      <span className="nce-tabbar__badge" title={t(locale, "app.demoNote")}>
        {t(locale, "app.demoBadge")}
      </span>
    </nav>
  );
}

/** How many sessions the rail lists before Sessions is the place to look. */
export const RAIL_SESSION_LIMIT = 3;

/** A count written for the rail's own caption, in the reader's numerals. */
export function sessionCountLabel(locale: Locale, state: ExperienceState): string {
  return formatNumber(locale, Math.min(conversationRows(state).length, RAIL_SESSION_LIMIT));
}
