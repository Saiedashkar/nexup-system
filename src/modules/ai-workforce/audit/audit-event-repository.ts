import type { AuditEvent } from "./run-recorder";

/**
 * Audit-event repository port.
 *
 * Append-only by contract: there is no `update` and no `delete` on purpose.
 * This is the immutable compliance trail (who / what / why, policy decisions,
 * approvals, tool invocations) and it deliberately does NOT reuse the legacy
 * `ActivityLog` table, which records a much narrower slice of user actions.
 */

export interface AuditEventRepository {
  append(event: AuditEvent): Promise<AuditEvent>;
  /** Newest first (UI/API ordering). */
  list(limit?: number): Promise<AuditEvent[]>;
  /** Oldest first — used to replay a job's transition history. */
  listForJob(jobId: string, limit?: number): Promise<AuditEvent[]>;
}

export type InMemoryAuditEventStore = {
  readonly rows: AuditEvent[];
};

export function createInMemoryAuditEventStore(): InMemoryAuditEventStore {
  return { rows: [] };
}

function clone(event: AuditEvent): AuditEvent {
  return JSON.parse(JSON.stringify(event)) as AuditEvent;
}

/** Bounded so a long-lived process cannot grow without limit. */
export const MAX_IN_MEMORY_EVENTS = 1000;

export class InMemoryAuditEventRepository implements AuditEventRepository {
  constructor(private readonly store: InMemoryAuditEventStore = createInMemoryAuditEventStore()) {}

  async append(event: AuditEvent): Promise<AuditEvent> {
    this.store.rows.push(clone(event));
    if (this.store.rows.length > MAX_IN_MEMORY_EVENTS) {
      this.store.rows.splice(0, this.store.rows.length - MAX_IN_MEMORY_EVENTS);
    }
    return clone(event);
  }

  async list(limit = 100): Promise<AuditEvent[]> {
    return this.store.rows
      .slice(-limit)
      .reverse()
      .map(clone);
  }

  async listForJob(jobId: string, limit = 200): Promise<AuditEvent[]> {
    return this.store.rows
      .filter((event) => event.jobId === jobId)
      .slice(-limit)
      .map(clone);
  }

  count(): number {
    return this.store.rows.length;
  }
}
