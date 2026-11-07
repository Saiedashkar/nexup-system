/**
 * NEXUP COMMAND — EXEC EXPERIENCE · DOMAIN TYPES
 * ─────────────────────────────────────────────
 * The contract between the EXEC surface and whatever drives it.
 *
 * THE ONE RULE THIS FILE EXISTS TO ENFORCE: **state is locale-independent.**
 * Nothing here stores a rendered sentence. A message carries a translation KEY
 * and its variables; a card carries keys; a status is a CODE. The language is
 * applied at render time and nowhere else. That is what makes switching
 * language mid-run preserve the conversation and the task exactly.
 *
 * The second rule: there is no timer, promise or side effect in this model. A
 * scenario advances only when a reviewer takes an explicit action, so the demo
 * can never show progress nobody caused.
 *
 * No React, no I/O, no provider SDK, no runtime contact.
 */

import type { Locale, MessageKey } from "./i18n";

/* ═══════════════════════════════════════════════════════
   Locale — owned by `i18n.ts`, re-exported for callers
   ═══════════════════════════════════════════════════════ */

export type { Locale, MessageKey };

/* ═══════════════════════════════════════════════════════
   EXEC status — the executive's own state
   ═══════════════════════════════════════════════════════ */

/**
 * The ten states EXEC can be in. Deliberately separate from `TaskStatus`:
 * EXEC being `available` says nothing about whether a task finished, and a
 * single step completing must never be read as the mission completing.
 */
export type ExecStatusCode =
  | "available"
  | "planning"
  | "working"
  | "waiting"
  | "needs_approval"
  | "blocked"
  | "reviewing"
  | "completed"
  | "failed"
  | "offline";

/** Colour FAMILY only. Never the sole carrier of meaning (see `status.ts`). */
export type ExecTone = "blue" | "blue-low" | "amber" | "green" | "red" | "off";

/* ═══════════════════════════════════════════════════════
   Task lifecycle — the work's own state
   ═══════════════════════════════════════════════════════ */

export type TaskStatus =
  | "planned"
  | "working"
  | "waiting"
  | "blocked"
  | "review"
  | "completed"
  | "failed"
  | "cancelled";

/* ═══════════════════════════════════════════════════════
   Scope — company / client / project
   ═══════════════════════════════════════════════════════ */

export type ScopeId = string;

export type Scope = {
  companyId: ScopeId;
  clientId: ScopeId;
  projectId: ScopeId;
};

/** A selectable context the reviewer can switch EXEC to. */
export type ScopeOption = {
  id: ScopeId;
  /** Translation key for the human label. */
  labelKey: MessageKey;
  scope: Scope;
};

/* ═══════════════════════════════════════════════════════
   Cards — structured payloads, never rendered strings
   ═══════════════════════════════════════════════════════ */

export type LabelValue = { labelKey: MessageKey; valueKey: MessageKey };
export type LabelValueNumber = { labelKey: MessageKey; value: number };

export type PlanStep = {
  id: string;
  /** Translation key for the step's one-line description. */
  titleKey: MessageKey;
  ownerId: TeamId;
  /** Step ids this step cannot start without. Drives the optional graph. */
  dependsOn: string[];
  /** Demo status of this step. A step finishing never completes the task. */
  state: "queued" | "running" | "done" | "blocked";
};

export type VerificationItem = {
  key: MessageKey;
  /** `supported` = traceable to a source inside this run. */
  state: "supported" | "unsupported";
};

export type Card =
  | { kind: "brief"; id: string; rows: LabelValue[] }
  | { kind: "plan"; id: string; steps: PlanStep[] }
  | {
      kind: "delegation";
      id: string;
      ownerId: TeamId;
      deliverableKey: MessageKey;
      authorityKey: MessageKey;
      dueKey: MessageKey;
    }
  | {
      kind: "gate";
      id: string;
      titleKey: MessageKey;
      bodyKey: MessageKey;
      /** What the human is actually authorising. */
      authorityKey: MessageKey;
      cost: number;
    }
  | {
      kind: "evidence";
      id: string;
      claimKey: MessageKey;
      sourceKey: MessageKey;
      state: "supported" | "unsupported";
    }
  | { kind: "correction"; id: string; beforeKey: MessageKey; afterKey: MessageKey; boundKey: MessageKey }
  | { kind: "verification"; id: string; items: VerificationItem[] }
  | {
      kind: "result";
      id: string;
      rows: LabelValue[];
      noPublishKey: MessageKey;
      titleKey?: MessageKey;
      descriptionKey?: MessageKey;
    }
  | { kind: "required-inputs"; id: string; items: MessageKey[]; blocksKey: MessageKey }
  | {
      kind: "attachment";
      id: string;
      nameKey: MessageKey;
      /**
       * The reviewer's own file name, when they picked a local file. Literal text
       * like the founder's own sentence: never translated, and never a path.
       */
      name?: string;
      fileKind: "image" | "doc";
      /** True when the chip stands in for a file the reviewer picked locally. */
      local?: boolean;
      demo: true;
    };

/* ═══════════════════════════════════════════════════════
   Conversation
   ═══════════════════════════════════════════════════════ */

export type MessageFrom = "founder" | "exec";

export type Message = {
  id: string;
  from: MessageFrom;
  /** Clock label only — the demo never invents a real timestamp. */
  at: string;
  /**
   * A translation key for EXEC's own words, OR the founder's literal text.
   * A person's own sentence is never translated.
   */
  key?: MessageKey;
  text?: string;
  vars?: Record<string, string | number>;
  cards: Card[];
};

export type ActivityKind = "agent" | "mission" | "approval" | "system" | "error" | "human";

export type TimelineEntry = {
  id: string;
  at: string;
  kind: ActivityKind;
  key: MessageKey;
  vars?: Record<string, string | number>;
  /** True for a demo event a reviewer caused, false for setup. */
  causedByUser: boolean;
};

/* ═══════════════════════════════════════════════════════
   The team EXEC routes to — responsibilities, not invented names
   ═══════════════════════════════════════════════════════ */

export type TeamId = "exec" | "systems" | "creative" | "growth" | "operations" | "engineering";

/**
 * The accent each member carries on the approved team sheet. A NAMED accent,
 * not an EXEC state tone: the team's identity colours must never be read as a
 * status.
 */
export type TeamAccent = "blue" | "violet" | "orange" | "mint" | "capso";

export type TeamMember = {
  id: TeamId;
  /** Codename shown beside the specialty; the five names are not final yet. */
  codename: string;
  specialtyKey: MessageKey;
  mandateKey: MessageKey;
  /** Identity accent from the approved team sheet (informational only). */
  accent: TeamAccent;
};

/* ═══════════════════════════════════════════════════════
   Scenario script — explicit beats and explicit choices
   ═══════════════════════════════════════════════════════ */

export type Emit =
  /** A real person's own words — never translated, stored verbatim. */
  | { type: "founder"; text: string }
  /** A scripted demo line that IS part of the fixture, so it localises. */
  | { type: "founder-script"; key: MessageKey }
  | { type: "exec"; key: MessageKey; vars?: Record<string, string | number>; cards?: Card[] }
  | { type: "event"; kind: ActivityKind; key: MessageKey; vars?: Record<string, string | number>; causedByUser?: boolean };

export type ChoiceEffect = "set_blocked" | "clear_blocked" | "mark_verified" | "mark_failed" | "cancel_task";

export type Choice = {
  id: string;
  labelKey: MessageKey;
  kind: "continue" | "approve" | "reject" | "cancel" | "retry";
  /** Next beat index, or "end" to finish the run. */
  to: number | "end";
  effect?: ChoiceEffect;
};

export type Beat = {
  id: string;
  /** EXEC's state while this beat is current. */
  status: ExecStatusCode;
  /** The task's state while this beat is current. */
  task: TaskStatus;
  /** Entering the beat appends these, in order. */
  emit: Emit[];
  /** Required when a human must act. */
  choices: Choice[];
  /** Present when the task was stopped and the UI must say why. */
  reasonKey?: MessageKey;
  /** Show the optional dependency graph for this beat. */
  showGraph?: boolean;
  /** Which team members are engaged during this beat. */
  activeTeam?: TeamId[];
};

export type ScenarioId =
  | "launch_brief"
  | "content_week"
  | "missing_inputs"
  | "approval"
  | "blocked_dependency"
  | "failure_cancel"
  | "offline";

export type Scenario = {
  id: ScenarioId;
  labelKey: MessageKey;
  summaryKey: MessageKey;
  /** The scope this scenario belongs to. Isolated: see `fixtures.ts`. */
  scope: Scope;
  /** Human-facing task reference, unique per scenario. */
  code: string;
  taskTitleKey: MessageKey;
  /** True when EXEC cannot run at all in this scenario. */
  unreachable?: boolean;
  /** The founder's opening message, when the run starts from one. */
  opener?: Emit;
  beats: Beat[];
};

/* ═══════════════════════════════════════════════════════
   Engine state — what the surface renders
   ═══════════════════════════════════════════════════════ */

export type RunState = {
  scenarioId: ScenarioId;
  beatIndex: number;
  /** True once the run has reached a beat with no choices. */
  ended: boolean;
  /** EXEC's global state. */
  execStatus: ExecStatusCode;
  /** The CURRENT task's state — independent of `execStatus`. */
  taskStatus: TaskStatus;
  taskCode: string;
  taskTitleKey: MessageKey;
  reasonKey?: MessageKey;
  showGraph: boolean;
  activeTeam: TeamId[];
  /** Team members engaged at some point during this run (for the history view). */
  engagedTeam: TeamId[];
  /** Stable transcript. Keys, not sentences. */
  messages: Message[];
  timeline: TimelineEntry[];
  /** Counters the UI shows without inventing progress. */
  correctionRounds: number;
  attempts: number;
};

export type DemoAttachment = {
  id: string;
  nameKey: MessageKey;
  /** The reviewer's own file name for a local pick. Never a path. */
  name?: string;
  fileKind: "image" | "doc";
  demo: true;
  /**
   * True while the chip is a DEMO stand-in for a file the reviewer picked.
   * The demo never reads, uploads or analyses the file; this flag is what the
   * composer's own note and the chip's badge refer to.
   */
  local: boolean;
};

/* ═══════════════════════════════════════════════════════
   Conversation history
   ═══════════════════════════════════════════════════════ */

/**
 * A conversation that is NOT the open one.
 *
 * The open conversation stays where it always was — `general` and `run` at the
 * top level of `ExperienceState` — so the surface does not change shape when a
 * second conversation exists. A parked one is the same two things, copied out
 * with the tab and the context it was in.
 *
 * `lines` is a COUNT, never a rendered sentence, and `taskTitleKey` is a key:
 * a parked conversation therefore survives a language switch for the same
 * reason the open one does.
 */
export type ParkedConversation = {
  id: string;
  /** Human-facing reference for the history row. Derived from the demo sequence. */
  code: string;
  /** The context it was parked in. Never carried into another one. */
  scope: Scope;
  /** The tab that was open when it was parked. */
  conversation: "general" | "task";
  /** The parked task's title, when it was parked holding a run. */
  taskTitleKey: MessageKey | null;
  /** The parked general thread. Keys and the person's own words, as before. */
  general: Message[];
  /** The parked run, when there was one. */
  run: RunState | null;
  /** Run lines + general lines. What the history row reports. */
  lines: number;
  /** Demo order, oldest first. The list is never ordered by a wall clock. */
  seq: number;
};

export type ExperienceState = {
  /** The language is UI state, NOT part of the run — switching it touches no run field. */
  locale: Locale;
  /** Which conversation is open. */
  conversation: "general" | "task";
  /** The selected context. Changing it does not mutate the run. */
  scope: Scope;
  /** The GENERAL conversation. Deliberately separate from a task's thread. */
  general: Message[];
  /** The active run, when one exists. */
  run: RunState | null;
  /** Demo attachments staged in the composer. Never uploaded anywhere. */
  attachments: DemoAttachment[];
  /**
   * Conversations parked by "new conversation". SAME CONTEXT ONLY: a move to
   * another context clears this list along with everything else, because a
   * parked conversation is still one client's words and one client's work, and
   * client isolation outranks keeping history around.
   */
  conversations: ParkedConversation[];
  /** The open conversation's id, so a parked copy can be opened again. */
  activeId: string;
  /** Monotonic demo counter for conversation ids and codes. Not a clock. */
  seq: number;
};

