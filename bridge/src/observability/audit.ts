import { identityRedactor, type Redactor } from "../redaction";

/**
 * Append-only audit log.
 *
 * Independent of the operational logs: every request and every run outcome gets
 * an audit line recording WHO (key id), WHAT (action), WHICH run/profile, the
 * OUTCOME and the duration. The sink is injectable; in production it is a JSON
 * line on stdout (captured by journald) so the record is durable and ordered.
 */

export type AuditOutcome = "allowed" | "denied" | "completed" | "failed" | "cancelled";

export type AuditEntry = {
  action: string;
  keyId: string;
  profile: string;
  outcome: AuditOutcome;
  statusCode?: number;
  runId?: string;
  method?: string;
  durationMs?: number;
  remote?: string;
  detail?: string;
};

export type AuditedEntry = AuditEntry & { at: string };

export type AuditSink = (entry: AuditedEntry) => void;

export type AuditLogOptions = {
  sink?: AuditSink;
  redactor?: Redactor;
  now?: () => Date;
};

export const stdoutAuditSink: AuditSink = (entry) => {
  process.stdout.write(`${JSON.stringify(entry)}\n`);
};

export class AuditLog {
  private readonly sink: AuditSink;
  private readonly redactor: Redactor;
  private readonly now: () => Date;

  constructor(options: AuditLogOptions = {}) {
    this.sink = options.sink ?? stdoutAuditSink;
    this.redactor = options.redactor ?? identityRedactor;
    this.now = options.now ?? (() => new Date());
  }

  record(entry: AuditEntry): AuditedEntry {
    const audited: AuditedEntry = {
      ...this.redactor.value(entry),
      at: this.now().toISOString(),
    };
    try {
      this.sink(audited);
    } catch {
      /* an audit sink failure must never break a request */
    }
    return audited;
  }
}

/** An in-memory audit sink for tests and assertions. */
export function createMemoryAuditSink(): { sink: AuditSink; entries: AuditedEntry[] } {
  const entries: AuditedEntry[] = [];
  return {
    entries,
    sink: (entry) => {
      entries.push(entry);
    },
  };
}
