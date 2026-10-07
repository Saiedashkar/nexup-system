import { analyze, compatChecks, type CompatOptions } from "./hermes-compat";
import { SCOPE_BANNER } from "./output";
import type { Check, CheckOutcome, CommandResult, HostProbe, Suite } from "./runner";

/**
 * Read-only VPS pre-flight probe for the containerised deployment (revised C).
 *
 * Derived directly from `docs/NEXUP_VPS_BRIDGE_DEPLOY_RUNBOOK.md` §1 (P0–P4) so
 * the document and the tool cannot drift: every check carries the runbook anchor
 * it implements. It inspects and reports only — it never installs, starts,
 * stops, reloads, re-creates or writes anything, and it never contacts Hermes.
 *
 * Three checks EXECUTE something, and all three are opt-in (`--exec-probes`):
 *
 *   P0.2c  runs `grep` INSIDE the bridge image (no network, no port, no config)
 *   P0.6   runs the bridge image four times with a deliberately invalid bind or
 *          profile so it exits BEFORE `listen`, to prove the bind and profile
 *          guards
 *   P4.12  opens a TCP connection to the serve endpoint from inside the Hermes
 *          container to prove it answers on loopback
 *
 * None of them invokes an RPC method and none of them changes state.
 *
 * Secrets: the env file is parsed into NARROW accessors (presence, length,
 * equality against a literal, and — for the trusted-proxy boundary — whether
 * every entry is loopback) so a value cannot reach an evidence string by
 * accident. The secret values themselves are handed only to the redactor.
 */

export const PREFLIGHT = "PREFLIGHT";

export const ENV_FILE = "/etc/nexup-bridge/bridge.env";
export const COMPOSE_PATH = "/opt/nexup-bridge/docker-compose.bridge.yml";
/** The bundle path INSIDE the image (the Dockerfile stage root is /app). */
export const IMAGE_BUNDLE_PATH = "/app/dist/main.js";
export const HERMES_SRC_GUESSES = ["/opt/hermes", "/opt/hermes/src", "/srv/hermes", "/usr/local/lib/hermes"];

/** Stable container names. Never an ID: the ID changes on every recreation. */
export const HERMES_CONTAINER = "hermes-agent-r3j1-hermes-agent-1";
export const BRIDGE_CONTAINER = "nexup-bridge";
export const TRAEFIK_CONTAINER = "traefik-traefik-1";
export const SUPERVISOR_SERVICE = "nexup-bridge-supervisor.service";


export const BRIDGE_PORT = 9220;
export const HERMES_PORT = 9119;
export const DASHBOARD_PORT = 4860;
/** Host port the managed Hermes compose publishes for the dashboard. */
export const DASHBOARD_PUBLISHED_PORT = 32768;
/** Path of the interpreter inside the Hermes container (used by the serve probe). */
export const HERMES_PYTHON = "/opt/hermes/.venv/bin/python";

export const EXPECTED_KEY_ID = "nexup-vercel";
export const TARGET_PROFILE = "saieed";
export const FORBIDDEN_PROFILE = "default";
/** An off-scope profile that is NOT `default`: the real daemon accepted it until
 * the config grew an allowlist. Adel's root is `/opt/data`, which is what
 * `default` resolves to, so both names must be refused. */
export const FORBIDDEN_OFF_SCOPE_PROFILE = "adel";
export const MIN_SECRET_CHARS = 64;
export const DEFAULT_MAX_BODY_BYTES = "262144";
export const MIN_FREE_MIB = 200;
/** The non-root uid both the image and the compose file must agree on. */
export const CONTAINER_USER = "10001";

/** Traefik entrypoint the bridge router must use (TLS-terminating). */
const SECURE_ENTRYPOINT = "websecure";
const HEADERS_MIDDLEWARE = "nexup-bridge-headers";

/**
 * The banner an operator must see before any result. Defined once in `output.ts`
 * so the pre-flight and the compat probe cannot disagree; the test suite pins it
 * against TARGET_PROFILE so the two copies of "saieed" cannot drift.
 */
export const PREFLIGHT_BANNER = SCOPE_BANNER;

/** The allowlist refusal planted into every run's method guard, used as a bundling probe. */
const BUNDLE_GUARD_STRING = "is not permitted by the NEXUP bridge";

/** Synthetic values for the opt-in execution probes; never real, never written anywhere. */
const SYNTHETIC_SECRET = "nexup-preflight-synthetic-secret-not-a-real-key";
const SYNTHETIC_TOKEN = "nexup-preflight-synthetic-token-not-real";

/**
 * Fixed container-name prefix for the opt-in probe containers. The name is
 * DETERMINISTIC, not random: a probe orphaned by an earlier crashed run can then
 * be addressed and cleaned before the next attempt, and the argv is reproducible.
 */
export const PROBE_CONTAINER_PREFIX = "nexup-preflight-probe";

/**
 * The `docker run` argv for ONE opt-in probe container.
 *
 * The environment is a MAPPING, so each name appears EXACTLY ONCE in the argv.
 * That matters because Docker resolves a repeated `-e NAME=VALUE` LAST-WINS: an
 * ordered list that carried a shared `HERMES_PROFILE=saieed` AFTER a probe's own
 * override would silently replace it — the defect this replaces, where the
 * "forbidden profile" probe ran as `saieed`, configured, bound the port and
 * stalled to the 15 s timeout. A map makes the override authoritative by
 * construction: there is no second assignment left to win.
 */
export function bridgeProbeArgs(
  imageRef: string,
  name: string,
  env: Readonly<Record<string, string>>,
): string[] {
  const assignments = Object.entries(env).flatMap(([key, value]) => ["-e", `${key}=${value}`]);
  return ["run", "--rm", "--name", name, ...assignments, imageRef];
}

/** The environment the bridge reads. `NEXUP_BRIDGE_MAX_BODY_BYTES` is deliberately
 * excluded: it is covered by the dedicated P1.1 reconciliation check instead. */
export const REQUIRED_ENV_NAMES = [
  "NEXUP_BRIDGE_ENABLED",
  "NEXUP_BRIDGE_HOST",
  "NEXUP_BRIDGE_ALLOW_NON_LOOPBACK_BIND",
  "NEXUP_BRIDGE_PORT",
  "NEXUP_BRIDGE_HMAC_SECRET",
  "NEXUP_BRIDGE_ALLOWED_KEY_IDS",
  "NEXUP_BRIDGE_ALLOWED_PROFILES",
  "NEXUP_BRIDGE_TIMEOUT_MS",
  "NEXUP_BRIDGE_MAX_OUTPUT_BYTES",
  "NEXUP_BRIDGE_MAX_CONCURRENCY",
  "NEXUP_BRIDGE_RATE_LIMIT_PER_MINUTE",
  "NEXUP_BRIDGE_PREAUTH_PER_REMOTE_PER_MINUTE",
  "NEXUP_BRIDGE_PREAUTH_GLOBAL_PER_MINUTE",
  "NEXUP_BRIDGE_CLOCK_SKEW_SECONDS",
  "NEXUP_BRIDGE_TRUSTED_PROXIES",
  "NEXUP_BRIDGE_CLIENT_IP_HEADER",
  "HERMES_RPC_URL",
  "HERMES_SESSION_TOKEN",
  "HERMES_ORIGIN",
  "HERMES_PROFILE",
] as const;

/** Values that must never be rendered; registered with the redactor. */
export const SECRET_ENV_NAMES = ["NEXUP_BRIDGE_HMAC_SECRET", "HERMES_SESSION_TOKEN"] as const;

/**
 * Binaries the HOST needs. Node and Caddy are gone on purpose: there is no host
 * Node (the bundle runs in the image) and Traefik is the edge.
 */
export const REQUIRED_BINARIES = ["docker", "systemctl", "ss", "stat", "df", "sh", "grep", "sha256sum"] as const;

export type PreflightOptions = CompatOptions & {
  envFile?: string;
  composePath?: string;
  /** Digest-pinned image reference (`nexup-bridge@sha256:…`). */
  image?: string;
  /** Digest recorded when the image was built; compared against the host copy. */
  expectedDigest?: string;
  /** The bridge hostname the router must serve; checked when supplied. */
  bridgeHostname?: string;
  /** Enables the three checks that EXECUTE something. */
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
  /**
   * True when every entry of a comma-separated value is loopback, false when at
   * least one is not, and NULL when the name is absent. This is the only derived
   * property of a non-secret value the checks need, and it is computed here so
   * the value itself never leaves the parser.
   */
  loopbackOnlyOf(key: string): boolean | null;
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

  const csv = (key: string): string[] =>
    (values.get(key) ?? "")
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean);

  return {
    names: new Set(values.keys()),
    lengthOf: (key) => (values.has(key) ? (values.get(key) as string).length : null),
    equals: (key, expected) => values.get(key) === expected,
    includesToken: (key, token) => csv(key).includes(token),
    loopbackOnlyOf: (key) => (values.has(key) ? csv(key).every((entry) => isLoopbackAddress(entry)) : null),
    assignsDefaultProfile,
    secretValues: SECRET_ENV_NAMES.map((name) => values.get(name)).filter(
      (value): value is string => typeof value === "string" && value.length > 0,
    ),
    ...(values.size === 0 ? { parseError: "no key=value assignments could be parsed" } : {}),
  };
}

/** A boolean-shaped env value, spelled the way an operator actually writes one. */
function envTruthy(env: EnvMetadata, key: string): boolean {
  return ["true", "1", "yes", "on"].some((form) => env.equals(key, form));
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

/* ── deployment-definition (compose) parsing ────────────────────────────────
 *
 * The subject of P0.5 changed with the architecture but the property did not:
 * the check must read what the definition actually DECLARES. A correct value
 * that only appears in a comment — or in a label — must not satisfy it, because
 * the false negative that hides a published port or a mutable image tag is
 * exactly what this check exists to prevent. Deliberately NOT a YAML parser:
 * the deployment file's shape is fixed and small, and an unparsed construct
 * falls back to "did not find it", which fails closed.
 */

/** Live lines only: whole-line `#` comments are removed, the way compose reads them. */
function liveLines(content: string): string[] {
  return content.split(/\r?\n/).filter((line) => !line.trim().startsWith("#"));
}

/** The effective value of `key`, with surrounding quotes removed. NULL when absent. */
export function composeValue(content: string, key: string): string | null {
  const pattern = new RegExp(`^\\s*${key}\\s*:\\s*(.*)$`);
  let found: string | null = null;
  for (const line of liveLines(content)) {
    const match = pattern.exec(line);
    if (!match) continue;
    let value = (match[1] ?? "").trim();
    if (
      (value.startsWith('"') && value.endsWith('"') && value.length > 1) ||
      (value.startsWith("'") && value.endsWith("'") && value.length > 1)
    ) {
      value = value.slice(1, -1);
    }
    found = value;
  }
  return found;
}

/**
 * The EFFECTIVE list value of `key`: the last live `key:` wins (that is how
 * compose merges a repeated key), and the value may be inline (`[]`, `[a, b]`)
 * or a block of `- item` lines at deeper indentation. Quotes around an item are
 * removed.
 *
 * Reading the last value matters: a reader that collected items from anywhere in
 * the file would let an earlier `- ALL` satisfy a definition whose effective
 * `cap_drop` is empty.
 */
export function composeList(content: string, key: string): string[] {
  const pattern = new RegExp(`^(\\s*)${key}\\s*:\\s*(.*)$`);
  const lines = liveLines(content);

  let index = -1;
  let indent = "";
  let inline = "";
  for (let cursor = 0; cursor < lines.length; cursor += 1) {
    const match = pattern.exec(lines[cursor] as string);
    if (!match) continue;
    index = cursor;
    indent = match[1] ?? "";
    inline = (match[2] ?? "").trim();
  }
  if (index < 0) return [];

  const unquote = (value: string): string => value.trim().replace(/^["']|["']$/g, "");
  if (inline.startsWith("[")) {
    const inner = inline.replace(/^\[/, "").replace(/\]$/, "");
    return inner
      .split(",")
      .map(unquote)
      .filter(Boolean);
  }
  if (inline === "") {
    const items: string[] = [];
    for (let cursor = index + 1; cursor < lines.length; cursor += 1) {
      const line = lines[cursor] as string;
      if (line.trim() === "") continue;
      const item = /^(\s*)-\s*(.*)$/.exec(line);
      if (!item || (item[1] ?? "").length <= indent.length) break;
      const value = unquote(item[2] ?? "");
      if (value) items.push(value);
    }
    return items;
  }
  // A scalar where a list was expected is still a value: report it as one item
  // and let the caller judge (fail-closed for `ports:`, strict for the rest).
  return [unquote(inline)];
}

/**
 * Does the definition publish a host port? True for `ports:` with any non-empty
 * value (mapping, bare port, or inline list) and for a `- "H:C"` list item,
 * which publishes even when the key is not visible in the same block.
 */
export function composePublishesPorts(content: string): boolean {
  if (composeList(content, "ports").length > 0) return true;
  return liveLines(content).some((line) => /^\s*-\s*["']?\d{1,5}:\d{1,5}/.test(line));
}

/**
 * Every live list item written as `key=value` (traefik labels are exactly that).
 * A list item that is not `key=value` — an env-file path, a capability, a port
 * mapping — is not a label and is deliberately not collected.
 */
export type ComposeSecurityInput = {
  compose: string;
  /** The digest recorded at build time; the DEPLOYED identity must equal it. */
  expectedDigest?: string | null;
  /**
   * What the deployment environment resolves `${NEXUP_BRIDGE_IMAGE}` to, as
   * `docker compose config` renders it, or null when it could not be resolved.
   */
  resolvedImage?: string | null;
};

export type ComposeSecurityAssessment = {
  declaredImage: string | null;
  /** The DIGEST the deployment will actually run, or null when it is unknowable. */
  resolvedDigest: string | null;
  /** True when the definition carries its own fallback digest (a second identity). */
  embeddedFallbackDigest: boolean;
  /** True when the deployed digest is knowable AND equals the recorded one. */
  imageOk: boolean;
  publishesPorts: boolean;
  userOk: boolean;
  /** Every unmet requirement, in the order a reader should fix them. */
  missing: string[];
};

/**
 * P0.5b's decision, extracted so that the ARTIFACT can be judged directly.
 *
 * The check suite normally reads a recorded host, which is how a definition that
 * has drifted from what ships (or a fixture that invents a property the artifact
 * lacks) stayed green. `tests/deploy-artifact.test.ts` evaluates the checked-in
 * compose with this same function, so there is one implementation of the rule
 * and no second, unreachable copy of it.
 */
export function assessComposeSecurity(input: ComposeSecurityInput): ComposeSecurityAssessment {
  const declaredImage = composeValue(input.compose, "image");
  const expected = normalizeDigest(input.expectedDigest ?? null);

  // `${NEXUP_BRIDGE_IMAGE}`, `${NEXUP_BRIDGE_IMAGE:?msg}` or the discouraged
  // `${NEXUP_BRIDGE_IMAGE:-fallback}`. The fallback is captured only to REFUSE
  // it when it carries a digest: that would be a second identity.
  const isEnvRef = declaredImage !== null && /\$\{NEXUP_BRIDGE_IMAGE\b/.test(declaredImage);
  const fallback = declaredImage === null ? null : /\$\{NEXUP_BRIDGE_IMAGE:-([^}]*)\}/.exec(declaredImage);
  const embeddedFallbackDigest = fallback !== null && normalizeDigest(fallback[1] ?? null) !== null;

  const resolvedDigest = isEnvRef
    ? normalizeDigest(input.resolvedImage ?? null)
    : declaredImage !== null && declaredImage.includes("@")
      ? normalizeDigest(declaredImage)
      : null;

  const user = composeValue(input.compose, "user");
  const userOk =
    user !== null && user !== "" && !/^(0|root)(:|$)/.test(user) && user.startsWith(CONTAINER_USER);
  const labels = composeLabelText(input.compose);
  const capabilities = composeList(input.compose, "cap_drop");
  const envFiles = composeList(input.compose, "env_file");
  const publishesPorts = composePublishesPorts(input.compose);

  const imageMissing = embeddedFallbackDigest
    ? "image: no fallback digest (`NEXUP_BRIDGE_IMAGE` must be the definition's ONLY image source)"
    : resolvedDigest !== null && (expected === null || resolvedDigest === expected)
      ? null
      : resolvedDigest === null
        ? isEnvRef
          ? "image: could not resolve the deployment image digest (`docker compose config` on this host " +
            "could not interpolate `NEXUP_BRIDGE_IMAGE`), so it cannot be compared with the recorded build digest"
          : `image: the definition names \`${declaredImage ?? "<no image>"}\`, which is not digest-pinned ` +
            "(expected `<name>@sha256:\u2026`)"
        : `image: the deployed digest ${resolvedDigest} differs from the recorded build digest ${expected}`;

  // P0.5a owns the network/ports property and reports it; `publishesPorts` is
  // returned for the artifact-level tests rather than repeated in this list, so
  // one defect does not raise two findings.
  const missing = [
    imageMissing,
    envFiles.some((file) => file === ENV_FILE) ? null : `env_file: ${ENV_FILE}`,
    userOk ? null : `user: "${CONTAINER_USER}:${CONTAINER_USER}"`,
    composeValue(input.compose, "read_only") === "true" ? null : "read_only: true",
    capabilities.includes("ALL") ? null : "cap_drop: [ALL]",
    labels.some((label) => label.includes("no-new-privileges")) || input.compose.includes("no-new-privileges")
      ? null
      : "security_opt: no-new-privileges:true",
    composeValue(input.compose, "restart") !== null ? null : "restart: unless-stopped",
  ].filter((entry): entry is string => entry !== null);

  return {
    declaredImage,
    resolvedDigest,
    embeddedFallbackDigest,
    imageOk: imageMissing === null,
    publishesPorts,
    userOk,
    missing,
  };
}

export function composeLabelText(content: string): string[] {
  const labels: string[] = [];
  for (const line of liveLines(content)) {
    const match = /^\s*-\s*["']?([A-Za-z0-9_.-]+)=(.*)$/.exec(line);
    if (!match) continue;
    labels.push((match[0] ?? "").trim().replace(/^-\s*["']?/, "").replace(/["']$/, ""));
  }
  return labels;
}

/* ── small helpers for checks ────────────────────────────────────────────── */

function firstLine(text: string): string {
  return (text.split("\n")[0] ?? "").trim();
}

/**
 * The offset of the `{` that opens the body of the method `name`, or -1 when the
 * file does not DEFINE that method.
 *
 * In a class file the first textual occurrence of a name is usually a CALL
 * (`this.sweepBuckets(nowMs)`), which is what a naive `indexOf` + fixed-width
 * slice reads — and the actual method, with the property under test, can sit well
 * beyond that window. A call is preceded by `.`, so it can never be taken for a
 * definition; a definition (`private sweepBuckets(nowMs: number): void {`) is
 * preceded by an identifier boundary and followed by a parameter list closed by
 * `)` and a body brace on the same line.
 */
function methodBodyOpen(content: string, name: string): number {
  const pattern = new RegExp(`(^|[^.\\w])${name}\\s*\\(`, "gm");
  for (let match = pattern.exec(content); match !== null; match = pattern.exec(content)) {
    const start = (match.index ?? 0) + (match[1]?.length ?? 0);
    const lineEnd = content.indexOf("\n", start);
    const line = content.slice(start, lineEnd === -1 ? content.length : lineEnd);
    // A definition closes its parameter list and is followed by a return type
    // and/or a body brace; a call ends at `)` or `);` with no brace after it.
    if (!/\)\s*(?::\s*[^{;]*)?\{/.test(line)) continue;
    return content.indexOf("{", start);
  }
  return -1;
}

/**
 * The full body of the method `name` (braces included), or NULL when the file
 * does not define it. Bounded to the method's own braces rather than a fixed
 * window from the name: a 600-character window from a signature overruns into the
 * NEXT method, whose `break;` would satisfy the assertion for a sweep that no
 * longer has one. Returns NULL so the caller fails closed.
 */
export function methodBodyText(content: string, name: string): string | null {
  const open = methodBodyOpen(content, name);
  if (open < 0) return null;
  let depth = 0;
  for (let index = open; index < content.length; index += 1) {
    const char = content[index];
    if (char === "{") depth += 1;
    else if (char === "}") {
      depth -= 1;
      if (depth === 0) return content.slice(open, index + 1);
    }
  }
  return content.slice(open);
}

const pass = (evidence: string): CheckOutcome => ({ status: "pass", evidence });
const fail = (reason: string, evidence?: string): CheckOutcome =>
  evidence ? { status: "fail", reason, evidence } : { status: "fail", reason };
/** "Could not run". Fail-closed at the runner for safety checks. */
const skip = (reason: string): CheckOutcome => ({ status: "skip", reason });

const safety = (id: string, title: string, run: Check["run"]): Check => ({ id, title, severity: "safety", run });
const advisory = (id: string, title: string, run: Check["run"]): Check => ({ id, title, severity: "advisory", run });

/**
 * A digest in canonical `sha256:<hex>` form, from either a bare hex string (what
 * `sha256sum` prints) or a reference (`name@sha256:<hex>`).
 */
function normalizeDigest(value: string | undefined | null): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim().toLowerCase();
  const afterAt = trimmed.includes("@") ? trimmed.slice(trimmed.indexOf("@") + 1) : trimmed;
  const hex = afterAt.startsWith("sha256:") ? afterAt.slice("sha256:".length) : afterAt;
  return /^[0-9a-f]{64}$/.test(hex) ? `sha256:${hex}` : null;
}

/**
 * The ONE place the HMAC secret-strength policy is decided. Runbook P1.3 gates on
 * it and runbook P3.2 (the weak-secret-acceptance finding) re-reports the same
 * decision rather than re-deriving it, so the two rows cannot disagree.
 */
function secretStrength(env: EnvMetadata): CheckOutcome {
  const length = env.lengthOf("NEXUP_BRIDGE_HMAC_SECRET");
  if (length === null) return fail("NEXUP_BRIDGE_HMAC_SECRET is not set");
  return length >= MIN_SECRET_CHARS
    ? pass(`${length} characters (value not read into evidence)`)
    : fail(`NEXUP_BRIDGE_HMAC_SECRET is ${length} characters; >= ${MIN_SECRET_CHARS} is required (32 random bytes as hex)`);
}

/* ── the suite ───────────────────────────────────────────────────────────── */

export function createPreflightSuite(
  probe: HostProbe,
  options: PreflightOptions = {},
): { suite: Suite; secrets: string[] } {
  const envFile = options.envFile ?? ENV_FILE;
  const composePath = options.composePath ?? COMPOSE_PATH;
  const minFreeMiB = options.minFreeMiB ?? MIN_FREE_MIB;

  const envRead = probe.read(envFile);
  const env = envRead.ok && envRead.content !== null ? parseEnvMetadata(envRead.content) : null;

  const composeRead = probe.read(composePath);
  const compose = composeRead.ok && composeRead.content !== null ? composeRead.content : null;

  /**
   * `docker compose config` runs at most ONCE per suite, whichever check needs it
   * first: it is the deployment's own resolution of `${NEXUP_BRIDGE_IMAGE}`, and
   * P0.5b and the image checks must be judging the same rendering of it.
   */
  let renderedConfig: CommandResult | undefined;
  const composeRendered = (): CommandResult =>
    (renderedConfig ??= probe.run("docker", ["compose", "-f", composePath, "config"]));

  /**
   * The image reference the image-reading checks judge.
   *
   * `--image` is an explicit override (an operator may deliberately judge some
   * other artifact). With no flag the reference is the identity the DEPLOYMENT
   * resolves — the definition's `image:` after interpolation, which is what P0.5b
   * compares against the recorded build digest — and NEVER the unpinned default
   * name. Measured against the real host: defaulting to `nexup-bridge`
   * (`nexup-bridge:latest`) made P0.2a/P0.2b/P0.2c/P0.6 look for an image the
   * deployment does not run, so a correctly digest-pinned deployment FAILED four
   * SAFETY checks; the reverse is worse, because a stray `nexup-bridge:latest`
   * built from an older bundle would have satisfied them.
   */
  const declaredImage = compose === null ? null : composeValue(compose, "image");
  let resolvedDefinitionImage: string | null | undefined; // undefined = not resolved yet
  const definitionImage = (): string | null => {
    if (resolvedDefinitionImage !== undefined) return resolvedDefinitionImage;
    if (declaredImage === null) {
      resolvedDefinitionImage = null;
    } else if (!declaredImage.includes("${NEXUP_BRIDGE_IMAGE")) {
      // A literal reference needs no interpolation: it IS the identity.
      resolvedDefinitionImage = declaredImage;
    } else {
      const rendered = composeRendered();
      resolvedDefinitionImage =
        rendered.ran && rendered.code === 0 ? composeValue(rendered.stdout, "image") : null;
    }
    return resolvedDefinitionImage;
  };

  const imageRef = options.image ?? definitionImage();

  /**
   * Fail closed when the deployment's image identity cannot be established. A
   * `skip` on a safety check is a gating failure, which is the intended verdict:
   * with no identity of record there is nothing to judge, and judging an unpinned
   * name would report on something the deployment does not run.
   */
  const noImageIdentity = (): CheckOutcome =>
    skip(
      "the deployment definition resolves to no image identity, so there is nothing to judge: pass " +
        "`--image <name>@sha256:<digest>`, or make ${NEXUP_BRIDGE_IMAGE} resolvable from the deployment " +
        "environment (sourced from /etc/nexup-bridge/deploy.env, which is what the unit loads)",
    );

  const listeners = (): { ran: boolean; list: Listener[]; reason?: string } => {
    const withPids = probe.run("ss", ["-ltnp"]);
    const plain = withPids.ran && withPids.code === 0 ? withPids : probe.run("ss", ["-ltn"]);
    if (!plain.ran) return { ran: false, list: [], reason: plain.reason ?? "ss could not be executed" };
    if (plain.code !== 0) return { ran: false, list: [], reason: `ss exited ${plain.code}` };
    return { ran: true, list: parseListeners(plain.stdout) };
  };

  const containerRunning = (name: string): boolean | null => {
    const result = probe.run("docker", ["inspect", "-f", "{{.State.Running}}", name]);
    if (!result.ran) return null;
    if (result.code !== 0) return false;
    return firstLine(result.stdout) === "true";
  };

  /** The image digest the host actually holds, from its repo digest. */
  const hostImageDigest = (ref: string): { ran: boolean; digest: string | null; reason?: string } => {
    const result = probe.run("docker", ["image", "inspect", "--format", "{{index .RepoDigests 0}}", ref]);
    if (!result.ran) return { ran: false, digest: null, reason: result.reason ?? "docker could not be executed" };
    if (result.code !== 0) return { ran: false, digest: null, reason: `docker image inspect exited ${result.code}` };
    const digest = normalizeDigest(firstLine(result.stdout));
    return digest ? { ran: true, digest } : { ran: false, digest: null, reason: `unparseable digest from "${firstLine(result.stdout)}"` };
  };

  /**
   * Runs ONE opt-in probe container under a fixed name and ALWAYS removes it.
   *
   * `--rm` removes a container only when the CLI exits normally, but the probe's
   * 15 s timeout kills the CLI — NOT the container — so a run that stalls leaves
   * an orphan (the defect that left a stray probe behind before the profile
   * override was made authoritative). Cleaning BEFORE (a stale name from a
   * crashed run) and AFTER (success, refusal and timeout alike) makes the
   * container lifecycle unconditional. The cleanup result is deliberately
   * ignored: `rm -f` on an absent name is not an error.
   */
  const runProbeContainer = (ref: string, slug: string, env: Record<string, string>): CommandResult => {
    const name = `${PROBE_CONTAINER_PREFIX}-${slug}`;
    probe.run("docker", ["rm", "-f", name]);
    const result = probe.run("docker", bridgeProbeArgs(ref, name, env));
    probe.run("docker", ["rm", "-f", name]);
    return result;
  };

  const checks: Check[] = [
    /* P0 — release artifact and deployment definition (runbook ids P0.1–P0.7) */
    advisory("P0.1", "Build gate: bridge typecheck and test suite are green at the recorded SHA", () =>
      skip(
        "run on the build machine, not the host: `npx tsc -p tsconfig.json --noEmit` and " +
          "`npx vitest run --config vitest.config.ts` at the recorded HEAD, then build the image and record " +
          "its digest. The VPS has no repository checkout, so this probe cannot run the suite itself (runbook P0.1)",
      ),
    ),

    safety(
      "P0.2a",
      `The bridge image ${imageRef ?? "the definition resolves"} is present on the host`,
      () => {
        if (imageRef === null) return noImageIdentity();
        const result = probe.run("docker", ["image", "inspect", "--format", "{{.Id}}", imageRef]);
        if (!result.ran) return skip(`docker is not executable (${result.reason})`);
        return result.code === 0
          ? pass(`present: ${firstLine(result.stdout) || "<no id>"}`)
          : fail(`docker has no image ${imageRef}; build it and pin it before deploying (§2)`);
      },
    ),

    safety("P0.2b", "Host image digest matches the digest recorded at build time", () => {
      if (!options.expectedDigest) {
        return skip(
          "no --expected-digest supplied. Runbook P0 records the digest produced by the build; without it a " +
            "stale or replaced image cannot be detected",
        );
      }
      if (imageRef === null) return noImageIdentity();
      const expected = normalizeDigest(options.expectedDigest);
      if (!expected) return fail(`--expected-digest is not a sha256 digest: "${options.expectedDigest}"`);
      const digest = hostImageDigest(imageRef);
      if (!digest.ran || !digest.digest) return skip(`digest unavailable (${digest.reason})`);
      return digest.digest === expected
        ? pass(`${digest.digest} on ${imageRef}`)
        : fail(
            `the host image digest differs from the recorded build digest — do not deploy this image`,
            `host=${digest.digest} recorded=${expected}`,
          );
    }),

    safety("P0.2c", "Method-allowlist guard survived into the shipped image (opt-in)", () => {
      if (!options.execProbes) {
        return skip(
          `not run: this check reads the bundle INSIDE the image (no network, no port, no config). Re-run with ` +
            `--exec-probes to prove the compile-time allowlist refusal is in the artifact`,
        );
      }
      if (imageRef === null) return noImageIdentity();
      const result = probe.run("docker", [
        "run",
        "--rm",
        "--entrypoint",
        "/bin/sh",
        imageRef,
        "-c",
        `grep -c '${BUNDLE_GUARD_STRING}' ${IMAGE_BUNDLE_PATH}`,
      ]);
      if (!result.ran) return skip(`could not execute the image (${result.reason})`);
      const count = Number.parseInt(firstLine(result.stdout), 10);
      if (!Number.isFinite(count)) {
        return fail(`could not read a match count out of the image`, firstLine(result.stderr));
      }
      return count >= 1
        ? pass(`refusal string present ${count}x in ${IMAGE_BUNDLE_PATH} inside the image`)
        : fail(
            `the method-allowlist refusal is absent from the bundle in the image; the compile-time guarantee is not evidenced`,
          );
    }),

    advisory("P0.3", "Build-machine toolchain is available (runbook P0.3 — run P0 from a full checkout)", () =>
      skip(
        "a build-machine property, not host state: `bridge/` has no `node_modules` of its own, so the build, the " +
          "suite and `docker build` resolve from the repository root. Run P0 from a full checkout (or `npm i` at " +
          "the root first) and record it (runbook P0.3)",
      ),
    ),

    safety("P0.4a", "The Docker CLI is present and its daemon answers", () => {
      const result = probe.run("docker", ["version", "--format", "{{.Server.Version}}"]);
      if (!result.ran) return skip(`docker is not executable (${result.reason})`);
      return result.code === 0
        ? pass(`server ${firstLine(result.stdout)}`)
        : fail(`\`docker version\` exited ${result.code}: the daemon is unreachable`, firstLine(result.stderr));
    }),

    safety("P0.4b", "Docker Compose v2 is available (v1 is not supported by this definition)", () => {
      const result = probe.run("docker", ["compose", "version"]);
      if (!result.ran) return skip(`docker is not executable (${result.reason})`);
      if (result.code !== 0) {
        return fail(`\`docker compose version\` exited ${result.code}`, firstLine(result.stderr));
      }
      const version = firstLine(result.stdout);
      const major = Number.parseInt(/(\d+)/.exec(version)?.[1] ?? "", 10);
      return major >= 2
        ? pass(version)
        : fail(`compose version "${version}" is not v2 or later; the definition uses v2 syntax`);
    }),

    safety("P0.5a", "The deployment definition shares the Hermes network namespace and publishes nothing", () => {
      if (compose === null) return skip(`compose file not readable at ${composePath} (${composeRead.reason})`);
      const networkMode = composeValue(compose, "network_mode");
      const ownerCorrect =
        networkMode !== null &&
        (/^\$\{NEXUP_HERMES_CONTAINER(:-|:\?)?/.test(networkMode) || networkMode.includes(HERMES_CONTAINER)) &&
        !networkMode.includes("some-other");
      const problems = [
        ownerCorrect ? null : `network_mode "container:${HERMES_CONTAINER}" (observed ${networkMode ?? "<absent>"})`,
        composePublishesPorts(compose) ? "the definition declares `ports:`, which publishes the bridge on the host" : null,
      ].filter((entry): entry is string => entry !== null);
      return problems.length === 0
        ? pass(
            `network_mode ${networkMode} (the Hermes container's namespace); nothing is published, so the edge reaches ` +
              `the bridge at the owner's address`,
          )
        : fail(`the bridge would not join the Hermes namespace privately — ${problems.join("; ")}`);
    }),

    safety("P0.5b", "The definition runs the digest-pinned image as an unprivileged container", () => {
      if (compose === null) return skip(`compose file not readable at ${composePath} (${composeRead.reason})`);
      const declaredImage = composeValue(compose, "image");

      // Resolve the image the way the DEPLOYMENT resolves it, not by reading the
      // file text: `docker compose config` interpolates `${NEXUP_BRIDGE_IMAGE}`
      // from the deployment environment, which is exactly what the supervisor's
      // own `up -d` does on the recovery path. A definition that names the image
      // literally needs no resolution; one that names the environment must be
      // resolvable, and an unresolvable identity FAILS CLOSED (the deployed
      // digest cannot be compared with the recorded build digest).
      let resolvedImage: string | null = null;
      let resolveNote = "the definition names no ${NEXUP_BRIDGE_IMAGE}";
      if (declaredImage !== null && declaredImage.includes("${NEXUP_BRIDGE_IMAGE")) {
        const rendered = composeRendered();
        if (!rendered.ran) {
          resolveNote = `\`docker compose config\` could not run (${rendered.reason})`;
        } else if (rendered.code !== 0) {
          resolveNote = `\`docker compose config\` exited ${rendered.code}: ${firstLine(rendered.stderr)}`;
        } else {
          resolvedImage = composeValue(rendered.stdout, "image");
          resolveNote = resolvedImage ?? "the rendered configuration carries no image";
        }
      }

      const assessment = assessComposeSecurity({
        compose,
        expectedDigest: options.expectedDigest ?? null,
        resolvedImage,
      });
      const { missing } = assessment;
      return missing.length === 0
        ? pass(
            `deployed image ${assessment.resolvedDigest} (resolved from the definition${declaredImage && declaredImage.includes("${NEXUP_BRIDGE_IMAGE") ? " and the deployment environment" : ""}), ` +
              `env_file ${ENV_FILE}, user ${composeValue(compose, "user")}, read-only root, all capabilities ` +
              `dropped, no-new-privileges, restart ${composeValue(compose, "restart")}`,
          )
        : fail(
            `the definition would run an unpinned or privileged container — missing ${missing.join(", ")}`,
            `image resolution: ${resolveNote}`,
          );
    }),

    safety("P0.6", "The bind and profile guards hold inside the shipped image (opt-in)", () => {
      if (!options.execProbes) {
        return skip(
          "not run: this check executes the bridge image four times with configurations it must REFUSE, and each run " +
            "exits BEFORE `listen` (no port, no config, no state). Re-run with --exec-probes to prove the guards",
        );
      }
      if (imageRef === null) return noImageIdentity();
      // NOTE: the image's OWN entrypoint is used (`node /app/dist/main.js`). Adding
      // `--entrypoint /usr/local/bin/node` REPLACES the entrypoint and drops the
      // bundle argument, so node would start a REPL, read EOF and exit 0 — a check
      // that could never observe a refusal. Found against the real daemon.
      //
      // The environment is a MAP, never an ordered list: Docker resolves a
      // repeated `-e NAME=VALUE` LAST-WINS, so the probe's own override must not
      // be preceded by a shared assignment of the same name. Each of the four
      // probes therefore names its profile exactly once (see `bridgeProbeArgs`).
      const shared: Record<string, string> = {
        NEXUP_BRIDGE_HMAC_SECRET: SYNTHETIC_SECRET,
        NEXUP_BRIDGE_ALLOWED_KEY_IDS: EXPECTED_KEY_ID,
        HERMES_SESSION_TOKEN: SYNTHETIC_TOKEN,
        HERMES_RPC_URL: `ws://127.0.0.1:${HERMES_PORT}/api/ws`,
      };

      // 1. The bind guard: a non-loopback bind without the opt-in must be refused.
      //    The config resolver validates the PROFILE allowlist BEFORE the bind
      //    (config.ts), so reaching this refusal also proves `HERMES_PROFILE=saieed`
      //    was ACCEPTED — a refused profile would have exited with a profile reason.
      const withoutOptIn = runProbeContainer(imageRef, "bind-guard", {
        ...shared,
        NEXUP_BRIDGE_HOST: "0.0.0.0",
        HERMES_PROFILE: TARGET_PROFILE,
      });
      if (!withoutOptIn.ran) return skip(`could not execute the image (${withoutOptIn.reason})`);
      if (
        !(withoutOptIn.code === 1 && /loopback/i.test(withoutOptIn.stderr)) ||
        /ALLOWED_PROFILES|forbidden/i.test(withoutOptIn.stderr)
      ) {
        return fail(
          `expected exit=1 with a loopback refusal for NEXUP_BRIDGE_HOST=0.0.0.0 without the opt-in (and NOT a ` +
            `profile refusal, which would mean ${TARGET_PROFILE} itself was rejected), got exit=${withoutOptIn.code}`,
          firstLine(withoutOptIn.stderr),
        );
      }

      // 2. The opt-in alone is not enough: the edge boundary must be named.
      const withLoopbackBoundary = runProbeContainer(imageRef, "bind-boundary", {
        ...shared,
        NEXUP_BRIDGE_HOST: "0.0.0.0",
        NEXUP_BRIDGE_ALLOW_NON_LOOPBACK_BIND: "true",
        NEXUP_BRIDGE_TRUSTED_PROXIES: "127.0.0.1,::1",
        HERMES_PROFILE: TARGET_PROFILE,
      });
      if (!withLoopbackBoundary.ran) return skip(`could not execute the image (${withLoopbackBoundary.reason})`);
      if (!(withLoopbackBoundary.code === 1 && /TRUSTED_PROXIES/.test(withLoopbackBoundary.stderr))) {
        return fail(
          `the opt-in was honoured without naming the edge boundary: expected exit=1 mentioning ` +
            `NEXUP_BRIDGE_TRUSTED_PROXIES, got exit=${withLoopbackBoundary.code}`,
          firstLine(withLoopbackBoundary.stderr),
        );
      }

      // 3. The profile allowlist is proved on the ARTIFACT, not just in the config
      //    tests: the real daemon accepted `HERMES_PROFILE=adel` before this row was
      //    added, and `adel` names the same `/opt/data` root as `default`.
      const offScopeProfile = runProbeContainer(imageRef, "profile-adel", {
        ...shared,
        HERMES_PROFILE: FORBIDDEN_OFF_SCOPE_PROFILE,
      });
      if (!offScopeProfile.ran) return skip(`could not execute the image (${offScopeProfile.reason})`);
      if (!(offScopeProfile.code === 1 && /ALLOWED_PROFILES|forbidden/i.test(offScopeProfile.stderr))) {
        return fail(
          `expected exit=1 refusing HERMES_PROFILE=${FORBIDDEN_OFF_SCOPE_PROFILE} (only ${TARGET_PROFILE} may be ` +
            `addressed), got exit=${offScopeProfile.code}`,
          firstLine(offScopeProfile.stderr),
        );
      }

      // 4. `default` is the primary forbidden profile — the root profile, which is
      //    never addressable — and is checked explicitly, not left implied by (3).
      const forbiddenDefault = runProbeContainer(imageRef, "profile-default", {
        ...shared,
        HERMES_PROFILE: FORBIDDEN_PROFILE,
      });
      if (!forbiddenDefault.ran) return skip(`could not execute the image (${forbiddenDefault.reason})`);
      if (!(forbiddenDefault.code === 1 && /default is never addressable|forbidden/i.test(forbiddenDefault.stderr))) {
        return fail(
          `expected exit=1 refusing HERMES_PROFILE=${FORBIDDEN_PROFILE} (the root profile is never addressable), got ` +
            `exit=${forbiddenDefault.code}`,
          firstLine(forbiddenDefault.stderr),
        );
      }

      return pass(
        `HERMES_PROFILE=${TARGET_PROFILE} was ACCEPTED — the run reached the bind guard, which config.ts evaluates ` +
          `AFTER the profile allowlist — and was refused only for the bind; exit=1 with the opt-in while the trusted ` +
          `boundary is still loopback-only (so client identity cannot collapse into one bucket); ` +
          `HERMES_PROFILE=${FORBIDDEN_OFF_SCOPE_PROFILE} refused; HERMES_PROFILE=${FORBIDDEN_PROFILE} refused`,
      );
    }),

    safety("P0.7a", "Traefik is running and owns the web entrypoints on the host", () => {
      const running = containerRunning(TRAEFIK_CONTAINER);
      if (running === null) return skip("docker could not inspect the Traefik container");
      if (!running) {
        return fail(`${TRAEFIK_CONTAINER} is not running; the bridge hostname has no route and no TLS`);
      }
      const scan = listeners();
      if (!scan.ran) return skip(`listen table unavailable (${scan.reason})`);
      const web = scan.list.filter((listener) => listener.port === 80 || listener.port === 443);
      return [80, 443].every((port) => web.some((listener) => listener.port === port))
        ? pass(`${TRAEFIK_CONTAINER} is running and the host listens on :80 and :443 — Traefik owns the edge`)
        : fail(
            `Traefik is running but the host does not listen on both :80 and :443; the ACME challenge and TLS ` +
              `entrypoints are not reachable`,
            web.map((listener) => `${listener.address}:${listener.port}`).join(", ") || "no :80/:443 listener",
          );
    }),

    safety("P0.7b", "The definition routes the bridge on its own hostname without buffering the run stream", () => {
      if (compose === null) return skip(`compose file not readable at ${composePath} (${composeRead.reason})`);
      const labels = composeLabelText(compose).filter((label) => label.startsWith("traefik."));
      const routerPrefix = "traefik.http.routers.nexup-bridge.";
      /**
       * A LABEL LIST is applied in order, so the LAST value of a key is the
       * effective one — the same rule `composeValue` applies to scalar keys. A
       * later wrong value must therefore win, not be shadowed by the earlier one.
       */
      const lastLabel = (prefix: string): string | null => {
        let found: string | null = null;
        for (const label of labels) if (label.startsWith(prefix)) found = label.slice(prefix.length);
        return found;
      };
      const rule = lastLabel(`${routerPrefix}rule=`);
      const entrypoints = lastLabel(`${routerPrefix}entrypoints=`);
      const hostOk =
        rule !== null &&
        /Host\(/.test(rule) &&
        (options.bridgeHostname === undefined ||
          rule.includes(options.bridgeHostname) ||
          rule.includes("NEXUP_BRIDGE_HOSTNAME"));
      const missing = [
        hostOk ? null : `rule=Host(\`<bridge hostname>\`)`,
        entrypoints === SECURE_ENTRYPOINT ? null : `entrypoints=${SECURE_ENTRYPOINT}`,
        lastLabel(`${routerPrefix}tls=`) === "true" ? null : "tls=true",
        lastLabel(`${routerPrefix}tls.certresolver=`) ? null : "tls.certresolver",
        lastLabel("traefik.http.services.nexup-bridge.loadbalancer.server.port=") === String(BRIDGE_PORT)
          ? null
          : `loadbalancer.server.port=${BRIDGE_PORT}`,
        labels.some((label) => label.includes(`middlewares.${HEADERS_MIDDLEWARE}.headers.stsSeconds`))
          ? null
          : `the ${HEADERS_MIDDLEWARE} security-header middleware`,
        labels.some((label) => label.includes("buffering"))
          ? "NO buffering middleware (it would hold SSE frames)"
          : null,
      ].filter((entry): entry is string => entry !== null);

      const route = labels.length === 0 ? "no traefik labels at all" : `${labels.length} traefik label(s)`;
      return missing.length === 0
        ? pass(
            `rule ${rule} on entrypoint ${entrypoints} with TLS via certresolver, service port ${BRIDGE_PORT}, ` +
              `${HEADERS_MIDDLEWARE} headers, and no buffering middleware (${route})`,
          )
        : fail(`the edge would not route or protect the bridge — missing ${missing.join(", ")}`);
    }),

    /* P1 — environment and secret NAMES (runbook ids P1.0–P1.8) */
    safety("P1.0a", `Bridge env file is present at ${envFile}`, () =>
      envRead.ok
        ? pass(`${(envRead.content ?? "").split("\n").length} line(s) read`)
        : fail(`${envFile} is not readable (${envRead.reason})`),
    ),

    safety("P1.0b", `Every required env name is present (${REQUIRED_ENV_NAMES.length} names)`, () => {
      if (!env) return skip(`${envFile} could not be parsed, so names cannot be checked`);
      if (env.parseError) return fail(env.parseError);
      const missing = REQUIRED_ENV_NAMES.filter((name) => !env.names.has(name));
      return missing.length === 0
        ? pass(`${REQUIRED_ENV_NAMES.length}/${REQUIRED_ENV_NAMES.length} present`)
        : fail(`missing ${missing.length}: ${missing.join(", ")}`);
    }),

    safety("P1.1", `The bridge request-body cap is ${DEFAULT_MAX_BODY_BYTES} bytes (the control of record)`, () => {
      if (!env) return skip(`${envFile} could not be parsed`);
      if (!env.names.has("NEXUP_BRIDGE_MAX_BODY_BYTES")) {
        return pass(
          `absent; the code default ${DEFAULT_MAX_BODY_BYTES} B is in use. This bridge is the ONLY body limit — ` +
            `Traefik core cannot cap a request body without a plugin, and the built-in that can would buffer the SSE ` +
            `run stream (P0.7b refuses it)`,
        );
      }
      return env.equals("NEXUP_BRIDGE_MAX_BODY_BYTES", DEFAULT_MAX_BODY_BYTES)
        ? pass(`set to ${DEFAULT_MAX_BODY_BYTES}, the value the edge policy assumes`)
        : fail(
            `set to a value other than ${DEFAULT_MAX_BODY_BYTES} while no edge cap exists: this IS the limit, so ` +
              `change it only with the runbook`,
          );
    }),

    safety("P1.2", "Env file permissions are 600 root:root", () => {
      const result = probe.run("stat", ["-c", "%a %U:%G", envFile]);
      if (!result.ran) return skip(`stat is not executable (${result.reason})`);
      if (result.code !== 0) return fail(`stat exited ${result.code} for ${envFile}`, firstLine(result.stderr));
      const observed = firstLine(result.stdout);
      return observed === "600 root:root"
        ? pass(observed)
        : fail(`expected "600 root:root", observed "${observed}"`);
    }),

    safety("P1.3", `HMAC secret is >= ${MIN_SECRET_CHARS} characters (length only — never the value)`, () => {
      if (!env) return skip(`${envFile} could not be parsed, so the secret length cannot be checked`);
      return secretStrength(env);
    }),

    safety("P1.4", `Allowed key ids include ${EXPECTED_KEY_ID}`, () => {
      if (!env) return skip(`${envFile} could not be parsed, so key-id agreement cannot be checked`);
      return env.includesToken("NEXUP_BRIDGE_ALLOWED_KEY_IDS", EXPECTED_KEY_ID)
        ? pass(`${EXPECTED_KEY_ID} is present in NEXUP_BRIDGE_ALLOWED_KEY_IDS`)
        : fail(`NEXUP_BRIDGE_ALLOWED_KEY_IDS does not contain ${EXPECTED_KEY_ID}; every signed request would be rejected`);
    }),

    safety("P1.5", `Only ${TARGET_PROFILE} is addressable: profile pinned AND allowlisted`, () => {
      if (!env) return skip(`${envFile} could not be parsed, so profile pinning cannot be checked`);
      if (env.assignsDefaultProfile) {
        return fail(
          `a PROFILE assignment in ${envFile} is "${FORBIDDEN_PROFILE}" — that is Adel's profile and is refused at startup`,
        );
      }
      if (!env.equals("HERMES_PROFILE", TARGET_PROFILE)) {
        return fail(`HERMES_PROFILE is not ${TARGET_PROFILE}`);
      }
      // The allowlist is what the config HONOURS, so pinning the requested name
      // alone is not enough: a widened allowlist makes an off-scope profile such
      // as `adel` addressable (`adel` names the same /opt/data root as `default`).
      if (!env.equals("NEXUP_BRIDGE_ALLOWED_PROFILES", TARGET_PROFILE)) {
        return fail(
          `NEXUP_BRIDGE_ALLOWED_PROFILES is not exactly ${TARGET_PROFILE}; any other name in it would be addressable ` +
            `(and ${FORBIDDEN_PROFILE} could never be, since the config refuses it) — re-check that this is intentional`,
        );
      }
      return pass(
        `HERMES_PROFILE=${TARGET_PROFILE} with NEXUP_BRIDGE_ALLOWED_PROFILES=${TARGET_PROFILE}; no ` +
          `${FORBIDDEN_PROFILE} assignment found, so no other profile is reachable`,
      );
    }),

    advisory("P1.6", "Host clock (compare against the signing host; must agree within 60 s)", () => {
      const result = probe.run("date", ["-u", "+%s"]);
      const epoch = result.ran && result.code === 0 ? firstLine(result.stdout) : "";
      const skew = probe.run("date", ["-u", "+%Y-%m-%dT%H:%M:%SZ"]);
      return pass(
        `VPS epoch ${epoch || "<unreadable>"} (${skew.ran ? firstLine(skew.stdout) : "?"}); ` +
          "compare with `date -u +%s` on the signing host — a difference over NEXUP_BRIDGE_CLOCK_SKEW_SECONDS " +
          "(default 300 s) is the usual cause of a REPLAY 401",
      );
    }),

    advisory("P1.7", "Vercel-side runtime variables are configured (not host-inspectable)", () =>
      skip(
        "these live in Vercel, not on this host: HERMES_RUNTIME_TRANSPORT=BRIDGE, HERMES_RUNTIME_BRIDGE_URL, " +
          "HERMES_RUNTIME_BRIDGE_KEY_ID, HERMES_RUNTIME_BRIDGE_SECRET, HERMES_RUNTIME_PROFILE=saieed. " +
          "Verify in the Vercel dashboard and record it; the app fails closed (runtime simply not registered)",
      ),
    ),

    safety("P1.8", "The client-identity boundary matches the bind (the E4 decision, enforced in config)", () => {
      if (!env) return skip(`${envFile} could not be parsed`);
      const optedIn = envTruthy(env, "NEXUP_BRIDGE_ALLOW_NON_LOOPBACK_BIND");
      const loopbackOnly = env.loopbackOnlyOf("NEXUP_BRIDGE_TRUSTED_PROXIES");
      const header = env.names.has("NEXUP_BRIDGE_CLIENT_IP_HEADER");
      const headerName = env.equals("NEXUP_BRIDGE_CLIENT_IP_HEADER", "x-forwarded-for")
        ? "x-forwarded-for"
        : "a single-value overwrite header";

      if (!optedIn) {
        return loopbackOnly === false
          ? fail(
              "the bind is loopback but NEXUP_BRIDGE_TRUSTED_PROXIES names an off-loopback boundary: the real proxy " +
                "would not be trusted and the header would be ignored",
            )
          : pass(
              "loopback bind: the edge boundary defaults to 127.0.0.1,::1, the only hop that can reach a loopback " +
                "bridge. The bridge is never published",
            );
      }

      if (loopbackOnly === null) {
        return fail(
          "NEXUP_BRIDGE_ALLOW_NON_LOOPBACK_BIND is set but NEXUP_BRIDGE_TRUSTED_PROXIES is not: off-loopback no peer " +
            "is trusted, so every caller shares ONE pre-auth bucket (the bridge refuses this exact combination)",
        );
      }
      if (loopbackOnly) {
        return fail(
          `NEXUP_BRIDGE_TRUSTED_PROXIES is loopback-only while the bridge binds off-loopback: the loopback default ` +
            `trusts no peer, so all callers collapse into one pre-auth bucket and one client starves the rest`,
        );
      }
      if (!header) {
        return fail(
          "NEXUP_BRIDGE_CLIENT_IP_HEADER is not set: with an off-loopback bind the address header is a decision, not " +
            "a default (the bridge refuses to run without it)",
        );
      }
      return pass(
        `off-loopback bind with an explicit, non-loopback boundary and header ${headerName}. ` +
          (headerName === "x-forwarded-for"
            ? "Traefik APPENDS the peer to X-Forwarded-For, so the bridge reads the RIGHTMOST entry: anything to its " +
              "left is caller-supplied and cannot mint a fresh pre-auth bucket"
            : "the edge must OVERWRITE this header, never forward a caller-supplied value"),
      );
    }),

    /* P2 — Hermes method compatibility (shared with the standalone suite).
     * `analyze` walks the installed tree, so it is called exactly ONCE per run
     * and its single result feeds every P2 check. */
    ...compatChecks(analyze(probe, options)),

    /* P3 — the recorded findings, one result each so an operator can tick every
     * runbook P3.x row. All advisory: none gates the deployment on its own
     * (P3.2's gate is P1.3). */
    advisory("P3.1", "Client identity behind the edge: a trusted peer plus a rightmost forwarded address", () => {
      const app = probe.read("bridge/src/api/app.ts");
      const identity = probe.read("bridge/src/auth/client-identity.ts");
      if (!app.ok || app.content === null || !identity.ok || identity.content === null) {
        return skip(
          "app.ts / client-identity.ts are not readable from this checkout; verify them from the build machine",
        );
      }
      const missing = [
        app.content.includes("resolveClientIdentity(") ? null : "app.ts does not resolve the identity (still raw socket)",
        identity.content.includes("trustedProxies") && identity.content.includes("socketAddress")
          ? null
          : "client-identity.ts lacks the trusted-peer/socket-fallback pair",
        identity.content.includes("rightmost") || identity.content.includes("EDGE_APPENDED_HEADERS")
          ? null
          : "client-identity.ts does not take the RIGHTMOST forwarded entry",
        compose !== null && composePublishesPorts(compose)
          ? "the deployment definition publishes a port, which bypasses the edge entirely"
          : null,
      ].filter((entry): entry is string => entry !== null);
      return missing.length === 0
        ? pass(
            "app.ts resolves the identity through client-identity.ts: the forwarded address is believed only from a " +
              "trusted PROXY NETWORK, and for an edge-appended list only its rightmost entry is used, otherwise the " +
              "socket address is used. The pre-auth bucket and audit remote are per client, not one global bucket. " +
              "The bridge publishes no port. Residual: §8 L3",
          )
        : fail(`the proxy-identity chain is incomplete: ${missing.join("; ")}`);
    }),

    advisory("P3.2", `Weak-secret acceptance: the code refuses only < 16 characters, so the policy is P1.3 (>= ${MIN_SECRET_CHARS})`, () => {
      if (!env) return skip(`${envFile} could not be parsed, so the secret-strength finding cannot be re-reported`);
      // Same finding as P1.3, reported from the SAME owner so the two rows can
      // never disagree; P1.3 is the one that gates.
      return secretStrength(env);
    }),

    advisory("P3.3", "Pre-auth sweep order: stale buckets linger to the cap, and no test covers live-bucket eviction", () => {
      const read = probe.read("bridge/src/auth/pre-auth-guard.ts");
      if (!read.ok || read.content === null) {
        return skip("pre-auth-guard.ts not readable from this checkout; run the security suite from the build machine");
      }
      const record =
        'run `npx vitest run tests/security.test.ts -t "refills over time and keeps its bucket state bounded"` on the build ' +
        "machine and record it green; no test asserts a live bucket survives cap eviction (§8 L4). No host action";
      // Read the METHOD BODY, not the first time the name appears. In this file
      // the first textual `sweepBuckets` is the `this.sweepBuckets(nowMs)` CALL
      // inside `check()`; slicing from there lands ~3 kB short of the body, so a
      // correct method could only pass with a hand-trimmed fragment.
      const sweep = methodBodyText(read.content, "sweepBuckets");
      if (sweep === null) {
        return fail(
          "pre-auth-guard.ts no longer DEFINES `sweepBuckets` (only a call site was found), so the accepted sweep order " +
            `in §8 L4 cannot be evidenced. ${record}`,
        );
      }
      return sweep.includes("break;")
        ? pass(
            "sweepBuckets still breaks on the first live bucket (insertion order ≈ recency), so stale buckets linger until " +
              `the cap — accepted. ${record}`,
          )
        : fail(
            "sweepBuckets no longer breaks on the first live bucket: the accepted state in §8 L4 is absent, so re-read the sweep " +
              `and reconcile the runbook before proceeding. ${record}`,
          );
    }),

    advisory("P3.4", "Output bounding truncates by characters, not bytes (accepted limitation L7)", () => {
      const read = probe.read("src/modules/workforce/runtimes/hermes/hermes-spawn.ts");
      if (!read.ok || read.content === null) return skip("hermes-spawn.ts not readable from this checkout");
      return /slice\(0,\s*maxBytes\)/.test(read.content)
        ? pass("character-based truncation confirmed; keep NEXUP_BRIDGE_MAX_OUTPUT_BYTES sane and confirm S11")
        : fail(
            "boundText no longer slices by characters: the accepted state in §8 L7 is absent, so re-read the bounding " +
              "implementation and reconcile the runbook before proceeding",
          );
    }),

    advisory("P3.5", "Supervisor invariants: fixed token from a file, no argv exposure, recreate via compose", () => {
      const read = probe.read("bridge/deploy/nexup-bridge-supervisor.sh");
      if (!read.ok || read.content === null) {
        return skip("the supervisor script is not readable from this checkout; verify it from the build machine");
      }
      const body = read.content;
      const missing = [
        body.includes("TOKEN_FILE") ? null : "the token is read from a root-only file (TOKEN_FILE)",
        /openssl rand|randomBytes|uuidgen/.test(body) ? "the token must not be generated per start" : null,
        /-e\s+HERMES_DASHBOARD_SESSION_TOKEN=/.test(body)
          ? "the token must be passed by NAME, never by value (argv is world-readable)"
          : null,
        body.includes("compose") && body.includes("up -d") ? null : "the bridge is re-created through the compose file",
        /rm -f[^\n]*BRIDGE_CONTAINER/.test(body) ? null : "the stale bridge is removed before the replacement",
        body.includes("ALLOWED_PROFILES") && body.includes("saieed") && !/-p\s+default/.test(body)
          ? null
          : "the profile is allowlisted to saieed and default is never addressed",
        body.includes("/docker/hermes-agent-r3j1") || body.includes("--network host")
          ? "the supervisor must not touch the managed Hermes deployment or bind a host network"
          : null,
      ].filter((entry): entry is string => entry !== null);
      return missing.length === 0
        ? pass(
            "the supervisor reads the fixed token from a root-only file, passes it by name (never as an argument), " +
              "re-creates the bridge through the compose file after removing the orphan, allowlists the profile to " +
              "saieed, and touches neither the Hermes compose nor a host network",
          )
        : fail(`the supervisor would not recover safely: ${missing.join("; ")}`);
    }),

    /* P4 — host state capture */
    safety("P4.1", `Hermes (:${HERMES_PORT}) is namespace-local — nothing on the host reaches it`, () => {
      const running = containerRunning(HERMES_CONTAINER);
      if (running === null) return skip("docker could not inspect the Hermes container");
      if (!running) return fail(`${HERMES_CONTAINER} is not running; the serve endpoint cannot exist`);
      const scan = listeners();
      if (!scan.ran) {
        return skip(`listen table unavailable (${scan.reason}) — cannot prove Hermes is not host-exposed, so this is NO-GO`);
      }
      const exposed = scan.list.filter((listener) => listener.port === HERMES_PORT);
      return exposed.length === 0
        ? pass(
            `${HERMES_CONTAINER} is running and the host listens on :${HERMES_PORT} nowhere: the serve endpoint is ` +
              `reachable only inside that namespace, which is what the bridge shares`,
          )
        : fail(
            `the host listens on :${HERMES_PORT} (${exposed.map((listener) => `${listener.address}:${listener.port}`).join(", ")}), ` +
              `so Hermes is reachable without the bridge`,
          );
    }),

    safety("P4.2", `Bridge port ${BRIDGE_PORT} is never published on the host`, () => {
      const scan = listeners();
      if (!scan.ran) return skip(`listen table unavailable (${scan.reason})`);
      const published = scan.list.filter((listener) => listener.port === BRIDGE_PORT);
      return published.length === 0
        ? pass(
            `nothing on the host listens on ${BRIDGE_PORT}: the bridge is reachable only through Traefik inside the ` +
              `shared namespace (abort criterion §6.1 if this ever changes)`,
          )
        : fail(
            `${BRIDGE_PORT} is published on the host: ${published.map((listener) => listener.address).join(", ")} — ` +
              `stop (abort criterion §6.1)`,
          );
    }),

    advisory("P4.3", `Dashboard state on port ${DASHBOARD_PORT} captured (must stay unchanged)`, () => {
      const scan = listeners();
      const running = containerRunning(HERMES_CONTAINER);
      if (!scan.ran) return skip(`listen table unavailable (${scan.reason})`);
      const published = scan.list.filter((listener) => listener.port === DASHBOARD_PUBLISHED_PORT);
      return pass(
        `${HERMES_CONTAINER} ${running === null ? "unknown" : running ? "running" : "NOT running"}; the host publishes ` +
          `${published.length > 0 ? `${DASHBOARD_PUBLISHED_PORT} (the managed compose's dashboard mapping)` : `no :${DASHBOARD_PUBLISHED_PORT}`} — ` +
          `record this and re-check in S14. The dashboard runs on :${DASHBOARD_PORT} inside the container and must stay up. Do NOT touch it`,
      );
    }),

    advisory("P4.4", "The bridge container runs as a non-root user", () => {
      if (compose === null) return skip(`compose file not readable at ${composePath} (${composeRead.reason})`);
      const user = composeValue(compose, "user");
      return user !== null && !/^(0|root)(:|$)/.test(user) && user !== ""
        ? pass(`user ${user} (the image declares the same numeric uid, so no override is needed)`)
        : pass(`no non-root user is declared ("${user ?? "<absent>"}") — the image's USER applies; record which`);
    }),

    advisory("P4.5", "Install directories exist", () => {
      const missing = [probe.stat("/opt/nexup-bridge"), probe.stat("/etc/nexup-bridge")].filter(
        (info) => !info.exists,
      ).length;
      return pass(
        missing === 0
          ? "both /opt/nexup-bridge (compose file and build context) and /etc/nexup-bridge (env + token) present"
          : `${missing} absent — §3.2 creates them`,
      );
    }),

    safety("P4.6", "systemd is available (it owns the supervisor)", () => {
      const result = probe.run("systemctl", ["--version"]);
      return result.ran && result.code === 0
        ? pass(firstLine(result.stdout))
        : skip(`systemctl not usable (${result.reason ?? `exit ${result.code}`})`);
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

    safety("P4.8", "Required binaries are on PATH (no host Node, no Caddy)", () => {
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
        ? pass(`${REQUIRED_BINARIES.length}/${REQUIRED_BINARIES.length} present: ${REQUIRED_BINARIES.join(", ")}`)
        : fail(`missing: ${missing.join(", ")}`);
    }),

    advisory("P4.9", "Listening-address evidence (best effort)", () => {
      const scan = listeners();
      if (!scan.ran) return skip(`listen table unavailable (${scan.reason})`);
      const exposed = scan.list.filter((listener) => !isLoopbackAddress(listener.address));
      return pass(
        exposed.length === 0
          ? "no non-loopback listeners observed in `ss` — record this as evidence"
          : `${exposed.length} non-loopback listener(s): ${exposed
              .map((listener) => `${listener.address}:${listener.port}`)
              .join(", ")} — confirm each is expected before proceeding`,
      );
    }),

    advisory("P4.10", "Hermes tree for the compatibility probe (it lives INSIDE the container now)", () => {
      if (options.hermesSrc) {
        return probe.stat(options.hermesSrc).exists
          ? pass(`${options.hermesSrc} exists (supplied via --hermes-src)`)
          : fail(`${options.hermesSrc} was supplied but does not exist`);
      }
      const found = HERMES_SRC_GUESSES.filter((candidate) => probe.stat(candidate).exists);
      return found.length > 0
        ? pass(`candidate(s) present: ${found.join(", ")} — re-run with --hermes-src <dir> to run P2`)
        : skip(
            `none of ${HERMES_SRC_GUESSES.join(", ")} exist on the host: the installed tree is inside ${HERMES_CONTAINER}. ` +
              `Materialize a read-only COPY (\`docker cp ${HERMES_CONTAINER}:/opt/hermes /tmp/nexup-hermes-src\`, then ` +
              `remove it afterwards) and pass --hermes-src at it, so P2 can still read the emitted methods. The container ` +
              `itself is never modified`,
          );
    }),

    safety("P4.11", "The supervisor unit is installed, enabled and active (it owns recovery)", () => {
      const enabled = probe.run("systemctl", ["is-enabled", SUPERVISOR_SERVICE]);
      if (!enabled.ran) return skip(`systemctl is not usable (${enabled.reason})`);
      const active = probe.run("systemctl", ["is-active", SUPERVISOR_SERVICE]);
      const enabledState = firstLine(enabled.stdout) || `exit ${enabled.code}`;
      const activeState = firstLine(active.stdout) || `exit ${active.code}`;
      return enabled.code === 0 && enabledState === "enabled" && active.code === 0 && activeState === "active"
        ? pass(`${SUPERVISOR_SERVICE} is enabled and active — the serve endpoint and the bridge lifecycle are supervised`)
        : fail(
            `${SUPERVISOR_SERVICE} is not installed and running (is-enabled: ${enabledState}, is-active: ${activeState}): ` +
              `nothing would restart the serve endpoint or re-parent the bridge after a Hermes recreation`,
          );
    }),

    safety("P4.12", "The serve endpoint accepts a connection on loopback inside the container (opt-in)", () => {
      if (!options.execProbes) {
        return skip(
          `not run: this check opens one TCP connection to ${HERMES_PORT} from inside ${HERMES_CONTAINER} and invokes ` +
            `no RPC method. Re-run with --exec-probes to prove the endpoint the bridge authenticates to actually answers`,
        );
      }
      const result = probe.run("docker", [
        "exec",
        HERMES_CONTAINER,
        HERMES_PYTHON,
        "-c",
        `import socket;socket.create_connection(('127.0.0.1',${HERMES_PORT}),2).close()`,
      ]);
      if (!result.ran) return skip(`could not exec into the Hermes container (${result.reason})`);
      return result.code === 0
        ? pass(`a TCP connection to 127.0.0.1:${HERMES_PORT} inside ${HERMES_CONTAINER} succeeded`)
        : fail(
            `${HERMES_CONTAINER} does not accept a connection on 127.0.0.1:${HERMES_PORT}: the supervised serve is not ` +
              `running, so the bridge has nothing to authenticate to`,
            firstLine(result.stderr),
          );
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
