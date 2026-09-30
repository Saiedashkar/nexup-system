import { riskAtLeast, type RiskLevel } from "../core/types";
import type { ExecutionContext } from "../core/execution-context";
import type { ToolDefinition } from "../registry/tool-definition";
import type { ApprovalStatus } from "./approval-repository";

/**
 * Approval policy.
 *
 * Answers one question: "may this capability run right now?"
 *
 * Deterministic rules, in order:
 *   1. CRITICAL never runs under AGENT autonomy — ever.
 *   2. CRITICAL under HUMAN autonomy needs an APPROVED approval record.
 *   3. Otherwise an approval is required when the tool forces it
 *      (`requiresApproval`) or when the policy threshold is met.
 *   4. When an approval is required and an APPROVED record exists, it passes.
 *   5. When it is required and the execution is MANUAL + HUMAN, the person
 *      pressing the button IS the approval (presence), except for rule 2.
 *   6. Anything else is refused — the job waits for a human.
 */

export type ApprovalPolicyMode = "NEVER" | "ALWAYS" | "RISK_AT_LEAST";

export type ApprovalPolicy = {
  mode: ApprovalPolicyMode;
  /** Threshold used when mode is RISK_AT_LEAST. */
  minRiskLevel: RiskLevel;
  /** Treat a MANUAL + HUMAN execution as its own approval. */
  humanPresenceCountsAsApproval: boolean;
};

export const DEFAULT_APPROVAL_POLICY: ApprovalPolicy = {
  mode: "RISK_AT_LEAST",
  // HIGH = money movement. Reads and reversible writes stay frictionless.
  minRiskLevel: "HIGH",
  humanPresenceCountsAsApproval: true,
};

/** Every capability must be approved by a human, no exceptions. */
export const STRICT_APPROVAL_POLICY: ApprovalPolicy = {
  mode: "ALWAYS",
  minRiskLevel: "LOW",
  humanPresenceCountsAsApproval: false,
};

export type ApprovalDecisionReason =
  | "NOT_REQUIRED"
  | "HUMAN_PRESENT"
  | "APPROVAL_APPROVED"
  | "APPROVAL_MISSING"
  | "APPROVAL_REJECTED"
  | "CRITICAL_FORBIDDEN_AUTONOMOUS"
  | "CRITICAL_REQUIRES_EXPLICIT_APPROVAL";

export type ApprovalEvaluation = {
  toolId: string;
  riskLevel: RiskLevel;
  required: boolean;
  satisfied: boolean;
  reason: ApprovalDecisionReason;
  approvalId?: string;
};

export function isApprovalRequired(tool: ToolDefinition, policy: ApprovalPolicy): boolean {
  if (tool.requiresApproval) return true;
  switch (policy.mode) {
    case "NEVER":
      return false;
    case "ALWAYS":
      return true;
    case "RISK_AT_LEAST":
      return riskAtLeast(tool.riskLevel, policy.minRiskLevel);
    default:
      return true;
  }
}

export type ApprovalRecordView = {
  id: string;
  status: ApprovalStatus;
  toolId: string;
};

export function evaluateApproval(input: {
  tool: ToolDefinition;
  policy: ApprovalPolicy;
  context: ExecutionContext;
  approval?: ApprovalRecordView | null;
}): ApprovalEvaluation {
  const { tool, policy, context, approval } = input;
  const base = { toolId: tool.id, riskLevel: tool.riskLevel, approvalId: approval?.id };

  // Rule 1 + 2 — CRITICAL risk.
  if (tool.riskLevel === "CRITICAL") {
    if (context.autonomy === "AGENT") {
      return { ...base, required: true, satisfied: false, reason: "CRITICAL_FORBIDDEN_AUTONOMOUS" };
    }
    if (approval?.status === "APPROVED") {
      return { ...base, required: true, satisfied: true, reason: "APPROVAL_APPROVED" };
    }
    if (approval?.status === "REJECTED") {
      return { ...base, required: true, satisfied: false, reason: "APPROVAL_REJECTED" };
    }
    return { ...base, required: true, satisfied: false, reason: "CRITICAL_REQUIRES_EXPLICIT_APPROVAL" };
  }

  const required = isApprovalRequired(tool, policy);

  // Rule 4 — an explicit decision wins.
  if (approval) {
    if (approval.status === "APPROVED") {
      return { ...base, required, satisfied: true, reason: "APPROVAL_APPROVED" };
    }
    if (approval.status === "REJECTED") {
      return { ...base, required, satisfied: false, reason: "APPROVAL_REJECTED" };
    }
  }

  if (!required) {
    return { ...base, required: false, satisfied: true, reason: "NOT_REQUIRED" };
  }

  // Rule 5 — a signed-in human triggering the job is the approval.
  if (policy.humanPresenceCountsAsApproval && context.autonomy === "HUMAN" && context.source === "MANUAL") {
    return { ...base, required, satisfied: true, reason: "HUMAN_PRESENT" };
  }

  return { ...base, required, satisfied: false, reason: "APPROVAL_MISSING" };
}
