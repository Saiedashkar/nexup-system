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
import { useLocale } from "../i18n/command-locale";
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
  const { t, tc } = useLocale();
  const [mode, setMode] = useState<ActorModeId>("overview");
  const [instruction, setInstruction] = useState("");

  const isAI = actor.type === "ai-agent";
  const TypeIcon = isAI ? IconAgent : IconHuman;
  const actorName = tc(actor.name);

  const send = () => {
    const text = instruction.trim();
    if (!text) return;
    notify(t("aw.instructionQueued", { name: actorName, text }));
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
            {tc(actor.departmentName)}
          </Link>

          <span className="nc-aw__avatar" aria-hidden="true">
            {actor.initials}
          </span>

          <div className="nc-aw__titles">
            <span className="nc-aw__kicker">
              {tc(actor.role)} · {tc(actor.departmentName)}
            </span>
            <h1 className="nc-aw__name">{actorName}</h1>
          </div>

          <span className="nc-aw__type" data-type={actor.type}>
            <TypeIcon size={14} />
            {tc(actorTypeLabel(actor.type))}
          </span>

          <span className="nc-aw__state">
            <i aria-hidden="true" />
            {tc(actor.status)}
          </span>
        </div>

        <p className="nc-aw__responsibility">{tc(actor.responsibility)}</p>

        <dl className="nc-aw__facts">
          <div className="nc-aw__fact">
            <dt>{t("aw.factCurrentMission")}</dt>
            <dd>{tc(actor.mission)}</dd>
          </div>
          <div className="nc-aw__fact">
            <dt>{t("aw.factReportsTo")}</dt>
            <dd>{tc(actor.reportsTo)}</dd>
          </div>
          <div className="nc-aw__fact">
            <dt>{t("aw.factSkills")}</dt>
            <dd>{actor.skills.length}</dd>
          </div>
          <div className="nc-aw__fact" data-attention={actor.attention.length > 0}>
            <dt>{t("aw.factAttention")}</dt>
            <dd>{actor.attention.length}</dd>
          </div>
        </dl>
      </header>

      {/* Persistent Actor Command Surface. Mock interaction only — nothing is
          sent to a model or a tool. */}
      <div className="nc-aw__cmd" role="group" aria-label={t("aw.commandAria", { name: actorName })}>
        <span className="nc-aw__cmd-lead">
          <span className="nc-aw__cmd-orb" aria-hidden="true" />
          <span className="nc-aw__cmd-label">{t("aw.commandLabel")}</span>
        </span>

        <span className="nc-aw__cmd-inputwrap">
          <input
            className="nc-aw__cmd-input"
            value={instruction}
            placeholder={t("aw.commandPlaceholder", { name: actorName })}
            aria-label={t("aw.commandInputAria", { name: actorName })}
            onChange={(event) => setInstruction(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") send();
            }}
          />
          <button type="button" className="nc-aw__cmd-send" onClick={send} aria-label={t("aw.sendAria")}>
            <IconSend size={14} />
          </button>
        </span>

        <div className="nc-aw__cmd-actions">
          <button
            type="button"
            className="nc-aw__cmd-btn"
            onClick={() => notify(t("aw.talkToast", { name: actorName }))}
          >
            {t("aw.talk")}
          </button>
          <button
            type="button"
            className="nc-aw__cmd-btn"
            onClick={() => notify(t("aw.warnToast", { name: actorName }))}
          >
            {t("aw.warn")}
          </button>
          <button
            type="button"
            className="nc-aw__cmd-btn"
            onClick={() => notify(t("aw.addContextToast", { name: actorName }))}
          >
            {t("aw.addContext")}
          </button>
          <button
            type="button"
            className="nc-aw__cmd-btn"
            onClick={() => notify(t("aw.assignToast", { name: actorName }))}
          >
            {t("aw.assignMission")}
          </button>
          <button
            type="button"
            className="nc-aw__cmd-btn nc-aw__cmd-btn--exec"
            onClick={() => setExecOpen(true)}
          >
            <IconWarRoom size={14} />
            {t("aw.escalateToExec")}
          </button>
        </div>

        <span className="nc-aw__cmd-note">{t("aw.mockNote")}</span>
      </div>

      <nav className="nc-aw__modes" aria-label={t("aw.modesAria", { name: actorName })}>
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
              title={tc(item.hint)}
              onClick={() => setMode(item.id)}
            >
              <ModeIcon size={15} />
              {tc(item.label)}
            </button>
          );
        })}
      </nav>

      <div className="nc-aw__body">
        <div className="nc-aw__modehead">
          <span className="nc-aw__modehead-title">{tc(ACTOR_MODES.find((item) => item.id === mode)?.label ?? "")}</span>
          <span className="nc-aw__modehead-hint">{tc(ACTOR_MODES.find((item) => item.id === mode)?.hint ?? "")}</span>
        </div>

        <ActorModeBody mode={mode} actor={actor} />
      </div>
    </div>
  );
}
