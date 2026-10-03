/**
 * NEXUP COMMAND — DEPARTMENT WORKSPACE CONFIGURATION (mock, Phase UI-03)
 * ──────────────────────────────────────────────────────────────────────
 * A Department Workspace is a *place*, not a dashboard, and there is exactly
 * one implementation of it. This file is the data that fills that one
 * implementation: the route slug, the eight internal modes, and the mock
 * operating content of each department.
 *
 * Design rules, consistent with `organization-model.ts`:
 *   · Adding a sixth department stays a data change — nothing renders lazily
 *     from names like "Growth".
 *   · Nothing here touches a database, an AI provider or a real integration.
 *     Every value is illustrative and the UI says so out loud.
 *   · Team identities are ROLE-based, never a real person's name, so the same
 *     model works for a founder, a human manager, an AI Director or a
 *     specialist.
 *
 * Future compatibility (deliberately NOT built here):
 *   · `WorkspaceActor.id` is the same id a future `/command/actors/[actorId]`
 *     route would resolve, so Team items can become links without restructuring.
 *   · `Capability` carries NO permanent owner — capabilities are reusable and
 *     may later be attached to or detached from an agent dynamically.
 */

import { systemsForDepartment, type DepartmentId } from "./organization-model";

/* ── Modes ─────────────────────────────────────────────────────────────────
   The eight internal surfaces every department workspace hosts. Icons are
   resolved by the UI from the shared icon set (keys, never component refs, so
   this file stays plain serialisable data).                                */

export type WorkspaceModeId =
  | "overview"
  | "work"
  | "team"
  | "map"
  | "flow"
  | "capabilities"
  | "memory"
  | "systems";

export type WorkspaceMode = {
  id: WorkspaceModeId;
  label: string;
  /** One short line, used as the tab's title and the mode's own subhead. */
  hint: string;
};

export const WORKSPACE_MODES: WorkspaceMode[] = [
  { id: "overview", label: "Overview", hint: "The operational picture" },
  { id: "work", label: "Work", hint: "Missions, jobs, approvals" },
  { id: "team", label: "Team", hint: "Humans and AI agents" },
  { id: "map", label: "Map", hint: "Internal network" },
  { id: "flow", label: "Flow", hint: "Production pipeline" },
  { id: "capabilities", label: "Capabilities", hint: "Skills, tools, workflows" },
  { id: "memory", label: "Memory", hint: "Context and decisions" },
  { id: "systems", label: "Systems", hint: "Connected systems" },
];

/* ── Routing ───────────────────────────────────────────────────────────────
   One slug per department. The workspace route is `/command/departments/<slug>`
   so a department's URL never changes when its internals do.               */

export const DEPARTMENT_SLUGS: Record<DepartmentId, string> = {
  growth: "growth-revenue",
  client: "client-delivery",
  operations: "business-operations",
  product: "product-technology",
  finance: "finance-control",
};

/** Where this department's workspace lives. */
export function workspaceHref(id: DepartmentId): string {
  return `/command/departments/${DEPARTMENT_SLUGS[id]}`;
}

/** Resolve a route slug to a department id, or null when unknown. */
export function departmentIdForSlug(slug: string): DepartmentId | null {
  const ids = Object.keys(DEPARTMENT_SLUGS) as DepartmentId[];
  return ids.find((id) => DEPARTMENT_SLUGS[id] === slug) ?? null;
}

/* ── Shapes ────────────────────────────────────────────────────────────── */

export type ActorKind = "human" | "ai";

/** A member of the department's Team — human or AI, role-based identity. */
export type WorkspaceActor = {
  id: string;
  /** Role-based display label, never a real personal name. */
  name: string;
  role: string;
  kind: ActorKind;
  initials: string;
  /** Human-readable presence word: Active · Thinking · Idle · Waiting. */
  status: string;
  /** What this actor is on right now. Mock. */
  mission: string;
  /** One short line of what this actor is good for. */
  capability: string;
};

export type Mission = {
  id: string;
  title: string;
  /** Role label of the owner (human or AI), matching a Team actor. */
  owner: string;
  status: string;
  /** 0-100. Illustrative only. */
  progress: number;
  kind: "mission" | "job" | "task";
};

export type Kpi = {
  id: string;
  label: string;
  value: string;
  /** What the number is doing, in words — never a bare arrow. */
  trend: string;
};

export type FlowStage = {
  id: string;
  label: string;
  note: string;
  state: "done" | "active" | "next";
};

export type CapabilityKind = "Skill" | "Tool" | "Workflow" | "Template" | "Automation";

export type Capability = {
  id: string;
  name: string;
  kind: CapabilityKind;
  /** Who is *currently* using it — never a permanent owner. */
  usedBy: string;
  note: string;
};

export type MemoryLayer = {
  id: string;
  label: string;
  /** Number of references held. Placeholder counts, no fabricated content. */
  count: number;
  note: string;
};

export type SystemLink = {
  id: string;
  name: string;
  kind: string;
  mark: string;
  status: string;
  statusKind: string;
  /** What relationship this department has with the system. */
  purpose: string;
};

export type DepartmentWorkspaceConfig = {
  departmentId: DepartmentId;
  /** Demand → Leads → Sales → Revenue. The department's one-line purpose. */
  purpose: string;
  /** Human Lead + AI Director, etc. */
  ownership: string;
  /** Human-readable current state word. */
  state: string;
  objective: string;
  focus: string;
  /** Things needing a human decision. */
  attention: string[];
  bottleneck: string;
  missions: Mission[];
  kpis: Kpi[];
  team: WorkspaceActor[];
  flow: FlowStage[];
  capabilities: Capability[];
  memory: MemoryLayer[];
  systems: SystemLink[];
};

/* ── Shared vocabulary ─────────────────────────────────────────────────── */

const SYSTEM_PURPOSE: Record<string, string> = {
  nexup: "The business OS this department writes into — clients, projects and expenses.",
  "x-publisher": "Distribution — campaigns and scheduled posts leave through here.",
  rebound: "Operations system for shared clients, expenses and reporting.",
  "real-estate": "Portfolio surface — listings, viewings and property deals.",
};

function systemsFor(id: DepartmentId): SystemLink[] {
  return systemsForDepartment(id).map((system) => ({
    id: system.id,
    name: system.name,
    kind: system.kind,
    mark: system.mark,
    status: system.status,
    statusKind: system.statusKind,
    purpose: SYSTEM_PURPOSE[system.id] ?? `${system.kind} system.`,
  }));
}

/** Memory layers are the same structure everywhere — the content fills in later. */
function memoryLayers(seed: { decisions: number; lessons: number; context: number; projects: number }): MemoryLayer[] {
  return [
    { id: "department", label: "Department memory", count: seed.context, note: "Shared operating context this department reads from." },
    { id: "decisions", label: "Decisions", count: seed.decisions, note: "Choices made here, with the reasoning kept." },
    { id: "lessons", label: "Lessons learned", count: seed.lessons, note: "What worked, what did not, and why." },
    { id: "projects", label: "Project memory", count: seed.projects, note: "Context carried with finished and active work." },
    { id: "agents", label: "Agent memory references", count: 0, note: "Per-agent context links — occupied once the agent workspace exists." },
  ];
}

/* ── Department: Growth & Revenue (the reference implementation) ───────── */

const GROWTH: DepartmentWorkspaceConfig = {
  departmentId: "growth",
  purpose: "Demand → Leads → Sales → Revenue",
  ownership: "Human Lead + AI Director",
  state: "Working",
  objective: "Turn qualified demand into revenue across every business without slowing answer speed.",
  focus: "Reactivation campaign for dormant leads, plus the partner channel launch.",
  attention: ["Answer speed is below target on inbound leads", "Partner revenue share still undecided"],
  bottleneck: "Answer speed",
  missions: [
    { id: "g-m1", title: "Q4 outbound reactivation", owner: "Lead Acquisition", status: "Active", progress: 62, kind: "mission" },
    { id: "g-m2", title: "Partner channel launch", owner: "AI Growth Director", status: "Review", progress: 40, kind: "mission" },
    { id: "g-m3", title: "Real-estate listing push", owner: "Market Intelligence", status: "Active", progress: 28, kind: "mission" },
    { id: "g-m4", title: "Referral loop design", owner: "Sales Lead", status: "Idle", progress: 12, kind: "mission" },
    { id: "g-j1", title: "Enrich 340 dormant leads", owner: "Lead Acquisition", status: "Running", progress: 74, kind: "job" },
    { id: "g-t1", title: "Approve partner revenue share", owner: "Growth Lead", status: "Needs you", progress: 0, kind: "task" },
  ],
  kpis: [
    { id: "g-k1", label: "Pipeline value", value: "1.9M", trend: "up 12% this week" },
    { id: "g-k2", label: "Lead response time", value: "3h 40m", trend: "slipping — target is 1h" },
    { id: "g-k3", label: "Qualification rate", value: "34%", trend: "steady" },
    { id: "g-k4", label: "Win rate", value: "21%", trend: "up 3 points" },
  ],
  team: [
    { id: "growth.human-lead", name: "Growth Lead", role: "Human lead", kind: "human", initials: "GL", status: "Active", mission: "Partner channel launch", capability: "Owns revenue targets and final calls." },
    { id: "growth.sales-lead", name: "Sales Lead", role: "Human manager", kind: "human", initials: "SL", status: "Active", mission: "Pipeline conversion", capability: "Runs the deal desk and closes." },
    { id: "growth.ai-director", name: "AI Growth Director", role: "AI director", kind: "ai", initials: "GD", status: "Thinking", mission: "Channel strategy", capability: "Sets direction, routes work, reports." },
    { id: "growth.market-intel", name: "Market Intelligence", role: "AI specialist", kind: "ai", initials: "MI", status: "Active", mission: "Real-estate listing push", capability: "Signals, competition and demand reading." },
    { id: "growth.lead-acq", name: "Lead Acquisition", role: "AI specialist", kind: "ai", initials: "LA", status: "Active", mission: "Q4 outbound reactivation", capability: "Inbound capture and outbound sourcing." },
    { id: "growth.sales-crm", name: "Sales / CRM", role: "AI specialist", kind: "ai", initials: "SC", status: "Waiting", mission: "Pipeline hygiene", capability: "Pipeline state, follow-ups, CRM upkeep." },
  ],
  flow: [
    { id: "g-f1", label: "Opportunity", note: "A signal or a named account enters.", state: "done" },
    { id: "g-f2", label: "Research", note: "Fit, budget and timing are read.", state: "done" },
    { id: "g-f3", label: "Acquire lead", note: "Contact captured and enriched.", state: "done" },
    { id: "g-f4", label: "Qualify", note: "Scored against the ideal profile.", state: "active" },
    { id: "g-f5", label: "Outreach", note: "Sequence runs, answer speed matters.", state: "active" },
    { id: "g-f6", label: "Sales", note: "Owner works the deal.", state: "next" },
    { id: "g-f7", label: "Won / Lost", note: "Outcome recorded either way.", state: "next" },
    { id: "g-f8", label: "Learn", note: "Result feeds the market signal.", state: "next" },
  ],
  capabilities: [
    { id: "g-c1", name: "Demand scanning", kind: "Skill", usedBy: "Market Intelligence", note: "Reads markets and surfaces demand." },
    { id: "g-c2", name: "Lead enrichment", kind: "Tool", usedBy: "Lead Acquisition", note: "Fills firmographic and contact data." },
    { id: "g-c3", name: "Outbound sequence", kind: "Workflow", usedBy: "Lead Acquisition", note: "Multi-step outreach with pacing." },
    { id: "g-c4", name: "Qualification rule set", kind: "Automation", usedBy: "Sales / CRM", note: "Scores leads automatically." },
    { id: "g-c5", name: "Discovery call script", kind: "Template", usedBy: "Sales Lead", note: "Reusable structure for first calls." },
  ],
  memory: memoryLayers({ decisions: 14, lessons: 31, context: 128, projects: 9 }),
  systems: systemsFor("growth"),
};

/* ── Department: Client & Delivery ─────────────────────────────────────── */

const CLIENT: DepartmentWorkspaceConfig = {
  departmentId: "client",
  purpose: "Onboarding → Delivery → Retention",
  ownership: "Human Lead + AI Director",
  state: "Working",
  objective: "Deliver what was promised, on time, and keep the client aware without chasing.",
  focus: "Onboarding paperwork removal and delivery quality checks.",
  attention: ["Two onboardings blocked on paperwork"],
  bottleneck: "Onboarding paperwork",
  missions: [
    { id: "c-m1", title: "Onboarding flow rebuild", owner: "Onboarding", status: "Active", progress: 55, kind: "mission" },
    { id: "c-m2", title: "Delivery QA sweep", owner: "Client Success", status: "Active", progress: 33, kind: "mission" },
    { id: "c-j1", title: "Kickoff pack for 3 new clients", owner: "Service Delivery", status: "Running", progress: 60, kind: "job" },
    { id: "c-t1", title: "Confirm onboarding owner", owner: "Delivery Lead", status: "Needs you", progress: 0, kind: "task" },
  ],
  kpis: [
    { id: "c-k1", label: "Clients in flight", value: "6", trend: "steady" },
    { id: "c-k2", label: "On-time delivery", value: "88%", trend: "up 4 points" },
    { id: "c-k3", label: "Retention", value: "94%", trend: "steady" },
    { id: "c-k4", label: "Onboarding time", value: "4.2 days", trend: "target is 2 days" },
  ],
  team: [
    { id: "client.human-lead", name: "Delivery Lead", role: "Human lead", kind: "human", initials: "DL", status: "Active", mission: "Onboarding flow rebuild", capability: "Owns delivery promises." },
    { id: "client.success-lead", name: "Client Success Lead", role: "Human manager", kind: "human", initials: "CS", status: "Waiting", mission: "Retention checks", capability: "Keeps clients aware and retained." },
    { id: "client.ai-director", name: "AI Delivery Director", role: "AI director", kind: "ai", initials: "DD", status: "Thinking", mission: "QA sweep", capability: "Routes delivery work and flags risk." },
    { id: "client.onboarding", name: "Onboarding", role: "AI specialist", kind: "ai", initials: "ON", status: "Active", mission: "Kickoff packs", capability: "Sets clients up correctly." },
    { id: "client.qa", name: "Delivery QA", role: "AI specialist", kind: "ai", initials: "QA", status: "Active", mission: "Quality checks", capability: "Checks work before it ships." },
  ],
  flow: [
    { id: "c-f1", label: "Won", note: "Deal handed to delivery.", state: "done" },
    { id: "c-f2", label: "Onboard", note: "Access, scope and expectations.", state: "active" },
    { id: "c-f3", label: "Plan", note: "Work broken into deliverables.", state: "next" },
    { id: "c-f4", label: "Deliver", note: "Execution against the promise.", state: "next" },
    { id: "c-f5", label: "Review", note: "Quality checked before shipping.", state: "next" },
    { id: "c-f6", label: "Retain", note: "Success and renewal.", state: "next" },
  ],
  capabilities: [
    { id: "c-c1", name: "Kickoff pack", kind: "Template", usedBy: "Onboarding", note: "Standard client setup bundle." },
    { id: "c-c2", name: "Delivery checklist", kind: "Workflow", usedBy: "Delivery QA", note: "Ensures nothing ships unchecked." },
    { id: "c-c3", name: "Client pulse read", kind: "Skill", usedBy: "Client Success Lead", note: "Reads satisfaction and risk." },
    { id: "c-c4", name: "Status digest", kind: "Automation", usedBy: "AI Delivery Director", note: "Sends clients periodic updates." },
  ],
  memory: memoryLayers({ decisions: 8, lessons: 19, context: 96, projects: 14 }),
  systems: systemsFor("client"),
};

/* ── Department: Business Operations ───────────────────────────────────── */

const OPERATIONS: DepartmentWorkspaceConfig = {
  departmentId: "operations",
  purpose: "Process → Vendors → Quality",
  ownership: "Human Lead + AI Director",
  state: "Working",
  objective: "Keep work moving with predictable process, reliable vendors and honest quality checks.",
  focus: "Runbook coverage and vendor lead times.",
  attention: ["Runbook coverage at 92%", "Vendor lead times creeping up"],
  bottleneck: "Vendor lead times",
  missions: [
    { id: "o-m1", title: "Runbook coverage to 100%", owner: "Process Control", status: "Active", progress: 92, kind: "mission" },
    { id: "o-m2", title: "Vendor consolidation", owner: "Vendors & Logistics", status: "Review", progress: 30, kind: "mission" },
    { id: "o-j1", title: "Weekly quality sweep", owner: "Quality & Follow-up", status: "Running", progress: 48, kind: "job" },
  ],
  kpis: [
    { id: "o-k1", label: "Runbook coverage", value: "92%", trend: "up 6 points" },
    { id: "o-k2", label: "Vendor lead time", value: "9 days", trend: "up 2 days — watch" },
    { id: "o-k3", label: "Escalations open", value: "3", trend: "down 1" },
  ],
  team: [
    { id: "ops.human-lead", name: "Operations Lead", role: "Human lead", kind: "human", initials: "OL", status: "Active", mission: "Vendor consolidation", capability: "Owns process and vendors." },
    { id: "ops.ai-director", name: "AI Operations Director", role: "AI director", kind: "ai", initials: "OD", status: "Thinking", mission: "Runbook coverage", capability: "Watches SLAs and routes exceptions." },
    { id: "ops.process", name: "Process Control", role: "AI specialist", kind: "ai", initials: "PC", status: "Active", mission: "Runbooks & SLAs", capability: "Keeps process documented and current." },
    { id: "ops.quality", name: "Quality & Follow-up", role: "AI specialist", kind: "ai", initials: "QO", status: "Waiting", mission: "Quality sweep", capability: "Checks output and escalates." },
  ],
  flow: [
    { id: "o-f1", label: "Request", note: "Work enters the process.", state: "done" },
    { id: "o-f2", label: "Plan", note: "Owner and runbook chosen.", state: "active" },
    { id: "o-f3", label: "Execute", note: "Work carried out to standard.", state: "next" },
    { id: "o-f4", label: "Check", note: "Quality verified.", state: "next" },
    { id: "o-f5", label: "Close", note: "Outcome recorded and learned from.", state: "next" },
  ],
  capabilities: [
    { id: "o-c1", name: "Runbook library", kind: "Template", usedBy: "Process Control", note: "Reusable operating procedures." },
    { id: "o-c2", name: "SLA monitor", kind: "Automation", usedBy: "AI Operations Director", note: "Flags services drifting off target." },
    { id: "o-c3", name: "Vendor scorecard", kind: "Skill", usedBy: "Operations Lead", note: "Rates suppliers objectively." },
    { id: "o-c4", name: "Exception routing", kind: "Workflow", usedBy: "Quality & Follow-up", note: "Sends exceptions to the right owner." },
  ],
  memory: memoryLayers({ decisions: 11, lessons: 24, context: 84, projects: 7 }),
  systems: systemsFor("operations"),
};

/* ── Department: Product & Technology ──────────────────────────────────── */

const PRODUCT: DepartmentWorkspaceConfig = {
  departmentId: "product",
  purpose: "Build → Ship → Operate",
  ownership: "Product lead + AI Builder",
  state: "Working",
  objective: "Build the systems the rest of the organization runs on, and keep them reliable.",
  focus: "Command Shell UI review and agent workforce design.",
  attention: ["Review queue depth is the current drag"],
  bottleneck: "Review queue depth",
  missions: [
    { id: "p-m1", title: "Command Shell UI", owner: "Full-stack", status: "Review", progress: 80, kind: "mission" },
    { id: "p-m2", title: "Workforce design", owner: "Agent Engineer", status: "Active", progress: 45, kind: "mission" },
    { id: "p-m3", title: "Automation backbone", owner: "Automation", status: "Active", progress: 35, kind: "mission" },
    { id: "p-j1", title: "Triage review queue", owner: "Product Discovery", status: "Running", progress: 22, kind: "job" },
  ],
  kpis: [
    { id: "p-k1", label: "Review queue depth", value: "14", trend: "up 5 — slowing delivery" },
    { id: "p-k2", label: "Ship cadence", value: "5 / week", trend: "steady" },
    { id: "p-k3", label: "Incidents open", value: "1", trend: "down 2" },
  ],
  team: [
    { id: "product.human-lead", name: "Product Lead", role: "Human lead", kind: "human", initials: "PL", status: "Active", mission: "Command Shell UI", capability: "Owns priorities and product calls." },
    { id: "product.ai-builder", name: "AI Builder", role: "AI specialist", kind: "ai", initials: "BU", status: "Active", mission: "Workforce design", capability: "Implements and automates." },
    { id: "product.discovery", name: "Product Discovery", role: "AI specialist", kind: "ai", initials: "PD", status: "Thinking", mission: "Review triage", capability: "Frames problems and priorities." },
    { id: "product.automation", name: "Automation", role: "AI specialist", kind: "ai", initials: "AU", status: "Active", mission: "Automation backbone", capability: "Connects systems and workflows." },
  ],
  flow: [
    { id: "p-f1", label: "Discover", note: "Problem framed and prioritised.", state: "done" },
    { id: "p-f2", label: "Design", note: "Approach agreed.", state: "active" },
    { id: "p-f3", label: "Build", note: "Implementation.", state: "active" },
    { id: "p-f4", label: "Review", note: "Checked before it ships.", state: "next" },
    { id: "p-f5", label: "Ship", note: "Released to the organization.", state: "next" },
    { id: "p-f6", label: "Operate", note: "Monitored and maintained.", state: "next" },
  ],
  capabilities: [
    { id: "p-c1", name: "Full-stack build", kind: "Skill", usedBy: "Full-stack", note: "Surfaces and APIs end to end." },
    { id: "p-c2", name: "Workforce design", kind: "Skill", usedBy: "Agent Engineer", note: "Designs agent roles and limits." },
    { id: "p-c3", name: "CI pipeline", kind: "Automation", usedBy: "AI Builder", note: "Builds, checks and ships changes." },
    { id: "p-c4", name: "Review checklist", kind: "Workflow", usedBy: "Product Lead", note: "Consistent review before release." },
  ],
  memory: memoryLayers({ decisions: 22, lessons: 40, context: 140, projects: 11 }),
  systems: systemsFor("product"),
};

/* ── Department: Finance & Control ─────────────────────────────────────── */

const FINANCE: DepartmentWorkspaceConfig = {
  departmentId: "finance",
  purpose: "Money in → Money out → Margin",
  ownership: "AI Controller + Founder",
  state: "Attention",
  objective: "Know the numbers are right, and make sure nothing moves without a control.",
  focus: "Two payments held for approval.",
  attention: ["Two payments held for you", "Approval limit breach detected"],
  bottleneck: "Approval limit breach",
  missions: [
    { id: "f-m1", title: "Monthly close", owner: "Bookkeeping", status: "Active", progress: 70, kind: "mission" },
    { id: "f-m2", title: "Collections sweep", owner: "Collections", status: "Active", progress: 38, kind: "mission" },
    { id: "f-j1", title: "Reconcile open entries", owner: "Bookkeeping", status: "Running", progress: 55, kind: "job" },
    { id: "f-t1", title: "Approve 2 held payments", owner: "Founder", status: "Needs you", progress: 0, kind: "task" },
  ],
  kpis: [
    { id: "f-k1", label: "Margin", value: "31%", trend: "down 2 points" },
    { id: "f-k2", label: "Receivables ageing", value: "18 days", trend: "slipping" },
    { id: "f-k3", label: "Held payments", value: "2", trend: "needs you" },
  ],
  team: [
    { id: "finance.ai-controller", name: "AI Controller", role: "AI director", kind: "ai", initials: "CT", status: "Active", mission: "Monthly close", capability: "Watches controls and flags breaches." },
    { id: "finance.human-lead", name: "Finance Lead", role: "Human manager", kind: "human", initials: "FL", status: "Waiting", mission: "Collections review", capability: "Owns the books and approvals." },
    { id: "finance.books", name: "Bookkeeping", role: "AI specialist", kind: "ai", initials: "BK", status: "Active", mission: "Reconciliation", capability: "Ledgers, entries and close." },
    { id: "finance.margin", name: "Margin / Audit", role: "AI specialist", kind: "ai", initials: "MA", status: "Thinking", mission: "Margin review", capability: "Cost and performance checks." },
  ],
  flow: [
    { id: "f-f1", label: "Capture", note: "Income and spend recorded.", state: "done" },
    { id: "f-f2", label: "Classify", note: "Correct category and control applied.", state: "active" },
    { id: "f-f3", label: "Approve", note: "Anything above limit needs a human.", state: "active" },
    { id: "f-f4", label: "Reconcile", note: "Matched against reality.", state: "next" },
    { id: "f-f5", label: "Report", note: "Margin and position surfaced.", state: "next" },
  ],
  capabilities: [
    { id: "f-c1", name: "Reconciliation", kind: "Workflow", usedBy: "Bookkeeping", note: "Matches entries to actuals." },
    { id: "f-c2", name: "Approval policy", kind: "Automation", usedBy: "AI Controller", note: "Holds anything over the limit." },
    { id: "f-c3", name: "Margin read", kind: "Skill", usedBy: "Margin / Audit", note: "Reads cost and performance." },
    { id: "f-c4", name: "Close checklist", kind: "Template", usedBy: "Finance Lead", note: "Repeatable month-end close." },
  ],
  memory: memoryLayers({ decisions: 17, lessons: 12, context: 72, projects: 5 }),
  systems: systemsFor("finance"),
};

/* ── The lookup the route resolves against ─────────────────────────────── */

export const WORKSPACES: Record<DepartmentId, DepartmentWorkspaceConfig> = {
  growth: GROWTH,
  client: CLIENT,
  operations: OPERATIONS,
  product: PRODUCT,
  finance: FINANCE,
};

export function workspaceFor(id: DepartmentId): DepartmentWorkspaceConfig {
  return WORKSPACES[id];
}

/** Split a team into its human and AI halves for the Team mode. */
export function teamByKind(config: DepartmentWorkspaceConfig) {
  return {
    humans: config.team.filter((actor) => actor.kind === "human"),
    agents: config.team.filter((actor) => actor.kind === "ai"),
  };
}
