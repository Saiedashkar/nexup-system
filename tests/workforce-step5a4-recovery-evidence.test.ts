import { execSync } from "node:child_process";
import path from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createSequentialIdFactory, sequentialClock } from "@/modules/ai-workforce/core/ids";
import type { BudgetGovernor } from "@/modules/ai-workforce/policies/budget-governor";
import { createWorkforcePrismaClient, type WorkforcePrismaHandle } from "@/modules/ai-workforce/persistence/prisma-client";
import {
  executionIdempotencyKeyForAttempt,
  type ExecutionAttemptRequest,
} from "@/modules/workforce/execution/capability-execution-contracts";
import type { ExecutionClaim } from "@/modules/workforce/execution/execution-claim";
import type { ExecutionRecord } from "@/modules/workforce/execution/execution-record";
import { createExecutionAuthority, type ExecutionAuthority } from "@/modules/workforce/execution/execution-authority";
import {
  PrismaExecutionClaimRepository,
} from "@/modules/workforce/persistence/prisma-execution-claim-repository";
import { PrismaExecutionAttemptCommitter } from "@/modules/workforce/persistence/prisma-execution-attempt-committer";
import {
  createHermesRuntime,
  type HermesAsyncTransport,
  type HermesRunStart,
  type HermesRuntimeConfig,
  type HermesTransportRequest,
  type HermesTransportResult,
} from "@/modules/workforce";
import { createWorkforceApplication, type WorkforceApplication } from "@/modules/workforce/application";
import { DeterministicHermesTransport } from "@/modules/workforce/runtimes/hermes/testing/deterministic-transport";

import type { MissionTask } from "@/modules/workforce/missions/task-contracts";

/**
 * STEP 5A-4 (third review) — RECOVERY EVIDENCE, against a real PostgreSQL.
 *
 * The in-memory suite (`workforce-step5a4-correction-p1.test.ts`) proves the
 * SEMANTICS of the corrections. This file proves the DURABLE adapter and the
 * APPLICATION boundary obey them, which is a different claim, and the one the
 * review asked for:
 *
 *   I.   a multi-task cancellation that can only partly resolve ROLLS BACK its
 *        reservations, and contends with a concurrent `execute()` in ONE place;
 *   II.  `commands.reconcile()`, `reconcileInFlight()` and `drain()` all find an
 *        entered-but-unidentified attempt, durably and repeatably;
 *   III. the atomic finalizer and `markUnverified` race on ONE row, and the two
 *        durable facts can never disagree about which side won;
 *   IV.  more than 50 unresolved claims are swept, and a mission's own incident is
 *        recovered even when it sits OUTSIDE the first global page;
 *   V.   the FOURTH review's starvation scenario — 700 permanent unresolved claims,
 *        the target at row 625 and 60 new claims before every sweep — is recovered
 *        within a justified bound, globally and within one mission;
 *   VI.  the FIFTH review's stale-wrap interleaving: three sweeps of one scope
 *        overlap so that the OLDEST finishes LAST, and the stale sweep's write
 *        cannot clear, rewind or lose the progress the newer sweeps made — because
 *        the progress is a property of the ROWS (`recoverySweptAt`), not a cursor
 *        object a late writer can overwrite;
 *   VII. the record-first correction: the terminal filter happens in the QUERY,
 *        BEFORE `LIMIT`, so 50 newer FINISHED attempts cannot hide an older open
 *        one — and the rotation still pages past the first page when there are more
 *        eligible attempts than one page holds;
 *   VIII. 70 mission scopes are swept through ONE instance and then continued by a
 *        SECOND instance (its own pool, its own ids, no shared memory), which is
 *        the restart/multi-instance claim stated as evidence rather than as a
 *        design note.
 *
 * LOCAL AND ISOLATED, by construction: skipped unless
 * `AI_WORKFORCE_TEST_DATABASE_URL` is set, creates and drops its OWN database in a
 * throwaway cluster on a caller-allocated port, applies the PROPOSED migration SQL,
 * and never reads `DATABASE_URL`. Nothing here reaches a network: the runtime is
 * the real Hermes adapter over the deterministic test transport.
 *
 * SYNCHRONISATION IS STRUCTURAL, NOT TIMED. There is no `sleep` in this file. The
 * races are produced by `Promise.all` over operations that contend on a UNIQUE
 * index, a single-statement CAS or a transaction, and the assertions are written as
 * INVARIANTS over the two possible winners — so the outcome may vary and the
 * property never does.
 */

const BASE_URL = process.env.AI_WORKFORCE_TEST_DATABASE_URL;
const DB_NAME = "workforce_recovery_evidence_test";
const DB_URL = BASE_URL ? `${BASE_URL.replace(/\/$/, "")}/${DB_NAME}` : "";
const REPO_ROOT = path.resolve(__dirname, "..");
const PSQL_BIN = process.env.PSQL_BIN || "C:\\Program Files\\PostgreSQL\\18\\bin\\psql.exe";
const PORT = BASE_URL ? new URL(BASE_URL).port || "5432" : "5432";

const MIGRATIONS = [
  "prisma/proposed-migrations/AI_WORKFORCE_PHASE_1A/migration.sql",
  "prisma/proposed-migrations/AI_WORKFORCE_PHASE_1B/migration.sql",
  "prisma/proposed-migrations/AI_WORKFORCE_PHASE_2/migration.sql",
  "prisma/proposed-migrations/AI_WORKFORCE_PHASE_3/migration.sql",
  "prisma/proposed-migrations/AI_WORKFORCE_PHASE_4/migration.sql",
  // The FIFTH review's durability key (Step 5A-4): one nullable column and one
  // index on each of `ai_execution_claims` and `ai_execution_records`. Applied here
  // because the recovery ROTATION reads and writes it; it is PROPOSED SQL applied
  // to a throwaway database, and no migration is added to `prisma/migrations`.
  "prisma/proposed-migrations/AI_WORKFORCE_PHASE_5/migration.sql",
];

const FOUNDER = "actor_founder";
const MARKER = "NEXUP_RECOVERY_EVIDENCE_OK";
const START = "2026-09-01T00:00:00.000Z";
const describeIfDatabase = BASE_URL ? describe : describe.skip;

/**
 * The explicit test-only budget governor, as in the Step 5 application proof.
 *
 * This file runs the REAL Hermes adapter over a deterministic transport, and a
 * RUNTIME leg is always `VARIABLE_PROVIDER_COST` — which the shipped DENY governor
 * refuses by design. The application's DEFAULT is untouched; this proof states its
 * own governor so the boundary can be exercised without a provider turn. The
 * budget posture itself is asserted by `workforce-boundary-budget-guard.test.ts`.
 */
const evidenceGovernor: BudgetGovernor = {
  policyRef: "test.recovery-evidence.allow",
  async evaluate(input) {
    return {
      allowed: true,
      reason: "ALLOWED_ATTESTED_INCLUDED_ROUTE",
      policyRef: "test.recovery-evidence.allow",
      spend: input.spend,
    };
  },
};

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

/**
 * SQL through STDIN, so a statement may quote its camelCase identifiers. (The
 * `-c` helper above has to stay inside one shell word, which a multi-row fixture
 * with quoted columns cannot.)
 */
function psqlStdin(sql: string, database = DB_NAME) {
  return execSync(
    `"${PSQL_BIN}" -h 127.0.0.1 -p ${PORT} -U postgres -w -v ON_ERROR_STOP=1 -d ${database} -f -`,
    { env: { ...process.env, PGPASSWORD: "postgres" }, input: sql, stdio: ["pipe", "pipe", "pipe"], cwd: REPO_ROOT },
  );
}

/**
 * ONE numeric scalar through psql's STDIN.
 *
 * STDIN and not `-c`, deliberately: `psql -c "…"` is handed to a SHELL, which strips the
 * double quotes around camelCase identifiers, so `"recoverySweptAt"` arrives as
 * `recoverySweptAt` and PostgreSQL folds it to `recoverysweptat`. That is a test bug, not
 * a schema one, and it is why every statement below that names a camelCase column goes
 * through the stdin helpers.
 */
function scalar(sql: string): number {
  const out = execSync(
    `"${PSQL_BIN}" -h 127.0.0.1 -p ${PORT} -U postgres -w -t -A -v ON_ERROR_STOP=1 -d ${DB_NAME} -f -`,
    { env: { ...process.env, PGPASSWORD: "postgres" }, input: sql, stdio: ["pipe", "pipe", "pipe"], cwd: REPO_ROOT },
  );
  return Number(out.toString().trim());
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

/** A transport that COUNTS, so "nothing was dispatched" is observable. */
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

describeIfDatabase("STEP 5A-4 (rounds 3–5) — recovery evidence on a real PostgreSQL", () => {
  const handles: WorkforcePrismaHandle[] = [];

  type Booted = {
    application: WorkforceApplication;
    handle: WorkforcePrismaHandle;
    /** A SECOND handle on the same ledger, for seeding and for reading truth. */
    claims: PrismaExecutionClaimRepository;
    committer: PrismaExecutionAttemptCommitter;
    transport: CountingTransport;
    authority: ExecutionAuthority;
    actorId: string;
    capabilityId: string;
  };

  /** One "process": its own pool, its own ids, its own clock. */
  async function boot(prefix: string): Promise<Booted> {
    const handle = createWorkforcePrismaClient(DB_URL);
    handles.push(handle);

    const ids = createSequentialIdFactory(prefix);
    const now = sequentialClock(START, 1000);
    const transport = new CountingTransport(new DeterministicHermesTransport());
    const runtime = createHermesRuntime(hermesConfig(), { transport, ids, now, allowTestTransport: true });

    const application = await createWorkforceApplication(handle, {
      ids,
      now,
      runtime,
      budget: evidenceGovernor,
    });
    if (!application.routing.actorId || !application.routing.capabilityId) {
      throw new Error(`the application has no routed actor/capability: ${application.routing.reason}`);
    }

    const claims = new PrismaExecutionClaimRepository({
      client: handle.client,
      ids: createSequentialIdFactory(`${prefix}ledger`),
    });

    const authority = createExecutionAuthority({
      userId: "user_operator",
      actorId: "actor_human_operator",
      actorSlug: "human-operator",
      actorType: "HUMAN",
      permissionTokens: ["aiworkforce.access"],
      accessibleBusinessSlugs: ["nexup"],
      isSuperAdmin: false,
      hasOfficeFinanceFull: false,
      requestedAt: START,
    });

    return {
      application,
      handle,
      claims,
      committer: new PrismaExecutionAttemptCommitter({ client: handle.client }),
      transport,
      authority,
      actorId: application.routing.actorId,
      capabilityId: application.routing.capabilityId,
    };
  }

  function command(key: string, taskCount: number, overrides: Record<string, unknown> = {}) {
    return {
      idempotencyKey: key,
      scope: "test:recovery-evidence",
      title: `Command ${key}`,
      goal: "prove durable recovery",
      requestedBy: FOUNDER,
      owner: FOUNDER,
      tasks: Array.from({ length: taskCount }, (_unused, index) => ({
        title: `${key}-task-${index + 1}`,
        objective: "produce a brief",
        instruction: `Return exactly: ${MARKER}`,
      })),
      ...overrides,
    };
  }

  /** Lapse a lease using the DATABASE's own clock — never this process's. */
  async function expireLease(handle: WorkforcePrismaHandle, claimId: string): Promise<void> {
    await handle.client.$executeRaw`
      UPDATE ai_execution_claims
      SET "leaseExpiresAt" = ((now() AT TIME ZONE 'UTC') - interval '1 second')
      WHERE "id" = ${claimId}
    `;
  }

  /**
   * A genuine claim row, through the production adapter: won, entered, and then
   * EITHER left `DISPATCHING` (a crash between entry and the handle) or promoted
   * to `UNVERIFIED` (the doubt recorded).
   */
  async function seedClaim(
    claims: PrismaExecutionClaimRepository,
    input: {
      missionId: string;
      taskId: string;
      attempt: number;
      actorId: string;
      capabilityId: string;
      leaseOwner: string;
      ttlMs?: number;
      /** Defaults to `DISPATCHING`: the crash window, with no handle recorded. */
      state?: "DISPATCHING" | "UNVERIFIED";
    },
  ): Promise<ExecutionClaim> {
    const claimed = await claims.claim({
      missionId: input.missionId,
      taskId: input.taskId,
      attempt: input.attempt,
      idempotencyKey: executionIdempotencyKeyForAttempt(input.taskId, input.attempt),
      actorId: input.actorId,
      capabilityId: input.capabilityId,
      runtimeId: "runtime_hermes_saeed",
      leaseOwner: input.leaseOwner,
      leaseTtlMs: input.ttlMs ?? 600_000,
    });
    if (claimed.kind !== "CLAIMED") throw new Error(`expected CLAIMED, got ${claimed.kind}`);
    const entered = await claims.markDispatching(claimed.claim.id, {
      invocationToken: input.leaseOwner,
      leaseTtlMs: input.ttlMs ?? 600_000,
    });
    if (!entered) throw new Error("expected DISPATCHING");
    if ((input.state ?? "DISPATCHING") === "DISPATCHING") return entered;
    const doubted = await claims.markUnverified(entered.id, "dispatch was entered and the process died");
    if (!doubted) throw new Error("expected UNVERIFIED");
    return doubted;
  }

  function recordFixture(input: { id: string; handleId: string; attempt: number; at?: string }): ExecutionRecord {
    const at = input.at ?? START;
    return {
      id: input.id,
      handleId: input.handleId,
      runtimeId: "runtime_hermes_saeed",
      actorId: "actor_internal_strategy_analyst",
      capabilityId: "strategy.internal-brief",
      attempt: input.attempt,
      status: "ACCEPTED",
      startedAt: at,
      updatedAt: at,
      audit: [{ seq: 1, at, type: "PREFLIGHT", status: "ACCEPTED", detail: "fixture" }],
    };
  }

  /** The exact request the orchestrator would build, derived from the TASK row. */
  function attemptRequestFrom(
    boot_: Booted,
    task: MissionTask,
    options: { attempt?: number } = {},
  ): ExecutionAttemptRequest {
    const attempt = options.attempt ?? task.attempt + 1;
    return {
      missionId: task.missionId,
      taskId: task.id,
      attempt,
      authority: boot_.authority,
      assignedActorId: task.assignedActorId!,
      requiredCapabilityId: task.requiredCapabilityId!,
      ...(task.requiredCapabilityVersion ? { requiredCapabilityVersion: task.requiredCapabilityVersion } : {}),
      input: task.input,
      traceId: `trace:${task.id}:${attempt}`,
      businessScope: null,
      source: "MANUAL",
    };
  }

  async function issued(boot_: Booted, key: string, taskCount: number) {
    const outcome = await boot_.application.commands.issueCommand(command(key, taskCount), {
      authority: boot_.authority,
    });
    if (outcome.kind !== "issued") throw new Error(`expected an issued command, got ${outcome.kind}`);
    return outcome;
  }

  beforeAll(() => {
    psql(`DROP DATABASE IF EXISTS "${DB_NAME}" WITH (FORCE)`);
    psql(`CREATE DATABASE "${DB_NAME}"`);
    // Additive-only is asserted, not assumed (the same check the durable-claim
    // proof makes against the claim migration).
    execSync("node scripts/verify-proposed-migration.mjs prisma/proposed-migrations/AI_WORKFORCE_PHASE_4/migration.sql", {
      stdio: "pipe",
      cwd: REPO_ROOT,
    });
    // Phase 5 CREATES no table: it extends the two the earlier phases create, so the
    // tables it may ALTER are named explicitly — which is the review step the flag
    // exists to force. Anything else it might touch is a hard failure.
    execSync(
      "node scripts/verify-proposed-migration.mjs prisma/proposed-migrations/AI_WORKFORCE_PHASE_5/migration.sql --allow=ai_execution_claims,ai_execution_records",
      { stdio: "pipe", cwd: REPO_ROOT },
    );
    for (const migration of MIGRATIONS) psqlFile(migration);
    execSync("npx prisma generate", { env: process.env, stdio: "pipe", cwd: REPO_ROOT });
  }, 300_000);

  afterAll(async () => {
    for (const handle of handles) await handle.disconnect().catch(() => undefined);
    if (BASE_URL) {
      try {
        psql(`DROP DATABASE IF EXISTS "${DB_NAME}" WITH (FORCE)`);
      } catch {
        /* the database is throwaway either way */
      }
    }
  });

  /* ══════════════════════════════════════════════════════
     I — partial cancellation rolls back, and races execute() once
     ══════════════════════════════════════════════════════ */

  it("rolls back a multi-task cancellation that can only PARTLY resolve, leaving no task poisoned", async () => {
    const booted = await boot("ev1");
    const { application, claims, authority, actorId, capabilityId } = booted;
    const outcome = await issued(booted, "partial-1", 3);
    const missionId = outcome.mission.id;

    const running = outcome.tasks[0]!;
    const reservable = outcome.tasks[1]!;
    const doubtful = outcome.tasks[2]!;
    // The plan promotes every dependency-free task and starts AT MOST one.
    expect(running.state).toBe("RUNNING");
    expect(reservable.state).toBe("READY");
    expect(doubtful.state).toBe("READY");
    expect(reservable.attempt).toBe(0);
    const startsAfterPlan = booted.transport.starts;
    expect(startsAfterPlan).toBe(1);

    // A GENUINE unverified current attempt for the second READY task: a crash
    // between entering dispatch for its NEXT attempt and recording the handle,
    // which is reachable in production and needs a human to resolve.
    const doubtfulClaim = await seedClaim(claims, {
      missionId,
      taskId: doubtful.id,
      attempt: 1,
      actorId,
      capabilityId,
      leaseOwner: "tok_ev1_doubtful",
      state: "UNVERIFIED",
    });

    const results = await application.execution.cancelMissionAttempts({
      missionId,
      // ORDER MATTERS: the reservable attempt is reserved FIRST, so the
      // compensation has something real to undo when the doubtful one refuses.
      tasks: [
        { taskId: reservable.id, state: "READY" },
        { taskId: doubtful.id, state: "READY" },
      ],
      reason: "operator cancelled the mission",
      authority,
    });
    expect(results).toHaveLength(2);

    const unresolvable = results.find((row) => row.taskId === doubtful.id)!;
    expect(unresolvable.unresolved).toBe(true);
    expect(unresolvable.cancelled).toBe(false);

    // COMPENSATION, durably: the attempt this call had already reserved is
    // RELEASED again — "no external run exists for it" — instead of being left
    // terminally CANCELLED while the mission itself is NOT cancelled.
    const rolledBack = results.find((row) => row.taskId === reservable.id)!;
    expect(rolledBack.cancelled).toBe(false);
    expect(rolledBack.unresolved).toBe(true);
    expect(rolledBack.state).toBe("RELEASED");

    const reservationRow = await claims.findByKey(executionIdempotencyKeyForAttempt(reservable.id, 1));
    expect(reservationRow?.state).toBe("RELEASED");
    expect(reservationRow?.leaseExpiresAt).toBeUndefined();
    // The doubtful attempt is untouched: a doubt is only ever resolved by a human.
    expect((await claims.get(doubtfulClaim.id))?.state).toBe("UNVERIFIED");
    // No external run was started for either attempt.
    expect(await application.domain.executionRecords.listForTask(reservable.id)).toHaveLength(0);
    expect(await application.domain.executionRecords.listForTask(doubtful.id)).toHaveLength(0);
    expect(booted.transport.starts).toBe(startsAfterPlan);
    expect((await application.domain.tasks.get(reservable.id))?.state).toBe("READY");
    expect((await application.domain.tasks.get(doubtful.id))?.state).toBe("READY");
  }, 120_000);

  it("lets a concurrent cancellation and execute() contend in ONE place, never both", async () => {
    const booted = await boot("ev1b");
    const { application, claims, authority, actorId, capabilityId } = booted;
    const outcome = await issued(booted, "race-1", 3);
    const missionId = outcome.mission.id;
    const target = outcome.tasks[1]!;
    expect(target.state).toBe("READY");

    // A RELEASED row for the NEXT attempt is exactly what both sides can act on:
    // `reserveCancellation` flips a RELEASED row to CANCELLED in one statement,
    // and a concurrent `execute()` may reclaim it. Neither side is favoured — that
    // is the point — so the assertion is the INVARIANT, not one winner.
    const seeded = await claims.claim({
      missionId,
      taskId: target.id,
      attempt: 1,
      idempotencyKey: executionIdempotencyKeyForAttempt(target.id, 1),
      actorId,
      capabilityId,
      runtimeId: "runtime_hermes_saeed",
      leaseOwner: "tok_ev1b_reservation",
      leaseTtlMs: 600_000,
    });
    if (seeded.kind !== "CLAIMED") throw new Error(`expected CLAIMED, got ${seeded.kind}`);
    // RELEASED is the ledger's own "no external run exists for this attempt",
    // written by the owning invocation before dispatch — the state both a
    // cancellation and a fresh `execute()` may legitimately act on.
    const released = await claims.release(seeded.claim.id, {
      invocationToken: "tok_ev1b_reservation",
      detail: "a control refused before dispatch, so no run exists for this attempt",
    });
    expect(released?.state).toBe("RELEASED");
    const before = await claims.findByKey(executionIdempotencyKeyForAttempt(target.id, 1));
    expect(before?.state).toBe("RELEASED");

    const [cancellation, execution] = await Promise.all([
      application.execution.cancelMissionAttempts({
        missionId,
        tasks: [{ taskId: target.id, state: "READY" }],
        reason: "operator cancelled",
        authority,
      }),
      application.execution.execute(attemptRequestFrom(booted, target, { attempt: 1 })),
    ]);

    const row = await claims.findByKey(executionIdempotencyKeyForAttempt(target.id, 1));
    const records = await application.domain.executionRecords.listForTask(target.id);

    if (records.length === 0) {
      // Cancellation won: the attempt is terminally CANCELLED and NO run exists.
      expect(row?.state).toBe("CANCELLED");
      expect(cancellation[0]!.cancelled).toBe(true);
      expect(cancellation[0]!.unresolved).toBe(false);
      // The losing `execute()` fails CLOSED, and says which attempt it lost.
      expect(execution.kind).toBe("DENIED");
      if (execution.kind !== "DENIED") throw new Error("unreachable");
      expect(execution.code).toBe("EXECUTION_RESERVATION_UNRESOLVED");
      expect(booted.transport.starts).toBe(1); // only the plan's own dispatch
    } else {
      // The execution won: exactly ONE run exists, and the ledger NAMES it.
      expect(records).toHaveLength(1);
      expect(row?.state).toBe("DISPATCHED");
      expect(row?.executionRecordId).toBe(records[0]!.id);
      expect(row?.handleId).toBe(records[0]!.handleId);
      expect(execution.kind).toBe("DISPATCHED");
      // …and the cancellation reported that it could not resolve the attempt.
      expect(cancellation[0]!.unresolved).toBe(true);
      expect(cancellation[0]!.cancelled).toBe(false);
      expect(booted.transport.starts).toBe(2); // the plan's dispatch, plus this one
    }
    // NEVER both, in either order: a cancelled attempt with a record, or a
    // DISPATCHED attempt with none, would be the double-dispatch defect.
    expect(row?.state === "CANCELLED" && records.length > 0).toBe(false);
    expect(records.length > 0 && !row?.executionRecordId).toBe(false);
  }, 120_000);

  /* ══════════════════════════════════════════════════════
     II — the application entry points find a crash claim
     ══════════════════════════════════════════════════════ */

  it("finds an entered-but-unidentified attempt through reconcile(), reconcileInFlight() and drain()", async () => {
    const booted = await boot("ev2");
    const { application, claims, authority, actorId, capabilityId } = booted;
    const outcome = await issued(booted, "crash-1", 2);
    const missionId = outcome.mission.id;
    const crashTask = outcome.tasks[1]!;
    expect(crashTask.state).toBe("READY");
    const startsAfterPlan = booted.transport.starts;

    // THE CRASH WINDOW: dispatch was ENTERED for the task's next attempt and the
    // process died before any handle was recorded. The lease is lapsed with the
    // DATABASE's clock, so the sweep's verdict is the database's, not ours.
    const claim = await seedClaim(claims, {
      missionId,
      taskId: crashTask.id,
      attempt: 1,
      actorId,
      capabilityId,
      leaseOwner: "tok_ev2_crash",
      ttlMs: 1_000,
      state: "DISPATCHING",
    });
    await expireLease(booted.handle, claim.id);

    const viaReconcile = await application.commands.reconcile(missionId);
    expect(
      viaReconcile.some((row) => row.kind === "CLAIM_UNVERIFIED" && row.taskId === crashTask.id),
    ).toBe(true);

    const viaInFlight = await application.commands.reconcileInFlight();
    expect(viaInFlight.some((row) => row.kind === "CLAIM_UNVERIFIED" && row.taskId === crashTask.id)).toBe(true);

    const drained = await application.commands.drain(missionId, { authority });
    expect(drained.changes.some((change) => change.includes("CLAIM_UNVERIFIED"))).toBe(true);

    // DURABLE doubt, and a second sweep still finds it: an incident that is
    // recorded once but never rediscovered is the same as no incident at all.
    expect((await claims.get(claim.id))?.state).toBe("UNVERIFIED");
    const second = await application.commands.reconcile(missionId);
    expect(second.some((row) => row.kind === "CLAIM_UNVERIFIED" && row.taskId === crashTask.id)).toBe(true);
    const incidents = await application.commands.claimIncidents(missionId);
    expect(incidents.map((row) => row.id)).toEqual([claim.id]);

    // NOTHING was redispatched, and no execution record was fabricated for the
    // attempt that may already exist outside.
    expect(await application.domain.executionRecords.listForTask(crashTask.id)).toHaveLength(0);
    expect(booted.transport.starts).toBe(startsAfterPlan);
  }, 120_000);

  /* ══════════════════════════════════════════════════════
     III — the finalizer and markUnverified race on ONE row
     ══════════════════════════════════════════════════════ */

  it("rolls the execution record back when the finalizer's claim CAS loses to markUnverified", async () => {
    const booted = await boot("ev3");
    const { claims, committer, application, actorId, capabilityId } = booted;

    const claim = await seedClaim(claims, {
      missionId: "mission_ev3_deterministic",
      taskId: "task_ev3_deterministic",
      attempt: 1,
      actorId,
      capabilityId,
      leaseOwner: "tok_ev3_deterministic",
    });
    // The recovering sweep recorded the doubt FIRST — deterministically, so this
    // is the losing side of the race with no concurrency at all.
    const promoted = await claims.markUnverified(claim.id, "recovery recorded the doubt first");
    expect(promoted?.state).toBe("UNVERIFIED");

    await expect(
      committer.commitDispatched({
        claimId: claim.id,
        invocationToken: "tok_ev3_deterministic",
        record: recordFixture({ id: "exec_ev3_rolled_back", handleId: "handle_ev3_rolled_back", attempt: 1 }),
      }),
    ).rejects.toMatchObject({ code: "PERSISTENCE_UNAVAILABLE" });

    // The record insert was INSIDE the failed transaction, so it does not exist.
    expect(await application.domain.executionRecords.get("exec_ev3_rolled_back" as never)).toBeNull();
    expect((await claims.get(claim.id))?.state).toBe("UNVERIFIED");
    expect((await claims.get(claim.id))?.executionRecordId).toBeUndefined();
  }, 120_000);

  it("never lets the record and the ledger disagree about which side of the race won", async () => {
    const booted = await boot("ev3b");
    const { claims, committer, application, actorId, capabilityId } = booted;

    // Three independent attempts, each raced once. The WINNER may differ between
    // iterations — that is fine and expected — so every iteration asserts the
    // invariant instead of a winner.
    for (let index = 0; index < 3; index += 1) {
      const claim = await seedClaim(claims, {
        missionId: `mission_ev3_race_${index}`,
        taskId: `task_ev3_race_${index}`,
        attempt: 1,
        actorId,
        capabilityId,
        leaseOwner: `tok_ev3_race_${index}`,
      });
      const recordId = `exec_ev3_race_${index}`;
      const record = recordFixture({ id: recordId, handleId: `handle_ev3_race_${index}`, attempt: 1 });

      await Promise.allSettled([
        committer.commitDispatched({ claimId: claim.id, invocationToken: `tok_ev3_race_${index}`, record }),
        claims.markUnverified(claim.id, "concurrent recovery doubt"),
      ]);

      const stored = await claims.get(claim.id);
      const row = await application.domain.executionRecords.get(recordId as never);

      if (row) {
        // The finalizer won: the ledger NAMES the record it committed.
        expect(stored?.state).toBe("DISPATCHED");
        expect(stored?.executionRecordId).toBe(recordId);
        expect(stored?.handleId).toBe(record.handleId);
      } else {
        // The doubt won: no record survived the rollback, and the row is a doubt.
        expect(stored?.state).toBe("UNVERIFIED");
        expect(stored?.executionRecordId).toBeUndefined();
      }
    }
  }, 120_000);

  /* ══════════════════════════════════════════════════════
     IV — more than 50 unresolved claims, and mission scoping
     ══════════════════════════════════════════════════════ */

  it("sweeps more than 50 unresolved claims and recovers a mission's incident beyond the first global page", async () => {
    const booted = await boot("ev4");
    const { application, claims, actorId, capabilityId } = booted;
    const missionId = "mission_ev4_target";
    const taskId = "task_ev4_target";

    // 60 unresolved incidents for OTHER missions. The claim table deliberately has
    // no foreign key on mission/task, so a delivery-ledger backlog can be seeded
    // without inventing 60 missions — exactly as the migration documents.
    const backlog: ExecutionClaim[] = [];
    for (let index = 0; index < 60; index += 1) {
      const padded = await seedClaim(claims, {
        missionId: `mission_ev4_pad_${index}`,
        taskId: `task_ev4_pad_${index}`,
        attempt: 1,
        actorId,
        capabilityId,
        leaseOwner: `tok_ev4_pad_${index}`,
        ttlMs: 1_000,
      });
      await expireLease(booted.handle, padded.id);
      backlog.push(padded);
    }
    // The mission's own incident, created LAST so it sorts after the backlog.
    const target = await seedClaim(claims, {
      missionId,
      taskId,
      attempt: 1,
      actorId,
      capabilityId,
      leaseOwner: "tok_ev4_target",
      state: "UNVERIFIED",
    });

    // PROOF THAT IT IS OUTSIDE THE FIRST GLOBAL PAGE — measured, not assumed.
    const firstGlobalPage = await claims.listUnresolved({ limit: 50 });
    expect(firstGlobalPage).toHaveLength(50);
    expect(firstGlobalPage.some((row) => row.id === target.id)).toBe(false);
    // …while the MISSION-SCOPED query already sees it. The filter is in the QUERY,
    // which is what makes the mission's answer complete regardless of the backlog.
    const missionScoped = await claims.listUnresolved({ missionId, limit: 50 });
    expect(missionScoped.map((row) => row.id)).toEqual([target.id]);

    // RECOVERY, through the APPLICATION boundary: the mission's incident is found
    // even though 60 other missions' incidents sort ahead of it.
    const scoped = await application.commands.reconcile(missionId);
    const scopedIncidents = scoped.filter((row) => row.kind === "CLAIM_UNVERIFIED");
    expect(scopedIncidents).toHaveLength(1);
    expect(scopedIncidents[0]!.taskId).toBe(taskId);
    expect((await application.commands.claimIncidents(missionId)).map((row) => row.id)).toEqual([target.id]);

    // ONE CALL IS BOUNDED; SUCCESSIVE CALLS ARE EXHAUSTIVE. The budget is split into
    // three DISJOINT windows (Step 5A-4, sixth review), so no single sweep can hold
    // all 61 incidents — and the property that matters is the one the review asked
    // for: that repeated sweeps REACH every one of them, in the ledger, without any of
    // them being re-served forever. Measured over the incidents this case seeded, not
    // asserted from the design.
    const expectedTaskIds = [taskId, ...backlog.map((row) => row.taskId)];
    // THE CAP IS DERIVED, NOT GUESSED. Every unresolved row of the scope is served by one
    // of two windows — 25 unseen rows per sweep, 20 observed ones — so covering the scope
    // twice over (once to OBSERVE, once to REVISIT) is a bound that follows from the
    // allocations rather than from a number chosen to make the test pass.
    const unresolvedNow = scalar(
      `select count(*) from ai_execution_claims
        where ("state" = 'DISPATCHING' or "state" = 'UNVERIFIED'
               or ("state" = 'DISPATCHED' and "executionRecordId" is null))`,
    );
    const sweepCap = Math.ceil(unresolvedNow / 20) + Math.ceil(unresolvedNow / 25) + 2;
    // EVERY row this pass reports counts, including other suites' incidents (one database,
    // one file), so progress is measured against THIS case's 61 ids and nothing else. A
    // count of "rows reached" that could be satisfied by somebody else's rows would stop
    // the loop early and report a starvation that is really a bookkeeping error.
    const expectedSet = new Set(expectedTaskIds);
    const reached = new Set<string>();
    const missingIds = () => expectedTaskIds.filter((id) => !reached.has(id));
    const perSweep: number[] = [];
    let globalSweeps = 0;
    while (globalSweeps < sweepCap && missingIds().length > 0) {
      globalSweeps += 1;
      const before = reached.size;
      for (const row of await application.commands.reconcileInFlight()) {
        if (row.kind === "CLAIM_UNVERIFIED" && row.taskId && expectedSet.has(row.taskId)) reached.add(row.taskId);
      }
      perSweep.push(reached.size - before);
    }
    // The MISSING ids are what the failure prints, so a starvation says which row starved —
    // and the queue arithmetic is printed with it, so a bound that was wrong says why.
    expect({ missing: missingIds(), sweeps: globalSweeps, sweepCap, unresolvedNow, perSweep }).toEqual({
      missing: [],
      sweeps: globalSweeps,
      sweepCap,
      unresolvedNow,
      perSweep,
    });

    // DURABLE and repeatable: the doubt is recorded on the row, and every incident
    // comes back round again — an incident recorded once and never rediscovered would
    // be the same as no incident at all.
    expect((await claims.get(target.id))?.state).toBe("UNVERIFIED");
    const repeatReached = new Set<string>();
    for (let attempt = 0; attempt < sweepCap && expectedTaskIds.some((id) => !repeatReached.has(id)); attempt += 1) {
      for (const row of await application.commands.reconcileInFlight()) {
        if (row.kind === "CLAIM_UNVERIFIED" && row.taskId && expectedSet.has(row.taskId)) repeatReached.add(row.taskId);
      }
    }
    expect(expectedTaskIds.filter((id) => !repeatReached.has(id))).toEqual([]);

    // EVERY one of the 61 incidents recorded DOUBT and nothing else: no attempt
    // was redispatched, and no execution record was fabricated for them.
    // (Scoped to THIS proof's ids — the database is shared with the earlier cases
    // in this file, which legitimately dispatched real attempts of their own, and
    // a GLOBAL sweep is global: it also visits their records. That is why the
    // assertion below is about SUBMISSIONS, which adoption never performs.)
    const states = await Promise.all(backlog.map((row) => claims.get(row.id)));
    expect(states.map((row) => row?.state)).toEqual(backlog.map(() => "UNVERIFIED"));
    expect(await application.domain.executionRecords.listForMission(missionId)).toHaveLength(0);
    for (const probeTaskId of [taskId, "task_ev4_pad_0", "task_ev4_pad_59"]) {
      expect(await application.domain.executionRecords.listForTask(probeTaskId)).toHaveLength(0);
    }
    expect(booted.transport.starts).toBe(0);
  }, 180_000);

  /* ══════════════════════════════════════════════════════
     V — bounded recovery reaches a middle row (fourth review)
     ══════════════════════════════════════════════════════ */

  /**
   * A DETERMINISTIC backlog, written straight to the ledger.
   *
   * The rows have exactly the shape the adapter writes for a doubted attempt
   * (`UNVERIFIED`, no handle, no execution record, lease cleared), and `claimedAt`
   * is a FIXED, strictly increasing series — so a row's POSITION in the sweep's
   * `(claimedAt, id)` order is decided by the fixture rather than by how the
   * inserts happened to interleave. "The target is row 625" is then a fact the
   * assertion can stand on.
   */
  function seedBacklog(input: {
    rows: number;
    keyPrefix: string;
    /** An SQL expression for `missionId` (may reference `g`). */
    missionExpr: string;
    taskPrefix: string;
    actorId: string;
    capabilityId: string;
    /** Base of the strictly increasing `claimedAt` series. */
    at: string;
  }): void {
    psqlStdin(`INSERT INTO ai_execution_claims
  ("id", "missionId", "taskId", "attempt", "actorId", "capabilityId", "runtimeId", "idempotencyKey", "state", "detail", "claimedAt", "updatedAt")
SELECT '${input.keyPrefix}_claim_' || g,
       ${input.missionExpr},
       '${input.taskPrefix}' || g,
       1,
       '${input.actorId}',
       '${input.capabilityId}',
       'runtime_hermes_saeed',
       '${input.keyPrefix}:claim:' || g,
       'UNVERIFIED',
       'fixture: dispatch was entered and no durable handle was recorded',
       TIMESTAMP '${input.at}' + (g || ' milliseconds')::interval,
       TIMESTAMP '${input.at}' + (g || ' milliseconds')::interval
  FROM generate_series(1, ${input.rows}) AS g;
`);
  }

  /**
   * The review's arrivals: new unresolved claims BEFORE each successive sweep.
   *
   * They take the DATABASE clock, so every arrival sorts strictly AFTER the fixed
   * backlog — which is the point: an arrival may not displace a row that is already
   * in the ledger, and the walk has to pass that row on the way.
   */
  function seedArrivals(input: {
    sweep: number;
    count: number;
    keyPrefix: string;
    missionExpr: string;
    taskPrefix: string;
    actorId: string;
    capabilityId: string;
  }): void {
    psqlStdin(`INSERT INTO ai_execution_claims
  ("id", "missionId", "taskId", "attempt", "actorId", "capabilityId", "runtimeId", "idempotencyKey", "state", "detail", "claimedAt", "updatedAt")
SELECT '${input.keyPrefix}_arrival_${input.sweep}_' || g,
       ${input.missionExpr},
       '${input.taskPrefix}${input.sweep}_' || g,
       1,
       '${input.actorId}',
       '${input.capabilityId}',
       'runtime_hermes_saeed',
       '${input.keyPrefix}:arrival:${input.sweep}:' || g,
       'UNVERIFIED',
       'fixture: an arrival that landed between two sweeps',
       (now() AT TIME ZONE 'UTC'),
       (now() AT TIME ZONE 'UTC')
  FROM generate_series(1, ${input.count}) AS g;
`);
  }

  it("reaches the row 625 target across sweeps, with 60 arrivals before each — globally and within one mission", async () => {
    const booted = await boot("ev5");
    const { application, claims, actorId, capabilityId, transport } = booted;

    const PERMANENT = 700;
    const TARGET = 625; // row 625 of the backlog, 1-based — the review's target
    const ARRIVALS = 60;
    // THE FAIRNESS BOUND, WITH ITS ASSUMPTIONS — and after the SIXTH review it is a
    // bound of the UNSEEN WINDOW alone. The row at backlog position `p` is reached
    // within ceil(p / 25) sweeps — 25 for row 625 — and NOTHING about the arrivals
    // enters that arithmetic: they are never-observed rows, so they belong to the
    // UNSEEN and NEWEST windows, and within UNSEEN they are NEWER than every row
    // already in the ledger, so they can only queue behind it. The assumptions are the
    // ones `collectUnresolved` documents, stated here rather than implied: sweeps
    // REPEAT, and the DATABASE's clock advances between them (true here — every sweep
    // is its own transaction, so `now()` advances). The arrival rate is NOT assumed:
    // sustained arrivals lengthen the unseen backlog and this bound grows with it,
    // but they cannot take one row of the REVISIT window, which is what keeps an
    // already-observed row's bound independent of them.
    const UNSEEN_QUOTA = 25;
    const JUSTIFIED_BOUND = Math.ceil(TARGET / UNSEEN_QUOTA) + 1;

    /* ── the GLOBAL case ── */
    seedBacklog({
      rows: PERMANENT,
      keyPrefix: "ev5global",
      missionExpr: "'mission_ev5_pad_' || g",
      taskPrefix: "task_ev5_global_",
      actorId,
      capabilityId,
      at: "2026-09-01 00:00:00",
    });
    const targetTaskId = `task_ev5_global_${TARGET}`;
    // Measured, not assumed: the target is beyond the first page AND beyond one
    // sweep's budget, so no single bounded query can already contain it.
    const firstPage = await claims.listUnresolved({ limit: 50 });
    expect(firstPage.some((row) => row.taskId === targetTaskId)).toBe(false);

    const originals = new Set<string>();
    let arrivalsSeen = 0;
    let found = false;
    let sweeps = 0;
    while (sweeps < JUSTIFIED_BOUND + 3 && !found) {
      sweeps += 1;
      // 60 NEW unresolved claims before EACH successive sweep.
      seedArrivals({
        sweep: sweeps,
        count: ARRIVALS,
        keyPrefix: "ev5global",
        missionExpr: "'mission_ev5_arrival_' || g",
        taskPrefix: "task_ev5_arrival_",
        actorId,
        capabilityId,
      });
      const rows = await application.commands.reconcileInFlight();
      for (const row of rows) {
        if (row.taskId === targetTaskId) found = true;
        if (row.taskId?.startsWith("task_ev5_global_")) originals.add(row.taskId);
        if (row.taskId?.startsWith("task_ev5_arrival_")) arrivalsSeen += 1;
      }
      if (sweeps === 1) {
        // The review's exact observation, on the CORRECTED tree: one bounded sweep
        // does NOT reach row 625 — stated rather than papered over with a bigger page.
        // What it HAS done is move: the first UNSEEN window of the ORIGINAL backlog,
        // taken from the OLDEST end, is in its answer — and no arrival is in it.
        expect(found).toBe(false);
        expect(originals.size).toBe(UNSEEN_QUOTA);
      }
    }
    expect(found).toBe(true);
    expect(sweeps).toBeLessThanOrEqual(JUSTIFIED_BOUND);
    // THE WALK, NOT A PROBE: every row of the ORIGINAL backlog up to and including
    // the target was observed on the way. A newest-end probe cannot produce this,
    // and a cursor that reset on every call would never produce it either.
    const unvisited: string[] = [];
    for (let index = 1; index <= TARGET; index += 1) {
      if (!originals.has(`task_ev5_global_${index}`)) unvisited.push(String(index));
    }
    expect(unvisited).toEqual([]);
    // …while the arrivals were not starved either: the newest end of the ledger is
    // seen by every sweep, so a fresh incident never waits for the backlog.
    expect(arrivalsSeen).toBeGreaterThan(0);

    /* ── the SINGLE-MISSION case: the same backlog inside ONE mission ── */
    const singleMissionId = "mission_ev5_single";
    seedBacklog({
      rows: PERMANENT,
      keyPrefix: "ev5single",
      missionExpr: `'${singleMissionId}'`,
      taskPrefix: "task_ev5_single_",
      actorId,
      capabilityId,
      at: "2026-09-02 00:00:00",
    });
    const singleTarget = `task_ev5_single_${TARGET}`;
    const scopedFirstPage = await claims.listUnresolved({ missionId: singleMissionId, limit: 50 });
    expect(scopedFirstPage.some((row) => row.taskId === singleTarget)).toBe(false);

    let scopedFound = false;
    let scopedSweeps = 0;
    while (scopedSweeps < JUSTIFIED_BOUND + 3 && !scopedFound) {
      scopedSweeps += 1;
      seedArrivals({
        sweep: scopedSweeps,
        count: ARRIVALS,
        keyPrefix: "ev5single",
        missionExpr: `'${singleMissionId}'`,
        taskPrefix: "task_ev5_single_arrival_",
        actorId,
        capabilityId,
      });
      for (const row of await application.commands.reconcile(singleMissionId)) {
        if (row.taskId === singleTarget) scopedFound = true;
      }
    }
    expect(scopedFound).toBe(true);
    expect(scopedSweeps).toBeLessThanOrEqual(JUSTIFIED_BOUND);

    /* ── nothing was redispatched, and nothing was fabricated ── */
    expect(transport.starts).toBe(0);
    for (const taskId of [targetTaskId, singleTarget, `task_ev5_global_${PERMANENT}`, `task_ev5_single_${PERMANENT}`]) {
      expect(await application.domain.executionRecords.listForTask(taskId)).toHaveLength(0);
    }
    const targetRow = await claims.findByKey("ev5global:claim:625");
    if (!targetRow) throw new Error("the target fixture row is missing");
    expect(targetRow.state).toBe("UNVERIFIED");
  }, 600_000);

  /* ══════════════════════════════════════════════════════
     VI — three interleaved sweeps, the OLDEST writing LAST
     ══════════════════════════════════════════════════════ */

  /**
   * The FIFTH review's concurrent-wrap defect, reproduced DETERMINISTICALLY.
   *
   * The fourth review's sweep kept its position in a per-scope cursor that lived
   * for the process, walked by keyset and WRAPPED. Three overlapping sweeps could
   * interleave so that the OLDEST — still holding the position it read before the
   * others moved — wrote LAST and cleared the progress the two newer sweeps had
   * made. The write at the wrap was the moment it happened.
   *
   * There is no cursor to serialize any more: a sweep's only write is a STAMP on
   * the rows it read, and the queue is DERIVED from those stamps. This test scripts
   * the exact three-sweep interleaving (A reads, B and C run to completion, A's
   * write lands last) against the durable ledger and asserts what must then be true:
   *
   *   1. the stale write CLEARS nothing — a stamp is never unset;
   *   2. no stamp goes BACKWARDS;
   *   3. the queue does not REWIND: the rows A never read are still the front of it,
   *      before and after A's late write, byte for byte;
   *   4. nothing is LOST: further sweeps still cover the scope completely.
   */
  it("cannot be rewound or cleared by a stale sweep that writes last — the three-sweep interleaving", async () => {
    const booted = await boot("ev6");
    const { claims, actorId, capabilityId } = booted;
    const missionId = "mission_ev6_rotation";
    const TOTAL = 200;
    // 200 rows, so ONE sweep — two bounded pages — cannot cover the scope.
    seedBacklog({
      rows: TOTAL,
      keyPrefix: "ev6",
      missionExpr: `'${missionId}'`,
      taskPrefix: "task_ev6_",
      actorId,
      capabilityId,
      at: "2026-09-06 00:00:00",
    });

    /**
     * Exactly what ONE sweep observes: one bounded window of each of the three
     * DISJOINT lanes (Step 5A-4, sixth review). Composed from the same repository
     * reads the sweep itself makes, so this helper cannot describe a shape the sweep
     * does not use.
     */
    const pageIds = async (): Promise<string[]> => {
      const windows = [
        await claims.listUnresolved({ missionId, limit: 25, lane: "NEVER_OBSERVED" }),
        await claims.listUnresolved({ missionId, limit: 20, lane: "PREVIOUSLY_OBSERVED" }),
        await claims.listUnresolved({ missionId, limit: 5, lane: "NEVER_OBSERVED_NEWEST" }),
      ];
      const ids: string[] = [];
      for (const row of windows.flat()) if (!ids.includes(row.id)) ids.push(row.id);
      return ids;
    };
    /** What a sweep WRITES: one stamp per row it looked at. */
    const stamp = async (ids: readonly string[]): Promise<void> => {
      for (const id of ids) await claims.markRecoverySwept(id);
    };
    const queue = () => claims.listUnresolved({ missionId, limit: TOTAL, order: "LEAST_RECENTLY_SWEPT_FIRST" });
    const stampsOf = async (ids: readonly string[]) =>
      Object.fromEntries(
        await Promise.all(ids.map(async (id) => [id, (await claims.get(id))?.recoverySweptAt ?? null] as const)),
      );

    // ── the interleaving ──
    const aRead = await pageIds(); // A READS (it writes nothing yet)
    const bRead = await pageIds();
    await stamp(bRead); // B runs to COMPLETION
    const cRead = await pageIds();
    await stamp(cRead); // C runs to COMPLETION
    // The queue as B and C left it — and the stamps, taken BEFORE the stale write.
    const frontBefore = (await queue()).slice(0, 50).map((row) => row.id);
    const bStampsBefore = await stampsOf(bRead);
    // A's write lands LAST.
    await stamp(aRead);
    const frontAfter = (await queue()).slice(0, 50).map((row) => row.id);
    const bStampsAfter = await stampsOf(bRead);

    // (3) THE QUEUE DID NOT REWIND. A's page is the OLDEST rows of a never-swept
    // scope, so nothing of A's is at the front: the front is the untouched backlog,
    // and it is IDENTICAL before and after the stale write. (Measured, not assumed.)
    expect(frontBefore.some((id) => aRead.includes(id))).toBe(false);
    expect(frontAfter).toEqual(frontBefore);

    // (1) NOTHING WAS CLEARED, and (2) NOTHING WENT BACKWARDS. The stale sweep
    // re-stamped rows that B had already stamped: a re-stamp can only move a row
    // FORWARD in the queue (it was observed again), never backwards, and never to
    // "never swept".
    for (const id of aRead) expect((await claims.get(id))?.recoverySweptAt).toBeTruthy();
    for (const [id, before] of Object.entries(bStampsBefore)) {
      expect(before).not.toBeNull();
      expect(bStampsAfter[id] ?? null).not.toBeNull();
      expect((bStampsAfter[id] as string) >= (before as string)).toBe(true);
    }

    // (4) NOTHING IS LOST. A's late write does not make any row unreachable: the
    // next three sweeps still cover the whole scope — the rows A never read
    // included, and the rows it re-stamped after they had already been served.
    const seen = new Set<string>([...aRead, ...bRead, ...cRead, ...frontAfter]);
    // 200 rows through a 25-row UNSEEN window is ceil(200 / 25) = 8 sweeps, and the
    // NEWEST window covers the top of the ledger from the start.
    for (let sweep = 0; sweep < 8 && seen.size < TOTAL; sweep += 1) {
      const ids = await pageIds();
      await stamp(ids);
      for (const id of ids) seen.add(id);
    }
    expect(seen.size).toBe(TOTAL);
    // …and a further sweep now re-serves rows rather than reporting the scope as
    // unfinished: the rotation WRAPPED, on the rows, which is the honest end state
    // of a covered scope (and is why nothing had to be remembered to reach it).
  }, 300_000);

  /* ══════════════════════════════════════════════════════
     VII — the terminal filter happens BEFORE the page limit
     ══════════════════════════════════════════════════════ */

  /**
   * The FIFTH review's record-first defect: the reconciler read a page of records
   * and THEN dropped the terminal ones, so a page full of finished attempts could
   * hide an older attempt that was still open. The review's reproduction was 50
   * newer TERMINAL records in front of ONE older `ACCEPTED` record.
   *
   * The filter now lives in the QUERY (`listRecoverable`) and runs before `LIMIT`,
   * and the page is walked in the durable rotation, so the same read also pages
   * FAIRLY past the first page when there are more eligible attempts than one page.
   */
  it("cannot let 50 newer finished attempts hide an older open one, and pages fairly past the first page", async () => {
    const booted = await boot("ev7");
    const { application } = booted;
    const outcome = await issued(booted, "record-first", 1);
    const missionId = outcome.mission.id;
    const taskId = outcome.tasks[0]!.id;
    const records = application.domain.executionRecords;

    // `(taskId, attempt)` is UNIQUE in the records table, so the fixture takes only
    // attempts the task does not already have — whatever the command's own plan
    // created for it is left exactly as it is, and this test asserts PROPERTIES of
    // the page rather than its exact contents, because that is what the correction
    // is about: the terminal rows must not consume it.
    const takenAttempts = new Set((await records.listForTask(taskId)).map((row) => row.attempt));
    let nextAttempt = 1;
    const freeAttempt = () => {
      while (takenAttempts.has(nextAttempt)) nextAttempt += 1;
      takenAttempts.add(nextAttempt);
      return nextAttempt;
    };

    // ONE older, still-OPEN attempt …
    const openAt = "2026-09-03T00:00:00.000Z";
    await records.insert({
      ...recordFixture({ id: "exec_ev7_open", handleId: "handle_ev7_open", attempt: freeAttempt(), at: openAt }),
      missionId,
      taskId,
    } as ExecutionRecord);
    // … behind FIFTY newer FINISHED attempts: the review's exact arrangement.
    for (let index = 0; index < 50; index += 1) {
      const at = new Date(Date.parse("2026-09-04T00:00:00.000Z") + index * 1_000).toISOString();
      await records.insert({
        ...recordFixture({ id: `exec_ev7_done_${index}`, handleId: `handle_ev7_done_${index}`, attempt: freeAttempt(), at }),
        status: "SUCCEEDED",
        completedAt: at,
        missionId,
        taskId,
      } as ExecutionRecord);
    }

    // The page with the review's own size contains the OPEN attempt and NOT ONE
    // terminal row — so the finished attempts could not have consumed it, and the
    // older open attempt was not reachable "because the page happened to be short".
    const page = await records.listRecoverable({ missionId, limit: 50 });
    expect(page.map((row) => row.id)).toContain("exec_ev7_open");
    expect(page.some((row) => (["SUCCEEDED", "FAILED", "CANCELLED"] as const).includes(row.status as never))).toBe(false);

    // …and the sweep the APPLICATION runs uses that same read, so adoption never
    // even sees the finished attempts.
    const swept = await application.commands.reconcile(missionId);
    expect(swept.some((row) => row.executionRecordId === "exec_ev7_open")).toBe(true);
    const observed = await records.get("exec_ev7_open" as never);
    expect(observed?.recoverySweptAt).toBeTruthy();
    // The ROTATION WRITE is an observation and nothing else — asserted around the
    // stamp ITSELF, because the same sweep may legitimately also RECONCILE the
    // attempt (which is activity and does move `updatedAt`, with its own audit
    // event). What must never happen is the stamp changing either of them.
    await records.markRecoverySwept("exec_ev7_open" as never);
    const afterStamp = await records.get("exec_ev7_open" as never);
    expect(afterStamp?.status).toBe(observed?.status);
    expect(afterStamp?.updatedAt).toBe(observed?.updatedAt);
    expect(afterStamp?.recoverySweptAt).toBeTruthy();
    expect((afterStamp?.recoverySweptAt as string) >= (observed?.recoverySweptAt as string)).toBe(true);
    expect(afterStamp?.audit.length).toBe(observed?.audit.length);

    // MORE ELIGIBLE ATTEMPTS THAN ONE PAGE: the rotation reaches every one of them,
    // and every page it serves ADVANCES.
    const BULK = 120;
    const bulkIds = new Set<string>();
    for (let index = 0; index < BULK; index += 1) {
      const at = new Date(Date.parse("2026-09-05T00:00:00.000Z") + index * 1_000).toISOString();
      bulkIds.add(`exec_ev7_bulk_${index}`);
      await records.insert({
        ...recordFixture({ id: `exec_ev7_bulk_${index}`, handleId: `handle_ev7_bulk_${index}`, attempt: freeAttempt(), at }),
        missionId,
        taskId,
      } as ExecutionRecord);
    }
    const seen = new Set<string>();
    let pages = 0;
    // The scope holds at least BULK + 1 eligible attempts, so a one-page sweep
    // cannot cover it and the walk below is forced to paginate.
    while (pages < 6 && [...bulkIds].some((id) => !seen.has(id))) {
      pages += 1;
      const rows = await records.listRecoverable({ missionId, limit: 50 });
      // Every page is the LEAST RECENTLY OBSERVED rows, so it can never be the page
      // just read again — that is what "fair" means here, and it is asserted rather
      // than assumed.
      expect(rows.filter((row) => !seen.has(row.id)).length).toBeGreaterThan(0);
      for (const row of rows) {
        seen.add(row.id);
        await records.markRecoverySwept(row.id);
      }
    }
    expect(pages).toBeLessThanOrEqual(4);
    for (const id of bulkIds) expect(seen.has(id)).toBe(true);
    expect(seen.has("exec_ev7_open")).toBe(true);
  }, 300_000);

  /* ══════════════════════════════════════════════════════
     VIII — 70 mission scopes, and a SECOND instance continues them
     ══════════════════════════════════════════════════════ */

  /**
   * The FIFTH review's lifecycle question, as evidence: does recovery progress
   * survive 65-or-more active mission scopes, a process boundary, and the global
   * sweep running INTERLEAVED with the scoped ones?
   *
   * The answer has to be visible in the DATABASE, because that is the only thing two
   * processes share: instance A sweeps all 70 scopes (with the global sweep mixed
   * in), and instance B — a different pool, a different id factory, a different
   * clock, and no shared memory of any kind — sweeps the same 70 scopes and finds
   * every incident. Under the rejected design the eviction and the reset both lived
   * in the process, so this could not pass.
   */
  it("carries 70 mission scopes' progress in the LEDGER, and a SECOND instance continues it", async () => {
    const first = await boot("ev8a");
    // A DIFFERENT process's composition: its own pool, its own ids, its own clock.
    const second = await boot("ev8b");
    const { actorId, capabilityId } = first;
    const MISSIONS = 70;
    const ROWS = MISSIONS * 2;

    // Two doubtful claims per mission, written straight into the ledger with a fixed
    // `claimedAt` series. The claim table deliberately carries no FK to missions or
    // tasks (the migration documents why), so a delivery-ledger backlog can be
    // seeded without inventing 70 missions.
    psqlStdin(`INSERT INTO ai_execution_claims
  ("id", "missionId", "taskId", "attempt", "actorId", "capabilityId", "runtimeId", "idempotencyKey", "state", "detail", "claimedAt", "updatedAt")
SELECT 'ev8_claim_' || g,
       'mission_ev8_' || (((g - 1) / 2) + 1),
       'task_ev8_' || g,
       1,
       '${actorId}',
       '${capabilityId}',
       'runtime_hermes_saeed',
       'ev8:claim:' || g,
       'UNVERIFIED',
       'fixture: dispatch was entered and no durable handle was recorded',
       TIMESTAMP '2026-09-07 00:00:00' + (g || ' milliseconds')::interval,
       TIMESTAMP '2026-09-07 00:00:00' + (g || ' milliseconds')::interval
  FROM generate_series(1, ${ROWS}) AS g;
`);

    // Instance A sweeps all 70 scopes, with the GLOBAL sweep INTERLEAVED.
    for (let mission = 1; mission <= MISSIONS; mission += 1) {
      const scoped = await first.application.commands.reconcile(`mission_ev8_${mission}`);
      expect(scoped.filter((row) => row.kind === "CLAIM_UNVERIFIED")).toHaveLength(2);
      if (mission % 5 === 0) await first.application.commands.reconcileInFlight();
    }

    // Instance B has swept NOTHING, and yet the ledger hands it exactly what A found
    // — because the progress and the queue are both in the ROWS.
    for (let mission = 1; mission <= MISSIONS; mission += 1) {
      const scoped = await second.application.commands.reconcile(`mission_ev8_${mission}`);
      expect(scoped.filter((row) => row.kind === "CLAIM_UNVERIFIED")).toHaveLength(2);
    }

    // The rotation key is set on the rows, and the queue is readable from the other
    // instance: "how far behind is recovery for this scope" is a DURABLE answer.
    const head = (
      await second.claims.listUnresolved({ missionId: "mission_ev8_1", limit: 1, order: "LEAST_RECENTLY_SWEPT_FIRST" })
    )[0];
    expect(head?.recoverySweptAt).toBeTruthy();

    // Nothing was redispatched and nothing was fabricated by any of those sweeps.
    expect(first.transport.starts).toBe(0);
    for (const taskId of ["task_ev8_1", "task_ev8_2", `task_ev8_${ROWS}`]) {
      expect(await first.application.domain.executionRecords.listForTask(taskId)).toHaveLength(0);
    }
  }, 300_000);

  /* ══════════════════════════════════════════════════════
     IX — REPEATED recovery: an observed row keeps coming back
     ══════════════════════════════════════════════════════ */

  /**
   * Claim rows a sweep has ALREADY observed, still open, with a FIXED increasing stamp
   * series — so their position in the revisit rotation is the fixture's, not whatever
   * order the inserts happened to interleave in.
   */
  function seedObservedClaims(input: {
    idPrefix: string;
    rows: number;
    missionExpr: string;
    taskPrefix: string;
    actorId: string;
    capabilityId: string;
    at: string;
  }): void {
    psqlStdin(`INSERT INTO ai_execution_claims
  ("id", "missionId", "taskId", "attempt", "actorId", "capabilityId", "runtimeId", "idempotencyKey", "state", "detail", "claimedAt", "updatedAt", "recoverySweptAt")
SELECT '${input.idPrefix}_obs_' || g,
       ${input.missionExpr},
       '${input.taskPrefix}' || g,
       1,
       '${input.actorId}',
       '${input.capabilityId}',
       'runtime_hermes_saeed',
       '${input.idPrefix}:observed:' || g,
       'UNVERIFIED',
       'fixture: observed once and still open',
       TIMESTAMP '${input.at}' + (g || ' milliseconds')::interval,
       TIMESTAMP '${input.at}' + (g || ' milliseconds')::interval,
       TIMESTAMP '${input.at}' + (g || ' milliseconds')::interval
  FROM generate_series(1, ${input.rows}) AS g;
`);
  }

  /**
   * The SIXTH review's first blocking finding, proved on the real adapter and through
   * the APPLICATION boundary.
   *
   * The review's reproduction: a `DISPATCHING` claim observed while its lease was LIVE
   * (reported `CLAIM_IN_PROGRESS`) was NOT revisited in 20 mission sweeps with 60
   * arrivals per sweep. A single page ordered "never observed first, then least
   * recently observed" can be filled by exactly 60 arrivals forever, with no growing
   * unswept backlog at all — which is why the correction had to be an ALLOCATION
   * between disjoint windows rather than a larger page.
   *
   * What is asserted is RECONSIDERATION AND ITS DURABLE OUTCOME: the claim is reported
   * again, its row reaches `UNVERIFIED`, and the arrivals themselves are still
   * observed. Row selection alone would prove nothing about recovery happening.
   */
  it("revisits an observed claim under 60 arrivals per sweep, which cannot spend the revisit window", async () => {
    const booted = await boot("ev9");
    const { application, claims, actorId, capabilityId } = booted;
    const missionId = "mission_ev9_target";
    const taskId = "task_ev9_target";

    // SIXTY rows already observed and still open, INSIDE THE SAME MISSION as the target:
    // the revisit window's competition, and the rotation this case's bound is measured
    // over. (The arrivals below land in OTHER missions, which is the shape the review
    // used: heavy traffic around a scope must not delay the scope's own revisit.)
    seedObservedClaims({
      idPrefix: "ev9",
      rows: 60,
      missionExpr: `'${missionId}'`,
      taskPrefix: "task_ev9_observed_",
      actorId,
      capabilityId,
      at: "2026-09-20 00:00:00",
    });

    // The target: dispatch was entered and the owner is STILL WORKING (a live lease).
    const target = await seedClaim(claims, {
      missionId,
      taskId,
      attempt: 1,
      actorId,
      capabilityId,
      leaseOwner: "tok_ev9_owner",
      ttlMs: 600_000,
      state: "DISPATCHING",
    });

    // FIRST OBSERVATION: the sweep sees a LIVE lease and reports exactly that. Being
    // observed is what puts the row in the REVISIT window, whose allocation arrivals
    // cannot touch.
    const first = await application.commands.reconcile(missionId);
    expect(first.find((row) => row.taskId === taskId)?.kind).toBe("CLAIM_IN_PROGRESS");
    expect((await claims.get(target.id))?.recoverySweptAt).toBeTruthy();

    // …and now the owner CRASHES: the lease lapses on the DATABASE's own clock.
    await expireLease(booted.handle, target.id);

    // 60 NEW unresolved claims before EVERY sweep — more than the whole budget, every
    // time. The old single page spent all of it on these and never looked at the target
    // again. They land in OTHER missions, which is the shape the review used and what
    // makes this a claim about the WINDOWS rather than about a mission filter: this
    // scope's own observed rows are exactly the 61 below, so the bound is a real
    // measurement rather than a guess at a shared table's size.
    const ARRIVALS = 60;
    const REVISIT_QUOTA = 20;
    // The target is at position 61 of the revisit rotation, and nothing about the
    // arrivals enters that arithmetic: they can only ever be stamped BEHIND it.
    const JUSTIFIED_BOUND = Math.ceil(61 / REVISIT_QUOTA) + 1;
    let revisited: string | null = null;
    let sweeps = 0;
    while (sweeps < JUSTIFIED_BOUND && revisited === null) {
      sweeps += 1;
      seedArrivals({
        sweep: sweeps,
        count: ARRIVALS,
        keyPrefix: "ev9",
        missionExpr: "'mission_ev9_arrival_' || g",
        taskPrefix: "task_ev9_arrival_",
        actorId,
        capabilityId,
      });
      const rows = await application.commands.reconcile(missionId);
      const news = rows.find((row) => row.taskId === taskId && row.kind !== "CLAIM_IN_PROGRESS");
      if (news) revisited = news.kind;
    }

    expect(sweeps).toBeLessThanOrEqual(JUSTIFIED_BOUND);
    expect(revisited).toBe("CLAIM_UNVERIFIED");
    // The DURABLE outcome, not merely the report.
    expect((await claims.get(target.id))?.state).toBe("UNVERIFIED");
    // …and the SIXTY rows that were already observed are still being served too: the
    // window is a rotation, not a one-off. Measured, not assumed.
    const observedStillOpen = scalar(
      `select count(*) from ai_execution_claims
        where "idempotencyKey" like 'ev9:observed:%' and "state" = 'UNVERIFIED'`,
    );
    expect(observedStillOpen).toBe(60);

    // Nothing was redispatched and nothing was fabricated for the target.
    expect(await application.domain.executionRecords.listForTask(taskId)).toHaveLength(0);
    expect(booted.transport.starts).toBe(0);
  }, 300_000);

  /**
   * The same finding's OTHER half: GLOBAL and MISSION-scoped traffic must not starve
   * each other's observed rows.
   *
   * The review reproduced both directions on the unrepaired tree: a global sweep's
   * stamping followed by mission traffic starved mission recovery for eight sweeps, and
   * mission stamping followed by global traffic starved global recovery for eight
   * sweeps. Both are exercised HERE TOGETHER — 60 arrivals outside the mission, a global
   * sweep, 60 inside it, a mission sweep, eight times — and both targets must be
   * reconsidered and reach the durable doubt.
   */
  it("does not let global and mission traffic starve each other's observed rows", async () => {
    const booted = await boot("ev9b");
    const { application, claims, actorId, capabilityId } = booted;
    const missionId = "mission_ev9b_scope";
    const scopedTaskId = "task_ev9b_scoped";
    const globalTaskId = "task_ev9b_global";

    // TWO observed, still-open rows: one inside ONE mission, one outside it. They are
    // given the OLDEST observation stamps in the cluster through the same column
    // `markRecoverySwept` writes — which is not a trick but the situation the review
    // describes: a row observed long ago that nothing has looked at since, sitting at
    // the front of the revisit rotation where a bound can be measured.
    const scoped = await seedClaim(claims, {
      missionId,
      taskId: scopedTaskId,
      attempt: 1,
      actorId,
      capabilityId,
      leaseOwner: "tok_ev9b_scoped",
      ttlMs: 600_000,
      state: "DISPATCHING",
    });
    const global = await seedClaim(claims, {
      missionId: "mission_ev9b_other",
      taskId: globalTaskId,
      attempt: 1,
      actorId,
      capabilityId,
      leaseOwner: "tok_ev9b_global",
      ttlMs: 600_000,
      state: "DISPATCHING",
    });
    psqlStdin(
      `update ai_execution_claims set "recoverySweptAt" = TIMESTAMP '2026-09-01 00:00:00' where "id" in ('${scoped.id}', '${global.id}');`,
    );
    // Both owners then CRASH: the leases lapse on the DATABASE's own clock.
    await expireLease(booted.handle, scoped.id);
    await expireLease(booted.handle, global.id);

    const seen = new Set<string>();
    for (let round = 0; round < 8; round += 1) {
      seedArrivals({
        sweep: round,
        count: 60,
        keyPrefix: "ev9bg",
        missionExpr: "'mission_ev9b_far_' || g",
        taskPrefix: "task_ev9b_far_",
        actorId,
        capabilityId,
      });
      for (const row of await application.commands.reconcileInFlight()) {
        if (row.taskId && row.kind === "CLAIM_UNVERIFIED") seen.add(row.taskId);
      }
      // They sit at the FRONT of the revisit rotation, so the bound here is the window
      // itself: 2 rows, 20 rows per sweep. Asserted within the loop rather than after
      // it, so a starvation cannot be hidden by the rounds that follow.
      expect(seen.has(globalTaskId)).toBe(true);
      seedArrivals({
        sweep: round,
        count: 60,
        keyPrefix: "ev9bs",
        missionExpr: `'${missionId}'`,
        taskPrefix: "task_ev9b_near_",
        actorId,
        capabilityId,
      });
      for (const row of await application.commands.reconcile(missionId)) {
        if (row.taskId && row.kind === "CLAIM_UNVERIFIED") seen.add(row.taskId);
      }
    }

    // BOTH were reconsidered: the mission's traffic did not hide the global row, and the
    // global traffic did not hide the mission's.
    expect(seen.has(scopedTaskId)).toBe(true);
    expect(seen.has(globalTaskId)).toBe(true);
    // …and BOTH reached the durable doubt a first observation would have given them.
    expect((await claims.get(scoped.id))?.state).toBe("UNVERIFIED");
    expect((await claims.get(global.id))?.state).toBe("UNVERIFIED");
    expect(booted.transport.starts).toBe(0);
  }, 300_000);

  /* ══════════════════════════════════════════════════════
     X — an observed RECORD that must keep being revisited
     ══════════════════════════════════════════════════════ */

  /**
   * The record half of the same finding: an attempt that was observed once and is STILL
   * OPEN — its run finished after we stopped looking, which is the case recovery exists
   * for — must be revisited under a stream of eligible arrivals.
   *
   * The review reproduced the starved direction with 55 arrivals per sweep across ten
   * record-first sweeps. Here the target sits at the BACK of the revisit rotation — sixty
   * observed-open attempts ahead of it, both groups carrying the OLDEST observation stamps
   * in the cluster, written through the very column `markRecoverySwept` owns — so that a
   * bound is actually measured against a rotation of known size; and the assertion is the
   * DURABLE one, that a RECONCILED audit event was appended to the attempt.
   */
  it("revisits an observed but still-open record under 55 eligible arrivals per sweep", async () => {
    const booted = await boot("ev10");
    const { application } = booted;
    const records = application.domain.executionRecords;

    // Sixty attempts already observed and still open, then the target behind them.
    for (let index = 0; index < 60; index += 1) {
      await records.insert(
        recordFixture({ id: `exec_ev10_obs_${index}`, handleId: `handle_ev10_obs_${index}`, attempt: 1 + index }) as ExecutionRecord,
      );
    }
    const target = await records.insert(
      recordFixture({ id: "exec_ev10_target", handleId: "handle_ev10_target", attempt: 500 }) as ExecutionRecord,
    );
    // The OBSERVATION stamps are written directly because their ORDER is the fixture's
    // point: 2026-09-20 predates every other observed attempt in this cluster, so the
    // rotation this case measures is exactly the 61 rows below.
    psqlStdin(`UPDATE ai_execution_records r
   SET "recoverySweptAt" = TIMESTAMP '2026-09-20 00:00:00' + (s.n || ' milliseconds')::interval
  FROM (SELECT g AS n, 'exec_ev10_obs_' || (g - 1) AS id FROM generate_series(1, 60) AS g) s
 WHERE r."id" = s.id;
UPDATE ai_execution_records
   SET "recoverySweptAt" = TIMESTAMP '2026-09-20 00:02:00'
 WHERE "id" = 'exec_ev10_target';
`);

    const before = (await records.get(target.id))!;
    expect(before.recoverySweptAt).toBeTruthy();
    const ARRIVALS = 55;
    const REVISIT_QUOTA = 20;
    const JUSTIFIED_BOUND = Math.ceil(61 / REVISIT_QUOTA) + 1;
    let revisitedAt: number | null = null;
    let sweep = 0;
    while (sweep < JUSTIFIED_BOUND && revisitedAt === null) {
      sweep += 1;
      for (let index = 0; index < ARRIVALS; index += 1) {
        const n = (sweep - 1) * ARRIVALS + index;
        await records.insert(
          recordFixture({ id: `exec_ev10_arrival_${n}`, handleId: `handle_ev10_arrival_${n}`, attempt: 1000 + n }) as ExecutionRecord,
        );
      }
      const rows = await application.commands.reconcileInFlight();
      if (rows.some((row) => row.executionRecordId === target.id)) revisitedAt = sweep;
    }

    expect(revisitedAt).toBeLessThanOrEqual(JUSTIFIED_BOUND);
    // The revisit DID the work, durably: the attempt gained a RECONCILED audit event.
    const after = (await records.get(target.id))!;
    expect(after.audit.length).toBeGreaterThan(before.audit.length);
    expect(after.audit.some((event) => event.type === "RECONCILED")).toBe(true);
  }, 300_000);
});
