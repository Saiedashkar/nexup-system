import type { JsonObject, RiskLevel } from "../core/types";

/**
 * Budget Governor — the FAIL-CLOSED money gate on the execution path.
 *
 * WHY IT EXISTS. NEXUP's product invariant is ZERO ADDITIONAL VARIABLE AI SPEND
 * BY DEFAULT. That invariant is only real if there is a decision point that can
 * refuse an execution BEFORE it reaches a provider. Without one, "we do not
 * spend" is a promise about code that does not exist yet — which is exactly the
 * state `docs/AI_WORKFORCE_STEP5_ARCHITECTURE_FREEZE_AUDIT.md` recorded as gap
 * #1 (`ActorModelPolicy` / `EstimatedCostPolicy` declared and unread).
 *
 * STEP 5A SHIPS THE PORT AND A DENY DEFAULT. Not a router, not a ledger, not a
 * price table. The ModelRouter and the real Governor are Step 5C; what must be
 * true NOW is that the hook cannot be absent and that its default outcome is
 * refusal.
 *
 * ── THE ECONOMIC QUESTION, NOT THE PLUMBING ──
 *
 * This port deliberately does NOT speak in terms of runtimes, transports,
 * providers or "bindings". A governor that knew what Hermes is would have to
 * change every time a provider is added, and would tempt someone into encoding
 * a provider-specific exception. The only thing it needs to know is whether a
 * proposed execution can incur cost that varies with use:
 *
 *   VARIABLE_PROVIDER_COST  a real external inference/model/agent turn. This is
 *                           the spend the invariant is about.
 *   NO_VARIABLE_COST        deterministic in-process work, a tool execution, or
 *                           a human step. Bounded by nothing that bills per use.
 *
 * The execution service classifies the leg and asks; the governor decides. That
 * keeps the policy provider-neutral (the same property `AgentRuntime` protects)
 * and keeps the decision in ONE place.
 *
 * ── WHAT THE DEFAULT DOES ──
 *
 * `DenyVariableAiSpendBudgetGovernor` denies every `VARIABLE_PROVIDER_COST`
 * execution with `BUDGET_DENIED_VARIABLE_AI_EXECUTION`, and permits
 * `NO_VARIABLE_COST` work. So:
 *
 *   - deterministic/tool execution still runs (it costs nothing per use);
 *   - a real provider turn CANNOT start until Step 5C establishes an attested
 *     included/free route and returns `ALLOWED_ATTESTED_INCLUDED_ROUTE`.
 *
 * There is deliberately NO allow-with-audit mode, NO "temporary" override flag,
 * NO auto-top-up, NO pay-as-you-go, NO credit purchase and NO silent paid
 * fallback. Tests that need a permissive decision compose their OWN governor
 * (see `BudgetGovernor` below) — the production default is not made weaker to
 * make a test convenient.
 *
 * ── TOTAL, NEVER THROWING ──
 *
 * `evaluate` answers, it does not raise. A governor that threw would turn a
 * policy refusal into an unhandled error on a dispatch path, and a caller
 * catching broadly would then be guessing which way the exception meant. Every
 * path that is not an explicit allow resolves to a refusal, including a spend
 * class the implementation does not recognize.
 */

/** Whether a proposed execution can incur cost that varies with use. */
export const BUDGET_SPEND_CLASSES = ["VARIABLE_PROVIDER_COST", "NO_VARIABLE_COST"] as const;
export type BudgetSpendClass = (typeof BUDGET_SPEND_CLASSES)[number];

export function isBudgetSpendClass(value: string): value is BudgetSpendClass {
  return (BUDGET_SPEND_CLASSES as readonly string[]).includes(value);
}

/**
 * Why the governor decided what it decided. A closed vocabulary so a refusal is
 * machine-readable and cannot be reduced to a free-text excuse.
 */
export const BUDGET_DECISION_REASONS = [
  /** The Step-5A default: variable-cost AI execution is refused outright. */
  "BUDGET_DENIED_VARIABLE_AI_EXECUTION",
  /** The work cannot incur per-use provider cost. */
  "ALLOWED_NO_VARIABLE_COST",
  /**
   * Reserved for Step 5C: the execution maps onto an ATTESTED included/free
   * route. Nothing in Step 5A can return this, because no such attestation
   * exists yet — the reason is declared so the reviewer can see the only
   * legitimate way a provider turn will ever be allowed to start.
   */
  "ALLOWED_ATTESTED_INCLUDED_ROUTE",
  /** Defensive: an unrecognized spend class is a refusal, never a guess. */
  "BUDGET_DENIED_UNCLASSIFIED",
] as const;
export type BudgetDecisionReason = (typeof BUDGET_DECISION_REASONS)[number];

/**
 * What the governor is told. Attribution is included so a future governor can
 * budget per mission/task/actor without a contract change; the Step-5A default
 * evaluates none of it beyond the spend class.
 */
export type BudgetEvaluationInput = {
  capabilityId: string;
  capabilityVersion?: string;
  /** The leg that would execute — classified by the caller, not by this port. */
  spend: BudgetSpendClass;
  actorId: string;
  missionId?: string;
  taskId?: string;
  /** 1-based attempt number inside the task. */
  attempt?: number;
  riskLevel?: RiskLevel;
  /** Correlation id for audit; never a credential. */
  correlationId?: string;
};

export type BudgetDecision = {
  allowed: boolean;
  reason: BudgetDecisionReason;
  /** The policy that produced the decision — a reference, never a price table. */
  policyRef: string;
  /** Whether the decision concerned spend-capable work. */
  spend: BudgetSpendClass;
  /** Bounded, non-secret explanation, safe to record on the execution audit. */
  detail?: string;
};

/**
 * The port. The execution service depends on THIS, never on a class, so a
 * deployment can compose the Step-5C governor without touching the service.
 */
export interface BudgetGovernor {
  /** Stable reference recorded on every execution audit entry. */
  readonly policyRef: string;
  /** Total: every non-allow resolution is a refusal, and nothing is thrown. */
  evaluate(input: BudgetEvaluationInput): Promise<BudgetDecision>;
}

export const DENY_VARIABLE_AI_SPEND_POLICY_REF = "budget.deny-variable-ai-spend.v1";

/**
 * The Step-5A default governor.
 *
 * DENY variable-cost AI execution. PERMIT only work that cannot incur per-use
 * provider cost. This is the mechanical form of "no additional variable AI spend
 * by default": a real provider turn cannot be started by this code path at all,
 * so no configuration mistake, retry storm or agent decision can spend money.
 *
 * It is intentionally tiny. Everything it could grow into (budgets, quotas,
 * included-route attestation, per-actor limits) is Step 5C, and each of those
 * will arrive as a NEW implementation of `BudgetGovernor` beside this one, so
 * this default stays auditable.
 */
export class DenyVariableAiSpendBudgetGovernor implements BudgetGovernor {
  readonly policyRef = DENY_VARIABLE_AI_SPEND_POLICY_REF;

  async evaluate(input: BudgetEvaluationInput): Promise<BudgetDecision> {
    const base = { policyRef: this.policyRef, spend: input.spend };

    switch (input.spend) {
      case "NO_VARIABLE_COST":
        return {
          ...base,
          allowed: true,
          reason: "ALLOWED_NO_VARIABLE_COST",
          detail: "execution cannot incur per-use provider cost",
        };
      case "VARIABLE_PROVIDER_COST":
        return {
          ...base,
          allowed: false,
          reason: "BUDGET_DENIED_VARIABLE_AI_EXECUTION",
          detail:
            "variable-cost AI execution is refused by default; Step 5C must establish an attested included/free route before a provider turn may start",
        };
      default:
        // Unreachable through the type, reachable through data. Refuse.
        return {
          ...base,
          allowed: false,
          reason: "BUDGET_DENIED_UNCLASSIFIED",
          detail: "unrecognized spend class; refusing rather than guessing",
        };
    }
  }
}

/**
 * A fresh default governor. A FUNCTION rather than a shared singleton, so a
 * composition owns its own instance and nothing can mutate a module-level one.
 */
export function denyVariableAiSpendBudgetGovernor(): BudgetGovernor {
  return new DenyVariableAiSpendBudgetGovernor();
}

/** The default the application composes when nothing else is supplied. */
export const DEFAULT_BUDGET_GOVERNOR_POLICY_REF = DENY_VARIABLE_AI_SPEND_POLICY_REF;

/** A bounded, JSON-safe summary of a decision (never a credential, never a price). */
export function summarizeBudgetDecision(decision: BudgetDecision): JsonObject {
  const summary: JsonObject = {
    allowed: decision.allowed,
    reason: decision.reason,
    policyRef: decision.policyRef,
    spend: decision.spend,
  };
  if (decision.detail) summary.detail = decision.detail;
  return summary;
}
