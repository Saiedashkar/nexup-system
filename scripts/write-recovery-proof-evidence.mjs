#!/usr/bin/env node
// Turns a run of `scripts/run-recovery-proof.sh` into the committed evidence file.
//
// It reads vitest's OWN JSON report, so the counts and titles are the runner's,
// not a human's retelling, and it records the two things a reviewer cannot
// reconstruct later:
//
//   * the exact SOURCE this evidence describes — a SHA-256 per implementation,
//     test and document file touched by this correction, each marked tracked or
//     untracked so an uncommitted file cannot hide in the list;
//   * the isolated cluster the proof ran against.
//
// It refuses to describe a failed run as a passed one: `exitStatus` and
// `runnerSaidSuccess` are copied verbatim, so a failure is recorded as a failure.
//
// Usage: node scripts/write-recovery-proof-evidence.mjs <results.json> <exit-status>

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { buildManifest } from "./evidence-manifest.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, "..");
const OUT_FILE = path.join(REPO_ROOT, "docs/evidence/step5a4-recovery-round5-2026-10-13.json");

/**
 * The implementation, tests, migrations and scripts this correction consists of —
 * hashed into the canonical MANIFEST below (sorted paths + content hashes + a digest
 * over the canonical form), so it is independently re-derivable with
 * `node scripts/verify-evidence-manifest.mjs <this file>`.
 */
const FINGERPRINTED = [
  "prisma/schema.prisma",
  "prisma/proposed-migrations/AI_WORKFORCE_PHASE_5/migration.sql",
  "src/modules/workforce/execution/execution-claim.ts",
  "src/modules/workforce/execution/execution-claim-receipt.ts",
  "src/modules/workforce/execution/execution-record.ts",
  "src/modules/workforce/execution/execution-reconciler.ts",
  "src/modules/workforce/execution/capability-execution-service.ts",
  "src/modules/workforce/persistence/prisma-execution-claim-repository.ts",
  "src/modules/workforce/persistence/prisma-lifecycle-repositories.ts",
  "src/modules/workforce/index.ts",
  "tests/workforce-step5a4-correction-p1.test.ts",
  "tests/workforce-step5a4-recovery-evidence.test.ts",
  "scripts/run-persistence-proof.sh",
  "scripts/run-recovery-proof.sh",
  "scripts/run-api-http-proof.sh",
  "scripts/run-http-proof-safety.sh",
  "scripts/dev-db.mjs",
  "scripts/dev-db-ownership.mjs",
  "scripts/process-lineage.mjs",
  "scripts/evidence-manifest.mjs",
  "scripts/verify-evidence-manifest.mjs",
  "scripts/write-recovery-proof-evidence.mjs",
];

const [resultsFile, exitStatus] = process.argv.slice(2);
if (!resultsFile) {
  console.error("usage: node scripts/write-recovery-proof-evidence.mjs <results.json> <exit-status>");
  process.exit(2);
}

function git(args) {
  const result = spawnSync("git", args, { cwd: REPO_ROOT, encoding: "utf8" });
  return result.status === 0 ? (result.stdout ?? "").trim() : null;
}

function readResults() {
  // The runner passes an ABSOLUTE path now (the report is per-run, inside the
  // run's own directory), so an absolute path must not be re-rooted here.
  const full = path.isAbsolute(resultsFile) ? resultsFile : path.join(REPO_ROOT, resultsFile);
  if (!fs.existsSync(full)) return null;
  try {
    return JSON.parse(fs.readFileSync(full, "utf8"));
  } catch {
    return null;
  }
}

/**
 * The canonical manifest (`nexup-evidence-manifest/1`): sorted paths, a content hash
 * and a size per file, whether git tracks each one, and a digest over the canonical
 * form — see `scripts/evidence-manifest.mjs` for the format, which is documented
 * there and re-derivable without it.
 */
function manifest() {
  return buildManifest(FINGERPRINTED, { repoRoot: REPO_ROOT });
}

/**
 * The skip GATE, spelled once so the count is never reported without its reason.
 */
const SKIP_GATE =
  "a skip in these suites is a REAL-POSTGRESQL section: the in-memory suites keep those tests inside a " +
  "`describeIfDatabase` block, which is `describe.skip` until AI_WORKFORCE_TEST_DATABASE_URL names a database. " +
  "They are not disabled — they are RUN by `scripts/run-recovery-proof.sh` (and by any run with that variable " +
  "set) against a disposable cluster. The durable file this runner measures, " +
  "`tests/workforce-step5a4-recovery-evidence.test.ts`, is itself entirely inside such a block and reports ZERO " +
  "skips when it runs, so `skipped: 0` there is the absence of a gate rather than the absence of tests.";

/** Every skipped test, with the file it lives in. */
function skippedTests(suites) {
  return suites.flatMap((suite) =>
    (suite.assertions ?? []).filter((assertion) => assertion.status === "skipped").map((assertion) => `${suite.file} :: ${assertion.title}`),
  );
}

/**
 * `git status --porcelain` EXACTLY as git emitted it — the two status columns included.
 *
 * Deliberately NOT through `git()` above: that helper `.trim()`s the whole output, which
 * strips the leading space off the FIRST line, and the first column is DATA here (`" M"` =
 * modified in the worktree, `"M "` = staged). Reading the list after that trim made one
 * ordinary modification look like a staged one — an unverifiable number of exactly the kind
 * the sixth review had to correct. Each entry is kept as `<XY> <path>`, so a reader can see
 * which column carried what instead of taking a count on trust.
 */
function porcelainEntries() {
  const result = spawnSync("git", ["status", "--porcelain"], { cwd: REPO_ROOT, encoding: "utf8" });
  if (result.status !== 0) return [];
  return (result.stdout ?? "")
    .split(/\r?\n/)
    .filter((line) => line.length > 0)
    // Trailing whitespace only: the LEADING status columns are the point.
    .map((line) => line.replace(/[ \t]+$/, ""));
}

/**
 * The working tree, COUNTED from `git status --porcelain` rather than by hand.
 *
 * A handoff that says "45 modified / 22 untracked" when the tree holds 41 and 23 is a
 * reporting error the sixth review had to catch; deriving the numbers from porcelain — with
 * the status columns intact — removes the opportunity.
 */
function workingTreeCounts() {
  const lines = porcelainEntries();
  const counts = { total: lines.length, tracked: 0, modified: 0, untracked: 0, staged: 0, deleted: 0, renamed: 0, other: 0 };
  for (const line of lines) {
    const x = line[0];
    const y = line[1];
    if (x === "?" && y === "?") {
      counts.untracked += 1;
      continue;
    }
    counts.tracked += 1;
    if (x !== " " && x !== "?") counts.staged += 1;
    if (y === "M" || x === "M") counts.modified += 1;
    else if (y === "D" || x === "D") counts.deleted += 1;
    else if (y === "R" || x === "R") counts.renamed += 1;
    else counts.other += 1;
  }
  return counts;
}

const results = readResults();
const suites = (results?.testResults ?? []).map((suite) => ({
  file: path.relative(REPO_ROOT, suite.name ?? "").split(path.sep).join("/"),
  status: suite.status,
  assertions: (suite.assertionResults ?? []).map((assertion) => ({
    title: assertion.fullName ?? assertion.title,
    status: assertion.status,
    durationMs: assertion.duration ?? null,
  })),
}));

const evidence = {
  proof:
    "the Step 5A-4 third- through SIXTH-review RECOVERY proofs, against a disposable PostgreSQL cluster: a partial multi-task cancellation that rolls its reservations back (and races a concurrent execute()), recovery through the application entry points, the finalizer-versus-markUnverified claim CAS, more than 50 unresolved claims with mission-scoped recovery beyond the first global page, the fourth review's starvation scenario (700 permanent unresolved claims, the target at row 625, 60 new claims before each sweep, reached within a bound of ceil(625/25)+1 = 26 sweeps through the UNSEEN window, both globally and inside ONE mission), the fifth review's DURABLE-PROGRESS corrections (a three-sweep stale-write interleaving that cannot clear, rewind or lose progress; 70 mission scopes continued by a SECOND process; and a record page that filters non-terminal attempts in the QUERY before LIMIT so 50 newer finished attempts cannot hide an older open one), and the SIXTH review's REPEATED-RECOVERY correction: the sweep's budget is split into THREE DISJOINT windows, so an ALREADY-OBSERVED row is revisited under 60 arrivals per sweep for claims and 55 per sweep for records (the review reproduced that as starvation), a live DISPATCHING claim observed before its owner's crash reaches UNVERIFIED, an observed record that is still open gains a RECONCILED audit event, and global and mission-scoped traffic cannot starve each other's observed rows",
  generatedAt: new Date().toISOString(),
  exitStatus: exitStatus ?? null,
  runnerSaidSuccess: results?.success ?? null,
  counts: {
    testFiles: results?.numTotalTestSuites ?? null,
    tests: results?.numTotalTests ?? null,
    passed: results?.numPassedTests ?? null,
    failed: results?.numFailedTests ?? null,
    skipped: results?.numPendingTests ?? null,
  },
  testedCommit: git(["rev-parse", "HEAD"]),
  // Listed, not merely asserted: this run WRITES an evidence file, so the tree is
  // never pristine at the moment of measurement. The COUNTS are derived from the same
  // porcelain output rather than counted by hand, because a hand-count in a handoff is
  // exactly the kind of number the sixth review had to correct ("45 modified / 22
  // untracked" against an actual 41 / 23).
  workingTreeDirty: porcelainEntries().length > 0,
  workingTreeCounts: workingTreeCounts(),
  // `<XY> <path>`, status columns intact — the same evidence the counts are derived from,
  // so the two can be checked against each other instead of trusted separately.
  workingTreeChanges: porcelainEntries(),
  manifest: manifest(),
  environment: {
    database:
      "a DISPOSABLE PostgreSQL cluster created by `initdb` for this single run, on an auto-allocated loopback port with a unique data directory; the proof creates and drops its own database inside it",
    productionDatabase: "NOT touched. No proof here reads DATABASE_URL.",
    runtime:
      "the real Hermes runtime adapter over the DETERMINISTIC test transport (explicit allowTestTransport), so the proofs spend no provider turn",
    synchronization:
      "no sleeps: races are produced with Promise.all over operations that contend on a unique index, a single-statement CAS or a transaction, and asserted as invariants",
  },
  howToReproduce: ["bash scripts/run-recovery-proof.sh"],
  // Every skip in the suites this run measured, with the gate that produced it: a
  // count without the reason is the kind of number a handoff gets wrong.
  skips: { count: results?.numPendingTests ?? null, tests: skippedTests(suites), gate: SKIP_GATE },
  knownLimitationsRecordedByThisRun: [
    "FAIRNESS BOUNDS, WITH THEIR ASSUMPTIONS — including the one the sixth review found MISSING. A sweep spends a 50-row budget as THREE DISJOINT WINDOWS: 25 never-observed rows oldest first, 20 previously-observed rows least-recently-observed first, 5 never-observed rows newest first. So (a) an unresolved row that NO sweep has observed is reached within ceil(unseen / 25) sweeps of the scope, because that window is FIFO and arrivals queue behind the rows already in it; and (b) an unresolved row that HAS been observed — the case the review proved unbounded, a live `DISPATCHING` claim whose owner then crashed — is reached within ceil(observed / 20) sweeps, because arrivals are never-observed rows BY DEFINITION and cannot enter that window at all. Both bounds assume only that sweeps REPEAT and that the DATABASE clock advances between them (true in PostgreSQL, where each sweep is its own transaction). Neither assumes an arrival rate: sustained traffic lengthens the unseen and observed sets and each bound grows with the set it drains, which is queueing — what it can no longer do is push a row that is already waiting behind an UNBOUNDED number of newer rows. The earlier statement that overload means `latency, never invisibility` was FALSE for previously-observed rows and is WITHDRAWN.",
    "THE DURABLE ROTATION NEEDS ONE COLUMN THAT IS NOT APPLIED TO ANY SHARED DATABASE. `recoverySweptAt` (nullable, no default, one index each) is proposed in `prisma/proposed-migrations/AI_WORKFORCE_PHASE_5/` on `ai_execution_claims` and `ai_execution_records`, and it is NOT applied to the dev, staging or production database by this work, nor registered in `prisma/migrations/`. The literal claim that it was `not applied to any database` was inaccurate and is corrected: the DISPOSABLE proof clusters create it deliberately (this file's own test suite lists PHASE_5 in MIGRATIONS and applies it with `psql -f`), because a sweep cannot be proved against a schema its own columns are missing from. Every existing column was rejected for the role: `updatedAt` is the row's real ACTIVITY (it is what the command centre's Recent Activity feed orders by), so a sweep that wrote it would make an observation indistinguishable from an execution that happened.",
    "ACTIVATION REQUIREMENTS, preserved because this run does NOT establish them: PHASE_5 must be REGISTERED AND APPROVED through the project's real migration workflow and APPLIED BEFORE this code is deployed (the adapters read and write `recoverySweptAt`; a deployment that carries the code without the column cannot run the rotation at all); Prisma Client must be generated during that deploy build; the two indexes are SINGLE COLUMN and are NOT claimed to be optimal for a page that also orders by `claimedAt`/`id` and filters on state/status and `missionId`, so realistic `EXPLAIN (ANALYZE, BUFFERS)` evidence and a decision about non-concurrent index creation are owed at activation; and recovery should be SCHEDULED and MONITORED only after that, never assumed from a green test run.",
    "THE RECORDS ROTATION PAGES WHAT IS ELIGIBLE WHEN IT READS. `listRecoverable` filters non-terminal statuses in the QUERY, before LIMIT; an attempt that becomes terminal between that read and its adoption is reported as ALREADY_TERMINAL (news, and never thrown), and it is stamped, so it does not head the queue again.",
    "THE ROTATION KEY IS A ROTATION KEY, NOT A CURSOR. It records THAT a sweep observed a row, from the database clock; it is deliberately not a generation or a scope position, so two instances sweeping the same scope may duplicate work on the same page — idempotent, and the same trade a single-statement CAS makes everywhere else in this ledger.",
    "The engineering-plane boundary checks are STATIC regression tripwires (imports, names, manifest): a specifier assembled at runtime is outside what they can see. The ADR records this limit.",
    "HERMES: the OFFLINE artifact that exists in this worktree is the NEXUP bridge's pinned-profile and method allowlist (`bridge/src/hermes/allowlist.ts`, `bridge/src/hermes/profile-policy.ts`, `bridge/src/config.ts`), inspected READ-ONLY for this evidence. The profile is PINNED to `saieed` (a caller-supplied profile is rejected), and the seven JSON-RPC methods NEXUP can emit are `gateway.ping` plus the six session methods; `llm.oneshot` is deliberately excluded. NO FreeBuff/engineering invocation method appears in that allowlist, so no NEXUP business path reaches FreeBuff through the bridge. Live Hermes was NOT contacted and no profile was modified.",
    "HERMES, the residual gap: an export of the LIVE daemon profile's OWN tool list (rather than the bridge's outbound allowlist) does not exist in this worktree. Runtime-WIDE FreeBuff protection inside the Hermes profile is therefore NOT proven here — only that NEXUP's pinned, allowlisted method surface contains no FreeBuff path. That remains an operator-side check against the running daemon.",
  ],
  suites,
};

fs.mkdirSync(path.dirname(OUT_FILE), { recursive: true });
fs.writeFileSync(OUT_FILE, `${JSON.stringify(evidence, null, 2)}\n`);
console.log(`wrote ${path.relative(REPO_ROOT, OUT_FILE)}`);
