"use client";

import Link from "next/link";
import { useState } from "react";
import { DEPARTMENT_BY_ID } from "@/components/command/state/organization-model";
import { agentHref, missionHref } from "@/components/command/lab/areas";
import { useLocale } from "@/components/command/i18n/command-locale";
import {
  Avatar,
  LabData,
  LabFrame,
  Note,
  Pill,
  Section,
  Split,
  tone,
} from "@/components/command/lab/kit";
import { useCommand } from "@/components/command/state/command-store";
import { useCommandData } from "@/components/command/state/demo/command-data-store";
import {
  RISK_META,
  decisionHistory,
  decisionQueue,
  decisionRiskSummary,
} from "@/components/command/state/demo/selectors";
import type { CommandDataset, Decision } from "@/components/command/state/demo/types";

/**
 * DECISION CENTER — the approval queue
 * ────────────────────────────────────
 * The one surface where a human's authority is exercised. Each card states the
 * requested action, what it costs if it goes ahead, which policy raised the gate
 * and who asked — in that order, because that is the order a founder reads them.
 *
 * Approve and reject mutate the LOCAL dataset only, and the page says so out
 * loud in the confirmation and in the footer note. The real approval loop lives
 * in the existing workforce module and is deliberately not connected here.
 *
 * PASS 2 — risk words come from `status.risk.*` so a card and the page summary
 * cannot disagree; the copy around them resolves through `tc`.
 */

export default function DecisionsPage() {
  const { tc } = useLocale();
  return (
    <LabFrame areaId="decisions">
      <LabData
        emptyTitle={tc("Nothing is waiting on you")}
        emptyBody={tc(
          "Every decision in this organization has been settled. The queue is where held work appears the moment an agent reaches a gate.",
        )}
      >
        {(dataset) => <DecisionCenter dataset={dataset} />}
      </LabData>
    </LabFrame>
  );
}

function DecisionCenter({ dataset }: { dataset: CommandDataset }) {
  const { t, tc } = useLocale();
  const queue = decisionQueue(dataset);
  const history = decisionHistory(dataset);
  const summary = decisionRiskSummary(dataset);

  return (
    <>
      <div className="nl-figures" role="list">
        {[
          { id: "pending", value: String(summary.total), label: "Waiting on you", note: "ordered by risk", tone: "--nc-approval" },
          { id: "critical", value: String(summary.critical), label: "Critical", note: "irreversible or autonomy-widening", tone: "--nc-error" },
          { id: "high", value: String(summary.high), label: "High", note: "money, clients or a supplier", tone: "--nc-blocked" },
          { id: "settled", value: String(history.length), label: "Settled", note: "kept with the reason", tone: "--nc-completed" },
        ].map((figure) => (
          <div key={figure.id} role="listitem" className="nl-figure" style={tone(figure.tone)}>
            <span className="nl-figure__value">{figure.value}</span>
            <span className="nl-figure__label">{tc(figure.label)}</span>
            <span className="nl-figure__note">{tc(figure.note)}</span>
          </div>
        ))}
      </div>

      <Split
        primary={
          <>
            <Section
              title={tc("Pending approvals")}
              count={queue.length}
              span={12}
              hint={tc("highest risk first — the order to work them in")}
            >
              {queue.length === 0 ? (
                <Note>
                  {tc(
                    "Nothing is waiting. That is the state this queue is designed to reach: decisions made, or made unnecessary.",
                  )}
                </Note>
              ) : (
                <div className="nl-decisions" aria-label={t("decisions.queueAria")}>
                  {queue.map((decision) => (
                    <DecisionCard key={decision.id} decision={decision} dataset={dataset} />
                  ))}
                </div>
              )}
            </Section>
          </>
        }
        aside={
          <>
            <Section title={tc("Risk mix")} span={12}>
              <div className="nl-rows">
                {(["critical", "high", "medium", "low"] as const).map((risk) => {
                  const meta = RISK_META[risk];
                  const count = queue.filter((d) => d.risk === risk).length;
                  return (
                    <div key={risk} className="nl-line" style={tone(meta.tone)}>
                      <span className="nl-line__stack">
                        <span className="nl-line__title">{t(`status.risk.${risk}`)}</span>
                        <span className="nl-line__meta">
                          {count === 0 ? tc("nothing at this level") : t("decisions.waitingCount", { count })}
                        </span>
                      </span>
                      <span className="nl-line__load">{count}</span>
                    </div>
                  );
                })}
              </div>
            </Section>

            <Section
              title={tc("History")}
              count={history.length}
              span={12}
              hint={tc("every settled decision keeps its reason")}
            >
              <div className="nl-rows">
                {history.map((decision) => (
                  <div key={decision.id} className="nl-line" data-state={decision.status}>
                    <span className="nl-line__stack">
                      <span className="nl-line__title">{tc(decision.title)}</span>
                      <span className="nl-line__meta">
                        {t(`status.decision.${decision.status}`)} · {decision.decidedAt ?? decision.createdAt} ·{" "}
                        {decision.decidedBy ? tc(decision.decidedBy) : "—"}
                      </span>
                    </span>
                  </div>
                ))}
              </div>
            </Section>

            <Section title={tc("How authority works here")} span={12}>
              <Note>
                {tc(
                  "A gate exists when an action is above a policy limit: money, a client promise, public distribution, a vendor contract or autonomy. Agents stop at the gate. Only a human clears it, and the record keeps who decided and why.",
                )}
              </Note>
              <Note>
                {tc(
                  "Approving or rejecting here changes local demo state only — the real approval loop is in the existing workforce module and this prototype is not connected to it.",
                )}
              </Note>
            </Section>
          </>
        }
      />
    </>
  );
}

function DecisionCard({ decision, dataset }: { decision: Decision; dataset: CommandDataset }) {
  const { t, tc } = useLocale();
  const { decide } = useCommandData();
  const { notify } = useCommand();
  const [note, setNote] = useState("");
  const [settled, setSettled] = useState<null | "approved" | "rejected">(null);

  const meta = RISK_META[decision.risk];
  const mission = dataset.missions.find((m) => m.id === decision.missionId);
  const department = DEPARTMENT_BY_ID[decision.departmentId];
  const requester = decision.requestingAgentId
    ? dataset.agents.find((a) => a.id === decision.requestingAgentId)
    : undefined;

  const title = tc(decision.title);

  const settle = (outcome: "approved" | "rejected") => {
    decide(decision.id, outcome, note.trim() || undefined);
    setSettled(outcome);
    notify(t(outcome === "approved" ? "decisions.approved" : "decisions.rejected", { title }));
  };

  return (
    <article className="nl-decision" data-state={settled ?? "pending"} style={tone(meta.tone)}>
      <div>
        <div className="nl-decision__tags">
          <Pill label={t("decisions.riskPill", { level: t(`status.risk.${decision.risk}`) })} tone={meta.tone} />
          <Pill
            label={department ? t(`dept.${department.id}.name`) : decision.departmentId}
            tone={department?.accentVar ?? "--nc-network"}
            dot={false}
          />
          {mission && (
            <Link href={missionHref(mission.id)} className="nl-decision__mission">
              {mission.code} · {tc(mission.title)}
            </Link>
          )}
        </div>

        <h3 className="nl-decision__title" style={{ marginTop: 10 }}>
          {title}
        </h3>
        <p className="nl-decision__action">{tc(decision.requestedAction)}</p>
        <p className="nl-decision__impact">
          <span className="nl-decision__impactlabel">{tc("If it goes ahead")}</span> {tc(decision.impact)}
        </p>
        <div className="nl-decision__tags">
          <span className="nl-decisions__policy">
            {t("common.policy")} · {tc(decision.policy)}
          </span>
          <span className="nl-decisions__policy">{t("decisions.raised", { at: decision.createdAt })}</span>
        </div>
      </div>

      <div className="nl-decision__side">
        <div className="nl-decision__who">
          <Avatar
            initials={requester?.initials ?? "FN"}
            kind={requester?.kind ?? "human"}
            tone={requester ? "--nc-lime" : "--nc-human"}
            size={32}
          />
          <span className="nl-cellstack">
            <span className="nl-cell__title">{tc(decision.requestedBy)}</span>
            <span className="nl-cell__meta">
              {requester ? (
                <Link href={agentHref(requester.id)} className="nl-inlinelink">
                  {tc(requester.role)}
                </Link>
              ) : (
                tc("Human request")
              )}
            </span>
          </span>
        </div>

        {settled ? (
          <div className="nl-settled" data-state={settled}>
            <Pill
              label={t(`status.decision.${settled}`)}
              tone={settled === "approved" ? "--nc-completed" : "--nc-error"}
            />
            <span className="nl-settled__text">{t("decisions.settled", { title })}</span>
          </div>
        ) : (
          <>
            <textarea
              className="nl-decision__note"
              placeholder={tc("Reason (kept with the record — required for a reject)")}
              value={note}
              onChange={(event) => setNote(event.target.value)}
              aria-label={t("decisions.noteAria", { title })}
            />
            <div className="nl-decision__buttons">
              <button type="button" className="nl-btn" data-variant="primary" onClick={() => settle("approved")}>
                {tc("Approve")}
              </button>
              <button type="button" className="nl-btn" data-variant="danger" onClick={() => settle("rejected")}>
                {tc("Reject")}
              </button>
            </div>
          </>
        )}
      </div>
    </article>
  );
}
