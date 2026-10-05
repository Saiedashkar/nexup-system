import { createRedactor, identityRedactor, type Redactor } from "../redaction";

/**
 * Structured JSON logger.
 *
 * One JSON object per line to a sink (stdout → journald by default). It carries
 * only ids, statuses, timings and byte counts — never a token, never a full
 * prompt, never an environment value. The message and every field pass through
 * the redactor before serialization as a second line of defense.
 */

export type LogLevel = "debug" | "info" | "warn" | "error";

export type LogFields = Record<string, unknown>;

export type LogSink = (line: string) => void;

const LEVEL_RANK: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

export type LoggerOptions = {
  sink?: LogSink;
  level?: LogLevel;
  secrets?: readonly string[];
  redactor?: Redactor;
  now?: () => Date;
  base?: LogFields;
};

export const defaultLogSink: LogSink = (line) => {
  process.stdout.write(`${line}\n`);
};

export class Logger {
  private readonly sink: LogSink;
  private readonly threshold: number;
  private readonly redactor: Redactor;
  private readonly now: () => Date;
  private readonly base: LogFields;

  constructor(options: LoggerOptions = {}) {
    this.sink = options.sink ?? defaultLogSink;
    this.threshold = LEVEL_RANK[options.level ?? "info"];
    this.redactor =
      options.redactor ?? (options.secrets ? createRedactor(options.secrets) : identityRedactor);
    this.now = options.now ?? (() => new Date());
    this.base = options.base ?? {};
  }

  /** Returns a logger bound with additional base fields. */
  child(fields: LogFields): Logger {
    const child = new Logger({
      sink: this.sink,
      level: "debug",
      redactor: this.redactor,
      now: this.now,
      base: { ...this.base, ...fields },
    });
    // Preserve the parent's threshold without exposing the private field.
    (child as unknown as { threshold: number }).threshold = this.threshold;
    return child;
  }

  log(level: LogLevel, message: string, fields?: LogFields): void {
    if (LEVEL_RANK[level] < this.threshold) return;
    const record = {
      ts: this.now().toISOString(),
      level,
      msg: this.redactor.text(message),
      ...this.redactor.value({ ...this.base, ...(fields ?? {}) }),
    };
    try {
      this.sink(JSON.stringify(record));
    } catch {
      /* a logging failure must never break a request */
    }
  }

  debug(message: string, fields?: LogFields): void {
    this.log("debug", message, fields);
  }
  info(message: string, fields?: LogFields): void {
    this.log("info", message, fields);
  }
  warn(message: string, fields?: LogFields): void {
    this.log("warn", message, fields);
  }
  error(message: string, fields?: LogFields): void {
    this.log("error", message, fields);
  }
}
