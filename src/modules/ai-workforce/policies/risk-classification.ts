import { AiWorkforceError } from "../core/errors";
import { riskAtLeast, type ReadWriteMode, type RiskLevel } from "../core/types";

/**
 * Risk classification.
 *
 * LOW      read-only, no side effects               (e.g. client.search)
 * MEDIUM   reversible write, or an outbound action  (e.g. create client, send a message)
 * HIGH     money movement / irreversible business state (e.g. record an expense, write capital)
 * CRITICAL permanent deletion, secrets, structural or RBAC changes
 *
 * CRITICAL capabilities are never executed under AGENT autonomy — that rule
 * lives in `approvals/approval-policy.ts` and is enforced by the runtime.
 */

export const ACTION_RISK_BASELINE: Record<ReadWriteMode, RiskLevel> = {
  READ: "LOW",
  WRITE: "MEDIUM",
};

/** Actions whose effects leave the NEXUP boundary (outbound messaging etc.). */
export const EXTERNAL_SIDE_EFFECT_ACTIONS = [
  "send",
  "publish",
  "post",
  "notify",
  "email",
  "sms",
  "message",
  "webhook",
  "dispatch",
] as const;

/** Actions that cannot be undone through the normal recycle-bin path. */
export const DESTRUCTIVE_ACTIONS = [
  "purge",
  "destroy",
  "hard_delete",
  "delete_forever",
  "rotate_secret",
  "grant_role",
  "revoke_role",
  "migrate",
  "drop",
] as const;

export type RiskClassificationInput = {
  readWriteMode: ReadWriteMode;
  action: string;
  /** True when the capability moves money (see policies/money-safety.ts). */
  moneySensitive?: boolean;
  /** Set explicitly by a tool that reaches an external system. */
  externalSideEffect?: boolean;
  /** Set explicitly by a tool that destroys data permanently. */
  destructive?: boolean;
};

function actionMatches(action: string, list: readonly string[]): boolean {
  const normalised = action.toLowerCase();
  return list.some((candidate) => normalised === candidate || normalised.includes(candidate));
}

/**
 * Classifies a capability from its declared action semantics. Used to verify
 * that a tool's declared `riskLevel` is not understated.
 */
export function classifyRisk(input: RiskClassificationInput): RiskLevel {
  const destructive =
    input.destructive === true || actionMatches(input.action, DESTRUCTIVE_ACTIONS);
  if (destructive) return "CRITICAL";

  if (input.moneySensitive && input.readWriteMode === "WRITE") return "HIGH";

  const external =
    input.externalSideEffect === true || actionMatches(input.action, EXTERNAL_SIDE_EFFECT_ACTIONS);

  if (input.readWriteMode === "READ") return external ? "MEDIUM" : "LOW";
  return external ? "HIGH" : ACTION_RISK_BASELINE.WRITE;
}

/**
 * Registration guard: a tool may declare a risk level at least as severe as
 * its own semantics, never less.
 */
export function assertRiskDeclaration(input: {
  id: string;
  readWriteMode: ReadWriteMode;
  action: string;
  riskLevel: RiskLevel;
  moneySensitive?: boolean;
  externalSideEffect?: boolean;
  destructive?: boolean;
}): void {
  const minimum = classifyRisk(input);
  if (!riskAtLeast(input.riskLevel, minimum)) {
    throw new AiWorkforceError(
      "INVALID_TOOL_DEFINITION",
      `Tool "${input.id}" declares risk ${input.riskLevel} but its semantics require at least ${minimum}`,
      { declared: input.riskLevel, minimum, action: input.action },
    );
  }
}
