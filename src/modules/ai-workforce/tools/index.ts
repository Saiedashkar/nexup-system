import type { ToolAdapter } from "../registry/tool-definition";
import type { ToolRegistry } from "../registry/tool-registry";
import { readToolAdapters } from "./read";
import { writeToolAdapters } from "./write";

/**
 * Every capability the workforce module knows about.
 *
 * `workforceToolAdapters` is the Phase 1A read-only surface, unchanged.
 * `controlPlaneToolAdapters` adds the Phase 1B approval fixture and is what the
 * application composition root and the Phase 1B tests register.
 */
export const workforceToolAdapters: readonly ToolAdapter[] = [...readToolAdapters];

export const controlPlaneToolAdapters: readonly ToolAdapter[] = [...readToolAdapters, ...writeToolAdapters];

/** Registers the bundle. Duplicate ids throw, by design. */
export function registerWorkforceTools(registry: ToolRegistry): ToolRegistry {
  registry.registerAll(workforceToolAdapters);
  return registry;
}

export { readToolAdapters, writeToolAdapters };
export * from "./adapters/client.tools";
export * from "./adapters/project.tools";
export * from "./adapters/capital.tools";
export * from "./adapters/system.tools";
