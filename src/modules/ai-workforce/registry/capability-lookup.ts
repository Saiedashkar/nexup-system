import { AiWorkforceError } from "../core/errors";
import type { PermissionToken } from "../core/execution-context";
import { RISK_RANK, type ReadWriteMode, type RiskLevel, type ToolDomain } from "../core/types";
import type { ToolAdapter, ToolDefinition } from "./tool-definition";
import type { ToolRegistry } from "./tool-registry";

/**
 * Capability lookup.
 *
 * This is the "Capability Lookup" step of the execution model: given a
 * registry and a query (or a capability string from a job), resolve which
 * tool may run. It never executes anything.
 */

export type CapabilityQuery = {
  /** Exact id (`client.search`). */
  id?: string;
  domain?: ToolDomain;
  action?: string;
  readWriteMode?: ReadWriteMode;
  /** Only capabilities at or below this risk. */
  maxRiskLevel?: RiskLevel;
  /** Capabilities that run with these tokens (no grant required here). */
  permissionTokens?: PermissionToken[];
  /** Free-text match over id / name / description. */
  text?: string;
  /** Include disabled capabilities (default false). */
  includeDisabled?: boolean;
};

export function findCapabilities(registry: ToolRegistry, query: CapabilityQuery = {}): ToolDefinition[] {
  const text = query.text?.trim().toLowerCase();

  return registry.list().filter((definition) => {
    if (!query.includeDisabled && !definition.enabled) return false;
    if (query.id && definition.id !== query.id) return false;
    if (query.domain && definition.domain !== query.domain) return false;
    if (query.action && definition.action !== query.action) return false;
    if (query.readWriteMode && definition.readWriteMode !== query.readWriteMode) return false;
    if (query.maxRiskLevel && RISK_RANK[definition.riskLevel] > RISK_RANK[query.maxRiskLevel]) return false;
    if (query.permissionTokens && !query.permissionTokens.every((token) => definition.requiredPermissions.includes(token))) {
      return false;
    }
    if (text) {
      const haystack = `${definition.id} ${definition.name} ${definition.description} ${definition.domain} ${definition.action}`.toLowerCase();
      if (!haystack.includes(text)) return false;
    }
    return true;
  });
}

/**
 * Resolves a capability string into an executable adapter.
 *
 * Accepts an exact tool id (`capital.summary`) or an unambiguous shorthand
 * (`summary`). Ambiguity is an error, never a coin flip.
 *
 * @throws TOOL_NOT_FOUND | CAPABILITY_AMBIGUOUS | TOOL_DISABLED
 */
export function resolveCapability(registry: ToolRegistry, capability: string): ToolAdapter {
  const wanted = capability.trim();

  const exact = registry.getAdapter(wanted);
  if (exact) {
    if (!exact.definition.enabled) {
      throw new AiWorkforceError("TOOL_DISABLED", `Tool "${wanted}" is disabled`, { toolId: wanted });
    }
    return exact;
  }

  const matches = registry
    .listAdapters()
    .filter((adapter) => adapter.definition.action === wanted || adapter.definition.id.split(".")[1] === wanted);

  if (matches.length === 0) {
    throw new AiWorkforceError("TOOL_NOT_FOUND", `No capability matches "${capability}"`, { capability });
  }
  if (matches.length > 1) {
    throw new AiWorkforceError(
      "CAPABILITY_AMBIGUOUS",
      `Capability "${capability}" is ambiguous — use a full tool id`,
      { capability, candidates: matches.map((m) => m.definition.id) },
    );
  }

  const adapter = matches[0];
  if (!adapter.definition.enabled) {
    throw new AiWorkforceError("TOOL_DISABLED", `Tool "${adapter.definition.id}" is disabled`, {
      toolId: adapter.definition.id,
    });
  }
  return adapter;
}

/**
 * Resolves a capability to an EXECUTABLE adapter at an EXACT `id@version`.
 *
 * `resolveCapability` resolves by id and returns whatever single adapter holds
 * it — so a caller that authorised `client.search@2.0.0` could otherwise be
 * handed the `client.search@1.0.0` handler. Capability identity is
 * `id + version` (see `capability-contracts.ts`), so the version is part of the
 * authorisation, not a display detail. This resolver is the ONE place that
 * binds the two: it returns the adapter ONLY when the registry's definition is
 * at the exact authorised version, and otherwise fails closed.
 *
 * @throws CAPABILITY_VERSION_CONFLICT when the id exists at a different version
 * @throws TOOL_NOT_FOUND when the id is not registered at all
 * @throws TOOL_DISABLED when the exact adapter is disabled
 */
export function resolveCapabilityExact(registry: ToolRegistry, id: string, version: string): ToolAdapter {
  const adapter = registry.getAdapter(id);
  if (!adapter) {
    throw new AiWorkforceError("TOOL_NOT_FOUND", `No capability is registered with id "${id}"`, { toolId: id });
  }
  if (adapter.definition.version !== version) {
    throw new AiWorkforceError(
      "CAPABILITY_VERSION_CONFLICT",
      `Capability "${id}" is registered at version "${adapter.definition.version}", not the authorised "${version}"`,
      { toolId: id, authorisedVersion: version, registeredVersion: adapter.definition.version },
    );
  }
  if (!adapter.definition.enabled) {
    throw new AiWorkforceError("TOOL_DISABLED", `Tool "${id}@${version}" is disabled`, { toolId: id });
  }
  return adapter;
}

export function describeCapability(definition: ToolDefinition): string {
  return `${definition.id}@${definition.version} [${definition.riskLevel}/${definition.readWriteMode}] ${definition.name}`;
}
