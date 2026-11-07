import type { PrismaClient } from "@prisma/client";

import { AiWorkforceError } from "@/modules/ai-workforce/core/errors";
import type { IdFactory } from "@/modules/ai-workforce/core/types";

import type { TaskId } from "../core/refs";
import {
  ALREADY_UNVERIFIED_DETAIL,
  attemptIdempotencyMismatch,
  DEFAULT_CLAIM_LEASE_TTL_MS,
  isExecutionClaimState,
  recoveryForClaim,
  type ExecutionClaim,
  type ExecutionClaimOutcome,
  type ExecutionClaimRecovery,
  type ExecutionClaimRepository,
  type ExecutionClaimRequest,
  type ExecutionClaimReservation,
  type ExecutionClaimReservationRequest,
  type ExecutionClaimState,
  type ExecutionClaimSweepLane,
  type ExecutionClaimSweepQuery,
} from "../execution/execution-claim";
import { DISPATCHING_DOUBT_DETAIL } from "../execution/execution-claim";
import { assertReceiptDetail, detailWithDoubt } from "../execution/execution-claim-receipt";

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
export type ClaimRow = {
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
  /** The rotation key (`markRecoverySwept`); NULL = a sweep has never looked. */
  recoverySweptAt: Date | null;
};

/** A row plus the DATABASE's own answers: is the lease live, and what time is it. */
export type ClaimRowWithClock = ClaimRow & { leaseLive: boolean; dbNow: Date };

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
/**
 * The recorded reason a `DISPATCHING` attempt became `UNVERIFIED`.
 *
 * It is the SAME sentence the in-memory reference writes (imported, not
 * re-typed), so the two ledgers cannot drift into two different audits.
 */
const UNVERIFIED_DETAIL = DISPATCHING_DOUBT_DETAIL;

/** How many times a losing CAS may re-read before the ledger is declared unusable. */
const MAX_CLASSIFY_ATTEMPTS = 5;

/**
 * Is this a Postgres UNIQUE-VIOLATION (SQLSTATE 23505) reaching us through
 * Prisma's raw-query wrapper?
 *
 * It exists for exactly one caller: the cancellation reservation names a single
 * conflict target, and a clash on the table's OTHER unique index is a legitimate
 * "nothing landed" signal rather than an outage. Prisma surfaces the SQLSTATE
 * inside the message and, when present, `meta.code`; both spellings are checked so
 * a Prisma upgrade that fills in `meta` cannot silently turn the signal into a
 * thrown PERSISTENCE_UNAVAILABLE.
 */
function isUniqueViolation(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const meta = (error as { meta?: unknown }).meta;
  if (typeof meta === "object" && meta !== null) {
    const code = (meta as { code?: unknown }).code;
    if (code === "23505" || code === 23505) return true;
  }
  const message = (error as { message?: unknown }).message;
  return typeof message === "string" && /Code: `23505`|"code":\s*"23505"/.test(message);
}

function unknownStateError(row: ClaimRow): AiWorkforceError {
  return new AiWorkforceError(
    "PERSISTENCE_UNAVAILABLE",
    `Execution claim "${row.id}" carries an unknown state "${row.state}"`,
    { claimId: row.id, state: row.state },
  );
}

export function toClaim(row: ClaimRow): ExecutionClaim {
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
  // Absent means NULL, which is a real state (never swept), so it is mapped as an
  // absence rather than an empty string.
  if (row.recoverySweptAt) claim.recoverySweptAt = row.recoverySweptAt.toISOString();
  return claim;
}

function leaseTtl(ttlMs: number | undefined): number {
  return typeof ttlMs === "number" && Number.isFinite(ttlMs) && ttlMs > 0 ? ttlMs : DEFAULT_CLAIM_LEASE_TTL_MS;
}

/**
 * `DISPATCHING → DISPATCHED`, executable against ANY client — including the
 * transaction client the atomic execution finalizer supplies.
 *
 * It lives HERE, in the ONE approved writer for `ai_execution_claims`, on
 * purpose: a repository-suite architecture guard fails if any other file in
 * `src/` names the table, precisely so a second, subtly different copy of the
 * database-clock and lease predicates cannot appear. The finalizer therefore
 * supplies a TRANSACTION and calls this, instead of carrying its own SQL.
 *
 * The CAS conditions are the whole point: the state must still be `DISPATCHING`
 * and the lease must still be owned by THIS invocation, or the write does not
 * land and the caller's transaction rolls back.
 */
export async function updateClaimDispatched(
  client: ExecutionClaimPrismaClient,
  claimId: string,
  input: { invocationToken: string; executionRecordId: string; handleId: string; runtimeId?: string },
): Promise<ExecutionClaim | null> {
  const rows = await client.$queryRaw<ClaimRow[]>`
    UPDATE ai_execution_claims
    SET "state" = 'DISPATCHED',
        "executionRecordId" = ${input.executionRecordId},
        "handleId" = ${input.handleId},
        "runtimeId" = COALESCE(${input.runtimeId ?? null}, "runtimeId"),
        "updatedAt" = (now() AT TIME ZONE 'UTC')
    WHERE "id" = ${claimId}
      AND "state" = 'DISPATCHING'
      AND "leaseOwner" = ${input.invocationToken}
    RETURNING *
  `;
  return rows[0] ? toClaim(rows[0]) : null;
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
    if (state === "CANCELLED") return { kind: "CANCELLED", claim: toClaim(row) };
    if (state === "UNVERIFIED") {
      return { kind: "UNVERIFIED", claim: toClaim(row), detail: row.detail ?? UNVERIFIED_DETAIL };
    }

    const live = row.leaseLive === true;

    if (state === "DISPATCHING") {
      // LIVE IS LIVE FOR EVERYONE, including the token that wrote it. The old
      // `&& !mine` half let an owner's own re-read demote its healthy attempt to
      // UNVERIFIED, after which it could no longer record the handle it was
      // about to receive.
      if (live) return { kind: "IN_PROGRESS", claim: toClaim(row) };
      // The corrected branch. There is NO path from here to a re-dispatch: a
      // `DISPATCHING` attempt is promoted to UNVERIFIED so the doubt is durable.
      // The promotion is CAS-guarded (`state = 'DISPATCHING'`), so if another
      // process simultaneously recorded the handle, this call loses instead of
      // overwriting a real execution identity with a doubt.
      const promoted = await this.markUnverified(row.id, UNVERIFIED_DETAIL);
      if (!promoted) return null;
      return { kind: "UNVERIFIED", claim: promoted, detail: promoted.detail ?? UNVERIFIED_DETAIL };
    }

    // CLAIMED / RELEASED — dispatch was never entered. A live claim parks every
    // caller, whatever token it presents: "same owner" is NOT a second authority.
    if (state === "CLAIMED" && live) return { kind: "IN_PROGRESS", claim: toClaim(row) };
    const reclaimedFrom: ExecutionClaimState = state;
    // ATOMIC, in ONE statement: DATABASE time plus an EXPIRED-LEASE predicate.
    // The previous version read the row and then updated it unconditionally on
    // state, which could steal a lease that had just been RENEWED by its owner
    // between the read and the write.
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

  async listDispatching(limit = 50): Promise<ExecutionClaim[]> {
    const rows = await this.options.client.aiExecutionClaim.findMany({
      where: { state: "DISPATCHING" },
      orderBy: [{ claimedAt: "asc" }, { id: "asc" }],
      take: limit,
    });
    return rows.map(toClaim);
  }

  /**
   * The unresolved sweep — MISSION-SCOPED, LANE-SCOPED and PAGE-BOUNDED, all
   * decided by SQL.
   *
   * The mission filter is inside the WHERE clause, so it applies BEFORE `LIMIT`.
   * That ordering is the whole correction: filtering in the caller (which is what
   * this used to do) reads a global first page and then discards most of it, so a
   * mission's own incident is invisible whenever enough other missions'
   * incidents sort ahead of it.
   *
   * There is NO cursor parameter, and that absence is the fifth-review correction.
   * A keyset cursor has to be STORED somewhere to give a sweep progress, and the
   * only place it was stored was process memory: every restart (and every mission
   * beyond the 64-scope LRU) began again at the oldest end. The traversal here is a
   * queue position that lives in the ROWS THEMSELVES — `recoverySweptAt` — so the
   * progress is durable, shared by every instance, and free of any wrap/generation
   * bookkeeping that a stale sweep could clear.
   *
   * A `lane`, when given, is the SIXTH-review correction and it is deliberately a
   * separate STATEMENT per lane rather than an interpolated `ORDER BY`: the lane
   * decides membership with a WHERE predicate (`"recoverySweptAt" IS NULL` versus
   * `IS NOT NULL`) as well as direction, which is what gives the revisit window an
   * allocation that arriving (never-observed) rows cannot consume. Membership by
   * predicate is the property; a page size alone could never provide it.
   *
   * The direction is a closed choice, not a value: rather than interpolate SQL
   * text, each lane and each order gets its own fully static statement.
   */
  async listUnresolved(query: ExecutionClaimSweepQuery = {}): Promise<ExecutionClaim[]> {
    const { limit = 50, missionId = null, order = "OLDEST_FIRST", lane } = query;

    // ── THE LANES (Step 5A-4, sixth review; corrected by the seventh and ninth) ──
    //
    // Three windows, but NOT three disjoint sets. Membership is decided by the
    // PREDICATE — not the order — and TWO of the three read the SAME rows from
    // opposite ends: `NEVER_OBSERVED` and `NEVER_OBSERVED_NEWEST` are the same
    // unseen SET, and the sweep's `seen` guard deduplicates the overlap (see the
    // claim type and the reconciler). Only `PREVIOUSLY_OBSERVED` is disjoint from
    // the other two.
    //
    // A sweep reads one bounded window of each, so a steady arrival of
    // never-observed rows can delay the unseen queue (a bound that grows with the
    // backlog, and `NEVER_OBSERVED_NEWEST` keeps the newest of them visible) but
    // can never take a single row of the revisit window's allocation.
    if (lane) return this.listLane(lane, limit, missionId);

    // LEAST RECENTLY SWEPT FIRST — the DURABLE ROTATION the recovery sweep reads.
    //
    // `NULLS FIRST` is what makes a NEVER-SWEPT row the most urgent thing in the
    // queue whatever its age, and `recoverySweptAt ASC` after it is what makes the
    // queue ADVANCE: a sweep stamps every row it looks at with the database's own
    // clock, so a stamped row necessarily sorts behind everything not yet stamped.
    // Both spellings match `compareByRecoveryRotation` in the claim module, which
    // is the rule the in-memory reference sorts by and the one the paging tests
    // assert the two agree on.
    if (order === "LEAST_RECENTLY_SWEPT_FIRST") {
      const rows = await this.options.client.$queryRaw<ClaimRow[]>`
        SELECT c.*,
               (c."leaseExpiresAt" IS NOT NULL AND c."leaseExpiresAt" > (now() AT TIME ZONE 'UTC')) AS "leaseLive",
               (now() AT TIME ZONE 'UTC') AS "dbNow"
        FROM ai_execution_claims c
        WHERE (
                c."state" = 'DISPATCHING'
                OR c."state" = 'UNVERIFIED'
                OR (c."state" = 'DISPATCHED' AND c."executionRecordId" IS NULL)
              )
          AND (${missionId}::text IS NULL OR c."missionId" = ${missionId})
        ORDER BY c."recoverySweptAt" ASC NULLS FIRST, c."claimedAt" ASC, c."id" ASC
        LIMIT ${limit}
      `;
      return rows.map(toClaim);
    }

    // OLDEST FIRST — the operator-facing read: the work that has waited longest.
    if (order === "OLDEST_FIRST") {
      const rows = await this.options.client.$queryRaw<ClaimRow[]>`
        SELECT c.*,
               (c."leaseExpiresAt" IS NOT NULL AND c."leaseExpiresAt" > (now() AT TIME ZONE 'UTC')) AS "leaseLive",
               (now() AT TIME ZONE 'UTC') AS "dbNow"
        FROM ai_execution_claims c
        WHERE (
                c."state" = 'DISPATCHING'
                OR c."state" = 'UNVERIFIED'
                OR (c."state" = 'DISPATCHED' AND c."executionRecordId" IS NULL)
              )
          AND (${missionId}::text IS NULL OR c."missionId" = ${missionId})
        ORDER BY c."claimedAt" ASC, c."id" ASC
        LIMIT ${limit}
      `;
      return rows.map(toClaim);
    }

    // NEWEST FIRST — the bounded fairness probe: a backlog of permanent incidents
    // must never hide a fresh one. Same statement, mirrored.
    const rows = await this.options.client.$queryRaw<ClaimRow[]>`
      SELECT c.*,
             (c."leaseExpiresAt" IS NOT NULL AND c."leaseExpiresAt" > (now() AT TIME ZONE 'UTC')) AS "leaseLive",
             (now() AT TIME ZONE 'UTC') AS "dbNow"
      FROM ai_execution_claims c
      WHERE (
              c."state" = 'DISPATCHING'
              OR c."state" = 'UNVERIFIED'
              OR (c."state" = 'DISPATCHED' AND c."executionRecordId" IS NULL)
            )
        AND (${missionId}::text IS NULL OR c."missionId" = ${missionId})
      ORDER BY c."claimedAt" DESC, c."id" DESC
      LIMIT ${limit}
    `;
    return rows.map(toClaim);
  }

  /**
   * ONE LANE, as its own fully static statement.
   *
   * Every lane shares the SAME eligibility predicate and the SAME optional mission
   * filter as the merged read above — a lane is an ADDITIONAL constraint, never a
   * different definition of "unresolved". What each one adds is the stamp predicate
   * that decides whether a row has been observed, plus the direction in which that
   * window is read:
   *
   *   NEVER_OBSERVED        IS NULL,     `claimedAt ASC, id ASC`   — FIFO service.
   *   NEVER_OBSERVED_NEWEST IS NULL,     `claimedAt DESC, id DESC` — freshness.
   *   PREVIOUSLY_OBSERVED   IS NOT NULL, `recoverySweptAt ASC, claimedAt ASC, id ASC`
   *                                                        — the REVISIT rotation.
   *
   * The `PREVIOUSLY_OBSERVED` order has no `NULLS FIRST` clause because a NULL
   * stamp cannot satisfy its WHERE clause: the round-robin is over rows every one
   * of which already carries a stamp, and each sweep's stamps send what it looked
   * at to the back of that lane (the `recoverySweptAt ASC` clause, read with the
   * database's own clock).
   */
  private async listLane(
    lane: ExecutionClaimSweepLane,
    limit: number,
    missionId: string | null,
  ): Promise<ExecutionClaim[]> {
    if (lane === "PREVIOUSLY_OBSERVED") {
      const rows = await this.options.client.$queryRaw<ClaimRow[]>`
        SELECT c.*,
               (c."leaseExpiresAt" IS NOT NULL AND c."leaseExpiresAt" > (now() AT TIME ZONE 'UTC')) AS "leaseLive",
               (now() AT TIME ZONE 'UTC') AS "dbNow"
        FROM ai_execution_claims c
        WHERE (
                c."state" = 'DISPATCHING'
                OR c."state" = 'UNVERIFIED'
                OR (c."state" = 'DISPATCHED' AND c."executionRecordId" IS NULL)
              )
          AND c."recoverySweptAt" IS NOT NULL
          AND (${missionId}::text IS NULL OR c."missionId" = ${missionId})
        ORDER BY c."recoverySweptAt" ASC, c."claimedAt" ASC, c."id" ASC
        LIMIT ${limit}
      `;
      return rows.map(toClaim);
    }

    if (lane === "NEVER_OBSERVED") {
      const rows = await this.options.client.$queryRaw<ClaimRow[]>`
        SELECT c.*,
               (c."leaseExpiresAt" IS NOT NULL AND c."leaseExpiresAt" > (now() AT TIME ZONE 'UTC')) AS "leaseLive",
               (now() AT TIME ZONE 'UTC') AS "dbNow"
        FROM ai_execution_claims c
        WHERE (
                c."state" = 'DISPATCHING'
                OR c."state" = 'UNVERIFIED'
                OR (c."state" = 'DISPATCHED' AND c."executionRecordId" IS NULL)
              )
          AND c."recoverySweptAt" IS NULL
          AND (${missionId}::text IS NULL OR c."missionId" = ${missionId})
        ORDER BY c."claimedAt" ASC, c."id" ASC
        LIMIT ${limit}
      `;
      return rows.map(toClaim);
    }

    // NEVER_OBSERVED_NEWEST — the bounded freshness window: the same unseen SET as
    // the lane above, read from the other end, so a brand-new incident is visible on
    // the next sweep instead of after the whole unseen backlog has drained.
    const rows = await this.options.client.$queryRaw<ClaimRow[]>`
      SELECT c.*,
             (c."leaseExpiresAt" IS NOT NULL AND c."leaseExpiresAt" > (now() AT TIME ZONE 'UTC')) AS "leaseLive",
             (now() AT TIME ZONE 'UTC') AS "dbNow"
      FROM ai_execution_claims c
      WHERE (
              c."state" = 'DISPATCHING'
              OR c."state" = 'UNVERIFIED'
              OR (c."state" = 'DISPATCHED' AND c."executionRecordId" IS NULL)
            )
        AND c."recoverySweptAt" IS NULL
        AND (${missionId}::text IS NULL OR c."missionId" = ${missionId})
      ORDER BY c."claimedAt" DESC, c."id" DESC
      LIMIT ${limit}
    `;
    return rows.map(toClaim);
  }

  /**
   * `CLAIMED → DISPATCHING`, in ONE statement, with all three conditions the
   * port documents: expected state, the EXACT invocation token, and a lease that
   * is STILL LIVE according to the database's own clock.
   *
   * The `leaseExpiresAt > (now() AT TIME ZONE 'UTC')` predicate is the fix for
   * the verified defect where `markDispatching` accepted an already-expired
   * lease: an invocation that stalled past its window could enter dispatch on an
   * attempt another caller was entitled to reclaim, so TWO dispatches could be
   * authorised for one attempt. The database decides liveness here too — no
   * application clock participates.
   */
  async markDispatching(
    claimId: string,
    input: { invocationToken: string; leaseTtlMs?: number; receiptDetail?: string },
  ): Promise<ExecutionClaim | null> {
    const ttlMs = leaseTtl(input.leaseTtlMs);
    // Fail closed on a detail that cannot carry the receipt through a later
    // transition, rather than writing audit evidence that will be dropped.
    if (input.receiptDetail !== undefined) assertReceiptDetail(input.receiptDetail);
    const receipt = input.receiptDetail ?? null;
    const rows = await this.options.client.$queryRaw<ClaimRow[]>`
      UPDATE ai_execution_claims
      SET "state" = 'DISPATCHING',
          "leaseOwner" = ${input.invocationToken},
          "leaseExpiresAt" = ((now() AT TIME ZONE 'UTC') + (${ttlMs}::double precision * interval '1 millisecond')),
          "detail" = COALESCE(${receipt}, "detail"),
          "updatedAt" = (now() AT TIME ZONE 'UTC')
      WHERE "id" = ${claimId}
        AND "state" = 'CLAIMED'
        AND "leaseOwner" = ${input.invocationToken}
        AND "leaseExpiresAt" IS NOT NULL
        AND "leaseExpiresAt" > (now() AT TIME ZONE 'UTC')
      RETURNING *
    `;
    return rows[0] ? toClaim(rows[0]) : null;
  }

  /**
   * `DISPATCHING → DISPATCHED` — the owning invocation token, and nothing else.
   *
   * The `detail` is deliberately NOT touched: the preflight receipt committed at
   * the `DISPATCHING` boundary must survive this transition byte-for-byte.
   */
  async markDispatched(
    claimId: string,
    input: { invocationToken: string; executionRecordId: string; handleId: string; runtimeId?: string },
  ): Promise<ExecutionClaim | null> {
    return updateClaimDispatched(this.options.client, claimId, input);
  }

  /** `CLAIMED → RELEASED`, by the owning invocation token only. */
  async release(claimId: string, input: { invocationToken: string; detail: string }): Promise<ExecutionClaim | null> {
    const rows = await this.options.client.$queryRaw<ClaimRow[]>`
      UPDATE ai_execution_claims
      SET "state" = 'RELEASED',
          "detail" = ${input.detail},
          "leaseOwner" = NULL,
          "leaseExpiresAt" = NULL,
          "updatedAt" = (now() AT TIME ZONE 'UTC')
      WHERE "id" = ${claimId}
        AND "state" = 'CLAIMED'
        AND "leaseOwner" = ${input.invocationToken}
      RETURNING *
    `;
    return rows[0] ? toClaim(rows[0]) : null;
  }

  /** `CLAIMED → CANCELLED`, by the owning invocation token only. Terminal. */
  async markCancelled(claimId: string, input: { invocationToken: string; detail: string }): Promise<ExecutionClaim | null> {
    const rows = await this.options.client.$queryRaw<ClaimRow[]>`
      UPDATE ai_execution_claims
      SET "state" = 'CANCELLED',
          "detail" = ${input.detail},
          "leaseOwner" = NULL,
          "leaseExpiresAt" = NULL,
          "updatedAt" = (now() AT TIME ZONE 'UTC')
      WHERE "id" = ${claimId}
        AND "state" = 'CLAIMED'
        AND "leaseOwner" = ${input.invocationToken}
      RETURNING *
    `;
    return rows[0] ? toClaim(rows[0]) : null;
  }

  /**
   * `DISPATCHING → UNVERIFIED`. The doubt is ADDED to any preflight receipt
   * already on the row, never written over it.
   *
   * The read is only there to fetch the existing detail so the receipt can be
   * carried through; the WRITE is still a CAS on `state = 'DISPATCHING'`, so if
   * another process recorded the handle in between, this call loses rather than
   * demoting a real execution identity to a doubt.
   */
  async markUnverified(claimId: string, detail: string): Promise<ExecutionClaim | null> {
    const existing = await this.options.client.aiExecutionClaim.findUnique({ where: { id: claimId } });
    const nextDetail = detailWithDoubt(existing?.detail ?? null, detail);
    const rows = await this.options.client.$queryRaw<ClaimRow[]>`
      UPDATE ai_execution_claims
      SET "state" = 'UNVERIFIED',
          "detail" = ${nextDetail},
          "leaseOwner" = NULL,
          "leaseExpiresAt" = NULL,
          "updatedAt" = (now() AT TIME ZONE 'UTC')
      WHERE "id" = ${claimId} AND "state" = 'DISPATCHING'
      RETURNING *
    `;
    return rows[0] ? toClaim(rows[0]) : null;
  }

  /**
   * Stamps the ROTATION KEY, and nothing else.
   *
   * One statement, one column: no conditional `WHERE` beyond the id, because this
   * is not a state transition and must succeed for EVERY state (a sweep has to be
   * able to move the queue past a row it is forbidden to change), and because two
   * sweeps racing on the same row may both stamp it — the later stamp simply wins,
   * which is the same answer either order would produce.
   *
   * The timestamp is the DATABASE's clock, like every other write in this ledger,
   * so two instances cannot disagree about the order of the queue. `updatedAt` and
   * every semantic field are left untouched: a sweep is an observation, not an
   * activity.
   */
  async markRecoverySwept(claimId: string): Promise<ExecutionClaim | null> {
    const rows = await this.options.client.$queryRaw<ClaimRow[]>`
      UPDATE ai_execution_claims
      SET "recoverySweptAt" = (now() AT TIME ZONE 'UTC')
      WHERE "id" = ${claimId}
      RETURNING *
    `;
    return rows[0] ? toClaim(rows[0]) : null;
  }

  /**
   * ATOMICALLY reserves the exact attempt as `CANCELLED` — ONE statement.
   *
   * A fresh INSERT lands `CANCELLED` directly, and the `ON CONFLICT DO UPDATE`
   * with its state predicate flips a reclaimable (`CLAIMED` with a lapsed lease,
   * or `RELEASED`) row in the same write. There is therefore NO intermediate
   * `CLAIMED` row for a crash to strand — which is the whole defect the old
   * two-write `claim()` + `markCancelled()` sequence had, because a stranded
   * `CLAIMED` row becomes reclaimable once its lease lapses, letting a racing
   * `execute()` dispatch the attempt that was just cancelled.
   *
   * The `WHERE` on the conflicting row also requires the SAME attempt identity
   * and the SAME key, so a row held under a different key is never overwritten: it
   * is reported as `CONFLICT` after the classify pass, exactly like `claim()`.
   */
  async reserveCancellation(request: ExecutionClaimReservationRequest): Promise<ExecutionClaimReservation> {
    for (let pass = 0; pass < MAX_CLASSIFY_ATTEMPTS; pass += 1) {
      const reserved = await this.insertCancelled(request);
      if (reserved) return { kind: "RESERVED", claim: reserved, priorState: null };
      const classified = await this.classifyReservation(request);
      if (classified) return classified;
      // `null` means a CAS lost or the row moved under us. Re-read and retry; the
      // state only moves forward, so this terminates in practice.
    }
    throw new AiWorkforceError(
      "PERSISTENCE_UNAVAILABLE",
      `The execution claim reservation for "${request.idempotencyKey}" could not be resolved after ${MAX_CLASSIFY_ATTEMPTS} attempts`,
      { idempotencyKey: request.idempotencyKey },
    );
  }

  /** The single-statement reservation. `null` = "nothing landed; classify". */
  private async insertCancelled(request: ExecutionClaimReservationRequest): Promise<ExecutionClaim | null> {
    const id = this.options.ids.next("claim");
    let rows: ClaimRow[];
    try {
      rows = await this.options.client.$queryRaw<ClaimRow[]>`
        INSERT INTO ai_execution_claims
          ("id", "missionId", "taskId", "attempt", "actorId", "capabilityId", "runtimeId",
           "idempotencyKey", "state", "leaseOwner", "leaseExpiresAt", "detail", "claimedAt", "updatedAt")
        VALUES
          (${id}, ${request.missionId}, ${request.taskId}, ${request.attempt},
           ${request.actorId}, ${request.capabilityId}, ${request.runtimeId ?? null},
           ${request.idempotencyKey}, 'CANCELLED', ${request.leaseOwner}, NULL, ${request.detail},
           (now() AT TIME ZONE 'UTC'), (now() AT TIME ZONE 'UTC'))
        ON CONFLICT ("taskId", "attempt") DO UPDATE
          SET "state" = 'CANCELLED',
              "detail" = EXCLUDED."detail",
              "leaseOwner" = EXCLUDED."leaseOwner",
              "leaseExpiresAt" = NULL,
              "updatedAt" = (now() AT TIME ZONE 'UTC')
          WHERE ai_execution_claims."idempotencyKey" = EXCLUDED."idempotencyKey"
            AND ai_execution_claims."state" IN ('CLAIMED', 'RELEASED')
            AND (ai_execution_claims."leaseExpiresAt" IS NULL
                 OR ai_execution_claims."leaseExpiresAt" <= (now() AT TIME ZONE 'UTC'))
        RETURNING *
      `;
    } catch (error) {
      // `ON CONFLICT ("taskId", "attempt")` names ONE unique index, because
      // Postgres allows exactly one conflict target per statement. If the row
      // instead collides on the OTHER unique index (`idempotencyKey`) — a
      // different attempt held under this key, or this attempt held under a
      // different key — the insert raises a 23505 unique violation. That is not a
      // fault: it is a second way of saying "nothing landed; classify". Returning
      // `null` hands it to `classifyReservation`, which reports the conflict
      // honestly (and never overwrites the row).
      if (isUniqueViolation(error)) return null;
      throw new AiWorkforceError(
        "PERSISTENCE_UNAVAILABLE",
        `Could not reserve the execution claim for "${request.idempotencyKey}" as cancelled`,
        {
          idempotencyKey: request.idempotencyKey,
          cause: error instanceof Error ? error.message : String(error),
        },
      );
    }
    return rows[0] ? toClaim(rows[0]) : null;
  }

  /**
   * Why the reservation did NOT land. Never returns `RESERVED` — if a
   * reclaimable row is seen here the caller re-runs the single-statement
   * reservation instead of mutating through a second write.
   */
  private async classifyReservation(
    request: ExecutionClaimReservationRequest,
  ): Promise<ExecutionClaimReservation | null> {
    const byKey = await this.readByKeyWithClock(request.idempotencyKey);
    const row = byKey ?? (await this.readByAttemptWithClock(request.taskId, request.attempt));
    if (!row) {
      // A bare `ON CONFLICT` absorbs every unique constraint, so nothing found by
      // key OR by attempt can only mean the PRIMARY KEY collided: an id-factory
      // fault, reported rather than hidden.
      throw new AiWorkforceError(
        "PERSISTENCE_UNAVAILABLE",
        `The execution claim ledger attracted no row for "${request.idempotencyKey}" and holds none for task ${request.taskId} attempt ${request.attempt}`,
        { idempotencyKey: request.idempotencyKey, taskId: request.taskId, attempt: request.attempt },
      );
    }
    if (byKey === null && row.idempotencyKey !== request.idempotencyKey) {
      return { kind: "CONFLICT", claimId: row.id, taskId: row.taskId, attempt: row.attempt };
    }
    if (row.taskId !== request.taskId || row.attempt !== request.attempt) {
      return { kind: "CONFLICT", claimId: row.id, taskId: row.taskId, attempt: row.attempt };
    }
    if (!isExecutionClaimState(row.state)) throw unknownStateError(row);

    switch (row.state) {
      case "CANCELLED":
        return { kind: "ALREADY_CANCELLED", claim: toClaim(row) };
      case "DISPATCHED":
        return { kind: "EXECUTION_EXISTS", claim: toClaim(row) };
      case "UNVERIFIED":
        return { kind: "UNVERIFIED", claim: toClaim(row), detail: row.detail ?? ALREADY_UNVERIFIED_DETAIL };
      case "DISPATCHING": {
        if (row.leaseLive === true) return { kind: "IN_PROGRESS", claim: toClaim(row) };
        const promoted = await this.markUnverified(row.id, UNVERIFIED_DETAIL);
        if (!promoted) return null;
        return { kind: "UNVERIFIED", claim: promoted, detail: promoted.detail ?? UNVERIFIED_DETAIL };
      }
      case "CLAIMED":
        // A LIVE lease means an invocation may be mid-flight: report it rather
        // than forcing a cancellation over the top of it. (The one-statement write
        // above refused for the same reason — it will not touch a live lease.)
        if (row.leaseLive === true) return { kind: "IN_PROGRESS", claim: toClaim(row) };
        // The lease has LAPSED: the reservation CAN land, so re-run the
        // one-statement write rather than mutating through a second.
        return null;
      default:
        // RELEASED — a control refused before dispatch, so no run exists. The
        // reservation CAN land: re-run the one-statement write.
        return null;
    }
  }

  /** `CANCELLED → RELEASED`, by the reservation's own token: the compensation. */
  async rollbackCancellation(
    claimId: string,
    input: { invocationToken: string; detail: string },
  ): Promise<ExecutionClaim | null> {
    const rows = await this.options.client.$queryRaw<ClaimRow[]>`
      UPDATE ai_execution_claims
      SET "state" = 'RELEASED',
          "detail" = ${input.detail},
          "leaseOwner" = NULL,
          "leaseExpiresAt" = NULL,
          "updatedAt" = (now() AT TIME ZONE 'UTC')
      WHERE "id" = ${claimId}
        AND "state" = 'CANCELLED'
        AND "leaseOwner" = ${input.invocationToken}
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

  /**
   * `CLAIMED`/`RELEASED` → a fresh `CLAIMED` lease: ONE atomic statement, using
   * DATABASE TIME and an EXPIRED-LEASE predicate.
   *
   * This is the other verified defect. The earlier version read the row (which
   * said "expired"), then updated it unconditionally on the state it had read.
   * Between the read and the write the owner can RENEW its lease — so the write
   * stole an attempt that was, at the moment of the write, legitimately held. The
   * predicate below makes that impossible: the UPDATE only lands when the lease
   * is genuinely NOT live any more, judged by the database in the same statement
   * that renews it.
   *
   * `expectedState` is still part of the predicate, so the CAS cannot move a row
   * that has advanced (to `DISPATCHING`, say) while this caller was deciding.
   */
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
      WHERE "id" = ${claimId}
        AND "state" = ${expectedState}
        AND ("leaseExpiresAt" IS NULL OR "leaseExpiresAt" <= (now() AT TIME ZONE 'UTC'))
      RETURNING *
    `;
    return rows[0] ? toClaim(rows[0]) : null;
  }

  private async readByKeyWithClock(idempotencyKey: string): Promise<ClaimRowWithClock | null> {
    // A named method so the transaction-aware sibling above and this read share
    // one place to change if the claim read ever gains a column.

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
