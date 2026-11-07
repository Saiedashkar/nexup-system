/**
 * NEXUP COMMAND — THE DEMO ADAPTER (and the seam Step 6 replaces)
 * ───────────────────────────────────────────────────────────────
 * ONE interface feeds the whole Product Lab:
 *
 *     CommandAdapter  ←  DemoCommandAdapter   (today: local typed data)
 *                     ←  NexupQueryAdapter    (Step 6: the real read model)
 *
 * Every surface reads through `useCommandData()`, which reads through this
 * interface. Replacing the implementation is therefore a one-line change in the
 * store — no component, no page and no style touches the data source directly.
 *
 * WHAT THIS ADAPTER IS NOT: it does not fetch, does not execute, does not call a
 * provider and does not touch a database. `decide()` and `sendToExec()` mutate a
 * local object graph and return the result; the store applies it. That is the
 * whole runtime.
 */

import { createTranslator, type LocaleValue } from "../../i18n/command-locale";
import { en } from "../../i18n/messages";
import { demoDataset } from "./dataset";
import type {
  ActivityEvent,
  CommandDataset,
  Decision,
  ExecTurn,
  Mission,
} from "./types";

/**
 * The translator this adapter composes with.
 *
 * A reply is assembled from dictionary keys rather than English literals, so it
 * is written once and reads correctly in both languages. `t` is optional: with
 * no argument the adapter uses the English source of truth, which is what keeps
 * it usable outside React and what its tests read; the store passes the live
 * translator in, so an Arabic reader gets Arabic answers to the same question.
 */
type Translate = LocaleValue["t"];

const english = createTranslator(en);

/* ── Adapter state ──────────────────────────────────────────────────────── */

/**
 * The four states a reviewer needs to be able to hold the UI in. `empty` and
 * `degraded` are not decorative: they are the states real reads fail into, and
 * the surfaces have to survive them.
 */
export type DemoState = "ready" | "loading" | "empty" | "degraded";

export const DEMO_STATES: Array<{ id: DemoState; label: string; note: string }> = [
  { id: "ready", label: "Ready", note: "The full operating picture." },
  { id: "loading", label: "Loading", note: "Every surface in its reading state." },
  { id: "empty", label: "Empty", note: "A brand-new organization with no work yet." },
  { id: "degraded", label: "Degraded", note: "Reads delivered late, with stale sections." },
];

/** The store's own state — what the UI renders against. */
export type StoreState = "loading" | "ready" | "empty" | "degraded" | "error";

export type ReadResult = {
  state: StoreState;
  dataset: CommandDataset;
  /** Set when the read is `degraded`, so the surface can say which part failed. */
  warning?: string;
};

/* ── The interface ──────────────────────────────────────────────────────── */

export interface CommandAdapter {
  /** Stable id so the UI can name its own source ("demo-adapter"). */
  readonly id: string;
  readonly label: string;
  /** Read the whole operating picture, in one request. */
  read(demoState: DemoState): Promise<ReadResult>;
  /**
   * Local decision mutation. Returns the settled decision + the audit event.
   *
   * `t` is how the adapter speaks the active language without knowing about
   * React; omitting it composes English from the source-of-truth dictionary.
   */
  decide(
    dataset: CommandDataset,
    decisionId: string,
    outcome: "approved" | "rejected",
    note?: string,
    t?: Translate,
  ): { decision: Decision; event: ActivityEvent };
  /**
   * Deterministic local reply. There is no model here: the answer is selected
   * from the dataset's own state, which is exactly why it never lies.
   */
  reply(dataset: CommandDataset, input: string, t?: Translate): ExecTurn;
}

/* ── Builders ───────────────────────────────────────────────────────────── */

/** An empty organization: no missions, no decisions, no agents, no history. */
function emptyDataset(): CommandDataset {
  const base = demoDataset();
  return {
    ...base,
    missions: [],
    agents: [],
    decisions: [],
    projects: [],
    clients: [],
    activity: [],
    exec: {
      greeting:
        "Nothing is assigned yet. The organization is empty — create a mission and I will route it to the department that owns it.",
      turns: [
        {
          id: "e-empty",
          from: "exec",
          at: "—",
          kind: "text",
          text: "Nothing is assigned yet. The organization is empty — create a mission and I will route it to the department that owns it.",
          cards: [],
          actions: [
            { id: "ea-empty-1", label: "What can you do?", kind: "ask", prompt: "What can you do?" },
          ],
        },
      ],
    },
  };
}

/**
 * A degraded read: the shape is complete but one region did not answer. The
 * surfaces render their rows; the header says which region is stale. This is the
 * honest version of a partial failure, so the UI is built for it now.
 */
function degradedDataset(): CommandDataset {
  const base = demoDataset();
  return {
    ...base,
    activity: base.activity.slice(0, 6),
    exec: {
      ...base.exec,
      greeting:
        "One region did not answer on this read. I have the missions and the decision queue; the activity log is stale.",
    },
  };
}

/* ── Latency ────────────────────────────────────────────────────────────── */

/**
 * A deliberate, small delay so the loading states are real rather than
 * theoretical. Kept in the adapter, never in a component.
 */
const READ_DELAY_MS = 320;

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/* ── The demo implementation ────────────────────────────────────────────── */

export const demoCommandAdapter: CommandAdapter = {
  id: "demo-adapter",
  label: "Demo adapter · local typed data",

  async read(demoState) {
    await wait(READ_DELAY_MS);

    if (demoState === "empty") {
      return { state: "empty", dataset: emptyDataset(), warning: "No work exists yet." };
    }
    if (demoState === "degraded") {
      return {
        state: "degraded",
        dataset: degradedDataset(),
        warning: "The activity log did not answer — showing the last known window.",
      };
    }
    /* `loading` resolves into the full picture: the loading state itself is held
       by the store before this resolves. */
    return { state: "ready", dataset: demoDataset() };
  },

  decide(dataset, decisionId, outcome, note, t = english) {
    const decision = dataset.decisions.find((d) => d.id === decisionId);
    if (!decision) throw new Error(`Unknown decision: ${decisionId}`);

    const settled: Decision = {
      ...decision,
      status: outcome,
      decidedAt: "just now",
      decidedBy: "Founder",
      note: note ?? (outcome === "rejected" ? "Rejected from the Decision Center." : undefined),
    };

    const mission = dataset.missions.find((m) => m.id === decision.missionId);

    return {
      decision: settled,
      event: {
        id: `a-${decision.id}-${outcome}`,
        at: "just now",
        time: "just now",
        kind: "approval",
        severity: outcome === "approved" ? "info" : "notice",
        actor: "Founder",
        actorKind: "human",
        text: t(
          outcome === "approved" ? "execReply.decisionApprovedEvent" : "execReply.decisionRejectedEvent",
          { title: decision.title },
        ),
        departmentId: decision.departmentId,
        missionId: mission?.id,
        href: "/command/decisions",
      },
    };
  },

  reply(dataset, input, t = english) {
    const question = input.trim().toLowerCase();
    const pending = dataset.decisions.filter((d) => d.status === "pending");
    const blocked = dataset.missions.filter((m) => m.status === "blocked");
    const waiting = dataset.missions.filter((m) => m.status === "waiting");
    const active = dataset.missions.filter((m) =>
      ["active", "review", "planned"].includes(m.status),
    );
    const agents = dataset.agents.filter((a) => a.tier !== "executive");
    const humans = agents.filter((a) => a.tier === "director" || a.tier === "manager");
    const ai = agents.filter((a) => !(a.tier === "director" || a.tier === "manager"));

    const base = {
      id: `e-${dataset.exec.turns.length + 1}`,
      from: "exec" as const,
      at: "now",
      cards: [],
      actions: [] as ExecTurn["actions"],
    };

    /* The router reads both languages: a direction typed in Arabic has to reach
       the same branch as its English equivalent, or the console answers a
       different question than the one it was asked. */

    /* Ask about the queue. */
    if (/need|today|priorit|attention|focus|يحتاج|اليوم|أولو|انتباه|تركيز/.test(question)) {
      const top = pending[0];
      return {
        ...base,
        kind: "text",
        text: top
          ? t("execReply.queueText", {
              count: pending.length,
              title: top.title,
              impact: top.impact,
            })
          : t("execReply.queueEmpty"),
        cards: [
          { id: "rc1", label: t("execReply.queueCardDecisions"), value: String(pending.length), note: t("execReply.queueCardDecisionsNote"), tone: "attention" },
          { id: "rc2", label: t("execReply.queueCardBlocked"), value: String(blocked.length), note: t("execReply.queueCardBlockedNote"), tone: blocked.length ? "attention" : "positive" },
          { id: "rc3", label: t("execReply.queueCardRunning"), value: String(active.length), note: t("execReply.queueCardRunningNote"), tone: "positive" },
        ],
        actions: [
          { id: "ra1", label: t("execReply.queueActionQueue"), kind: "open", href: "/command/decisions" },
          { id: "ra2", label: t("execReply.queueActionWhy"), kind: "ask", prompt: t("execReply.queueActionWhy") },
        ],
      };
    }

    /* Ask about a blockage. */
    if (/block|stuck|stall|why is|معطّ|معلّق|عالق|متوقف|لماذا/.test(question)) {
      const mission = blocked[0] ?? waiting[0];
      return {
        ...base,
        kind: "escalation",
        text: mission
          ? t("execReply.blockedText", {
              title: mission.title,
              state:
                mission.status === "blocked"
                  ? t("execReply.stateBlocked")
                  : t("execReply.stateWaiting"),
              reason:
                mission.blockedReason ?? mission.waitingOn ?? t("execReply.reasonNotRecorded"),
            })
          : t("execReply.blockedEmpty"),
        cards: mission
          ? [
              { id: "bc1", label: t("execReply.blockedCardMission"), value: mission.code, note: mission.title, tone: "neutral" },
              { id: "bc2", label: t("execReply.blockedCardDepartment"), value: mission.departmentId, note: mission.owner, tone: "neutral" },
              { id: "bc3", label: t("execReply.blockedCardHeldFor"), value: mission.updatedAt, note: t("execReply.blockedCardHeldNote"), tone: "attention" },
            ]
          : [],
        actions: mission
          ? [
              { id: "ba1", label: t("execReply.blockedActionOpen", { code: mission.code }), kind: "open", href: `/command/missions/${mission.id}` },
              { id: "ba2", label: t("execReply.blockedActionSee"), kind: "open", href: "/command/decisions", targetId: mission.decisionIds[0] },
            ]
          : [],
      };
    }

    /* Ask about models / spend. Checked BEFORE the workforce branch: a question
       that mentions both ("what are the agents running on?") is about the
       registry, and routing it to the directory would answer a different one. */
    if (/model|spend|cost|runtime|quota|intelligence|running on|نموذج|نماذج|إنفاق|كلفة|حصة|ذكاء/.test(question)) {
      const near = dataset.models.filter((m) => m.quota.state === "near-limit" || m.quota.state === "exhausted");
      return {
        ...base,
        kind: "text",
        text: t("execReply.modelsText", {
          count: dataset.models.length,
          near: near.length,
        }),
        cards: near.map((m, i) => ({
          id: `mc${i}`,
          label: m.name,
          value: `${m.quota.usedPct}%`,
          note: m.quota.note,
          tone: m.quota.state === "exhausted" ? "attention" : "neutral",
        })),
        actions: [
          { id: "ma1", label: t("execReply.modelsActionRegistry"), kind: "open", href: "/command/models" },
          { id: "ma2", label: t("execReply.modelsActionDecision"), kind: "open", href: "/command/decisions", targetId: "d-04" },
        ],
      };
    }

    /* Ask about the workforce. */
    if (/who|agent|workforce|team|capacity|busy|وكيل|وكلاء|القوى العاملة|فريق|سعة|مشغول/.test(question)) {
      const busiest = [...ai].sort((a, b) => b.workload.utilisation - a.workload.utilisation)[0];
      return {
        ...base,
        kind: "text",
        text: `${t("execReply.workforceText", { agents: ai.length, leads: humans.length })} ${
          busiest
            ? t("execReply.workforceBusiest", {
                name: busiest.name,
                percent: busiest.workload.utilisation,
                queued: busiest.workload.queuedTasks,
              })
            : t("execReply.workforceNothingLoaded")
        }`,
        cards: [
          { id: "wc1", label: t("execReply.workforceCardAgents"), value: String(ai.length), note: t("execReply.workforceCardAgentsNote"), tone: "intelligence" },
          { id: "wc2", label: t("execReply.workforceCardLeads"), value: String(humans.length), note: t("execReply.workforceCardLeadsNote"), tone: "neutral" },
          { id: "wc3", label: t("execReply.workforceCardBusiest"), value: busiest ? `${busiest.workload.utilisation}%` : "—", note: busiest?.name ?? "", tone: "attention" },
        ],
        actions: [
          { id: "wa1", label: t("execReply.workforceActionOpen"), kind: "open", href: "/command/workforce" },
          { id: "wa2", label: t("execReply.workforceActionAsk"), kind: "ask", prompt: t("execReply.workforceActionAsk") },
        ],
      };
    }

    /* Ask about systems. */
    if (/system|connect|integration|supabase|hermes|bridge|api|نظام|أنظمة|ربط|تكامل|متصل/.test(question)) {
      const blockedSystems = dataset.systems.filter((s) =>
        ["BLOCKED", "MISSING", "NEEDS_APPROVAL"].includes(s.state),
      );
      return {
        ...base,
        kind: "text",
        text: t("execReply.systemsText", {
          count: dataset.systems.length,
          blocked: blockedSystems.length,
        }),
        cards: dataset.systems.slice(0, 3).map((s, i) => ({
          id: `sc${i}`,
          label: s.name,
          value: s.state.replace("_", " "),
          note: s.stateDetail,
          tone: s.state === "CONNECTED" ? "positive" : "attention",
        })),
        actions: [
          { id: "sa1", label: t("execReply.systemsActionMap"), kind: "open", href: "/command/systems" },
          { id: "sa2", label: t("execReply.systemsActionMissing"), kind: "ask", prompt: t("execReply.systemsAskMissing") },
        ],
      };
    }

    /* Fallback: the honest operating summary. */
    return {
      ...base,
      kind: "text",
      text: t("execReply.fallbackText", {
        active: active.length,
        pending: pending.length,
        blocked: blocked.length,
        people: dataset.agents.length,
      }),
      cards: [
        { id: "fc1", label: t("execReply.fallbackCardMissions"), value: String(dataset.missions.length), note: t("execReply.fallbackCardMissionsNote", { active: active.length }), tone: "neutral" },
        { id: "fc2", label: t("execReply.fallbackCardDecisions"), value: String(pending.length), note: t("execReply.fallbackCardDecisionsNote"), tone: pending.length ? "attention" : "positive" },
        { id: "fc3", label: t("execReply.fallbackCardSystems"), value: String(dataset.systems.length), note: t("execReply.fallbackCardSystemsNote"), tone: "intelligence" },
      ],
      actions: [
        { id: "fa1", label: t("execReply.fallbackActionNeedsMe"), kind: "ask", prompt: t("execReply.fallbackActionNeedsMe") },
        { id: "fa2", label: t("execReply.fallbackActionMission"), kind: "open", href: "/command/missions" },
      ],
    };
  },
};

/** The adapter the store uses. Swap THIS line for the real read model in Step 6. */
export const commandAdapter: CommandAdapter = demoCommandAdapter;

/* ── Pure helpers the store applies ─────────────────────────────────────── */

/** Apply a settled decision + its audit event to a dataset, immutably. */
export function applyDecision(
  dataset: CommandDataset,
  decision: Decision,
  event: ActivityEvent,
): CommandDataset {
  return {
    ...dataset,
    decisions: dataset.decisions.map((d) => (d.id === decision.id ? decision : d)),
    activity: [event, ...dataset.activity],
  };
}

/** Apply a new EXEC turn to a dataset, immutably. */
export function applyTurn(dataset: CommandDataset, turn: ExecTurn): CommandDataset {
  return { ...dataset, exec: { ...dataset.exec, turns: [...dataset.exec.turns, turn] } };
}

/** A mission with its decision list resolved — what a detail page renders. */
export function missionDecisions(dataset: CommandDataset, mission: Mission): Decision[] {
  return dataset.decisions.filter(
    (d) => d.missionId === mission.id || mission.decisionIds.includes(d.id),
  );
}
