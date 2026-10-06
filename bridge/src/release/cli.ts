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
  "  --bundle <path>         Shipped bundle         (default /opt/nexup-bridge/dist/main.js)",
  "  --unit <path>           systemd unit           (default /etc/systemd/system/nexup-bridge.service)",
  "  --caddyfile <path>      Caddy site config      (default /etc/caddy/Caddyfile)",
  "  --expected-digest <sha> Digest recorded in runbook P0; compared with the host copy",
  "  --exec-probes           Allow ONE execution check: P0.6 runs the bundle with an invalid",
  "                          host address so it exits before binding. Off by default.",
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
      case "--bundle":
        parsed.preflight.bundlePath = next(index, arg) ?? parsed.preflight.bundlePath;
        index += 1;
        break;
      case "--unit":
        parsed.preflight.unitPath = next(index, arg) ?? parsed.preflight.unitPath;
        index += 1;
        break;
      case "--caddyfile":
        parsed.preflight.caddyfilePath = next(index, arg) ?? parsed.preflight.caddyfilePath;
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
        if (value !== undefined) parsed.preflight.minFreeMiB = Number.parseInt(value, 10);
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
  io.out(renderReport(report, { format: parsed.format, redactor }));
  return report.exitCode;
}

/* Only auto-run when executed directly (`node dist/release-cli.js ...`). */
if (typeof require !== "undefined" && require.main === module) {
  process.exitCode = runReleaseCli(process.argv.slice(2));
}
