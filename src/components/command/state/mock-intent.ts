import type { LocaleValue } from "../i18n/command-locale";
import type { MessageKey } from "../i18n/command-locale";
import type { CommandVisualSnapshot } from "./demo-scenarios";

/**
 * Deterministic, local, boring-on-purpose intent mock.
 *
 * Phase UI-01 has no AI provider, so the command bar and the Executive dock
 * both need *something* plausible to render. This is that something: a small
 * keyword router, no randomness, no network. It is labelled as mocked wherever
 * it surfaces, so it can never be mistaken for real intelligence.
 *
 * IT RETURNS DICTIONARY KEYS, NOT SENTENCES. The router is language-blind: it
 * decides *what* was said (a read, a write or a plan; which department; whether
 * approval is required) and hands back `MessageKey`s. The caller renders them
 * with `t()`, which is the same closure the language switch drives — so the
 * console is bilingual for free and cannot drift from the rest of the product.
 */

/** The dictionary's translator, as the locale provider types it. */
type Translate = LocaleValue["t"];

export type MockInterpretation = {
  intent: MessageKey;
  target: MessageKey;
  authority: MessageKey;
};

const ROUTING_HINTS: Array<{ match: RegExp; target: MessageKey }> = [
  { match: /client|onboard|delivery|retention/i, target: "mock.targetClient" },
  { match: /invoice|payment|money|cash|margin|collect/i, target: "mock.targetFinance" },
  { match: /lead|sales|growth|revenue|campaign|pipeline/i, target: "mock.targetGrowth" },
  { match: /deploy|code|automation|agent|bug|build|system/i, target: "mock.targetProduct" },
  { match: /vendor|supplier|process|logistics|quality|schedule/i, target: "mock.targetOperations" },
];

export function interpret(input: string): MockInterpretation {
  const text = input.trim();
  const routed = ROUTING_HINTS.find((hint) => hint.match.test(text));
  const risky = /send|pay|delete|publish|transfer|refund|deploy/i.test(text);
  const reads = /report|show|summar|list|check|how many|status|why/i.test(text);

  return {
    intent: reads ? "mock.intentRead" : risky ? "mock.intentWrite" : "mock.intentPlan",
    target: routed?.target ?? "mock.targetExecutive",
    authority: risky ? "mock.authorityApproval" : "mock.authoritySafe",
  };
}

/**
 * A plausible Executive reply that stays honest: it always says out loud that
 * it cannot execute in this phase, and it reflects the state the reviewer has
 * actually put the organization into.
 *
 * Counts are phrased so the sentence holds for any figure in both languages —
 * a mock that reads "1 departments" would undercut the whole exercise.
 */
export function executiveReply(
  input: string,
  snapshot: CommandVisualSnapshot,
  t: Translate,
): string {
  const mock = interpret(input);
  const approvals = snapshot.approvals.length;
  const working = Object.values(snapshot.visual.departments).filter(
    (department) => department.status === "ACTIVE" || department.status === "THINKING",
  ).length;

  const lines = [
    t("execDock.replyLead", {
      target: t(mock.target),
      intent: t(mock.intent),
      authority: t(mock.authority),
    }),
  ];

  if (approvals > 0) {
    lines.push(t("execDock.replyQueue", { count: approvals }));
  } else if (working > 0) {
    lines.push(t("execDock.replyWorking", { count: working }));
  } else {
    lines.push(t("execDock.replyIdle"));
  }

  lines.push(t("execDock.replyNoProvider"));
  return lines.join(" ");
}

/** The Executive's opening line, which always reflects the live demo state. */
export function executiveGreeting(snapshot: CommandVisualSnapshot, t: Translate): string {
  const approvals = snapshot.approvals.length;
  if (approvals > 0) return t("execDock.greetingQueue", { count: approvals });

  const active = Object.entries(snapshot.visual.departments).filter(
    ([, node]) => node.status === "ACTIVE",
  );
  if (active.length > 0) return t("execDock.greetingActive", { count: active.length });

  return t("execDock.greetingQuiet");
}

/** The four starting directions the console offers, as dictionary keys. */
export const EXEC_INTENTS: MessageKey[] = [
  "execDock.intentWhatNeedsMe",
  "execDock.intentFinanceHold",
  "execDock.intentPushGrowth",
  "execDock.intentSummarize",
];
