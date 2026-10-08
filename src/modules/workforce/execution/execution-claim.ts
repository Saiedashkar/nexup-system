import { AiWorkforceError } from "@/modules/ai-workforce/core/errors";
import type { Clock, IdFactory } from "@/modules/ai-workforce/core/types";
import type { ActorId, CapabilityId, ExecutionRecordId, MissionId, RuntimeId, TaskId } from "../core/refs";

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

/** Default lease length. Matches `DEFAULT_EXECUTION_WAIT_TIMEOUT_MS` (120s). */
export const DEFAULT_CLAIM_LEASE_TTL_MS = 120_000;

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
  /** Which process/instance holds the claim. Not a security boundary — see `claim()`. */
  leaseOwner?: string;
  /** When the lease stops being authoritative. Absent = not live. */
  leaseExpiresAt?: string;
  /** Bounded, non-secret explanation of the current state. */
  detail?: string;
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
] as const;
export type ExecutionClaimOutcomeKind = (typeof EXECUTION_CLAIM_OUTCOME_KINDS)[number];

export type ExecutionClaimOutcome =
  | { kind: "CLAIMED"; claim: ExecutionClaim }
  | { kind: "RECLAIMED"; claim: ExecutionClaim; reclaimedFrom: ExecutionClaimState }
  | { kind: "REPLAYED"; claim: ExecutionClaim }
  | { kind: "IN_PROGRESS"; claim: ExecutionClaim }
  | { kind: "UNVERIFIED"; claim: ExecutionClaim; detail: string };

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
  /** The instance taking the claim. */
  leaseOwner: string;
  leaseTtlMs?: number;
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

export const EXECUTION_CLAIM_RECOVERY_KINDS = ["RECLAIM", "ADOPT", "IN_PROGRESS", "UNVERIFIED"] as const;
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
  /** Already `UNVERIFIED`: the doubt was already recorded and must not be re-resolved automatically. */
  "ALREADY_UNVERIFIED",
] as const;
export type ExecutionClaimRecoveryReason = (typeof EXECUTION_CLAIM_RECOVERY_REASONS)[number];

export type ExecutionClaimRecovery =
  | { kind: "RECLAIM"; reason: "CLAIMED_LEASE_EXPIRED_NO_DISPATCH" | "RELEASED_NO_DISPATCH"; claim: ExecutionClaim }
  | { kind: "ADOPT"; reason: "DISPATCHED_EXECUTION_EXISTS"; claim: ExecutionClaim; executionRecordId: ExecutionRecordId }
  | { kind: "IN_PROGRESS"; reason: "LIVE_LEASE_HELD"; claim: ExecutionClaim; leaseOwner?: string }
  | {
      kind: "UNVERIFIED";
      reason: "DISPATCHING_NO_HANDLE" | "ALREADY_UNVERIFIED";
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

  // A `DISPATCHED` row without a record is not adoptable — fall through to the
  // same doubt as `DISPATCHING`, because the durable identity is missing.
  // ONE liveness answer for the whole verdict: the caller's authoritative boolean
  // when it has one, otherwise arithmetic on the clock it supplied.
  const live = options.leaseIsLive ?? isLeaseLive(claim, options.now);

  if (claim.state === "DISPATCHING") {
    if (live && !leaseHeldBy(claim, options.requester)) {
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

  if (claim.state === "UNVERIFIED") {
    return {
      kind: "UNVERIFIED",
      reason: "ALREADY_UNVERIFIED",
      claim,
      detail: claim.detail ?? "this attempt was already recorded as unverifiable",
    };
  }

  // CLAIMED / RELEASED — dispatch was never entered.
  if (live && !leaseHeldBy(claim, options.requester)) {
    return { kind: "IN_PROGRESS", reason: "LIVE_LEASE_HELD", claim, leaseOwner: claim.leaseOwner };
  }
  return {
    kind: "RECLAIM",
    reason: claim.state === "RELEASED" ? "RELEASED_NO_DISPATCH" : "CLAIMED_LEASE_EXPIRED_NO_DISPATCH",
    claim,
  };
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
   * `CLAIMED → DISPATCHING`. The CAS is what makes "entered" a once-only fact: a
   * claim whose lease lapsed and was retaken by another process cannot be moved
   * twice.
   *
   * @returns the stored claim, or `null` when the CAS lost.
   */
  markDispatching(
    claimId: string,
    input: { leaseOwner: string; leaseTtlMs?: number },
  ): Promise<ExecutionClaim | null>;

  /** `DISPATCHING → DISPATCHED`. Records the durable identity of the execution. */
  markDispatched(
    claimId: string,
    input: { executionRecordId: ExecutionRecordId; handleId: string; runtimeId?: RuntimeId },
  ): Promise<ExecutionClaim | null>;

  /** `CLAIMED → RELEASED`. A control refused BEFORE dispatch, so no run exists. */
  release(claimId: string, detail: string): Promise<ExecutionClaim | null>;

  /**
   * `DISPATCHING → UNVERIFIED`. Records doubt honestly.
   *
   * This is the ONLY transition out of `DISPATCHING` other than `DISPATCHED`, and
   * it never leads back to dispatch.
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

function leaseHeldBy(claim: ExecutionClaim, requester: string | undefined): boolean {
  return Boolean(requester) && claim.leaseOwner === requester;
}

/* ═══════════════════════════════════════════════════════
   In-memory implementation
   ═══════════════════════════════════════════════════════ */

export type ExecutionClaimRepositoryDeps = {
  ids: IdFactory;
  now: Clock;
};

function clone(claim: ExecutionClaim): ExecutionClaim {
  return { ...claim };
}

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

    // DISPATCHING that someone is actively working on: report, do not execute.
    if (existing.state === "DISPATCHING" && isLeaseLive(existing, now) && !leaseHeldBy(existing, request.leaseOwner)) {
      return { kind: "IN_PROGRESS", claim: clone(existing) };
    }

    // DISPATCHING with a lapsed lease, or already UNVERIFIED: the run may exist.
    // This is the corrected branch — there is deliberately NO path from here to
    // a re-dispatch. A `DISPATCHING` claim is promoted to UNVERIFIED so the doubt
    // is durable rather than inferred anew on every read.
    if (existing.state === "DISPATCHING") {
      const doubt =
        existing.detail ??
        "dispatch was entered and no durable handle was recorded; the external run may have started";
      const promoted = this.write(existing, {
        state: "UNVERIFIED",
        detail: doubt,
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

    // CLAIMED with a live lease held elsewhere: wait.
    if (existing.state === "CLAIMED" && isLeaseLive(existing, now) && !leaseHeldBy(existing, request.leaseOwner)) {
      return { kind: "IN_PROGRESS", claim: clone(existing) };
    }

    // CLAIMED (lease lapsed / same owner) or RELEASED: dispatch was never entered,
    // so the attempt may legitimately be retaken. CAS on the state we read, so two
    // simultaneous reclaims cannot both win.
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

  async markDispatching(
    claimId: string,
    input: { leaseOwner: string; leaseTtlMs?: number },
  ): Promise<ExecutionClaim | null> {
    const existing = this.byId.get(claimId);
    // CAS: only a claim that is still un-entered may be entered, and only by its
    // own lease holder. Anything else means another process got there first.
    if (!existing || existing.state !== "CLAIMED") return null;
    if (existing.leaseOwner && existing.leaseOwner !== input.leaseOwner) return null;

    const now = this.deps.now();
    return this.write(existing, {
      state: "DISPATCHING",
      leaseOwner: input.leaseOwner,
      leaseExpiresAt: new Date(now.getTime() + leaseTtl(input.leaseTtlMs)).toISOString(),
    });
  }

  async markDispatched(
    claimId: string,
    input: { executionRecordId: ExecutionRecordId; handleId: string; runtimeId?: RuntimeId },
  ): Promise<ExecutionClaim | null> {
    const existing = this.byId.get(claimId);
    if (!existing || existing.state !== "DISPATCHING") return null;

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

  async release(claimId: string, detail: string): Promise<ExecutionClaim | null> {
    const existing = this.byId.get(claimId);
    // Only an un-entered claim may be released. Releasing a DISPATCHING attempt
    // would invite a later re-dispatch of a run that may exist.
    if (!existing || existing.state !== "CLAIMED") return null;
    return this.write(existing, { state: "RELEASED", detail, leaseOwner: undefined, leaseExpiresAt: undefined });
  }

  async markUnverified(claimId: string, detail: string): Promise<ExecutionClaim | null> {
    const existing = this.byId.get(claimId);
    if (!existing || existing.state !== "DISPATCHING") return null;
    return this.write(existing, { state: "UNVERIFIED", detail, leaseOwner: undefined, leaseExpiresAt: undefined });
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
