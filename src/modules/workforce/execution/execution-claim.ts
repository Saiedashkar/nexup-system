import { AiWorkforceError } from "@/modules/ai-workforce/core/errors";
import type { Clock, IdFactory } from "@/modules/ai-workforce/core/types";
import type { ActorId, CapabilityId, ExecutionRecordId, MissionId, RuntimeId, TaskId } from "../core/refs";
import { assertReceiptDetail, detailWithDoubt } from "./execution-claim-receipt";

/**
 * Execution CLAIMS — the durable gate in front of every external execution.
 *
 * THE BUG THIS EXISTS FOR, stated precisely. Before Step 5A, a mission task was
 * dispatched like this:
 *
 *   1. read the task, assert READY
 *   2. call `dispatcher.startJob(...)`   ← a REAL HMAC-signed request to the bridge
 *   3. write the execution record
 *   4. compare-and-set the task to RUNNING
 *
 * Two defects follow from that order, and they are different defects:
 *
 *   * ORDERING. A crash between 2 and 3 leaves a provider run that NEXUP has no
 *     record of, so nothing can ever adopt or settle it.
 *   * CONCURRENCY. Two concurrent advances both pass step 1 and both reach step 2.
 *     Step 4 refuses the SECOND writer — but only AFTER both runs started.
 *
 * The claim fixes both by making "who is executing attempt N of task T" a single
 * durable row, won by a single INSERT against a unique key, written BEFORE any
 * external call. A loser does not execute; it reads what the winner did.
 *
 * ── THE CORRECTION THAT MATTERS MOST ──
 *
 * The first draft of this design allowed an EXPIRED `DISPATCHING` claim to be
 * stolen and re-dispatched. The owner rejected that, and it is worth writing down
 * why it was wrong rather than just removing it:
 *
 *   A crash may happen AFTER the external request reaches Hermes and BEFORE the
 *   handle is persisted. So "no durable handle" does NOT mean "no run happened".
 *
 * Therefore the transition into `DISPATCHING` is the irreversible marker:
 *
 *   CLAIMED      dispatch was never ATTEMPTED          → safe to reclaim
 *   DISPATCHING  dispatch was ENTERED, outcome unknown → UNVERIFIED, NEVER re-dispatched
 *   DISPATCHED   an execution is durably identified    → adopt, never duplicate
 *
 * There is no lease-expiry path from `DISPATCHING` back to dispatchable. The only
 * transitions out of `DISPATCHING` are `DISPATCHED` (a handle was recorded) and
 * `UNVERIFIED` (it was not). `UNVERIFIED` is terminal for automatic purposes and
 * requires a human/operator to resolve.
 *
 * ── WHAT A CLAIM IS NOT ──
 *
 * It is NOT a second lifecycle. It does not know about mission or task state, it
 * never moves a task, and `MissionOrchestrator` remains the only thing that does.
 * Its states describe the DELIVERY of one attempt — whether it was won, entered,
 * identified, refused, or abandoned in doubt. Duration, review, retry and
 * cancellation are all still the orchestrator's. */

/* ═══════════════════════════════════════════════════════
   States
   ═══════════════════════════════════════════════════════ */

export const EXECUTION_CLAIM_STATES = [
  /** The key was won. Dispatch has NOT been entered. Reclaimable once its lease lapses. */
  "CLAIMED",
  /**
   * Dispatch HAS been entered. This is the last durable write before the external
   * call, and the point of no return: the outside world may now know about this
   * attempt. Never reclaimed.
   */
  "DISPATCHING",
  /** An external execution is durably identified (execution record + handle). */
  "DISPATCHED",
  /** Refused BEFORE dispatch was entered. No external run is possible, so the attempt is free. */
  "RELEASED",
  /**
   * CANCELLED before dispatch was entered (Step 5A-4 correction). A cancellation
   * WINS this attempt's key so a racing `execute()` can never enter dispatch for
   * it: cancellation and dispatch contend on ONE atomic insert, which is the
   * linearization point between cancelling and starting. Terminal — never
   * reclaimed. Added without a schema change because `state` is TEXT validated
   * by this state machine, not a Postgres enum.
   */
  "CANCELLED",
  /** Dispatch was entered and no durable handle exists. Human/operator resolution only. */
  "UNVERIFIED",
] as const;
export type ExecutionClaimState = (typeof EXECUTION_CLAIM_STATES)[number];

export function isExecutionClaimState(value: string): value is ExecutionClaimState {
  return (EXECUTION_CLAIM_STATES as readonly string[]).includes(value);
}

/**
 * The states an attempt may be RE-DISPATCHED from — i.e. the states in which no
 * external execution can possibly exist.
 *
 * `DISPATCHING` and `UNVERIFIED` are deliberately absent, and this constant is
 * exported so a test can assert that absence. It is the machine-checkable form of
 * the owner's correction: if someone later adds `DISPATCHING` here, the invariant
 * test fails instead of the mistake shipping.
 */
export const REDISPATCHABLE_CLAIM_STATES = ["CLAIMED", "RELEASED"] as const satisfies readonly ExecutionClaimState[];

/** True only for a state from which a new external execution may legitimately start. */
export function isRedispatchableClaimState(state: ExecutionClaimState): boolean {
  return (REDISPATCHABLE_CLAIM_STATES as readonly ExecutionClaimState[]).includes(state);
}

/**
 * The states that BLOCK a new external execution, derived from the allowlist
 * rather than written out a second time.
 *
 * Derived on purpose: two hand-maintained lists of the same fact eventually
 * disagree, and the disagreement would be a state that is neither dispatchable nor
 * blocked — i.e. one nobody checks. A test asserts the two are exact complements.
 */
export function executionBlockedClaimStates(): ExecutionClaimState[] {
  return EXECUTION_CLAIM_STATES.filter((state) => !isRedispatchableClaimState(state));
}

/**
 * Default lease length.
 *
 * ── LEASE SIZING, WHICH IS THE WHOLE FIX FOR "ZERO SAFETY MARGIN" ──
 *
 * The lease must not normally lapse while the invocation it belongs to is still
 * legitimately working on the attempt, because a lapse is what lets another
 * caller reclaim the attempt — and a reclaim is only safe when it is TRUE that
 * nothing is in flight.
 *
 * The two configured numbers this is sized against are the real ones as they
 * exist in the repository (not the 60s figure an earlier draft assumed):
 *
 *   DEFAULT_CLAIM_LEASE_TTL_MS   120_000   (this constant)
 *   DEFAULT_HERMES_TIMEOUT_MS    120_000   (`HermesRuntimeConfig.timeoutMs`)
 *
 * With those equal there is ZERO margin, which is exactly the defect the owner
 * flagged: a submission that runs to its own configured timeout would leave the
 * `CLAIMED` lease already expired, so a concurrent caller could reclaim an
 * attempt that is still being submitted.
 *
 * The sizing rule is therefore: the DISPATCHING lease (written immediately
 * before the external call) is `submissionTimeout + finalizationMargin`, and it
 * is written ONCE at the `DISPATCHING` boundary rather than renewed by a timer
 * (no distributed lease platform is introduced — PostgreSQL is the clock). The
 * `CLAIMED` lease, which only has to cover the LOCAL preflight, gets the same
 * length because a longer local window costs nothing.
 *
 * 120_000 (submission) + 60_000 (local durable finalization margin) = 180_000.
 */
export const DEFAULT_CLAIM_LEASE_TTL_MS = 180_000;

/** The margin added on top of a submission timeout when sizing a lease. */
export const CLAIM_FINALIZATION_MARGIN_MS = 60_000;

/** Lease length for an execution whose submission timeout is known. */
export function claimLeaseTtlForTimeout(submissionTimeoutMs?: number): number {
  const timeout = typeof submissionTimeoutMs === "number" && Number.isFinite(submissionTimeoutMs) && submissionTimeoutMs > 0
    ? submissionTimeoutMs
    : DEFAULT_CLAIM_LEASE_TTL_MS - CLAIM_FINALIZATION_MARGIN_MS;
  return timeout + CLAIM_FINALIZATION_MARGIN_MS;
}

/**
 * Mints the INVOCATION TOKEN for one `execute()` call.
 *
 * This is what replaced "which process holds the claim". A stable worker or
 * process id is NOT sufficient: two concurrent invocations inside ONE process
 * share it, which is precisely how the reproduced defect let two callers of the
 * same logical worker both receive a dispatch-permitting outcome. The token is
 * unique per INVOCATION, so "the caller that holds this token" is a statement
 * about one call, not about a machine.
 *
 * It is stored in the existing `leaseOwner` column (no schema change): the
 * column's meaning is "who owns this lease", and the owner of a lease is now an
 * invocation rather than a host.
 */
export function newInvocationToken(input: { processId: string; ids: IdFactory; now?: Clock }): string {
  const random =
    typeof globalThis.crypto?.randomUUID === "function"
      ? globalThis.crypto.randomUUID()
      : Math.random().toString(36).slice(2);
  const at = (input.now?.() ?? new Date()).getTime().toString(36);
  return `inv:${input.processId}:${at}:${input.ids.next("invocation")}:${random}`;
}

/* ═══════════════════════════════════════════════════════
   The record
   ═══════════════════════════════════════════════════════ */

export type ExecutionClaim = {
  id: string;
  missionId: MissionId;
  taskId: TaskId;
  /** 1-based attempt number inside the task. */
  attempt: number;
  actorId: ActorId;
  capabilityId: CapabilityId;
  /** Known at claim time in the composed path; confirmable at dispatch. */
  runtimeId?: RuntimeId;
  /**
   * The deterministic attempt key (`task:<taskId>:attempt:<n>`). UNIQUE — this is
   * the whole algorithm, so it is never caller-supplied.
   */
  idempotencyKey: string;
  state: ExecutionClaimState;
  /** The durable execution record, once one exists. */
  executionRecordId?: ExecutionRecordId;
  /** The runtime's own handle for this attempt (bridge run id on BRIDGE). */
  handleId?: string;
  /**
   * The INVOCATION token that holds this lease — unique per `execute()` call,
   * not per process (see `newInvocationToken`). Every mutation that depends on
   * owning the attempt compares against THIS value, and a live lease blocks a
   * second caller even when two callers would have shared a process id.
   */
  leaseOwner?: string;
  /** When the lease stops being authoritative. Absent = not live. */
  leaseExpiresAt?: string;
  /** Bounded, non-secret explanation of the current state. */
  detail?: string;
  /**
   * When a RECOVERY SWEEP last OBSERVED this row — the DURABLE rotation key
   * (Step 5A-4, fifth review). `undefined` means "recovery has never looked at
   * this row" and sorts FIRST.
   *
   * It is deliberately NOT `updatedAt`. `updatedAt` is the row's last real WRITE
   * (claim, dispatch, release, cancellation) and is the application's activity
   * signal; a sweep that bumped it would make recovery indistinguishable from an
   * execution that actually happened. This field is written by exactly one
   * operation, `markRecoverySwept`, which changes nothing else, and it lives in
   * the ledger so the sweep's progress survives a restart and is shared by every
   * instance — neither of which process memory can do.
   */
  recoverySweptAt?: string;
  claimedAt: string;
  updatedAt: string;
};

/* ═══════════════════════════════════════════════════════
   Typed outcomes
   ═══════════════════════════════════════════════════════ */

export const EXECUTION_CLAIM_OUTCOME_KINDS = [
  /** Insert won the key. Dispatch not entered: proceed to `markDispatching` then dispatch. */
  "CLAIMED",
  /** An expired `CLAIMED`, or a `RELEASED` claim, was retaken. Dispatch not entered. */
  "RECLAIMED",
  /** Already `DISPATCHED`: adopt the existing execution. NEVER dispatch again. */
  "REPLAYED",
  /** A live lease is held (by another process, or on a `DISPATCHING` attempt). Wait. */
  "IN_PROGRESS",
  /** `DISPATCHING`/`UNVERIFIED` with no handle: an external run MAY exist. Never dispatch. */
  "UNVERIFIED",
  /** Cancelled before dispatch: this attempt is terminally dead. Never dispatch. */
  "CANCELLED",
] as const;
export type ExecutionClaimOutcomeKind = (typeof EXECUTION_CLAIM_OUTCOME_KINDS)[number];

export type ExecutionClaimOutcome =
  | { kind: "CLAIMED"; claim: ExecutionClaim }
  | { kind: "RECLAIMED"; claim: ExecutionClaim; reclaimedFrom: ExecutionClaimState }
  | { kind: "REPLAYED"; claim: ExecutionClaim }
  | { kind: "IN_PROGRESS"; claim: ExecutionClaim }
  | { kind: "UNVERIFIED"; claim: ExecutionClaim; detail: string }
  | { kind: "CANCELLED"; claim: ExecutionClaim };

/**
 * True when the outcome permits the caller to proceed to `markDispatching` and
 * then dispatch. Everything else means "do not execute" — and this is a single
 * function precisely so no call site can get the list wrong.
 */
export function claimOutcomePermitsDispatch(outcome: ExecutionClaimOutcome): boolean {
  return outcome.kind === "CLAIMED" || outcome.kind === "RECLAIMED";
}

export type ExecutionClaimRequest = {
  missionId: MissionId;
  taskId: TaskId;
  attempt: number;
  /** Deterministic: `executionIdempotencyKeyForAttempt(taskId, attempt)`. */
  idempotencyKey: string;
  actorId: ActorId;
  capabilityId: CapabilityId;
  runtimeId?: RuntimeId;
  /**
   * The INVOCATION taking the claim — `newInvocationToken(...)`, never a bare
   * process id. See the note on `ExecutionClaim.leaseOwner`.
   */
  leaseOwner: string;
  leaseTtlMs?: number;
};

/* ═══════════════════════════════════════════════════════
   Cancellation reservation (Step 5A-4 correction)
   ═══════════════════════════════════════════════════════

   THE DEFECT THIS REPLACES. Cancellation used to reserve an attempt with TWO
   writes: `claim()` (which inserts the row as `CLAIMED`) and then
   `markCancelled()`. A crash between them left an ordinary, RECLAIMABLE
   `CLAIMED` row — and once its lease lapsed, a racing `execute()` could reclaim
   and dispatch exactly the attempt the operator had cancelled.

   `reserveCancellation` is therefore ONE statement that lands the exact attempt
   directly in its terminal `CANCELLED` state: a fresh INSERT when nothing holds
   the attempt, or a single CAS-shaped flip when a reclaimable (`CLAIMED` with a
   lapsed lease, or `RELEASED`) row already exists. There is no intermediate
   state for a crash to strand, so cancellation and dispatch contend on the SAME
   single write — which is the linearization point between cancelling and
   starting.

   A reservation is REVERSIBLE and that is deliberate: a partially-resolved
   multi-task cancellation must not permanently poison the tasks it reserved
   ahead of the one that could not be resolved, so the caller can roll its
   reservations back with `rollbackCancellation`. */

export const EXECUTION_CLAIM_RESERVATION_KINDS = [
  /** The exact attempt is now `CANCELLED`. No dispatch can ever start for it. */
  "RESERVED",
  /** The attempt was already terminal `CANCELLED`. Nothing to do. */
  "ALREADY_CANCELLED",
  /** `DISPATCHED`: an external execution exists — cancel it THROUGH the runtime. */
  "EXECUTION_EXISTS",
  /** A live lease holds the attempt; the owning invocation is still working. */
  "IN_PROGRESS",
  /** Dispatch was ENTERED with no durable handle: the run may exist. Human only. */
  "UNVERIFIED",
  /** The attempt is held under a DIFFERENT key: an upstream derivation drifted. */
  "CONFLICT",
] as const;
export type ExecutionClaimReservationKind = (typeof EXECUTION_CLAIM_RESERVATION_KINDS)[number];

export type ExecutionClaimReservation =
  | { kind: "RESERVED"; claim: ExecutionClaim; priorState: ExecutionClaimState | null }
  | { kind: "ALREADY_CANCELLED"; claim: ExecutionClaim }
  | { kind: "EXECUTION_EXISTS"; claim: ExecutionClaim }
  | { kind: "IN_PROGRESS"; claim: ExecutionClaim }
  | { kind: "UNVERIFIED"; claim: ExecutionClaim; detail: string }
  | { kind: "CONFLICT"; claimId: string; taskId: TaskId; attempt: number };

export type ExecutionClaimReservationRequest = ExecutionClaimRequest & {
  /** Bounded, non-secret reason recorded on the reservation. */
  detail: string;
};

/**
 * The typed, FAIL-CLOSED refusal for a caller whose `(taskId, attempt)` is
 * already held under a DIFFERENT idempotency key.
 *
 * `taskId + attempt` is the semantic identity of an execution attempt; the key
 * is only its deterministic spelling. When the two disagree, some upstream
 * derivation has drifted, and the safe answer is to REFUSE — never to classify
 * the caller as an ordinary retry (which would hand it, or imply, the existing
 * attempt's authority), and never to create a second row. The stored claim is
 * left exactly as it was, and no dispatch permission can come out of this.
 *
 * Shared so the in-memory reference and the durable adapter cannot disagree
 * about what the mismatch means.
 */
export function attemptIdempotencyMismatch(
  request: ExecutionClaimRequest,
  stored: ExecutionClaim,
): AiWorkforceError {
  return new AiWorkforceError(
    "ATTEMPT_IDEMPOTENCY_MISMATCH",
    `Execution attempt ${stored.attempt} of task "${stored.taskId}" is already claimed under key "${stored.idempotencyKey}", but the caller supplied "${request.idempotencyKey}"`,
    {
      claimId: stored.id,
      taskId: stored.taskId,
      attempt: stored.attempt,
      storedKey: stored.idempotencyKey,
      suppliedKey: request.idempotencyKey,
    },
  );
}

/* ═══════════════════════════════════════════════════════
   Recovery verdicts
   ═══════════════════════════════════════════════════════ */

export const EXECUTION_CLAIM_RECOVERY_KINDS = ["RECLAIM", "ADOPT", "IN_PROGRESS", "UNVERIFIED", "CANCELLED"] as const;
export type ExecutionClaimRecoveryKind = (typeof EXECUTION_CLAIM_RECOVERY_KINDS)[number];

export const EXECUTION_CLAIM_RECOVERY_REASONS = [
  /** `CLAIMED` with a lapsed lease: dispatch was never entered, so starting is safe. */
  "CLAIMED_LEASE_EXPIRED_NO_DISPATCH",
  /** `RELEASED`: a control refused BEFORE dispatch, so no external run exists. */
  "RELEASED_NO_DISPATCH",
  /** `DISPATCHED`: an execution already exists and must be adopted, never duplicated. */
  "DISPATCHED_EXECUTION_EXISTS",
  /** A live lease is held: something is actively working on this attempt. */
  "LIVE_LEASE_HELD",
  /** `DISPATCHING` with no handle: the run MAY have started. Human resolution only. */
  "DISPATCHING_NO_HANDLE",
  /**
   * `DISPATCHED` that names NO execution record: the ledger believes an
   * execution exists but cannot say which. A missing durable identity is doubt,
   * never a licence to start again.
   */
  "DISPATCHED_WITHOUT_RECORD",
  /** Already `UNVERIFIED`: the doubt was already recorded and must not be re-resolved automatically. */
  "ALREADY_UNVERIFIED",
  /** The attempt was CANCELLED before dispatch. Terminal for every purpose. */
  "ATTEMPT_CANCELLED",
] as const;
export type ExecutionClaimRecoveryReason = (typeof EXECUTION_CLAIM_RECOVERY_REASONS)[number];

export type ExecutionClaimRecovery =
  | { kind: "RECLAIM"; reason: "CLAIMED_LEASE_EXPIRED_NO_DISPATCH" | "RELEASED_NO_DISPATCH"; claim: ExecutionClaim }
  | { kind: "ADOPT"; reason: "DISPATCHED_EXECUTION_EXISTS"; claim: ExecutionClaim; executionRecordId: ExecutionRecordId }
  | { kind: "IN_PROGRESS"; reason: "LIVE_LEASE_HELD"; claim: ExecutionClaim; leaseOwner?: string }
  | { kind: "CANCELLED"; reason: "ATTEMPT_CANCELLED"; claim: ExecutionClaim }
  | {
      kind: "UNVERIFIED";
      reason: "DISPATCHING_NO_HANDLE" | "ALREADY_UNVERIFIED" | "DISPATCHED_WITHOUT_RECORD";
      claim: ExecutionClaim;
      detail: string;
    };

/**
 * The recovery verdict for ONE claim — the corrected model, in one place.
 *
 * The three questions it answers, in order:
 *
 *   1. Is an execution already identified? → ADOPT. (Never start a second one.)
 *   2. Was dispatch entered?             → UNVERIFIED. The run may exist; a person
 *                                           decides. `UNVERIFIED` is NOT a licence
 *                                           to dispatch, and the only way to reach
 *                                           `RECLAIM` from here is... there is none.
 *   3. Otherwise (CLAIMED/RELEASED)      → RECLAIM when the lease is not live.
 *
 * "Live" is deliberately conservative: a missing or unparseable `leaseExpiresAt`
 * counts as NOT live for `CLAIMED` (so a crashed process does not strand the
 * attempt forever) and the SAME absence is what makes `DISPATCHING` unverifiable.
 * The asymmetry is the point — for `CLAIMED` we know nothing happened; for
 * `DISPATCHING` we know we do not know.
 */
export function recoveryForClaim(
  claim: ExecutionClaim,
  options: {
    now: Date;
    requester?: string;
    /**
     * The AUTHORITATIVE liveness answer, when the caller already has one.
     *
     * A durable ledger must not decide this with application date arithmetic:
     * instance A's clock is not evidence about instance B's lease. When the
     * storage layer computed liveness itself — as PostgreSQL does, in the same
     * query that read the row — it supplies the answer here and it WINS over
     * `now`. Only the in-memory reference, which owns the one and only clock it
     * can see, leaves this unset.
     */
    leaseIsLive?: boolean;
  },
): ExecutionClaimRecovery {
  if (claim.state === "DISPATCHED" && claim.executionRecordId) {
    return {
      kind: "ADOPT",
      reason: "DISPATCHED_EXECUTION_EXISTS",
      claim,
      executionRecordId: claim.executionRecordId,
    };
  }

  // A `DISPATCHED` row WITHOUT a record is not adoptable — and must never be
  // re-dispatchable either. The ledger says an execution exists but cannot name
  // it, which is doubt of the same kind as an unhandleable `DISPATCHING`: the
  // only safe answer is a human's, so it is reported as UNVERIFIED rather than
  // falling through to the RECLAIM branch below.
  if (claim.state === "DISPATCHED") {
    return {
      kind: "UNVERIFIED",
      reason: "DISPATCHED_WITHOUT_RECORD",
      claim,
      detail:
        claim.detail ??
        "the delivery ledger reports DISPATCHED but names no execution record; the durable identity is missing and this attempt must not be re-dispatched automatically",
    };
  }
  // ONE liveness answer for the whole verdict: the caller's authoritative boolean
  // when it has one, otherwise arithmetic on the clock it supplied.
  const live = options.leaseIsLive ?? isLeaseLive(claim, options.now);

  if (claim.state === "DISPATCHING") {
    // A LIVE `DISPATCHING` lease is IN PROGRESS — for EVERYONE, including the
    // token that wrote it. The old `&& !leaseHeldBy(...)` made the owner's own
    // re-read report UNVERIFIED, which is wrong twice over: it hides real work
    // from the process doing it, and it marks a healthy dispatch as doubtful.
    if (live) {
      return { kind: "IN_PROGRESS", reason: "LIVE_LEASE_HELD", claim, leaseOwner: claim.leaseOwner };
    }
    return {
      kind: "UNVERIFIED",
      reason: "DISPATCHING_NO_HANDLE",
      claim,
      detail:
        "dispatch was entered and no durable handle exists; the external run may have started, so this attempt must not be re-dispatched automatically",
    };
  }

  if (claim.state === "CANCELLED") {
    return { kind: "CANCELLED", reason: "ATTEMPT_CANCELLED", claim };
  }

  if (claim.state === "UNVERIFIED") {
    return {
      kind: "UNVERIFIED",
      reason: "ALREADY_UNVERIFIED",
      claim,
      detail: claim.detail ?? "this attempt was already recorded as unverifiable",
    };
  }

  // CLAIMED / RELEASED — dispatch was never entered.
  // SAME RULE AS `DISPATCHING`: a live lease is in progress for everyone. A
  // matching `leaseOwner` string is NOT permission for a second claimant — the
  // reproduced defect was exactly that, so this branch no longer consults it.
  if (live && claim.state === "CLAIMED") {
    return { kind: "IN_PROGRESS", reason: "LIVE_LEASE_HELD", claim, leaseOwner: claim.leaseOwner };
  }
  return {
    kind: "RECLAIM",
    reason: claim.state === "RELEASED" ? "RELEASED_NO_DISPATCH" : "CLAIMED_LEASE_EXPIRED_NO_DISPATCH",
    claim,
  };
}

/* ═══════════════════════════════════════════════════════
   Sweeping the unresolved ledger (Step 5A-4, sixth review)
   ═══════════════════════════════════════════════════════

   THE DEFECTS THESE TYPES EXIST FOR, and none of them is a state-machine bug —
   every one is a read:

     1. MISSION SCOPING. A mission-scoped sweep used to read the global first
        page and filter by mission in the caller, so a mission's own incident
        was invisible whenever more than one page of OTHER missions' incidents
        sorted ahead of it. A mission-scoped question must be a mission-scoped
        QUERY: the filter belongs in the WHERE clause, BEFORE any `take`.

     2. FAIR PROGRESS. A permanent incident (an old `UNVERIFIED` row nobody has
        resolved yet) sorts before every newer one, so a sweep that always reads
        "the first N by `claimedAt`" re-reads the same rows forever and never
        reaches anything newer. The doubt is durable but nothing ever acts on it,
        which is indistinguishable from having no incident at all.

     3. DURABLE PROGRESS. The previous correction fixed (2) with a cursor kept
        in PROCESS MEMORY, bounded by an LRU of 64 scopes. That survives neither a
        restart (every scope starts again at the oldest end) nor more than 64
        active missions (an evicted scope starts again at the oldest end), so
        "progress" was really "repeated work whose repetition nobody bounds".

     4. REPEATED-RECOVERY STARVATION (the SIXTH review). (3) was fixed by making
        the rotation key a column on the rows — right — but the sweep still read
        ONE page ordered "never observed first, then least recently observed".
        That order proves FIRST discovery while saying nothing about the SECOND:
        a steady arrival of `N` new rows per sweep fills the whole page with
        never-observed rows (exactly `N` of them, forever, with no growing
        backlog at all), so a row that was observed once and still needs recovery
        — a `DISPATCHING` claim whose owner has just crashed, a record that
        finished after its first observation — is never looked at again. "No
        unconditional bound" is another way of saying "starved".

   So the traversal is no longer a cursor, and it is no longer ONE page either. It
   is a PROPERTY OF THE LEDGER:

     a sweep reads ONE BOUNDED WINDOW of each of the THREE lanes below, and STAMPS
     every row it looks at (`recoverySweptAt`, from the database clock).

   Only PREVIOUSLY_OBSERVED is disjoint from the other two. NEVER_OBSERVED and
   NEVER_OBSERVED_NEWEST select the SAME rows from opposite ends, and the `seen`
   set in the sweep collapses the overlap — the freshness window is an additional
   way into the unseen set, never a third set.

   There is therefore no position to store, no position to advance, no wrap and
   no generation to get wrong: the durable rows ARE the progress. Restart the
   process, run a second instance, sweep 65 missions or 65 thousand — the queue is
   wherever the ledger says it is.

   `order` remains for the READS that are not the sweep: `OLDEST_FIRST` for the
   operator's "what has waited longest", `NEWEST_FIRST` for "what just arrived",
   and `LEAST_RECENTLY_SWEPT_FIRST` for the merged "what is next" diagnostic. The
   sweep itself names a LANE, so the read it makes cannot be re-composed by a
   caller into something that starves again. */

export type ExecutionClaimSweepOrder =
  /** Oldest dispatch first (`claimedAt`): the work that has waited longest. */
  | "OLDEST_FIRST"
  /** Newest dispatch first: the FRESHNESS end of the ledger. */
  | "NEWEST_FIRST"
  /** LEAST RECENTLY SWEPT first, never-observed first: the merged "next" read. */
  | "LEAST_RECENTLY_SWEPT_FIRST";

/**
 * ONE OF THE SWEEP'S THREE ALLOCATIONS (Step 5A-4, sixth review; the "disjoint"
 * claim corrected by the seventh and ninth reviews).
 *
 * A sweep does not read "a page of the queue". It reads ONE BOUNDED WINDOW of
 * each of three lanes, because the WHERE clause decides membership and the window
 * only decides direction. TWO OF THE THREE OVERLAP — see below — and the overlap
 * is deliberate and deduplicated, not a third set:
 *
 *   NEVER_OBSERVED          `recoverySweptAt IS NULL`, OLDEST `claimedAt` first.
 *                           FIFO service for work recovery has never looked at.
 *   NEVER_OBSERVED_NEWEST   `recoverySweptAt IS NULL`, NEWEST `claimedAt` first.
 *                           The bounded freshness window: a brand-new incident
 *                           is visible on the very next sweep, not after the
 *                           whole unseen backlog has drained. THE SAME ROWS as
 *                           NEVER_OBSERVED, read from the newest end.
 *   PREVIOUSLY_OBSERVED     `recoverySweptAt IS NOT NULL`, LEAST recently
 *                           observed first. The REVISIT window — the one the
 *                           sixth review found unbounded, and the only lane whose
 *                           predicate excludes the other two.
 *
 * WHY THE SPLIT IS THE FIX. Rows that have never been observed form a SET the
 * revisit window excludes BY PREDICATE, not by being behind them in an order.
 * ONLY that separation has to hold for the fairness argument: the two unseen
 * lanes may repeat each other, and the `seen` guard removes the repeat.
 * Arrivals are always never-observed rows, so no number of arrivals can consume a
 * single row of the revisit allocation — which is precisely what "up to 50 newest
 * rows" could not promise.
 */
export type ExecutionClaimSweepLane = "NEVER_OBSERVED" | "NEVER_OBSERVED_NEWEST" | "PREVIOUSLY_OBSERVED";

export type ExecutionClaimSweepQuery = {
  /** Defaults to 50. The page size, never "everything". */
  limit?: number;
  /**
   * Restricts the read to ONE mission, in the QUERY rather than in the caller.
   * This is what makes a mission-scoped recovery answer complete no matter how
   * many other missions' incidents exist.
   */
  missionId?: MissionId;
  /** Defaults to `OLDEST_FIRST`, and IGNORED when `lane` is given. */
  order?: ExecutionClaimSweepOrder;
  /**
   * The sweep's LANE. When set, it fixes BOTH the predicate that decides
   * membership and the direction of the window, so a sweep's allocation cannot be
   * widened or re-ordered by the call site.
   */
  lane?: ExecutionClaimSweepLane;
};

/**
 * True when the DURABLE row still needs a human or an operator.
 *
 * Two shapes qualify, and they are the shapes `listUnresolved` returns:
 *
 *   UNVERIFIED                     dispatch was entered and no handle exists;
 *   DISPATCHED with no record id   an identity that went missing.
 *
 * Everything else — including a `DISPATCHED` row that NAMES its execution — is
 * resolved, and escalating on it would be a false alarm raised about a run the
 * ledger can point at. That distinction is exactly what a losing CAS has to
 * consult before it may escalate anything.
 */
export function claimRequiresOperatorResolution(claim: ExecutionClaim): boolean {
  if (claim.state === "UNVERIFIED") return true;
  return claim.state === "DISPATCHED" && !claim.executionRecordId;
}

/* ═══════════════════════════════════════════════════════
   The port
   ═══════════════════════════════════════════════════════ */

export interface ExecutionClaimRepository {
  /**
   * Wins or classifies the attempt's key. The ONLY way to obtain the right to
   * dispatch.
   *
   * A `CLAIMED`/`RECLAIMED` outcome is the sole permission to proceed. Every other
   * outcome means the caller must NOT execute.
   */
  claim(request: ExecutionClaimRequest): Promise<ExecutionClaimOutcome>;

  /** Nullable read by id. Never throws. */
  get(id: string): Promise<ExecutionClaim | null>;

  /** Nullable read by the deterministic attempt key. Never throws. */
  findByKey(idempotencyKey: string): Promise<ExecutionClaim | null>;

  /** Every claim for a task, ordered by attempt. */
  listForTask(taskId: TaskId): Promise<ExecutionClaim[]>;

  /**
   * Every claim in `DISPATCHING` — dispatch was ENTERED and no durable handle is
   * recorded. This is the claim-first reconciliation input (Step 5A-4
   * correction): a crash AFTER the external call but BEFORE the execution record
   * exists leaves exactly this row and NO record, so a record-only sweep could
   * never discover it.
   */
  listDispatching(limit?: number): Promise<ExecutionClaim[]>;

  /**
   * Every claim that still needs an operator's attention, ACROSS sweeps.
   *
   * `listDispatching` alone is not enough for recovery: an attempt that was
   * entered with no handle is promoted to `UNVERIFIED` the first time it is
   * swept, and a later sweep asked only for `DISPATCHING` would then LOSE it —
   * the doubt would be durable but undiscoverable, which is the same as absent.
   * This read therefore also returns `UNVERIFIED` rows, and a `DISPATCHED` row
   * that names no execution record (a durable identity that went missing).
   */
  listUnresolved(query?: ExecutionClaimSweepQuery): Promise<ExecutionClaim[]>;

  /**
   * Records that a RECOVERY SWEEP OBSERVED this row — the DURABLE rotation key.
   *
   * This is the whole of the sweep's progress mechanism, and it is deliberately
   * the smallest write the ledger admits: it sets `recoverySweptAt` and NOTHING
   * else. It does not change `state`, `detail`, `leaseOwner`, `leaseExpiresAt`, or
   * `updatedAt` (the row's activity timestamp), so a sweep cannot be confused with
   * work and cannot alter any recovery verdict.
   *
   * It is valid for EVERY state, including the terminal ones — the sweep may
   * observe a row whose state it must not touch, and the queue still has to
   * advance past it. A missing row is `null`, never an error.
   *
   * The timestamp is the DATABASE's clock, like every other write in the durable
   * ledger, so two instances cannot disagree about the order of the queue.
   */
  markRecoverySwept(claimId: string): Promise<ExecutionClaim | null>;

  /**
   * `CLAIMED → DISPATCHING`. The CAS is what makes "entered" a once-only fact.
   *
   * THREE conditions, all required, and the third is the correction that matters:
   *
   *   1. the state is still `CLAIMED`,
   *   2. the exact INVOCATION TOKEN owns the lease (`leaseOwner === invocationToken`) —
   *      not a string that merely looks like the same worker,
   *   3. the lease is STILL LIVE according to the STORAGE layer's own clock.
   *
   * (3) is what the runtime verification broke: `markDispatching` used to accept
   * an already-expired lease, so an invocation that stalled past its window
   * could enter dispatch on a lease another caller was entitled to reclaim.
   *
   * `receiptDetail`, when supplied, is written as part of this SAME statement —
   * the preflight receipt and the authorisation it justifies become durable in
   * one write, so no reader can observe one without the other.
   *
   * @returns the stored claim, or `null` when the CAS lost.
   */
  markDispatching(
    claimId: string,
    input: { invocationToken: string; leaseTtlMs?: number; receiptDetail?: string },
  ): Promise<ExecutionClaim | null>;

  /**
   * `DISPATCHING → DISPATCHED`. Records the durable identity of the execution.
   *
   * Requires the owning invocation token: a bare state CAS would let a stale
   * invocation attach its handle to an attempt that has moved on, and the
   * handle is the identity a reconciler adopts.
   */
  markDispatched(
    claimId: string,
    input: {
      invocationToken: string;
      executionRecordId: ExecutionRecordId;
      handleId: string;
      runtimeId?: RuntimeId;
    },
  ): Promise<ExecutionClaim | null>;

  /**
   * `CLAIMED → RELEASED`. A control refused BEFORE dispatch, so no run exists.
   *
   * Requires the owning invocation token for the same reason `markDispatched`
   * does: releasing is what makes an attempt dispatchable again, so only the
   * invocation that holds it may free it.
   */
  release(claimId: string, input: { invocationToken: string; detail: string }): Promise<ExecutionClaim | null>;

  /**
   * `CLAIMED → CANCELLED` by the invocation that reserved the attempt for a
   * cancellation (Step 5A-4 correction). Terminal: a later `claim()` on the same
   * key reports `CANCELLED` and can never dispatch.
   *
   * Requires the owning invocation token for the same reason `release` does — it
   * is the CAS that turns a live reservation into a dead one, so only the
   * invocation that won it may perform it.
   */
  markCancelled(claimId: string, input: { invocationToken: string; detail: string }): Promise<ExecutionClaim | null>;

  /**
   * ATOMICALLY reserves the EXACT attempt as `CANCELLED`, in ONE statement.
   *
   * It is the cancellation-side linearization against irreversible dispatch, and
   * it replaces the two-write `claim()` + `markCancelled()` sequence: there is no
   * intermediate `CLAIMED` row for a crash to strand and for a later lease-expiry
   * reclaim to turn into a real run of a cancelled attempt.
   *
   *   no row for the attempt          → INSERT it directly as `CANCELLED`
   *   `CLAIMED` (lease lapsed)        → flip to `CANCELLED` in the same CAS
   *   `RELEASED`                      → flip to `CANCELLED` in the same CAS
   *   `CLAIMED` (lease live)          → `IN_PROGRESS` (someone is working)
   *   `DISPATCHING`                   → `IN_PROGRESS` while live, else `UNVERIFIED`
   *   `UNVERIFIED`                    → `UNVERIFIED` (human resolution only)
   *   `DISPATCHED`                    → `EXECUTION_EXISTS` (cancel via runtime)
   *   held under a DIFFERENT key      → `CONFLICT` (never a second authority)
   *
   * The reservation is NOT a dispatch permit and never can be: every outcome
   * other than `RESERVED`/`ALREADY_CANCELLED` means the attempt is NOT safely
   * cancellable here.
   */
  reserveCancellation(request: ExecutionClaimReservationRequest): Promise<ExecutionClaimReservation>;

  /**
   * `CANCELLED → RELEASED`, by the reservation's own owning token.
   *
   * THE COMPENSATION THIS EXISTS FOR. Cancelling a mission is a multi-task
   * operation, and one task can be un-cancellable while the others were already
   * reserved `CANCELLED`. Without a way back, those earlier attempts would be
   * terminally dead while the mission itself was NOT cancelled — the mission
   * could then never progress and could never be cancelled either. Releasing
   * restores exactly the pre-reservation meaning ("no external run exists for
   * this attempt"), so the attempt is dispatchable again and nothing is stranded.
   *
   * Only `CANCELLED` rows may be released by this path, and only by the token
   * that wrote the reservation: it must be impossible to use it to free an
   * attempt that was genuinely cancelled and accepted, or one never reserved.
   */
  rollbackCancellation(claimId: string, input: { invocationToken: string; detail: string }): Promise<ExecutionClaim | null>;

  /**
   * `DISPATCHING → UNVERIFIED`. Records doubt honestly.
   *
   * This is the ONLY transition out of `DISPATCHING` other than `DISPATCHED`, and
   * it never leads back to dispatch.
   *
   * NO TOKEN IS REQUIRED, and that is deliberate rather than an omission: this is
   * the transition taken precisely when the owning invocation is presumed DEAD
   * (it timed out, its transport failed ambiguously, or a restart found the row).
   * Demanding the token would make the doubt unrecordable by the only process
   * left to record it. It is fail-closed in the direction that matters: it can
   * never produce dispatch permission, and it PRESERVES any preflight receipt
   * already written on the row (the doubt is ADDED, never overwritten).
   */
  markUnverified(claimId: string, detail: string): Promise<ExecutionClaim | null>;

  /** The recovery verdict for one claim. Never dispatches; never mutates. */
  recoveryFor(claimId: string, options?: { requester?: string }): Promise<ExecutionClaimRecovery | null>;

  /**
   * How many claims the ledger holds.
   *
   * ASYNC, and corrected in Step 5A-2: the durable adapter cannot answer a
   * count without a round trip, so a synchronous signature would have made the
   * port itself unimplementable against a database — the one thing a port must
   * never be. Callers `await` it.
   */
  count(): Promise<number>;
}

/* ═══════════════════════════════════════════════════════
   Lease helpers
   ═══════════════════════════════════════════════════════ */

function isLeaseLive(claim: ExecutionClaim, now: Date): boolean {
  if (!claim.leaseExpiresAt) return false;
  const expiresAt = new Date(claim.leaseExpiresAt).getTime();
  if (!Number.isFinite(expiresAt)) return false;
  return expiresAt > now.getTime();
}

/**
 * True when this claim's live lease is held by `token`.
 *
 * ONLY used for a write that must be performed by the owning invocation
 * (`markDispatching`, `markDispatched`, `release`). It is deliberately NOT used
 * by the claim classifier any more: there, a matching owner used to be treated
 * as permission to take the attempt a second time, which is the defect 5A-4
 * corrects.
 */
export function leaseHeldBy(claim: ExecutionClaim, token: string | undefined): boolean {
  return Boolean(token) && claim.leaseOwner === token;
}

/* ═══════════════════════════════════════════════════════
   In-memory implementation
   ═══════════════════════════════════════════════════════ */

/**
 * THE DURABLE ROTATION ORDER, spelled once.
 *
 * The in-memory reference sorts with this function and the durable adapter spells
 * the identical rule in SQL (`ORDER BY "recoverySweptAt" ASC NULLS FIRST,
 * "claimedAt" ASC, "id" ASC`), so the two ledgers cannot disagree about which row
 * is "next" — the property the paging tests assert directly.
 *
 * The three clauses, and why each is there:
 *
 *   1. NEVER SWEPT FIRST. A row recovery has not looked at is the most urgent
 *      thing in the queue, whatever its age.
 *   2. THEN LEAST RECENTLY SWEPT. `recoverySweptAt` is stamped by every sweep, so
 *      the oldest stamp is the row that has waited longest for attention. A stamp
 *      is taken from the database clock, so a freshly stamped row sorts behind
 *      every row that has not been stamped yet — which is what makes the queue
 *      advance instead of repeating.
 *   3. THEN `claimedAt`, THEN `id`. A total order, so a page boundary never
 *      depends on two rows comparing equal.
 *
 * It is ALSO the ordering of the `PREVIOUSLY_OBSERVED` lane, where the
 * `NULLS FIRST` clause cannot apply (every row in that lane has a stamp) and
 * clause (2) is the whole of it: least recently observed first is a round-robin
 * over the observed-and-still-open set.
 */
export function compareByRecoveryRotation(
  a: Pick<ExecutionClaim, "recoverySweptAt" | "claimedAt" | "id">,
  b: Pick<ExecutionClaim, "recoverySweptAt" | "claimedAt" | "id">,
): number {
  if (a.recoverySweptAt !== b.recoverySweptAt) {
    if (a.recoverySweptAt === undefined) return -1;
    if (b.recoverySweptAt === undefined) return 1;
    return a.recoverySweptAt.localeCompare(b.recoverySweptAt);
  }
  return a.claimedAt.localeCompare(b.claimedAt) || a.id.localeCompare(b.id);
}

/**
 * The `NEVER_OBSERVED` lane's order: OLDEST dispatch first, then `id`.
 *
 * The durable adapter spells the identical rule as `ORDER BY "claimedAt" ASC,
 * "id" ASC`, so "the unseen row that has waited longest" is one answer in both
 * ledgers. Note that this is a TOTAL order over a SET that shrinks as rows are
 * observed (they leave the lane), never over an offset — which is what makes
 * ``ceil(unseen / quota)`` sweeps a real bound rather than a hope.
 */
export function compareByClaimAge(
  a: Pick<ExecutionClaim, "claimedAt" | "id">,
  b: Pick<ExecutionClaim, "claimedAt" | "id">,
): number {
  return a.claimedAt.localeCompare(b.claimedAt) || a.id.localeCompare(b.id);
}

/** True when `claim` belongs to `lane`. The predicate, in ONE place. */
export function claimIsInLane(claim: Pick<ExecutionClaim, "recoverySweptAt">, lane: ExecutionClaimSweepLane): boolean {
  return lane === "PREVIOUSLY_OBSERVED" ? claim.recoverySweptAt !== undefined : claim.recoverySweptAt === undefined;
}

/**
 * The order of `lane`, as a comparator — the in-memory counterpart of the SQL
 * `ORDER BY` that lane gets in the durable adapter.
 */
export function compareInClaimLane(lane: ExecutionClaimSweepLane): (a: ExecutionClaim, b: ExecutionClaim) => number {
  if (lane === "NEVER_OBSERVED") return compareByClaimAge;
  if (lane === "PREVIOUSLY_OBSERVED") return compareByRecoveryRotation;
  // NEVER_OBSERVED_NEWEST: the same SET as NEVER_OBSERVED, read from the other end.
  return (a, b) => -compareByClaimAge(a, b);
}

export type ExecutionClaimRepositoryDeps = {
  ids: IdFactory;
  now: Clock;
};

function clone(claim: ExecutionClaim): ExecutionClaim {
  return { ...claim };
}

/**
 * The recorded reason a `DISPATCHING` attempt became `UNVERIFIED`.
 *
 * ONE spelling, shared by the in-memory reference and the durable adapter, so a
 * reviewer reading either ledger reads the same sentence.
 */
export const DISPATCHING_DOUBT_DETAIL =
  "dispatch was entered and no durable handle was recorded; the external run may have started, so this attempt must not be re-dispatched automatically";

/** The recorded reason an `UNVERIFIED` claim is still open. */
export const ALREADY_UNVERIFIED_DETAIL = "this attempt was already recorded as unverifiable";

/** Collision-free key for the in-memory `UNIQUE (taskId, attempt)` index. */
function attemptIdentityKey(taskId: string, attempt: number): string {
  return JSON.stringify([taskId, attempt]);
}

/**
 * In-memory claim ledger — the REFERENCE implementation of the semantics.
 *
 * It is not the production adapter: the whole point of the claim is that it
 * survives the process, and a `Map` does not. It exists so the recovery model can
 * be tested exhaustively and deterministically, and so the port has an
 * implementation a composition can use before the durable one lands.
 *
 * ATOMICITY. `claim()` performs its read-then-write as a SINGLE synchronous
 * critical section with no `await` inside it. That is what makes "exactly one
 * winner" true here as well as in the database: JavaScript cannot interleave two
 * synchronous sequences, so the check-and-insert cannot race itself. Moving any
 * `await` into that section would silently reintroduce the double-dispatch bug
 * this module exists to remove, so the section is isolated in
 * `insertOrClassify()` and commented as such.
 */
export class InMemoryExecutionClaimRepository implements ExecutionClaimRepository {
  private readonly byId = new Map<string, ExecutionClaim>();
  /** idempotencyKey → claim id. The unique index, in memory. */
  private readonly byKey = new Map<string, string>();
  /**
   * `taskId + attempt` → claim id. The OTHER unique index, in memory — the
   * mirror of the durable `UNIQUE (taskId, attempt)`. It exists so the reference
   * enforces attempt IDENTITY, not merely key spelling, exactly as PostgreSQL does.
   */
  private readonly byAttempt = new Map<string, string>();
  /** The last recovery stamp written, so a sweep's stamp always advances. */
  private lastStamp = Number.NEGATIVE_INFINITY;

  constructor(private readonly deps: ExecutionClaimRepositoryDeps) {}

  async claim(request: ExecutionClaimRequest): Promise<ExecutionClaimOutcome> {
    // ── CRITICAL SECTION. No `await` may appear inside this call: the
    //    read-then-write must be one uninterruptible step. ──
    return this.insertOrClassify(request);
  }

  private insertOrClassify(request: ExecutionClaimRequest): ExecutionClaimOutcome {
    const now = this.deps.now();
    const existingId = this.byKey.get(request.idempotencyKey);

    if (existingId === undefined) {
      // FAIL CLOSED on an identity mismatch. The key is absent, but this
      // `(taskId, attempt)` may already be held under a DIFFERENT key — the
      // mirror of the durable attempt-identity constraint. Attempt identity
      // governs, so refuse rather than mint a second authority for one attempt.
      const heldId = this.byAttempt.get(attemptIdentityKey(request.taskId, request.attempt));
      if (heldId !== undefined) {
        const held = this.byId.get(heldId);
        if (held) throw attemptIdempotencyMismatch(request, clone(held));
      }

      const at = now.toISOString();
      const claim: ExecutionClaim = {
        id: this.deps.ids.next("claim"),
        missionId: request.missionId,
        taskId: request.taskId,
        attempt: request.attempt,
        actorId: request.actorId,
        capabilityId: request.capabilityId,
        idempotencyKey: request.idempotencyKey,
        state: "CLAIMED",
        leaseOwner: request.leaseOwner,
        leaseExpiresAt: new Date(now.getTime() + leaseTtl(request.leaseTtlMs)).toISOString(),
        claimedAt: at,
        updatedAt: at,
      };
      if (request.runtimeId) claim.runtimeId = request.runtimeId;
      this.byId.set(claim.id, claim);
      this.byKey.set(claim.idempotencyKey, claim.id);
      this.byAttempt.set(attemptIdentityKey(claim.taskId, claim.attempt), claim.id);
      return { kind: "CLAIMED", claim: clone(claim) };
    }

    const existing = this.byId.get(existingId);
    if (!existing) {
      // The index and the store disagree: a corrupted ledger, not a caller error.
      throw new AiWorkforceError(
        "PERSISTENCE_UNAVAILABLE",
        `Execution claim index for "${request.idempotencyKey}" points at a missing row`,
        { idempotencyKey: request.idempotencyKey },
      );
    }

    // DISPATCHED — an execution exists. Adopt it; never start a second one.
    if (existing.state === "DISPATCHED") return { kind: "REPLAYED", claim: clone(existing) };

    // CANCELLED — terminal before dispatch. Never dispatch.
    if (existing.state === "CANCELLED") return { kind: "CANCELLED", claim: clone(existing) };

    // DISPATCHING that someone is actively working on: report, do not execute.
    // LIVE means live for EVERYONE — including the invocation that wrote it.
    // The old `!leaseHeldBy(existing, request.leaseOwner)` half made an owner's
    // own re-read flip its healthy DISPATCHING row to UNVERIFIED; the owner could
    // then no longer record the handle it was about to receive.
    if (existing.state === "DISPATCHING" && isLeaseLive(existing, now)) {
      return { kind: "IN_PROGRESS", claim: clone(existing) };
    }

    // DISPATCHING with a lapsed lease, or already UNVERIFIED: the run may exist.
    // This is the corrected branch — there is deliberately NO path from here to
    // a re-dispatch. A `DISPATCHING` claim is promoted to UNVERIFIED so the doubt
    // is durable rather than inferred anew on every read, and any preflight
    // receipt already on the row is PRESERVED (the doubt is added to it).
    if (existing.state === "DISPATCHING") {
      const doubt =
        "dispatch was entered and no durable handle was recorded; the external run may have started, so this attempt must not be re-dispatched automatically";
      const promoted = this.write(existing, {
        state: "UNVERIFIED",
        detail: detailWithDoubt(existing.detail, doubt),
        leaseOwner: undefined,
        leaseExpiresAt: undefined,
      });
      return { kind: "UNVERIFIED", claim: promoted, detail: doubt };
    }
    if (existing.state === "UNVERIFIED") {
      return {
        kind: "UNVERIFIED",
        claim: clone(existing),
        detail: existing.detail ?? "this attempt was already recorded as unverifiable",
      };
    }

    // CLAIMED with a live lease: wait — whoever holds it, INCLUDING a caller
    // whose token string happens to match. A matching owner is not permission for
    // a second claimant; it is the reproduced defect this batch removes.
    if (existing.state === "CLAIMED" && isLeaseLive(existing, now)) {
      return { kind: "IN_PROGRESS", claim: clone(existing) };
    }

    // CLAIMED with a lapsed lease, or RELEASED: dispatch was never entered, so
    // the attempt may legitimately be retaken. The state we read is the CAS
    // predicate, so two simultaneous reclaims cannot both win.
    const reclaimedFrom = existing.state;
    const next = this.write(existing, {
      state: "CLAIMED",
      leaseOwner: request.leaseOwner,
      leaseExpiresAt: new Date(now.getTime() + leaseTtl(request.leaseTtlMs)).toISOString(),
      detail: undefined,
    });
    return { kind: "RECLAIMED", claim: next, reclaimedFrom };
  }

  async get(id: string): Promise<ExecutionClaim | null> {
    const claim = this.byId.get(id);
    return claim ? clone(claim) : null;
  }

  async findByKey(idempotencyKey: string): Promise<ExecutionClaim | null> {
    const id = this.byKey.get(idempotencyKey);
    return id ? this.get(id) : null;
  }

  async listForTask(taskId: TaskId): Promise<ExecutionClaim[]> {
    return [...this.byId.values()]
      .filter((claim) => claim.taskId === taskId)
      .map(clone)
      .sort((a, b) => a.attempt - b.attempt || a.claimedAt.localeCompare(b.claimedAt));
  }

  async listDispatching(limit = 50): Promise<ExecutionClaim[]> {
    return [...this.byId.values()]
      .filter((claim) => claim.state === "DISPATCHING")
      .sort((a, b) => a.claimedAt.localeCompare(b.claimedAt) || a.id.localeCompare(b.id))
      .slice(0, limit)
      .map(clone);
  }

  async listUnresolved(query: ExecutionClaimSweepQuery = {}): Promise<ExecutionClaim[]> {
    const { limit = 50, missionId, order = "OLDEST_FIRST", lane } = query;
    const eligible = [...this.byId.values()]
      .filter(
        (claim) =>
          claim.state === "DISPATCHING" ||
          claim.state === "UNVERIFIED" ||
          // A DISPATCHED row with no record is a durable identity that went
          // missing: news, and discoverable — not silently skipped by the sweep.
          (claim.state === "DISPATCHED" && !claim.executionRecordId),
      )
      // The mission filter is part of the QUERY, exactly as the durable adapter's
      // WHERE clause is. Filtering in the caller is what made a mission's own
      // incident invisible behind a page of other missions' incidents.
      .filter((claim) => missionId === undefined || claim.missionId === missionId);

    // THE LANE, when the caller names one: predicate first (so the window can only
    // contain rows that belong to it), then that lane's own order. The durable
    // adapter spells the identical two statements — see its `listUnresolved`, where
    // the predicate is in the WHERE clause for the same reason.
    if (lane) {
      return eligible
        .filter((claim) => claimIsInLane(claim, lane))
        .sort(compareInClaimLane(lane))
        .slice(0, limit)
        .map(clone);
    }

    // The merged "what is next" read, for the diagnostic surface (`recoveryQueue`)
    // and for tests that page the whole ledger. The SWEEP never uses it.
    if (order === "LEAST_RECENTLY_SWEPT_FIRST") {
      return eligible.sort(compareByRecoveryRotation).slice(0, limit).map(clone);
    }
    const dir = order === "NEWEST_FIRST" ? -1 : 1;
    return eligible
      .sort((a, b) => dir * (a.claimedAt.localeCompare(b.claimedAt) || 0) || dir * a.id.localeCompare(b.id))
      .slice(0, limit)
      .map(clone);
  }

  /**
   * Stamps the rotation key and nothing else. `updatedAt` is deliberately left
   * alone: it is the row's last real WRITE, and a sweep is not a write to the
   * attempt.
   */
  async markRecoverySwept(claimId: string): Promise<ExecutionClaim | null> {
    const existing = this.byId.get(claimId);
    if (!existing) return null;
    const next: ExecutionClaim = { ...existing, recoverySweptAt: this.stamp() };
    this.byId.set(next.id, next);
    return clone(next);
  }

  /**
   * A stamp STRICTLY LATER than every stamp this ledger has already written.
   *
   * The rotation's guarantee is "the stamp a sweep writes is later than the stamps
   * already on the rows". A wall clock does not provide that on its own — a fixed
   * or millisecond-coarse test clock can hand the same instant to two sweeps, which
   * would put the same rows at the front forever and make this reference behave
   * differently from PostgreSQL, where every sweep is its own transaction and
   * `now()` therefore always advances. Enforcing it here makes the reference
   * independent of the clock it was handed, and the durable adapter's own ordering
   * test (against real PostgreSQL) asserts the two agree.
   */
  private stamp(): string {
    this.lastStamp = Math.max(this.deps.now().getTime(), this.lastStamp + 1);
    return new Date(this.lastStamp).toISOString();
  }

  async markDispatching(
    claimId: string,
    input: { invocationToken: string; leaseTtlMs?: number; receiptDetail?: string },
  ): Promise<ExecutionClaim | null> {
    const existing = this.byId.get(claimId);
    // CAS, with ALL THREE conditions the port documents: the state, the owning
    // INVOCATION token, and a lease that is still LIVE. The liveness check is the
    // runtime-verification fix — this used to accept an already-expired lease.
    if (!existing || existing.state !== "CLAIMED") return null;
    if (!leaseHeldBy(existing, input.invocationToken)) return null;
    const now = this.deps.now();
    if (!isLeaseLive(existing, now)) return null;

    const patch: Partial<ExecutionClaim> = {
      state: "DISPATCHING",
      leaseOwner: input.invocationToken,
      leaseExpiresAt: new Date(now.getTime() + leaseTtl(input.leaseTtlMs)).toISOString(),
    };
    // The receipt is committed WITH the authorisation, in one write. It must be
    // the ENVELOPE form: a bare receipt would look like a legacy plain detail to
    // every later transition and would be dropped by `detailWithDoubt`. Refuse
    // instead of writing audit evidence that cannot survive.
    if (input.receiptDetail !== undefined) {
      assertReceiptDetail(input.receiptDetail);
      patch.detail = input.receiptDetail;
    }
    return this.write(existing, patch);
  }

  async markDispatched(
    claimId: string,
    input: {
      invocationToken: string;
      executionRecordId: ExecutionRecordId;
      handleId: string;
      runtimeId?: RuntimeId;
    },
  ): Promise<ExecutionClaim | null> {
    const existing = this.byId.get(claimId);
    if (!existing || existing.state !== "DISPATCHING") return null;
    // Owning token only: attaching a handle is the identity a reconciler adopts.
    if (!leaseHeldBy(existing, input.invocationToken)) return null;

    const next: ExecutionClaim = {
      ...existing,
      state: "DISPATCHED",
      executionRecordId: input.executionRecordId,
      handleId: input.handleId,
      updatedAt: this.deps.now().toISOString(),
    };
    if (input.runtimeId ?? existing.runtimeId) next.runtimeId = input.runtimeId ?? existing.runtimeId;
    this.byId.set(next.id, next);
    return clone(next);
  }

  async release(claimId: string, input: { invocationToken: string; detail: string }): Promise<ExecutionClaim | null> {
    const existing = this.byId.get(claimId);
    // Only an un-entered claim may be released, and only by the invocation that
    // holds it. Releasing a DISPATCHING attempt would invite a later re-dispatch
    // of a run that may exist.
    if (!existing || existing.state !== "CLAIMED") return null;
    if (!leaseHeldBy(existing, input.invocationToken)) return null;
    return this.write(existing, {
      state: "RELEASED",
      detail: input.detail,
      leaseOwner: undefined,
      leaseExpiresAt: undefined,
    });
  }

  async markCancelled(claimId: string, input: { invocationToken: string; detail: string }): Promise<ExecutionClaim | null> {
    const existing = this.byId.get(claimId);
    // Only an un-entered CLAIMED attempt may be cancelled, and only by the
    // invocation that holds it. A DISPATCHING attempt may already exist outside.
    if (!existing || existing.state !== "CLAIMED") return null;
    if (!leaseHeldBy(existing, input.invocationToken)) return null;
    return this.write(existing, {
      state: "CANCELLED",
      detail: input.detail,
      leaseOwner: undefined,
      leaseExpiresAt: undefined,
    });
  }

  async markUnverified(claimId: string, detail: string): Promise<ExecutionClaim | null> {
    const existing = this.byId.get(claimId);
    if (!existing || existing.state !== "DISPATCHING") return null;
    return this.write(existing, {
      state: "UNVERIFIED",
      // PRESERVED, not replaced: the receipt that proves dispatch was authorised
      // stays byte-for-byte, and the doubt is added beside it.
      detail: detailWithDoubt(existing.detail, detail),
      leaseOwner: undefined,
      leaseExpiresAt: undefined,
    });
  }

  /**
   * ONE synchronous critical section — no `await` inside — that lands the exact
   * attempt directly in `CANCELLED`, or reports why it cannot.
   */
  async reserveCancellation(request: ExecutionClaimReservationRequest): Promise<ExecutionClaimReservation> {
    return this.reserveOrClassify(request);
  }

  private reserveOrClassify(request: ExecutionClaimReservationRequest): ExecutionClaimReservation {
    const now = this.deps.now();
    const existingId = this.byKey.get(request.idempotencyKey);

    if (existingId === undefined) {
      // The key is free. Attempt IDENTITY still governs: this `(taskId,
      // attempt)` may be held under a DIFFERENT key, and then reservation is a
      // conflict, never a second authority over one attempt.
      const heldId = this.byAttempt.get(attemptIdentityKey(request.taskId, request.attempt));
      if (heldId !== undefined) {
        const held = this.byId.get(heldId);
        if (held) return { kind: "CONFLICT", claimId: held.id, taskId: held.taskId, attempt: held.attempt };
      }
      const at = now.toISOString();
      const claim: ExecutionClaim = {
        id: this.deps.ids.next("claim"),
        missionId: request.missionId,
        taskId: request.taskId,
        attempt: request.attempt,
        actorId: request.actorId,
        capabilityId: request.capabilityId,
        idempotencyKey: request.idempotencyKey,
        state: "CANCELLED",
        // The reservation's owner: NOT a lease (there is nothing to lease on a
        // dead attempt) but the token that authorises a compensating rollback.
        leaseOwner: request.leaseOwner,
        detail: request.detail,
        claimedAt: at,
        updatedAt: at,
      };
      if (request.runtimeId) claim.runtimeId = request.runtimeId;
      this.byId.set(claim.id, claim);
      this.byKey.set(claim.idempotencyKey, claim.id);
      this.byAttempt.set(attemptIdentityKey(claim.taskId, claim.attempt), claim.id);
      return { kind: "RESERVED", claim: clone(claim), priorState: null };
    }

    const existing = this.byId.get(existingId);
    if (!existing) {
      throw new AiWorkforceError(
        "PERSISTENCE_UNAVAILABLE",
        `Execution claim index for "${request.idempotencyKey}" points at a missing row`,
        { idempotencyKey: request.idempotencyKey },
      );
    }
    // The key is held by a DIFFERENT attempt: the caller's identity has drifted.
    if (existing.taskId !== request.taskId || existing.attempt !== request.attempt) {
      return { kind: "CONFLICT", claimId: existing.id, taskId: existing.taskId, attempt: existing.attempt };
    }

    switch (existing.state) {
      case "CANCELLED":
        return { kind: "ALREADY_CANCELLED", claim: clone(existing) };
      case "DISPATCHED":
        return { kind: "EXECUTION_EXISTS", claim: clone(existing) };
      case "DISPATCHING": {
        if (isLeaseLive(existing, now)) return { kind: "IN_PROGRESS", claim: clone(existing) };
        const promoted = this.write(existing, {
          state: "UNVERIFIED",
          detail: detailWithDoubt(existing.detail, DISPATCHING_DOUBT_DETAIL),
          leaseOwner: undefined,
          leaseExpiresAt: undefined,
        });
        return { kind: "UNVERIFIED", claim: promoted, detail: DISPATCHING_DOUBT_DETAIL };
      }
      case "UNVERIFIED":
        return { kind: "UNVERIFIED", claim: clone(existing), detail: existing.detail ?? ALREADY_UNVERIFIED_DETAIL };
      case "CLAIMED": {
        if (isLeaseLive(existing, now)) return { kind: "IN_PROGRESS", claim: clone(existing) };
        const next = this.write(existing, {
          state: "CANCELLED",
          detail: request.detail,
          leaseOwner: request.leaseOwner,
          leaseExpiresAt: undefined,
        });
        return { kind: "RESERVED", claim: next, priorState: "CLAIMED" };
      }
      default: {
        // RELEASED — a control refused before dispatch, so no run exists.
        const next = this.write(existing, {
          state: "CANCELLED",
          detail: request.detail,
          leaseOwner: request.leaseOwner,
          leaseExpiresAt: undefined,
        });
        return { kind: "RESERVED", claim: next, priorState: existing.state };
      }
    }
  }

  async rollbackCancellation(
    claimId: string,
    input: { invocationToken: string; detail: string },
  ): Promise<ExecutionClaim | null> {
    const existing = this.byId.get(claimId);
    if (!existing || existing.state !== "CANCELLED") return null;
    // The RESERVATION OWNER only: releasing is what makes the attempt
    // dispatchable again, so only the invocation that reserved it may undo it.
    if (!leaseHeldBy(existing, input.invocationToken)) return null;
    return this.write(existing, {
      state: "RELEASED",
      detail: input.detail,
      leaseOwner: undefined,
      leaseExpiresAt: undefined,
    });
  }

  async recoveryFor(claimId: string, options: { requester?: string } = {}): Promise<ExecutionClaimRecovery | null> {
    const claim = this.byId.get(claimId);
    if (!claim) return null;
    return recoveryForClaim(claim, { now: this.deps.now(), ...(options.requester ? { requester: options.requester } : {}) });
  }

  async count(): Promise<number> {
    return this.byId.size;
  }

  /** The single write path, so `updatedAt` and the clone discipline cannot drift. */
  private write(existing: ExecutionClaim, patch: Partial<ExecutionClaim>): ExecutionClaim {
    const next: ExecutionClaim = { ...existing, ...patch, updatedAt: this.deps.now().toISOString() };
    // `undefined` values in `patch` mean "clear the field", and spreading keeps the
    // old value. Delete explicitly so a cleared lease is genuinely absent.
    for (const [key, value] of Object.entries(patch)) {
      if (value === undefined) delete (next as Record<string, unknown>)[key];
    }
    this.byId.set(next.id, next);
    return clone(next);
  }
}

function leaseTtl(ttlMs: number | undefined): number {
  return typeof ttlMs === "number" && Number.isFinite(ttlMs) && ttlMs > 0 ? ttlMs : DEFAULT_CLAIM_LEASE_TTL_MS;
}