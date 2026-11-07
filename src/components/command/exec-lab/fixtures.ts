/**
 * NEXUP COMMAND — EXEC EXPERIENCE · FIXTURES
 * ─────────────────────────────────────────
 * Demo history, and the isolation rules that keep one client's context out of
 * another's — INCLUDING inside the fixtures themselves.
 *
 * The rule this file exists to hold: a fixture row carries a `scope`, and every
 * read is scoped. `historyFor()` can therefore never return a row belonging to a
 * different client, which is what makes client separation testable rather than
 * merely asserted in prose.
 */

import type { MessageKey } from "./i18n";
import type { Scope, TaskStatus } from "./types";
import { SCOPE_OPTIONS, scopeKey } from "./catalog";
import { SCENARIO_LIST } from "./scenarios";

/* ═══════════════════════════════════════════════════════
   Demo history — labelled, scoped, and outcome-bearing
   ═══════════════════════════════════════════════════════ */

export type HistoryEntry = {
  id: string;
  scope: Scope;
  labelKey: MessageKey;
  /** A demo clock label. Never presented as a real timestamp. */
  atLabel: string;
  outcome: TaskStatus;
  /** True when this row was produced by a scenario in this build. */
  fromScenario: boolean;
};

export const DEMO_HISTORY: HistoryEntry[] = [
  {
    id: "h-1041",
    scope: { companyId: "nexup", clientId: "nexuq", projectId: "brand-week" },
    labelKey: "hist.brand",
    atLabel: "T-3d",
    outcome: "completed",
    fromScenario: true,
  },
  {
    id: "h-1039",
    scope: { companyId: "nexup", clientId: "nexuq", projectId: "brand-week" },
    labelKey: "hist.brandVoice",
    atLabel: "T-6d",
    outcome: "cancelled",
    fromScenario: false,
  },
  {
    id: "h-1042",
    scope: { companyId: "nexup", clientId: "atlas", projectId: "gulf-launch" },
    labelKey: "hist.gulf",
    atLabel: "T-2d",
    outcome: "blocked",
    fromScenario: true,
  },
  {
    id: "h-1040",
    scope: { companyId: "nexup", clientId: "atlas", projectId: "gulf-launch" },
    labelKey: "hist.gulfOffer",
    atLabel: "T-5d",
    outcome: "completed",
    fromScenario: false,
  },
  {
    id: "h-1044",
    scope: { companyId: "nexup", clientId: "dune", projectId: "retainer" },
    labelKey: "hist.retainer",
    atLabel: "T-1d",
    outcome: "failed",
    fromScenario: true,
  },
  {
    id: "h-1038",
    scope: { companyId: "nexup", clientId: "dune", projectId: "retainer" },
    labelKey: "hist.retainerAssets",
    atLabel: "T-9d",
    outcome: "completed",
    fromScenario: false,
  },
];

/**
 * History for ONE scope, and only that scope. The comparison is on the full
 * scope key (company + client + project), so a row from another client can
 * never appear here — and a test asserts exactly that.
 */
export function historyFor(scope: Scope): HistoryEntry[] {
  const key = scopeKey(scope);
  return DEMO_HISTORY.filter((entry) => scopeKey(entry.scope) === key);
}

/* ═══════════════════════════════════════════════════════
   Isolation self-checks — used by the tests, not by the UI
   ═══════════════════════════════════════════════════════ */

export type IsolationViolation = string;

/**
 * Verifies the fixture rules that must hold for client separation:
 *   1. every history row belongs to a DECLARED scope option;
 *   2. every scenario runs inside a DECLARED scope option;
 *   3. no two DIFFERENT clients share a task code.
 */
export function findIsolationViolations(): IsolationViolation[] {
  const violations: IsolationViolation[] = [];
  const declared = new Set(SCOPE_OPTIONS.map((option) => scopeKey(option.scope)));

  for (const entry of DEMO_HISTORY) {
    if (!declared.has(scopeKey(entry.scope))) {
      violations.push(`history ${entry.id} uses an undeclared scope ${scopeKey(entry.scope)}`);
    }
  }

  for (const scenario of SCENARIO_LIST) {
    if (!declared.has(scopeKey(scenario.scope))) {
      violations.push(`scenario ${scenario.id} uses an undeclared scope ${scopeKey(scenario.scope)}`);
    }
  }

  const codeOwner = new Map<string, string>();
  for (const scenario of SCENARIO_LIST) {
    const client = scenario.scope.clientId;
    const holder = codeOwner.get(scenario.code);
    if (holder && holder !== client) {
      violations.push(`task code ${scenario.code} is shared by clients ${holder} and ${client}`);
    }
    codeOwner.set(scenario.code, client);
  }

  return violations;
}

/**
 * The client ids present in a history slice. A cross-client leak shows up as
 * more than one entry here.
 */
export function clientsIn(entries: HistoryEntry[]): string[] {
  return [...new Set(entries.map((entry) => entry.scope.clientId))].sort();
}
