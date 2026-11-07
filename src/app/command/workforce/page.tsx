"use client";

import Link from "next/link";
import { useState } from "react";
import { DEPARTMENT_BY_ID, DEPARTMENT_IDS } from "@/components/command/state/organization-model";
import { agentHref, departmentHref } from "@/components/command/lab/areas";
import { useLocale } from "@/components/command/i18n/command-locale";
import {
  Avatar,
  Cell,
  LabData,
  LabFrame,
  Meter,
  Note,
  Pill,
  Row,
  Section,
  Split,
  Table,
  tone,
} from "@/components/command/lab/kit";
import {
  AGENT_STATUS_META,
  agentReports,
  agentsForDepartment,
  overloadedAgents,
  workforceStatus,
} from "@/components/command/state/demo/selectors";
import type { Agent, CommandDataset } from "@/components/command/state/demo/types";

/**
 * AI WORKFORCE — the directory and the hierarchy
 * ──────────────────────────────────────────────
 * Two readings of the same 26 identities:
 *
 *   · the HIERARCHY, which is the answer to "who holds authority here?" — the
 *     executive, then the human leads, then the AI directors, then the
 *     specialists;
 *   · the DIRECTORY, which is the answer to "who is loaded, who is idle, and who
 *     is blocked?" — sortable by department and state.
 *
 * Load is shown as a meter rather than a badge, because utilisation is a range,
 * not a status. Runtime and model are shown as a REGISTRY REFERENCE, not a live
 * route: this worktree has no model router and the page says so.
 */

export default function WorkforcePage() {
  const { tc } = useLocale();
  return (
    <LabFrame areaId="workforce">
      <LabData
        emptyTitle={tc("No workforce yet")}
        emptyBody={tc(
          "Agents appear here once they are registered against a department. This organization has none.",
        )}
      >
        {(dataset) => <Workforce dataset={dataset} />}
      </LabData>
    </LabFrame>
  );
}

function Workforce({ dataset }: { dataset: CommandDataset }) {
  const { t, tc } = useLocale();
  const [department, setDepartment] = useState<string>("all");
  const status = workforceStatus(dataset);
  const overloaded = overloadedAgents(dataset);
  const executive = dataset.agents.find((a) => a.tier === "executive");
  const listed = dataset.agents
    .filter((a) => a.tier !== "executive")
    .filter((a) => department === "all" || a.scope === department);

  return (
    <>
      <div className="nl-figures" role="list">
        {[
          { id: "total", value: String(status.total), label: "Registered", note: t("workforce.directorSplit", { directors: status.directors, specialists: status.specialists }), tone: "--nc-product" },
          { id: "on", value: String(status.active + status.thinking), label: "Carrying work", note: t("workforce.carryingNote", { active: status.active, thinking: status.thinking }), tone: "--nc-active" },
          { id: "held", value: String(status.waiting + status.blocked), label: "Held", note: t("workforce.heldNote", { blocked: status.blocked, waiting: status.waiting }), tone: "--nc-approval" },
          { id: "load", value: `${status.averageUtilisation}%`, label: "Average load", note: t("workforce.above80", { count: overloaded.length }), tone: overloaded.length ? "--nc-approval" : "--nc-completed" },
          { id: "idle", value: String(status.idle), label: "Idle", note: "available for routing", tone: "--nc-text-3" },
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
              title={tc("Executive hierarchy")}
              span={12}
              hint={tc("authority flows down; work flows up as reports")}
            >
              <div className="nl-tree">
                {executive && (
                  <>
                    <div className="nl-tree__tier">
                      <span className="nl-tree__label">{tc("Core")}</span>
                      <AgentRow agent={executive} />
                    </div>
                    <span className="nl-tree__connector" aria-hidden="true" />
                  </>
                )}

                <div className="nl-tree__tier">
                  <span className="nl-tree__label">{tc("Human authority")}</span>
                  {dataset.agents
                    .filter((a) => a.kind === "human")
                    .map((human) => (
                      <div key={human.id}>
                        <AgentRow agent={human} />
                        <div className="nl-tree__children">
                          {agentReports(dataset, human.id).map((report) => (
                            <AgentRow key={report.id} agent={report} child />
                          ))}
                        </div>
                      </div>
                    ))}
                </div>

                <div className="nl-tree__tier">
                  <span className="nl-tree__label">{tc("Directors without a human lead on the chain")}</span>
                  {dataset.agents
                    .filter((a) => a.kind === "agent" && a.tier === "director" && !dataset.agents.some((p) => p.id === a.reportsTo && p.kind === "human"))
                    .map((director) => (
                      <div key={director.id}>
                        <AgentRow agent={director} />
                        <div className="nl-tree__children">
                          {agentReports(dataset, director.id).map((report) => (
                            <AgentRow key={report.id} agent={report} child />
                          ))}
                        </div>
                      </div>
                    ))}
                </div>
              </div>
            </Section>

            <Section
              title={tc("Directory")}
              count={listed.length}
              span={12}
              hint={tc("filtered by department")}
              action={
                <div className="nl-chips">
                  <button
                    type="button"
                    className="nl-chip"
                    data-active={department === "all"}
                    aria-pressed={department === "all"}
                    onClick={() => setDepartment("all")}
                  >
                    {t("common.all")}
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
                      <span className="nl-chip__count">{agentsForDepartment(dataset, id).length}</span>
                    </button>
                  ))}
                </div>
              }
            >
              <Table head={[tc("Agent"), tc("Role"), tc("State"), tc("Load")]}>
                {listed.map((agent) => {
                  const meta = AGENT_STATUS_META[agent.status];
                  return (
                    <Row key={agent.id} href={agentHref(agent.id)} accent={scopedAccent(agent)}>
                      <Cell variant="lead">
                        <Avatar
                          initials={agent.initials}
                          kind={agent.kind}
                          tone={agent.kind === "human" ? "--nc-human" : "--nc-lime"}
                          size={30}
                        />
                        <span className="nl-cellstack">
                          <span className="nl-cell__title">{agent.name}</span>
                          <span className="nl-cell__meta">
                            {agent.scope === "organization"
                              ? t("common.organization")
                              : DEPARTMENT_BY_ID[agent.scope]
                                ? t(`dept.${agent.scope}.name`)
                                : agent.scope}
                          </span>
                        </span>
                      </Cell>
                      <Cell variant="muted">{tc(agent.role.split("·")[0].trim())}</Cell>
                      <Cell>
                        <Pill label={t(`status.agent.${agent.status}`)} tone={meta.tone} />
                      </Cell>
                      <Cell variant="right">
                        <Meter value={agent.workload.utilisation} tone={meta.tone} />
                        <span className="nl-cell__num">{agent.workload.utilisation}%</span>
                      </Cell>
                    </Row>
                  );
                })}
              </Table>
            </Section>
          </>
        }
        aside={
          <>
            <Section title={tc("Departments")} span={12} hint={tc("who works where")}>
              <div className="nl-rows">
                {DEPARTMENT_IDS.map((id) => {
                  const department = DEPARTMENT_BY_ID[id];
                  const members = agentsForDepartment(dataset, id);
                  const humans = members.filter((m) => m.kind === "human").length;
                  return (
                    <Link key={id} href={departmentHref(id)} className="nl-line">
                      <span className="nl-line__stack">
                        <span className="nl-line__title">{t(`dept.${id}.name`)}</span>
                        <span className="nl-line__meta">
                          {t("workforce.identities", {
                            count: members.length,
                            humans,
                            director: t(`dept.${id}.director`),
                          })}
                        </span>
                      </span>
                      <span className="nl-line__load">{department.crew}</span>
                    </Link>
                  );
                })}
              </div>
              <Note>
                {tc(
                  "Department workspaces stay where they were: the spatial scene and the UI-03 workspace are unchanged.",
                )}
              </Note>
            </Section>

            <Section title={tc("Runtime & models")} span={12} hint={t("workforce.runtimeRoute")}>
              <div className="nl-rows">
                {dataset.models.slice(0, 5).map((model) => (
                  <Link key={model.id} href="/command/models" className="nl-line">
                    <span className="nl-line__stack">
                      <span className="nl-line__title">{model.name}</span>
                      <span className="nl-line__meta">
                        {model.provider} · {model.intelligenceTier} ·{" "}
                        {t("workforce.usedPct", { percent: model.quota.usedPct })}
                      </span>
                    </span>
                  </Link>
                ))}
              </div>
              <Note>
                {tc(
                  "No model router runs in this worktree. The registry is a read-only shell; agents reference entries, nothing is dispatched.",
                )}
              </Note>
            </Section>

            <Section title={tc("Load watch")} count={overloaded.length} span={12} hint={tc("above 80% utilisation")}>
              <div className="nl-rows">
                {overloaded.length === 0 ? (
                  <Note>{tc("Nothing is over 80%. Load is inside the healthy band.")}</Note>
                ) : (
                  overloaded.map((agent) => (
                    <Link key={agent.id} href={agentHref(agent.id)} className="nl-line">
                      <span className="nl-line__stack">
                        <span className="nl-line__title">{agent.name}</span>
                        <span className="nl-line__meta">
                          {t("workforce.missionsHeld", {
                            count: agent.workload.activeMissions,
                            queued: agent.workload.queuedTasks,
                          })}
                        </span>
                      </span>
                      <span className="nl-line__load">{agent.workload.utilisation}%</span>
                    </Link>
                  ))
                )}
              </div>
            </Section>
          </>
        }
      />
    </>
  );
}

function AgentRow({ agent, child }: { agent: Agent; child?: boolean }) {
  const { t, tc } = useLocale();
  const meta = AGENT_STATUS_META[agent.status];
  return (
    <Link className="nl-tree__row" href={agentHref(agent.id)} data-depth={child ? "child" : "root"}>
      <Avatar
        initials={agent.initials}
        kind={agent.kind}
        tone={agent.kind === "human" ? "--nc-human" : "--nc-lime"}
        size={child ? 26 : 30}
      />
      <span className="nl-tree__stack">
        <span className="nl-tree__name">{agent.name}</span>
        <span className="nl-tree__role">{tc(agent.role)}</span>
      </span>
      <Pill label={t(`status.agent.${agent.status}`)} tone={meta.tone} />
      <span className="nl-tree__load">{agent.workload.utilisation}%</span>
    </Link>
  );
}

function scopedAccent(agent: Agent): string {
  if (agent.scope === "organization") return "--nc-cyan";
  return DEPARTMENT_BY_ID[agent.scope]?.accentVar ?? "--nc-network";
}
