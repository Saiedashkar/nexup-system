import type { RuntimeId } from "../core/refs";
import type { ActorRegistrationInput } from "./actor-contracts";

/**
 * The Internal Strategy Analyst — a REAL Actor Registry actor.
 *
 * Deliberately the least dangerous useful AI role:
 *
 *   - it reads and summarises; it never publishes, pays, messages a client or
 *     touches money;
 *   - it starts in `SHADOW` (not `APPROVED_AUTONOMY`), so it cannot act on its
 *     own authority;
 *   - its approval policy escalates anything at MEDIUM risk or above to the
 *     Founder — the human remains the authority;
 *   - it has no memory scope and a restricted data policy: nothing is retained.
 *
 * This is a pure DATA seed (identity + policy), like `exec-actor.ts`. It carries
 * no runtime and no capability definitions: the runtime binding is supplied by
 * the caller, and its capability is a separate, revocable ASSIGNMENT.
 *
 * `runtimeId` is a PARAMETER rather than a constant because the binding must
 * name the runtime that is actually registered — the bootstrap passes the real
 * runtime's identity, so the two can never drift apart.
 */

export const INTERNAL_STRATEGY_ANALYST_ACTOR_ID = "actor_internal_strategy_analyst";
export const INTERNAL_STRATEGY_ANALYST_SLUG = "internal-strategy-analyst";
export const INTERNAL_STRATEGY_ANALYST_ROLE = "strategy-analyst";
export const STRATEGY_DEPARTMENT = "strategy";

export type StrategyActorBindingInput = {
  /** The runtime this actor is bound to. Must be a registered runtime id. */
  runtimeId: RuntimeId;
  /** Provider-neutral runtime type, echoed from the runtime's own identity. */
  runtimeType: string;
  /** Opaque provider profile reference, copied from runtime metadata. Never a secret. */
  profileRef?: string;
  /** Capability kinds/ids the runtime must host for this actor. */
  requiredCapabilities?: string[];
  /** Actor this one escalates to. Defaults to the Founder (human authority). */
  escalationTarget?: string;
};

/** The Internal Strategy Analyst as an actor registration. */
export function internalStrategyAnalystRegistration(binding: StrategyActorBindingInput): ActorRegistrationInput {
  const escalationTarget = binding.escalationTarget ?? "actor_founder";
  return {
    id: INTERNAL_STRATEGY_ANALYST_ACTOR_ID,
    slug: INTERNAL_STRATEGY_ANALYST_SLUG,
    displayName: "Internal Strategy Analyst",
    type: "AI_AGENT",
    role: INTERNAL_STRATEGY_ANALYST_ROLE,
    department: STRATEGY_DEPARTMENT,
    reportsTo: escalationTarget,
    collaborators: [],
    // SHADOW: it may be exercised, but it does not operate on its own authority.
    lifecycle: "SHADOW",
    runtimeBinding: {
      runtimeId: binding.runtimeId,
      runtimeType: binding.runtimeType,
      ...(binding.profileRef ? { profileRef: binding.profileRef } : {}),
      ...(binding.requiredCapabilities ? { requiredCapabilities: [...binding.requiredCapabilities] } : {}),
    },
    modelPolicy: {
      strategy: "RUNTIME_DEFAULT",
      maxCostTier: "LOW",
      dataHandling: "RESTRICTED",
    },
    // ASSISTED, not AUTONOMOUS: a human stays in the loop for anything it drafts.
    autonomyLevel: "ASSISTED",
    memoryScope: { scope: "NONE", retention: "EPHEMERAL" },
    permissions: [{ permission: "aiworkforce.access" }, { permission: "strategy.read" }],
    approvalPolicy: { mode: "RISK_AT_LEAST", minRiskLevel: "MEDIUM", escalateToActorId: escalationTarget },
    escalationTarget,
    metadata: { tier: "specialist", dataClass: "INTERNAL", purpose: "internal strategy briefs" },
  };
}
