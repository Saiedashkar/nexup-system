import type { ActorRegistrationInput } from "./actor-contracts";

/**
 * EXEC, the Founder channel and system identities — as ACTOR registrations.
 *
 * EXEC is a special actor: the central, policy-aware orchestrator that can
 * delegate to other actors and escalate to human authority. Phase 2A models
 * only its IDENTITY and AUTHORITY. There is deliberately NO planning
 * intelligence, no LLM and no scheduler attached here — those arrive in a
 * later phase, on top of this representation.
 *
 * These are pure data seeds. A caller decides whether to register them, so a
 * test that wants a bare registry is never polluted.
 */

export const EXEC_ACTOR_ID = "actor_exec";
export const EXEC_ACTOR_SLUG = "exec";

export const FOUNDER_ACTOR_ID = "actor_founder";
export const FOUNDER_ACTOR_SLUG = "founder";

/** EXEC — organization-wide executive orchestrator. */
export function execActorRegistration(): ActorRegistrationInput {
  return {
    id: EXEC_ACTOR_ID,
    slug: EXEC_ACTOR_SLUG,
    displayName: "EXEC",
    type: "EXECUTIVE",
    role: "orchestrator",
    department: null,
    reportsTo: FOUNDER_ACTOR_ID,
    collaborators: [],
    // EXEC may run under approved autonomy, but every high-risk action still
    // routes through the approval policy and escalates to human authority.
    lifecycle: "APPROVED_AUTONOMY",
    // No runtime binding in Phase 2A: EXEC has no execution runtime yet, and
    // the field is null rather than a fabricated one. Only AI_AGENT actors are
    // required to carry a binding (`requiresRuntime`).
    runtimeBinding: null,
    modelPolicy: { strategy: "NONE" },
    autonomyLevel: "SUPERVISED",
    memoryScope: { scope: "ORGANIZATION", retention: "LONG_TERM", namespaces: ["org"] },
    permissions: [{ permission: "aiworkforce.access" }],
    approvalPolicy: { mode: "RISK_AT_LEAST", minRiskLevel: "HIGH", escalateToActorId: FOUNDER_ACTOR_ID },
    escalationTarget: FOUNDER_ACTOR_ID,
    metadata: { tier: "executive", orchestrator: true },
  };
}

/** The Founder — human authority EXEC escalates to. */
export function founderActorRegistration(): ActorRegistrationInput {
  return {
    id: FOUNDER_ACTOR_ID,
    slug: FOUNDER_ACTOR_SLUG,
    displayName: "Founder",
    type: "HUMAN",
    role: "founder",
    department: null,
    reportsTo: null,
    collaborators: [],
    lifecycle: "APPROVED_AUTONOMY",
    // Humans carry no runtime binding — human work is first-class without a
    // fabricated AI runtime.
    runtimeBinding: null,
    modelPolicy: null,
    autonomyLevel: "AUTONOMOUS",
    memoryScope: { scope: "ORGANIZATION", retention: "LONG_TERM", namespaces: ["org"] },
    permissions: [{ permission: "aiworkforce.access" }],
    approvalPolicy: { mode: "NEVER" },
    escalationTarget: null,
    metadata: { tier: "human-authority" },
  };
}

/**
 * An ADDITIONAL human authority — the Founder-shaped registration, for a named
 * person.
 *
 * The deployment seeds only the Founder as a HUMAN actor. A proof (or a future
 * operator) that needs to show a decision attributed to a SPECIFIC person rather
 * than the Founder channel registers one of these. It is the same shape as the
 * Founder seed on purpose: a human carries no runtime binding, and its approval
 * policy is NEVER (a person is the authority, not a subject of it).
 */
export function humanActorRegistration(input: {
  id: string;
  slug: string;
  displayName: string;
  role?: string;
}): ActorRegistrationInput {
  return {
    id: input.id,
    slug: input.slug,
    displayName: input.displayName,
    type: "HUMAN",
    role: input.role ?? "human-authority",
    department: null,
    reportsTo: null,
    collaborators: [],
    lifecycle: "APPROVED_AUTONOMY",
    runtimeBinding: null,
    modelPolicy: null,
    autonomyLevel: "AUTONOMOUS",
    memoryScope: { scope: "NONE", retention: "EPHEMERAL" },
    permissions: [{ permission: "aiworkforce.access" }],
    approvalPolicy: { mode: "NEVER" },
    escalationTarget: null,
    metadata: { tier: "human-authority" },
  };
}

/** A deterministic/manual system or service identity (never a person). */
export function systemActorRegistration(input: {
  slug: string;
  role: string;
  displayName?: string;
  type?: "SYSTEM" | "SERVICE";
}): ActorRegistrationInput {
  return {
    slug: input.slug,
    displayName: input.displayName ?? input.slug,
    type: input.type ?? "SYSTEM",
    role: input.role,
    department: null,
    reportsTo: null,
    collaborators: [],
    lifecycle: "APPROVED_AUTONOMY",
    runtimeBinding: null,
    modelPolicy: { strategy: "NONE" },
    autonomyLevel: "MANUAL",
    memoryScope: { scope: "NONE", retention: "EPHEMERAL" },
    permissions: [{ permission: "aiworkforce.access" }],
    approvalPolicy: { mode: "INHERIT" },
    escalationTarget: FOUNDER_ACTOR_ID,
    metadata: {},
  };
}
