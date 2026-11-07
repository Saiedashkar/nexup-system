"use client";

/**
 * NEXUP COMMAND — EXEC EXPERIENCE · THE DEPENDENCY GRAPH
 * ─────────────────────────────────────────────────────
 * The only card renderer left in this module, because it is the only one that
 * cannot live in a message: the plan's `dependsOn` edges are a *layout*, so they
 * are derived into dependency levels and drawn as columns.
 *
 * The other nine card kinds moved into `thread.tsx`, where each one is placed by
 * what a reviewer does with it — the brief and the approval read inline, the plan
 * and the owners sit inside the one execution summary, and the evidence sits
 * behind the review disclosure. The card DATA is unchanged: every kind still
 * comes from the scripts and is still typed in `types.ts`.
 *
 * A cycle cannot hang this: `dependencyLevels` gives a cycle guard, and a step
 * that never lands in a level is appended rather than dropped.
 */

import { dependencyLevels } from "./engine";
import { TEAM_BY_ID } from "./catalog";
import { formatNumber, t, type Locale } from "./i18n";
import type { PlanStep } from "./types";

export function DependencyGraph({ steps, locale }: { steps: PlanStep[]; locale: Locale }) {
  const levels = dependencyLevels(steps);
  return (
    <div className="nce-graph" role="img" aria-label={t(locale, "panel.dependencies")}>
      {levels.map((level, levelIndex) => (
        <div key={levelIndex} className="nce-graph__col">
          <span className="nce-graph__level">{formatNumber(locale, levelIndex + 1)}</span>
          {level.map((step) => {
            const member = TEAM_BY_ID[step.ownerId];
            const position = steps.findIndex((candidate) => candidate.id === step.id) + 1;
            return (
              <div key={step.id} className="nce-graph__node" data-accent={member?.accent} data-state={step.state}>
                <span className="nce-graph__num">{formatNumber(locale, position)}</span>
                <span className="nce-graph__label" dir="auto">
                  {t(locale, step.titleKey)}
                </span>
                {step.dependsOn.length > 0 && (
                  <span className="nce-graph__edges">
                    {step.dependsOn
                      .map((id) => steps.findIndex((candidate) => candidate.id === id) + 1)
                      .filter((position_) => position_ > 0)
                      .map((position_) => (
                        <span key={position_} className="nce-graph__edge">
                          ← {formatNumber(locale, position_)}
                        </span>
                      ))}
                  </span>
                )}
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}
