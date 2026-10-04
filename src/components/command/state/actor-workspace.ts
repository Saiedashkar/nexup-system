/**
 * NEXUP COMMAND — ACTOR WORKSPACE CONFIGURATION (mock, Phase UI-04)
 * ───────────────────────────────────────────────────────────────────
 * An Actor Workspace is the operating profile / control room of ONE worker,
 * human or AI. Like the Department Workspace, there is exactly one
 * implementation of it and this file is the data that fills it.
 *
 * Three ideas shape the model, and all three are deliberate:
 *
 *   · CATALOG vs ASSIGNMENT. Skills, tools and workflows live in shared
 *     catalogs (`SKILL_CATALOG`, `TOOL_CATALOG`, `WORKFLOW_CATALOG`). An actor
 *     *references* catalog entries with a per-actor level / permission /
 *     state. Nothing is owned permanently, so a future phase can assign or
 *     remove a skill dynamically without touching any actor definition or UI.
 *
 *   · HUMANS ARE NOT SECOND-CLASS. The same structure serves `human` and
 *     `ai-agent`. AI-only concepts (model route, autonomy) are simply absent
 *     on humans, and human-only content (contact context) is absent on agents.
 *     There is no separate Human page architecture.
 *
 *   · HERMES COMPATIBILITY, NOT HERMES. Nothing here calls a runtime. The
 *     shape leaves room for future fields — runtime identity, Hermes profile,
 *     model route, skills/tools registry, memory scope, approval policy,
 *     escalation rules, lifecycle state — so Hermes can arrive later as an
 *     external adapter rather than a UI dependency.
 *
 * NO database, NO AI provider, NO tool execution. Every value is illustrative.
 */

import { DEPARTMENT_BY_ID, systemsForDepartment, type DepartmentId } from "./organization-model";
import { workspaceHref } from "./department-workspace";

/* ── Modes ─────────────────────────────────────────────────────────────────
   The nine internal surfaces every actor workspace hosts. Keys, never
   component refs, so this file stays plain serialisable data.              */

export type ActorModeId =
  | "overview"
  | "work"
  | "skills"
  | "tools"
  | "workflows"
  | "memory"
  | "permissions"
  | "performance"
  | "history";

export type ActorMode = {
  id: ActorModeId;
  label: string;
  /** One short line, used as the tab title and the mode's own subhead. */
  hint: string;
};

export const ACTOR_MODES: ActorMode[] = [
  { id: "overview", label: "Overview", hint: "Who this worker is" },
  { id: "work", label: "Work", hint: "Missions, jobs, approvals" },
  { id: "skills", label: "Skills", hint: "Procedural knowledge" },
  { id: "tools", label: "Tools", hint: "Executable capabilities" },
  { id: "workflows", label: "Workflows", hint: "Reusable sequences" },
  { id: "memory", label: "Memory", hint: "Context and decisions" },
  { id: "permissions", label: "Permissions", hint: "Scope, autonomy, route" },
  { id: "performance", label: "Performance", hint: "How it is doing" },
  { id: "history", label: "History", hint: "What it has done" },
];

/* ── Routing ───────────────────────────────────────────────────────────────
   One slug per actor: `/command/actors/<slug>`. The URL is the actor's
   identity, so renaming its role or changing its skills never moves it.    */

/** Where an actor's workspace lives. */
export function actorHref(slug: string): string {
  return `/command/actors/${slug}`;
}

/* ── Actor types ───────────────────────────────────────────────────────── */

export type ActorType = "human" | "ai-agent";

export function actorTypeLabel(type: ActorType): string {
  return type === "human" ? "Human" : "AI Agent";
}

/* ── Shared vocabulary types ───────────────────────────────────────────── */

export type SkillLevel = "Mastered" | "Proficient" | "Learning" | "Dormant";
export type ToolAccess = "Allowed" | "Approval" | "Read-only" | "Blocked";
export type WorkflowState = "Ready" | "Draft" | "Paused";
export type AutonomyLevel =
  | "Observe"
  | "Suggest"
  | "Execute with approval"
  | "Auto low-risk"
  | "Bounded autonomy";

/* ── Catalogs (the reusable registry) ──────────────────────────────────── */

type SkillDef = { id: string; name: string; /** SOP / pack the capability comes from. */ source: string };
type ToolDef = { id: string; name: string; category: string };
type WorkflowDef = { id: string; name: string; steps: string[] };

const SKILL_CATALOG: Record<string, SkillDef> = {
  "market-research": { id: "market-research", name: "Market research", source: "pack:growth.research@v3" },
  "demand-scanning": { id: "demand-scanning", name: "Demand scanning", source: "pack:growth.signals@v2" },
  "lead-qualification": { id: "lead-qualification", name: "Lead qualification", source: "pack:growth.qualify@v2" },
  "outreach-writing": { id: "outreach-writing", name: "Outreach writing", source: "pack:growth.outreach@v4" },
  "sales-followup": { id: "sales-followup", name: "Sales follow-up", source: "pack:growth.followup@v4" },
  "deal-closing": { id: "deal-closing", name: "Deal closing", source: "pack:growth.close@v1" },
  "pipeline-management": { id: "pipeline-management", name: "Pipeline management", source: "pack:growth.pipeline@v3" },
  "team-leadership": { id: "team-leadership", name: "Team leadership", source: "pack:core.leadership@v2" },
  "prioritisation": { id: "prioritisation", name: "Prioritisation", source: "pack:core.priority@v1" },
  "delegation": { id: "delegation", name: "Delegation", source: "pack:core.delegation@v1" },
  "client-onboarding": { id: "client-onboarding", name: "Client onboarding", source: "pack:delivery.onboard@v3" },
  "delivery-quality": { id: "delivery-quality", name: "Delivery quality review", source: "pack:delivery.qa@v2" },
  "retention-reading": { id: "retention-reading", name: "Retention reading", source: "pack:delivery.retention@v1" },
  "client-communication": { id: "client-communication", name: "Client communication", source: "pack:delivery.comms@v2" },
  "runbook-design": { id: "runbook-design", name: "Runbook design", source: "pack:ops.runbook@v3" },
  "vendor-assessment": { id: "vendor-assessment", name: "Vendor assessment", source: "pack:ops.vendor@v2" },
  "exception-routing": { id: "exception-routing", name: "Exception routing", source: "pack:ops.exceptions@v1" },
  "process-audit": { id: "process-audit", name: "Process audit", source: "pack:ops.audit@v2" },
  "product-discovery": { id: "product-discovery", name: "Product discovery", source: "pack:product.discovery@v3" },
  "implementation": { id: "implementation", name: "Implementation", source: "pack:product.build@v4" },
  "integration-design": { id: "integration-design", name: "Integration design", source: "pack:product.integration@v2" },
  "review-discipline": { id: "review-discipline", name: "Review discipline", source: "pack:product.review@v2" },
  "reconciliation": { id: "reconciliation", name: "Reconciliation", source: "pack:finance.reconcile@v3" },
  "margin-analysis": { id: "margin-analysis", name: "Margin analysis", source: "pack:finance.margin@v2" },
  "collections": { id: "collections", name: "Collections", source: "pack:finance.collections@v2" },
  "financial-controls": { id: "financial-controls", name: "Financial controls", source: "pack:finance.controls@v3" },
  "budget-ownership": { id: "budget-ownership", name: "Budget ownership", source: "pack:finance.budget@v1" },
};

const TOOL_CATALOG: Record<string, ToolDef> = {
  "maps.search_business": { id: "maps.search_business", name: "maps.search_business", category: "Discovery" },
  "web.search": { id: "web.search", name: "web.search", category: "Discovery" },
  "lead.score": { id: "lead.score", name: "lead.score", category: "Scoring" },
  "lead.enrich": { id: "lead.enrich", name: "lead.enrich", category: "Enrichment" },
  "crm.read": { id: "crm.read", name: "crm.read", category: "CRM" },
  "crm.update": { id: "crm.update", name: "crm.update", category: "CRM" },
  "email.send": { id: "email.send", name: "email.send", category: "Outreach" },
  "x.publish": { id: "x.publish", name: "x.publish", category: "Publishing" },
  "proposal.generate": { id: "proposal.generate", name: "proposal.generate", category: "Documents" },
  "docs.create": { id: "docs.create", name: "docs.create", category: "Documents" },
  "sheet.read": { id: "sheet.read", name: "sheet.read", category: "Data" },
  "report.generate": { id: "report.generate", name: "report.generate", category: "Reporting" },
  "calendar.schedule": { id: "calendar.schedule", name: "calendar.schedule", category: "Scheduling" },
  "ticket.create": { id: "ticket.create", name: "ticket.create", category: "Operations" },
  "vendor.query": { id: "vendor.query", name: "vendor.query", category: "Operations" },
  "ledger.write": { id: "ledger.write", name: "ledger.write", category: "Finance" },
  "payment.hold": { id: "payment.hold", name: "payment.hold", category: "Finance" },
  "invoice.generate": { id: "invoice.generate", name: "invoice.generate", category: "Finance" },
  "repo.build": { id: "repo.build", name: "repo.build", category: "Engineering" },
  "repo.review": { id: "repo.review", name: "repo.review", category: "Engineering" },
  "deploy.preview": { id: "deploy.preview", name: "deploy.preview", category: "Engineering" },
  "listing.publish": { id: "listing.publish", name: "listing.publish", category: "Portfolio" },
};

const WORKFLOW_CATALOG: Record<string, WorkflowDef> = {
  "new-lead-qualification": {
    id: "new-lead-qualification",
    name: "New lead qualification",
    steps: ["Capture", "Enrich", "Score", "Route to owner"],
  },
  "real-estate-outreach": {
    id: "real-estate-outreach",
    name: "Real estate outreach",
    steps: ["Select listings", "Draft message", "Review", "Send", "Log outcome"],
  },
  "client-followup": {
    id: "client-followup",
    name: "Client follow-up",
    steps: ["Check status", "Draft update", "Send", "Record"],
  },
  "proposal-generation": {
    id: "proposal-generation",
    name: "Proposal generation",
    steps: ["Gather scope", "Draft", "Price", "Review", "Send"],
  },
  "campaign-launch": {
    id: "campaign-launch",
    name: "Campaign launch",
    steps: ["Define audience", "Draft assets", "Approve", "Schedule", "Measure"],
  },
  "onboarding-sequence": {
    id: "onboarding-sequence",
    name: "Onboarding sequence",
    steps: ["Collect details", "Create access", "Schedule kickoff", "Confirm"],
  },
  "delivery-quality-check": {
    id: "delivery-quality-check",
    name: "Delivery quality check",
    steps: ["Open deliverable", "Check against brief", "Flag issues", "Sign off"],
  },
  "incident-response": {
    id: "incident-response",
    name: "Incident response",
    steps: ["Detect", "Classify", "Notify owner", "Resolve", "Record lesson"],
  },
  "weekly-quality-sweep": {
    id: "weekly-quality-sweep",
    name: "Weekly quality sweep",
    steps: ["Sample work", "Score", "Escalate outliers", "Report"],
  },
  "vendor-consolidation": {
    id: "vendor-consolidation",
    name: "Vendor consolidation",
    steps: ["List vendors", "Score", "Propose cuts", "Approve"],
  },
  "discovery-to-spec": {
    id: "discovery-to-spec",
    name: "Discovery to spec",
    steps: ["Frame problem", "Explore options", "Write spec", "Review"],
  },
  "build-and-review": {
    id: "build-and-review",
    name: "Build and review",
    steps: ["Plan", "Build", "Self-check", "Review", "Ship"],
  },
  "month-end-close": {
    id: "month-end-close",
    name: "Month-end close",
    steps: ["Freeze entries", "Reconcile", "Adjust", "Report"],
  },
  "collections-cycle": {
    id: "collections-cycle",
    name: "Collections cycle",
    steps: ["List overdue", "Prioritise", "Draft chase", "Escalate"],
  },
  "spend-approval": {
    id: "spend-approval",
    name: "Spend approval",
    steps: ["Capture request", "Check limit", "Route for approval", "Release"],
  },
};

/* ── Public shapes ─────────────────────────────────────────────────────── */

export type Skill = {
  id: string;
  name: string;
  level: SkillLevel;
  source: string;
  /** Human-readable last use, or "—" when never used. Mock. */
  lastUsed: string;
  available: boolean;
};

export type ToolItem = {
  id: string;
  name: string;
  category: string;
  permission: ToolAccess;
  lastUsed: string;
  available: boolean;
};

export type WorkflowItem = {
  id: string;
  name: string;
  steps: string[];
  state: WorkflowState;
  reusable: boolean;
};

export type MemoryLayerId = "working" | "actor" | "department" | "project" | "decisions" | "instructions";

export type MemoryEntry = { id: string; title: string; note: string };

export type MemoryLayer = {
  id: MemoryLayerId;
  label: string;
  /** What this layer is, in one line. */
  note: string;
  entries: MemoryEntry[];
};

export type ModelRoute = {
  /** Policy word shown first: AUTO means the system chooses the route. */
  policy: "AUTO" | "PINNED" | "ECONOMY";
  preferred: string;
  fallback: string;
  costPolicy: string;
  /** Whether a paid escalation must be approved by a human. */
  paidEscalation: string;
};

export type ActorPermissions = {
  autonomy: AutonomyLevel;
  allowedTools: string[];
  allowedSystems: string[];
  dataScope: string;
  financial: string;
  publishing: string;
  approval: string;
  escalation: string;
};

export type PerformanceMetric = { id: string; label: string; value: string; note: string };

export type HistoryKind =
  | "mission"
  | "command"
  | "decision"
  | "output"
  | "warning"
  | "approval"
  | "skill"
  | "tool";

export type HistoryEntry = { id: string; kind: HistoryKind; title: string; at: string };

export type WorkKind = "mission" | "job" | "delegated" | "blocker" | "approval" | "output";

export type ActorWorkItem = {
  id: string;
  title: string;
  kind: WorkKind;
  state: string;
  note: string;
};

export type HumanContact = { id: string; label: string; value: string };

export type ActorConfig = {
  /** Route slug — the actor's identity. */
  id: string;
  name: string;
  type: ActorType;
  initials: string;
  role: string;
  departmentId: DepartmentId;
  departmentName: string;
  /** Identity accent CSS custom property, inherited from the department. */
  accentVar: string;
  status: string;
  mission: string;
  /** What this actor owns, in the operator's words. */
  responsibility: string;
  /** Why the actor exists. */
  purpose: string;
  reportsTo: string;
  collaborates: string[];
  priority: string;
  attention: string[];
  /** One-line capability summary shown in the header. */
  capability: string;
  /** Links back to the department Team item that opens this workspace. */
  workspaceActorId: string;
  /* AI-only. Absent on humans. */
  model?: ModelRoute;
  /* Reusable catalog references, filled per actor. */
  skills: Skill[];
  tools: ToolItem[];
  workflows: WorkflowItem[];
  memory: MemoryLayer[];
  permissions: ActorPermissions;
  performance: PerformanceMetric[];
  history: HistoryEntry[];
  work: ActorWorkItem[];
  /* Human-only. Absent on agents. */
  contact?: HumanContact[];
};

/* ── Spec + builder ────────────────────────────────────────────────────────
   Each actor is authored as a compact spec and expanded by `defineActor`.
   The per-actor lists (skills / tools / workflows / work / seeds) are the
   only hand-authored content; identity defaults are derived where they can
   be, so the file stays declarative.                                       */

type SkillRef = [id: string, level: SkillLevel, lastUsed: string];
type ToolRef = [id: string, permission: ToolAccess, lastUsed: string];
type WorkflowRef = [id: string, state: WorkflowState];
type MemorySeed = [layer: MemoryLayerId, title: string, note: string];

type ActorSpec = {
  id: string;
  name: string;
  type: ActorType;
  departmentId: DepartmentId;
  role: string;
  initials: string;
  status: string;
  mission: string;
  responsibility: string;
  purpose: string;
  reportsTo: string;
  collaborates: string[];
  priority: string;
  attention: string[];
  capability: string;
  workspaceActorId: string;
  skills: SkillRef[];
  tools: ToolRef[];
  workflows: WorkflowRef[];
  work: ActorWorkItem[];
  memorySeeds?: MemorySeed[];
  autonomy?: AutonomyLevel;
  model?: Partial<ModelRoute>;
  permissions?: Partial<ActorPermissions>;
  contact?: HumanContact[];
};

const DEFAULT_MODEL: ModelRoute = {
  policy: "AUTO",
  preferred: "reasoning-generalist",
  fallback: "fast-generalist",
  costPolicy: "Economy unless the task is high-stakes",
  paidEscalation: "Human approval required",
};

const DEFAULT_MEMORY: Array<{ id: MemoryLayerId; label: string; note: string }> = [
  { id: "working", label: "Working context", note: "What this actor is holding right now." },
  { id: "actor", label: "Actor memory", note: "Learned preferences specific to this actor." },
  { id: "department", label: "Department memory references", note: "Shared context pulled from the department." },
  { id: "project", label: "Project memory references", note: "Context carried from active and past work." },
  { id: "decisions", label: "Decisions & lessons", note: "Choices made, with what they taught." },
  { id: "instructions", label: "Important user instructions", note: "Standing instructions from the founder or lead." },
];

function buildMemory(spec: ActorSpec): MemoryLayer[] {
  const seeds = spec.memorySeeds ?? [];
  return DEFAULT_MEMORY.map((layer) => ({
    ...layer,
    entries: seeds
      .filter((seed) => seed[0] === layer.id)
      .map((seed, index) => ({ id: `${layer.id}-${index + 1}`, title: seed[1], note: seed[2] })),
  }));
}

function buildPerformance(spec: ActorSpec): PerformanceMetric[] {
  const ai = spec.type === "ai-agent";
  return [
    { id: "jobs", label: ai ? "Completed jobs" : "Missions closed", value: ai ? "128" : "9", note: "This quarter, mock." },
    { id: "success", label: "Success rate", value: ai ? "94%" : "100%", note: "Of attempted work." },
    { id: "quality", label: "Response quality", value: ai ? "4.6 / 5" : "—", note: "Reviewed output quality." },
    { id: "cost", label: "Cost", value: ai ? "$18 this week" : "—", note: ai ? "Model and tool spend." : "Not applicable." },
    { id: "time", label: "Avg completion", value: ai ? "6m 20s" : "1.4 days", note: "Typical task time." },
    { id: "corrections", label: "Human corrections", value: ai ? "3" : "0", note: "Times a human had to step in." },
    { id: "outputs", label: "Reusable outputs", value: ai ? "12" : "4", note: "Saved as reusable assets." },
  ];
}

function buildHistory(spec: ActorSpec): HistoryEntry[] {
  const entries: HistoryEntry[] = [
    { id: "h1", kind: "mission", title: `Assigned — ${spec.mission}`, at: "09:12" },
    { id: "h2", kind: "command", title: "Direct command received from the department lead", at: "08:40" },
  ];
  if (spec.type === "ai-agent") {
    entries.push({ id: "h3", kind: "skill", title: "Skill set refreshed from the registry", at: "Yesterday" });
    entries.push({ id: "h4", kind: "tool", title: "Tool permission reviewed", at: "Yesterday" });
  }
  entries.push({ id: "h5", kind: "output", title: "Output recorded for the department", at: "Yesterday" });
  return entries;
}

function defineActor(spec: ActorSpec): ActorConfig {
  const department = DEPARTMENT_BY_ID[spec.departmentId];
  const ai = spec.type === "ai-agent";

  const skills: Skill[] = spec.skills.map(([id, level, lastUsed]) => {
    const def = SKILL_CATALOG[id];
    return {
      id,
      name: def?.name ?? id,
      level,
      source: def?.source ?? "unregistered",
      lastUsed,
      available: level !== "Dormant",
    };
  });

  const tools: ToolItem[] = spec.tools.map(([id, permission, lastUsed]) => {
    const def = TOOL_CATALOG[id];
    return {
      id,
      name: def?.name ?? id,
      category: def?.category ?? "Other",
      permission,
      lastUsed,
      available: permission !== "Blocked",
    };
  });

  const workflows: WorkflowItem[] = spec.workflows.map(([id, state]) => {
    const def = WORKFLOW_CATALOG[id];
    return {
      id,
      name: def?.name ?? id,
      steps: def?.steps ?? [],
      state,
      reusable: true,
    };
  });

  const allowedTools = tools.filter((tool) => tool.permission === "Allowed").map((tool) => tool.name);
  const allowedSystems = systemsForDepartment(spec.departmentId).map((system) => system.name);

  const permissions: ActorPermissions = {
    autonomy: spec.autonomy ?? (ai ? "Execute with approval" : "Bounded autonomy"),
    allowedTools,
    allowedSystems,
    dataScope: "This department's records",
    financial: ai ? "No spend authority" : "Budget owner within the department",
    publishing: ai ? "Approval required before publishing" : "May publish under policy",
    approval: ai ? "Writes above the limit need a human" : "Approves work within the department",
    escalation: "Escalates to the department lead, then EXEC",
    ...spec.permissions,
  };

  return {
    id: spec.id,
    name: spec.name,
    type: spec.type,
    initials: spec.initials,
    role: spec.role,
    departmentId: spec.departmentId,
    departmentName: department?.name ?? spec.departmentId,
    accentVar: department?.accentVar ?? "--nc-lime",
    status: spec.status,
    mission: spec.mission,
    responsibility: spec.responsibility,
    purpose: spec.purpose,
    reportsTo: spec.reportsTo,
    collaborates: spec.collaborates,
    priority: spec.priority,
    attention: spec.attention,
    capability: spec.capability,
    workspaceActorId: spec.workspaceActorId,
    model: ai ? { ...DEFAULT_MODEL, ...spec.model } : undefined,
    skills,
    tools,
    workflows,
    memory: buildMemory(spec),
    permissions,
    performance: buildPerformance(spec),
    history: buildHistory(spec),
    work: spec.work,
    contact: spec.contact,
  };
}

/* ── The actors ────────────────────────────────────────────────────────────
   Every Team item in every department resolves here. Five departments,
   humans and AI agents, all through one structure.                        */

const ACTOR_SPECS: ActorSpec[] = [
  /* ── Growth & Revenue ─────────────────────────────────────────────────── */
  {
    id: "growth-lead",
    name: "Growth Lead",
    type: "human",
    departmentId: "growth",
    role: "Human lead",
    initials: "GL",
    status: "Active",
    mission: "Partner channel launch",
    responsibility: "Owns revenue targets and the final call on every deal.",
    purpose: "Hold the revenue number and keep authority where it belongs — with a human.",
    reportsTo: "Founder",
    collaborates: ["AI Growth Director", "Sales Lead"],
    priority: "Approve the partner revenue share",
    attention: ["Partner revenue share still undecided"],
    capability: "Revenue ownership, direction and final approval.",
    workspaceActorId: "growth.human-lead",
    skills: [
      ["deal-closing", "Mastered", "1h ago"],
      ["team-leadership", "Mastered", "Today"],
      ["prioritisation", "Proficient", "Today"],
      ["delegation", "Proficient", "2h ago"],
    ],
    tools: [
      ["crm.read", "Allowed", "2h ago"],
      ["report.generate", "Allowed", "Yesterday"],
      ["sheet.read", "Read-only", "Yesterday"],
    ],
    workflows: [["campaign-launch", "Ready"], ["spend-approval", "Ready"]],
    autonomy: "Bounded autonomy",
    contact: [
      { id: "c1", label: "Channel", value: "Direct · priority" },
      { id: "c2", label: "Decision window", value: "09:00 – 18:00" },
      { id: "c3", label: "Best for", value: "Approvals and final calls" },
    ],
    memorySeeds: [
      ["instructions", "Hold the partner share at 20% until the channel proves out", "Standing instruction from the founder."],
      ["decisions", "Prioritise answer speed over lead volume this quarter", "Chosen after the Q3 review."],
    ],
    work: [
      { id: "gl-w1", title: "Partner channel launch", kind: "mission", state: "Review", note: "Waiting on the revenue-share call." },
      { id: "gl-w2", title: "Approve partner revenue share", kind: "approval", state: "Needs you", note: "Blocks the channel launch." },
      { id: "gl-w3", title: "Weekly revenue review", kind: "job", state: "Scheduled", note: "With the AI Growth Director." },
    ],
  },
  {
    id: "sales-lead",
    name: "Sales Lead",
    type: "human",
    departmentId: "growth",
    role: "Human manager",
    initials: "SL",
    status: "Active",
    mission: "Pipeline conversion",
    responsibility: "Runs the deal desk and closes business.",
    purpose: "Turn qualified pipeline into signed revenue.",
    reportsTo: "Growth Lead",
    collaborates: ["Sales / CRM", "Lead Acquisition"],
    priority: "Clear the stalled mid-pipeline deals",
    attention: ["Two proposals have been idle for six days"],
    capability: "Deal desk, negotiation and closing.",
    workspaceActorId: "growth.sales-lead",
    skills: [
      ["deal-closing", "Mastered", "Today"],
      ["sales-followup", "Proficient", "Today"],
      ["pipeline-management", "Proficient", "1h ago"],
    ],
    tools: [
      ["crm.update", "Allowed", "1h ago"],
      ["email.send", "Allowed", "3h ago"],
      ["proposal.generate", "Approval", "Yesterday"],
    ],
    workflows: [["proposal-generation", "Ready"], ["client-followup", "Ready"]],
    autonomy: "Bounded autonomy",
    contact: [
      { id: "c1", label: "Channel", value: "Direct · deal desk" },
      { id: "c2", label: "Decision window", value: "10:00 – 19:00" },
    ],
    memorySeeds: [["project", "Sector pricing guardrails", "Where discounts must stop."]],
    work: [
      { id: "sl-w1", title: "Mid-pipeline reactivation", kind: "mission", state: "Active", note: "Six stalled deals." },
      { id: "sl-w2", title: "Review two idle proposals", kind: "job", state: "Running", note: "Drafted by Sales / CRM." },
    ],
  },
  {
    id: "ai-growth-director",
    name: "AI Growth Director",
    type: "ai-agent",
    departmentId: "growth",
    role: "AI director",
    initials: "GD",
    status: "Thinking",
    mission: "Channel strategy",
    responsibility: "Coordinate research, acquisition, sales operations and revenue growth.",
    purpose: "Set direction, route work and report — the department's operating brain.",
    reportsTo: "Growth Lead",
    collaborates: ["Market Intelligence", "Lead Acquisition", "Sales / CRM"],
    priority: "Land the partner channel launch",
    attention: ["Answer speed below target on inbound leads"],
    capability: "Direction setting, work routing and reporting.",
    workspaceActorId: "growth.ai-director",
    autonomy: "Auto low-risk",
    model: { policy: "AUTO", preferred: "reasoning-generalist", fallback: "fast-generalist" },
    skills: [
      ["market-research", "Mastered", "30m ago"],
      ["demand-scanning", "Mastered", "Today"],
      ["prioritisation", "Proficient", "Today"],
      ["delegation", "Proficient", "1h ago"],
    ],
    tools: [
      ["web.search", "Allowed", "30m ago"],
      ["crm.read", "Allowed", "1h ago"],
      ["report.generate", "Allowed", "Today"],
      ["email.send", "Approval", "Yesterday"],
    ],
    workflows: [["campaign-launch", "Ready"], ["new-lead-qualification", "Ready"]],
    memorySeeds: [
      ["working", "Objective — partner channel launch", "Owns the launch sequence."],
      ["department", "Growth operating context", "Targets, guardrails and routing rules."],
    ],
    work: [
      { id: "gd-w1", title: "Partner channel launch", kind: "mission", state: "Active", note: "Routing across the department." },
      { id: "gd-w2", title: "Route inbound to Sales / CRM", kind: "delegated", state: "Assigned", note: "Handed to a specialist." },
      { id: "gd-w3", title: "Weekly revenue digest", kind: "output", state: "Drafted", note: "For the Growth Lead." },
      { id: "gd-w4", title: "Answer-speed metric drifting", kind: "blocker", state: "Flagged", note: "Under the response target." },
    ],
  },
  {
    id: "market-intelligence",
    name: "Market Intelligence",
    type: "ai-agent",
    departmentId: "growth",
    role: "AI specialist",
    initials: "MI",
    status: "Active",
    mission: "Real-estate listing push",
    responsibility: "Read signals, competition and demand, and surface what matters.",
    purpose: "Know the market before the department acts on it.",
    reportsTo: "AI Growth Director",
    collaborates: ["Lead Acquisition"],
    priority: "Complete the demand scan for the listing push",
    attention: [],
    capability: "Signals, competition and demand reading.",
    workspaceActorId: "growth.market-intel",
    autonomy: "Bounded autonomy",
    model: { policy: "ECONOMY", preferred: "fast-generalist", fallback: "reasoning-generalist" },
    skills: [
      ["market-research", "Mastered", "Today"],
      ["demand-scanning", "Mastered", "2h ago"],
    ],
    tools: [
      ["maps.search_business", "Allowed", "2h ago"],
      ["web.search", "Allowed", "Today"],
      ["sheet.read", "Read-only", "Today"],
    ],
    workflows: [["real-estate-outreach", "Ready"]],
    memorySeeds: [["project", "Listing push signals", "Demand pockets found so far."]],
    work: [
      { id: "mi-w1", title: "Real-estate listing push", kind: "mission", state: "Active", note: "Demand scan in progress." },
      { id: "mi-w2", title: "Competitor price sweep", kind: "job", state: "Running", note: "Local listing prices." },
    ],
  },
  {
    id: "lead-acquisition",
    name: "Lead Acquisition",
    type: "ai-agent",
    departmentId: "growth",
    role: "AI specialist",
    initials: "LA",
    status: "Active",
    mission: "Q4 outbound reactivation",
    responsibility: "Capture inbound and source outbound demand.",
    purpose: "Keep a steady supply of qualified demand flowing in.",
    reportsTo: "AI Growth Director",
    collaborates: ["Market Intelligence", "Sales / CRM"],
    priority: "Finish enriching the dormant lead set",
    attention: [],
    capability: "Inbound capture and outbound sourcing.",
    workspaceActorId: "growth.lead-acq",
    autonomy: "Auto low-risk",
    model: { policy: "AUTO", preferred: "fast-generalist", fallback: "reasoning-generalist" },
    skills: [
      ["lead-qualification", "Mastered", "1h ago"],
      ["outreach-writing", "Proficient", "3h ago"],
      ["demand-scanning", "Proficient", "Today"],
    ],
    tools: [
      ["lead.enrich", "Allowed", "1h ago"],
      ["lead.score", "Allowed", "1h ago"],
      ["email.send", "Approval", "4h ago"],
      ["crm.update", "Allowed", "2h ago"],
    ],
    workflows: [["new-lead-qualification", "Ready"], ["real-estate-outreach", "Ready"]],
    memorySeeds: [["working", "Objective — Q4 outbound reactivation", "340 dormant leads in the set."]],
    work: [
      { id: "la-w1", title: "Enrich 340 dormant leads", kind: "job", state: "Running", note: "74% enriched." },
      { id: "la-w2", title: "Q4 outbound reactivation", kind: "mission", state: "Active", note: "Sequence pacing at target." },
    ],
  },
  {
    id: "sales-crm",
    name: "Sales / CRM",
    type: "ai-agent",
    departmentId: "growth",
    role: "AI specialist",
    initials: "SC",
    status: "Waiting",
    mission: "Pipeline hygiene",
    responsibility: "Keep pipeline state accurate and follow-ups on time.",
    purpose: "Make sure nothing in the pipeline is dropped or stale.",
    reportsTo: "AI Growth Director",
    collaborates: ["Sales Lead", "Lead Acquisition"],
    priority: "Clear the stale mid-pipeline entries",
    attention: [],
    capability: "Pipeline state, follow-ups and CRM upkeep.",
    workspaceActorId: "growth.sales-crm",
    autonomy: "Execute with approval",
    skills: [
      ["pipeline-management", "Mastered", "Today"],
      ["sales-followup", "Proficient", "Today"],
    ],
    tools: [
      ["crm.update", "Allowed", "Today"],
      ["crm.read", "Allowed", "Today"],
      ["email.send", "Approval", "Yesterday"],
    ],
    workflows: [["client-followup", "Ready"], ["proposal-generation", "Draft"]],
    memorySeeds: [["actor", "Follow-up cadence preference", "Every 3 days until a reply."]],
    work: [
      { id: "sc-w1", title: "Pipeline hygiene", kind: "mission", state: "Active", note: "Flagging stale entries." },
      { id: "sc-w2", title: "Chase two idle proposals", kind: "job", state: "Running", note: "Awaiting the Sales Lead." },
    ],
  },

  /* ── Client & Delivery ────────────────────────────────────────────────── */
  {
    id: "delivery-lead",
    name: "Delivery Lead",
    type: "human",
    departmentId: "client",
    role: "Human lead",
    initials: "DL",
    status: "Active",
    mission: "Onboarding flow rebuild",
    responsibility: "Owns the delivery promise to every client.",
    purpose: "Make sure what was promised is what gets delivered.",
    reportsTo: "Founder",
    collaborates: ["AI Delivery Director", "Client Success Lead"],
    priority: "Remove the onboarding paperwork blocker",
    attention: ["Two onboardings blocked on paperwork"],
    capability: "Delivery ownership and client escalation.",
    workspaceActorId: "client.human-lead",
    skills: [
      ["client-onboarding", "Proficient", "Today"],
      ["client-communication", "Mastered", "1h ago"],
      ["team-leadership", "Proficient", "Today"],
    ],
    tools: [
      ["calendar.schedule", "Allowed", "1h ago"],
      ["docs.create", "Allowed", "Today"],
      ["report.generate", "Allowed", "Yesterday"],
    ],
    workflows: [["delivery-quality-check", "Ready"], ["onboarding-sequence", "Ready"]],
    autonomy: "Bounded autonomy",
    contact: [
      { id: "c1", label: "Channel", value: "Direct · delivery desk" },
      { id: "c2", label: "Decision window", value: "09:00 – 18:00" },
    ],
    memorySeeds: [["decisions", "Set onboarding to two days maximum", "After repeated slippage."]],
    work: [
      { id: "dl-w1", title: "Onboarding flow rebuild", kind: "mission", state: "Active", note: "Removing paper steps." },
      { id: "dl-w2", title: "Confirm onboarding owner", kind: "approval", state: "Needs you", note: "Blocks two clients." },
    ],
  },
  {
    id: "client-success-lead",
    name: "Client Success Lead",
    type: "human",
    departmentId: "client",
    role: "Human manager",
    initials: "CS",
    status: "Waiting",
    mission: "Retention checks",
    responsibility: "Keep clients aware, satisfied and retained.",
    purpose: "Protect the relationship after delivery.",
    reportsTo: "Delivery Lead",
    collaborates: ["Onboarding", "Delivery QA"],
    priority: "Run the quarterly retention sweep",
    attention: [],
    capability: "Client awareness, satisfaction and retention.",
    workspaceActorId: "client.success-lead",
    skills: [
      ["retention-reading", "Mastered", "Today"],
      ["client-communication", "Proficient", "2h ago"],
    ],
    tools: [
      ["crm.read", "Allowed", "2h ago"],
      ["email.send", "Allowed", "3h ago"],
      ["report.generate", "Allowed", "Yesterday"],
    ],
    workflows: [["client-followup", "Ready"]],
    autonomy: "Bounded autonomy",
    contact: [{ id: "c1", label: "Channel", value: "Direct · client desk" }],
    work: [{ id: "cs-w1", title: "Quarterly retention sweep", kind: "job", state: "Scheduled", note: "Six clients in scope." }],
  },
  {
    id: "ai-delivery-director",
    name: "AI Delivery Director",
    type: "ai-agent",
    departmentId: "client",
    role: "AI director",
    initials: "DD",
    status: "Thinking",
    mission: "QA sweep",
    responsibility: "Route delivery work and flag risk before it reaches a client.",
    purpose: "Keep delivery moving and safe without manual chasing.",
    reportsTo: "Delivery Lead",
    collaborates: ["Onboarding", "Delivery QA"],
    priority: "Complete the delivery QA sweep",
    attention: ["One deliverable flagged for review"],
    capability: "Work routing and delivery risk flagging.",
    workspaceActorId: "client.ai-director",
    autonomy: "Auto low-risk",
    model: { policy: "AUTO", preferred: "reasoning-generalist", fallback: "fast-generalist" },
    skills: [
      ["delivery-quality", "Mastered", "1h ago"],
      ["client-communication", "Proficient", "Today"],
      ["prioritisation", "Proficient", "Today"],
    ],
    tools: [
      ["report.generate", "Allowed", "1h ago"],
      ["crm.read", "Allowed", "Today"],
      ["email.send", "Approval", "Yesterday"],
    ],
    workflows: [["delivery-quality-check", "Ready"], ["incident-response", "Ready"]],
    memorySeeds: [["department", "Delivery operating context", "Client SLAs and quality bar."]],
    work: [
      { id: "dd-w1", title: "Delivery QA sweep", kind: "mission", state: "Active", note: "33% checked." },
      { id: "dd-w2", title: "Flag one deliverable", kind: "blocker", state: "Flagged", note: "Below the quality bar." },
    ],
  },
  {
    id: "onboarding",
    name: "Onboarding",
    type: "ai-agent",
    departmentId: "client",
    role: "AI specialist",
    initials: "ON",
    status: "Active",
    mission: "Kickoff packs",
    responsibility: "Set every new client up correctly and quickly.",
    purpose: "Turn a won deal into a running engagement.",
    reportsTo: "AI Delivery Director",
    collaborates: ["Service Delivery"],
    priority: "Ship three pending kickoff packs",
    attention: [],
    capability: "Client setup, access and kickoff preparation.",
    workspaceActorId: "client.onboarding",
    autonomy: "Execute with approval",
    model: { policy: "AUTO", preferred: "fast-generalist", fallback: "reasoning-generalist" },
    skills: [["client-onboarding", "Mastered", "Today"], ["client-communication", "Proficient", "2h ago"]],
    tools: [
      ["docs.create", "Allowed", "Today"],
      ["calendar.schedule", "Allowed", "1h ago"],
      ["email.send", "Approval", "Yesterday"],
    ],
    workflows: [["onboarding-sequence", "Ready"]],
    memorySeeds: [["working", "Objective — kickoff packs", "Three clients waiting."]],
    work: [
      { id: "on-w1", title: "Kickoff packs for 3 new clients", kind: "job", state: "Running", note: "60% assembled." },
    ],
  },
  {
    id: "delivery-qa",
    name: "Delivery QA",
    type: "ai-agent",
    departmentId: "client",
    role: "AI specialist",
    initials: "QA",
    status: "Active",
    mission: "Quality checks",
    responsibility: "Check work before it ships to a client.",
    purpose: "Catch problems before the client ever sees them.",
    reportsTo: "AI Delivery Director",
    collaborates: ["Onboarding"],
    priority: "Clear the current review queue",
    attention: [],
    capability: "Quality checks and pre-ship review.",
    workspaceActorId: "client.qa",
    autonomy: "Execute with approval",
    model: { policy: "ECONOMY", preferred: "fast-generalist", fallback: "reasoning-generalist" },
    skills: [["delivery-quality", "Mastered", "Today"], ["process-audit", "Proficient", "Yesterday"]],
    tools: [
      ["docs.create", "Allowed", "Today"],
      ["report.generate", "Allowed", "Today"],
      ["ticket.create", "Approval", "Yesterday"],
    ],
    workflows: [["delivery-quality-check", "Ready"]],
    memorySeeds: [["actor", "Quality bar", "What passes and what is sent back."]],
    work: [{ id: "qa-w1", title: "Quality checks", kind: "job", state: "Running", note: "Two deliverables in queue." }],
  },

  /* ── Business Operations ──────────────────────────────────────────────── */
  {
    id: "operations-lead",
    name: "Operations Lead",
    type: "human",
    departmentId: "operations",
    role: "Human lead",
    initials: "OL",
    status: "Active",
    mission: "Vendor consolidation",
    responsibility: "Owns process quality and the vendor set.",
    purpose: "Keep work moving with predictable process and reliable vendors.",
    reportsTo: "Founder",
    collaborates: ["AI Operations Director", "Process Control"],
    priority: "Decide the vendor consolidation cuts",
    attention: ["Vendor lead times creeping up"],
    capability: "Process ownership and vendor decisions.",
    workspaceActorId: "ops.human-lead",
    skills: [
      ["vendor-assessment", "Mastered", "Today"],
      ["process-audit", "Proficient", "1h ago"],
      ["prioritisation", "Proficient", "Today"],
    ],
    tools: [
      ["vendor.query", "Allowed", "Today"],
      ["report.generate", "Allowed", "Yesterday"],
      ["sheet.read", "Read-only", "Yesterday"],
    ],
    workflows: [["vendor-consolidation", "Ready"]],
    autonomy: "Bounded autonomy",
    contact: [{ id: "c1", label: "Channel", value: "Direct · operations desk" }],
    memorySeeds: [["decisions", "Consolidate to fewer, larger vendors", "To stabilise lead times."]],
    work: [
      { id: "ol-w1", title: "Vendor consolidation", kind: "mission", state: "Review", note: "Proposal ready for a decision." },
    ],
  },
  {
    id: "ai-operations-director",
    name: "AI Operations Director",
    type: "ai-agent",
    departmentId: "operations",
    role: "AI director",
    initials: "OD",
    status: "Thinking",
    mission: "Runbook coverage",
    responsibility: "Watch SLAs, route exceptions and keep process current.",
    purpose: "Hold the operating standard across every process.",
    reportsTo: "Operations Lead",
    collaborates: ["Process Control", "Quality & Follow-up"],
    priority: "Close the remaining runbook gaps",
    attention: ["Runbook coverage at 92%"],
    capability: "SLA watching and exception routing.",
    workspaceActorId: "ops.ai-director",
    autonomy: "Auto low-risk",
    model: { policy: "AUTO", preferred: "reasoning-generalist", fallback: "fast-generalist" },
    skills: [
      ["runbook-design", "Mastered", "Today"],
      ["exception-routing", "Mastered", "1h ago"],
      ["process-audit", "Proficient", "Today"],
    ],
    tools: [
      ["ticket.create", "Allowed", "1h ago"],
      ["report.generate", "Allowed", "Today"],
      ["vendor.query", "Read-only", "Yesterday"],
    ],
    workflows: [["incident-response", "Ready"], ["weekly-quality-sweep", "Ready"]],
    memorySeeds: [["department", "Operations operating context", "SLAs, runbooks and escalation paths."]],
    work: [
      { id: "od-w1", title: "Runbook coverage to 100%", kind: "mission", state: "Active", note: "92% covered." },
      { id: "od-w2", title: "Route three open exceptions", kind: "job", state: "Running", note: "To the right owners." },
    ],
  },
  {
    id: "process-control",
    name: "Process Control",
    type: "ai-agent",
    departmentId: "operations",
    role: "AI specialist",
    initials: "PC",
    status: "Active",
    mission: "Runbooks & SLAs",
    responsibility: "Keep process documented, current and measured.",
    purpose: "Make the way work happens repeatable and visible.",
    reportsTo: "AI Operations Director",
    collaborates: ["Quality & Follow-up"],
    priority: "Document the last three gaps",
    attention: [],
    capability: "Runbook authoring and SLA measurement.",
    workspaceActorId: "ops.process",
    autonomy: "Execute with approval",
    model: { policy: "ECONOMY", preferred: "fast-generalist", fallback: "reasoning-generalist" },
    skills: [["runbook-design", "Mastered", "Today"], ["process-audit", "Proficient", "2h ago"]],
    tools: [
      ["docs.create", "Allowed", "Today"],
      ["ticket.create", "Allowed", "2h ago"],
      ["sheet.read", "Read-only", "Today"],
    ],
    workflows: [["weekly-quality-sweep", "Ready"]],
    memorySeeds: [["actor", "Documentation style", "How this actor writes runbooks."]],
    work: [{ id: "pc-w1", title: "Fill runbook gaps", kind: "job", state: "Running", note: "Three gaps left." }],
  },
  {
    id: "quality-followup",
    name: "Quality & Follow-up",
    type: "ai-agent",
    departmentId: "operations",
    role: "AI specialist",
    initials: "QO",
    status: "Waiting",
    mission: "Quality sweep",
    responsibility: "Check output against standard and escalate exceptions.",
    purpose: "Be the last honest check before work is called done.",
    reportsTo: "AI Operations Director",
    collaborates: ["Process Control"],
    priority: "Complete the weekly quality sweep",
    attention: [],
    capability: "Quality checking and escalation.",
    workspaceActorId: "ops.quality",
    autonomy: "Execute with approval",
    model: { policy: "AUTO", preferred: "fast-generalist", fallback: "reasoning-generalist" },
    skills: [["process-audit", "Mastered", "Today"], ["delivery-quality", "Proficient", "Yesterday"]],
    tools: [
      ["ticket.create", "Approval", "Today"],
      ["report.generate", "Allowed", "Today"],
      ["docs.create", "Allowed", "Yesterday"],
    ],
    workflows: [["weekly-quality-sweep", "Ready"], ["incident-response", "Draft"]],
    memorySeeds: [["actor", "Exception threshold", "When to escalate versus fix."]],
    work: [{ id: "qo-w1", title: "Weekly quality sweep", kind: "job", state: "Running", note: "48% sampled." }],
  },

  /* ── Product & Technology ─────────────────────────────────────────────── */
  {
    id: "product-lead",
    name: "Product Lead",
    type: "human",
    departmentId: "product",
    role: "Human lead",
    initials: "PL",
    status: "Active",
    mission: "Command Shell UI",
    responsibility: "Owns product priorities and the final review call.",
    purpose: "Decide what to build and what is good enough to ship.",
    reportsTo: "Founder",
    collaborates: ["AI Builder", "Product Discovery"],
    priority: "Clear the review queue",
    attention: ["Review queue depth is the current drag"],
    capability: "Product direction and review authority.",
    workspaceActorId: "product.human-lead",
    skills: [
      ["product-discovery", "Mastered", "Today"],
      ["review-discipline", "Mastered", "1h ago"],
      ["prioritisation", "Mastered", "Today"],
    ],
    tools: [
      ["repo.review", "Allowed", "1h ago"],
      ["docs.create", "Allowed", "Today"],
      ["report.generate", "Allowed", "Yesterday"],
    ],
    workflows: [["discovery-to-spec", "Ready"], ["build-and-review", "Ready"]],
    autonomy: "Bounded autonomy",
    contact: [{ id: "c1", label: "Channel", value: "Direct · product desk" }],
    memorySeeds: [["decisions", "Review before release, always", "Non-negotiable quality gate."]],
    work: [
      { id: "pl-w1", title: "Command Shell UI", kind: "mission", state: "Review", note: "80% complete." },
      { id: "pl-w2", title: "Review queue depth 14", kind: "blocker", state: "Flagged", note: "Slowing delivery." },
    ],
  },
  {
    id: "ai-builder",
    name: "AI Builder",
    type: "ai-agent",
    departmentId: "product",
    role: "AI specialist",
    initials: "BU",
    status: "Active",
    mission: "Workforce design",
    responsibility: "Implement, integrate and automate the systems the organization runs on.",
    purpose: "Turn decided work into working software.",
    reportsTo: "Product Lead",
    collaborates: ["Product Discovery", "Automation"],
    priority: "Finish the workforce design implementation",
    attention: [],
    capability: "Implementation, integration and automation.",
    workspaceActorId: "product.ai-builder",
    autonomy: "Execute with approval",
    model: { policy: "AUTO", preferred: "code-specialist", fallback: "reasoning-generalist" },
    skills: [
      ["implementation", "Mastered", "Today"],
      ["integration-design", "Proficient", "1h ago"],
      ["review-discipline", "Proficient", "Today"],
    ],
    tools: [
      ["repo.build", "Allowed", "1h ago"],
      ["repo.review", "Allowed", "Today"],
      ["deploy.preview", "Approval", "Yesterday"],
    ],
    workflows: [["build-and-review", "Ready"]],
    memorySeeds: [["project", "Workforce design decisions", "Patterns chosen for the actor layer."]],
    work: [
      { id: "bu-w1", title: "Workforce design", kind: "mission", state: "Active", note: "45% implemented." },
      { id: "bu-w2", title: "Open a preview build", kind: "job", state: "Running", note: "Awaiting approval to deploy." },
    ],
  },
  {
    id: "product-discovery",
    name: "Product Discovery",
    type: "ai-agent",
    departmentId: "product",
    role: "AI specialist",
    initials: "PD",
    status: "Thinking",
    mission: "Review triage",
    responsibility: "Frame problems and set priorities before work starts.",
    purpose: "Make sure the right thing is built, not just something.",
    reportsTo: "Product Lead",
    collaborates: ["AI Builder"],
    priority: "Triage the review queue",
    attention: [],
    capability: "Problem framing and priority setting.",
    workspaceActorId: "product.discovery",
    autonomy: "Bounded autonomy",
    model: { policy: "AUTO", preferred: "reasoning-generalist", fallback: "fast-generalist" },
    skills: [["product-discovery", "Mastered", "Today"], ["prioritisation", "Proficient", "1h ago"]],
    tools: [
      ["web.search", "Allowed", "Today"],
      ["docs.create", "Allowed", "Today"],
      ["repo.review", "Read-only", "Yesterday"],
    ],
    workflows: [["discovery-to-spec", "Ready"]],
    memorySeeds: [["actor", "Framing template", "How problems are stated here."]],
    work: [{ id: "pd-w1", title: "Triage review queue", kind: "job", state: "Running", note: "14 items in queue." }],
  },
  {
    id: "automation",
    name: "Automation",
    type: "ai-agent",
    departmentId: "product",
    role: "AI specialist",
    initials: "AU",
    status: "Active",
    mission: "Automation backbone",
    responsibility: "Connect systems and workflows into reliable automation.",
    purpose: "Remove repeated manual work across the organization.",
    reportsTo: "Product Lead",
    collaborates: ["AI Builder"],
    priority: "Extend the automation backbone",
    attention: [],
    capability: "System connections and workflow automation.",
    workspaceActorId: "product.automation",
    autonomy: "Execute with approval",
    model: { policy: "ECONOMY", preferred: "fast-generalist", fallback: "reasoning-generalist" },
    skills: [["integration-design", "Mastered", "Today"], ["implementation", "Proficient", "2h ago"]],
    tools: [
      ["repo.build", "Allowed", "Today"],
      ["ticket.create", "Allowed", "1h ago"],
      ["deploy.preview", "Approval", "Yesterday"],
    ],
    workflows: [["build-and-review", "Ready"], ["incident-response", "Ready"]],
    memorySeeds: [["project", "Automation backbone map", "Which systems are wired together."]],
    work: [{ id: "au-w1", title: "Automation backbone", kind: "mission", state: "Active", note: "35% wired." }],
  },

  /* ── Finance & Control ────────────────────────────────────────────────── */
  {
    id: "ai-controller",
    name: "AI Controller",
    type: "ai-agent",
    departmentId: "finance",
    role: "AI director",
    initials: "CT",
    status: "Active",
    mission: "Monthly close",
    responsibility: "Watch controls and flag anything that moves without authority.",
    purpose: "Keep the numbers right and movements controlled.",
    reportsTo: "Founder",
    collaborates: ["Bookkeeping", "Margin / Audit"],
    priority: "Complete the monthly close",
    attention: ["Approval limit breach detected"],
    capability: "Controls, approvals and financial risk flagging.",
    workspaceActorId: "finance.ai-controller",
    autonomy: "Auto low-risk",
    model: { policy: "AUTO", preferred: "reasoning-generalist", fallback: "fast-generalist" },
    skills: [
      ["financial-controls", "Mastered", "Today"],
      ["reconciliation", "Proficient", "1h ago"],
      ["margin-analysis", "Proficient", "Today"],
    ],
    tools: [
      ["ledger.write", "Approval", "1h ago"],
      ["payment.hold", "Allowed", "Today"],
      ["report.generate", "Allowed", "Today"],
    ],
    workflows: [["month-end-close", "Ready"], ["spend-approval", "Ready"]],
    memorySeeds: [
      ["department", "Finance operating context", "Limits, controls and approval rules."],
      ["decisions", "Hold anything above the limit", "Wait for a human, never waive it."],
    ],
    work: [
      { id: "ct-w1", title: "Monthly close", kind: "mission", state: "Active", note: "70% closed." },
      { id: "ct-w2", title: "Approval limit breach", kind: "blocker", state: "Flagged", note: "Two payments held." },
    ],
  },
  {
    id: "finance-lead",
    name: "Finance Lead",
    type: "human",
    departmentId: "finance",
    role: "Human manager",
    initials: "FL",
    status: "Waiting",
    mission: "Collections review",
    responsibility: "Owns the books and approves financial movements.",
    purpose: "Hold financial authority and the final approval call.",
    reportsTo: "Founder",
    collaborates: ["AI Controller", "Collections"],
    priority: "Release the two held payments",
    attention: ["Two payments held for you"],
    capability: "Financial approval and books ownership.",
    workspaceActorId: "finance.human-lead",
    skills: [
      ["financial-controls", "Proficient", "Today"],
      ["budget-ownership", "Mastered", "1h ago"],
      ["collections", "Proficient", "Yesterday"],
    ],
    tools: [
      ["ledger.write", "Allowed", "1h ago"],
      ["report.generate", "Allowed", "Today"],
      ["sheet.read", "Read-only", "Today"],
    ],
    workflows: [["spend-approval", "Ready"], ["collections-cycle", "Ready"]],
    autonomy: "Bounded autonomy",
    contact: [{ id: "c1", label: "Channel", value: "Direct · finance desk" }],
    memorySeeds: [["instructions", "Approval limit stays at the current figure", "Standing instruction from the founder."]],
    work: [
      { id: "fl-w1", title: "Approve 2 held payments", kind: "approval", state: "Needs you", note: "Above the approval limit." },
      { id: "fl-w2", title: "Collections review", kind: "mission", state: "Active", note: "Ageing is slipping." },
    ],
  },
  {
    id: "bookkeeping",
    name: "Bookkeeping",
    type: "ai-agent",
    departmentId: "finance",
    role: "AI specialist",
    initials: "BK",
    status: "Active",
    mission: "Reconciliation",
    responsibility: "Keep ledgers, entries and the close accurate.",
    purpose: "Make the books match reality.",
    reportsTo: "AI Controller",
    collaborates: ["Margin / Audit"],
    priority: "Reconcile the open entries",
    attention: [],
    capability: "Ledger entries, reconciliation and close support.",
    workspaceActorId: "finance.books",
    autonomy: "Execute with approval",
    model: { policy: "ECONOMY", preferred: "fast-generalist", fallback: "reasoning-generalist" },
    skills: [["reconciliation", "Mastered", "Today"], ["financial-controls", "Proficient", "Yesterday"]],
    tools: [
      ["ledger.write", "Approval", "Today"],
      ["sheet.read", "Read-only", "Today"],
      ["report.generate", "Allowed", "Yesterday"],
    ],
    workflows: [["month-end-close", "Ready"]],
    memorySeeds: [["project", "Open reconciliation items", "Entries still unmatched."]],
    work: [{ id: "bk-w1", title: "Reconcile open entries", kind: "job", state: "Running", note: "55% matched." }],
  },
  {
    id: "margin-audit",
    name: "Margin / Audit",
    type: "ai-agent",
    departmentId: "finance",
    role: "AI specialist",
    initials: "MA",
    status: "Thinking",
    mission: "Margin review",
    responsibility: "Read cost and performance and surface what is slipping.",
    purpose: "Keep margin visible and honest.",
    reportsTo: "AI Controller",
    collaborates: ["Bookkeeping"],
    priority: "Explain the margin decline",
    attention: [],
    capability: "Cost, margin and performance reading.",
    workspaceActorId: "finance.margin",
    autonomy: "Bounded autonomy",
    model: { policy: "AUTO", preferred: "reasoning-generalist", fallback: "fast-generalist" },
    skills: [["margin-analysis", "Mastered", "Today"], ["process-audit", "Proficient", "1h ago"]],
    tools: [
      ["sheet.read", "Read-only", "Today"],
      ["report.generate", "Allowed", "Today"],
      ["ledger.write", "Blocked", "—"],
    ],
    workflows: [["month-end-close", "Draft"]],
    memorySeeds: [["actor", "Margin baseline", "The reference the decline is measured against."]],
    work: [{ id: "ma-w1", title: "Margin review", kind: "mission", state: "Active", note: "Down 2 points." }],
  },
];

/* ── The lookup the route resolves against ─────────────────────────────── */

export const ACTORS: Record<string, ActorConfig> = ACTOR_SPECS.reduce(
  (acc, spec) => {
    acc[spec.id] = defineActor(spec);
    return acc;
  },
  {} as Record<string, ActorConfig>,
);

export function actorForSlug(slug: string): ActorConfig | null {
  return ACTORS[slug] ?? null;
}

/** The department Team item that opens this actor, if any. */
const SLUG_BY_WORKSPACE_ID: Record<string, string> = ACTOR_SPECS.reduce(
  (acc, spec) => {
    acc[spec.workspaceActorId] = spec.id;
    return acc;
  },
  {} as Record<string, string>,
);

/**
 * Resolve a Department Workspace Team item id (e.g. `growth.ai-director`) to
 * the Actor Workspace slug that opens it. Returns null when an actor has no
 * workspace yet, so the Team view can fall back cleanly.
 */
export function actorSlugForWorkspaceActor(workspaceActorId: string): string | null {
  return SLUG_BY_WORKSPACE_ID[workspaceActorId] ?? null;
}

/** Where an actor sits in the organization — used by "Back to Department". */
export function departmentHrefForActor(actor: ActorConfig): string {
  return workspaceHref(actor.departmentId);
}
