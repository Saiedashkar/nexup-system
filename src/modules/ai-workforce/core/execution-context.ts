import type { ApprovalId, AutonomyLevel, BusinessScope, CorrelationId, JobId, RunId, TriggerType } from "./types";

/* ═══════════════════════════════════════════════════════
   Permission tokens
   ═══════════════════════════════════════════════════════

   The tokens the workforce policy engine understands. They are DERIVED from
   the existing NEXUP session flags (`policies/permission-policy.ts`) — the
   legacy auth module stays the single source of truth for who may do what.
   Tools never inspect a session; they only declare tokens. */

export const PERMISSION_TOKENS = [
  /** Module gate — access to the AI Workforce control core itself. */
  "aiworkforce.access",
  /** Read/write business data through workforce tools. */
  "clients.read",
  "clients.write",
  "projects.read",
  "projects.write",
  "capital.read",
  "capital.write",
  /** Explicitly authorise a high-risk money movement. */
  "capital.approve",
  /** Internal/system capabilities (staging + control-plane probes). */
  "system.write",
] as const;

export type PermissionToken = (typeof PERMISSION_TOKENS)[number];

export function isPermissionToken(value: string): value is PermissionToken {
  return (PERMISSION_TOKENS as readonly string[]).includes(value);
}

/* ═══════════════════════════════════════════════════════
   Service identity
   ═══════════════════════════════════════════════════════

   `serviceIdentity` answers "which runtime is executing?".
   `actor` answers "on whose behalf, and with which rights?".

   The two are deliberately separate: the runtime never inherits the actor's
   rights by itself, and the actor never gets superadmin merely because the
   runtime is trusted. */

export type ServiceIdentity = {
  /** Stable service id, e.g. "ai-workforce.control-core". */
  id: string;
  name: string;
  kind: "SERVICE" | "RUNTIME";
  /** Which runtime adapter backed this execution ("LOCAL" in Phase 1A). */
  runtimeKind: string;
  /** True only for identities that were verified, not merely configured. */
  verified: boolean;
};

export const CONTROL_CORE_SERVICE_ID = "ai-workforce.control-core";

export function createServiceIdentity(runtimeKind: string, overrides: Partial<ServiceIdentity> = {}): ServiceIdentity {
  return {
    id: CONTROL_CORE_SERVICE_ID,
    name: "NEXUP AI Workforce Control Core",
    kind: "SERVICE",
    runtimeKind,
    // Phase 1A runs in-process: there is no external caller to verify yet.
    // A future Runtime Adapter (Hermes/OpenAI/...) must set this to true only
    // after its service credential has actually been validated.
    verified: false,
    ...overrides,
  };
}

/* ═══════════════════════════════════════════════════════
   Delegated actor
   ═══════════════════════════════════════════════════════ */

export type ActorContext = {
  userId: string;
  name: string;
  role: string;
  isSuperAdmin: boolean;
  hasOfficeFinanceFull: boolean;
  /** Business slugs this actor may reach (from the legacy session). */
  accessibleBusinessSlugs: string[];
  /** Tokens derived from the flags above. */
  permissionTokens: PermissionToken[];
};

/** Actor used by system-originated work where no person is involved. */
export function createSystemActor(): ActorContext {
  return {
    userId: "system",
    name: "System",
    role: "SYSTEM",
    isSuperAdmin: false,
    hasOfficeFinanceFull: false,
    accessibleBusinessSlugs: [],
    permissionTokens: [],
  };
}

/* ═══════════════════════════════════════════════════════
   Workspace
   ═══════════════════════════════════════════════════════ */

export type WorkspaceContext = {
  clientId?: string;
  projectId?: string;
};

/* ═══════════════════════════════════════════════════════
   Execution context
   ═══════════════════════════════════════════════════════ */

export type ExecutionContext = {
  serviceIdentity: ServiceIdentity;
  actor: ActorContext;
  /** Resolved business scope; null for office-wide (global) capabilities. */
  business: BusinessScope | null;
  workspace: WorkspaceContext | null;
  jobId?: JobId;
  runId?: RunId;
  approvalId?: ApprovalId;
  source: TriggerType;
  autonomy: AutonomyLevel;
  correlationId: CorrelationId;
  requestedAt: string;
};

export type ExecutionContextInput = {
  serviceIdentity: ServiceIdentity;
  actor: ActorContext;
  business?: BusinessScope | null;
  workspace?: WorkspaceContext | null;
  jobId?: JobId;
  runId?: RunId;
  approvalId?: ApprovalId;
  source?: TriggerType;
  autonomy?: AutonomyLevel;
  correlationId?: CorrelationId;
  now?: Date;
  ids?: { next(kind: string): string };
};

/**
 * Builds an execution context. The actor and the business scope are always
 * supplied by the caller (the API adapter resolves them from the session);
 * they are never read from tool input.
 */
export function createExecutionContext(input: ExecutionContextInput): ExecutionContext {
  const now = input.now ?? new Date();
  const correlationId =
    input.correlationId ?? input.ids?.next("corr") ?? `corr_${now.getTime().toString(36)}`;
  const source: TriggerType = input.source ?? "MANUAL";

  return {
    serviceIdentity: input.serviceIdentity,
    actor: input.actor,
    business: input.business ?? null,
    workspace: input.workspace ?? null,
    jobId: input.jobId,
    runId: input.runId,
    approvalId: input.approvalId,
    source,
    // A person pressing the button is HUMAN autonomy; every automatic trigger
    // is AGENT autonomy unless a caller explicitly states otherwise.
    autonomy: input.autonomy ?? (source === "MANUAL" ? "HUMAN" : "AGENT"),
    correlationId,
    requestedAt: now.toISOString(),
  };
}

/** Returns a copy of the context with the given patches applied. */
export function withContext(context: ExecutionContext, patch: Partial<ExecutionContext>): ExecutionContext {
  return { ...context, ...patch };
}
