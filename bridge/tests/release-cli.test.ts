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
/** The digest pinned at build time; the recorded host holds this exact image. */
const PASS_DIGEST = "d1e2f3a4d1e2f3a4d1e2f3a4d1e2f3a4d1e2f3a4d1e2f3a4d1e2f3a4d1e2f3a4";
const IMAGE_REF = `nexup-bridge@sha256:${PASS_DIGEST}`;
const COMPOSE_PATH = "/opt/nexup-bridge/docker-compose.bridge.yml";

const OUT_OF_SCOPE = "OUT OF SCOPE — DO NOT TOUCH";

type Run = { code: number; out: string; err: string };

function run(argv: readonly string[]): Run {
  const out: string[] = [];
  const err: string[] = [];
  const io: CliIo = { out: (text) => out.push(text), err: (text) => err.push(text) };
  const code = runReleaseCli(argv, io);
  return { code, out: out.join("\n"), err: err.join("\n") };
}

/** The healthy recorded host, fully exercised (the execution probes included). */
const passPreflight = [
  "preflight",
  "--fixture",
  PASS,
  "--hermes-src",
  "/opt/hermes",
  "--expected-digest",
  PASS_DIGEST,
  "--image",
  IMAGE_REF,
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

  it("fails closed when the execution probes are not enabled", () => {
    // P0.2c (the allowlist guard survived into the image), P0.6 (the bind guard)
    // and P4.12 (the serve endpoint really answers on loopback) all EXECUTE
    // something, so all three must be opted into — and a safety row that cannot
    // run is a NO-GO, never a quiet pass.
    const withoutExec = passPreflight.filter((arg) => arg !== "--exec-probes");
    const { code, out } = run(withoutExec);
    expect(code).toBe(1);
    for (const id of ["P0.2c", "P0.6", "P4.12"]) {
      expect(out).toContain(`[NOGO] ${id}`);
      // Reported as "could not run", never as a failure of the thing checked.
      expect(out).toContain("could not run:");
    }
    expect(out).toContain("NO-GO — gating checks did not pass");
    expect(lastLine(out)).toBe("PREFLIGHT: FAIL");
  });

  it("exits 1 with `PREFLIGHT: FAIL` on a host with forced safety failures", () => {
    const { code, out } = run(failPreflight);
    expect(code).toBe(1);
    expect(lastLine(out)).toBe("PREFLIGHT: FAIL");

    const nogo = out.split("\n").find((line) => line.startsWith("NO-GO"));
    expect(nogo).toBeDefined();
    // A mutable image, a published port, a host-exposed Hermes, a missing
    // supervisor — every one of them is a NO-GO on its own.
    for (const id of ["P0.2b", "P0.5a", "P0.5b", "P0.7a", "P0.7b", "P1.1", "P1.3", "P1.5", "P2.1", "P4.1", "P4.2"]) {
      expect(nogo).toContain(id);
    }
    expect(out).toContain("[FAIL] P1.3");
    expect(out).toContain("[FAIL] P1.5");
    expect(out).toContain("[FAIL] P4.11");
  });

  it("gates on a FAILED advisory row instead of reporting a harmless warning", () => {
    // §1 P0 says do not proceed on a warning, so a failed row gates at any
    // severity — while a row that merely cannot run (P0.1/P0.3/P1.7) does not.
    const { code, out } = run(failPreflight);
    const nogo = out.split("\n").find((line) => line.startsWith("NO-GO")) ?? "";
    for (const id of ["P3.1", "P3.2", "P3.3", "P3.4", "P3.5"]) {
      expect(out).toContain(`[FAIL] ${id}`);
      expect(nogo).toContain(id);
    }
    // The non-gating `warn` marker is gone: a failed row is always a FAIL.
    expect(out).not.toContain("[warn]");
    expect(code).toBe(1);
  });

  it("P0.5a reads the LIVE compose directives — a commented-out line does not satisfy it", () => {
    // The recorded compose runs `network_mode: bridge` and publishes 9220; the
    // correct `container:` form appears only in a comment. A substring detector
    // passes that (the audit's finding); the directive reader must not.
    const { out } = run(failPreflight);
    expect(out).toContain("[FAIL] P0.5a");
    expect(out).toContain("network_mode");
    expect(out).toContain("ports");
  });

  it("fails P3.3, P3.4 and P3.5 when the documented accepted state is absent", () => {
    const { out } = run(failPreflight);
    expect(out).toContain("[FAIL] P3.3");
    expect(out).toContain("[FAIL] P3.4");
    expect(out).toContain("[FAIL] P3.5");
    expect(out).toContain("§8 L4");
    expect(out).toContain("§8 L7");
  });

  it("keeps a genuinely healthy host green — off-host advisory rows still do not gate", () => {
    // Guards against the lazy fix of widening every advisory row to blocking:
    // P0.1/P0.3/P1.7 cannot run here by design and the run must still exit 0.
    const { code, out } = run(passPreflight);
    expect(code).toBe(0);
    expect(out).toContain("[skip] P0.1");
    expect(out).toContain("[skip] P0.3");
    expect(out).toContain("[skip] P1.7");
    expect(out).toContain("[PASS] P0.5a");
    expect(out).toContain("[PASS] P0.5b");
    expect(out).toContain("[PASS] P0.7b");
    expect(out).toContain("gating failures: 0");
    expect(out).not.toContain("[FAIL]");
  });

  it("gives an operator a result for every runbook id, once each", () => {
    const { out } = run([...passPreflight, "--json"]);
    const checks = (JSON.parse(out) as { checks: { id: string; severity: string }[] }).checks;
    const ids = checks.map((check) => check.id);
    expect(new Set(ids).size).toBe(ids.length);

    for (const id of [
      "P0.1", "P0.2a", "P0.2b", "P0.2c", "P0.3", "P0.4a", "P0.4b", "P0.5a", "P0.5b", "P0.6", "P0.7a", "P0.7b",
      "P1.0a", "P1.0b", "P1.1", "P1.2", "P1.3", "P1.4", "P1.5", "P1.6", "P1.7", "P1.8",
      "P2.1", "P2.2", "P2.3", "P2.4", "P2.5", "P2.6",
      "P3.1", "P3.2", "P3.3", "P3.4", "P3.5",
      "P4.1", "P4.2", "P4.3", "P4.4", "P4.5", "P4.6", "P4.7", "P4.8", "P4.9", "P4.10", "P4.11", "P4.12",
    ]) {
      expect(ids).toContain(id);
    }

    // The recorded findings exist AND stay addressable without gating: an
    // advisory result is what an operator ticks off.
    const byId = new Map(checks.map((check) => [check.id, check]));
    for (const id of ["P3.1", "P3.2", "P3.3", "P3.4", "P3.5"]) expect(byId.get(id)?.severity).toBe("advisory");
    // ...and the rows that carry the revised-C safety properties are safety.
    for (const id of ["P0.5a", "P0.5b", "P0.7b", "P1.8", "P4.1", "P4.2", "P4.11"]) {
      expect(byId.get(id)?.severity).toBe("safety");
    }
  });

  it("keeps the scope banner and TARGET_PROFILE from drifting apart", () => {
    expect(PREFLIGHT_BANNER).toContain(OUT_OF_SCOPE);
    expect(PREFLIGHT_BANNER).toContain(TARGET_PROFILE);
  });
});

/**
 * P0.5a/P0.5b/P0.7b are the SOLE owners of the deployment-definition parse, so
 * their grammar is exercised here, through the CLI, against a DERIVED recorded
 * host: the healthy fixture with only its compose file swapped out. Nothing on
 * this machine is probed and no fixture on disk is modified.
 *
 * The subject changed with the architecture (a compose file, not a systemd unit)
 * but the PROPERTY did not: the check reads what the definition actually
 * declares, ignores comments, and refuses anything that would expose the bridge
 * or run an unpinned artifact.
 */
describe("release CLI — deployment-definition grammar (P0.5a/P0.5b/P0.7b)", () => {
  const temp = mkdtempSync(path.join(os.tmpdir(), "nexup-p05-"));
  afterAll(() => rmSync(temp, { recursive: true, force: true }));

  let cases = 0;
  /** Preflight against the recorded healthy host, with a different compose file. */
  function runWithCompose(compose: string): Run {
    const host = JSON.parse(readFileSync(PASS, "utf8")) as RecordedFixture;
    host.files = { ...(host.files ?? {}), [COMPOSE_PATH]: compose };
    cases += 1;
    const file = path.join(temp, `compose-case-${cases}.json`);
    writeFileSync(file, JSON.stringify(host), "utf8");
    return run(passPreflight.map((arg) => (arg === PASS ? file : arg)));
  }

  /** The shipped shape, with individual lines replaced. */
  const compose = (...overrides: string[]): string =>
    [
      "services:",
      "  nexup-bridge:",
      "    image: ${NEXUP_BRIDGE_IMAGE:?set NEXUP_BRIDGE_IMAGE}",
      '    network_mode: "container:${NEXUP_HERMES_CONTAINER:-hermes-agent-r3j1-hermes-agent-1}"',
      "    restart: unless-stopped",
      "    env_file:",
      `      - ${ENV_FILE}`,
      "    read_only: true",
      '    user: "10001:10001"',
      "    cap_drop:",
      "      - ALL",
      "    security_opt:",
      "      - no-new-privileges:true",
      "    labels:",
      "      - traefik.enable=true",
      "      - traefik.http.routers.nexup-bridge.rule=Host(`${NEXUP_BRIDGE_HOSTNAME}`)",
      "      - traefik.http.routers.nexup-bridge.entrypoints=websecure",
      "      - traefik.http.routers.nexup-bridge.tls=true",
      "      - traefik.http.routers.nexup-bridge.tls.certresolver=letsencrypt",
      "      - traefik.http.routers.nexup-bridge.middlewares=nexup-bridge-headers@docker",
      "      - traefik.http.services.nexup-bridge.loadbalancer.server.port=9220",
      "      - traefik.http.middlewares.nexup-bridge-headers.headers.stsSeconds=31536000",
      ...overrides,
      "",
    ].join("\n");

  /**
   * Exactly the named rows fail, and nothing else on the recorded host does. A
   * defect in the deployment definition is usually caught by MORE than one row
   * (P0.5a/P0.5b read it directly, P3.1 reads it as the edge contract), so the
   * expectation is the full set rather than one id.
   */
  const expectOnly = (out: string, ...ids: string[]): void => {
    for (const id of ids) {
      expect(out).toContain(`[FAIL] ${id}`);
      expect(nogoLine(out)).toContain(id);
    }
    expect(out).toContain(`gating failures: ${ids.length}`);
  };

  it("accepts the shipped compose unchanged", () => {
    const { code, out } = runWithCompose(compose());
    expect(out).toContain("[PASS] P0.5a");
    expect(out).toContain("[PASS] P0.5b");
    expect(out).toContain("[PASS] P0.7b");
    expect(code).toBe(0);
  });

  it("refuses any definition that publishes a port", () => {
    const published = runWithCompose(compose("    ports:", '      - "9220:9220"'));
    // P0.5a refuses the definition AND P3.1 refuses the edge contract it implies.
    expectOnly(published.out, "P0.5a", "P3.1");
    // The empty list publishes nothing, so it is not a finding.
    const empty = runWithCompose(compose("    ports: []"));
    expect(empty.out).toContain("[PASS] P0.5a");
    expect(empty.code).toBe(0);
  });

  it("uses the LIVE network_mode, the way compose does (a comment is not a value)", () => {
    // Both the correct value in a comment and a wrong live value. A substring
    // reader passes this; the directive reader must not.
    const commented = runWithCompose(
      compose("    # network_mode: container:hermes-agent-r3j1-hermes-agent-1", "    network_mode: bridge"),
    );
    expectOnly(commented.out, "P0.5a");
    expect(commented.out).toContain("observed bridge");

    // A SECOND live network_mode wins, exactly as compose's own merge does.
    const twice = runWithCompose(compose("    network_mode: host"));
    expectOnly(twice.out, "P0.5a");
  });

  it("refuses a namespace owner that is not the Hermes container", () => {
    const wrongOwner = runWithCompose(compose('    network_mode: "container:some-other-container"'));
    expectOnly(wrongOwner.out, "P0.5a");
    // ...and accepts both the shipped interpolated form and the literal name.
    expect(runWithCompose(compose("    network_mode: container:hermes-agent-r3j1-hermes-agent-1")).code).toBe(0);
  });

  it("refuses an image that is not pinned by digest", () => {
    const mutable = runWithCompose(compose("    image: nexup-bridge:latest"));
    expectOnly(mutable.out, "P0.5b");
    expect(mutable.out).toContain("digest");

    // A literal digest that differs from the recorded build digest is a NO-GO.
    const wrong = runWithCompose(compose(`    image: ${IMAGE_REF.replace("d1e2", "ffff")}`));
    expectOnly(wrong.out, "P0.5b");
  });

  it("refuses a root user, a writable root filesystem and an emptied cap drop", () => {
    expectOnly(runWithCompose(compose('    user: "0:0"')).out, "P0.5b");
    expectOnly(runWithCompose(compose("    user: root")).out, "P0.5b");
    expectOnly(runWithCompose(compose("    read_only: false")).out, "P0.5b");
    // The LAST cap_drop wins, so this definition drops nothing even though an
    // earlier `- ALL` is still in the file.
    expectOnly(runWithCompose(compose("    cap_drop: []")).out, "P0.5b");
  });

  it("refuses a definition that would not read the root-only env file", () => {
    // No env_file at all: the container would start with no secrets.
    expectOnly(runWithCompose(compose().replace(`      - ${ENV_FILE}\n`, "")).out, "P0.5b");
    // A LATER env_file wins, even though the root-only path is still in the file.
    expectOnly(runWithCompose(compose("    env_file:", "      - /tmp/bridge.env")).out, "P0.5b");
  });

  it("refuses an edge that buffers the run stream or drops the TLS entrypoint", () => {
    const buffering = runWithCompose(
      compose("      - traefik.http.middlewares.nexup-bridge-buffer.buffering.maxRequestBodyBytes=262144"),
    );
    expectOnly(buffering.out, "P0.7b");
    expect(buffering.out).toContain("buffering");

    expectOnly(runWithCompose(compose("      - traefik.http.routers.nexup-bridge.entrypoints=web")).out, "P0.7b");
    expect(
      runWithCompose(
        compose("      - traefik.http.routers.nexup-bridge.tls.certresolver=letsencrypt"),
      ).code,
    ).toBe(0);
  });

  it("refuses a router with no host rule, and one pointed at the wrong service port", () => {
    const noHost = runWithCompose(
      compose("      - traefik.http.routers.nexup-bridge.rule=PathPrefix(`/`)"),
    );
    expectOnly(noHost.out, "P0.7b");
    expectOnly(runWithCompose(compose("      - traefik.http.services.nexup-bridge.loadbalancer.server.port=9119")).out, "P0.7b");
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
