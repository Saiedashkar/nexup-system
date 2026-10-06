import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  assessComposeSecurity,
  composeList,
  composeValue,
  CONTAINER_USER,
  ENV_FILE,
} from "../src/release/preflight";

/**
 * The deployment definition is an ARTIFACT, and these tests read the artifact
 * itself — not a fixture, not a trimmed copy. The audit that produced this file
 * found `host-pass.json` asserting a `user:` line the shipped compose did not
 * have, so P0.5b NO-GO'd against the real file while the suite stayed green.
 *
 * A fixture may stand in for a host's RECORDED COMMANDS. It may not invent a
 * deployment property: a drifted fixture is a false green, and the only defence
 * is asserting the shipped file directly (below) and pinning the fixture to it
 * (the drift gate at the end).
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const SHIPPED_COMPOSE = path.resolve(here, "../deploy/docker-compose.bridge.yml");
const PASS_FIXTURE = path.resolve(here, "../fixtures/release/host-pass.json");
const COMPOSE_PATH = "/opt/nexup-bridge/docker-compose.bridge.yml";

const shipped = readFileSync(SHIPPED_COMPOSE, "utf8");

/** The digest recorded at build time, and a different one — a rebuilt image. */
const RECORDED = "2004387ab49a4b72b64ae763be21251d892b9ddb97cb87e768eeffbbaec024e3";
const REBUILT = "d1e2f3a4d1e2f3a4d1e2f3a4d1e2f3a4d1e2f3a4d1e2f3a4d1e2f3a4d1e2f3a4";
const ref = (digest: string): string => `nexup-bridge@sha256:${digest}`;

describe("shipped docker-compose.bridge.yml", () => {
  it("runs the bridge as the declared non-root user", () => {
    const assessment = assessComposeSecurity({ compose: shipped });
    expect(composeValue(shipped, "user")).toBe(`${CONTAINER_USER}:${CONTAINER_USER}`);
    expect(assessment.userOk).toBe(true);
  });

  it("publishes nothing on the host and keeps every hardening directive", () => {
    const assessment = assessComposeSecurity({
      compose: shipped,
      resolvedImage: ref(RECORDED),
      expectedDigest: RECORDED,
    });
    expect(assessment.publishesPorts).toBe(false);
    expect(assessment.missing).toEqual([]);
  });

  it("takes its image from NEXUP_BRIDGE_IMAGE and embeds no digest of its own", () => {
    const assessment = assessComposeSecurity({
      compose: shipped,
      resolvedImage: ref(RECORDED),
      expectedDigest: RECORDED,
    });
    expect(composeValue(shipped, "image")).toMatch(/\$\{NEXUP_BRIDGE_IMAGE/);
    // ONE source of truth: a fallback digest in the definition would be a second
    // identity that nothing compares against the recorded build.
    expect(assessment.embeddedFallbackDigest).toBe(false);
  });
});

describe("deployment image identity", () => {
  it("accepts the resolved digest that matches the recorded build digest", () => {
    const assessment = assessComposeSecurity({
      compose: shipped,
      resolvedImage: ref(RECORDED),
      expectedDigest: RECORDED,
    });
    expect(assessment.resolvedDigest).toBe(`sha256:${RECORDED}`);
    expect(assessment.imageOk).toBe(true);
  });

  it("refuses a resolved digest that differs from the recorded build digest", () => {
    const assessment = assessComposeSecurity({
      compose: shipped,
      resolvedImage: ref(REBUILT),
      expectedDigest: RECORDED,
    });
    expect(assessment.imageOk).toBe(false);
    expect(assessment.missing.join(" ")).toMatch(/differs/);
  });

  it("fails closed when the deployment image digest cannot be resolved", () => {
    // An unset NEXUP_BRIDGE_IMAGE, a compose that will not interpolate, or a
    // probe that could not run: all of them mean the deployed identity is
    // UNKNOWN, which is a NO-GO — never a pass on the strength of the file text.
    const assessment = assessComposeSecurity({
      compose: shipped,
      resolvedImage: null,
      expectedDigest: RECORDED,
    });
    expect(assessment.imageOk).toBe(false);
    expect(assessment.missing.join(" ")).toMatch(/could not resolve/);
  });

  it("does not let an embedded fallback digest stand in for the resolved one", () => {
    const withFallback = shipped.replace(
      /^(\s*image:).*$/m,
      `$1 \${NEXUP_BRIDGE_IMAGE:-${ref(RECORDED)}}`,
    );
    const assessment = assessComposeSecurity({
      compose: withFallback,
      resolvedImage: ref(RECORDED),
      expectedDigest: RECORDED,
    });
    expect(assessment.embeddedFallbackDigest).toBe(true);
    expect(assessment.imageOk).toBe(false);
    expect(assessment.missing.join(" ")).toMatch(/fallback/);
  });
});

describe("recorded fixture vs shipped artifact", () => {
  const fixture = JSON.parse(readFileSync(PASS_FIXTURE, "utf8")) as {
    files: Record<string, string>;
    commands: Record<string, { stdout?: string }>;
  };
  const recorded = fixture.files[COMPOSE_PATH];

  it("records the deployment definition it will be judged against", () => {
    expect(recorded).toBeTypeOf("string");
  });

  it("claims no security-critical deployment fact the shipped file lacks", () => {
    // Scalar facts, parsed with the same reader the checks use.
    for (const key of ["image", "network_mode", "user", "read_only", "restart"]) {
      expect(composeValue(recorded, key), `fixture vs shipped: ${key}`).toBe(composeValue(shipped, key));
    }
    // List facts.
    expect(composeList(recorded, "env_file")).toEqual(composeList(shipped, "env_file"));
    expect(composeList(recorded, "cap_drop")).toEqual(composeList(shipped, "cap_drop"));
    expect(recorded).toContain("no-new-privileges");
    // And the recorded host's own resolution of the image must satisfy the check
    // the fixture is used to exercise — no fixture-only deployment facts. The
    // fixture is a SYNTHETIC host (its recorded image digest is synthetic like
    // its recorded secrets); what must match the shipped artifact is the
    // DEFINITION, which the assertions above pin.
    const resolved = composeValue(
      fixture.commands[`docker compose -f ${COMPOSE_PATH} config`]?.stdout ?? "",
      "image",
    );
    expect(resolved).not.toBeNull();
    expect(
      assessComposeSecurity({ compose: recorded, resolvedImage: resolved, expectedDigest: REBUILT }).missing,
    ).toEqual([]);
    expect(composeList(recorded, "env_file")).toContain(ENV_FILE);
  });
});
