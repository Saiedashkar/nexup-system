"use client";

import { useCommand } from "../state/command-store";
import { useLocale } from "../i18n/command-locale";
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
  const { t, tc } = useLocale();
  const isAI = actor.type === "ai-agent";

  return (
    <div className="nc-aw-dash">
      <div className="nc-aw-dash__main">
        {/* Current mission — the reason this console is open. */}
        <section className="nc-glass nc-glass--lit nc-glass-signal nc-aw-mission">
          <span className="nc-eyebrow">{t("aw.factCurrentMission")}</span>
          <h3 className="nc-aw-mission__title">{tc(actor.mission)}</h3>
          <p className="nc-aw-mission__priority">
            <span className="nc-aw-mission__priority-label">{t("aw.priority")}</span>
            {tc(actor.priority)}
          </p>
          {actor.attention.length > 0 ? (
            <ul className="nc-aw-mission__flags">
              {actor.attention.map((item) => (
                <li key={item} className="nc-aw-mission__flag">
                  {tc(item)}
                </li>
              ))}
            </ul>
          ) : (
            <p className="nc-aw-mission__clear">{t("aw.nothingFromYou")}</p>
          )}
        </section>

        {/* Who this actor answers to, and who it works with — a relationship,
            not a profile field. */}
        <section className="nc-glass nc-aw-panel">
          <span className="nc-eyebrow">{t("dws.relationship")}</span>
          <RelationshipNetwork actor={actor} />
        </section>

        {/* Authority and capability together, so autonomy is read next to what
            the actor can actually do. */}
        <section className="nc-glass nc-aw-panel">
          <span className="nc-eyebrow">{t("aw.authorityAndCapability")}</span>
          <p className="nc-aw-panel__lead">{tc(actor.capability)}</p>
          <dl className="nc-aw-facts">
            <div className="nc-aw-facts__row">
              <dt>{tc("Autonomy")}</dt>
              <dd className="nc-aw-empower">{tc(actor.permissions.autonomy)}</dd>
            </div>
            <div className="nc-aw-facts__row">
              <dt>{tc("Data scope")}</dt>
              <dd>{tc(actor.permissions.dataScope)}</dd>
            </div>
            <div className="nc-aw-facts__row">
              <dt>{tc("Approval")}</dt>
              <dd>{tc(actor.permissions.approval)}</dd>
            </div>
            <div className="nc-aw-facts__row">
              <dt>{tc("Escalation")}</dt>
              <dd>{tc(actor.permissions.escalation)}</dd>
            </div>
          </dl>
        </section>
      </div>

      <div className="nc-aw-dash__side">
        <section className="nc-glass nc-aw-panel">
          <span className="nc-eyebrow">{tc("Identity")}</span>
          <dl className="nc-aw-ident">
            <div className="nc-aw-ident__row">
              <dt>{tc("Type")}</dt>
              <dd>
                <span className="nc-aw-badge" data-type={actor.type}>
                  {isAI ? <IconAgent size={12} /> : <IconHuman size={12} />}
                  {tc(actorTypeLabel(actor.type))}
                </span>
              </dd>
            </div>
            <div className="nc-aw-ident__row">
              <dt>{tc("Role")}</dt>
              <dd>{tc(actor.role)}</dd>
            </div>
            <div className="nc-aw-ident__row">
              <dt>{tc("Purpose")}</dt>
              <dd>{tc(actor.purpose)}</dd>
            </div>
            <div className="nc-aw-ident__row">
              <dt>{tc("Department")}</dt>
              <dd>{actor.departmentName}</dd>
            </div>
            <div className="nc-aw-ident__row">
              <dt>{tc("Status")}</dt>
              <dd>{tc(actor.status)}</dd>
            </div>
            <div className="nc-aw-ident__row">
              <dt>{tc("Reports to")}</dt>
              <dd>{tc(actor.reportsTo)}</dd>
            </div>
          </dl>
        </section>

        {isAI && actor.model ? (
          <section className="nc-glass nc-aw-panel">
            <span className="nc-eyebrow">{tc("Model route")}</span>
            <ModelRouteChain route={actor.model} />
          </section>
        ) : null}

        {!isAI && actor.contact ? (
          <section className="nc-glass nc-aw-panel">
            <span className="nc-eyebrow">{t("aw.contactContext")}</span>
            <dl className="nc-aw-ident">
              {actor.contact.map((row) => (
                <div key={row.id} className="nc-aw-ident__row">
                  <dt>{tc(row.label)}</dt>
                  <dd>{tc(row.value)}</dd>
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
  const { tc } = useLocale();
  return (
    <div className="nc-aw-relmap">
      <span className="nc-aw-relmap__label">{tc("Reports to")}</span>
      <span className="nc-glass-data nc-aw-relmap__node">{tc(actor.reportsTo)}</span>

      <svg className="nc-net nc-aw-relmap__line" viewBox="0 0 8 22" preserveAspectRatio="none" aria-hidden="true">
        <path className="nc-net__line" data-state="active" d="M4 0 V22" />
        <path className="nc-net__flow" d="M4 0 V22" />
      </svg>

      <span className="nc-aw-relmap__self" data-type={actor.type}>
        <span className="nc-aw-relmap__avatar" aria-hidden="true">
          {actor.initials}
        </span>
        <span className="nc-aw-relmap__self-text">
          <span className="nc-aw-relmap__self-role">{tc(actor.role)}</span>
          <span className="nc-aw-relmap__self-name">{tc(actor.name)}</span>
        </span>
      </span>

      <svg className="nc-net nc-aw-relmap__line" viewBox="0 0 8 22" preserveAspectRatio="none" aria-hidden="true">
        <path className="nc-net__line" data-state="idle" d="M4 0 V22" />
      </svg>

      <span className="nc-aw-relmap__label">{tc("Collaborates with")}</span>
      <span className="nc-aw-relmap__peers">
        {actor.collaborates.map((name) => (
          <span key={name} className="nc-glass-data nc-aw-relmap__node nc-aw-relmap__node--peer">
            {tc(name)}
          </span>
        ))}
      </span>
    </div>
  );
}

/** AI-only: the route a request actually takes, drawn as a chain. */
function ModelRouteChain({ route }: { route: ModelRoute }) {
  const { tc } = useLocale();
  return (
    <>
      <div className="nc-aw-route">
        <span className="nc-glass-data nc-aw-route__node" data-role="preferred">
          <span className="nc-aw-route__tier">{tc("Preferred")}</span>
          <span className="nc-aw-route__name">{route.preferred}</span>
        </span>
        <svg className="nc-net nc-aw-route__line" viewBox="0 0 30 8" preserveAspectRatio="none" aria-hidden="true">
          <path className="nc-net__line" data-state="routing" d="M0 4 H30" />
        </svg>
        <span className="nc-glass-data nc-aw-route__node" data-role="fallback">
          <span className="nc-aw-route__tier">{tc("Fallback")}</span>
          <span className="nc-aw-route__name">{route.fallback}</span>
        </span>
      </div>
      <dl className="nc-aw-ident">
        <div className="nc-aw-ident__row">
          <dt>{tc("Current policy")}</dt>
          <dd>
            <span className="nc-aw-policy">{tc(route.policy)}</span>
          </dd>
        </div>
        <div className="nc-aw-ident__row">
          <dt>{tc("Cost policy")}</dt>
          <dd>{tc(route.costPolicy)}</dd>
        </div>
        <div className="nc-aw-ident__row">
          <dt>{tc("Paid escalation")}</dt>
          <dd>{tc(route.paidEscalation)}</dd>
        </div>
      </dl>
    </>
  );
}

function ModelRouteMini({ route }: { route: ModelRoute }) {
  const { tc } = useLocale();
  return (
    <dl className="nc-aw-ident">
      <div className="nc-aw-ident__row">
        <dt>{tc("Current policy")}</dt>
        <dd>
          <span className="nc-aw-policy">{tc(route.policy)}</span>
        </dd>
      </div>
      <div className="nc-aw-ident__row">
        <dt>{tc("Preferred route")}</dt>
        <dd>{route.preferred}</dd>
      </div>
      <div className="nc-aw-ident__row">
        <dt>{tc("Fallback route")}</dt>
        <dd>{route.fallback}</dd>
      </div>
      <div className="nc-aw-ident__row">
        <dt>{tc("Cost policy")}</dt>
        <dd>{tc(route.costPolicy)}</dd>
      </div>
      <div className="nc-aw-ident__row">
        <dt>{tc("Paid escalation")}</dt>
        <dd>{tc(route.paidEscalation)}</dd>
      </div>
    </dl>
  );
}

/* ── Work ──────────────────────────────────────────────────────────────── */

const WORK_GROUP_KEYS = [
  { kind: "mission", key: "dws.activeMissions" },
  { kind: "job", key: "aw.groupAssignedJobs" },
  { kind: "delegated", key: "aw.groupDelegated" },
  { kind: "blocker", key: "dws.blockers" },
  { kind: "approval", key: "aw.groupPendingApprovals" },
  { kind: "output", key: "aw.groupRecentOutputs" },
] as const;

function WorkMode({ actor }: { actor: ActorConfig }) {
  const { t, tc } = useLocale();
  return (
    <div className="nc-aw-grid nc-aw-grid--work">
      {WORK_GROUP_KEYS.map((group) => {
        const items = actor.work.filter((item) => item.kind === (group.kind as WorkKind));
        return (
          <section key={group.kind} className="nc-aw-card" data-empty={items.length === 0}>
            <span className="nc-aw-card__kicker">
              {t(group.key)} <i>{items.length}</i>
            </span>
            {items.length === 0 ? (
              <span className="nc-aw-none">{t("aw.nothingInState")}</span>
            ) : (
              <ul className="nc-aw-rows">
                {items.map((item) => (
                  <li key={item.id} className="nc-aw-row" data-state={item.state}>
                    <span className="nc-aw-row__top">
                      <span className="nc-aw-row__title">{tc(item.title)}</span>
                      <span className="nc-aw-row__state">{tc(item.state)}</span>
                    </span>
                    <span className="nc-aw-row__note">{tc(item.note)}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        );
      })}
      <p className="nc-aw-note">{t("aw.workNote")}</p>
    </div>
  );
}

/* ── Skills ────────────────────────────────────────────────────────────── */

const SKILL_LEVELS: SkillLevel[] = ["Mastered", "Proficient", "Learning", "Dormant"];

function SkillsMode({ actor }: { actor: ActorConfig }) {
  const { t, tc } = useLocale();
  return (
    <div className="nc-aw-stack">
      <ul className="nc-aw-list">
        {actor.skills.map((skill) => (
          <li key={skill.id} className="nc-aw-item" data-available={skill.available}>
            <span className="nc-aw-item__main">
              <span className="nc-aw-item__top">
                <span className="nc-aw-item__name">{tc(skill.name)}</span>
                <span className="nc-aw-level" data-level={skill.level}>
                  {tc(skill.level)}
                </span>
              </span>
              <span className="nc-aw-item__meta">
                <span className="nc-aw-item__source">{tc(skill.source)}</span>
              </span>
            </span>
            <span className="nc-aw-item__side">
              <span className="nc-aw-item__label">{tc("Last used")}</span>
              <span className="nc-aw-item__value">{skill.lastUsed}</span>
            </span>
            <span className="nc-aw-item__flag" data-available={skill.available}>
              {skill.available ? t("aw.available") : t("aw.unavailable")}
            </span>
          </li>
        ))}
      </ul>
      <div className="nc-aw-legend">
        {SKILL_LEVELS.map((level) => (
          <span key={level} data-level={level}>
            {tc(level)}
          </span>
        ))}
      </div>
      <p className="nc-aw-note">{t("aw.skillsNote")}</p>
    </div>
  );
}

/* ── Tools ─────────────────────────────────────────────────────────────── */

function ToolsMode({ actor }: { actor: ActorConfig }) {
  const { notify } = useCommand();
  const { t, tc } = useLocale();

  return (
    <div className="nc-aw-stack">
      <ul className="nc-aw-list">
        {actor.tools.map((tool) => (
          <li key={tool.id} className="nc-aw-item" data-available={tool.available}>
            <span className="nc-aw-item__main">
              <span className="nc-aw-item__top">
                <span className="nc-aw-item__name nc-aw-mono">{tc(tool.name)}</span>
                <span className="nc-aw-perm" data-perm={tool.permission}>
                  {tc(tool.permission)}
                </span>
              </span>
              <span className="nc-aw-item__meta">
                <span className="nc-aw-item__source">{tc(tool.category)}</span>
              </span>
            </span>
            <span className="nc-aw-item__side">
              <span className="nc-aw-item__label">{tc("Last used")}</span>
              <span className="nc-aw-item__value">{tool.lastUsed}</span>
            </span>
            <button
              type="button"
              className="nc-aw-item__action"
              onClick={() => notify(t("aw.toolDisabledToast", { name: tool.name }))}
            >
              {tool.available ? t("aw.inspect") : t("aw.blocked")}
            </button>
          </li>
        ))}
      </ul>
      <p className="nc-aw-note">{t("aw.toolsNote")}</p>
    </div>
  );
}

/* ── Workflows ─────────────────────────────────────────────────────────── */

function WorkflowsMode({ actor }: { actor: ActorConfig }) {
  const { t, tc } = useLocale();
  return (
    <div className="nc-aw-grid nc-aw-grid--workflows">
      {actor.workflows.map((workflow) => (
        <section key={workflow.id} className="nc-aw-card">
          <span className="nc-aw-card__kicker">
            {tc(workflow.name)}
            <span className="nc-aw-wfstate" data-state={workflow.state}>
              {tc(workflow.state)}
            </span>
          </span>
          <ol className="nc-aw-steps">
            {workflow.steps.map((step, index) => (
              <li key={step} className="nc-aw-step">
                <span className="nc-aw-step__num">{index + 1}</span>
                {tc(step)}
              </li>
            ))}
          </ol>
          <span className="nc-aw-card__row">
            <span className="nc-aw-card__label">{tc("Reusable")}</span>
            <span className="nc-aw-card__value">
              {workflow.reusable ? (
                <>
                  <IconCheck size={13} /> {t("aw.sharedSequence")}
                </>
              ) : (
                t("aw.oneOff")
              )}
            </span>
          </span>
        </section>
      ))}
      <p className="nc-aw-note">{t("aw.workflowsNote")}</p>
    </div>
  );
}

/* ── Memory ────────────────────────────────────────────────────────────── */

function MemoryMode({ actor }: { actor: ActorConfig }) {
  const { t, tc } = useLocale();
  const total = actor.memory.reduce((sum, layer) => sum + layer.entries.length, 0);

  return (
    <div className="nc-aw-stack">
      <section className="nc-aw-card">
        <span className="nc-aw-card__kicker">{tc("Memory layers")}</span>
        <span className="nc-aw-card__sub">
          {t("aw.memoryLead", {
            count: total,
            unit: t(total === 1 ? "aw.entry" : "aw.entries"),
            layers: actor.memory.length,
          })}
        </span>
      </section>

      <div className="nc-aw-grid nc-aw-grid--memory">
        {actor.memory.map((layer) => (
          <section key={layer.id} className="nc-aw-card nc-aw-card--memory" data-empty={layer.entries.length === 0}>
            <span className="nc-aw-card__kicker">
              {tc(layer.label)} <i>{layer.entries.length}</i>
            </span>
            <span className="nc-aw-card__sub">{tc(layer.note)}</span>
            {layer.entries.length === 0 ? (
              <span className="nc-aw-none">{t("aw.noEntries")}</span>
            ) : (
              <ul className="nc-aw-mem">
                {layer.entries.map((entry) => (
                  <li key={entry.id} className="nc-aw-mem__item">
                    <span className="nc-aw-mem__title">{tc(entry.title)}</span>
                    <span className="nc-aw-mem__note">{tc(entry.note)}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        ))}
      </div>

      <p className="nc-aw-note">{t("aw.actorMemoryNote")}</p>
    </div>
  );
}

/* ── Permissions ───────────────────────────────────────────────────────── */

function PermissionsMode({ actor }: { actor: ActorConfig }) {
  const { t, tc } = useLocale();
  const { permissions } = actor;
  const facts: Array<{ label: string; value: string }> = [
    { label: tc("Data scope"), value: tc(permissions.dataScope) },
    { label: t("aw.financial"), value: tc(permissions.financial) },
    { label: t("aw.publishing"), value: tc(permissions.publishing) },
    { label: tc("Approval"), value: tc(permissions.approval) },
    { label: tc("Escalation"), value: tc(permissions.escalation) },
  ];

  return (
    <div className="nc-aw-stack">
      <section className="nc-aw-card">
        <span className="nc-aw-card__kicker">{tc("Autonomy level")}</span>
        <span className="nc-aw-autonomy">{tc(permissions.autonomy)}</span>
        <span className="nc-aw-card__sub">{t("aw.autonomyLead")}</span>
      </section>

      <div className="nc-aw-grid nc-aw-grid--perm">
        <section className="nc-aw-card">
          <span className="nc-aw-card__kicker">{tc("Allowed tools")}</span>
          {permissions.allowedTools.length === 0 ? (
            <span className="nc-aw-none">{t("aw.noToolAllowed")}</span>
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
          <span className="nc-aw-card__kicker">{tc("Allowed systems")}</span>
          {permissions.allowedSystems.length === 0 ? (
            <span className="nc-aw-none">{t("aw.noSystemAccess")}</span>
          ) : (
            <ul className="nc-aw-chips">
              {permissions.allowedSystems.map((system) => (
                <li key={system} className="nc-aw-chip">
                  {tc(system)}
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="nc-aw-card">
          <span className="nc-aw-card__kicker">{t("aw.scopeAndRules")}</span>
          <dl className="nc-aw-ident">
            {facts.map((fact) => (
              <div key={fact.label} className="nc-aw-ident__row">
                <dt>{tc(fact.label)}</dt>
                <dd>{fact.value}</dd>
              </div>
            ))}
          </dl>
        </section>

        {actor.model ? (
          <section className="nc-aw-card">
            <span className="nc-aw-card__kicker">{tc("Model route")}</span>
            <ModelRouteMini route={actor.model} />
          </section>
        ) : null}
      </div>

      <p className="nc-aw-note">{t("aw.permissionsNote")}</p>
    </div>
  );
}

/* ── Performance ───────────────────────────────────────────────────────── */

function PerformanceMode({ actor }: { actor: ActorConfig }) {
  const { t, tc } = useLocale();
  return (
    <div className="nc-aw-stack">
      <div className="nc-aw-grid nc-aw-grid--perf">
        {actor.performance.map((metric) => (
          <section key={metric.id} className="nc-aw-card nc-aw-card--metric">
            <span className="nc-aw-card__kicker">{tc(metric.label)}</span>
            <span className="nc-aw-metric__value">{tc(metric.value)}</span>
            <span className="nc-aw-card__sub">{tc(metric.note)}</span>
          </section>
        ))}
      </div>
      <p className="nc-aw-note">{t("aw.performanceNote")}</p>
    </div>
  );
}

/* ── History ───────────────────────────────────────────────────────────── */

function HistoryMode({ actor }: { actor: ActorConfig }) {
  const { t, tc } = useLocale();
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
                <span className="nc-aw-event__kind">{tc(entry.kind)}</span>
                <span className="nc-aw-event__at">{tc(entry.at)}</span>
              </span>
              <span className="nc-aw-event__title">{tc(entry.title)}</span>
            </span>
          </li>
        ))}
      </ol>
      <p className="nc-aw-note">{t("aw.historyNote")}</p>
    </div>
  );
}
