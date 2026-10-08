#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-require-imports */

/**
 * Read a persisted execution CLAIM in a process that shares NOTHING with
 * whatever wrote it.
 *
 * This exists to make the Step-5A-2 durability claim checkable the honest way.
 * The test suite re-reads a claim through a fresh repository inside the test
 * process, which is a real reconstruction but is still the SAME operating-system
 * process. This script is a separate `node` invocation with no imports from
 * `src/`, no in-memory ledger and no shared module state — the database is the
 * only thing it can possibly be reading from.
 *
 * It is also the operator-facing reproduction tool: after a durability proof, an
 * operator can point it at the throwaway cluster and see the claim that outlived
 * the process which wrote it.
 *
 * Usage:
 *   node scripts/read-durable-claim.cjs <databaseUrl> <idempotencyKey>
 *
 * Prints one JSON object on stdout. Contains no credentials.
 */

const { PrismaClient } = require("@prisma/client");
const { PrismaPg } = require("@prisma/adapter-pg");
const { Pool } = require("pg");

async function main() {
  const [url, idempotencyKey] = process.argv.slice(2);
  if (!url || !idempotencyKey) {
    console.error("usage: node scripts/read-durable-claim.cjs <databaseUrl> <idempotencyKey>");
    process.exit(2);
  }

  const pool = new Pool({ connectionString: url, ssl: false });
  const client = new PrismaClient({ adapter: new PrismaPg(pool) });

  try {
    const claim = await client.aiExecutionClaim.findUnique({ where: { idempotencyKey } });
    if (!claim) {
      console.log(JSON.stringify({ found: false, idempotencyKey }));
      return;
    }

    console.log(
      JSON.stringify({
        found: true,
        idempotencyKey,
        claim: {
          id: claim.id,
          missionId: claim.missionId,
          taskId: claim.taskId,
          attempt: claim.attempt,
          actorId: claim.actorId,
          capabilityId: claim.capabilityId,
          runtimeId: claim.runtimeId,
          state: claim.state,
          executionRecordId: claim.executionRecordId,
          handleId: claim.handleId,
          leaseOwner: claim.leaseOwner,
          leaseExpiresAt: claim.leaseExpiresAt ? claim.leaseExpiresAt.toISOString() : null,
          detail: claim.detail,
          claimedAt: claim.claimedAt.toISOString(),
          updatedAt: claim.updatedAt.toISOString(),
        },
      }),
    );
  } finally {
    try {
      await client.$disconnect();
    } finally {
      await pool.end();
    }
  }
}

main().catch((error) => {
  console.error(error && error.message ? error.message : String(error));
  process.exit(1);
});
