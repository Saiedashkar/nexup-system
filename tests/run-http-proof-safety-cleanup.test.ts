import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

/**
 * THE EIGHTH REVIEW'S SIXTH FINDING — the safety runner's cleanup contract.
 *
 * `scripts/run-http-proof-safety.sh` starts disposable clusters, so its cleanup is the one
 * place in the evidence chain that can DELETE resources whose shutdown it could not verify.
 * The finding was exact: a failed `pg_ctl stop` was ignored and the scratch directory was
 * removed anyway, so the run could report a clean exit over a postmaster it had not stopped.
 *
 * This file cannot start a cluster (that is what the runner itself is for), so it pins the
 * CONTRACT the runner's cleanup is written to: an independent check of each cluster's pid,
 * a preservation branch that runs BEFORE any deletion and turns the exit status non-zero,
 * and a deletion guarded by proof that this run created the directory. Removing any of
 * those three is a regression this test fails on.
 *
 * The runner's end-to-end evidence is not re-derived here; see the correction record for
 * what was and was not re-executed.
 */

const REPO_ROOT = path.resolve(__dirname, "..");
const SOURCE = fs.readFileSync(path.join(REPO_ROOT, "scripts/run-http-proof-safety.sh"), "utf8");

/** The text of `cleanup() { … }`, from its definition to the trap that installs it. */
function cleanupBody(): string {
  const start = SOURCE.indexOf("\ncleanup() {");
  expect(start, "the runner no longer defines cleanup()").toBeGreaterThan(-1);
  const end = SOURCE.indexOf("\ntrap cleanup ", start);
  expect(end, "cleanup() is no longer installed with `trap cleanup`").toBeGreaterThan(start);
  return SOURCE.slice(start, end);
}

describe("safety-runner cleanup — verified shutdown before deletion", () => {
  it("judges every stopped cluster independently, and never by pg_ctl's exit code alone", () => {
    const body = cleanupBody();
    // The stop is best-effort: its exit code is NOT the evidence.
    expect(body).toContain('stop -m fast -w -t 30 >/dev/null 2>&1 || true');
    // The evidence is the pid on line 1 of the cluster's own lock file.
    expect(body).toContain('if ! cluster_stopped "$cluster_dir"; then');
    expect(body).toContain('unverified="$unverified $cluster_dir"');
  });

  it("preserves the resources and fails the run when a shutdown cannot be verified", () => {
    const body = cleanupBody();
    const preserve = body.indexOf("cleanup: PRESERVING");
    const remove = body.indexOf('rm -rf "$SCRATCH"');
    expect(preserve, "the enforcement branch no longer announces preservation").toBeGreaterThan(-1);
    expect(remove, "the scratch directory is no longer removed anywhere").toBeGreaterThan(-1);
    // Order is the whole safety property: nothing may be deleted before the refusal returns.
    expect(preserve).toBeLessThan(remove);
    expect(body).toContain('if [ "$status" = "0" ]; then status=1; fi');
    // The preservation branch leaves the function; it does not fall through to the delete.
    const branch = body.slice(preserve, remove);
    expect(branch).toContain("exit");
  });

  it("only deletes a directory this run can prove it created", () => {
    const body = cleanupBody();
    expect(body).toContain("elif owned_scratch; then");
    expect(body).toContain("this check did not create it");
  });

  it("never strips the lock file of a cluster it could not stop", () => {
    const body = cleanupBody();
    expect(body).not.toMatch(/rm\s+-f\s+.*postmaster\.pid/);
    expect(body).not.toMatch(/rm\s+-rf\s+"\$cluster_dir"/);
  });
});
