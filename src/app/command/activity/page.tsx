"use client";

import Link from "next/link";
import { useState } from "react";
import { DEPARTMENT_BY_ID, DEPARTMENT_IDS } from "@/components/command/state/organization-model";
import { missionHref } from "@/components/command/lab/areas";
import { useLocale } from "@/components/command/i18n/command-locale";
import { LabData, LabFrame, Note, Pill, Section, Split, tone } from "@/components/command/lab/kit";
import { ACTIVITY_KIND_META, activityByKind } from "@/components/command/state/demo/selectors";
import type { ActivityEvent, ActivityKind, CommandDataset } from "@/components/command/state/demo/types";

/**
 * ACTIVITY & AUDIT — one timeline
 * ──────────────────────────────
 * Human actions, agent actions, mission transitions, approvals, finance events and
 * system events, in one ordered stream. The point of this surface is that there
 * is no second history: the decision log, the mission timeline and the audit
 * trail are the same events, filtered differently.
 *
 * Severity is shown as a material change on the entry, not as a colour-coded
 * alarm: a warning is a warning because the text says what is at stake.
 */

const SEVERITY_TONE: Record<ActivityEvent["severity"], string> = {
  info: "--nc-text-3",
  notice: "--nc-thinking",
  warning: "--nc-approval",
  critical: "--nc-error",
};

export default function ActivityPage() {
  const { tc } = useLocale();
  return (
    <LabFrame areaId="activity">
      <LabData
        emptyTitle={tc("No activity yet.")}
        emptyBody={tc("The audit timeline is empty because nothing has happened in this organization.")}
      >
        {(dataset) => <Activity dataset={dataset} />}
      </LabData>
    </LabFrame>
  );
}

function Activity({ dataset }: { dataset: CommandDataset }) {
  const { t, tc } = useLocale();
  const [kind, setKind] = useState<"all" | ActivityKind>("all");
  const [department, setDepartment] = useState<"all" | string>("all");

  const groups = activityByKind(dataset);
  const events = dataset.activity.filter(
    (event) => (kind === "all" || event.kind === kind) && (department === "all" || event.departmentId === department),
  );

  const counts = dataset.activity.reduce<Record<string, number>>((acc, event) => {
    acc[event.kind] = (acc[event.kind] ?? 0) + 1;
    return acc;
  }, {});

  const escalations = dataset.activity.filter((e) => e.severity === "critical" || e.severity === "warning");

  return (
    <>
      <div className="nl-figures" role="list">
        {[
          { id: "total", value: String(dataset.activity.length), label: "Events", note: "in the current window", tone: "--nc-network" },
          { id: "humans", value: String(counts.human ?? 0), label: "Human actions", note: "authority being exercised", tone: "--nc-human" },
          { id: "agents", value: String(counts.agent ?? 0), label: "Agent actions", note: "work moving without a gate", tone: "--nc-lime" },
          { id: "approvals", value: String(counts.approval ?? 0), label: "Approvals", note: "gates raised or settled", tone: "--nc-approval" },
          { id: "faults", value: String((counts.error ?? 0)), label: "Errors", note: "things that stopped", tone: counts.error ? "--nc-error" : "--nc-completed" },
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
          <Section title={tc("Timeline")} count={events.length} span={12} hint={tc("most recent first")}>
            <div className="nl-filters">
              <div className="nl-chips" role="group" aria-label={t("activity.kindAria")}>
                <button
                  type="button"
                  className="nl-chip"
                  data-active={kind === "all"}
                  aria-pressed={kind === "all"}
                  onClick={() => setKind("all")}
                >
                  {t("common.all")}
                  <span className="nl-chip__count">{dataset.activity.length}</span>
                </button>
                {groups.map((group) => (
                  <button
                    key={group.kind}
                    type="button"
                    className="nl-chip"
                    data-active={kind === group.kind}
                    aria-pressed={kind === group.kind}
                    onClick={() => setKind(group.kind)}
                  >
                    {t(`status.activity.${group.kind}`)}
                    <span className="nl-chip__count">{group.events.length}</span>
                  </button>
                ))}
              </div>

              <div className="nl-chips" role="group" aria-label={t("activity.departmentAria")}>
                <button
                  type="button"
                  className="nl-chip"
                  data-active={department === "all"}
                  aria-pressed={department === "all"}
                  onClick={() => setDepartment("all")}
                >
                  {tc("All departments")}
                </button>
                {DEPARTMENT_IDS.map((id) => (
                  <button
                    key={id}
                    type="button"
                    className="nl-chip"
                    data-active={department === id}
                    aria-pressed={department === id}
                    onClick={() => setDepartment(id)}
                  >
                    {t(`dept.${id}.short`)}
                  </button>
                ))}
              </div>
            </div>

            {events.length === 0 ? (
              <Note>{tc("No event matches this filter. The full timeline is one click away.")}</Note>
            ) : (
              <ol className="nl-audit">
                {events.map((event) => {
                  const meta = ACTIVITY_KIND_META[event.kind];
                  const departmentName = event.departmentId
                    ? (DEPARTMENT_BY_ID[event.departmentId]
                        ? t(`dept.${event.departmentId}.name`)
                        : event.departmentId)
                    : "";
                  return (
                    <li key={event.id} className="nl-audit__item" style={tone(SEVERITY_TONE[event.severity])}>
                      <span className="nl-audit__when">
                        <span className="nl-audit__at">{tc(event.at)}</span>
                        <span className="nl-audit__clock">{event.time}</span>
                      </span>
                      <span className="nl-audit__body">
                        <span className="nl-audit__meta">
                          <Pill label={t(`status.activity.${event.kind}`)} tone={meta.tone} />
                          <span className="nl-audit__actor">{tc(event.actor)}</span>
                          <span className="nl-audit__kind">
                            {t(event.actorKind === "human" ? "activity.human" : "activity.agent")}
                            {departmentName ? ` · ${departmentName}` : ""}
                          </span>
                        </span>
                        <span className="nl-audit__text">{tc(event.text)}</span>
                        <span className="nl-audit__links">
                          {event.missionId && (
                            <Link href={missionHref(event.missionId)} className="nl-inlinelink">
                              {t("common.open_mission")}
                            </Link>
                          )}
                          {event.href && event.kind === "approval" && (
                            <Link href={event.href} className="nl-inlinelink">
                              {tc("Open the decision")}
                            </Link>
                          )}
                          {event.href && event.kind === "system" && (
                            <Link href={event.href} className="nl-inlinelink">
                              {t("common.open_map")}
                            </Link>
                          )}
                        </span>
                      </span>
                    </li>
                  );
                })}
              </ol>
            )}
          </Section>
        }
        aside={
          <>
            <Section
              title={tc("Needs attention")}
              count={escalations.length}
              span={12}
              hint={tc("warnings and critical events")}
            >
              <div className="nl-rows">
                {escalations.slice(0, 7).map((event) => (
                  <div key={event.id} className="nl-line" style={tone(SEVERITY_TONE[event.severity])}>
                    <span className="nl-line__stack">
                      <span className="nl-line__title">{tc(event.actor)}</span>
                      <span className="nl-line__meta">{tc(event.text)}</span>
                    </span>
                    <span className="nl-line__load">{tc(event.at)}</span>
                  </div>
                ))}
                {escalations.length === 0 && <Note>{tc("Nothing in this window needs a human.")}</Note>}
              </div>
            </Section>

            <Section title={tc("By source")} span={12}>
              <div className="nl-rows">
                {groups.map((group) => (
                  <div key={group.kind} className="nl-line" style={tone(ACTIVITY_KIND_META[group.kind].tone)}>
                    <span className="nl-line__stack">
                      <span className="nl-line__title">{t(`status.activity.${group.kind}`)}</span>
                      <span className="nl-line__meta">
                        {t("activity.countsHint", {
                          human: group.events.filter((e) => e.actorKind === "human").length,
                          agent: group.events.filter((e) => e.actorKind === "agent").length,
                        })}
                      </span>
                    </span>
                    <span className="nl-line__load">{group.events.length}</span>
                  </div>
                ))}
              </div>
            </Section>

            <Section title={tc("What this timeline is")} span={12}>
              <Note>
                {tc(
                  "The same events the Decision Center and each mission's own activity read. There is no second audit trail to reconcile, which is the point: a founder, a mission and a decision all describe one history.",
                )}
              </Note>
              <Note>
                {tc(
                  "Events are typed demo data in this worktree. The durable execution record it would eventually read lives in the workforce module and is deliberately not connected here.",
                )}
              </Note>
            </Section>
          </>
        }
      />
    </>
  );
}
