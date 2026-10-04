import type { Mission, MissionState } from "./mission-contracts";

/**
 * Mission repository port.
 *
 * Mirrors the Phase-1 `JobRepository` contract exactly, including the
 * compare-and-set `update`: a transition only lands when the stored state is
 * still the one the caller read. That is what stops two concurrent advances
 * (two actors, a double click) from both mutating the same mission.
 *
 * Phase 2A ships the in-memory implementation only. A persisted one would
 * implement this same interface, exactly as Phase 1B did for jobs.
 */

export interface MissionRepository {
  insert(mission: Mission): Promise<Mission>;
  get(id: string): Promise<Mission | null>;
  list(limit?: number): Promise<Mission[]>;
  /** @returns the stored mission on success, or null when the CAS lost. */
  update(mission: Mission, expected: MissionState[]): Promise<Mission | null>;
}

function clone(mission: Mission): Mission {
  return JSON.parse(JSON.stringify(mission)) as Mission;
}

export class InMemoryMissionRepository implements MissionRepository {
  private readonly rows = new Map<string, Mission>();

  async insert(mission: Mission): Promise<Mission> {
    this.rows.set(mission.id, clone(mission));
    return clone(mission);
  }

  async get(id: string): Promise<Mission | null> {
    const row = this.rows.get(id);
    return row ? clone(row) : null;
  }

  async list(limit = 50): Promise<Mission[]> {
    return [...this.rows.values()]
      .map(clone)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id))
      .slice(0, limit);
  }

  async update(mission: Mission, expected: MissionState[]): Promise<Mission | null> {
    const current = this.rows.get(mission.id);
    if (!current) return null;
    if (!expected.includes(current.state)) return null;

    const next = clone(mission);
    this.rows.set(next.id, next);
    return clone(next);
  }

  count(): number {
    return this.rows.size;
  }
}
