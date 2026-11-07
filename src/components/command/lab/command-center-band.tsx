"use client";

import { useState } from "react";
import Link from "next/link";
import { DEPARTMENT_BY_ID } from "../state/organization-model";
import { useLocale } from "../i18n/command-locale";
import { useCommandData } from "../state/demo/command-data-store";
import {
  ACTIVITY_KIND_META,
  AGENT_STATUS_META,
  SYSTEM_STATE_META,
  systemHealth,
  workforceStatus,
} from "../state/demo/selectors";
import { agentHref, missionHref } from "./areas";
import { Avatar, LabButton, LabData, LoadingStack, Note, Pill, Section, tone } from "./kit";
import type { CommandDataset } from "../state/demo/types";
import { IconChevronDown } from "../ui/icons";

/**
 * OPERATING DETAIL — the home's lower band, closed by default (Pass 3)
 * ───────────────────────────────────────────────────────────────────
 * This band used to open with its own kicker, title and blurb, then repeat the
 * page's figures, the page's departments and the page's decision queue, then add
 * the workforce, the systems and the activity log. Read end to end it was a
 * second, worse dashboard underneath the first one.
 *
 * The correction is PROGRESSIVE DISCLOSURE, which is what the band's content
 * actually wanted:
 *
 *   · the duplicated parts are gone — the six departments and the decision queue
 *     live in one place now (the home above), and the area strip lives in the rail
 *     and the phones' own navigation, where it was already duplicated;
 *   · what is left is what the room cannot say: WHO is carrying work, WHAT is
 *     actually connected, and WHAT changed. None of it is invented — it all reads
 *     through the demo adapter's selectors;
 *   · it is CLOSED by default and opens on request, so nothing below the fold is
 *     competing with the two answers the home exists to give.
 *
 * The disclosure is a real button with `aria-expanded`/`aria-controls`, and the
 * panel only mounts its read when it is open — so a closed band costs nothing.
 */

export function CommandCenterBand() {
  const { t } = useLocale();
  const [open, setOpen] = useState(false);

  return (
    <section className="nl-band nc-op-detail" data-open={open} aria-label={t("band.aria")}>
      <header className="nc-op-detail__head">
        <h2 className="nc-op-detail__title">{t("band.title")}</h2>
        <p className="nc-op-detail__blurb">{t("band.blurb")}</p>
        <button
          type="button"
          className="nc-op-detail__toggle"
          aria-expanded={open}
          aria-controls="nc-operating-detail"
          onClick={() => setOpen((value) => !value)}
        >
          {open ? t("band.collapse") : t("band.expand")}
          <IconChevronDown size={14} data-flip={open} />
        </button>
      </header>

      {open && (
        <div id="nc-operating-detail">
          <LabData emptyTitle={t("band.emptyTitle")} emptyBody={t("band.emptyBody")}>
            {(dataset) => <Band dataset={dataset} />}
          </LabData>
        </div>
      )}
    </section>
  );
}

/** The band's own reading state, distinct from a full page. */
export function CommandCenterBandLoading() {
  const { t } = useLocale();
  return (
    <section className="nl-band nc-op-detail" aria-label={t("band.aria")}>
      <LoadingStack label={t("band.readingState")} />
    </section>
  );
}

function Band({ dataset }: { dataset: CommandDataset }) {
  const { state } = useCommandData();
  const { t, tc } = useLocale();
  if (state === "loading") return <LoadingStack label={t("band.readingState")} />;

  const workforce = workforceStatus(dataset);
  const health = systemHealth(dataset);
  const attention = dataset.systems
    .filter((s) => s.state !== "CONNECTED" && s.state !== "PARTIAL")
    .slice(0, 4);
  const recent = dataset.activity.slice(0, 6);

  return (
    <div className="nl-band__inner nc-op-detail__body">
      {/* The three sections hold the band's 12-column grid in pairs: workforce
          next to the systems, and the activity log across the foot — one calm
          block, not a stack of eleven panels. */}
      <>
        <Section
          title={t("band.workforce")}
          count={workforce.total}
          span={6}
          hint={t("band.workforceHint", {
            carrying: workforce.active + workforce.thinking,
            load: workforce.averageUtilisation,
          })}
          action={<LabButton href="/command/workforce">{t("band.openWorkforce")}</LabButton>}
        >
          <div className="nl-rows">
            {dataset.agents
              .filter((a) => a.tier === "director" || a.tier === "executive")
              .slice(0, 6)
              .map((agent) => {
                const meta = AGENT_STATUS_META[agent.status];
                return (
                  <Link
                    key={agent.id}
                    href={agentHref(agent.id)}
                    className="nl-line"
                    style={tone(meta.tone)}
                  >
                    <Avatar
                      initials={agent.initials}
                      kind={agent.kind}
                      tone={agent.kind === "human" ? "--nc-human" : "--nc-lime"}
                      size={28}
                    />
                    <span className="nl-line__stack">
                      <span className="nl-line__title">{tc(agent.name)}</span>
                      <span className="nl-line__meta">{tc(agent.currentFocus)}</span>
                    </span>
                    <Pill label={t(`status.agent.${agent.status}`)} tone={meta.tone} />
                  </Link>
                );
              })}
          </div>
        </Section>

        <Section
          title={t("band.systemHealth")}
          count={health.total}
          span={6}
          hint={t("band.systemHealthHint", { usable: health.usable, degraded: health.degraded })}
          action={<LabButton href="/command/systems">{t("band.openMap")}</LabButton>}
        >
          <div className="nl-rows">
            {attention.length === 0 ? (
              <Note>{t("band.allConnected")}</Note>
            ) : (
              attention.map((system) => {
                const meta = SYSTEM_STATE_META[system.state];
                return (
                  <Link
                    key={system.id}
                    href="/command/systems"
                    className="nl-line"
                    style={tone(meta.tone)}
                  >
                    <span className="nl-mark" aria-hidden="true">
                      {system.name.slice(0, 2).toUpperCase()}
                    </span>
                    <span className="nl-line__stack">
                      <span className="nl-line__title">{system.name}</span>
                      <span className="nl-line__meta">{tc(system.stateDetail)}</span>
                    </span>
                    <Pill label={t(`status.system.${system.state}`)} tone={meta.tone} />
                  </Link>
                );
              })
            )}
          </div>
        </Section>

        <Section
          title={t("band.recent")}
          count={dataset.activity.length}
          span={12}
          hint={t("band.recentHint")}
          action={<LabButton href="/command/activity">{t("band.allActivity")}</LabButton>}
        >
          <div className="nl-rows">
            {recent.map((event) => {
              const meta = ACTIVITY_KIND_META[event.kind];
              const department = event.departmentId ? DEPARTMENT_BY_ID[event.departmentId] : null;
              return (
                <Link
                  key={event.id}
                  href={event.missionId ? missionHref(event.missionId) : "/command/activity"}
                  className="nl-line"
                  style={tone(department?.accentVar ?? meta.tone)}
                >
                  <span className="nl-line__stack">
                    <span className="nl-line__title">{tc(event.actor)}</span>
                    <span className="nl-line__meta">{tc(event.text)}</span>
                  </span>
                  <span className="nl-line__load">{tc(event.at)}</span>
                </Link>
              );
            })}
          </div>
        </Section>
      </>
    </div>
  );
}
