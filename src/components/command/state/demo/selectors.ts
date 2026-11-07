/**
 * NEXUP COMMAND — PRODUCT LAB SELECTORS
 * ─────────────────────────────────────
 * Every figure a surface renders is computed HERE, from the dataset, once. No
 * page sums its own rows, and no component owns a status vocabulary: the labels
 * and tones a status maps to live in this file, next to the type that defines
 * the status. That is what stops the Company Pulse on the Command Center
 * disagreeing with the count in the sidebar of Mission Control.
 *
 * Pure functions over `CommandDataset` — no React, no I/O, and therefore
 * directly testable (see tests/command-product-lab.test.ts).
 */

import type { DepartmentId } from "../organization-model";
/* Type-only, so it is erased: the state layer still has no RUNTIME dependency
   on the dictionary. It does depend on the dictionary's SHAPE, deliberately — a
   note key that does not exist is a compile error, not a blank line. */
import type { MessageKey } from "../../i18n/command-locale";
import type {
  ActivityEvent,
  ActivityKind,
  Agent,
  CommandDataset,
  Decision,
  Mission,
  MissionStatus,
  Priority,
  RiskLevel,
  SystemState,
} from "./types";

/* ── Status vocabulary ──────────────────────────────────────────────────── */

/** Label + tone for every mission state. The UI never invents one. */
export const MISSION_STATUS_META: Record<
  MissionStatus,
  { label: string; tone: string; hint: string }
> = {
  planned: { label: "Planned", tone: "--nc-text-3", hint: "Opened, not started" },
  active: { label: "Active", tone: "--nc-active", hint: "Moving without a gate" },
  waiting: { label: "Waiting", tone: "--nc-approval", hint: "Held for a human" },
  blocked: { label: "Blocked", tone: "--nc-blocked", hint: "Cannot move yet" },
  review: { label: "In review", tone: "--nc-thinking", hint: "Finished, not accepted" },
  completed: { label: "Completed", tone: "--nc-completed", hint: "Closed with an outcome" },
  failed: { label: "Failed", tone: "--nc-error", hint: "Stopped with a reason" },
};

export const PRIORITY_META: Record<Priority, { label: string; tone: string }> = {
  low: { label: "Low", tone: "--nc-text-3" },
  normal: { label: "Normal", tone: "--nc-text-2" },
  high: { label: "High", tone: "--nc-approval" },
  critical: { label: "Critical", tone: "--nc-error" },
};

export const RISK_META: Record<RiskLevel, { label: string; tone: string; weight: number }> = {
  low: { label: "Low", tone: "--nc-thinking", weight: 1 },
  medium: { label: "Medium", tone: "--nc-approval", weight: 2 },
  high: { label: "High", tone: "--nc-blocked", weight: 3 },
  critical: { label: "Critical", tone: "--nc-error", weight: 4 },
};

export const SYSTEM_STATE_META: Record<
  SystemState,
  { label: string; tone: string; hint: string }
> = {
  CONNECTED: { label: "Connected", tone: "--nc-completed", hint: "In use, and this surface may read it" },
  PARTIAL: { label: "Partial", tone: "--nc-thinking", hint: "The system exists; the Command read does not" },
  MOCK: { label: "Mock", tone: "--nc-violet", hint: "Modelled here and nowhere else" },
  MISSING: { label: "Missing", tone: "--nc-text-3", hint: "No client, no credential, no code" },
  BLOCKED: { label: "Blocked", tone: "--nc-blocked", hint: "Something outside this codebase is in the way" },
  NEEDS_APPROVAL: { label: "Needs approval", tone: "--nc-approval", hint: "Waiting on a human gate" },
};

export const AGENT_STATUS_META: Record<
  Agent["status"],
  { label: string; tone: string }
> = {
  active: { label: "Active", tone: "--nc-active" },
  thinking: { label: "Thinking", tone: "--nc-thinking" },
  waiting: { label: "Waiting", tone: "--nc-waiting" },
  idle: { label: "Idle", tone: "--nc-text-3" },
  blocked: { label: "Blocked", tone: "--nc-blocked" },
  offline: { label: "Offline", tone: "--nc-text-4" },
};

/** A mission is "live" when nothing has settled it yet. */
export const LIVE_MISSION_STATUSES: MissionStatus[] = [
  "planned",
  "active",
  "waiting",
  "blocked",
  "review",
];

export function isLiveMission(mission: Mission): boolean {
  return LIVE_MISSION_STATUSES.includes(mission.status);
}

/* ── Mission reads ──────────────────────────────────────────────────────── */

export function liveMissions(dataset: CommandDataset): Mission[] {
  return dataset.missions.filter(isLiveMission);
}

export function settledMissions(dataset: CommandDataset): Mission[] {
  return dataset.missions.filter((m) => !isLiveMission(m));
}

/**
 * The home's "current work" reading: every live mission, ordered by what needs a
 * human next — held work first, then review, then what is simply running — and
 * among equals by how little has moved.
 *
 * It lives here, beside the status vocabulary, because the desktop home and the
 * phone home must put the same mission at the top. Two surfaces with their own
 * sort would be two opinions about what is urgent, which is exactly the drift
 * this file exists to prevent.
 */
const CURRENT_WORK_ORDER: Record<MissionStatus, number> = {
  blocked: 0,
  waiting: 1,
  review: 2,
  active: 3,
  planned: 4,
  completed: 5,
  failed: 6,
};

export function currentWork(dataset: CommandDataset): Mission[] {
  return [...liveMissions(dataset)].sort(
    (a, b) =>
      CURRENT_WORK_ORDER[a.status] - CURRENT_WORK_ORDER[b.status] || a.progress - b.progress,
  );
}

export function missionsByStatus(dataset: CommandDataset): Record<MissionStatus, Mission[]> {
  const out = {
    planned: [], active: [], waiting: [], blocked: [], review: [], completed: [], failed: [],
  } as Record<MissionStatus, Mission[]>;
  for (const mission of dataset.missions) out[mission.status].push(mission);
  return out;
}

export function missionsForDepartment(dataset: CommandDataset, id: DepartmentId): Mission[] {
  return dataset.missions.filter((m) => m.departmentId === id);
}

/* ── Node standing ──────────────────────────────────────────────────────── */

/**
 * The state a SPACE (a department, or the core) is in, derived from the work it
 * owns rather than from a hand-kept field. The vocabulary is the shell's existing
 * `status.node.*` enum, so a derived state speaks the same language as every other
 * node in the product and is localised in the dictionary, not here.
 */
export type NodeStatus =
  | "IDLE"
  | "THINKING"
  | "ACTIVE"
  | "HANDOFF"
  | "WAITING"
  | "APPROVAL_REQUIRED"
  | "BLOCKED"
  | "COMPLETED"
  | "ERROR";

/** The colour for each state. The WORD always comes from `status.node.*`. */
export const NODE_STATUS_TONE: Record<NodeStatus, string> = {
  IDLE: "--nc-idle",
  THINKING: "--nc-thinking",
  ACTIVE: "--nc-active",
  HANDOFF: "--nc-handoff",
  WAITING: "--nc-waiting",
  APPROVAL_REQUIRED: "--nc-approval",
  BLOCKED: "--nc-blocked",
  COMPLETED: "--nc-completed",
  ERROR: "--nc-error",
};

/**
 * Everything the home's department card needs, from ONE read: the space's state,
 * how much work it owns, how much of that is held for a human, and how far its
 * live work has actually moved.
 *
 * Derived, never declared — a space that blocks a mission changes its own card.
 */
export function departmentStanding(dataset: CommandDataset, id: DepartmentId) {
  const missions = missionsForDepartment(dataset, id);
  const live = missions.filter(isLiveMission);
  const load = departmentLoad(dataset)[id] ?? { live: 0, held: 0 };
  const progress = live.length
    ? Math.round(live.reduce((sum, m) => sum + m.progress, 0) / live.length)
    : 0;

  let status: NodeStatus;
  if (live.some((m) => m.status === "blocked" || m.status === "failed")) status = "BLOCKED";
  else if (live.some((m) => m.status === "waiting")) status = "APPROVAL_REQUIRED";
  else if (live.some((m) => m.status === "review")) status = "HANDOFF";
  else if (live.some((m) => m.status === "active")) status = "ACTIVE";
  else if (live.length > 0) status = "IDLE";
  else status = missions.length > 0 ? "COMPLETED" : "IDLE";

  return { status, live: load.live, held: load.held, total: missions.length, progress };
}

/** The single most urgent live mission a space owns, or null when it owns none. */
export function topWork(dataset: CommandDataset, id: DepartmentId): Mission | null {
  return currentWork(dataset).find((m) => m.departmentId === id) ?? null;
}

/** Load per department: how many live missions, and how many are held. */
export function departmentLoad(dataset: CommandDataset) {
  return dataset.missions.reduce<Record<string, { live: number; held: number }>>((acc, m) => {
    const key = m.departmentId;
    acc[key] ??= { live: 0, held: 0 };
    if (isLiveMission(m)) acc[key].live += 1;
    if (m.status === "blocked" || m.status === "waiting") acc[key].held += 1;
    return acc;
  }, {});
}

/* ── The Company Pulse ──────────────────────────────────────────────────── */

export type PulseFigure = {
  id: string;
  label: string;
  value: string;
  note: string;
  /**
   * THE NOTE AS A TRANSLATABLE KEY, when the note interpolates a count.
   *
   * `note` is English prose, and `tc()` can only translate a string it can look
   * up EXACTLY — so `"across 6 departments"` could never be translated, and the
   * Arabic overview rendered an English fragment inside an Arabic figure. A
   * count has to be a placeholder, which means the sentence has to be a key.
   *
   * Both fields are kept: `note` stays the English source (and is still what a
   * consumer without a translator reads), `noteKey` is what a localized surface
   * renders through `t(noteKey, noteParams)`. A figure with a fixed note has no
   * `noteKey` and is still read through the content overlay.
   */
  noteKey?: MessageKey;
  noteParams?: Record<string, string | number>;
  tone: string;
  href?: string;
};

/**
 * The one honest summary of where the organization stands. Every number here has
 * a counterpart list on a page, and the note says which — so a founder reading
 * "7 waiting on you" can get to the seven rows in one click.
 */
export function companyPulse(dataset: CommandDataset): PulseFigure[] {
  const live = liveMissions(dataset);
  const blocked = dataset.missions.filter((m) => m.status === "blocked");
  const waiting = dataset.missions.filter((m) => m.status === "waiting");
  const pending = pendingDecisions(dataset);
  const activeAgents = dataset.agents.filter(
    (a) => a.status === "active" || a.status === "thinking",
  );
  const degradedSystems = dataset.systems.filter((s) =>
    ["BLOCKED", "MISSING", "NEEDS_APPROVAL", "MOCK"].includes(s.state),
  );

  return [
    {
      id: "missions",
      label: "Active missions",
      value: String(live.length),
      note: `across ${distinctDepartments(live).length} departments`,
      noteKey: "cc.pulse.acrossDepartments",
      noteParams: { count: distinctDepartments(live).length },
      tone: "--nc-growth",
      href: "/command/missions",
    },
    {
      id: "decisions",
      label: "Waiting on you",
      value: String(pending.length),
      note: pending.length === 1 ? "one decision" : `${pending.length} decisions`,
      noteKey: pending.length === 1 ? "cc.pulse.oneDecision" : "cc.pulse.decisions",
      noteParams: { count: pending.length },
      tone: "--nc-approval",
      href: "/command/decisions",
    },
    {
      id: "blocked",
      label: "Blocked",
      value: String(blocked.length),
      note: blocked.length ? "cannot move yet" : "nothing is stuck",
      noteKey: blocked.length ? "cc.pulse.blocked" : "cc.pulse.notStuck",
      tone: blocked.length ? "--nc-blocked" : "--nc-completed",
      href: "/command/missions",
    },
    {
      id: "workforce",
      label: "Workforce online",
      value: String(activeAgents.length),
      note: `${dataset.agents.filter((a) => a.tier !== "executive").length} registered`,
      noteKey: "cc.pulse.registered",
      noteParams: { count: dataset.agents.filter((a) => a.tier !== "executive").length },
      tone: "--nc-product",
      href: "/command/workforce",
    },
    {
      id: "systems",
      label: "Systems mapped",
      value: String(dataset.systems.length),
      note: `${degradedSystems.length} not fully usable`,
      noteKey: "cc.pulse.notUsable",
      noteParams: { count: degradedSystems.length },
      tone: "--nc-cyan",
      href: "/command/systems",
    },
    {
      id: "held",
      label: "Held for a human",
      value: String(blocked.length + waiting.length + pending.length),
      note: "blocked · waiting · decisions",
      noteKey: "cc.pulse.heldBreakdown",
      tone: "--nc-text-2",
      href: "/command/decisions",
    },
  ];
}

function distinctDepartments(missions: Mission[]): string[] {
  return Array.from(new Set(missions.map((m) => m.departmentId)));
}

/**
 * The Command Center BAND's own reading of the company — deliberately not a
 * repeat of the room's KPI row above it.
 *
 * The room already answers "how much work is there?". This answers "what state
 * is the machine in?": capacity, what is held, what is not usable yet, and what
 * has actually been settled. Two readings of one organization, no duplicated
 * figure, and every number still has a page behind it.
 */
export function operatingPulse(dataset: CommandDataset): PulseFigure[] {
  const workforce = workforceStatus(dataset);
  const health = systemHealth(dataset);
  const settled = dataset.missions.filter((m) => !isLiveMission(m)).length;
  const inReview = dataset.missions.filter((m) => m.status === "review").length;

  return [
    {
      id: "capacity",
      label: "Workforce load",
      value: `${workforce.averageUtilisation}%`,
      note: `${workforce.active + workforce.thinking} of ${workforce.total} carrying work`,
      noteKey: "cc.pulse.carryingWork",
      noteParams: { active: workforce.active + workforce.thinking, total: workforce.total },
      tone: workforce.averageUtilisation >= 75 ? "--nc-approval" : "--nc-completed",
      href: "/command/workforce",
    },
    {
      id: "clients",
      label: "Clients needing attention",
      value: String(clientAtRisk(dataset)),
      note: `of ${dataset.clients.length} relationships on watch`,
      noteKey: "cc.pulse.relationshipsOnWatch",
      noteParams: { count: dataset.clients.length },
      tone: clientAtRisk(dataset) > 0 ? "--nc-approval" : "--nc-completed",
      href: "/command/clients",
    },
    {
      id: "review",
      label: "In review",
      value: String(inReview),
      note: "finished, not accepted",
      noteKey: "cc.pulse.finishedNotAccepted",
      tone: "--nc-thinking",
      href: "/command/missions",
    },
    {
      id: "systems",
      label: "Systems not usable",
      value: String(health.degraded),
      note: `of ${health.total} mapped — mock, blocked or missing`,
      noteKey: "cc.pulse.systemsMapped",
      noteParams: { count: health.total },
      tone: "--nc-blocked",
      href: "/command/systems",
    },
    {
      id: "settled",
      label: "Settled missions",
      value: String(settled),
      note: "closed with an outcome",
      noteKey: "cc.pulse.settledOutcome",
      tone: "--nc-completed",
      href: "/command/missions",
    },
    {
      id: "registry",
      label: "Runtimes constrained",
      value: String(modelAvailabilitySummary(dataset).constrained),
      note: `of ${dataset.models.length} registered`,
      noteKey: "cc.pulse.ofRegistered",
      noteParams: { count: dataset.models.length },
      tone: "--nc-violet",
      href: "/command/models",
    },
  ];
}

/* ── Decisions ──────────────────────────────────────────────────────────── */

export function pendingDecisions(dataset: CommandDataset): Decision[] {
  return dataset.decisions.filter((d) => d.status === "pending");
}

export function decisionHistory(dataset: CommandDataset): Decision[] {
  return dataset.decisions.filter((d) => d.status !== "pending");
}

/** The queue, ordered by risk then age — the order a founder should work it. */
export function decisionQueue(dataset: CommandDataset): Decision[] {
  return [...pendingDecisions(dataset)].sort(
    (a, b) => RISK_META[b.risk].weight - RISK_META[a.risk].weight,
  );
}

export function decisionsForMission(dataset: CommandDataset, missionId: string): Decision[] {
  return dataset.decisions.filter((d) => d.missionId === missionId);
}

export function decisionRiskSummary(dataset: CommandDataset) {
  const queue = pendingDecisions(dataset);
  return {
    total: queue.length,
    critical: queue.filter((d) => d.risk === "critical").length,
    high: queue.filter((d) => d.risk === "high").length,
    other: queue.filter((d) => d.risk === "low" || d.risk === "medium").length,
  };
}

/* ── Workforce ──────────────────────────────────────────────────────────── */

export function workforceStatus(dataset: CommandDataset) {
  const agents = dataset.agents;
  const byTier = (tier: Agent["tier"]) => agents.filter((a) => a.tier === tier);
  return {
    total: agents.length,
    executive: byTier("executive").length,
    directors: byTier("director").length,
    managers: byTier("manager").length,
    specialists: byTier("specialist").length,
    active: agents.filter((a) => a.status === "active").length,
    thinking: agents.filter((a) => a.status === "thinking").length,
    waiting: agents.filter((a) => a.status === "waiting").length,
    idle: agents.filter((a) => a.status === "idle").length,
    blocked: agents.filter((a) => a.status === "blocked").length,
    averageUtilisation: agents.length
      ? Math.round(agents.reduce((sum, a) => sum + a.workload.utilisation, 0) / agents.length)
      : 0,
  };
}

/** The reporting tree the executive hierarchy renders, from `reportsTo`. */
export function agentReports(dataset: CommandDataset, id: string): Agent[] {
  return dataset.agents.filter((a) => a.reportsTo === id);
}

export function agentsForDepartment(dataset: CommandDataset, id: DepartmentId): Agent[] {
  return dataset.agents.filter((a) => a.scope === id);
}

export function overloadedAgents(dataset: CommandDataset, threshold = 80): Agent[] {
  return dataset.agents.filter((a) => a.workload.utilisation >= threshold);
}

/* ── Clients & projects ─────────────────────────────────────────────────── */

export function projectsForClient(dataset: CommandDataset, clientId: string) {
  return dataset.projects.filter((p) => p.clientId === clientId);
}

export function missionsForProject(dataset: CommandDataset, projectId: string) {
  return dataset.missions.filter((m) => m.projectId === projectId);
}

export function clientAtRisk(dataset: CommandDataset): number {
  return dataset.clients.filter((c) => c.status !== "healthy").length;
}

export function projectProgress(project: { missionIds: string[] }, dataset: CommandDataset): string {
  const missions = dataset.missions.filter((m) => project.missionIds.includes(m.id));
  if (!missions.length) return "No mission yet";
  const avg = Math.round(missions.reduce((sum, m) => sum + m.progress, 0) / missions.length);
  return `${avg}% across ${missions.length} mission${missions.length === 1 ? "" : "s"}`;
}

/* ── Systems ────────────────────────────────────────────────────────────── */

export function systemHealth(dataset: CommandDataset) {
  const counts = dataset.systems.reduce<Record<string, number>>((acc, s) => {
    acc[s.state] = (acc[s.state] ?? 0) + 1;
    return acc;
  }, {});
  const usable = (counts.CONNECTED ?? 0) + (counts.PARTIAL ?? 0);
  return {
    total: dataset.systems.length,
    counts,
    usable,
    /** "Not fully usable" is the honest phrase: partial is not the same as down. */
    degraded: dataset.systems.length - usable,
    blocked: counts.BLOCKED ?? 0,
    missing: counts.MISSING ?? 0,
  };
}

export function systemsForDepartment(dataset: CommandDataset, id: DepartmentId) {
  return dataset.systems.filter((s) => s.linkedDepartments.includes(id));
}

/* ── Models ─────────────────────────────────────────────────────────────── */

export function modelAvailabilitySummary(dataset: CommandDataset) {
  return {
    total: dataset.models.length,
    available: dataset.models.filter((m) => m.availability === "available").length,
    degraded: dataset.models.filter((m) => m.availability === "degraded").length,
    unavailable: dataset.models.filter((m) => m.availability === "unavailable").length,
    constrained: dataset.models.filter(
      (m) => m.quota.state === "near-limit" || m.quota.state === "exhausted",
    ).length,
    awaitingEntitlement: dataset.models.filter((m) => m.entitlement !== "entitled").length,
  };
}

export function modelDefaultRoles(dataset: CommandDataset) {
  return {
    defaults: dataset.models.filter((m) => m.roles.includes("default")),
    fallbacks: dataset.models.filter((m) => m.roles.includes("fallback")),
    escalations: dataset.models.filter((m) => m.roles.includes("escalation")),
  };
}

export function modelById(dataset: CommandDataset, id: string) {
  return dataset.models.find((m) => m.id === id);
}

/* ── Activity ───────────────────────────────────────────────────────────── */

export const ACTIVITY_KIND_META: Record<ActivityKind, { label: string; tone: string }> = {
  human: { label: "Human", tone: "--nc-human" },
  agent: { label: "Agent", tone: "--nc-lime" },
  mission: { label: "Mission", tone: "--nc-thinking" },
  approval: { label: "Approval", tone: "--nc-approval" },
  system: { label: "System", tone: "--nc-cyan" },
  finance: { label: "Finance", tone: "--nc-finance" },
  error: { label: "Error", tone: "--nc-error" },
};

export function activityByKind(dataset: CommandDataset): Array<{ kind: ActivityKind; events: ActivityEvent[] }> {
  const order: ActivityKind[] = ["human", "agent", "mission", "approval", "system", "finance", "error"];
  return order
    .map((kind) => ({ kind, events: dataset.activity.filter((e) => e.kind === kind) }))
    .filter((group) => group.events.length > 0);
}

/* ── The Command Center's quick actions ─────────────────────────────────── */

export type QuickActionId = "decide" | "mission" | "workforce" | "systems" | "models" | "talk";

export type QuickAction = {
  /** Typed as a union so the band's `quick.<id>` dictionary lookup is checked. */
  id: QuickActionId;
  label: string;
  hint: string;
  href: string;
  /** What this action would do, in the operator's words. */
  intent: string;
};

export const QUICK_ACTIONS: QuickAction[] = [
  { id: "decide", label: "Decide", hint: "Work the approval queue", href: "/command/decisions", intent: "Open the decision queue and settle what is held." },
  { id: "mission", label: "Mission Control", hint: "Every mission and its state", href: "/command/missions", intent: "Open every mission across the six departments." },
  { id: "workforce", label: "Workforce", hint: "Agents, roles and load", href: "/command/workforce", intent: "Open the agent directory and its hierarchy." },
  { id: "systems", label: "Systems", hint: "What is connected, honestly", href: "/command/systems", intent: "Open the connection map and its real states." },
  { id: "models", label: "Model Control", hint: "Registry, quota, fallbacks", href: "/command/models", intent: "Open the model registry and its entitlements." },
  { id: "talk", label: "Talk to EXEC", hint: "Ask the organization anything", href: "/command/exec/talk", intent: "Open the executive conversation surface." },
];
