"use client";

import { useEffect, useRef, useState } from "react";
import { useCommand } from "./state/command-store";
import { FOUNDER } from "./state/organization-model";
import { EXEC_INTENTS, executiveGreeting, executiveReply } from "./state/mock-intent";
import { IconChevronDown, IconSpark } from "./ui/icons";

/**
 * Executive presence.
 *
 * The Executive is conceptually accessible from everywhere, so its control is
 * persistent and visual — a living orb with a voice waveform, sitting at the
 * centre of the bottom dock, not a chat bubble in the corner. Opening it raises
 * a command surface that reads like an operating console.
 *
 * There is no AI provider in this phase. Replies are produced locally by
 * `mock-intent.ts` and every reply says so out loud.
 */
export function ExecutiveDockOrb() {
  const { execOpen, setExecOpen } = useCommand();

  return (
    <div className="nc-dock__exec-wrap">
      <button
        type="button"
        className="nc-dock__exec"
        data-open={execOpen}
        onClick={() => setExecOpen(!execOpen)}
        aria-expanded={execOpen}
        aria-label="Talk to Executive"
      >
        <span className="nc-dock__wave" aria-hidden="true">
          <i />
          <i />
          <i />
          <i />
          <i />
        </span>
      </button>
      <span className="nc-dock__exec-label">
        <b>Talk to Executive...</b>
        <span>{execOpen ? "⌘K to close" : "⌘K · nothing runs without you"}</span>
      </span>
    </div>
  );
}

type Message = { id: number; role: "human" | "executive"; text: string };

/**
 * The raised console.
 *
 * Mounted by the shell only while it is open, and keyed by the demo revision —
 * so the opening line is initialised once, lazily, instead of being pushed into
 * state from an effect, and switching demo states starts a clean exchange.
 */
export function ExecutiveSurface() {
  const { setExecOpen, snapshot, notify } = useCommand();
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<Message[]>(() => [
    { id: 0, role: "executive", text: executiveGreeting(snapshot) },
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
        { id: nextId.current++, role: "executive", text: executiveReply(trimmed, snapshot) },
      ]);
    }, 520);
  };

  return (
    <>
      <div className="nc-exec-surface__scrim" onClick={() => setExecOpen(false)} aria-hidden="true" />

      <section className="nc-exec-surface" aria-label="Executive command surface">
        <header className="nc-exec-surface__head">
          <span className="nc-avatar" style={{ width: 24, height: 24, fontSize: 10 }} aria-hidden="true">
            {FOUNDER.initials}
          </span>
          <span>
            <span className="nc-exec-surface__title" style={{ display: "block" }}>
              Executive
            </span>
            <span className="nc-exec-surface__kicker">{snapshot.scenario.replace(/-/g, " ")}</span>
          </span>
          <span style={{ flex: 1 }} />
          <span className="nc-badge-mock">no AI provider</span>
          <button
            type="button"
            className="nc-context__collapse"
            onClick={() => {
              setExecOpen(false);
              notify("Executive console closed — it is a mocked console in UI-01.");
            }}
            aria-label="Close Executive surface"
          >
            <IconChevronDown size={14} />
          </button>
        </header>

        <div className="nc-exec-surface__stream">
          {messages.map((message) => (
            <div key={message.id} className="nc-exec-surface__msg" data-role={message.role}>
              <div className="nc-exec-surface__who">
                {message.role === "executive" ? "Executive" : "Saeed · Human Authority"}
              </div>
              <div className="nc-exec-surface__bubble">{message.text}</div>
            </div>
          ))}
        </div>

        <div className="nc-exec-surface__intents">
          {EXEC_INTENTS.map((intent) => (
            <button key={intent} type="button" className="nc-exec-surface__intent" onClick={() => send(intent)}>
              {intent}
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
            placeholder="Direct the Executive..."
            aria-label="Direct the Executive"
            autoComplete="off"
          />
          <button type="submit" className="nc-btn nc-btn--sm nc-btn--lime" disabled={!input.trim()}>
            Send
          </button>
        </form>
      </section>
    </>
  );
}
