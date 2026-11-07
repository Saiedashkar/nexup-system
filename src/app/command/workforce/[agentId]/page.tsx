"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { DEPARTMENT_BY_ID } from "@/components/command/state/organization-model";
import { agentHref, missionHref } from "@/components/command/lab/areas";
import { useLocale } from "@/components/command/i18n/command-locale";
import {
  Avatar,
  EmptyState,
  KV,
  LabButton,
  LabData,
  LabFrame,
  Meter,
  MockButton,
  Note,
  Pill,
  Section,
  Split,
  tone,
} from "@/components/command/lab/kit";
import {
  ACTIVITY_KIND_META,
  AGENT_STATUS_META,
  MISSION_STATUS_META,
  agentReports,
  modelById,
} from "@/components/command/state/demo/selectors";
import type { CommandDataset } from "@/components/command/state/demo/types";

/**
 * AI WORKFORCE — agent detail
 * ───────────────────────────
 * What this identity is, what it answers to, what it is trusted with, what it is
 * carrying, and what it has actually done. Everything is read from the same
 * dataset the directory reads, so a load figure here cannot disagree with the
 * meter in the list.
 *
 * Capability, skills and runtime are shown as REGISTRY material: read-only, with
 * the autonomy level stated in words, because autonomy is the thing a founder
 * actually needs to see on this page.
 */

const SKILL_TONE: Record<string, string> = {
  learning: "--nc-waiting",
  proficient: "--nc-thinking",
  expert: "--nc-active",
};

const AUTONOMY_COPY: Record<string, string> = {
  supervised: "Every action is confirmed by a human before it happens.",
  bounded: "Acts freely inside its department, and stops at any gate above it.",
  full: "Would act without a human gate. No agent holds this level in the registry today.",
};

export default function AgentDetailPage() {
  const { tc } = useLocale();
  return (
    <LabFrame areaId="workforce">
      <LabData
        emptyTitle={tc("No workforce yet")}
        emptyBody={tc("No agent is registered in this organization.")}
      >
        {(dataset) => <AgentDetail dataset={dataset} />}
      </LabData>
    </LabFrame>
  );
}

function AgentDetail({ dataset }: { dataset: CommandDataset }) {
  const { t, tc, formatNumber } = useLocale();
  const params = useParams<{ agentId: string }>();
  const agent = dataset.agents.find((a) => a.id === params.agentId);

  if (!agent) {
    return (
      <EmptyState
        title={tc("That identity is not in this read")}
        body={t("agentDetail.notInRead", { id: params.agentId })}
        action={<LabButton href="/command/workforce">{tc("Back to the workforce")}</LabButton>}
      />
    );
  }

  const status = AGENT_STATUS_META[agent.status];
  const scope = agent.scope === "organization" ? null : DEPARTMENT_BY_ID[agent.scope];
  const accent = agent.kind === "human" ? "--nc-human" : "--nc-lime";
  const manager = dataset.agents.find((a) => a.id === agent.reportsTo);
  const reports = agentReports(dataset, agent.id);
  const missions = dataset.missions.filter((m) => agent.missionIds.includes(m.id));
  const model = modelById(dataset, agent.runtime.modelId);

  return (
    <>
      <div className="nl-hero" style={tone(scope?.accentVar ?? accent)}>
        <Avatar initials={agent.initials} kind={agent.kind} tone={accent} size={44} />
        <div className="nl-hero__stack">
          <span className="nl-hero__code">
            {t("agentDetail.heroLine", {
              kind: t(agent.kind === "human" ? "agentDetail.human" : "agentDetail.agent"),
              tier: tc(agent.tier),
              scope: scope ? t(`dept.${scope.id}.name`) : t("common.organization"),
            })}
          </span>
          <span className="nl-hero__title">{agent.name}</span>
          <span className="nl-hero__obj">{tc(agent.currentFocus)}</span>
        </div>
        <div className="nl-hero__flags">
          <Pill label={t(`status.agent.${agent.status}`)} tone={status.tone} />
          <Pill
            label={t(agent.workload.utilisation >= 80 ? "agentDetail.heavyLoad" : "agentDetail.withinLoad")}
            tone={agent.workload.utilisation >= 80 ? "--nc-approval" : "--nc-completed"}
            dot={false}
          />
        </div>
        <div className="nl-hero__meter">
          <Meter value={agent.workload.utilisation} tone={status.tone} />
          <span className="nl-hero__pct">{agent.workload.utilisation}%</span>
        </div>
      </div>

      <Split
        primary={
          <>
            <Section title={tc("Capabilities")} count={agent.capabilities.length} span={12} hint={tc("what it is trusted to do")}>
              <div className="nl-chipwall">
                {agent.capabilities.map((capability) => (
                  <span key={capability} className="nl-tag">
                    {tc(capability)}
                  </span>
                ))}
              </div>
            </Section>

            <Section title={tc("Skills")} count={agent.skills.length} span={12} hint={tc("and how developed each one is")}>
              <div className="nl-rows">
                {agent.skills.map((skill) => (
                  <div key={skill.id} className="nl-line" style={tone(SKILL_TONE[skill.level] ?? "--nc-network")}>
                    <span className="nl-line__stack">
                      <span className="nl-line__title">{tc(skill.name)}</span>
                      <span className="nl-line__meta">{tc(skill.note)}</span>
                    </span>
                    <Pill label={tc(skill.level)} tone={SKILL_TONE[skill.level] ?? "--nc-network"} />
                  </div>
                ))}
              </div>
            </Section>

            <Section
              title={tc("Assigned missions")}
              count={missions.length}
              span={12}
              hint={tc("read from the same mission list Mission Control shows")}
            >
              {missions.length === 0 ? (
                <Note>{tc("No mission is currently assigned to this identity.")}</Note>
              ) : (
                <div className="nl-rows">
                  {missions.map((mission) => (
                    <Link key={mission.id} href={missionHref(mission.id)} className="nl-line">
                      <span className="nl-line__stack">
                        <span className="nl-line__title">{tc(mission.title)}</span>
                        <span className="nl-line__meta">
                          {mission.code} · {t(`status.mission.${mission.status}`)} · {mission.progress}%
                        </span>
                      </span>
                      <Meter value={mission.progress} tone={MISSION_STATUS_META[mission.status].tone} />
                    </Link>
                  ))}
                </div>
              )}
            </Section>

            <Section title={tc("Activity history")} count={agent.activity.length} span={12}>
              <ol className="nl-timeline">
                {agent.activity.map((entry) => {
                  const meta = ACTIVITY_KIND_META[entry.kind];
                  return (
                    <li key={entry.id} className="nl-timeline__item" style={tone(meta.tone)}>
                      <span className="nl-timeline__dot" aria-hidden="true" />
                      <span className="nl-timeline__body">
                        <span className="nl-timeline__meta">
                          <span className="nl-timeline__actor">{tc(entry.actor)}</span>
                          <span className="nl-timeline__at">{tc(entry.at)}</span>
                        </span>
                        <span className="nl-timeline__text">{tc(entry.text)}</span>
                      </span>
                    </li>
                  );
                })}
              </ol>
            </Section>
          </>
        }
        aside={
          <>
            <Section title={tc("Chain of command")} span={12}>
              {manager ? (
                <Link href={agentHref(manager.id)} className="nl-line">
                  <Avatar
                    initials={manager.initials}
                    kind={manager.kind}
                    tone={manager.kind === "human" ? "--nc-human" : "--nc-lime"}
                    size={30}
                  />
                  <span className="nl-line__stack">
                    <span className="nl-line__title">{manager.name}</span>
                    <span className="nl-line__meta">
                      {t("agentDetail.reportsTo", { role: tc(manager.role) })}
                    </span>
                  </span>
                </Link>
              ) : (
                <Note>{tc("This identity reports to the founder directly.")}</Note>
              )}

              {reports.length > 0 && (
                <div className="nl-rows" style={{ marginTop: 10 }}>
                  {reports.map((report) => (
                    <Link key={report.id} href={agentHref(report.id)} className="nl-line">
                      <Avatar
                        initials={report.initials}
                        kind={report.kind}
                        tone={report.kind === "human" ? "--nc-human" : "--nc-lime"}
                        size={26}
                      />
                      <span className="nl-line__stack">
                        <span className="nl-line__title">{report.name}</span>
                        <span className="nl-line__meta">{t("agentDetail.reportsToName", { name: agent.name })}</span>
                      </span>
                    </Link>
                  ))}
                </div>
              )}
            </Section>

            <Section title={tc("Workload")} span={12}>
              <KV label={tc("Active missions")}>{agent.workload.activeMissions}</KV>
              <KV label={tc("Queued tasks")}>{agent.workload.queuedTasks}</KV>
              <KV label={tc("Utilisation")}>{agent.workload.utilisation}%</KV>
              <KV label={tc("Online for")}>{tc(agent.onlineSince)}</KV>
            </Section>

            <Section title={tc("Performance")} span={12}>
              <KV label={tc("Task success")}>{agent.performance.successRate}%</KV>
              <KV label={tc("Decisions raised")}>{agent.performance.decisionsRaised}</KV>
              <KV label={tc("Average cycle")}>{agent.performance.avgCycle}</KV>
            </Section>

            <Section title={tc("Runtime")} span={12} hint={t("workforce.runtimeRoute")}>
              <KV label={tc("Runtime")}>{agent.runtime.runtimeLabel}</KV>
              <KV label={tc("Model entry")}>
                {model ? (
                  <Link href="/command/models" className="nl-inlinelink">
                    {model.name} · {model.provider}
                  </Link>
                ) : (
                  agent.runtime.modelId
                )}
              </KV>
              <KV label={tc("Context window")}>
                {t("agentDetail.tokens", { count: formatNumber(agent.runtime.contextWindow) })}
              </KV>
              <KV label={tc("Tools allowed")}>
                <span className="nl-chipwall">
                  {agent.runtime.tools.map((tool) => (
                    <span key={tool} className="nl-tag nl-tag--mono">
                      {tool}
                    </span>
                  ))}
                </span>
              </KV>
              <KV label={tc("Autonomy")}>
                <Pill
                  label={t(`agentDetail.autonomy.${agent.runtime.autonomy}`)}
                  tone={agent.runtime.autonomy === "full" ? "--nc-error" : agent.runtime.autonomy === "bounded" ? "--nc-approval" : "--nc-completed"}
                />
                <span className="nl-kvnote">{tc(AUTONOMY_COPY[agent.runtime.autonomy])}</span>
              </KV>
              <KV label={tc("Quota")}>{tc(agent.runtime.quotaState)}</KV>
              <Note>
                {tc(
                  "Model routing does not exist in this worktree. This is the registry row the identity is registered against — no request is ever dispatched from here.",
                )}
              </Note>
            </Section>

            <Section title={tc("Actions")} span={12}>
              <div className="nl-stack">
                <MockButton message={t("agentDetail.autonomyMessage", { name: agent.name })}>
                  {tc("Change autonomy")}
                </MockButton>
                <MockButton message={t("agentDetail.reassignMessage", { name: agent.name })}>
                  {tc("Reassign")}
                </MockButton>
              </div>
            </Section>
          </>
        }
      />
    </>
  );
}
