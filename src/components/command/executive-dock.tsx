"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useCommand } from "./state/command-store";
import { useLocale, type LocaleValue } from "./i18n/command-locale";
import { FOUNDER } from "./state/organization-model";
import { EXEC_INTENTS, executiveGreeting, executiveReply } from "./state/mock-intent";
import type { CommandVisualSnapshot } from "./state/demo-scenarios";
import { IconChevronDown, IconSpark } from "./ui/icons";

/**
 * Executive presence.
 *
 * The Executive is conceptually accessible from everywhere, so its control is
 * persistent and visual — a living orb with a voice waveform — and it is the
 * LEAD cell of the command surface, not a chat bubble in the corner. Opening it
 * raises a console inside the stage, above the surface that opened it.
 *
 * There is no AI provider in this phase. Replies are produced locally by
 * `mock-intent.ts` and every reply says so out loud.
 */
export function ExecutiveDockOrb() {
  const { execOpen, setExecOpen } = useCommand();
  const { t } = useLocale();

  return (
    <div className="nc-exec-lead">
      <button
        type="button"
        className="nc-exec-lead__orb"
        data-open={execOpen}
        onClick={() => setExecOpen(!execOpen)}
        aria-expanded={execOpen}
        aria-label={t("execDock.openAria")}
      >
        <span className="nc-exec-lead__wave" aria-hidden="true">
          <i />
          <i />
          <i />
          <i />
          <i />
        </span>
      </button>
      <span className="nc-exec-lead__text">
        <span className="nc-exec-lead__title">{t("execDock.talk")}</span>
        <span className="nc-exec-lead__hint">
          {execOpen ? t("execDock.hintClose") : t("execDock.hintOpen")}
        </span>
      </span>
    </div>
  );
}

/* A message stores WHAT was said, never the rendered sentence: an Executive line
   is recomposed from the dictionary on every render, so a language switch
   rewrites the conversation instead of leaving earlier bubbles in the old
   language. Human input is the one thing that is never translated. */
type Message =
  | { id: number; role: "human"; text: string }
  | { id: number; role: "executive"; greeting: true }
  | { id: number; role: "executive"; replyTo: string };

function messageText(
  message: Message,
  snapshot: CommandVisualSnapshot,
  t: LocaleValue["t"],
): string {
  if (message.role === "human") return message.text;
  return "greeting" in message ? executiveGreeting(snapshot, t) : executiveReply(message.replyTo, snapshot, t);
}

/**
 * The raised console.
 *
 * Mounted by the shell only while it is open, and keyed by the demo revision —
 * so the opening line is initialised once, lazily, instead of being pushed into
 * state from an effect, and switching demo states starts a clean exchange.
 */
export function ExecutiveSurface() {
  const { setExecOpen, snapshot, notify } = useCommand();
  const { t } = useLocale();
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<Message[]>(() => [
    { id: 0, role: "executive", greeting: true },
  ]);
  const pending = useRef<ReturnType<typeof setTimeout> | null>(null);
  const nextId = useRef(1);

  useEffect(
    () => () => {
      if (pending.current) clearTimeout(pending.current);
    },
    [],
  );

  const send = (text: string) => {
    const trimmed = text.trim();
    if (!trimmed) return;
    setMessages((current) => [...current, { id: nextId.current++, role: "human", text: trimmed }]);
    setInput("");
    pending.current = setTimeout(() => {
      setMessages((current) => [
        ...current,
        { id: nextId.current++, role: "executive", replyTo: trimmed },
      ]);
    }, 520);
  };

  return (
    <>
      <div className="nc-exec-surface__scrim" onClick={() => setExecOpen(false)} aria-hidden="true" />

      <section className="nc-exec-surface" aria-label={t("execDock.surfaceAria")}>
        <header className="nc-exec-surface__head">
          <span className="nc-avatar" style={{ width: 24, height: 24, fontSize: 10 }} aria-hidden="true">
            {FOUNDER.initials}
          </span>
          <span>
            <span className="nc-exec-surface__title" style={{ display: "block" }}>
              {t("execDock.title")}
            </span>
            <span className="nc-exec-surface__kicker">{t(`scenario.${snapshot.scenario}`)}</span>
          </span>
          <span style={{ flex: 1 }} />
          {/* EXEC is a first-class entity: the console can hand off to its page. */}
          <Link className="nc-btn nc-btn--sm" href="/command/exec" onClick={() => setExecOpen(false)}>
            <IconSpark size={13} />
            {t("execDock.openPage")}
          </Link>
          <span className="nc-badge-mock">{t("execDock.noProvider")}</span>
          <button
            type="button"
            className="nc-context__collapse"
            onClick={() => {
              setExecOpen(false);
              notify(t("execDock.closeToast"));
            }}
            aria-label={t("execDock.closeAria")}
          >
            <IconChevronDown size={14} />
          </button>
        </header>

        <div className="nc-exec-surface__stream">
          {messages.map((message) => (
            <div key={message.id} className="nc-exec-surface__msg" data-role={message.role}>
              <div className="nc-exec-surface__who">
                {message.role === "executive" ? t("execDock.whoExec") : t("execDock.whoFounder")}
              </div>
              <div className="nc-exec-surface__bubble">{messageText(message, snapshot, t)}</div>
            </div>
          ))}
        </div>

        <div className="nc-exec-surface__intents" aria-label={t("execDock.intentsAria")}>
          {EXEC_INTENTS.map((intent) => (
            <button
              key={intent}
              type="button"
              className="nc-exec-surface__intent"
              onClick={() => send(t(intent))}
            >
              {t(intent)}
            </button>
          ))}
        </div>

        <form
          className="nc-exec-surface__compose"
          onSubmit={(event) => {
            event.preventDefault();
            send(input);
          }}
        >
          <span style={{ color: "var(--nc-lime)", display: "flex" }}>
            <IconSpark size={16} />
          </span>
          <input
            className="nc-exec-surface__input"
            value={input}
            onChange={(event) => setInput(event.target.value)}
            placeholder={t("execDock.placeholder")}
            aria-label={t("execDock.inputAria")}
            autoComplete="off"
          />
          <button type="submit" className="nc-btn nc-btn--sm nc-btn--lime" disabled={!input.trim()}>
            {t("execDock.send")}
          </button>
        </form>
      </section>
    </>
  );
}
