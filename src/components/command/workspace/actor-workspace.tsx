"use client";

import { useState, type ComponentType } from "react";
import Link from "next/link";
import { useCommand } from "../state/command-store";
import {
  ACTOR_MODES,
  actorTypeLabel,
  departmentHrefForActor,
  type ActorConfig,
  type ActorModeId,
} from "../state/actor-workspace";
import { cssVars } from "../ui/css-vars";
import {
  IconAgent,
  IconArrowLeft,
  IconCapabilities,
  IconControl,
  IconHuman,
  IconList,
  IconReview,
  IconRun,
  IconSend,
  IconSpark,
  IconStack,
  IconTool,
  IconWarRoom,
  IconWorkflow,
  type IconProps,
} from "../ui/icons";
import { ActorModeBody } from "./actor-modes";

/**
 * ACTOR WORKSPACE (Phase UI-04)
 * ─────────────────────────────
 * The reusable shell every actor opens into — human or AI. It owns exactly
 * three decisions — who I am, which mode I am showing, and how I leave — and
 * renders everything else from configuration.
 *
 * Composition, top to bottom:
 *   1. HEADER   — back to the department, identity, type (HUMAN / AI AGENT),
 *                 role, department, status, current mission, responsibility;
 *   2. COMMAND  — a persistent Actor Command Surface (talk / instruct / warn /
 *                 add context / assign mission / escalate to EXEC), so the page
 *                 reads as "I am speaking directly to this worker";
 *   3. MODES    — the nine internal surfaces (Overview … History);
 *   4. BODY     — the current mode, from `actor-modes.tsx`.
 *
 * Nothing here fetches data, calls an AI or touches a database. All content is
 * mock configuration and the shell says so.
 */

const MODE_ICONS: Record<ActorModeId, ComponentType<IconProps>> = {
  overview: IconSpark,
  work: IconRun,
  skills: IconCapabilities,
  tools: IconTool,
  workflows: IconWorkflow,
  memory: IconStack,
  permissions: IconControl,
  performance: IconReview,
  history: IconList,
};

export function ActorWorkspace({ actor }: { actor: ActorConfig }) {
  const { notify, setExecOpen } = useCommand();
  const [mode, setMode] = useState<ActorModeId>("overview");
  const [instruction, setInstruction] = useState("");

  const isAI = actor.type === "ai-agent";
  const TypeIcon = isAI ? IconAgent : IconHuman;

  const send = () => {
    const text = instruction.trim();
    if (!text) return;
    notify(`Instruction queued for ${actor.name} (mock): “${text}”`);
    setInstruction("");
  };

  return (
    <div
      className="nc-aw"
      data-type={actor.type}
      style={cssVars({ "--nc-aw-accent": `var(${actor.accentVar})` })}
    >
      <header className="nc-aw__head nc-anim-panel">
        <div className="nc-aw__head-top">
          <Link className="nc-aw__back" href={departmentHrefForActor(actor)}>
            <IconArrowLeft size={14} />
            {actor.departmentName}
          </Link>

          <span className="nc-aw__avatar" aria-hidden="true">
            {actor.initials}
          </span>

          <div className="nc-aw__titles">
            <span className="nc-aw__kicker">
              {actor.role} · {actor.departmentName}
            </span>
            <h1 className="nc-aw__name">{actor.name}</h1>
          </div>

          <span className="nc-aw__type" data-type={actor.type}>
            <TypeIcon size={14} />
            {actorTypeLabel(actor.type)}
          </span>

          <span className="nc-aw__state">
            <i aria-hidden="true" />
            {actor.status}
          </span>
        </div>

        <p className="nc-aw__responsibility">{actor.responsibility}</p>

        <dl className="nc-aw__facts">
          <div className="nc-aw__fact">
            <dt>Current mission</dt>
            <dd>{actor.mission}</dd>
          </div>
          <div className="nc-aw__fact">
            <dt>Reports to</dt>
            <dd>{actor.reportsTo}</dd>
          </div>
          <div className="nc-aw__fact">
            <dt>Skills</dt>
            <dd>{actor.skills.length}</dd>
          </div>
          <div className="nc-aw__fact" data-attention={actor.attention.length > 0}>
            <dt>Needs attention</dt>
            <dd>{actor.attention.length}</dd>
          </div>
        </dl>
      </header>

      {/* Persistent Actor Command Surface. Mock interaction only — nothing is
          sent to a model or a tool. */}
      <div className="nc-aw__cmd" role="group" aria-label={`Command ${actor.name}`}>
        <span className="nc-aw__cmd-lead">
          <span className="nc-aw__cmd-orb" aria-hidden="true" />
          <span className="nc-aw__cmd-label">Direct command</span>
        </span>

        <span className="nc-aw__cmd-inputwrap">
          <input
            className="nc-aw__cmd-input"
            value={instruction}
            placeholder={`Speak directly to ${actor.name}…`}
            aria-label={`Instruction for ${actor.name}`}
            onChange={(event) => setInstruction(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") send();
            }}
          />
          <button type="button" className="nc-aw__cmd-send" onClick={send} aria-label="Send instruction">
            <IconSend size={14} />
          </button>
        </span>

        <div className="nc-aw__cmd-actions">
          <button
            type="button"
            className="nc-aw__cmd-btn"
            onClick={() => notify(`${actor.name} — a mock conversation opens here in a later phase.`)}
          >
            Talk
          </button>
          <button
            type="button"
            className="nc-aw__cmd-btn"
            onClick={() => notify(`Warned ${actor.name} (mock).`) }
          >
            Warn
          </button>
          <button
            type="button"
            className="nc-aw__cmd-btn"
            onClick={() => notify(`Context added for ${actor.name} (mock).`)}
          >
            Add context
          </button>
          <button
            type="button"
            className="nc-aw__cmd-btn"
            onClick={() => notify(`Mission assigned to ${actor.name} (mock).`)}
          >
            Assign mission
          </button>
          <button
            type="button"
            className="nc-aw__cmd-btn nc-aw__cmd-btn--exec"
            onClick={() => setExecOpen(true)}
          >
            <IconWarRoom size={14} />
            Escalate to EXEC
          </button>
        </div>

        <span className="nc-aw__cmd-note">No AI provider · mock</span>
      </div>

      <nav className="nc-aw__modes" aria-label={`${actor.name} workspace modes`}>
        {ACTOR_MODES.map((item) => {
          const ModeIcon = MODE_ICONS[item.id];
          const current = item.id === mode;
          return (
            <button
              key={item.id}
              type="button"
              className="nc-aw__mode"
              data-current={current}
              aria-pressed={current}
              title={item.hint}
              onClick={() => setMode(item.id)}
            >
              <ModeIcon size={15} />
              {item.label}
            </button>
          );
        })}
      </nav>

      <div className="nc-aw__body">
        <div className="nc-aw__modehead">
          <span className="nc-aw__modehead-title">{ACTOR_MODES.find((item) => item.id === mode)?.label}</span>
          <span className="nc-aw__modehead-hint">{ACTOR_MODES.find((item) => item.id === mode)?.hint}</span>
        </div>

        <ActorModeBody mode={mode} actor={actor} />
      </div>
    </div>
  );
}
