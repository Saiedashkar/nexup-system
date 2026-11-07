"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { DEPARTMENT_BY_ID } from "@/components/command/state/organization-model";
import { agentHref } from "@/components/command/lab/areas";
import { useLocale } from "@/components/command/i18n/command-locale";
import {
  Avatar,
  Cell,
  EmptyState,
  KV,
  LabButton,
  LabData,
  LabFrame,
  Meter,
  MockButton,
  Note,
  Pill,
  Row,
  Section,
  Split,
  Table,
  tone,
} from "@/components/command/lab/kit";
import {
  ACTIVITY_KIND_META,
  MISSION_STATUS_META,
  PRIORITY_META,
  RISK_META,
  decisionsForMission,
} from "@/components/command/state/demo/selectors";
import type { CommandDataset, MissionTask } from "@/components/command/state/demo/types";

/**
 * MISSION CONTROL — mission detail
 * ────────────────────────────────
 * One mission, read as an operator would: what "done" means, who owns it, what
 * the work graph is doing right now, what it is waiting on, what has happened to
 * it, and which decisions it raised.
 *
 * The task graph is a real chain — each node is connected to the next because the
 * tasks genuinely run in order — and its states are the ones the mission is
 * actually in. Nothing here is a sparkline standing in for data we do not have.
 */

const TASK_TONE: Record<MissionTask["state"], string> = {
  done: "--nc-completed",
  running: "--nc-active",
  queued: "--nc-text-4",
  waiting: "--nc-approval",
  blocked: "--nc-blocked",
  failed: "--nc-error",
};

export default function MissionDetailPage() {
  const { tc } = useLocale();
  return (
    <LabFrame areaId="missions">
      <LabData
        emptyTitle={tc("No missions exist yet")}
        emptyBody={tc("Mission Control has nothing to show in an empty organization.")}
      >
        {(dataset) => <MissionDetail dataset={dataset} />}
      </LabData>
    </LabFrame>
  );
}

function MissionDetail({ dataset }: { dataset: CommandDataset }) {
  const { t, tc } = useLocale();
  const params = useParams<{ missionId: string }>();
  const mission = dataset.missions.find((m) => m.id === params.missionId);

  if (!mission) {
    return (
      <EmptyState
        title={tc("That mission is not in this read")}
        body={t("missionDetail.notInRead", { id: params.missionId })}
        action={<LabButton href="/command/missions">{tc("Back to Mission Control")}</LabButton>}
      />
    );
  }

  const department = DEPARTMENT_BY_ID[mission.departmentId];
  const status = MISSION_STATUS_META[mission.status];
  const priority = PRIORITY_META[mission.priority];
  const decisions = decisionsForMission(dataset, mission.id);
  const pendingHere = decisions.filter((d) => d.status === "pending");
  const agents = mission.agents
    .map((id) => dataset.agents.find((a) => a.id === id))
    .filter((a): a is NonNullable<typeof a> => Boolean(a));

  return (
    <>
      {/* ── Hero: the mission's identity, in one band ── */}
      <div className="nl-hero" style={tone(department?.accentVar ?? "--nc-network")}>
        <Mark code={department?.short ?? "MI"} />
        <div className="nl-hero__stack">
          <span className="nl-hero__code">
            {mission.code} · {department ? t(`dept.${department.id}.name`) : mission.departmentId}
          </span>
          <span className="nl-hero__title">{tc(mission.title)}</span>
          <span className="nl-hero__obj">{tc(mission.objective)}</span>
        </div>
        <div className="nl-hero__flags">
          <Pill label={t(`status.mission.${mission.status}`)} tone={status.tone} />
          <Pill
            label={t("missions.priorityPill", { level: t(`status.priority.${mission.priority}`) })}
            tone={priority.tone}
            dot={false}
          />
          <Pill label={tc(mission.spendClass)} tone="--nc-violet" dot={false} />
        </div>
        <div className="nl-hero__meter">
          <Meter value={mission.progress} tone={status.tone} />
          <span className="nl-hero__pct">{mission.progress}%</span>
        </div>
      </div>

      {/* ── What is holding it — rendered only when there is something real ── */}
      {(mission.blockedReason || mission.waitingOn || mission.result) && (
        <div className="nl-flags">
          {mission.blockedReason && (
            <div className="nl-flag nl-flag__long" style={tone("--nc-blocked")}>
              <span className="nl-flag__label">{tc("Blocked")}</span>
              <span className="nl-flag__text">{tc(mission.blockedReason)}</span>
            </div>
          )}
          {mission.waitingOn && (
            <div className="nl-flag nl-flag__long" style={tone("--nc-approval")}>
              <span className="nl-flag__label">{tc("Waiting on")}</span>
              <span className="nl-flag__text">{tc(mission.waitingOn)}</span>
            </div>
          )}
          {mission.result && (
            <div className="nl-flag nl-flag__long" style={tone("--nc-completed")}>
              <span className="nl-flag__label">{tc("Outcome")}</span>
              <span className="nl-flag__text">{tc(mission.result)}</span>
            </div>
          )}
        </div>
      )}

      <Split
        primary={
          <>
            <Section
              title={tc("Task graph")}
              count={mission.tasks.length}
              span={12}
              hint={tc("the work in the order it has to happen")}
            >
              <div className="nl-graph">
                {mission.tasks.map((task) => (
                  <div key={task.id} className="nl-task" style={tone(TASK_TONE[task.state])}>
                    <span className="nl-task__node" aria-hidden="true">
                      {task.state === "done" ? "✓" : task.state === "failed" ? "!" : ""}
                    </span>
                    <span>
                      <span className="nl-task__title">{tc(task.title)}</span>
                      <span className="nl-task__note">{tc(task.note)}</span>
                      <span className="nl-task__meta">
                        <Pill label={t(`status.task.${task.state}`)} tone={TASK_TONE[task.state]} />
                        <span>
                          {t("missionDetail.taskKind", {
                            owner: tc(task.owner),
                            kind: t(task.kind === "human" ? "activity.human" : "activity.agent"),
                          })}
                        </span>
                        <span>{t("missionDetail.inState", { elapsed: task.elapsed })}</span>
                      </span>
                    </span>
                    <span className="nl-task__right">
                      <span className="nl-cell__num">{t(`status.task.${task.state}`)}</span>
                    </span>
                  </div>
                ))}
              </div>
            </Section>

            <Section
              title={tc("Execution activity")}
              count={mission.timeline.length}
              span={12}
              hint={tc("mission transitions, agent actions, human actions and system events")}
            >
              <ol className="nl-timeline">
                {mission.timeline.map((entry) => {
                  const meta = ACTIVITY_KIND_META[entry.kind];
                  return (
                    <li key={entry.id} className="nl-timeline__item" style={tone(meta.tone)}>
                      <span className="nl-timeline__dot" aria-hidden="true" />
                      <span className="nl-timeline__body">
                        <span className="nl-timeline__meta">
                          <span className="nl-timeline__actor">{tc(entry.actor)}</span>
                          <span className="nl-timeline__at">
                            {tc(entry.at)} · {t(`status.activity.${entry.kind}`)}
                          </span>
                        </span>
                        <span className="nl-timeline__text">{tc(entry.text)}</span>
                      </span>
                    </li>
                  );
                })}
              </ol>
            </Section>

            <Section
              title={tc("Approvals raised by this mission")}
              count={decisions.length}
              span={12}
              hint={
                pendingHere.length
                  ? t("missionDetail.waitingCount", { count: pendingHere.length })
                  : t("missionDetail.noneOpen")
              }
            >
              {decisions.length === 0 ? (
                <Note>
                  {tc("This mission has never needed a human gate. It has run inside its own authority.")}
                </Note>
              ) : (
                <Table head={[tc("Decision"), tc("Risk"), tc("State")]}>
                  {decisions.map((decision) => (
                    <Row key={decision.id} href="/command/decisions">
                      <Cell variant="lead">
                        <span className="nl-cellstack">
                          <span className="nl-cell__title">{tc(decision.title)}</span>
                          <span className="nl-cell__meta">{tc(decision.policy)}</span>
                        </span>
                      </Cell>
                      <Cell>
                        <Pill label={t(`status.risk.${decision.risk}`)} tone={RISK_META[decision.risk].tone} />
                      </Cell>
                      <Cell variant="muted">{t(`status.decision.${decision.status}`)}</Cell>
                    </Row>
                  ))}
                </Table>
              )}
            </Section>
          </>
        }
        aside={
          <>
            <Section title={tc("Ownership")} span={12}>
              <KV label={tc("Owner")}>
                {t("missionDetail.ownerLine", {
                  owner: tc(mission.owner),
                  kind: t(mission.ownerKind === "human" ? "activity.human" : "activity.agent"),
                })}
              </KV>
              <KV label={tc("Department")}>
                {department ? t(`dept.${department.id}.name`) : mission.departmentId}
              </KV>
              <KV label={tc("Director")}>{department ? t(`dept.${department.id}.director`) : "—"}</KV>
              <KV label={tc("Started")}>{mission.startedAt}</KV>
              <KV label={tc("Due")}>{mission.dueAt}</KV>
              <KV label={tc("Last movement")}>{mission.updatedAt}</KV>
              <KV label={tc("Intelligence class")}>{tc(mission.spendClass)}</KV>
            </Section>

            <Section title={tc("Assigned agents")} count={agents.length} span={12}>
              <div className="nl-rows">
                {agents.map((agent) => (
                  <Link key={agent.id} href={agentHref(agent.id)} className="nl-line">
                    <Avatar
                      initials={agent.initials}
                      kind={agent.kind}
                      tone={agent.kind === "human" ? "--nc-human" : "--nc-lime"}
                      size={30}
                    />
                    <span className="nl-line__stack">
                      <span className="nl-line__title">{agent.name}</span>
                      <span className="nl-line__meta">
                        {tc(agent.role)} · {t(`status.agent.${agent.status}`)}
                      </span>
                    </span>
                    <span className="nl-line__load">{agent.workload.utilisation}%</span>
                  </Link>
                ))}
                {agents.length === 0 && <Note>{tc("No agent is assigned to this mission.")}</Note>}
              </div>
            </Section>

            <Section title={tc("Where this sits")} span={12}>
              <div className="nl-stack">
                <LabButton href="/command/missions">{tc("All missions")}</LabButton>
                <LabButton href="/command/decisions">{tc("Decision Center")}</LabButton>
                <MockButton
                  message={t("missionDetail.reassignMessage", { code: mission.code })}
                >
                  {tc("Reassign owner")}
                </MockButton>
              </div>
              <Note>
                {tc(
                  "Visual prototype. Nothing on this page reads or writes a real mission — the execution spine is not connected in this worktree.",
                )}
              </Note>
            </Section>
          </>
        }
      />
    </>
  );
}

/** Small local mark so the hero does not depend on the table's Mark component. */
function Mark({ code }: { code: string }) {
  return (
    <span className="nl-mark" aria-hidden="true">
      {code.slice(0, 2)}
    </span>
  );
}
