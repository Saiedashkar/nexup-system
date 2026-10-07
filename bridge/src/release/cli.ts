import { readFileSync } from "node:fs";

import { createHermesCompatSuite, type CompatOptions } from "./hermes-compat";
import { createRedactor, renderReport, type ReportFormat } from "./output";
import { createPreflightSuite, type PreflightOptions } from "./preflight";
import { createLiveProbe, createRecordedProbe, type RecordedFixture } from "./probe";
import { evaluate, type HostProbe, type SuiteReport } from "./runner";

/**
 * NEXUP release-engineering CLI.
 *
 *   node bridge/dist/release-cli.js preflight     [options]   # A: read-only VPS pre-flight
 *   node bridge/dist/release-cli.js hermes-compat [options]   # B: Hermes method compatibility
 *
 * Both subcommands share one runner, one output module and one exit-code
 * policy, so a safety-critical failure is a NO-GO in both by construction.
 *
 * `--fixture <file.json>` replays a recorded host instead of the local machine.
 * That is how the tool is exercised without a Linux host, and it keeps the LIVE
 * path and the tested path identical.
 */

const USAGE = [
  "NEXUP release-engineering probes (read-only; never deploys, never contacts Hermes)",
  "",
  "USAGE",
  "  node bridge/dist/release-cli.js preflight     [options]",
  "  node bridge/dist/release-cli.js hermes-compat [options]",
  "",
  "COMMON",
  "  --fixture <file.json>   Replay a recorded host instead of this machine",
  "  --json                  Machine-readable report",
  "  --help                  This text",
  "",
  "PREFLIGHT",
  "  --env-file <path>       Bridge env file        (default /etc/nexup-bridge/bridge.env)",
  "  --compose <path>        Deployment definition  (default /opt/nexup-bridge/docker-compose.bridge.yml)",
  "  --image <ref>           Judge THIS image reference instead of the one the deployment",
  "                          definition resolves (the default: the digest-pinned identity in",
  "                          ${NEXUP_BRIDGE_IMAGE}, which is what the deployment runs)",
  "  --expected-digest <sha> Digest recorded when the image was built (runbook P0)",
  "  --bridge-hostname <h>   Hostname the router must serve (checked in P0.7b)",
  "  --exec-probes           Allow the THREE execution checks: P0.2c greps the bundle inside",
  "                          the image, P0.6 runs it with an invalid bind so it exits before",
  "                          binding, P4.12 opens one TCP connection to the serve endpoint.",
  "                          None of them changes state. Off by default.",
  "  --min-free-mib <n>      Free-space floor on / (default 200)",
  "  --hermes-src <dir>      Installed Hermes tree; without it the P2 checks cannot run (NO-GO)",
  "  --accept-degraded       Record an explicit acceptance of a missing gateway.ping (runbook §6.5)",
  "",
  "HERMES-COMPAT",
  "  --hermes-src <dir>      Installed Hermes tree to search (required; otherwise NO-GO)",
  "  --accept-degraded       Record an explicit acceptance of a missing gateway.ping (runbook §6.5)",
  "",
  "EXIT",
  "  0 = PASS   1 = FAIL / NO-GO   2 = usage error",
  "  A safety-critical check that FAILS or CANNOT RUN is a NO-GO.",
].join("\n");

export type CliIo = { out(text: string): void; err(text: string): void };

const defaultIo: CliIo = {
  out: (text) => process.stdout.write(`${text}\n`),
  err: (text) => process.stderr.write(`${text}\n`),
};

type Parsed = {
  command: "preflight" | "hermes-compat" | null;
  format: ReportFormat;
  fixture?: string;
  help: boolean;
  unknown: string[];
  preflight: PreflightOptions;
};

export function parseArgs(argv: readonly string[]): Parsed {
  const parsed: Parsed = { command: null, format: "text", help: false, unknown: [], preflight: {} };
  const next = (index: number, flag: string): string | undefined => {
    const value = argv[index + 1];
    if (value === undefined || value.startsWith("--")) {
      parsed.unknown.push(`${flag} needs a value`);
      return undefined;
    }
    return value;
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "preflight" || arg === "hermes-compat") {
      parsed.command ??= arg;
      continue;
    }
    switch (arg) {
      case "--help":
      case "-h":
        parsed.help = true;
        break;
      case "--json":
        parsed.format = "json";
        break;
      case "--fixture":
        parsed.fixture = next(index, arg) ?? parsed.fixture;
        index += 1;
        break;
      case "--env-file":
        parsed.preflight.envFile = next(index, arg) ?? parsed.preflight.envFile;
        index += 1;
        break;
      case "--compose":
        parsed.preflight.composePath = next(index, arg) ?? parsed.preflight.composePath;
        index += 1;
        break;
      case "--image":
        parsed.preflight.image = next(index, arg) ?? parsed.preflight.image;
        index += 1;
        break;
      case "--bridge-hostname":
        parsed.preflight.bridgeHostname = next(index, arg) ?? parsed.preflight.bridgeHostname;
        index += 1;
        break;
      case "--expected-digest":
        parsed.preflight.expectedDigest = next(index, arg) ?? parsed.preflight.expectedDigest;
        index += 1;
        break;
      case "--hermes-src":
        parsed.preflight.hermesSrc = next(index, arg) ?? parsed.preflight.hermesSrc;
        index += 1;
        break;
      case "--min-free-mib": {
        const value = next(index, arg);
        if (value !== undefined) {
          // A rejected input, not a check: NaN would silently propagate into the
          // free-space comparison and report "below the NaN MiB floor". Refuse it
          // as a usage error instead (exit 2), before any probe runs.
          const threshold = Number(value);
          if (!Number.isInteger(threshold) || threshold <= 0) {
            parsed.unknown.push(`--min-free-mib needs a positive integer, got "${value}"`);
          } else {
            parsed.preflight.minFreeMiB = threshold;
          }
        }
        index += 1;
        break;
      }
      case "--exec-probes":
        parsed.preflight.execProbes = true;
        break;
      case "--accept-degraded":
        parsed.preflight.acceptedDegraded = true;
        break;
      default:
        if (arg.startsWith("--")) parsed.unknown.push(`unknown option ${arg}`);
    }
  }
  return parsed;
}

/** Selects the host seam. A fixture never touches the local machine. */
export function probeFor(parsed: Parsed, io: CliIo = defaultIo): HostProbe | null {
  if (!parsed.fixture) return createLiveProbe();
  try {
    const fixture = JSON.parse(readFileSync(parsed.fixture, "utf8")) as RecordedFixture;
    return createRecordedProbe(fixture, parsed.fixture);
  } catch (error) {
    io.err(`could not read fixture ${parsed.fixture}: ${error instanceof Error ? error.message : String(error)}`);
    return null;
  }
}

export function runReleaseCli(argv: readonly string[], io: CliIo = defaultIo): number {
  const parsed = parseArgs(argv);

  if (parsed.help || parsed.command === null) {
    io.out(USAGE);
    return parsed.command === null && !parsed.help ? 2 : 0;
  }
  if (parsed.unknown.length > 0) {
    for (const problem of parsed.unknown) io.err(problem);
    io.err("");
    io.out(USAGE);
    return 2;
  }

  const probe = probeFor(parsed, io);
  if (!probe) return 2;

  let report: SuiteReport;
  if (parsed.command === "preflight") {
    const { suite, secrets } = createPreflightSuite(probe, parsed.preflight);
    const redactor = createRedactor(secrets);
    report = evaluate(suite, probe);
    io.out(
      renderReport(report, {
        format: parsed.format,
        redactor,
        banner: suite.banner,
      }),
    );
    return report.exitCode;
  }

  const compat: CompatOptions = {
    ...(parsed.preflight.hermesSrc ? { hermesSrc: parsed.preflight.hermesSrc } : {}),
    ...(parsed.preflight.acceptedDegraded ? { acceptedDegraded: true } : {}),
  };
  const suite = createHermesCompatSuite(probe, compat);
  const redactor = createRedactor();
  report = evaluate(suite, probe);
  io.out(renderReport(report, { format: parsed.format, redactor, banner: suite.banner }));
  return report.exitCode;
}

/* Only auto-run when executed directly (`node dist/release-cli.js ...`). */
if (typeof require !== "undefined" && require.main === module) {
  process.exitCode = runReleaseCli(process.argv.slice(2));
}
