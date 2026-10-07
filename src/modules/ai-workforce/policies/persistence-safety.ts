import { AiWorkforceError } from "../core/errors";

/**
 * Persistence safety — FAIL CLOSED, and now with an EXPLICIT target policy.
 *
 * Preview and Production share the same Supabase database, which means any
 * production persistence the workforce gets is real business data. Enabling it
 * by setting one variable would be the wrong kind of easy, so enabling it takes
 * TWO deliberate statements plus the host itself:
 *
 *   1. Persistence uses its OWN variable: `AI_WORKFORCE_DATABASE_URL`.
 *      The legacy `DATABASE_URL` is ignored — not read, not defaulted to.
 *      No project host is ever hardcoded in source; the host arrives as
 *      configuration.
 *   2. The TARGET must be declared: `AI_WORKFORCE_DATABASE_TARGET` is `local`
 *      (the default) or `production`. A non-loopback host is refused under
 *      `local`, so "I pointed it at the wrong URL" cannot happen quietly.
 *   3. Under `production`, the host must ALSO be named in the explicit allowlist
 *      `AI_WORKFORCE_DATABASE_HOSTS` (comma-separated, exact hostnames, no
 *      wildcards and no suffix matching). An arbitrary external PostgreSQL host
 *      is refused even then: the allowlist is what makes it deliberate.
 *
 * Loopback stays allowed under either target — a development database does not
 * stop being a development database because a deployment also wants production.
 *
 * What is refused, always: a malformed or non-postgres URL, a URL with no
 * database name, a host that merely LOOKS local (`127.0.0.1.` with a trailing
 * dot, `127.0.0.1.somewhere-else.example`, a userinfo trick like
 * `postgres://127.0.0.1@evil.example/db`), an empty allowlist, and any host not
 * named in it. Every refusal resolves to IN_MEMORY with a reason: it never opens
 * a connection, never writes, and never throws into the request path.
 *
 * Nothing here logs or returns credentials. The only values that leave this
 * module are the host, the port and the database name.
 *
 * `assertIsolatedDatabaseUrl` remains the STRICT LOCAL form (loopback only) used
 * by the repository factory and by tests: it throws so a misconfiguration cannot
 * be ignored.
 */

export const WORKFORCE_DATABASE_ENV = "AI_WORKFORCE_DATABASE_URL";
export const WORKFORCE_PERSISTENCE_ENV = "AI_WORKFORCE_PERSISTENCE";
export const WORKFORCE_DATABASE_TARGET_ENV = "AI_WORKFORCE_DATABASE_TARGET";
export const WORKFORCE_DATABASE_HOSTS_ENV = "AI_WORKFORCE_DATABASE_HOSTS";

export const WORKFORCE_DATABASE_TARGETS = ["local", "production"] as const;
export type WorkforceDatabaseTarget = (typeof WORKFORCE_DATABASE_TARGETS)[number];

/** Hosts that are by definition this machine (or its container init). */
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]", "host.docker.internal", "0.0.0.0"]);

export type IsolatedDatabaseInfo = {
  url: string;
  host: string;
  port: string | null;
  database: string;
  /** Which policy admitted this URL. Never a credential, safe to report. */
  target: WorkforceDatabaseTarget;
};

/**
 * Parses and shape-checks a workforce database URL — WITHOUT deciding whether
 * its host is acceptable. That decision belongs to a policy, and there are two:
 * the strict local one (`assertIsolatedDatabaseUrl`) and the target-aware one
 * (`classifyWorkforceDatabase`). Sharing the shape checks keeps them from ever
 * disagreeing about what a usable URL is.
 *
 * @throws PERSISTENCE_UNSAFE when the URL is missing, unparseable, not
 *         postgres, or has no database name.
 */
export function parseWorkforceDatabaseUrl(rawUrl: string | undefined | null): IsolatedDatabaseInfo {
  if (!rawUrl || rawUrl.trim() === "") {
    throw new AiWorkforceError(
      "PERSISTENCE_UNSAFE",
      `${WORKFORCE_DATABASE_ENV} is not set — refusing to open a workforce database connection`,
      { env: WORKFORCE_DATABASE_ENV },
    );
  }

  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new AiWorkforceError("PERSISTENCE_UNSAFE", "Workforce database URL is not a valid URL", {
      env: WORKFORCE_DATABASE_ENV,
    });
  }

  if (parsed.protocol !== "postgresql:" && parsed.protocol !== "postgres:") {
    throw new AiWorkforceError("PERSISTENCE_UNSAFE", `Unsupported protocol "${parsed.protocol}" for workforce persistence`, {
      protocol: parsed.protocol,
    });
  }

  const host = parsed.hostname.toLowerCase();
  const database = parsed.pathname.replace(/^\//, "");
  if (!database) {
    throw new AiWorkforceError("PERSISTENCE_UNSAFE", "Workforce database URL has no database name", { host });
  }

  return { url: rawUrl, host, port: parsed.port || null, database, target: "local" };
}

/**
 * The STRICT LOCAL form: a workforce database must be loopback, full stop.
 *
 * @throws PERSISTENCE_UNSAFE when the URL is missing, unparseable, or points
 *         anywhere other than loopback.
 */
export function assertIsolatedDatabaseUrl(rawUrl: string | undefined | null): IsolatedDatabaseInfo {
  const info = parseWorkforceDatabaseUrl(rawUrl);
  if (!isLoopbackHost(info.host)) {
    throw new AiWorkforceError(
      "PERSISTENCE_UNSAFE",
      `Workforce persistence is restricted to isolated loopback databases; "${info.host}" is not loopback`,
      { host: info.host, env: WORKFORCE_DATABASE_ENV },
    );
  }
  return info;
}

/** Exact hostnames (lowercased) a production target is allowed to name. */
export function productionDatabaseAllowlist(
  env: Record<string, string | undefined> = process.env,
): string[] {
  return (env[WORKFORCE_DATABASE_HOSTS_ENV] ?? "")
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter((entry) => entry.length > 0);
}

/**
 * Classifies a workforce database URL against the declared target and the
 * explicit host allowlist.
 *
 * @throws PERSISTENCE_UNSAFE for anything the policy does not admit.
 */
export function classifyWorkforceDatabase(
  rawUrl: string | undefined | null,
  target: WorkforceDatabaseTarget,
  allowedHosts: readonly string[],
): IsolatedDatabaseInfo {
  // Shape and protocol checks are shared with the strict local form, so the two
  // can never disagree about what "a usable workforce database URL" means. The
  // host decision is this function's own, which is why it parses rather than
  // asserts: the strict form would refuse the very hosts this policy can admit.
  const info = parseWorkforceDatabaseUrl(rawUrl);
  if (isLoopbackHost(info.host)) return info;

  if (target !== "production") {
    throw new AiWorkforceError(
      "PERSISTENCE_UNSAFE",
      `Workforce persistence is restricted to loopback databases under target "${target}"; "${info.host}" is remote. Set ${WORKFORCE_DATABASE_TARGET_ENV}=production AND name the host in ${WORKFORCE_DATABASE_HOSTS_ENV} to allow it`,
      { host: info.host, target, env: WORKFORCE_DATABASE_ENV },
    );
  }

  if (allowedHosts.length === 0) {
    throw new AiWorkforceError(
      "PERSISTENCE_UNSAFE",
      `target is "production" but ${WORKFORCE_DATABASE_HOSTS_ENV} is empty — an external database host must be named explicitly`,
      { host: info.host, env: WORKFORCE_DATABASE_HOSTS_ENV },
    );
  }

  // EXACT match only: no suffix, prefix or wildcard matching, so a look-alike
  // host can never inherit a trusted name.
  const allowed = allowedHosts.map((entry) => entry.toLowerCase()).includes(info.host);
  if (!allowed) {
    throw new AiWorkforceError(
      "PERSISTENCE_UNSAFE",
      `host "${info.host}" is not in ${WORKFORCE_DATABASE_HOSTS_ENV} (${allowedHosts.length} host(s) allowed)`,
      { host: info.host, env: WORKFORCE_DATABASE_HOSTS_ENV },
    );
  }

  return { ...info, target: "production" };
}

function isLoopbackHost(host: string): boolean {
  return LOOPBACK_HOSTS.has(host.toLowerCase());
}

export type PersistenceResolution =
  | { kind: "IN_MEMORY"; reason: string }
  | { kind: "DATABASE"; reason: string; info: IsolatedDatabaseInfo };

/**
 * Resolves where workforce state should live.
 *
 * Fail-closed: every path the policy does not admit resolves to IN_MEMORY, and
 * the reason is surfaced in the UI/status endpoint so a misconfiguration is
 * visible instead of silent. Under the default `local` target this behaves
 * exactly as the original loopback-only guard did.
 */
export function resolvePersistence(env: Record<string, string | undefined> = process.env): PersistenceResolution {
  const mode = (env[WORKFORCE_PERSISTENCE_ENV] ?? "memory").toLowerCase();
  const rawUrl = env[WORKFORCE_DATABASE_ENV];

  if (mode !== "database") {
    return { kind: "IN_MEMORY", reason: `persistence mode is "${mode}" (set ${WORKFORCE_PERSISTENCE_ENV}=database to enable)` };
  }

  const declared = (env[WORKFORCE_DATABASE_TARGET_ENV] ?? "local").toLowerCase();
  if (!(WORKFORCE_DATABASE_TARGETS as readonly string[]).includes(declared)) {
    // An unrecognized target is refused rather than treated as the default: a
    // typo must not silently disable the production policy.
    return {
      kind: "IN_MEMORY",
      reason: `${WORKFORCE_DATABASE_TARGET_ENV}="${declared}" is not one of ${WORKFORCE_DATABASE_TARGETS.join("|")}`,
    };
  }

  try {
    const info = classifyWorkforceDatabase(rawUrl, declared as WorkforceDatabaseTarget, productionDatabaseAllowlist(env));
    return {
      kind: "DATABASE",
      reason: `${info.target} database verified (${info.host}/${info.database})`,
      info,
    };
  } catch (error) {
    const message = error instanceof AiWorkforceError ? error.message : "workforce database URL was rejected";
    // Never connect, never throw into the request path — stay in memory.
    return { kind: "IN_MEMORY", reason: `database requested but rejected: ${message}` };
  }
}
