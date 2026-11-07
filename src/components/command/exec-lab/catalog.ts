/**
 * NEXUP COMMAND — EXEC EXPERIENCE · CATALOG
 * ─────────────────────────────────────────
 * The fixed vocabularies the surface renders: EXEC's ten states, the task
 * lifecycle, the team EXEC routes to, and the selectable scopes.
 *
 * Every entry carries a LABEL KEY and a SYMBOL. Colour is a third, additive
 * signal — never the only one — so the surface stays readable for a reviewer who
 * cannot distinguish the tones.
 */

import type { ExecStatusCode, ExecTone, ScopeOption, TaskStatus, TeamId, TeamMember } from "./types";
import type { MessageKey } from "./i18n";

/* ═══════════════════════════════════════════════════════
   EXEC's states
   ═══════════════════════════════════════════════════════ */

export type StatusMeta = {
  labelKey: MessageKey;
  tone: ExecTone;
  /** A text symbol — the state must be readable without colour. */
  glyph: string;
  /** True when the UI must also state a reason. */
  needsReason: boolean;
};

export const EXEC_STATUS_META: Record<ExecStatusCode, StatusMeta> = {
  available: { labelKey: "status.available", tone: "blue", glyph: "◆", needsReason: false },
  planning: { labelKey: "status.planning", tone: "blue", glyph: "◇", needsReason: false },
  working: { labelKey: "status.working", tone: "blue", glyph: "▶", needsReason: false },
  waiting: { labelKey: "status.waiting", tone: "blue-low", glyph: "❙❙", needsReason: true },
  needs_approval: {
    labelKey: "status.needs_approval",
    tone: "amber",
    glyph: "!",
    needsReason: true,
  },
  blocked: { labelKey: "status.blocked", tone: "amber", glyph: "▲", needsReason: true },
  reviewing: { labelKey: "status.reviewing", tone: "blue", glyph: "◉", needsReason: false },
  completed: { labelKey: "status.completed", tone: "green", glyph: "✓", needsReason: false },
  failed: { labelKey: "status.failed", tone: "red", glyph: "✕", needsReason: true },
  offline: { labelKey: "status.offline", tone: "off", glyph: "○", needsReason: true },
};

/** Stable order for the legend. */
export const EXEC_STATUS_ORDER: ExecStatusCode[] = [
  "available",
  "planning",
  "working",
  "waiting",
  "needs_approval",
  "blocked",
  "reviewing",
  "completed",
  "failed",
  "offline",
];

/* ═══════════════════════════════════════════════════════
   Task lifecycle — deliberately a SEPARATE vocabulary
   ═══════════════════════════════════════════════════════ */

export const TASK_STATUS_META: Record<TaskStatus, { labelKey: MessageKey; tone: ExecTone }> = {
  planned: { labelKey: "task.planned", tone: "blue" },
  working: { labelKey: "task.working", tone: "blue" },
  waiting: { labelKey: "task.waiting", tone: "blue-low" },
  blocked: { labelKey: "task.blocked", tone: "amber" },
  review: { labelKey: "task.review", tone: "blue" },
  completed: { labelKey: "task.completed", tone: "green" },
  failed: { labelKey: "task.failed", tone: "red" },
  cancelled: { labelKey: "task.cancelled", tone: "off" },
};

/* ═══════════════════════════════════════════════════════
   The team
   ═══════════════════════════════════════════════════════ */

export const TEAM: TeamMember[] = [
  { id: "exec", codename: "EXEC", specialtyKey: "team.exec", mandateKey: "team.exec.mandate", accent: "blue" },
  { id: "systems", codename: "AZR", specialtyKey: "team.systems", mandateKey: "team.systems.mandate", accent: "blue" },
  { id: "creative", codename: "VIO", specialtyKey: "team.creative", mandateKey: "team.creative.mandate", accent: "violet" },
  { id: "growth", codename: "ORN", specialtyKey: "team.growth", mandateKey: "team.growth.mandate", accent: "orange" },
  { id: "operations", codename: "MNT", specialtyKey: "team.operations", mandateKey: "team.operations.mandate", accent: "mint" },
  { id: "engineering", codename: "CPO", specialtyKey: "team.engineering", mandateKey: "team.engineering.mandate", accent: "capso" },
];

export const TEAM_BY_ID: Record<TeamId, TeamMember> = TEAM.reduce(
  (acc, member) => {
    acc[member.id] = member;
    return acc;
  },
  {} as Record<TeamId, TeamMember>,
);

/* ═══════════════════════════════════════════════════════
   Scopes — client scopes are isolated, including in fixtures
   ═══════════════════════════════════════════════════════ */

export const SCOPE_OPTIONS: ScopeOption[] = [
  {
    id: "nexup:nexuq:brand-week",
    labelKey: "scope.project.brandWeek",
    scope: { companyId: "nexup", clientId: "nexuq", projectId: "brand-week" },
  },
  {
    id: "nexup:atlas:gulf-launch",
    labelKey: "scope.project.gulfLaunch",
    scope: { companyId: "nexup", clientId: "atlas", projectId: "gulf-launch" },
  },
  {
    id: "nexup:dune:retainer",
    labelKey: "scope.project.retainer",
    scope: { companyId: "nexup", clientId: "dune", projectId: "retainer" },
  },
];

export const DEFAULT_SCOPE = SCOPE_OPTIONS[0].scope;

/** The client label for a scope — a key, resolved at render time. */
export const CLIENT_LABEL_KEY: Record<string, MessageKey> = {
  nexuq: "scope.client.nexuq",
  atlas: "scope.client.atlas",
  dune: "scope.client.dune",
};

export function scopeKey(scope: { companyId: string; clientId: string; projectId: string }): string {
  return `${scope.companyId}:${scope.clientId}:${scope.projectId}`;
}

/** The project option that matches a scope, if the reviewer is inside one. */
export function scopeOptionFor(scope: { companyId: string; clientId: string; projectId: string }): ScopeOption | undefined {
  return SCOPE_OPTIONS.find((option) => scopeKey(option.scope) === scopeKey(scope));
}
