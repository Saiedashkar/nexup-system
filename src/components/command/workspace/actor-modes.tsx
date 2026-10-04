"use client";

import { useCommand } from "../state/command-store";
import {
  actorTypeLabel,
  type ActorConfig,
  type ActorModeId,
  type ModelRoute,
  type SkillLevel,
  type WorkKind,
} from "../state/actor-workspace";
import { IconAgent, IconCheck, IconHuman } from "../ui/icons";

/**
 * ACTOR WORKSPACE — the nine modes (Phase UI-04)
 * ──────────────────────────────────────────────
 * Every mode is a reading of the SAME configuration. None of them fetches,
 * calls an AI or writes anything; each ends by saying what it is.
 *
 * The modes are the information architecture an actor's control room will grow
 * into. Human and AI actors share the structure: AI-only content (model route,
 * autonomy) and human-only content (contact surface) simply appear or vanish
 * based on what the configuration provides — the layout does not branch into
 * two different pages.
 */

export function ActorModeBody({ mode, actor }: { mode: ActorModeId; actor: ActorConfig }) {
  switch (mode) {
    case "overview":
      return <OverviewMode actor={actor} />;
    case "work":
      return <WorkMode actor={actor} />;
    case "skills":
      return <SkillsMode actor={actor} />;
    case "tools":
      return <ToolsMode actor={actor} />;
    case "workflows":
      return <WorkflowsMode actor={actor} />;
    case "memory":
      return <MemoryMode actor={actor} />;
    case "permissions":
      return <PermissionsMode actor={actor} />;
    case "performance":
      return <PerformanceMode actor={actor} />;
    case "history":
      return <HistoryMode actor={actor} />;
    default:
      return null;
  }
}

/* ── Overview ──────────────────────────────────────────────────────────── */

/**
 * The Overview is a worker's control console, not a profile page: the current
 * mission leads, the relationship is drawn as a network, and authority sits
 * next to capability. Repetitive card framing is replaced by two glass
 * surfaces per column plus the shared `.nc-net` relationship language.
 */
function OverviewMode({ actor }: { actor: ActorConfig }) {
  const isAI = actor.type === "ai-agent";

  return (
    <div className="nc-aw-dash">
      <div className="nc-aw-dash__main">
        {/* Current mission — the reason this console is open. */}
        <section className="nc-glass nc-glass--lit nc-glass-signal nc-aw-mission">
          <span className="nc-eyebrow">Current mission</span>
          <h3 className="nc-aw-mission__title">{actor.mission}</h3>
          <p className="nc-aw-mission__priority">
            <span className="nc-aw-mission__priority-label">Priority</span>
            {actor.priority}
          </p>
          {actor.attention.length > 0 ? (
            <ul className="nc-aw-mission__flags">
              {actor.attention.map((item) => (
                <li key={item} className="nc-aw-mission__flag">
                  {item}
                </li>
              ))}
            </ul>
          ) : (
            <p className="nc-aw-mission__clear">Nothing needs a decision from you right now.</p>
          )}
        </section>

        {/* Who this actor answers to, and who it works with — a relationship,
            not a profile field. */}
        <section className="nc-glass nc-aw-panel">
          <span className="nc-eyebrow">Relationship</span>
          <RelationshipNetwork actor={actor} />
        </section>

        {/* Authority and capability together, so autonomy is read next to what
            the actor can actually do. */}
        <section className="nc-glass nc-aw-panel">
          <span className="nc-eyebrow">Authority &amp; capability</span>
          <p className="nc-aw-panel__lead">{actor.capability}</p>
          <dl className="nc-aw-facts">
            <div className="nc-aw-facts__row">
              <dt>Autonomy</dt>
              <dd className="nc-aw-empower">{actor.permissions.autonomy}</dd>
            </div>
            <div className="nc-aw-facts__row">
              <dt>Data scope</dt>
              <dd>{actor.permissions.dataScope}</dd>
            </div>
            <div className="nc-aw-facts__row">
              <dt>Approval</dt>
              <dd>{actor.permissions.approval}</dd>
            </div>
            <div className="nc-aw-facts__row">
              <dt>Escalation</dt>
              <dd>{actor.permissions.escalation}</dd>
            </div>
          </dl>
        </section>
      </div>

      <div className="nc-aw-dash__side">
        <section className="nc-glass nc-aw-panel">
          <span className="nc-eyebrow">Identity</span>
          <dl className="nc-aw-ident">
            <div className="nc-aw-ident__row">
              <dt>Type</dt>
              <dd>
                <span className="nc-aw-badge" data-type={actor.type}>
                  {isAI ? <IconAgent size={12} /> : <IconHuman size={12} />}
                  {actorTypeLabel(actor.type)}
                </span>
              </dd>
            </div>
            <div className="nc-aw-ident__row">
              <dt>Role</dt>
              <dd>{actor.role}</dd>
            </div>
            <div className="nc-aw-ident__row">
              <dt>Purpose</dt>
              <dd>{actor.purpose}</dd>
            </div>
            <div className="nc-aw-ident__row">
              <dt>Department</dt>
              <dd>{actor.departmentName}</dd>
            </div>
            <div className="nc-aw-ident__row">
              <dt>Status</dt>
              <dd>{actor.status}</dd>
            </div>
            <div className="nc-aw-ident__row">
              <dt>Reports to</dt>
              <dd>{actor.reportsTo}</dd>
            </div>
          </dl>
        </section>

        {isAI && actor.model ? (
          <section className="nc-glass nc-aw-panel">
            <span className="nc-eyebrow">Model route</span>
            <ModelRouteChain route={actor.model} />
          </section>
        ) : null}

        {!isAI && actor.contact ? (
          <section className="nc-glass nc-aw-panel">
            <span className="nc-eyebrow">Contact &amp; instruction context</span>
            <dl className="nc-aw-ident">
              {actor.contact.map((row) => (
                <div key={row.id} className="nc-aw-ident__row">
                  <dt>{row.label}</dt>
                  <dd>{row.value}</dd>
                </div>
              ))}
            </dl>
          </section>
        ) : null}
      </div>
    </div>
  );
}

/** Reports-to → this actor → collaborators, wired with the shared net language. */
function RelationshipNetwork({ actor }: { actor: ActorConfig }) {
  return (
    <div className="nc-aw-relmap">
      <span className="nc-aw-relmap__label">Reports to</span>
      <span className="nc-glass-data nc-aw-relmap__node">{actor.reportsTo}</span>

      <svg className="nc-net nc-aw-relmap__line" viewBox="0 0 8 22" preserveAspectRatio="none" aria-hidden="true">
        <path className="nc-net__line" data-state="active" d="M4 0 V22" />
        <path className="nc-net__flow" d="M4 0 V22" />
      </svg>

      <span className="nc-aw-relmap__self" data-type={actor.type}>
        <span className="nc-aw-relmap__avatar" aria-hidden="true">
          {actor.initials}
        </span>
        <span className="nc-aw-relmap__self-text">
          <span className="nc-aw-relmap__self-role">{actor.role}</span>
          <span className="nc-aw-relmap__self-name">{actor.name}</span>
        </span>
      </span>

      <svg className="nc-net nc-aw-relmap__line" viewBox="0 0 8 22" preserveAspectRatio="none" aria-hidden="true">
        <path className="nc-net__line" data-state="idle" d="M4 0 V22" />
      </svg>

      <span className="nc-aw-relmap__label">Collaborates with</span>
      <span className="nc-aw-relmap__peers">
        {actor.collaborates.map((name) => (
          <span key={name} className="nc-glass-data nc-aw-relmap__node nc-aw-relmap__node--peer">
            {name}
          </span>
        ))}
      </span>
    </div>
  );
}

/** AI-only: the route a request actually takes, drawn as a chain. */
function ModelRouteChain({ route }: { route: ModelRoute }) {
  return (
    <>
      <div className="nc-aw-route">
        <span className="nc-glass-data nc-aw-route__node" data-role="preferred">
          <span className="nc-aw-route__tier">Preferred</span>
          <span className="nc-aw-route__name">{route.preferred}</span>
        </span>
        <svg className="nc-net nc-aw-route__line" viewBox="0 0 30 8" preserveAspectRatio="none" aria-hidden="true">
          <path className="nc-net__line" data-state="routing" d="M0 4 H30" />
        </svg>
        <span className="nc-glass-data nc-aw-route__node" data-role="fallback">
          <span className="nc-aw-route__tier">Fallback</span>
          <span className="nc-aw-route__name">{route.fallback}</span>
        </span>
      </div>
      <dl className="nc-aw-ident">
        <div className="nc-aw-ident__row">
          <dt>Current policy</dt>
          <dd>
            <span className="nc-aw-policy">{route.policy}</span>
          </dd>
        </div>
        <div className="nc-aw-ident__row">
          <dt>Cost policy</dt>
          <dd>{route.costPolicy}</dd>
        </div>
        <div className="nc-aw-ident__row">
          <dt>Paid escalation</dt>
          <dd>{route.paidEscalation}</dd>
        </div>
      </dl>
    </>
  );
}

function ModelRouteMini({ route }: { route: ModelRoute }) {
  return (
    <dl className="nc-aw-ident">
      <div className="nc-aw-ident__row">
        <dt>Current policy</dt>
        <dd>
          <span className="nc-aw-policy">{route.policy}</span>
        </dd>
      </div>
      <div className="nc-aw-ident__row">
        <dt>Preferred route</dt>
        <dd>{route.preferred}</dd>
      </div>
      <div className="nc-aw-ident__row">
        <dt>Fallback route</dt>
        <dd>{route.fallback}</dd>
      </div>
      <div className="nc-aw-ident__row">
        <dt>Cost policy</dt>
        <dd>{route.costPolicy}</dd>
      </div>
      <div className="nc-aw-ident__row">
        <dt>Paid escalation</dt>
        <dd>{route.paidEscalation}</dd>
      </div>
    </dl>
  );
}

/* ── Work ──────────────────────────────────────────────────────────────── */

const WORK_GROUPS: Array<{ kind: WorkKind; label: string }> = [
  { kind: "mission", label: "Active missions" },
  { kind: "job", label: "Assigned jobs" },
  { kind: "delegated", label: "Delegated work" },
  { kind: "blocker", label: "Blockers" },
  { kind: "approval", label: "Pending approvals" },
  { kind: "output", label: "Recent outputs" },
];

function WorkMode({ actor }: { actor: ActorConfig }) {
  return (
    <div className="nc-aw-grid nc-aw-grid--work">
      {WORK_GROUPS.map((group) => {
        const items = actor.work.filter((item) => item.kind === group.kind);
        return (
          <section key={group.kind} className="nc-aw-card" data-empty={items.length === 0}>
            <span className="nc-aw-card__kicker">
              {group.label} <i>{items.length}</i>
            </span>
            {items.length === 0 ? (
              <span className="nc-aw-none">Nothing in this state.</span>
            ) : (
              <ul className="nc-aw-rows">
                {items.map((item) => (
                  <li key={item.id} className="nc-aw-row" data-state={item.state}>
                    <span className="nc-aw-row__top">
                      <span className="nc-aw-row__title">{item.title}</span>
                      <span className="nc-aw-row__state">{item.state}</span>
                    </span>
                    <span className="nc-aw-row__note">{item.note}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        );
      })}
      <p className="nc-aw-note">
        Mock work only. No job runner, queue or scheduler is connected in this phase.
      </p>
    </div>
  );
}

/* ── Skills ────────────────────────────────────────────────────────────── */

const SKILL_LEVELS: SkillLevel[] = ["Mastered", "Proficient", "Learning", "Dormant"];

function SkillsMode({ actor }: { actor: ActorConfig }) {
  return (
    <div className="nc-aw-stack">
      <ul className="nc-aw-list">
        {actor.skills.map((skill) => (
          <li key={skill.id} className="nc-aw-item" data-available={skill.available}>
            <span className="nc-aw-item__main">
              <span className="nc-aw-item__top">
                <span className="nc-aw-item__name">{skill.name}</span>
                <span className="nc-aw-level" data-level={skill.level}>
                  {skill.level}
                </span>
              </span>
              <span className="nc-aw-item__meta">
                <span className="nc-aw-item__source">{skill.source}</span>
              </span>
            </span>
            <span className="nc-aw-item__side">
              <span className="nc-aw-item__label">Last used</span>
              <span className="nc-aw-item__value">{skill.lastUsed}</span>
            </span>
            <span className="nc-aw-item__flag" data-available={skill.available}>
              {skill.available ? "Available" : "Unavailable"}
            </span>
          </li>
        ))}
      </ul>
      <div className="nc-aw-legend">
        {SKILL_LEVELS.map((level) => (
          <span key={level} data-level={level}>
            {level}
          </span>
        ))}
      </div>
      <p className="nc-aw-note">
        Skills are procedural knowledge (SOP capability) drawn from a shared registry. Nothing is loaded at runtime in
        this phase — the registry and these assignments are structured so skills can be added or removed dynamically
        later without changing an actor definition.
      </p>
    </div>
  );
}

/* ── Tools ─────────────────────────────────────────────────────────────── */

function ToolsMode({ actor }: { actor: ActorConfig }) {
  const { notify } = useCommand();

  return (
    <div className="nc-aw-stack">
      <ul className="nc-aw-list">
        {actor.tools.map((tool) => (
          <li key={tool.id} className="nc-aw-item" data-available={tool.available}>
            <span className="nc-aw-item__main">
              <span className="nc-aw-item__top">
                <span className="nc-aw-item__name nc-aw-mono">{tool.name}</span>
                <span className="nc-aw-perm" data-perm={tool.permission}>
                  {tool.permission}
                </span>
              </span>
              <span className="nc-aw-item__meta">
                <span className="nc-aw-item__source">{tool.category}</span>
              </span>
            </span>
            <span className="nc-aw-item__side">
              <span className="nc-aw-item__label">Last used</span>
              <span className="nc-aw-item__value">{tool.lastUsed}</span>
            </span>
            <button
              type="button"
              className="nc-aw-item__action"
              onClick={() => notify(`${tool.name} — tool execution is disabled in this phase.`)}
            >
              {tool.available ? "Inspect" : "Blocked"}
            </button>
          </li>
        ))}
      </ul>
      <p className="nc-aw-note">
        Tools are executable capabilities, distinct from skills: a skill is how the actor thinks, a tool is what it can
        actually run. Nothing executes here — no tool call leaves this page.
      </p>
    </div>
  );
}

/* ── Workflows ─────────────────────────────────────────────────────────── */

function WorkflowsMode({ actor }: { actor: ActorConfig }) {
  return (
    <div className="nc-aw-grid nc-aw-grid--workflows">
      {actor.workflows.map((workflow) => (
        <section key={workflow.id} className="nc-aw-card">
          <span className="nc-aw-card__kicker">
            {workflow.name}
            <span className="nc-aw-wfstate" data-state={workflow.state}>
              {workflow.state}
            </span>
          </span>
          <ol className="nc-aw-steps">
            {workflow.steps.map((step, index) => (
              <li key={step} className="nc-aw-step">
                <span className="nc-aw-step__num">{index + 1}</span>
                {step}
              </li>
            ))}
          </ol>
          <span className="nc-aw-card__row">
            <span className="nc-aw-card__label">Reusable</span>
            <span className="nc-aw-card__value">
              {workflow.reusable ? (
                <>
                  <IconCheck size={13} /> Shared sequence
                </>
              ) : (
                "One-off"
              )}
            </span>
          </span>
        </section>
      ))}
      <p className="nc-aw-note">
        Foundation for reusable sequences. No workflow runtime is introduced — these describe shape and state only.
      </p>
    </div>
  );
}

/* ── Memory ────────────────────────────────────────────────────────────── */

function MemoryMode({ actor }: { actor: ActorConfig }) {
  const total = actor.memory.reduce((sum, layer) => sum + layer.entries.length, 0);

  return (
    <div className="nc-aw-stack">
      <section className="nc-aw-card">
        <span className="nc-aw-card__kicker">Memory layers</span>
        <span className="nc-aw-card__sub">
          {total} structured {total === 1 ? "entry" : "entries"} across {actor.memory.length} layers. The future
          architecture retrieves memory on demand rather than injecting everything into every prompt.
        </span>
      </section>

      <div className="nc-aw-grid nc-aw-grid--memory">
        {actor.memory.map((layer) => (
          <section key={layer.id} className="nc-aw-card nc-aw-card--memory" data-empty={layer.entries.length === 0}>
            <span className="nc-aw-card__kicker">
              {layer.label} <i>{layer.entries.length}</i>
            </span>
            <span className="nc-aw-card__sub">{layer.note}</span>
            {layer.entries.length === 0 ? (
              <span className="nc-aw-none">No entries yet.</span>
            ) : (
              <ul className="nc-aw-mem">
                {layer.entries.map((entry) => (
                  <li key={entry.id} className="nc-aw-mem__item">
                    <span className="nc-aw-mem__title">{entry.title}</span>
                    <span className="nc-aw-mem__note">{entry.note}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        ))}
      </div>

      <p className="nc-aw-note">
        Small structured placeholders only — no memory content is fabricated, and no memory backend exists in this
        phase.
      </p>
    </div>
  );
}

/* ── Permissions ───────────────────────────────────────────────────────── */

function PermissionsMode({ actor }: { actor: ActorConfig }) {
  const { permissions } = actor;
  const facts: Array<{ label: string; value: string }> = [
    { label: "Data scope", value: permissions.dataScope },
    { label: "Financial", value: permissions.financial },
    { label: "Publishing", value: permissions.publishing },
    { label: "Approval", value: permissions.approval },
    { label: "Escalation", value: permissions.escalation },
  ];

  return (
    <div className="nc-aw-stack">
      <section className="nc-aw-card">
        <span className="nc-aw-card__kicker">Autonomy level</span>
        <span className="nc-aw-autonomy">{permissions.autonomy}</span>
        <span className="nc-aw-card__sub">
          How far this actor may act before a human is required. Policy enforcement is not implemented in this phase.
        </span>
      </section>

      <div className="nc-aw-grid nc-aw-grid--perm">
        <section className="nc-aw-card">
          <span className="nc-aw-card__kicker">Allowed tools</span>
          {permissions.allowedTools.length === 0 ? (
            <span className="nc-aw-none">No tool is fully allowed.</span>
          ) : (
            <ul className="nc-aw-chips nc-aw-chips--mono">
              {permissions.allowedTools.map((tool) => (
                <li key={tool} className="nc-aw-chip">
                  {tool}
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="nc-aw-card">
          <span className="nc-aw-card__kicker">Allowed systems</span>
          {permissions.allowedSystems.length === 0 ? (
            <span className="nc-aw-none">No system access.</span>
          ) : (
            <ul className="nc-aw-chips">
              {permissions.allowedSystems.map((system) => (
                <li key={system} className="nc-aw-chip">
                  {system}
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="nc-aw-card">
          <span className="nc-aw-card__kicker">Scope &amp; rules</span>
          <dl className="nc-aw-ident">
            {facts.map((fact) => (
              <div key={fact.label} className="nc-aw-ident__row">
                <dt>{fact.label}</dt>
                <dd>{fact.value}</dd>
              </div>
            ))}
          </dl>
        </section>

        {actor.model ? (
          <section className="nc-aw-card">
            <span className="nc-aw-card__kicker">Model route</span>
            <ModelRouteMini route={actor.model} />
          </section>
        ) : null}
      </div>

      <p className="nc-aw-note">
        Mock values only. No policy engine, permission check or model provider is connected — this is the foundation the
        enforcement layer will read.
      </p>
    </div>
  );
}

/* ── Performance ───────────────────────────────────────────────────────── */

function PerformanceMode({ actor }: { actor: ActorConfig }) {
  return (
    <div className="nc-aw-stack">
      <div className="nc-aw-grid nc-aw-grid--perf">
        {actor.performance.map((metric) => (
          <section key={metric.id} className="nc-aw-card nc-aw-card--metric">
            <span className="nc-aw-card__kicker">{metric.label}</span>
            <span className="nc-aw-metric__value">{metric.value}</span>
            <span className="nc-aw-card__sub">{metric.note}</span>
          </section>
        ))}
      </div>
      <p className="nc-aw-note">
        Small mock values. No analytics pipeline is connected and no trend is computed here.
      </p>
    </div>
  );
}

/* ── History ───────────────────────────────────────────────────────────── */

function HistoryMode({ actor }: { actor: ActorConfig }) {
  return (
    <div className="nc-aw-stack">
      <ol className="nc-aw-timeline">
        {actor.history.map((entry) => (
          <li key={entry.id} className="nc-aw-event" data-kind={entry.kind}>
            <span className="nc-aw-event__rail" aria-hidden="true">
              <span className="nc-aw-event__dot" />
            </span>
            <span className="nc-aw-event__body">
              <span className="nc-aw-event__top">
                <span className="nc-aw-event__kind">{entry.kind}</span>
                <span className="nc-aw-event__at">{entry.at}</span>
              </span>
              <span className="nc-aw-event__title">{entry.title}</span>
            </span>
          </li>
        ))}
      </ol>
      <p className="nc-aw-note">
        A simple timeline foundation — missions, commands, decisions, outputs, warnings, approvals and skill or tool
        changes. No history store exists in this phase.
      </p>
    </div>
  );
}
