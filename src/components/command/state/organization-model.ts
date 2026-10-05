/**
 * NEXUP COMMAND — ORGANIZATION CONFIGURATION (mock, Phase UI-02.1)
 * ────────────────────────────────────────────────────────────────
 * Pure data, and now the single source of truth for the spatial scene. The
 * CommandScene renders whatever this file describes, so adding a department, a
 * second company or an extra space stays a *data* change: no scene component
 * knows the name "Growth", and no component owns department-specific logic.
 *
 * Three things live here:
 *   · ORGANIZATION  — the configuration object the scene reads.
 *   · derived exports (EXECUTIVE, DEPARTMENTS, …) — kept from UI-01.1 so the
 *     rest of the environment (list view, deck, rail, scenarios) needs no
 *     knowledge of the new shape.
 *   · nodeAnchor()  — the one coordinate resolver shared by the pod layer and
 *     the SVG connection layer, so wiring can never drift from the pod it
 *     belongs to, including while the camera moves.
 *
 * SPATIAL LAYOUT
 * The scene is deliberately asymmetric: five pods on one ring reads as a
 * dashboard, so each department carries its own x/y *and* its own depth. Depth
 * is a real translateZ consumed by CSS `perspective`, which is what makes
 * "nearer / further" perceptible instead of merely decorative.
 */

export type DepartmentId = "growth" | "client" | "operations" | "product" | "finance";

export type Worker = {
  id: string;
  name: string;
  role: string;
};

/** One command-surface cell. Configuration, never duplicated markup. */
export type DeckAction = {
  id: string;
  label: string;
  /** Icon key resolved by the surface from the shared icon set. */
  icon: DeckIconKey;
  /** One short line under the label: what this does, in the operator's words. */
  hint: string;
  /** Plain-language statement of what this would do to the organization. */
  intent: string;
};

export type DeckIconKey =
  | "mission"
  | "warroom"
  | "call"
  | "systems"
  | "control"
  | "build"
  | "review"
  | "workflow"
  | "lab"
  | "run"
  | "tool"
  | "more"
  | "map"
  | "stack";

export type Department = {
  id: DepartmentId;
  name: string;
  short: string;
  /** What this department is accountable for — shown on focus. */
  brief: string;
  /** Short capability line, used when the department has no live work. */
  capability: string;
  /** CSS custom property holding this department's restrained identity accent. */
  accentVar: string;
  /** The space's own vocabulary ("Growth floor", "Delivery bay") — spatial, not card-like. */
  space: string;
  /** Pod-centre anchor, in percent of the stage (0-100). Not a ring. */
  x: number;
  y: number;
  /**
   * Depth in px, consumed as `translateZ` under the stage perspective.
   * Positive = nearer the viewer. Deliberately uneven across the five pods.
   */
  depth: number;
  /** Headline crew size — drives the "+N" overflow on the presence cluster. */
  crew: number;
  workers: Worker[];
  /** Human + AI presence in this space (actor ids from `actors.ts`). */
  presence: string[];
  /** Who directs this space. Mock. */
  director: string;
  /** One important live insight shown on the pod. Mock. */
  insight: string;
  /** The single thing slowing this space down right now. Mock. */
  bottleneck: string;
  /** Missions owned by this space (count only — labels come from projects). */
  missions: number;
  /** This space's own adaptive deck. */
  deck: DeckAction[];
};

/* ── Reusable deck presets so five departments don't become five copies ─── */

const DECK_BUILD: DeckAction[] = [
  { id: "build", label: "Start Build", icon: "build", hint: "Ship a change from this space", intent: "Open a build run in this space." },
  { id: "review", label: "Review Project", icon: "review", hint: "Read what this space shipped", intent: "Review what this space shipped." },
  { id: "call", label: "Call Specialist", icon: "call", hint: "Bring the right specialist in", intent: "Pull the right specialist into the conversation." },
  { id: "workflow", label: "Run Workflow", icon: "workflow", hint: "Execute a registered workflow", intent: "Execute a workflow registered to this space." },
  { id: "lab", label: "Build Lab", icon: "lab", hint: "Build this space's own tools", intent: "Open the lab where this space builds its own tools." },
];

const DECK_REVENUE: DeckAction[] = [
  { id: "mission", label: "New Campaign", icon: "mission", hint: "Draft demand for this space", intent: "Draft a campaign for this space." },
  { id: "review", label: "Review Pipeline", icon: "review", hint: "Read what is in the pipeline", intent: "Review what is in the pipeline." },
  { id: "call", label: "Call Specialist", icon: "call", hint: "Bring the right specialist in", intent: "Pull the right specialist into the conversation." },
  { id: "workflow", label: "Run Workflow", icon: "workflow", hint: "Execute a registered workflow", intent: "Execute a workflow registered to this space." },
  { id: "lab", label: "Build Lab", icon: "lab", hint: "Build this space's own tools", intent: "Open the lab where this space builds its own tools." },
];

const DECK_MONEY: DeckAction[] = [
  { id: "review", label: "Review Ledger", icon: "review", hint: "Open the books for review", intent: "Open the ledger for review." },
  { id: "run", label: "Run Reconciliation", icon: "run", hint: "Match entries against reality", intent: "Reconcile open entries for this space." },
  { id: "mission", label: "New Control", icon: "mission", hint: "Draft a financial control", intent: "Draft a financial control." },
  { id: "call", label: "Call Specialist", icon: "call", hint: "Bring the right specialist in", intent: "Pull the right specialist into the conversation." },
  { id: "lab", label: "Build Lab", icon: "lab", hint: "Build this space's own tools", intent: "Open the lab where this space builds its own tools." },
];

const DECK_DELIVERY: DeckAction[] = [
  { id: "mission", label: "New Mission", icon: "mission", hint: "Open work inside this space", intent: "Open a mission inside this space." },
  { id: "review", label: "Review Delivery", icon: "review", hint: "Read what is being delivered", intent: "Review what is being delivered right now." },
  { id: "call", label: "Call Team", icon: "call", hint: "Pull the delivery team in", intent: "Pull the delivery team into the conversation." },
  { id: "run", label: "Run Check", icon: "run", hint: "Check quality over active work", intent: "Run a quality check over active work." },
  { id: "lab", label: "Build Lab", icon: "lab", hint: "Build this space's own tools", intent: "Open the lab where this space builds its own tools." },
];

const DECK_PROCESS: DeckAction[] = [
  { id: "mission", label: "New Mission", icon: "mission", hint: "Open work inside this space", intent: "Open a mission inside this space." },
  { id: "workflow", label: "Run Workflow", icon: "workflow", hint: "Execute a registered runbook", intent: "Execute a runbook registered to this space." },
  { id: "tool", label: "Use Tool", icon: "tool", hint: "Invoke a capability under policy", intent: "Invoke a registered capability under policy." },
  { id: "call", label: "Call Team", icon: "call", hint: "Pull the operations team in", intent: "Pull the operations team into the conversation." },
  { id: "more", label: "More", icon: "more", hint: "More arrives with the Work area", intent: "More actions surface with the Work area." },
];

/** The organization's own surface, used at the overview level. */
export const OVERVIEW_DECK: DeckAction[] = [
  { id: "mission", label: "New Mission", icon: "mission", hint: "Turn an idea into execution", intent: "Open a mission and assign a department." },
  { id: "warroom", label: "War Room", icon: "warroom", hint: "Open a temporary mission room", intent: "Open a temporary mission room with the relevant actors." },
  { id: "call", label: "Call", icon: "call", hint: "Pull people and agents in", intent: "Pull the right people and agents into the conversation." },
  { id: "systems", label: "Systems", icon: "systems", hint: "Reach what you run on", intent: "Reach the systems this organization runs on." },
  { id: "control", label: "Control", icon: "control", hint: "Policy, limits, approvals", intent: "Open policy, limits and approval rules." },
];

/**
 * The internal surfaces a focused department can host. NOT built in this phase:
 * the focused workspace reserves the slots so entering a space already reads as
 * entering a place with rooms, and a later phase fills them one at a time.
 */
export type WorkspaceMode = { id: string; label: string; icon: DeckIconKey; hint: string };

export const WORKSPACE_MODES: WorkspaceMode[] = [
  { id: "work", label: "Work", icon: "run", hint: "Live work in this space" },
  { id: "map", label: "Map", icon: "map", hint: "Who and what is here — later phase" },
  { id: "flow", label: "Flow", icon: "workflow", hint: "How work moves through it — later phase" },
  { id: "assets", label: "Assets", icon: "stack", hint: "What this space runs on — later phase" },
];

export const DEPARTMENTS: Department[] = [
  {
    id: "operations",
    name: "Operations",
    short: "OPS",
    brief: "The machine that keeps work moving: process, vendors, quality.",
    capability: "People · Process · Support",
    accentVar: "--nc-operations",
    space: "Operations floor",
    /* The composition puts the spaces on the flanks so the Intelligence Core
       has room to breathe in the middle — a deliberate repositioning for the
       command-center reading, not a ring. */
    x: 22,
    y: 82,
    depth: 30,
    crew: 8,
    workers: [
      { id: "operations.process", name: "Process Control", role: "Runbooks & SLAs" },
      { id: "operations.vendors", name: "Vendors & Logistics", role: "Suppliers & supply" },
      { id: "operations.quality", name: "Quality & Follow-up", role: "Checks & escalations" },
    ],
    presence: ["human-ops-lead", "ai-director"],
    director: "AI Director · Ops",
    insight: "Runbook coverage at 92%",
    bottleneck: "Vendor lead times",
    missions: 2,
    deck: DECK_PROCESS,
  },
  {
    id: "client",
    name: "Client & Delivery",
    short: "CLIENT",
    brief: "Everything a client feels: onboarding, delivery and retention.",
    capability: "Clients · Projects · QA",
    accentVar: "--nc-client",
    space: "Delivery bay",
    x: 17,
    y: 50,
    /* Furthest back: the quietest space when nothing is at risk. */
    depth: -70,
    crew: 6,
    workers: [
      { id: "client.onboarding", name: "Onboarding", role: "Kickoff & setup" },
      { id: "client.delivery", name: "Service Delivery", role: "Execution on promise" },
      { id: "client.success", name: "Client Success", role: "Retention & growth" },
    ],
    presence: ["human-product-lead", "ai-analyst"],
    director: "AI Director · Delivery",
    insight: "6 clients in flight",
    bottleneck: "Onboarding paperwork",
    missions: 2,
    deck: DECK_DELIVERY,
  },
  {
    id: "product",
    name: "Product & Tech",
    short: "PRODUCT",
    brief: "Building the systems the rest of the organization runs on.",
    capability: "Build · AI · Automation",
    accentVar: "--nc-product",
    space: "Build floor",
    x: 80,
    y: 26,
    depth: 55,
    crew: 7,
    workers: [
      { id: "product.discovery", name: "Product Discovery", role: "Problems & priorities" },
      { id: "product.agents", name: "Agent Engineer", role: "Workforce design" },
      { id: "product.automation", name: "Automation", role: "Workflows & integrations" },
      { id: "product.fullstack", name: "Full-stack", role: "Surfaces & APIs" },
    ],
    presence: ["human-product-lead", "ai-builder"],
    director: "Product lead",
    insight: "Command Shell UI in review",
    bottleneck: "Review queue depth",
    missions: 3,
    deck: DECK_BUILD,
  },
  {
    id: "growth",
    name: "Growth & Revenue",
    short: "GROWTH",
    brief: "Demand, pipeline and revenue generation across every business.",
    capability: "Leads · Sales · Market",
    accentVar: "--nc-growth",
    space: "Growth floor",
    x: 20,
    y: 16,
    /* Nearest the viewer: revenue is the space a founder leans toward. */
    depth: 95,
    crew: 8,
    workers: [
      { id: "growth.market", name: "Market Intelligence", role: "Signal & competition" },
      { id: "growth.leads", name: "Lead Acquisition", role: "Inbound & outbound" },
      { id: "growth.sales", name: "Sales / CRM", role: "Pipeline & conversion" },
    ],
    presence: ["human-ops-lead", "ai-director"],
    director: "AI Director · Growth",
    insight: "18 leads being qualified",
    bottleneck: "Answer speed",
    missions: 4,
    deck: DECK_REVENUE,
  },
  {
    id: "finance",
    name: "Finance & Control",
    short: "FINANCE",
    brief: "Money in, money out, and whether any of it is working.",
    capability: "Money · Margin · Audit",
    accentVar: "--nc-finance",
    space: "Control room",
    x: 79,
    y: 64,
    depth: -95,
    crew: 4,
    workers: [
      { id: "finance.books", name: "Bookkeeping", role: "Ledgers & reconciliation" },
      { id: "finance.collections", name: "Collections", role: "Receivables & ageing" },
      { id: "finance.margin", name: "Margin / Audit", role: "Cost & performance" },
    ],
    presence: ["human-founder", "ai-controller"],
    director: "AI Controller",
    insight: "Two payments held for you",
    bottleneck: "Approval limit breach",
    missions: 1,
    deck: DECK_MONEY,
  },
];

/**
 * The Founder is deliberately NOT a node in the graph. Authority is expressed
 * as the greeting block instead, which keeps the scene clean and puts the human
 * where the human actually sits: above the whole system, not inside it.
 */
export const FOUNDER = {
  /* Anonymous by design: the authority slot shows its role, never a real name. */
  name: "Founder",
  role: "Founder / Human Authority",
  initials: "FN",
  /** Focus card shown beside the greeting. */
  focus: { label: "Today's Focus", value: "3 active missions" },
} as const;

/**
 * The central intelligence / router. Everything flows through it.
 * In UI-02.1 it is rendered by `ExecCore`, which is a presence — layered core,
 * rings, a small lime energy centre and a state line — not a glowing circle.
 */
export const EXECUTIVE = {
  id: "executive",
  label: "Right-Hand Executive",
  short: "EXEC",
  kicker: "Central intelligence · router",
  /** Canonical level name in the spatial hierarchy. */
  level: "Intelligence Core",
  /** Core centre, in percent of the stage (overview). */
  x: 50,
  y: 45,
  /** The core always sits between the viewer and the far spaces. */
  depth: 20,
} as const;

/**
 * The whole scene as one configuration object. Anything the spatial layer
 * needs to know about the organization is reachable from here, which is what
 * makes "add a department later" a data change.
 */
export const ORGANIZATION = {
  id: "nexup",
  name: "NEXUP",
  /** Level in the spatial hierarchy this configuration renders. */
  level: "Organization",
  executive: EXECUTIVE,
  departments: DEPARTMENTS,
  overviewDeck: OVERVIEW_DECK,
} as const;

export type OrganizationConfig = typeof ORGANIZATION;

export const DEPARTMENT_IDS: DepartmentId[] = DEPARTMENTS.map((d) => d.id);

export const DEPARTMENT_BY_ID: Record<string, Department> = DEPARTMENTS.reduce(
  (acc, department) => {
    acc[department.id] = department;
    return acc;
  },
  {} as Record<string, Department>,
);

/**
 * Resolve any node id to its canvas anchor. The pod layer and the SVG
 * connection layer both read from this, so a connection can never drift away
 * from the pod it belongs to — including while the camera is moving, because
 * both live inside the same transformed canvas.
 */
export function nodeAnchor(id: string): { x: number; y: number } | null {
  if (id === EXECUTIVE.id) return { x: EXECUTIVE.x, y: EXECUTIVE.y };
  const department = DEPARTMENT_BY_ID[id];
  return department ? { x: department.x, y: department.y } : null;
}

/** Depth for any node id, in px. Used by the pod layer and the wiring layer. */
export function nodeDepth(id: string): number {
  if (id === EXECUTIVE.id) return EXECUTIVE.depth;
  return DEPARTMENT_BY_ID[id]?.depth ?? 0;
}

/** Look up a worker's display data from a `departmentId.workerId` key. */
export function findWorker(departmentId: string, workerId: string): Worker | undefined {
  return DEPARTMENT_BY_ID[departmentId]?.workers.find((worker) => worker.id === workerId);
}

/** The deck for a level: organization overview, or one department's own. */
export function deckFor(departmentId: DepartmentId | null): DeckAction[] {
  if (!departmentId) return ORGANIZATION.overviewDeck;
  return DEPARTMENT_BY_ID[departmentId]?.deck ?? ORGANIZATION.overviewDeck;
}

/* ── Connected systems (mock) ─────────────────────────────────────────────
   Visual only. `href` is set solely for NEXUP System, which is allowed to
   route to the existing production surface because that surface already
   exists — nothing here creates a fake backend integration.                */

export type SystemEntry = {
  id: string;
  name: string;
  kind: string;
  mark: string;
  accentVar: string;
  capabilities: string[];
  /** Status word shown on the perimeter node. Purely descriptive here. */
  status: string;
  statusKind: "online" | "running" | "connected" | "development";
  /** `base` is the system the rest hang off, which changes how it is drawn. */
  role?: "base" | "endpoint";
  /**
   * Where this system is mounted on the perimeter of the room, in percent of the
   * stage. Infrastructure lives on the walls, not in the middle of the floor.
   */
  perimeter: { x: number; y: number };
  /**
   * Which spaces actually reach this system. Mock relationships, and the only
   * reason a node ever lights up: a system matters when a space is using it.
   */
  linkedDepartments: DepartmentId[];
  /** Only real, already-existing destinations get an href. */
  href?: string;
};

export const SYSTEMS: SystemEntry[] = [
  {
    id: "nexup",
    name: "NEXUP System",
    kind: "Business OS",
    mark: "NX",
    accentVar: "--nc-growth",
    capabilities: ["Clients", "Projects", "Withdrawals", "Expenses"],
    status: "Online",
    statusKind: "online",
    role: "base",
    perimeter: { x: 95, y: 78 },
    linkedDepartments: ["finance", "client"],
    href: "/office",
  },
  {
    id: "x-publisher",
    name: "X Publisher",
    kind: "Distribution",
    mark: "XP",
    accentVar: "--nc-finance",
    capabilities: ["Channels", "Scheduling", "Analytics"],
    status: "Running",
    statusKind: "running",
    role: "endpoint",
    perimeter: { x: 95, y: 22 },
    linkedDepartments: ["growth"],
  },
  {
    id: "rebound",
    name: "REBOUND",
    kind: "Operations",
    mark: "RB",
    accentVar: "--nc-product",
    capabilities: ["Clients", "Expenses", "Reports"],
    status: "Connected",
    statusKind: "connected",
    role: "endpoint",
    perimeter: { x: 5, y: 14 },
    linkedDepartments: ["operations", "product"],
  },
  {
    id: "real-estate",
    name: "Real Estate",
    kind: "Portfolio",
    mark: "RE",
    accentVar: "--nc-operations",
    capabilities: ["Listings", "Viewings", "Deals"],
    status: "Development",
    statusKind: "development",
    role: "endpoint",
    perimeter: { x: 5, y: 88 },
    linkedDepartments: ["growth"],
  },
];

/** The systems one space reaches. Used by the perimeter layer and the workspace. */
export function systemsForDepartment(departmentId: DepartmentId): SystemEntry[] {
  return SYSTEMS.filter((system) => system.linkedDepartments.includes(departmentId));
}
