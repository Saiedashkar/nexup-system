"use client";

import Link from "next/link";
import { useState } from "react";
import { agentHref } from "@/components/command/lab/areas";
import { useLocale } from "@/components/command/i18n/command-locale";
import {
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
  modelAvailabilitySummary,
  modelDefaultRoles,
} from "@/components/command/state/demo/selectors";
import type {
  CommandDataset,
  ModelEntry,
  ModelProvider,
} from "@/components/command/state/demo/types";

/**
 * MODEL CONTROL CENTER — UI shell only
 * ────────────────────────────────────
 * The registry, read as a control surface: what exists, what it can do, what it
 * costs, how fast it answers, whether it is available, whether it is entitled,
 * and which entries the registry treats as default or fallback.
 *
 * THERE IS NO ROUTER HERE. No ModelRouter, no routing policy, no dispatch, no
 * spend. This page will consume the separate Model Control architecture in a
 * later step; today it is a read-only shell over typed demo rows, and it says so
 * on the surface rather than in a comment.
 */

const AVAILABILITY_TONE: Record<ModelEntry["availability"], string> = {
  available: "--nc-completed",
  degraded: "--nc-approval",
  unavailable: "--nc-error",
  reserved: "--nc-violet",
};

const QUOTA_TONE: Record<ModelEntry["quota"]["state"], string> = {
  ok: "--nc-completed",
  "near-limit": "--nc-approval",
  exhausted: "--nc-error",
  unmetered: "--nc-text-4",
};

const COST_TONE: Record<ModelEntry["costClass"], string> = {
  premium: "--nc-error",
  standard: "--nc-approval",
  economy: "--nc-completed",
  local: "--nc-violet",
};

export default function ModelsPage() {
  const { tc } = useLocale();
  return (
    <LabFrame areaId="models">
      <LabData
        emptyTitle={tc("No models registered")}
        emptyBody={tc("The registry is empty. Nothing is registered against this organization.")}
      >
        {(dataset) => <Models dataset={dataset} />}
      </LabData>
    </LabFrame>
  );
}

function Models({ dataset }: { dataset: CommandDataset }) {
  const { t, tc } = useLocale();
  const [provider, setProvider] = useState<"all" | ModelProvider>("all");
  const [tier, setTier] = useState<"all" | ModelEntry["intelligenceTier"]>("all");

  const summary = modelAvailabilitySummary(dataset);
  const roles = modelDefaultRoles(dataset);

  const listed = dataset.models
    .filter((m) => provider === "all" || m.provider === provider)
    .filter((m) => tier === "all" || m.intelligenceTier === tier);

  const providers = Array.from(new Set(dataset.models.map((m) => m.provider)));

  return (
    <>
      <div className="nl-flags">
        <div className="nl-flag nl-flag__long" style={tone("--nc-violet")}>
          <span className="nl-flag__label">{tc("UI shell only")}</span>
          <span className="nl-flag__text">
            {tc(
              "No ModelRouter, no routing policy and no dispatch run in this worktree. This surface is a read-only shell over typed demo rows; it will consume the separate Model Control architecture later.",
            )}
          </span>
        </div>
      </div>

      <div className="nl-figures" role="list">
        {[
          { id: "total", value: String(summary.total), label: "Registered runtimes", note: t("models.providerCount", { count: providers.length }), tone: "--nc-network" },
          { id: "available", value: String(summary.available), label: "Available", note: t("models.availableNote", { degraded: summary.degraded, unavailable: summary.unavailable }), tone: "--nc-completed" },
          { id: "constrained", value: String(summary.constrained), label: "Quota constrained", note: "near or past the allowance", tone: "--nc-approval" },
          { id: "entitled", value: String(summary.awaitingEntitlement), label: "Need entitlement", note: "not provisioned or requires approval", tone: "--nc-violet" },
          { id: "fallbacks", value: String(roles.fallbacks.length), label: "Fallbacks", note: t("models.defaultsNote", { count: roles.defaults.length }), tone: "--nc-thinking" },
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
              title={tc("Runtime registry")}
              count={listed.length}
              span={12}
              hint={tc("capability · tier · cost · latency · context · tools · availability · quota · entitlement")}
            >
              <div className="nl-filters">
                <div className="nl-chips" role="group" aria-label={t("models.providerAria")}>
                  <button
                    type="button"
                    className="nl-chip"
                    data-active={provider === "all"}
                    aria-pressed={provider === "all"}
                    onClick={() => setProvider("all")}
                  >
                    {tc("All providers")}
                  </button>
                  {providers.map((p) => (
                    <button
                      key={p}
                      type="button"
                      className="nl-chip"
                      data-active={provider === p}
                      aria-pressed={provider === p}
                      onClick={() => setProvider(p)}
                    >
                      {p}
                    </button>
                  ))}
                </div>
                <div className="nl-chips" role="group" aria-label={t("models.tierAria")}>
                  {(["all", "frontier", "high", "balanced", "economy"] as const).map((option) => (
                    <button
                      key={option}
                      type="button"
                      className="nl-chip"
                      data-active={tier === option}
                      aria-pressed={tier === option}
                      onClick={() => setTier(option)}
                    >
                      {option === "all" ? tc("All tiers") : option}
                    </button>
                  ))}
                </div>
              </div>

              <div className="nl-models">
                <div className="nl-model nl-model--head" aria-hidden="true">
                  <span>{tc("Runtime")}</span>
                  <span>{tc("Intelligence")}</span>
                  <span>{tc("Cost / latency")}</span>
                  <span>{tc("Context")}</span>
                  <span>{tc("Availability")}</span>
                  <span>{tc("Quota & entitlement")}</span>
                </div>

                {listed.map((model) => (
                  <div key={model.id} className="nl-model" style={tone(AVAILABILITY_TONE[model.availability])}>
                    <span className="nl-cellstack">
                      <span className="nl-model__name">{model.name}</span>
                      <span className="nl-model__provider">
                        {model.provider} · {model.family} · {t("models.toolsCount", { count: model.toolSupport })}
                      </span>
                      <span className="nl-chipwall">
                        {model.roles.map((role) => (
                          <span key={role} className="nl-tag nl-tag--tight">
                            {t(`models.role.${role}`)}
                          </span>
                        ))}
                      </span>
                    </span>

                    <span className="nl-model__cell" data-hide="phone">
                      {model.intelligenceTier}
                      <span className="nl-model__provider">{model.capabilities.join(" · ")}</span>
                    </span>

                    <span className="nl-model__cell" data-hide="tablet">
                      <Pill label={t(`models.cost.${model.costClass}`)} tone={COST_TONE[model.costClass]} dot={false} />
                      <span className="nl-model__provider">{model.latencyClass}</span>
                    </span>

                    <span className="nl-model__cell" data-hide="narrow">
                      {Math.round(model.contextWindow / 1000)}k
                    </span>

                    <span className="nl-model__cell">
                      <Pill label={t(`models.availabilityLabel.${model.availability}`)} tone={AVAILABILITY_TONE[model.availability]} />
                    </span>

                    <span className="nl-model__quota">
                      <Meter value={model.quota.usedPct} tone={QUOTA_TONE[model.quota.state]} />
                      <span className="nl-model__quotanote">
                        {tc(model.quota.note)} · {tc(model.entitlement)}
                      </span>
                    </span>
                  </div>
                ))}
              </div>

              <Note>
                {tc(
                  "Rows are typed demo data. Tier, cost, latency, context, tool support, availability, quota and entitlement are all read from the dataset — nothing here is derived from a live provider.",
                )}
              </Note>
            </Section>
          </>
        }
        aside={
          <>
            <Section
              title={tc("Registry defaults")}
              count={roles.defaults.length}
              span={12}
              hint={tc("the entries work is routed to by default")}
            >
              <div className="nl-rows">
                {roles.defaults.map((model) => (
                  <div key={model.id} className="nl-line" style={tone(COST_TONE[model.costClass])}>
                    <span className="nl-line__stack">
                      <span className="nl-line__title">{model.name}</span>
                      <span className="nl-line__meta">
                        {model.provider} · {model.intelligenceTier} ·{" "}
                        {t("models.identities", { count: model.agents.length })}
                      </span>
                    </span>
                  </div>
                ))}
              </div>
            </Section>

            <Section
              title={tc("Fallbacks")}
              count={roles.fallbacks.length}
              span={12}
              hint={tc("what survives a provider outage")}
            >
              <div className="nl-rows">
                {roles.fallbacks.map((model) => (
                  <div key={model.id} className="nl-line" style={tone(AVAILABILITY_TONE[model.availability])}>
                    <span className="nl-line__stack">
                      <span className="nl-line__title">{model.name}</span>
                      <span className="nl-line__meta">{tc(model.note)}</span>
                    </span>
                  </div>
                ))}
                {roles.fallbacks.length === 0 && <Note>{tc("No cross-provider fallback is registered.")}</Note>}
              </div>
            </Section>

            <Section
              title={tc("Quota watch")}
              count={dataset.models.filter((m) => m.quota.usedPct >= 75).length}
              span={12}
              hint={tc("75% or more consumed")}
            >
              <div className="nl-rows">
                {dataset.models
                  .filter((m) => m.quota.usedPct >= 75)
                  .map((model) => (
                    <div key={model.id} className="nl-line" style={tone(QUOTA_TONE[model.quota.state])}>
                      <span className="nl-line__stack">
                        <span className="nl-line__title">{model.name}</span>
                        <span className="nl-line__meta">{tc(model.quota.note)}</span>
                      </span>
                      <span className="nl-line__load">{model.quota.usedPct}%</span>
                    </div>
                  ))}
              </div>
            </Section>

            <Section
              title={tc("Identities registered here")}
              span={12}
              hint={t("models.registryHint")}
            >
              <div className="nl-rows">
                {dataset.models
                  .filter((m) => m.agents.length > 0)
                  .slice(0, 5)
                  .map((model) => (
                    <div key={model.id} className="nl-line">
                      <span className="nl-line__stack">
                        <span className="nl-line__title">{model.name}</span>
                        <span className="nl-line__meta">
                          {model.agents
                            .map((id) => dataset.agents.find((a) => a.id === id)?.name ?? id)
                            .join(" · ")}
                        </span>
                      </span>
                    </div>
                  ))}
              </div>
              <MockButton
                message={tc("Assigning or detaching a runtime is an architecture decision — nothing was changed.")}
              >
                {tc("Change registry bindings")}
              </MockButton>
            </Section>

            <Section title={tc("Related surfaces")} span={12}>
              <Note>
                {tc(
                  "Where these entries are referenced today: the workforce directory shows each identity's registered runtime, and Finance shows consumption as a control. Neither dispatches anything.",
                )}
              </Note>
              <div className="nl-chipwall">
                {dataset.agents
                  .filter((a) => a.tier === "director")
                  .slice(0, 5)
                  .map((agent) => (
                    <Link key={agent.id} className="nl-tag" href={agentHref(agent.id)}>
                      {agent.name}
                    </Link>
                  ))}
              </div>
            </Section>
          </>
        }
      />
    </>
  );
}
