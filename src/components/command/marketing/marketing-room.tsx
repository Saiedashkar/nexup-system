"use client";

import Link from "next/link";
import { useMemo, useRef, useState, type ComponentType } from "react";
import { useLocale } from "../i18n/command-locale";
import {
  IconActivity,
  IconAgent,
  IconCheck,
  IconChevronRight,
  IconDeptGrowth,
  IconHuman,
  IconSend,
  IconSpark,
  type IconProps,
} from "../ui/icons";
import { MARKETING_COPY } from "./campaign-copy";
import { noticeFrom, type CampaignNotice } from "./campaign-notice";
import {
  STATION_ORDER,
  analysisKey,
  approveBrief,
  approveDraft,
  editDraft,
  initialCampaign,
  nextStep,
  requestSchedule,
  selectSlot,
  stationStates,
  teamStates,
  type CampaignState,
  type SlotId,
  type StationId,
  type TeamRoleId,
} from "./campaign-model";
import { createDemoScheduleConnector } from "./schedule-connector";
import { StationWork } from "./station-work";

/**
 * NEXUP COMMAND — MARKETING ROOM
 * ────────────────────────────────────────────────────────────────────────────
 * ROUTE: `/command/marketing`
 *
 * One campaign, worked IN the room instead of being described by it. The three
 * stations are the three pieces of work — strategy, content, publish review —
 * and each one opens its own panel directly underneath the orbit. The decisions
 * panel, the team strip and the analysis line all read the same `nextStep`
 * derivation, so the room can never claim two different next steps at once.
 *
 * The whole flow is local:
 *
 *   brief → draft (edited by hand) → approval → slot → scheduling request
 *
 * with the two honest edges this pass had to get right: an accepted schedule is
 * NOT a publication, and editing the text after approval cancels the approval.
 *
 * Boundaries: this component is a leaf on the Product surface. It does not touch
 * the shell, the navigation, the login, the database, X or any provider, and it
 * writes no file outside `components/command/marketing` and its own route.
 */

const STATION_ICONS: Record<StationId, ComponentType<IconProps>> = {
  strategy: IconDeptGrowth,
  content: IconSpark,
  publish: IconSend,
};

const TEAM_ORDER: TeamRoleId[] = ["manager", "strategy", "content", "publish"];

export function MarketingRoom() {
  const { locale } = useLocale();
  const copy = MARKETING_COPY[locale];

  /* One connector for the life of the room. Replacing the demo with a real
     integration is this line — the model and the UI stay as they are. */
  const connector = useMemo(() => createDemoScheduleConnector(), []);

  const [campaign, setCampaign] = useState<CampaignState>(() =>
    initialCampaign(copy.content.seedDraft),
  );
  const [station, setStation] = useState<StationId>("strategy");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<CampaignNotice | null>(null);
  const draftRef = useRef<HTMLTextAreaElement | null>(null);

  const step = nextStep(campaign);
  const stations = stationStates(campaign);
  const team = teamStates(campaign);

  const openManualDraft = () => {
    setStation("content");
    /* Moving the reader into the field they were just invited to. */
    window.requestAnimationFrame(() => draftRef.current?.focus());
  };

  const handleApproveBrief = () => {
    setCampaign((current) => approveBrief(current));
    setStation("content");
    setNotice(null);
  };

  const handleDraftChange = (text: string) => {
    setCampaign((current) => editDraft(current, text));
    setNotice(null);
  };

  const handleGenerate = () => {
    const seed = copy.content.seedDraft;
    const alternate = copy.content.alternateDraft;
    setCampaign((current) =>
      editDraft(current, current.draft.trim() === seed.trim() ? alternate : seed),
    );
    setNotice(null);
  };

  const handleApproveDraft = () => {
    setCampaign((current) => approveDraft(current));
    setNotice(null);
  };

  const handleSelectSlot = (slotId: SlotId) => {
    setCampaign((current) => selectSlot(current, slotId));
    setNotice(null);
  };

  const handleRequestSchedule = async () => {
    if (busy) return;
    setBusy(true);
    const { state, outcome } = await requestSchedule(campaign, connector);
    setCampaign(state);
    setBusy(false);
    setNotice(noticeFrom(outcome, copy));
  };

  const handleReset = () => {
    setCampaign(initialCampaign(copy.content.seedDraft));
    setStation("strategy");
    setNotice(null);
  };

  return (
    <div className="nc-mk">
      <header className="nc-mk__head">
        <div className="nc-mk__head-main">
          <nav className="nc-mk__crumbs" aria-label={copy.breadcrumbAria}>
            <Link href="/command">{copy.breadcrumbRoot}</Link>
            <IconChevronRight size={12} />
            <Link href="/command/sales">{copy.breadcrumbHere}</Link>
          </nav>
          <p className="nc-mk__kicker">{copy.kicker}</p>
          <h1 className="nc-mk__title">{copy.title}</h1>
          <p className="nc-mk__subtitle">{copy.subtitle}</p>
        </div>

        <div className="nc-mk__head-side">
          <span className="nc-mk__badge" data-tone="demo">
            {copy.demoBadge}
          </span>
          <button
            type="button"
            className="nc-btn nc-btn--ghost nc-btn--sm"
            data-action="reset"
            onClick={handleReset}
            title={copy.resetHint}
          >
            {copy.reset}
          </button>
        </div>
      </header>

      <div className="nc-mk__grid">
        <section className="nc-mk__stagecol" aria-label={copy.stationsAria}>
          <div className="nc-mk__campaign">
            <span className="nc-mk__campaign-label">{copy.campaignLabel}</span>
            <b className="nc-mk__campaign-name">{copy.campaignName}</b>
            <span className="nc-mk__campaign-meta">{copy.campaignMeta}</span>
          </div>

          <div className="nc-mk__stage" data-step={step.step}>
            <span className="nc-mk__planet" aria-hidden="true" />
            <span className="nc-mk__ring" data-ring="outer" aria-hidden="true" />
            <span className="nc-mk__ring" data-ring="mid" aria-hidden="true" />
            <span className="nc-mk__ring" data-ring="inner" aria-hidden="true" />
            <span className="nc-mk__rim" aria-hidden="true" />

            <div className="nc-mk__stations" role="group" aria-label={copy.stationsAria}>
              {STATION_ORDER.map((id) => {
                const StationIcon = STATION_ICONS[id];
                const visual = stations[id];
                const current = station === id;
                return (
                  <button
                    key={id}
                    type="button"
                    className="nc-mk__station"
                    data-station={id}
                    data-state={visual}
                    data-current={current}
                    aria-pressed={current}
                    aria-label={copy.stations[id].open}
                    onClick={() => setStation(id)}
                  >
                    <span className="nc-mk__role">
                      <i aria-hidden="true" />
                      {copy.stations[id].role}
                    </span>

                    <span className="nc-mk__screen" aria-hidden="true">
                      <span className="nc-mk__screen-bar" />
                      <span className="nc-mk__screen-icon">
                        <StationIcon size={22} />
                      </span>
                      <span className="nc-mk__screen-lines" />
                    </span>

                    <span className="nc-mk__plate">
                      <span className="nc-mk__plate-name">{copy.stations[id].name}</span>
                      <span className="nc-mk__plate-hint">{copy.stations[id].hint}</span>
                      <span className="nc-mk__state" data-state={visual}>
                        <i aria-hidden="true" />
                        {copy.states[visual]}
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="nc-mk__analysis" data-step={step.step}>
            <span className="nc-mk__analysis-label">
              <IconActivity size={14} />
              {copy.analysis.label}
            </span>
            <p className="nc-mk__analysis-text">{copy.analysis[analysisKey(campaign)]}</p>
          </div>
        </section>

        <aside className="nc-mk__decisions" aria-labelledby="nc-mk-decisions-title">
          <header className="nc-mk__decisions-head">
            <h2 className="nc-mk__decisions-title" id="nc-mk-decisions-title">
              {copy.decisions.title}
            </h2>
            <p className="nc-mk__decisions-sub">{copy.decisions.subtitle}</p>
          </header>

          <dl className="nc-mk__decisions-list">
            <div className="nc-mk__decision">
              <dt>{copy.decisions.missionLabel}</dt>
              <dd>{copy.decisions.mission}</dd>
            </div>
            <div className="nc-mk__decision">
              <dt>{copy.decisions.ownerLabel}</dt>
              <dd>{copy.team.members[step.owner].name}</dd>
            </div>
            <div className="nc-mk__decision" data-next="true">
              <dt>{copy.decisions.nextLabel}</dt>
              <dd>{copy.stepNames[step.step]}</dd>
            </div>
          </dl>

          <div className="nc-mk__actions">
            <button
              type="button"
              className="nc-btn nc-btn--lime"
              onClick={() => setStation("publish")}
              title={copy.decisions.reviewHint}
            >
              {copy.decisions.review}
            </button>
            <button
              type="button"
              className="nc-btn nc-btn--ghost"
              onClick={openManualDraft}
              title={copy.decisions.manualHint}
            >
              {copy.decisions.manual}
            </button>
          </div>
        </aside>
      </div>

      <StationWork
        copy={copy}
        campaign={campaign}
        station={station}
        busy={busy}
        notice={notice}
        connectorLabel={`${connector.label} · ${connector.mode}`}
        draftRef={draftRef}
        onOpenStation={setStation}
        onApproveBrief={handleApproveBrief}
        onDraftChange={handleDraftChange}
        onGenerateDraft={handleGenerate}
        onApproveDraft={handleApproveDraft}
        onSelectSlot={handleSelectSlot}
        onRequestSchedule={handleRequestSchedule}
      />

      <section className="nc-mk__team" aria-labelledby="nc-mk-team-title">
        <header className="nc-mk__team-head">
          <div>
            <h2 className="nc-mk__team-title" id="nc-mk-team-title">
              {copy.team.title}
            </h2>
            <p className="nc-mk__team-sub">{copy.team.subtitle}</p>
          </div>
        </header>

        <ul className="nc-mk__team-list" aria-label={copy.team.aria}>
          {TEAM_ORDER.map((role) => {
            const member = copy.team.members[role];
            const owns = step.owner === role;
            const AgentIcon = role === "manager" ? IconHuman : IconAgent;
            return (
              <li key={role} className="nc-mk__member" data-owner={owns} data-kind={role}>
                <span className="nc-mk__avatar" aria-hidden="true">
                  <AgentIcon size={18} />
                </span>
                <span className="nc-mk__member-text">
                  <b>{member.name}</b>
                  <span>{member.role}</span>
                  <span className="nc-mk__member-state" data-state={team[role]}>
                    <i aria-hidden="true" />
                    {copy.team.statusWords[team[role]]}
                  </span>
                </span>
                {owns ? <span className="nc-mk__owner-tag">{copy.team.ownerTag}</span> : null}
              </li>
            );
          })}
        </ul>
      </section>

      <section className="nc-mk__notes" aria-labelledby="nc-mk-notes-title">
        <h2 className="nc-mk__notes-title" id="nc-mk-notes-title">
          <IconCheck size={14} />
          {copy.notes.title}
        </h2>
        <ul>
          <li>{copy.notes.local}</li>
          <li>{copy.notes.reset}</li>
          <li>{copy.notes.noProvider}</li>
          <li>{copy.notes.openRequest}</li>
        </ul>
      </section>
    </div>
  );
}
