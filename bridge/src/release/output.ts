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

/**
 * The mission's scope declaration. It is part of the REPORT, not decoration:
 * both probes print it in text AND carry it in `--json`, so a machine reader is
 * told the same thing a human reader is (DEFAULT/Adel is out of scope; the only
 * profile in scope is `saieed`).
 */
export const SCOPE_BANNER = [
  "DEFAULT / ADEL:",
  "OUT OF SCOPE — DO NOT TOUCH",
  "",
  "TARGET PROFILE:",
  "saieed",
].join("\n");

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
      // The scope banner is part of the report, not decoration: a machine reader
      // must see the same DEFAULT/ADEL out-of-scope warning the operator sees.
      banner: options.banner ? scrub(options.banner) : "",
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
        detail: scrub(result.outcome.status === "pass" ? result.outcome.evidence : result.outcome.reason),
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
    // The marker shows the GATE outcome, not just the check outcome. A failed
    // check blocks at any severity ("do not proceed on a warning"), so it is
    // always FAIL — the `(advisory)` suffix on the title still tells the reader
    // which kind of row it is. A safety-critical skip is as blocking as a
    // failure, so it is labelled NOGO.
    const marker =
      result.outcome.status === "pass"
        ? "PASS"
        : result.outcome.status === "fail"
          ? "FAIL"
          : result.blocking
            ? "NOGO"
            : "skip";
    const gated = result.check.severity === "safety" ? "" : " (advisory)";
    lines.push(`[${marker.padEnd(4)}] ${result.check.id.padEnd(6)} ${scrub(result.check.title)}${gated}`);
    const detail = result.outcome.status === "pass" ? result.outcome.evidence : result.outcome.reason;
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
    // "gating", not "safety-critical": a failed advisory row gates too (§1 P0
    // do-not-proceed-on-a-warning), so the label must cover both kinds of row.
    lines.push(`NO-GO — gating checks did not pass: ${report.counts.blocking.join(", ")}`);
  }
  lines.push(`${report.suite}: ${report.verdict}`);
  return lines.join("\n");
}
