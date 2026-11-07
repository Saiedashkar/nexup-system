"use client";

/** NEXUP COMMAND — EXEC EXPERIENCE
 * ───────────────────────────────
 * ROUTE: `/command/exec`
 *
 * EXEC's own room: the head, one place to write, and the conversation. Everything
 * that is *read* rather than *acted on* moved one level down (the execution
 * summary, the ONE panel) or out of the experience entirely (the review tools at
 * `/command/exec/lab`), because the earlier version lost the conversation inside
 * its own machinery.
 *
 * THE FOUR RULES THIS FILE HOLDS:
 *
 *   1. ONE PAGE, TWO MODES. Before anything is said, the screen holds the head,
 *      the question and the composer. After the first message it is a single
 *      column of readable text — no right rail, no card wall. Either way the
 *      page is exactly one window tall: the header is fixed, the thread scrolls
 *      inside itself, and the composer does not move.
 *
 *   2. THE SHELL STANDS DOWN, AND ONLY HERE. This page is the only route whose
 *      stylesheet is loaded, and every shell rule that changes anything is scoped
 *      under `:has(.nce)` in `exec-lab.css`. No file another track owns is
 *      touched, and the moment this surface unmounts the shell is exactly as it
 *      was on every other page.
 *
 *   3. NO WORK HAPPENS BY ITSELF. Explicit demo scripts still advance only by
 *      click. Free conversation uses the isolated exec-conversation/v1 dummy
 *      connector: one message in, one test reply out, with no model, tool,
 *      mission, transcript persistence or hidden fallback to the demo engine.
 *
 *   4. THE NAVIGATION IS THE ROOM'S OWN. The shell's rail belongs to the shared
 *      Command chrome and lists the six areas; EXEC needs EXEC, Sessions, Tools,
 *      the recent sessions and New session. That rail is built in `exec-nav.tsx`,
 *      the shell's stands down under the SAME route-only `:has(.nce[data-mode])`
 *      scope the earlier pass used, and a narrow window gets the reference's
 *      three-tab bar instead of a 64px spine.
 *
 *   5. NOTHING IS LOST QUIETLY. The draft is kept per conversation, staged
 *      attachments travel with it, and the two changes that DO clear something —
 *      leaving the context, and opening another conversation — say so on the
 *      page, in the notice line under the header, before anything disappears
 *      from view.
 *
 * The head is the approved art, cut from the ICON mark on the character board.
 * A true layered head (face screen and eyes separate, for eye movement) does not
 * exist yet; see §5 and §11 of the lab doc for what the character needs next.
 */

import Image from "next/image";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";

import {
  otherEffectsLevel,
  setEffectsPreference,
  useEffectsPreference,
} from "./effects-preference";

import {
  Composer,
  HeaderIdentity,
  HeaderMenu,
  NoticeBar,
  ScopeMenu,
  ScrollToNewest,
  SidePanel,
  useEscapeClosesDisclosures,
  type Notice,
  type PanelKind,
  type PanelTarget,
} from "./chrome";
import { ExecRail, ExecTabBar, type NavTarget } from "./exec-nav";
import { EXEC_STATUS_META } from "./catalog";
import { postExecTurn } from "./exec-conversation-client";
import {
  ExecTurnGate,
  beginExecConversationTurn,
  finishExecConversationTurn,
} from "./exec-conversation-state";
import {
  choose,
  choiceIsApproval,
  choicesFor,
  createExperience,
  newConversation,
  openConversation,
  removeAttachment,
  resetRun,
  scriptedScenarioFor,
  setConversation,
  setLocale,
  setScope,
  startScenario,
  stoppableChoice,
  addDemoAttachment,
} from "./engine";
import { DEFAULT_LOCALE, FOUNDER_NAME, dirOf, formatNumber, t, type Locale } from "./i18n";
import { clearRequestedScenario, peekRequestedScenario } from "./review-handoff";
import { getScenario } from "./scenarios";
import { ExecutionSummary, MessageView, RunStateLine } from "./thread";
import type { ExperienceState, Message, MessageKey, RunState, ScenarioId } from "./types";

/* The two light suggestions on the empty screen. Each is the founder's own
   sentence — clicking one sends exactly what it says, verbatim, and the demo
   answers it honestly instead of pretending to work. */
const EMPTY_SUGGESTIONS = ["empty.suggest.review", "empty.suggest.plan"] as const;

/* The scripted run this round is built around: EXEC alone, brief → plan →
   delegation → review → a caught claim → correction → verified result, with no
   publishing. It gets a chip of its own because it is the demo, and the chip says
   it is a script rather than dressing up as a live conversation. */
const ROUND_SCRIPT: ScenarioId = "content_week";

const HEAD_SRC = "/exec-lab/exec-head.png";

/* How long the panel stays mounted on its way out. Short, and the same number the
   stylesheet's exit animation uses, because a mismatch here is a panel that
   vanishes mid-slide. */
const PANEL_EXIT_MS = 180;

export function ExecExperience() {
  const [state, setState] = useState<ExperienceState>(() => {
    const base = createExperience(DEFAULT_LOCALE);
    const requested = peekRequestedScenario();
    return requested ? startScenario(base, requested) : base;
  });
  const [draft, setDraft] = useState("");
  const [navCollapsed, setNavCollapsed] = useState(false);
  const [panel, setPanel] = useState<PanelKind | null>(null);
  const [panelClosing, setPanelClosing] = useState(false);
  const [panelTarget, setPanelTarget] = useState<PanelTarget>("activity");
  const [workView, setWorkView] = useState<{ id: string; view: "band" | "inline" } | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [atBottom, setAtBottom] = useState(true);
  const effects = useEffectsPreference();

  const drafts = useRef<Record<string, string>>({});
  const noticeSeq = useRef(0);
  const scroller = useRef<HTMLDivElement | null>(null);
  const turnGate = useRef(new ExecTurnGate());
  const panelExitTimer = useRef<number | null>(null);
  const [turnPending, setTurnPending] = useState(false);

  const say = useCallback((keys: MessageKey[]) => {
    noticeSeq.current += 1;
    setNotice({ id: noticeSeq.current, keys });
  }, []);


  const { locale, run } = state;
  const dir = dirOf(locale);
  const status = run ? run.execStatus : "available";
  const meta = EXEC_STATUS_META[status];

  const isTaskThread = state.conversation === "task";
  const thread: Message[] = isTaskThread ? run?.messages ?? [] : state.general;
  const choices = choicesFor(state);
  const approvalChoices = choices.filter(choiceIsApproval);
  const stopChoice = stoppableChoice(state);
  const chips = choices.filter((choice) => !choiceIsApproval(choice) && choice.kind !== "cancel");
  const empty = thread.length === 0 && run === null;
  const switchable = run !== null && state.general.length > 0;

  useEffect(() => {
    clearRequestedScenario();
  }, []);

  const cancelPendingTurn = useCallback(() => {
    turnGate.current.cancel();
    setTurnPending(false);
  }, []);

  useEffect(() => cancelPendingTurn, [cancelPendingTurn]);

  const toggleEffects = useCallback(() => {
    setEffectsPreference(otherEffectsLevel(effects));
    say(["notice.effects"]);
  }, [effects, say]);

  useEffect(() => {
    const node = scroller.current;
    if (!node || !atBottom) return;
    node.scrollTop = node.scrollHeight;
  }, [thread.length, isTaskThread, run?.beatIndex, atBottom]);

  const onScroll = () => {
    const node = scroller.current;
    if (!node) return;
    setAtBottom(node.scrollHeight - node.scrollTop - node.clientHeight < 48);
  };

  const goToNewest = useCallback(() => {
    const node = scroller.current;
    if (node) node.scrollTop = node.scrollHeight;
    setAtBottom(true);
  }, []);

  const closePanel = useCallback(() => {
    if (panelExitTimer.current !== null) window.clearTimeout(panelExitTimer.current);
    setPanelClosing(true);
    panelExitTimer.current = window.setTimeout(() => {
      setPanel(null);
      setPanelClosing(false);
      setPanelTarget("activity");
      panelExitTimer.current = null;
    }, PANEL_EXIT_MS);
  }, []);

  const cancelPanelExit = useCallback(() => {
    if (panelExitTimer.current !== null) {
      window.clearTimeout(panelExitTimer.current);
      panelExitTimer.current = null;
    }
    setPanelClosing(false);
  }, []);

  useEffect(() => () => {
    if (panelExitTimer.current !== null) window.clearTimeout(panelExitTimer.current);
  }, []);

  const togglePanel = useCallback(
    (kind: PanelKind) => {
      if (panel === kind) {
        closePanel();
        return;
      }
      cancelPanelExit();
      setPanel(kind);
      setPanelTarget(kind === "workspace" ? "activity" : panelTarget);
    },
    [panel, panelTarget, closePanel, cancelPanelExit],
  );

  const openOutput = useCallback(() => {
    cancelPanelExit();
    setPanel("workspace");
    setPanelTarget("outputs");
  }, [cancelPanelExit]);

  const workOpen = workView !== null && workView.id === state.activeId;
  const inlineOpen = workOpen && workView?.view === "inline";

  const openWork = useCallback(
    (view: "inline" | null) => {
      setWorkView(view ? { id: state.activeId, view } : null);
      if (view !== "inline") return;
      window.setTimeout(() => {
        document.getElementById("nce-plan")?.scrollIntoView({ block: "nearest" });
      }, 0);
    },
    [state.activeId],
  );

  const toggleLive = useCallback(() => {
    if (panel === "workspace") closePanel();
    else {
      cancelPanelExit();
      setPanel("workspace");
      setPanelTarget("activity");
    }
  }, [panel, closePanel, cancelPanelExit]);

  useEscapeClosesDisclosures(panel ? closePanel : null);

  const navTarget: NavTarget =
    panel === "history"
      ? "sessions"
      : panel === "plugins"
        ? "plugins"
        : panel === "workspace"
          ? "workspace"
          : "chat";

  const selectNav = useCallback(
    (target: NavTarget) => {
      if (target === "chat") {
        closePanel();
        return;
      }
      if (target === "sessions") {
        togglePanel("history");
        return;
      }
      if (target === "plugins") {
        togglePanel("plugins");
        return;
      }
      if (panel === "workspace") {
        closePanel();
        return;
      }
      cancelPanelExit();
      setPanel("workspace");
      setPanelTarget("activity");
    },
    [closePanel, togglePanel, panel, cancelPanelExit],
  );

  const commit = (next: ExperienceState, keys: MessageKey[] = []) => {
    drafts.current[state.activeId] = draft;
    const restored = next.activeId === state.activeId ? draft : drafts.current[next.activeId] ?? "";
    setDraft(restored);
    setState(next);
    setAtBottom(true);
    if (keys.length > 0) say(keys);
  };

  const act = (next: ExperienceState) => setState(next);

  const send = async (text?: string) => {
    const value = (text ?? draft).trim();
    if (!value) return;
    const scenarioId = scriptedScenarioFor(value);
    if (scenarioId !== null && state.run !== null) {
      say(["notice.scriptBusy"]);
      return;
    }
    if (scenarioId !== null) {
      setState((current) => startScenario(current, scenarioId));
      drafts.current[state.activeId] = "";
      setDraft("");
      setAtBottom(true);
      say(["notice.script"]);
      return;
    }

    const turnId = `turn-${crypto.randomUUID()}`;
    const conversationId = state.activeId;
    const pending = turnGate.current.start(turnId, conversationId);
    if (!pending) return;

    const at = new Intl.DateTimeFormat(locale === "ar" ? "ar-EG-u-nu-latn" : "en-US", {
      hour: "numeric",
      minute: "2-digit",
    }).format(new Date());
    setTurnPending(true);
    setState((current) =>
      current.activeId === conversationId
        ? beginExecConversationTurn(current, { turnId, message: value, at })
        : current,
    );
    drafts.current[state.activeId] = "";
    setDraft("");
    setAtBottom(true);

    const result = await postExecTurn(
      { turnId, message: value, conversationId },
      { signal: pending.signal },
    );
    if (!turnGate.current.settle(turnId, conversationId)) return;
    setTurnPending(false);
    const repliedAt = new Intl.DateTimeFormat(locale === "ar" ? "ar-EG-u-nu-latn" : "en-US", {
      hour: "numeric",
      minute: "2-digit",
    }).format(new Date());
    setState((current) =>
      finishExecConversationTurn(current, { turnId, conversationId, at: repliedAt, result }),
    );
  };

  const runScript = (id: ScenarioId) => {
    act(startScenario(state, id));
    say(["notice.script"]);
  };

  const changeScope = (id: string) => {
    const next = setScope(state, id);
    if (next === state) return;
    cancelPendingTurn();
    commit(next, ["notice.scopeCleared", ...(draft.trim() ? (["notice.draftKept"] as MessageKey[]) : [])]);
  };

  const startNew = () => {
    cancelPendingTurn();
    const keys: MessageKey[] = ["notice.parked"];
    if (draft.trim()) keys.push("notice.draftKept");
    if (state.attachments.length > 0) keys.push("notice.attachmentsKept");
    commit(newConversation(state), keys);
  };

  const reopen = (id: string) => {
    const next = openConversation(state, id);
    if (next === state) return;
    cancelPendingTurn();
    const keys: MessageKey[] = ["notice.parked"];
    if (draft.trim()) keys.push("notice.draftKept");
    commit(next, keys);
  };

  const lastGateMessageId = [...thread]
    .reverse()
    .find((message) => message.cards.some((card) => card.kind === "gate"))?.id;

  const colKey = `${state.activeId}:${state.conversation}:${run?.scenarioId ?? "none"}`;

  return (
    <div
      className="nce"
      dir={dir}
      lang={locale}
      data-locale={locale}
      data-status={status}
      data-mode={empty ? "empty" : "thread"}
      data-nav={navCollapsed ? "collapsed" : "expanded"}
      data-live={panel === "workspace" ? "on" : "off"}
      data-panel={panel ?? "none"}
      data-closing={panelClosing ? "true" : "false"}
      data-effects={effects}
    >
      <div className="nce-shell">
        <ExecRail
          locale={locale}
          state={state}
          avatarSrc={HEAD_SRC}
          collapsed={navCollapsed}
          active={navTarget}
          onToggleCollapsed={() => setNavCollapsed((current) => !current)}
          onSelect={selectNav}
          onNewSession={startNew}
          onOpenConversation={reopen}
          effects={effects}
          onToggleLocale={() => act(setLocale(state, locale === "ar" ? "en" : "ar"))}
          onToggleEffects={toggleEffects}
        />

        <div className="nce-main">
          <span className="nce-orbit" aria-hidden="true" />
          <header className="nce-top">
            <Link className="nce-top__back" href="/command">
              <span aria-hidden="true" className="nce-top__arrow">
                ←
              </span>
              <span className="nce-top__btn-label">{t(locale, "app.back")}</span>
            </Link>

            <HeaderIdentity tone={meta.tone} locale={locale} avatarSrc={HEAD_SRC} />

            {!empty && <ScopeMenu state={state} locale={locale} onScope={changeScope} />}

            {switchable && (
              <span className="nce-switch" role="group">
                <button
                  type="button"
                  className="nce-switch__item"
                  data-active={!isTaskThread}
                  onClick={() => {
                    cancelPendingTurn();
                    act(setConversation(state, "general"));
                  }}
                >
                  {t(locale, "conv.scope.general")}
                </button>
                <button
                  type="button"
                  className="nce-switch__item"
                  data-active={isTaskThread}
                  onClick={() => {
                    cancelPendingTurn();
                    act(setConversation(state, "task"));
                  }}
                >
                  {run ? t(locale, run.taskTitleKey) : t(locale, "conv.task")}
                </button>
              </span>
            )}

            <div className="nce-top__right">
              <button
                type="button"
                className="nce-livebtn"
                data-open={panel === "workspace" ? "true" : "false"}
                aria-expanded={panel === "workspace"}
                aria-label={t(locale, panel === "workspace" ? "live.close" : "live.open")}
                title={t(locale, panel === "workspace" ? "live.close" : "live.open")}
                data-tip={t(locale, "live.hint")}
                onClick={toggleLive}
              >
                <span className="nce-livebtn__glyph" aria-hidden="true">
                  ⑃
                </span>
                <span className="nce-livebtn__label">{t(locale, panel === "workspace" ? "live.close" : "live.open")}</span>
                <span className="nce-livebtn__dot" data-tone={meta.tone} aria-hidden="true" />
              </button>

              <HeaderMenu
                locale={locale}
                navCollapsed={navCollapsed}
                onToggleNav={() => setNavCollapsed((current) => !current)}
                onToggleLocale={() => act(setLocale(state, locale === "ar" ? "en" : "ar"))}
                effects={effects}
                onToggleEffects={toggleEffects}
                onNewConversation={startNew}
                canResetRun={run !== null}
                onResetRun={() => act(resetRun(state))}
                onStartScenario={runScript}
                runningId={run?.scenarioId ?? null}
                labsHref="/command/exec/lab"
                consoleHref="/command/exec/console"
              />
            </div>
          </header>

          {notice && (
            <div className="nce-noticewrap">
              <NoticeBar notice={notice} locale={locale} onDismiss={() => setNotice(null)} />
            </div>
          )}

          <div className="nce-body">
            <div className="nce-stage">
              {run && <TaskBar run={run} locale={locale} />}

              <div className="nce-scroll" ref={scroller} onScroll={onScroll}>
                {empty ? (
                  <div className="nce-hero">
                    <span className="nce-hero__head">
                      <ExactHead tone={meta.tone} locale={locale} />
                    </span>

                    <div className="nce-hero__copy">
                      <h1 className="nce-hero__line">{t(locale, "empty.greeting", { name: FOUNDER_NAME[locale] })}</h1>
                      <div className="nce-hero__suggest">
                        {EMPTY_SUGGESTIONS.map((key) => (
                          <button key={key} type="button" className="nce-suggest__chip" onClick={() => send(t(locale, key))}>
                            {t(locale, key)}
                          </button>
                        ))}

                        <button
                          type="button"
                          className="nce-suggest__chip"
                          data-script="true"
                          aria-label={t(locale, "empty.suggest.script", { name: t(locale, getScenario(ROUND_SCRIPT).labelKey) })}
                          onClick={() => runScript(ROUND_SCRIPT)}
                        >
                          <span aria-hidden="true" className="nce-suggest__mark">
                            ▶
                          </span>
                          {t(locale, "empty.suggest.script", { name: t(locale, getScenario(ROUND_SCRIPT).labelKey) })}
                        </button>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="nce-col nce-col--enter" key={colKey}>
                    {thread.map((message) => (
                      <MessageView
                        key={message.id}
                        message={message}
                        locale={locale}
                        approvalChoices={message.id === lastGateMessageId ? approvalChoices : []}
                        onChoose={(id) => act(choose(state, id))}
                        avatarSrc={HEAD_SRC}
                        onOpenOutput={run ? openOutput : undefined}
                      />
                    ))}

                    {run && (
                      <ExecutionSummary
                        run={run}
                        locale={locale}
                        open={inlineOpen}
                        onToggle={(next) => openWork(next ? "inline" : null)}
                      />
                    )}
                  </div>
                )}
              </div>

              <div className="nce-dock">
                {!atBottom && thread.length > 0 && <ScrollToNewest locale={locale} onClick={goToNewest} />}

                <div className="nce-col">
                  {run && <RunStateLine run={run} locale={locale} />}

                  <Composer
                    locale={locale}
                    draft={draft}
                    onDraft={setDraft}
                    onSend={() => send()}
                    pending={turnPending}
                    attachments={state.attachments}
                    onAttach={(fileKind, name) => act(addDemoAttachment(state, fileKind as "doc" | "image", { local: name !== undefined, name }))}
                    onRemoveAttachment={(id) => act(removeAttachment(state, id))}
                    variant={empty ? "hero" : "thread"}
                    choices={chips}
                    onChoose={(id) => act(choose(state, id))}
                    stopChoice={stopChoice}
                    onStop={(id) => act(choose(state, id))}
                    agentTone={meta.tone}
                    effects={effects}
                    avatarSrc={HEAD_SRC}
                  />

                  <div className="nce-dock__foot">
                    {empty && <ScopeMenu state={state} locale={locale} onScope={changeScope} />}
                    <span className="nce-tag" data-tone="off" title={t(locale, "app.demoNote")}>
                      {t(locale, "conversation.testBadge")}
                    </span>
                    <span className="nce-dock__note">
                      {t(locale, turnPending ? "conversation.pending" : "conversation.ephemeral")}
                    </span>
                  </div>
                </div>
              </div>
            </div>

            {panel && (
              <SidePanel
                kind={panel}
                state={state}
                locale={locale}
                target={panelTarget}
                closing={panelClosing}
                onClose={closePanel}
                onNewConversation={startNew}
                onOpenConversation={reopen}
                onTarget={setPanelTarget}
              />
            )}
          </div>

          <ExecTabBar locale={locale} active={navTarget} onSelect={selectNav} />
        </div>
      </div>
    </div>
  );
}

function TaskBar({ run, locale }: { run: RunState; locale: Locale }) {
  const meta = EXEC_STATUS_META[run.execStatus];
  const scenario = getScenario(run.scenarioId);
  const total = scenario.beats.length;
  const stage = Math.min(run.beatIndex + 1, total);

  return (
    <div className="nce-taskbar" data-tone={meta.tone}>
      <span className="nce-state" data-tone={meta.tone}>
        <i aria-hidden="true">{meta.glyph}</i>
        {t(locale, meta.labelKey)}
      </span>
      <span className="nce-taskbar__title" dir="auto">
        {t(locale, run.taskTitleKey)}
      </span>
      <span className="nce-taskbar__progress">
        {t(locale, "summary.progress", { done: formatNumber(locale, stage), total: formatNumber(locale, total) })}
      </span>
    </div>
  );
}

function ExactHead({ tone, locale, layers }: { tone: string; locale: Locale; layers?: ReactNode }) {
  return (
    <span className="nce-face" data-size="hero" data-tone={tone}>
      <Image
        className="nce-face__img"
        src={HEAD_SRC}
        alt={t(locale, "app.portraitAlt")}
        width={212}
        height={212}
        unoptimized
        priority
        loading="eager"
      />
      {layers}
    </span>
  );
}
