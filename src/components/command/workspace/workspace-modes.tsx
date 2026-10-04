"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useCommand } from "../state/command-store";
import {
  teamByKind,
  type Capability,
  type CapabilityKind,
  type DepartmentWorkspaceConfig,
  type FlowStage,
  type WorkspaceModeId,
} from "../state/department-workspace";
import { actorHref, actorSlugForWorkspaceActor } from "../state/actor-workspace";
import { IconAgent, IconChevronRight, IconHuman } from "../ui/icons";

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
  const { humans, agents } = teamByKind(config);
  const online = config.team.filter((actor) => actor.status === "Active" || actor.status === "Thinking");

  return (
    <div className="nc-dw-grid nc-dw-grid--overview">
      <section className="nc-dw-card nc-dw-card--objective">
        <span className="nc-dw-card__kicker">Objective</span>
        <p className="nc-dw-card__lead">{config.objective}</p>
        <span className="nc-dw-card__row">
          <span className="nc-dw-card__label">Current focus</span>
          <span className="nc-dw-card__value">{config.focus}</span>
        </span>
      </section>

      <section className="nc-dw-card nc-dw-card--attention" data-empty={config.attention.length === 0}>
        <span className="nc-dw-card__kicker">Needs attention</span>
        {config.attention.length === 0 ? (
          <span className="nc-dw-none">Nothing needs a decision right now.</span>
        ) : (
          <ul className="nc-dw-flags">
            {config.attention.map((item) => (
              <li key={item} className="nc-dw-flags__item">
                {item}
              </li>
            ))}
          </ul>
        )}
        <span className="nc-dw-card__row">
          <span className="nc-dw-card__label">Bottleneck</span>
          <span className="nc-dw-card__value">{config.bottleneck}</span>
        </span>
      </section>

      <section className="nc-dw-card">
        <span className="nc-dw-card__kicker">KPI signals</span>
        <dl className="nc-dw-kpis">
          {config.kpis.map((kpi) => (
            <div key={kpi.id} className="nc-dw-kpi">
              <dt>{kpi.label}</dt>
              <dd className="nc-dw-kpi__value">{kpi.value}</dd>
              <dd className="nc-dw-kpi__trend">{kpi.trend}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section className="nc-dw-card">
        <span className="nc-dw-card__kicker">Active missions</span>
        <ul className="nc-dw-mini">
          {config.missions
            .filter((mission) => mission.kind === "mission")
            .slice(0, 4)
            .map((mission) => (
              <li key={mission.id} className="nc-dw-mini__row">
                <span className="nc-dw-mini__dot" aria-hidden="true" />
                <span className="nc-dw-mini__title">{mission.title}</span>
                <span className="nc-dw-mini__meta">{mission.status}</span>
              </li>
            ))}
        </ul>
      </section>

      <section className="nc-dw-card">
        <span className="nc-dw-card__kicker">People &amp; agents online</span>
        <span className="nc-dw-card__stat">
          {online.length}
          <i>of {config.team.length} present</i>
        </span>
        <span className="nc-dw-card__sub">
          {humans.length} human{humans.length === 1 ? "" : "s"} · {agents.length} AI agent
          {agents.length === 1 ? "" : "s"}
        </span>
      </section>

      <section className="nc-dw-card">
        <span className="nc-dw-card__kicker">Connected systems</span>
        <ul className="nc-dw-mini">
          {config.systems.map((system) => (
            <li key={system.id} className="nc-dw-mini__row">
              <span className="nc-dw-mini__mark" aria-hidden="true">
                {system.mark}
              </span>
              <span className="nc-dw-mini__title">{system.name}</span>
              <span className="nc-dw-mini__meta">{system.status}</span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

/* ── Work ──────────────────────────────────────────────────────────────── */

function WorkMode({ config }: ModeProps) {
  const byKind = (kind: "mission" | "job" | "task") =>
    config.missions.filter((mission) => mission.kind === kind);
  const approvals = config.missions.filter((mission) => mission.status === "Needs you");

  const groups: Array<{ id: string; label: string; items: typeof config.missions }> = [
    { id: "missions", label: "Missions", items: byKind("mission") },
    { id: "jobs", label: "Jobs", items: byKind("job") },
    { id: "tasks", label: "Human tasks", items: byKind("task") },
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
                    <span className="nc-dw-row__title">{item.title}</span>
                    <span className="nc-dw-row__status">{item.status}</span>
                  </span>
                  <span className="nc-dw-row__meta">{item.owner}</span>
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
          <span className="nc-dw-card__kicker">Approvals</span>
          {approvals.length === 0 ? (
            <span className="nc-dw-none">Nothing waiting on a human.</span>
          ) : (
            <ul className="nc-dw-rows">
              {approvals.map((item) => (
                <li key={item.id} className="nc-dw-row" data-status={item.status}>
                  <span className="nc-dw-row__title">{item.title}</span>
                  <span className="nc-dw-row__meta">{item.owner}</span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="nc-dw-card">
          <span className="nc-dw-card__kicker">Blockers</span>
          <ul className="nc-dw-flags">
            {config.attention.map((item) => (
              <li key={item} className="nc-dw-flags__item">
                {item}
              </li>
            ))}
          </ul>
        </section>

        <section className="nc-dw-card">
          <span className="nc-dw-card__kicker">Recent output</span>
          <ul className="nc-dw-mini">
            {config.capabilities.slice(0, 3).map((capability) => (
              <li key={capability.id} className="nc-dw-mini__row">
                <span className="nc-dw-mini__dot" aria-hidden="true" />
                <span className="nc-dw-mini__title">{capability.name}</span>
                <span className="nc-dw-mini__meta">{capability.usedBy}</span>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </div>
  );
}

/* ── Team ──────────────────────────────────────────────────────────────── */

function TeamMode({ config, departmentName = "this department" }: ModeProps) {
  const { humans, agents } = teamByKind(config);
  const { notify } = useCommand();
  const router = useRouter();

  /* Phase UI-04: every Team item opens the actor's workspace route. The slug is
     resolved through the actor configuration, so this list stays data-driven; a
     member without an actor workspace still degrades to a notice. */
  const openActor = (workspaceActorId: string, name: string) => {
    const slug = actorSlugForWorkspaceActor(workspaceActorId);
    if (slug) router.push(actorHref(slug));
    else notify(`${name} — no actor workspace is configured yet.`);
  };

  const groups: Array<{ id: string; label: string; note: string; members: typeof config.team }> = [
    { id: "humans", label: "Humans", note: "Hold authority and final calls.", members: humans },
    { id: "agents", label: "AI agents", note: "Hold throughput and route work.", members: agents },
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
            <span className="nc-dw-team__note">{group.note}</span>
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
                    <span className="nc-dw-actor__name">{actor.name}</span>
                    <span className="nc-dw-actor__role">{actor.role}</span>
                  </span>
                  <span className="nc-dw-actor__type" data-kind={actor.kind}>
                    {actor.kind === "human" ? "Human" : "AI"}
                  </span>
                </span>

                <span className="nc-dw-actor__status" data-status={actor.status}>
                  <i aria-hidden="true" />
                  {actor.status}
                </span>

                <span className="nc-dw-actor__mission">
                  <span className="nc-dw-actor__mission-label">Current mission</span>
                  {actor.mission}
                </span>

                <span className="nc-dw-actor__cap">{actor.capability}</span>
              </button>
            ))}
          </div>
        </section>
      ))}

      <p className="nc-dw-note">
        Identities are role-based. Every item opens that actor&apos;s workspace — role, skills, tools, memory and a
        direct command surface — where {departmentName} humans and agents are treated the same.
      </p>
    </div>
  );
}

/* ── Map ─────────────────────────────────────────────────────────────────
   A DOM/SVG network mock: Human Lead → AI Director → Agents → Capabilities →
   Systems. Thin cyan lines, no 3D. Left as a visual foundation for the real
   internal department network.                                            */

type MapTone = "human" | "ai" | "cap" | "system";
/** The six relationship states shared with `.nc-net` (system.css). */
type NetState = "idle" | "active" | "routing" | "handoff" | "attention" | "completed";
type MapNode = { id: string; label: string; sub: string; tone: MapTone };
type MapLayer = { id: string; label: string; note: string; tone: MapTone; nodes: MapNode[] };

const MAP_W = 1120;
const MAP_H = 380;
const MAP_NODE_W = 176;
const MAP_NODE_H = 48;

/** Relationship meaning by boundary, in the order work actually flows. */
const MAP_BOUNDARY_STATES: NetState[] = ["active", "routing", "handoff", "completed"];

function truncate(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

/**
 * The department's internal network, as the chain work moves along:
 * Authority (human lead) → Direction (AI director) → Specialists →
 * Capabilities (skills/tools/workflows) → Systems & missions.
 */
function buildMapLayers(config: DepartmentWorkspaceConfig): MapLayer[] {
  const { humans, agents } = teamByKind(config);
  const director = agents.find((actor) => /director/i.test(actor.role)) ?? agents[0];
  const specialists = agents.filter((actor) => actor.id !== director?.id);

  const layers: MapLayer[] = [
    {
      id: "authority",
      label: "Authority",
      note: "Holds the mandate and the final call.",
      tone: "human",
      nodes: humans.map((actor) => ({ id: `human:${actor.id}`, label: actor.name, sub: actor.role, tone: "human" })),
    },
    {
      id: "direction",
      label: "Direction",
      note: "Sets intent and routes the work.",
      tone: "ai",
      nodes: director
        ? [{ id: `ai:${director.id}`, label: director.name, sub: director.role, tone: "ai" }]
        : [],
    },
    {
      id: "specialists",
      label: "Specialists",
      note: "Carry the throughput.",
      tone: "ai",
      nodes: specialists.map((actor) => ({ id: `ai:${actor.id}`, label: actor.name, sub: actor.role, tone: "ai" })),
    },
    {
      id: "capabilities",
      label: "Capabilities",
      note: "Skills, tools and workflows they draw on.",
      tone: "cap",
      nodes: config.capabilities.slice(0, 5).map((capability) => ({
        id: `cap:${capability.id}`,
        label: capability.name,
        sub: capability.kind,
        tone: "cap",
      })),
    },
    {
      id: "systems",
      label: "Systems & work",
      note: "Where the output lands.",
      tone: "system",
      nodes: [
        ...config.systems.map((system) => ({ id: `sys:${system.id}`, label: system.name, sub: system.kind, tone: "system" as const })),
        { id: "sys:missions", label: "Missions", sub: "Active work", tone: "system" as const },
      ],
    },
  ];

  return layers.filter((layer) => layer.nodes.length > 0);
}

function MapMode({ config }: ModeProps) {
  const [selected, setSelected] = useState<string | null>(null);
  const layers = useMemo(() => buildMapLayers(config), [config]);

  /* Node coordinates are derived, never hand-placed, so adding a member or a
     capability stays a data change. */
  const layout = useMemo(() => {
    const xs = layers.map((_, index) => 70 + ((index + 0.5) * (MAP_W - 140)) / layers.length);
    const coords = new Map<string, { x: number; y: number }>();
    const pad = 46;
    layers.forEach((layer, column) => {
      const usable = MAP_H - pad * 2;
      layer.nodes.forEach((node, index) => {
        coords.set(node.id, {
          x: xs[column],
          y: pad + (usable * (index + 0.5)) / Math.max(layer.nodes.length, 1),
        });
      });
    });

    /* Each node wires to exactly one node in the next layer (index modulo): a
       branched chain, not a mesh, which is what keeps the wiring readable. */
    const edges: Array<{ id: string; from: string; to: string; state: NetState }> = [];
    for (let c = 0; c < layers.length - 1; c += 1) {
      const from = layers[c].nodes;
      const to = layers[c + 1].nodes;
      if (to.length === 0) continue;
      from.forEach((node, index) => {
        const target = to[index % to.length];
        edges.push({
          id: `${node.id}->${target.id}`,
          from: node.id,
          to: target.id,
          state: MAP_BOUNDARY_STATES[Math.min(c, MAP_BOUNDARY_STATES.length - 1)],
        });
      });
    }

    return { xs, coords, edges };
  }, [layers]);

  /* Selecting a node dims everything it does not touch, so one click answers
     "what is this connected to?". */
  const connected = useMemo(() => {
    if (!selected) return null;
    const set = new Set<string>([selected]);
    layout.edges.forEach((edge) => {
      if (edge.from === selected) set.add(edge.to);
      if (edge.to === selected) set.add(edge.from);
    });
    return set;
  }, [layout.edges, selected]);

  const path = (from: string, to: string) => {
    const a = layout.coords.get(from);
    const b = layout.coords.get(to);
    if (!a || !b) return "";
    const mx = (a.x + b.x) / 2;
    return `M ${a.x + MAP_NODE_W / 2} ${a.y} C ${mx} ${a.y}, ${mx} ${b.y}, ${b.x - MAP_NODE_W / 2} ${b.y}`;
  };

  const toggle = (id: string) => setSelected((current) => (current === id ? null : id));

  return (
    <div className="nc-dw-map nc-glass" data-selected={selected ? "true" : "false"}>
      <div className="nc-dw-map__canvas">
        <svg
          className="nc-net nc-dw-map__net"
          viewBox={`0 0 ${MAP_W} ${MAP_H}`}
          preserveAspectRatio="xMidYMid meet"
          aria-hidden="true"
        >
          {layout.edges.map((edge) => (
            <path
              key={edge.id}
              className="nc-net__line"
              data-state={edge.state}
              data-dim={connected && !(connected.has(edge.from) && connected.has(edge.to)) ? "true" : undefined}
              d={path(edge.from, edge.to)}
            />
          ))}
          {layout.edges
            .filter((edge) => edge.state === "active" && (!connected || (connected.has(edge.from) && connected.has(edge.to))))
            .map((edge) => (
              <path key={`flow-${edge.id}`} className="nc-net__flow" d={path(edge.from, edge.to)} />
            ))}
        </svg>

        <svg
          className="nc-dw-map__nodes"
          viewBox={`0 0 ${MAP_W} ${MAP_H}`}
          preserveAspectRatio="xMidYMid meet"
          role="group"
          aria-label={`Internal network for ${config.departmentId}`}
        >
          {layers.map((layer) =>
            layer.nodes.map((node) => {
              const at = layout.coords.get(node.id);
              if (!at) return null;
              const active = selected === node.id;
              const dim = connected ? !connected.has(node.id) : false;
              return (
                <g
                  key={node.id}
                  className="nc-dw-map__node"
                  data-tone={node.tone}
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
        <span data-tone="human">Human</span>
        <span data-tone="ai">AI</span>
        <span data-tone="cap">Capability</span>
        <span data-tone="system">System / work</span>
      </div>

      {/* Mobile recomposition: the same network as a vertical chain, so a phone
          reads the layers top-to-bottom instead of a shrunk diagram. */}
      <div className="nc-dw-map__stack">
        {layers.map((layer, index) => (
          <div key={layer.id} className="nc-dw-map__layer" data-tone={layer.tone}>
            {index > 0 ? (
              <svg className="nc-net nc-dw-map__spine" viewBox="0 0 8 26" preserveAspectRatio="none" aria-hidden="true">
                <path
                  className="nc-net__line"
                  data-state={MAP_BOUNDARY_STATES[Math.min(index - 1, MAP_BOUNDARY_STATES.length - 1)]}
                  d="M4 0 V26"
                />
              </svg>
            ) : null}
            <div className="nc-dw-map__layer-head">
              <span className="nc-eyebrow">{layer.label}</span>
              <span className="nc-dw-map__layer-note">{layer.note}</span>
            </div>
            <div className="nc-dw-map__layer-nodes">
              {layer.nodes.map((node) => (
                <span key={node.id} className="nc-dw-map__chip" data-tone={node.tone}>
                  <i aria-hidden="true" />
                  {node.label}
                </span>
              ))}
            </div>
          </div>
        ))}
      </div>

      <p className="nc-dw-note">
        A visual foundation for the department&apos;s internal network. Select a node to trace what it touches; every line
        carries its relationship state. Relationships are illustrative in this phase.
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

const FLOW_STATUS: Record<FlowStage["state"], string> = {
  done: "Done",
  active: "In progress",
  next: "Next",
};

function FlowMode({ config }: ModeProps) {
  const activeLabels = config.flow.filter((stage) => stage.state === "active").map((stage) => stage.label);
  const doneCount = config.flow.filter((stage) => stage.state === "done").length;
  const links = config.flow.slice(1).map((stage, index) => flowEdgeState(config.flow[index].state, stage.state));
  const handoffs = links.filter((state) => state === "handoff").length;

  return (
    <div className="nc-dw-flow">
      <div className="nc-dw-flow__bar nc-glass nc-glass--lit">
        <span className="nc-dw-flow__dir">
          <IconChevronRight size={14} />
          {config.purpose}
        </span>
        <span className="nc-dw-flow__meta">
          <span className="nc-dw-flow__stat" data-tone="completed">
            {doneCount} completed
          </span>
          <span className="nc-dw-flow__stat" data-tone="active">
            {activeLabels.length > 0 ? `In progress: ${activeLabels.join(" · ")}` : "Nothing running"}
          </span>
          {config.attention.length > 0 ? (
            <span className="nc-dw-flow__stat" data-tone="attention">
              {config.attention.length} blocker{config.attention.length === 1 ? "" : "s"}
            </span>
          ) : null}
          <span className="nc-dw-flow__stat" data-tone="handoff">
            {handoffs} handoff{handoffs === 1 ? "" : "s"}
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
                <span className="nc-dw-stage__label">{stage.label}</span>
                <span className="nc-dw-stage__status" data-state={stage.state}>
                  <i aria-hidden="true" />
                  {FLOW_STATUS[stage.state]}
                </span>
              </span>
              <span className="nc-dw-stage__note">{stage.note}</span>
            </li>
          );
        })}
      </ol>

      <p className="nc-dw-note">
        The production pipeline this department will run on. Direction reads left to right and each line&apos;s state
        shows where the work is — the active step carries the signal a live run would animate. No workflow executes in
        this phase.
      </p>
    </div>
  );
}

/* ── Capabilities ──────────────────────────────────────────────────────── */

const CAP_ORDER: CapabilityKind[] = ["Skill", "Tool", "Workflow", "Template", "Automation"];

function CapabilitiesMode({ config }: ModeProps) {
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
              {group.kind}s <i>{group.items.length}</i>
            </span>
            <ul className="nc-dw-rows">
              {group.items.map((item) => (
                <li key={item.id} className="nc-dw-row">
                  <span className="nc-dw-row__title">{item.name}</span>
                  <span className="nc-dw-row__meta">{item.note}</span>
                  <span className="nc-dw-row__used">Used by {item.usedBy}</span>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
      <p className="nc-dw-note">
        Capabilities are reusable and are not permanently tied to one agent — assignment arrives with the workforce
        layer, which is why none is owned here.
      </p>
    </div>
  );
}

/* ── Memory ────────────────────────────────────────────────────────────── */

function MemoryMode({ config }: ModeProps) {
  return (
    <div className="nc-dw-memory">
      <div className="nc-dw-grid nc-dw-grid--memory">
        {config.memory.map((layer) => (
          <section key={layer.id} className="nc-dw-card nc-dw-card--memory">
            <span className="nc-dw-card__kicker">{layer.label}</span>
            <span className="nc-dw-card__stat">
              {layer.count}
              <i>{layer.count === 1 ? "reference" : "references"}</i>
            </span>
            <span className="nc-dw-card__sub">{layer.note}</span>
          </section>
        ))}
      </div>
      <p className="nc-dw-note">
        Structure only. No memory content is fabricated here — the layers fill in when the memory layer is built.
      </p>
    </div>
  );
}

/* ── Systems ───────────────────────────────────────────────────────────── */

function SystemsMode({ config }: ModeProps) {
  const { notify } = useCommand();

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
                <span className="nc-dw-sys__kind">{system.kind}</span>
              </span>
              <span className="nc-dw-sys__purpose">{system.purpose}</span>
            </span>
            <span className="nc-dw-sys__status" data-kind={system.statusKind}>
              <i aria-hidden="true" />
              {system.status}
            </span>
            <button
              type="button"
              className="nc-dw-sys__action"
              onClick={() => notify(`${system.name} — the relationship view is a later phase; nothing is connected.`)}
            >
              Relationship
            </button>
          </li>
        ))}
      </ul>
      <p className="nc-dw-note">
        Visual relationships only. No connector, API or integration is introduced by this workspace.
      </p>
    </div>
  );
}
