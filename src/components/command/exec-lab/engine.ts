/**
 * NEXUP COMMAND — EXEC EXPERIENCE · ENGINE
 * ───────────────────────────────────────
 * A pure reducer over the scenario scripts. Nothing here is a component, a
 * promise, a timer or a side effect: given the same state and the same action it
 * returns the same next state, which is what makes every claim on this surface
 * checkable in a test.
 *
 * Two invariants worth naming, because the brief requires both:
 *
 *   · LANGUAGE IS NOT RUN STATE. `run` contains no locale and no rendered
 *     sentence, so `setLocale` cannot lose the conversation or the task. A test
 *     asserts the run object is untouched by a language change.
 *
 *   · EXEC'S STATE ≠ THE TASK'S STATE. `execStatus` and `taskStatus` are
 *     separate fields, set separately on every beat. One step finishing never
 *     completes the task, and a cancelled task returns EXEC to `available`.
 */

import { DEFAULT_SCOPE, SCOPE_OPTIONS, scopeKey } from "./catalog";
import { DEFAULT_LOCALE, LOCALES, isLocale, t, type Locale } from "./i18n";
import { getScenario, SCENARIO_LIST } from "./scenarios";
import type {
  Beat,
  Card,
  Choice,
  DemoAttachment,
  ChoiceEffect,
  Emit,
  ExecStatusCode,
  ExperienceState,
  Message,
  MessageKey,
  ParkedConversation,
  PlanStep,
  RunState,
  ScenarioId,
  Scope,
  TaskStatus,
  TeamId,
  TimelineEntry,
} from "./types";

/* ═══════════════════════════════════════════════════════
   Initial state
   ═══════════════════════════════════════════════════════ */

export function createExperience(locale: Locale = DEFAULT_LOCALE): ExperienceState {
  return {
    locale,
    conversation: "general",
    scope: DEFAULT_SCOPE,
    general: [],
    run: null,
    attachments: [],
    conversations: [],
    activeId: conversationId(1),
    seq: 0,
  };
}

/** Demo ids: derived from a counter, never from a clock and never from `Math.random`. */
function conversationId(ordinal: number): string {
  return `c-${ordinal}`;
}

function emptyRun(scenarioId: ScenarioId): RunState {
  const scenario = getScenario(scenarioId);
  return {
    scenarioId,
    beatIndex: 0,
    ended: false,
    execStatus: "available",
    taskStatus: "planned",
    taskCode: scenario.code,
    taskTitleKey: scenario.taskTitleKey,
    showGraph: false,
    activeTeam: [],
    engagedTeam: [],
    messages: [],
    timeline: [],
    correctionRounds: 0,
    attempts: 0,
  };
}

/* ═══════════════════════════════════════════════════════
   Emit → state
   ═══════════════════════════════════════════════════════ */

/**
 * A deterministic demo-clock label. Never presented as a real timestamp.
 */
function demoClock(step: number): string {
  return `T+${step}`;
}

function appendEmit(run: RunState, emit: Emit): RunState {
  const step = run.messages.length + run.timeline.length;
  switch (emit.type) {
    case "founder":
      /* A person's own words are stored verbatim and are never translated. */
      return { ...run, messages: [...run.messages, mkMessage(run, { from: "founder", at: demoClock(step), text: emit.text })] };
    case "founder-script":
      return { ...run, messages: [...run.messages, mkMessage(run, { from: "founder", at: demoClock(step), key: emit.key })] };
    case "exec":
      return {
        ...run,
        messages: [
          ...run.messages,
          mkMessage(run, { from: "exec", at: demoClock(step), key: emit.key, cards: emit.cards ?? [] }),
        ],
      };
    case "event": {
      const entry: TimelineEntry = {
        id: `tl-${run.taskCode}-${run.timeline.length + 1}`,
        at: demoClock(step),
        kind: emit.kind,
        key: emit.key,
        causedByUser: emit.causedByUser === true,
      };
      return { ...run, timeline: [...run.timeline, entry] };
    }
    default:
      return run;
  }
}

type MessageDraft = {
  from: Message["from"];
  at: string;
  key?: Message["key"];
  text?: string;
  cards?: Card[];
};

/**
 * IDs are DERIVED from position, never from a module counter: a counter would
 * produce different ids on the server and the client and break hydration, and
 * would make a re-run of the same demo unreproducible.
 */
function mkMessage(run: RunState, draft: MessageDraft): Message {
  const message: Message = {
    id: `m-${run.taskCode}-${run.messages.length + 1}`,
    from: draft.from,
    at: draft.at,
    cards: draft.cards ?? [],
  };
  if (draft.key !== undefined) message.key = draft.key;
  if (draft.text !== undefined) message.text = draft.text;
  return message;
}

/** Applies a beat's emits and then its declared states. */
function enterBeat(run: RunState, beat: Beat, beatIndex: number): RunState {
  const reduced = beat.emit.reduce((acc, emit) => appendEmit(acc, emit), run);

  const engaged = new Set<TeamId>(reduced.engagedTeam);
  for (const member of beat.activeTeam ?? []) engaged.add(member);

  const next: RunState = {
    ...reduced,
    beatIndex,
    execStatus: beat.status,
    taskStatus: beat.task,
    showGraph: beat.showGraph === true,
    activeTeam: beat.activeTeam ?? [],
    engagedTeam: [...engaged],
    messages: reduced.messages.map((message) => ({ ...message, cards: [...message.cards] })),
  };

  if (beat.reasonKey !== undefined) next.reasonKey = beat.reasonKey;
  else delete next.reasonKey;

  return next;
}

/* ═══════════════════════════════════════════════════════
   Actions
   ═══════════════════════════════════════════════════════ */

/** Starts a scenario. Always from a clean run: a demo must be reproducible. */
export function startScenario(state: ExperienceState, scenarioId: ScenarioId): ExperienceState {
  const scenario = getScenario(scenarioId);
  let run = emptyRun(scenarioId);

  if (scenario.opener) run = appendEmit(run, scenario.opener);
  run = enterBeat(run, scenario.beats[0], 0);
  if (scenario.beats[0].choices.length === 0) run = { ...run, ended: true };

  return {
    ...state,
    run,
    conversation: "task",
    /* Starting a run adopts that scenario's scope, so the context shown always
       matches the work on screen. */
    scope: scenario.scope,
  };
}

/** Clears the run without touching the language, the scope or the conversation. */
export function resetRun(state: ExperienceState): ExperienceState {
  return { ...state, run: null, conversation: "general" };
}

export function setLocale(state: ExperienceState, locale: Locale): ExperienceState {
  if (!isLocale(locale)) return state;
  /* ONLY the locale changes. `run` is returned by reference on purpose, so a
     language switch is provably incapable of losing the conversation or task. */
  return { ...state, locale };
}

export function setConversation(state: ExperienceState, conversation: ExperienceState["conversation"]): ExperienceState {
  return { ...state, conversation };
}

/**
 * Switches context — and crosses out of the previous one cleanly.
 *
 * Re-selecting the context you are already in changes nothing. Moving to a
 * DIFFERENT context (another company, client or project) drops ALL of the
 * previous context's state: the open task, the conversation, and any staged
 * composer attachment. Carrying any of it across would show one client's work,
 * words or files inside another client's scope — the one thing client isolation
 * must never allow, and the reason this is a property of the reducer rather
 * than a rule someone has to remember to follow in the UI.
 */
export function setScope(state: ExperienceState, scopeId: string): ExperienceState {
  const option = SCOPE_OPTIONS.find((candidate) => candidate.id === scopeId);
  if (!option) return state;
  if (scopeKey(option.scope) === scopeKey(state.scope)) return state;

  return {
    ...state,
    scope: option.scope,
    run: null,
    conversation: "general",
    general: [],
    attachments: [],
    /* The parked conversations go with it. They are still one client's words and
       one client's work, so leaving the context must not leave them readable
       behind a history button. The UI explains the loss BEFORE the click (see
       `scope.isolated` in the context menu) rather than erasing it quietly. */
    conversations: [],
  };
}

/* ── Conversation history ───────────────────────────────────────────────── */

/** Run lines + general lines: what the history row reports for a conversation. */
export function linesOf(run: RunState | null, general: Message[]): number {
  return (run?.messages.length ?? 0) + general.length;
}

/** True when the open conversation holds anything worth parking. */
export function conversationHasContent(state: ExperienceState): boolean {
  return state.run !== null || state.general.length > 0;
}

/** The open conversation, copied out. `null` when there is nothing to park. */
export function parkActive(state: ExperienceState): ParkedConversation | null {
  if (!conversationHasContent(state)) return null;
  return {
    id: state.activeId,
    code: state.run?.taskCode ?? state.activeId,
    scope: state.scope,
    conversation: state.conversation,
    taskTitleKey: state.run?.taskTitleKey ?? null,
    general: state.general,
    run: state.run,
    lines: linesOf(state.run, state.general),
    seq: state.seq,
  };
}

/**
 * Starts a fresh conversation, PARKING the open one rather than deleting it.
 *
 * The brief's rule — a conversation change may not erase a draft or an active
 * run without explanation — is why this never drops anything: the parked
 * conversation keeps its run, its transcript and its context, and the surface
 * says where it went. The draft is kept by the composer, which owns it.
 */
export function newConversation(state: ExperienceState): ExperienceState {
  const parked = parkActive(state);
  const seq = state.seq + 1;
  return {
    ...state,
    conversation: "general",
    general: [],
    run: null,
    /* A staged attachment is aimed at the next thing written, not at the
       conversation it was picked in, so it travels with the reviewer. The
       composer's draft travels the same way, and neither is dropped. */
    conversations: parked ? [...state.conversations, parked] : state.conversations,
    activeId: conversationId(seq + 1),
    seq,
  };
}

/**
 * Opens a parked conversation, parking the open one in its place. Returns the
 * state unchanged for an unknown id, so a stale row can never blank the screen.
 */
export function openConversation(state: ExperienceState, id: string): ExperienceState {
  if (id === state.activeId) return state;
  const target = state.conversations.find((candidate) => candidate.id === id);
  if (!target) return state;

  const parked = parkActive(state);
  const rest = state.conversations.filter((candidate) => candidate.id !== id);

  return {
    ...state,
    activeId: target.id,
    scope: target.scope,
    conversation: target.conversation,
    general: target.general,
    run: target.run,
    conversations: parked ? [...rest, parked] : rest,
  };
}

/**
 * One row in the history list. The open conversation is synthesised from the
 * live state rather than copied into the list, so the two can never disagree.
 */
export type ConversationRow = {
  id: string;
  code: string;
  /** Provider-side label: the parked task's title, or the general tab. */
  titleKey: MessageKey | null;
  taskCode: string | null;
  conversation: "general" | "task";
  lines: number;
  isOpen: boolean;
  /** The run's own EXEC state, when it has one — for the row's tone and glyph. */
  execStatus: ExecStatusCode | null;
  /** True when the run was left unfinished, so the row can say so. */
  hasRun: boolean;
};

export function conversationRows(state: ExperienceState): ConversationRow[] {
  const open: ConversationRow = {
    id: state.activeId,
    code: state.run?.taskCode ?? state.activeId,
    titleKey: state.run?.taskTitleKey ?? null,
    taskCode: state.run?.taskCode ?? null,
    conversation: state.conversation,
    lines: linesOf(state.run, state.general),
    isOpen: true,
    execStatus: state.run?.execStatus ?? null,
    hasRun: state.run !== null,
  };

  const parked = state.conversations
    .slice()
    .sort((a, b) => b.seq - a.seq)
    .map<ConversationRow>((record) => ({
      id: record.id,
      code: record.code,
      titleKey: record.taskTitleKey,
      taskCode: record.run?.taskCode ?? null,
      conversation: record.conversation,
      lines: record.lines,
      isOpen: false,
      execStatus: record.run?.execStatus ?? null,
      hasRun: record.run !== null,
    }));

  return [open, ...parked];
}

/** Human-facing session name. Technical ids remain optional secondary metadata. */
export function conversationRowTitle(row: ConversationRow, locale: Locale): string {
  return row.titleKey ? t(locale, row.titleKey) : t(locale, "nav.untitledSession");
}

/** Local, in-memory filtering only. Nothing is persisted or sent to the server. */
export function filterConversationRows(
  rows: ConversationRow[],
  query: string,
  locale: Locale,
): ConversationRow[] {
  const needle = query.trim().toLocaleLowerCase(locale === "ar" ? "ar" : "en");
  if (!needle) return rows;
  return rows.filter((row) =>
    `${conversationRowTitle(row, locale)} ${row.code} ${row.taskCode ?? ""}`
      .toLocaleLowerCase(locale === "ar" ? "ar" : "en")
      .includes(needle),
  );
}

export function currentScopeOptionId(scope: Scope): string | undefined {
  return SCOPE_OPTIONS.find((option) => scopeKey(option.scope) === scopeKey(scope))?.id;
}

/* ── Attachments (demo only) ────────────────────────────────────────────── */

export function addDemoAttachment(
  state: ExperienceState,
  fileKind: "image" | "doc",
  options: { local?: boolean; name?: string } = {},
): ExperienceState {
  const next = state.attachments.length + 1;
  const nameKey = fileKind === "image" ? "conv.attachment.imageName" : "conv.attachment.docName";
  /* `name` is the reviewer's own file name and is stored as LITERAL TEXT, the way
     the founder's own sentence is — never translated and never a path. The demo
     still reads nothing: no bytes, no directory and no content leave the picker. */
  const attachment: DemoAttachment = { id: `demo-att-${next}`, nameKey, fileKind, demo: true, local: options.local === true };
  if (options.name) attachment.name = options.name;
  return { ...state, attachments: [...state.attachments, attachment] };
}

export function removeAttachment(state: ExperienceState, id: string): ExperienceState {
  return { ...state, attachments: state.attachments.filter((attachment) => attachment.id !== id) };
}

/* ── The composer ───────────────────────────────────────────────────────── */

/**
 * A typed message goes into the GENERAL conversation — never into a task's
 * thread — and is appended VERBATIM (it is the person's own sentence). The demo
 * then answers with one fixed, labelled line. No model is called and no task is
 * created, so a typed message cannot fake execution.
 */
export function sendMessage(state: ExperienceState, text: string): ExperienceState {
  const trimmed = text.trim();
  if (!trimmed) return state;

  /* Whatever was staged goes WITH the message, as its attachment cards, and the
     staging area empties. A chip that stayed behind after the message it was
     written for would claim the file is still pending when it is not. */
  const staged = state.attachments.map<Card>((attachment) => {
    const card: Extract<Card, { kind: "attachment" }> = {
      kind: "attachment",
      id: `att-${attachment.id}`,
      nameKey: attachment.nameKey,
      fileKind: attachment.fileKind,
      demo: true,
    };
    if (attachment.name) card.name = attachment.name;
    if (attachment.local) card.local = true;
    return card;
  });

  const step = state.general.length;
  const founder: Message = { id: `g-${step + 1}`, from: "founder", at: demoClock(step), text: trimmed, cards: staged };
  const reply: Message = {
    id: `g-${step + 2}`,
    from: "exec",
    at: demoClock(step + 1),
    key: "conv.demoReply",
    cards: [],
  };

  return { ...state, general: [...state.general, founder, reply], conversation: "general", attachments: [] };
}

/* ── Intake: what Send means ─────────────────────────────────────────────── */

/**
 * Folds a typed sentence down to letters, digits and single spaces: case,
 * punctuation, diacritics and tatweel are forgiven, wording is not.
 */
function normalizePrompt(text: string): string {
  return text
    .toLowerCase()
    .replace(/[\u0640\u064b-\u0652]/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

/**
 * The scripted demo run a typed sentence asks for, or null.
 *
 * There is no model behind this surface, so matching the script's own opener is
 * the ONLY honest way a typed prompt can start a run: a sentence either IS the
 * script's first line (in either language, punctuation and case aside) or the
 * demo has not been asked to do that. It is deliberately not a similarity
 * search — inferring that a paraphrase "meant" a script would be inventing
 * comprehension the demo does not have.
 */
export function scriptedScenarioFor(text: string): ScenarioId | null {
  const wanted = normalizePrompt(text);
  if (!wanted) return null;

  for (const scenario of SCENARIO_LIST) {
    const opener = scenario.opener;
    if (!opener || opener.type !== "founder-script") continue;
    for (const locale of LOCALES) {
      if (normalizePrompt(t(locale, opener.key)) === wanted) return scenario.id;
    }
  }
  return null;
}

/**
 * What Send does.
 *
 * A sentence that IS a script's opener enters that deterministic run — the same
 * entry as the start screen's script chip, so the demo can be started from the
 * composer exactly as the brief writes it. Everything else is an ordinary typed
 * message, which `sendMessage` answers with one fixed line that says the demo
 * calls no model.
 *
 * A run already open is never replaced by typing: that would erase work in
 * progress without asking, and the brief forbids it. Restarting a run stays an
 * explicit action in the tools.
 */
export function intake(state: ExperienceState, text: string): ExperienceState {
  const scenarioId = scriptedScenarioFor(text);
  if (scenarioId !== null && state.run === null) return startScenario(state, scenarioId);
  return sendMessage(state, text);
}

/* ── Choices ────────────────────────────────────────────────────────────── */

/** The choices a reviewer may take right now. Empty means the run is over. */
export function choicesFor(state: ExperienceState): Choice[] {
  const run = state.run;
  if (!run || run.ended) return [];
  const scenario = getScenario(run.scenarioId);
  const beat = scenario.beats[run.beatIndex];
  if (!beat) return [];
  return beat.choices;
}

/**
 * The ONE action that may take the composer's primary control away from send.
 *
 * A run is stoppable exactly when its current beat offers a cancel choice — the
 * engine's own vocabulary for “this task is over, at the reviewer's request”.
 * Nothing is invented here and nothing is scheduled: the composer SURFACES a
 * choice the beat already carries, and it stops being offered the moment that
 * beat does. It is also why the chip row excludes cancel choices: one action,
 * one control.
 */
export function stoppableChoice(state: ExperienceState): Choice | null {
  return choicesFor(state).find((choice) => choice.kind === "cancel") ?? null;
}

/**
 * True for the choices that authorise or decline something. They belong BESIDE
 * the approval they answer — never in the general suggestion row under the
 * composer, where a bare "Approve" would be an action with its subject missing.
 */
export function choiceIsApproval(choice: Choice): boolean {
  return choice.kind === "approve" || choice.kind === "reject";
}

function applyEffect(run: RunState, effect: ChoiceEffect | undefined): RunState {
  switch (effect) {
    case "clear_blocked":
      return run.reasonKey === undefined ? run : omitReason(run);
    case "cancel_task":
      /* EXEC is free again; the TASK is cancelled. Two states, two fields. */
      return { ...run, execStatus: "available" as ExecStatusCode, taskStatus: "cancelled" as TaskStatus };
    case "mark_failed":
      return run;
    case "mark_verified":
    case "set_blocked":
    default:
      return run;
  }
}

function omitReason(run: RunState): RunState {
  const next: RunState = { ...run };
  delete next.reasonKey;
  return next;
}

function countCorrections(run: RunState, beat: Beat): RunState {
  return beat.id === "correction" ? { ...run, correctionRounds: run.correctionRounds + 1 } : run;
}

/**
 * Takes a reviewer action. The ONLY way a run advances — there is no timer and
 * no automatic transition anywhere in this module.
 */
export function choose(state: ExperienceState, choiceId: string): ExperienceState {
  const run = state.run;
  if (!run || run.ended) return state;

  const scenario = getScenario(run.scenarioId);
  const choice = choicesFor(state).find((candidate) => candidate.id === choiceId);
  if (!choice) return state;

  /* A retry is counted from the CHOICE KIND, not from an optional effect on the
     script: the attempt ceiling must be impossible to forget in a new scenario. */
  const applied = applyEffect(run, choice.effect);
  const afterEffect = choice.kind === "retry" ? { ...applied, attempts: applied.attempts + 1 } : applied;

  if (choice.to === "end") {
    return { ...state, run: { ...afterEffect, ended: true, showGraph: false, activeTeam: [] } };
  }

  const target = scenario.beats[choice.to];
  /* A scenario with a bad index must not silently produce a broken run. */
  if (!target) {
    return { ...state, run: { ...afterEffect, ended: true, showGraph: false, activeTeam: [] } };
  }

  const cleared = choice.effect === "clear_blocked" ? afterEffect : omitReason(afterEffect);
  const entered = enterBeat(cleared, target, choice.to);
  const counted = countCorrections(entered, target);
  const ended = target.choices.length === 0;

  return { ...state, run: ended ? { ...counted, ended: true, showGraph: false, activeTeam: [] } : counted };
}

/* ═══════════════════════════════════════════════════════
   Read models the UI uses
   ═══════════════════════════════════════════════════════ */

/** Every card currently on screen, in order. */
export function allCards(run: RunState | null): Card[] {
  if (!run) return [];
  return run.messages.flatMap((message) => message.cards);
}

/** The plan card, when the run has one. */
export function planCard(run: RunState | null): Card | undefined {
  return allCards(run).find((card) => card.kind === "plan");
}

/**
 * The dependency graph is shown ONLY while the plan is being reviewed — the
 * brief asks for it "when needed only", so it is derived, never always-on.
 */
export function showDependencyGraph(run: RunState | null): boolean {
  return run !== null && run.showGraph && planCard(run) !== undefined;
}

export function scenarioLabelKeyOf(run: RunState | null): string | undefined {
  return run ? getScenario(run.scenarioId).labelKey : undefined;
}

/* ═══════════════════════════════════════════════════════
   Dependency graph — derived, never hand-placed
   ═══════════════════════════════════════════════════════ */

/**
 * Groups plan steps into dependency LEVELS: level 0 has no prerequisites, level
 * n depends only on lower levels. Rendered as columns, so the optional graph is
 * a layout of the data rather than a hand-drawn picture — and a cycle shows up
 * as a step that never lands in a level instead of an infinite loop.
 */
export function dependencyLevels(steps: PlanStep[]): PlanStep[][] {
  const byId = new Map(steps.map((step) => [step.id, step]));
  const levelOf = new Map<string, number>();

  const levelFor = (step: PlanStep, seen: Set<string>): number => {
    const known = levelOf.get(step.id);
    if (known !== undefined) return known;
    if (seen.has(step.id)) return 0; // cycle guard: treat as a root, never recurse forever
    seen.add(step.id);
    const parents = step.dependsOn
      .map((id) => byId.get(id))
      .filter((parent): parent is PlanStep => parent !== undefined);
    const level = parents.length === 0 ? 0 : Math.max(...parents.map((parent) => levelFor(parent, seen))) + 1;
    levelOf.set(step.id, level);
    return level;
  };

  const levels: PlanStep[][] = [];
  for (const step of steps) {
    const level = levelFor(step, new Set<string>());
    (levels[level] ??= []).push(step);
  }
  /* Any step left out because of a cycle is appended, so nothing is hidden. */
  const placed = new Set(levels.flat().map((step) => step.id));
  const orphans = steps.filter((step) => !placed.has(step.id));
  if (orphans.length > 0) levels.push(orphans);
  return levels;
}

/* ═══════════════════════════════════════════════════════
   Integrity checks — a test asserts these hold
   ═══════════════════════════════════════════════════════ */

export type ScriptViolation = string;

export function findScriptViolations(): ScriptViolation[] {
  const violations: ScriptViolation[] = [];
  for (const scenario of SCENARIO_LIST) {
    if (scenario.beats.length === 0) {
      violations.push(`${scenario.id} has no beats`);
      continue;
    }

    scenario.beats.forEach((beat) => {
      for (const choice of beat.choices) {
        if (choice.to === "end") continue;
        if (!Number.isInteger(choice.to) || choice.to < 0 || choice.to >= scenario.beats.length) {
          violations.push(`${scenario.id}/${beat.id} choice ${choice.id} points at missing beat ${choice.to}`);
          continue;
        }
        /* A choice that lands on its own beat is an infinite loop. */
        if (choice.to === scenario.beats.indexOf(beat)) {
          violations.push(`${scenario.id}/${beat.id} choice ${choice.id} loops back to itself`);
        }
      }
    });

    /* REACHABILITY: every beat must be reachable from beat 0, or it is dead
       script nobody can review. This is the check that actually matters — a
       scenario legitimately has several terminal outcomes, so "the last beat is
       the only ending" is NOT a rule. */
    const reachable = new Set<number>([0]);
    const queue = [0];
    while (queue.length > 0) {
      const index = queue.shift() as number;
      for (const choice of scenario.beats[index].choices) {
        if (choice.to === "end") continue;
        if (!reachable.has(choice.to)) {
          reachable.add(choice.to);
          queue.push(choice.to);
        }
      }
    }
    scenario.beats.forEach((beat, index) => {
      if (!reachable.has(index)) violations.push(`${scenario.id}/${beat.id} is unreachable from the first beat`);
    });

    /* An ending must exist: a script with no terminal beat can never finish. */
    if (!scenario.beats.some((beat) => beat.choices.length === 0) &&
        !scenario.beats.some((beat) => beat.choices.some((choice) => choice.to === "end"))) {
      violations.push(`${scenario.id} has no ending`);
    }
  }
  return violations;
}
