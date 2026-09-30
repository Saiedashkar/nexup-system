import { AiWorkforceError } from "../core/errors";

/**
 * Persistence safety — FAIL CLOSED.
 *
 * Preview and Production currently share the same Supabase database, which
 * means the project's `DATABASE_URL` IS production data. The workforce engine
 * must therefore never be able to enable database persistence just because
 * somebody set an environment variable.
 *
 * The rules, in order:
 *
 *   1. Persistence uses its OWN variable: `AI_WORKFORCE_DATABASE_URL`.
 *      The legacy `DATABASE_URL` is ignored — not read, not defaulted to.
 *   2. The target host must be LOOPBACK. This is an allowlist, not a
 *      blocklist: a new managed-database hostname can never slip through a
 *      "does it contain supabase?" check.
 *   3. Anything else — a remote host, a Supabase pooler, an unparseable URL,
 *      a missing URL — resolves to IN_MEMORY with a reason. It never opens a
 *      connection, never writes, and never throws into the request path.
 *
 * `assertIsolatedDatabaseUrl` is the strict form used by the repository
 * factory and by tests: it throws so a misconfiguration cannot be ignored.
 */

export const WORKFORCE_DATABASE_ENV = "AI_WORKFORCE_DATABASE_URL";
export const WORKFORCE_PERSISTENCE_ENV = "AI_WORKFORCE_PERSISTENCE";

/** Hosts that are by definition this machine (or its container init). */
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]", "host.docker.internal", "0.0.0.0"]);

export type IsolatedDatabaseInfo = {
  url: string;
  host: string;
  port: string | null;
  database: string;
};

/**
 * @throws PERSISTENCE_UNSAFE when the URL is missing, unparseable, or points
 *         anywhere other than loopback.
 */
export function assertIsolatedDatabaseUrl(rawUrl: string | undefined | null): IsolatedDatabaseInfo {
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
  if (!LOOPBACK_HOSTS.has(host)) {
    throw new AiWorkforceError(
      "PERSISTENCE_UNSAFE",
      `Workforce persistence is restricted to isolated loopback databases; "${host}" is not loopback`,
      { host, env: WORKFORCE_DATABASE_ENV },
    );
  }

  const database = parsed.pathname.replace(/^\//, "");
  if (!database) {
    throw new AiWorkforceError("PERSISTENCE_UNSAFE", "Workforce database URL has no database name", { host });
  }

  return { url: rawUrl, host, port: parsed.port || null, database };
}

export type PersistenceResolution =
  | { kind: "IN_MEMORY"; reason: string }
  | { kind: "DATABASE"; reason: string; info: IsolatedDatabaseInfo };

/**
 * Resolves where workforce state should live.
 *
 * Fail-closed: every path that is not a verified loopback database resolves to
 * IN_MEMORY, and the reason is surfaced in the UI/status endpoint so a
 * misconfiguration is visible instead of silent.
 */
export function resolvePersistence(env: Record<string, string | undefined> = process.env): PersistenceResolution {
  const mode = (env[WORKFORCE_PERSISTENCE_ENV] ?? "memory").toLowerCase();
  const rawUrl = env[WORKFORCE_DATABASE_ENV];

  if (mode !== "database") {
    return { kind: "IN_MEMORY", reason: `persistence mode is "${mode}" (set ${WORKFORCE_PERSISTENCE_ENV}=database to enable)` };
  }

  try {
    const info = assertIsolatedDatabaseUrl(rawUrl);
    return { kind: "DATABASE", reason: `isolated database verified (${info.host}/${info.database})`, info };
  } catch (error) {
    const message = error instanceof AiWorkforceError ? error.message : "workforce database URL was rejected";
    // Never connect, never throw into the request path — stay in memory.
    return { kind: "IN_MEMORY", reason: `database requested but rejected: ${message}` };
  }
}
