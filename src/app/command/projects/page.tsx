"use client";

import Link from "next/link";
import { useState } from "react";
import { clientHref } from "@/components/command/lab/areas";
import {
  DirectoryScopeLine,
  DirectorySourcePanel,
  SessionEnded,
  errorMessageKey,
} from "@/components/command/lab/directory";
import { useLocale } from "@/components/command/i18n/command-locale";
import {
  EmptyState,
  ErrorState,
  LabFrame,
  LoadingStack,
  Meter,
  Note,
  Pill,
  Section,
  StaleBanner,
  tone,
} from "@/components/command/lab/kit";
import { DirectoryProvider, useDirectory } from "@/components/command/state/directory/directory-store";
import {
  projectTotals,
  type ProjectView,
} from "@/components/command/state/directory/mapping";
import type { WorkStatus } from "@/components/command/state/directory/types";

/**
 * PROJECTS — the work, bound to this company's records
 * ───────────────────────────────────────────────────
 * Every card is a `ProjectRecord` from the database, read through
 * `GET /api/projects` (session-scoped, with the client, the designer and the
 * services the record actually references).
 *
 * The demo card showed a department, a mission list, agent avatars, a progress
 * percentage and a "next milestone". A project record has none of them — it has
 * a name, a client, a date, four work states, a payment state, a designer, the
 * services booked and the money. Those are the card now. The meter is collected
 * ÷ agreed, which is arithmetic over two stored amounts.
 */

const WORK_TONE: Record<WorkStatus, string> = {
  WAITING: "--nc-approval",
  IN_PROGRESS: "--nc-active",
  COMPLETED: "--nc-completed",
  PAUSED: "--nc-text-3",
};

const WORK_ORDER: WorkStatus[] = ["WAITING", "IN_PROGRESS", "PAUSED", "COMPLETED"];

export default function ProjectsPage() {
  return (
    <LabFrame areaId="projects" hideDemoState>
      <DirectoryProvider>
        <DirectoryScopeLine />
        <ProjectsSurface />
      </DirectoryProvider>
    </LabFrame>
  );
}

function ProjectsSurface() {
  const { t } = useLocale();
  const { state, projects, reloadSession, reloadClients, reloadProjects } = useDirectory();

  /* NO CARD BEFORE THE SESSION AND ITS SCOPE ARE PROVEN — and none on failure. */
  if (state.unauthorized) return <SessionEnded next="/command/projects" />;
  if (state.session.state === "loading") {
    return <LoadingStack label={t("directory.readingSession")} />;
  }
  if (state.session.state === "error") {
    return <ErrorState message={t(errorMessageKey(state.session.error))} onRetry={reloadSession} />;
  }
  if (state.projects.state === "loading" || !projects) {
    return <LoadingStack label={t("directory.readingProjects")} />;
  }
  if (state.projects.state === "error") {
    return (
      <ErrorState message={t(errorMessageKey(state.projects.error))} onRetry={reloadProjects} />
    );
  }
  if (state.projects.state === "empty") {
    return (
      <>
        <EmptyState title={t("directory.projectsTitle")} body={t("directory.projectsBody")} />
        <Section title={t("directory.sources.title")} span={12}>
          <DirectorySourcePanel />
        </Section>
      </>
    );
  }

  return (
    <>
      {state.clients.state === "error" && (
        <StaleBanner message={t("directory.clientsFailed")} onRetry={reloadClients} />
      )}
      <Projects projects={projects} />
    </>
  );
}

function Projects({ projects }: { projects: ProjectView[] }) {
  const { t, formatNumber } = useLocale();
  const [status, setStatus] = useState<"all" | WorkStatus>("all");
  const listed = projects.filter((p) => status === "all" || p.work === status);
  const totals = projectTotals(projects);

  return (
    <>
      <div className="nl-figures" role="list">
        {[
          {
            id: "projects",
            value: formatNumber(totals.projects),
            label: t("directory.figureProjects"),
            note: t("directory.figureProjectsNote"),
            tone: "--nc-product",
          },
          {
            id: "progress",
            value: formatNumber(totals.byWork("IN_PROGRESS")),
            label: t("directory.figureWorkInProgress"),
            note: t("directory.figureWorkInProgressNote"),
            tone: "--nc-active",
          },
          {
            id: "completed",
            value: formatNumber(totals.byWork("COMPLETED")),
            label: t("directory.figureCompleted"),
            note: t("directory.figureCompletedNote"),
            tone: "--nc-completed",
          },
          {
            id: "outstanding",
            value: formatNumber(Math.round(totals.outstanding)),
            label: t("directory.figureOutstanding"),
            note: t("directory.figureOutstandingNote"),
            tone: "--nc-approval",
          },
        ].map((figure) => (
          <div key={figure.id} role="listitem" className="nl-figure" style={tone(figure.tone)}>
            <span className="nl-figure__value">{figure.value}</span>
            <span className="nl-figure__label">{figure.label}</span>
            <span className="nl-figure__note">{figure.note}</span>
          </div>
        ))}
      </div>

      <div className="nl-toolbar">
        <div className="nl-chips" role="group" aria-label={t("directory.statusAria")}>
          <button
            type="button"
            className="nl-chip"
            data-active={status === "all"}
            aria-pressed={status === "all"}
            onClick={() => setStatus("all")}
          >
            {t("directory.allProjects")}
            <span className="nl-chip__count">{projects.length}</span>
          </button>
          {WORK_ORDER.filter((option) => totals.byWork(option) > 0).map((option) => (
            <button
              key={option}
              type="button"
              className="nl-chip"
              data-active={status === option}
              aria-pressed={status === option}
              onClick={() => setStatus(option)}
            >
              {t(`status.work.${option}`)}
              <span className="nl-chip__count">{totals.byWork(option)}</span>
            </button>
          ))}
        </div>
      </div>

      {listed.length === 0 ? (
        <div className="nl-empty">
          <h2 className="nl-empty__title">{t("directory.inThatState")}</h2>
          <p className="nl-empty__body">{t("directory.inThatStateBody")}</p>
        </div>
      ) : (
        <div className="nl-cards nl-cards--wide">
          {listed.map((project) => (
            <ProjectCard key={project.id} project={project} />
          ))}
        </div>
      )}

      <Section title={t("directory.sources.title")} span={12}>
        <DirectorySourcePanel />
      </Section>
    </>
  );
}

function ProjectCard({ project }: { project: ProjectView }) {
  const { t, formatNumber } = useLocale();
  const workTone = project.work ? WORK_TONE[project.work] : "--nc-text-3";

  return (
    <article className="nl-card nl-card--project" id={project.id} style={tone(workTone)}>
      <div className="nl-card__head">
        <span className="nl-card__title">{project.name}</span>
        <span className="nl-card__spacer" />
        {project.work ? (
          <Pill label={t(`status.work.${project.work}`)} tone={workTone} />
        ) : (
          <Pill label={t("directory.none")} tone="--nc-text-3" />
        )}
      </div>

      <div className="nl-card__meta">
        {project.clientName ? (
          <Link href={clientHref(project.clientId)} className="nl-inlinelink">
            {project.clientName}
          </Link>
        ) : (
          t("directory.none")
        )}{" "}
        · {t("directory.opened")} {project.date.slice(0, 10)}
        {project.designer ? ` · ${t("directory.designer")} ${project.designer}` : ""}
      </div>

      <div className="nl-card__meter">
        <Meter value={project.paidRatio} tone={workTone} />
        <span className="nl-cell__num">
          {t("directory.paidOfTotal", {
            paid: formatNumber(Math.round(project.paid)),
            total: formatNumber(Math.round(project.total)),
          })}
        </span>
      </div>

      <div className="nl-card__rows">
        {project.services.length > 0 ? (
          project.services.map((service) => (
            <span key={service} className="nl-card__row">
              <span className="nl-inlinedot" style={tone("--nc-cyan")} aria-hidden="true" />
              <span className="nl-card__rowtext">{service}</span>
            </span>
          ))
        ) : (
          <Note>{t("directory.noServices")}</Note>
        )}
        {project.notes && <Note>{project.notes}</Note>}
      </div>

      <div className="nl-card__foot">
        <span className="nl-card__meta">
          {t("directory.remaining")} {formatNumber(Math.round(Math.max(0, project.remaining)))}
        </span>
        {project.payment ? (
          <Pill label={t(`status.payment.${project.payment}`)} tone="--nc-finance" />
        ) : (
          <Pill label={t("directory.none")} tone="--nc-text-3" />
        )}
      </div>
    </article>
  );
}
