"use client";

import type { RefObject } from "react";
import { IconCheck, IconReview, IconSpark } from "../ui/icons";
import { fill, type CampaignCopy } from "./campaign-copy";
import type { CampaignNotice } from "./campaign-notice";
import {
  SCHEDULE_SLOTS,
  STATION_ORDER,
  canApprove,
  isOverLimit,
  isRequestDisabled,
  requestBlockedReason,
  type CampaignState,
  type SlotId,
  type StationId,
} from "./campaign-model";

/**
 * THE ROOM'S WORK PANEL
 * ─────────────────────
 * The three stations open their work HERE, inside the room — strategy → brief,
 * content → the editable X draft, publish review → approval, slot and the
 * scheduling request. No station navigates away, and no station is a placeholder
 * that only raises a toast: each one changes the campaign state the others read.
 *
 * The panel is a real tablist over one panel, so a keyboard reader can move
 * between the three pieces of work without hunting for the orbit.
 */

export type StationWorkProps = {
  copy: CampaignCopy;
  campaign: CampaignState;
  station: StationId;
  busy: boolean;
  notice: CampaignNotice | null;
  connectorLabel: string;
  draftRef: RefObject<HTMLTextAreaElement | null>;
  onOpenStation: (station: StationId) => void;
  onApproveBrief: () => void;
  onDraftChange: (text: string) => void;
  onGenerateDraft: () => void;
  onApproveDraft: () => void;
  onSelectSlot: (slotId: SlotId) => void;
  onRequestSchedule: () => void;
};

function tabId(station: StationId): string {
  return `nc-mk-tab-${station}`;
}

function panelId(station: StationId): string {
  return `nc-mk-panel-${station}`;
}

export function StationWork({
  copy,
  campaign,
  station,
  busy,
  notice,
  connectorLabel,
  draftRef,
  onOpenStation,
  onApproveBrief,
  onDraftChange,
  onGenerateDraft,
  onApproveDraft,
  onSelectSlot,
  onRequestSchedule,
}: StationWorkProps) {
  const metadata = copy.stations[station];
  const approvalLabel =
    campaign.approval === "approved"
      ? copy.publish.approvalApproved
      : campaign.approval === "stale"
        ? copy.publish.approvalStale
        : copy.publish.approvalNone;
  const approveBlocked = !canApprove(campaign);
  const approveBlockedReason = !campaign.briefApproved
    ? copy.publish.approvalLocked
    : isOverLimit(campaign.draft)
      ? copy.publish.approvalTooLong
      : null;
  const editedByHand =
    campaign.approvedText !== null && campaign.draft.trim() !== campaign.approvedText;
  /* The button says why it is off; the model refuses the request for the same
     reason if it is somehow called. `busy` covers the in-flight send. */
  const requestBlocked = requestBlockedReason(campaign);
  const requestDisabled = isRequestDisabled(campaign, busy);

  return (
    <section className="nc-mk__work" aria-label={copy.work.panelAria}>
      <div className="nc-mk__tabs" role="tablist" aria-label={copy.work.tabsAria}>
        {STATION_ORDER.map((id) => (
          <button
            key={id}
            type="button"
            role="tab"
            id={tabId(id)}
            className="nc-mk__tab"
            aria-selected={station === id}
            aria-controls={panelId(id)}
            tabIndex={station === id ? 0 : -1}
            onClick={() => onOpenStation(id)}
          >
            {copy.stations[id].name}
          </button>
        ))}
      </div>

      <div
        className="nc-mk__panel"
        role="tabpanel"
        id={panelId(station)}
        aria-labelledby={tabId(station)}
        tabIndex={0}
      >
        <header className="nc-mk__panel-head">
          <div>
            <h2 className="nc-mk__panel-title">{metadata.name}</h2>
            <p className="nc-mk__panel-lead">{metadata.hint}</p>
          </div>
          <span className="nc-mk__panel-owner">
            {fill(copy.work.stepLabel, { role: metadata.role })}
          </span>
        </header>

        {station === "strategy" ? (
          <div className="nc-mk__panel-body">
            <p className="nc-mk__panel-note">{copy.strategy.lead}</p>
            <dl className="nc-mk__brief">
              {copy.strategy.fields.map((field) => (
                <div key={field.label} className="nc-mk__brief-item">
                  <dt>{field.label}</dt>
                  <dd>{field.value}</dd>
                </div>
              ))}
            </dl>
            <div className="nc-mk__panel-actions">
              <button
                type="button"
                className="nc-btn nc-btn--lime"
                data-action="approve-brief"
                onClick={onApproveBrief}
                disabled={campaign.briefApproved}
              >
                {campaign.briefApproved ? (
                  <>
                    <IconCheck size={14} />
                    {copy.strategy.approved}
                  </>
                ) : (
                  copy.strategy.approve
                )}
              </button>
              <p className="nc-mk__hint">
                {campaign.briefApproved ? copy.strategy.approvedNote : copy.strategy.locked}
              </p>
            </div>
          </div>
        ) : null}

        {station === "content" ? (
          <div className="nc-mk__panel-body">
            <p className="nc-mk__panel-note">{copy.content.lead}</p>

            <label className="nc-mk__label" htmlFor="nc-mk-draft">
              {copy.content.draftLabel}
            </label>
            <textarea
              id="nc-mk-draft"
              name="marketing-x-draft"
              ref={draftRef}
              className="nc-mk__textarea"
              value={campaign.draft}
              rows={5}
              spellCheck={false}
              aria-describedby="nc-mk-draft-hint"
              onChange={(event) => onDraftChange(event.target.value)}
            />

            <div className="nc-mk__draft-meta">
              <span className="nc-mk__counter" data-over={isOverLimit(campaign.draft)}>
                {fill(copy.content.counter, { count: campaign.draft.trim().length })}
              </span>
              {isOverLimit(campaign.draft) ? (
                <span className="nc-mk__over">{copy.content.overLimit}</span>
              ) : null}
              {editedByHand ? (
                <span className="nc-mk__tag">{copy.content.editedTag}</span>
              ) : campaign.approval === "approved" ? (
                <span className="nc-mk__tag" data-tone="ok">
                  <IconCheck size={12} />
                  {copy.content.approvedTag}
                </span>
              ) : null}
            </div>

            <p className="nc-mk__hint" id="nc-mk-draft-hint">
              {copy.content.saveHint}
            </p>

            <div className="nc-mk__panel-actions">
              <button
                type="button"
                className="nc-btn"
                data-action="generate"
                onClick={onGenerateDraft}
              >
                <IconSpark size={14} />
                {copy.content.generate}
              </button>
            </div>

            <div className="nc-mk__preview">
              <span className="nc-mk__preview-label">{copy.content.previewLabel}</span>
              <p>{campaign.draft}</p>
            </div>
          </div>
        ) : null}

        {station === "publish" ? (
          <div className="nc-mk__panel-body">
            <p className="nc-mk__panel-note">{copy.publish.lead}</p>

            <div className="nc-mk__approval">
              <span className="nc-mk__approval-version">
                {fill(copy.publish.version, { version: campaign.version })}
              </span>
              <span className="nc-mk__approval-state" data-state={campaign.approval}>
                {copy.publish.approvalLabel}: {approvalLabel}
              </span>
            </div>

            <div className="nc-mk__panel-actions">
              <button
                type="button"
                className="nc-btn nc-btn--lime"
                data-action="approve-draft"
                onClick={onApproveDraft}
                disabled={approveBlocked}
              >
                <IconReview size={14} />
                {campaign.approval === "stale" ? copy.publish.reapprove : copy.publish.approve}
              </button>
              {approveBlockedReason ? (
                <p className="nc-mk__hint">{approveBlockedReason}</p>
              ) : null}
            </div>

            <div className="nc-mk__slots-block">
              <span className="nc-mk__label">{copy.publish.slotLabel}</span>
              <div className="nc-mk__slots" role="group" aria-label={copy.publish.slotAria}>
                {SCHEDULE_SLOTS.map((slot) => (
                  <button
                    key={slot.id}
                    type="button"
                    className="nc-mk__slot"
                    data-slot={slot.id}
                    aria-pressed={campaign.slotId === slot.id}
                    data-demo-refusal={slot.demoFails}
                    onClick={() => onSelectSlot(slot.id)}
                  >
                    <span className="nc-mk__slot-dot" aria-hidden="true" />
                    <span className="nc-mk__slot-label">{copy.publish.slots[slot.id]}</span>
                  </button>
                ))}
              </div>
            </div>

            <div className="nc-mk__connector">
              <span className="nc-mk__connector-label">{copy.publish.connectorLabel}</span>
              <span className="nc-mk__connector-name">{connectorLabel}</span>
              <p className="nc-mk__hint">{copy.publish.connectorNote}</p>
            </div>

            <div className="nc-mk__panel-actions">
              <button
                type="button"
                className="nc-btn nc-btn--lime"
                data-action="request"
                data-blocked={requestBlocked ?? undefined}
                onClick={onRequestSchedule}
                disabled={requestDisabled}
                aria-busy={busy}
                aria-describedby={requestBlocked ? "nc-mk-request-reason" : undefined}
              >
                {busy
                  ? copy.publish.requesting
                  : campaign.scheduleState === "failed"
                    ? copy.publish.retry
                    : copy.publish.request}
              </button>
              {requestBlocked ? (
                <p
                  className="nc-mk__hint"
                  id="nc-mk-request-reason"
                  data-reason={requestBlocked}
                >
                  {copy.publish.blocked[requestBlocked]}
                </p>
              ) : null}
            </div>

            {notice ? (
              <div
                className="nc-mk__notice"
                data-tone={notice.tone}
                role={notice.tone === "error" ? "alert" : "status"}
                aria-live="polite"
              >
                <b>{notice.title}</b>
                <p>{notice.body}</p>
              </div>
            ) : null}

            <div className="nc-mk__publish" data-accepted={campaign.scheduleState === "accepted"}>
              <span className="nc-mk__publish-mark" aria-hidden="true">
                <IconReview size={16} />
              </span>
              <div>
                <b>{copy.publish.publishLabel}</b>
                <p>
                  {campaign.scheduleState === "accepted" && campaign.slotId
                    ? fill(copy.publish.publishAfterAccept, {
                        slot: copy.publish.slots[campaign.slotId],
                      })
                    : copy.publish.publishNever}
                </p>
              </div>
            </div>

            <section className="nc-mk__history" aria-label={copy.publish.historyLabel}>
              <h3 className="nc-mk__history-title">{copy.publish.historyLabel}</h3>
              {campaign.requests.length === 0 ? (
                <p className="nc-mk__hint">{copy.publish.historyEmpty}</p>
              ) : (
                <ul>
                  {[...campaign.requests]
                    .reverse()
                    .slice(0, 4)
                    .map((request) => (
                      <li key={request.id} className="nc-mk__history-row" data-status={request.status}>
                        <span className="nc-mk__history-slot">
                          {copy.publish.slots[request.slotId]}
                        </span>
                        <span className="nc-mk__history-status">
                          {copy.publish.requestStatus[request.status]}
                        </span>
                        <span className="nc-mk__history-meta">
                          {fill(copy.publish.attempt, { attempt: request.attempt })}
                          {request.receiptId
                            ? ` · ${request.receiptId}`
                            : request.errorCode
                              ? ` · ${request.errorCode}`
                              : ""}
                        </span>
                      </li>
                    ))}
                </ul>
              )}
            </section>
          </div>
        ) : null}
      </div>
    </section>
  );
}
