"use client";

import { useState } from "react";
import { useCommand } from "../state/command-store";
import { useLocale } from "../i18n/command-locale";
import { SharedServicesBand } from "./shared-services-band";
import { HomeHeader } from "./home-header";
import { DemoHandoffDialog } from "./demo-handoff";
import { CommandScene } from "../scene/command-scene";
import { CommandActionBar } from "../command-actions";
import { GlobalCommandBar } from "../global-command-bar";
import { LabData } from "../lab/kit";
import {
  CommandKpis,
  CommandPriorities,
  CommandSummaries,
} from "./command-center";
import { IconSpark } from "../ui/icons";

/**
 * LIVING ORGANIZATION — the approved company overview
 * ───────────────────────────────────────────────────
 * One subject, two answers, one composer, one disclosure. In that order:
 *
 *   1. HOME HEADER — brand, company scope and language at the left; the
 *      time-aware greeting and the product line at the right;
 *   2. THE COMPOSITION — six department plates, three a side, around the
 *      approved EXEC character, with one explicit demo collaboration on the
 *      route between Clients & Projects and Creative & Production;
 *   3. THE TWO SUMMARIES — what waits on the founder and what is moving;
 *   4. THE COMPOSER — the home is addressed to EXEC, so the console sits at the
 *      end of the composition rather than in a page-wide toolbar above it;
 *   5. ONE DISCLOSURE — figures, row-level panels, the home's verbs and shared
 *      services, closed by default.
 *
 * There is no page title, no subtitle and no view switcher in this composition.
 * The reference does not have them, and the previous pass read as a dashboard
 * precisely because it stacked all three above the thing the screen is about.
 * The cards and list readings still exist as components; they are simply not
 * competing with the approved composition on its first screen.
 *
 * The desktop room is hidden at ≤760px by `system.css`; the phone gets its own
 * reading in `command-mobile-overview.tsx`.
 */
export function LivingOrganization({ children }: { children?: React.ReactNode }) {
  const { focus, clearFocus } = useCommand();
  const { t } = useLocale();
  const [handoffOpen, setHandoffOpen] = useState(false);

  return (
    <section className="nc-room nc-op" data-reading="overview" aria-label={t("cc.livingOrganization")}>
      <HomeHeader />

      {/* The selection is reversible from the composition itself, and not only
          from the contextual panel: a reader who selected a space must be able
          to let it go without hunting for the panel that opened it. */}
      {focus && (
        <div className="nc-ov__selected" role="status">
          <span className="nc-ov__selected-text">{t("cc.selectedNote")}</span>
          <button type="button" className="nc-ov__selected-clear" onClick={clearFocus}>
            {t("cc.clearSelection")}
          </button>
        </div>
      )}

      <LabData>
        {(dataset) => (
          <>
            <section className="nc-ov" aria-label={t("cc.viewOrganization")}>
              <div className="nc-room__stage nc-ov__stage">
                <div className="nc-room__view" data-active="true">
                  <CommandScene onDemoHandoff={() => setHandoffOpen(true)} />
                </div>
              </div>
            </section>

            {/* The two answers. Directly under the composition, above everything
                else, because they are what a founder opens this screen for. */}
            <CommandSummaries dataset={dataset} />

            <div className="nc-homecomposer">
              <GlobalCommandBar home />
            </div>

            <p className="nc-home__provenance">{t("home.provenance")}</p>

            {/* OPERATING DETAIL — one disclosure, closed by default. A native
                `<details>` is a real disclosure to a screen reader and to the
                keyboard with no JavaScript, so it is the honest choice here: the
                content is not hidden from anything, it is folded. */}
            <details className="nc-detail">
              <summary className="nc-detail__summary">
                <IconSpark size={14} />
                {t("cc.detailsTitle")}
                <span className="nc-detail__note">{t("cc.detailsNote")}</span>
              </summary>

              <div className="nc-detail__body">
                <CommandKpis dataset={dataset} />
                <CommandActionBar />
                <CommandPriorities dataset={dataset} />
                <SharedServicesBand />
              </div>
            </details>
          </>
        )}
      </LabData>

      <DemoHandoffDialog open={handoffOpen} onClose={() => setHandoffOpen(false)} />

      {/* The page's own additive band (operating detail), appended INSIDE the
          room's scroll flow. Nothing above this line changes. */}
      {children}
    </section>
  );
}
