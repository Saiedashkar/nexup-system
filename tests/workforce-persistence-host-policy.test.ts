import { describe, expect, it } from "vitest";

import {
  WORKFORCE_DATABASE_HOSTS_ENV,
  WORKFORCE_DATABASE_TARGET_ENV,
  assertIsolatedDatabaseUrl,
  classifyWorkforceDatabase,
  productionDatabaseAllowlist,
  resolvePersistence,
} from "@/modules/ai-workforce/policies/persistence-safety";

/**
 * The production database HOST POLICY.
 *
 * This is a pure policy: nothing here opens a connection, so a production-LOOKING
 * hostname can be tested without going anywhere near production. The Supabase
 * hostname below is deliberately a placeholder (`db.project-ref.supabase.co`) —
 * the real one is configuration, never source, and the policy must work for any
 * explicitly named host.
 *
 * What it has to prove:
 *
 *   - the DEFAULT stays narrow: loopback only, exactly as before;
 *   - a "production" target alone is not enough — the host must ALSO be named,
 *     so pointing at the wrong database cannot happen quietly;
 *   - an arbitrary external PostgreSQL host is refused under EITHER target;
 *   - look-alike hosts (`127.0.0.1.`)
 *     and userinfo tricks (`postgres://127.0.0.1@evil.example/db`) are refused;
 *   - a malformed URL, a missing URL and an unknown target are refused;
 *   - nothing returned or thrown carries a credential.
 */

const PASSWORD = "super-secret-password";
const PROD_HOST = "db.project-ref.supabase.co";
const PROD_URL = `postgresql://postgres.abcdefghijkl:${PASSWORD}@${PROD_HOST}:6543/postgres`;

function env(overrides: Record<string, string | undefined> = {}) {
  return { AI_WORKFORCE_PERSISTENCE: "database", ...overrides };
}

describe("workforce persistence host policy — the dev default", () => {
  it("admits loopback with no target or allowlist configured at all", () => {
    const resolution = resolvePersistence(env({ AI_WORKFORCE_DATABASE_URL: "postgresql://postgres@127.0.0.1:5501/nexup_dev" }));
    expect(resolution.kind).toBe("DATABASE");
    if (resolution.kind !== "DATABASE") throw new Error("expected a database resolution");
    expect(resolution.info.target).toBe("local");
    expect(resolution.info.host).toBe("127.0.0.1");
    // The reason is safe to display: host and database, never the URL.
    expect(resolution.reason).toContain("127.0.0.1/nexup_dev");
    expect(resolution.reason).not.toContain(PASSWORD);
  });

  it("refuses the production-looking host under the default local target", () => {
    const resolution = resolvePersistence(env({ AI_WORKFORCE_DATABASE_URL: PROD_URL }));
    expect(resolution.kind).toBe("IN_MEMORY");
    if (resolution.kind !== "IN_MEMORY") throw new Error("expected a refusal");
    expect(resolution.reason).toMatch(/restricted to loopback/i);
    // The refusal names the host (useful) and never the credentials.
    expect(resolution.reason).toContain(PROD_HOST);
    expect(resolution.reason).not.toContain(PASSWORD);
  });

  it("refuses any arbitrary external host, with no allowlist configured", () => {
    for (const host of ["db.example.com", "10.0.0.5", "postgres.internal.example", "0.0.0.0.evil.example"]) {
      const resolution = resolvePersistence(
        env({ AI_WORKFORCE_DATABASE_URL: `postgresql://u:p@${host}:5432/nexup` }),
      );
      expect(resolution.kind, host).toBe("IN_MEMORY");
    }
  });

  it("refuses look-alike and userinfo hosts even under a production target", () => {
    // A host that merely STARTS with a loopback address is not loopback, and it
    // is not in the allowlist either: both policies must refuse it.
    for (const lookalike of ["127.0.0.1.evil.example", "127.0.0.1.", "localhost.evil.example", "db.example.com"]) {
      for (const target of [undefined, "production"]) {
        const resolution = resolvePersistence(
          env({
            AI_WORKFORCE_DATABASE_URL: `postgresql://u:p@${lookalike}:5432/nexup`,
            [WORKFORCE_DATABASE_TARGET_ENV]: target,
            [WORKFORCE_DATABASE_HOSTS_ENV]: PROD_HOST,
          }),
        );
        expect(resolution.kind, `${lookalike} (target=${target ?? "local"})`).toBe("IN_MEMORY");
      }
    }

    // The userinfo trick: the host is `evil.example`, whatever the user field says.
    const trick = env({
      AI_WORKFORCE_DATABASE_URL: "postgresql://127.0.0.1@evil.example:5432/nexup",
      [WORKFORCE_DATABASE_TARGET_ENV]: "production",
      [WORKFORCE_DATABASE_HOSTS_ENV]: "127.0.0.1",
    });
    const resolution = resolvePersistence(trick);
    expect(resolution.kind).toBe("IN_MEMORY");
    if (resolution.kind !== "IN_MEMORY") throw new Error("expected a refusal");
    expect(resolution.reason).toContain("evil.example");
  });

  it("refuses a malformed URL, a missing URL, a bad protocol and a URL with no database", () => {
    for (const url of ["not a url", "", "mysql://u:p@127.0.0.1:3306/db", "postgresql://postgres@127.0.0.1:5501/"]) {
      const resolution = resolvePersistence(env({ AI_WORKFORCE_DATABASE_URL: url }));
      expect(resolution.kind, url).toBe("IN_MEMORY");
    }
    expect(resolvePersistence(env()).kind).toBe("IN_MEMORY");
  });

  it("refuses an unknown target rather than treating it as the default", () => {
    const resolution = resolvePersistence(
      env({ AI_WORKFORCE_DATABASE_URL: "postgresql://postgres@127.0.0.1:5501/nexup_dev", [WORKFORCE_DATABASE_TARGET_ENV]: "prod" }),
    );
    expect(resolution.kind).toBe("IN_MEMORY");
    if (resolution.kind !== "IN_MEMORY") throw new Error("expected a refusal");
    expect(resolution.reason).toContain("local|production");
  });
});

describe("workforce persistence host policy — the explicit production target", () => {
  it("admits the named host, and reports the target it was admitted under", () => {
    const resolution = resolvePersistence(
      env({
        AI_WORKFORCE_DATABASE_URL: PROD_URL,
        [WORKFORCE_DATABASE_TARGET_ENV]: "production",
        [WORKFORCE_DATABASE_HOSTS_ENV]: `db.other-project.supabase.co, ${PROD_HOST}`,
      }),
    );
    expect(resolution.kind).toBe("DATABASE");
    if (resolution.kind !== "DATABASE") throw new Error("expected a database resolution");
    expect(resolution.info.target).toBe("production");
    expect(resolution.info.host).toBe(PROD_HOST);
    expect(resolution.info.database).toBe("postgres");
    expect(resolution.info.port).toBe("6543");
    expect(resolution.reason).not.toContain(PASSWORD);
  });

  it("refuses a production target with an EMPTY allowlist", () => {
    const resolution = resolvePersistence(
      env({ AI_WORKFORCE_DATABASE_URL: PROD_URL, [WORKFORCE_DATABASE_TARGET_ENV]: "production" }),
    );
    expect(resolution.kind).toBe("IN_MEMORY");
    if (resolution.kind !== "IN_MEMORY") throw new Error("expected a refusal");
    expect(resolution.reason).toMatch(/empty/i);
  });

  it("refuses a production target whose host is simply not named", () => {
    const resolution = resolvePersistence(
      env({
        AI_WORKFORCE_DATABASE_URL: "postgresql://u:p@db.some-other-cluster.example:5432/nexup",
        [WORKFORCE_DATABASE_TARGET_ENV]: "production",
        [WORKFORCE_DATABASE_HOSTS_ENV]: PROD_HOST,
      }),
    );
    expect(resolution.kind).toBe("IN_MEMORY");
    if (resolution.kind !== "IN_MEMORY") throw new Error("expected a refusal");
    expect(resolution.reason).toMatch(/is not in/i);
  });

  it("still admits loopback under a production target, so a dev database stays usable", () => {
    const resolution = resolvePersistence(
      env({
        AI_WORKFORCE_DATABASE_URL: "postgresql://postgres@localhost:5501/nexup_dev",
        [WORKFORCE_DATABASE_TARGET_ENV]: "production",
        [WORKFORCE_DATABASE_HOSTS_ENV]: PROD_HOST,
      }),
    );
    expect(resolution.kind).toBe("DATABASE");
    if (resolution.kind !== "DATABASE") throw new Error("expected a database resolution");
    expect(resolution.info.target).toBe("local");
  });

  it("parses the allowlist as EXACT hostnames, lowercased, ignoring blanks", () => {
    const hosts = productionDatabaseAllowlist({
      [WORKFORCE_DATABASE_HOSTS_ENV]: ` ${PROD_HOST.toUpperCase()} , ,db.two.example,`,
    });
    expect(hosts).toEqual([PROD_HOST, "db.two.example"]);
    // A bare suffix can never be smuggled in as a wildcard.
    expect(hosts).not.toContain("supabase.co");
  });
});

describe("workforce persistence host policy — the strict local form", () => {
  it("still throws for anything but loopback, so callers that need a local database are unaffected", () => {
    expect(() => assertIsolatedDatabaseUrl(PROD_URL)).toThrow(/not loopback/i);
    expect(() => assertIsolatedDatabaseUrl(undefined)).toThrow(/not set/i);
    expect(assertIsolatedDatabaseUrl("postgresql://postgres@127.0.0.1:5501/dev").target).toBe("local");
  });

  it("classifies directly, without an environment, for callers that hold the inputs", () => {
    expect(classifyWorkforceDatabase("postgresql://postgres@127.0.0.1/dev", "local", []).target).toBe("local");
    expect(() => classifyWorkforceDatabase(PROD_URL, "local", [PROD_HOST])).toThrow(/loopback/i);
    expect(classifyWorkforceDatabase(PROD_URL, "production", [PROD_HOST]).target).toBe("production");
  });
});
