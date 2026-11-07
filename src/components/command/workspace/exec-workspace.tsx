"use client";

import { useMemo, useState, type ComponentType } from "react";
import Link from "next/link";
import { useCommand } from "../state/command-store";
import {
  CONTEXT_LAYERS,
  EXEC_ACTIVITY,
  EXEC_AREAS,
  EXEC_IDENTITY,
  EXEC_STATUS,
  MISSION_ROUTE,
  REPEATING_WORK,
  SUMMON_TARGETS,
  WAR_ROOM,
  execState,
  summonKindLabel,
  type ExecAreaId,
  type ExecIconKey,
  type RouteEdge,
} from "../state/exec-model";
import { useLocale } from "../i18n/command-locale";
import { cssVars } from "../ui/css-vars";
import {
  EXEC_ICONS,
  IconArrowLeft,
  IconExec,
  IconHuman,
  IconAgent,
  IconMic,
  IconPlus,
  IconSend,
  IconSpark,
  IconTool,
  IconWorkflow,
} from "../ui/icons";

/**
 * EXEC WORKSPACE (Phase UI-05)
 * ────────────────────────────
 * EXEC's own page. It is the same shell as a department or an actor — EXEC is
 * an entity with a workspace, not a modal — but its material, type and state
 * vocabulary are EXEC's own, so it never reads as "another department".
 *
 * Composition:
 *   1. IDENTITY  — the EXEC sigil, its state light, its headline and the four
 *                  things it is currently aware of;
 *   2. COMMAND   — a persistent, attachment-ready command surface (prepared
 *                  visually for text, voice, files, images and screenshots);
 *   3. AREAS     — the seven foundation areas (Command, Summon, War Room,
 *                  Mission Routing, Repeating Work, Context, Activity).
 *
 * Everything is mock configuration. There is no AI provider, no tool runtime,
 * no scheduler and no memory store behind any of this, and the page says so.
 */

const AREA_ICONS: Record<ExecIconKey, ComponentType<{ size?: number; className?: string }>> = EXEC_ICONS;

/** The four starting intents the command composer offers. Content, not chrome. */
const EXEC_INTENTS = [
  "Route the Q4 offer",
  "What needs me today?",
  "Call the Growth team",
  "Start a war room",
];

/* ── Mission Routing canvas ───────────────────────────────────────────────
   Positions are derived from the configuration, never hand-placed, so adding a
   node or an edge is a data change. The SVG shares ONE coordinate space with
   the node layer (viewBox 0..100), and every line carries its relationship
   STATE, not just a colour.                                                 */

function RouteCanvas() {
  const { t, tc } = useLocale();
  const { nodes, edges, mission } = MISSION_ROUTE;

  const byColumn = useMemo(() => {
    const map = new Map<number, typeof nodes>();
    nodes.forEach((node) => {
      const list = map.get(node.column) ?? [];
      list.push(node);
      map.set(node.column, list);
    });
    return map;
  }, [nodes]);

  const anchor = (id: string) => {
    const node = nodes.find((n) => n.id === id);
    if (!node) return { x: 0, y: 50 };
    const list = byColumn.get(node.column) ?? [node];
    const index = list.findIndex((n) => n.id === id);
    const count = list.length;
    return {
      x: ((node.column + 0.5) / 6) * 100,
      y: count === 1 ? 50 : ((index + 1) / (count + 1)) * 100,
    };
  };

  const path = (edge: RouteEdge) => {
    const a = anchor(edge.from);
    const b = anchor(edge.to);
    const mx = (a.x + b.x) / 2;
    /* When both ends sit on the same lane, bow the curve out of that lane so it
       never draws straight through a node that happens to share the lane. */
    const bow = Math.abs(a.y - b.y) < 6 ? (a.y < 50 ? -8 : 8) : 0;
    return `M ${a.x} ${a.y} C ${mx} ${a.y + bow}, ${mx} ${b.y + bow}, ${b.x} ${b.y}`;
  };

  return (
    <div className="nc-ex-route">
      <div className="nc-ex-route__scroll">
        <div className="nc-ex-route__canvas">
          <svg className="nc-net nc-ex-route__net" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
            {edges.map((edge) => (
              <path key={`${edge.from}-${edge.to}`} className="nc-net__line" data-state={edge.state} d={path(edge)} />
            ))}
            {edges
              .filter((edge) => edge.state === "active")
              .map((edge) => (
                <path
                  key={`flow-${edge.from}-${edge.to}`}
                  className="nc-net__flow"
                  d={path(edge)}
                />
              ))}
          </svg>

          {nodes.map((node) => {
            const a = anchor(node.id);
            return (
              <div
                key={node.id}
                className="nc-ex-rnode"
                data-kind={node.kind}
                style={cssVars({ left: `${a.x}%`, top: `${a.y}%` })}
              >
                <span className="nc-ex-rnode__plate" aria-hidden="true" />
                <span className="nc-ex-rnode__label">{tc(node.label)}</span>
                <span className="nc-ex-rnode__detail">{tc(node.detail)}</span>
              </div>
            );
          })}
        </div>
      </div>
      <p className="nc-ex-note">{t("exw.routeNote", { mission: tc(mission) })}</p>
    </div>
  );
}

function AreaBody({ area, onSend, value, setValue }: {
  area: ExecAreaId;
  onSend: () => void;
  value: string;
  setValue: (v: string) => void;
}) {
  const { notify } = useCommand();
  const { t, tc } = useLocale();

  switch (area) {
    case "command":
      return (
        <div className="nc-ex-grid nc-ex-grid--command">
          <section className="nc-glass nc-glass--lit nc-ex-panel nc-ex-panel--wide">
            <span className="nc-eyebrow">{t("exw.commandSurface")}</span>
            <h3 className="nc-ex-panel__title">{t("exw.commandTitle")}</h3>
            <p className="nc-ex-panel__lede">{t("exw.commandLede")}</p>
            <form
              className="nc-ex-composer"
              onSubmit={(event) => {
                event.preventDefault();
                onSend();
              }}
            >
              <input
                className="nc-ex-composer__input"
                value={value}
                onChange={(event) => setValue(event.target.value)}
                placeholder={t("exw.commandPlaceholder")}
                aria-label={t("exw.commandInputAria")}
                autoComplete="off"
              />
              <div className="nc-ex-composer__tools" role="group" aria-label={t("exw.toolsAria")}>
                <button type="button" className="nc-ex-tool" onClick={() => notify(t("exw.attachToast"))} aria-label={t("exw.attachFile")}>
                  <IconPlus size={15} />
                </button>
                <button type="button" className="nc-ex-tool" onClick={() => notify(t("exw.imageToast"))} aria-label={t("exw.addImage")}>
                  <IconTool size={15} />
                </button>
                <button type="button" className="nc-ex-tool" onClick={() => notify(t("exw.voiceToast"))} aria-label={t("exw.speak")}>
                  <IconMic size={15} />
                </button>
              </div>
              <button type="submit" className="nc-btn nc-btn--lime" disabled={!value.trim()}>
                <IconSend size={14} />
                {t("exw.send")}
              </button>
            </form>
            <div className="nc-ex-intents">
              {EXEC_INTENTS.map((intent) => (
                <button key={intent} type="button" className="nc-ex-intent" onClick={() => setValue(tc(intent))}>
                  {tc(intent)}
                </button>
              ))}
            </div>
          </section>

          <section className="nc-glass nc-ex-panel">
            <span className="nc-eyebrow">{t("exw.currentDirection")}</span>
            <p className="nc-ex-panel__quote">{t("exw.directionQuote")}</p>
            <ul className="nc-ex-flags">
              <li><span className="nc-ex-flag" data-tone="active" /> {t("exw.flagRouted")}</li>
              <li><span className="nc-ex-flag" data-tone="approval" /> {t("exw.flagApproval")}</li>
              <li><span className="nc-ex-flag" data-tone="handoff" /> {t("exw.flagHandoff")}</li>
            </ul>
          </section>
        </div>
      );

    case "summon":
      return (
        <div className="nc-ex-grid">
          <section className="nc-glass nc-ex-panel nc-ex-panel--wide">
            <span className="nc-eyebrow">{t("exw.summonOne")}</span>
            <p className="nc-ex-panel__lede">{t("exw.summonOneLede")}</p>
            <div className="nc-ex-summon">
              {SUMMON_TARGETS.filter((t) => t.kind !== "many").map((target) => (
                <div key={target.id} className="nc-glass-data nc-ex-summon__row">
                  <span className="nc-ex-summon__icon" data-kind={target.kind} aria-hidden="true">
                    {target.kind === "human" ? <IconHuman size={16} /> : target.kind === "department" ? <IconExec size={16} /> : <IconAgent size={16} />}
                  </span>
                  <span className="nc-ex-summon__text">
                    {target.href ? (
                      <Link className="nc-ex-summon__name" href={target.href}>
                        {target.label}
                      </Link>
                    ) : (
                      <span className="nc-ex-summon__name">{target.label}</span>
                    )}
                    <span className="nc-ex-summon__detail">
                      {tc(summonKindLabel(target.kind))} · {tc(target.detail)}
                    </span>
                  </span>
                  <button
                    type="button"
                    className="nc-btn nc-btn--sm"
                    onClick={() => notify(t("exw.summonToast", { name: tc(target.label) }))}
                  >
                    {t("exw.summon")}
                  </button>
                </div>
              ))}
            </div>
          </section>

          <section className="nc-glass nc-ex-panel">
            <span className="nc-eyebrow">{t("exw.summonMany")}</span>
            <p className="nc-ex-panel__lede">{t("exw.summonManyLede")}</p>
            <div className="nc-ex-summon">
              {SUMMON_TARGETS.filter((t) => t.kind === "many").map((target) => (
                <div key={target.id} className="nc-glass-data nc-ex-summon__row">
                  <span className="nc-ex-summon__icon" data-kind="many" aria-hidden="true">
                    <IconWorkflow size={16} />
                  </span>
                  <span className="nc-ex-summon__text">
                    <span className="nc-ex-summon__name">{tc(target.label)}</span>
                    <span className="nc-ex-summon__detail">{tc(target.detail)}</span>
                  </span>
                  <button
                    type="button"
                    className="nc-btn nc-btn--sm"
                    onClick={() => notify(t("exw.summonGroupToast", { name: tc(target.label) }))}
                  >
                    {t("exw.summon")}
                  </button>
                </div>
              ))}
            </div>
          </section>
        </div>
      );

    case "warroom":
      return (
        <div className="nc-ex-grid">
          <section className="nc-glass nc-glass--lit nc-ex-panel nc-ex-panel--wide">
            <span className="nc-eyebrow">{t("exw.warRoomArea")}</span>
            <h3 className="nc-ex-panel__title">{tc(WAR_ROOM.mission)}</h3>
            <p className="nc-ex-panel__lede">{tc(WAR_ROOM.moderator)}</p>
            <div className="nc-ex-seats">
              {WAR_ROOM.seats.map((seat) => (
                <div key={seat.id} className="nc-glass-data nc-ex-seat" data-kind={seat.kind}>
                  <span className="nc-ex-seat__icon" aria-hidden="true">
                    {seat.kind === "human" ? <IconHuman size={15} /> : <IconAgent size={15} />}
                  </span>
                  <span className="nc-ex-seat__name">{tc(seat.name)}</span>
                  <span className="nc-ex-seat__role">{tc(seat.role)}</span>
                </div>
              ))}
            </div>
            <button type="button" className="nc-btn nc-btn--lime" onClick={() => notify(t("exw.warRoomToast"))}>
              <IconSpark size={14} />
              {t("exw.openWarRoom")}
            </button>
          </section>

          <section className="nc-glass nc-ex-panel">
            <span className="nc-eyebrow">{t("exw.agenda")}</span>
            <ul className="nc-ex-agenda">
              {WAR_ROOM.agenda.map((item) => (
                <li key={item.id} className="nc-ex-agenda__row" data-state={item.state}>
                  <span className="nc-ex-agenda__dot" aria-hidden="true" />
                  <span className="nc-ex-agenda__label">{tc(item.label)}</span>
                  <span className="nc-ex-agenda__owner">{tc(item.owner)}</span>
                </li>
              ))}
            </ul>
          </section>
        </div>
      );

    case "routing":
      return (
        <section className="nc-glass nc-ex-panel nc-ex-panel--wide">
          <span className="nc-eyebrow">{t("exw.missionRouting")}</span>
          <h3 className="nc-ex-panel__title">{t("exw.routingChain")}</h3>
          <RouteCanvas />
        </section>
      );

    case "repeating":
      return (
        <section className="nc-glass nc-ex-panel nc-ex-panel--wide">
          <span className="nc-eyebrow">{t("exw.repeatingWork")}</span>
          <p className="nc-ex-panel__lede">{t("exw.repeatingLede")}</p>
          <div className="nc-ex-repeat">
            {REPEATING_WORK.map((item) => (
              <div key={item.id} className="nc-glass-data nc-ex-repeat__row" data-state={item.state}>
                <span className="nc-ex-repeat__state" aria-hidden="true" />
                <span className="nc-ex-repeat__text">
                  <span className="nc-ex-repeat__label">{tc(item.label)}</span>
                  <span className="nc-ex-repeat__note">{tc(item.note)}</span>
                </span>
                <span className="nc-ex-repeat__meta">
                  <span className="nc-ex-repeat__cadence">{tc(item.cadence)}</span>
                  <span className="nc-ex-repeat__owner">{tc(item.owner)}</span>
                </span>
              </div>
            ))}
          </div>
        </section>
      );

    case "context":
      return (
        <div className="nc-ex-layers">
          {CONTEXT_LAYERS.map((layer) => (
            <section key={layer.id} className="nc-glass nc-ex-layer">
              <span className="nc-eyebrow">{tc(layer.label)}</span>
              <p className="nc-ex-layer__note">{tc(layer.note)}</p>
              <ul className="nc-ex-layer__items">
                {layer.items.map((item) => (
                  <li key={item}>{tc(item)}</li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      );

    case "activity":
      return (
        <section className="nc-glass nc-ex-panel nc-ex-panel--wide">
          <span className="nc-eyebrow">{t("exw.activityArea")}</span>
          <ul className="nc-ex-activity">
            {EXEC_ACTIVITY.map((item) => (
              <li key={item.id} className="nc-ex-activity__row" data-state={item.state}>
                <span className="nc-ex-activity__dot" aria-hidden="true" />
                <span className="nc-ex-activity__text">
                  <span className="nc-ex-activity__label">{tc(item.label)}</span>
                  <span className="nc-ex-activity__meta">{tc(item.meta)}</span>
                </span>
                <span className="nc-ex-activity__state">{tc(item.state)}</span>
                <span className="nc-ex-activity__when">{tc(item.when)}</span>
              </li>
            ))}
          </ul>
        </section>
      );

    default:
      return null;
  }
}

export function ExecWorkspace() {
  const { notify } = useCommand();
  const { t, tc } = useLocale();
  const [area, setArea] = useState<ExecAreaId>("command");
  const [direction, setDirection] = useState("");

  const status = execState(EXEC_STATUS.state);

  const send = () => {
    const text = direction.trim();
    if (!text) return;
    notify(t("exw.directionReceived", { text }));
    setDirection("");
  };

  return (
    <div className="nc-ex" data-state={EXEC_STATUS.state} style={cssVars({ "--nc-ex-tone": status.tone })}>
      <header className="nc-ex__head nc-anim-panel">
        <div className="nc-ex__head-top">
          <Link className="nc-ex__back" href="/command">
            <IconArrowLeft size={14} />
            {t("dws.backToCommand")}
          </Link>

          <span className="nc-ex__sigil" aria-hidden="true">
            <span className="nc-ex__sigil-core" />
            <IconExec size={26} />
          </span>

          <div className="nc-ex__titles">
            <span className="nc-ex__kicker">{tc(EXEC_IDENTITY.role)}</span>
            <h1 className="nc-ex__name">{EXEC_IDENTITY.name}</h1>
          </div>

          <span className="nc-ex__state" data-state={EXEC_STATUS.state}>
            <i aria-hidden="true" />
            {tc(status.label)}
          </span>
        </div>

        <p className="nc-ex__headline">{tc(EXEC_STATUS.headline)}</p>
        <p className="nc-ex__character">{tc(EXEC_IDENTITY.character)}</p>

        <dl className="nc-ex__aware">
          {EXEC_STATUS.awareness.map((item) => (
            <div key={item.id} className="nc-ex__aware-item">
              <dt>{tc(item.label)}</dt>
              <dd>{tc(item.detail)}</dd>
            </div>
          ))}
        </dl>

        <p className="nc-ex__state-note">{tc(status.note)}</p>
      </header>

      <nav className="nc-ex__areas" aria-label={t("exw.areasAria")}>
        {EXEC_AREAS.map((item) => {
          const Icon = AREA_ICONS[item.icon];
          const active = item.id === area;
          return (
            <button
              key={item.id}
              type="button"
              className="nc-ex__area"
              data-active={active}
              aria-current={active ? "page" : undefined}
              onClick={() => setArea(item.id)}
            >
              <span className="nc-ex__area-icon">
                <Icon size={16} />
              </span>
              <span className="nc-ex__area-text">
                <span className="nc-ex__area-label">{tc(item.label)}</span>
                <span className="nc-ex__area-hint">{tc(item.hint)}</span>
              </span>
            </button>
          );
        })}
      </nav>

      <div className="nc-ex__body nc-anim-panel" key={area}>
        <AreaBody area={area} onSend={send} value={direction} setValue={setDirection} />
      </div>

      <p className="nc-ex-note nc-ex-note--foot">{t("exw.footerNote")}</p>
    </div>
  );
}
