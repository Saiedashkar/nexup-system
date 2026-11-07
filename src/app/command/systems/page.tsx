"use client";

import Link from "next/link";
import { useState } from "react";
import { DEPARTMENT_BY_ID } from "@/components/command/state/organization-model";
import { useLocale } from "@/components/command/i18n/command-locale";
import {
  LabData,
  LabFrame,
  Note,
  Pill,
  Section,
  Split,
  tone,
} from "@/components/command/lab/kit";
import { SYSTEM_STATE_META, systemHealth } from "@/components/command/state/demo/selectors";
import type { CommandDataset, SystemIntegration, SystemState } from "@/components/command/state/demo/types";

/**
 * SYSTEMS — the integration control map
 * ────────────────────────────────────
 * Thirteen connections, each in one of six honest states, each with the evidence
 * that puts it there. This page is deliberately the opposite of an integration
 * dashboard: the default is not green, and a system is only "connected" if the
 * repository can prove it.
 *
 * The map is a control surface — nodes carry their own coordinates in the
 * dataset, wires follow `dependsOn` — and the list beside it carries the
 * detail: purpose, capabilities, owner, dependencies and what the state means.
 *
 * PASS 2 — state words come from `status.system.*`, so the legend, the list and
 * the detail panel can never use three different words for one state.
 */

export default function SystemsPage() {
  const { tc } = useLocale();
  return (
    <LabFrame areaId="systems">
      <LabData
        emptyTitle={tc("No systems mapped.")}
        emptyBody={tc("The connection map is empty. Nothing is modelled in this read.")}
      >
        {(dataset) => <Systems dataset={dataset} />}
      </LabData>
    </LabFrame>
  );
}

function Systems({ dataset }: { dataset: CommandDataset }) {
  const { t, tc } = useLocale();
  const [selectedId, setSelectedId] = useState<string>(dataset.systems[0]?.id ?? "");
  const [state, setState] = useState<"all" | SystemState>("all");

  const health = systemHealth(dataset);
  const selected = dataset.systems.find((s) => s.id === selectedId) ?? dataset.systems[0];
  const listed = dataset.systems.filter((s) => state === "all" || s.state === state);

  return (
    <>
      <div className="nl-figures" role="list">
        {[
          { id: "total", value: String(health.total), label: "Mapped", note: "every connection the organization depends on", tone: "--nc-network" },
          { id: "usable", value: String(health.usable), label: "Usable", note: "connected or partial", tone: "--nc-completed" },
          { id: "degraded", value: String(health.degraded), label: "Not fully usable", note: "mock, missing, blocked or held", tone: "--nc-approval" },
          { id: "blocked", value: String(health.blocked), label: "Blocked", note: "waiting on something outside the code", tone: "--nc-blocked" },
          { id: "missing", value: String(health.missing), label: "Missing", note: "no client, no credential, no code", tone: "--nc-text-3" },
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
            <Section title={tc("Connection map")} span={12} hint={tc("select a node to read its state and its evidence")}>
              <div className="nl-map">
                <span className="nl-map__grid" aria-hidden="true" />
                <svg className="nl-map__svg" aria-hidden="true" viewBox="0 0 100 100" preserveAspectRatio="none">
                  {dataset.systems.flatMap((system) =>
                    system.dependsOn.map((target) => {
                      const to = dataset.systems.find((s) => s.id === target);
                      if (!to) return null;
                      return (
                        <line
                          key={`${system.id}-${target}`}
                          className="nl-map__wire"
                          x1={system.at.x}
                          y1={system.at.y}
                          x2={to.at.x}
                          y2={to.at.y}
                          vectorEffect="non-scaling-stroke"
                        />
                      );
                    }),
                  )}
                </svg>

                {dataset.systems.map((system) => {
                  const meta = SYSTEM_STATE_META[system.state];
                  return (
                    <button
                      key={system.id}
                      type="button"
                      className="nl-map__node"
                      style={{
                        left: `${system.at.x}%`,
                        top: `${system.at.y}%`,
                        ...tone(meta.tone),
                      }}
                      data-state={system.state}
                      data-selected={selected?.id === system.id}
                      onClick={() => setSelectedId(system.id)}
                    >
                      <span className="nl-map__dot" aria-hidden="true" />
                      {system.name}
                    </button>
                  );
                })}
              </div>

              <div className="nl-map__legend">
                {(Object.keys(SYSTEM_STATE_META) as SystemState[]).map((key) => (
                  <button
                    key={key}
                    type="button"
                    className="nl-map__key"
                    style={tone(SYSTEM_STATE_META[key].tone)}
                    data-active={state === key}
                    onClick={() => setState(state === key ? "all" : key)}
                  >
                    <i aria-hidden="true" />
                    {t(`status.system.${key}`)}
                    <span className="nl-map__count">{health.counts[key] ?? 0}</span>
                  </button>
                ))}
              </div>
            </Section>

            <Section
              title={tc("Connections")}
              count={listed.length}
              span={12}
              hint={state === "all" ? t("systems.allStates") : t("systems.filtered", { state: t(`status.system.${state}`) })}
            >
              <div className="nl-rows">
                {listed.map((system) => {
                  const meta = SYSTEM_STATE_META[system.state];
                  return (
                    <button
                      key={system.id}
                      type="button"
                      className="nl-line nl-line--button"
                      style={tone(meta.tone)}
                      data-selected={selected?.id === system.id}
                      onClick={() => setSelectedId(system.id)}
                    >
                      <span className="nl-mark" aria-hidden="true">
                        {system.mark}
                      </span>
                      <span className="nl-line__stack">
                        <span className="nl-line__title">{system.name}</span>
                        <span className="nl-line__meta">
                          {tc(system.category)} · {tc(system.purpose)}
                        </span>
                      </span>
                      <Pill label={t(`status.system.${system.state}`)} tone={meta.tone} />
                    </button>
                  );
                })}
              </div>
            </Section>
          </>
        }
        aside={
          <>
            {selected && <SystemDetail system={selected} dataset={dataset} />}

            <Section title={tc("How to read a state")} span={12}>
              <div className="nl-rows">
                {(Object.keys(SYSTEM_STATE_META) as SystemState[]).map((key) => (
                  <div key={key} className="nl-line" style={tone(SYSTEM_STATE_META[key].tone)}>
                    <span className="nl-line__stack">
                      <span className="nl-line__title">{t(`status.system.${key}`)}</span>
                      <span className="nl-line__meta">{tc(SYSTEM_STATE_META[key].hint)}</span>
                    </span>
                  </div>
                ))}
              </div>
              <Note>
                {tc(
                  "These are product states for the prototype, with the exception of the ones this repository can prove. Where the state is a claim, the evidence line says where the claim comes from.",
                )}
              </Note>
            </Section>
          </>
        }
      />
    </>
  );
}

function SystemDetail({ system, dataset }: { system: SystemIntegration; dataset: CommandDataset }) {
  const { t, tc } = useLocale();
  const meta = SYSTEM_STATE_META[system.state];
  const dependencies = system.dependsOn
    .map((id) => dataset.systems.find((s) => s.id === id))
    .filter((s): s is NonNullable<typeof s> => Boolean(s));

  return (
    <Section title={system.name} span={12} hint={tc(system.category)}>
      <div className="nl-stack">
        <div className="nl-detail__head">
          <span className="nl-mark" aria-hidden="true">
            {system.mark}
          </span>
          <Pill label={t(`status.system.${system.state}`)} tone={meta.tone} />
          <span className="nl-card__spacer" />
        </div>

        <p className="nl-detail__purpose">{tc(system.purpose)}</p>
        <p className="nl-detail__state">{tc(system.stateDetail)}</p>

        <div className="nl-detail__grid">
          <span className="nl-subhead">{tc("Capabilities")}</span>
          <div className="nl-chipwall">
            {system.capabilities.map((capability) => (
              <span key={capability} className="nl-tag">
                {tc(capability)}
              </span>
            ))}
          </div>

          <span className="nl-subhead">{tc("Reached by")}</span>
          <div className="nl-chipwall">
            {system.linkedDepartments.map((id) => (
              <span key={id} className="nl-tag">
                {DEPARTMENT_BY_ID[id] ? t(`dept.${id}.name`) : id}
              </span>
            ))}
          </div>

          <span className="nl-subhead">{tc("Owner")}</span>
          <span className="nl-cell__num">{tc(system.owner)}</span>

          {dependencies.length > 0 && (
            <>
              <span className="nl-subhead">{tc("Depends on")}</span>
              <div className="nl-chipwall">
                {dependencies.map((dependency) => (
                  <span key={dependency.id} className="nl-tag" style={tone(SYSTEM_STATE_META[dependency.state].tone)}>
                    {dependency.name}
                  </span>
                ))}
              </div>
            </>
          )}
        </div>

        <div className="nl-evidence" style={tone(meta.tone)}>
          <span className="nl-flag__label">{tc("Evidence")}</span>
          <span className="nl-flag__text">{tc(system.evidence)}</span>
        </div>

        {system.href && (
          <Link className="nl-btn" data-variant="primary" href={system.href}>
            {t("systems.openReal", { name: system.name })}
          </Link>
        )}
      </div>
    </Section>
  );
}
