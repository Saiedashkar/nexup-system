import type { Clock } from "@/modules/ai-workforce/core/types";

import type { MissionId, TaskId } from "../core/refs";
import type { MissionState } from "../missions/mission-contracts";
import type { MissionRepository } from "../missions/mission-repository";
import type { TaskRepository } from "../missions/task-repository";
import type { TaskState } from "../missions/task-contracts";
import type { MissionOrchestrator } from "../orchestration/mission-orchestrator";
import {
  isAgentExecutionRecovery,
  isTerminalExecutionStatus,
  type AgentExecutionAdoption,
  type AgentExecutionStatus,
} from "../runtimes/agent-runtime";
import type { RuntimeRegistry } from "../runtimes/runtime-registry";

import { executionIdempotencyKeyForAttempt } from "./capability-execution-contracts";
import { claimRequiresOperatorResolution } from "./execution-claim";
import type {
  ExecutionClaim,
  ExecutionClaimRepository,
  ExecutionClaimState,
  ExecutionClaimSweepQuery,
} from "./execution-claim";
import type {
  ExecutionRecord,
  ExecutionRecordRepository,
  ExecutionRecoverableQuery,
  ExecutionRecorder,
} from "./execution-record";

/**
 * Execution reconciliation — the provider-neutral recovery service.
 *
 * The problem it exists for, stated plainly: an execution is submitted to a
 * runtime, the runtime keeps running it on its own, and the NEXUP process that
 * submitted it goes away. The provider did not stop; our ability to OBSERVE it
 * did. Before this service the mission was stuck — the runtime no longer knew
 * the handle it had minted in a previous life, so nothing could settle the
 * attempt and a human had to cancel a mission that may well have succeeded.
 *
 * What it does, per in-flight attempt:
 *
 *   1. loads the DURABLE record (handleId, providerExecutionId, actor, runtime,
 *      capability, attempt, timestamps) — never process memory;
 *   2. asks the runtime to ADOPT the execution (see `AgentExecutionRecovery`).
 *      Adoption observes; it never resubmits and never starts a second run;
 *   3. writes what it learned onto the durable record, as a RECONCILED audit
 *      event plus the runtime's own status;
 *   4. hands a confirmed-terminal attempt to the ORCHESTRATOR, so the task
 *      moves through the same state machine and the same review boundary a
 *      freshly-settled attempt does. Reconciliation adds no second way to
 *      complete a task.
 *
 * It is deliberately NOT Hermes-specific: it speaks `AgentExecutionRecovery`,
 * `RuntimeRegistry` and the repositories. A second provider adapter implements
 * the same port and this service picks it up unchanged.
 *
 * Truthful handling of every remote outcome:
 *
 *   still running            → ADOPTED_RUNNING      nothing moves, nothing faked
 *   finished while we were down
 *                            → ADOPTED_TERMINAL     SUCCEEDED/FAILED → the
 *                                                     orchestrator's own paths
 *                                                     (REVIEW, retry, CANCELLED)
 *   cancelled while we were down
 *                            → ADOPTED_TERMINAL     task and mission CANCELLED
 *   failed while we were down
 *                            → ADOPTED_TERMINAL     retry allowance decides
 *   the runtime does not know it any more
 *                            → REMOTE_UNKNOWN       status UNKNOWN_REMOTE and a
 *                                                     HUMAN decides: never a
 *                                                     fabricated FAILED, never
 *                                                     an automatic retry (the
 *                                                     run may have succeeded)
 *   the runtime cannot be asked (outage/timeout)
 *                            → RUNTIME_UNAVAILABLE  nothing changes, retry later
 *   no runtime registered    → NO_RUNTIME           reported, not invented
 *   the task already moved on → NOT_RUNNING         left alone, reported
 */

export const EXECUTION_RECONCILIATION_KINDS = [
  "ADOPTED_TERMINAL",
  "ADOPTED_RUNNING",
  "REMOTE_UNKNOWN",
  "RUNTIME_UNAVAILABLE",
  "NO_RUNTIME",
  "NOT_RUNNING",
  "ALREADY_TERMINAL",
  /**
   * The DELIVERY LEDGER says this attempt was entered without ever being
   * identified (Step 5A-4). The run may exist, so it is parked for a human — the
   * one thing reconciliation must never do here is start another attempt.
   */
  "CLAIM_UNVERIFIED",
  /** The claim's lease is still live: an invocation is actively working. Nothing to do. */
  "CLAIM_IN_PROGRESS",
] as const;
export type ExecutionReconciliationKind = (typeof EXECUTION_RECONCILIATION_KINDS)[number];

export type ExecutionReconciliation = {
  kind: ExecutionReconciliationKind;
  executionRecordId: string;
  handleId: string;
  runtimeId: string;
  status: AgentExecutionStatus;
  detail: string;
  missionId?: MissionId;
  taskId?: TaskId;
  taskState?: TaskState;
  missionState?: MissionState;
};

export type ExecutionReconcilerDeps = {
  records: ExecutionRecordRepository;
  executions: ExecutionRecorder;
  runtimes: RuntimeRegistry;
  /** Read-only access, for the task/mission a settled attempt reports back. */
  missions: MissionRepository;
  tasks: TaskRepository;
  /**
   * The ONLY way an attempt is settled: reconciliation decides nothing about
   * task state itself. It runs after the record has been updated, so the
   * orchestrator observes the same durable status a live settle would.
   */
  orchestrator: MissionOrchestrator;
  /**
   * The DELIVERY ledger (Step 5A-4). When supplied, the sweep reads it as well
   * as the execution records, so an attempt that was ENTERED but never
   * IDENTIFIED is visible and escalated rather than silently stranded.
   *
   * It is read-only in spirit: this service may CLASSIFY a claim and record a
   * doubt, and it may never acquire one. There is deliberately no `claim()` call
   * in this file, and no way for reconciliation to reacquire execution authority
   * — which is the whole reason the mission path cannot be restarted by a sweep.
   */
  claims?: ExecutionClaimRepository;
  now?: Clock;
};

/** The non-secret label recovery uses when it asks the ledger for a verdict. */
export const RECONCILIATION_REQUESTER = "reconciler";

/**
 * The disagreement between a ledger row that NAMES an execution and the record
 * being reconciled: news when the two names differ, `null` when they agree (i.e.
 * the ledger simply resolved the attempt, and normal adoption continues).
 *
 * It returns `null` rather than a string for the agreeing case on purpose: the
 * caller's contract is "a string is a doubt to escalate", so "nothing wrong here"
 * has to be spelled as an absence rather than as an empty sentence.
 */
function ledgerRecordMismatch(authoritative: ExecutionClaim, record: ExecutionRecord): string | null {
  const named = authoritative.executionRecordId;
  if (!named || named === record.id) return null;
  return `the delivery ledger names execution record "${named}" for this attempt, but "${record.id}" was observed; the two disagree`;
}

/**
 * ONE SWEEP'S TOTAL BUDGET — and the three ALLOCATIONS it is split into.
 *
 * A page, not "everything" and not an accidental entire-table read: the sweep is
 * what a scheduled job runs, so its per-query cost must not grow with the backlog
 * it is draining. What the SIXTH review changed is that the budget is SPLIT rather
 * than spent on one merged page: each lane gets a floor no other lane can eat, which
 * is what turns "a previously observed row is looked at again" from a hope into an
 * allocation. See `collectUnresolved` for the bounds this buys and their assumptions.
 *
 *   UNSEEN   never observed, oldest first   — FIFO service for work never looked at
 *   REVISIT  observed, least recently first — the round-robin the sixth review found
 *                                             unbounded (a live `DISPATCHING` claim
 *                                             whose owner then crashes lands here)
 *   NEWEST   never observed, newest first   — the freshness window
 *
 * Every share is at least one row WHEN THE BUDGET CAN HOLD THREE, so an ordinary page
 * reads one window per lane rather than dropping a lane. A budget smaller than three
 * cannot cover every lane, and is spent in the declared CONSUMPTION ORDER (UNSEEN, then
 * REVISIT, then NEWEST): the total is never exceeded, and a lane that receives nothing is
 * reported as zero rather than silently over-read. The fairness bound is therefore claimed
 * for pages that hold at least three rows — the sweep's own page is 50, and every recovery
 * caller uses it.
 */
const CLAIM_SWEEP_PAGE_SIZE = 50;

/**
 * The budget a caller's `limit` buys. `0`, a negative number, `NaN` or `Infinity` buys
 * NOTHING — an invalid budget is not a request for a default page, and it is certainly not
 * a silent one-row sweep. Anything above the page size is the page size.
 */
function sweepBudget(limit: number): number {
  if (!Number.isFinite(limit) || limit <= 0) return 0;
  return Math.min(Math.floor(limit), CLAIM_SWEEP_PAGE_SIZE);
}

/** Exported so the allocation itself can be asserted, rather than inferred from a sweep. */
export function sweepLanes(total: number): { unseen: number; revisit: number; newest: number } {
  const budget = sweepBudget(total);
  if (budget === 0) return { unseen: 0, revisit: 0, newest: 0 };
  const unseen = Math.max(1, Math.ceil(budget / 2));
  let revisit = Math.max(1, Math.floor(budget * 0.4));
  let newest = Math.max(1, budget - unseen - revisit);
  // Three floors of one OVERSPEND any budget below four (1 → 3 rows, 2 → 3, 3 → 4). Trim in
  // the REVERSE of the consumption order — NEWEST first, then REVISIT, then UNSEEN — so the
  // rows that are read are the ones the order says come first, and the total is exactly the
  // requested budget. The seventh review found the overspend at limits 1, 2 and 3.
  if (unseen + revisit + newest > budget) newest = Math.max(0, budget - unseen - revisit);
  if (unseen + revisit + newest > budget) revisit = Math.max(0, budget - unseen);
  if (unseen + revisit + newest > budget) return { unseen: budget, revisit: 0, newest: 0 };
  return { unseen, revisit, newest };
}

/**
 * ONE ROW OF THE RECOVERY QUEUE, as the LEDGER holds it.
 *
 * The rotation's position lives in the rows (`recoverySweptAt`), so this is what an
 * operator or an evidence run inspects to answer "how far behind is recovery for
 * this mission?" — a DURABLE answer, not a report about one process's memory.
 */
export type RecoveryQueueRow = {
  claimId: string;
  taskId: TaskId;
  state: ExecutionClaimState;
  claimedAt: string;
  /** When a sweep last observed it; `null` = never (which is the front of the queue). */
  recoverySweptAt: string | null;
};

/** One row of the queue, reduced to what a READ needs. */
function recoveryQueueRow(claim: ExecutionClaim): RecoveryQueueRow {
  return {
    claimId: claim.id,
    taskId: claim.taskId,
    state: claim.state,
    claimedAt: claim.claimedAt,
    recoverySweptAt: claim.recoverySweptAt ?? null,
  };
}

  /** The DURABLE state of ONE scope's recovery queue — a READ. */
export type RecoveryQueue = {
  /** The mission this queue belongs to, or `null` for the global queue. */
  missionId: MissionId | null;
  /**
   * The row the NEXT sweep of this scope takes FIRST: the oldest NEVER-OBSERVED row,
   * or — when nothing is unseen — the least recently observed one. That is the order
   * the lanes are consumed in (UNSEEN, then REVISIT, then NEWEST), so this is the
   * honest answer to "where does recovery stand for this scope?".
   */
  head: RecoveryQueueRow | null;
  /**
   * The front of the REVISIT window: the row whose turn it is among the rows a sweep
   * has ALREADY observed and that are still unresolved. This is the lane the sixth
   * review found unbounded, so it is reported separately rather than folded into
   * `head`.
   */
  observedHead: RecoveryQueueRow | null;
  /**
   * The newest unresolved row of this scope, observed or not — the OPERATOR read
   * ("what just arrived?"). When it is still unseen it is also what the freshness
   * window makes visible on the very next sweep, which is the property that window
   * exists for.
   */
  newest: RecoveryQueueRow | null;
  /** How many rows one sweep's budget holds, across the three lanes. */
  pageSize: number;
  /** The budget's split across the lanes, so a reader can check the allocations. */
  lanes: { unseen: number; revisit: number; newest: number };
};

/**
 * What happened to the doubt a sweep tried to record.
 *
 * The distinction that matters is `SUPERSEDED`: the CAS lost to a racing owner
 * that recorded a REAL execution identity, so the attempt is not doubtful at all
 * and must not be escalated. Anything else keeps the incident.
 */
type ClaimDoubtOutcome =
  | { kind: "TRANSITIONED"; detail: string }
  | { kind: "ALREADY_DOUBT"; claim: ExecutionClaim; detail: string }
  | { kind: "SUPERSEDED"; claim: ExecutionClaim }
  | { kind: "VANISHED" };

export class ExecutionReconciler {
  private readonly now: Clock;

  /**
   * THERE IS NO SWEEP STATE IN THIS CLASS, and that is the correction.
   *
   * The fourth review kept a cursor per scope in a `Map`, bounded by an LRU of 64.
   * Every supported lifecycle event wiped or truncated it: a restart began each
   * scope at the oldest end, a 65th active mission evicted an earlier scope, and
   * two instances could not see each other's progress at all. The traversal state
   * now lives in the LEDGER (`recoverySweptAt`, stamped by `markRecoverySwept`), so
   * there is nothing here to lose, evict, rewind, or race — see
   * `collectUnresolved` for the traversal and `recoveryQueue` for how it is read.
   */
  constructor(private readonly deps: ExecutionReconcilerDeps) {
    this.now = deps.now ?? (() => new Date());
  }

  /**
   * Re-adopts every in-flight attempt of one mission. Never dispatches.
   *
   * BOTH SWEEPS RUN (Step 5A-4 correction). A record-first sweep alone cannot see
   * the primary crash case — dispatch was entered, the process died, and NO
   * execution record was ever written — because there is nothing to iterate over.
   * The CLAIM-FIRST pass is therefore part of this application-level entry point
   * rather than an optional extra a caller has to remember, and it runs first:
   * discovering an unaccounted-for attempt is news even when nothing else is open.
   *
   * Both passes read ONE BOUNDED PAGE, and both are MISSION-SCOPED IN THE QUERY, so
   * a mission with its own incidents finds them wherever they sit in the global
   * queue — and both stamp what they read, so the next sweep of this scope continues
   * where this one stopped.
   */
  async reconcileMission(missionId: MissionId): Promise<ExecutionReconciliation[]> {
    const claims = await this.reconcileDispatchingClaims(CLAIM_SWEEP_PAGE_SIZE, { missionId });
    const records = await this.collectRecoverable({ limit: CLAIM_SWEEP_PAGE_SIZE, missionId });
    const adopted = await this.reconcileRecords(records);
    return [...claims, ...adopted];
  }

  /**
   * Re-adopts one bounded window of each lane, across missions.
   * This is the sweep a scheduled job or an operator action would call; it
   * shares every rule with the per-mission path — including the claim-first pass.
   */
  async reconcileInFlight(limit = 50): Promise<ExecutionReconciliation[]> {
    const claims = await this.reconcileDispatchingClaims(limit);
    const records = await this.collectRecoverable({ limit });
    const adopted = await this.reconcileRecords(records);
    return [...claims, ...adopted];
  }

  /**
   * The OPEN claim incidents of one mission — a READ, for an operator surface.
   *
   * It exists so a crash claim is not merely durable but DISCOVERABLE through the
   * application boundary: the reconciliation report is a transient return value,
   * whereas this read answers "what is still unresolved in this mission?" at any
   * later time, from the ledger alone.
   */
  async openClaimIncidents(missionId: MissionId, limit = 50): Promise<ExecutionClaim[]> {
    const claims = this.deps.claims;
    if (!claims) return [];
    // The MISSION is part of the query, not a filter applied afterwards. Reading a
    // global page and then discarding the other missions' rows (which is what this
    // used to do) makes a mission's own incident invisible as soon as enough other
    // missions' incidents sort ahead of it.
    const rows = await claims.listUnresolved({ missionId, limit });
    return rows.filter((claim) => !claim.executionRecordId);
  }

  /**
   * The DURABLE state of one scope's recovery queue — a READ.
   *
   * It replaces the old `recoverySweepProgress()`, which reported PROCESS MEMORY
   * ("this process's cursor for this scope"). That read could tell a reviewer what
   * one instance had done and nothing about what recovery would do next; and the
   * answer it gave was the thing the fifth review rejected. This one asks the
   * LEDGER: who is at the head of the queue, and who is newest. It mutates nothing
   * and is on no recovery path.
   *
   * It reads at most THREE rows (one per lane), so it is safe for an operator surface.
   */
  async recoveryQueue(missionId?: MissionId): Promise<RecoveryQueue> {
    const scope = missionId === undefined ? {} : { missionId };
    const claims = this.deps.claims;
    let unseen: ExecutionClaim | null = null;
    let observed: ExecutionClaim | null = null;
    let newest: ExecutionClaim | null = null;
    if (claims) {
      // The three LANES, one row each — exactly what the next sweep of this scope
      // takes first from each window, so a status read cannot drift from the sweep it
      // describes. Three bounded statements, and this is on no recovery path.
      unseen = (await claims.listUnresolved({ limit: 1, lane: "NEVER_OBSERVED", ...scope }))[0] ?? null;
      observed = (await claims.listUnresolved({ limit: 1, lane: "PREVIOUSLY_OBSERVED", ...scope }))[0] ?? null;
      // The OPERATOR's latest, over every unresolved row — not the freshness window,
      // which by construction holds only rows no sweep has observed yet. An operator
      // asking "what is newest here?" is not asking the sweep's question.
      newest = (await claims.listUnresolved({ limit: 1, order: "NEWEST_FIRST", ...scope }))[0] ?? null;
    }
    return {
      missionId: missionId ?? null,
      // An UNSEEN row is the next one, because that is the window a sweep consumes
      // first; only when nothing is unseen does an observed row's turn arrive. (Both
      // are reported below, so a caller that needs the revisit front exactly can ask
      // for it by name.)
      head: unseen ? recoveryQueueRow(unseen) : observed ? recoveryQueueRow(observed) : null,
      observedHead: observed ? recoveryQueueRow(observed) : null,
      newest: newest ? recoveryQueueRow(newest) : null,
      pageSize: CLAIM_SWEEP_PAGE_SIZE,
      lanes: sweepLanes(CLAIM_SWEEP_PAGE_SIZE),
    };
  }

  /**
   * The CLAIM-FIRST sweep (Step 5A-4 correction).
   *
   * A crash AFTER the durable `DISPATCHING` write (the external call may already
   * have happened) and BEFORE the execution record exists leaves a delivery-claim
   * row and NO record. The record-based sweeps above cannot discover it, because
   * there is nothing to iterate. This method reads the claim ledger directly:
   *
   *   - it NEVER redispatches and NEVER fabricates a handle;
   *   - it NEVER fabricates a successful execution record;
   *   - it records the doubt durably (`markUnverified`) and surfaces a truthful
   *     UNVERIFIED state, escalating a RUNNING task for human/operator
   *     resolution through the EXISTING review mechanism.
   *
   * It can OBSERVE and ADOPT; it never acquires execution authority.
   *
   * WHAT IT READS is `collectUnresolved` — one bounded window of each of the three
   * LANES — and what it WRITES is one stamp per row it looked at, in the ledger. The
   * lanes are what give an already-observed row a bound that arrivals cannot take; see
   * `collectUnresolved` for the windows, the bounds and their assumptions.
   */
  async reconcileDispatchingClaims(
    limit = CLAIM_SWEEP_PAGE_SIZE,
    options: { missionId?: MissionId } = {},
  ): Promise<ExecutionReconciliation[]> {
    const claims = this.deps.claims;
    if (!claims) return [];
    // `listUnresolved`, NOT `listDispatching`. The first sweep of an entered-and-
    // unidentified attempt promotes it to UNVERIFIED, and a later sweep that asked
    // only for DISPATCHING would then LOSE the incident: durable doubt that nothing
    // can rediscover is the same as no doubt at all.
    //
    // The mission filter travels IN the query (`collectUnresolved`), so a
    // mission-scoped sweep reaches its own incidents wherever they sort globally.
    const rows = await this.collectUnresolved(
      options.missionId === undefined ? { limit } : { limit, missionId: options.missionId },
    );
    const results: ExecutionReconciliation[] = [];
    for (const claim of rows) {
      // A claim that already names a record is the record path's job — but the
      // sweep still OBSERVED it, so it is still stamped below: the queue has to
      // advance past rows this pass has nothing to do about, or they would head it
      // forever.
      if (!claim.executionRecordId) {
        // `null` = the ledger moved on while this sweep ran and the attempt is no
        // longer an incident (a racing owner identified it). It is not news, and it
        // is emphatically not something to escalate.
        const result = await this.reconcileDispatchingClaim(claim);
        if (result) results.push(result);
      }
      // ── STAMPING IS THE PROGRESS ──
      // The durable rotation key is written AFTER the row has been dealt with, so a
      // sweep that dies half way leaves every row it did not reach exactly where it
      // was: they are the next sweep's head, not lost work. Writing it BEFORE would
      // let a crash push rows to the back of the queue without anything having
      // looked at them.
      await this.deps.claims!.markRecoverySwept(claim.id);
    }
    return results;
  }

  /**
   * Every unresolved claim ONE sweep should look at — ONE BOUNDED WINDOW OF EACH OF
   * THREE LANES, ONLY ONE OF WHICH IS DISJOINT FROM THE OTHER TWO (Step 5A-4, sixth
   * review; corrected by the seventh and ninth: UNSEEN and NEWEST are the same set).
   *
   * THE DEFECT THIS SHAPE EXISTS FOR. The fifth-review traversal was ONE page ordered
   * "never observed first, then least recently observed". That proves FIRST discovery
   * and says nothing about the SECOND: a steady arrival of `N` rows per sweep fills
   * the whole page with never-observed rows — exactly `N` of them can hold it
   * forever, with no growth in the backlog at all — so a row that was already
   * observed once is never reached again. The sixth review reproduced exactly that: a
   * `DISPATCHING` claim observed while its lease was live (reported
   * `CLAIM_IN_PROGRESS`) was not revisited in 20 sweeps at 60 arrivals per sweep, so
   * an owner that crashed immediately afterwards would never be noticed. The review's
   * sentence is the one to keep: "a previously swept row has no unconditional bound".
   *
   * THE FIX IS AN ALLOCATION, NOT A BETTER ORDER. Membership is decided by a
   * PREDICATE. REVISIT is disjoint from the other two; UNSEEN and NEWEST are NOT:
   *
   *   UNSEEN   `recoverySweptAt IS NULL`, oldest `claimedAt` first;
   *   REVISIT  `recoverySweptAt IS NOT NULL`, least recently observed first;
   *   NEWEST   `recoverySweptAt IS NULL`, newest `claimedAt` first.
   *
   * UNSEEN and NEWEST are the SAME SET read from both ends, so an unseen backlog
   * smaller than `u + w` appears in both windows. That is deliberate — the freshness
   * window exists to make a brand-new row visible on the next sweep — and the `seen`
   * guard below DEDUPLICATES it, so the page can return fewer than `u + v + w` rows when
   * the unseen set is small. The seventh review is right that calling the three lanes
   * "disjoint" was wrong; only REVISIT's separation from the unseen set is structural,
   * and that separation is the whole fairness argument.
   *
   * Arrivals are never-observed rows, so they can only ever enter UNSEEN or NEWEST;
   * no arrival rate, however high, can take one row of REVISIT's allocation. That is
   * the property no page size can provide on its own.
   *
   * THE BOUNDS, AND THEIR ASSUMPTIONS. With quotas `u` (UNSEEN), `v` (REVISIT) and
   * `w` (NEWEST) — see `sweepLanes` — and a scope `S`:
   *
   *   * an unresolved row of `S` that NO sweep has observed is reached within
   *     `ceil(unseen(S) / u)` sweeps of `S`. FIFO, so the ARRIVAL RATE does not enter
   *     this arithmetic at all: an arrival queues behind the rows already in the
   *     window. The NEWEST window additionally puts the `w` most recent of them in
   *     front of that queue on the very next sweep, which is what keeps a brand-new
   *     incident visible while an unseen backlog drains.
   *   * an unresolved row of `S` that HAS been observed — a live `DISPATCHING` claim
   *     whose owner later crashed, a record whose run finished after we stopped
   *     looking, a permanent incident — is revisited within `ceil(observed(S) / v)`
   *     sweeps of `S`. Each sweep stamps every row it looked at (see
   *     `reconcileDispatchingClaims`), and REVISIT reads the OLDEST stamps first, so
   *     that window is a strict round-robin over the observed-and-still-open set.
   *
   *     That arithmetic needs FOUR qualifications, which the seventh review is right
   *     to require — a strict "within K calls" is not unconditional:
   *
   *       1. STAMPS MUST ADVANCE. `recoverySweptAt` is `TIMESTAMP(3)`, and a new
   *          transaction does NOT guarantee a distinct millisecond: two sweeps in the
   *          same millisecond produce equal stamps. Equal stamps are ordered by
   *          `claimedAt, id`, so the rotation still moves forward through the window —
   *          but progress is measured in DISTINCT stamps (visits), not in calls.
   *       2. ORDERING. The bound counts rows that sort BEFORE the target by
   *          `(recoverySweptAt, claimedAt, id)`. A row that keeps arriving with an
   *          equal stamp and a LOWER id sorts ahead of a target at the back of the
   *          window; the bound is therefore unconditional only for rows already ahead
   *          of it, or when concurrent sweeps use DISTINCT stamps (which the shared
   *          stamping transaction makes the normal case).
   *       3. CONCURRENCY. Two instances sweeping the same scope can select the same
   *          window; that duplicates work and does not add visits. The bound counts
   *          distinct progress epochs, not calls.
   *       4. MEMBERSHIP. Rows may resolve or appear between sweeps. The bound is stated
   *          over the rows ahead of the target as they stood at the previous visit; a
   *          target that stays unresolved keeps moving forward through a set that only
   *          shrinks as other rows resolve.
   *
   *     What the bound does NOT assume is anything about the ARRIVAL RATE: a waiting
   *     row is never pushed behind an unlimited number of newer rows, which is exactly
   *     what "never observed first, forever" did.
   *
   * ── SHARED PROGRESS, OR PER-SCOPE? ──
   * SHARED, deliberately. The stamp is a property of the ROW, so a global sweep and a
   * mission-scoped sweep advance the SAME rotation key: there is no per-scope cursor
   * to create, store, evict or leak, and no limit on how many scopes exist.
   *
   * The consequence is stated here rather than left to be discovered: a sweep of an
   * ENCLOSING scope can re-stamp a row, which moves it to the back of its own scope's
   * REVISIT window. That cannot starve it, because A STAMP IS A VISIT — the sweep
   * that stamped it observed it and reached the same per-row verdict the scoped sweep
   * would have (recovery decisions are per row, never per scope; the scope only
   * decides which rows are IN the window). The price of one shared key is duplicated
   * work when an enclosing and a scoped sweep cover the same rows in the same window:
   * idempotent, and the same trade every single-statement CAS in this ledger makes.
   *
   * WHY PROGRESS IS DURABLE, STILL. Every visited row is stamped by
   * `markRecoverySwept`, and REVISIT's order reads that stamp, so the front of that
   * window moves FORWARD as a CONSEQUENCE OF LOOKING AT ROWS — not because a process
   * remembered where it was. There is no cursor, no wrap and no per-scope state:
   *
   *   * RESTART: a new process reads the same stamps and continues;
   *   * MULTIPLE INSTANCES: they share the stamps, so both see the same front and
   *     neither can starve the other (the worst case is duplicated work on the same
   *     window, which is idempotent);
   *   * 65 (or 65,000) MISSION SCOPES: a scope's queue is a WHERE clause and each
   *     lane is a bounded window over it, so nothing is evicted and nothing restarts.
   *
   * Nothing here promises that a full pass happens inside one call. It promises that
   * successive calls cover both halves of the ledger, in the ledger, forever.
   */
  private async collectUnresolved(options: { limit: number; missionId?: MissionId }): Promise<ExecutionClaim[]> {
    const claims = this.deps.claims!;
    const pageSize = sweepBudget(options.limit);
    // An invalid or zero budget reads NOTHING. It does not fall back to a default page and
    // it does not read one row "to make progress": a sweep that was asked for no rows must
    // not silently act on one.
    if (pageSize === 0) return [];
    const scope = options.missionId === undefined ? {} : { missionId: options.missionId };
    const lanes = sweepLanes(pageSize);
    const collected: ExecutionClaim[] = [];
    const seen = new Set<string>();

    // THE WINDOWS ARE READ BEFORE ANYTHING IS STAMPED, so a sweep's allocation is a
    // snapshot of the queue rather than a set that shifts while it is being read. The
    // `seen` guard covers the ONE overlap the predicates admit: UNSEEN and NEWEST are
    // the same SET read from two ends, so an unseen backlog smaller than `u + w` is in
    // both windows.
    const window = async (query: ExecutionClaimSweepQuery): Promise<void> => {
      for (const row of await claims.listUnresolved(query)) {
        if (seen.has(row.id)) continue;
        seen.add(row.id);
        collected.push(row);
      }
    };
    await window({ limit: lanes.unseen, lane: "NEVER_OBSERVED", ...scope });
    await window({ limit: lanes.revisit, lane: "PREVIOUSLY_OBSERVED", ...scope });
    await window({ limit: lanes.newest, lane: "NEVER_OBSERVED_NEWEST", ...scope });

    return collected;
  }

  /**
   * The RECORD half of the same traversal: one bounded window of each of the two
   * record lanes.
   *
   * The claim lanes' argument holds here without a freshness window — the case that
   * matters is a record that finished AFTER its first observation, which is a
   * PREVIOUSLY-OBSERVED row and therefore needs REVISIT. `listRecoverable` puts the
   * terminal filter and the lane predicate in the QUERY, before `LIMIT`, so a pile of
   * recently finished attempts can consume neither window.
   */
  private async collectRecoverable(options: { limit: number; missionId?: MissionId }): Promise<ExecutionRecord[]> {
    const pageSize = sweepBudget(options.limit);
    if (pageSize === 0) return [];
    const scope = options.missionId === undefined ? {} : { missionId: options.missionId };
    const lanes = sweepLanes(pageSize);
    // Records have no freshness lane, so the page reads UNSEEN and REVISIT only — at most
    // `u + v` rows, and never more than the caller asked for (the seventh review's small-
    // budget finding applies here too: `sweepLanes(1)` is ONE row, all of it UNSEEN —
    // `{unseen: 1, revisit: 0, newest: 0}` — so there is no REVISIT window at all).
    const recordRevisit = Math.min(lanes.revisit, pageSize - lanes.unseen);
    const collected: ExecutionRecord[] = [];
    const seen = new Set<string>();
    const window = async (query: ExecutionRecoverableQuery): Promise<void> => {
      for (const row of await this.deps.records.listRecoverable(query)) {
        if (seen.has(row.id)) continue;
        seen.add(row.id);
        collected.push(row);
      }
    };
    await window({ limit: lanes.unseen, lane: "NEVER_OBSERVED", ...scope });
    await window({ limit: recordRevisit, lane: "PREVIOUSLY_OBSERVED", ...scope });
    return collected;
  }

  /** One unresolved `DISPATCHING` claim with NO execution record. */
  private async reconcileDispatchingClaim(claim: ExecutionClaim): Promise<ExecutionReconciliation | null> {
    const claims = this.deps.claims!;
    const base = {
      executionRecordId: claim.executionRecordId ?? "",
      handleId: claim.handleId ?? "",
      runtimeId: claim.runtimeId ?? "",
      missionId: claim.missionId,
      taskId: claim.taskId,
    };

    const recovery = await claims.recoveryFor(claim.id, { requester: RECONCILIATION_REQUESTER });
    if (recovery?.kind === "IN_PROGRESS") {
      return {
        ...base,
        kind: "CLAIM_IN_PROGRESS",
        status: "UNKNOWN",
        detail: "dispatch is live; the owning invocation is still working",
      };
    }

    const UNRESOLVED =
      "dispatch was entered with no execution record; the external run may exist, so this attempt must not be re-dispatched and requires operator resolution";
    let detail = recovery?.kind === "UNVERIFIED" ? recovery.detail : UNRESOLVED;

    // Record the doubt DURABLY, once (CAS from DISPATCHING), and never fabricate
    // an execution record. A racing owner that recorded a real handle first wins
    // and this loses — and a LOSS IS NOT A STALER SNAPSHOT TO REPORT FROM: the
    // authoritative row is re-read and followed, so a race cannot produce an
    // escalation about an attempt the ledger can now identify.
    if (recovery?.kind === "UNVERIFIED") {
      const outcome = await this.recordDoubt(claim, recovery.detail);
      // Superseded or gone: not an incident any more. The record-first pass (which
      // runs immediately after this one, and sees the execution record the racing
      // owner just wrote) is what handles it.
      if (outcome.kind === "SUPERSEDED" || outcome.kind === "VANISHED") return null;
      // The authoritative spellings, not the snapshot's: a sweep that lost its CAS
      // to another sweep reports the reason the LEDGER holds.
      detail = outcome.detail;
    }

    // Surface the incident for a HUMAN — for BOTH a RUNNING and a non-RUNNING
    // task (Step 5A-4 correction).
    //
    //   RUNNING:   through the EXISTING review mechanism, so it lands in the
    //              Decision Queue an operator already reads.
    //   otherwise: there is no review to park. The most common shape is a crash
    //              BETWEEN `markDispatching` and the task's own CAS to RUNNING, so
    //              the task is still READY — and the task state machine has no
    //              READY→REVIEW edge, nor is there an execution record to review.
    //              The DURABLE incident is therefore the claim row itself, which
    //              `markUnverified` has just written and which `listUnresolved`
    //              keeps discovering on every later sweep. Saying so explicitly
    //              beats leaving an operator to infer why nothing moved.
    const task = await this.deps.tasks.get(claim.taskId);
    if (task && task.state === "RUNNING") {
      await this.deps.orchestrator.escalateUnverifiedExecution(claim.missionId, claim.taskId, { detail });
    } else if (task) {
      detail = `${detail}; the task is ${task.state} and holds no execution record, so the durable claim row is the operator's incident record`;
    } else {
      detail = `${detail}; no task "${claim.taskId}" exists for this claim`;
    }

    return { ...base, kind: "CLAIM_UNVERIFIED", status: "UNKNOWN", detail };
  }

  /**
   * Records the doubt on ONE claim, and reports what the LEDGER now says.
   *
   * `markUnverified` is a CAS on `state = 'DISPATCHING'`, and it can lose for a
   * reason that must not be ignored: a racing owner FINALISED the attempt
   * (`DISPATCHING → DISPATCHED`) between this sweep's read and its write. The row
   * the sweep is holding is then a STALE SNAPSHOT, and acting on it would ask a
   * human to resolve a run whose identity is durably recorded — a false
   * escalation, and precisely the class of bug this correction removes.
   *
   * So a losing CAS is never guessed at. The authoritative row is re-read, and the
   * ANSWER decides:
   *
   *   TRANSITIONED   our write landed; the doubt is durable and ours to report.
   *   ALREADY_DOUBT  the row the ledger holds still needs an operator (it is
   *                  `UNVERIFIED`, or a `DISPATCHED` row that cannot name its
   *                  execution). Escalating is legitimate — it is the DURABLE row
   *                  we are escalating from, not a snapshot.
   *   SUPERSEDED     the ledger now NAMES an execution. No incident, no escalation.
   *   VANISHED       the row cannot be read at all, so no durable doubt exists to
   *                  report. Nothing is invented to fill the gap.
   */
  private async recordDoubt(claim: ExecutionClaim, detail: string): Promise<ClaimDoubtOutcome> {
    const claims = this.deps.claims!;
    const written = await claims.markUnverified(claim.id, detail);
    if (written) return { kind: "TRANSITIONED", detail: written.detail ?? detail };

    const authoritative = await claims.get(claim.id);
    if (!authoritative) return { kind: "VANISHED" };
    if (claimRequiresOperatorResolution(authoritative)) {
      return { kind: "ALREADY_DOUBT", claim: authoritative, detail: authoritative.detail ?? detail };
    }
    return { kind: "SUPERSEDED", claim: authoritative };
  }

  private async reconcileRecords(records: readonly ExecutionRecord[]): Promise<ExecutionReconciliation[]> {
    // The page arrives already ELIGIBLE — `listRecoverable` excluded terminal
    // attempts in the QUERY, before `LIMIT`, which is what stops a pile of finished
    // attempts from consuming the page (Step 5A-4, fifth review). The filter below
    // is therefore a belt to that braces, kept for the RACE: an attempt that became
    // terminal between the read and the adoption, because another process settled it
    // first. That IS news and is reported as `ALREADY_TERMINAL`, never thrown.
    //
    // The sort is for a DETERMINISTIC REPORT only. Which rows are in the page was
    // decided by the durable rotation in the repository.
    const inFlight = records
      .filter((record) => !isTerminalExecutionStatus(record.status))
      .sort((a, b) => a.startedAt.localeCompare(b.startedAt) || a.id.localeCompare(b.id));

    const results: ExecutionReconciliation[] = [];
    for (const record of inFlight) {
      results.push(await this.reconcileOne(record));
      // The same rule as the claim sweep: the page is stamped AFTER each attempt has
      // been dealt with, so the next sweep of this scope continues past it — in the
      // DATABASE, not in this process. Nothing about a restart, a second instance, or
      // a mission count can move this queue backwards.
      await this.deps.records.markRecoverySwept(record.id);
    }
    return results;
  }

  /**
   * The claim ledger's verdict for this attempt's record.
   *
   *   `null`         no doubt to record: adoption may proceed normally.
   *   IN_PROGRESS    a live lease owns it; leave it entirely alone.
   *   a string       the doubt, having been made DURABLE in the ledger first.
   */
  private async claimVerdictFor(record: ExecutionRecord): Promise<string | null | "IN_PROGRESS"> {
    const claims = this.deps.claims;
    if (!claims || !record.taskId) return null;
    const key = record.idempotencyKey ?? executionIdempotencyKeyForAttempt(record.taskId, record.attempt);
    const claim = await claims.findByKey(key);
    if (!claim) return null;
    // A claim that already names THIS record has been finalised: normal adoption.
    if (claim.state === "DISPATCHED") return null;

    const recovery = await claims.recoveryFor(claim.id, { requester: RECONCILIATION_REQUESTER });
    if (recovery?.kind === "IN_PROGRESS") return "IN_PROGRESS";

    if (claim.state === "DISPATCHING") {
      // Expired `DISPATCHING`: the doubt is recorded ONCE, durably, and the
      // attempt is never redispatched. `markUnverified` CASes on the state, so a
      // racing owner that recorded a real handle first wins and this loses — and
      // a LOSS IS RESOLVED FROM THE AUTHORITATIVE ROW, never from this snapshot.
      // Reporting the snapshot's doubt after losing would escalate a human about
      // an attempt the ledger has since identified.
      const detail =
        recovery?.kind === "UNVERIFIED" && recovery.detail
          ? recovery.detail
          : "dispatch was entered and no durable handle exists; the external run may have started, so this attempt must not be re-dispatched automatically";
      const outcome = await this.recordDoubt(claim, detail);
      if (outcome.kind === "TRANSITIONED" || outcome.kind === "ALREADY_DOUBT") return outcome.detail;
      // The ledger now names an execution: ordinary adoption resumes below. (If it
      // names a DIFFERENT record than the one being reconciled, that disagreement
      // is still news and is reported.)
      if (outcome.kind === "SUPERSEDED") return ledgerRecordMismatch(outcome.claim, record);
      return null;
    }

    // A record exists but the ledger says no dispatch was ever entered (CLAIMED /
    // RELEASED). The two durable truths disagree, so the safe answer is doubt —
    // but the verdict is stated from the row the LEDGER holds now, not from the
    // snapshot this pass read earlier, so a row that has moved on to `DISPATCHED`
    // is adoption rather than an alarm.
    const authoritative = await claims.get(claim.id);
    if (!authoritative) return null;
    if (authoritative.state === "DISPATCHED") return ledgerRecordMismatch(authoritative, record);
    if (claimRequiresOperatorResolution(authoritative)) {
      return (
        authoritative.detail ??
        `the delivery ledger reports "${authoritative.state}" for an attempt that has an execution record; the two disagree`
      );
    }
    return `the delivery ledger reports "${authoritative.state}" for an attempt that has an execution record; the two disagree`;
  }

  private async reconcileOne(record: ExecutionRecord): Promise<ExecutionReconciliation> {
    const base = {
      executionRecordId: record.id,
      handleId: record.handleId,
      runtimeId: record.runtimeId,
      ...(record.missionId ? { missionId: record.missionId } : {}),
      ...(record.taskId ? { taskId: record.taskId } : {}),
    };

    if (isTerminalExecutionStatus(record.status)) {
      return { ...base, kind: "ALREADY_TERMINAL", status: record.status, detail: `attempt is already ${record.status}` };
    }

    // A record can outlive its task's RUNNING state (a human cancelled the
    // mission, the task failed by review). Adopting it then would resurrect a
    // task the state machine has already closed, so it is left alone — and
    // SAID, rather than silently skipped.
    const task = record.taskId ? await this.deps.tasks.get(record.taskId) : null;
    if (task && task.state !== "RUNNING") {
      return {
        ...base,
        kind: "NOT_RUNNING",
        status: record.status,
        taskState: task.state,
        detail: `task is ${task.state}; there is no running attempt to adopt`,
      };
    }

    // ── CLAIM-AWARENESS (Step 5A-4) ──
    // Before asking a runtime anything, ask the DELIVERY ledger. A `DISPATCHING`
    // attempt whose lease lapsed is the case this exists for: no handle was ever
    // recorded, and the run may exist. It is parked for a human. An attempt whose
    // lease is still live belongs to an invocation that is still working, so
    // nothing is touched at all.
    const claimVerdict = await this.claimVerdictFor(record);
    if (claimVerdict === "IN_PROGRESS") {
      return {
        ...base,
        kind: "CLAIM_IN_PROGRESS",
        status: record.status,
        detail: "the claim ledger shows a live lease; the owning invocation is still working",
      };
    }
    if (claimVerdict) {
      const detail = claimVerdict;
      await this.deps.executions.noteReconciliation(record.id, detail);
      if (record.missionId && record.taskId) {
        await this.deps.orchestrator.escalateUnverifiedExecution(record.missionId, record.taskId, { detail });
      }
      return { ...base, kind: "CLAIM_UNVERIFIED", status: record.status, detail };
    }

    const runtime = this.deps.runtimes.get(record.runtimeId);
    if (!runtime) {
      const detail = `no runtime is registered for id "${record.runtimeId}"; the attempt cannot be observed in this process`;
      await this.deps.executions.noteReconciliation(record.id, detail);
      return { ...base, kind: "NO_RUNTIME", status: record.status, detail };
    }

    if (!isAgentExecutionRecovery(runtime)) {
      const detail = `runtime "${record.runtimeId}" does not implement execution adoption; the attempt cannot be re-adopted`;
      await this.deps.executions.noteReconciliation(record.id, detail);
      return { ...base, kind: "RUNTIME_UNAVAILABLE", status: record.status, detail };
    }

    let adoption: AgentExecutionAdoption;
    try {
      adoption = await runtime.adoptExecution({
        handleId: record.handleId,
        runtimeId: record.runtimeId,
        ...(record.providerExecutionId ? { providerExecutionId: record.providerExecutionId } : {}),
        actorId: record.actorId,
        capabilityId: record.capabilityId,
        ...(record.missionId ? { missionId: record.missionId } : {}),
        ...(record.taskId ? { taskId: record.taskId } : {}),
        attempt: record.attempt,
      });
    } catch (error) {
      // A THROW is an outage, not knowledge: the adapter itself failed. Record
      // the attempt and leave the state untouched, so nothing looks verified.
      const detail = `adoption failed: ${error instanceof Error ? error.message : "unknown runtime error"}`;
      await this.deps.executions.noteReconciliation(record.id, detail);
      return { ...base, kind: "RUNTIME_UNAVAILABLE", status: record.status, detail };
    }

    if (adoption.kind === "UNAVAILABLE") {
      const detail = `runtime could not report on this execution: ${adoption.detail}`;
      await this.deps.executions.noteReconciliation(record.id, detail);
      return { ...base, kind: "RUNTIME_UNAVAILABLE", status: record.status, detail };
    }

    // Both remaining shapes are KNOWLEDGE, and both are written down. UNKNOWN
    // becomes an explicit UNKNOWN status with an UNKNOWN_REMOTE error: the
    // attempt is unverified, and a human decides. It is never FAILED, because
    // an automatic retry off the back of "we lost track of it" could duplicate a
    // run that actually succeeded.
    let status: AgentExecutionStatus;
    let detail: string;
    let reconciled: ExecutionRecord;
    if (adoption.kind === "UNKNOWN") {
      status = "UNKNOWN";
      detail = `the runtime no longer knows this execution: ${adoption.detail}`;
      reconciled = await this.deps.executions.reconcile(record.id, {
        status,
        detail,
        error: { category: "UNKNOWN_REMOTE", message: adoption.detail, retryable: false },
      });
    } else {
      const reported = adoption.record;
      status = reported.status;
      detail = `re-adopted from the runtime; it reports ${reported.status}`;
      reconciled = await this.deps.executions.reconcile(record.id, {
        status,
        detail,
        ...(reported.providerExecutionId ? { providerExecutionId: reported.providerExecutionId } : {}),
        ...(reported.completedAt ? { completedAt: reported.completedAt } : {}),
        ...(reported.durationMs !== undefined ? { durationMs: reported.durationMs } : {}),
        ...(reported.output !== undefined ? { output: reported.output } : {}),
        ...(reported.outputText !== undefined ? { outputText: reported.outputText } : {}),
        ...(reported.error ? { error: reported.error } : {}),
      });
    }
    const unverifiable = adoption.kind === "UNKNOWN";

    // An UNVERIFIABLE attempt never flows through `settleTask`: the runtime has
    // no handle to wait on, and — more importantly — settling it would mean
    // choosing a state we do not know. It is escalated to a human instead.
    if (unverifiable && record.missionId && record.taskId) {
      const escalated = await this.deps.orchestrator.escalateUnverifiedExecution(record.missionId, record.taskId, {
        detail,
      });
      const escalatedMission = await this.deps.missions.get(record.missionId);
      return {
        ...base,
        kind: "REMOTE_UNKNOWN",
        status: reconciled.status,
        taskState: escalated.state,
        ...(escalatedMission ? { missionState: escalatedMission.state } : {}),
        detail,
      };
    }

    if (!isTerminalExecutionStatus(reconciled.status)) {
      return { ...base, kind: "ADOPTED_RUNNING", status: reconciled.status, detail };
    }

    // Confirmed terminal: the SAME settle path a live dispatch uses decides what
    // happens to the task (REVIEW, retry, CANCELLED) and to the mission.
    if (!record.missionId || !record.taskId) {
      return {
        ...base,
        kind: "ADOPTED_TERMINAL",
        status: reconciled.status,
        detail: `${detail}; the record carries no task to settle`,
      };
    }

    const outcome = await this.deps.orchestrator.settleTask(record.missionId, record.taskId);
    const mission = await this.deps.missions.get(record.missionId);
    return {
      ...base,
      kind: "ADOPTED_TERMINAL",
      status: reconciled.status,
      taskState: outcome.state,
      ...(mission ? { missionState: mission.state } : {}),
      detail,
    };
  }
}
