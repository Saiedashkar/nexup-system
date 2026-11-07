import { ToolRegistry } from "@/modules/ai-workforce/registry/tool-registry";
import { workforceToolAdapters } from "@/modules/ai-workforce/tools";

import type { WorkforceDomain } from "../index";

/**
 * The SAFE, EXECUTABLE DETERMINISTIC LEG for the running application (Step 5A-4
 * correction, P1-7).
 *
 * WHY THIS EXISTS. With the shipped default runtime leg always classified
 * `VARIABLE_PROVIDER_COST`, the default DENY governor refuses EVERY runtime
 * dispatch — so before this module the running application had no genuinely
 * executable, zero-variable-cost path at all. The fix is NOT to weaken the
 * governor; it is to compose a DEDICATED deterministic leg that cannot spend:
 *
 *   - a FRESH `ToolRegistry` per composition (never the Phase-1 singleton), so a
 *     later controller cannot quietly register a write tool into it;
 *   - the STRICT read-only allowlist, `workforceToolAdapters` only — the three
 *     Phase-1A read capabilities (`client.search`, `project.list`,
 *     `capital.summary`). NO control-plane write tool (`system.staging_write`) is
 *     ever registered here;
 *   - each capability registered into the DOMAIN capability registry at the
 *     handler's EXACT version, so `id + version` identity holds end to end;
 *   - each capability explicitly ASSIGNED to the routed actor, so no implicit
 *     grant exists.
 *
 * Execution still goes ONLY through the Capability Execution Service: this module
 * composes the deterministic leg the service is handed, it does not execute
 * anything, reuse the Phase-1 JobRunner lifecycle, or touch the
 * LocalRuntimeAdapter (which opens AiRuns).
 */
export function createWorkforceReadOnlyToolRegistry(): ToolRegistry {
  const registry = new ToolRegistry();
  registry.registerAll(workforceToolAdapters);
  return registry;
}

/**
 * Registers and assigns the read-only capabilities for one actor. Idempotent: a
 * re-composed process must not fail because the capability or the assignment
 * already exists.
 */
export async function registerReadOnlyWorkforceCapabilities(
  domain: WorkforceDomain,
  input: { actorId: string; grantedBy: string },
): Promise<string[]> {
  const registered: string[] = [];
  for (const adapter of workforceToolAdapters) {
    const definition = adapter.definition;
    const existing = await domain.capabilities.get(definition.id, definition.version);
    if (!existing) {
      await domain.capabilities.register({
        id: definition.id,
        name: definition.name,
        kind: "TOOL",
        version: definition.version,
        description: definition.description,
        owner: input.grantedBy,
        status: "ACTIVE",
        riskLevel: definition.riskLevel,
        // Read-only toolling needs no human approval, and the deterministic leg
        // is NO_VARIABLE_COST, so the budget gate permits it.
        approvalRequirement: "NONE",
        runtimeRequirements: { supportsDeterministic: true },
        tags: [],
        metadata: {},
      });
    }
    const alreadyAssigned = domain.assignments
      .listForActor(input.actorId)
      .some(
        (assignment) =>
          assignment.status === "ACTIVE" &&
          assignment.capabilityId === definition.id &&
          assignment.capabilityVersion === definition.version,
      );
    if (!alreadyAssigned) {
      await domain.assignments.assign({
        actorId: input.actorId,
        capabilityId: definition.id,
        capabilityVersion: definition.version,
        grantedBy: input.grantedBy,
      });
    }
    registered.push(definition.id);
  }
  return registered;
}
