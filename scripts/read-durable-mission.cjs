#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-require-imports */

/**
 * Read a persisted workforce mission and its whole chain, in a process that
 * shares NOTHING with whatever wrote it.
 *
 * This exists to make the Step-5 durability claim checkable the honest way: the
 * test suites re-hydrate through a fresh domain inside the test process, which
 * is a real reconstruction but is still the SAME operating-system process. This
 * script is a separate `node` invocation with no imports from `src/`, no
 * in-memory registry and no shared module state — the database is the only
 * thing it can possibly be reading from.
 *
 * It is also the operator-facing reproduction tool: after a durability proof,
 * an operator can point it at the throwaway cluster and see the records that
 * outlived the process that wrote them.
 *
 * Usage:
 *   AI_WORKFORCE_TEST_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5499 \
 *     node scripts/read-durable-mission.cjs <databaseUrl> <missionId>
 *
 * Prints one JSON object on stdout. Contains no credentials.
 */

const { PrismaClient } = require("@prisma/client");
const { PrismaPg } = require("@prisma/adapter-pg");
const { Pool } = require("pg");

async function main() {
  const [url, missionId] = process.argv.slice(2);
  if (!url || !missionId) {
    console.error("usage: node scripts/read-durable-mission.cjs <databaseUrl> <missionId>");
    process.exit(2);
  }

  const pool = new Pool({ connectionString: url, ssl: false });
  const client = new PrismaClient({ adapter: new PrismaPg(pool) });

  try {
    const mission = await client.aiMission.findUnique({ where: { id: missionId } });
    if (!mission) {
      console.log(JSON.stringify({ found: false, missionId }));
      return;
    }

    const tasks = await client.aiTask.findMany({
      where: { missionId },
      orderBy: { sequence: "asc" },
    });
    const executions = await client.aiExecutionRecord.findMany({
      where: { missionId },
      orderBy: [{ taskId: "asc" }, { attempt: "asc" }],
    });
    const reviews = await client.aiTaskReview.findMany({
      where: { taskId: { in: tasks.map((task) => task.id) } },
      orderBy: { requestedAt: "asc" },
    });

    console.log(
      JSON.stringify({
        found: true,
        missionId,
        mission: {
          id: mission.id,
          state: mission.state,
          businessId: mission.businessId,
          workspaceRef: mission.workspaceRef,
          projectRef: mission.projectRef,
          clientRef: mission.clientRef,
          taskRefs: mission.taskRefs,
          historyTo: (mission.history || []).map((entry) => entry.to),
          finishedAt: mission.finishedAt ? mission.finishedAt.toISOString() : null,
        },
        tasks: tasks.map((task) => ({
          id: task.id,
          sequence: task.sequence,
          title: task.title,
          state: task.state,
          attempt: task.attempt,
          executionHandleId: task.executionHandleId,
          reviewId: task.reviewId,
          result: task.result,
        })),
        executions: executions.map((execution) => ({
          id: execution.id,
          taskId: execution.taskId,
          attempt: execution.attempt,
          handleId: execution.handleId,
          providerExecutionId: execution.providerExecutionId,
          idempotencyKey: execution.idempotencyKey,
          status: execution.status,
          auditTypes: (execution.audit || []).map((event) => event.type),
        })),
        reviews: reviews.map((review) => ({
          id: review.id,
          taskId: review.taskId,
          state: review.state,
          decidedBy: review.decidedBy,
          decidedAt: review.decidedAt ? review.decidedAt.toISOString() : null,
        })),
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
