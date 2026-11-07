"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useLocale } from "@/components/command/i18n/command-locale";
import { LabData, LabFrame, Note, Pill, Section, tone } from "@/components/command/lab/kit";
import { useCommandData } from "@/components/command/state/demo/command-data-store";
import {
  AGENT_STATUS_META,
  RISK_META,
  decisionQueue,
  liveMissions,
} from "@/components/command/state/demo/selectors";
import type { CommandDataset, ExecTurn } from "@/components/command/state/demo/types";
import { IconSend, IconSpark } from "@/components/command/ui/icons";

/**
 * TALK TO EXEC — the executive conversation surface
 * ────────────────────────────────────────────────
 * The product version of "talk to my executive": a real conversation thread with
 * context cards the executive attaches to its own answer, suggested actions that
 * actually navigate, and an escalation card when something needs a human.
 *
 * THE EXECUTIVE IS NOT A MODEL HERE. Replies are selected deterministically from
 * the organization's own state by the demo adapter, which is why they can be
 * trusted to describe the prototype accurately. No provider is called, no tokens
 * are spent, and the surface says so under the composer.
 *
 * PASS 2 — THE SUGGESTED PROMPTS ARE TRANSLATED BUT NOT REWRITTEN. The adapter
 * matches a question against its own English key, so the chip SHOWS the Arabic
 * and SENDS the English source. Translating what is sent would silently turn
 * every suggestion into the fallback answer.
 */

const PROMPTS = [
  "What needs me today?",
  "Why is vendor consolidation blocked?",
  "Which agents are overloaded?",
  "What are the agents running on?",
  "What systems are missing?",
];

export default function TalkPage() {
  const { tc } = useLocale();
  return (
    <LabFrame areaId="talk">
      <LabData
        emptyTitle={tc("Nothing to talk about yet")}
        emptyBody={tc("The executive reads the organization's own state. With no work, there is nothing to read.")}
      >
        {(dataset) => <Talk dataset={dataset} />}
      </LabData>
    </LabFrame>
  );
}

function Talk({ dataset }: { dataset: CommandDataset }) {
  const { t, tc } = useLocale();
  const { sendToExec, execThinking, resetConversation } = useCommandData();
  const [input, setInput] = useState("");
  const threadRef = useRef<HTMLDivElement | null>(null);

  const turns = dataset.exec.turns;
  const queue = decisionQueue(dataset);
  const live = liveMissions(dataset);

  /* Keep the newest turn in view, including the composing state. */
  useEffect(() => {
    const node = threadRef.current;
    if (node) node.scrollTop = node.scrollHeight;
  }, [turns.length, execThinking]);

  const submit = (text: string) => {
    if (!text.trim()) return;
    sendToExec(text);
    setInput("");
  };

  return (
    <>
      <div className="nl-talk">
        <section className="nl-conv" aria-label={t("talk.contextAria")}>
          <header className="nl-conv__head">
            <span className="nl-conv__sigil" aria-hidden="true">
              <IconSpark size={17} />
            </span>
            <span className="nl-conv__who">
              <span className="nl-conv__name">{tc("Right-Hand Executive")}</span>
              <span className="nl-conv__state">
                {t("talk.reading", { live: live.length, queue: queue.length })}
              </span>
            </span>
            <Pill label={t("talk.local")} tone="--nc-lime" />
            <button type="button" className="nl-btn" data-variant="quiet" onClick={resetConversation}>
              {t("common.reset")}
            </button>
          </header>

          <div className="nl-conv__thread" ref={threadRef} aria-live="polite">
            {turns.map((turn) => (
              <Turn key={turn.id} turn={turn} />
            ))}

            {execThinking && (
              <div className="nl-turn" data-from="exec">
                <span className="nl-conv__typing" aria-label={t("talk.composingAria")}>
                  <i />
                  <i />
                  <i />
                </span>
              </div>
            )}
          </div>

          <div className="nl-conv__compose">
            <div className="nl-conv__suggest">
              {PROMPTS.map((prompt) => (
                <button key={prompt} type="button" className="nl-chip" onClick={() => submit(prompt)}>
                  {tc(prompt)}
                </button>
              ))}
            </div>
            <div className="nl-compose__row">
              <textarea
                className="nl-conv__input"
                value={input}
                placeholder={tc("Ask the organization anything — what needs you, why something is stuck, who is loaded…")}
                onChange={(event) => setInput(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault();
                    submit(input);
                  }
                }}
                aria-label={t("talk.inputAria")}
              />
              <button
                type="button"
                className="nl-btn"
                data-variant="primary"
                onClick={() => submit(input)}
                disabled={!input.trim() || execThinking}
              >
                <IconSend size={15} />
                {t("common.send")}
              </button>
            </div>
            <Note>
              {tc(
                "No model is called. Replies are selected from this prototype's own state by the demo adapter, so nothing here leaves the machine and nothing is executed.",
              )}
            </Note>
          </div>
        </section>

        <aside className="nl-talk__aside">
          <Section title={t("talk.contextTitle")} span={12}>
            <div className="nl-ctx">
              <CtxCard
                label={t("common.missions")}
                value={String(live.length)}
                note={t("talk.heldNote", {
                  count: dataset.missions.filter((m) => m.status === "blocked" || m.status === "waiting").length,
                })}
                tone="--nc-growth"
              />
              <CtxCard
                label={t("talk.decisions")}
                value={String(queue.length)}
                note={t("talk.waitingOnYou")}
                tone="--nc-approval"
              />
              <CtxCard
                label={t("shell.rail.workforce")}
                value={String(dataset.agents.length)}
                note={t("talk.identitiesOnline")}
                tone="--nc-product"
              />
              <CtxCard
                label={t("shell.rail.systems")}
                value={String(dataset.systems.length)}
                note={t("talk.notUsable", { count: dataset.systems.filter((s) => s.state !== "CONNECTED").length })}
                tone="--nc-cyan"
              />
            </div>
          </Section>

          <Section
            title={t("talk.escalationsTitle")}
            count={queue.length}
            span={12}
            hint={t("talk.escalationsHint")}
          >
            <div className="nl-rows">
              {queue.slice(0, 4).map((decision) => {
                const meta = RISK_META[decision.risk];
                return (
                  <Link key={decision.id} href="/command/decisions" className="nl-line" style={tone(meta.tone)}>
                    <span className="nl-line__stack">
                      <span className="nl-line__title">{tc(decision.title)}</span>
                      <span className="nl-line__meta">{tc(decision.requestedBy)}</span>
                    </span>
                    <span className="nl-line__load">{t(`status.risk.${decision.risk}`)}</span>
                  </Link>
                );
              })}
              {queue.length === 0 && <Note>{tc("Nothing is waiting on your authority.")}</Note>}
            </div>
          </Section>

          <Section title={t("talk.routesTitle")} span={12}>
            <div className="nl-rows">
              {dataset.agents
                .filter((a) => a.tier === "director")
                .slice(0, 5)
                .map((agent) => {
                  const meta = AGENT_STATUS_META[agent.status];
                  return (
                    <div key={agent.id} className="nl-line" style={tone(meta.tone)}>
                      <span className="nl-line__stack">
                        <span className="nl-line__title">{agent.name}</span>
                        <span className="nl-line__meta">{tc(agent.currentFocus)}</span>
                      </span>
                      <Pill label={t(`status.agent.${agent.status}`)} tone={meta.tone} />
                    </div>
                  );
                })}
            </div>
          </Section>

          <Section title={t("talk.honestTitle")} span={12}>
            <Note>
              {tc(
                "A local reply engine reads the dataset and answers from it. There is no language model, no tool call and no memory store behind this panel — which is precisely why it can be used to review the prototype without inventing behaviour it does not have.",
              )}
            </Note>
          </Section>
        </aside>
      </div>
    </>
  );
}

function Turn({ turn }: { turn: ExecTurn }) {
  const { t, tc } = useLocale();
  const kindTone =
    turn.kind === "escalation" ? "--nc-approval" : turn.from === "founder" ? "--nc-human" : "--nc-lime";

  return (
    <div className="nl-turn" data-from={turn.from} data-kind={turn.kind} style={tone(kindTone)}>
      <span className="nl-turn__bubble">{tc(turn.text)}</span>

      {turn.cards.length > 0 && (
        <div className="nl-turn__cards">
          {turn.cards.map((card) => (
            <div key={card.id} className="nl-turn__card" style={tone(cardTone(card.tone))}>
              <span className="nl-turn__card-value">{card.value}</span>
              <span className="nl-turn__card-label">{tc(card.label)}</span>
              <span className="nl-turn__card-note">{tc(card.note)}</span>
            </div>
          ))}
        </div>
      )}

      {turn.actions.length > 0 && (
        <div className="nl-turn__actions">
          {turn.actions.map((action) =>
            action.href ? (
              <Link key={action.id} href={action.href} className="nl-btn" data-variant="ghost">
                {tc(action.label)}
              </Link>
            ) : (
              <Asker key={action.id} action={action} />
            ),
          )}
        </div>
      )}

      <span className="nl-turn__at">
        {turn.from === "founder" ? t("talk.you") : "EXEC"} · {tc(turn.at)}
      </span>
    </div>
  );
}

/** An `ask` action sends its prompt back into the conversation. */
function Asker({ action }: { action: ExecTurn["actions"][number] }) {
  const { tc } = useLocale();
  const { sendToExec } = useCommandData();
  return (
    <button
      type="button"
      className="nl-btn"
      data-variant="ghost"
      onClick={() => sendToExec(action.prompt ?? action.label)}
    >
      {tc(action.label)}
    </button>
  );
}

function cardTone(tone: "neutral" | "intelligence" | "attention" | "positive") {
  return tone === "attention"
    ? "--nc-approval"
    : tone === "positive"
      ? "--nc-completed"
      : tone === "intelligence"
        ? "--nc-lime"
        : "--nc-network";
}

function CtxCard({ label, value, note, tone: token }: { label: string; value: string; note: string; tone: string }) {
  return (
    <div className="nl-turn__card" style={tone(token)}>
      <span className="nl-turn__card-value">{value}</span>
      <span className="nl-turn__card-label">{label}</span>
      <span className="nl-turn__card-note">{note}</span>
    </div>
  );
}
