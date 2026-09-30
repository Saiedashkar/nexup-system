import type { CommandVisualSnapshot } from "./demo-scenarios";

/**
 * Deterministic, local, boring-on-purpose intent mock.
 *
 * Phase UI-01 has no AI provider, so the command bar and the Executive dock
 * both need *something* plausible to render. This is that something: a small
 * keyword router, no randomness, no network. It is labelled as mocked wherever
 * it surfaces, so it can never be mistaken for real intelligence.
 */

export type MockInterpretation = {
  intent: string;
  target: string;
  authority: string;
};

const ROUTING_HINTS: Array<{ match: RegExp; target: string }> = [
  { match: /client|onboard|delivery|retention/i, target: "Client & Delivery" },
  { match: /invoice|payment|money|cash|margin|collect/i, target: "Finance & Control" },
  { match: /lead|sales|growth|revenue|campaign|pipeline/i, target: "Growth & Revenue" },
  { match: /deploy|code|automation|agent|bug|build|system/i, target: "Product & Tech" },
  { match: /vendor|supplier|process|logistics|quality|schedule/i, target: "Operations" },
];

export function interpret(input: string): MockInterpretation {
  const text = input.trim();
  const routed = ROUTING_HINTS.find((hint) => hint.match.test(text));
  const risky = /send|pay|delete|publish|transfer|refund|deploy/i.test(text);
  const reads = /report|show|summar|list|check|how many|status|why/i.test(text);

  return {
    intent: reads ? "read · summarize" : risky ? "write · propose action" : "plan · decompose",
    target: routed?.target ?? "Executive will route",
    authority: risky ? "requires your approval" : "safe to run autonomously",
  };
}

/**
 * A plausible Executive reply that stays honest: it always says out loud that
 * it cannot execute in this phase, and it reflects the state the reviewer has
 * actually put the organization into.
 */
export function executiveReply(input: string, snapshot: CommandVisualSnapshot): string {
  const mock = interpret(input);
  const approvals = snapshot.approvals.length;
  const working = Object.values(snapshot.visual.departments).filter(
    (department) => department.status === "ACTIVE" || department.status === "THINKING",
  ).length;

  const lines = [
    `I'd route that to ${mock.target} as a ${mock.intent} — ${mock.authority}.`,
  ];

  if (approvals > 0) {
    lines.push(
      `Before that: ${approvals} decision ${approvals === 1 ? "is" : "are"} already holding on you. I have not started this one behind your back.`,
    );
  } else if (working > 0) {
    lines.push(`${working} department${working === 1 ? " is" : "s are"} working right now — this would queue behind them.`);
  } else {
    lines.push("Nothing else is running, so this would be first in line.");
  }

  lines.push("I can't execute anything yet — no AI provider or job runner is wired to this surface.");
  return lines.join(" ");
}

/** The Executive's opening line, which always reflects the live demo state. */
export function executiveGreeting(snapshot: CommandVisualSnapshot): string {
  const approvals = snapshot.approvals.length;
  if (approvals > 0) {
    return "One decision is waiting on you. I've paused the work that depends on it — say the word and I'll walk you through it.";
  }
  const active = Object.entries(snapshot.visual.departments).filter(([, node]) => node.status === "ACTIVE");
  if (active.length > 0) {
    return `I'm supervising ${active.length} active department${active.length === 1 ? "" : "s"}. Nothing needs you right now — what do you want to move?`;
  }
  return "The organization is quiet. Tell me what you want to happen and I'll shape it into work.";
}

export const EXEC_INTENTS = [
  "What needs me right now?",
  "Why is Finance holding a payment?",
  "Push more into Growth this week",
  "Summarize yesterday across all businesses",
];
