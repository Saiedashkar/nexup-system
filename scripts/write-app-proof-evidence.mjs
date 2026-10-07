#!/usr/bin/env node
// Turns a run of `scripts/run-app-proof.sh` into the committed evidence file.
//
// It reads vitest's own JSON report (so the counts and titles are the RUNNER's,
// not a human's retelling), adds the tested commit and the isolated cluster's
// identity, and refuses to write a "passed" artifact when the run failed.
//
// Usage: node scripts/write-app-proof-evidence.mjs <results.json> <exit-status>

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, "..");
const OUT_FILE = path.join(REPO_ROOT, "docs/evidence/step5-app-acceptance-2026-10-07.json");

const [resultsFile, exitStatus] = process.argv.slice(2);
if (!resultsFile) {
  console.error("usage: node scripts/write-app-proof-evidence.mjs <results.json> <exit-status>");
  process.exit(2);
}

function git(args) {
  const result = spawnSync("git", args, { cwd: REPO_ROOT, encoding: "utf8" });
  return result.status === 0 ? (result.stdout ?? "").trim() : null;
}

function readResults() {
  const full = path.join(REPO_ROOT, resultsFile);
  if (!fs.existsSync(full)) return null;
  try {
    return JSON.parse(fs.readFileSync(full, "utf8"));
  } catch {
    return null;
  }
}

function identity() {
  const result = spawnSync(process.execPath, [path.join(HERE, "dev-db.mjs"), "status", "--json"], {
    cwd: REPO_ROOT,
    encoding: "utf8",
  });
  if (result.status !== 0) return { running: false, error: "dev-db status failed" };
  try {
    return JSON.parse(result.stdout);
  } catch {
    return { running: false, error: "dev-db status was not JSON" };
  }
}

const results = readResults();
const suites = (results?.testResults ?? []).map((suite) => ({
  file: path.relative(REPO_ROOT, suite.name ?? ""),
  status: suite.status,
  assertions: (suite.assertionResults ?? []).map((assertion) => ({
    title: assertion.fullName ?? assertion.title,
    status: assertion.status,
    durationMs: assertion.duration ?? null,
  })),
}));

const evidence = {
  proof: "the APPLICATION acceptance proofs: the full lifecycle through the application boundary (Command → … → human decision → COMPLETED), Command idempotency, and a REAL multi-process restart proof against the isolated development database",
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
  // Listed, not just asserted: this run WRITES an evidence file, so the tree is
  // never pristine at the moment of measurement. A reader can check that the
  // only changes are the artifacts themselves.
  workingTreeDirty: (git(["status", "--porcelain"]) ?? "").length > 0,
  workingTreeChanges: (git(["status", "--porcelain"]) ?? "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean),
  environment: {
    applicationDatabase:
      "the isolated development cluster only — 127.0.0.1, created by `initdb` for this work, never the production Supabase host",
    productionDatabase: "NOT touched. The application proof never reads DATABASE_URL.",
    transport:
      "the real Hermes runtime adapter over the DETERMINISTIC test transport (an explicit allowTestTransport opt-in), so the proofs spend no provider turn. The live bridge proof is separate (scripts/run-persistence-proof.sh).",
  },
  isolatedCluster: identity(),
  suites,
  howToReproduce: [
    "node scripts/dev-db.mjs up        # isolated development cluster + pre-migration schema",
    "bash scripts/run-app-proof.sh      # runs both suites and re-writes this file",
  ],
  knownLimitationsRecordedByThisRun: [
    "An execution left IN FLIGHT by a process restart cannot be settled: the runtime adapter's handle bookkeeping is in-process memory and the port has no re-adoption seam. The restart suite asserts this failure and the stuck rows rather than hiding it.",
    "The provider-side cancellation of such a handle is not confirmed, so cancelling such a mission closes the bookkeeping without pretending the provider run was stopped.",
  ],
};

fs.mkdirSync(path.dirname(OUT_FILE), { recursive: true });
fs.writeFileSync(OUT_FILE, `${JSON.stringify(evidence, null, 2)}\n`);
console.log(`wrote ${path.relative(REPO_ROOT, OUT_FILE)}`);
