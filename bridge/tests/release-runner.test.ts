import { describe, expect, it } from "vitest";

import { createRedactor, renderReport } from "../src/release/output";
import { parseEnvMetadata, parseListeners, isLoopbackAddress } from "../src/release/preflight";
import { createRecordedProbe } from "../src/release/probe";
import { evaluate, type Check, type HostProbe, type Suite } from "../src/release/runner";

const SENTINEL = "SENTINEL_secret_value_that_must_never_be_printed_0123456789";

/** A probe that answers nothing — every check "could not run". */
const inertProbe: HostProbe = {
  label: () => "inert",
  now: () => new Date(0),
  run: () => ({ ran: false, code: null, stdout: "", stderr: "", reason: "not recorded" }),
  read: () => ({ ok: false, content: null, reason: "not recorded" }),
  stat: () => ({ exists: false }),
  searchTree: () => ({ ran: false, hits: {}, scannedFiles: 0, reason: "not recorded" }),
};

const suiteOf = (...checks: Check[]): Suite => ({ name: "UNIT", title: "unit suite", checks });

describe("release runner — fail-closed policy", () => {
  it("treats a safety check that cannot run as a NO-GO, not a pass", () => {
    const report = evaluate(
      suiteOf({ id: "S1", title: "cannot run", severity: "safety", run: () => ({ status: "skip", reason: "no data" }) }),
      inertProbe,
    );
    expect(report.verdict).toBe("FAIL");
    expect(report.exitCode).toBe(1);
    expect(report.counts.blocking).toEqual(["S1"]);
    // It is reported as "could not run", never as a failure of the thing checked.
    expect(report.results[0].outcome.status).toBe("skip");
  });

  it("treats a safety check that fails as a NO-GO", () => {
    const report = evaluate(
      suiteOf({ id: "S2", title: "fails", severity: "safety", run: () => ({ status: "fail", reason: "bad" }) }),
      inertProbe,
    );
    expect(report.verdict).toBe("FAIL");
    expect(report.exitCode).toBe(1);
  });

  it("lets an advisory check that CANNOT RUN through without blocking", () => {
    // The advisory rows that legitimately cannot run on the host (P0.1 build
    // gate, P0.3 toolchain, P1.7 Vercel) are assigned to another venue by the
    // runbook: they are reported and must not gate the host run.
    const report = evaluate(
      suiteOf(
        { id: "A1", title: "advisory pass", severity: "advisory", run: () => ({ status: "pass", evidence: "fine" }) },
        { id: "A2", title: "advisory skip", severity: "advisory", run: () => ({ status: "skip", reason: "off-host by design" }) },
      ),
      inertProbe,
    );
    expect(report.verdict).toBe("PASS");
    expect(report.exitCode).toBe(0);
    expect(report.counts.blocking).toEqual([]);
  });

  it("treats an advisory FAILURE as a warning that stops the run", () => {
    // §1 P0: "Every check has a stated pass signal. Do not proceed on a
    // warning." An advisory row that FAILS is a warning, so it gates exactly
    // like a safety failure. (Previously it rendered as a cosmetic `warn` and
    // the run still returned PASS — the defect this pins.)
    const report = evaluate(
      suiteOf({ id: "A3", title: "advisory fail", severity: "advisory", run: () => ({ status: "fail", reason: "wrong unit" }) }),
      inertProbe,
    );
    expect(report.verdict).toBe("FAIL");
    expect(report.exitCode).toBe(1);
    expect(report.counts.blocking).toEqual(["A3"]);
    expect(renderReport(report, { redactor: createRedactor() })).toContain("[FAIL] A3");
  });

  it("counts a check that throws as could-not-run rather than a pass", () => {
    const report = evaluate(
      suiteOf({
        id: "S3",
        title: "throws",
        severity: "safety",
        run: () => {
          throw new Error("boom");
        },
      }),
      inertProbe,
    );
    expect(report.results[0].outcome.status).toBe("skip");
    expect(report.verdict).toBe("FAIL");
  });

  it("passes only when every safety check passes", () => {
    const report = evaluate(
      suiteOf(
        { id: "S4", title: "ok", severity: "safety", run: () => ({ status: "pass", evidence: "fine" }) },
        { id: "A3", title: "advisory skip", severity: "advisory", run: () => ({ status: "skip", reason: "n/a" }) },
      ),
      inertProbe,
    );
    expect(report.verdict).toBe("PASS");
    expect(report.exitCode).toBe(0);
    expect(renderReport(report, { redactor: createRedactor() })).toContain("UNIT: PASS");
  });
});

describe("release output — the never-print-a-secret rule", () => {
  it("masks a registered secret even when a check puts it in its evidence", () => {
    const leaky = suiteOf({
      id: "L1",
      title: "deliberately leaky check",
      severity: "safety",
      run: () => ({ status: "fail", reason: `value was ${SENTINEL} in plain view`, evidence: `raw=${SENTINEL}` }),
    });
    const rendered = renderReport(evaluate(leaky, inertProbe), { redactor: createRedactor([SENTINEL]) });
    expect(rendered).not.toContain(SENTINEL);
    expect(rendered).toContain("[REDACTED]");
  });

  it("masks the secret in the JSON rendering too", () => {
    const leaky = suiteOf({
      id: "L2",
      title: `title with ${SENTINEL}`,
      severity: "safety",
      run: () => ({ status: "pass", evidence: SENTINEL }),
    });
    const rendered = renderReport(evaluate(leaky, inertProbe), { format: "json", redactor: createRedactor([SENTINEL]) });
    expect(rendered).not.toContain(SENTINEL);
    expect(rendered).toContain("[REDACTED]");
    expect((JSON.parse(rendered) as { verdict: string }).verdict).toBe("PASS");
  });

  it("ignores short values so ordinary output is not masked", () => {
    const redactor = createRedactor(["abc", "", "1234567"]);
    expect(redactor.size()).toBe(0);
    expect(redactor.scrub("abc 1234567")).toBe("abc 1234567");
  });
});

describe("env metadata — values are not reachable through the metadata", () => {
  const content = [
    "# comment",
    "NEXUP_BRIDGE_HMAC_SECRET=" + SENTINEL,
    "NEXUP_BRIDGE_ALLOWED_KEY_IDS=nexup-vercel,other-key",
    "HERMES_PROFILE=saieed",
    "QUOTED=\"quoted value\"",
  ].join("\n");

  it("exposes presence, length and equality — never the value", () => {
    const env = parseEnvMetadata(content);
    expect(env.names.has("NEXUP_BRIDGE_HMAC_SECRET")).toBe(true);
    expect(env.lengthOf("NEXUP_BRIDGE_HMAC_SECRET")).toBe(SENTINEL.length);
    expect(env.equals("HERMES_PROFILE", "saieed")).toBe(true);
    expect(env.equals("HERMES_PROFILE", "default")).toBe(false);
    expect(env.includesToken("NEXUP_BRIDGE_ALLOWED_KEY_IDS", "nexup-vercel")).toBe(true);
    expect(env.includesToken("NEXUP_BRIDGE_ALLOWED_KEY_IDS", "absent")).toBe(false);
    // The only place a value is carried is the redaction list.
    expect(env.secretValues).toEqual([SENTINEL]);
    expect(JSON.stringify([...env.names])).not.toContain(SENTINEL);
    expect(env.lengthOf("NEXUP_BRIDGE_HMAC_SECRET")).not.toBe(SENTINEL);
  });

  it("detects a default profile assignment anywhere in the file", () => {
    expect(parseEnvMetadata("HERMES_PROFILE=default\n").assignsDefaultProfile).toBe(true);
    expect(parseEnvMetadata("HERMES_PROFILE=saieed\n").assignsDefaultProfile).toBe(false);
    expect(parseEnvMetadata("HERMES_RUNTIME_PROFILE=default\n").assignsDefaultProfile).toBe(true);
  });

  it("unquotes values before measuring them", () => {
    expect(parseEnvMetadata('HERMES_PROFILE="saieed"\n').equals("HERMES_PROFILE", "saieed")).toBe(true);
  });
});

describe("listener parsing", () => {
  it("extracts addresses and ports, including bracketed IPv6", () => {
    const listeners = parseListeners(
      [
        "State  Recv-Q Send-Q Local Address:Port Peer Address:Port Process",
        'LISTEN 0      128    127.0.0.1:9119       0.0.0.0:*         users:(("hermes",pid=421,fd=21))',
        "LISTEN 0      128    [::]:9220            [::]:*            users:((\"node\",pid=900,fd=19))",
      ].join("\n"),
    );
    expect(listeners).toEqual([
      { address: "127.0.0.1", port: 9119 },
      { address: "[::]", port: 9220 },
    ]);
    expect(isLoopbackAddress("127.0.0.1")).toBe(true);
    expect(isLoopbackAddress("[::1]")).toBe(true);
    expect(isLoopbackAddress("0.0.0.0")).toBe(false);
    expect(isLoopbackAddress("[::]")).toBe(false);
  });
});

describe("recorded probe — a missing recording is 'could not run', never a pass", () => {
  it("reports an unrecorded command, file and tree as unrunnable", () => {
    const probe = createRecordedProbe({ label: "empty" }, "empty.json");
    expect(probe.run("ss", ["-ltnp"]).ran).toBe(false);
    expect(probe.read("/etc/nexup-bridge/bridge.env").ok).toBe(false);
    expect(probe.stat("/opt/nexup-bridge").exists).toBe(false);
    expect(probe.searchTree("/opt/hermes", ["gateway.ping"]).ran).toBe(false);
  });

  it("replays recorded commands and files verbatim", () => {
    const probe = createRecordedProbe(
      { commands: { "ss -ltnp": { stdout: "LISTEN 0 1 127.0.0.1:9119 0.0.0.0:*\n" } }, files: { "/x": "hello" } },
      "mini.json",
    );
    expect(probe.run("ss", ["-ltnp"]).stdout).toContain("127.0.0.1:9119");
    expect(probe.read("/x").content).toBe("hello");
    expect(probe.run("unrecorded").ran).toBe(false);
  });
});
