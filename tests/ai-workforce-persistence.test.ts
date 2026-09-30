import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { execSync } from "node:child_process";
import path from "node:path";

import { createControlCore } from "@/modules/ai-workforce/core/create-core";
import { AiWorkforceError } from "@/modules/ai-workforce/core/errors";
import { createExecutionContext, createServiceIdentity, type ActorContext } from "@/modules/ai-workforce/core/execution-context";
import { createSequentialIdFactory, sequentialClock } from "@/modules/ai-workforce/core/ids";
import type { WorkforcePorts } from "@/modules/ai-workforce/core/ports";
import { createPrismaRepositories } from "@/modules/ai-workforce/persistence/prisma-repositories";
import {
  createWorkforcePrismaClient,
  type WorkforcePrismaHandle,
} from "@/modules/ai-workforce/persistence/prisma-client";
import { derivePermissionTokens } from "@/modules/ai-workforce/policies/permission-policy";
import type { ToolAdapter } from "@/modules/ai-workforce/registry/tool-definition";
import { controlPlaneToolAdapters } from "@/modules/ai-workforce/tools";
import { systemStagingWriteTool } from "@/modules/ai-workforce/tools/adapters/system.tools";

/**
 * LOCAL-ONLY persistence proof.
 *
 * This file is the only place the workforce repositories touch a database, and
 * it is deliberately unable to touch the wrong one:
 *
 *   - it runs against a throwaway database created here, on a loopback host;
 *   - it is skipped entirely unless `AI_WORKFORCE_TEST_DATABASE_URL` is set;
 *   - `createWorkforcePrismaClient` refuses any non-loopback URL;
 *   - the schema comes from the PROPOSED migration files (1A then 1B), so the
 *     SQL that will one day run on a real server is executed somewhere first.
 *
 * It never reads `DATABASE_URL` and never writes to a business table.
 */

const BASE_URL = process.env.AI_WORKFORCE_TEST_DATABASE_URL;
const DB_NAME = "ai_workforce_test";
const DB_URL = BASE_URL ? `${BASE_URL.replace(/\/$/, "")}/${DB_NAME}` : "";
const REPO_ROOT = path.resolve(__dirname, "..");

const PSQL_BIN = process.env.PSQL_BIN || "C:\\Program Files\\PostgreSQL\\18\\bin\\psql.exe";
const PORT = BASE_URL ? new URL(BASE_URL).port || "5432" : "5432";

const MIGRATIONS = [
  "prisma/proposed-migrations/AI_WORKFORCE_PHASE_1A/migration.sql",
  "prisma/proposed-migrations/AI_WORKFORCE_PHASE_1B/migration.sql",
];

const describeIfDatabase = BASE_URL ? describe : describe.skip;

function psql(sql: string, database = "postgres") {
  return execSync(`"${PSQL_BIN}" -h 127.0.0.1 -p ${PORT} -U postgres -w -v ON_ERROR_STOP=1 -c "${sql}" -d ${database}`, {
    env: { ...process.env, PGPASSWORD: "postgres" },
    stdio: "pipe",
    cwd: REPO_ROOT,
  });
}

function psqlFile(file: string) {
  return execSync(
    `"${PSQL_BIN}" -h 127.0.0.1 -p ${PORT} -U postgres -w -v ON_ERROR_STOP=1 -f "${path.join(REPO_ROOT, file)}" -d ${DB_NAME}`,
    { env: { ...process.env, PGPASSWORD: "postgres" }, stdio: "pipe", cwd: REPO_ROOT },
  );
}

function superAdmin(): ActorContext {
  return {
    userId: "user_db_test",
    name: "DB Test",
    role: "SUPER_ADMIN",
    isSuperAdmin: true,
    hasOfficeFinanceFull: true,
    accessibleBusinessSlugs: ["nexup"],
    permissionTokens: derivePermissionTokens({
      role: "SUPER_ADMIN",
      isSuperAdmin: true,
      hasOfficeFinanceFull: true,
      accessibleBusinessSlugs: ["nexup"],
    }),
  };
}

const noPorts: WorkforcePorts = {
  clients: { async search() { return []; } },
  projects: { async list() { return []; } },
  capital: {
    async summary() {
      return { totalReceived: 0, totalSpent: 0, available: 0, contributionCount: 0, spendCount: 0, funderCount: 0 };
    },
  },
};

describeIfDatabase("Phase 1B — Prisma repositories against an isolated local database", () => {
  const handles: WorkforcePrismaHandle[] = [];

  /** One shared counter: every core in this file counts into it. */
  let executions = 0;

  function countingTools(): readonly ToolAdapter[] {
    const counting: ToolAdapter = {
      definition: { ...systemStagingWriteTool.definition },
      async handler(input, ctx) {
        executions += 1;
        return systemStagingWriteTool.handler(input as never, ctx);
      },
    };
    return [counting, ...controlPlaneToolAdapters.filter((entry) => entry.definition.id !== counting.definition.id)];
  }

  /** A "process": its own client, its own id factory, its own core. */
  function boot(prefix: string) {
    const handle = createWorkforcePrismaClient(DB_URL);
    handles.push(handle);

    const ids = createSequentialIdFactory(prefix);
    const now = sequentialClock("2026-03-01T00:00:00.000Z", 1000);

    const core = createControlCore({
      ports: noPorts,
      tools: countingTools(),
      ids,
      now,
      sleep: async () => {},
      repositories: createPrismaRepositories(handle.client, { ids, now }),
      persistence: "DATABASE",
    });

    return { core, handle };
  }

  beforeAll(async () => {
    executions = 0;
    try {
      psql(`DROP DATABASE IF EXISTS "${DB_NAME}" WITH (FORCE)`);
    } catch {
      /* may not exist */
    }
    psql(`CREATE DATABASE "${DB_NAME}"`);

    // The PROPOSED migrations are applied here — first 1A, then the 1B delta.
    for (const file of MIGRATIONS) psqlFile(file);

    // Regenerates the Prisma client so the ai_* models exist. Local only.
    execSync("npx prisma generate", { env: process.env, stdio: "pipe", cwd: REPO_ROOT });

    // Evidence: the tables that exist after applying the two proposed files.
    execSync(`"${PSQL_BIN}" -h 127.0.0.1 -p ${PORT} -U postgres -w -c "\\dt ai_*" -d ${DB_NAME}`, {
      env: { ...process.env, PGPASSWORD: "postgres" },
      stdio: "inherit",
      cwd: REPO_ROOT,
    });
  }, 240_000);

  afterAll(async () => {
    for (const handle of handles) {
      try {
        await handle.disconnect();
      } catch {
        /* ignore */
      }
    }
    try {
      psql(`DROP DATABASE IF EXISTS "${DB_NAME}" WITH (FORCE)`);
    } catch {
      /* ignore */
    }
  });

  it("persists a job, an approval and a run in real rows, then reloads them with a fresh process", async () => {
    const first = boot("db1");
    const context = createExecutionContext({
      serviceIdentity: createServiceIdentity("LOCAL"),
      actor: superAdmin(),
      source: "EVENT", // autonomous → approval required
      now: new Date("2026-03-01T00:00:00.000Z"),
    });

    const job = await first.core.jobs.create({
      capability: "system.staging_write",
      input: { note: "اختبار قاعدة بيانات معزولة" },
      context,
    });
    const parked = await first.core.jobs.run(job.id);
    expect(parked.status).toBe("WAITING_APPROVAL");
    expect(executions).toBe(0);

    const approvalId = parked.job.approvalId as string;

    /* ── A DIFFERENT process, a DIFFERENT pool, the SAME database ── */
    const second = boot("db2");

    // The parked job and its pending approval survived the reload.
    const reloadedJob = await second.core.jobs.requireJob(job.id);
    expect(reloadedJob.status).toBe("WAITING_APPROVAL");
    expect(reloadedJob.approvalId).toBe(approvalId);
    expect(reloadedJob.contextSnapshot?.actor.userId).toBe("user_db_test");

    const reloadedApproval = await second.core.approvalService.get(approvalId);
    expect(reloadedApproval).toMatchObject({
      status: "PENDING",
      toolId: "system.staging_write",
      jobId: job.id,
      riskLevel: "HIGH",
      requestedByUserId: "user_db_test",
      requestedForUserId: "user_db_test",
    });

    // Audit events persisted (append-only, JSONB payload).
    const events = await second.core.recorder.listJobEvents(job.id, 50);
    expect(events.map((event) => event.type)).toEqual([
      "job.created",
      "job.transitioned",
      "job.transitioned",
      "approval.requested",
    ]);

    // Approve from the SECOND process: the policy is re-checked there.
    const decision = await second.core.approvalService.approve({
      approvalId,
      actor: superAdmin(),
      reason: "موافقة من عملية أخرى",
    });
    expect(decision.approval.status).toBe("APPROVED");
    expect(decision.outcome?.status).toBe("COMPLETED");
    expect(executions).toBe(1);

    // The result is a row, not a memory: read it back with the FIRST process.
    const finalJob = await first.core.jobs.requireJob(job.id);
    expect(finalJob.status).toBe("COMPLETED");
    expect(finalJob.history.map((step) => step.to)).toEqual(["PLANNED", "WAITING_APPROVAL", "READY", "RUNNING", "COMPLETED"]);
    expect(finalJob.error).toBeUndefined();

    const run = await first.core.recorder.getRun(finalJob.runId as string);
    expect(run).toMatchObject({ status: "SUCCEEDED", toolId: "system.staging_write" });
    expect(run?.input).toMatchObject({ note: "اختبار قاعدة بيانات معزولة" });
    expect(run?.output).toMatchObject({ businessImpact: "NONE", approvalId });

    /* ── Idempotency across processes ── */
    const duplicate = await second.core.approvalService.approve({ approvalId, actor: superAdmin() });
    expect(duplicate.idempotent).toBe(true);
    expect(executions).toBe(1);
    await expect(second.core.jobs.run(job.id)).rejects.toThrow(/already finished/);

    console.log(
      [
        "",
        "════════ PHASE 1B — REAL DATABASE EVIDENCE ════════",
        `database     ${DB_NAME}@127.0.0.1 (loopback, throwaway)`,
        `migrations   1A + 1B applied from prisma/proposed-migrations`,
        `job          ${job.id}   status=${finalJob.status}`,
        `history      ${finalJob.history.map((step) => `${step.from}→${step.to}`).join("  ")}`,
        `approval     ${approvalId}   approved by ${reloadedApproval.decidedByUserId ?? "user_db_test"} (second process)`,
        `run          ${run?.id}  status=${run?.status}`,
        `result       ${JSON.stringify(run?.output)}`,
        `handler executions = ${executions}   (across two processes)`,
        "═══════════════════════════════════════════════════",
        "",
      ].join("\n"),
    );
  }, 120_000);

  it("compare-and-set refuses a stale job write at the database level", async () => {
    const { core } = boot("db3");
    const context = createExecutionContext({
      serviceIdentity: createServiceIdentity("LOCAL"),
      actor: superAdmin(),
      source: "MANUAL",
      now: new Date("2026-03-01T00:00:00.000Z"),
    });

    const job = await core.jobs.create({ capability: "capital.summary", input: {}, context });

    // Stale write: claim the job is READY when the row says CREATED.
    const stale = await core.repositories.jobs.update({ ...job, status: "READY" }, ["CREATED"]);
    expect(stale).not.toBeNull();

    // A second attempt with the same expectation loses the compare-and-set.
    const loser = await core.repositories.jobs.update({ ...job, status: "CANCELLED" }, ["CREATED"]);
    expect(loser).toBeNull();

    const stored = await core.jobs.requireJob(job.id);
    expect(stored.status).toBe("READY");
  }, 60_000);

  it("enforces the approval compare-and-set in SQL, not in application memory", async () => {
    const { core } = boot("db4");
    const context = createExecutionContext({
      serviceIdentity: createServiceIdentity("LOCAL"),
      actor: superAdmin(),
      source: "EVENT",
      now: new Date("2026-03-01T00:00:00.000Z"),
    });

    const job = await core.jobs.create({
      capability: "system.staging_write",
      input: { note: "سباق على نفس الموافقة" },
      context,
    });
    const parked = await core.jobs.run(job.id);
    const approvalId = parked.job.approvalId as string;

    await core.approvals.decide({ approvalId, decision: "REJECTED", byUserId: "user_db_test" });

    const error = await core.approvals
      .decide({ approvalId, decision: "APPROVED", byUserId: "user_db_test" })
      .then(
        () => null,
        (e: unknown) => e as AiWorkforceError,
      );

    expect(error?.code).toBe("APPROVAL_ALREADY_DECIDED");
    expect(executions).toBe(1); // still only the run from the first test
  }, 60_000);
});
