import { AiWorkforceError } from "../core/errors";
import type { ReadWriteMode, RiskLevel, ToolDomain, ToolId } from "../core/types";
import { assertMoneySafety, isMoneyDomain } from "../policies/money-safety";
import { assertRiskDeclaration } from "../policies/risk-classification";
import type { ToolAdapter, ToolDefinition } from "./tool-definition";

/**
 * Tool registry.
 *
 * Registration is the single place where a capability is validated:
 * id uniqueness, declared-risk honesty and money-safety rules. Nothing may
 * execute a tool that did not go through `register`.
 */
export class ToolRegistry {
  private readonly adapters = new Map<ToolId, ToolAdapter>();

  /**
   * Registers a tool adapter.
   * @throws DUPLICATE_TOOL_ID when the id already exists
   */
  register(adapter: ToolAdapter): void {
    const { definition } = adapter;
    if (this.adapters.has(definition.id)) {
      throw new AiWorkforceError("DUPLICATE_TOOL_ID", `Tool "${definition.id}" is already registered`, {
        toolId: definition.id,
      });
    }

    // Guard 1 — the declared risk may never understate the tool's semantics.
    assertRiskDeclaration({
      id: definition.id,
      readWriteMode: definition.readWriteMode,
      action: definition.action,
      riskLevel: definition.riskLevel,
      moneySensitive: isMoneyDomain(definition.domain),
    });

    // Guard 2 — money-writing tools must be HIGH+ and always approved.
    assertMoneySafety(definition);

    this.adapters.set(definition.id, adapter);
  }

  registerAll(adapters: readonly ToolAdapter[]): void {
    for (const adapter of adapters) this.register(adapter);
  }

  has(id: ToolId): boolean {
    return this.adapters.has(id);
  }

  size(): number {
    return this.adapters.size;
  }

  getDefinition(id: ToolId): ToolDefinition | undefined {
    return this.adapters.get(id)?.definition;
  }

  getAdapter(id: ToolId): ToolAdapter | undefined {
    return this.adapters.get(id);
  }

  /** @throws TOOL_NOT_FOUND */
  requireAdapter(id: ToolId): ToolAdapter {
    const adapter = this.adapters.get(id);
    if (!adapter) {
      throw new AiWorkforceError("TOOL_NOT_FOUND", `No tool registered with id "${id}"`, { toolId: id });
    }
    return adapter;
  }

  /** All definitions, sorted by id — safe to serialise (no handlers). */
  list(): ToolDefinition[] {
    return [...this.adapters.values()].map((a) => a.definition).sort((a, b) => a.id.localeCompare(b.id));
  }

  listEnabled(): ToolDefinition[] {
    return this.list().filter((definition) => definition.enabled);
  }

  listAdapters(): ToolAdapter[] {
    return [...this.adapters.values()];
  }

  byDomain(): Record<string, ToolDefinition[]> {
    const grouped: Record<string, ToolDefinition[]> = {};
    for (const definition of this.list()) {
      (grouped[definition.domain] ??= []).push(definition);
    }
    return grouped;
  }

  countBy(filter: { domain?: ToolDomain; readWriteMode?: ReadWriteMode; riskLevel?: RiskLevel }): number {
    return this.list().filter(
      (definition) =>
        (filter.domain === undefined || definition.domain === filter.domain) &&
        (filter.readWriteMode === undefined || definition.readWriteMode === filter.readWriteMode) &&
        (filter.riskLevel === undefined || definition.riskLevel === filter.riskLevel),
    ).length;
  }
}
