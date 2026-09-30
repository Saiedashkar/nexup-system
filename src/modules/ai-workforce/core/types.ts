/**
 * NEXUP AI WORKFORCE — Core primitives.
 *
 * Additive module. Nothing here imports from the legacy application except
 * pure types, and nothing here writes to the database.
 */

/* ═══════════════════════════════════════════════════════
   JSON
   ═══════════════════════════════════════════════════════ */

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

/* ═══════════════════════════════════════════════════════
   Identifiers
   ═══════════════════════════════════════════════════════ */

export type ToolId = string;
export type JobId = string;
export type RunId = string;
export type ApprovalId = string;
export type AuditEventId = string;
export type CorrelationId = string;

/* ═══════════════════════════════════════════════════════
   Risk
   ═══════════════════════════════════════════════════════ */

export const RISK_LEVELS = ["LOW", "MEDIUM", "HIGH", "CRITICAL"] as const;
export type RiskLevel = (typeof RISK_LEVELS)[number];

export const RISK_RANK: Record<RiskLevel, number> = {
  LOW: 0,
  MEDIUM: 1,
  HIGH: 2,
  CRITICAL: 3,
};

export function riskRank(level: RiskLevel): number {
  return RISK_RANK[level];
}

/** True when `level` is at least as dangerous as `min`. */
export function riskAtLeast(level: RiskLevel, min: RiskLevel): boolean {
  return riskRank(level) >= riskRank(min);
}

export function maxRisk(a: RiskLevel, b: RiskLevel): RiskLevel {
  return riskRank(a) >= riskRank(b) ? a : b;
}

/* ═══════════════════════════════════════════════════════
   Read / write
   ═══════════════════════════════════════════════════════ */

export type ReadWriteMode = "READ" | "WRITE";

/* ═══════════════════════════════════════════════════════
   Domains
   ═══════════════════════════════════════════════════════ */

export const TOOL_DOMAINS = ["crm", "projects", "finance", "capital", "office", "system"] as const;
export type ToolDomain = (typeof TOOL_DOMAINS)[number];

/* ═══════════════════════════════════════════════════════
   Time + ids (injectable so runs are deterministic in tests)
   ═══════════════════════════════════════════════════════ */

export type Clock = () => Date;

export interface IdFactory {
  /** Returns a fresh identifier for the given kind, e.g. `run`, `job`. */
  next(kind: string): string;
}

/* ═══════════════════════════════════════════════════════
   Autonomy
   ═══════════════════════════════════════════════════════ */

/**
 * WHO is driving the execution.
 *
 * HUMAN  — a signed-in person explicitly triggered it (UI / manual job).
 * AGENT  — an agent or automatic trigger drove it with no person in the loop.
 *
 * CRITICAL risk never runs under AGENT autonomy.
 */
export const AUTONOMY_LEVELS = ["HUMAN", "AGENT"] as const;
export type AutonomyLevel = (typeof AUTONOMY_LEVELS)[number];

/* ═══════════════════════════════════════════════════════
   Trigger + source
   ═══════════════════════════════════════════════════════ */

/**
 * How a job came to exist. Phase 1A only ever *produces* MANUAL / SYSTEM,
 * but every trigger is part of the contract so the job engine never needs
 * a redesign once schedulers, events and webhooks arrive.
 */
export const TRIGGER_TYPES = ["MANUAL", "AGENT", "EVENT", "SCHEDULE", "WEBHOOK", "SYSTEM"] as const;
export type TriggerType = (typeof TRIGGER_TYPES)[number];

/** Which business a workforce capability belongs to. */
export const BUSINESS_SLUGS = ["nexup", "rebound", "abomazen"] as const;
export type BusinessSlug = (typeof BUSINESS_SLUGS)[number];

export type BusinessScope = {
  id: string;
  slug: string;
};

export function isBusinessSlug(value: string): value is BusinessSlug {
  return (BUSINESS_SLUGS as readonly string[]).includes(value);
}
