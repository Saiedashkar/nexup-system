"use client";

import Link from "next/link";
import { useState } from "react";
import { projectHref } from "@/components/command/lab/areas";
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
  Split,
  StaleBanner,
  tone,
} from "@/components/command/lab/kit";
import { DirectoryProvider, useDirectory } from "@/components/command/state/directory/directory-store";
import {
  directoryTotals,
  type ClientView,
  type ProjectRefView,
} from "@/components/command/state/directory/mapping";
import type { Tier } from "@/components/command/state/directory/types";

/**
 * CLIENTS — the relationship view, bound to this company's records
 * ──────────────────────────────────────────────────────────────
 * Every row on this page is a `Client` row from the company's own database, read
 * through `GET /api/clients` (which scopes by the session and enriches each row
 * with its projects and totals). The existing layout is kept — figures, tier
 * chips, the relationship list and the side column — but the vocabulary is now
 * only what the records carry: phone, tier, the projects, and the money.
 *
 * WHAT IS NOT HERE, AND WHY. The demo version showed an industry, a "client
 * since", an owner, a health score and the missions a client was waiting on.
 * None of those exist in `Client`/`ProjectRecord`, so none of them are rendered:
 * there is no field to invent one from, and inventing one is exactly the silent
 * demo fallback this binding exists to remove.
 *
 * PAID SHARE, NOT PROGRESS. The meter shows collected ÷ agreed, computed from
 * the two stored amounts. It is arithmetic over real numbers, not an opinion.
 */

const TIER_TONE: Record<Tier, string> = {
  VIP: "--nc-violet",
  LOYAL: "--nc-growth",
  NORMAL: "--nc-text-3",
  DELINQUENT: "--nc-error",
};

const TIERS: Tier[] = ["VIP", "LOYAL", "NORMAL", "DELINQUENT"];

export default function ClientsPage() {
  return (
    <LabFrame areaId="clients" hideDemoState>
      <DirectoryProvider>
        <DirectoryScopeLine />
        <ClientsSurface />
      </DirectoryProvider>
    </LabFrame>
  );
}

function ClientsSurface() {
  const { t } = useLocale();
  const { state, clients, reload, reloadSession, reloadClients, reloadProjects } = useDirectory();

  /* NO ROW BEFORE THE SESSION AND ITS SCOPE ARE PROVEN — and none on failure. */
  if (state.unauthorized) return <SessionEnded next="/command/clients" />;
  if (state.session.state === "loading") {
    return <LoadingStack label={t("directory.readingSession")} />;
  }
  if (state.session.state === "error") {
    return <ErrorState message={t(errorMessageKey(state.session.error))} onRetry={reloadSession} />;
  }
  if (state.clients.state === "loading" || !clients) {
    return <LoadingStack label={t("directory.readingClients")} />;
  }
  if (state.clients.state === "error") {
    return <ErrorState message={t(errorMessageKey(state.clients.error))} onRetry={reloadClients} />;
  }
  if (state.clients.state === "empty") {
    return (
      <>
        <EmptyState title={t("directory.clientsTitle")} body={t("directory.clientsBody")} />
        <Split primary={<Section title={t("directory.howRead")} span={12}><Note>{t("directory.howReadBody")}</Note></Section>} aside={<><Section title={t("directory.sources.title")} span={12}><DirectorySourcePanel /></Section></>} />
      </>
    );
  }

  return (
    <>
      {state.projects.state === "error" && (
        <StaleBanner message={t("directory.projectsFailed")} onRetry={reloadProjects} />
      )}
      <Clients clients={clients} onReload={reload} />
    </>
  );
}

function Clients({ clients, onReload }: { clients: ClientView[]; onReload: () => void }) {
  const { t, formatNumber } = useLocale();
  const [tier, setTier] = useState<"all" | Tier>("all");
  const listed = clients.filter((c) => tier === "all" || c.tier === tier);
  const totals = directoryTotals(clients);

  return (
    <>
      <div className="nl-figures" role="list">
        {[
          {
            id: "total",
            value: formatNumber(totals.clients),
            label: t("directory.figureClients"),
            note: t("directory.projectsAcross", { count: formatNumber(totals.projects) }),
            tone: "--nc-client",
          },
          {
            id: "vip",
            value: formatNumber(totals.byTier("VIP")),
            label: t("directory.figureVip"),
            note: t("directory.figureVipNote"),
            tone: "--nc-violet",
          },
          {
            id: "outstanding",
            value: formatNumber(Math.round(totals.outstanding)),
            label: t("directory.figureOutstanding"),
            note: t("directory.figureOutstandingNote"),
            tone: "--nc-approval",
          },
          {
            id: "collected",
            value: formatNumber(Math.round(totals.paid)),
            label: t("directory.figureCollected"),
            note: t("directory.figureCollectedNote"),
            tone: "--nc-completed",
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
        <div className="nl-chips" role="group" aria-label={t("clients.tierAria")}>
          <button
            type="button"
            className="nl-chip"
            data-active={tier === "all"}
            aria-pressed={tier === "all"}
            onClick={() => setTier("all")}
          >
            {t("directory.allClients")}
            <span className="nl-chip__count">{clients.length}</span>
          </button>
          {TIERS.filter((option) => totals.byTier(option) > 0).map((option) => (
            <button
              key={option}
              type="button"
              className="nl-chip"
              data-active={tier === option}
              aria-pressed={tier === option}
              onClick={() => setTier(option)}
            >
              {t(`status.tier.${option}`)}
              <span className="nl-chip__count">{totals.byTier(option)}</span>
            </button>
          ))}
        </div>
      </div>

      <Split
        primary={
          <Section
            title={t("directory.relationships")}
            count={listed.length}
            span={12}
            hint={t("directory.relationshipsHint")}
          >
            <div className="nl-clients">
              {listed.map((client) => (
                <ClientRow key={client.id} client={client} />
              ))}
            </div>
          </Section>
        }
        aside={
          <>
            <Section title={t("directory.sources.title")} span={12}>
              <DirectorySourcePanel />
            </Section>

            <Section
              title={t("directory.howRead")}
              span={12}
              action={
                <button type="button" className="nl-stale__retry" onClick={onReload}>
                  {t("directory.readAgain")}
                </button>
              }
            >
              <Note>{t("directory.howReadBody")}</Note>
            </Section>
          </>
        }
      />
    </>
  );
}

function ClientRow({ client }: { client: ClientView }) {
  const { t, formatNumber } = useLocale();
  const tier = client.tier ?? "NORMAL";

  return (
    <article className="nl-client" id={client.id} style={tone(TIER_TONE[tier])}>
      <div className="nl-client__head">
        <div className="nl-cellstack">
          <span className="nl-client__name">{client.name}</span>
          <span className="nl-client__meta">
            {t("directory.phone")} {client.phone} ·{" "}
            {t("directory.projectsCount", { count: formatNumber(client.projectCount) })}
          </span>
        </div>
        {client.tier ? (
          <Pill label={t(`status.tier.${client.tier}`)} tone={TIER_TONE[client.tier]} />
        ) : (
          <Pill label={t("directory.none")} tone="--nc-text-3" />
        )}
        {client.isRepeat && <Pill label={t("directory.repeat")} tone="--nc-growth" />}
      </div>

      <div className="nl-client__health">
        <Meter value={client.paidRatio} tone={TIER_TONE[tier]} />
        <span className="nl-cell__num">
          {t("directory.paidShare", { percent: formatNumber(client.paidRatio) })}
        </span>
      </div>

      <p className="nl-client__note">
        {t("directory.agreedTotal")} {formatNumber(Math.round(client.total))} ·{" "}
        {t("directory.collected")} {formatNumber(Math.round(client.paid))} ·{" "}
        {t("directory.outstanding")} {formatNumber(Math.round(Math.max(0, client.remaining)))}
      </p>

      {client.projects.length > 0 ? (
        <div className="nl-client__group">
          <span className="nl-subhead">{t("directory.projectList")}</span>
          {client.projects.map((project) => (
            <ProjectRow key={project.id} project={project} />
          ))}
        </div>
      ) : (
        <Note>{t("directory.noProjectsForClient")}</Note>
      )}
    </article>
  );
}

function ProjectRow({ project }: { project: ProjectRefView }) {
  const { t, formatNumber } = useLocale();
  return (
    <Link href={projectHref(project.id)} className="nl-card__row">
      <span className="nl-inlinedot" style={tone("--nc-product")} aria-hidden="true" />
      <span className="nl-card__rowtext">
        {project.name} · {project.work ? t(`status.work.${project.work}`) : t("directory.none")}
      </span>
      <span className="nl-card__rowpct">
        {formatNumber(Math.round(Math.max(0, project.remaining)))}
      </span>
    </Link>
  );
}
