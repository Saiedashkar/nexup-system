import { execSync } from "node:child_process";
import path from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createSequentialIdFactory, sequentialClock } from "@/modules/ai-workforce/core/ids";
import { createWorkforcePrismaClient, type WorkforcePrismaHandle } from "@/modules/ai-workforce/persistence/prisma-client";
import { createHermesRuntime, type HermesRuntimeConfig } from "@/modules/workforce";
import { createWorkforceApplication, type WorkforceApplication } from "@/modules/workforce/application";
import { DeterministicHermesTransport } from "@/modules/workforce/runtimes/hermes/testing/deterministic-transport";

/**
 * STEP 5/8 — RE-ADOPTION: every remote outcome, on a real database.
 *
 * The restart suites prove the headline claim with whole OS processes. This file
 * is the MATRIX: one in-flight attempt, then a FRESH application whose runtime
 * reports each of the things a provider can report hours later.
 *
 *   still running          → nothing moves, nothing is faked
 *   completed while down   → REVIEW (a human accepts it)
 *   cancelled while down   → task and mission CANCELLED
 *   failed while down      → FAILED, and NEVER back to READY
 *   the runtime forgot it  → UNKNOWN + a human decision (never an auto-retry)
 *   the runtime can't be asked → nothing changes, and it is written down
 *   no runtime registered  → reported, not invented
 *
 * Two invariants are asserted in EVERY case, because they are the point:
 *
 *   - the transport's `runsStarted` stays 0: re-adoption observes, it does not
 *     resubmit, so a restart can never cause a second real run;
 *   - there is still exactly ONE execution record for the attempt.
 *
 * LOCAL AND ISOLATED: skipped unless `AI_WORKFORCE_TEST_DATABASE_URL` is set,
 * creates and drops its OWN database in the throwaway development cluster, and
 * never reads `DATABASE_URL`.
 */

const BASE_URL = process.env.AI_WORKFORCE_TEST_DATABASE_URL;
const DB_NAME = "workforce_adoption_test";
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
const MARKER = "NEXUP_READOPTION_OK";
const STRATEGY_ACTOR = "actor_internal_strategy_analyst";
const describeIfDatabase = BASE_URL ? describe : describe.skip;

type TransportOptions = ConstructorParameters<typeof DeterministicHermesTransport>[0];

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

function hermesConfig(runtimeId = "runtime_hermes_saeed"): HermesRuntimeConfig {
  return {
    runtimeId,
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

/** A transport that counts, so "it did not resubmit" is measured, not asserted. */
class CountingTransport {
  readonly provenance = "TEST" as const;
  starts = 0;

  constructor(private readonly inner: DeterministicHermesTransport) {}

  counts() {
    return this.inner.counts();
  }

  startRun(request: Parameters<DeterministicHermesTransport["startRun"]>[0]) {
    this.starts += 1;
    return this.inner.startRun(request);
  }

  async invoke(request: Parameters<DeterministicHermesTransport["invoke"]>[0]) {
    return this.inner.invoke(request);
  }
}

describeIfDatabase("STEP 5 — re-adoption of in-flight executions, against a real database", () => {
  const handles: WorkforcePrismaHandle[] = [];

  type Booted = {
    application: WorkforceApplication;
    transport: CountingTransport;
    runtimeId: string;
  };

  async function boot(prefix: string, options: TransportOptions = {}, runtimeId?: string): Promise<Booted> {
    const handle = createWorkforcePrismaClient(DB_URL);
    handles.push(handle);
    const ids = createSequentialIdFactory(prefix);
    const now = sequentialClock("2026-08-05T00:00:00.000Z", 1000);
    const transport = new CountingTransport(new DeterministicHermesTransport(options));
    const runtime = createHermesRuntime(hermesConfig(runtimeId), {
      transport: transport as never,
      ids,
      now,
      allowTestTransport: true,
    });
    const application = await createWorkforceApplication(handle, { ids, now, runtime });
    return { application, transport, runtimeId: runtime.identity.id };
  }

  function command(key: string) {
    return {
      idempotencyKey: key,
      scope: "test:adoption",
      title: `Adoption ${key}`,
      goal: "prove re-adoption never resubmits",
      requestedBy: FOUNDER,
      owner: FOUNDER,
      tasks: [{ title: `${key}-task`, objective: "produce a brief", instruction: `Return exactly: ${MARKER}` }],
    };
  }

  /**
   * Boots a process, issues a Command and leaves the attempt genuinely IN FLIGHT
   * by never draining it.
   *
   * `holdCompletionMs` is essential: with the default transport the provider run
   * completes inside `startRun`, so the execution RECORD is opened already
   * terminal and there would be nothing in flight to re-adopt. Holding the
   * completion is what makes this the situation a restart actually faces — an
   * attempt this process opened and never settled.
   */
  async function inFlight(prefix: string, key: string) {
    const { application } = await boot(prefix, { holdCompletionMs: 60_000 });
    const outcome = await application.commands.issueCommand(command(key));
    if (outcome.kind !== "issued") throw new Error(`expected an issued command, got ${outcome.kind}`);
    const snapshot = await application.commands.snapshot(outcome.mission.id);
    const task = snapshot.tasks[0]!;
    expect(task.state).toBe("RUNNING");
    expect(snapshot.executions).toHaveLength(1);
    return {
      missionId: outcome.mission.id,
      taskId: task.id,
      handleId: task.executionHandleId!,
      executionRecordId: snapshot.executions[0]!.id,
    };
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

  /** Reads what the fresh application saw, plus the invariants that always hold. */
  async function adopt(
    prefix: string,
    flight: { missionId: string; handleId: string },
    options: TransportOptions,
    runtimeId?: string,
  ) {
    const { application, transport } = await boot(prefix, options, runtimeId);
    const reconciliations = await application.commands.reconcile(flight.missionId as never);
    return { application, transport, reconciliations };
  }

  it("still RUNNING abroad: re-adoption reports it and moves nothing", async () => {
    const flight = await inFlight("s1", "still-running");
    const { application, transport, reconciliations } = await adopt(
      "s1b",
      flight,
      { knownRuns: [{ executionId: flight.handleId, status: "running" }] },
    );

    expect(reconciliations.map((row) => row.kind)).toEqual(["ADOPTED_RUNNING"]);
    const after = await application.commands.snapshot(flight.missionId as never);
    expect(after.tasks[0]!.state).toBe("RUNNING");
    expect(after.mission.state).toBe("RUNNING");
    expect(after.executions[0]!.status).toBe("RUNNING");
    // Observed, not resubmitted.
    expect(transport.counts().runsStarted).toBe(0);
    expect(after.executions).toHaveLength(1);
  }, 120_000);

  it("completed while we were down: the attempt settles to REVIEW and nothing is resubmitted", async () => {
    const flight = await inFlight("s2", "completed-while-down");
    const { application, transport, reconciliations } = await adopt(
      "s2b",
      flight,
      { knownRuns: [{ executionId: flight.handleId, status: "succeeded", output: { summary: MARKER } }] },
    );

    expect(reconciliations.map((row) => row.kind)).toEqual(["ADOPTED_TERMINAL"]);
    const after = await application.commands.snapshot(flight.missionId as never);
    expect(after.executions[0]!.status).toBe("SUCCEEDED");
    expect(after.executions[0]!.output).toEqual({ summary: MARKER });
    expect(after.executions[0]!.audit.map((event) => event.type)).toContain("RECONCILED");
    expect(after.tasks[0]!.state).toBe("REVIEW");
    expect(after.mission.state).toBe("WAITING");
    expect(transport.counts().runsStarted).toBe(0);

    // The decision queue can see the result a restart recovered.
    const queue = await application.queries.decisionQueue();
    expect(queue.map((row) => row.missionId)).toContain(flight.missionId);
  }, 120_000);

  it("cancelled while we were down: the task and the mission are CANCELLED", async () => {
    const flight = await inFlight("s3", "cancelled-while-down");
    const { application, reconciliations } = await adopt(
      "s3b",
      flight,
      { knownRuns: [{ executionId: flight.handleId, status: "cancelled" }] },
    );

    expect(reconciliations.map((row) => row.kind)).toEqual(["ADOPTED_TERMINAL"]);
    const after = await application.commands.snapshot(flight.missionId as never);
    expect(after.executions[0]!.status).toBe("CANCELLED");
    expect(after.tasks[0]!.state).toBe("CANCELLED");
    expect(after.mission.state).toBe("CANCELLED");
  }, 120_000);

  it("failed while we were down: the task FAILS, and a re-adopted failure never auto-retries", async () => {
    const flight = await inFlight("s4", "failed-while-down");
    const { application, transport, reconciliations } = await adopt(
      "s4b",
      flight,
      { knownRuns: [{ executionId: flight.handleId, status: "failed" }] },
    );

    expect(reconciliations.map((row) => row.kind)).toEqual(["ADOPTED_TERMINAL"]);
    const after = await application.commands.snapshot(flight.missionId as never);
    expect(after.executions[0]!.status).toBe("FAILED");
    // FAILED, not READY: a provider-reported failure is not retryable by
    // classification, so reconciliation can never take the retry edge — the one
    // edge that could start a second real run.
    expect(after.tasks[0]!.state).toBe("FAILED");
    expect(after.tasks[0]!.attempt).toBe(1);
    expect(after.mission.state).toBe("FAILED");
    expect(transport.counts().runsStarted).toBe(0);
    expect(after.executions).toHaveLength(1);
  }, 120_000);

  it("the runtime no longer knows it: UNKNOWN, escalated to a human, and never retried", async () => {
    const flight = await inFlight("s5", "unknown-remote");
    const { application, transport, reconciliations } = await adopt(
      "s5b",
      flight,
      { unknownRunIds: [flight.handleId] },
    );

    expect(reconciliations.map((row) => row.kind)).toEqual(["REMOTE_UNKNOWN"]);
    const after = await application.commands.snapshot(flight.missionId as never);
    const execution = after.executions[0]!;
    expect(execution.status).toBe("UNKNOWN");
    expect(execution.error?.category).toBe("UNKNOWN_REMOTE");
    expect(execution.error?.retryable).toBe(false);
    expect(after.tasks[0]!.state).toBe("REVIEW");
    expect(after.tasks[0]!.attempt).toBe(1);
    expect(transport.counts().runsStarted).toBe(0);
    // A review row exists, so the human actually sees it in the queue.
    expect(after.reviews.filter((review) => review.state === "PENDING")).toHaveLength(1);
    // …and NOT an ordinary acceptance review: the summary says what happened.
    expect(after.reviews[0]!.summary).toMatch(/could not be verified/i);
  }, 120_000);

  it("a transient runtime outage changes NOTHING, and is written down as an attempt", async () => {
    const flight = await inFlight("s6", "outage");
    const { application, reconciliations } = await adopt("s6b", flight, { failWith: "UNAVAILABLE" });

    expect(reconciliations.map((row) => row.kind)).toEqual(["RUNTIME_UNAVAILABLE"]);
    const after = await application.commands.snapshot(flight.missionId as never);
    // Nothing was learned, so nothing changed: the attempt is still open and the
    // task is still running. An outage is not evidence.
    expect(after.tasks[0]!.state).toBe("RUNNING");
    expect(after.mission.state).toBe("RUNNING");
    expect(after.executions[0]!.status).toBe("ACCEPTED");
    // …but the attempt to verify it is durable.
    expect(after.executions[0]!.audit.map((event) => event.type)).toContain("RECONCILED");
    expect(after.executions[0]!.audit.at(-1)!.detail).toMatch(/could not report|did not answer/i);
    expect(after.executions).toHaveLength(1);
  }, 120_000);

  it("no runtime registered: reported, not invented", async () => {
    const flight = await inFlight("s7", "no-runtime");
    // A fresh application whose runtime has a DIFFERENT id: the record names a
    // runtime this process does not host, so it cannot be observed here.
    const { application, reconciliations } = await adopt(
      "s7b",
      flight,
      { knownRuns: [{ executionId: flight.handleId, status: "succeeded" }] },
      "runtime_hermes_other",
    );

    expect(reconciliations.map((row) => row.kind)).toEqual(["NO_RUNTIME"]);
    expect(reconciliations[0]!.detail).toMatch(/no runtime is registered/i);
    const after = await application.commands.snapshot(flight.missionId as never);
    expect(after.tasks[0]!.state).toBe("RUNNING");
    expect(after.executions[0]!.audit.map((event) => event.type)).toContain("RECONCILED");
  }, 120_000);

  it("is idempotent: a second reconciliation adds no execution, no review and no run", async () => {
    const flight = await inFlight("s8", "idempotent");
    const { application, transport, reconciliations } = await adopt(
      "s8b",
      flight,
      { knownRuns: [{ executionId: flight.handleId, status: "succeeded" }] },
    );
    expect(reconciliations.map((row) => row.kind)).toEqual(["ADOPTED_TERMINAL"]);

    // A second sweep has nothing left to adopt and therefore reports NOTHING:
    // the report describes what was DONE, and `ALREADY_TERMINAL` is reserved for
    // the race where a record turns terminal while a sweep is running (another
    // process settled it first). Both are inert; only one is news.
    const again = await application.commands.reconcile(flight.missionId as never);
    expect(again).toEqual([]);

    const after = await application.commands.snapshot(flight.missionId as never);
    expect(after.executions).toHaveLength(1);
    expect(after.reviews).toHaveLength(1);
    expect(after.tasks[0]!.state).toBe("REVIEW");
    expect(transport.counts().runsStarted).toBe(0);

    // Draining again is also inert: nothing new is started, nothing duplicated.
    await application.commands.drain(flight.missionId as never);
    const drained = await application.commands.snapshot(flight.missionId as never);
    expect(drained.executions).toHaveLength(1);
    expect(drained.reviews).toHaveLength(1);
    expect(transport.counts().runsStarted).toBe(0);
  }, 120_000);

  it("keeps the actor, capability and attempt attribution it adopted", async () => {
    const flight = await inFlight("s9", "attribution");
    const { application } = await adopt("s9b", flight, {
      knownRuns: [{ executionId: flight.handleId, status: "succeeded", providerExecutionId: "session-abc" }],
    });

    const after = await application.commands.snapshot(flight.missionId as never);
    const execution = after.executions[0]!;
    // The durable record still names WHO ran WHAT, and the adopted provider
    // reference is merged in rather than lost.
    expect(execution.actorId).toBe(STRATEGY_ACTOR);
    expect(execution.capabilityId).toBe("strategy.internal-brief");
    expect(execution.runtimeId).toBe("runtime_hermes_saeed");
    expect(execution.providerExecutionId).toBe("session-abc");
    expect(execution.attempt).toBe(1);
  }, 120_000);
});
