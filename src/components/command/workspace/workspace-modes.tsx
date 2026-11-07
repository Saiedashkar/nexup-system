"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useCommand } from "../state/command-store";
import { systemStateLabel, useLocale } from "../i18n/command-locale";
import {
  teamByKind,
  type ActorKind,
  type Capability,
  type CapabilityKind,
  type DepartmentWorkspaceConfig,
  type FlowStage,
  type WorkspaceActor,
  type WorkspaceModeId,
} from "../state/department-workspace";
import { actorHref, actorSlugForWorkspaceActor } from "../state/actor-workspace";
import { IconAgent, IconChevronRight, IconClose, IconHuman } from "../ui/icons";
import { cssVars } from "../ui/css-vars";

/**
 * DEPARTMENT WORKSPACE — the eight modes (Phase UI-03)
 * ───────────────────────────────────────────────────
 * Every mode is a reading of the SAME configuration. None of them fetches,
 * calls an AI or writes anything; each ends by saying what it is.
 *
 * The modes are the information architecture the department will grow into — a
 * place for missions, people and agents, an internal network, a production
 * pipeline, reusable capabilities, memory and connected systems — so the shell
 * is complete before any of that logic exists.
 */

type ModeProps = {
  config: DepartmentWorkspaceConfig;
  /** Only Team mode names the department; the rest read from config. */
  departmentName?: string;
};

export function DepartmentModeBody({
  mode,
  config,
  departmentName,
}: ModeProps & { mode: WorkspaceModeId }) {
  switch (mode) {
    case "overview":
      return <OverviewMode config={config} />;
    case "work":
      return <WorkMode config={config} />;
    case "team":
      return <TeamMode config={config} departmentName={departmentName} />;
    case "map":
      return <MapMode config={config} />;
    case "flow":
      return <FlowMode config={config} />;
    case "capabilities":
      return <CapabilitiesMode config={config} />;
    case "memory":
      return <MemoryMode config={config} />;
    case "systems":
      return <SystemsMode config={config} />;
    default:
      return null;
  }
}

/* ── Overview ─────────────────────────────────────────────────────────────
   A concise operational picture — objective, focus, missions, signals,
   attention, bottleneck, presence and systems — not a wall of metric cards. */

function OverviewMode({ config }: ModeProps) {
  const { t, tc } = useLocale();
  const { humans, agents } = teamByKind(config);
  const online = config.team.filter((actor) => actor.status === "Active" || actor.status === "Thinking");

  return (
    <div className="nc-dw-grid nc-dw-grid--overview">
      <section className="nc-dw-card nc-dw-card--objective">
        <span className="nc-dw-card__kicker">{t("dws.objective")}</span>
        <p className="nc-dw-card__lead">{tc(config.objective)}</p>
        <span className="nc-dw-card__row">
          <span className="nc-dw-card__label">{t("dws.currentFocus")}</span>
          <span className="nc-dw-card__value">{tc(config.focus)}</span>
        </span>
      </section>

      <section className="nc-dw-card nc-dw-card--attention" data-empty={config.attention.length === 0}>
        <span className="nc-dw-card__kicker">{t("dws.factAttention")}</span>
        {config.attention.length === 0 ? (
          <span className="nc-dw-none">{t("dws.nothingNeedsDecision")}</span>
        ) : (
          <ul className="nc-dw-flags">
            {config.attention.map((item) => (
              <li key={item} className="nc-dw-flags__item">
                {tc(item)}
              </li>
            ))}
          </ul>
        )}
        <span className="nc-dw-card__row">
          <span className="nc-dw-card__label">{t("dws.bottleneck")}</span>
          <span className="nc-dw-card__value">{tc(config.bottleneck)}</span>
        </span>
      </section>

      <section className="nc-dw-card">
        <span className="nc-dw-card__kicker">{t("dws.kpiSignals")}</span>
        <dl className="nc-dw-kpis">
          {config.kpis.map((kpi) => (
            <div key={kpi.id} className="nc-dw-kpi">
              <dt>{tc(kpi.label)}</dt>
              <dd className="nc-dw-kpi__value">{kpi.value}</dd>
              <dd className="nc-dw-kpi__trend">{tc(kpi.trend)}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section className="nc-dw-card">
        <span className="nc-dw-card__kicker">{t("dws.activeMissions")}</span>
        <ul className="nc-dw-mini">
          {config.missions
            .filter((mission) => mission.kind === "mission")
            .slice(0, 4)
            .map((mission) => (
              <li key={mission.id} className="nc-dw-mini__row">
                <span className="nc-dw-mini__dot" aria-hidden="true" />
                <span className="nc-dw-mini__title">{tc(mission.title)}</span>
                <span className="nc-dw-mini__meta">{tc(mission.status)}</span>
              </li>
            ))}
        </ul>
      </section>

      <section className="nc-dw-card">
        <span className="nc-dw-card__kicker">{t("dws.peopleOnline")}</span>
        <span className="nc-dw-card__stat">
          {online.length}
          <i>{t("dws.presentOf", { count: config.team.length })}</i>
        </span>
        <span className="nc-dw-card__sub">
          {t(humans.length === 1 ? "dws.humanCount" : "dws.humanCountPlural", { count: humans.length })} ·{" "}
          {t(agents.length === 1 ? "dws.agentCount" : "dws.agentCountPlural", { count: agents.length })}
        </span>
      </section>

      <section className="nc-dw-card">
        <span className="nc-dw-card__kicker">{t("dws.connectedSystems")}</span>
        <ul className="nc-dw-mini">
          {config.systems.map((system) => (
            <li key={system.id} className="nc-dw-mini__row">
              <span className="nc-dw-mini__mark" aria-hidden="true">
                {system.mark}
              </span>
              <span className="nc-dw-mini__title">{system.name}</span>
              <span className="nc-dw-mini__meta" title={tc(system.status)}>
                {systemStateLabel(t, system.statusKind)}
              </span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

/* ── Work ──────────────────────────────────────────────────────────────── */

function WorkMode({ config }: ModeProps) {
  const { t, tc } = useLocale();
  const byKind = (kind: "mission" | "job" | "task") =>
    config.missions.filter((mission) => mission.kind === kind);
  const approvals = config.missions.filter((mission) => mission.status === "Needs you");

  const groups: Array<{ id: string; label: string; items: typeof config.missions }> = [
    { id: "missions", label: t("dws.groupMissions"), items: byKind("mission") },
    { id: "jobs", label: t("dws.groupJobs"), items: byKind("job") },
    { id: "tasks", label: t("dws.groupHumanTasks"), items: byKind("task") },
  ];

  return (
    <div className="nc-dw-work">
      <div className="nc-dw-work__cols">
        {groups.map((group) => (
          <section key={group.id} className="nc-dw-card">
            <span className="nc-dw-card__kicker">
              {group.label} <i>{group.items.length}</i>
            </span>
            <ul className="nc-dw-rows">
              {group.items.map((item) => (
                <li key={item.id} className="nc-dw-row" data-status={item.status}>
                  <span className="nc-dw-row__top">
                    <span className="nc-dw-row__title">{tc(item.title)}</span>
                    <span className="nc-dw-row__status">{tc(item.status)}</span>
                  </span>
                  <span className="nc-dw-row__meta">{tc(item.owner)}</span>
                  <span className="nc-dw-row__meter" aria-hidden="true">
                    <i style={{ width: `${item.progress}%` }} />
                  </span>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>

      <div className="nc-dw-work__side">
        <section className="nc-dw-card nc-dw-card--attention" data-empty={approvals.length === 0}>
          <span className="nc-dw-card__kicker">{t("dws.approvals")}</span>
          {approvals.length === 0 ? (
            <span className="nc-dw-none">{t("dws.nothingWaitingHuman")}</span>
          ) : (
            <ul className="nc-dw-rows">
              {approvals.map((item) => (
                <li key={item.id} className="nc-dw-row" data-status={item.status}>
                  <span className="nc-dw-row__title">{tc(item.title)}</span>
                  <span className="nc-dw-row__meta">{tc(item.owner)}</span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="nc-dw-card">
          <span className="nc-dw-card__kicker">{t("dws.blockers")}</span>
          <ul className="nc-dw-flags">
            {config.attention.map((item) => (
              <li key={item} className="nc-dw-flags__item">
                {tc(item)}
              </li>
            ))}
          </ul>
        </section>

        <section className="nc-dw-card">
          <span className="nc-dw-card__kicker">{t("dws.recentOutput")}</span>
          <ul className="nc-dw-mini">
            {config.capabilities.slice(0, 3).map((capability) => (
              <li key={capability.id} className="nc-dw-mini__row">
                <span className="nc-dw-mini__dot" aria-hidden="true" />
                <span className="nc-dw-mini__title">{tc(capability.name)}</span>
                <span className="nc-dw-mini__meta">{tc(capability.usedBy)}</span>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </div>
  );
}

/* ── Team ──────────────────────────────────────────────────────────────── */

function TeamMode({ config, departmentName = "" }: ModeProps) {
  const { t, tc } = useLocale();
  const { humans, agents } = teamByKind(config);
  const { notify } = useCommand();
  const router = useRouter();

  /* Phase UI-04: every Team item opens the actor's workspace route. The slug is
     resolved through the actor configuration, so this list stays data-driven; a
     member without an actor workspace still degrades to a notice. */
  const openActor = (workspaceActorId: string, name: string) => {
    const slug = actorSlugForWorkspaceActor(workspaceActorId);
    if (slug) router.push(actorHref(slug));
    else notify(t("dws.noActorWorkspace", { name: tc(name) }));
  };

  const groups: Array<{ id: string; label: string; note: string; members: typeof config.team }> = [
    { id: "humans", label: t("dws.teamHumans"), note: t("dws.teamHumansNote"), members: humans },
    { id: "agents", label: t("dws.teamAgents"), note: t("dws.teamAgentsNote"), members: agents },
  ];

  return (
    <div className="nc-dw-team">
      {groups.map((group) => (
        <section key={group.id} className="nc-dw-team__group">
          <header className="nc-dw-team__head">
            <span className="nc-dw-team__label">
              {group.id === "humans" ? <IconHuman size={15} /> : <IconAgent size={15} />}
              {group.label}
              <i>{group.members.length}</i>
            </span>
            <span className="nc-dw-team__note">{tc(group.note)}</span>
          </header>

          <div className="nc-dw-team__grid">
            {group.members.map((actor) => (
              <button
                key={actor.id}
                type="button"
                className="nc-dw-actor"
                data-kind={actor.kind}
                data-actor-id={actor.id}
                onClick={() => openActor(actor.id, actor.name)}
              >
                <span className="nc-dw-actor__top">
                  <span className="nc-dw-actor__avatar" aria-hidden="true">
                    {actor.initials}
                  </span>
                  <span className="nc-dw-actor__id">
                    <span className="nc-dw-actor__name">{tc(actor.name)}</span>
                    <span className="nc-dw-actor__role">{tc(actor.role)}</span>
                  </span>
                  <span className="nc-dw-actor__type" data-kind={actor.kind}>
                    {actor.kind === "human" ? t("dws.kindHuman") : t("dws.kindAi")}
                  </span>
                </span>

                <span className="nc-dw-actor__status" data-status={actor.status}>
                  <i aria-hidden="true" />
                  {tc(actor.status)}
                </span>

                <span className="nc-dw-actor__mission">
                  <span className="nc-dw-actor__mission-label">{t("dws.currentMission")}</span>
                  {tc(actor.mission)}
                </span>

                <span className="nc-dw-actor__cap">{tc(actor.capability)}</span>
              </button>
            ))}
          </div>
        </section>
      ))}

      <p className="nc-dw-note">
        {t("dws.teamNote", { name: departmentName || t("dws.thisDepartment") })}
      </p>
    </div>
  );
}

/* ── Map ─────────────────────────────────────────────────────────────────
   The department's internal network — and the wiring in it is DERIVED, not
   drawn.

   WHAT WAS WRONG BEFORE. This map laid out its columns and then wired each node
   to the next column's `nodes[index % next.length]`. That is modular arithmetic,
   not a relationship: "Lead Acquisition" pointed at "Demand scanning" because
   they happened to be items 2 and 1, not because anyone uses it. Read as a map
   it was a picture of the layout algorithm, and it could not answer the only
   question a department map is for — who is on what, and what that depends on.

   WHAT REPLACES IT. Every line comes from a field the configuration already
   carries, and the line says which relationship it is:

     · OWNERSHIP   `mission.owner` names the role. That role — human or AI — is
       what the work hangs off. It is the same field the Work mode prints as the
       owner and the Overview counts, so the map cannot disagree with them.
     · CAPABILITY  `capability.usedBy` names the role currently drawing on it.
     · DIRECTION   `ownership` ("Human Lead + AI Director") is the authority
       chain, so each human is what the director answers to.
     · SYSTEMS     `systemsForDepartment` is the department↔system relationship,
       and the direction node is what reaches out along it.

   A RELATIONSHIP THE CONFIGURATION DOES NOT STATE DOES NOT EXIST HERE. An owner
   that matches nobody, a capability nobody uses — those are real gaps in the
   department, and a line invented to cover one is the single thing a map must
   never do. The node is still drawn; the readout says in words that nothing is
   wired to it. `systemState` refuses the same way: a modelled system is never
   drawn as a verified live link.

   Selecting a node answers "what is this connected to, and how?" in words, not
   only by dimming what it does not touch.                                  */

type MapTone = "human" | "ai" | "work" | "cap" | "system";
/** The six relationship states shared with `.nc-net` (system.css). */
type NetState = "idle" | "active" | "routing" | "handoff" | "attention" | "completed";
/** The four relationships this map is allowed to draw — and no others. */
type MapRelation = "owns" | "uses" | "directs" | "reaches";
type MapNode = { id: string; label: string; sub: string; tone: MapTone; state: NetState };

/**
 * One node's answer, resolved once: the node itself, everything it is wired to,
 * and each of those relationships with its direction.
 *
 * It is a named type because TWO compositions read it — the desktop readout and
 * the phone's sheet — and a shared shape is what stops the two from drifting into
 * two different explanations of one selection.
 */
type MapSelection = {
  node: MapNode | null;
  connected: Set<string>;
  relations: Array<{
    id: string;
    rel: MapRelation;
    outgoing: boolean;
    tone: MapTone;
    label: string;
  }>;
};
type MapLayer = { id: string; label: string; note: string; tone: MapTone; nodes: MapNode[] };
type MapEdge = { id: string; from: string; to: string; rel: MapRelation };

/* Geometry. Six columns at this ratio still leave each plate room to breathe, and
   `--nc-map-ratio` is set from these two numbers (see `MapMode`) so the canvas'
   aspect-ratio cannot drift away from the viewBox it is drawing into. */
const MAP_W = 1280;
const MAP_H = 420;
const MAP_NODE_W = 168;
const MAP_NODE_H = 48;

function truncate(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

/** The node id a team member carries. The kind is part of the id, which is what
    keeps a human and an AI carrying the same role label apart. */
function actorNodeId(actor: { id: string; kind: ActorKind }): string {
  return `${actor.kind === "human" ? "human" : "ai"}:${actor.id}`;
}

/* ── Node states ────────────────────────────────────────────────────────
   Every state below is read from the configuration's own words. Nothing here
   decides how something *feels*; all of it reports what the data says.       */

function actorState(status: string): NetState {
  switch (status) {
    case "Active":
      return "active";
    case "Thinking":
      return "handoff";
    case "Waiting":
      return "routing";
    default:
      return "idle";
  }
}

/** The work vocabulary the Work mode prints: Active · Running · Review · Needs you · Idle. */
function workState(status: string): NetState {
  switch (status) {
    case "Active":
    case "Running":
      return "active";
    case "Review":
    case "Needs you":
      return "attention";
    case "Waiting":
      return "routing";
    case "Done":
      return "completed";
    default:
      return "idle";
  }
}

/** A capability is only as live as the role drawing on it — and one whose
    `usedBy` names nobody is idle, not decoration. */
function capabilityState(actor: WorkspaceActor | undefined): NetState {
  if (!actor) return "idle";
  return actor.status === "Active" || actor.status === "Thinking" ? "active" : "idle";
}

/** A modelled system is not a live link. `systemStateLabel` already refuses to
    say "Online" about anything unverified; the map draws the same distinction,
    marking the one genuinely unbuilt system apart instead of green-lighting a
    connection this prototype cannot back up. */
function systemState(kind: string): NetState {
  return kind === "development" ? "routing" : "idle";
}

/** The translator types, threaded into the pure builders. */
type T = ReturnType<typeof useLocale>["t"];
type Tc = (source: string) => string;

/**
 * The nodes — every one of them a field the configuration already carries.
 * Nothing is synthesised: a department with no missions gets no work column, and
 * an empty column is dropped rather than padded with a placeholder.
 *
 * The order is the chain the column headers describe — authority, direction,
 * specialists, the work they carry, the capabilities the work draws on, and the
 * systems it reaches — which is also the order that keeps every relationship
 * left-to-right and therefore drawable as one clean sweep.
 */
function buildMapLayers(config: DepartmentWorkspaceConfig, t: T, tc: Tc): MapLayer[] {
  const { humans, agents } = teamByKind(config);
  const director = agents.find((actor) => /director/i.test(actor.role)) ?? agents[0];
  const specialists = agents.filter((actor) => actor.id !== director?.id);
  const actorsByName = new Map(config.team.map((actor) => [actor.name, actor]));

  const member = (actor: WorkspaceActor): MapNode => ({
    id: actorNodeId(actor),
    label: tc(actor.name),
    sub: tc(actor.role),
    tone: actor.kind === "human" ? "human" : "ai",
    state: actorState(actor.status),
  });

  const layers: MapLayer[] = [
    {
      id: "authority",
      label: t("dws.mapLayerAuthority"),
      note: t("dws.mapAuthorityNote"),
      tone: "human",
      nodes: humans.map(member),
    },
    {
      id: "direction",
      label: t("dws.mapLayerDirection"),
      note: t("dws.mapDirectionNote"),
      tone: "ai",
      nodes: director ? [member(director)] : [],
    },
    {
      id: "specialists",
      label: t("dws.mapLayerSpecialists"),
      note: t("dws.mapSpecialistsNote"),
      tone: "ai",
      nodes: specialists.map(member),
    },
    {
      id: "work",
      label: t("dws.mapLayerWork"),
      note: t("dws.mapWorkNote"),
      tone: "work",
      /* Every mission, job and task — not a truncated sample. The owner is shown
         because the owner is the line: a reader can see a row whose owner is not
         on the map without selecting anything. */
      nodes: config.missions.map((item) => ({
        id: `work:${item.id}`,
        label: tc(item.title),
        sub: `${tc(item.owner)} · ${tc(item.status)}`,
        tone: "work",
        state: workState(item.status),
      })),
    },
    {
      id: "capabilities",
      label: t("dws.mapLayerCapabilities"),
      note: t("dws.mapCapabilitiesNote"),
      tone: "cap",
      nodes: config.capabilities.map((capability) => ({
        id: `cap:${capability.id}`,
        label: tc(capability.name),
        sub: tc(capability.kind),
        tone: "cap",
        state: capabilityState(actorsByName.get(capability.usedBy)),
      })),
    },
    {
      id: "systems",
      label: t("dws.mapLayerSystems"),
      note: t("dws.mapSystemsNote"),
      tone: "system",
      nodes: config.systems.map((system) => ({
        id: `sys:${system.id}`,
        label: system.name,
        sub: tc(system.kind),
        tone: "system",
        state: systemState(system.statusKind),
      })),
    },
  ];

  return layers.filter((layer) => layer.nodes.length > 0);
}

/**
 * The relationships, each one naming the field it comes from. A relationship the
 * configuration does not state is not drawn — see the section comment above for
 * why that is the point rather than an omission.
 */
function buildMapEdges(config: DepartmentWorkspaceConfig, layers: MapLayer[]): MapEdge[] {
  const known = new Set(layers.flatMap((layer) => layer.nodes.map((node) => node.id)));
  const edges: MapEdge[] = [];
  const link = (from: string, to: string, rel: MapRelation) => {
    if (from === to || !known.has(from) || !known.has(to)) return;
    edges.push({ id: `${rel}:${from}->${to}`, from, to, rel });
  };

  const { humans, agents } = teamByKind(config);
  const director = agents.find((actor) => /director/i.test(actor.role)) ?? agents[0];
  /** Resolve a role LABEL to the team member that carries it. */
  const role = (name: string) => config.team.find((actor) => actor.name === name);

  /* DIRECTION — `ownership` is "Human Lead + AI Director", so the humans are
     what the director answers to. */
  if (director) {
    humans.forEach((actor) => link(actorNodeId(actor), actorNodeId(director), "directs"));
  }

  /* OWNERSHIP — work hangs off the role that owns it. */
  config.missions.forEach((item) => {
    const owner = role(item.owner);
    if (owner) link(actorNodeId(owner), `work:${item.id}`, "owns");
  });

  /* CAPABILITY — `usedBy` is the role currently drawing on it. */
  config.capabilities.forEach((capability) => {
    const user = role(capability.usedBy);
    if (user) link(actorNodeId(user), `cap:${capability.id}`, "uses");
  });

  /* SYSTEMS — `systemsForDepartment` IS the department↔system relationship, and
     the direction node is the one that reaches along it. */
  if (director) {
    config.systems.forEach((system) => link(actorNodeId(director), `sys:${system.id}`, "reaches"));
  }

  return edges;
}

/** The localized verb for a relationship, from the selected node's own side of it. */
const REL_LABEL: Record<MapRelation, { out: "dws.relOwns" | "dws.relUses" | "dws.relDirects" | "dws.relReaches"; in: "dws.relOwnedBy" | "dws.relUsedBy" | "dws.relDirectedBy" | "dws.relReachedBy" }> = {
  owns: { out: "dws.relOwns", in: "dws.relOwnedBy" },
  uses: { out: "dws.relUses", in: "dws.relUsedBy" },
  directs: { out: "dws.relDirects", in: "dws.relDirectedBy" },
  reaches: { out: "dws.relReaches", in: "dws.relReachedBy" },
};

/**
 * A node's relationships, IN WORDS — the one explanation, used twice.
 *
 * Desktop prints it inline under the diagram; the phone prints the identical
 * list inside an accessible sheet. Extracting it is what makes the two
 * readings equivalent instead of merely similar: there is one sentence
 * generator, so the phone cannot explain a selection differently from the
 * diagram it came from.
 */
function RelationReadout({ selection }: { selection: MapSelection }) {
  const { t } = useLocale();
  if (selection.relations.length === 0) {
    return <p className="nc-dw-map__read-empty">{t("dws.mapNoRelations")}</p>;
  }
  return (
    <ul className="nc-dw-map__rels">
      {selection.relations.map((relation) => (
        <li key={relation.id} className="nc-dw-map__rel" data-tone={relation.tone}>
          <span className="nc-dw-map__rel-word">
            {t(relation.outgoing ? REL_LABEL[relation.rel].out : REL_LABEL[relation.rel].in)}
          </span>
          <span className="nc-dw-map__rel-target">{relation.label}</span>
        </li>
      ))}
    </ul>
  );
}

function MapMode({ config }: ModeProps) {
  const { t, tc } = useLocale();
  const [selected, setSelected] = useState<string | null>(null);
  /* The phone's contextual sheet. It is driven by the SAME `selected` the desk
     diagram uses, so the two cannot disagree about which node is open. */
  const [sheetOpen, setSheetOpen] = useState(false);
  const sheetRef = useRef<HTMLDivElement | null>(null);
  const chipRefs = useRef(new Map<string, HTMLButtonElement | null>());
  const layers = useMemo(() => buildMapLayers(config, t, tc), [config, t, tc]);

  const allNodes = useMemo(() => layers.flatMap((layer) => layer.nodes), [layers]);
  const edges = useMemo(() => buildMapEdges(config, layers), [config, layers]);
  const stateById = useMemo(() => new Map(allNodes.map((node) => [node.id, node.state])), [allNodes]);

  /* Node coordinates are derived from the columns and their contents, never
     hand-placed, so adding a capability or a mission stays a data change. */
  const layout = useMemo(() => {
    const coords = new Map<string, { x: number; y: number }>();
    /* Columns SPAN the canvas — the first and last hug opposite edges — so a
       relationship never has to leave the drawing to reach the end of the chain. */
    const step = (MAP_W - 200) / Math.max(layers.length - 1, 1);
    const pad = 44;
    layers.forEach((layer, column) => {
      const x = 100 + column * step;
      const usable = MAP_H - pad * 2;
      layer.nodes.forEach((node, index) => {
        coords.set(node.id, {
          x,
          y: pad + (usable * (index + 0.5)) / Math.max(layer.nodes.length, 1),
        });
      });
    });
    return { coords };
  }, [layers]);

  /* Selecting a node dims everything it does not touch, and the readout below says
     what it does — so one click answers "what is this connected to, and HOW?"
     rather than only "what is nearby". */
  const selection = useMemo(() => {
    if (!selected) return null;
    const byId = new Map(allNodes.map((node) => [node.id, node]));
    const connected = new Set<string>([selected]);
    const relations = edges
      .filter((edge) => edge.from === selected || edge.to === selected)
      .map((edge) => {
        const outgoing = edge.from === selected;
        const otherId = outgoing ? edge.to : edge.from;
        const other = byId.get(otherId);
        connected.add(otherId);
        return {
          id: edge.id,
          rel: edge.rel,
          outgoing,
          tone: other?.tone ?? "system",
          label: other?.label ?? "",
        };
      });
    return { node: byId.get(selected) ?? null, connected, relations };
  }, [allNodes, edges, selected]);

  /*
   * The sheet behaves like a dialog: Escape closes it from anywhere, not only
   * from a control inside it; opening moves focus into it; closing hands focus
   * back to the chip that opened it, so a keyboard reader is never dropped on a
   * node that no longer exists. Every chip keeps its own ref for that handover.
   */
  const closeSheet = useCallback(() => {
    setSheetOpen(false);
    setSelected((current) => {
      const chip = current ? chipRefs.current.get(current) : null;
      chip?.focus();
      return current;
    });
  }, []);

  useEffect(() => {
    if (!sheetOpen) return;
    sheetRef.current?.querySelector<HTMLElement>("button, a")?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeSheet();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [sheetOpen, closeSheet]);

  const path = (from: string, to: string) => {
    const a = layout.coords.get(from);
    const b = layout.coords.get(to);
    if (!a || !b) return "";
    const mx = (a.x + b.x) / 2;
    return `M ${a.x + MAP_NODE_W / 2} ${a.y} C ${mx} ${a.y}, ${mx} ${b.y}, ${b.x - MAP_NODE_W / 2} ${b.y}`;
  };

  /* A relationship is as live as its FAR end, so a line reports where it leads,
     not where it came from. */
  const stateOf = (nodeId: string): NetState => stateById.get(nodeId) ?? "idle";
  const touched = (edge: MapEdge) =>
    !selection || (selection.connected.has(edge.from) && selection.connected.has(edge.to));

  /* The mobile spine carries the state of the first relationship that actually
     crosses into a column — never a placeholder. */
  const spineState = (index: number): NetState => {
    const previous = new Set(layers[index - 1]?.nodes.map((node) => node.id) ?? []);
    const here = new Set(layers[index].nodes.map((node) => node.id));
    const crossing = edges.find((edge) => previous.has(edge.from) && here.has(edge.to));
    return (crossing ? stateById.get(crossing.to) : undefined) ?? "idle";
  };

  const toggle = (id: string) => setSelected((current) => (current === id ? null : id));

  return (
    <div
      className="nc-dw-map nc-glass"
      data-selected={selected ? "true" : "false"}
      /* The canvas' aspect-ratio is declared from these two numbers, so the CSS
         cannot drift from the viewBox it is drawing into. */
      style={cssVars({ "--nc-map-ratio": `${MAP_W} / ${MAP_H}` })}
    >
      <div className="nc-dw-map__canvas">
        <svg
          className="nc-net nc-dw-map__net"
          viewBox={`0 0 ${MAP_W} ${MAP_H}`}
          preserveAspectRatio="xMidYMid meet"
          aria-hidden="true"
        >
          {edges.map((edge) => (
            <path
              key={edge.id}
              className="nc-net__line"
              /* The state is the DESTINATION's: a line reads as healthy when what
                 it leads to is healthy. The relationship kind is carried too, so
                 a dependency can be drawn lighter than an ownership. */
              data-state={stateOf(edge.to)}
              data-rel={edge.rel}
              data-dim={!touched(edge) ? "true" : undefined}
              d={path(edge.from, edge.to)}
            />
          ))}
          {edges
            .filter((edge) => {
              const state = stateOf(edge.to);
              return (state === "active" || state === "attention") && touched(edge);
            })
            .map((edge) => (
              <path key={`flow-${edge.id}`} className="nc-net__flow" d={path(edge.from, edge.to)} />
            ))}
        </svg>

        <svg
          className="nc-dw-map__nodes"
          viewBox={`0 0 ${MAP_W} ${MAP_H}`}
          preserveAspectRatio="xMidYMid meet"
          role="group"
          aria-label={t("dws.mapNetworkAria", { name: t(`dept.${config.departmentId}.name`) })}
        >
          {layers.map((layer) =>
            layer.nodes.map((node) => {
              const at = layout.coords.get(node.id);
              if (!at) return null;
              const active = selected === node.id;
              const dim = selection ? !selection.connected.has(node.id) : false;
              return (
                <g
                  key={node.id}
                  className="nc-dw-map__node"
                  data-tone={node.tone}
                  data-state={node.state}
                  data-active={active ? "true" : undefined}
                  data-dim={dim ? "true" : undefined}
                  role="button"
                  tabIndex={0}
                  aria-label={`${node.label}, ${node.sub}`}
                  aria-pressed={active}
                  onClick={() => toggle(node.id)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      toggle(node.id);
                    }
                  }}
                >
                  <rect
                    className="nc-dw-map__plate"
                    x={at.x - MAP_NODE_W / 2}
                    y={at.y - MAP_NODE_H / 2}
                    width={MAP_NODE_W}
                    height={MAP_NODE_H}
                    rx={12}
                  />
                  <rect
                    className="nc-dw-map__bar"
                    x={at.x - MAP_NODE_W / 2}
                    y={at.y - MAP_NODE_H / 2}
                    width={3}
                    height={MAP_NODE_H}
                    rx={1.5}
                  />
                  <circle className="nc-dw-map__dot" cx={at.x - MAP_NODE_W / 2 + 17} cy={at.y} r={3.6} />
                  <text className="nc-dw-map__label" x={at.x - MAP_NODE_W / 2 + 30} y={at.y - 3}>
                    {truncate(node.label, 20)}
                  </text>
                  <text className="nc-dw-map__sub" x={at.x - MAP_NODE_W / 2 + 30} y={at.y + 11}>
                    {truncate(node.sub, 24)}
                  </text>
                </g>
              );
            }),
          )}
        </svg>
      </div>

      <div className="nc-dw-map__legend">
        <span data-tone="human">{t("dws.legendHuman")}</span>
        <span data-tone="ai">{t("dws.legendAi")}</span>
        <span data-tone="work">{t("dws.legendWork")}</span>
        <span data-tone="cap">{t("dws.legendCapability")}</span>
        <span data-tone="system">{t("dws.legendSystem")}</span>
      </div>

      {/* What the selection means, in words. Dimming shows what a node does not
          touch; this says what it DOES, and by which relationship — including,
          deliberately, when the answer is "nothing".

          DESKTOP reads it inline, as a live region: the diagram is on screen, so
          a sentence beside it is the whole explanation. The PHONE reads the same
          sentences in the sheet below instead — `workspace.css` hides this block
          under 761px exactly where it shows the vertical chain, so neither
          composition ever prints the list twice. */}
      {selection ? (
        <div className="nc-dw-map__read" role="status">
          <div className="nc-dw-map__read-head">
            <span className="nc-eyebrow">{t("dws.mapRelationsTitle")}</span>
            <span className="nc-dw-map__read-node">{selection.node?.label}</span>
          </div>
          <RelationReadout selection={selection} />
        </div>
      ) : null}

      {/* Mobile recomposition: the same network as a vertical chain, so a phone
          reads the layers top-to-bottom instead of a shrunk diagram.

          THE CHIPS ARE CONTROLS HERE, NOT LABELS. The diagram's nodes are
          buttons with an explanation; the phone's chips are the same nodes in a
          different composition, so they open the same explanation — through a
          sheet, because a chain has no free space beside it to print into. */}
      <div className="nc-dw-map__stack">
        <p className="nc-dw-map__stack-hint" id={`nc-map-hint-${config.departmentId}`}>
          {t("dws.mapTapHint")}
        </p>
        {layers.map((layer, index) => (
          <div key={layer.id} className="nc-dw-map__layer" data-tone={layer.tone}>
            {index > 0 ? (
              <svg className="nc-net nc-dw-map__spine" viewBox="0 0 8 26" preserveAspectRatio="none" aria-hidden="true">
                <path className="nc-net__line" data-state={spineState(index)} d="M4 0 V26" />
              </svg>
            ) : null}
            <div className="nc-dw-map__layer-head">
              <span className="nc-eyebrow">{layer.label}</span>
              <span className="nc-dw-map__layer-note">{tc(layer.note)}</span>
            </div>
            <div className="nc-dw-map__layer-nodes">
              {layer.nodes.map((node) => {
                const active = selected === node.id;
                return (
                  <button
                    key={node.id}
                    type="button"
                    ref={(element) => {
                      chipRefs.current.set(node.id, element);
                    }}
                    className="nc-dw-map__chip"
                    data-tone={node.tone}
                    data-active={active ? "true" : undefined}
                    aria-pressed={active}
                    aria-describedby={`nc-map-hint-${config.departmentId}`}
                    onClick={() => {
                      if (active) {
                        closeSheet();
                        return;
                      }
                      setSelected(node.id);
                      setSheetOpen(true);
                    }}
                  >
                    <i aria-hidden="true" />
                    {node.label}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      {/* The phone's contextual sheet: the desktop readout, in a dialog. It is
          `.nc-sheet`, the same mobile dialog the More navigation uses, so an
          accessible sheet is a pattern this product has, not a second one. */}
      {sheetOpen && selection ? (
        <div className="nc-sheet">
          <button
            type="button"
            className="nc-sheet__scrim"
            aria-label={t("common.close")}
            onClick={closeSheet}
          />
          <div
            className="nc-sheet__panel"
            ref={sheetRef}
            role="dialog"
            aria-modal="true"
            aria-label={t("dws.mapRelationsAria", { name: selection.node?.label ?? "" })}
          >
            <header className="nc-sheet__head">
              <span className="nc-sheet__title">{t("dws.mapRelationsTitle")}</span>
              <button
                type="button"
                className="nc-sheet__close"
                aria-label={t("common.close")}
                onClick={closeSheet}
              >
                <IconClose size={16} />
              </button>
            </header>
            <div className="nc-sheet__body">
              <div className="nc-dw-map__read-head">
                <span className="nc-eyebrow">{selection.node?.sub}</span>
                <span className="nc-dw-map__read-node">{selection.node?.label}</span>
              </div>
              <RelationReadout selection={selection} />
            </div>
          </div>
        </div>
      ) : null}

      <p className="nc-dw-note">
        {t("dws.mapNote")}
      </p>
    </div>
  );
}

/* ── Flow ──────────────────────────────────────────────────────────────── */

/** How work leaves one stage and arrives at the next. */
function flowEdgeState(previous: FlowStage["state"], next: FlowStage["state"]): NetState {
  if (previous === "done" && next === "done") return "completed";
  if (previous === "done" && next === "active") return "active";
  if (previous === "active" && next === "active") return "handoff";
  if (previous === "active" && next === "next") return "routing";
  if (previous === "done" && next === "next") return "routing";
  return "idle";
}

const FLOW_STATUS_KEY = {
  done: "dws.flowDone",
  active: "dws.flowActive",
  next: "dws.flowNext",
} as const;

function FlowMode({ config }: ModeProps) {
  const { t, tc } = useLocale();
  const activeLabels = config.flow.filter((stage) => stage.state === "active").map((stage) => tc(stage.label));
  const doneCount = config.flow.filter((stage) => stage.state === "done").length;
  const links = config.flow.slice(1).map((stage, index) => flowEdgeState(config.flow[index].state, stage.state));
  const handoffs = links.filter((state) => state === "handoff").length;

  return (
    <div className="nc-dw-flow">
      <div className="nc-dw-flow__bar nc-glass nc-glass--lit">
        <span className="nc-dw-flow__dir">
          <IconChevronRight size={14} />
          {tc(config.purpose)}
        </span>
        <span className="nc-dw-flow__meta">
          <span className="nc-dw-flow__stat" data-tone="completed">
            {t("dws.flowCompletedCount", { count: doneCount })}
          </span>
          <span className="nc-dw-flow__stat" data-tone="active">
            {activeLabels.length > 0
              ? t("dws.flowInProgress", { labels: activeLabels.join(" · ") })
              : t("dws.flowNothingRunning")}
          </span>
          {config.attention.length > 0 ? (
            <span className="nc-dw-flow__stat" data-tone="attention">
              {t(config.attention.length === 1 ? "dws.flowBlocker" : "dws.flowBlockers", {
                count: config.attention.length,
              })}
            </span>
          ) : null}
          <span className="nc-dw-flow__stat" data-tone="handoff">
            {t(handoffs === 1 ? "dws.flowHandoff" : "dws.flowHandoffs", { count: handoffs })}
          </span>
        </span>
      </div>

      <ol className="nc-dw-flow__track">
        {config.flow.map((stage, index) => {
          const linkState = index > 0 ? flowEdgeState(config.flow[index - 1].state, stage.state) : null;
          const isActive = stage.state === "active";
          return (
            <li
              key={stage.id}
              className="nc-dw-stage"
              data-state={stage.state}
              data-active={isActive ? "true" : undefined}
            >
              {linkState ? (
                <svg className="nc-net nc-dw-flow__link" viewBox="0 0 34 8" preserveAspectRatio="none" aria-hidden="true">
                  <path className="nc-net__line" data-state={linkState} d="M0 4 H34" />
                  {linkState === "active" ? <path className="nc-net__flow" d="M0 4 H34" /> : null}
                </svg>
              ) : null}

              <span className="nc-dw-stage__top">
                <span className="nc-dw-stage__num" aria-hidden="true">
                  {index + 1}
                </span>
                <span className="nc-dw-stage__label">{tc(stage.label)}</span>
                <span className="nc-dw-stage__status" data-state={stage.state}>
                  <i aria-hidden="true" />
                  {t(FLOW_STATUS_KEY[stage.state])}
                </span>
              </span>
              <span className="nc-dw-stage__note">{tc(stage.note)}</span>
            </li>
          );
        })}
      </ol>

      <p className="nc-dw-note">
        {t("dws.flowNote")}
      </p>
    </div>
  );
}

/* ── Capabilities ──────────────────────────────────────────────────────── */

const CAP_ORDER: CapabilityKind[] = ["Skill", "Tool", "Workflow", "Template", "Automation"];

function CapabilitiesMode({ config }: ModeProps) {
  const { t, tc } = useLocale();
  const groups = CAP_ORDER.map((kind) => ({
    kind,
    items: config.capabilities.filter((capability: Capability) => capability.kind === kind),
  })).filter((group) => group.items.length > 0);

  return (
    <div className="nc-dw-cap">
      <div className="nc-dw-grid nc-dw-grid--caps">
        {groups.map((group) => (
          <section key={group.kind} className="nc-dw-card">
            <span className="nc-dw-card__kicker">
              {tc(group.kind)} <i>{group.items.length}</i>
            </span>
            <ul className="nc-dw-rows">
              {group.items.map((item) => (
                <li key={item.id} className="nc-dw-row">
                  <span className="nc-dw-row__title">{tc(item.name)}</span>
                  <span className="nc-dw-row__meta">{tc(item.note)}</span>
                  <span className="nc-dw-row__used">{t("dws.capUsedBy", { name: tc(item.usedBy) })}</span>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
      <p className="nc-dw-note">{t("dws.capNote")}</p>
    </div>
  );
}

/* ── Memory ────────────────────────────────────────────────────────────── */

/**
 * Memory (Pass 2 — honest labelling)
 *
 * The counts here are illustrative structure, not a measured store: no memory
 * backend exists in this worktree. Pass 2 therefore labels every count as SAMPLE
 * DATA rather than letting a figure like "72 references" read as a real read,
 * and a layer with no count reads as unavailable rather than as zero work.
 */
function MemoryMode({ config }: ModeProps) {
  const { t, tc } = useLocale();
  return (
    <div className="nc-dw-memory">
      <p className="nc-dw-note" data-sample="true">
        {t("provenance.sampleData")} · {t("provenance.sampleDataNote")}
      </p>
      <div className="nc-dw-grid nc-dw-grid--memory">
        {config.memory.map((layer) => {
          const unavailable = layer.count === 0;
          return (
            <section key={layer.id} className="nc-dw-card nc-dw-card--memory" data-unavailable={unavailable}>
              <span className="nc-dw-card__kicker">{tc(layer.label)}</span>
              <span className="nc-dw-card__stat" data-sample={!unavailable}>
                {unavailable ? t("provenance.unavailable") : layer.count}
                <i>
                  {unavailable ? "" : t(layer.count === 1 ? "dws.memoryReference" : "dws.memoryReferences")}
                </i>
              </span>
              <span className="nc-dw-card__sub">{tc(layer.note)}</span>
            </section>
          );
        })}
      </div>
      <p className="nc-dw-note">{t("dws.memoryNote")}</p>
    </div>
  );
}

/* ── Systems ───────────────────────────────────────────────────────────── */

function SystemsMode({ config }: ModeProps) {
  const { notify } = useCommand();
  const { t, tc } = useLocale();

  return (
    <div className="nc-dw-systems">
      <ul className="nc-dw-syslist">
        {config.systems.map((system) => (
          <li key={system.id} className="nc-dw-sys">
            <span className="nc-dw-sys__mark" aria-hidden="true">
              {system.mark}
            </span>
            <span className="nc-dw-sys__body">
              <span className="nc-dw-sys__top">
                <span className="nc-dw-sys__name">{system.name}</span>
                <span className="nc-dw-sys__kind">{tc(system.kind)}</span>
              </span>
              <span className="nc-dw-sys__purpose">{tc(system.purpose)}</span>
            </span>
            <span className="nc-dw-sys__status" data-kind={system.statusKind} title={tc(system.status)}>
              <i aria-hidden="true" />
              {systemStateLabel(t, system.statusKind)}
            </span>
            <button
              type="button"
              className="nc-dw-sys__action"
              onClick={() => notify(t("dws.relationshipToast", { name: system.name }))}
            >
              {t("dws.relationship")}
            </button>
          </li>
        ))}
      </ul>
      <p className="nc-dw-note">{t("dws.systemsNote")}</p>
    </div>
  );
}
