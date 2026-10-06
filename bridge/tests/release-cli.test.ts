import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterAll, describe, expect, it } from "vitest";

import { runReleaseCli, type CliIo } from "../src/release/cli";
import { PREFLIGHT_BANNER, TARGET_PROFILE, createPreflightSuite, ENV_FILE } from "../src/release/preflight";
import { createRecordedProbe, type RecordedFixture } from "../src/release/probe";

/**
 * The reusable core is covered by `release-runner.test.ts`. THESE tests drive the
 * CLI entry point itself (`runReleaseCli`), because the guarantees an operator
 * relies on are properties of the command line: the verdict token it prints, the
 * exit code it returns, the scope banner, and the fail-closed rule end to end.
 *
 * Everything below runs against RECORDED fixtures — no host, no Hermes, no
 * network, and nothing is started, stopped or written.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES = path.resolve(here, "../fixtures/release");

const PASS = path.join(FIXTURES, "host-pass.json");
const FAIL_SAFETY = path.join(FIXTURES, "host-fail-safety.json");
const DEGRADED = path.join(FIXTURES, "hermes-degraded.json");
const MISSING_INTERRUPT = path.join(FIXTURES, "hermes-missing-interrupt.json");

const HMAC_SENTINEL = "SENTINEL_hmac_secret_value_that_must_never_be_printed_0123456789abcdef";
const TOKEN_SENTINEL = "SENTINEL_session_token_that_must_never_be_printed_abcdef";
const PASS_DIGEST = "a1b2c3d4a1b2c3d4a1b2c3d4a1b2c3d4a1b2c3d4a1b2c3d4a1b2c3d4a1b2c3d4";

const OUT_OF_SCOPE = "OUT OF SCOPE — DO NOT TOUCH";

type Run = { code: number; out: string; err: string };

function run(argv: readonly string[]): Run {
  const out: string[] = [];
  const err: string[] = [];
  const io: CliIo = { out: (text) => out.push(text), err: (text) => err.push(text) };
  const code = runReleaseCli(argv, io);
  return { code, out: out.join("\n"), err: err.join("\n") };
}

/** The healthy recorded host, fully exercised (P0.6 opt-in included). */
const passPreflight = [
  "preflight",
  "--fixture",
  PASS,
  "--hermes-src",
  "/opt/hermes",
  "--expected-digest",
  PASS_DIGEST,
  "--exec-probes",
];

/** The forced-failing recorded host — safety failures plus failed advisory rows. */
const failPreflight = [
  "preflight",
  "--fixture",
  FAIL_SAFETY,
  "--hermes-src",
  "/opt/hermes",
  "--expected-digest",
  PASS_DIGEST,
];

const lastLine = (text: string): string => text.trimEnd().split("\n").pop() ?? "";

const nogoLine = (text: string): string =>
  text.split("\n").find((line) => line.startsWith("NO-GO")) ?? "";

describe("release CLI — preflight through the entry point", () => {
  it("exits 0 and ends with `PREFLIGHT: PASS` on a healthy recorded host", () => {
    const { code, out } = run(passPreflight);
    expect(code).toBe(0);
    expect(out).toContain("gating failures: 0");
    // The verdict token is the LAST line, so `tail -1` cannot be fooled.
    expect(lastLine(out)).toBe("PREFLIGHT: PASS");
  });

  it("carries the DEFAULT/ADEL out-of-scope banner in text and in --json", () => {
    const text = run(passPreflight);
    expect(text.out).toContain("DEFAULT / ADEL:");
    expect(text.out).toContain(OUT_OF_SCOPE);

    const json = run([...passPreflight, "--json"]);
    expect(json.code).toBe(0);
    const payload = JSON.parse(json.out) as { banner: string; verdict: string; exitCode: number };
    expect(payload.banner).toContain(OUT_OF_SCOPE);
    expect(payload.banner).toContain(TARGET_PROFILE);
    expect(payload.verdict).toBe("PASS");
    expect(payload.exitCode).toBe(0);
  });

  it("never prints a secret value, in text or in --json", () => {
    // The fixture really does contain the secrets, so this is not vacuous...
    const fixture = readFileSync(PASS, "utf8");
    expect(fixture).toContain(HMAC_SENTINEL);
    expect(fixture).toContain(TOKEN_SENTINEL);

    // ...and the values really are handed to the redactor, so the property below
    // is about redaction, not about the values never being read.
    const probe = createRecordedProbe(JSON.parse(fixture) as RecordedFixture, PASS);
    expect(createPreflightSuite(probe, { envFile: ENV_FILE }).secrets).toEqual([HMAC_SENTINEL, TOKEN_SENTINEL]);

    for (const argv of [passPreflight, [...passPreflight, "--json"]]) {
      const { out, err } = run(argv);
      for (const secret of [HMAC_SENTINEL, TOKEN_SENTINEL]) {
        expect(out.split(secret).length - 1).toBe(0);
        expect(err.split(secret).length - 1).toBe(0);
      }
    }
  });

  it("fails closed when a safety check cannot run (P0.6 without --exec-probes)", () => {
    const withoutExec = passPreflight.filter((arg) => arg !== "--exec-probes");
    const { code, out } = run(withoutExec);
    expect(code).toBe(1);
    expect(out).toContain("[NOGO] P0.6");
    expect(out).toContain("could not run:");
    expect(out).toContain("NO-GO — gating checks did not pass");
    expect(out).toContain("P0.6");
    expect(lastLine(out)).toBe("PREFLIGHT: FAIL");
  });

  it("exits 1 with `PREFLIGHT: FAIL` on a host with forced safety failures", () => {
    const { code, out } = run(failPreflight);
    expect(code).toBe(1);
    expect(lastLine(out)).toBe("PREFLIGHT: FAIL");

    const nogo = out.split("\n").find((line) => line.startsWith("NO-GO"));
    expect(nogo).toBeDefined();
    for (const id of ["P0.4a", "P0.7a", "P1.3", "P1.5", "P2.1", "P4.1"]) expect(nogo).toContain(id);
    expect(out).toContain("[FAIL] P1.3");
    expect(out).toContain("[FAIL] P1.5");
  });

  it("gates on a FAILED advisory row instead of reporting a harmless warning", () => {
    // The audit found P0.5/P3.x could emit `warn` and the run still returned
    // PASS/0. §1 P0 says do not proceed on a warning, so a failed row gates at
    // any severity — while a row that merely cannot run (P0.1/P0.3/P1.7) does not.
    const { code, out } = run(failPreflight);
    const nogo = out.split("\n").find((line) => line.startsWith("NO-GO")) ?? "";
    for (const id of ["P0.5", "P3.1", "P3.2", "P3.3", "P3.4"]) {
      expect(out).toContain(`[FAIL] ${id}`);
      expect(nogo).toContain(id);
    }
    // The non-gating `warn` marker is gone: a failed row is always a FAIL.
    expect(out).not.toContain("[warn]");
    expect(code).toBe(1);
  });

  it("P0.5 reads the LIVE unit directives — a correct path in a comment does not satisfy it", () => {
    // The recorded unit's real ExecStart is /srv/WRONG/main.js; the shipped path
    // appears only in a comment. A substring detector passed this (the audit's
    // finding); the directive parser must not.
    const { out } = run(failPreflight);
    expect(out).toContain("[FAIL] P0.5");
    expect(out).toContain("observed ExecStart: /usr/bin/node /srv/WRONG/main.js");
  });

  it("fails P3.3 and P3.4 when the documented accepted state is absent", () => {
    const { out } = run(failPreflight);
    expect(out).toContain("[FAIL] P3.3");
    expect(out).toContain("[FAIL] P3.4");
    expect(out).toContain("§8 L4");
    expect(out).toContain("§8 L7");
  });

  it("keeps a genuinely healthy host green — off-host advisory rows still do not gate", () => {
    // Guards against the lazy fix of widening every advisory row to blocking:
    // P0.1/P0.3/P1.7 cannot run here by design and the run must still exit 0,
    // and the healthy unit must satisfy the stricter P0.5 parser.
    const { code, out } = run(passPreflight);
    expect(code).toBe(0);
    expect(out).toContain("[skip] P0.1");
    expect(out).toContain("[skip] P0.3");
    expect(out).toContain("[skip] P1.7");
    expect(out).toContain("[PASS] P0.5");
    expect(out).toContain("gating failures: 0");
    expect(out).not.toContain("[FAIL]");
  });

  it("gives an operator a result for every runbook id, once each", () => {
    const { out } = run([...passPreflight, "--json"]);
    const checks = (JSON.parse(out) as { checks: { id: string; severity: string }[] }).checks;
    const ids = checks.map((check) => check.id);
    expect(new Set(ids).size).toBe(ids.length);

    for (const id of [
      "P0.1", "P0.2a", "P0.2b", "P0.2c", "P0.3", "P0.4a", "P0.4b", "P0.5", "P0.6", "P0.7a", "P0.7b",
      "P1.0a", "P1.0b", "P1.1", "P1.2", "P1.3", "P1.4", "P1.5", "P1.6", "P1.7", "P1.8",
      "P2.1", "P2.2", "P2.3", "P2.4", "P2.5", "P2.6",
      "P3.1", "P3.2", "P3.3", "P3.4",
      "P4.1", "P4.2", "P4.3", "P4.4", "P4.5", "P4.6", "P4.7", "P4.8", "P4.9", "P4.10",
    ]) {
      expect(ids).toContain(id);
    }

    // P0.5 and every P3.x row must exist AND be addressable without gating: they
    // are recorded findings, so an advisory result is what an operator ticks off.
    const byId = new Map(checks.map((check) => [check.id, check]));
    expect(byId.get("P0.5")?.severity).toBe("advisory");
    for (const id of ["P3.1", "P3.2", "P3.3", "P3.4"]) expect(byId.get(id)?.severity).toBe("advisory");
  });

  it("keeps the scope banner and TARGET_PROFILE from drifting apart", () => {
    expect(PREFLIGHT_BANNER).toContain(OUT_OF_SCOPE);
    expect(PREFLIGHT_BANNER).toContain(TARGET_PROFILE);
  });
});

/**
 * P0.5 is the SOLE owner of the unit parse, so its grammar is exercised here,
 * through the CLI, against a DERIVED recorded host: the healthy fixture with only
 * its systemd unit swapped out. Nothing on this machine is probed and no fixture
 * on disk is modified.
 *
 * The grammar is `systemd.syntax(7)` plus `systemd.exec(5)` and is pinned by the
 * runbook's P0.5 paragraph. Where those documents leave a tie-breaker to real
 * systemd behaviour that cannot be observed on a Windows workstation, the
 * reading this tool takes is stated in the runbook AND asserted below rather than
 * left implicit.
 */
describe("release CLI — P0.5 unit grammar", () => {
  const UNIT = "/etc/systemd/system/nexup-bridge.service";
  const BUNDLE = "/opt/nexup-bridge/dist/main.js";
  const WD = "WorkingDirectory=/opt/nexup-bridge";
  const ENVFILE = "EnvironmentFile=/etc/nexup-bridge/bridge.env";
  // A trailing backslash is written through fromCharCode so the byte in this
  // file is unambiguous: systemd joins a line that ENDS with one backslash.
  const BACKSLASH = String.fromCharCode(92);

  const temp = mkdtempSync(path.join(os.tmpdir(), "nexup-p05-"));
  afterAll(() => rmSync(temp, { recursive: true, force: true }));

  let cases = 0;
  /** Preflight against the recorded healthy host, with a different unit file. */
  function runWithUnit(unit: string): Run {
    const host = JSON.parse(readFileSync(PASS, "utf8")) as RecordedFixture;
    host.files = { ...(host.files ?? {}), [UNIT]: unit };
    cases += 1;
    const file = path.join(temp, `unit-case-${cases}.json`);
    writeFileSync(file, JSON.stringify(host), "utf8");
    return run(passPreflight.map((arg) => (arg === PASS ? file : arg)));
  }

  /** A unit in the shape the runbook ships, with the given [Service] lines. */
  const unit = (...serviceLines: string[]): string =>
    ["[Unit]", "Description=NEXUP VPS Bridge", "[Service]", "User=nexup-bridge", ...serviceLines, ""].join("\n");

  const expectP05Pass = ({ code, out }: Run): void => {
    expect(out).toContain("[PASS] P0.5");
    // P0.5 is the only thing under test here: the host is otherwise healthy.
    expect(out).toContain("gating failures: 0");
    expect(code).toBe(0);
  };

  const expectP05Nogo = ({ code, out }: Run): void => {
    expect(out).toContain("[FAIL] P0.5");
    expect(nogoLine(out)).toContain("P0.5");
    // ...and nothing else on the recorded healthy host failed.
    expect(out).toContain("gating failures: 1");
    expect(code).toBe(1);
  };

  it("accepts a Node option placed before the script (the realistic hardening edit)", () => {
    // `node -r /srv/preload.js <bundle>` launches the shipped bundle; the entry
    // script is the first argument that is not a Node option.
    expectP05Pass(runWithUnit(unit(WD, ENVFILE, `ExecStart=/usr/bin/node -r /srv/preload.js ${BUNDLE}`)));
  });

  it("accepts a quoted bundle path", () => {
    // systemd.syntax(7) QUOTING: quotes wrap an item and are removed.
    expectP05Pass(runWithUnit(unit(WD, ENVFILE, `ExecStart=/usr/bin/node "${BUNDLE}"`)));
    expectP05Pass(runWithUnit(unit(`WorkingDirectory="/opt/nexup-bridge"`, ENVFILE, `ExecStart=/usr/bin/node ${BUNDLE}`)));
  });

  it("accepts a backslash-continued ExecStart, including across a comment block", () => {
    // "Lines ending in a backslash are concatenated with the following line while
    // reading and the backslash is replaced by a space character."
    expectP05Pass(runWithUnit(unit(WD, ENVFILE, `ExecStart=/usr/bin/node ${BACKSLASH}`, `  ${BUNDLE}`)));
    // "When a comment line or lines follow a line ending with a backslash, the
    // comment block is ignored, so the continued line is concatenated with
    // whatever follows the comment block."
    expectP05Pass(
      runWithUnit(unit(WD, ENVFILE, `ExecStart=/usr/bin/node ${BACKSLASH}`, "# preload is added later", `  ${BUNDLE}`)),
    );
  });

  it("uses the LAST live ExecStart, the way systemd does (a later wrong one is a NO-GO)", () => {
    // The audit's false negative: `any line wins` let a unit that ends up
    // launching /srv/WRONG/main.js pass because a correct line appeared first.
    expectP05Nogo(
      runWithUnit(unit(WD, ENVFILE, `ExecStart=/usr/bin/node ${BUNDLE}`, "ExecStart=/usr/bin/node /srv/WRONG/main.js")),
    );
    // The mirror image is a valid unit: the last assignment is what runs.
    expectP05Pass(
      runWithUnit(unit(WD, ENVFILE, "ExecStart=/usr/bin/node /srv/WRONG/main.js", `ExecStart=/usr/bin/node ${BUNDLE}`)),
    );
  });

  it("accepts whitespace around `=` — a stated reading, not an accident", () => {
    // systemd.syntax(7): "Whitespace immediately before or after the \"=\" is
    // ignored." The previous parser happened to tolerate this; the runbook now
    // states it, so an operator may write either form.
    expectP05Pass(
      runWithUnit(
        unit(
          "WorkingDirectory = /opt/nexup-bridge",
          "EnvironmentFile = /etc/nexup-bridge/bridge.env",
          `ExecStart = /usr/bin/node ${BUNDLE}`,
        ),
      ),
    );
  });

  it("keeps rejecting a unit that only MENTIONS the shipped path", () => {
    // The four defeat cases the directive parser already handled: they must not
    // regress while it gains quoting, continuation and option handling.
    const mentions = runWithUnit(
      unit(WD, ENVFILE, `ExecStart=/usr/bin/node /srv/WRONG/main.js # ${BUNDLE}`),
    );
    expectP05Nogo(mentions);
    expect(mentions.out).toContain("observed ExecStart: /usr/bin/node /srv/WRONG/main.js #");

    // The path as WorkingDirectory's trailing comment, with the right ExecStart.
    expectP05Nogo(runWithUnit(unit(`WorkingDirectory=/tmp # ${BUNDLE}`, ENVFILE, `ExecStart=/usr/bin/node ${BUNDLE}`)));

    // The path as another directive's value.
    expectP05Nogo(runWithUnit(unit(`EnvironmentFile=${BUNDLE}`, WD, "ExecStart=/usr/bin/node /srv/WRONG/main.js")));

    // No live ExecStart at all — only a commented one.
    const commented = runWithUnit(unit(WD, ENVFILE, `# ExecStart=/usr/bin/node ${BUNDLE}`));
    expectP05Nogo(commented);
    expect(commented.out).toContain("(no ExecStart directive found)");
  });
});

describe("release CLI — hermes-compat through the entry point", () => {
  it("exits 0 and ends with `HERMES-COMPAT: PASS` when every emitted method is present", () => {
    const { code, out } = run(["hermes-compat", "--fixture", PASS, "--hermes-src", "/opt/hermes"]);
    expect(code).toBe(0);
    expect(lastLine(out)).toBe("HERMES-COMPAT: PASS");
    expect(out).toContain("session.events.since");
  });

  it("is NO-GO on a missing gateway.ping unless the degradation is explicitly accepted", () => {
    const blocked = run(["hermes-compat", "--fixture", DEGRADED, "--hermes-src", "/opt/hermes"]);
    expect(blocked.code).toBe(1);
    expect(blocked.out).toContain("[FAIL] P2.5");
    expect(lastLine(blocked.out)).toBe("HERMES-COMPAT: FAIL");

    const accepted = run(["hermes-compat", "--fixture", DEGRADED, "--hermes-src", "/opt/hermes", "--accept-degraded"]);
    expect(accepted.code).toBe(0);
    expect(accepted.out).toContain("ACCEPTED-DEGRADED");
    expect(lastLine(accepted.out)).toBe("HERMES-COMPAT: PASS");
  });

  it("is NO-GO on a missing lifecycle method", () => {
    const { code, out } = run(["hermes-compat", "--fixture", MISSING_INTERRUPT, "--hermes-src", "/opt/hermes"]);
    expect(code).toBe(1);
    expect(out).toContain("[FAIL] P2.4");
  });

  it("fails closed when no --hermes-src is supplied", () => {
    const { code, out } = run(["hermes-compat", "--fixture", PASS]);
    expect(code).toBe(1);
    expect(out).toContain("[NOGO] P2.1");
    expect(lastLine(out)).toBe("HERMES-COMPAT: FAIL");
  });

  it("carries the same scope banner in --json", () => {
    const { out } = run(["hermes-compat", "--fixture", PASS, "--hermes-src", "/opt/hermes", "--json"]);
    const payload = JSON.parse(out) as { banner: string; verdict: string };
    expect(payload.banner).toContain(OUT_OF_SCOPE);
    expect(payload.banner).toContain(TARGET_PROFILE);
    expect(payload.verdict).toBe("PASS");
  });
});

describe("release CLI — rejected input", () => {
  it("prints usage and exits 2 when no subcommand is given", () => {
    const { code, out } = run([]);
    expect(code).toBe(2);
    expect(out).toContain("USAGE");
  });

  it("exits 0 for --help", () => {
    expect(run(["--help"]).code).toBe(0);
  });

  it("rejects an unknown flag with exit 2", () => {
    const { code, err, out } = run(["preflight", "--nope", "--fixture", PASS]);
    expect(code).toBe(2);
    expect(err).toContain("unknown option --nope");
    expect(out).toContain("USAGE");
  });

  it("exits 2 when the fixture cannot be read", () => {
    const { code, err } = run(["preflight", "--fixture", path.join(FIXTURES, "does-not-exist.json")]);
    expect(code).toBe(2);
    expect(err).toContain("could not read fixture");
  });

  it("rejects a non-numeric or non-positive --min-free-mib before probing", () => {
    for (const value of ["abc", "0", "-5", "", "300.5"]) {
      const { code, out, err } = run(["preflight", "--min-free-mib", value, "--fixture", PASS]);
      expect(code).toBe(2);
      expect(err).toContain("--min-free-mib needs a positive integer");
      // The probe never ran, so no verdict was produced from a NaN floor.
      expect(out).not.toContain("PREFLIGHT:");
    }
  });

  it("actually applies an accepted --min-free-mib", () => {
    const { code, out } = run([...passPreflight, "--min-free-mib", "40000"]);
    expect(code).toBe(1);
    expect(out).toContain("[FAIL] P4.7");
  });
});
