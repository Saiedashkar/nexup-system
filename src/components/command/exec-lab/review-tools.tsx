"use client";

/**
 * NEXUP COMMAND — EXEC REVIEW TOOLS
 * ─────────────────────────────────
 * ROUTE: `/command/exec/lab`
 *
 * Everything that was crowding the conversation, moved here on purpose: the demo
 * scenario picker, the state vocabulary, the approved reference boards and the
 * demo history. A reviewer comes here deliberately; a founder never sees it.
 *
 * This page is NOT the experience, so it does not take the shell into focus mode:
 * its root carries `.nce--lab` and no `data-mode`, and the focus rules in
 * `exec-lab.css` are guarded by `.nce[data-mode]`. The shell therefore looks
 * exactly as it does on every other page while the tools are open — which is also
 * how the "only the EXEC page is affected" claim stays checkable on screen.
 *
 * Starting a scenario records an intent through `review-handoff` and hands the
 * reviewer to the conversation; the run is stepped there, by hand, one action at
 * a time.
 */

import Link from "next/link";
import { useState } from "react";

import { HistoryPanel, ReferenceAssets, StatusLegend } from "./panels";
import { historyFor } from "./fixtures";
import { DEFAULT_LOCALE, LOCALE_SWITCH_LABEL, dirOf, t, type Locale } from "./i18n";
import { requestScenario } from "./review-handoff";
import { DEFAULT_SCOPE } from "./catalog";
import { SCENARIO_LIST } from "./scenarios";

export function ExecReviewTools() {
  const [locale, setLocale] = useState<Locale>(DEFAULT_LOCALE);
  const history = historyFor(DEFAULT_SCOPE);

  return (
    <div className="nce nce--lab" dir={dirOf(locale)} lang={locale} data-locale={locale}>
      <div className="nce-top">
        <Link className="nce-top__back" href="/command/exec">
          <span aria-hidden="true" className="nce-top__arrow">
            ←
          </span>
          EXEC
        </Link>

        <div className="nce-top__right">
          <button
            type="button"
            className="nce-top__btn"
            aria-label={t(locale, "app.locale")}
            onClick={() => setLocale(locale === "ar" ? "en" : "ar")}
          >
            <span className="nce-top__btn-label">{LOCALE_SWITCH_LABEL[locale]}</span>
          </button>
        </div>
      </div>

      <header className="nce-lab__head">
        <h1 className="nce-lab__title">{t(locale, "lab.title")}</h1>
        <p className="nce-lab__note">{t(locale, "lab.note")}</p>
      </header>

      {/* ═══ Demo scenarios ═══ */}
      <section className="nce-lab__block">
        <h2 className="nce-lab__block-title">{t(locale, "scen.title")}</h2>
        <p className="nce-note">{t(locale, "scen.note")}</p>

        <ul className="nce-lab__scenarios">
          {SCENARIO_LIST.map((scenario) => (
            <li key={scenario.id} className="nce-lab__scenario">
              <span className="nce-lab__scenario-head">
                <span className="nce-lab__scenario-name">{t(locale, scenario.labelKey)}</span>
                <span className="nce-lab__scenario-code" dir="ltr">
                  {scenario.code}
                </span>
              </span>
              <span className="nce-lab__scenario-summary">{t(locale, scenario.summaryKey)}</span>
              {/* Records the intent, then lets Link navigate. The run starts in
                  the conversation, after it mounts — never here. */}
              <Link className="nce-btn nce-btn--sm" href="/command/exec" onClick={() => requestScenario(scenario.id)}>
                {t(locale, "scen.start")}
              </Link>
            </li>
          ))}
        </ul>
      </section>

      {/* ═══ The state vocabulary ═══ */}
      <section className="nce-lab__block">
        <StatusLegend locale={locale} />
        <p className="nce-note">{t(locale, "panel.stateSeparation")}</p>
      </section>

      {/* ═══ Demo history, scoped ═══ */}
      <section className="nce-lab__block">
        <HistoryPanel history={history} scope={DEFAULT_SCOPE} locale={locale} />
      </section>

      {/* ═══ Reference assets ═══ */}
      <section className="nce-lab__block">
        <ReferenceAssets locale={locale} />
      </section>
    </div>
  );
}
