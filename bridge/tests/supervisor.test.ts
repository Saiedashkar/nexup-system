import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

/**
 * The supervisor is a shell program, so its behaviour is pinned by
 * `supervisor.test.sh`, which drives the real script with a stubbed `docker`
 * (and a stubbed `sleep`) and asserts the decisions it makes.
 *
 * It is run from here so that `npm test` — the one command an operator runs
 * before a release — covers the component that owns recovery. Spawning `bash`
 * is deliberate: the alternative is rewriting the supervisor in TypeScript,
 * which the VPS cannot run (there is no Node on the host, by design).
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const HARNESS = path.resolve(here, "supervisor.test.sh");

describe("supervisor", () => {
  // The harness forks a bash process per assertion, which costs seconds on
  // Windows and milliseconds on Linux. The budget is generous because the
  // assertion is the runtime itself, not a timer.
  it("reconciles idempotently, re-parents on owner change, and never leaks the token", { timeout: 120_000 }, () => {
    const result = spawnSync("bash", [HARNESS], { encoding: "utf8" });
    // A missing `bash` is reported as a failure of the toolchain, not skipped:
    // git-bash on Windows and every Linux host have it.
    expect(result.error).toBeUndefined();
    expect(`${result.stdout}${result.stderr}`).toMatch(/\d+ passed, 0 failed/);
    expect(result.status).toBe(0);
  });
});
