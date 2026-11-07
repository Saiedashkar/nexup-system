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
 * SPATIAL LAYOUT (Pass 2)
 * Six department surfaces, THREE on each side of the Intelligence Core on
 * desktop, with the core centred between them. Each department carries its own
 * x/y *and* its own depth; depth is a real translateZ consumed by CSS
 * `perspective`, which is what keeps "nearer / further" perceptible instead of
 * merely decorative, and what stops a balanced 3·3 arrangement from reading as a
 * plain grid.
 *
 * THE APPROVED TAXONOMY (Pass 4). Six WORK-OWNING departments, each a product
 * grouping and never an organizational authority change: it moves no durable
 * workforce assignment, approval or execution.
 *
 *   operations · Management & Operations      الإدارة والتشغيل
 *   growth     · Marketing & Sales            التسويق والمبيعات
 *   client     · Clients & Projects           العملاء والمشاريع
 *   creative   · Creative & Production        الإبداع والإنتاج
 *   product    · Technology & Systems         التقنية والأنظمة
 *   finance    · Finance & Oversight          المالية والرقابة
 *
 * Five of those ids are the ids those spaces already had, so their routes are
 * untouched; `creative` is the one genuinely new surface.
 *
 * SHARED SERVICES are NOT a seventh department. `knowledge` — skills, memory
 * references, model information — is what every department reads from, so it is
 * modelled as a shared service (`SHARED_SERVICES`, `kind: "shared"`) instead of
 * a department with a P&L. Its id, route, workspace and modes are all kept: it
 * simply stops occupying one of the six department slots, which is also why the
 * overview does not grow a seventh node.
 *
 * MARKETING vs PRODUCTION. `growth` is demand for the group's OWN companies;
 * `creative` is campaign and content production FOR CLIENTS. They are different
 * work with different owners, so they are different departments rather than two
 * lines in one brief.
 *
 * DISPLAY NAMES are localized, so `name` here is the English source string used
 * by tests and non-React code; every surface renders the localized name from
 * `i18n/messages.ts` instead.
 */

export type DepartmentId =
  | "operations"
  | "growth"
  | "client"
  | "creative"
  | "product"
  | "finance"
  /* A shared service, not a department: see `SHARED_SERVICES`. */
  | "knowledge";

export type Worker = {
  id: string;
  name: string;
  role: string;
};

/**
 * Every action id the six spaces and the organization level can offer.
 *
 * Typed as a union on purpose (Pass 2): the deck renders its labels from
 * `deck.<id>.label` in the dictionary, and this union is what makes that lookup
 * a compile-checked key instead of an unchecked string.
 */
export type DeckActionId =
  | "build"
  | "review"
  | "call"
  | "workflow"
  | "lab"
  | "mission"
  | "run"
  | "tool"
  | "more"
  | "stack"
  | "warroom"
  | "systems"
  | "control";

/** One command-surface cell. Configuration, never duplicated markup. */
export type DeckAction = {
  id: DeckActionId;
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

/**
 * What a department and a shared service have in common.
 *
 * Everything a surface *says* lives here; where a surface *sits* does not, which
 * is exactly the difference between the two kinds: a department occupies a place
 * in the room, a shared service spans all of them.
 */
export type SurfaceBase = {
  id: DepartmentId;
  /** English source name. Surfaces render `dept.<id>.name` from the dictionary. */
  name: string;
  short: string;
  /** What this surface is accountable for — shown on focus. */
  brief: string;
  /** Short capability line, used when the surface has no live work. */
  capability: string;
  /** CSS custom property holding this surface's restrained identity accent. */
  accentVar: string;
  /** The space's own vocabulary ("Studio floor", "Delivery bay") — spatial, not card-like. */
  space: string;
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
  /* Mission counts are deliberately NOT configured here. `departmentMissions()`
     in `department-workspace.ts` derives each space's count from the mission list
     that space actually owns, so the node, the rail, the Active Missions panel and
     the top KPI cannot drift away from the workspace. */
  /** This surface's own adaptive deck. */
  deck: DeckAction[];
};

/** A work-owning department: it holds missions, and it has a place in the room. */
export type Department = SurfaceBase & {
  kind: "department";
  /** Pod-centre anchor, in percent of the stage (0-100). Not a ring. */
  x: number;
  y: number;
  /**
   * Depth in px, consumed as `translateZ` under the stage perspective.
   * Positive = nearer the viewer. Deliberately uneven across the six pods.
   */
  depth: number;
};

/**
 * A shared service: cross-cutting capability the departments read from.
 *
 * It carries no place in the room on purpose — `serves` says who reads from it
 * and `provides` says what it holds, and the overview draws it as one band that
 * spans the departments rather than as a seventh node competing with them.
 */
export type SharedService = SurfaceBase & {
  kind: "shared";
  /** Ids of the departments that read from this service. */
  serves: DepartmentId[];
  /**
   * What the service holds, as DISPLAY KEYS rather than English words: the band
   * renders `t(\`shared.provides.${key}\`)`, so a shared service cannot end up
   * showing English chips inside Arabic chrome.
   */
  provides: Array<"skills" | "memory" | "models">;
};

/** Any surface in the roster: one department, or one shared service. */
export type Surface = Department | SharedService;

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

const DECK_STUDIO: DeckAction[] = [
  { id: "mission", label: "New Brief", icon: "mission", hint: "Open client production work", intent: "Open a client brief inside this space." },
  { id: "review", label: "Review Output", icon: "review", hint: "Read what the studio produced", intent: "Review the work the studio produced." },
  { id: "call", label: "Call Studio", icon: "call", hint: "Pull the production team in", intent: "Pull the production team into the conversation." },
  { id: "run", label: "Publish Campaign", icon: "run", hint: "Release approved work to the client", intent: "Publish approved work to the client's channels." },
  { id: "lab", label: "Build Lab", icon: "lab", hint: "Build this space's own tools", intent: "Open the lab where this space builds its own tools." },
];

const DECK_KNOWLEDGE: DeckAction[] = [
  { id: "review", label: "Review Knowledge", icon: "review", hint: "Read what the organization knows", intent: "Review the knowledge the organization is holding." },
  { id: "stack", label: "Open Registry", icon: "stack", hint: "Skills, memory and model information", intent: "Open the skills, memory and model registry." },
  { id: "mission", label: "New Reference", icon: "mission", hint: "Register something worth keeping", intent: "Register a reference the organization should keep." },
  { id: "call", label: "Call Steward", icon: "call", hint: "Bring the knowledge steward in", intent: "Pull the knowledge steward into the conversation." },
  { id: "more", label: "More", icon: "more", hint: "More arrives with the Capabilities area", intent: "More actions surface with the Capabilities area." },
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
/** The internal rooms a focused space can host. Ids are typed for i18n lookup. */
export type WorkspaceModeId = "work" | "map" | "flow" | "assets";

export type WorkspaceMode = {
  id: WorkspaceModeId;
  label: string;
  icon: DeckIconKey;
  hint: string;
};

export const WORKSPACE_MODES: WorkspaceMode[] = [
  { id: "work", label: "Work", icon: "run", hint: "Current work in this space" },
  { id: "map", label: "Map", icon: "map", hint: "Who and what is here — later phase" },
  { id: "flow", label: "Flow", icon: "workflow", hint: "How work moves through it — later phase" },
  { id: "assets", label: "Assets", icon: "stack", hint: "What this space runs on — later phase" },
];

export const DEPARTMENTS: Department[] = [
  {
    id: "operations",
    kind: "department",
    name: "Management & Operations",
    short: "OPS",
    brief:
      "Management and the machine that keeps work moving: process, people, vendors, quality and the runbooks everything else depends on.",
    capability: "People · Process · Quality",
    accentVar: "--nc-operations",
    space: "Operations floor",
    /* Pass 2 arrangement: three working spaces in each flank column, the core
       centred between them. Depth still varies per space, so the two columns
       read as a room with a near side and a far side rather than a table. */
    x: 82,
    y: 22,
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
    deck: DECK_PROCESS,
  },
  {
    id: "client",
    kind: "department",
    name: "Clients & Projects",
    short: "CLIENTS",
    brief: "The client relationship and the projects delivered through it: onboarding, project delivery and retention.",
    capability: "Clients · Projects · Retention",
    accentVar: "--nc-client",
    space: "Delivery bay",
    x: 82,
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
    deck: DECK_DELIVERY,
  },
  {
    id: "product",
    kind: "department",
    name: "Technology & Systems",
    short: "TECH",
    brief: "The platforms the organization runs on: product surfaces, agents, automation and the systems behind them.",
    capability: "Build · AI · Systems",
    accentVar: "--nc-product",
    space: "Build floor",
    x: 82,
    y: 78,
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
    deck: DECK_BUILD,
  },
  {
    id: "growth",
    kind: "department",
    name: "Marketing & Sales",
    short: "MARKETING",
    /* Demand for OUR OWN companies — deliberately not client campaign
       production, which is `creative`. */
    brief: "Demand, market position and revenue for the group's own companies: brand, pipeline and sales.",
    capability: "Brand · Market · Sales",
    accentVar: "--nc-growth",
    space: "Market floor",
    x: 18,
    y: 22,
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
    deck: DECK_REVENUE,
  },
  {
    id: "finance",
    kind: "department",
    name: "Finance & Oversight",
    short: "FINANCE",
    brief: "Money in, money out, and the oversight that keeps both honest: controls, limits and audit.",
    capability: "Money · Controls · Audit",
    accentVar: "--nc-finance",
    space: "Control room",
    x: 18,
    y: 78,
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
    deck: DECK_MONEY,
  },
  {
    id: "creative",
    kind: "department",
    name: "Creative & Production",
    short: "CREATIVE",
    /* The half of demand that is NOT our own marketing: work produced for a
       client, under a brief, with an output to review. */
    brief:
      "Campaigns and content produced for clients: the brief, the concept, the production and the release.",
    capability: "Concept · Production · Publish",
    accentVar: "--nc-creative",
    space: "Studio floor",
    /* The client flank's mirror: what a client feels on one side is what the
       studio makes on the other, and neither is nearer the core than the
       Intelligence that routes between them. */
    x: 18,
    y: 50,
    depth: 70,
    crew: 6,
    workers: [
      { id: "creative.concept", name: "Concept & Art Direction", role: "Briefs & treatment" },
      { id: "creative.production", name: "Content Production", role: "Copy · design · edit" },
      { id: "creative.publish", name: "Media & Scheduling", role: "Placement & cadence" },
    ],
    presence: ["human-product-lead", "ai-builder"],
    director: "Creative Director",
    insight: "3 client campaigns in production",
    bottleneck: "Concept review rounds",
    deck: DECK_STUDIO,
  },
];

/**
 * SHARED SERVICES — what every department reads from.
 *
 * These are NOT departments: they own no missions and take no place in the room,
 * and that is the point. Knowledge, memory, skills and model information are
 * cross-cutting capability. Giving one of them a department node would either
 * have made it a seventh surface competing with the six or implied it had its own
 * P&L, and it has neither.
 *
 * `serves` lists every department, because that is literally true: each one reads
 * the same skills, the same decisions and the same registry. The id, route,
 * workspace and eight modes all already existed for `knowledge`, so nothing is
 * lost by moving it here — it is the same surface, correctly labelled.
 */
export const SHARED_SERVICES: SharedService[] = [
  {
    id: "knowledge",
    kind: "shared",
    name: "Knowledge & Models",
    short: "SHARED",
    brief:
      "Shared services every department reads from: skills, memory references and model information, kept in one place instead of rediscovered in six.",
    capability: "Skills · Memory · Models",
    accentVar: "--nc-violet",
    space: "Shared services",
    crew: 5,
    workers: [
      { id: "knowledge.library", name: "Knowledge Library", role: "Skills & references" },
      { id: "knowledge.memory", name: "Memory Curation", role: "Context & decisions" },
      { id: "knowledge.registry", name: "Model Registry", role: "Runtimes & quota" },
    ],
    presence: ["human-ops-lead", "ai-analyst"],
    director: "Knowledge steward",
    insight: "Model registry partly constrained",
    bottleneck: "Memory references not populated",
    deck: DECK_KNOWLEDGE,
    serves: ["operations", "growth", "client", "creative", "product", "finance"],
    provides: ["skills", "memory", "models"],
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
  /* Focus card shown beside the greeting. Its value is NOT configured here:
     `room-identity.tsx` renders it from `totalMissions()`, the same source the
     top KPI reads, so the card cannot quote a total the rest of the page rejects. */
  focus: { label: "Today's Focus" },
} as const;

/**
 * The central intelligence / router. Everything flows through it.
 * In UI-02.1 it is rendered by `ExecCore`, which is a presence — layered core,
 * rings, a small lime energy centre and a state line — not a glowing circle.
 */
export const EXECUTIVE = {
  id: "executive",
  label: "EXEC",
  longLabel: "Right-Hand Executive",
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
  /** Capability that spans the departments rather than sitting beside them. */
  sharedServices: SHARED_SERVICES,
  overviewDeck: OVERVIEW_DECK,
} as const;

export type OrganizationConfig = typeof ORGANIZATION;

/** The six work-owning departments, in configuration order. */
export const DEPARTMENT_IDS: DepartmentId[] = DEPARTMENTS.map((d) => d.id);

/** The shared services — spanning capability, never a seventh department. */
export const SHARED_SERVICE_IDS: DepartmentId[] = SHARED_SERVICES.map((service) => service.id);

/**
 * The whole roster by id: the six departments AND the shared services.
 *
 * One map rather than two, because almost every reader holds an id and wants the
 * words and the accent that go with it — which is the same answer either way. The
 * FEW readers that need a place in the room ask for the kind first (see
 * `nodeAnchor`), so a shared service can never be drawn at a department's
 * coordinates by accident.
 */
export const SURFACE_BY_ID: Record<string, Surface> = [...DEPARTMENTS, ...SHARED_SERVICES].reduce(
  (acc, surface) => {
    acc[surface.id] = surface;
    return acc;
  },
  {} as Record<string, Surface>,
);

/** Kept under its original name for existing call sites — the same roster. */
export const DEPARTMENT_BY_ID = SURFACE_BY_ID;

/**
 * Resolve any node id to its canvas anchor. The pod layer and the SVG
 * connection layer both read from this, so a connection can never drift away
 * from the pod it belongs to — including while the camera is moving, because
 * both live inside the same transformed canvas.
 */
export function nodeAnchor(id: string): { x: number; y: number } | null {
  if (id === EXECUTIVE.id) return { x: EXECUTIVE.x, y: EXECUTIVE.y };
  const surface = SURFACE_BY_ID[id];
  /* A shared service is deliberately NOT anchored: it spans the room instead of
     occupying a place in it, and the caller draws it as a band. */
  if (!surface || surface.kind !== "department") return null;
  return { x: surface.x, y: surface.y };
}

/** Depth for any node id, in px. Used by the pod layer and the wiring layer. */
export function nodeDepth(id: string): number {
  if (id === EXECUTIVE.id) return EXECUTIVE.depth;
  const surface = SURFACE_BY_ID[id];
  return surface && surface.kind === "department" ? surface.depth : 0;
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
    linkedDepartments: ["finance", "client", "creative"],
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
    /* Distribution serves both halves of demand: our own channels AND the work
       the studio releases for clients. */
    linkedDepartments: ["growth", "creative"],
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
  /* The NEXUP business OS holds clients and projects, so the studio writes into
     it too — a client campaign is delivered through the same book of record. */
  return SYSTEMS.filter((system) => system.linkedDepartments.includes(departmentId));
}
