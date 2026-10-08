# NEXUP — STEP 5A REMEDIATION DESIGN (owner-approved, owner-corrected)

STATUS: **APPROVED FOR IMPLEMENTATION, IN BATCHES.** This document is the design
of record for Step 5A. Batch 5A-1 (foundation/contracts + claim primitive) is the
only batch authorized so far.

Production activation remains **PAUSED**. Step 6 must **NOT** start.

Sources this design is answerable to:

- Codex independent architecture review of the live mission path.
- `docs/AI_WORKFORCE_STEP5_ARCHITECTURE_FREEZE_AUDIT.md` (repo-truth audit).
- Three explicit OWNER corrections, recorded verbatim in §0.

---

## 0. OWNER CORRECTIONS (binding — these override the first draft)

### 0.1 Claim / recovery correction (removes a contradiction in draft 1)

Draft 1 said an expired `DISPATCHING` claim may be stolen and re-dispatched. That
was **wrong**, and it is corrected here.

Once a claim has transitioned to `DISPATCHING`, the absence of a durable
handle/`executionRecordId` does **not** prove that external execution never
started. A crash may occur *after* the external request reaches Hermes but
*before* the handle is persisted. So:

| Claim state | Meaning | Recovery |
|---|---|---|
| `CLAIMED` | dispatch was never attempted | **may** be reclaimed, per CAS + lease rules |
| `DISPATCHING` with no durable handle | dispatch **was entered**; outcome UNKNOWN | **UNKNOWN_REMOTE / UNVERIFIED** → **NEVER automatically re-dispatch**. Reconcile/adopt only where identity and evidence permit; otherwise park/escalate for operator/human resolution |
| `DISPATCHED` | a durable handle exists | adopt/reconcile the existing execution → **never duplicate** |

**There is no expired-`DISPATCHING` lease steal that re-dispatches.** That
behaviour is forbidden by this design.

### 0.2 Budget Governor correction

Step-5A default is **DENY**. There is **no allow-with-audit bypass**. Until Step 5C
establishes an attested included/free route:

```
DEFAULT = DENY_VARIABLE_AI_EXECUTION
```

Product invariant preserved: **ZERO ADDITIONAL VARIABLE AI SPEND BY DEFAULT.**
No auto-top-up. No pay-as-you-go. No credit purchase. No silent paid fallback.

Tests may use an explicit fake/test governor, or deterministic (no-variable-cost)
execution where appropriate.

### 0.3 Business-scope correction

For a caller reaching an object outside their authorized business scope:

- **External API:** 404-alike — must not reveal that the object exists.
- **Internal audit:** preserve the real typed reason (`BUSINESS_SCOPE_DENIED`)
  together with actor/user/business/correlation context, where safe to record.

---

## A. EXACT FILES / CONTRACTS AFFECTED

### A.1 Changed in batch 5A-1

| File | Change |
|---|---|
| `docs/AI_WORKFORCE_STEP5A_REMEDIATION_DESIGN.md` | NEW — this document |
| `src/modules/ai-workforce/policies/budget-governor.ts` | NEW — port + deny default |
| `src/modules/workforce/execution/execution-authority.ts` | NEW — `ExecutionAuthority` |
| `src/modules/workforce/execution/capability-execution-contracts.ts` | NEW — binding/request/preflight/outcome/service |
| `src/modules/workforce/execution/execution-claim.ts` | NEW — claim port, states, in-memory impl |
| `src/modules/workforce/execution/execution-record.ts` | EDIT — one additive audit event type (`PREFLIGHT`) |
| `src/modules/workforce/index.ts` | EDIT — additive barrel exports |
| `tests/workforce-step5a-claim.test.ts` | NEW — focused tests |

### A.2 To change in later batches (NOT touched in 5A-1)

- `orchestration/mission-orchestrator.ts` — `startTask` stops calling
  `dispatcher.startJob` directly; `MissionOrchestratorDeps.dispatcher` becomes a
  `CapabilityExecutionService`.
- `runtimes/agent-runtime-dispatcher.ts` — kept as the governed agent leg; call
  sites change, internals do not.
- `application/composition.ts` — composes the service, the claim repository, the
  policy bundle.
- `application/command-service.ts` — every method takes an `ExecutionAuthority`
  and a scope.
- `app/api/ai-workforce/missions/route.ts`, `missions/[id]/route.ts`,
  `decisions/route.ts` — authority derived from the session; scope enforced;
  `actor_founder` removed.
- `adapters/api-guard.ts`, `adapters/session-actor.ts` — return an
  `ExecutionAuthority`.
- `execution/actor-execution-context.ts` — finally builds a real
  `ExecutionContext` on the mission path (today it exists only on the Phase-1
  `/jobs` route).
- `execution/execution-reconciler.ts` — claims participate in recovery.
- `persistence/prisma-execution-claim-repository.ts` + a proposed migration —
  the durable adapter for the claim port.
- `review/task-review.ts` — `decide` takes a session-derived decider.

### A.3 Reused unchanged (the Phase-1 controls this design extracts)

`policies/permission-policy.ts`, `policies/money-safety.ts`,
`policies/risk-classification.ts`, `approvals/approval-policy.ts`,
`approvals/approval-gate.ts`, `approvals/approval-repository.ts`,
`runtime/runtime-dispatch-guard.ts`, `registry/tool-registry.ts`,
`runtime/local-runtime-adapter.ts`, and the entire `runtimes/hermes/**` +
`bridge/**` surface.

### A.4 Must never change

`runtimes/hermes/hermes-config.ts` (`NEXUP_ALLOWED_PROFILES`, the `default`
refusal), `prisma/migrations/**`, the legacy tables, the bridge allowlists.

---

## B. CURRENT CALL PATH (repo truth, and where it breaks)

```
POST /api/ai-workforce/missions
  requireWorkforceActor()        → session → ActorContext; checks ONLY aiworkforce.access
  getWorkforceApplication()      → fail-closed singleton
  WorkforceCommandService.submit()
    intents.claim(scope,key)     → durable UNIQUE(scope,idempotencyKey)      ← correct
    orchestrator.createMission() → intents.complete(missionId)
    orchestrator.plan()          → task rows, mission DRAFT→PLANNING, advance()
      advance() → startTask():
        1 missions.require(missionId)          existence only
        2 requireTask + assert READY + missionId matches
        3 actors.require(actorId); runtime.runtimeForActor(actor)
        4 assignments.hasCapability(actorId, capabilityId, version)
        5 attempt = task.attempt + 1; key = `task:${taskId}:attempt:${attempt}`
        6 dispatcher.startJob({...})   ← EXTERNAL I/O HAPPENS HERE
        7 executions.open(...)         ← durable record written AFTER I/O
        8 tasks.update(running, [task.state])  ← CAS, loses AFTER both dispatches
POST /api/ai-workforce/missions/:id   → drain(): reconcile → settleTask → advance
POST /api/ai-workforce/decisions      → decide(reviewId, decidedBy: "actor_founder")  ← constant
```

Grep-confirmed: on the mission path, `PermissionPolicy`, `ApprovalGate`,
`assertMoneySafety`, `ToolRegistry`, `RunRecorder` and `createExecutionContext`
appear **nowhere**. `Actor.approvalPolicy` is read by `dispatchJob` only to
*describe* the actor to Hermes — never to decide anything.

Defects, each anchored to the code above:

1. **No execution authority.** Steps 3–4 check structure (assignment, runtime
   binding) but no permission token, no business scope, no risk class, no
   approval, no money safety.
2. **Dispatch precedes the durable claim** (6 before 7). A crash or timeout in
   between = a real bridge run with no record, so `ExecutionReconciler` has
   nothing to adopt.
3. **Idempotency is not restart-safe end-to-end.** `attempt` is persisted only at
   step 8; the Hermes adapter's dedupe map is process memory;
   `executionIdempotencyKeyFor` falls back to `job:${jobId}`;
   `AiExecutionRecord` has `@@unique([taskId, attempt])` but only an `@@index` on
   `idempotencyKey`.
4. **Concurrent advance double-dispatches.** Two `POST /missions/:id` both read
   READY, both pass step 2, both reach step 6. The CAS at step 8 only fails the
   *second writer* — after both external runs started.
5. **Caller-controlled / hard-coded actor.** `decidedBy: "actor_founder"` is a
   literal; `owner` defaults to `actor_founder` and is otherwise caller-supplied;
   `createdBy`/`owner` are *actor* ids while `requestedBy` is a *user* id — two
   vocabularies, and `resolveReviewer` looks `mission.owner` up in the
   ActorRegistry.
6. **No object/business scope.** Every mission read/advance/decide/cancel accepts
   any id; `AiMission.businessId` is stored and never checked against
   `actor.accessibleBusinessSlugs`.
7. **`actor_founder` is not the authenticated human.** `ReviewService` verifies
   `type === "HUMAN"`, but the identity is a shared stand-in.
8. **No budget/model hook** (freeze-audit gap #1) — nothing between dispatcher and
   runtime.

---

## C. PROPOSED STEP-5A CALL PATH

```
POST /api/ai-workforce/missions[/:id]
  requireWorkforceActor() → ExecutionAuthority (session-derived; payload cannot set it)
  WorkforceCommandService.<verb>(authority, scope, …)
    scope check: mission.businessId ↔ authority.accessibleBusinessSlugs    ← NEW
    MissionOrchestrator.advance(ONE candidate)
      startTask():
        preflight (read-only, no I/O):
          capability.resolve → binding (RUNTIME | DETERMINISTIC | HUMAN)
          PermissionPolicy.evaluate(descriptor, context)          ← REUSED
          ApprovalGate.evaluate(descriptor, context)              ← REUSED
          assertMoneySafety / assertRiskDeclaration               ← REUSED at binding time
          budgetGovernor.evaluate(spendClass, …)                  ← NEW, DENY by default
        → DENY | BLOCKED | WAIT_APPROVAL ⇒ no claim, no I/O, task reported BLOCKED
        → DISPATCH:
            1 INSERT claim (UNIQUE(idempotencyKey))               ← THE ONLY GATE
            2 claim → DISPATCHING (CAS: last durable write before I/O)
            3 CapabilityExecutionService → governed leg
                  ├ RUNTIME        → AgentRuntimeDispatcher (resolve() unchanged)
                  ├ DETERMINISTIC  → ToolRegistry + LocalRuntimeAdapter
                  └ HUMAN          → WAIT_HUMAN (never a dispatch)
            4 record handle; claim → DISPATCHED
            5 task READY→RUNNING (CAS, second backstop)
```

`MissionOrchestrator` remains the **only** lifecycle authority. The claim row is
**not** a second lifecycle: its states are *attempt-delivery* states, and the task
state machine (`PENDING … CANCELLED`) stays the only state machine. Phase-1
`JobRunner` is **not** in this path — Step 5A reuses `ToolRegistry` +
`LocalRuntimeAdapter` directly, so the job engine never becomes a second mission
state machine.

---

## D. `CapabilityExecutionService` CONTRACT

```ts
export interface CapabilityExecutionService {
  preflight(request: ExecutionAttemptRequest): Promise<ExecutionPreflightResult>; // no writes, no I/O
  execute(request: ExecutionAttemptRequest): Promise<ExecutionOutcome>;           // claim → dispatch → record
  observe(ref: ExecutionHandleRef): Promise<ExecutionObservation>;
  cancel(ref: ExecutionHandleRef, reason: string): Promise<ExecutionCancellation>;
}
```

Invariants encoded in the implementation:

1. The service refuses construction without `permissions`, `approvals`,
   `capabilities`, `claims`, `executions`, `runtimes` and `budget`
   (`AUTHORIZATION_UNAVAILABLE`), never "allow".
2. There is **no** code path from `execute()` to a runtime that does not pass the
   claim insert.
3. `preflight()` is side-effect-free, so `advance()` can report a reason without
   touching a provider.
4. `budget.evaluate()` runs in `preflight` **and** is re-checked immediately
   before dispatch. Default is deny (see §0.2).

Contract shapes live in
`src/modules/workforce/execution/capability-execution-contracts.ts` and
`src/modules/workforce/execution/execution-authority.ts` (batch 5A-1) — see those
files for the authoritative declarations.

---

## E. PHASE-1 CODE: REUSED / EXTRACTED / DEPRECATED

| Component | Verdict |
|---|---|
| `PermissionPolicy` (+ `RUNTIME_DISPATCH_DEFINITION`) | **REUSE as-is** — module gate, token set, `SCOPE_MISSING`/`SCOPE_DENIED`, input-widening refusal |
| `ApprovalPolicy` + `ApprovalGate` + `ApprovalRepository` / `AiApproval` | **REUSE as-is** — CRITICAL-under-AGENT refusal, HUMAN+MANUAL presence, one PENDING per execution |
| `assertMoneySafety`, `isMoneySensitive`, piaster helpers | **REUSE** at capability→tool binding time |
| `assertRiskDeclaration` / `classifyRisk` | **REUSE** — verify a capability's declared risk is not understated |
| `ToolRegistry` + `ToolAdapter` + `LocalRuntimeAdapter` | **REUSE** as the `DETERMINISTIC` leg |
| `AgentRuntimeDispatcher` + `RuntimeRegistry` | **REUSE** as the `RUNTIME` leg, internals unchanged |
| `AiRun` / `AiRunEvent` / `RunRecorder` | **DEPRECATE for this path** — no second audit spine; the preflight decision lands on `ExecutionRecord.audit` as `PREFLIGHT` |
| `JobRunner` state machine | **DO NOT REUSE** — extract *patterns* only (CAS claim, "already RUNNING → refuse", one PENDING approval) |
| `toJobRunnerDispatcher` | **REPLACE** (flagged test-only by the freeze audit) |
| Phase-1 `JobRunner` | **PLAN RETIREMENT SEPARATELY** — never a second mission lifecycle |
| `AiJob`/`AiRun`/`AiRunEvent`/`AiApproval` tables | **UNTOUCHED** — the legacy dashboard keeps working |

---

## F. DURABLE PRE-DISPATCH CLAIM / IDEMPOTENCY (corrected)

### F.1 States

```
CLAIMED       won the key; dispatch NOT entered
DISPATCHING   dispatch ENTERED — the outside world may know about this attempt
DISPATCHED    external execution identified (executionRecordId + handle durable)
RELEASED      refused BEFORE dispatch was entered; no external run possible
UNVERIFIED    dispatch was entered and no durable handle exists → human/operator resolution
```

`DISPATCHING` is the marker of "the provider may know about this". Its absence of
a handle is **not** evidence of absence of a run.

### F.2 Order of operations

1. `attempt = task.attempt + 1`; `key = task:${taskId}:attempt:${attempt}`
2. **INSERT claim** — the only gate. A unique violation is classified:
   - `DISPATCHED` → `REPLAYED`; return the existing `executionRecordId`; **never
     dispatch**
   - `DISPATCHING` → **`UNVERIFIED`**; **never dispatch** (corrected: no steal)
   - `CLAIMED`/`DISPATCHING` with a live lease → `IN_PROGRESS`; **never dispatch**
   - `CLAIMED` with an expired lease → `RECLAIMED` (dispatch was never entered)
   - `RELEASED` → `RECLAIMED` (no external run was possible)
   - `UNVERIFIED` → stays `UNVERIFIED`; **never dispatch**
3. `CLAIMED → DISPATCHING` via CAS — the last durable write before I/O
4. external dispatch
5. record the handle; `DISPATCHING → DISPATCHED` via CAS
6. refusal before dispatch → `CLAIMED → RELEASED`
7. dispatch failure/timeout with no handle → `DISPATCHING → UNVERIFIED`, and the
   attempt is escalated for human resolution

### F.3 The irreducible window, stated rather than papered over

An external side effect and a local write cannot be atomic. Between steps 3 and 5
a crash is possible. What this design guarantees:

- we **never** dispatch without a durable claim;
- a recovery that finds `DISPATCHING` with no handle **must not auto-retry** —
  the run may exist. It escalates through the existing
  `orchestrator.escalateUnverifiedExecution`, i.e. the existing
  `UNKNOWN`/`UNKNOWN_REMOTE` posture applied one step earlier. No second
  escalation mechanism is invented.

### F.4 Second backstop

`AiExecutionRecord.@@unique([taskId, attempt])` prevents a duplicate record for
the same attempt, and must surface as a typed `REPLAYED`/`IN_PROGRESS` rather than
a raw Prisma `P2002`. The Hermes adapter's in-process dedupe map is an
optimization only; the durable claim — not the adapter — is what prevents a
duplicate run.

---

## G. AUTHENTICATED AUTHORITY / SCOPING

- `ExecutionAuthority` is assembled at the API edge from `getCurrentSession()`.
  No field is payload-settable.
- Two concepts currently conflated are separated: **actor authority** (`actorId`,
  the registered workforce actor the work is attributed to) vs **decision actor**
  (`decidedBy`, the human who decided). `decidedBy` becomes the session user's
  resolved HUMAN actor.
- **user→actor resolution** (`ActorRegistry.actorForUser`), backed until the
  durable roster exists (freeze-audit gap #4, deferred) by a config-seeded mapping
  — never a literal. **Fail closed:** if the session user resolves to no HUMAN
  actor, a decision is refused with `APPROVAL_FORBIDDEN`. Silent impersonation
  becomes a visible configuration error.
- **Object/business scope:** mission reads/advance/cancel check
  `mission.businessId` against `authority.accessibleBusinessSlugs`; `decide`
  resolves `review → missionId → mission.businessId` first. A payload
  `businessId` may never widen the session scope.
- Per §0.3: **external 404-alike** for out-of-scope objects; **internal audit**
  keeps the typed `BUSINESS_SCOPE_DENIED` reason with safe actor/user/business/
  correlation context.

---

## H. TRANSACTION BOUNDARIES

- **Requires `$transaction`:** `plan()` (N task inserts + `attachTask` + mission
  transition — today a crash leaves a partial plan); `parkForReview` (review
  insert + task CAS — today a crash loses `reviewId` while leaving a PENDING
  review); `decide` (review CAS + task transition + `markRejected`).
- **Must NOT be transactional:** the dispatch itself. Holding a DB transaction
  across an HMAC-signed bridge POST causes connection starvation and cannot roll
  back an HTTP request.
- **Must NOT be one transaction:** `advance()`. It spans reads, possibly I/O, then
  later CAS writes; it is a reconciliation and each step is individually CAS-safe.
- Single-statement CAS everywhere else (claim insert, claim state, task/review
  CAS) needs no transaction.
- **Implementation constraint:** the repositories take
  `Pick<PrismaClient, …>` (`WorkforceLifecyclePrismaClient`), which does not accept
  an interactive transaction client. Add a `withTransaction` helper or widen those
  deps types — while keeping `assertLifecycleSchema`.

---

## I. TESTS REQUIRED

Batch 5A-1 ships `tests/workforce-step5a-claim.test.ts` covering the claim
primitive and the deny default:

1. only one claimant wins a concurrent claim;
2. a `DISPATCHED` claim replays/adopts and never re-dispatches;
3. an active `CLAIMED`/`DISPATCHING` claim cannot create another dispatch;
4. an expired `CLAIMED` claim may be reclaimed **only** because dispatch was never
   entered;
5. an expired `DISPATCHING` claim with no handle becomes `UNVERIFIED` and **must
   not** re-dispatch;
6. a `Promise.all` claim race produces exactly one execution-authority winner;
7. the deny default blocks variable-cost (spend-capable) execution and permits
   only no-variable-cost execution;
8. no `actor_founder` / business-scope wiring has changed.

Later batches add `workforce-step5a-execution-authority`,
`-scope`, `-authority`, `-budget-hook`, `-invariants` suites, and extend
`workforce-step5-app-integration`, `-app-restart` and `workforce-api-http`.

---

## J. MIGRATION / SCHEMA IMPACT

Additive only, **proposed, never applied**:

```
ai_execution_claims
  id (PK) | missionId | taskId | attempt | actorId | capabilityId | runtimeId
  idempotencyKey  UNIQUE          ← the algorithm
  state           CLAIMED | DISPATCHING | DISPATCHED | RELEASED | UNVERIFIED
  executionRecordId? | detail? | leaseOwner? | leaseExpiresAt
  claimedAt | updatedAt
```

- Proposed under `prisma/proposed-migrations/AI_WORKFORCE_PHASE_4/`, **never** in
  `prisma/migrations/`, and mechanically checked by
  `scripts/verify-proposed-migration.mjs` before anyone applies it.
- No `ALTER`/`DROP` of any existing object; no foreign key into a legacy table.
- Batch 5A-1 added **no** schema and **no** migration: the owner gated schema work
  on necessity, and the port + in-memory implementation compile and test without
  it. The Prisma adapter and this migration are batch 5A-2.
- Not created in Step 5A: `ai_actors` / `ai_capabilities` / `ai_assignments`
  (gap #4 stays deferred), so the user→actor resolver is config-seeded — a
  documented limitation.

---

## K. SMALLEST SAFE IMPLEMENTATION SEQUENCE

| Batch | Content | Behaviour change |
|---|---|---|
| **5A-1** | Design doc, contracts (`ExecutionAuthority`, `CapabilityExecutionService`, budget port + deny default, `PREFLIGHT` event), claim port + in-memory impl, focused tests | **none** |
| 5A-2 | Prisma claim repository + proposed `AI_WORKFORCE_PHASE_4` migration + tests | none (not composed yet) |
| 5A-3 | `preflight()` wired into `startTask`; dispatch still on the old path | authorization becomes observable |
| 5A-4 | Dispatch moves behind `execute()` with the claim | ordering change, deterministic leg only |
| 5A-5 | Session → `ExecutionAuthority`; scope enforcement; `actor_founder` removed | identity/scope change |
| 5A-6 | Prisma claim repository composed in | final ordering change for real Hermes dispatch |
| 5A-7 | Full regression + typecheck + lint | — |

Steps 5A-1 … 5A-2 change no production behaviour. 5A-6 remains gated by the
local/loopback persistence policy and `requireRuntime`.

---

## L. RISKS / REGRESSIONS

- **Visible behaviour change** once §C lands: missions park more often, because a
  capability whose declared risk meets the approval threshold now actually waits.
  Intended, but operators will notice.
- Raw Prisma `P2002` can leak where a typed outcome is expected — must be mapped.
- Widening the repository `Pick` types for `$transaction` risks letting callers
  bypass `assertLifecycleSchema`; keep the assertion, and add the same for the
  claim delegate.
- Fail-closed user→actor resolution means decisions stop working on a fresh
  deployment until the founder's user id is configured. Deliberate and visible;
  needs an operator note.
- Run `preflight()` **only** for the single candidate task in `advance()` — not
  per task, or a 50-task mission does 50 preflights per tick.
- The deny default means no real provider turn can be started until Step 5C. That
  is the invariant, not an inconvenience.
- No rollback risk: additive schema, no `ALTER`/`DROP`, `prisma/migrations/`
  untouched.

---

## M. EXPLICITLY NOT IN STEP 5A

Step 5C ModelRouter/BudgetGovernor *implementation* (only the port + deny default
exist here); durable actor/capability/assignment registries (beyond the
config-seeded resolver); the scheduler/lease worker loop + `next_run_at` (gap #3);
Hermes surface widening — skills/memory/subagents/cron (gap #2); any bridge
allowlist change; Phase-1 `JobRunner` retirement (planned only); the engineering
plane; RLS posture; CI workflow; Command Center real-data wiring; external
capability adapters (`social.publish`, `email.send`, `crm.*`); per-actor
presence/avatars; **Step 6**; and any change to `prisma/migrations/`, production,
or the `saieed` / `default` profile posture.
