import type { Job, JobStatus } from "./job-contracts";

/**
 * Job repository port.
 *
 * The control core talks to this interface only — never to Prisma. Two
 * implementations exist:
 *
 *   InMemoryJobRepository  tests + the default (isolated) runtime
 *   PrismaJobRepository    a real, approved database (Phase 1B adapter)
 *
 * `update` is a COMPARE-AND-SET, not a blind write. That single property is
 * what makes the engine idempotent: a transition only lands when the stored
 * status is still the one the caller read, so two concurrent resumes (or a
 * double click, or a retried request) cannot both advance the same job into
 * execution. The loser gets `null` and the runner raises JOB_CONCURRENT_UPDATE.
 */

export interface JobRepository {
  insert(job: Job): Promise<Job>;
  get(id: string): Promise<Job | null>;
  list(limit?: number): Promise<Job[]>;
  /**
   * Persists `job` only when the stored row is currently in one of `expected`.
   * @returns the stored job on success, `null` when the compare-and-set failed
   *          (row missing or already advanced by someone else).
   */
  update(job: Job, expected: JobStatus[]): Promise<Job | null>;
}

/* ═══════════════════════════════════════════════════════
   In-memory implementation
   ═══════════════════════════════════════════════════════ */

/**
 * Shared row store. Handing the same store to a second core is what makes a
 * "process restart" observable in tests: the runner keeps nothing of its own.
 */
export type InMemoryJobStore = {
  readonly rows: Map<string, Job>;
};

export function createInMemoryJobStore(): InMemoryJobStore {
  return { rows: new Map<string, Job>() };
}

/**
 * Rows are cloned on the way in and out (JSON round-trip), so callers can
 * never mutate stored state by holding a reference — the in-memory store
 * behaves like a database, not like a cache.
 */
function clone(job: Job): Job {
  return JSON.parse(JSON.stringify(job)) as Job;
}

export class InMemoryJobRepository implements JobRepository {
  constructor(private readonly store: InMemoryJobStore = createInMemoryJobStore()) {}

  async insert(job: Job): Promise<Job> {
    this.store.rows.set(job.id, clone(job));
    return clone(job);
  }

  async get(id: string): Promise<Job | null> {
    const row = this.store.rows.get(id);
    return row ? clone(row) : null;
  }

  async list(limit = 50): Promise<Job[]> {
    return [...this.store.rows.values()]
      .map(clone)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id))
      .slice(0, limit);
  }

  async update(job: Job, expected: JobStatus[]): Promise<Job | null> {
    const current = this.store.rows.get(job.id);
    if (!current) return null;
    if (!expected.includes(current.status)) return null;

    // No `await` between the read above and the write below: in a single
    // JS thread this makes the compare-and-set atomic, exactly like the
    // `updateMany({ where: { id, status: { in: expected } } })` the Prisma
    // adapter uses.
    const next = clone(job);
    this.store.rows.set(next.id, next);
    return clone(next);
  }

  /** Test helper — number of stored rows. */
  count(): number {
    return this.store.rows.size;
  }
}
