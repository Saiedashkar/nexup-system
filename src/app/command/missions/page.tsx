"use client";

import { useState } from "react";
import { DEPARTMENT_BY_ID, DEPARTMENT_IDS } from "@/components/command/state/organization-model";
import { missionHref } from "@/components/command/lab/areas";
import { useLocale } from "@/components/command/i18n/command-locale";
import {
  Cell,
  LabData,
  LabFrame,
  Mark,
  Meter,
  Pill,
  Row,
  Section,
  Table,
  ViewAll,
  tone,
} from "@/components/command/lab/kit";
import {
  MISSION_STATUS_META,
  PRIORITY_META,
  departmentLoad,
  isLiveMission,
  missionsByStatus,
  companyPulse,
} from "@/components/command/state/demo/selectors";
import type { CommandDataset, Mission, MissionStatus } from "@/components/command/state/demo/types";

/**
 * MISSION CONTROL — the mission list
 * ───────────────────────────────────
 * Every mission the organization is holding, in one place, with the four filters
 * that matter (state, department, priority, and whether a human is holding it).
 *
 * The list reads the SAME dataset as the Command Center's Active Missions panel,
 * so a mission can never appear in one and not the other. Rows are links: this
 * page exists to get you into a mission, not to be the last stop.
 *
 * PASS 2 — BILINGUAL. The state vocabulary comes from the typed dictionary
 * (`status.mission.*`), so a filter chip and a state pill can never disagree
 * about what a state is called; the page's own prose resolves through `tc`.
 */

type Filter = "live" | "all" | MissionStatus | "held";

const FILTERS: Array<{ id: Filter; label: string; status?: MissionStatus }> = [
  { id: "live", label: "Live" },
  { id: "held", label: "Held for a human" },
  { id: "active", label: "Active", status: "active" },
  { id: "review", label: "In review", status: "review" },
  { id: "completed", label: "Completed", status: "completed" },
  { id: "failed", label: "Failed", status: "failed" },
  { id: "all", label: "Everything" },
];

function matches(mission: Mission, filter: Filter): boolean {
  if (filter === "all") return true;
  if (filter === "live") return isLiveMission(mission);
  if (filter === "held") return mission.status === "blocked" || mission.status === "waiting";
  return mission.status === filter;
}

export default function MissionsPage() {
  const { tc } = useLocale();
  return (
    <LabFrame areaId="missions">
      {/* THE GLASS STAGE — this page's own depth. Everything it contains is
          unchanged; the wrapper exists so the three shared background layers
          (`.nlm-air`) can sit behind the figures and the panels, and so the
          champagne-glass direction stays scoped to Mission Control
          (`missions-glass.css`) instead of leaking into the other surfaces. */}
      <div className="nlm-stage">
        <div className="nlm-air" aria-hidden="true">
          <i />
          <i />
          <i />
        </div>
        <LabData
          emptyTitle={tc("No missions exist yet")}
          emptyBody={tc(
            "Mission Control fills the moment work is opened against a department. Nothing is open in this organization right now.",
          )}
        >
          {(dataset) => <MissionList dataset={dataset} />}
        </LabData>
      </div>
    </LabFrame>
  );
}

function MissionList({ dataset }: { dataset: CommandDataset }) {
  const { t, tc } = useLocale();
  const [filter, setFilter] = useState<Filter>("live");
  const [department, setDepartment] = useState<string>("all");

  const status = missionsByStatus(dataset);
  const options = FILTERS.map((f) => ({
    ...f,
    count: dataset.missions.filter((m) => matches(m, f.id)).length,
  }));

  const rows = dataset.missions.filter(
    (m) => matches(m, filter) && (department === "all" || m.departmentId === department),
  );

  const load = departmentLoad(dataset);

  return (
    <>
      <div className="nl-figures" role="list">
        {companyPulse(dataset)
          .filter((figure) => ["missions", "decisions", "blocked", "held"].includes(figure.id))
          .map((figure) => (
            <div key={figure.id} role="listitem" className="nl-figure" style={tone(figure.tone)}>
              <span className="nl-figure__value">{figure.value}</span>
              <span className="nl-figure__label">{tc(figure.label)}</span>
              <span className="nl-figure__note">{tc(figure.note)}</span>
            </div>
          ))}
      </div>

      <Section
        title={t("common.missions")}
        count={rows.length}
        hint={tc("filtered view")}
        action={<ViewAll href="/command/decisions" label={t("areas.decisions.label")} />}
      >
        <div className="nl-readout" role="group" aria-label={t("missions.filtersAria")}>
          <div className="nl-chips">
            {options.map((option) => (
              <button
                key={option.id}
                type="button"
                className="nl-chip"
                data-active={filter === option.id}
                aria-pressed={filter === option.id}
                onClick={() => setFilter(option.id)}
              >
                {option.status
                  ? t(`status.mission.${option.status}`)
                  : option.id === "all"
                    ? t("common.all")
                    : tc(option.label)}
                <span className="nl-chip__count">{option.count}</span>
              </button>
            ))}
          </div>

          <div className="nl-chips" role="group" aria-label={t("missions.departmentAria")}>
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
                <span className="nl-chip__count">{load[id]?.live ?? 0}</span>
              </button>
            ))}
          </div>
        </div>

        {rows.length === 0 ? (
          <p className="nl-quiet">
            {tc(
              "Nothing matches this filter. That is a real answer, not an empty page — switch the filter to see the rest of the organization.",
            )}
          </p>
        ) : (
          <Table head={[t("common.missions"), tc("Department"), tc("State"), tc("Progress")]}>
            {rows.map((mission) => (
              <MissionRow key={mission.id} mission={mission} />
            ))}
          </Table>
        )}
      </Section>

      <Section
        title={tc("State breakdown")}
        span={12}
        hint={tc("the same rows, counted by the state the missions are actually in")}
      >
        <div className="nl-breakdown">
          {(Object.keys(MISSION_STATUS_META) as MissionStatus[]).map((state) => {
            const meta = MISSION_STATUS_META[state];
            const list = status[state];
            return (
              <button
                key={state}
                type="button"
                className="nl-breakdown__cell"
                style={tone(meta.tone)}
                data-empty={list.length === 0}
                onClick={() => setFilter(state)}
              >
                <span className="nl-breakdown__value">{list.length}</span>
                <span className="nl-breakdown__label">{t(`status.mission.${state}`)}</span>
                <span className="nl-breakdown__hint">{tc(meta.hint)}</span>
              </button>
            );
          })}
        </div>
      </Section>
    </>
  );
}

function MissionRow({ mission }: { mission: Mission }) {
  const { t, tc } = useLocale();
  const meta = MISSION_STATUS_META[mission.status];
  const priority = PRIORITY_META[mission.priority];
  const department = DEPARTMENT_BY_ID[mission.departmentId];

  return (
    <Row href={missionHref(mission.id)} accent={department?.accentVar}>
      <Cell variant="lead">
        <Mark>{department?.short.slice(0, 2) ?? "—"}</Mark>
        <span className="nl-cellstack">
          <span className="nl-cell__title">{tc(mission.title)}</span>
          <span className="nl-cell__meta">
            {mission.code} · {tc(mission.owner)} · {t("common.updated")} {mission.updatedAt}
          </span>
        </span>
      </Cell>

      <Cell variant="muted">{department ? t(`dept.${department.id}.name`) : mission.departmentId}</Cell>

      <Cell>
        <Pill label={t(`status.mission.${mission.status}`)} tone={meta.tone} />
        <Pill
          label={t("missions.priorityPill", { level: t(`status.priority.${mission.priority}`) })}
          tone={priority.tone}
          dot={false}
        />
      </Cell>

      <Cell variant="right">
        <Meter value={mission.progress} tone={meta.tone} />
        <span className="nl-cell__num">{mission.progress}%</span>
      </Cell>
    </Row>
  );
}
