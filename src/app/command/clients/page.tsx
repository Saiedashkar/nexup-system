"use client";

import Link from "next/link";
import { useState } from "react";
import { DEPARTMENT_BY_ID } from "@/components/command/state/organization-model";
import { missionHref, projectHref } from "@/components/command/lab/areas";
import { useLocale } from "@/components/command/i18n/command-locale";
import {
  LabData,
  LabFrame,
  Meter,
  Note,
  Pill,
  Section,
  Split,
  tone,
} from "@/components/command/lab/kit";
import { MISSION_STATUS_META, missionsForProject } from "@/components/command/state/demo/selectors";
import type { Client, ClientTier, CommandDataset } from "@/components/command/state/demo/types";

/**
 * CLIENTS — the relationship view
 * ──────────────────────────────
 * Who the organization works for, what they hold open, and how healthy the
 * relationship actually is. Health is shown as a range with the component facts
 * beside it (open items, current work) rather than as a score with no history —
 * a number on its own is the thing this page is trying to avoid.
 *
 * Tier colours come from the approved palette, not from the legacy tier tokens.
 */

const TIER_TONE: Record<ClientTier, string> = {
  VIP: "--nc-violet",
  LOYAL: "--nc-growth",
  NORMAL: "--nc-text-3",
  AT_RISK: "--nc-error",
};

const HEALTH_TONE: Record<Client["status"], string> = {
  healthy: "--nc-completed",
  watch: "--nc-approval",
  "at-risk": "--nc-error",
};

export default function ClientsPage() {
  const { tc } = useLocale();
  return (
    <LabFrame areaId="clients">
      <LabData
        emptyTitle={tc("No clients yet")}
        emptyBody={tc("Client relationships appear here once work is opened for them.")}
      >
        {(dataset) => <Clients dataset={dataset} />}
      </LabData>
    </LabFrame>
  );
}

function Clients({ dataset }: { dataset: CommandDataset }) {
  const { t, tc } = useLocale();
  const [tier, setTier] = useState<"all" | ClientTier>("all");
  const listed = dataset.clients.filter((c) => tier === "all" || c.tier === tier);
  const atRisk = dataset.clients.filter((c) => c.status !== "healthy");

  return (
    <>
      <div className="nl-figures" role="list">
        {[
          { id: "total", value: String(dataset.clients.length), label: "Clients", note: `${dataset.clients.filter((c) => c.tier === "VIP").length} VIP`, tone: "--nc-client" },
          { id: "risk", value: String(atRisk.length), label: "Need attention", note: "watch or at-risk", tone: atRisk.length ? "--nc-approval" : "--nc-completed" },
          {
            id: "open",
            value: String(dataset.clients.reduce((n, c) => n + c.openItems.length, 0)),
            label: "Open items",
            note: "things a client is waiting on",
            tone: "--nc-thinking",
          },
          {
            id: "work",
            value: String(new Set(dataset.clients.flatMap((c) => c.missionIds)).size),
            label: "Missions on client work",
            note: "across all relationships",
            tone: "--nc-growth",
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
        <div className="nl-chips" role="group" aria-label={t("clients.tierAria")}>
          {(["all", "VIP", "LOYAL", "NORMAL"] as const).map((option) => (
            <button
              key={option}
              type="button"
              className="nl-chip"
              data-active={tier === option}
              aria-pressed={tier === option}
              onClick={() => setTier(option)}
            >
              {option === "all" ? tc("All clients") : tc(option)}
              <span className="nl-chip__count">
                {option === "all" ? dataset.clients.length : dataset.clients.filter((c) => c.tier === option).length}
              </span>
            </button>
          ))}
        </div>
      </div>

      <Split
        primary={
          <Section
            title={tc("Relationships")}
            count={listed.length}
            span={12}
            hint={tc("health, current work and what is open")}
          >
            <div className="nl-clients">
              {listed.map((client) => (
                <ClientRow key={client.id} client={client} dataset={dataset} />
              ))}
            </div>
          </Section>
        }
        aside={
          <>
            <Section title={tc("Needs attention")} count={atRisk.length} span={12}>
              {atRisk.length === 0 ? (
                <Note>{tc("Every relationship is healthy. Nothing is ageing or drifting.")}</Note>
              ) : (
                <div className="nl-rows">
                  {atRisk.map((client) => (
                    <Link key={client.id} href={`/command/clients#${client.id}`} className="nl-line" style={tone(HEALTH_TONE[client.status])}>
                      <span className="nl-line__stack">
                        <span className="nl-line__title">{tc(client.name)}</span>
                        <span className="nl-line__meta">{tc(client.openItems[0] ?? client.note)}</span>
                      </span>
                      <span className="nl-line__load">{client.healthScore}</span>
                    </Link>
                  ))}
                </div>
              )}
            </Section>

            <Section title={tc("How this is read")} span={12}>
              <Note>
                {tc(
                  "Health is an illustrative range, not a score the system computes: it moves with receivables ageing, open items and how recently work moved. The component facts are shown beside it so the number can be questioned.",
                )}
              </Note>
              <Note>{tc("Client rows are typed demo data behind the demo adapter. No CRM is connected.")}</Note>
            </Section>
          </>
        }
      />
    </>
  );
}

function ClientRow({ client, dataset }: { client: Client; dataset: CommandDataset }) {
  const { t, tc } = useLocale();
  const projects = dataset.projects.filter((p) => client.projectIds.includes(p.id));

  return (
    <article className="nl-client" id={client.id} style={tone(TIER_TONE[client.tier])}>
      <div className="nl-client__head">
        <div className="nl-cellstack">
          <span className="nl-client__name">{tc(client.name)}</span>
          <span className="nl-client__meta">
            {tc(client.industry)} · {t("clients.sinceLabel")} {client.since} · {t("clients.ownerLabel")} {tc(client.owner)}
          </span>
        </div>
        <Pill label={tc(client.tier)} tone={TIER_TONE[client.tier]} />
        <Pill label={t(`status.client.${client.status}`)} tone={HEALTH_TONE[client.status]} />
      </div>

      <div className="nl-client__health">
        <Meter value={client.healthScore} tone={HEALTH_TONE[client.status]} />
        <span className="nl-cell__num">{client.healthScore}</span>
      </div>

      <p className="nl-client__note">{tc(client.note)}</p>

      {projects.length > 0 && (
        <div className="nl-client__group">
          <span className="nl-subhead">{tc("Projects")}</span>
          {projects.map((project) => (
            <Link key={project.id} href={projectHref(project.id)} className="nl-card__row">
              <span className="nl-inlinedot" style={tone(DEPARTMENT_BY_ID[project.departmentId]?.accentVar ?? "--nc-network")} aria-hidden="true" />
              <span className="nl-card__rowtext">{tc(project.name)}</span>
              <span className="nl-card__rowpct">{project.progress}%</span>
            </Link>
          ))}
        </div>
      )}

      {client.missionIds.length > 0 && (
        <div className="nl-client__group">
          <span className="nl-subhead">{tc("Current work")}</span>
          {client.missionIds.map((id) => {
            const mission = dataset.missions.find((m) => m.id === id);
            if (!mission) return null;
            return (
              <Link key={mission.id} href={missionHref(mission.id)} className="nl-card__row">
                <span className="nl-inlinedot" style={tone(MISSION_STATUS_META[mission.status].tone)} aria-hidden="true" />
                <span className="nl-card__rowtext">
                  {tc(mission.title)} · {t(`status.mission.${mission.status}`)}
                </span>
                <span className="nl-card__rowpct">{mission.progress}%</span>
              </Link>
            );
          })}
        </div>
      )}

      {client.openItems.length > 0 && (
        <div className="nl-client__group">
          <span className="nl-subhead">{tc("Open")}</span>
          {client.openItems.map((item) => (
            <span key={item} className="nl-client__open">
              {tc(item)}
            </span>
          ))}
        </div>
      )}

      {projects.length > 0 && missionsForProject(dataset, projects[0].id).length === 0 && (
        <Note>{tc("No mission has been opened against this client's project yet.")}</Note>
      )}
    </article>
  );
}
