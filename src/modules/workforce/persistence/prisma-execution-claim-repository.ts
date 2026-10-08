import type { PrismaClient } from "@prisma/client";

import { AiWorkforceError } from "@/modules/ai-workforce/core/errors";
import type { IdFactory } from "@/modules/ai-workforce/core/types";

import type { TaskId } from "../core/refs";
import {
  attemptIdempotencyMismatch,
  DEFAULT_CLAIM_LEASE_TTL_MS,
  isExecutionClaimState,
  recoveryForClaim,
  type ExecutionClaim,
  type ExecutionClaimOutcome,
  type ExecutionClaimRecovery,
  type ExecutionClaimRepository,
  type ExecutionClaimRequest,
  type ExecutionClaimState,
} from "../execution/execution-claim";

/**
 * The DURABLE execution-claim ledger — `ai_execution_claims`.
 *
 * `InMemoryExecutionClaimRepository` is the REFERENCE for the semantics; this is
 * the adapter that makes them survive the process. It implements the identical
 * port, and — deliberately — calls the identical pure classifier and recovery
 * function (`recoveryForClaim`), so the two cannot drift into two different
 * state machines that only look alike.
 *
 * ── THE ONE THING THAT COULD NOT BE COPIED FROM THE IN-MEMORY VERSION ──
 *
 * The in-memory implementation asks an injected `Clock` whether a lease is
 * still live. In one process that is exactly right: there is one clock. Across
 * instances it is a bug waiting to happen — instance A's `Date.now()` deciding
 * that instance B's perfectly healthy claim has expired is precisely how two
 * runs of the same paid attempt would both start.
 *
 * So THIS adapter has NO clock dependency at all. Every lease value is written
 * as `(now() AT TIME ZONE 'UTC')` and every liveness comparison is made in SQL
 * against the same expression. The database is the only clock, so two skewed
 * instances still agree, and `now() AT TIME ZONE 'UTC'` is used rather than a
 * bare `now()` because the column is a `TIMESTAMP(3)` (no zone): comparing it
 * to a `timestamptz` would silently reinterpret it in the session's zone.
 *
 * `recoveryFor` is not an exception to that rule. PostgreSQL computes
 * `leaseLive` in the SAME query as the row, and the classifier is handed that
 * authoritative boolean, so no JavaScript date arithmetic — and therefore no
 * application clock, skewed or otherwise — participates in a recovery verdict.
 *
 * ── TWO UNIQUE INDEXES GUARD ONE ATTEMPT, AND BOTH CONFLICTS ARE TYPED ──
 *
 *   UNIQUE("idempotencyKey")      a retry of the SAME key resolves to the same row.
 *   UNIQUE("taskId", "attempt")  `taskId + attempt` IS the semantic identity of an
 *                                 execution attempt, so two rows for one attempt are
 *                                 impossible even if a future caller spells the key
 *                                 differently. Correctness does not rest on every
 *                                 caller deriving the identical string.
 *
 * A conflict on EITHER is absorbed, not thrown: the insert uses a bare
 * `ON CONFLICT DO NOTHING` (no target), which covers every unique constraint on the
 * table. When it attracts nothing, the adapter reads the row that blocked it — by
 * KEY first, then by ATTEMPT IDENTITY — and classifies it.
 *
 * A row found by KEY always carries the caller's own key, so it is classified
 * normally. A row found by ATTEMPT IDENTITY under a DIFFERENT key is NOT: the key
 * is only the attempt's spelling, so a disagreement means an upstream derivation
 * has drifted. That case FAILS CLOSED with the typed `ATTEMPT_IDEMPOTENCY_MISMATCH`
 * — no second row, no rewrite of the stored key, no dispatch authority, and no raw
 * uniqueness error. The stored claim is left exactly as it was.
 *
 * If it attracts nothing AND neither lookup finds a row, the conflict must have
 * been the PRIMARY KEY — an id-factory fault. That is reported as a typed
 * `PERSISTENCE_UNAVAILABLE`, never retried away and never left as a Prisma error.
 *
 * ── WHY THERE IS NO TRANSACTION, AND WHY THAT IS SAFER ──
 *
 * The winner of a claim is decided by a UNIQUE index, never by a read-then-write
 * check:
 *
 *   INSERT … ON CONFLICT DO NOTHING RETURNING *   → won
 *   (no row)                                      → someone else did
 *
 * That is ONE statement, so two callers cannot both win, in this process or in
 * any other. Everything after it is either a plain read or a single-statement
 * CAS (`UPDATE … WHERE id = … AND state = <observed>`), so there is no window in
 * which a lock is held across a round trip, no deadlock ordering to reason
 * about, and no long-lived transaction to leak. When a CAS loses, the caller
 * re-reads and classifies again — bounded, because the state can only move
 * forward.
 *
 * ── TYPED OUTCOMES, NEVER RAW ERRORS ──
 *
 * A key clash is not an error here (ON CONFLICT absorbs it). A losing CAS
 * returns `null`, which becomes `IN_PROGRESS`/`REPLAYED`/`UNVERIFIED` rather
 * than an exception. The only things that can escape are a genuine
 * primary-key collision or a database outage, and both are re-thrown as the
 * typed `PERSISTENCE_UNAVAILABLE` — a caller branches on a code, never on a
 * Prisma class name.
 */

/** The client surface this adapter needs: the delegate (schema guard + reads) and raw SQL (DB clock). */
export type ExecutionClaimPrismaClient = Pick<PrismaClient, "aiExecutionClaim" | "$queryRaw">;

/**
 * The row shape this adapter reads. Structural on purpose: Prisma's generated
 * `AiExecutionClaim` type and the raw-SQL result both satisfy it.
 */
type ClaimRow = {
  id: string;
  missionId: string;
  taskId: string;
  attempt: number;
  actorId: string;
  capabilityId: string;
  runtimeId: string | null;
  idempotencyKey: string;
  state: string;
  executionRecordId: string | null;
  handleId: string | null;
  leaseOwner: string | null;
  leaseExpiresAt: Date | null;
  detail: string | null;
  claimedAt: Date;
  updatedAt: Date;
};

/** A row plus the DATABASE's own answers: is the lease live, and what time is it. */
type ClaimRowWithClock = ClaimRow & { leaseLive: boolean; dbNow: Date };

/** Fails closed when the connected database has no claim ledger. */
export function assertExecutionClaimSchema(client: unknown): void {
  const candidate = client as Record<string, unknown>;
  if (!candidate["aiExecutionClaim"]) {
    throw new AiWorkforceError(
      "PERSISTENCE_UNAVAILABLE",
      'Execution claims are not available on the connected database (missing delegate: aiExecutionClaim). Run "prisma generate" and apply the proposed AI_WORKFORCE_PHASE_4 migration locally.',
      { missing: ["aiExecutionClaim"] },
    );
  }
}

/**
 * The recorded reason a `DISPATCHING` attempt became `UNVERIFIED`, and the same
 * text reported on every later read. Written down so the doubt is durable rather
 * than re-inferred — a reviewer should see WHY, not just that.
 */
const UNVERIFIED_DETAIL =
  "dispatch was entered and no durable handle exists; the external run may have started, so this attempt must not be re-dispatched automatically";

/** How many times a losing CAS may re-read before the ledger is declared unusable. */
const MAX_CLASSIFY_ATTEMPTS = 5;

function unknownStateError(row: ClaimRow): AiWorkforceError {
  return new AiWorkforceError(
    "PERSISTENCE_UNAVAILABLE",
    `Execution claim "${row.id}" carries an unknown state "${row.state}"`,
    { claimId: row.id, state: row.state },
  );
}

function toClaim(row: ClaimRow): ExecutionClaim {
  if (!isExecutionClaimState(row.state)) throw unknownStateError(row);
  const claim: ExecutionClaim = {
    id: row.id,
    missionId: row.missionId,
    taskId: row.taskId,
    attempt: row.attempt,
    actorId: row.actorId,
    capabilityId: row.capabilityId,
    idempotencyKey: row.idempotencyKey,
    state: row.state,
    claimedAt: row.claimedAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
  // An absent optional field is OMITTED, never null — the in-memory reference
  // deletes cleared fields, and `exactOptionalPropertyTypes` is on.
  if (row.runtimeId) claim.runtimeId = row.runtimeId;
  if (row.executionRecordId) claim.executionRecordId = row.executionRecordId;
  if (row.handleId) claim.handleId = row.handleId;
  if (row.leaseOwner) claim.leaseOwner = row.leaseOwner;
  if (row.leaseExpiresAt) claim.leaseExpiresAt = row.leaseExpiresAt.toISOString();
  if (row.detail) claim.detail = row.detail;
  return claim;
}

function leaseTtl(ttlMs: number | undefined): number {
  return typeof ttlMs === "number" && Number.isFinite(ttlMs) && ttlMs > 0 ? ttlMs : DEFAULT_CLAIM_LEASE_TTL_MS;
}

export type PrismaExecutionClaimRepositoryOptions = {
  client: ExecutionClaimPrismaClient;
  /**
   * Generates the claim's own primary key and nothing else.
   *
   * There is deliberately NO `now` here. An application clock cannot be given to
   * this adapter because it would have nothing to do: every timestamp in the
   * ledger is produced by the database. That absence is the clock-safety
   * guarantee expressed in the type.
   */
  ids: IdFactory;
};

export class PrismaExecutionClaimRepository implements ExecutionClaimRepository {
  constructor(private readonly options: PrismaExecutionClaimRepositoryOptions) {
    assertExecutionClaimSchema(options.client);
  }

  async claim(request: ExecutionClaimRequest): Promise<ExecutionClaimOutcome> {
    const ttlMs = leaseTtl(request.leaseTtlMs);
    for (let pass = 0; pass < MAX_CLASSIFY_ATTEMPTS; pass += 1) {
      const outcome = await this.claimOnce(request, ttlMs);
      if (outcome !== null) return outcome;
      // `null` means a CAS lost or the row moved under us. Re-read, classify
      // again. The state only moves forward, so this terminates in practice.
    }
    throw new AiWorkforceError(
      "PERSISTENCE_UNAVAILABLE",
      `Execution claim for "${request.idempotencyKey}" could not be resolved after ${MAX_CLASSIFY_ATTEMPTS} attempts`,
      { idempotencyKey: request.idempotencyKey },
    );
  }

  /** One classify pass. `null` = "re-read and try again". */
  private async claimOnce(
    request: ExecutionClaimRequest,
    ttlMs: number,
  ): Promise<ExecutionClaimOutcome | null> {
    // ── 1. Try to WIN the attempt. The UNIQUE INDEXES decide, not a read.
    const inserted = await this.insertFresh(request, ttlMs);
    if (inserted) return { kind: "CLAIMED", claim: inserted };

    // ── 2. Read what blocked it, with the DATABASE's clock for lease liveness.
    //       BY KEY FIRST: the key the caller supplied is what they are claiming,
    //       so a row holding it is the authority for this caller.
    //       THEN BY ATTEMPT IDENTITY: the only other reason the insert attracted
    //       nothing is that `(taskId, attempt)` is already taken — the attempt
    //       exists under a differently-spelled key. The ATTEMPT governs, so that
    //       row is CLASSIFIED rather than a second one created.
    const byKey = await this.readByKeyWithClock(request.idempotencyKey);
    const row = byKey ?? (await this.readByAttemptWithClock(request.taskId, request.attempt));
    if (!row) {
      // The insert attracted nothing, yet NEITHER the key NOR the attempt has a
      // row. A bare `ON CONFLICT` absorbs every unique constraint on the table,
      // so the only third constraint it can have absorbed is the PRIMARY KEY: a
      // duplicate id from the id factory. That is a ledger fault, not a domain
      // conflict. Surface it as a typed failure rather than minting another id
      // and retrying — retrying would HIDE the bug, and spinning on a broken id
      // factory is exactly the kind of silent misbehaviour this module removes.
      throw new AiWorkforceError(
        "PERSISTENCE_UNAVAILABLE",
        `The execution claim ledger attracted no row for "${request.idempotencyKey}" and holds none for task ${request.taskId} attempt ${request.attempt}`,
        { idempotencyKey: request.idempotencyKey, taskId: request.taskId, attempt: request.attempt },
      );
    }
    // FOUND BY ATTEMPT IDENTITY, DIFFERENT KEY → an upstream invariant has
    // drifted. Refuse BEFORE classifying: classification would imply the caller
    // holds this attempt, or hand them its authority. The row is untouched.
    if (byKey === null && row.idempotencyKey !== request.idempotencyKey) {
      throw attemptIdempotencyMismatch(request, toClaim(row));
    }

    if (!isExecutionClaimState(row.state)) throw unknownStateError(row);
    const state = row.state;

    // ── 3. Classify. An execution that exists is adopted; an entered attempt
    //       with no handle is a doubt; only an un-entered attempt is free.
    if (state === "DISPATCHED") return { kind: "REPLAYED", claim: toClaim(row) };
    if (state === "UNVERIFIED") {
      return { kind: "UNVERIFIED", claim: toClaim(row), detail: row.detail ?? UNVERIFIED_DETAIL };
    }

    const mine = row.leaseOwner !== null && row.leaseOwner === request.leaseOwner;
    const live = row.leaseLive === true;

    if (state === "DISPATCHING") {
      if (live && !mine) return { kind: "IN_PROGRESS", claim: toClaim(row) };
      // The corrected branch. There is NO path from here to a re-dispatch: a
      // `DISPATCHING` attempt is promoted to UNVERIFIED so the doubt is durable.
      const promoted = await this.markUnverified(row.id, UNVERIFIED_DETAIL);
      if (!promoted) return null;
      return { kind: "UNVERIFIED", claim: promoted, detail: promoted.detail ?? UNVERIFIED_DETAIL };
    }

    // CLAIMED / RELEASED — dispatch was never entered.
    if (state === "CLAIMED" && live && !mine) return { kind: "IN_PROGRESS", claim: toClaim(row) };
    const reclaimedFrom: ExecutionClaimState = state;
    const reclaimed = await this.reclaim(row.id, reclaimedFrom, request.leaseOwner, ttlMs);
    if (!reclaimed) return null;
    return { kind: "RECLAIMED", claim: reclaimed, reclaimedFrom };
  }

  async get(id: string): Promise<ExecutionClaim | null> {
    const row = await this.options.client.aiExecutionClaim.findUnique({ where: { id } });
    return row ? toClaim(row) : null;
  }

  async findByKey(idempotencyKey: string): Promise<ExecutionClaim | null> {
    const row = await this.options.client.aiExecutionClaim.findUnique({ where: { idempotencyKey } });
    return row ? toClaim(row) : null;
  }

  async listForTask(taskId: TaskId): Promise<ExecutionClaim[]> {
    const rows = await this.options.client.aiExecutionClaim.findMany({
      where: { taskId },
      orderBy: [{ attempt: "asc" }, { claimedAt: "asc" }],
    });
    return rows.map(toClaim);
  }

  async markDispatching(
    claimId: string,
    input: { leaseOwner: string; leaseTtlMs?: number },
  ): Promise<ExecutionClaim | null> {
    const ttlMs = leaseTtl(input.leaseTtlMs);
    const rows = await this.options.client.$queryRaw<ClaimRow[]>`
      UPDATE ai_execution_claims
      SET "state" = 'DISPATCHING',
          "leaseOwner" = ${input.leaseOwner},
          "leaseExpiresAt" = ((now() AT TIME ZONE 'UTC') + (${ttlMs}::double precision * interval '1 millisecond')),
          "updatedAt" = (now() AT TIME ZONE 'UTC')
      WHERE "id" = ${claimId}
        AND "state" = 'CLAIMED'
        AND ("leaseOwner" IS NULL OR "leaseOwner" = ${input.leaseOwner})
      RETURNING *
    `;
    return rows[0] ? toClaim(rows[0]) : null;
  }

  async markDispatched(
    claimId: string,
    input: { executionRecordId: string; handleId: string; runtimeId?: string },
  ): Promise<ExecutionClaim | null> {
    const rows = await this.options.client.$queryRaw<ClaimRow[]>`
      UPDATE ai_execution_claims
      SET "state" = 'DISPATCHED',
          "executionRecordId" = ${input.executionRecordId},
          "handleId" = ${input.handleId},
          "runtimeId" = COALESCE(${input.runtimeId ?? null}, "runtimeId"),
          "updatedAt" = (now() AT TIME ZONE 'UTC')
      WHERE "id" = ${claimId} AND "state" = 'DISPATCHING'
      RETURNING *
    `;
    return rows[0] ? toClaim(rows[0]) : null;
  }

  async release(claimId: string, detail: string): Promise<ExecutionClaim | null> {
    const rows = await this.options.client.$queryRaw<ClaimRow[]>`
      UPDATE ai_execution_claims
      SET "state" = 'RELEASED',
          "detail" = ${detail},
          "leaseOwner" = NULL,
          "leaseExpiresAt" = NULL,
          "updatedAt" = (now() AT TIME ZONE 'UTC')
      WHERE "id" = ${claimId} AND "state" = 'CLAIMED'
      RETURNING *
    `;
    return rows[0] ? toClaim(rows[0]) : null;
  }

  async markUnverified(claimId: string, detail: string): Promise<ExecutionClaim | null> {
    const rows = await this.options.client.$queryRaw<ClaimRow[]>`
      UPDATE ai_execution_claims
      SET "state" = 'UNVERIFIED',
          "detail" = ${detail},
          "leaseOwner" = NULL,
          "leaseExpiresAt" = NULL,
          "updatedAt" = (now() AT TIME ZONE 'UTC')
      WHERE "id" = ${claimId} AND "state" = 'DISPATCHING'
      RETURNING *
    `;
    return rows[0] ? toClaim(rows[0]) : null;
  }

  async recoveryFor(
    claimId: string,
    options: { requester?: string } = {},
  ): Promise<ExecutionClaimRecovery | null> {
    const row = await this.readByIdWithClock(claimId);
    if (!row) return null;
    // The SAME pure classifier the in-memory ledger uses — but fed the DATABASE's
    // own verdict. `leaseLive` was computed by PostgreSQL in the same query as the
    // row, and the classifier PREFERS it over any date arithmetic, so this verdict
    // is the one every instance would reach regardless of its clock.
    return recoveryForClaim(toClaim(row), {
      now: row.dbNow,
      leaseIsLive: row.leaseLive,
      ...(options.requester ? { requester: options.requester } : {}),
    });
  }

  async count(): Promise<number> {
    return this.options.client.aiExecutionClaim.count();
  }

  /* ── The write paths, each ONE statement ── */

  private async insertFresh(
    request: ExecutionClaimRequest,
    ttlMs: number,
  ): Promise<ExecutionClaim | null> {
    const id = this.options.ids.next("claim");
    let rows: ClaimRow[];
    try {
      rows = await this.options.client.$queryRaw<ClaimRow[]>`
        INSERT INTO ai_execution_claims
          ("id", "missionId", "taskId", "attempt", "actorId", "capabilityId", "runtimeId",
           "idempotencyKey", "state", "leaseOwner", "leaseExpiresAt", "claimedAt", "updatedAt")
        VALUES
          (${id}, ${request.missionId}, ${request.taskId}, ${request.attempt},
           ${request.actorId}, ${request.capabilityId}, ${request.runtimeId ?? null},
           ${request.idempotencyKey}, 'CLAIMED', ${request.leaseOwner},
           ((now() AT TIME ZONE 'UTC') + (${ttlMs}::double precision * interval '1 millisecond')),
           (now() AT TIME ZONE 'UTC'), (now() AT TIME ZONE 'UTC'))
        ON CONFLICT DO NOTHING
        RETURNING *
      `;
    } catch (error) {
      // BOTH unique-constraint clashes are absorbed by the bare ON CONFLICT, so
      // anything thrown here is a primary-key collision (an id-factory bug) or a
      // database outage. Both are PERSISTENCE_UNAVAILABLE — a typed code, never a
      // leaked Prisma error.
      throw new AiWorkforceError(
        "PERSISTENCE_UNAVAILABLE",
        `Could not write the execution claim for "${request.idempotencyKey}"`,
        {
          idempotencyKey: request.idempotencyKey,
          cause: error instanceof Error ? error.message : String(error),
        },
      );
    }
    return rows[0] ? toClaim(rows[0]) : null;
  }

  /** CAS: `CLAIMED`/`RELEASED` → a fresh `CLAIMED` lease. Only if the state still matches. */
  private async reclaim(
    claimId: string,
    expectedState: ExecutionClaimState,
    leaseOwner: string,
    ttlMs: number,
  ): Promise<ExecutionClaim | null> {
    const rows = await this.options.client.$queryRaw<ClaimRow[]>`
      UPDATE ai_execution_claims
      SET "state" = 'CLAIMED',
          "leaseOwner" = ${leaseOwner},
          "leaseExpiresAt" = ((now() AT TIME ZONE 'UTC') + (${ttlMs}::double precision * interval '1 millisecond')),
          "detail" = NULL,
          "updatedAt" = (now() AT TIME ZONE 'UTC')
      WHERE "id" = ${claimId} AND "state" = ${expectedState}
      RETURNING *
    `;
    return rows[0] ? toClaim(rows[0]) : null;
  }

  private async readByKeyWithClock(idempotencyKey: string): Promise<ClaimRowWithClock | null> {
    const rows = await this.options.client.$queryRaw<ClaimRowWithClock[]>`
      SELECT c.*,
             (c."leaseExpiresAt" IS NOT NULL AND c."leaseExpiresAt" > (now() AT TIME ZONE 'UTC')) AS "leaseLive",
             (now() AT TIME ZONE 'UTC') AS "dbNow"
      FROM ai_execution_claims c
      WHERE c."idempotencyKey" = ${idempotencyKey}
      LIMIT 1
    `;
    return rows[0] ?? null;
  }

  private async readByAttemptWithClock(taskId: string, attempt: number): Promise<ClaimRowWithClock | null> {
    const rows = await this.options.client.$queryRaw<ClaimRowWithClock[]>`
      SELECT c.*,
             (c."leaseExpiresAt" IS NOT NULL AND c."leaseExpiresAt" > (now() AT TIME ZONE 'UTC')) AS "leaseLive",
             (now() AT TIME ZONE 'UTC') AS "dbNow"
      FROM ai_execution_claims c
      WHERE c."taskId" = ${taskId} AND c."attempt" = ${attempt}
      LIMIT 1
    `;
    return rows[0] ?? null;
  }

  private async readByIdWithClock(id: string): Promise<ClaimRowWithClock | null> {
    const rows = await this.options.client.$queryRaw<ClaimRowWithClock[]>`
      SELECT c.*,
             (c."leaseExpiresAt" IS NOT NULL AND c."leaseExpiresAt" > (now() AT TIME ZONE 'UTC')) AS "leaseLive",
             (now() AT TIME ZONE 'UTC') AS "dbNow"
      FROM ai_execution_claims c
      WHERE c."id" = ${id}
      LIMIT 1
    `;
    return rows[0] ?? null;
  }
}
