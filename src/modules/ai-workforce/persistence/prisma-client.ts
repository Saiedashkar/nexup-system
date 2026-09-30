import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import { AiWorkforceError } from "../core/errors";

/**
 * Dedicated Prisma client for the workforce tables.
 *
 * Deliberately NOT the legacy `@/lib/prisma` client: that pool is bound to
 * `DATABASE_URL`, which is production data. Workforce persistence gets its own
 * pool bound to `AI_WORKFORCE_DATABASE_URL`, whose host has already been
 * verified as loopback by `policies/persistence-safety.ts`. If the URL is not
 * loopback, this function is never reached.
 *
 * No TLS: the guard only ever admits a local database.
 *
 * The handle owns BOTH the Prisma client and the underlying pg pool, so
 * shutting down actually closes the sockets instead of leaving the pool to be
 * torn down by whatever happens to the database next.
 */

export type WorkforcePrismaHandle = {
  client: PrismaClient;
  pool: Pool;
  disconnect: () => Promise<void>;
};

export function createWorkforcePrismaClient(url: string): WorkforcePrismaHandle {
  const pool = new Pool({ connectionString: url, ssl: false });
  const adapter = new PrismaPg(pool);
  const client = new PrismaClient({ adapter });

  assertWorkforceSchema(client);

  return {
    client,
    pool,
    async disconnect() {
      try {
        await client.$disconnect();
      } finally {
        await pool.end();
      }
    },
  };
}

/**
 * Fails closed when the connected database does not expose the `ai_*` tables.
 * A missing `prisma generate` (or an unmigrated database) must be a clear
 * error, not a `undefined.create` crash deep inside a job run.
 */
export function assertWorkforceSchema(client: unknown): void {
  const candidate = client as Record<string, unknown>;
  const required = ["aiJob", "aiRun", "aiRunEvent", "aiApproval"];
  const missing = required.filter((model) => !candidate[model]);
  if (missing.length > 0) {
    throw new AiWorkforceError(
      "PERSISTENCE_UNAVAILABLE",
      `Workforce tables are not available on the connected database (missing delegates: ${missing.join(", ")}). Run "prisma generate" and apply the proposed workforce migration locally.`,
      { missing },
    );
  }
}
