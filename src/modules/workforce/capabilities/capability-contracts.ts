import { AiWorkforceError } from "@/modules/ai-workforce/core/errors";
import type { JsonObject, RiskLevel } from "@/modules/ai-workforce/core/types";
import type { CapabilityId } from "../core/refs";

/**
 * Capability contracts.
 *
 * Capabilities are the things an actor MAY do. Phase 2A keeps five KINDS that
 * must never be merged into one generic blob, even though they share registry
 * infrastructure:
 *
 *   TOOL        atomic executable action            e.g. `lead.create`, `x.publish`
 *   SKILL       procedural / SOP knowledge          e.g. "qualify a Saudi legal lead"
 *   WORKFLOW    a composition of tools/skills/humans
 *   TEMPLATE    a reusable document/message shape
 *   AUTOMATION  a tool/workflow bound to a trigger
 *
 * The registry enforces just enough shape per kind to keep the distinction
 * real (see `assertCapabilityRegistration`), and nothing more — the domain is
 * still additive, not a workflow engine.
 *
 * The contract carries SCHEMA REFERENCES, not inline schemas: the executable
 * schema lives with the capability owner / tool registry, and the domain keeps
 * a stable pointer, so a schema can evolve without rewriting the registry row.
 */

export const CAPABILITY_KINDS = ["TOOL", "SKILL", "WORKFLOW", "TEMPLATE", "AUTOMATION"] as const;
export type CapabilityKind = (typeof CAPABILITY_KINDS)[number];

export function isCapabilityKind(value: string): value is CapabilityKind {
  return (CAPABILITY_KINDS as readonly string[]).includes(value);
}

export const CAPABILITY_STATUSES = ["DRAFT", "ACTIVE", "DEPRECATED", "DISABLED"] as const;
export type CapabilityStatus = (typeof CAPABILITY_STATUSES)[number];

/** How the approval policy treats this capability. */
export const CAPABILITY_APPROVAL_REQUIREMENTS = ["NONE", "REQUIRED", "POLICY"] as const;
export type CapabilityApprovalRequirement = (typeof CAPABILITY_APPROVAL_REQUIREMENTS)[number];

/* ═══════════════════════════════════════════════════════
   Runtime requirements
   ═══════════════════════════════════════════════════════

   Provider-neutral: `requiredRuntimeTypes` names runtime TYPES (strings the
   RuntimeRegistry understands), never a specific vendor field. A future
   Hermes adapter satisfies `["HERMES"]` without the core knowing what Hermes
   is. */

export type CapabilityRuntimeRequirement = {
  /** Runtime types able to host this capability. Empty = any. */
  requiredRuntimeTypes?: string[];
  /** The capability needs a person (a human step), not just an execution runtime. */
  requiresHuman?: boolean;
  /** The capability can be executed deterministically (no model needed). */
  supportsDeterministic?: boolean;
  /** The capability needs an execution runtime to host it. */
  requiresRuntime?: boolean;
};

/* ═══════════════════════════════════════════════════════
   Composition (WORKFLOW only)
   ═══════════════════════════════════════════════════════ */

export type CapabilityStep =
  | { kind: "TOOL"; ref: string; version?: string }
  | { kind: "SKILL"; ref: string }
  | { kind: "WORKFLOW"; ref: string; version?: string }
  | { kind: "HUMAN"; roleRef: string }
  | { kind: "APPROVAL"; approvalRef?: string };

export type CapabilityComposition = {
  steps: CapabilityStep[];
};

/* ═══════════════════════════════════════════════════════
   Capability
   ═══════════════════════════════════════════════════════ */

export type Capability = {
  id: CapabilityId;
  name: string;
  kind: CapabilityKind;
  /** Semver-like contract version. `id` + `version` is the identity. */
  version: string;
  description: string;
  /** Owner is an actor id or a service id — a reference, not a copy. */
  owner: string;
  status: CapabilityStatus;
  /** Reference to the input contract schema (not the schema itself). */
  inputSchemaRef?: string;
  outputSchemaRef?: string;
  riskLevel: RiskLevel;
  approvalRequirement: CapabilityApprovalRequirement;
  runtimeRequirements: CapabilityRuntimeRequirement;
  /** WORKFLOW only — the ordered composition. */
  composition?: CapabilityComposition;
  /** SKILL only — reference to the procedural/SOP document. */
  procedureRef?: string;
  /** TEMPLATE only — reference to the template body. */
  templateRef?: string;
  /** AUTOMATION only — reference to the trigger that fires it. */
  triggerRef?: string;
  tags: string[];
  metadata: JsonObject;
  createdAt: string;
  updatedAt: string;
};

export type CapabilityRegistrationInput = Omit<
  Capability,
  "createdAt" | "updatedAt" | "status" | "approvalRequirement" | "runtimeRequirements" | "tags" | "metadata"
> &
  Partial<Pick<Capability, "status" | "approvalRequirement" | "runtimeRequirements" | "tags" | "metadata">>;

export type CapabilityFilter = {
  kind?: CapabilityKind;
  status?: CapabilityStatus;
  owner?: string;
  maxRiskLevel?: RiskLevel;
  tag?: string;
};

/** Stable registry key for a capability version. */
export function capabilityKey(id: CapabilityId, version: string): string {
  return `${id}@${version}`;
}

const VERSION_PATTERN = /^\d+\.\d+\.\d+$/;
const ID_PATTERN = /^[a-z][a-z0-9_.-]*$/;

/**
 * Validates a capability registration, including the per-kind distinction.
 * @throws AiWorkforceError("INVALID_CAPABILITY")
 */
export function assertCapabilityRegistration(input: CapabilityRegistrationInput): void {
  const fail = (message: string, details?: JsonObject): never => {
    throw new AiWorkforceError("INVALID_CAPABILITY", message, details);
  };

  if (!input.id || !ID_PATTERN.test(input.id)) {
    fail("Capability id must be lower-case dotted (e.g. lead.create)", { id: input.id });
  }
  if (!isCapabilityKind(input.kind)) {
    fail(`Unknown capability kind "${input.kind}"`, { kind: input.kind as string });
  }
  if (!VERSION_PATTERN.test(input.version)) {
    fail(`Capability version must be semver (e.g. 1.0.0), received "${input.version}"`, { version: input.version });
  }
  if (!input.owner?.trim()) {
    fail("Capability owner is required", { id: input.id });
  }

  switch (input.kind) {
    case "TOOL":
      if (input.composition) fail("A TOOL is atomic and must not carry a composition", { id: input.id });
      if (input.procedureRef) fail("A TOOL must not carry a procedureRef (that is a SKILL)", { id: input.id });
      break;
    case "SKILL":
      if (!input.procedureRef?.trim()) fail("A SKILL requires a procedureRef (its SOP)", { id: input.id });
      if (input.composition) fail("A SKILL must not carry a composition (that is a WORKFLOW)", { id: input.id });
      break;
    case "WORKFLOW":
      if (!input.composition || input.composition.steps.length === 0) {
        fail("A WORKFLOW requires a composition with at least one step", { id: input.id });
      }
      break;
    case "TEMPLATE":
      if (!input.templateRef?.trim()) fail("A TEMPLATE requires a templateRef", { id: input.id });
      break;
    case "AUTOMATION":
      // An AUTOMATION is a tool/workflow bound to a trigger; the trigger is
      // optional in the domain so an automation can be registered before its
      // trigger exists.
      break;
    default:
      break;
  }
}
