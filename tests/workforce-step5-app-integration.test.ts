import { execSync } from "node:child_process";
import path from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createSequentialIdFactory, sequentialClock } from "@/modules/ai-workforce/core/ids";
import { createWorkforcePrismaClient, type WorkforcePrismaHandle } from "@/modules/ai-workforce/persistence/prisma-client";
import {
  STRATEGY_INTERNAL_BRIEF_CAPABILITY_ID,
  createHermesRuntime,
  type HermesAsyncTransport,
  type HermesRunStart,
  type HermesRuntimeConfig,
  type HermesTransportRequest,
  type HermesTransportResult,
} from "@/modules/workforce";
import {
  createWorkforceApplication,
  type WorkforceApplication,
} from "@/modules/workforce/application";
import { DeterministicHermesTransport } from "@/modules/workforce/runtimes/hermes/testing/deterministic-transport";

/**
 * STEP 5/8 — the APPLICATION boundary, against a real PostgreSQL.
 *
 * The audit's remaining gap was that the dispatcher, the orchestrator and the
 * durable repositories existed but no application constructed them. This file
 * exercises the thing a running NEXUP now calls:
 *
 *   Command → durable Mission → durable Task → Actor → Capability authorisation
 *           → Runtime → Execution → Result → durable Review → HUMAN decision
 *           → durable COMPLETED Mission
 *
 * through `createWorkforceApplication` — the SAME factory the API routes use —
 * with a real database, the real dispatcher, the real Hermes adapter and the
 * real durable repositories. Only the transport is deterministic (an explicit
 * `allowTestTransport` opt-in), so there is no network and no provider turn.
 *
 * LOCAL AND ISOLATED, by construction: skipped unless
 * `AI_WORKFORCE_TEST_DATABASE_URL` is set, creates and drops its OWN database in
 * the throwaway development cluster, and never reads `DATABASE_URL`.
 */

const BASE_URL = process.env.AI_WORKFORCE_TEST_DATABASE_URL;
const DB_NAME = "workforce_app_integration_test";
const DB_URL = BASE_URL ? `${BASE_URL.replace(/\/$/, "")}/${DB_NAME}` : "";
const REPO_ROOT = path.resolve(__dirname, "..");
const PSQL_BIN = process.env.PSQL_BIN || "C:\\Program Files\\PostgreSQL\\18\\bin\\psql.exe";
const PORT = BASE_URL ? new URL(BASE_URL).port || "5432" : "5432";

const MIGRATIONS = [
  "prisma/proposed-migrations/AI_WORKFORCE_PHASE_1A/migration.sql",
  "prisma/proposed-migrations/AI_WORKFORCE_PHASE_1B/migration.sql",
  "prisma/proposed-migrations/AI_WORKFORCE_PHASE_2/migration.sql",
  "prisma/proposed-migrations/AI_WORKFORCE_PHASE_3/migration.sql",
];

const FOUNDER = "actor_founder";
const MARKER = "NEXUP_APP_INTEGRATION_OK";
const describeIfDatabase = BASE_URL ? describe : describe.skip;

function psql(sql: string, database = "postgres") {
  return execSync(
    `"${PSQL_BIN}" -h 127.0.0.1 -p ${PORT} -U postgres -w -v ON_ERROR_STOP=1 -c "${sql}" -d ${database}`,
    { env: { ...process.env, PGPASSWORD: "postgres" }, stdio: "pipe", cwd: REPO_ROOT },
  );
}

function psqlFile(file: string) {
  return execSync(
    `"${PSQL_BIN}" -h 127.0.0.1 -p ${PORT} -U postgres -w -v ON_ERROR_STOP=1 -f "${path.join(REPO_ROOT, file)}" -d ${DB_NAME}`,
    { env: { ...process.env, PGPASSWORD: "postgres" }, stdio: "pipe", cwd: REPO_ROOT },
  );
}

function hermesConfig(): HermesRuntimeConfig {
  return {
    runtimeId: "runtime_hermes_saeed",
    displayName: "Hermes Agent Runtime",
    transport: "BRIDGE",
    profile: "saieed",
    bridgeEndpoint: "https://bridge.invalid",
    bridgeKeyId: "nexup-vercel",
    bridgeSecretPresent: true,
    timeoutMs: 5_000,
    maxOutputBytes: 8_192,
    capabilities: { submit: true, status: true, health: true, cancel: true, resume: false },
    authTokenPresent: false,
    authHeaderName: "Authorization",
    authScheme: "Bearer",
  };
}

/**
 * A transport that COUNTS. The deterministic transport proves the chain works;
 * a counter proves it did not run when it should not have, which is the actual
 * claim ("zero transport calls on refusal").
 */
class CountingTransport implements HermesAsyncTransport {
  readonly kind = "DETERMINISTIC" as const;
  readonly provenance = "TEST" as const;
  starts = 0;
  invokes = 0;

  constructor(private readonly inner: DeterministicHermesTransport) {}

  async startRun(request: HermesTransportRequest): Promise<HermesRunStart> {
    this.starts += 1;
    return this.inner.startRun(request);
  }

  async invoke(request: HermesTransportRequest): Promise<HermesTransportResult> {
    this.invokes += 1;
    return this.inner.invoke(request);
  }
}

describeIfDatabase("STEP 5 — the application boundary runs the whole lifecycle on a real database", () => {
  const handles: WorkforcePrismaHandle[] = [];

  type Booted = {
    application: WorkforceApplication;
    handle: WorkforcePrismaHandle;
    transport: CountingTransport;
    actorId: string;
  };

  /** One "process": its own pool, ids, clock and registries. */
  async function boot(prefix: string): Promise<Booted> {
    const handle = createWorkforcePrismaClient(DB_URL);
    handles.push(handle);

    const ids = createSequentialIdFactory(prefix);
    const now = sequentialClock("2026-08-02T00:00:00.000Z", 1000);
    const transport = new CountingTransport(new DeterministicHermesTransport());
    const runtime = createHermesRuntime(hermesConfig(), {
      transport,
      ids,
      now,
      allowTestTransport: true,
    });

    const application = await createWorkforceApplication(handle, { ids, now, runtime });
    if (!application.routing.actorId) throw new Error(`the application has no routed actor: ${application.routing.reason}`);

    return { application, handle, transport, actorId: application.routing.actorId };
  }

  function command(key: string, overrides: Record<string, unknown> = {}) {
    return {
      idempotencyKey: key,
      scope: "test:application",
      title: `Command ${key}`,
      goal: "prove the application boundary",
      requestedBy: FOUNDER,
      owner: FOUNDER,
      tasks: [
        {
          title: `${key}-task`,
          objective: "produce a brief",
          instruction: `Return exactly: ${MARKER}`,
        },
      ],
      ...overrides,
    };
  }

  async function executionsOf(application: WorkforceApplication, missionId: string) {
    return application.domain.executionRecords.listForMission(missionId as never);
  }

  beforeAll(() => {
    psql(`DROP DATABASE IF EXISTS ${DB_NAME}`);
    psql(`CREATE DATABASE ${DB_NAME}`);
    for (const migration of MIGRATIONS) psqlFile(migration);
  });

  afterAll(async () => {
    for (const handle of handles) await handle.disconnect().catch(() => undefined);
    if (BASE_URL) psql(`DROP DATABASE IF EXISTS ${DB_NAME}`);
  });

  it("runs Command → Mission → Task → Actor → Capability → Runtime → Execution → Review → COMPLETED", async () => {
    const { application, transport, actorId } = await boot("it1");

    const outcome = await application.commands.issueCommand(command("lifecycle-1"));
    expect(outcome.kind).toBe("issued");
    if (outcome.kind !== "issued") throw new Error("expected an issued command");

    // The plan reached a REAL actor with a REAL assignment and a REAL runtime.
    expect(outcome.mission.state).toBe("RUNNING");
    expect(outcome.tasks).toHaveLength(1);
    const task = outcome.tasks[0]!;
    expect(task.assignedActorId).toBe(actorId);
    expect(task.requiredCapabilityId).toBe(STRATEGY_INTERNAL_BRIEF_CAPABILITY_ID);
    expect(task.state).toBe("RUNNING");
    // ...and the runtime was actually called, once.
    expect(transport.starts).toBe(1);

    // `drain` settles the in-flight task through the runtime port and then
    // reconciles the mission — the same call an API worker or a restarted
    // process makes.
    const settled = await application.commands.drain(outcome.mission.id);
    expect(settled.mission.state).toBe("WAITING");

    const snapshot = await application.commands.snapshot(outcome.mission.id);
    const settledTask = snapshot.tasks[0]!;
    expect(settledTask.state).toBe("REVIEW");
    expect(snapshot.executions).toHaveLength(1);
    expect(snapshot.executions[0]!.status).toBe("SUCCEEDED");
    // The runtime's own handle is always recorded. The PROVIDER reference is
    // deliberately absent here: `extractProviderExecutionId` refuses to reuse
    // the handle as the provider id, and this deterministic transport reports
    // the same id for both. The live durability proof asserts it present
    // against the real bridge.
    expect(snapshot.executions[0]!.handleId).toBeTruthy();
    expect(snapshot.executions[0]!.providerExecutionId ?? null).toBeNull();
    expect(snapshot.reviews).toHaveLength(1);
    expect(snapshot.reviews[0]!.state).toBe("PENDING");
    expect(snapshot.reviews[0]!.reviewerActorId).toBe(FOUNDER);

    const decided = await application.commands.decide(snapshot.reviews[0]!.id, {
      decision: "APPROVED",
      decidedBy: FOUNDER,
    });
    expect(decided.mission.state).toBe("COMPLETED");

    const final = await application.commands.snapshot(outcome.mission.id);
    expect(final.tasks[0]!.state).toBe("COMPLETED");
    expect(final.reviews[0]!.state).toBe("APPROVED");
    expect(final.reviews[0]!.decidedBy).toBe(FOUNDER);

    // The read models the Command Center will draw agree with the writes.
    expect(await application.queries.activeMissions()).toHaveLength(0);
    const activity = await application.queries.recentActivity();
    expect(activity).toHaveLength(1);
    expect(activity[0]!.status).toBe("SUCCEEDED");
    expect(activity[0]!.missionId).toBe(outcome.mission.id);
    expect(await application.queries.decisionQueue()).toHaveLength(0);
  }, 120_000);

  it("returns the SAME mission for a retry, and runs nothing new", async () => {
    const { application, transport } = await boot("it2");

    const first = await application.commands.issueCommand(command("retry-1"));
    expect(first.kind).toBe("issued");
    if (first.kind !== "issued") throw new Error("expected an issued command");
    const startsAfterFirst = transport.starts;
    const executionsAfterFirst = await executionsOf(application, first.mission.id);
    expect(executionsAfterFirst).toHaveLength(1);

    // The client retries the SAME command (same key, same body).
    const retry = await application.commands.issueCommand(command("retry-1"));
    expect(retry.kind).toBe("replayed");
    expect(retry.replayed).toBe(true);
    if (retry.kind !== "replayed") throw new Error("expected a replay");

    expect(retry.mission.id).toBe(first.mission.id);
    // No duplicate task, no duplicate execution, no second provider turn.
    expect(retry.tasks).toHaveLength(1);
    expect(await executionsOf(application, first.mission.id)).toHaveLength(1);
    expect(transport.starts).toBe(startsAfterFirst);
    // ...and the retry did not advance the mission it already owns.
    expect(retry.mission.state).toBe("RUNNING");
  }, 120_000);

  it("refuses a reused key with a DIFFERENT command (COMMAND_KEY_REUSED)", async () => {
    const { application } = await boot("it3");
    await application.commands.issueCommand(command("reuse-1"));

    await expect(
      application.commands.issueCommand(command("reuse-1", { goal: "a completely different goal" })),
    ).rejects.toMatchObject({ code: "COMMAND_KEY_REUSED" });
  }, 120_000);

  it("still creates a NEW mission for a genuinely new command", async () => {
    const { application } = await boot("it4");
    const first = await application.commands.issueCommand(command("new-1"));
    const second = await application.commands.issueCommand(command("new-2"));
    if (first.kind !== "issued" || second.kind !== "issued") throw new Error("expected both to be issued");
    expect(second.mission.id).not.toBe(first.mission.id);

    // Scoped to THIS test's missions: the file shares one database, so an
    // absolute count would be measuring the other tests too.
    const active = await application.queries.activeMissions();
    const ids = active.map((row) => row.missionId);
    expect(ids).toContain(first.mission.id);
    expect(ids).toContain(second.mission.id);
  }, 120_000);

  it("refuses a capability the actor is NOT assigned, with zero transport calls", async () => {
    const { application, transport } = await boot("it5");

    const outcome = await application.commands.issueCommand(
      command("unassigned-1", {
        tasks: [
          {
            title: "unassigned-task",
            objective: "try to run a capability nobody granted",
            instruction: "should never run",
            requiredCapabilityId: "strategy.not-assigned",
          },
        ],
      }),
    );
    if (outcome.kind !== "issued") throw new Error("expected an issued command");

    // FAIL CLOSED: the task is not dispatched, and the reason is reported.
    expect(outcome.tasks[0]!.state).toBe("READY");
    expect(outcome.changes.some((change) => change.includes("BLOCKED") && /not assigned/i.test(change))).toBe(true);
    expect(await executionsOf(application, outcome.mission.id)).toHaveLength(0);
    expect(transport.starts).toBe(0);
    expect(transport.invokes).toBe(0);
  }, 120_000);

  it("rehydrates the finished mission through a FRESH application", async () => {
    const { application } = await boot("it6");
    const outcome = await application.commands.issueCommand(command("rehydrate-1"));
    if (outcome.kind !== "issued") throw new Error("expected an issued command");
    await application.commands.drain(outcome.mission.id);
    const snapshot = await application.commands.snapshot(outcome.mission.id);
    expect(snapshot.reviews).toHaveLength(1);
    await application.commands.decide(snapshot.reviews[0]!.id, { decision: "APPROVED", decidedBy: FOUNDER });

    // A DIFFERENT application: new pool, new registries, new ids — nothing in
    // common except the database.
    const { application: restarted } = await boot("it6b");
    const reloaded = await restarted.commands.snapshot(outcome.mission.id);

    expect(reloaded.mission.state).toBe("COMPLETED");
    expect(reloaded.tasks[0]!.state).toBe("COMPLETED");
    expect(reloaded.executions[0]!.status).toBe("SUCCEEDED");
    expect(reloaded.reviews[0]!.state).toBe("APPROVED");
    expect(reloaded.reviews[0]!.decidedBy).toBe(FOUNDER);
    expect(reloaded.mission.history.map((step) => step.to)).toContain("COMPLETED");
  }, 120_000);
});
