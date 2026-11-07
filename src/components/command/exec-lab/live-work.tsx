"use client";

/**
 * NEXUP COMMAND — EXEC EXPERIENCE · LIVE WORK
 * ───────────────────────────────────────────
 * “View live work” is ONE control in the header, and this is the one view it
 * opens: the open task's progress, plan and dependencies, in a single band above
 * the conversation.
 *
 * WHAT IT DOES NOT DO. It starts nothing and it reveals nothing that is not
 * already in the run. There is no timer, no polling and no animation that would
 * suggest work is happening behind the screen: the band is a READING of
 * `RunState`, drawn only while the button says it is open, and every value in it
 * is demo state that the conversation itself produced.
 *
 * ONE COPY AT A TIME. The band and the conversation's own execution summary are
 * the same disclosure — the plan — reached from two places, so the page renders
 * exactly one of them (see `exec-experience.tsx`). That keeps the plan's `id`
 * unique, and keeps the “one place the steps live” promise the surface made when
 * the card wall was removed.
 *
 * THE STATE VOCABULARY IS PRESERVED, NOT SIMPLIFIED AWAY. EXEC's state, the
 * task's state and each step's state are three different things with three
 * different words (`EXEC_STATUS_META` · `TASK_STATUS_META` · `StepState`), and the
 * summary below draws all three with a glyph as well as a colour.
 */

import { EXEC_STATUS_META } from "./catalog";
import { formatNumber, t, type Locale } from "./i18n";
import { getScenario } from "./scenarios";
import { ExecutionSummary } from "./thread";
import type { RunState } from "./types";

export function LiveWorkBand({
  run,
  locale,
  onClose,
}: {
  run: RunState | null;
  locale: Locale;
  onClose: () => void;
}) {
  /* No task yet: the control still works, and it says what it found rather than
     showing an empty scaffold that implies work in progress. */
  if (!run) {
    return (
      <section className="nce-live" data-empty="true" aria-label={t(locale, "live.title")}>
        <header className="nce-live__head">
          <h2 className="nce-live__title">{t(locale, "live.title")}</h2>
          <span className="nce-tag" data-tone="off">
            {t(locale, "app.demoBadge")}
          </span>
          <button type="button" className="nce-btn nce-btn--quiet nce-btn--sm" onClick={onClose}>
            {t(locale, "live.close")}
          </button>
        </header>
        <p className="nce-live__empty">{t(locale, "live.none")}</p>
      </section>
    );
  }

  const meta = EXEC_STATUS_META[run.execStatus];
  const scenario = getScenario(run.scenarioId);
  const total = scenario.beats.length;
  const stage = Math.min(run.beatIndex + 1, total);

  return (
    <section className="nce-live" data-tone={meta.tone} aria-label={t(locale, "live.title")}>
      <header className="nce-live__head">
        <span className="nce-live__dot" data-tone={meta.tone} aria-hidden="true" />
        <h2 className="nce-live__title">{t(locale, "live.title")}</h2>

        <span className="nce-state" data-tone={meta.tone}>
          <i aria-hidden="true">{meta.glyph}</i>
          {t(locale, meta.labelKey)}
        </span>

        <span className="nce-live__task" dir="auto">
          {t(locale, run.taskTitleKey)}
        </span>

        <span className="nce-live__progress">
          {t(locale, "summary.progress", {
            done: formatNumber(locale, stage),
            total: formatNumber(locale, total),
          })}
        </span>

        <span className="nce-tag" data-tone="off">
          {t(locale, "app.demoBadge")}
        </span>

        <button type="button" className="nce-btn nce-btn--quiet nce-btn--sm" onClick={onClose}>
          {t(locale, "live.close")}
        </button>
      </header>

      <p className="nce-live__hint">{t(locale, "live.hint")}</p>

      {/* The demo line is part of the view, not a footer note: this band is the
          one place that looks most like a live monitor, so it is the one place
          that most needs to say what it actually is. */}
      <p className="nce-live__demo">{t(locale, "live.demo")}</p>

      {/* The run's own disclosure, open by construction here. Closing it from its
          own bar closes the band, so the two can never disagree about being open
          — there is one variable behind both. */}
      <ExecutionSummary
        run={run}
        locale={locale}
        open
        onToggle={(next) => {
          if (!next) onClose();
        }}
      />
    </section>
  );
}
