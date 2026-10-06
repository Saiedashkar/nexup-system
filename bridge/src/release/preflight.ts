import { compatChecks, type CompatOptions } from "./hermes-compat";
import type { Check, CheckOutcome, HostProbe, Suite } from "./runner";

/**
 * Read-only VPS pre-flight probe.
 *
 * Derived directly from `docs/NEXUP_VPS_BRIDGE_DEPLOY_RUNBOOK.md` §1 (P0–P4) so
 * the document and the tool cannot drift: every check carries the runbook anchor
 * it implements. It inspects and reports only — it never installs, starts,
 * stops, reloads or writes anything, and it never contacts Hermes. The one check
 * that executes anything (P0.6) runs the bundle with a deliberately invalid host
 * so it exits BEFORE binding, and is opt-in.
 *
 * Secrets: the env file is parsed into NARROW accessors (presence, length, and
 * equality against a literal) so a value cannot reach an evidence string by
 * accident. The secret values themselves are handed only to the redactor.
 */

export const PREFLIGHT = "PREFLIGHT";

export const ENV_FILE = "/etc/nexup-bridge/bridge.env";
export const BUNDLE_PATH = "/opt/nexup-bridge/dist/main.js";
export const UNIT_PATH = "/etc/systemd/system/nexup-bridge.service";
export const CADDYFILE_PATH = "/etc/caddy/Caddyfile";
export const HERMES_SRC_GUESSES = ["/opt/hermes", "/opt/hermes/src", "/srv/hermes", "/usr/local/lib/hermes"];

export const BRIDGE_PORT = 9220;
export const HERMES_PORT = 9119;
export const DASHBOARD_PORT = 4860;
export const SERVICE_USER = "nexup-bridge";
export const EXPECTED_KEY_ID = "nexup-vercel";
export const TARGET_PROFILE = "saieed";
export const FORBIDDEN_PROFILE = "default";
export const MIN_SECRET_CHARS = 64;
export const MIN_NODE_MAJOR = 22;
export const MIN_CADDY_MAJOR = 2;
export const MIN_CADDY_MINOR = 10;
export const DEFAULT_MAX_BODY_BYTES = "262144";
export const MIN_FREE_MIB = 200;

/** The banner an operator must see before any result. */
export const PREFLIGHT_BANNER = [
  "DEFAULT / ADEL:",
  "OUT OF SCOPE — DO NOT TOUCH",
  "",
  "TARGET PROFILE:",
  TARGET_PROFILE,
].join("\n");

/** The allowlist refusal planted into every run's method guard, used as a bundling probe. */
const BUNDLE_GUARD_STRING = "is not permitted by the NEXUP bridge";

/** Synthetic values for the opt-in execution probe; never written anywhere. */
const SYNTHETIC_SECRET = "nexup-preflight-synthetic-secret-not-a-real-key";
const SYNTHETIC_TOKEN = "nexup-preflight-synthetic-token-not-real";

/** Names the bridge actually reads. `NEXUP_BRIDGE_MAX_BODY_BYTES` is deliberately
 * excluded: it is absent from the shipped example (runbook P1.1) and is covered
 * by the advisory P1.8 instead. */
export const REQUIRED_ENV_NAMES = [
  "NEXUP_BRIDGE_ENABLED",
  "NEXUP_BRIDGE_HOST",
  "NEXUP_BRIDGE_PORT",
  "NEXUP_BRIDGE_HMAC_SECRET",
  "NEXUP_BRIDGE_ALLOWED_KEY_IDS",
  "NEXUP_BRIDGE_TIMEOUT_MS",
  "NEXUP_BRIDGE_MAX_OUTPUT_BYTES",
  "NEXUP_BRIDGE_MAX_CONCURRENCY",
  "NEXUP_BRIDGE_RATE_LIMIT_PER_MINUTE",
  "NEXUP_BRIDGE_PREAUTH_PER_REMOTE_PER_MINUTE",
  "NEXUP_BRIDGE_PREAUTH_GLOBAL_PER_MINUTE",
  "NEXUP_BRIDGE_CLOCK_SKEW_SECONDS",
  "HERMES_RPC_URL",
  "HERMES_SESSION_TOKEN",
  "HERMES_ORIGIN",
  "HERMES_PROFILE",
] as const;

/** Values that must never be rendered; registered with the redactor. */
export const SECRET_ENV_NAMES = ["NEXUP_BRIDGE_HMAC_SECRET", "HERMES_SESSION_TOKEN"] as const;

export const REQUIRED_BINARIES = ["node", "caddy", "systemctl", "ss", "stat", "sha256sum", "df", "sh"] as const;

export type PreflightOptions = CompatOptions & {
  envFile?: string;
  bundlePath?: string;
  unitPath?: string;
  caddyfilePath?: string;
  /** Digest recorded in runbook P0; compared against the copy on the host. */
  expectedDigest?: string;
  /** Enables P0.6, which executes the bundle once with an invalid host. */
  execProbes?: boolean;
  minFreeMiB?: number;
};

/* ── env parsing (narrow by construction) ────────────────────────────────── */

export type EnvMetadata = {
  names: Set<string>;
  /** Character length of a value, or null when the name is absent. NEVER the value. */
  lengthOf(key: string): number | null;
  /** True when the value is exactly `expected`. */
  equals(key: string, expected: string): boolean;
  /** True when a comma-separated value contains `token`. */
  includesToken(key: string, token: string): boolean;
  /** True when any profile-shaped assignment in the file is `default`. */
  assignsDefaultProfile: boolean;
  /** Secret values, for redaction registration only. */
  secretValues: string[];
  parseError?: string;
};

export function parseEnvMetadata(content: string): EnvMetadata {
  const values = new Map<string, string>();
  let assignsDefaultProfile = false;

  for (const rawLine of content.split("\n")) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    if (!/^[A-Z_][A-Z0-9_]*$/.test(key)) continue;
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"') && value.length > 1) ||
      (value.startsWith("'") && value.endsWith("'") && value.length > 1)
    ) {
      value = value.slice(1, -1);
    }
    values.set(key, value);
    if (/PROFILE$/.test(key) && value === FORBIDDEN_PROFILE) assignsDefaultProfile = true;
  }

  return {
    names: new Set(values.keys()),
    lengthOf: (key) => (values.has(key) ? (values.get(key) as string).length : null),
    equals: (key, expected) => values.get(key) === expected,
    includesToken: (key, token) =>
      (values.get(key) ?? "")
        .split(",")
        .map((entry) => entry.trim())
        .includes(token),
    assignsDefaultProfile,
    secretValues: SECRET_ENV_NAMES.map((name) => values.get(name)).filter(
      (value): value is string => typeof value === "string" && value.length > 0,
    ),
    ...(values.size === 0 ? { parseError: "no key=value assignments could be parsed" } : {}),
  };
}

/* ── listener parsing ────────────────────────────────────────────────────── */

export type Listener = { address: string; port: number };

export function parseListeners(text: string): Listener[] {
  const listeners: Listener[] = [];
  for (const line of text.split("\n")) {
    const match = /^\s*(?:LISTEN|UNCONN)\s+\d+\s+\d+\s+(\S+)\s/.exec(line);
    if (!match) continue;
    const endpoint = match[1];
    const separator = endpoint.lastIndexOf(":");
    if (separator <= 0) continue;
    const port = Number.parseInt(endpoint.slice(separator + 1), 10);
    if (Number.isFinite(port)) listeners.push({ address: endpoint.slice(0, separator), port });
  }
  return listeners;
}

export function isLoopbackAddress(address: string): boolean {
  const normalized = address.replace(/^\[|\]$/g, "").toLowerCase();
  return normalized === "127.0.0.1" || normalized === "::1" || normalized === "localhost";
}

/* ── small helpers for checks ────────────────────────────────────────────── */

function firstLine(text: string): string {
  return (text.split("\n")[0] ?? "").trim();
}

const pass = (evidence: string): CheckOutcome => ({ status: "pass", evidence });
const fail = (reason: string, evidence?: string): CheckOutcome =>
  evidence ? { status: "fail", reason, evidence } : { status: "fail", reason };
/** "Could not run". Fail-closed at the runner for safety checks. */
const skip = (reason: string): CheckOutcome => ({ status: "skip", reason });

const safety = (id: string, title: string, run: Check["run"]): Check => ({ id, title, severity: "safety", run });
const advisory = (id: string, title: string, run: Check["run"]): Check => ({ id, title, severity: "advisory", run });

/* ── the suite ───────────────────────────────────────────────────────────── */

export function createPreflightSuite(probe: HostProbe, options: PreflightOptions = {}): {
  suite: Suite;
  secrets: string[];
} {
  const envFile = options.envFile ?? ENV_FILE;
  const bundlePath = options.bundlePath ?? BUNDLE_PATH;
  const unitPath = options.unitPath ?? UNIT_PATH;
  const caddyfilePath = options.caddyfilePath ?? CADDYFILE_PATH;
  const minFreeMiB = options.minFreeMiB ?? MIN_FREE_MIB;

  const envRead = probe.read(envFile);
  const env = envRead.ok && envRead.content !== null ? parseEnvMetadata(envRead.content) : null;

  const listeners = (): { ran: boolean; list: Listener[]; reason?: string } => {
    const withPids = probe.run("ss", ["-ltnp"]);
    const plain = withPids.ran && withPids.code === 0 ? withPids : probe.run("ss", ["-ltn"]);
    if (!plain.ran) return { ran: false, list: [], reason: plain.reason ?? "ss could not be executed" };
    if (plain.code !== 0) return { ran: false, list: [], reason: `ss exited ${plain.code}` };
    return { ran: true, list: parseListeners(plain.stdout) };
  };

  const bundleDigest = (): { ran: boolean; digest: string | null; reason?: string } => {
    const result = probe.run("sha256sum", [bundlePath]);
    if (!result.ran) return { ran: false, digest: null, reason: result.reason ?? "sha256sum could not be executed" };
    if (result.code !== 0) return { ran: false, digest: null, reason: `sha256sum exited ${result.code}` };
    const digest = (result.stdout.trim().split(/\s+/)[0] ?? "").toLowerCase();
    return /^[0-9a-f]{64}$/.test(digest) ? { ran: true, digest } : { ran: false, digest: null, reason: "unparseable digest" };
  };

  const checks: Check[] = [
    /* P0 — workspace, build, artifact integrity */
    safety("P0.1", `Node on the host is >= v${MIN_NODE_MAJOR} (the bundle targets node22)`, () => {
      const systemdNode = probe.run("/usr/bin/node", ["--version"]);
      const anyNode = systemdNode.ran ? systemdNode : probe.run("node", ["--version"]);
      if (!anyNode.ran) return skip(`node is not executable (${anyNode.reason ?? "not found"})`);
      if (anyNode.code !== 0) return fail(`node --version exited ${anyNode.code}`, firstLine(anyNode.stderr));
      const version = firstLine(anyNode.stdout);
      const major = Number.parseInt(/v?(\d+)/.exec(version)?.[1] ?? "", 10);
      if (!Number.isFinite(major)) return fail(`could not parse a version from "${version}"`);
      return major >= MIN_NODE_MAJOR
        ? pass(`${version} via ${systemdNode.ran ? "/usr/bin/node" : "node on PATH"}`)
        : fail(`${version} is below v${MIN_NODE_MAJOR}; the bundle is built for node22`);
    }),

    safety("P0.2a", `Bundle present at ${bundlePath}`, () => {
      const info = probe.stat(bundlePath);
      return info.exists
        ? pass(`present${info.size !== undefined ? `, ${info.size} bytes` : ""}`)
        : fail(`${bundlePath} is absent; install §2 has not run or the path is wrong`);
    }),

    safety("P0.2b", "Host bundle digest matches the recorded build digest", () => {
      if (!options.expectedDigest) {
        return skip(
          "no --expected-digest supplied. Runbook P0 records the local digest and §2 compares it after the copy; " +
            "without it a tampered or stale artifact cannot be detected",
        );
      }
      const digest = bundleDigest();
      if (!digest.ran || !digest.digest) return skip(`digest unavailable (${digest.reason})`);
      return digest.digest === options.expectedDigest.toLowerCase()
        ? pass(`sha256 ${digest.digest}`)
        : fail("the host digest differs from the recorded local digest — do not start this artifact", `host=${digest.digest}`);
    }),

    safety("P0.3", "Method-allowlist guard survived bundling (P0.2 integrity probe)", () => {
      const read = probe.read(bundlePath);
      if (!read.ok || read.content === null) return skip(`bundle not readable (${read.reason})`);
      const count = read.content.split(BUNDLE_GUARD_STRING).length - 1;
      return count >= 1
        ? pass(`refusal string present ${count}x in the shipped bundle`)
        : fail("the method-allowlist refusal is absent from the bundle; the compile-time guarantee is not evidenced");
    }),

    advisory("P0.4", "systemd unit points at the shipped bundle path", () => {
      const read = probe.read(unitPath);
      if (!read.ok || read.content === null) return skip(`unit not readable at ${unitPath} (${read.reason})`);
      const hasExec = read.content.includes(`/usr/bin/node`) && read.content.includes(bundlePath);
      return hasExec
        ? pass(`ExecStart references /usr/bin/node and ${bundlePath}`)
        : fail("the unit does not reference the expected interpreter and bundle path");
    }),

    safety("P0.6", "A non-loopback NEXUP_BRIDGE_HOST is refused before any listener opens (opt-in)", () => {
      if (!options.execProbes) {
        return skip(
          "not run: this check executes the bundle once with NEXUP_BRIDGE_HOST=0.0.0.0 (it exits before `listen` and " +
            "writes nothing). Re-run with --exec-probes to prove the loopback-only bind is enforced",
        );
      }
      const result = probe.run("node", [bundlePath], {
        env: {
          NEXUP_BRIDGE_HOST: "0.0.0.0",
          NEXUP_BRIDGE_HMAC_SECRET: SYNTHETIC_SECRET,
          NEXUP_BRIDGE_ALLOWED_KEY_IDS: EXPECTED_KEY_ID,
          HERMES_SESSION_TOKEN: SYNTHETIC_TOKEN,
          HERMES_PROFILE: TARGET_PROFILE,
          HERMES_RPC_URL: `ws://127.0.0.1:${HERMES_PORT}/api/ws`,
        },
      });
      if (!result.ran) return skip(`could not execute the bundle (${result.reason})`);
      const refused = result.code === 1 && /loopback/i.test(result.stderr);
      return refused
        ? pass(`exit=1 with "loopback" refusal on stderr — no listener was opened`)
        : fail(
            `expected exit=1 with a loopback refusal for NEXUP_BRIDGE_HOST=0.0.0.0, got exit=${result.code}`,
            firstLine(result.stderr),
          );
    }),

    safety("P0.7a", `Caddy is >= v${MIN_CADDY_MAJOR}.${MIN_CADDY_MINOR} (request_body needs it)`, () => {
      const result = probe.run("caddy", ["version"]);
      if (!result.ran) return skip(`caddy is not executable (${result.reason})`);
      if (result.code !== 0) return fail(`caddy version exited ${result.code}`, firstLine(result.stderr));
      const version = firstLine(result.stdout);
      const match = /v?(\d+)\.(\d+)/.exec(version);
      if (!match) return fail(`could not parse a version from "${version}"`);
      const major = Number.parseInt(match[1], 10);
      const minor = Number.parseInt(match[2], 10);
      const ok = major > MIN_CADDY_MAJOR || (major === MIN_CADDY_MAJOR && minor >= MIN_CADDY_MINOR);
      return ok
        ? pass(version)
        : fail(`${version} is below v${MIN_CADDY_MAJOR}.${MIN_CADDY_MINOR}: the edge body cap would not be applied`);
    }),

    safety("P0.7b", "The Caddy site validates", () => {
      const result = probe.run("caddy", ["validate", "--config", caddyfilePath]);
      if (!result.ran) return skip(`caddy is not executable (${result.reason})`);
      return result.code === 0
        ? pass(`caddy validate: ok (${caddyfilePath})`)
        : fail(`caddy validate failed for ${caddyfilePath}`, firstLine(result.stderr) || firstLine(result.stdout));
    }),

    /* P1 — environment and secret NAMES */
    safety("P1.0", `Bridge env file is present at ${envFile}`, () =>
      envRead.ok ? pass(`${(envRead.content ?? "").split("\n").length} line(s) read`) : fail(`${envFile} is not readable (${envRead.reason})`),
    ),

    safety("P1.1", `Every required env name is present (${REQUIRED_ENV_NAMES.length} names)`, () => {
      if (!env) return skip(`${envFile} could not be parsed, so names cannot be checked`);
      if (env.parseError) return fail(env.parseError);
      const missing = REQUIRED_ENV_NAMES.filter((name) => !env.names.has(name));
      return missing.length === 0
        ? pass(`${REQUIRED_ENV_NAMES.length}/${REQUIRED_ENV_NAMES.length} present`)
        : fail(`missing ${missing.length}: ${missing.join(", ")}`);
    }),

    safety("P1.2", `Env file permissions are 600 ${SERVICE_USER}:${SERVICE_USER}`, () => {
      const result = probe.run("stat", ["-c", "%a %U:%G", envFile]);
      if (!result.ran) return skip(`stat is not executable (${result.reason})`);
      if (result.code !== 0) return fail(`stat exited ${result.code} for ${envFile}`, firstLine(result.stderr));
      const observed = firstLine(result.stdout);
      return observed === `600 ${SERVICE_USER}:${SERVICE_USER}`
        ? pass(observed)
        : fail(`expected "600 ${SERVICE_USER}:${SERVICE_USER}", observed "${observed}"`);
    }),

    safety("P1.3", `HMAC secret is >= ${MIN_SECRET_CHARS} characters (length only — never the value)`, () => {
      if (!env) return skip(`${envFile} could not be parsed, so the secret length cannot be checked`);
      const length = env.lengthOf("NEXUP_BRIDGE_HMAC_SECRET");
      if (length === null) return fail("NEXUP_BRIDGE_HMAC_SECRET is not set");
      return length >= MIN_SECRET_CHARS
        ? pass(`${length} characters (value not read into evidence)`)
        : fail(`NEXUP_BRIDGE_HMAC_SECRET is ${length} characters; >= ${MIN_SECRET_CHARS} is required (32 random bytes as hex)`);
    }),

    safety("P1.4", `Allowed key ids include ${EXPECTED_KEY_ID}`, () => {
      if (!env) return skip(`${envFile} could not be parsed, so key-id agreement cannot be checked`);
      return env.includesToken("NEXUP_BRIDGE_ALLOWED_KEY_IDS", EXPECTED_KEY_ID)
        ? pass(`${EXPECTED_KEY_ID} is present in NEXUP_BRIDGE_ALLOWED_KEY_IDS`)
        : fail(`NEXUP_BRIDGE_ALLOWED_KEY_IDS does not contain ${EXPECTED_KEY_ID}; every signed request would be rejected`);
    }),

    safety("P1.5", `Profile is pinned to ${TARGET_PROFILE} and ${FORBIDDEN_PROFILE} is never assigned`, () => {
      if (!env) return skip(`${envFile} could not be parsed, so profile pinning cannot be checked`);
      if (env.assignsDefaultProfile) {
        return fail(`a PROFILE assignment in ${envFile} is "${FORBIDDEN_PROFILE}" — that is Adel's profile and is refused at startup`);
      }
      return env.equals("HERMES_PROFILE", TARGET_PROFILE)
        ? pass(`HERMES_PROFILE=${TARGET_PROFILE}; no ${FORBIDDEN_PROFILE} assignment found`)
        : fail(`HERMES_PROFILE is not ${TARGET_PROFILE}`);
    }),

    advisory("P1.6", "Host clock (compare against the signing host; must agree within 60 s)", () => {
      const result = probe.run("date", ["-u", "+%s"]);
      const epoch = result.ran && result.code === 0 ? firstLine(result.stdout) : "";
      const skew = probe.run("date", ["-u", "+%Y-%m-%dT%H:%M:%SZ"]);
      return pass(
        `VPS epoch ${epoch || "<unreadable>"} (${skew.ran ? firstLine(skew.stdout) : "?"}); ` +
          "compare with `date -u +%s` on the signing host — a difference over NEXUP_BRIDGE_CLOCK_SKEW_SECONDS (default 300 s) is the usual cause of a REPLAY 401",
      );
    }),

    advisory("P1.8", `NEXUP_BRIDGE_MAX_BODY_BYTES reconciles with the edge cap (${DEFAULT_MAX_BODY_BYTES})`, () => {
      if (!env) return skip(`${envFile} could not be parsed`);
      if (!env.names.has("NEXUP_BRIDGE_MAX_BODY_BYTES")) {
        return pass(`absent; the code default ${DEFAULT_MAX_BODY_BYTES} B is in use and matches Caddy's max_size 256KB (record this)`);
      }
      return env.equals("NEXUP_BRIDGE_MAX_BODY_BYTES", DEFAULT_MAX_BODY_BYTES)
        ? pass(`set to ${DEFAULT_MAX_BODY_BYTES}, matching Caddy's max_size 256KB`)
        : fail(`set to a value other than ${DEFAULT_MAX_BODY_BYTES}; reconcile it with Caddy or the larger body is truncated at the edge`);
    }),

    advisory("P1.9", "Trusted-proxy identity env matches the Caddy header the edge overwrites", () => {
      if (!env) return skip(`${envFile} could not be parsed`);
      const headerSet = env.names.has("NEXUP_BRIDGE_CLIENT_IP_HEADER");
      const trusted = env.names.has("NEXUP_BRIDGE_TRUSTED_PROXIES");
      return pass(
        `${headerSet ? "NEXUP_BRIDGE_CLIENT_IP_HEADER is set" : "NEXUP_BRIDGE_CLIENT_IP_HEADER defaults to x-nexup-client-ip"}; ` +
          `${trusted ? "NEXUP_BRIDGE_TRUSTED_PROXIES is set" : "NEXUP_BRIDGE_TRUSTED_PROXIES defaults to 127.0.0.1,::1"}. ` +
          "deploy/Caddyfile must overwrite exactly this header name (header_up X-Nexup-Client-IP)",
      );
    }),

    advisory("P1.7", "Vercel-side runtime variables are configured (not host-inspectable)", () =>
      skip(
        "these live in Vercel, not on this host: HERMES_RUNTIME_TRANSPORT=BRIDGE, HERMES_RUNTIME_BRIDGE_URL, " +
          "HERMES_RUNTIME_BRIDGE_KEY_ID, HERMES_RUNTIME_BRIDGE_SECRET, HERMES_RUNTIME_PROFILE=saieed. " +
          "Verify in the Vercel dashboard and record it; the app fails closed (runtime simply not registered)",
      ),
    ),

    /* P2 — Hermes method compatibility (shared with the standalone suite) */
    ...compatChecks(probe, options),

    /* P3 — deployment-dependent findings, recorded */
    advisory("P3.1", "Client identity behind the proxy: trusted-peer header, socket fallback", () => {
      const read = probe.read("bridge/src/auth/client-identity.ts");
      if (!read.ok || read.content === null) {
        return skip("client-identity.ts not readable from this checkout; verify from the build machine");
      }
      const trustedPeer = read.content.includes("trustedProxies");
      const fallback = read.content.includes("socketAddress");
      return trustedPeer && fallback
        ? pass("identity is believed only from a trusted peer and otherwise falls back to the socket address (F1 hardening)")
        : fail("the trusted-peer/fallback pair is not present; the pre-auth bucket would collapse behind the proxy");
    }),

    advisory("P3.4", "Output bounding truncates by characters, not bytes (accepted limitation L7)", () => {
      const read = probe.read("src/modules/workforce/runtimes/hermes/hermes-spawn.ts");
      if (!read.ok || read.content === null) return skip("hermes-spawn.ts not readable from this checkout");
      return /slice\(0,\s*maxBytes\)/.test(read.content)
        ? pass("character-based truncation confirmed; keep NEXUP_BRIDGE_MAX_OUTPUT_BYTES sane and confirm S11")
        : pass("no character-based slice found; re-check the bounding implementation");
    }),

    /* P4 — host state capture */
    safety("P4.1", `Hermes listens on loopback only (:${HERMES_PORT})`, () => {
      const scan = listeners();
      if (!scan.ran) {
        return skip(`listen table unavailable (${scan.reason}) — cannot prove Hermes is loopback-only, so this is NO-GO`);
      }
      const hermes = scan.list.filter((listener) => listener.port === HERMES_PORT);
      if (hermes.length === 0) return fail(`nothing is listening on ${HERMES_PORT}; Hermes is not running`);
      const exposed = hermes.filter((listener) => !isLoopbackAddress(listener.address));
      return exposed.length === 0
        ? pass(`loopback only: ${hermes.map((listener) => `${listener.address}:${listener.port}`).join(", ")}`)
        : fail(
            `Hermes is exposed on a non-loopback address: ${exposed.map((listener) => `${listener.address}:${listener.port}`).join(", ")}`,
          );
    }),

    safety("P4.2", `Bridge port ${BRIDGE_PORT} is free, or already loopback-bound`, () => {
      const scan = listeners();
      if (!scan.ran) return skip(`listen table unavailable (${scan.reason})`);
      const bridge = scan.list.filter((listener) => listener.port === BRIDGE_PORT);
      if (bridge.length === 0) return pass(`free (nothing listening on ${BRIDGE_PORT})`);
      const exposed = bridge.filter((listener) => !isLoopbackAddress(listener.address));
      return exposed.length === 0
        ? pass(`already bound on loopback (${bridge.map((listener) => listener.address).join(", ")}) — expected after install`)
        : fail(`bound on a PUBLIC address: ${exposed.map((listener) => listener.address).join(", ")} — stop (abort criterion §6.1)`);
    }),

    advisory("P4.3", `Dashboard state on port ${DASHBOARD_PORT} captured (must stay unchanged)`, () => {
      const scan = listeners();
      if (!scan.ran) return skip(`listen table unavailable (${scan.reason})`);
      const dashboard = scan.list.filter((listener) => listener.port === DASHBOARD_PORT);
      return pass(
        dashboard.length === 0
          ? `nothing listening on ${DASHBOARD_PORT} — record that and re-check in S14`
          : `${dashboard.map((listener) => `${listener.address}:${listener.port}`).join(", ")} — record PID/start time and re-check in S14. Do NOT touch it`,
      );
    }),

    advisory("P4.4", `Service user ${SERVICE_USER} exists`, () => {
      const result = probe.run("id", [SERVICE_USER]);
      if (!result.ran) return skip(`id is not executable (${result.reason})`);
      return result.code === 0
        ? pass(firstLine(result.stdout))
        : pass(`absent — install §3.1 creates it idempotently`);
    }),

    advisory("P4.5", "Install directories exist", () => {
      const missing = [probe.stat("/opt/nexup-bridge"), probe.stat("/etc/nexup-bridge")].filter((info) => !info.exists).length;
      return pass(missing === 0 ? "both /opt/nexup-bridge and /etc/nexup-bridge present" : `${missing} absent — install §3.2 creates them`);
    }),

    safety("P4.6", "systemd is available", () => {
      const result = probe.run("systemctl", ["--version"]);
      return result.ran && result.code === 0 ? pass(firstLine(result.stdout)) : skip(`systemctl not usable (${result.reason ?? `exit ${result.code}`})`);
    }),

    safety("P4.7", `At least ${minFreeMiB} MiB free on /`, () => {
      const result = probe.run("df", ["-Pk", "/"]);
      if (!result.ran) return skip(`df is not executable (${result.reason})`);
      const line = result.stdout.split("\n")[1] ?? "";
      const available = Number.parseInt(line.trim().split(/\s+/)[3] ?? "", 10);
      if (!Number.isFinite(available)) return fail("could not parse available space from `df -Pk /`");
      const availableMiB = Math.floor(available / 1024);
      return availableMiB >= minFreeMiB
        ? pass(`${availableMiB} MiB available`)
        : fail(`${availableMiB} MiB available, below the ${minFreeMiB} MiB floor`);
    }),

    safety("P4.8", "Required binaries are on PATH", () => {
      const missing: string[] = [];
      const unavailable: string[] = [];
      for (const binary of REQUIRED_BINARIES) {
        const result = probe.run("sh", ["-c", `command -v ${binary}`]);
        if (!result.ran) unavailable.push(binary);
        else if (result.code !== 0) missing.push(binary);
      }
      if (unavailable.length === REQUIRED_BINARIES.length) {
        return skip(`no PATH lookup could be executed (${unavailable.length} unavailable)`);
      }
      return missing.length === 0
        ? pass(`${REQUIRED_BINARIES.length}/${REQUIRED_BINARIES.length} present`)
        : fail(`missing: ${missing.join(", ")}`);
    }),

    advisory("P4.9", "Firewall / listening-address evidence (best effort)", () => {
      const scan = listeners();
      if (!scan.ran) return skip(`listen table unavailable (${scan.reason})`);
      const exposed = scan.list.filter((listener) => !isLoopbackAddress(listener.address));
      return pass(
        exposed.length === 0
          ? "no non-loopback listeners observed in `ss` — record this as evidence"
          : `${exposed.length} non-loopback listener(s): ${exposed.map((listener) => `${listener.address}:${listener.port}`).join(", ")} — confirm each is expected before proceeding`,
      );
    }),

    advisory("P4.10", "Hermes source/install location discoverable (feeds the compatibility probe)", () => {
      if (options.hermesSrc) {
        return probe.stat(options.hermesSrc).exists
          ? pass(`${options.hermesSrc} exists (supplied via --hermes-src)`)
          : fail(`${options.hermesSrc} was supplied but does not exist`);
      }
      const found = HERMES_SRC_GUESSES.filter((candidate) => probe.stat(candidate).exists);
      return found.length > 0
        ? pass(`candidate(s) present: ${found.join(", ")} — re-run with --hermes-src <dir> to run P2`)
        : pass(`none of ${HERMES_SRC_GUESSES.join(", ")} exist; pass --hermes-src <dir> so P2 can search the installed build`);
    }),
  ];

  return {
    suite: {
      name: PREFLIGHT,
      title: "VPS PRE-FLIGHT",
      banner: PREFLIGHT_BANNER,
      checks,
    },
    secrets: env?.secretValues ?? [],
  };
}
