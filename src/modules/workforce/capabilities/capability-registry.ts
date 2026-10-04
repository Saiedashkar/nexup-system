import { AiWorkforceError } from "@/modules/ai-workforce/core/errors";
import { RISK_RANK, type Clock, type IdFactory } from "@/modules/ai-workforce/core/types";
import { assertNoCredentials } from "../core/credentials";
import type { CapabilityId } from "../core/refs";
import {
  assertCapabilityRegistration,
  capabilityKey,
  type Capability,
  type CapabilityFilter,
  type CapabilityRegistrationInput,
} from "./capability-contracts";

/**
 * Capability registry port.
 *
 * Identity is `id` + `version`. Registering the same `id@version` twice is a
 * conflict (never a silent overwrite). A bare id resolves to the highest
 * ACTIVE version, falling back to the highest version of any status — so a
 * caller that does not pin a version gets the live one, while a caller that
 * pins a version (e.g. a workflow step) is honoured exactly.
 */

export interface CapabilityRegistry {
  register(input: CapabilityRegistrationInput): Promise<Capability>;
  /** Exact version, or (version omitted) the preferred live version. */
  get(id: CapabilityId, version?: string): Promise<Capability | null>;
  /** @throws CAPABILITY_NOT_FOUND */
  require(id: CapabilityId, version?: string): Promise<Capability>;
  listVersions(id: CapabilityId): Promise<Capability[]>;
  list(filter?: CapabilityFilter): Promise<Capability[]>;
  count(): number;
}

function clone(capability: Capability): Capability {
  return JSON.parse(JSON.stringify(capability)) as Capability;
}

/** Numeric-aware semver comparison (no external dependency). */
function compareVersions(a: string, b: string): number {
  const pa = a.split(".").map((part) => Number.parseInt(part, 10) || 0);
  const pb = b.split(".").map((part) => Number.parseInt(part, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i += 1) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

export class InMemoryCapabilityRegistry implements CapabilityRegistry {
  private readonly rows = new Map<string, Capability>();

  constructor(private readonly deps: { ids: IdFactory; now: Clock }) {}

  async register(input: CapabilityRegistrationInput): Promise<Capability> {
    assertCapabilityRegistration(input);
    assertNoCredentials(input, `Capability "${input.id}@${input.version}"`);

    const key = capabilityKey(input.id, input.version);
    if (this.rows.has(key)) {
      throw new AiWorkforceError(
        "CAPABILITY_VERSION_CONFLICT",
        `Capability "${input.id}" version "${input.version}" is already registered`,
        { id: input.id, version: input.version },
      );
    }

    const at = this.deps.now().toISOString();
    const capability: Capability = {
      ...input,
      status: input.status ?? "DRAFT",
      approvalRequirement: input.approvalRequirement ?? "POLICY",
      runtimeRequirements: input.runtimeRequirements ?? {},
      tags: input.tags ? [...input.tags] : [],
      metadata: input.metadata ?? {},
      createdAt: at,
      updatedAt: at,
    };

    this.rows.set(key, capability);
    return clone(capability);
  }

  async get(id: CapabilityId, version?: string): Promise<Capability | null> {
    if (version) {
      const row = this.rows.get(capabilityKey(id, version));
      return row ? clone(row) : null;
    }
    const preferred = await this.preferred(id);
    return preferred ? clone(preferred) : null;
  }

  async require(id: CapabilityId, version?: string): Promise<Capability> {
    const capability = await this.get(id, version);
    if (!capability) {
      throw new AiWorkforceError(
        "CAPABILITY_NOT_FOUND",
        version ? `Capability "${id}@${version}" does not exist` : `Capability "${id}" does not exist`,
        { id, version: version ?? null },
      );
    }
    return capability;
  }

  async listVersions(id: CapabilityId): Promise<Capability[]> {
    return [...this.rows.values()]
      .filter((capability) => capability.id === id)
      .map(clone)
      .sort((a, b) => compareVersions(a.version, b.version));
  }

  async list(filter: CapabilityFilter = {}): Promise<Capability[]> {
    return [...this.rows.values()]
      .filter((capability) => {
        if (filter.kind && capability.kind !== filter.kind) return false;
        if (filter.status && capability.status !== filter.status) return false;
        if (filter.owner && capability.owner !== filter.owner) return false;
        if (filter.tag && !capability.tags.includes(filter.tag)) return false;
        if (filter.maxRiskLevel && RISK_RANK[capability.riskLevel] > RISK_RANK[filter.maxRiskLevel]) {
          return false;
        }
        return true;
      })
      .map(clone)
      .sort((a, b) => a.id.localeCompare(b.id) || compareVersions(a.version, b.version));
  }

  count(): number {
    return this.rows.size;
  }

  /** The version a bare id resolves to: highest ACTIVE, else highest overall. */
  private async preferred(id: CapabilityId): Promise<Capability | null> {
    const versions = await this.listVersions(id);
    if (versions.length === 0) return null;

    const active = versions.filter((capability) => capability.status === "ACTIVE");
    const pool = active.length > 0 ? active : versions;
    return pool.reduce((best, candidate) => (compareVersions(candidate.version, best.version) > 0 ? candidate : best));
  }
}
