"use client";

/**
 * NEXUP COMMAND — EXEC EXPERIENCE · PANELS
 * ────────────────────────────────────────
 * The parts a reviewer opens deliberately, and which the conversation keeps out
 * of the way until then: the team EXEC routes to, the event timeline, the
 * optional dependency graph, the scoped demo history and the approved reference
 * boards.
 *
 * PLACEMENT IS THE POINT. The team, timeline and dependency panels render INSIDE
 * the conversation's single execution summary, each behind its own disclosure, so
 * the thread itself only ever shows text. The legend, the demo history and the
 * reference boards render on the review tools page (`/command/exec/lab`) — out of
 * the experience entirely.
 */

import Image from "next/image";

import { DependencyGraph } from "./cards";
import { CLIENT_LABEL_KEY, TEAM, TASK_STATUS_META, EXEC_STATUS_ORDER, EXEC_STATUS_META } from "./catalog";
import { formatNumber, t, type Locale } from "./i18n";
import type { HistoryEntry } from "./fixtures";
import type { RunState, Scope, TeamId } from "./types";

/* ═══════════════════════════════════════════════════════
   Status legend — every state labelled and symbolised
   ═══════════════════════════════════════════════════════ */

export function StatusLegend({ locale }: { locale: Locale }) {
  return (
    <section className="nce-panel">
      <h3 className="nce-panel__title">{t(locale, "status.legend")}</h3>
      <ul className="nce-legend">
        {EXEC_STATUS_ORDER.map((code) => {
          const meta = EXEC_STATUS_META[code];
          return (
            <li key={code} className="nce-legend__row">
              <span className="nce-legend__glyph" data-tone={meta.tone} aria-hidden="true">
                {meta.glyph}
              </span>
              <span className="nce-legend__label">{t(locale, meta.labelKey)}</span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/* ═══════════════════════════════════════════════════════
   Team
   ═══════════════════════════════════════════════════════ */

export function TeamPanel({ run, locale }: { run: RunState | null; locale: Locale }) {
  const active = new Set<TeamId>(run?.activeTeam ?? []);
  const engaged = new Set<TeamId>(run?.engagedTeam ?? []);

  return (
    <section className="nce-panel">
      <h3 className="nce-panel__title">{t(locale, "panel.team")}</h3>
      <p className="nce-note nce-note--tight">{t(locale, "team.note")}</p>
      <ul className="nce-team">
        {TEAM.map((member) => (
          <li key={member.id} className="nce-team__row" data-accent={member.accent} data-active={active.has(member.id)} data-engaged={engaged.has(member.id)}>
            <span className="nce-team__badge" aria-hidden="true">
              {member.codename.slice(0, 2)}
            </span>
            <span className="nce-team__text">
              <span className="nce-team__name" dir="auto">
                {t(locale, member.specialtyKey)}
                <span className="nce-team__code">{member.codename}</span>
              </span>
              <span className="nce-team__mandate" dir="auto">
                {t(locale, member.mandateKey)}
              </span>
            </span>
            <span className="nce-team__flag">
              {active.has(member.id) ? t(locale, "team.active") : engaged.has(member.id) ? t(locale, "team.idle") : ""}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

/* ═══════════════════════════════════════════════════════
   Timeline
   ═══════════════════════════════════════════════════════ */

export function TimelinePanel({ run, locale }: { run: RunState | null; locale: Locale }) {
  const entries = run?.timeline ?? [];
  return (
    <section className="nce-panel">
      <h3 className="nce-panel__title">
        {t(locale, "panel.timeline")}
        {entries.length > 0 && <span className="nce-panel__count">{formatNumber(locale, entries.length)}</span>}
      </h3>
      {entries.length === 0 ? (
        <p className="nce-note">{t(locale, "panel.timeline.empty")}</p>
      ) : (
        <ol className="nce-timeline">
          {entries.map((entry) => (
            <li key={entry.id} className="nce-timeline__row" data-kind={entry.kind}>
              <span className="nce-timeline__at" dir="ltr">
                {entry.at}
              </span>
              <span className="nce-timeline__dot" aria-hidden="true" data-kind={entry.kind} />
              <span className="nce-timeline__text" dir="auto">
                {t(locale, entry.key)}
                <span className="nce-timeline__cause">
                  {entry.causedByUser ? t(locale, "panel.causedByYou") : t(locale, "panel.causedByDemo")}
                </span>
              </span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

/* ═══════════════════════════════════════════════════════
   Dependencies — shown only when the run asks for it
   ═══════════════════════════════════════════════════════ */

export function DependenciesPanel({ run, locale }: { run: RunState | null; locale: Locale }) {
  if (!run || !run.showGraph) return null;
  const plan = run.messages.flatMap((message) => message.cards).find((card) => card.kind === "plan");
  if (!plan || plan.kind !== "plan") return null;

  return (
    <section className="nce-panel">
      <h3 className="nce-panel__title">{t(locale, "panel.dependencies")}</h3>
      <p className="nce-note nce-note--tight">{t(locale, "panel.dependencies.note")}</p>
      <DependencyGraph steps={plan.steps} locale={locale} />
    </section>
  );
}

/* ═══════════════════════════════════════════════════════
   Scoped demo history
   ═══════════════════════════════════════════════════════ */

export function HistoryPanel({ history, scope, locale }: { history: HistoryEntry[]; scope: Scope; locale: Locale }) {
  const clientKey = CLIENT_LABEL_KEY[scope.clientId];
  return (
    <section className="nce-panel">
      <h3 className="nce-panel__title">
        {t(locale, "panel.history")}
        <span className="nce-panel__count">{formatNumber(locale, history.length)}</span>
      </h3>
      {clientKey && <p className="nce-note nce-note--tight">{t(locale, clientKey)}</p>}
      {history.length === 0 ? (
        <p className="nce-note">—</p>
      ) : (
        <ul className="nce-history">
          {history.map((entry) => {
            const meta = TASK_STATUS_META[entry.outcome];
            return (
              <li key={entry.id} className="nce-history__row">
                <span className="nce-history__at" dir="ltr">
                  {entry.atLabel}
                </span>
                <span className="nce-history__text" dir="auto">
                  {t(locale, entry.labelKey)}
                </span>
                <span className="nce-history__state" data-tone={meta.tone}>
                  {t(locale, meta.labelKey)}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

/* ═══════════════════════════════════════════════════════
   Reference assets — flat images, labelled as such
   ═══════════════════════════════════════════════════════ */

export function ReferenceAssets({ locale }: { locale: Locale }) {
  return (
    <section className="nce-panel">
      {/* A native disclosure, so the reference boards cost nothing until a
          reviewer asks for them. The conversation keeps the priority. */}
      <details className="nce-refs">
        <summary className="nce-panel__title">
          <span className="nce-refs__marker" aria-hidden="true">
            ▸
          </span>
          {t(locale, "refs.title")}
        </summary>
        <p className="nce-note nce-note--tight">{t(locale, "refs.note")}</p>
        <div className="nce-refs__list">
          {/* Flat reference images from the approved design board. Not a 3D
              model, not animated, and not redrawn here. Dimensions are declared
              so the layout never shifts while an asset loads.

              `unoptimized`: this app's middleware gates every non-`_next` path,
              and Next's image optimizer fetches local files server-side without
              the session cookie — so the optimizer cannot read them. Serving the
              file directly is correct here and removes that failure mode.

              The served files are web-sized derivatives (1200 px wide, ~0.4 MB
              each); the full-resolution boards stay in
              `docs/exec-lab-reference/` and are never served. */}
          <figure className="nce-refs__item">
            <Image
              src="/exec-lab/exec-character-board.png"
              alt={t(locale, "refs.exec.alt")}
              width={1200}
              height={800}
              unoptimized
            />
            <figcaption>{t(locale, "refs.exec.caption")}</figcaption>
          </figure>
          <figure className="nce-refs__item">
            <Image
              src="/exec-lab/exec-team-board.png"
              alt={t(locale, "refs.team.alt")}
              width={1200}
              height={600}
              unoptimized
            />
            <figcaption>{t(locale, "refs.team.caption")}</figcaption>
          </figure>
        </div>
      </details>
    </section>
  );
}
