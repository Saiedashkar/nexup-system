import type { RunRecord } from "./run-recorder";

/**
 * Run repository port.
 *
 * A run is ONE execution attempt of a job by a runtime adapter. It is written
 * before the tool is invoked (status STARTED) and finished afterwards, so a
 * crash mid-execution still leaves evidence that something was attempted.
 */

export interface RunRepository {
  insert(run: RunRecord): Promise<RunRecord>;
  update(run: RunRecord): Promise<RunRecord | null>;
  get(id: string): Promise<RunRecord | null>;
  list(limit?: number): Promise<RunRecord[]>;
}

export type InMemoryRunStore = {
  readonly rows: Map<string, RunRecord>;
};

export function createInMemoryRunStore(): InMemoryRunStore {
  return { rows: new Map<string, RunRecord>() };
}

function clone(run: RunRecord): RunRecord {
  return JSON.parse(JSON.stringify(run)) as RunRecord;
}

export class InMemoryRunRepository implements RunRepository {
  constructor(private readonly store: InMemoryRunStore = createInMemoryRunStore()) {}

  async insert(run: RunRecord): Promise<RunRecord> {
    this.store.rows.set(run.id, clone(run));
    return clone(run);
  }

  async update(run: RunRecord): Promise<RunRecord | null> {
    if (!this.store.rows.has(run.id)) return null;
    this.store.rows.set(run.id, clone(run));
    return clone(run);
  }

  async get(id: string): Promise<RunRecord | null> {
    const row = this.store.rows.get(id);
    return row ? clone(row) : null;
  }

  async list(limit = 50): Promise<RunRecord[]> {
    return [...this.store.rows.values()]
      .map(clone)
      .sort((a, b) => b.startedAt.localeCompare(a.startedAt) || b.id.localeCompare(a.id))
      .slice(0, limit);
  }

  count(): number {
    return this.store.rows.size;
  }
}
