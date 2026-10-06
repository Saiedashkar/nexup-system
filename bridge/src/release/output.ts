/**
 * Shared output for the NEXUP release-engineering probes.
 *
 * Both suites render through THIS module, so the report shape, the verdict
 * token and — most importantly — the never-print-a-secret rule live in exactly
 * one place. Every string that reaches a terminal, a log or a ticket passes
 * through `scrub()` first.
 *
 * The rule is enforced twice, on purpose:
 *
 *   1. **By construction.** No check ever puts an environment value into its
 *      evidence; checks report names, counts, lengths and digests only.
 *   2. **Defence in depth.** The secret values discovered while checking the
 *      env file are registered with the redactor, so even an accidental echo in
 *      a reason string is masked before it can be printed.
 */

/** Values shorter than this are not registered — masking them would hide real output. */
const MIN_SECRET_LENGTH = 8;

export const REDACTED = "[REDACTED]";

export type Redactor = {
  /** Registers a value to be masked everywhere. Ignores short/empty values. */
  add(value: string | undefined | null): void;
  /** Masks every registered value. Idempotent and total. */
  scrub(text: string): string;
  /** How many values are registered (never the values themselves). */
  size(): number;
};

export function createRedactor(initial: readonly (string | undefined | null)[] = []): Redactor {
  const values = new Set<string>();
  const redactor: Redactor = {
    add(value) {
      if (typeof value === "string" && value.length >= MIN_SECRET_LENGTH) values.add(value);
    },
    scrub(text) {
      let out = text;
      for (const secret of values) {
        if (out.includes(secret)) out = out.split(secret).join(REDACTED);
      }
      return out;
    },
    size: () => values.size,
  };
  for (const value of initial) redactor.add(value);
  return redactor;
}

export type ReportFormat = "text" | "json";

export type RenderOptions = {
  format?: ReportFormat;
  redactor: Redactor;
  /** Printed above the results (e.g. the DEFAULT/Adel out-of-scope banner). */
  banner?: string;
};

/**
 * Renders a suite report. The verdict token is always the LAST line, so a log
 * tail or a `grep` for it cannot be fooled by an earlier mention.
 */
export function renderReport(report: import("./runner").SuiteReport, options: RenderOptions): string {
  const scrub = options.redactor.scrub;
  if (options.format === "json") {
    const payload = {
      suite: report.suite,
      title: scrub(report.title),
      host: scrub(report.host),
      verdict: report.verdict,
      exitCode: report.exitCode,
      counts: { pass: report.counts.pass, fail: report.counts.fail, skip: report.counts.skip },
      blocking: report.counts.blocking,
      notes: report.notes.map(scrub),
      checks: report.results.map((result) => ({
        id: result.check.id,
        title: scrub(result.check.title),
        severity: result.check.severity,
        status: result.outcome.status,
        blocking: result.blocking,
        detail:
          result.outcome.status === "pass"
            ? scrub(result.outcome.evidence)
            : result.outcome.status === "fail"
              ? scrub(result.outcome.reason)
              : scrub(result.outcome.reason),
      })),
    };
    return JSON.stringify(payload, null, 2);
  }

  const lines: string[] = [];
  lines.push(`NEXUP BRIDGE — ${scrub(report.title)} (read-only)`);
  lines.push(`host: ${scrub(report.host)}`);
  lines.push("");
  if (options.banner) {
    for (const line of options.banner.split("\n")) lines.push(line);
    lines.push("");
  }

  for (const result of report.results) {
    // The marker shows the GATE outcome, not just the check outcome: a
    // safety-critical skip is as blocking as a failure, so it is labelled NOGO.
    const marker =
      result.outcome.status === "pass"
        ? "PASS"
        : result.outcome.status === "fail"
          ? result.blocking
            ? "FAIL"
            : "warn"
          : result.blocking
            ? "NOGO"
            : "skip";
    const gated = result.check.severity === "safety" ? "" : " (advisory)";
    lines.push(`[${marker.padEnd(4)}] ${result.check.id.padEnd(6)} ${scrub(result.check.title)}${gated}`);
    const detail =
      result.outcome.status === "pass"
        ? result.outcome.evidence
        : result.outcome.status === "fail"
          ? result.outcome.reason
          : result.outcome.reason;
    if (detail) lines.push(`         ${result.outcome.status === "skip" ? "could not run: " : ""}${scrub(detail)}`);
    if (result.outcome.status === "fail" && result.outcome.evidence) {
      lines.push(`         evidence: ${scrub(result.outcome.evidence)}`);
    }
  }

  if (report.notes.length > 0) {
    lines.push("");
    for (const note of report.notes) lines.push(scrub(note));
  }

  lines.push("");
  lines.push(
    `checks: ${report.results.length} total, ${report.counts.pass} pass, ${report.counts.fail} fail, ` +
      `${report.counts.skip} could-not-run · gating failures: ${report.counts.blocking.length}`,
  );
  if (report.counts.blocking.length > 0) {
    lines.push(`NO-GO — safety-critical checks did not pass: ${report.counts.blocking.join(", ")}`);
  }
  lines.push(`${report.suite}: ${report.verdict}`);
  return lines.join("\n");
}
