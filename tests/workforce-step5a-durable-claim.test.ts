import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { AiWorkforceError } from "@/modules/ai-workforce/core/errors";
import { createSequentialIdFactory } from "@/modules/ai-workforce/core/ids";
import {
  createWorkforcePrismaClient,
  type WorkforcePrismaHandle,
} from "@/modules/ai-workforce/persistence/prisma-client";
import { executionIdempotencyKeyForAttempt } from "@/modules/workforce/execution/capability-execution-contracts";
import {
  DEFAULT_CLAIM_LEASE_TTL_MS,
  InMemoryExecutionClaimRepository,
  REDISPATCHABLE_CLAIM_STATES,
  isRedispatchableClaimState,
  type ExecutionClaim,
  type ExecutionClaimRepository,
  type ExecutionClaimRequest,
} from "@/modules/workforce/execution/execution-claim";
import { PrismaExecutionClaimRepository } from "@/modules/workforce/persistence";

/**
 * STEP 5A-2 — the DURABLE execution claim, against a real PostgreSQL.
 *
 * `workforce-step5a-claim.test.ts` proves the claim SEMANTICS over the in-memory
 * reference. This file proves the DURABLE adapter obeys the same semantics, and
 * that is a different claim: the ledger must be the source of truth instead of
 * process memory, two INSTANCES must agree about who owns an attempt, and a
 * restart must not turn a claim into a second execution.
 *
 * LOCAL AND ISOLATED, by construction:
 *
 *   - skipped entirely unless `AI_WORKFORCE_TEST_DATABASE_URL` is set;
 *   - creates and drops its OWN database (`workforce_claim_test`);
 *   - `scripts/run-persistence-proof.sh` (with `PROOF_TEST` pointed here) supplies
 *     a throwaway PostgreSQL cluster on loopback with trust auth, so no existing
 *     cluster — and certainly not production — is ever touched;
 *   - the schema comes from the PROPOSED migration files, so the SQL that would
 *     one day run on a real server runs somewhere first.
 *
 * It never reads `DATABASE_URL`, and it spends no provider turn: there is no
 * runtime, no bridge and no Hermes anywhere in this file.
 */

const BASE_URL = process.env.AI_WORKFORCE_TEST_DATABASE_URL;
const DB_NAME = "workforce_claim_test";
const DB_URL = BASE_URL ? `${BASE_URL.replace(/\/$/, "")}/${DB_NAME}` : "";
const REPO_ROOT = path.resolve(__dirname, "..");
const PSQL_BIN = process.env.PSQL_BIN || "C:\\Program Files\\PostgreSQL\\18\\bin\\psql.exe";
const PORT = BASE_URL ? new URL(BASE_URL).port || "5432" : "5432";

/** Every proposal up to and including the claim ledger, in apply order. */
const MIGRATIONS = [
  "prisma/proposed-migrations/AI_WORKFORCE_PHASE_1A/migration.sql",
  "prisma/proposed-migrations/AI_WORKFORCE_PHASE_1B/migration.sql",
  "prisma/proposed-migrations/AI_WORKFORCE_PHASE_2/migration.sql",
  "prisma/proposed-migrations/AI_WORKFORCE_PHASE_3/migration.sql",
  "prisma/proposed-migrations/AI_WORKFORCE_PHASE_4/migration.sql",
];

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

/**
 * A DURABLE ledger handle: its own connection, its own id factory and its own
 * repository. Two of these share nothing but the database, which is the point.
 */
type DurableLedger = {
  repo: PrismaExecutionClaimRepository;
  handle: WorkforcePrismaHandle;
  /** Lapse the lease using the DATABASE's clock — never this process's. */
  expire: (claimId: string) => Promise<void>;
};

/** A ledger under test, plus a way to make one of its leases lapse. */
type Ledger = {
  repo: ExecutionClaimRepository;
  expire: (claimId: string) => Promise<void>;
};

let seq = 0;

function claimRequest(overrides: Partial<ExecutionClaimRequest> = {}): ExecutionClaimRequest {
  seq += 1;
  const taskId = `task_${seq}`;
  return {
    missionId: `mission_${seq}`,
    taskId,
    attempt: 1,
    idempotencyKey: executionIdempotencyKeyForAttempt(taskId, 1),
    actorId: "actor_analyst",
    capabilityId: "strategy.internal-brief",
    runtimeId: "runtime_hermes_saeed",
    leaseOwner: "process_A",
    ...overrides,
  };
}

/** The reference implementation, with a clock that can be pushed past a lease. */
function memoryLedger(): Ledger {
  let current = new Date("2026-02-01T00:00:00.000Z").getTime();
  const repo = new InMemoryExecutionClaimRepository({
    ids: createSequentialIdFactory("mem"),
    now: () => new Date(current),
  });
  return {
    repo,
    expire: async () => {
      current += 2 * DEFAULT_CLAIM_LEASE_TTL_MS;
    },
  };
}

describeIfDatabase("STEP 5A-2 — the durable claim ledger, a real PostgreSQL and a restart", () => {
  const handles: WorkforcePrismaHandle[] = [];

  async function durableLedger(prefix: string): Promise<DurableLedger> {
    const handle = createWorkforcePrismaClient(DB_URL);
    handles.push(handle);
    const repo = new PrismaExecutionClaimRepository({
      client: handle.client,
      ids: createSequentialIdFactory(prefix),
    });
    return {
      repo,
      handle,
      expire: async (claimId: string) => {
        // The ONLY way to lapse a lease here. It is a SQL update against the
        // database's own clock, so a test cannot accidentally prove the
        // application clock decides anything.
        await handle.client.$executeRaw`
          UPDATE ai_execution_claims
          SET "leaseExpiresAt" = ((now() AT TIME ZONE 'UTC') - interval '1 second')
          WHERE "id" = ${claimId}
        `;
      },
    };
  }

  function readOutOfProcess(idempotencyKey: string): {
    found: boolean;
    claim?: { id: string; state: string; handleId: string | null; executionRecordId: string | null; attempt: number };
  } {
    const raw = execSync(`node scripts/read-durable-claim.cjs "${DB_URL}" "${idempotencyKey}"`, {
      cwd: REPO_ROOT,
      stdio: "pipe",
      env: process.env,
    }).toString();
    return JSON.parse(raw);
  }

  beforeAll(async () => {
    try {
      psql(`DROP DATABASE IF EXISTS "${DB_NAME}" WITH (FORCE)`);
    } catch {
      /* may not exist */
    }
    psql(`CREATE DATABASE "${DB_NAME}"`);

    // The additive-only guarantee is asserted, not assumed. Only the claim
    // migration is checked: PHASE_1B contains a reviewed, deliberate DROP of a
    // table that never existed, so it fails this check on purpose.
    execSync("node scripts/verify-proposed-migration.mjs prisma/proposed-migrations/AI_WORKFORCE_PHASE_4/migration.sql", {
      stdio: "pipe",
      cwd: REPO_ROOT,
    });

    for (const file of MIGRATIONS) psqlFile(file);

    // The generated client must know the new model. Local only.
    execSync("npx prisma generate", { env: process.env, stdio: "pipe", cwd: REPO_ROOT });

    // Evidence: the claim table that exists after applying the proposals.
    execSync(`"${PSQL_BIN}" -h 127.0.0.1 -p ${PORT} -U postgres -w -c "\\d ai_execution_claims" -d ${DB_NAME}`, {
      env: { ...process.env, PGPASSWORD: "postgres" },
      stdio: "inherit",
      cwd: REPO_ROOT,
    });
  }, 300_000);

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

  it("gives the same attempt to exactly ONE of two independent instances (1, 2)", async () => {
    const request = claimRequest();
    const [left, right] = await Promise.all([durableLedger("race-l"), durableLedger("race-r")]);

    const outcomes = await Promise.all([
      left.repo.claim({ ...request, leaseOwner: "instance_L" }),
      right.repo.claim({ ...request, leaseOwner: "instance_R" }),
    ]);

    const winners = outcomes.filter((outcome) => outcome.kind === "CLAIMED");
    const losers = outcomes.filter((outcome) => outcome.kind === "IN_PROGRESS");
    expect(winners).toHaveLength(1);
    expect(losers).toHaveLength(1);

    // The loser may not execute, and it addressed the winner's row rather than
    // creating one of its own.
    expect(losers[0]?.claim.id).toBe(winners[0]?.claim.id);
    // ONE row for this attempt — the property that makes a second concurrent
    // advance unable to start a second run. A whole-ledger count would prove
    // nothing here: the table is shared by every test in this file.
    expect(await left.repo.listForTask(request.taskId)).toHaveLength(1);

    // The loser cannot enter dispatch either: the CAS refuses a claim it does
    // not hold.
    const claimed = await right.repo.markDispatching(winners[0]!.claim.id, { leaseOwner: "instance_R" });
    expect(claimed).toBeNull();
  });

  it("refuses a second execution authority while a lease is live (2, 9)", async () => {
    const request = claimRequest();
    const first = await durableLedger("live-a");
    const second = await durableLedger("live-b");

    const owner = await first.repo.claim({ ...request, leaseOwner: "instance_A" });
    expect(owner.kind).toBe("CLAIMED");

    // Nothing has expired it, so the database says the lease is live and the
    // observer must WAIT — regardless of what its own clock thinks.
    const contender = await second.repo.claim({ ...request, leaseOwner: "instance_B" });
    expect(contender.kind).toBe("IN_PROGRESS");

    const recovery = await second.repo.recoveryFor(owner.claim.id, { requester: "instance_B" });
    expect(recovery?.kind).toBe("IN_PROGRESS");
  });

  it("lets an expired CLAIMED attempt be reclaimed, because dispatch was never entered (4)", async () => {
    const request = claimRequest();
    const first = await durableLedger("exp-a");
    const second = await durableLedger("exp-b");

    const original = await first.repo.claim({ ...request, leaseOwner: "instance_A" });
    expect(original.kind).toBe("CLAIMED");

    await second.expire(original.claim.id);

    const reclaimed = await second.repo.claim({ ...request, leaseOwner: "instance_B" });
    expect(reclaimed.kind).toBe("RECLAIMED");
    if (reclaimed.kind !== "RECLAIMED") throw new Error("expected RECLAIMED");
    expect(reclaimed.reclaimedFrom).toBe("CLAIMED");
    expect(reclaimed.claim.id).toBe(original.claim.id);
    expect(reclaimed.claim.leaseOwner).toBe("instance_B");
    expect(await second.repo.listForTask(request.taskId)).toHaveLength(1);
  });

  it("turns an expired DISPATCHING attempt into UNVERIFIED and NEVER redispatches it (5, 6)", async () => {
    const request = claimRequest();
    const first = await durableLedger("unv-a");
    const second = await durableLedger("unv-b");

    const claimed = await first.repo.claim({ ...request, leaseOwner: "instance_A" });
    expect(claimed.kind).toBe("CLAIMED");
    const entered = await first.repo.markDispatching(claimed.claim.id, { leaseOwner: "instance_A" });
    expect(entered?.state).toBe("DISPATCHING");

    // The crash: the external request may already have reached Hermes, and no
    // handle was persisted. This is the situation the owner corrected.
    await second.expire(claimed.claim.id);

    const observed = await second.repo.claim({ ...request, leaseOwner: "instance_B" });
    expect(observed.kind).toBe("UNVERIFIED");
    expect(observed.kind === "UNVERIFIED" && observed.detail).toContain("must not be re-dispatched");

    // The doubt is now DURABLE, not re-inferred: every later read says the same.
    const again = await second.repo.claim({ ...request, leaseOwner: "instance_C" });
    expect(again.kind).toBe("UNVERIFIED");

    const recovery = await second.repo.recoveryFor(claimed.claim.id, { requester: "instance_B" });
    expect(recovery?.kind).toBe("UNVERIFIED");

    // And it can never be moved back into dispatch, by any route.
    expect(await second.repo.markDispatching(claimed.claim.id, { leaseOwner: "instance_C" })).toBeNull();
    const persisted = await second.repo.get(claimed.claim.id);
    expect(persisted?.state).toBe("UNVERIFIED");
    // The lease is genuinely GONE, not merely stale — and the field is omitted,
    // exactly as the in-memory reference omits a cleared field.
    expect(persisted?.leaseOwner).toBeUndefined();
    expect(persisted?.leaseExpiresAt).toBeUndefined();
    expect(persisted?.detail).toContain("must not be re-dispatched");

    // The machine-checkable form of the invariant, asserted here as well as in
    // the offline suite.
    expect(REDISPATCHABLE_CLAIM_STATES).not.toContain("DISPATCHING");
    expect(REDISPATCHABLE_CLAIM_STATES).not.toContain("UNVERIFIED");
    expect(isRedispatchableClaimState("UNVERIFIED")).toBe(false);
  });

  it("survives a real process and repository recreation as DISPATCHED, never a new claim (3, 8)", async () => {
    const request = claimRequest();
    const first = await durableLedger("disp-a");

    const claimed = await first.repo.claim({ ...request, leaseOwner: "instance_A" });
    await first.repo.markDispatching(claimed.claim.id, { leaseOwner: "instance_A" });
    const dispatched = await first.repo.markDispatched(claimed.claim.id, {
      executionRecordId: "rec_step5a_1",
      handleId: "handle_step5a_1",
    });
    expect(dispatched?.state).toBe("DISPATCHED");

    // (a) a fresh repository over a fresh connection — a real reconstruction.
    const second = await durableLedger("disp-b");
    const replayed = await second.repo.claim({ ...request, leaseOwner: "instance_B" });
    expect(replayed.kind).toBe("REPLAYED");
    expect(replayed.claim.id).toBe(claimed.claim.id);
    expect(replayed.claim.executionRecordId).toBe("rec_step5a_1");
    expect(replayed.claim.handleId).toBe("handle_step5a_1");

    const recovery = await second.repo.recoveryFor(claimed.claim.id, { requester: "instance_B" });
    expect(recovery?.kind).toBe("ADOPT");
    expect(recovery?.kind === "ADOPT" && recovery.executionRecordId).toBe("rec_step5a_1");
    expect(await second.repo.listForTask(request.taskId)).toHaveLength(1);

    // (b) and a SEPARATE OPERATING-SYSTEM PROCESS, which imports nothing from
    //     `src/` — so the database is the only thing it can be reading.
    const outOfProcess = readOutOfProcess(request.idempotencyKey);
    expect(outOfProcess.found).toBe(true);
    expect(outOfProcess.claim).toMatchObject({
      id: claimed.claim.id,
      state: "DISPATCHED",
      handleId: "handle_step5a_1",
      executionRecordId: "rec_step5a_1",
      attempt: 1,
    });
  });

  it("yields exactly one winner under a burst of concurrent claims (6)", async () => {
    const request = claimRequest();
    const ledger = await durableLedger("burst");
    const contenders = Array.from({ length: 8 }, (_, index) => index);

    const outcomes = await Promise.all(
      contenders.map((index) => ledger.repo.claim({ ...request, leaseOwner: `instance_${index}` })),
    );

    const winners = outcomes.filter((outcome) => outcome.kind === "CLAIMED");
    expect(winners).toHaveLength(1);
    // Every other contender was told a live claim exists; none was told to run.
    expect(outcomes.filter((outcome) => outcome.kind === "IN_PROGRESS")).toHaveLength(7);
    expect(new Set(outcomes.map((outcome) => outcome.claim.id)).size).toBe(1);
    expect(await ledger.repo.listForTask(request.taskId)).toHaveLength(1);
  });

  it("maps uniqueness and CAS conflicts to typed outcomes, never raw Prisma errors (7)", async () => {
    const request = claimRequest();
    const ledger = await durableLedger("typed");

    const first = await ledger.repo.claim({ ...request, leaseOwner: "instance_A" });
    expect(first.kind).toBe("CLAIMED");

    // A key clash — the common concurrency case — is an OUTCOME, not a throw.
    const second = await ledger.repo.claim({ ...request, leaseOwner: "instance_B" });
    expect(second.kind).toBe("IN_PROGRESS");

    // Losing CAS calls return `null`, which the caller branches on. None throws.
    expect(await ledger.repo.markDispatched(first.claim.id, { executionRecordId: "rec", handleId: "h" })).toBeNull();
    expect(await ledger.repo.release(first.claim.id, "refused")).not.toBeNull();
    expect(await ledger.repo.release(first.claim.id, "again")).toBeNull();
    expect(await ledger.repo.markUnverified(first.claim.id, "not entering")).toBeNull();
    expect(await ledger.repo.markDispatched("claim_that_never_existed", { executionRecordId: "rec", handleId: "h" })).toBeNull();

    // A PRIMARY-KEY collision is NOT absorbed by ON CONFLICT (idempotencyKey), so
    // it is the one genuine error path. It must surface as the typed code, not as
    // a Prisma class the caller would have to import to understand.
    const victim = await durableLedger("collide");
    await victim.repo.claim(claimRequest());
    // A second repository REPLAYING the same id sequence: its first claim mints
    // an id that is already taken, and `ON CONFLICT (idempotencyKey)` does not
    // absorb a primary-key conflict.
    const broken = new PrismaExecutionClaimRepository({
      client: victim.handle.client,
      ids: createSequentialIdFactory("collide"),
    });
    let caught: unknown;
    try {
      await broken.claim(claimRequest());
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(AiWorkforceError);
    expect((caught as AiWorkforceError).code).toBe("PERSISTENCE_UNAVAILABLE");
  });

  it("decides lease expiry with the DATABASE clock, so an application clock cannot expire a peer (9)", async () => {
    // (a) STATIC: the adapter cannot consult an application clock at all. The
    //     comments mention `Date.now()` while explaining why it is avoided, so
    //     the check reads the CODE with comments stripped.
    const source = fs.readFileSync(
      path.join(REPO_ROOT, "src/modules/workforce/persistence/prisma-execution-claim-repository.ts"),
      "utf8",
    );
    const code = source.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/.*$/gm, " ");
    expect(code).not.toMatch(/Date\.now\(/);
    expect(code).not.toMatch(/new Date\(/);
    expect(code).not.toMatch(/options\.now/);
    expect(code).toMatch(/now\(\) AT TIME ZONE 'UTC'/);

    // (b) BEHAVIORAL: the same row, the same observer, two answers — decided by
    //     the database and nothing else.
    const request = claimRequest();
    const first = await durableLedger("clock-a");
    const second = await durableLedger("clock-b");

    const claimed = await first.repo.claim({ ...request, leaseOwner: "instance_A" });
    expect(claimed.kind).toBe("CLAIMED");
    expect(await second.repo.claim({ ...request, leaseOwner: "instance_B" })).toMatchObject({
      kind: "IN_PROGRESS",
    });

    // The RECOVERY verdict is the database's too. This is the branch that used
    // to compare two dates in JavaScript; PostgreSQL now computes `leaseIsLive`
    // in the same query as the row, so no application clock can reach it.
    expect((await second.repo.recoveryFor(claimed.claim.id, { requester: "instance_B" }))?.kind).toBe(
      "IN_PROGRESS",
    );

    await second.expire(claimed.claim.id);
    expect((await second.repo.recoveryFor(claimed.claim.id, { requester: "instance_B" }))?.kind).toBe("RECLAIM");
    expect(await second.repo.claim({ ...request, leaseOwner: "instance_B" })).toMatchObject({
      kind: "RECLAIMED",
    });

    // The adapter must CONSULT the database's verdict rather than do its own
    // date arithmetic. That is a property of the source, so it is asserted on it.
    expect(code).toMatch(/leaseIsLive/);
  });

  it("guards ONE attempt by its identity, and fails closed when the key disagrees (fix 1)", async () => {
    const base = claimRequest();
    const first = await durableLedger("identity-a");
    const second = await durableLedger("identity-b");

    const owner = await first.repo.claim({ ...base, leaseOwner: "instance_A" });
    expect(owner.kind).toBe("CLAIMED");

    // (1) SAME taskId + attempt + SAME key → ordinary claim semantics. The second
    //     instance is told a live lease exists; it is NOT handed dispatch authority.
    const sameKey = await second.repo.claim({ ...base, leaseOwner: "instance_B" });
    expect(sameKey.kind).toBe("IN_PROGRESS");
    expect(sameKey.claim.id).toBe(owner.claim.id);

    // (2) SAME taskId + attempt + DIFFERENT key → typed identity conflict. This is
    //     the case `UNIQUE(idempotencyKey)` alone would have treated as a brand
    //     new attempt, minting a SECOND authority for one attempt.
    const misspelled: ExecutionClaimRequest = {
      ...base,
      idempotencyKey: `${executionIdempotencyKeyForAttempt(base.taskId, base.attempt)}:typo`,
      leaseOwner: "instance_B",
    };
    let caught: unknown;
    try {
      await second.repo.claim(misspelled);
    } catch (error) {
      caught = error;
    }
    // (6) A typed domain refusal — never a raw Prisma P2002/P20xx.
    expect(caught).toBeInstanceOf(AiWorkforceError);
    expect((caught as AiWorkforceError).code).toBe("ATTEMPT_IDEMPOTENCY_MISMATCH");
    expect((caught as AiWorkforceError).message).not.toMatch(/P20\d\d/);

    // (3) Exactly one durable authority remains, and the misspelled key exists nowhere.
    expect(await second.repo.listForTask(base.taskId)).toHaveLength(1);
    expect(await second.repo.findByKey(misspelled.idempotencyKey)).toBeNull();

    // (4) The stored row is UNCHANGED — its original key, state and owner intact.
    expect(await second.repo.findByKey(base.idempotencyKey)).toMatchObject({ id: owner.claim.id });
    expect(await second.repo.get(owner.claim.id)).toMatchObject({
      idempotencyKey: base.idempotencyKey,
      state: "CLAIMED",
      leaseOwner: "instance_A",
    });

    // (5) No dispatch authority comes out of the refusal: it THREW instead of
    //     returning an outcome, so there is nothing to dispatch from, and the
    //     attempt was neither promoted nor mutated.
    expect(await second.repo.markDispatching(owner.claim.id, { leaseOwner: "instance_B" })).toBeNull();
    expect((await second.repo.get(owner.claim.id))?.state).toBe("CLAIMED");

    // Same-key replay after the attempt is durably identified still ADOPTS.
    await first.repo.markDispatching(owner.claim.id, { leaseOwner: "instance_A" });
    await first.repo.markDispatched(owner.claim.id, {
      executionRecordId: "rec_identity_1",
      handleId: "handle_identity_1",
    });
    const replayed = await second.repo.claim({ ...base, leaseOwner: "instance_B" });
    expect(replayed.kind).toBe("REPLAYED");
    expect(replayed.claim.id).toBe(owner.claim.id);
    expect(replayed.claim.executionRecordId).toBe("rec_identity_1");

    // ...and the DIFFERENT key still fails closed once the attempt is identified.
    await expect(second.repo.claim(misspelled)).rejects.toMatchObject({
      code: "ATTEMPT_IDEMPOTENCY_MISMATCH",
    });
    expect(await second.repo.listForTask(base.taskId)).toHaveLength(1);

    // A genuinely DIFFERENT attempt is a different authority, and does get a row.
    const otherAttempt: ExecutionClaimRequest = {
      ...base,
      attempt: base.attempt + 1,
      idempotencyKey: executionIdempotencyKeyForAttempt(base.taskId, base.attempt + 1),
      leaseOwner: "instance_C",
    };
    expect((await second.repo.claim(otherAttempt)).kind).toBe("CLAIMED");
    expect(await second.repo.listForTask(base.taskId)).toHaveLength(2);
  });

  it("obeys the SAME state-transition contract as the in-memory reference (10)", async () => {
    const durable = await durableLedger("parity");

    /** Dispatch → execution identified → replay/adopt. */
    async function dispatchedPath(ledger: Ledger): Promise<string[]> {
      const request = claimRequest();
      const seen: string[] = [];
      const first = await ledger.repo.claim({ ...request, leaseOwner: "P1" });
      seen.push(first.kind);
      const entered = await ledger.repo.markDispatching(first.claim.id, { leaseOwner: "P1" });
      seen.push(entered ? entered.state : "null");
      const contended = await ledger.repo.claim({ ...request, leaseOwner: "P2" });
      seen.push(contended.kind);
      const identified = await ledger.repo.markDispatched(first.claim.id, {
        executionRecordId: "rec_parity",
        handleId: "handle_parity",
      });
      seen.push(identified ? identified.state : "null");
      const replayed = await ledger.repo.claim({ ...request, leaseOwner: "P3" });
      seen.push(replayed.kind);
      const recovery = await ledger.repo.recoveryFor(first.claim.id, { requester: "P3" });
      seen.push(recovery ? recovery.kind : "null");
      return seen;
    }

    /** Entered, lease lapsed, no handle → a doubt that never becomes a dispatch. */
    async function unverifiedPath(ledger: Ledger): Promise<string[]> {
      const request = claimRequest();
      const seen: string[] = [];
      const first = await ledger.repo.claim({ ...request, leaseOwner: "P1" });
      seen.push(first.kind);
      const entered = await ledger.repo.markDispatching(first.claim.id, { leaseOwner: "P1" });
      seen.push(entered ? entered.state : "null");
      await ledger.expire(first.claim.id);
      const doubt = await ledger.repo.claim({ ...request, leaseOwner: "P2" });
      seen.push(doubt.kind);
      const stillDoubt = await ledger.repo.claim({ ...request, leaseOwner: "P3" });
      seen.push(stillDoubt.kind);
      const recovery = await ledger.repo.recoveryFor(first.claim.id, { requester: "P2" });
      seen.push(recovery ? recovery.kind : "null");
      const refused = await ledger.repo.markDispatching(first.claim.id, { leaseOwner: "P3" });
      seen.push(refused ? refused.state : "null");
      return seen;
    }

    /** Refused before dispatch → genuinely free again. */
    async function releasedPath(ledger: Ledger): Promise<string[]> {
      const request = claimRequest();
      const seen: string[] = [];
      const first = await ledger.repo.claim({ ...request, leaseOwner: "P1" });
      seen.push(first.kind);
      const released = await ledger.repo.release(first.claim.id, "a control refused before dispatch");
      seen.push(released ? released.state : "null");
      const retaken = await ledger.repo.claim({ ...request, leaseOwner: "P2" });
      seen.push(retaken.kind);
      const recovery = await ledger.repo.recoveryFor(first.claim.id, { requester: "P2" });
      seen.push(recovery ? recovery.kind : "null");
      return seen;
    }

    const memory = memoryLedger();
    const durableLedgerRef: Ledger = { repo: durable.repo, expire: durable.expire };

    for (const path_ of [dispatchedPath, unverifiedPath, releasedPath]) {
      const fromMemory = await path_(memory);
      const fromDatabase = await path_(durableLedgerRef);
      expect(fromDatabase).toEqual(fromMemory);
    }

    // The two implementations must also agree on which states are blocked from
    // dispatch — a divergence here is exactly the bug the whole module prevents.
    expect(REDISPATCHABLE_CLAIM_STATES).toEqual(["CLAIMED", "RELEASED"]);
  });

  it("keeps every claim for a task, in attempt order, across a restart", async () => {
    const first = await durableLedger("attempts-a");
    const request1 = claimRequest();
    await first.repo.claim(request1);
    const attempt2: ExecutionClaimRequest = {
      ...request1,
      attempt: 2,
      idempotencyKey: executionIdempotencyKeyForAttempt(request1.taskId, 2),
    };
    await first.repo.claim(attempt2);

    const second = await durableLedger("attempts-b");
    const claims: ExecutionClaim[] = await second.repo.listForTask(request1.taskId);
    expect(claims.map((claim) => claim.attempt)).toEqual([1, 2]);
    expect(await second.repo.findByKey(request1.idempotencyKey)).toMatchObject({
      attempt: 1,
      state: "CLAIMED",
    });
    // The whole-ledger count is the one async round trip the port's `count()`
    // makes; assert it is real without pinning a number that other tests move.
    expect(await second.repo.count()).toBeGreaterThanOrEqual(2);
  });
});

/**
 * A LIGHTWEIGHT architecture guard — deliberately NOT a database trigger, a
 * Redis lock or a new service.
 *
 * The lease-timing guarantee holds only while ONE adapter writes this table: it
 * is the only code that stores `now() AT TIME ZONE 'UTC'`. A second writer using
 * a JavaScript `Date` would store local-zone wall clock and silently break every
 * comparison in the ledger. Rather than escalate to infrastructure, this makes an
 * accidental direct write VISIBLE in a failing test. It runs without a database,
 * so it is not gated behind `AI_WORKFORCE_TEST_DATABASE_URL`.
 */
describe("STEP 5A-2 — the claim table has exactly ONE approved writer", () => {
  it("is referenced only by the approved persistence adapter in src/", () => {
    // Exactly ONE file, deliberately. A barrel re-export or a factory would not
    // need to name the delegate anyway, so the list stays as small as the rule.
    const approved = new Set([
      path.join("src", "modules", "workforce", "persistence", "prisma-execution-claim-repository.ts"),
    ]);

    const offenders: string[] = [];
    const walk = (directory: string) => {
      for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        const full = path.join(directory, entry.name);
        if (entry.isDirectory()) {
          walk(full);
          continue;
        }
        if (!/\.(ts|tsx)$/.test(entry.name)) continue;
        const source = fs.readFileSync(full, "utf8");
        if (!source.includes("aiExecutionClaim") && !source.includes("ai_execution_claims")) continue;
        const relative = path.relative(REPO_ROOT, full);
        if (!approved.has(relative)) offenders.push(relative);
      }
    };
    walk(path.join(REPO_ROOT, "src"));

    // A new entry here means a second writer appeared: either route it through
    // `PrismaExecutionClaimRepository`, or explain why this table is now owned
    // by more than one adapter. Never just add it to `approved`.
    expect(offenders).toEqual([]);
  });
});
