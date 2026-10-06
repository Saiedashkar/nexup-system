/**
 * Shared runner for the NEXUP release-engineering probes.
 *
 * The VPS pre-flight probe and the Hermes compatibility probe are the same kind
 * of thing: a list of read-only checks evaluated against an injectable probe.
 * They therefore share ONE runner so the check model, the fail-closed rule and
 * the exit-code policy live in exactly one place and cannot drift apart.
 *
 * Two rules are enforced here rather than in each suite:
 *
 *   1. **Nothing is asserted, only checked.** A check returns evidence; the
 *      runner decides the verdict.
 *   2. **Fail-closed, and a warning stops the run.** A safety-critical check
 *      that cannot run is NOT a pass — it blocks. An advisory check that merely
 *      cannot run is reported without gating (the runbook assigns those rows to
 *      another venue), but an advisory check that FAILS is a warning and blocks
 *      too: §1 P0 says "Do not proceed on a warning." See `evaluate`.
 */

export type CheckSeverity =
  /** Its failure or inability to run makes the verdict NO-GO. */
  | "safety"
  /** Informational: reported and counted, never blocks. */
  | "advisory";

export type CheckOutcome =
  | { status: "pass"; evidence: string }
  | { status: "fail"; reason: string; evidence?: string }
  /** The check could not run. Not a pass — the runner applies fail-closed. */
  | { status: "skip"; reason: string };

export type Check = {
  /** Runbook anchor where one exists, e.g. `"P1.2"`. */
  id: string;
  title: string;
  severity: CheckSeverity;
  run: (probe: HostProbe) => CheckOutcome;
};

export type CheckResult = {
  check: Check;
  outcome: CheckOutcome;
  /** True when this result makes the suite NO-GO. */
  blocking: boolean;
};

export type Suite = {
  /** Verdict token, also the last line of the report: `PREFLIGHT`, `HERMES-COMPAT`. */
  name: string;
  title: string;
  /** Printed before the results — the safety banner an operator must see. */
  banner?: string;
  checks: readonly Check[];
  /** Extra human-readable lines (e.g. the discovered-methods table). */
  notes?: () => string[];
};

export type SuiteReport = {
  suite: string;
  title: string;
  host: string;
  results: CheckResult[];
  notes: string[];
  verdict: "PASS" | "FAIL";
  /** 0 = PASS, 1 = FAIL (NO-GO). The single exit-code policy for every suite. */
  exitCode: 0 | 1;
  counts: { pass: number; fail: number; skip: number; blocking: string[] };
};

export function evaluate(suite: Suite, probe: HostProbe): SuiteReport {
  const results: CheckResult[] = suite.checks.map((check) => {
    let outcome: CheckOutcome;
    try {
      outcome = check.run(probe);
    } catch (error) {
      // A check that throws is a check that did not run. Never a pass.
      outcome = { status: "skip", reason: `check threw: ${error instanceof Error ? error.message : String(error)}` };
    }
    // THE GATE, taken from the runbook's own words.
    //
    //   1. A check that FAILS is a warning and blocks at ANY severity (§1 P0:
    //      "Every check has a stated pass signal. Do not proceed on a
    //      warning."). Severity says whether a row may be *unavailable* here,
    //      not whether its failure is harmless. Treating an advisory failure as
    //      a cosmetic `warn` let a real misconfiguration leave the run at PASS.
    //   2. A check that CANNOT RUN blocks only when it is safety-critical. The
    //      runbook states fail-closed for SAFETY checks; the advisory rows that
    //      legitimately cannot run on the host (P0.1 build gate, P0.3 toolchain,
    //      P1.7 Vercel) are assigned elsewhere and must not gate the host run.
    const blocking =
      outcome.status === "fail" || (check.severity === "safety" && outcome.status === "skip");
    return { check, outcome, blocking };
  });

  const blocking = results.filter((result) => result.blocking).map((result) => result.check.id);
  const counts = {
    pass: results.filter((result) => result.outcome.status === "pass").length,
    fail: results.filter((result) => result.outcome.status === "fail").length,
    skip: results.filter((result) => result.outcome.status === "skip").length,
    blocking,
  };

  return {
    suite: suite.name,
    title: suite.title,
    host: probe.label(),
    results,
    notes: suite.notes ? suite.notes() : [],
    verdict: blocking.length === 0 ? "PASS" : "FAIL",
    exitCode: blocking.length === 0 ? 0 : 1,
    counts,
  };
}

/* ── the injectable seam ─────────────────────────────────────────────────────
 *
 * Every check reads the host only through this interface. That is what lets the
 * identical check definitions be exercised on a Windows workstation against a
 * recorded fixture, and on the Linux VPS against the real host, with no branch
 * inside the checks themselves.
 */

export type CommandResult = {
  /** false when the command could not be executed at all (missing, not permitted). */
  ran: boolean;
  code: number | null;
  stdout: string;
  stderr: string;
  reason?: string;
};

export type FileRead = { ok: boolean; content: string | null; reason?: string };

export type PathStat = {
  exists: boolean;
  /** POSIX mode as an octal string, e.g. `"600"`. */
  mode?: string;
  owner?: string;
  group?: string;
  size?: number;
  reason?: string;
};

export type SourceHit = { file: string; line: number; text: string };

export type TreeSearch = {
  ran: boolean;
  /** needle → hits. An empty array means "searched for and not found". */
  hits: Record<string, SourceHit[]>;
  scannedFiles: number;
  reason?: string;
};

export type HostProbe = {
  /** Human label for what is being inspected (`live host`, `fixture:<path>`). */
  label(): string;
  /** Runs a read-only command. Never throws; a failure is reported, not raised. */
  run(command: string, args?: readonly string[], options?: { env?: Record<string, string> }): CommandResult;
  read(path: string): FileRead;
  stat(path: string): PathStat;
  /** Bounded recursive text search. `ran: false` means the tree was unreadable. */
  searchTree(root: string, needles: readonly string[]): TreeSearch;
  now(): Date;
};
