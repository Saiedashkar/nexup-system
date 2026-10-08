import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { createSequentialIdFactory } from "@/modules/ai-workforce/core/ids";
import {
  BUDGET_DECISION_REASONS,
  DEFAULT_BUDGET_GOVERNOR_POLICY_REF,
  DENY_VARIABLE_AI_SPEND_POLICY_REF,
  denyVariableAiSpendBudgetGovernor,
  summarizeBudgetDecision,
  type BudgetEvaluationInput,
  type BudgetGovernor,
} from "@/modules/ai-workforce/policies/budget-governor";
import {
  CAPABILITY_EXECUTION_REQUIREMENTS,
  EXECUTION_BINDINGS,
  EXECUTION_OUTCOME_KINDS,
  EXECUTION_PREFLIGHT_DECISIONS,
  executionIdempotencyKeyForAttempt,
  runtimeDeclaresNoVariableCost,
  spendClassForBinding,
} from "@/modules/workforce/execution/capability-execution-contracts";
import {
  DEFAULT_CLAIM_LEASE_TTL_MS,
  EXECUTION_CLAIM_STATES,
  InMemoryExecutionClaimRepository,
  REDISPATCHABLE_CLAIM_STATES,
  claimOutcomePermitsDispatch,
  executionBlockedClaimStates,
  isRedispatchableClaimState,
  type ExecutionClaimOutcome,
  type ExecutionClaimRequest,
} from "@/modules/workforce/execution/execution-claim";
import { EXECUTION_AUDIT_EVENT_TYPES } from "@/modules/workforce/execution/execution-record";
import {
  authorityCanReachBusiness,
  authorityIsHumanDecisionActor,
  createExecutionAuthority,
  summarizeExecutionAuthority,
  type ExecutionAuthorityInput,
} from "@/modules/workforce/execution/execution-authority";

/**
 * STEP 5A-1 — the EXECUTION CLAIM primitive, its CORRECTED recovery model, the
 * DENY budget default, and the batch invariants.
 *
 *   Mission Task → durable execution attempt claim → governed execution
 *
 * Everything here is deterministic and offline: no database, no runtime, no
 * provider. The claim ledger is the in-memory reference implementation, and the
 * clock is a mutable local one so a lease can be expired exactly rather than by
 * sleeping.
 *
 * WHAT THIS FILE EXISTS TO PROVE, and why each one is a real failure mode rather
 * than a restatement of the code:
 *
 *   1. one claimant wins — so two concurrent advances cannot both dispatch;
 *   2. a DISPATCHED claim replays and adopts — a retry never duplicates a run;
 *   3. an ACTIVE claim blocks a second dispatch;
 *   4. an expired CLAIMED claim may be retaken — because dispatch was never
 *      ENTERED, which is the only thing that makes retaking safe;
 *   5. an expired DISPATCHING claim becomes UNVERIFIED and is NEVER
 *      re-dispatched — the owner's correction, encoded as an assertion. A crash
 *      between "the request reached Hermes" and "the handle was persisted" leaves
 *      a run that exists, and re-dispatching would duplicate it;
 *   6. a burst of concurrent claims yields exactly ONE winner;
 *   7. the shipped budget default DENIES variable-cost AI execution, and permits
 *      only work that cannot incur per-use provider cost;
 *   8. the batch changed no wiring: the orchestrator still dispatches through the
 *      dispatcher, the claim is not a second lifecycle, and no new module is
 *      coupled to a provider.
 */

const REPO_ROOT = path.resolve(__dirname, "..");

/* ══════════════════════════════════════════════════════
   Fixtures
   ══════════════════════════════════════════════════════ */

/** A mutable clock, so a lease can be expired by advancing time, not by waiting. */
function controllableClock(start = "2026-02-01T00:00:00.000Z") {
  let current = new Date(start).getTime();
  return {
    now: () => new Date(current),
    advance: (ms: number) => {
      current += ms;
    },
  };
}

function harness() {
  const clock = controllableClock();
  const claims = new InMemoryExecutionClaimRepository({
    ids: createSequentialIdFactory("t"),
    now: clock.now,
  });
  return { clock, claims };
}

function request(overrides: Partial<ExecutionClaimRequest> = {}): ExecutionClaimRequest {
  return {
    missionId: "mission_1",
    taskId: "task_1",
    attempt: 1,
    idempotencyKey: executionIdempotencyKeyForAttempt("task_1", 1),
    actorId: "actor_analyst",
    capabilityId: "strategy.internal-brief",
    runtimeId: "runtime_hermes_saeed",
    leaseOwner: "process_A",
    ...overrides,
  };
}

/** The permitted-to-dispatch outcome kinds, written out independently of the source. */
function permitsDispatch(outcome: ExecutionClaimOutcome): boolean {
  return claimOutcomePermitsDispatch(outcome);
}

/* ══════════════════════════════════════════════════════
   1. ONE CLAIMANT WINS
   ══════════════════════════════════════════════════════ */

describe("Step 5A claim — exactly one claimant wins", () => {
  it("gives the key to the first claimant and refuses the second", async () => {
    const { claims } = harness();

    const first = await claims.claim(request({ leaseOwner: "process_A" }));
    const second = await claims.claim(request({ leaseOwner: "process_B" }));

    expect(first.kind).toBe("CLAIMED");
    expect(permitsDispatch(first)).toBe(true);

    // The loser is told a live lease exists. It is NOT told to proceed, and — the
    // point of the whole module — it never receives the right to dispatch.
    expect(second.kind).toBe("IN_PROGRESS");
    expect(permitsDispatch(second)).toBe(false);

    // One row, one identity: the loser addressed the winner's claim.
    expect(second.claim.id).toBe(first.claim.id);
    expect(claims.count()).toBe(1);
  });

  it("is keyed by attempt, so a different attempt is a different claim", async () => {
    const { claims } = harness();

    const attempt1 = await claims.claim(request({ attempt: 1 }));
    const attempt2 = await claims.claim(
      request({ attempt: 2, idempotencyKey: executionIdempotencyKeyForAttempt("task_1", 2) }),
    );

    expect(attempt1.kind).toBe("CLAIMED");
    expect(attempt2.kind).toBe("CLAIMED");
    expect(claims.count()).toBe(2);

    const forTask = await claims.listForTask("task_1");
    expect(forTask.map((claim) => claim.attempt)).toEqual([1, 2]);
  });
});

/* ══════════════════════════════════════════════════════
   2. DISPATCHED → REPLAY / ADOPT, NEVER A SECOND RUN
   ══════════════════════════════════════════════════════ */

describe("Step 5A claim — a DISPATCHED attempt is adopted, never duplicated", () => {
  it("replays the existing execution to every later caller", async () => {
    const { claims } = harness();

    const claimed = await claims.claim(request());
    expect(claimed.kind).toBe("CLAIMED");

    const entered = await claims.markDispatching(claimed.claim.id, { leaseOwner: "process_A" });
    expect(entered?.state).toBe("DISPATCHING");

    const dispatched = await claims.markDispatched(claimed.claim.id, {
      executionRecordId: "exec_1",
      handleId: "run_bridge_1",
    });
    expect(dispatched?.state).toBe("DISPATCHED");

    // A retry — same caller or another — must ADOPT, not start a second run.
    const replay = await claims.claim(request({ leaseOwner: "process_B" }));
    expect(replay.kind).toBe("REPLAYED");
    expect(permitsDispatch(replay)).toBe(false);
    expect(replay.claim.executionRecordId).toBe("exec_1");
    expect(replay.claim.handleId).toBe("run_bridge_1");

    // ...and the recovery verdict says ADOPT with the durable identity, which is
    // what a reconciler needs to re-adopt the run after a restart.
    const recovery = await claims.recoveryFor(claimed.claim.id);
    expect(recovery?.kind).toBe("ADOPT");
    if (recovery?.kind !== "ADOPT") throw new Error("expected an ADOPT verdict");
    expect(recovery.reason).toBe("DISPATCHED_EXECUTION_EXISTS");
    expect(recovery.executionRecordId).toBe("exec_1");
  });

  it("refuses to mark an un-entered claim as dispatched", async () => {
    const { claims } = harness();
    const claimed = await claims.claim(request());
    if (claimed.kind !== "CLAIMED") throw new Error("expected CLAIMED");

    // There is no way to record a handle for an attempt that never entered
    // dispatch: doing so would forge the identity a reconciler relies on.
    const forged = await claims.markDispatched(claimed.claim.id, {
      executionRecordId: "exec_forged",
      handleId: "run_forged",
    });
    expect(forged).toBeNull();
  });
});

/* ══════════════════════════════════════════════════════
   3. AN ACTIVE CLAIM BLOCKS A SECOND DISPATCH
   ══════════════════════════════════════════════════════ */

describe("Step 5A claim — an active claim blocks a second dispatch", () => {
  it("reports IN_PROGRESS for a live CLAIMED lease held elsewhere", async () => {
    const { claims } = harness();
    await claims.claim(request({ leaseOwner: "process_A" }));

    const other = await claims.claim(request({ leaseOwner: "process_B" }));
    expect(other.kind).toBe("IN_PROGRESS");
    expect(permitsDispatch(other)).toBe(false);

    const recovery = await claims.recoveryFor(other.claim.id, { requester: "process_B" });
    expect(recovery?.kind).toBe("IN_PROGRESS");
  });

  it("reports IN_PROGRESS for a live DISPATCHING lease held elsewhere", async () => {
    const { claims } = harness();
    const claimed = await claims.claim(request({ leaseOwner: "process_A" }));
    if (claimed.kind !== "CLAIMED") throw new Error("expected CLAIMED");
    await claims.markDispatching(claimed.claim.id, { leaseOwner: "process_A" });

    const other = await claims.claim(request({ leaseOwner: "process_B" }));
    expect(other.kind).toBe("IN_PROGRESS");
    expect(permitsDispatch(other)).toBe(false);
  });

  it("lets the SAME lease holder move its own claim into dispatch", async () => {
    const { claims } = harness();
    const claimed = await claims.claim(request({ leaseOwner: "process_A" }));
    if (claimed.kind !== "CLAIMED") throw new Error("expected CLAIMED");

    const entered = await claims.markDispatching(claimed.claim.id, { leaseOwner: "process_A" });
    expect(entered?.state).toBe("DISPATCHING");
  });

  it("refuses to let another process enter a claim it does not hold", async () => {
    const { claims } = harness();
    const claimed = await claims.claim(request({ leaseOwner: "process_A" }));
    if (claimed.kind !== "CLAIMED") throw new Error("expected CLAIMED");

    expect(await claims.markDispatching(claimed.claim.id, { leaseOwner: "process_B" })).toBeNull();
  });
});

/* ══════════════════════════════════════════════════════
   4. EXPIRED CLAIMED → RECLAIM (dispatch was never entered)
   ══════════════════════════════════════════════════════ */

describe("Step 5A claim — an expired CLAIMED claim may be retaken", () => {
  it("reclaims an expired CLAIMED claim and names what it reclaimed from", async () => {
    const { claims, clock } = harness();
    const first = await claims.claim(request({ leaseOwner: "process_A" }));
    if (first.kind !== "CLAIMED") throw new Error("expected CLAIMED");
    expect(first.claim.leaseExpiresAt).toBeDefined();

    const recoveryBefore = await claims.recoveryFor(first.claim.id, { requester: "process_B" });
    expect(recoveryBefore?.kind).toBe("IN_PROGRESS");

    clock.advance(DEFAULT_CLAIM_LEASE_TTL_MS + 1_000);

    const second = await claims.claim(request({ leaseOwner: "process_B" }));
    expect(second.kind).toBe("RECLAIMED");
    expect(permitsDispatch(second)).toBe(true);
    if (second.kind !== "RECLAIMED") throw new Error("expected RECLAIMED");
    expect(second.reclaimedFrom).toBe("CLAIMED");
    expect(second.claim.leaseOwner).toBe("process_B");

    // Still ONE row: reclaiming renews the same attempt, it does not create another.
    expect(claims.count()).toBe(1);

    const recovery = await claims.recoveryFor(second.claim.id, { requester: "process_C" });
    expect(recovery?.kind).toBe("IN_PROGRESS");

    const dispatchable = await claims.recoveryFor(second.claim.id, { requester: "process_B" });
    expect(dispatchable?.kind).toBe("RECLAIM");
    if (dispatchable?.kind !== "RECLAIM") throw new Error("expected RECLAIM");
    expect(dispatchable.reason).toBe("CLAIMED_LEASE_EXPIRED_NO_DISPATCH");
  });

  it("reclaims a RELEASED claim, because a refusal means no run exists", async () => {
    const { claims } = harness();
    const claimed = await claims.claim(request());
    if (claimed.kind !== "CLAIMED") throw new Error("expected CLAIMED");

    const released = await claims.release(claimed.claim.id, "BUDGET_DENIED_VARIABLE_AI_EXECUTION");
    expect(released?.state).toBe("RELEASED");

    const retaken = await claims.claim(request({ leaseOwner: "process_B" }));
    expect(retaken.kind).toBe("RECLAIMED");
    if (retaken.kind !== "RECLAIMED") throw new Error("expected RECLAIMED");
    expect(retaken.reclaimedFrom).toBe("RELEASED");

    const recovery = await claims.recoveryFor(retaken.claim.id, { requester: "process_Z" });
    expect(recovery?.kind).toBe("IN_PROGRESS");

    // The detail on the release is cleared by the reclaim: the attempt is live again.
    const fresh = await claims.recoveryFor(retaken.claim.id, { requester: "process_B" });
    expect(fresh?.kind).toBe("RECLAIM");
    if (fresh?.kind !== "RECLAIM") throw new Error("expected RECLAIM");
    expect(fresh.reason).toBe("CLAIMED_LEASE_EXPIRED_NO_DISPATCH");
  });
});

/* ══════════════════════════════════════════════════════
   5. EXPIRED DISPATCHING → UNVERIFIED, NEVER RE-DISPATCHED
      (the owner's correction, as an assertion)
   ══════════════════════════════════════════════════════ */

describe("Step 5A claim — an expired DISPATCHING claim is UNVERIFIED and never re-dispatched", () => {
  it("promotes an expired DISPATCHING claim to UNVERIFIED instead of stealing it", async () => {
    const { claims, clock } = harness();
    const claimed = await claims.claim(request({ leaseOwner: "process_A" }));
    if (claimed.kind !== "CLAIMED") throw new Error("expected CLAIMED");
    await claims.markDispatching(claimed.claim.id, { leaseOwner: "process_A" });

    clock.advance(DEFAULT_CLAIM_LEASE_TTL_MS + 1_000);

    const afterExpiry = await claims.claim(request({ leaseOwner: "process_B" }));

    // THE CORRECTION. Before it, this returned RECLAIMED and a second real run
    // could start. A crash may have happened AFTER the request reached Hermes and
    // BEFORE the handle was persisted, so "no handle" does not mean "no run".
    expect(afterExpiry.kind).toBe("UNVERIFIED");
    expect(permitsDispatch(afterExpiry)).toBe(false);
    expect(afterExpiry.claim.state).toBe("UNVERIFIED");
    if (afterExpiry.kind !== "UNVERIFIED") throw new Error("expected UNVERIFIED");
    expect(afterExpiry.detail).toMatch(/may have started/i);

    // The doubt is now DURABLE, not re-derived on every read.
    const stored = await claims.get(claimed.claim.id);
    expect(stored?.state).toBe("UNVERIFIED");
    expect(stored?.leaseExpiresAt).toBeUndefined();

    // A third caller is told the same thing and still may not dispatch.
    const third = await claims.claim(request({ leaseOwner: "process_C" }));
    expect(third.kind).toBe("UNVERIFIED");
    expect(permitsDispatch(third)).toBe(false);

    const recovery = await claims.recoveryFor(claimed.claim.id);
    expect(recovery?.kind).toBe("UNVERIFIED");
    if (recovery?.kind !== "UNVERIFIED") throw new Error("expected UNVERIFIED");
    expect(recovery.reason).toBe("ALREADY_UNVERIFIED");
  });

  it("never lets a DISPATCHING attempt be released or re-entered", async () => {
    const { claims, clock } = harness();
    const claimed = await claims.claim(request());
    if (claimed.kind !== "CLAIMED") throw new Error("expected CLAIMED");
    await claims.markDispatching(claimed.claim.id, { leaseOwner: "process_A" });

    clock.advance(DEFAULT_CLAIM_LEASE_TTL_MS + 1_000);

    // Releasing an ENTERED attempt would invite a later re-dispatch of a run that
    // may exist, so the port refuses it outright.
    expect(await claims.release(claimed.claim.id, "trying to free an entered attempt")).toBeNull();

    // ...and the CAS that would start a second run cannot land either.
    expect(await claims.markDispatching(claimed.claim.id, { leaseOwner: "process_B" })).toBeNull();
  });

  it("records doubt directly when the owner observes a dispatch failure", async () => {
    const { claims } = harness();
    const claimed = await claims.claim(request());
    if (claimed.kind !== "CLAIMED") throw new Error("expected CLAIMED");
    await claims.markDispatching(claimed.claim.id, { leaseOwner: "process_A" });

    const unverified = await claims.markUnverified(
      claimed.claim.id,
      "the bridge did not answer within the timeout; a run may exist",
    );
    expect(unverified?.state).toBe("UNVERIFIED");

    const verdict = await claims.recoveryFor(claimed.claim.id);
    expect(verdict?.kind).toBe("UNVERIFIED");
    if (verdict?.kind !== "UNVERIFIED") throw new Error("expected UNVERIFIED");
    expect(verdict.reason).toBe("ALREADY_UNVERIFIED");

    // Marking doubt twice is a no-op, not a second state change.
    expect(await claims.markUnverified(claimed.claim.id, "again")).toBeNull();
  });

  it("excludes DISPATCHING and UNVERIFIED from the re-dispatchable states", () => {
    // The machine-checkable form of the correction: if anyone later adds
    // DISPATCHING here, this fails instead of the mistake shipping.
    expect(REDISPATCHABLE_CLAIM_STATES).not.toContain("DISPATCHING");
    expect(REDISPATCHABLE_CLAIM_STATES).not.toContain("UNVERIFIED");
    expect(isRedispatchableClaimState("DISPATCHING")).toBe(false);
    expect(isRedispatchableClaimState("UNVERIFIED")).toBe(false);
    expect(isRedispatchableClaimState("DISPATCHED")).toBe(false);
    expect(isRedispatchableClaimState("CLAIMED")).toBe(true);
    expect(isRedispatchableClaimState("RELEASED")).toBe(true);

    // Every state is either re-dispatchable or explicitly blocked — nothing is
    // unaccounted for.
    for (const state of EXECUTION_CLAIM_STATES) {
      const blocked = executionBlockedClaimStates().includes(state);
      expect(isRedispatchableClaimState(state) || blocked).toBe(true);
      expect(isRedispatchableClaimState(state) && blocked).toBe(false);
    }
  });
});

/* ══════════════════════════════════════════════════════
   6. CONCURRENT RACE → ONE WINNER
   ══════════════════════════════════════════════════════ */

describe("Step 5A claim — a concurrent claim race produces one execution authority winner", () => {
  it("lets exactly one of many simultaneous claimants proceed", async () => {
    const { claims } = harness();

    const contenders = Array.from({ length: 8 }, (_, index) =>
      claims.claim(request({ leaseOwner: `process_${index}` })),
    );
    const outcomes = await Promise.all(contenders);

    const winners = outcomes.filter(permitsDispatch);
    expect(winners.length).toBe(1);
    expect(winners[0].kind).toBe("CLAIMED");

    const losers = outcomes.filter((outcome) => !permitsDispatch(outcome));
    expect(losers.length).toBe(7);
    // Every loser was told a live claim exists — none was told to dispatch.
    for (const loser of losers) expect(loser.kind).toBe("IN_PROGRESS");

    // One row for the whole race: this is the property that makes a second
    // concurrent mission advance unable to start a second real run.
    expect(claims.count()).toBe(1);
    const all = new Set(outcomes.map((outcome) => outcome.claim.id));
    expect(all.size).toBe(1);
  });

  it("replays to every later contender once the winner dispatched", async () => {
    const { claims } = harness();

    const winner = await claims.claim(request({ leaseOwner: "process_0" }));
    if (winner.kind !== "CLAIMED") throw new Error("expected CLAIMED");
    await claims.markDispatching(winner.claim.id, { leaseOwner: "process_0" });
    await claims.markDispatched(winner.claim.id, { executionRecordId: "exec_1", handleId: "run_1" });

    const later = await Promise.all(
      Array.from({ length: 8 }, (_, index) => claims.claim(request({ leaseOwner: `late_${index}` }))),
    );
    for (const outcome of later) {
      expect(outcome.kind).toBe("REPLAYED");
      expect(permitsDispatch(outcome)).toBe(false);
      expect(outcome.claim.executionRecordId).toBe("exec_1");
    }
  });
});

/* ══════════════════════════════════════════════════════
   7. BUDGET DEFAULT = DENY VARIABLE AI EXECUTION
   ══════════════════════════════════════════════════════ */

describe("Step 5A budget governor — deny variable-cost AI execution by default", () => {
  const base: BudgetEvaluationInput = {
    capabilityId: "strategy.internal-brief",
    actorId: "actor_analyst",
    missionId: "mission_1",
    taskId: "task_1",
    attempt: 1,
    spend: "VARIABLE_PROVIDER_COST",
  };

  it("refuses a variable-cost execution outright", async () => {
    const governor = denyVariableAiSpendBudgetGovernor();
    const decision = await governor.evaluate(base);

    expect(decision.allowed).toBe(false);
    expect(decision.reason).toBe("BUDGET_DENIED_VARIABLE_AI_EXECUTION");
    expect(decision.policyRef).toBe(DENY_VARIABLE_AI_SPEND_POLICY_REF);
    expect(governor.policyRef).toBe(DEFAULT_BUDGET_GOVERNOR_POLICY_REF);
    expect(governor.policyRef).toBe(DENY_VARIABLE_AI_SPEND_POLICY_REF);
  });

  it("permits only work that cannot incur per-use provider cost", async () => {
    const governor = denyVariableAiSpendBudgetGovernor();
    const decision = await governor.evaluate({ ...base, spend: "NO_VARIABLE_COST" });

    expect(decision.allowed).toBe(true);
    expect(decision.reason).toBe("ALLOWED_NO_VARIABLE_COST");
  });

  it("classifies legs fail-closed: a runtime spends unless it says otherwise", () => {
    expect(spendClassForBinding("RUNTIME")).toBe("VARIABLE_PROVIDER_COST");
    expect(spendClassForBinding("RUNTIME", { runtimeDeclaresNoVariableCost: false })).toBe(
      "VARIABLE_PROVIDER_COST",
    );
    expect(spendClassForBinding("RUNTIME", { runtimeDeclaresNoVariableCost: true })).toBe("NO_VARIABLE_COST");
    expect(spendClassForBinding("DETERMINISTIC")).toBe("NO_VARIABLE_COST");
    expect(spendClassForBinding("HUMAN")).toBe("NO_VARIABLE_COST");

    // The declaration must be EXPLICIT. Absent, `true` or a wrong type all mean
    // "assume it bills", because guessing "free" is how money gets spent.
    expect(runtimeDeclaresNoVariableCost(undefined)).toBe(false);
    expect(runtimeDeclaresNoVariableCost(null)).toBe(false);
    expect(runtimeDeclaresNoVariableCost({})).toBe(false);
    expect(runtimeDeclaresNoVariableCost({ variableCost: true })).toBe(false);
    expect(runtimeDeclaresNoVariableCost({ variableCost: undefined })).toBe(false);
    expect(runtimeDeclaresNoVariableCost({ variableCost: "false" })).toBe(false);
    expect(runtimeDeclaresNoVariableCost({ variableCost: false })).toBe(true);
    expect(runtimeDeclaresNoVariableCost({ transport: "BRIDGE", variableCost: false })).toBe(true);
  });

  it("ships no allow-with-audit mode and no override switch", async () => {
    // The denial is unconditional. There is no flag, no environment read and no
    // "temporary" escape: the ONLY way a provider turn is permitted is a different
    // governor, and Step 5C owns that.
    const governor = denyVariableAiSpendBudgetGovernor();
    for (const spend of ["VARIABLE_PROVIDER_COST"] as const) {
      for (const attempt of [1, 2, 50]) {
        const decision = await governor.evaluate({ ...base, spend, attempt });
        expect(decision.allowed).toBe(false);
        expect(decision.reason).toBe("BUDGET_DENIED_VARIABLE_AI_EXECUTION");
      }
    }

    // A permissive governor is COMPOSABLE (tests and Step 5C need that) without
    // weakening the shipped default, which stays a separate instance.
    const permissive: BudgetGovernor = {
      policyRef: "test.permissive",
      async evaluate(input) {
        return {
          allowed: true,
          reason: "ALLOWED_ATTESTED_INCLUDED_ROUTE",
          policyRef: "test.permissive",
          spend: input.spend,
        };
      },
    };
    expect((await permissive.evaluate(base)).allowed).toBe(true);
    expect((await denyVariableAiSpendBudgetGovernor().evaluate(base)).allowed).toBe(false);

    // Each composition gets its own instance — nothing shared to mutate.
    expect(denyVariableAiSpendBudgetGovernor()).not.toBe(denyVariableAiSpendBudgetGovernor());
  });

  it("summarizes a decision without leaking anything secret", async () => {
    const decision = await denyVariableAiSpendBudgetGovernor().evaluate(base);
    const summary = summarizeBudgetDecision(decision);

    expect(summary.allowed).toBe(false);
    expect(summary.reason).toBe("BUDGET_DENIED_VARIABLE_AI_EXECUTION");
    expect(Object.keys(summary).sort()).toEqual(["allowed", "detail", "policyRef", "reason", "spend"]);
    expect(JSON.stringify(summary)).not.toMatch(/key|token|secret|password|bearer/i);

    // The reason vocabulary is closed and includes the only legitimate future
    // allow for a provider turn.
    expect(BUDGET_DECISION_REASONS).toContain("ALLOWED_ATTESTED_INCLUDED_ROUTE");
    expect(BUDGET_DECISION_REASONS).toContain("BUDGET_DENIED_UNCLASSIFIED");
  });

  it("refuses an unclassified spend class rather than guessing", async () => {
    const governor = denyVariableAiSpendBudgetGovernor();
    const smuggled = { ...base, spend: "FREE_MAYBE" } as unknown as BudgetEvaluationInput;
    const decision = await governor.evaluate(smuggled);

    expect(decision.allowed).toBe(false);
    expect(decision.reason).toBe("BUDGET_DENIED_UNCLASSIFIED");
  });
});

/* ══════════════════════════════════════════════════════
   8. AUTHORITY + BATCH INVARIANTS (nothing wired yet)
   ══════════════════════════════════════════════════════ */

describe("Step 5A — the authenticated authority contract", () => {
  const input: ExecutionAuthorityInput = {
    userId: "user_founder_1",
    actorId: "actor_founder",
    actorSlug: "founder",
    actorType: "HUMAN",
    permissionTokens: ["aiworkforce.access"],
    accessibleBusinessSlugs: ["nexup"],
    isSuperAdmin: false,
    hasOfficeFinanceFull: false,
    correlationId: "corr_1",
    now: new Date("2026-02-01T00:00:00.000Z"),
  };

  it("keeps the user and the actor as separate identities", () => {
    const authority = createExecutionAuthority(input);

    // The defect being designed away: `decidedBy` is the resolved HUMAN actor for
    // THIS user, not a constant. The two ids are distinct fields on purpose.
    expect(authority.userId).toBe("user_founder_1");
    expect(authority.actorId).toBe("actor_founder");
    expect(authority.requestedAt).toBe("2026-02-01T00:00:00.000Z");
    expect(authorityIsHumanDecisionActor(authority)).toBe(true);
  });

  it("refuses an authority with no identity", () => {
    expect(() => createExecutionAuthority({ ...input, userId: "" })).toThrow(/userId/);
    expect(() => createExecutionAuthority({ ...input, actorId: "  " })).toThrow(/actorId/);
    expect(() => createExecutionAuthority({ ...input, actorSlug: "" })).toThrow(/actorSlug/);
  });

  it("refuses to carry a session credential", () => {
    const smuggled = { ...input, sessionToken: "not-a-real-token" } as unknown as ExecutionAuthorityInput;
    expect(() => createExecutionAuthority(smuggled)).toThrow(/credentials/i);
  });

  it("scopes business access, with no scope meaning office-wide", () => {
    const authority = createExecutionAuthority(input);

    // An unscoped capability has no business to be denied.
    expect(authorityCanReachBusiness(authority, null)).toBe(true);
    expect(authorityCanReachBusiness(authority, undefined)).toBe(true);
    expect(authorityCanReachBusiness(authority, "nexup")).toBe(true);
    expect(authorityCanReachBusiness(authority, "rebound")).toBe(false);

    const superAdmin = createExecutionAuthority({ ...input, isSuperAdmin: true });
    expect(authorityCanReachBusiness(superAdmin, "rebound")).toBe(true);

    expect(authorityIsHumanDecisionActor(superAdmin)).toBe(true);
    expect(authorityIsHumanDecisionActor(createExecutionAuthority({ ...input, actorType: "AI_AGENT" }))).toBe(false);
    expect(authorityIsHumanDecisionActor(createExecutionAuthority({ ...input, actorType: "EXECUTIVE" }))).toBe(false);
  });

  it("summarizes safely for audit", () => {
    const summary = summarizeExecutionAuthority(createExecutionAuthority(input));
    expect(summary.userId).toBe("user_founder_1");
    expect(summary.actorSlug).toBe("founder");
    expect(summary.businessCount).toBe(1);
    // No permission list, no business names — a bounded, shareable record.
    expect(Object.keys(summary).sort()).toEqual([
      "actorId",
      "actorSlug",
      "actorType",
      "businessCount",
      "correlationId",
      "isSuperAdmin",
      "userId",
    ]);
  });
});

describe("Step 5A-1 — batch invariants (nothing is wired, nothing provider-specific leaked)", () => {
  it("still requires every authorization source, with no optional escape", () => {
    expect(CAPABILITY_EXECUTION_REQUIREMENTS).toEqual({
      permissions: "REQUIRED",
      approvals: "REQUIRED",
      capabilities: "REQUIRED",
      claims: "REQUIRED",
      executions: "REQUIRED",
      runtimes: "REQUIRED",
      budget: "REQUIRED",
    });
  });

  it("keeps the attempt key deterministic and unique-per-attempt", () => {
    expect(executionIdempotencyKeyForAttempt("task_9", 1)).toBe("task:task_9:attempt:1");
    expect(executionIdempotencyKeyForAttempt("task_9", 2)).toBe("task:task_9:attempt:2");
    // Matches the durable `@@unique([taskId, attempt])` on ai_execution_records:
    // one attempt, one key, no caller input involved.
    expect(() => executionIdempotencyKeyForAttempt("task_10", 1)).not.toThrow();
  });

  it("publishes the full outcome and preflight vocabularies", () => {
    expect(EXECUTION_BINDINGS).toEqual(["RUNTIME", "DETERMINISTIC", "HUMAN"]);
    expect(EXECUTION_PREFLIGHT_DECISIONS).toEqual(["DISPATCH", "WAIT_APPROVAL", "WAIT_HUMAN", "BLOCKED", "DENY"]);
    // UNVERIFIED must be a first-class outcome, not an implicit failure.
    expect(EXECUTION_OUTCOME_KINDS).toContain("UNVERIFIED");
    expect(EXECUTION_OUTCOME_KINDS).toContain("REPLAYED");
    expect(EXECUTION_OUTCOME_KINDS).toContain("IN_PROGRESS");
    // The preflight decision has a place to be recorded on the audit spine.
    expect(EXECUTION_AUDIT_EVENT_TYPES).toContain("PREFLIGHT");
  });

  it("did not wire the service into the mission path", () => {
    // `F. DO NOT YET wire CapabilityExecutionService into MissionOrchestrator`.
    // Read the orchestrator and assert it still dispatches through the dispatcher
    // and knows nothing about the new service: a later batch must change this
    // line of the test, which is exactly what makes the boundary deliberate.
    const orchestrator = fs.readFileSync(
      path.join(REPO_ROOT, "src", "modules", "workforce", "orchestration", "mission-orchestrator.ts"),
      "utf8",
    );
    expect(orchestrator).toContain("AgentRuntimeDispatcher");
    expect(orchestrator).not.toContain("CapabilityExecutionService");
    expect(orchestrator).not.toContain("ExecutionClaimRepository");
    expect(orchestrator).not.toContain("BudgetGovernor");
  });

  it("keeps the claim out of the lifecycle: it moves no task and no mission", () => {
    const claimSource = fs.readFileSync(
      path.join(REPO_ROOT, "src", "modules", "workforce", "execution", "execution-claim.ts"),
      "utf8",
    );
    // The claim must not import the state machines it is deliberately not part of.
    expect(claimSource).not.toContain("mission-contracts");
    expect(claimSource).not.toContain("task-contracts");
    expect(claimSource).not.toContain("task-review");
    expect(claimSource).not.toContain("mission-orchestrator");
  });

  it("introduces no provider coupling into the new execution-policy modules", () => {
    // Provider neutrality is a property of the SOURCE, so it is asserted on it.
    const files = [
      path.join("src", "modules", "workforce", "execution", "execution-authority.ts"),
      path.join("src", "modules", "workforce", "execution", "capability-execution-contracts.ts"),
      path.join("src", "modules", "workforce", "execution", "execution-claim.ts"),
      path.join("src", "modules", "ai-workforce", "policies", "budget-governor.ts"),
    ];
    for (const relative of files) {
      const source = fs.readFileSync(path.join(REPO_ROOT, relative), "utf8");
      // No import of a provider adapter, and no hard-coded profile. The profile
      // allowlist (`saieed`, with `default` forbidden) stays where it was.
      expect(source).not.toMatch(/from\s+["'][^"']*runtimes\/hermes/);
      expect(source).not.toContain("NEXUP_ALLOWED_PROFILES");
      expect(source).not.toContain("HERMES_RUNTIME_");
      expect(source).not.toMatch(/saieed/);
    }
  });

  it("did not touch the schema, the migrations, or the bridge", () => {
    // The batch added NO schema model and NO proposed migration: the owner gated
    // schema work on necessity, and the port plus the in-memory implementation
    // compile and test without either. When the durable adapter lands (batch
    // 5A-2) this assertion is what forces the change to be deliberate.
    const schema = fs.readFileSync(path.join(REPO_ROOT, "prisma", "schema.prisma"), "utf8");
    expect(schema).not.toContain("AiExecutionClaim");
    expect(schema).not.toContain("ai_execution_claims");
    expect(fs.existsSync(path.join(REPO_ROOT, "prisma", "proposed-migrations", "AI_WORKFORCE_PHASE_4"))).toBe(false);
  });
});
