"use client";

import Link from "next/link";
import { useMemo, useState, type FormEvent } from "react";
import { useCommand } from "../state/command-store";
import { useCommandData } from "../state/demo/command-data-store";
import { useLocale } from "../i18n/command-locale";
import {
  IconArrowLeft,
  IconCheck,
  IconChevronRight,
  IconDeptGrowth,
  IconLab,
  IconMic,
  IconPanel,
  IconProject,
  IconRepeat,
  IconSend,
  IconStack,
  IconWorkforce,
} from "../ui/icons";
import type { JourneyStepId, RoleId, StationId, StatusWord } from "./copy";
import {
  DELIVERY_LINKS,
  JOURNEY_ORDER,
  STEP_OWNER,
  advance,
  advanceManually,
  assignOwner,
  canAdvance,
  currentStep,
  initialJourney,
  planDelivery,
  recordAcceptance,
  reviewOffer,
  saveOffer,
  stepForStation,
  type DeliveryChoice,
  type JourneyState,
} from "./journey";
import { useSalesCopy } from "./use-sales-copy";

/**
 * SALES OPERATING ROOM — the sales half of the Marketing & Sales gateway
 * ───────────────────────────────────────────────────────────────────────
 * ROUTE: `/command/sales/room`
 *
 * The composition, in this order and no other:
 *
 *   1. HEADER — the room's name, its parent ("Leadership / Marketing & Sales")
 *      and the "demo preview" badge, because nothing on this page is a record;
 *   2. THE STAGE — three glass stations on one platform (qualify, follow up,
 *      offer), the task under way above them, and the gate to Clients & Projects
 *      at their side. EVERY STATION IS A BUTTON: pressing it turns the decisions
 *      card to that station's owner and opens that station's step, which is what
 *      makes the picture an instrument instead of an illustration;
 *   3. YOUR DECISIONS — the one task, its owner and the next step, with the two
 *      verbs the room actually offers (review the draft / complete manually);
 *   4. THE TEAM — four roles and what each is doing right now, driven by the
 *      journey so a person can never look busy while the work has moved on;
 *   5. THE JOURNEY — five steps, each with its own owner and its own gate;
 *   6. THE COMPOSER — addressed to the department manager, and honest that it
 *      sends nothing.
 *
 * WHAT THIS PAGE IS NOT. It does not create a CRM. It reads the shape of the
 * NEXUP System hand-off (clients, projects) and points at those existing routes;
 * it writes no client, project, offer or activity record anywhere. The journey is
 * React state for the life of the tab, and the copy says so twice.
 *
 * Everything is scoped to the `nxs-` layer (`app/command/sales.css`) and reads
 * the approved COMMAND tokens — champagne edges, smoked glass, one mint action.
 */
export function SalesRoom() {
  const copy = useSalesCopy();
  const { tc } = useLocale();
  const { notify } = useCommand();
  const { dataset } = useCommandData();

  /* The journey is the page's one piece of state that matters. Seeded lazily so
     the draft starts in the reader's language on first paint. */
  const [journey, setJourney] = useState<JourneyState>(() => initialJourney(copy.room.offerDraft));
  const [openStep, setOpenStep] = useState<JourneyStepId | null>(null);
  const [ownerDraft, setOwnerDraft] = useState<RoleId>(STEP_OWNER.qualify);
  const [followUpDraft, setFollowUpDraft] = useState("");
  const [offerDraft, setOfferDraft] = useState(copy.room.offerDraft);
  const [choice, setChoice] = useState<DeliveryChoice>("existing");
  const [clientDraft, setClientDraft] = useState("");
  const [projectDraft, setProjectDraft] = useState("");
  const [askDraft, setAskDraft] = useState("");

  const existingClients = useMemo(
    () => (dataset?.clients ?? []).slice(0, 4).map((client) => ({ id: client.id, name: tc(client.name) })),
    [dataset, tc],
  );

  const current = currentStep(journey);
  /* What the reader opened, or the step that is actually current. Inspecting an
     earlier station never moves the work — the card says so out loud. */
  const viewed: JourneyStepId = openStep ?? (current === "done" ? "deliver" : current);
  const inspected = current !== "done" && openStep !== null && openStep !== current;
  const gateOpen = canAdvance(journey);

  const stationStatus = (station: StationId): StatusWord => {
    const index = JOURNEY_ORDER.indexOf(stepForStation(station));
    if (journey.stepIndex > index) return "done";
    if (journey.stepIndex === index) {
      return station === "offer" && journey.offerReviewed ? "approval" : "working";
    }
    return station === "follow" ? "ready" : "waiting";
  };

  const teamStatus: Record<RoleId, StatusWord> = {
    "sales-manager": "working",
    "opportunity-scout": journey.stepIndex > 0 ? "done" : "working",
    "follow-up-agent": journey.stepIndex > 1 ? "done" : journey.stepIndex === 1 ? "working" : "ready",
    "offer-manager":
      journey.stepIndex > 2
        ? "done"
        : journey.stepIndex === 2
          ? journey.offerReviewed
            ? "approval"
            : "working"
          : "waiting",
  };

  const stepState = (index: number) =>
    index < journey.stepIndex ? "done" : index === journey.stepIndex ? "current" : "pending";

  const ownerForViewed = STEP_OWNER[viewed];

  const handleManual = () => {
    setJourney(advanceManually(journey));
    setOpenStep(null);
    notify(copy.fields.manualDone);
  };

  const handleAdvance = () => {
    if (viewed !== current) return;
    setJourney(advance(journey));
    setOpenStep(null);
  };

  const handleAsk = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setAskDraft("");
    notify(copy.room.askNote);
  };

  const handleReset = () => {
    setJourney(initialJourney(copy.room.offerDraft));
    setOpenStep(null);
    setOwnerDraft(STEP_OWNER.qualify);
    setFollowUpDraft("");
    setOfferDraft(copy.room.offerDraft);
    setChoice("existing");
    setClientDraft("");
    setProjectDraft("");
  };

  return (
    <div className="nxs-room-page">
      <header className="nxs-head">
        <div className="nxs-head__lead">
          <span className="nxs-head__mark" aria-hidden="true">
            <IconDeptGrowth size={18} />
          </span>
          <div className="nxs-head__copy">
            <span className="nxs-head__kicker">{copy.kicker}</span>
            <h1 className="nxs-head__title">{copy.room.title}</h1>
            <p className="nxs-head__blurb">{copy.room.blurb}</p>
          </div>
        </div>

        <div className="nxs-head__side">
          <span className="nxs-badge" data-tone="demo">
            <i aria-hidden="true" />
            {copy.badge}
          </span>
          <Link className="nxs-back" href="/command/sales">
            <IconArrowLeft size={13} />
            {copy.common.backToGateway}
          </Link>
        </div>
      </header>

      <div className="nxs-room">
        {/* ── YOUR DECISIONS ───────────────────────────────────────────── */}
        <aside className="nxs-card nxs-dec" aria-label={copy.room.decisionsTitle}>
          <header className="nxs-card__head">
            <span className="nxs-card__mark" aria-hidden="true">
              <IconLab size={16} />
            </span>
            <div>
              <h2 className="nxs-card__title">{copy.room.decisionsTitle}</h2>
              <p className="nxs-card__note">{copy.room.decisionsNote}</p>
            </div>
          </header>

          <div className="nxs-task">
            <i className="nxs-task__dot" aria-hidden="true" />
            <span className="nxs-task__icon" aria-hidden="true">
              <IconDeptGrowth size={15} />
            </span>
            <span className="nxs-task__copy">
              <span className="nxs-task__label">{copy.room.taskLabel}</span>
              <span className="nxs-task__title">{copy.room.taskTitle}</span>
            </span>
          </div>

          <dl className="nxs-dec__kv">
            <div className="nxs-dec__row">
              <dt>{copy.room.ownerLabel}</dt>
              <dd>
                <span className="nxs-disc nxs-disc--sm" aria-hidden="true">
                  {initialsOf(copy.roles[ownerForViewed])}
                </span>
                {copy.roles[ownerForViewed]}
              </dd>
            </div>
            <div className="nxs-dec__row">
              <dt>{copy.room.nextLabel}</dt>
              <dd className="nxs-dec__next">
                <IconChevronRight size={12} />
                {copy.steps[viewed].action}
              </dd>
            </div>
          </dl>

          {inspected && (
            <p className="nxs-dec__inspect">
              {copy.room.inspectNote}{" "}
              <button type="button" className="nxs-linkbtn" onClick={() => setOpenStep(null)}>
                {copy.room.backToCurrent}
              </button>
            </p>
          )}

          <div className="nxs-actions">
            <button
              type="button"
              className="nxs-btn"
              data-variant="primary"
              onClick={() => setOpenStep("offer")}
            >
              <IconPanel size={14} />
              {copy.room.reviewDraft}
            </button>
            <button type="button" className="nxs-btn" onClick={handleManual}>
              {copy.room.finishManually}
            </button>
          </div>
        </aside>

        {/* ── THE STAGE ────────────────────────────────────────────────── */}
        <section className="nxs-stage" aria-label={copy.room.stageLabel}>
          <div className="nxs-stage__banner">
            <i aria-hidden="true" />
            <IconDeptGrowth size={15} />
            <span>{copy.room.taskTitle}</span>
          </div>

          <div className="nxs-deck">
            <span className="nxs-platform" aria-hidden="true" />

            <ol className="nxs-stations">
              {(["qualify", "follow", "offer"] as StationId[]).map((station) => {
                const status = stationStatus(station);
                const step = stepForStation(station);
                return (
                  <li key={station} className="nxs-stations__item">
                    <button
                      type="button"
                      className="nxs-station"
                      data-status={status}
                      data-open={viewed === step}
                      aria-pressed={viewed === step}
                      onClick={() => setOpenStep(step)}
                    >
                      <span className="nxs-station__disc" aria-hidden="true">
                        {stationIcon(station)}
                      </span>
                      <span className="nxs-station__label">{copy.stations[station].label}</span>
                      <span className="nxs-station__role">{copy.stations[station].role}</span>
                      <span className="nxs-station__status">
                        <i aria-hidden="true" />
                        {copy.status[status]}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ol>

            <Link className="nxs-gate" href={DELIVERY_LINKS.clients}>
              <IconArrowLeft size={13} />
              {copy.room.gateLabel}
            </Link>
          </div>
        </section>
      </div>

      {/* ── THE TEAM ─────────────────────────────────────────────────── */}
      <section className="nxs-card nxs-team" aria-label={copy.room.teamTitle}>
        <header className="nxs-card__head nxs-card__head--row">
          <span className="nxs-card__mark" aria-hidden="true">
            <IconWorkforce size={16} />
          </span>
          <div>
            <h2 className="nxs-card__title">{copy.room.teamTitle}</h2>
            <p className="nxs-card__note">{copy.room.teamNote}</p>
          </div>
        </header>

        <ul className="nxs-team__list">
          {(Object.keys(copy.roles) as RoleId[]).map((role) => (
            <li key={role} className="nxs-member" data-owner={role === ownerForViewed}>
              <span className="nxs-disc" aria-hidden="true">
                {initialsOf(copy.roles[role])}
              </span>
              <span className="nxs-member__copy">
                <span className="nxs-member__name">{copy.roles[role]}</span>
                <span className="nxs-member__status" data-status={teamStatus[role]}>
                  <i aria-hidden="true" />
                  {copy.status[teamStatus[role]]}
                </span>
              </span>
            </li>
          ))}
        </ul>
      </section>

      {/* ── THE JOURNEY ──────────────────────────────────────────────── */}
      <section className="nxs-card nxs-journey" aria-label={copy.room.journeyTitle}>
        <header className="nxs-card__head nxs-card__head--row">
          <span className="nxs-card__mark" aria-hidden="true">
            <IconStack size={16} />
          </span>
          <div>
            <h2 className="nxs-card__title">{copy.room.journeyTitle}</h2>
            <p className="nxs-card__note">{copy.room.journeyNote}</p>
          </div>
          <div className="nxs-card__tools">
            <span className="nxs-progress">
              {journey.stepIndex}/{JOURNEY_ORDER.length}
            </span>
            <button type="button" className="nxs-btn" data-variant="quiet" onClick={handleReset}>
              <IconRepeat size={13} />
              {copy.room.reset}
            </button>
          </div>
        </header>

        <ol className="nxs-rail">
          {JOURNEY_ORDER.map((step, index) => (
            <li key={step}>
              <button
                type="button"
                className="nxs-step"
                data-state={stepState(index)}
                aria-pressed={viewed === step}
                onClick={() => setOpenStep(step)}
              >
                <span className="nxs-step__index" aria-hidden="true">
                  {stepState(index) === "done" ? <IconCheck size={12} /> : index + 1}
                </span>
                <span className="nxs-step__copy">
                  <span className="nxs-step__title">{copy.steps[step].title}</span>
                  <span className="nxs-step__owner">{copy.steps[step].owner}</span>
                </span>
              </button>
            </li>
          ))}
        </ol>

        <div className="nxs-panel" data-step={viewed}>
          <header className="nxs-panel__head">
            <h3 className="nxs-panel__title">
              <span className="nxs-panel__index">{JOURNEY_ORDER.indexOf(viewed) + 1}</span>
              {copy.steps[viewed].title}
            </h3>
            <span className="nxs-panel__owner">{copy.steps[viewed].owner}</span>
          </header>
          <p className="nxs-panel__note">{copy.steps[viewed].note}</p>

          {viewed === "assign" && (
            <div className="nxs-fields">
              <div className="nxs-field">
                <span className="nxs-field__label">{copy.fields.owner}</span>
                <div className="nxs-chips" role="group" aria-label={copy.fields.owner}>
                  {(Object.keys(copy.roles) as RoleId[]).map((role) => (
                    <button
                      key={role}
                      type="button"
                      className="nxs-chip"
                      data-active={ownerDraft === role}
                      aria-pressed={ownerDraft === role}
                      onClick={() => setOwnerDraft(role)}
                    >
                      {copy.roles[role]}
                    </button>
                  ))}
                </div>
              </div>

              <label className="nxs-field">
                <span className="nxs-field__label">{copy.fields.followUpAt}</span>
                <input
                  type="date"
                  className="nxs-input"
                  value={followUpDraft}
                  onChange={(event) => setFollowUpDraft(event.target.value)}
                />
              </label>

              <button
                type="button"
                className="nxs-btn"
                onClick={() => {
                  setJourney(assignOwner(journey, ownerDraft, followUpDraft));
                  notify(copy.fields.save);
                }}
              >
                <IconCheck size={13} />
                {copy.fields.save}
              </button>
            </div>
          )}

          {viewed === "offer" && (
            <div className="nxs-fields">
              <label className="nxs-field">
                <span className="nxs-field__label">{copy.fields.offerText}</span>
                <textarea
                  className="nxs-textarea"
                  rows={5}
                  value={offerDraft}
                  onChange={(event) => setOfferDraft(event.target.value)}
                />
              </label>

              <div className="nxs-fields__row">
                <button
                  type="button"
                  className="nxs-btn"
                  onClick={() => {
                    setJourney(saveOffer(journey, offerDraft));
                    notify(copy.fields.offeredDraft);
                  }}
                >
                  {copy.fields.save}
                </button>
                <button
                  type="button"
                  className="nxs-btn"
                  data-variant={journey.offerReviewed ? "done" : "primary"}
                  onClick={() => setJourney(reviewOffer({ ...journey, offer: offerDraft }))}
                >
                  <IconCheck size={13} />
                  {journey.offerReviewed ? copy.fields.reviewed : copy.fields.markReviewed}
                </button>
              </div>
            </div>
          )}

          {viewed === "accept" && (
            <div className="nxs-fields">
              <button
                type="button"
                className="nxs-btn"
                data-variant={journey.accepted ? "done" : "primary"}
                disabled={journey.accepted}
                onClick={() => setJourney(recordAcceptance(journey))}
              >
                <IconCheck size={13} />
                {journey.accepted ? copy.fields.accepted : copy.fields.recordAcceptance}
              </button>
            </div>
          )}

          {viewed === "deliver" && (
            <div className="nxs-fields">
              <div className="nxs-chips" role="group" aria-label={copy.room.deliveryClient}>
                <button
                  type="button"
                  className="nxs-chip"
                  data-active={choice === "existing"}
                  aria-pressed={choice === "existing"}
                  onClick={() => setChoice("existing")}
                >
                  {copy.room.deliveryExisting}
                </button>
                <button
                  type="button"
                  className="nxs-chip"
                  data-active={choice === "new"}
                  aria-pressed={choice === "new"}
                  onClick={() => setChoice("new")}
                >
                  {copy.room.deliveryNew}
                </button>
              </div>

              {choice === "existing" ? (
                <div className="nxs-field">
                  <span className="nxs-field__label">{copy.room.deliveryClient}</span>
                  {existingClients.length > 0 ? (
                    <div className="nxs-chips" role="group" aria-label={copy.room.deliveryClient}>
                      {existingClients.map((client) => (
                        <button
                          key={client.id}
                          type="button"
                          className="nxs-chip"
                          data-active={clientDraft === client.name}
                          aria-pressed={clientDraft === client.name}
                          onClick={() => setClientDraft(client.name)}
                        >
                          {client.name}
                        </button>
                      ))}
                    </div>
                  ) : (
                    <p className="nxs-hint">{copy.room.deliveryNote}</p>
                  )}
                </div>
              ) : (
                <label className="nxs-field">
                  <span className="nxs-field__label">{copy.room.deliveryClient}</span>
                  <input
                    className="nxs-input"
                    value={clientDraft}
                    placeholder={copy.room.deliveryClientPlaceholder}
                    onChange={(event) => setClientDraft(event.target.value)}
                  />
                </label>
              )}

              <label className="nxs-field">
                <span className="nxs-field__label">{copy.room.deliveryProject}</span>
                <input
                  className="nxs-input"
                  value={projectDraft}
                  placeholder={copy.room.deliveryProjectPlaceholder}
                  onChange={(event) => setProjectDraft(event.target.value)}
                />
              </label>

              <button
                type="button"
                className="nxs-btn"
                data-variant="primary"
                onClick={() => setJourney(planDelivery(journey, { choice, clientName: clientDraft, projectName: projectDraft }))}
              >
                <IconProject size={13} />
                {copy.room.deliveryPreview}
              </button>

              {journey.delivery && (
                <div className="nxs-preview">
                  <h4 className="nxs-preview__title">{copy.room.deliveryTitle}</h4>
                  <p className="nxs-preview__line">
                    {journey.delivery.choice === "existing" ? copy.room.deliveryExisting : copy.room.deliveryNew} ·{" "}
                    <strong>{journey.delivery.clientName}</strong>
                  </p>
                  <p className="nxs-preview__line">
                    {copy.room.deliveryProject} · <strong>{journey.delivery.projectName}</strong>
                  </p>
                  <p className="nxs-preview__note">{copy.room.deliveryNote}</p>
                  <div className="nxs-preview__links">
                    <Link className="nxs-btn" href={DELIVERY_LINKS.clients}>
                      {copy.room.deliveryClients}
                      <IconChevronRight size={12} />
                    </Link>
                    <Link className="nxs-btn" href={DELIVERY_LINKS.projects}>
                      {copy.room.deliveryProjects}
                      <IconChevronRight size={12} />
                    </Link>
                  </div>
                </div>
              )}
            </div>
          )}

          <div className="nxs-panel__foot">
            <button
              type="button"
              className="nxs-btn"
              data-variant="primary"
              disabled={viewed !== current || !gateOpen}
              title={gateOpen ? undefined : copy.fields.gateBlocked}
              onClick={handleAdvance}
            >
              {copy.fields.advance}
              <IconChevronRight size={12} />
            </button>
            {current === "done" && <span className="nxs-done">{copy.fields.journeyDone}</span>}
            <span className="nxs-panel__hint">{copy.common.demoOnly}</span>
          </div>
        </div>
      </section>

      {/* ── THE COMPOSER ─────────────────────────────────────────────── */}
      <section className="nxs-ask" aria-label={copy.room.askTitle}>
        <span className="nxs-disc nxs-disc--sm" aria-hidden="true">
          {initialsOf(copy.roles["sales-manager"])}
        </span>
        <form className="nxs-ask__form" onSubmit={handleAsk}>
          <label className="nxs-sr" htmlFor="nxs-ask-input">
            {copy.room.askTitle}
          </label>
          <input
            id="nxs-ask-input"
            className="nxs-input nxs-ask__input"
            value={askDraft}
            placeholder={copy.room.askPlaceholder}
            onChange={(event) => setAskDraft(event.target.value)}
          />
          <button type="button" className="nxs-ask__icon" aria-label={copy.room.askTitle} tabIndex={-1}>
            <IconMic size={15} />
          </button>
          <button type="submit" className="nxs-ask__send" aria-label={copy.room.askSend}>
            <IconSend size={15} />
          </button>
        </form>
      </section>
      <p className="nxs-foot">
        {copy.room.resetNote} <span>·</span> {copy.common.notTransferable}
      </p>
    </div>
  );
}

/**
 * The monogram on the identity disc. Roles, never people.
 *
 * Latin labels take one letter from each of the first two words ("Sales
 * manager" → SM). Arabic labels take the FIRST letter only: two joined Arabic
 * letters read as a word ("مستكشف" → "ما"), and an avatar that spells a word is
 * an avatar that looks like a typo.
 */
function initialsOf(label: string): string {
  const words = label.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "—";
  if (/[\u0600-\u06FF]/.test(label)) return words[0].charAt(0);
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return `${words[0][0]}${words[1][0]}`.toUpperCase();
}

function stationIcon(station: StationId) {
  if (station === "qualify") return <IconDeptGrowth size={17} />;
  if (station === "follow") return <IconRepeat size={17} />;
  return <IconPanel size={17} />;
}
