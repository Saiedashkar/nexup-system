/**
 * NEXUP COMMAND — DIRECTORY MAPPING (pure)
 * ────────────────────────────────────────
 * One place that turns a wire row into what a surface may show, and one rule it
 * enforces everywhere: NOTHING IS INVENTED.
 *
 * The demo `Client` carried an industry, a "client since", an owner, a health
 * score, open items and mission ids. The database carries none of those, so the
 * mapped views have no such fields at all — a surface cannot render an owner
 * nobody stored, because there is no property to render. What IS stored (phone,
 * tier, dates, prices, designer, services, statuses) is carried through as-is.
 *
 * Pure functions, no React and no I/O, so `tests/command-directory-binding.test.ts`
 * can hold the mapping to that rule directly.
 */

import type {
  ClientDto,
  ClientProjectDto,
  PaymentStatus,
  ProjectDto,
  Tier,
  WorkStatus,
} from "./types";

/* ── Normalisation ──────────────────────────────────────────────────────── */

/** Decimal arrives as a string; anything unparseable becomes 0, never NaN. */
export function amount(value: unknown): number {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : 0;
}

const TIERS: readonly Tier[] = ["VIP", "LOYAL", "NORMAL", "DELINQUENT"];
const WORK: readonly WorkStatus[] = ["WAITING", "IN_PROGRESS", "COMPLETED", "PAUSED"];
const PAYMENT: readonly PaymentStatus[] = ["FULL", "PARTIAL", "UNPAID"];

/** An unknown tier is `null` — the surface prints a dash instead of guessing. */
export function tierOf(value: unknown): Tier | null {
  return typeof value === "string" && (TIERS as readonly string[]).includes(value)
    ? (value as Tier)
    : null;
}

export function workStatusOf(value: unknown): WorkStatus | null {
  return typeof value === "string" && (WORK as readonly string[]).includes(value)
    ? (value as WorkStatus)
    : null;
}

export function paymentStatusOf(value: unknown): PaymentStatus | null {
  return typeof value === "string" && (PAYMENT as readonly string[]).includes(value)
    ? (value as PaymentStatus)
    : null;
}

/** Collected share of the agreed price, 0-100. Zero total has no ratio. */
export function paidRatio(paid: number, total: number): number {
  if (total <= 0) return 0;
  return Math.max(0, Math.min(100, Math.round((paid / total) * 100)));
}

/* ── Views ──────────────────────────────────────────────────────────────── */

export type ProjectRefView = {
  id: string;
  name: string;
  work: WorkStatus | null;
  payment: PaymentStatus | null;
  total: number;
  paid: number;
  remaining: number;
  date: string;
};

export type ClientView = {
  id: string;
  name: string;
  phone: string;
  tier: Tier | null;
  projectCount: number;
  total: number;
  paid: number;
  remaining: number;
  paidRatio: number;
  isRepeat: boolean;
  projects: ProjectRefView[];
};

export type ProjectView = {
  id: string;
  name: string;
  clientId: string;
  clientName: string | null;
  clientPhone: string | null;
  work: WorkStatus | null;
  payment: PaymentStatus | null;
  total: number;
  paid: number;
  remaining: number;
  paidRatio: number;
  date: string;
  designer: string | null;
  services: string[];
  notes: string | null;
  clientProjectCount: number | null;
};

function mapClientProject(dto: ClientProjectDto): ProjectRefView {
  const total = amount(dto.totalPrice);
  const paid = amount(dto.deposit);
  return {
    id: dto.id,
    name: dto.projectName,
    work: workStatusOf(dto.workStatus),
    payment: paymentStatusOf(dto.paymentStatus),
    total,
    paid,
    remaining: amount(dto.totalPrice) - paid,
    date: dto.date,
  };
}

/**
 * A client row. The route's computed `projectCount/totalPaid/totalRemaining` are
 * preferred when present; otherwise they are summed from the embedded projects,
 * which is the same arithmetic the route performs. Neither path invents a figure.
 */
export function mapClient(dto: ClientDto): ClientView {
  const projects = (dto.projectRecords ?? []).map(mapClientProject);
  const total = projects.reduce((sum, p) => sum + p.total, 0);
  const paidFromProjects = projects.reduce((sum, p) => sum + p.paid, 0);
  const paid = typeof dto.totalPaid === "number" ? dto.totalPaid : paidFromProjects;
  const remaining =
    typeof dto.totalRemaining === "number"
      ? dto.totalRemaining
      : projects.reduce((sum, p) => sum + p.remaining, 0);
  const projectCount = typeof dto.projectCount === "number" ? dto.projectCount : projects.length;

  return {
    id: dto.id,
    name: dto.name,
    phone: dto.phone,
    tier: tierOf(dto.tier),
    projectCount,
    total,
    paid,
    remaining,
    paidRatio: paidRatio(paid, total),
    isRepeat: typeof dto.isRepeatClient === "boolean" ? dto.isRepeatClient : projectCount > 1,
    projects,
  };
}

/**
 * The services a record references — the typed catalogue entries first, and the
 * free-text service only when the record has no catalogue entries at all. Both
 * are stored fields; nothing is composed for display.
 */
function servicesOf(dto: ProjectDto): string[] {
  const named = (dto.services ?? [])
    .map((service) => service.name?.trim())
    .filter((name): name is string => Boolean(name));
  if (named.length) return named;
  const free = dto.customServiceText?.trim();
  return free ? [free] : [];
}

/** A project row. Designer and services are the stored ones, or absent. */
export function mapProject(dto: ProjectDto): ProjectView {
  const total = amount(dto.totalPrice);
  const paid = amount(dto.deposit);
  const designer = dto.designer?.name ?? dto.designerName ?? null;

  return {
    id: dto.id,
    name: dto.projectName,
    clientId: dto.clientId,
    clientName: dto.client?.name ?? null,
    clientPhone: dto.client?.phone ?? null,
    work: workStatusOf(dto.workStatus),
    payment: paymentStatusOf(dto.paymentStatus),
    total,
    paid,
    remaining: amount(dto.remaining),
    paidRatio: paidRatio(paid, total),
    date: dto.date,
    designer: designer && designer.trim() ? designer.trim() : null,
    services: servicesOf(dto),
    notes: dto.notes && dto.notes.trim() ? dto.notes.trim() : null,
    clientProjectCount: typeof dto.client?.projectCount === "number" ? dto.client.projectCount : null,
  };
}

/* ── Aggregates the surfaces read ───────────────────────────────────────── */

export function directoryTotals(clients: ClientView[]) {
  const total = clients.reduce((sum, c) => sum + c.total, 0);
  const paid = clients.reduce((sum, c) => sum + c.paid, 0);
  return {
    clients: clients.length,
    projects: clients.reduce((sum, c) => sum + c.projectCount, 0),
    total,
    paid,
    outstanding: clients.reduce((sum, c) => sum + Math.max(0, c.remaining), 0),
    byTier: (tier: Tier) => clients.filter((c) => c.tier === tier).length,
  };
}

export function projectTotals(projects: ProjectView[]) {
  return {
    projects: projects.length,
    byWork: (status: WorkStatus) => projects.filter((p) => p.work === status).length,
    outstanding: projects.reduce((sum, p) => sum + Math.max(0, p.remaining), 0),
    collected: projects.reduce((sum, p) => sum + p.paid, 0),
  };
}
