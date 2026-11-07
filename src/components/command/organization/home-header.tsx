"use client";

import Link from "next/link";
import { useState } from "react";
import { useCommand } from "../state/command-store";
import { translateFor, useLocale } from "../i18n/command-locale";
import { LocaleSwitch } from "../i18n/locale-switch";
import { BUSINESS_SCOPES, cycleScope, useScopeIndex } from "../state/business-scope";
import { greetingKeyForHour } from "../room-identity";
import { IconChevronDown, IconCommand, IconMore } from "../ui/icons";

/**
 * HOME HEADER — the approved composition's own top line
 * ─────────────────────────────────────────────────────
 * The reference does not open with a page title, a subtitle and a view switcher.
 * It opens with the identity of the room and the identity of the reader:
 *
 *     NEXUP ⌄   AR / EN                              Good evening, Founder
 *                                                   Build. Automate. Scale.
 *
 * So this replaces the old "Executive Command Center" band on the home only.
 * The heading is still a real `<h1>` for a screen reader, but it is the greeting
 * rather than a product name — which is what the approved reference actually
 * says. Nothing here is a new control: the brand links home, the scope cycles the
 * one shared scope store, and the language control is the same `LocaleSwitch`
 * the rail uses.
 *
 * WHY THE HEADER IS PHYSICALLY LTR
 * The reference pins the brand to the far left and the greeting to the far right
 * in BOTH languages. That is a brand placement, not a reading-order decision, so
 * the row itself is laid out LTR and the greeting is given the active `dir` back.
 * The language control keeps per-option `dir` inside `LocaleSwitch`, so each
 * option reads correctly regardless.
 */
export function MobileHomeHeader() {
  const { notify } = useCommand();
  const { t, tc } = useLocale();
  const scopeIndex = useScopeIndex();
  const scope = scopeIndex === 0 ? tc(BUSINESS_SCOPES[0]) : BUSINESS_SCOPES[scopeIndex];

  return (
    <header className="nc-mhome__head">
      <Link className="nc-homehead__brand" href="/command">
        <span className="nc-homehead__mark" aria-hidden="true">
          <IconCommand size={19} />
        </span>
        <span className="nc-homehead__wordmark">
          {t("shell.brandName")}
          <small>{t("shell.brandSub")}</small>
        </span>
      </Link>

      <button
        type="button"
        className="nc-mhome__scope"
        onClick={() => {
          const next = cycleScope();
          notify(
            t("shell.scopeToast", {
              scope: next === 0 ? tc(BUSINESS_SCOPES[0]) : BUSINESS_SCOPES[next],
            }),
          );
        }}
        title={t("shell.commandScopeTitle")}
        aria-describedby="nc-mhome-scope-note"
      >
        {scope}
        <IconChevronDown size={11} />
      </button>

      <LocaleSwitch
        variant="bar"
        labels="code"
        onChanged={(locale, label) =>
          notify(translateFor(locale, "shell.savedToast", { language: label }))
        }
      />

      <button
        type="button"
        className="nc-mhome__menu"
        aria-label={t("mobile.sheetAria")}
        onClick={() => window.dispatchEvent(new CustomEvent("nc:open-more"))}
      >
        <IconMore size={18} />
      </button>
    </header>
  );
}

export function HomeHeader() {
  const { notify } = useCommand();
  const { t, tc, dir } = useLocale();
  const scopeIndex = useScopeIndex();
  const [greetingKey] = useState(() => greetingKeyForHour(new Date().getHours()));
  const scope = scopeIndex === 0 ? tc(BUSINESS_SCOPES[0]) : BUSINESS_SCOPES[scopeIndex];

  return (
    <header className="nc-homehead" aria-label={t("home.headerAria")}>
      <div className="nc-homehead__id">
        <Link className="nc-homehead__brand" href="/command">
          <span className="nc-homehead__mark" aria-hidden="true">
            <IconCommand size={22} />
          </span>
          <span className="nc-homehead__wordmark">
            {t("shell.brandName")}
            <small>{t("shell.brandSub")}</small>
          </span>
        </Link>

        <button
          type="button"
          className="nc-homehead__scope"
          onClick={() => {
            const next = cycleScope();
            notify(
              t("shell.scopeToast", {
                scope: next === 0 ? tc(BUSINESS_SCOPES[0]) : BUSINESS_SCOPES[next],
              }),
            );
          }}
          title={t("shell.commandScopeTitle")}
          aria-describedby="nc-home-scope-note"
        >
          {scope}
          <IconChevronDown size={13} />
        </button>        <LocaleSwitch
          variant="bar"
          labels="code"
          onChanged={(locale, label) =>
            notify(translateFor(locale, "shell.savedToast", { language: label }))
          }
        />
      </div>

      <div className="nc-homehead__greeting" dir={dir}>
        <h1 className="nc-homehead__hello">
          <span suppressHydrationWarning>{t(greetingKey)}</span>{" "}
          <span className="nc-homehead__name">{t("shell.founderName")}</span>
        </h1>
        <p className="nc-homehead__tagline">{t("room.tagline")}</p>
      </div>
    </header>
  );
}
