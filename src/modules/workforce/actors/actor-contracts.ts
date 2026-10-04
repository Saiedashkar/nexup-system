import { AiWorkforceError } from "@/modules/ai-workforce/core/errors";
import type { JsonObject, RiskLevel } from "@/modules/ai-workforce/core/types";
import type { ActorId, ActorSlug, RuntimeId } from "../core/refs";

/**
 * Actor contracts — the workforce RUNTIME identity model.
 *
 * An actor is the thing that DECIDES and OWNS work: a person, an AI agent, the
 * executive orchestrator, or a system/service identity. It is deliberately NOT
 * the UI mock actor config (`components/command/state/actor-workspace.ts`) —
 * that config is presentation. This is the domain source of truth the runtime
 * will use.
 *
 * TWO SAFETY RULES, enforced at registration (see `core/credentials.ts`):
 *   1. An Actor record never stores a secret. A runtime binding references a
 *      runtime by id; the runtime — not the actor row — is where credentials
 *      would live (and they do NOT live there either in Phase 2A).
 *   2. An Actor record never embeds capability DEFINITIONS. It only carries
 *      ASSIGNMENTS (see `assignments/`), so capabilities can be versioned
 *      and revoked without touching the actor.
 */

/* ═══════════════════════════════════════════════════════
   Types
   ═══════════════════════════════════════════════════════ */

export const ACTOR_TYPES = ["HUMAN", "AI_AGENT", "EXECUTIVE", "SYSTEM", "SERVICE"] as const;
export type ActorType = (typeof ACTOR_TYPES)[number];

export function isActorType(value: string): value is ActorType {
  return (ACTOR_TYPES as readonly string[]).includes(value);
}

/**
 * True for actors that EXECUTE on an `AgentRuntime`.
 *
 * Humans and system/service identities do not. EXEC is deliberately excluded:
 * in Phase 2A it is a declarative orchestrator with no execution runtime, so
 * demanding a binding for it would force a fabricated one.
 */
export function requiresRuntime(type: ActorType): boolean {
  return type === "AI_AGENT";
}

/* ═══════════════════════════════════════════════════════
   Lifecycle
   ═══════════════════════════════════════════════════════ */

export const ACTOR_LIFECYCLE_STATES = [
  "DRAFT",
  "SHADOW",
  "ASSISTED",
  "APPROVED_AUTONOMY",
  "REVIEW",
  "DISABLED",
] as const;
export type ActorLifecycleState = (typeof ACTOR_LIFECYCLE_STATES)[number];

export function isActorLifecycleState(value: string): value is ActorLifecycleState {
  return (ACTOR_LIFECYCLE_STATES as readonly string[]).includes(value);
}

/* ═══════════════════════════════════════════════════════
   Autonomy
   ═══════════════════════════════════════════════════════

   Distinct from the Phase-1 job `AutonomyLevel` (HUMAN | AGENT), which
   describes WHO triggered a single execution. Actor autonomy describes how
   much latitude the actor has as a standing property. The lifecycle state and
   the autonomy level are related but independent: an actor can be parked in
   REVIEW at any autonomy level. */

export const ACTOR_AUTONOMY_LEVELS = ["MANUAL", "SUGGEST", "ASSISTED", "SUPERVISED", "AUTONOMOUS"] as const;
export type ActorAutonomyLevel = (typeof ACTOR_AUTONOMY_LEVELS)[number];

/* ═══════════════════════════════════════════════════════
   Runtime binding
   ═══════════════════════════════════════════════════════

   A binding is a POINTER, not a credential: `runtimeId` names a registered
   runtime, `profileRef` names a provider-side profile/config the adapter
   understands. The core never inspects what `profileRef` means. */

export type ActorRuntimeBinding = {
  runtimeId: RuntimeId;
  /** Provider-neutral runtime type (e.g. "DETERMINISTIC_LOCAL", future "HERMES"). */
  runtimeType: string;
  /** Opaque, provider-specific profile reference — never a secret. */
  profileRef?: string;
  /** Capability kinds/ids the runtime must support for this actor to run. */
  requiredCapabilities?: string[];
};

/* ═══════════════════════════════════════════════════════
   Model policy
   ═══════════════════════════════════════════════════════

   Model policy names a LOGICAL model reference (a tier/alias the runtime
   resolves), never an API key or provider endpoint. */

export const MODEL_STRATEGIES = ["NONE", "RUNTIME_DEFAULT", "PREFERRED_WITH_FALLBACK", "PINNED"] as const;
export type ModelStrategy = (typeof MODEL_STRATEGIES)[number];

export type ActorModelPolicy = {
  strategy: ModelStrategy;
  preferredModelRef?: string;
  fallbackModelRef?: string;
  maxCostTier?: "LOW" | "MEDIUM" | "HIGH";
  dataHandling?: "LOCAL_ONLY" | "CLOUD_ALLOWED" | "RESTRICTED";
};

/* ═══════════════════════════════════════════════════════
   Memory scope
   ═══════════════════════════════════════════════════════

   Phase 2A models WHERE an actor may remember — never HOW. No retrieval,
   embeddings or vector store is implemented here. */

export const MEMORY_SCOPES = ["NONE", "ACTOR", "DEPARTMENT", "ORGANIZATION", "MISSION"] as const;
export type MemoryScope = (typeof MEMORY_SCOPES)[number];

export type ActorMemoryScope = {
  scope: MemoryScope;
  retention?: "EPHEMERAL" | "SESSION" | "LONG_TERM";
  /** Logical namespaces the actor may read/write; opaque to the core. */
  namespaces?: string[];
};

/* ═══════════════════════════════════════════════════════
   Approval policy
   ═══════════════════════════════════════════════════════

   Per-actor approval posture. `INHERIT` means "use the system approval policy"
   — the actor adds no opinion. `escalateToActorId` names who a blocked actor
   escalates to (EXEC, a lead, or a human). */

export const ACTOR_APPROVAL_MODES = ["INHERIT", "RISK_AT_LEAST", "ALWAYS", "NEVER"] as const;
export type ActorApprovalMode = (typeof ACTOR_APPROVAL_MODES)[number];

export type ActorApprovalPolicy = {
  mode: ActorApprovalMode;
  /** Used when mode is RISK_AT_LEAST. */
  minRiskLevel?: RiskLevel;
  escalateToActorId?: ActorId;
};

/* ═══════════════════════════════════════════════════════
   Permissions
   ═══════════════════════════════════════════════════════

   A grant is a named capability token plus an optional business scope. This is
   a REFERENCE vocabulary, not an auth token: no session token, JWT or
   credential is ever stored on an actor. */

export type ActorPermissionGrant = {
  /**
   * The permission NAME, e.g. "clients.read", "capital.approve".
   * Deliberately NOT called `token`: it is a reference to a named right, not a
   * credential, and the credential guard must never have to special-case it.
   */
  permission: string;
  /** Restrict the grant to one business slug; absent = all permitted businesses. */
  businessSlug?: string;
};

/* ═══════════════════════════════════════════════════════
   Actor
   ═══════════════════════════════════════════════════════ */

export type Actor = {
  id: ActorId;
  slug: ActorSlug;
  displayName: string;
  type: ActorType;
  role: string;
  /** Department slug, or null for organization-wide / executive actors. */
  department: string | null;
  /** Actor this one reports to, if any. */
  reportsTo: ActorId | null;
  collaborators: ActorId[];
  lifecycle: ActorLifecycleState;
  /** Null for humans and services — no fake AI runtime is required. */
  runtimeBinding: ActorRuntimeBinding | null;
  modelPolicy: ActorModelPolicy | null;
  autonomyLevel: ActorAutonomyLevel;
  memoryScope: ActorMemoryScope;
  permissions: ActorPermissionGrant[];
  approvalPolicy: ActorApprovalPolicy;
  /** Who is escalated to when this actor cannot proceed. */
  escalationTarget: ActorId | null;
  metadata: JsonObject;
  createdAt: string;
  updatedAt: string;
};

/** Everything needed to register an actor; id/timestamps are minted by the registry. */
export type ActorRegistrationInput = Omit<Actor, "id" | "createdAt" | "updatedAt"> & {
  id?: ActorId;
};

export type ActorFilter = {
  type?: ActorType;
  lifecycle?: ActorLifecycleState;
  department?: string;
  runtimeId?: RuntimeId;
};

/* ═══════════════════════════════════════════════════════
   Registration defaults + validation
   ═══════════════════════════════════════════════════════ */

export const DEFAULT_MEMORY_SCOPE: ActorMemoryScope = { scope: "NONE", retention: "EPHEMERAL" };
export const INHERIT_APPROVAL: ActorApprovalPolicy = { mode: "INHERIT" };

const SLUG_PATTERN = /^[a-z][a-z0-9-]*$/;

/**
 * Validates the shape of an actor registration.
 * @throws AiWorkforceError("INVALID_ACTOR")
 */
export function assertActorRegistration(input: ActorRegistrationInput): void {
  const fail = (message: string, details?: JsonObject): never => {
    throw new AiWorkforceError("INVALID_ACTOR", message, details);
  };

  if (!input.slug || !SLUG_PATTERN.test(input.slug)) {
    fail("Actor slug must be lower-kebab-case", { slug: input.slug });
  }
  if (!isActorType(input.type)) {
    fail(`Unknown actor type "${input.type}"`, { type: input.type as string });
  }
  if (!input.displayName?.trim()) {
    fail("Actor displayName is required", { slug: input.slug });
  }
  if (!input.role?.trim()) {
    fail("Actor role is required", { slug: input.slug });
  }
  if (input.lifecycle && !isActorLifecycleState(input.lifecycle)) {
    fail(`Unknown lifecycle state "${input.lifecycle}"`, { lifecycle: input.lifecycle as string });
  }
  if (input.autonomyLevel && !(ACTOR_AUTONOMY_LEVELS as readonly string[]).includes(input.autonomyLevel)) {
    fail(`Unknown autonomy level "${input.autonomyLevel}"`, { autonomyLevel: input.autonomyLevel as string });
  }
  if (input.type === "HUMAN" && input.runtimeBinding) {
    fail("A human actor must not carry a runtime binding", { slug: input.slug });
  }
  if (requiresRuntime(input.type) && input.lifecycle === "APPROVED_AUTONOMY" && !input.runtimeBinding) {
    fail("An approved-autonomy AI actor requires a runtime binding", { slug: input.slug });
  }
}
