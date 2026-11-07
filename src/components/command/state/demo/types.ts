/**
 * NEXUP COMMAND — PRODUCT LAB DOMAIN TYPES (demo layer)
 * ─────────────────────────────────────────────────────
 * These types are the CONTRACT between the product surfaces and whatever feeds
 * them. Today the feed is `DemoCommandAdapter` (local, typed, synchronous data
 * wrapped in a promise). In Step 6 the same types are produced by the real
 * NEXUP query adapter and nothing above this folder has to be redesigned.
 *
 * Rules this file exists to enforce:
 *   · no React, no I/O, no provider SDK — plain data shapes only;
 *   · every state word the UI can render is an enum here, so a component never
 *     invents a status vocabulary of its own;
 *   · a status that means "not real yet" is spelled out (`SystemState.MOCK`,
 *     `Entitlement.REQUIRES_APPROVAL`) rather than implied by a colour.
 */

import type { DepartmentId } from "../organization-model";

export type { DepartmentId };

/* ── Shared vocabulary ──────────────────────────────────────────────────── */

export type ActorKind = "human" | "agent";

export type Priority = "low" | "normal" | "high" | "critical";

export type RiskLevel = "low" | "medium" | "high" | "critical";

/** Every mission state the surfaces can render. */
export type MissionStatus =
  | "planned"
  | "active"
  | "waiting"
  | "blocked"
  | "review"
  | "completed"
  | "failed";

export type TaskState = "done" | "running" | "queued" | "waiting" | "blocked" | "failed";

export type AgentTier = "executive" | "director" | "manager" | "specialist";

export type AgentStatus = "active" | "thinking" | "waiting" | "idle" | "blocked" | "offline";

export type AutonomyLevel = "supervised" | "bounded" | "full";

export type DecisionStatus = "pending" | "approved" | "rejected" | "expired";

export type ActivityKind =
  | "human"
  | "agent"
  | "mission"
  | "approval"
  | "system"
  | "finance"
  | "error";

export type Severity = "info" | "notice" | "warning" | "critical";

/* ── Missions ───────────────────────────────────────────────────────────── */

export type MissionTask = {
  id: string;
  title: string;
  state: TaskState;
  /** Role-based owner label, matching the workforce directory. */
  owner: string;
  kind: ActorKind;
  /** Short operating note — what this step is doing or waiting for. */
  note: string;
  /** How long this step has been in its current state, human readable ("2h 10m"). */
  elapsed: string;
};

export type MissionTimelineEntry = {
  id: string;
  /** Clock label only — the demo never pretends to know a real timestamp. */
  at: string;
  kind: Exclude<ActivityKind, "finance">;
  actor: string;
  text: string;
};

export type Mission = {
  id: string;
  /** Human-facing reference, e.g. "MIS-2041". */
  code: string;
  title: string;
  /** One sentence: what "done" means. */
  objective: string;
  status: MissionStatus;
  priority: Priority;
  /** 0-100, illustrative. */
  progress: number;
  departmentId: DepartmentId;
  /** Owner label — a role, never a person's name. */
  owner: string;
  ownerKind: ActorKind;
  clientId?: string;
  projectId?: string;
  /** Agent ids assigned to this mission. */
  agents: string[];
  startedAt: string;
  dueAt: string;
  updatedAt: string;
  /** Why it is blocked or waiting — required by the UI when status demands it. */
  blockedReason?: string;
  waitingOn?: string;
  /** Present once the mission has an outcome. */
  result?: string;
  /** Intelligence class the mission may spend: links to the Model Control registry. */
  spendClass: "standard" | "deep" | "economy";
  tasks: MissionTask[];
  timeline: MissionTimelineEntry[];
  /** Decision ids raised inside this mission. */
  decisionIds: string[];
};

/* ── Workforce ──────────────────────────────────────────────────────────── */

export type AgentSkill = {
  id: string;
  name: string;
  level: "learning" | "proficient" | "expert";
  note: string;
};

export type AgentRuntime = {
  /** Id into the model registry — the UI resolves the label from there. */
  modelId: string;
  runtimeLabel: string;
  contextWindow: number;
  tools: string[];
  autonomy: AutonomyLevel;
  /** Placeholder quota read, mirroring the model registry. */
  quotaState: "ok" | "near-limit" | "exhausted" | "unmetered";
};

export type Agent = {
  id: string;
  name: string;
  /** Role title, e.g. "AI Growth Director". */
  role: string;
  /** Human or agent. The workforce is both, and the material says which. */
  kind: ActorKind;
  tier: AgentTier;
  status: AgentStatus;
  /** Where the agent sits. The executive core sits above departments. */
  scope: DepartmentId | "organization";
  /** Who this agent answers to — an agent id, or "exec" for the core. */
  reportsTo: string;
  initials: string;
  /** The single thing it is on right now. */
  currentFocus: string;
  missionIds: string[];
  capabilities: string[];
  skills: AgentSkill[];
  workload: {
    activeMissions: number;
    queuedTasks: number;
    /** 0-100. */
    utilisation: number;
  };
  performance: {
    /** 0-100. */
    successRate: number;
    decisionsRaised: number;
    avgCycle: string;
  };
  runtime: AgentRuntime;
  activity: MissionTimelineEntry[];
  onlineSince: string;
};

/* ── Decisions ──────────────────────────────────────────────────────────── */

export type Decision = {
  id: string;
  title: string;
  /** What will happen if approved — the sentence a founder actually reads. */
  requestedAction: string;
  /** Present when an agent raised the gate; absent for human-raised requests. */
  requestingAgentId?: string;
  /** Human requester label when the request came from a person. */
  requestedBy: string;
  missionId: string;
  departmentId: DepartmentId;
  risk: RiskLevel;
  /** Blast radius in words: money, clients, systems, reputation. */
  impact: string;
  /** Policy that raised the gate. */
  policy: string;
  createdAt: string;
  status: DecisionStatus;
  decidedAt?: string;
  decidedBy?: string;
  /** Set when the founder rejects — the reason is kept with the record. */
  note?: string;
};

/* ── Projects & clients ─────────────────────────────────────────────────── */

export type ProjectStatus = "discovery" | "active" | "review" | "on-hold" | "closed";

export type Project = {
  id: string;
  name: string;
  clientId: string;
  departmentId: DepartmentId;
  status: ProjectStatus;
  /** 0-100. */
  progress: number;
  missionIds: string[];
  agentIds: string[];
  nextMilestone: string;
  meta: string;
  updatedAt: string;
};

export type ClientTier = "VIP" | "LOYAL" | "NORMAL" | "AT_RISK";

export type Client = {
  id: string;
  name: string;
  tier: ClientTier;
  status: "healthy" | "watch" | "at-risk";
  industry: string;
  since: string;
  /** 0-100 relationship health — illustrative. */
  healthScore: number;
  projectIds: string[];
  missionIds: string[];
  openItems: string[];
  owner: string;
  note: string;
};

/* ── Systems ────────────────────────────────────────────────────────────── */

/**
 * The SIX operating states a connection can be in. `MOCK` and `MISSING` are the
 * honest ones: this prototype is not wired to any of these systems, and the
 * surface says so rather than showing a green dot it cannot justify.
 */
export type SystemState =
  | "CONNECTED"
  | "PARTIAL"
  | "MOCK"
  | "MISSING"
  | "BLOCKED"
  | "NEEDS_APPROVAL";

export type SystemCategory =
  | "Data"
  | "Runtime"
  | "Delivery"
  | "Code"
  | "Distribution"
  | "Comms"
  | "Business";

export type SystemIntegration = {
  id: string;
  name: string;
  category: SystemCategory;
  mark: string;
  state: SystemState;
  /** What this system is for, in the operator's words. */
  purpose: string;
  capabilities: string[];
  owner: string;
  /** Which department reaches it. */
  linkedDepartments: DepartmentId[];
  /** What is true right now — the sentence behind the state pill. */
  stateDetail: string;
  /** Why the UI believes the state. Never a claim we cannot back. */
  evidence: string;
  /** Dependencies, by system id. */
  dependsOn: string[];
  /** Position on the control map, in percent (x, y). Layout data, not style. */
  at: { x: number; y: number };
  /** Only ever set for surfaces that already exist in this repository. */
  href?: string;
};

/* ── Model Control Center ───────────────────────────────────────────────── */

export type ModelProvider =
  | "Anthropic"
  | "OpenAI"
  | "Google"
  | "Meta"
  | "Mistral"
  | "Local"
  /** The repository's deterministic test transport — no provider, no credits. */
  | "Deterministic";

export type ModelAvailability = "available" | "degraded" | "unavailable" | "reserved";

export type ModelQuotaState = "ok" | "near-limit" | "exhausted" | "unmetered";

export type ModelEntitlement = "entitled" | "requires-approval" | "not-provisioned";

export type ModelEntry = {
  id: string;
  /** Registry name, e.g. "claude-opus-class". */
  name: string;
  provider: ModelProvider;
  family: string;
  /** What this model is allowed to be used for in the registry. */
  capabilities: Array<"text" | "code" | "vision" | "tools" | "long-context" | "voice">;
  intelligenceTier: "frontier" | "high" | "balanced" | "economy";
  costClass: "premium" | "standard" | "economy" | "local";
  latencyClass: "interactive" | "fast" | "batch";
  contextWindow: number;
  toolSupport: "native" | "limited" | "none";
  availability: ModelAvailability;
  quota: { state: ModelQuotaState; usedPct: number; note: string };
  entitlement: ModelEntitlement;
  /** Registry roles. `default` marks the routing fallbacks, not a live route. */
  roles: Array<"default" | "fallback" | "escalation" | "utility" | "private">;
  /** Agents currently registered against it (ids). */
  agents: string[];
  note: string;
};

/* ── Activity / audit ───────────────────────────────────────────────────── */

export type ActivityEvent = {
  id: string;
  at: string;
  /** Full clock label for the audit timeline. */
  time: string;
  kind: ActivityKind;
  severity: Severity;
  actor: string;
  /** Human or agent — decides the material, never the meaning. */
  actorKind: ActorKind;
  text: string;
  departmentId?: DepartmentId;
  missionId?: string;
  /** Where the operator can go next, when a destination exists. */
  href?: string;
};

/* ── Finance (product shell only) ───────────────────────────────────────── */

export type FinanceFigure = {
  id: string;
  label: string;
  /** Display value — a string, because these are never summed here. */
  value: string;
  note: string;
  /** Direction in words. Never a bare arrow. */
  trend: string;
  tone: "positive" | "attention" | "neutral";
};

export type Wallet = {
  id: string;
  name: string;
  kind: "operating" | "reserve" | "project" | "spend" | "clearing";
  balance: string;
  state: "open" | "reconciled" | "held" | "untracked";
  note: string;
};

export type SpendGuard = {
  id: string;
  label: string;
  /** What the guard covers: "AI & tool spend", "Client delivery", … */
  scope: string;
  limit: string;
  used: string;
  /** 0-100, illustrative. */
  usedPct: number;
  state: "within" | "near" | "breached" | "suspended";
  note: string;
};

export type FinanceShell = {
  /** The shell is honest about not knowing real numbers. */
  connected: false;
  figures: FinanceFigure[];
  wallets: Wallet[];
  guards: SpendGuard[];
  note: string;
};

/* ── EXEC conversation (local, deterministic) ───────────────────────────── */

export type ExecCard = {
  id: string;
  label: string;
  value: string;
  note: string;
  tone: "neutral" | "intelligence" | "attention" | "positive";
};

export type ExecAction = {
  id: string;
  label: string;
  kind: "open" | "approve" | "reject" | "ask";
  /** In-app destination for `open`. */
  href?: string;
  /** Id of the row this action acts on (decision, mission, …). */
  targetId?: string;
  /** The prompt an `ask` action sends back into the conversation. */
  prompt?: string;
};

export type ExecTurn = {
  id: string;
  from: "founder" | "exec";
  at: string;
  kind: "text" | "proposal" | "escalation";
  text: string;
  /** Context cards the executive attaches to its answer. */
  cards: ExecCard[];
  /** Suggested next moves. */
  actions: ExecAction[];
  /** True while the executive is "composing" — the UI shows the typing state. */
  pending?: boolean;
};

/* ── The dataset ────────────────────────────────────────────────────────── */

export type CommandDataset = {
  /** Provenance, rendered in the UI so nothing reads as production truth. */
  source: "demo-adapter";
  generatedAt: string;
  missions: Mission[];
  agents: Agent[];
  decisions: Decision[];
  projects: Project[];
  clients: Client[];
  systems: SystemIntegration[];
  models: ModelEntry[];
  activity: ActivityEvent[];
  finance: FinanceShell;
  /** The EXEC conversation's opening state. */
  exec: {
    greeting: string;
    turns: ExecTurn[];
  };
};
