import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  bridgeProbeArgs,
  createPreflightSuite,
  FORBIDDEN_OFF_SCOPE_PROFILE,
  FORBIDDEN_PROFILE,
  PROBE_CONTAINER_PREFIX,
  TARGET_PROFILE,
  type PreflightOptions,
} from "../src/release/preflight";
import { commandKey } from "../src/release/probe";
import type { CheckOutcome, HostProbe } from "../src/release/runner";

/**
 * The two audit findings that made the pre-flight green only because its evidence
 * was fiction. Each is pinned HERE against genuine material:
 *
 *   P0.6  the forbidden-profile probe must be authoritative by construction, so
 *         Docker's last-wins `-e` rule cannot silently replace its override with
 *         the shared `HERMES_PROFILE=saieed` — and every probe container must be
 *         removed on the success, refusal AND timeout paths.
 *   P3.3  the live-bucket policy must read the sweep METHOD, not the first
 *         textual `sweepBuckets` (which is a call site in the real file).
 *
 * The subjects are the real artifacts: `src/auth/pre-auth-guard.ts` on disk, and
 * an argv the production check actually builds (observed through a probe that
 * emulates `docker run` with Docker's own LAST-WINS semantics).
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const PRE_AUTH_GUARD = path.resolve(here, "../src/auth/pre-auth-guard.ts");

/*
 * The deployed image IDENTITY, as the suite resolves it: the definition
 * interpolates `${NEXUP_BRIDGE_IMAGE}` and `docker compose config` renders it
 * with the digest the host pinned. The P0.6 probes must judge THAT reference —
 * with no `--image` the check defaults to what the deployment runs, never to an
 * unpinned name (measured on the real VPS: `nexup-bridge`/`nexup-bridge:latest`
 * made a correctly digest-pinned deployment fail four safety checks).
 */
const COMPOSE_PATH = "/opt/nexup-bridge/docker-compose.bridge.yml";
const DEPLOYED_IMAGE = "nexup-bridge@sha256:d1e2f3a4d1e2f3a4d1e2f3a4d1e2f3a4d1e2f3a4d1e2f3a4d1e2f3a4d1e2f3a4";
const DEPLOYED_COMPOSE =
  "services:\n  nexup-bridge:\n    image: ${NEXUP_BRIDGE_IMAGE:?set NEXUP_BRIDGE_IMAGE in /etc/nexup-bridge/deploy.env}\n";
const COMPOSE_RENDERED = `services:\n  nexup-bridge:\n    image: ${DEPLOYED_IMAGE}\n`;

/** A probe that reads files from a map and cannot run commands. */
function fileProbe(files: Record<string, string>): HostProbe {
  return {
    label: () => "test:files",
    now: () => new Date(0),
    run: () => ({ ran: false, code: null, stdout: "", stderr: "", reason: "not available" }),
    read: (target) =>
      target in files ? { ok: true, content: files[target] as string } : { ok: false, content: null, reason: "not recorded" },
    stat: () => ({ exists: false }),
    searchTree: () => ({ ran: false, hits: {}, scannedFiles: 0, reason: "not available" }),
  };
}

/** Runs ONE check from the production suite, in isolation. */
function runCheck(probe: HostProbe, id: string, options: PreflightOptions = {}): CheckOutcome {
  const { suite } = createPreflightSuite(probe, options);
  const check = suite.checks.find((candidate) => candidate.id === id);
  if (!check) throw new Error(`no check ${id} in the preflight suite`);
  return check.run(probe);
}

/**
 * P3.3 — "Pre-auth sweep order". The accepted state (§8 L4) is a sweep that
 * BREAKS on the first live bucket, so stale buckets linger to the cap. The check
 * must find that `break;` in the sweep METHOD; in the real file the first
 * textual `sweepBuckets` is `this.sweepBuckets(nowMs)` inside `check()`, and the
 * method — with its `break;` — sits well beyond the 600-character window that a
 * naive `indexOf` slice reads. These tests read the REAL source, not a fragment.
 */
describe("P3.3 — the live-bucket policy is read from the sweep METHOD", () => {
  const source = readFileSync(PRE_AUTH_GUARD, "utf8");

  it("the premise holds: the first textual `sweepBuckets` really is a call site", () => {
    const first = source.indexOf("sweepBuckets");
    // The five characters before it are the `this.` of a member CALL.
    expect(source.slice(first - 5, first)).toBe("this.");
    expect(first).toBeLessThan(source.indexOf("private sweepBuckets("));
    // ...and the method is far outside a 600-character window from that call site.
    expect(source.indexOf("private sweepBuckets(") - first).toBeGreaterThan(600);
  });

  it("passes on the REAL pre-auth-guard.ts, whose sweep breaks on the first live bucket", () => {
    const outcome = runCheck(fileProbe({ "bridge/src/auth/pre-auth-guard.ts": source }), "P3.3");
    expect(outcome.status).toBe("pass");
  });

  it("still fails when the sweep is mutated to no longer break on the live bucket", () => {
    // A genuinely unsafe variant derived from the real source: the live-bucket
    // guard is gone, so the method no longer stops at the first live bucket.
    const unsafe = source.replace(
      "      if (bucket.updatedAtMs + this.ttlMs > nowMs) break; // insertion order ≈ recency\n",
      "",
    );
    expect(unsafe).not.toBe(source);
    expect(unsafe.includes("if (bucket.updatedAtMs + this.ttlMs > nowMs) break;")).toBe(false);

    const outcome = runCheck(fileProbe({ "bridge/src/auth/pre-auth-guard.ts": unsafe }), "P3.3");
    expect(outcome.status).toBe("fail");
  });
});

/* ── P0.6 — the forbidden-profile probe ───────────────────────────────────── */

type RunCall = { command: string; args: string[] };

/** Docker's own `-e` rule: a repeated `-e NAME=VALUE` is resolved LAST-WINS. */
function effectiveEnv(commandArgs: readonly string[], key: string): string | null {
  let value: string | null = null;
  for (let index = 0; index < commandArgs.length; index += 1) {
    if (commandArgs[index] !== "-e" && commandArgs[index] !== "--env") continue;
    const assignment = commandArgs[index + 1] ?? "";
    const eq = assignment.indexOf("=");
    if (eq <= 0) continue;
    if (assignment.slice(0, eq) === key) value = assignment.slice(eq + 1);
  }
  return value;
}

function envMap(commandArgs: readonly string[]): Record<string, string> {
  const map: Record<string, string> = {};
  for (let index = 0; index < commandArgs.length; index += 1) {
    if (commandArgs[index] !== "-e" && commandArgs[index] !== "--env") continue;
    const assignment = commandArgs[index + 1] ?? "";
    const eq = assignment.indexOf("=");
    if (eq <= 0) continue;
    map[assignment.slice(0, eq)] = assignment.slice(eq + 1);
  }
  return map;
}

const isLoopback = (host: string): boolean => ["127.0.0.1", "::1", "localhost", "0:0:0:0:0:0:0:1"].includes(host);
const isTrue = (value: string | undefined): boolean => ["true", "1", "yes", "on"].includes(value ?? "");

/**
 * A stand-in for the REAL bridge image behind `docker run`. It resolves the
 * container environment with Docker's OWN rule (a repeated `-e NAME=VALUE` is
 * LAST-WINS) and reproduces `src/config.ts`'s refusals in the same order, so the
 * thing under test is the argv the check builds — not a fixture's claim.
 *
 * An environment that would genuinely be ACCEPTED returns `ran:false`, i.e. the
 * run never exits: exactly the stall the probe's 15 s timeout observes.
 */
function fakeDockerProbe(): { probe: HostProbe; calls: RunCall[] } {
  const calls: RunCall[] = [];
  const probe: HostProbe = {
    label: () => "test:docker",
    now: () => new Date(0),
    run(command, args = []) {
      calls.push({ command, args: [...args] });
      // The deployment's OWN resolution of the image identity.
      if (command === "docker" && args[0] === "compose") {
        return { ran: true, code: 0, stdout: COMPOSE_RENDERED, stderr: "" };
      }
      if (command !== "docker" || args[0] !== "run") return { ran: true, code: 0, stdout: "", stderr: "" };
      const env = envMap(args);
      const refused = (reason: string) => ({ ran: true, code: 1, stdout: "", stderr: `[nexup-bridge] disabled: ${reason}\n` });
      const profile = env.HERMES_PROFILE ?? "saieed";
      const allowed = (env.NEXUP_BRIDGE_ALLOWED_PROFILES ?? "saieed")
        .split(",")
        .map((entry) => entry.trim())
        .filter(Boolean);
      if (profile === "default") {
        return refused('HERMES_PROFILE "default" is unsafe or forbidden (default is never addressable)');
      }
      if (!allowed.includes(profile)) {
        return refused(
          `HERMES_PROFILE "${profile}" is not in NEXUP_BRIDGE_ALLOWED_PROFILES (${allowed.join(",")}): only the pinned mission profile is addressable`,
        );
      }
      const host = env.NEXUP_BRIDGE_HOST ?? "127.0.0.1";
      if (!isLoopback(host)) {
        if (!isTrue(env.NEXUP_BRIDGE_ALLOW_NON_LOOPBACK_BIND)) {
          return refused(
            `NEXUP_BRIDGE_HOST must be loopback (the bridge is not published directly); a non-loopback bind needs NEXUP_BRIDGE_ALLOW_NON_LOOPBACK_BIND=true and applies only inside a shared network namespace; got "${host}"`,
          );
        }
        const proxies = (env.NEXUP_BRIDGE_TRUSTED_PROXIES ?? "")
          .split(",")
          .map((entry) => entry.trim())
          .filter(Boolean);
        if (proxies.length === 0) {
          return refused("NEXUP_BRIDGE_ALLOW_NON_LOOPBACK_BIND is set but NEXUP_BRIDGE_TRUSTED_PROXIES is not");
        }
        if (proxies.every(isLoopback)) {
          return refused(`NEXUP_BRIDGE_TRUSTED_PROXIES (${proxies.join(",")}) is loopback-only while the bind is "${host}"`);
        }
      }
      return { ran: false, code: null, stdout: "", stderr: "", reason: "ETIMEDOUT" };
    },
    read: (target) =>
      target === COMPOSE_PATH
        ? { ok: true, content: DEPLOYED_COMPOSE }
        : { ok: false, content: null, reason: "not recorded" },
    stat: () => ({ exists: false }),
    searchTree: () => ({ ran: false, hits: {}, scannedFiles: 0, reason: "not recorded" }),
  };
  return { probe, calls };
}

const runCalls = (calls: RunCall[]): RunCall[] => calls.filter((call) => call.command === "docker" && call.args[0] === "run");
const containerName = (args: readonly string[]): string => args[args.indexOf("--name") + 1] ?? "";

const wasRemoved = (calls: RunCall[], name: string): boolean =>
  calls.some(
    (call) => call.command === "docker" && call.args[0] === "rm" && call.args[1] === "-f" && call.args[2] === name,
  );

describe("P0.6 — the forbidden-profile probe is authoritative by construction", () => {
  it("passes against an image that honours Docker's LAST-WINS `-e` rule", () => {
    const { probe } = fakeDockerProbe();
    expect(runCheck(probe, "P0.6", { execProbes: true }).status).toBe("pass");
  });

  it("requests each profile exactly once, so no shared value can shadow the override", () => {
    const { probe, calls } = fakeDockerProbe();
    runCheck(probe, "P0.6", { execProbes: true });

    const adel = runCalls(calls).filter((call) => call.args.includes(`HERMES_PROFILE=${FORBIDDEN_OFF_SCOPE_PROFILE}`));
    expect(adel).toHaveLength(1);
    expect(adel[0].args.filter((arg) => arg.startsWith("HERMES_PROFILE="))).toHaveLength(1);
    // The override, not the shared `saieed`, is what Docker resolves.
    expect(effectiveEnv(adel[0].args, "HERMES_PROFILE")).toBe(FORBIDDEN_OFF_SCOPE_PROFILE);
  });

  it("probes the primary forbidden profile `default` as well as the off-scope one", () => {
    const { probe, calls } = fakeDockerProbe();
    expect(runCheck(probe, "P0.6", { execProbes: true }).status).toBe("pass");
    expect(runCalls(calls).some((call) => call.args.includes(`HERMES_PROFILE=${FORBIDDEN_PROFILE}`))).toBe(true);
  });

  it("proves `saieed` is allowed by reaching the BIND refusal, not a profile refusal", () => {
    const { probe, calls } = fakeDockerProbe();
    runCheck(probe, "P0.6", { execProbes: true });
    const bindGuard = runCalls(calls).find(
      (call) => call.args.includes("NEXUP_BRIDGE_HOST=0.0.0.0") && effectiveEnv(call.args, "HERMES_PROFILE") === TARGET_PROFILE,
    );
    expect(bindGuard).toBeDefined();
  });

  it("removes every probe container on the success and refusal paths alike", () => {
    const { probe, calls } = fakeDockerProbe();
    runCheck(probe, "P0.6", { execProbes: true });
    const runs = runCalls(calls);
    expect(runs.length).toBeGreaterThanOrEqual(4);
    for (const run of runs) {
      const name = containerName(run.args);
      expect(name.startsWith(`${PROBE_CONTAINER_PREFIX}-`)).toBe(true);
      expect(wasRemoved(calls, name)).toBe(true);
    }
  });

  it("removes a container whose run never returns (the timeout path)", () => {
    const calls: RunCall[] = [];
    const timeoutProbe: HostProbe = {
      label: () => "test:timeout",
      now: () => new Date(0),
      run(command, args = []) {
        calls.push({ command, args: [...args] });
        if (command === "docker" && args[0] === "compose") {
          return { ran: true, code: 0, stdout: COMPOSE_RENDERED, stderr: "" };
        }
        if (command === "docker" && args[0] === "run") return { ran: false, code: null, stdout: "", stderr: "", reason: "ETIMEDOUT" };
        return { ran: true, code: 0, stdout: "", stderr: "" };
      },
      read: (target) =>
        target === COMPOSE_PATH
          ? { ok: true, content: DEPLOYED_COMPOSE }
          : { ok: false, content: null, reason: "not recorded" },
      stat: () => ({ exists: false }),
      searchTree: () => ({ ran: false, hits: {}, scannedFiles: 0, reason: "not recorded" }),
    };
    expect(runCheck(timeoutProbe, "P0.6", { execProbes: true }).status).toBe("skip");
    const runs = runCalls(calls);
    expect(runs.length).toBeGreaterThan(0);
    for (const run of runs) {
      const name = containerName(run.args);
      expect(name.startsWith(`${PROBE_CONTAINER_PREFIX}-`)).toBe(true);
      expect(wasRemoved(calls, name)).toBe(true);
    }
  });
});

describe("the recorded P0.6 evidence is the argv the check actually builds", () => {
  const PASS_FIXTURE = path.resolve(here, "../fixtures/release/host-pass.json");

  it("records every `docker run` key the production probe emits, so the fixture cannot drift", () => {
    // No `--image`: this pins the DEFAULT path, which is what the runbook uses.
    const { probe, calls } = fakeDockerProbe();
    runCheck(probe, "P0.6", { execProbes: true });
    const fixture = JSON.parse(readFileSync(PASS_FIXTURE, "utf8")) as { commands: Record<string, unknown> };
    const runs = runCalls(calls);
    expect(runs.length).toBeGreaterThanOrEqual(4);
    for (const call of runs) {
      // The probe judges the digest-pinned image the DEFINITION resolves — the
      // fixture's whole value depends on that being the same reference.
      expect(call.args[call.args.length - 1]).toBe(DEPLOYED_IMAGE);
      expect(fixture.commands[commandKey("docker", call.args)]).toBeDefined();
    }
  });

  it("fails closed instead of judging an unpinned name when nothing resolves", () => {
    const { probe, calls } = fakeDockerProbe();
    const noDefinition: HostProbe = {
      ...probe,
      read: () => ({ ok: false, content: null, reason: "not recorded" }),
    };
    const outcome = runCheck(noDefinition, "P0.6", { execProbes: true });
    // A safety check that cannot establish the identity of record is a NO-GO.
    expect(outcome.status).toBe("skip");
    expect(outcome.status === "skip" ? outcome.reason : "").toMatch(/no image identity/);
    expect(runCalls(calls)).toHaveLength(0);
  });
});

describe("bridgeProbeArgs — the environment is a mapping, not an ordered list", () => {
  it("emits each env name exactly once and keeps the requested profile authoritative", () => {
    const args = bridgeProbeArgs("img@sha256:abc", "probe-1", {
      NEXUP_BRIDGE_HMAC_SECRET: "s",
      HERMES_PROFILE: FORBIDDEN_OFF_SCOPE_PROFILE,
    });
    const keys = args.filter((arg, index) => args[index - 1] === "-e").map((arg) => arg.slice(0, arg.indexOf("=")));
    expect(new Set(keys).size).toBe(keys.length);
    expect(effectiveEnv(args, "HERMES_PROFILE")).toBe(FORBIDDEN_OFF_SCOPE_PROFILE);
    expect(args).toContain("--rm");
    expect(args[args.length - 1]).toBe("img@sha256:abc");
  });
});
