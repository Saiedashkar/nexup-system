"use client";

import { useState } from "react";
import Link from "next/link";
import { useCommand } from "../state/command-store";
import { useLocale } from "../i18n/command-locale";
import { useCommandData } from "../state/demo/command-data-store";
import { useOnScreen } from "../state/use-on-screen";
import { DEPARTMENTS } from "../state/organization-model";
import { departmentStanding, NODE_STATUS_TONE } from "../state/demo/selectors";
import { workspaceHref } from "../state/department-workspace";
import { DEPARTMENT_ICONS, IconChevronRight } from "../ui/icons";
import { greetingKeyForHour } from "../room-identity";
import { CommandSummaries } from "./command-center";
import { GlobalCommandBar } from "../global-command-bar";
import { DemoHandoffDialog, DemoHandoffPill } from "./demo-handoff";
import { MobileHomeHeader } from "./home-header";
import { cssVars } from "../ui/css-vars";
import {
  EXEC_CHARACTER_BODY,
  EXEC_CHARACTER_BODY_SIZE,
  EXEC_CHARACTER_FALLBACK_LABEL,
  EXEC_CHARACTER_HEAD,
  EXEC_CHARACTER_HEAD_SIZE,
} from "../state/exec-character";

/** The same six, in the composition's reading order: top row first, then left. */
const HOME_DEPARTMENTS = [...DEPARTMENTS].sort((a, b) => a.y - b.y || a.x - b.x);

/**
 * MOBILE COMMAND HOME — the approved phone composition
 * ────────────────────────────────────────────────────
 * The phone is not the desktop canvas shrunk down. It is its own reading of the
 * same organization, in the order the approved reference uses:
 *
 *   1. a COMPACT header — brand, company scope, language and the menu;
 *   2. the GREETING — the same clock-aware line the desktop header states;
 *   3. the EXEC HERO — the approved character over its orbit, with the six
 *      departments as a two-column grid of readable, thumb-sized plates around
 *      it. No horizontal shrink: the page scrolls vertically;
 *   4. ONE EXPLICIT DEMO HANDOFF — a labelled brief moving from Clients &
 *      Projects to Creative & Production;
 *   5. the TWO SUMMARIES — side by side, each a link to the rows that act on it;
 *   6. the COMPOSER — addressed to EXEC, above the fixed bottom bar.
 *
 * The page reads the SAME dataset through the SAME selectors as the desktop and
 * the destination pages, so the two compositions cannot disagree. Everything is
 * local demo data; the provenances line says so in the reader's language.
 */
export function CommandMobileOverview() {
  const { setExecOpen } = useCommand();
  const { t, dir } = useLocale();
  const { dataset } = useCommandData();
  const { ref: screenRef, onScreen } = useOnScreen<HTMLElement>();
  const [assetFailed, setAssetFailed] = useState(false);
  const [handoffOpen, setHandoffOpen] = useState(false);
  const [greetingKey] = useState(() => greetingKeyForHour(new Date().getHours()));

  return (
    <section
      ref={screenRef}
      className="nc-mobile-command"
      data-live={onScreen}
      aria-label={t("mobile.aria")}
    >
      <MobileHomeHeader />

      {/* The company selector is a demonstration control: it changes the label,
          not the records. The limitation is written under the control itself,
          permanently, in whichever language is active. */}
      <p className="nc-mhome__scope-note" id="nc-mhome-scope-note">
        {t("shell.scopeLimitation")}
      </p>

      <div className="nc-mhome__greeting">
        <h1 className="nc-mhome__hello">
          <span suppressHydrationWarning>{t(greetingKey)}</span>{" "}
          <span className="nc-mhome__name">{t("shell.founderName")}</span>
        </h1>
        <p className="nc-mhome__tagline">{t("room.tagline")}</p>
      </div>

      <section className="nc-mhome__hero" aria-label={t("home.heroAria")}>
        {/* THE FIELD — the orbit, the character and the six plates share one
            box, so the seat can stand in the lane BETWEEN the two columns. On
            the phone the reference places the departments AROUND EXEC, not in a
            grid below it; the plates keep their own order and their own
            touchable box, and the character is the centre they face. */}
        <div className="nc-mhome__field">
        <div className="nc-mhome__orbit" aria-hidden="true">
          <span data-ring="outer" />
          <span data-ring="mid" />
          <span data-ring="inner" />
          <i data-pearl="1" />
          <i data-pearl="2" />
          <i data-pearl="3" />
        </div>

        <button
          type="button"
          className="nc-mhome__seat"
          onClick={() => setExecOpen(true)}
          aria-label={t("cc.openConsoleAria")}
        >
          <span className="nc-mhome__seat-figure" aria-hidden="true">
            {assetFailed ? (
              <span className="nc-mhome__seat-fallback">{EXEC_CHARACTER_FALLBACK_LABEL}</span>
            ) : (
              <img
                src={EXEC_CHARACTER_BODY ?? EXEC_CHARACTER_HEAD}
                width={(EXEC_CHARACTER_BODY ? EXEC_CHARACTER_BODY_SIZE : EXEC_CHARACTER_HEAD_SIZE).width}
                height={(EXEC_CHARACTER_BODY ? EXEC_CHARACTER_BODY_SIZE : EXEC_CHARACTER_HEAD_SIZE).height}
                alt=""
                draggable={false}
                decoding="async"
                onError={() => setAssetFailed(true)}
              />
            )}
          </span>
          <span className="nc-mhome__seat-name">EXEC</span>
          <span className="nc-mhome__seat-role">{t("home.execSeat")}</span>
        </button>

        {!dataset ? (
          <div className="nc-mhome__depts" aria-hidden="true">
            {HOME_DEPARTMENTS.map((department) => (
              <span key={department.id} className="nc-mhome__dept-skeleton" />
            ))}
          </div>
        ) : (
          <div className="nc-mhome__depts">
            {HOME_DEPARTMENTS.map((department) => {
              const Icon = DEPARTMENT_ICONS[department.id];
              const standing = departmentStanding(dataset, department.id);
              const note =
                standing.held > 0
                  ? `${t("cc.cardAttention")} · ${standing.held}`
                  : t(`status.node.${standing.status}`);
              return (
                <Link
                  key={department.id}
                  className="nc-mhome__dept"
                  href={workspaceHref(department.id)}
                  dir={dir}
                  style={cssVars({ "--nc-accent": `var(${department.accentVar})` })}
                  title={t("cc.openDepartment", { name: t(`dept.${department.id}.name`) })}
                >
                  <span className="nc-mhome__dept-icon" aria-hidden="true">
                    <Icon size={17} />
                  </span>
                  <span className="nc-mhome__dept-copy">
                    <span className="nc-mhome__dept-name">{t(`dept.${department.id}.name`)}</span>
                    <span
                      className="nc-mhome__dept-status"
                      style={cssVars({
                        "--nc-accent": `var(${NODE_STATUS_TONE[standing.status]})`,
                      })}
                    >
                      <i aria-hidden="true" />
                      {note}
                    </span>
                  </span>
                </Link>
              );
            })}
          </div>
        )}

        </div>

        <DemoHandoffPill variant="phone" onOpen={() => setHandoffOpen(true)} />
      </section>

      {dataset ? (
        <>
          <CommandSummaries dataset={dataset} />

          <div className="nc-mhome__composer">
            <GlobalCommandBar home />
          </div>

          <p className="nc-mhome__provenance">
            <span aria-hidden="true" />
            {t("home.provenance")}
          </p>

          <details className="nc-mhome__detail">
            <summary>
              {t("cc.detailsTitle")}
              <span>{t("cc.detailsNote")}</span>
            </summary>
            <div className="nc-mhome__detail-body">
              <Link href="/command/decisions">
                {t("cc.needsYourDecision")}
                <IconChevronRight size={14} />
              </Link>
              <Link href="/command/missions">
                {t("cc.currentWork")}
                <IconChevronRight size={14} />
              </Link>
              <Link href="/command/projects">
                {t("areas.projects.label")}
                <IconChevronRight size={14} />
              </Link>
            </div>
          </details>
        </>
      ) : (
        <p className="nc-mo__empty" role="status" aria-live="polite">
          {t("kit.readingOrganization")}…
        </p>
      )}

      <DemoHandoffDialog open={handoffOpen} onClose={() => setHandoffOpen(false)} />
    </section>
  );
}
