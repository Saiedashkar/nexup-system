/**
 * NEXUP COMMAND — ORGANIZATION MODEL (mock, Phase UI-01)
 * ───────────────────────────────────────────────────────
 * Pure data. The Living Organization renders whatever this file describes, so
 * adding a company, a department or a worker stays a data change — never a
 * component change. Positions are canvas percentages, not pixels, so the
 * composition holds at any width.
 *
 * Composition rule (matches the visual reference): the Executive sits at the
 * centre as the router, and the five departments ring it. Anchors are CARD
 * centres; each card's lit platform is derived from the card itself.
 */

export type DepartmentId = "growth" | "client" | "operations" | "product" | "finance";

export type Worker = {
  id: string;
  name: string;
  role: string;
};

export type Department = {
  id: DepartmentId;
  name: string;
  short: string;
  /** What this department is accountable for — shown on focus. */
  brief: string;
  /** Short capability line shown on the card, reference-style. */
  capability: string;
  /** CSS custom property holding this department's restrained identity accent. */
  accentVar: string;
  /** Card-centre anchor, in percent of the stage (0-100). */
  x: number;
  y: number;
  /** Headline crew size — drives the "+N" overflow on the avatar cluster. */
  crew: number;
  workers: Worker[];
};

/**
 * The Founder is deliberately NOT a node in the graph. Authority is expressed
 * as the greeting block instead, which keeps the ring clean and puts the human
 * where the human actually sits: above the whole system, not inside it.
 */
export const FOUNDER = {
  name: "Saeed",
  role: "Founder / Human Authority",
  initials: "SA",
  /** Focus card shown beside the greeting. */
  focus: { label: "Today's Focus", value: "3 active missions" },
} as const;

/** The central intelligence / router. Everything flows through it. */
export const EXECUTIVE = {
  id: "executive",
  label: "Right-Hand Executive",
  short: "EXEC",
  kicker: "Central intelligence · router",
  /** Orb centre, in percent of the stage. */
  x: 50,
  y: 45,
} as const;

export const DEPARTMENTS: Department[] = [
  {
    id: "operations",
    name: "Operations",
    short: "OPS",
    brief: "The machine that keeps work moving: process, vendors, quality.",
    capability: "People · Process · Support",
    accentVar: "--nc-operations",
    x: 50,
    y: 13,
    crew: 8,
    workers: [
      { id: "operations.process", name: "Process Control", role: "Runbooks & SLAs" },
      { id: "operations.vendors", name: "Vendors & Logistics", role: "Suppliers & supply" },
      { id: "operations.quality", name: "Quality & Follow-up", role: "Checks & escalations" },
    ],
  },
  {
    id: "client",
    name: "Client & Delivery",
    short: "CLIENT",
    brief: "Everything a client feels: onboarding, delivery and retention.",
    capability: "Clients · Projects · QA",
    accentVar: "--nc-client",
    x: 24,
    y: 35,
    crew: 6,
    workers: [
      { id: "client.onboarding", name: "Onboarding", role: "Kickoff & setup" },
      { id: "client.delivery", name: "Service Delivery", role: "Execution on promise" },
      { id: "client.success", name: "Client Success", role: "Retention & growth" },
    ],
  },
  {
    id: "product",
    name: "Product & Tech",
    short: "PRODUCT",
    brief: "Building the systems the rest of the organization runs on.",
    capability: "Build · AI · Automation",
    accentVar: "--nc-product",
    x: 76,
    y: 35,
    crew: 7,
    workers: [
      { id: "product.discovery", name: "Product Discovery", role: "Problems & priorities" },
      { id: "product.agents", name: "Agent Engineer", role: "Workforce design" },
      { id: "product.automation", name: "Automation", role: "Workflows & integrations" },
      { id: "product.fullstack", name: "Full-stack", role: "Surfaces & APIs" },
    ],
  },
  {
    id: "growth",
    name: "Growth & Revenue",
    short: "GROWTH",
    brief: "Demand, pipeline and revenue generation across every business.",
    capability: "Leads · Sales · Market",
    accentVar: "--nc-growth",
    x: 18,
    y: 65,
    crew: 8,
    workers: [
      { id: "growth.market", name: "Market Intelligence", role: "Signal & competition" },
      { id: "growth.leads", name: "Lead Acquisition", role: "Inbound & outbound" },
      { id: "growth.sales", name: "Sales / CRM", role: "Pipeline & conversion" },
    ],
  },
  {
    id: "finance",
    name: "Finance & Control",
    short: "FINANCE",
    brief: "Money in, money out, and whether any of it is working.",
    capability: "Money · Margin · Audit",
    accentVar: "--nc-finance",
    x: 82,
    y: 65,
    crew: 4,
    workers: [
      { id: "finance.books", name: "Bookkeeping", role: "Ledgers & reconciliation" },
      { id: "finance.collections", name: "Collections", role: "Receivables & ageing" },
      { id: "finance.margin", name: "Margin / Audit", role: "Cost & performance" },
    ],
  },
];

export const DEPARTMENT_IDS: DepartmentId[] = DEPARTMENTS.map((d) => d.id);

export const DEPARTMENT_BY_ID: Record<string, Department> = DEPARTMENTS.reduce(
  (acc, department) => {
    acc[department.id] = department;
    return acc;
  },
  {} as Record<string, Department>,
);

/**
 * Resolve any node id to its canvas anchor. The HTML node layer and the SVG
 * connection layer both read from this, so a connection can never drift away
 * from the node it belongs to — including during contextual zoom, because both
 * live inside the same transformed canvas.
 */
export function nodeAnchor(id: string): { x: number; y: number } | null {
  if (id === EXECUTIVE.id) return { x: EXECUTIVE.x, y: EXECUTIVE.y };
  const department = DEPARTMENT_BY_ID[id];
  return department ? { x: department.x, y: department.y } : null;
}

/** Look up a worker's display data from a `departmentId.workerId` key. */
export function findWorker(departmentId: string, workerId: string): Worker | undefined {
  return DEPARTMENT_BY_ID[departmentId]?.workers.find((worker) => worker.id === workerId);
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
  /** Status word shown on the tile. Purely descriptive in this phase. */
  status: string;
  statusKind: "online" | "running" | "connected" | "development";
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
  },
];
