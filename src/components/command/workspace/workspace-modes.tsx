"use client";

import { useCommand } from "../state/command-store";
import {
  teamByKind,
  type Capability,
  type CapabilityKind,
  type DepartmentWorkspaceConfig,
  type WorkspaceModeId,
} from "../state/department-workspace";
import { IconAgent, IconHuman } from "../ui/icons";

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
                onClick={() =>
                  notify(`${actor.name} — the actor workspace (role, skills, memory, direct command) is a later phase.`)
                }
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
        Identities are role-based. Opening an actor — {departmentName} agents included — is the next phase; these
        items are already wired to receive it.
      </p>
    </div>
  );
}

/* ── Map ─────────────────────────────────────────────────────────────────
   A DOM/SVG network mock: Human Lead → AI Director → Agents → Capabilities →
   Systems. Thin cyan lines, no 3D. Left as a visual foundation for the real
   internal department network.                                            */

type MapNode = {
  x: number;
  y: number;
  label: string;
  sub: string;
  tone: "human" | "ai" | "cap" | "system";
};

const MAP_W = 1060;
const MAP_H = 340;
const MAP_PAD = 44;
const MAP_XS = [96, 320, 548, 772, 980];
const MAP_NODE_W = 154;

function MapMode({ config }: ModeProps) {
  const { humans, agents } = teamByKind(config);
  const director = agents.find((actor) => /director/i.test(actor.role)) ?? agents[0];
  const specialists = agents.filter((actor) => actor.id !== director?.id);
  const caps = config.capabilities.slice(0, 5);
  const ends: Array<{ label: string; sub: string }> = [
    ...config.systems.map((system) => ({ label: system.name, sub: system.kind })),
    { label: "Missions", sub: "Active work" },
  ];

  const columns: MapNode[][] = [
    humans.map((actor) => ({ x: 0, y: 0, label: actor.name, sub: actor.role, tone: "human" })),
    director ? [{ x: 0, y: 0, label: director.name, sub: director.role, tone: "ai" }] : [],
    specialists.map((actor) => ({ x: 0, y: 0, label: actor.name, sub: actor.role, tone: "ai" })),
    caps.map((capability) => ({ x: 0, y: 0, label: capability.name, sub: capability.kind, tone: "cap" })),
    ends.map((end) => ({ x: 0, y: 0, label: end.label, sub: end.sub, tone: "system" })),
  ];

  /* Lay out each column, then wire every node to exactly one node in the next
     column (index modulo). A branched tree, not a mesh — that is what keeps the
     wiring clean and readable instead of noisy. */
  columns.forEach((nodes, colIndex) => {
    const x = MAP_XS[colIndex];
    const usable = MAP_H - MAP_PAD * 2;
    nodes.forEach((node, i) => {
      node.x = x;
      node.y = MAP_PAD + (usable * (i + 0.5)) / Math.max(nodes.length, 1);
    });
  });

  const edges: Array<{ from: MapNode; to: MapNode }> = [];
  for (let c = 0; c < columns.length - 1; c += 1) {
    const from = columns[c];
    const to = columns[c + 1];
    if (to.length === 0) continue;
    from.forEach((node, i) => edges.push({ from: node, to: to[i % to.length] }));
  }

  return (
    <div className="nc-dw-map">
      <svg
        className="nc-dw-map__svg"
        viewBox={`0 0 ${MAP_W} ${MAP_H}`}
        role="img"
        aria-label={`Internal network for ${config.departmentId}`}
      >
        <g className="nc-dw-map__edges">
          {edges.map((edge, i) => (
            <path
              key={i}
              d={`M ${edge.from.x + MAP_NODE_W / 2} ${edge.from.y} L ${edge.to.x - MAP_NODE_W / 2} ${edge.to.y}`}
            />
          ))}
        </g>

        {columns.map((nodes, colIndex) =>
          nodes.map((node) => (
            <g key={`${colIndex}-${node.label}`} className="nc-dw-map__node" data-tone={node.tone}>
              <rect
                x={node.x - MAP_NODE_W / 2}
                y={node.y - 21}
                width={MAP_NODE_W}
                height={42}
                rx={11}
              />
              <circle cx={node.x - MAP_NODE_W / 2 + 15} cy={node.y} r={3.4} className="nc-dw-map__dot" />
              <text x={node.x - MAP_NODE_W / 2 + 28} y={node.y - 3} className="nc-dw-map__label">
                {node.label.length > 19 ? `${node.label.slice(0, 18)}…` : node.label}
              </text>
              <text x={node.x - MAP_NODE_W / 2 + 28} y={node.y + 11} className="nc-dw-map__sub">
                {node.sub.length > 24 ? `${node.sub.slice(0, 23)}…` : node.sub}
              </text>
            </g>
          )),
        )}
      </svg>

      <div className="nc-dw-map__legend">
        <span data-tone="human">Human</span>
        <span data-tone="ai">AI</span>
        <span data-tone="cap">Capability</span>
        <span data-tone="system">System / work</span>
      </div>
      <p className="nc-dw-note">
        A visual foundation for the department&apos;s internal network. Relationships are illustrative in this phase.
      </p>
    </div>
  );
}

/* ── Flow ──────────────────────────────────────────────────────────────── */

function FlowMode({ config }: ModeProps) {
  return (
    <div className="nc-dw-flow">
      <ol className="nc-dw-flow__track">
        {config.flow.map((stage) => (
          <li key={stage.id} className="nc-dw-stage" data-state={stage.state}>
            <span className="nc-dw-stage__head">
              <span className="nc-dw-stage__dot" aria-hidden="true" />
              <span className="nc-dw-stage__label">{stage.label}</span>
            </span>
            <span className="nc-dw-stage__note">{stage.note}</span>
          </li>
        ))}
      </ol>
      <p className="nc-dw-note">
        The production pipeline this department will run on. Stages are illustrative; no workflow executes in this
        phase.
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
