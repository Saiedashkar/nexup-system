"use client";

import Link from "next/link";
import { useState } from "react";
import { DEPARTMENT_BY_ID } from "@/components/command/state/organization-model";
import { agentHref, clientHref, missionHref } from "@/components/command/lab/areas";
import { useLocale } from "@/components/command/i18n/command-locale";
import { Avatar, LabData, LabFrame, Meter, Note, Pill, tone } from "@/components/command/lab/kit";
import {
  MISSION_STATUS_META,
  missionsForProject,
  projectProgress,
} from "@/components/command/state/demo/selectors";
import type { CommandDataset, Project, ProjectStatus } from "@/components/command/state/demo/types";

/**
 * PROJECTS — grouped work, per client
 * ──────────────────────────────────
 * A project is where missions, a client and a set of agents meet. The page is a
 * card wall rather than a table because a project's identity matters more than
 * its numbers: what it is, who it is for, what is running inside it and when it
 * last moved.
 *
 * Status and progress are read from the missions the project actually owns, so a
 * project can never claim progress its missions do not support.
 */

const PROJECT_STATUS_TONE: Record<ProjectStatus, string> = {
  discovery: "--nc-violet",
  active: "--nc-active",
  review: "--nc-thinking",
  "on-hold": "--nc-approval",
  closed: "--nc-completed",
};

export default function ProjectsPage() {
  const { tc } = useLocale();
  return (
    <LabFrame areaId="projects">
      <LabData
        emptyTitle={tc("No projects yet")}
        emptyBody={tc("Projects group missions against a client. This organization has none open.")}
      >
        {(dataset) => <Projects dataset={dataset} />}
      </LabData>
    </LabFrame>
  );
}

function Projects({ dataset }: { dataset: CommandDataset }) {
  const { t, tc } = useLocale();
  const [status, setStatus] = useState<"all" | ProjectStatus>("all");
  const listed = dataset.projects.filter((p) => status === "all" || p.status === status);

  const clientsWithoutWork = dataset.clients.filter((client) =>
    client.projectIds.every((id) => {
      const project = dataset.projects.find((p) => p.id === id);
      return !project || project.missionIds.length === 0;
    }),
  );

  return (
    <>
      <div className="nl-figures" role="list">
        {[
          { id: "projects", value: String(dataset.projects.length), label: "Projects", note: t("projects.shownCount", { count: listed.length }), tone: "--nc-product" },
          {
            id: "missions",
            value: String(dataset.projects.reduce((n, p) => n + p.missionIds.length, 0)),
            label: "Missions in projects",
            note: "every mission belongs somewhere",
            tone: "--nc-growth",
          },
          { id: "clients", value: String(dataset.clients.length), label: "Clients", note: t("projects.nothingRunning", { count: clientsWithoutWork.length }), tone: "--nc-client" },
          {
            id: "hold",
            value: String(dataset.projects.filter((p) => p.status === "on-hold").length),
            label: "On hold",
            note: "waiting on something outside the team",
            tone: "--nc-approval",
          },
        ].map((figure) => (
          <div key={figure.id} role="listitem" className="nl-figure" style={tone(figure.tone)}>
            <span className="nl-figure__value">{figure.value}</span>
            <span className="nl-figure__label">{tc(figure.label)}</span>
            <span className="nl-figure__note">{tc(figure.note)}</span>
          </div>
        ))}
      </div>

      <div className="nl-toolbar">
        <div className="nl-chips" role="group" aria-label={t("projects.statusAria")}>
          {(["all", "discovery", "active", "review", "on-hold"] as const).map((option) => (
            <button
              key={option}
              type="button"
              className="nl-chip"
              data-active={status === option}
              aria-pressed={status === option}
              onClick={() => setStatus(option)}
            >
              {option === "all" ? tc("All projects") : t(`status.project.${option}`)}
              <span className="nl-chip__count">
                {option === "all" ? dataset.projects.length : dataset.projects.filter((p) => p.status === option).length}
              </span>
            </button>
          ))}
        </div>
      </div>

      {listed.length === 0 ? (
        <div className="nl-empty">
          <h2 className="nl-empty__title">{tc("No project in that state")}</h2>
          <p className="nl-empty__body">{tc("Nothing in this organization is in that stage right now.")}</p>
        </div>
      ) : (
        <div className="nl-cards nl-cards--wide">
          {listed.map((project) => (
            <ProjectCard key={project.id} project={project} dataset={dataset} />
          ))}
        </div>
      )}
    </>
  );
}

function ProjectCard({ project, dataset }: { project: Project; dataset: CommandDataset }) {
  const { t, tc } = useLocale();
  const department = DEPARTMENT_BY_ID[project.departmentId];
  const client = dataset.clients.find((c) => c.id === project.clientId);
  const missions = missionsForProject(dataset, project.id);
  const agents = project.agentIds
    .map((id) => dataset.agents.find((a) => a.id === id))
    .filter((a): a is NonNullable<typeof a> => Boolean(a));

  return (
    <article className="nl-card nl-card--project" id={project.id} style={tone(department?.accentVar ?? "--nc-network")}>
      <div className="nl-card__head">
        <span className="nl-card__title">{tc(project.name)}</span>
        <span className="nl-card__spacer" />
        <Pill label={t(`status.project.${project.status}`)} tone={PROJECT_STATUS_TONE[project.status]} />
      </div>

      <div className="nl-card__meta">
        {client ? (
          <Link href={clientHref(client.id)} className="nl-inlinelink">
            {tc(client.name)}
          </Link>
        ) : (
          tc("Internal")
        )}{" "}
        · {department ? t(`dept.${department.id}.name`) : project.departmentId} · {t("common.updated")}{" "}
        {project.updatedAt}
      </div>

      <div className="nl-card__meter">
        <Meter value={project.progress} tone={PROJECT_STATUS_TONE[project.status]} />
        <span className="nl-cell__num">{projectProgress(project, dataset)}</span>
      </div>

      <div className="nl-card__rows">
        {missions.map((mission) => (
          <Link key={mission.id} href={missionHref(mission.id)} className="nl-card__row">
            <span className="nl-inlinedot" style={tone(MISSION_STATUS_META[mission.status].tone)} aria-hidden="true" />
            <span className="nl-card__rowtext">{tc(mission.title)}</span>
            <span className="nl-card__rowpct">{mission.progress}%</span>
          </Link>
        ))}
        {missions.length === 0 && <Note>{tc("No mission has been opened against this project yet.")}</Note>}
      </div>

      <div className="nl-card__foot">
        <div className="nl-avatars" aria-label={t("projects.agentsAria")}>
          {agents.slice(0, 4).map((agent) => (
            <Link key={agent.id} href={agentHref(agent.id)} title={agent.name} className="nl-avatars__item">
              <Avatar
                initials={agent.initials}
                kind={agent.kind}
                tone={agent.kind === "human" ? "--nc-human" : "--nc-lime"}
                size={26}
              />
            </Link>
          ))}
          {agents.length > 4 && <span className="nl-avatars__more">+{agents.length - 4}</span>}
        </div>
        <span className="nl-card__meta">{tc(project.nextMilestone)}</span>
      </div>
    </article>
  );
}
