import type { Check, CheckOutcome, HostProbe, Suite, TreeSearch } from "./runner";

/**
 * Hermes method-compatibility probe (read-only).
 *
 * The largest remaining uncertainty in the deployment is whether the installed
 * Hermes build actually exposes the JSON-RPC methods the bridge emits. This
 * suite answers that by SEARCHING SOURCE and runtime metadata only: it opens no
 * socket, starts no session, submits no prompt and never mutates Hermes.
 *
 * Method classification follows the runbook's P2:
 *
 *   - the four lifecycle methods the bridge emits must exist, or the first real
 *     run fails and the cancel path is dead → NO-GO;
 *   - `gateway.ping` is different in kind: the transport already maps
 *     method-not-found to `degraded`, so its absence is reported DISTINCTLY as a
 *     degraded readiness signal and stays NO-GO unless explicitly accepted;
 *   - names that are allowlisted but emitted by no operation cannot break this
 *     deployment, so they are informational.
 */

export const HERMES_COMPAT = "HERMES-COMPAT";

/** Emitted by the bridge's operations; absence is fatal. */
export const CRITICAL_METHODS = ["session.create", "prompt.submit", "session.status", "session.interrupt"] as const;

/** The liveness probe. Absent → degraded readiness, reported separately. */
export const LIVENESS_METHOD = "gateway.ping";

/** Allowlisted but emitted by no operation — absence cannot break this deployment. */
export const INFORMATIONAL_METHODS = ["session.history", "session.events.since"] as const;

const ALL_NEEDLES = [...CRITICAL_METHODS, LIVENESS_METHOD, ...INFORMATIONAL_METHODS, "session.", "gateway."];

export type CompatOptions = {
  /** Root of the installed Hermes source/build to search. */
  hermesSrc?: string;
  /** Records an explicit acceptance of a degraded `gateway.ping`. */
  acceptedDegraded?: boolean;
};

export type MethodRow = {
  method: string;
  expected: boolean;
  found: boolean;
  verdict: "OK" | "MISSING" | "DEGRADED" | "ACCEPTED-DEGRADED" | "UNVERIFIED";
  evidence: string;
};

export type CompatAnalysis = {
  search: TreeSearch;
  rows: MethodRow[];
  discovered: string[];
};

/** Runs the single bounded tree search that every check below reads. */
export function analyze(probe: HostProbe, options: CompatOptions): CompatAnalysis {
  const src = options.hermesSrc;
  const search: TreeSearch = src
    ? probe.searchTree(src, ALL_NEEDLES)
    : { ran: false, hits: {}, scannedFiles: 0, reason: "no Hermes source directory supplied (--hermes-src)" };

  const evidenceFor = (method: string): string => {
    const hit = search.hits[method]?.[0];
    return hit ? `${hit.file}:${hit.line} ${hit.text}` : "";
  };

  const rows: MethodRow[] = [];
  for (const method of [...CRITICAL_METHODS, ...INFORMATIONAL_METHODS]) {
    const found = (search.hits[method]?.length ?? 0) > 0;
    rows.push({
      method,
      expected: true,
      found,
      verdict: !search.ran ? "UNVERIFIED" : found ? "OK" : "MISSING",
      evidence: found ? evidenceFor(method) : search.ran ? `searched ${search.scannedFiles} files; not found` : "",
    });
  }

  const livenessFound = (search.hits[LIVENESS_METHOD]?.length ?? 0) > 0;
  rows.push({
    method: LIVENESS_METHOD,
    expected: true,
    found: livenessFound,
    verdict: !search.ran
      ? "UNVERIFIED"
      : livenessFound
        ? "OK"
        : options.acceptedDegraded
          ? "ACCEPTED-DEGRADED"
          : "DEGRADED",
    evidence: livenessFound
      ? evidenceFor(LIVENESS_METHOD)
      : search.ran
        ? `searched ${search.scannedFiles} files; not found — readiness would report degraded`
        : "",
  });

  // Anything else method-shaped that the search surfaced, for operator awareness.
  const discovered = new Set<string>();
  for (const needle of ["session.", "gateway."]) {
    for (const hit of search.hits[needle] ?? []) {
      for (const token of hit.text.match(/\b(?:session|gateway)\.[a-z][a-z0-9.]*/gi) ?? []) {
        discovered.add(token.toLowerCase());
      }
    }
  }
  for (const known of [...CRITICAL_METHODS, LIVENESS_METHOD, ...INFORMATIONAL_METHODS]) discovered.delete(known);

  return { search, rows, discovered: [...discovered].sort() };
}

export function compatChecks(probe: HostProbe, options: CompatOptions): Check[] {
  const analysis = analyze(probe, options);

  const notRunnable = (): CheckOutcome | null =>
    analysis.search.ran
      ? null
      : { status: "skip", reason: analysis.search.reason ?? "Hermes source could not be searched" };

  const methodCheck = (method: string, id: string, title: string): Check => ({
    id,
    title,
    severity: "safety",
    run: () => {
      const blocked = notRunnable();
      if (blocked) return blocked;
      const row = analysis.rows.find((candidate) => candidate.method === method);
      if (row?.found) return { status: "pass", evidence: row.evidence };
      // A missing lifecycle method means the first real run fails.
      return {
        status: "fail",
        reason: `"${method}" is absent from the installed Hermes source; the ${method.split(".")[0]} path would fail at runtime`,
        evidence: row?.evidence || undefined,
      };
    },
  });

  const checks: Check[] = [
    methodCheck(CRITICAL_METHODS[0], "P2.1", `Hermes exposes ${CRITICAL_METHODS[0]} (session lifecycle)`),
    methodCheck(CRITICAL_METHODS[1], "P2.2", `Hermes exposes ${CRITICAL_METHODS[1]} (turn submission)`),
    methodCheck(CRITICAL_METHODS[2], "P2.3", `Hermes exposes ${CRITICAL_METHODS[2]} (status)`),
    methodCheck(CRITICAL_METHODS[3], "P2.4", `Hermes exposes ${CRITICAL_METHODS[3]} (cancellation)`),
    {
      id: "P2.5",
      title: `Hermes exposes ${LIVENESS_METHOD} (liveness) — degraded readiness if absent`,
      severity: "safety",
      run: () => {
        const blocked = notRunnable();
        if (blocked) return blocked;
        const row = analysis.rows.find((candidate) => candidate.method === LIVENESS_METHOD);
        if (row?.found) return { status: "pass", evidence: row.evidence };
        if (options.acceptedDegraded) {
          return {
            status: "pass",
            evidence:
              "absent, and its absence is EXPLICITLY ACCEPTED — the bridge will report hermes:\"degraded\" (HTTP 200). " +
              "Abort criterion §6.5 requires this acceptance to be recorded in the change record.",
          };
        }
        return {
          status: "fail",
          reason:
            `${LIVENESS_METHOD} is absent, so /v1/health reports HTTP 200 with hermes:"degraded" while liveness is ` +
            `unproven. This is NO-GO unless explicitly accepted with --accept-degraded (runbook §6.5)`,
          evidence: row?.evidence || undefined,
        };
      },
    },
    {
      id: "P2.6",
      title: `Allowlisted-but-unemitted methods (${INFORMATIONAL_METHODS.join(", ")}) are informational only`,
      severity: "advisory",
      run: () => {
        const blocked = notRunnable();
        if (blocked) return blocked;
        const present = INFORMATIONAL_METHODS.filter((method) => (analysis.search.hits[method]?.length ?? 0) > 0);
        return {
          status: "pass",
          evidence:
            `${present.length}/${INFORMATIONAL_METHODS.length} present (${present.join(", ") || "none"}). No operation emits these, ` +
            `so their absence cannot break this deployment`,
        };
      },
    },
  ];

  return checks;
}

export function methodMatrix(probe: HostProbe, options: CompatOptions): string[] {
  const analysis = analyze(probe, options);
  const header = ["METHOD".padEnd(22), "EXPECTED".padEnd(9), "FOUND".padEnd(6), "VERDICT".padEnd(18), "EVIDENCE"].join("");
  const lines = [header, "-".repeat(header.length)];
  for (const row of analysis.rows) {
    lines.push(
      [
        row.method.padEnd(22),
        (row.expected ? "yes" : "no").padEnd(9),
        (row.found ? "yes" : "no").padEnd(6),
        row.verdict.padEnd(18),
        row.evidence,
      ].join(""),
    );
  }
  lines.push("");
  lines.push(
    `scanned: ${analysis.search.scannedFiles} file(s) under ${options.hermesSrc ?? "<no --hermes-src>"}` +
      (analysis.search.ran ? "" : ` — NOT SEARCHABLE (${analysis.search.reason})`),
  );
  if (analysis.discovered.length > 0) {
    lines.push(`other method-shaped names discovered: ${analysis.discovered.join(", ")}`);
  }
  const liveness = analysis.rows.find((row) => row.method === LIVENESS_METHOD);
  if (liveness && !liveness.found && liveness.verdict !== "UNVERIFIED") {
    lines.push(`note: ${LIVENESS_METHOD} absent → readiness would be reported as DEGRADED (HTTP 200), not unavailable.`);
  }
  return lines;
}

export function createHermesCompatSuite(probe: HostProbe, options: CompatOptions): Suite {
  return {
    name: HERMES_COMPAT,
    title: "HERMES METHOD COMPATIBILITY PROBE",
    checks: compatChecks(probe, options),
    notes: () => methodMatrix(probe, options),
  };
}
