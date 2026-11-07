import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterAll, describe, expect, it } from "vitest";

import {
  createCleanupInventory,
  decideTamperedLock,
  proofOutcome,
} from "../scripts/dev-db-ownership-proof.mjs";

/**
 * THE NINTH REVIEW'S P2 — a proof runner that aborts must not report `ok`.
 *
 * The reviewer's reproduction: `initdb` failed before any assertion ran; the process exited
 * 1 (correctly, on the uncaught exception) but wrote a 0/0 artifact and printed
 * `ownership-proof-state: ok`. An exit code and an artifact that disagree are worse than
 * either alone, because the artifact is what gets quoted later.
 *
 * The regression is run through the ACTUAL script, with a setup failure injected where it
 * costs nothing: a `PG_BIN` that contains no PostgreSQL tools. No cluster is created, no
 * process is signalled, and the evidence is redirected so a deliberate failure can never
 * overwrite the recorded artifact.
 */

const REPO_ROOT = process.cwd();
const PROOF = path.join(REPO_ROOT, "scripts", "dev-db-ownership-proof.mjs");

const created: string[] = [];
function temporaryDirectory(prefix: string): string {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  created.push(directory);
  return directory;
}

afterAll(() => {
  for (const directory of created) fs.rmSync(directory, { recursive: true, force: true });
});

/**
 * TENTH REVIEW, P3 — THE CLEANER NEVER WRITES A LOCK FILE IT DID NOT CREATE.
 *
 * The reviewer's isolated reproduction: the probe's saved lock was restored over a VALID lock
 * naming a live replacement postmaster of the same directory; the recursion then found the OLD
 * pid gone and returned `stopped: true` while the replacement was still running and the lock
 * named a dead pid again. All three situations are decisions, not side effects, so they are
 * decided here and exercised without a cluster.
 */
describe("tenth review P3 — a lock another process wrote is never overwritten", () => {
  it("a live replacement of the same directory is preserved, not signalled and not overwritten", () => {
    const decision = decideTamperedLock({ recordedPid: 43000, currentPid: 43001, targetAlive: true, identity: "OURS" });
    expect(decision.action).toBe("refuse");
    expect(decision.reason).toContain("did NOT start");
    // The false success the reviewer found: the OLD pid being gone must not be the answer.
    expect(decision.reason).toContain("false success");
  });

  it("a foreign live pid refuses with its own reason", () => {
    const decision = decideTamperedLock({ recordedPid: 43000, currentPid: 43002, targetAlive: true, identity: "UNCERTAIN" });
    expect(decision.action).toBe("refuse");
    expect(decision.reason).toContain("not identifiable");
  });

  it("a gone pid refuses too: no branch of this decision writes the saved lock", () => {
    for (const identity of ["ABSENT", "OURS", "UNCERTAIN"]) {
      const decision = decideTamperedLock({ recordedPid: 43000, currentPid: 0, targetAlive: false, identity });
      expect(decision.action).toBe("refuse");
      expect(decision.reason).toContain("NOT written");
    }
  });

  it("the cleaner contains no write to a lock file at all", () => {
    // A source-level invariant, because the failure mode was a single fs.writeFileSync.
    const source = fs.readFileSync(PROOF, "utf8");
    const cleaner = source.slice(source.indexOf("function stopOwnedCluster("), source.indexOf("function inspectorFor("));
    expect(cleaner.length).toBeGreaterThan(0);
    expect(cleaner).not.toContain("writeFileSync");
  });
});

/**
 * TENTH REVIEW, P3/P4 — THE INVENTORY SHRINKS ONLY ON A VERIFIED STOP.
 *
 * A refusal used to splice the resource out of `started` as soon as `stopOwnedCluster` said
 * `stopped: true` — including the false success above. The rule is now: remove it from the
 * inventory only after the stop is verified, and REPORT what was retained.
 */
describe("tenth review P3/P4 — a refusal retains the resource and is reported", () => {
  it("a failed stop keeps the entry, and a later success retires it", () => {
    let outcome = { stopped: false, why: "a worker of this cluster is still alive" };
    const inventory = createCleanupInventory({ stopCluster: () => outcome });
    inventory.remember({ dir: "/tmp/probe-a", pid: 1, originalLock: null });
    inventory.remember({ dir: "/tmp/probe-b", pid: 2, originalLock: null });

    const refused = inventory.stopStarted("/tmp/probe-a");
    expect(refused.stopped).toBe(false);
    expect(inventory.entries).toHaveLength(2);
    expect(inventory.retained()).toEqual(["/tmp/probe-a", "/tmp/probe-b"]);

    outcome = { stopped: true, why: "pid and workers gone" };
    expect(inventory.stopStarted("/tmp/probe-a").stopped).toBe(true);
    expect(inventory.retained()).toEqual(["/tmp/probe-b"]);
  });

  it("a directory the probe never started is not an entry", () => {
    const inventory = createCleanupInventory({ stopCluster: () => ({ stopped: true, why: "gone" }) });
    expect(inventory.stopStarted("/tmp/not-mine")).toMatchObject({ stopped: true });
    expect(inventory.retained()).toEqual([]);
  });
});

describe("ninth review P2 — an aborted proof is a FAILED proof", () => {
  it("derives state and exit status from the abort, not from the assertion count", () => {
    const verified = {
      aborted: false,
      checksFailed: 0,
      cleanup: { preserved: [] as string[], state: "verified" },
    };
    expect(proofOutcome(verified)).toMatchObject({ state: "ok", exitCode: 0, reasons: [] });

    // The reviewer's case exactly: no assertion failed, cleanup was fine, the run aborted.
    const aborted = { ...verified, aborted: true };
    const outcome = proofOutcome(aborted);
    expect(outcome.state).toBe("failed");
    expect(outcome.exitCode).toBe(1);
    expect(outcome.reasons.join(" ")).toContain("aborted");

    // Each failure mode stands on its own.
    expect(proofOutcome({ ...verified, checksFailed: 1 }).state).toBe("failed");
    expect(
      proofOutcome({ ...verified, cleanup: { preserved: ["/tmp/x (still alive)"], state: "unverified" } }).state,
    ).toBe("failed");
    // A missing summary is a failure, never a pass.
    expect(proofOutcome(undefined).state).toBe("failed");
  });

  it("a real injected setup failure exits nonzero AND writes a failed artifact", () => {
    const emptyPgBin = temporaryDirectory("nexup-proof-no-tools-");
    const outFile = path.join(temporaryDirectory("nexup-proof-out-"), "evidence.json");
    // The recorded artifact must be untouched by this test.
    const recorded = path.join(REPO_ROOT, "docs/evidence/step5a4-eighth-review-ownership-2026-10-19.json");
    const recordedBefore = fs.existsSync(recorded) ? fs.readFileSync(recorded, "utf8") : null;

    const result = spawnSync(process.execPath, [PROOF], {
      cwd: REPO_ROOT,
      encoding: "utf8",
      timeout: 120_000,
      env: { ...process.env, PG_BIN: emptyPgBin, PROOF_OUT: outFile, PROOF_KEEP: "0" },
    });

    expect(result.status, `stdout:\n${result.stdout}\nstderr:\n${result.stderr}`).toBe(1);
    expect(result.stdout).toContain("ownership-proof-state: failed");
    expect(result.stdout).not.toContain("ownership-proof-state: ok");
    // The original error is preserved, not summarised into nothing.
    expect(result.stderr).toContain("initdb");

    expect(fs.existsSync(outFile)).toBe(true);
    const artifact = JSON.parse(fs.readFileSync(outFile, "utf8"));
    expect(artifact.aborted).toBe(true);
    expect(artifact.state).toBe("failed");
    expect(artifact.stateReasons.join(" ")).toContain("aborted");
    expect(artifact.error.message).toContain("initdb");
    expect(artifact.error.name).toBe("Error");
    expect(typeof artifact.error.stack).toBe("string");
    // Zero assertions, and that is REPORTED as zero rather than as success.
    expect(artifact.checks).toBe(0);
    expect(artifact.checksFailed).toBe(0);
    // Cleanup is its own outcome: nothing was created, so nothing needed stopping.
    expect(artifact.cleanup.state).toBe("nothing-started");
    expect(artifact.cleanup.clustersStarted).toBe(0);
    expect(artifact.cleanup.preserved).toEqual([]);

    const recordedAfter = fs.existsSync(recorded) ? fs.readFileSync(recorded, "utf8") : null;
    expect(recordedAfter).toBe(recordedBefore);
  });
});
