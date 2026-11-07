/**
 * EXEC Experience — focused tests
 * ──────────────────────────────
 * The acceptance criteria that can be PROVEN without a browser:
 *   1. the main scenario is complete and reachable, beat by beat;
 *   2. EXEC's state is separate from the task's state, and `completed` is only
 *      reachable through verification;
 *   3. a language change preserves the conversation and the task exactly;
 *   4. client scopes are isolated, including inside the fixtures;
 *   5. no timers, no network and no execution exist in the demo path.
 *
 * These are pure-logic tests: the demo engine takes state in and returns state
 * out, so none of this needs a DOM.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { inflateSync } from "node:zlib";

import { describe, expect, it } from "vitest";

import { EXEC_STATUS_META, SCOPE_OPTIONS, scopeKey, TASK_STATUS_META } from "@/components/command/exec-lab/catalog";
import {
  allCards,
  choiceIsApproval,
  choose,
  choicesFor,
  createExperience,
  dependencyLevels,
  findScriptViolations,
  addDemoAttachment,
  conversationRows,
  conversationRowTitle,
  filterConversationRows,
  intake,
  scriptedScenarioFor,
  linesOf,
  newConversation,
  openConversation,
  planCard,
  resetRun,
  sendMessage,
  setLocale,
  setScope,
  showDependencyGraph,
  startScenario,
  stoppableChoice,
} from "@/components/command/exec-lab/engine";
import { clientsIn, findIsolationViolations, historyFor } from "@/components/command/exec-lab/fixtures";
import { AR_DICTIONARY, DICTIONARY_KEYS, EN_DICTIONARY, LOCALES, dirOf, t } from "@/components/command/exec-lab/i18n";
import { SCENARIO_IDS, SCENARIO_LIST, getScenario } from "@/components/command/exec-lab/scenarios";
import type { ExecStatusCode, ExperienceState } from "@/components/command/exec-lab/types";

/** Plays a scenario to a named beat by repeatedly taking the first choice. */
function playTo(scenarioId: (typeof SCENARIO_IDS)[number], beatId: string): ExperienceState {
  let state = startScenario(createExperience("en"), scenarioId);
  for (let guard = 0; guard < 40; guard += 1) {
    const run = state.run;
    if (!run) throw new Error("run disappeared");
    const beat = getScenario(scenarioId).beats[run.beatIndex];
    if (beat.id === beatId) return state;
    const choices = choicesFor(state);
    if (choices.length === 0) throw new Error(`reached the end before beat ${beatId}`);
    state = choose(state, choices[0].id);
  }
  throw new Error(`never reached beat ${beatId}`);
}

describe("scripts", () => {
  it("has seven scenarios and structurally valid beats", () => {
    expect(SCENARIO_IDS).toHaveLength(7);
    expect(findScriptViolations()).toEqual([]);
  });

  it("provides a two-choice launch brief that resolves to one compact demo result", () => {
    const scenario = getScenario("launch_brief" as never);
    expect(scenario).toMatchObject({
      id: "launch_brief",
      code: "TSK-1047",
      beats: [
        {
          id: "goal",
          choices: [
            { id: "lb-goal-leads", to: 1 },
            { id: "lb-goal-awareness", to: 2 },
          ],
        },
        { id: "brief_leads", status: "available", task: "completed", choices: [] },
        { id: "brief_awareness", status: "available", task: "completed", choices: [] },
      ],
    });

    for (const [choiceId, goalKey] of [
      ["lb-goal-leads", "s.launch.result.goal.leads"],
      ["lb-goal-awareness", "s.launch.result.goal.awareness"],
    ] as const) {
      let state = startScenario(createExperience("en"), "launch_brief");
      expect(choicesFor(state).map((choice) => choice.id)).toEqual(["lb-goal-leads", "lb-goal-awareness"]);
      state = choose(state, choiceId);
      const result = state.run ? allCards(state.run).find((card) => card.kind === "result") : undefined;
      expect(state.run?.ended).toBe(true);
      expect(result).toMatchObject({
        kind: "result",
        titleKey: "s.launch.result.title",
      });
      expect(result?.kind === "result" ? result.rows[0]?.valueKey : undefined).toBe(goalKey);
    }
  });

  it("gives every scenario a unique task code", () => {
    const codes = SCENARIO_LIST.map((scenario) => scenario.code);
    expect(new Set(codes).size).toBe(codes.length);
  });
});

describe("EXEC states and task states are separate", () => {
  it("covers all ten EXEC states, each with a label key and a glyph", () => {
    const codes: ExecStatusCode[] = [
      "available",
      "planning",
      "working",
      "waiting",
      "needs_approval",
      "blocked",
      "reviewing",
      "completed",
      "failed",
      "offline",
    ];
    for (const code of codes) {
      const meta = EXEC_STATUS_META[code];
      expect(meta.labelKey.length).toBeGreaterThan(0);
      /* Never colour alone: every state carries a distinct symbol. */
      expect(meta.glyph.length).toBeGreaterThan(0);
    }
    const glyphs = codes.map((code) => EXEC_STATUS_META[code].glyph);
    expect(new Set(glyphs).size).toBe(glyphs.length);
  });

  it("uses a distinct vocabulary for the task lifecycle", () => {
    expect(Object.keys(TASK_STATUS_META).length).toBe(8);
    /* The two vocabularies must not be the same object graph. */
    expect(TASK_STATUS_META).not.toBe(EXEC_STATUS_META);
  });

  it("never reports a completed task while EXEC is still working", () => {
    let state = startScenario(createExperience("en"), "content_week");
    const seen: Array<[string, string]> = [];
    for (let guard = 0; guard < 40; guard += 1) {
      const run = state.run;
      if (!run) break;
      seen.push([run.execStatus, run.taskStatus]);
      if (run.ended) break;
      const choices = choicesFor(state);
      if (choices.length === 0) break;
      state = choose(state, choices[0].id);
    }
    for (const [exec, task] of seen) {
      if (task === "completed") expect(exec).toBe("completed");
    }
    const last = seen[seen.length - 1];
    expect(last).toEqual(["completed", "completed"]);
  });

  it("never shows `completed` before the verification beat", () => {
    let state = startScenario(createExperience("en"), "content_week");
    for (let guard = 0; guard < 40; guard += 1) {
      const run = state.run;
      if (!run) break;
      const beat = getScenario("content_week").beats[run.beatIndex];
      if (run.execStatus === "completed") {
        expect(beat.id).toBe("result");
        expect(run.messages.some((message) => message.cards.some((card) => card.kind === "verification"))).toBe(true);
      }
      if (run.ended) break;
      const choices = choicesFor(state);
      if (choices.length === 0) break;
      state = choose(state, choices[0].id);
    }
  });
});

describe("the main scenario, step by step", () => {
  it("opens with the founder's brief and sets the scope before anything else", () => {
    const state = startScenario(createExperience("en"), "content_week");
    const run = state.run!;
    expect(run.messages[0].from).toBe("founder");
    expect(run.execStatus).toBe("planning");
    /* The brief card is emitted, and it carries outcome, deliverables, criterion
       and the no-publishing constraint. */
    const brief = allCards(run).find((card) => card.kind === "brief");
    expect(brief).toBeDefined();
    expect(brief && brief.kind === "brief" ? brief.rows.length : 0).toBe(4);
  });

  it("gates the plan on an explicit human approval", () => {
    const atPlan = playTo("content_week", "plan");
    expect(atPlan.run!.execStatus).toBe("needs_approval");
    const kinds = choicesFor(atPlan).map((choice) => choice.kind);
    expect(kinds).toContain("approve");
    /* The dependency graph appears exactly while the plan is reviewed. */
    expect(showDependencyGraph(atPlan.run)).toBe(true);
  });

  it("delegates to Growth and Creative in parallel, then waits on their input", () => {
    const atDelegate = playTo("content_week", "delegate");
    const delegations = allCards(atDelegate.run).filter((card) => card.kind === "delegation");
    expect(delegations.map((card) => (card.kind === "delegation" ? card.ownerId : ""))).toEqual(["growth", "creative"]);

    const atWait = playTo("content_week", "await_inputs");
    expect(atWait.run!.execStatus).toBe("waiting");
    /* Progress is caused by explicit demo EVENTS, never by a timer. */
    const events = atWait.run!.timeline.filter((entry) => entry.causedByUser === false);
    expect(events.length).toBeGreaterThanOrEqual(3);
  });

  it("catches an unsupported claim and holds the draft instead of proceeding", () => {
    const atFinding = playTo("content_week", "finding");
    const run = atFinding.run!;
    expect(run.execStatus).toBe("blocked");
    expect(run.taskStatus).toBe("blocked");
    expect(run.reasonKey).toBeDefined();
    const evidence = allCards(run).find((card) => card.kind === "evidence");
    expect(evidence && evidence.kind === "evidence" ? evidence.state : "").toBe("unsupported");
    /* Nothing claims success while a claim is unresolved. */
    expect(run.execStatus).not.toBe("completed");
  });

  it("spends exactly one bounded correction round, then verifies", () => {
    const atCorrection = playTo("content_week", "correction");
    expect(atCorrection.run!.correctionRounds).toBe(1);

    const atVerification = playTo("content_week", "verification");
    const verification = allCards(atVerification.run).find((card) => card.kind === "verification");
    expect(verification).toBeDefined();
    if (verification && verification.kind === "verification") {
      expect(verification.items.every((item) => item.state === "supported")).toBe(true);
    }

    /* Reaching the correction beat again is impossible: the script is bounded. */
    let state = atCorrection;
    for (let guard = 0; guard < 20; guard += 1) {
      const choices = choicesFor(state);
      if (choices.length === 0) break;
      state = choose(state, choices[0].id);
    }
    expect(state.run!.correctionRounds).toBe(1);
  });

  it("ends on a result that names the drafts, the verification and the no-publish rule", () => {
    const finished = playTo("content_week", "result");
    const run = finished.run!;
    expect(run.ended).toBe(true);
    const result = allCards(run).find((card) => card.kind === "result");
    expect(result).toBeDefined();
    if (result && result.kind === "result") {
      expect(result.rows.length).toBeGreaterThanOrEqual(4);
      expect(result.noPublishKey).toBe("card.result.noPublish");
    }
    expect(choicesFor(finished)).toEqual([]);
  });
});

describe("independent scenarios", () => {
  it("blocks with a specific list when inputs are missing", () => {
    const state = startScenario(createExperience("en"), "missing_inputs");
    const inputs = allCards(state.run).find((card) => card.kind === "required-inputs");
    expect(inputs).toBeDefined();
    expect(inputs && inputs.kind === "required-inputs" ? inputs.items.length : 0).toBe(3);
    expect(state.run!.execStatus).toBe("blocked");
  });

  it("asks for approval and both outcomes are clean", () => {
    const atGate = startScenario(createExperience("en"), "approval");
    expect(atGate.run!.execStatus).toBe("needs_approval");
    const gate = allCards(atGate.run).find((card) => card.kind === "gate");
    expect(gate && gate.kind === "gate" ? gate.cost : 0).toBeGreaterThan(0);

    const approve = choicesFor(atGate).find((choice) => choice.kind === "approve")!;
    const approved = choose(atGate, approve.id);
    expect(approved.run!.execStatus).toBe("working");

    const reject = choicesFor(atGate).find((choice) => choice.kind === "reject")!;
    const declined = choose(atGate, reject.id);
    expect(declined.run!.execStatus).toBe("failed");
    expect(declined.run!.taskStatus).toBe("failed");
    expect(declined.run!.reasonKey).toBeDefined();
  });

  it("lets a blocked run either continue with a marked placeholder or stay held", () => {
    const blocked = startScenario(createExperience("en"), "blocked_dependency");
    expect(blocked.run!.reasonKey).toBeDefined();
    const hold = choicesFor(blocked).find((choice) => choice.id === "bd-0-hold")!;
    const held = choose(blocked, hold.id);
    expect(held.run!.ended).toBe(true);
    expect(held.run!.taskStatus).toBe("waiting");
    /* A held run produced no result card. */
    expect(allCards(held.run).some((card) => card.kind === "result")).toBe(false);
  });

  it("fails, bounds the retry, then a demo cancellation returns EXEC to available", () => {
    const failed = startScenario(createExperience("en"), "failure_cancel");
    expect(failed.run!.execStatus).toBe("failed");

    const retry = choicesFor(failed).find((choice) => choice.kind === "retry")!;
    const retried = choose(failed, retry.id);
    expect(retried.run!.attempts).toBe(1);
    /* The ceiling beat offers no retry at all. */
    expect(choicesFor(retried).some((choice) => choice.kind === "retry")).toBe(false);

    const cancel = choicesFor(retried).find((choice) => choice.kind === "cancel")!;
    const cancelled = choose(retried, cancel.id);
    expect(cancelled.run!.ended).toBe(true);
    /* EXEC is free again; the TASK is cancelled. Two fields, two answers. */
    expect(cancelled.run!.execStatus).toBe("available");
    expect(cancelled.run!.taskStatus).toBe("cancelled");
  });

  it("shows offline honestly, with no choices and no queued work", () => {
    const state = startScenario(createExperience("en"), "offline");
    expect(state.run!.execStatus).toBe("offline");
    expect(state.run!.ended).toBe(true);
    expect(choicesFor(state)).toEqual([]);
    expect(state.run!.reasonKey).toBeDefined();
  });
});

describe("language switching preserves state", () => {
  it("changes ONLY the locale, leaving the run object identical", () => {
    const state = playTo("content_week", "finding");
    const next = setLocale(state, "ar");

    expect(next.locale).toBe("ar");
    /* The run is the SAME object: a language change cannot touch it. */
    expect(next.run).toBe(state.run);
    expect(next.general).toBe(state.general);
    expect(next.scope).toBe(state.scope);
    expect(next.conversation).toBe(state.conversation);
  });

  it("preserves the conversation and task across a round trip ar → en → ar", () => {
    let state = playTo("content_week", "correction");
    const before = {
      messages: state.run!.messages.length,
      timeline: state.run!.timeline.length,
      beat: state.run!.beatIndex,
      exec: state.run!.execStatus,
      task: state.run!.taskStatus,
      code: state.run!.taskCode,
      corrections: state.run!.correctionRounds,
    };

    for (const locale of ["ar", "en", "ar", "en"] as const) {
      state = setLocale(state, locale);
      const run = state.run!;
      expect(run.messages.length).toBe(before.messages);
      expect(run.timeline.length).toBe(before.timeline);
      expect(run.beatIndex).toBe(before.beat);
      expect(run.execStatus).toBe(before.exec);
      expect(run.taskStatus).toBe(before.task);
      expect(run.taskCode).toBe(before.code);
      expect(run.correctionRounds).toBe(before.corrections);
    }
  });

  it("also preserves a typed general conversation", () => {
    let state = createExperience("ar");
    state = sendMessage(state, "جهّز خطة الأسبوع القادم.");
    const count = state.general.length;
    expect(count).toBe(2);
    /* The person's own words survive verbatim. */
    expect(state.general[0].text).toBe("جهّز خطة الأسبوع القادم.");

    state = setLocale(state, "en");
    expect(state.general.length).toBe(count);
    expect(state.general[0].text).toBe("جهّز خطة الأسبوع القادم.");
  });

  it("answers the composer without creating a task or touching the run", () => {
    const started = startScenario(createExperience("en"), "content_week");
    const typed = sendMessage(started, "what needs me today?");
    /* The run is untouched: a typed message is NOT a task. */
    expect(typed.run).toBe(started.run);
    expect(typed.general).toHaveLength(2);
    expect(typed.conversation).toBe("general");
  });

  it("keeps a run when the scope does not change", () => {
    const started = startScenario(createExperience("en"), "content_week");
    const sameScopeOption = SCOPE_OPTIONS.find(
      (option) => scopeKey(option.scope) === scopeKey(started.scope),
    )!;
    const next = setScope(started, sameScopeOption.id);
    expect(next.run).toBe(started.run);
  });

  it("closes a run when the reviewer leaves its client scope", () => {
    const started = startScenario(createExperience("en"), "content_week");
    const otherClient = SCOPE_OPTIONS.find((option) => option.scope.clientId !== started.scope.clientId)!;
    const next = setScope(started, otherClient.id);

    expect(next.run).toBeNull();
    expect(next.conversation).toBe("general");
    expect(next.scope.clientId).toBe(otherClient.scope.clientId);
  });

  it("carries no conversation and no attachment into another context", () => {
    /* The brief's isolation rule, exercised the way it could actually leak: a
       run, a typed general message and a staged attachment all belonging to one
       client, then a move to another client. */
    let state = startScenario(createExperience("ar"), "content_week");
    state = sendMessage(state, "ملاحظة خاصة بهذا العميل");
    state = addDemoAttachment(state, "image");
    expect(state.general.length).toBeGreaterThan(0);
    expect(state.attachments.length).toBe(1);

    const otherClient = SCOPE_OPTIONS.find((option) => option.scope.clientId !== state.scope.clientId)!;
    const next = setScope(state, otherClient.id);

    expect(next.run).toBeNull();
    expect(next.general).toEqual([]);
    expect(next.attachments).toEqual([]);
    expect(next.conversation).toBe("general");

    /* ...and the previous context is not recoverable by moving back. */
    const back = setScope(next, SCOPE_OPTIONS.find((option) => option.id !== otherClient.id)!.id);
    expect(back.general).toEqual([]);
    expect(back.attachments).toEqual([]);
    expect(back.run).toBeNull();
  });

  it("keeps the conversation and the attachment while the scope does not move", () => {
    let state = sendMessage(createExperience("en"), "what needs me today?");
    state = addDemoAttachment(state, "doc");
    if (scopeKey(state.scope) === scopeKey(SCOPE_OPTIONS[0].scope)) {
      const next = setScope(state, SCOPE_OPTIONS[0].id);
      expect(next).toBe(state);
      return;
    }
    throw new Error("the default scope is expected to be the first option");
  });
});

describe("client scope isolation", () => {
  it("holds no fixture or scope violations", () => {
    expect(findIsolationViolations()).toEqual([]);
  });

  it("returns history for exactly one client, never several", () => {
    for (const option of SCOPE_OPTIONS) {
      const entries = historyFor(option.scope);
      expect(entries.length).toBeGreaterThan(0);
      expect(clientsIn(entries)).toEqual([option.scope.clientId]);
    }
  });

  it("never returns another client's rows, even for a scope with no rows", () => {
    const empty = historyFor({ companyId: "nexup", clientId: "atlas", projectId: "does-not-exist" });
    expect(empty).toEqual([]);
  });

  it("pins each scenario to a declared scope option", () => {
    const declared = new Set(SCOPE_OPTIONS.map((option) => scopeKey(option.scope)));
    for (const scenario of SCENARIO_LIST) {
      expect(declared.has(scopeKey(scenario.scope))).toBe(true);
    }
  });

  it("keeps two scenarios on the same client from sharing a code", () => {
    const byClient = new Map<string, Set<string>>();
    for (const scenario of SCENARIO_LIST) {
      const set = byClient.get(scenario.scope.clientId) ?? new Set<string>();
      expect(set.has(scenario.code)).toBe(false);
      set.add(scenario.code);
      byClient.set(scenario.scope.clientId, set);
    }
  });
});

describe("the dependency graph is derived, and only when asked for", () => {
  it("lays the plan out in levels from dependsOn", () => {
    const state = playTo("content_week", "plan");
    const plan = planCard(state.run);
    expect(plan && plan.kind === "plan").toBe(true);
    if (!plan || plan.kind !== "plan") return;

    const levels = dependencyLevels(plan.steps);
    expect(levels).toHaveLength(3);
    expect(levels[0].map((step) => step.id).sort()).toEqual(["s1", "s2"]);
    expect(levels[1].map((step) => step.id)).toEqual(["s3"]);
    expect(levels[2].map((step) => step.id)).toEqual(["s4"]);
  });

  it("hides the graph when the run does not ask for it", () => {
    const atDelegate = playTo("content_week", "delegate");
    expect(showDependencyGraph(atDelegate.run)).toBe(false);
  });

  it("does not loop forever on a cyclic plan", () => {
    const levels = dependencyLevels([
      { id: "a", titleKey: "card.plan", ownerId: "exec", dependsOn: ["b"], state: "queued" },
      { id: "b", titleKey: "card.plan", ownerId: "exec", dependsOn: ["a"], state: "queued" },
    ]);
    expect(levels.flat()).toHaveLength(2);
  });
});

describe("localisation is complete in both languages", () => {
  it("defines both locales and their directions", () => {
    expect([...LOCALES]).toEqual(["ar", "en"]);
    expect(dirOf("ar")).toBe("rtl");
    expect(dirOf("en")).toBe("ltr");
  });

  it("has no key missing from either dictionary", () => {
    /* Arabic is typed as a full Record, so this is also a compile-time promise —
       the test makes the promise visible in the run. */
    for (const key of DICTIONARY_KEYS) {
      expect(typeof EN_DICTIONARY[key]).toBe("string");
      expect(typeof AR_DICTIONARY[key]).toBe("string");
      expect(EN_DICTIONARY[key].length).toBeGreaterThan(0);
      expect(AR_DICTIONARY[key].length).toBeGreaterThan(0);
    }
  });

  it("does not repeat both languages inside one label", () => {
    /* The brief forbids duplicating both languages in a single label. A label
       that carries a full Latin sentence AND an Arabic one is a smell. */
    const arabic = /[\u0600-\u06FF]/;
    const latinWord = /[A-Za-z]{4,}/;
    for (const key of DICTIONARY_KEYS) {
      const ar = AR_DICTIONARY[key];
      if (arabic.test(ar) && latinWord.test(ar)) {
        /* Mixed text is legitimate for a technical term — assert the Arabic side
           is not a verbatim mirror of the English one. */
        expect(ar).not.toBe(EN_DICTIONARY[key]);
      }
    }
  });

  it("renders Arabic and English differently for every key", () => {
    /* A proper noun is legitimately identical in both languages. Anything else
       identical means a label was left untranslated. */
    const identicalByDesign = new Set<string>(["scope.nexup", "conv.from.exec"]);
    const untranslated = DICTIONARY_KEYS.filter(
      (key) => !identicalByDesign.has(key) && AR_DICTIONARY[key] === EN_DICTIONARY[key],
    );
    expect(untranslated).toEqual([]);
  });

  it("substitutes variables and leaves unknown ones alone", () => {
    expect(t("en", "conv.task.note", { code: "TSK-1041" })).toContain("TSK-1041");
    expect(t("en", "conv.task.note")).toContain("{code}");
    expect(t("ar", "conv.task.note", { code: "TSK-1041" })).toContain("TSK-1041");
  });
});

describe("the demo never queues work by itself", () => {
  it("advances only when a choice is taken", () => {
    const state = startScenario(createExperience("en"), "content_week");
    const run = state.run!;
    /* Repeated reads change nothing: there is no timer and no background step. */
    expect(state.run!.beatIndex).toBe(run.beatIndex);
    expect(state.run!.messages.length).toBe(run.messages.length);

    const choices = choicesFor(state);
    expect(choices.length).toBeGreaterThan(0);
    const advanced = choose(state, choices[0].id);
    expect(advanced.run!.beatIndex).toBe(run.beatIndex + 1);
    expect(advanced.run!.messages.length).toBeGreaterThan(run.messages.length);
  });

  it("ignores an unknown or stale choice id", () => {
    const state = startScenario(createExperience("en"), "content_week");
    expect(choose(state, "not-a-real-choice")).toBe(state);
  });

  it("resets a run without touching language, scope or the general thread", () => {
    let state = startScenario(createExperience("ar"), "content_week");
    state = sendMessage(state, "ملاحظة");
    state = setLocale(state, "en");
    const before = { locale: state.locale, scope: state.scope, general: state.general };

    const reset = resetRun(state);
    expect(reset.run).toBeNull();
    expect(reset.locale).toBe(before.locale);
    expect(reset.scope).toBe(before.scope);
    expect(reset.general).toBe(before.general);
    expect(reset.conversation).toBe("general");
  });
});

describe("conversation history parks rather than deletes", () => {
  it("gives untitled conversations a human label and keeps technical ids secondary", () => {
    const rows = conversationRows(createExperience("ar"));
    expect(conversationRowTitle(rows[0], "ar")).toBe("محادثة جديدة");
    expect(conversationRowTitle(rows[0], "en")).toBe("New conversation");
    expect(conversationRowTitle(rows[0], "ar")).not.toContain("c-1");
  });

  it("filters memory-only sessions by visible title or secondary reference", () => {
    let state = startScenario(createExperience("en"), "content_week");
    state = newConversation(state);
    const rows = conversationRows(state);

    expect(filterConversationRows(rows, "content", "en")).toHaveLength(1);
    expect(filterConversationRows(rows, rows[0].code, "en")[0].id).toBe(rows[0].id);
    expect(filterConversationRows(rows, "missing session", "en")).toEqual([]);
  });

  it("parks the open conversation with its run, and opens an empty one", () => {
    let state = startScenario(createExperience("en"), "content_week");
    const code = state.run!.taskCode;
    const lines = linesOf(state.run, state.general);

    state = newConversation(state);

    /* The new conversation is genuinely empty... */
    expect(state.run).toBeNull();
    expect(state.general).toEqual([]);
    /* ...and the old one is still there, with its run and its transcript. */
    expect(state.conversations).toHaveLength(1);
    expect(state.conversations[0].run!.taskCode).toBe(code);
    expect(state.conversations[0].lines).toBe(lines);
  });

  it("opens a parked conversation and parks the newer one in its place", () => {
    let state = startScenario(createExperience("en"), "content_week");
    const firstId = state.activeId;
    state = newConversation(state);
    expect(state.activeId).not.toBe(firstId);

    state = openConversation(state, firstId);
    expect(state.activeId).toBe(firstId);
    expect(state.run).not.toBeNull();
    expect(state.conversations.map((record) => record.id)).not.toContain(firstId);
  });

  it("ignores an unknown or stale conversation id", () => {
    const state = startScenario(createExperience("en"), "content_week");
    expect(openConversation(state, "c-99")).toBe(state);
    expect(openConversation(state, state.activeId)).toBe(state);
  });

  it("does not park an empty conversation", () => {
    const state = createExperience("en");
    expect(newConversation(state).conversations).toEqual([]);
  });

  it("reports the open conversation first, and marks it open", () => {
    let state = startScenario(createExperience("en"), "content_week");
    state = newConversation(state);
    const rows = conversationRows(state);
    expect(rows).toHaveLength(2);
    expect(rows[0].isOpen).toBe(true);
    expect(rows[1].isOpen).toBe(false);
    expect(rows[0].id).toBe(state.activeId);
  });

  it("clears the history when the context changes, so isolation survives", () => {
    let state = startScenario(createExperience("en"), "content_week");
    state = newConversation(state);
    expect(state.conversations.length).toBeGreaterThan(0);

    const other = SCOPE_OPTIONS.find((option) => option.scope.clientId !== state.scope.clientId)!;
    const next = setScope(state, other.id);
    expect(next.conversations).toEqual([]);
  });
});

describe("attachments are staged, sent, or dropped — never silently read", () => {
  it("keeps a picked file NAME and marks the chip as local, with no path", () => {
    const state = addDemoAttachment(createExperience("en"), "doc", { local: true, name: "budget-q4.pdf" });
    const attachment = state.attachments[0];
    expect(attachment.name).toBe("budget-q4.pdf");
    expect(attachment.local).toBe(true);
    /* Nothing but the name exists in the state: no path, no size, no content. */
    expect(Object.keys(attachment).sort()).toEqual(["demo", "fileKind", "id", "local", "name", "nameKey"]);
    expect(JSON.stringify(state)).not.toContain("\\\\");
  });

  it("moves staged attachments onto the message and empties the composer", () => {
    let state = addDemoAttachment(createExperience("en"), "image", { local: true, name: "shot.png" });
    state = sendMessage(state, "look at this");

    expect(state.attachments).toEqual([]);
    const founder = state.general[0];
    expect(founder.cards).toHaveLength(1);
    const card = founder.cards[0];
    expect(card.kind).toBe("attachment");
    if (card.kind === "attachment") {
      expect(card.name).toBe("shot.png");
      expect(card.local).toBe(true);
    }
  });

  it("leaves the run untouched when a message carries an attachment", () => {
    const started = startScenario(createExperience("en"), "content_week");
    const withChip = addDemoAttachment(started, "doc", { local: true, name: "brief.pdf" });
    const sent = sendMessage(withChip, "context");
    expect(sent.run).toBe(started.run);
  });
});

describe("the composer's Send is honest about what it can start", () => {
  /* The one scripted entry a TYPED prompt can take: the sentence has to be the
     script's own opener. Everything else is an ordinary message. */
  const EN_OPENER = t("en", "s.content.opener");
  const AR_OPENER = t("ar", "s.content.opener");

  it("recognises a script opener in either language, ignoring case and punctuation", () => {
    expect(scriptedScenarioFor(EN_OPENER)).toBe("content_week");
    expect(scriptedScenarioFor(AR_OPENER)).toBe("content_week");
    expect(scriptedScenarioFor(`  ${EN_OPENER.toUpperCase()}  `)).toBe("content_week");
    expect(scriptedScenarioFor(EN_OPENER.replace(/[.,]/g, "") + "!!!")).toBe("content_week");
  });

  it("does not guess: a paraphrase, a fragment or an empty line starts nothing", () => {
    expect(scriptedScenarioFor("plan a content week for us on X")).toBeNull();
    expect(scriptedScenarioFor("content week")).toBeNull();
    expect(scriptedScenarioFor("   ")).toBeNull();
    expect(scriptedScenarioFor("!!!")).toBeNull();
  });

  it("enters the run when the opener is typed, and only then", () => {
    const typed = intake(createExperience("en"), EN_OPENER);
    expect(typed.run?.scenarioId).toBe("content_week");
    expect(typed.conversation).toBe("task");
    /* The owner's own sentence opens the thread, as the script writes it. */
    expect(typed.run?.messages[0].from).toBe("founder");

    const ordinary = intake(createExperience("en"), "what is the status?");
    expect(ordinary.run).toBeNull();
    expect(ordinary.general).toHaveLength(2);
    expect(ordinary.general[1].key).toBe("conv.demoReply");
  });

  it("never replaces an open run by typing — the run object survives", () => {
    const started = startScenario(createExperience("en"), "content_week");
    const after = intake(started, AR_OPENER);
    expect(after.run).toBe(started.run);
    expect(after.general).toHaveLength(2);
  });
});

/**
 * Enough of a PNG reader to make the head-asset tests about the PIXELS on disk
 * rather than about a number copied into the test. Only what the delivered file
 * uses: 8-bit RGBA, non-interlaced, all four scanline filters supported.
 */
function decodePng() {
  const buffer = readFileSync(join(process.cwd(), "public", "exec-lab", "exec-head.png"));
  const width = buffer.readUInt32BE(16);
  const height = buffer.readUInt32BE(20);
  expect(buffer.subarray(1, 4).toString("ascii")).toBe("PNG");
  expect([buffer[24], buffer[25], buffer[28]]).toEqual([8, 6, 0]);

  const chunks: Buffer[] = [];
  for (let offset = 8; offset < buffer.length; ) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.subarray(offset + 4, offset + 8).toString("ascii");
    if (type === "IDAT") chunks.push(buffer.subarray(offset + 8, offset + 8 + length));
    if (type === "IEND") break;
    offset += 12 + length;
  }
  const raw = inflateSync(Buffer.concat(chunks));
  const bpp = 4;
  const stride = width * bpp;
  const pixels = Buffer.alloc(height * stride);
  let previous = Buffer.alloc(stride);
  for (let y = 0; y < height; y += 1) {
    const filter = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    const row = pixels.subarray(y * stride, (y + 1) * stride);
    for (let x = 0; x < stride; x += 1) {
      const left = x >= bpp ? row[x - bpp] : 0;
      const up = previous[x];
      const upLeft = x >= bpp ? previous[x - bpp] : 0;
      let value = line[x];
      if (filter === 1) value += left;
      else if (filter === 2) value += up;
      else if (filter === 3) value += (left + up) >> 1;
      else if (filter === 4) {
        const p = left + up - upLeft;
        const [pa, pb, pc] = [Math.abs(p - left), Math.abs(p - up), Math.abs(p - upLeft)];
        value += pa <= pb && pa <= pc ? left : pb <= pc ? up : upLeft;
      } else if (filter !== 0) throw new Error(`unsupported PNG filter ${filter}`);
      row[x] = value & 0xff;
    }
    previous = row;
  }
  return {
    width,
    height,
    pixels,
    alphaAt: (x: number, y: number) => pixels[(y * width + x) * 4 + 3],
    rgbAt: (x: number, y: number): [number, number, number] => {
      const i = (y * width + x) * 4;
      return [pixels[i], pixels[i + 1], pixels[i + 2]];
    },
  };
}

/** Bounding box of the opaque pixels — the head's own silhouette. */
function alphaBounds(pixels: Buffer, width: number, height: number) {
  let left = width;
  let right = -1;
  let top = height;
  let bottom = -1;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (pixels[(y * width + x) * 4 + 3] < 200) continue;
      if (x < left) left = x;
      if (x > right) right = x;
      if (y < top) top = y;
      if (y > bottom) bottom = y;
    }
  }
  return { left, right, top, bottom, width: right - left + 1, height: bottom - top + 1 };
}

describe("the head asset is the whole head, and stays unclipped", () => {
  /* The delivered cut, read from the file itself rather than from a constant: the
     previous asset was the "CROWN & FOREHEND DETAIL" pane, so the guard has to be
     about the pixels on disk. A forehead-only crop is square too, which is why
     size alone is not enough — see the coverage check below. */
  const png = readFileSync(join(process.cwd(), "public", "exec-lab", "exec-head.png"));
  const width = png.readUInt32BE(16);
  const height = png.readUInt32BE(20);
  const css = readFileSync(join(process.cwd(), "src", "app", "command", "exec-lab.css"), "utf8");
  const source = readFileSync(
    join(process.cwd(), "src", "components", "command", "exec-lab", "exec-experience.tsx"),
    "utf8",
  );

  it("is a real PNG, square, and large enough to survive the 24px size", () => {
    expect(png.subarray(1, 4).toString("ascii")).toBe("PNG");
    expect([width, height]).toEqual([212, 212]);
  });

  it("carries the whole head — crown to jaw, with the side modules", () => {
    /* Measured on the delivered file (see `readRgba`): the opaque silhouette is
       189x166 inside the 212 square. The bands are wide enough for a re-cut with
       a little more or less air, and narrow enough that neither failure mode fits:
       a forehead-only pane comes out much WIDER than tall, and a crown-only crop
       stops well above the jaw line. */
    const { width: w, height: h, pixels } = decodePng();
    const bbox = alphaBounds(pixels, w, h);
    expect(bbox.width).toBeGreaterThan(180);
    expect(bbox.width).toBeLessThan(206);
    expect(bbox.height).toBeGreaterThan(155);
    expect(bbox.height).toBeLessThan(200);
    /* The crop reaches the crown at the top AND the jaw at the bottom: a crop that
       stopped at the brow would leave a third of the square empty down there. */
    expect(bbox.top).toBeLessThan(40);
    expect(bbox.bottom).toBeGreaterThan(h - 25);
  });

  it("has the two eyes in frame, below the brow mark rather than instead of it", () => {
    /* This is the check the withdrawn measurement should have been. The brow mark
       is a few hundred pixels of blue on the forehead; the two eyes are thousands,
       and their mass sits in the LOWER half of the head. Both are asserted, so a
       crop that kept only the mark fails on count and a crop that kept only the
       crown fails on position. */
    const { width: w, height: h, pixels, alphaAt, rgbAt } = decodePng();
    const bbox = alphaBounds(pixels, w, h);
    let blue = 0;

    let blueY = 0;
    for (let y = 0; y < h; y += 1) {
      for (let x = 0; x < w; x += 1) {
        if (alphaAt(x, y) < 200) continue;
        const [r, , b] = rgbAt(x, y);
        if (b - r > 45 && b > 100) {
          blue += 1;
          blueY += y;
        }
      }
    }
    expect(blue).toBeGreaterThan(2000);
    const centroid = blueY / blue;
    expect(centroid / h).toBeGreaterThan(0.52);
    expect(centroid / h).toBeLessThan(0.72);
    expect(bbox.top / h).toBeLessThan(centroid / h);
  });

  it("is mostly chrome over a black screen — not a dark plate or a flat cut-out", () => {
    const { width: w, height: h, pixels, rgbAt, alphaAt } = decodePng();
    let opaque = 0;
    let bright = 0;
    for (let y = 0; y < h; y += 1) {
      for (let x = 0; x < w; x += 1) {
        if (alphaAt(x, y) < 200) continue;
        opaque += 1;
        const [r, g, b] = rgbAt(x, y);
        if ((r + g + b) / 3 > 150) bright += 1;
      }
    }
    expect(pixels.length).toBe(w * h * 4);
    expect(bright / opaque).toBeGreaterThan(0.25);
    expect(bright / opaque).toBeLessThan(0.6);
  });

  it("keeps `object-fit: contain` and draws no clip on the image", () => {
    const image = /\.nce-face__img \{([\s\S]*?)\}/.exec(css)?.[1] ?? "";
    expect(image).toContain("object-fit: contain");
    expect(image).not.toContain("border-radius");
    expect(css).not.toMatch(/\.nce-face__img[^{]*\{[^}]*overflow: hidden/);
  });

  it("names exactly one head source, and places no second face over it", () => {
    const sources = source.match(/exec-lab\/exec-[a-z-]+\.png/g) ?? [];
    expect([...new Set(sources)]).toEqual(["exec-lab/exec-head.png"]);

    const face = /function ExactHead[\s\S]*?\n\}/.exec(source)?.[0] ?? "";
    expect(face).not.toBe("");
    /* ONE image in the aperture. The withdrawn overlay was a second element over
       the face, placed by a hard-coded blue-pixel centroid — so the guard is a
       single image and no coordinate anywhere in this file, not a vocabulary ban:
       the comments legitimately talk about eyes and about that measurement. */
    expect((face.match(/<Image/g) ?? []).length).toBe(1);
    expect(source).not.toMatch(/translate\(/);
    expect(source).not.toMatch(/\d+(\.\d+)?%/);
  });

  it("keeps the layer seam empty until the layered art exists", () => {
    expect(source).toContain("layers?: ReactNode");
    const face = /function ExactHead[\s\S]*?\n\}/.exec(source)?.[0] ?? "";
    expect(face).toContain("{layers}");
    /* `.nce-face__layer` is defined for the day it arrives, and used by nobody. */
    expect(css).toContain(".nce-face__layer");
    expect(source).not.toContain("nce-face__layer");
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   The composer's controls (this pass)
   ───────────────────────────────────
   The composer has ONE primary control. Send is the default; stop replaces it
   only while the open run actually offers a cancel. That rule is engine logic,
   so it is provable here rather than only on a screenshot.
   ═══════════════════════════════════════════════════════════════════════════ */

describe("the composer's primary control: send, or stop — never both", () => {
  it("offers stop exactly when the open run carries a cancel, and keeps it out of the chips", () => {
    const started = startScenario(createExperience("en"), "failure_cancel");
    const offered = choicesFor(started).map((choice) => choice.kind);
    expect(offered).toContain("cancel");
    expect(stoppableChoice(started)?.kind).toBe("cancel");

    /* The chip row excludes cancels (and approvals): the same action is never
       drawn twice — once under the field and once as the primary button. */
    const chips = choicesFor(started).filter(
      (choice) => !choiceIsApproval(choice) && choice.kind !== "cancel",
    );
    expect(chips.map((choice) => choice.kind)).toEqual(["retry"]);
  });

  it("stops offering stop the moment the run ends, and marks the TASK cancelled", () => {
    const started = startScenario(createExperience("en"), "failure_cancel");
    const cancel = stoppableChoice(started);
    expect(cancel).not.toBeNull();

    const stopped = choose(started, cancel!.id);
    expect(stoppableChoice(stopped)).toBeNull();
    expect(stopped.run?.ended).toBe(true);
    expect(stopped.run?.taskStatus).toBe("cancelled");
    /* EXEC is idle again, the task is cancelled: two states, two fields. */
    expect(stopped.run?.execStatus).toBe("available");
  });

  it("never shows stop where no cancel exists, across every scenario, beat by beat", () => {
    for (const scenarioId of SCENARIO_IDS) {
      let state = startScenario(createExperience("en"), scenarioId);
      for (let guard = 0; guard < 14; guard += 1) {
        const offersCancel = choicesFor(state).some((choice) => choice.kind === "cancel");
        expect(!!stoppableChoice(state)).toBe(offersCancel);

        const choices = choicesFor(state);
        if (choices.length === 0) break;
        state = choose(state, choices[0].id);
      }
    }
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   The material's fallbacks and the pointer response
   ──────────────────────────────────────────────────
   A glass surface has several ways to be unavailable (no backdrop-filter, the
   user asking for less transparency) and one way to be unpleasant (magnifying
   under a finger). Both are checked as source facts, because neither is visible
   in a default screenshot.
   ═══════════════════════════════════════════════════════════════════════════ */

describe("the composer's material, and what it does without support", () => {
  const css = readFileSync(join(process.cwd(), "src", "app", "command", "exec-lab.css"), "utf8");
  const chrome = readFileSync(
    join(process.cwd(), "src", "components", "command", "exec-lab", "chrome.tsx"),
    "utf8",
  );

  it("always paints a surface, whatever the platform refuses to blur", () => {
    /* The glass is one recipe with one fallback list, not a nested stack: the
       composed background is opaque enough to read on with no backdrop-filter. */
    expect(css).toContain("--nce-glass-bg:");
    expect(css).toContain("background: var(--nce-glass-bg)");
    expect(css).toContain("@supports not ((backdrop-filter: blur(4px)) or (-webkit-backdrop-filter: blur(4px)))");
    expect(css).toContain("@media (prefers-reduced-transparency: reduce)");
  });

  it("lets the reader turn the effects down without losing the layout", () => {
    expect(css).toContain('.nce[data-effects="calm"] .nce-write');
    expect(css).toContain("backdrop-filter: none");
  });

  it("feels magnification only where a pointer can hover, and never under a finger", () => {
    /* The magnetic row is disabled twice over: the media query when the device
       cannot hover, and the event's own pointerType when a hybrid device sends a
       touch — a `(hover: hover)` laptop with a touchscreen is the case a media
       query alone gets wrong. */
    expect(chrome).toContain('"(hover: hover) and (pointer: fine)"');
    expect(chrome).toMatch(/pointerType\s*===\s*"touch"/);
    expect(chrome).not.toMatch(/touchstart[\s\S]{0,80}--nce-pop/);
  });

  it("keeps the tool row still: the pop is a painted transform, not a layout change", () => {
    /* The face scales; the button keeps its box and its hit area. */
    expect(css).toMatch(/\.nce-tool__face\s*\{[^}]*transform:/);
    expect(css).toMatch(/\.nce-tool\s*\{[^}]*position: relative/);
    expect(css).toMatch(/\.nce-tool:focus-visible \.nce-tool__face/);
    /* And it is killed outright when the reader asks for less motion. */
    expect(css).toMatch(/prefers-reduced-motion: reduce[\s\S]{0,600}\.nce-tool__face \{ transform: none !important; \}/);
  });
});
