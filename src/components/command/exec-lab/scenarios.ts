/**
 * NEXUP COMMAND — EXEC EXPERIENCE · SCENARIO SCRIPTS
 * ────────────────────────────────────────────────
 * Seven deterministic demo runs, written as explicit BEATS and explicit CHOICES.
 *
 * There is no timer, no promise and no effect anywhere in this file. A run moves
 * only when a reviewer presses something, which is what makes it safe to review:
 * nothing on this surface can claim progress that nobody caused.
 *
 * EXEC's state and the task's state are declared SEPARATELY on every beat. A step
 * finishing is a task event; EXEC returning to `available` is EXEC's own state.
 * The two are never collapsed into one.
 *
 * `Choice.to` is an INDEX into the same scenario's `beats` array, or `"end"`.
 * Because beats are a flat list, an out-of-range index is caught by
 * `tests/exec-experience.test.ts` rather than trusted.
 */

import type { MessageKey } from "./i18n";
import type { ActivityKind, Card, Emit, Scenario, ScenarioId } from "./types";

/* ── Builders, so a beat reads as data rather than as code ─────────────── */

function exec(key: MessageKey, cards?: Card[]): Emit {
  return cards && cards.length > 0 ? { type: "exec", key, cards } : { type: "exec", key };
}

function event(kind: ActivityKind, key: MessageKey, causedByUser?: boolean): Emit {
  return causedByUser ? { type: "event", kind, key, causedByUser: true } : { type: "event", kind, key };
}

function delegation(
  id: string,
  ownerId: "growth" | "creative" | "operations",
  deliverableKey: MessageKey,
  authorityKey: MessageKey,
  dueKey: MessageKey,
): Card {
  return { kind: "delegation", id, ownerId, deliverableKey, authorityKey, dueKey };
}

function resultCard(id: string, rows: Array<{ labelKey: MessageKey; valueKey: MessageKey }>): Card {
  return { kind: "result", id, rows, noPublishKey: "card.result.noPublish" };
}

function launchResultCard(id: string, goalValueKey: MessageKey): Card {
  return {
    kind: "result",
    id,
    titleKey: "s.launch.result.title",
    descriptionKey: "s.launch.result.description",
    noPublishKey: "s.launch.result.noPublish",
    rows: [
      { labelKey: "s.launch.result.goal.label", valueKey: goalValueKey },
      { labelKey: "s.launch.result.audience.label", valueKey: "s.launch.result.audience.value" },
      { labelKey: "s.launch.result.next.label", valueKey: "s.launch.result.next.value" },
    ],
  };
}

function gateCard(id: string, prefix: "s.content" | "s.approval", cost: number): Card {
  return {
    kind: "gate",
    id,
    titleKey: prefix === "s.content" ? "s.content.gate.title" : "s.approval.gate.title",
    bodyKey: prefix === "s.content" ? "s.content.gate.body" : "s.approval.gate.body",
    authorityKey: prefix === "s.content" ? "s.content.gate.authority" : "s.approval.gate.authority",
    cost,
  };
}

const CONTENT_WEEK_PLAN: Card = {
  kind: "plan",
  id: "plan-cw",
  steps: [
    { id: "s1", titleKey: "s.content.plan.step.angles", ownerId: "growth", dependsOn: [], state: "queued" },
    { id: "s2", titleKey: "s.content.plan.step.visual", ownerId: "creative", dependsOn: [], state: "queued" },
    { id: "s3", titleKey: "s.content.plan.step.drafts", ownerId: "creative", dependsOn: ["s1", "s2"], state: "queued" },
    { id: "s4", titleKey: "s.content.plan.step.verify", ownerId: "exec", dependsOn: ["s3"], state: "queued" },
  ],
};

/* ═══════════════════════════════════════════════════════
   1 · Content week on X — the full flow (beats 0…10)
   ═══════════════════════════════════════════════════════ */

const contentWeek: Scenario = {
  id: "content_week",
  labelKey: "scen.content_week",
  summaryKey: "scen.content_week.summary",
  scope: { companyId: "nexup", clientId: "nexuq", projectId: "brand-week" },
  code: "TSK-1041",
  taskTitleKey: "s.content.task.title",
  opener: { type: "founder-script", key: "s.content.opener" },
  beats: [
    /* 0 — context, outcome, deliverables, success criterion */
    {
      id: "brief",
      status: "planning",
      task: "planned",
      activeTeam: ["exec"],
      emit: [
        exec("s.content.brief.msg", [
          {
            kind: "brief",
            id: "brief-cw",
            rows: [
              { labelKey: "s.content.brief.goal.label", valueKey: "s.content.brief.goal.value" },
              { labelKey: "s.content.brief.deliverables.label", valueKey: "s.content.brief.deliverables.value" },
              { labelKey: "s.content.brief.success.label", valueKey: "s.content.brief.success.value" },
              { labelKey: "s.content.brief.constraint.label", valueKey: "s.content.brief.constraint.value" },
            ],
          },
        ]),
      ],
      choices: [{ id: "cw-0-a", labelKey: "s.content.choice.showPlan", kind: "continue", to: 1 }],
    },

    /* 1 — the plan, and the single gate on it */
    {
      id: "plan",
      status: "needs_approval",
      task: "planned",
      showGraph: true,
      activeTeam: ["exec"],
      emit: [exec("s.content.plan.msg", [CONTENT_WEEK_PLAN, gateCard("gate-cw-plan", "s.content", 0)])],
      choices: [
        { id: "cw-1-approve", labelKey: "s.content.choice.approve", kind: "approve", to: 3, effect: "clear_blocked" },
        { id: "cw-1-change", labelKey: "s.content.choice.requestChange", kind: "reject", to: 2 },
      ],
    },

    /* 2 — one revision, then the gate closes again (bounded on purpose) */
    {
      id: "plan_revised",
      status: "needs_approval",
      task: "planned",
      showGraph: true,
      activeTeam: ["exec"],
      emit: [
        event("human", "s.content.ev.changeRequested", true),
        exec("s.content.plan.revised.msg", [CONTENT_WEEK_PLAN, gateCard("gate-cw-plan-2", "s.content", 0)]),
      ],
      choices: [{ id: "cw-2-approve", labelKey: "s.content.choice.approve", kind: "approve", to: 3, effect: "clear_blocked" }],
    },

    /* 3 — delegation: two independent owners, in parallel */
    {
      id: "delegate",
      status: "working",
      task: "working",
      activeTeam: ["growth", "creative"],
      emit: [
        event("agent", "s.content.ev.routed"),
        exec("s.content.delegate.msg", [
          delegation("del-g", "growth", "s.content.del.growth.deliverable", "s.content.del.growth.authority", "s.content.del.growth.due"),
          delegation("del-c", "creative", "s.content.del.creative.deliverable", "s.content.del.creative.authority", "s.content.del.creative.due"),
        ]),
      ],
      choices: [{ id: "cw-3-a", labelKey: "s.content.choice.run", kind: "continue", to: 4 }],
    },

    /* 4 — waiting on the delegated inputs, driven by explicit demo events */
    {
      id: "await_inputs",
      status: "waiting",
      task: "waiting",
      activeTeam: ["growth", "creative"],
      emit: [
        event("agent", "s.content.await.ev.growth"),
        event("agent", "s.content.await.ev.creative"),
        exec("s.content.await.msg"),
      ],
      choices: [{ id: "cw-4-a", labelKey: "s.content.choice.draft", kind: "continue", to: 5 }],
    },

    /* 5 — drafting, with a demo attachment that is never uploaded */
    {
      id: "draft",
      status: "working",
      task: "working",
      activeTeam: ["creative"],
      emit: [
        event("mission", "s.content.ev.draftStart"),
        exec("s.content.draft.msg", [
          { kind: "attachment", id: "att-cw", nameKey: "s.content.draft.attach", fileKind: "image", demo: true },
        ]),
      ],
      choices: [{ id: "cw-5-a", labelKey: "s.content.choice.review", kind: "continue", to: 6 }],
    },

    /* 6 — review */
    {
      id: "review",
      status: "reviewing",
      task: "review",
      activeTeam: ["exec"],
      emit: [event("mission", "s.content.review.ev.start"), exec("s.content.review.msg")],
      choices: [{ id: "cw-6-a", labelKey: "s.content.choice.inspect", kind: "continue", to: 7 }],
    },

    /* 7 — the review FINDS something. EXEC holds instead of publishing. */
    {
      id: "finding",
      status: "blocked",
      task: "blocked",
      reasonKey: "s.content.find.reason",
      activeTeam: ["growth"],
      emit: [
        event("error", "s.content.ev.found"),
        exec("s.content.find.msg", [
          {
            kind: "evidence",
            id: "ev-cw-1",
            claimKey: "s.content.ev.claim",
            sourceKey: "s.content.ev.source",
            state: "unsupported",
          },
        ]),
      ],
      choices: [{ id: "cw-7-a", labelKey: "s.content.choice.correct", kind: "continue", to: 8 }],
    },

    /* 8 — one bounded correction round */
    {
      id: "correction",
      status: "working",
      task: "working",
      activeTeam: ["growth", "creative"],
      emit: [
        event("agent", "s.content.ev.corrected"),
        exec("s.content.correct.msg", [
          {
            kind: "correction",
            id: "cor-cw-1",
            beforeKey: "s.content.corr.before",
            afterKey: "s.content.corr.after",
            boundKey: "s.content.corr.bound",
          },
        ]),
      ],
      choices: [{ id: "cw-8-a", labelKey: "s.content.choice.reverify", kind: "continue", to: 9 }],
    },

    /* 9 — re-verification */
    {
      id: "verification",
      status: "reviewing",
      task: "review",
      activeTeam: ["exec"],
      emit: [
        event("mission", "s.content.ev.verified"),
        exec("s.content.verify.msg", [
          {
            kind: "verification",
            id: "ver-cw-1",
            items: [
              { key: "s.content.verify.item.brief", state: "supported" },
              { key: "s.content.verify.item.deliverables", state: "supported" },
              { key: "s.content.verify.item.noPublish", state: "supported" },
              { key: "s.content.verify.item.cancel", state: "supported" },
            ],
          },
        ]),
      ],
      choices: [{ id: "cw-9-a", labelKey: "s.content.choice.result", kind: "continue", to: 10 }],
    },

    /* 10 — result. `completed` only AFTER verification, never before. */
    {
      id: "result",
      status: "completed",
      task: "completed",
      activeTeam: [],
      emit: [
        event("mission", "s.content.ev.completed"),
        exec("s.content.result.msg", [
          resultCard("res-cw", [
            { labelKey: "s.content.result.drafts.label", valueKey: "s.content.result.drafts.value" },
            { labelKey: "s.content.result.visual.label", valueKey: "s.content.result.visual.value" },
            { labelKey: "s.content.result.angles.label", valueKey: "s.content.result.angles.value" },
            { labelKey: "s.content.result.claims.label", valueKey: "s.content.result.claims.value" },
            { labelKey: "s.content.result.next.label", valueKey: "s.content.result.next.value" },
          ]),
        ]),
      ],
      choices: [],
    },
  ],
};

/* ═══════════════════════════════════════════════════════
   2 · Missing inputs
   ═══════════════════════════════════════════════════════ */

const missingInputs: Scenario = {
  id: "missing_inputs",
  labelKey: "scen.missing_inputs",
  summaryKey: "scen.missing_inputs.summary",
  scope: { companyId: "nexup", clientId: "atlas", projectId: "gulf-launch" },
  code: "TSK-1042",
  taskTitleKey: "s.inputs.task.title",
  opener: { type: "founder-script", key: "s.inputs.opener" },
  beats: [
    {
      id: "blocked",
      status: "blocked",
      task: "blocked",
      reasonKey: "s.inputs.blocks",
      activeTeam: ["exec"],
      emit: [
        exec("s.inputs.msg", [
          {
            kind: "required-inputs",
            id: "req-atlas",
            blocksKey: "s.inputs.blocks",
            items: ["s.inputs.item.logo", "s.inputs.item.palette", "s.inputs.item.voice"],
          },
        ]),
      ],
      choices: [{ id: "mi-0-a", labelKey: "s.inputs.choice.provide", kind: "continue", to: 1 }],
    },
    {
      id: "received",
      status: "working",
      task: "working",
      activeTeam: ["creative"],
      emit: [event("human", "s.inputs.ev.provided", true), exec("s.inputs.received.msg")],
      choices: [{ id: "mi-1-a", labelKey: "s.content.choice.draft", kind: "continue", to: 2 }],
    },
    {
      id: "done",
      status: "completed",
      task: "completed",
      activeTeam: [],
      emit: [
        event("mission", "s.content.ev.completed"),
        exec("s.inputs.done.msg", [resultCard("res-inputs", [{ labelKey: "s.inputs.result.label", valueKey: "s.inputs.result.value" }])]),
      ],
      choices: [],
    },
  ],
};

/* ═══════════════════════════════════════════════════════
   3 · Approval request — a commitment outside EXEC's authority
   ═══════════════════════════════════════════════════════ */

const approval: Scenario = {
  id: "approval",
  labelKey: "scen.approval",
  summaryKey: "scen.approval.summary",
  scope: { companyId: "nexup", clientId: "atlas", projectId: "gulf-launch" },
  code: "TSK-1043",
  taskTitleKey: "s.approval.task.title",
  opener: { type: "founder-script", key: "s.approval.opener" },
  beats: [
    {
      id: "gate",
      status: "needs_approval",
      task: "waiting",
      reasonKey: "s.approval.blocked.why",
      activeTeam: ["growth"],
      emit: [exec("s.approval.msg", [gateCard("gate-atlas", "s.approval", 12000)])],
      choices: [
        { id: "ap-0-yes", labelKey: "s.approval.choice.approve", kind: "approve", to: 1 },
        /* Beats 2 and 3 are the two OUTCOMES; declining lands on its own beat. */
        { id: "ap-0-no", labelKey: "s.approval.choice.reject", kind: "reject", to: 3 },
      ],
    },
    {
      id: "running",
      status: "working",
      task: "working",
      activeTeam: ["growth"],
      emit: [event("approval", "s.approval.ev.approved", true), exec("s.approval.running.msg")],
      choices: [{ id: "ap-1-a", labelKey: "s.content.choice.result", kind: "continue", to: 2 }],
    },
    {
      id: "settled",
      status: "completed",
      task: "completed",
      activeTeam: [],
      emit: [
        event("mission", "s.content.ev.completed"),
        exec("s.approval.running.msg", [
          resultCard("res-approval-ok", [{ labelKey: "s.approval.result.label", valueKey: "s.approval.result.value" }]),
        ]),
      ],
      choices: [],
    },
    {
      id: "declined",
      status: "failed",
      task: "failed",
      reasonKey: "s.approval.failed.why",
      activeTeam: [],
      emit: [event("approval", "s.approval.ev.rejected", true), exec("s.approval.rejected.msg")],
      choices: [],
    },
  ],
};

/* ═══════════════════════════════════════════════════════
   4 · Blocked on a dependency — two honest ways out
   ═══════════════════════════════════════════════════════ */

const blockedDependency: Scenario = {
  id: "blocked_dependency",
  labelKey: "scen.blocked_dependency",
  summaryKey: "scen.blocked_dependency.summary",
  scope: { companyId: "nexup", clientId: "dune", projectId: "retainer" },
  code: "TSK-1044",
  taskTitleKey: "s.blocked.task.title",
  opener: { type: "founder-script", key: "s.blocked.opener" },
  beats: [
    {
      id: "blocked",
      status: "blocked",
      task: "blocked",
      reasonKey: "s.blocked.reason",
      activeTeam: ["operations"],
      emit: [exec("s.blocked.msg")],
      choices: [
        { id: "bd-0-sub", labelKey: "s.blocked.choice.substitute", kind: "continue", to: 1 },
        { id: "bd-0-hold", labelKey: "s.blocked.choice.hold", kind: "continue", to: 3 },
      ],
    },
    {
      id: "substituted",
      status: "working",
      task: "working",
      activeTeam: ["operations"],
      emit: [event("human", "s.blocked.ev.substituted", true), exec("s.blocked.substituted.msg")],
      choices: [{ id: "bd-1-a", labelKey: "s.content.choice.result", kind: "continue", to: 2 }],
    },
    {
      id: "done",
      status: "completed",
      task: "completed",
      activeTeam: [],
      emit: [
        event("mission", "s.content.ev.completed"),
        exec("s.blocked.done.msg", [
          resultCard("res-blocked", [{ labelKey: "s.blocked.result.label", valueKey: "s.blocked.result.value" }]),
        ]),
      ],
      choices: [],
    },
    {
      id: "held",
      status: "waiting",
      task: "waiting",
      reasonKey: "s.blocked.held.task",
      activeTeam: ["operations"],
      emit: [event("human", "s.blocked.ev.held", true), exec("s.blocked.held.msg")],
      choices: [],
    },
  ],
};

/* ═══════════════════════════════════════════════════════
   5 · Failure and demo cancellation
   ═══════════════════════════════════════════════════════ */

const failureCancel: Scenario = {
  id: "failure_cancel",
  labelKey: "scen.failure_cancel",
  summaryKey: "scen.failure_cancel.summary",
  scope: { companyId: "nexup", clientId: "dune", projectId: "retainer" },
  code: "TSK-1045",
  taskTitleKey: "s.fail.task.title",
  opener: { type: "founder-script", key: "s.fail.opener" },
  beats: [
    {
      id: "failed",
      status: "failed",
      task: "failed",
      reasonKey: "s.fail.reason",
      activeTeam: ["operations"],
      emit: [
        event("error", "s.fail.ev.failed"),
        exec("s.fail.msg", [
          resultCard("res-fail", [{ labelKey: "s.fail.result.label", valueKey: "s.fail.result.value" }]),
        ]),
      ],
      choices: [
        { id: "fc-0-retry", labelKey: "s.fail.choice.retry", kind: "retry", to: 1 },
        /* Cancelling ends the run with NO beat: the effect decides the outcome. */
        { id: "fc-0-cancel", labelKey: "s.fail.choice.cancel", kind: "cancel", to: "end", effect: "cancel_task" },
      ],
    },
    {
      id: "ceiling",
      status: "failed",
      task: "failed",
      reasonKey: "s.fail.reason",
      activeTeam: [],
      emit: [event("error", "s.fail.ev.ceiling"), exec("s.fail.retry.msg")],
      choices: [{ id: "fc-1-cancel", labelKey: "s.fail.choice.cancel", kind: "cancel", to: "end", effect: "cancel_task" }],
    },
  ],
};

/* ═══════════════════════════════════════════════════════
   6 · Offline
   ═══════════════════════════════════════════════════════ */

const offline: Scenario = {
  id: "offline",
  labelKey: "scen.offline",
  summaryKey: "scen.offline.summary",
  scope: { companyId: "nexup", clientId: "nexuq", projectId: "brand-week" },
  code: "TSK-1046",
  taskTitleKey: "s.offline.task.title",
  unreachable: true,
  opener: { type: "founder-script", key: "s.offline.opener" },
  beats: [
    {
      id: "unreachable",
      status: "offline",
      task: "planned",
      reasonKey: "s.offline.reason",
      activeTeam: [],
      emit: [event("error", "s.offline.reason"), exec("s.offline.msg")],
      choices: [],
    },
  ],
};

/* ═══════════════════════════════════════════════════════
   7 · Launch brief — short visual-review conversation
   ═══════════════════════════════════════════════════════ */

const launchBrief: Scenario = {
  id: "launch_brief",
  labelKey: "scen.launch_brief",
  summaryKey: "scen.launch_brief.summary",
  scope: { companyId: "nexup", clientId: "nexuq", projectId: "brand-week" },
  code: "TSK-1047",
  taskTitleKey: "s.launch.task.title",
  opener: { type: "founder-script", key: "s.launch.opener" },
  beats: [
    {
      id: "goal",
      status: "planning",
      task: "planned",
      activeTeam: ["exec"],
      emit: [exec("s.launch.goal.msg")],
      choices: [
        { id: "lb-goal-leads", labelKey: "s.launch.goal.leads", kind: "continue", to: 1 },
        { id: "lb-goal-awareness", labelKey: "s.launch.goal.awareness", kind: "continue", to: 2 },
      ],
    },
    {
      id: "brief_leads",
      status: "available",
      task: "completed",
      activeTeam: ["exec"],
      emit: [exec("s.launch.brief.msg", [launchResultCard("result-launch-leads", "s.launch.result.goal.leads")])],
      choices: [],
    },
    {
      id: "brief_awareness",
      status: "available",
      task: "completed",
      activeTeam: ["exec"],
      emit: [exec("s.launch.brief.msg", [launchResultCard("result-launch-awareness", "s.launch.result.goal.awareness")])],
      choices: [],
    },
  ],
};

/* ═══════════════════════════════════════════════════════
   Registry
   ═══════════════════════════════════════════════════════ */

export const SCENARIO_IDS: ScenarioId[] = [
  "launch_brief",
  "content_week",
  "missing_inputs",
  "approval",
  "blocked_dependency",
  "failure_cancel",
  "offline",
];

export const SCENARIOS: Record<ScenarioId, Scenario> = {
  launch_brief: launchBrief,
  content_week: contentWeek,
  missing_inputs: missingInputs,
  approval,
  blocked_dependency: blockedDependency,
  failure_cancel: failureCancel,
  offline,
};

export function getScenario(id: ScenarioId): Scenario {
  return SCENARIOS[id];
}

/** The scenario list, in review order. */
export const SCENARIO_LIST: Scenario[] = SCENARIO_IDS.map((id) => SCENARIOS[id]);
