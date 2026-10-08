# NEXUP — STEP 5/8 ARCHITECTURE FREEZE AUDIT

**Mode:** PLAN / READ-ONLY. No code changed, no database touched, no production
write, no migration applied, no paid provider credit spent, Step 6 not started.

**Branch audited:** `feature/ai-workforce-foundation` @ `1e8eaf2`.
`master` / `origin/master` untouched.

Everything below is derived from the repository on disk (`src/`, `bridge/`,
`prisma/`, `scripts/`, `tests/`, `docs/`) — not from the roadmap documents.

---

## 1. EXECUTIVE VERDICT

**The target principle is correct, and the repository already implements most of
it as real seams rather than aspirations.** Specifically, the following are
already true in code:

| Target requirement | Repo truth | Evidence |
|---|---|---|
| runtime-independent | YES | `AgentRuntime` / `AsyncAgentRuntime` ports; no provider type in any core contract |
| model-independent | YES (no model layer at all) | no `openai`/`anthropic`/model SDK in `package.json`; no model call anywhere on the mission path |
| provider-independent | YES | `DeterministicHermesTransport`, `HermesRuntimeAdapter`, `LocalRuntimeAdapter` all satisfy the same port |
| tool/integration-independent | SHAPE YES, COVERAGE NO | `ToolAdapter = {definition, handler}` + read ports; only read-only local tools exist |
| database-portable | YES, unusually clean | zero `@supabase/*` dependency, zero Supabase Auth, zero RLS; Prisma + `pg` only |
| cost-aware | **NO** | contracts exist (`ActorModelPolicy`, `EstimatedCostPolicy`) and nothing reads them |
| secure | YES | fail-closed persistence, HMAC bridge, pinned profile, method allowlist, human-only approval |
| durable | YES for the lifecycle | mission/task/execution/review/intent rows; reconciler re-adopts after restart |
| mobile-operable | YES (shape) | the whole control surface is `/command` + `/api/ai-workforce/**` |
| long-running autonomous work | **NO** | advancement is an inbound HTTP request; there is no scheduler, queue or worker |
| Hermes at native strength | **NO** | one prompt per run over 6 RPC methods; no skills, memory, agents, delegation or cron |
| replaceable Hermes later | YES | the reconciler, dispatcher and orchestrator speak only the port |
| replaceable engineering agents | **NOT DEFINED** | no engineering plane exists in the repo at all |
| remote development without production access | **NO** | today, remote work requires the production DB credential |

**But three findings mean the current state is not yet the target state:**

1. **There is no cost or model layer.** `ActorModelPolicy`
   (`actors/actor-contracts.ts`) and `EstimatedCostPolicy`
   (`registry/tool-definition.ts`) are real contracts with no reader. The
   `ModelRoute` / `Budget` strings found under `src/components/command/state/`
   are presentation mocks. NET: NEXUP cannot currently answer "what will this
   cost, which model, may it spend". This is the single largest gap against the
   stated mission.
2. **Hermes is used at its weakest possible strength.** The bridge allowlist is
   `gateway.ping`, `session.create`, `prompt.submit`, `session.status`,
   `session.history`, `session.interrupt`, `session.events.since`, with
   `llm.oneshot` explicitly excluded. A NEXUP run is therefore: create a
   session, submit one prompt, poll, read text. No skills, no profile memory, no
   persistent agents, no delegation, no parallel work, no cron. That is
   excellent *isolation* and poor *exploitation* — the exact trade the roadmap
   must now decide consciously.
3. **There are two execution engines and only one is wired to a runtime.** The
   Phase-1 control core (`modules/ai-workforce`: `JobRunner`, tool registry,
   permission policy, approval gate, audit) holds the real tool/authority
   machinery. The Phase-2 mission engine (`modules/workforce`:
   `MissionOrchestrator` → `AgentRuntimeDispatcher` → runtime) is what the
   application actually drives, and on that path a `capabilityId` is a
   *declared label* — the work itself is a prompt handed to Hermes.
   `toJobRunnerDispatcher` (the one bridge between them) is referenced only by a
   test, never by the composition root. So NEXUP currently *names* capabilities
   it delegates rather than capabilities it *executes*.

None of these require redesign. All are additive. The minimum refactor is
genuinely small, and only one item is needed before production activation.

---

## 2. CURRENT ARCHITECTURE MAP (repo truth)

### 2.1 The live path

```
Browser / mobile → /command (Next.js App Router)
  POST /api/ai-workforce/missions          (session actor, idempotency key)
    └ requireWorkforceActor()              adapters/api-guard.ts
    └ getWorkforceApplication()            application/runtime.ts  (fail-closed singleton)
         └ resolvePersistence()            policies/persistence-safety.ts
              AI_WORKFORCE_PERSISTENCE=database
              + loopback host, or host named in AI_WORKFORCE_DATABASE_HOSTS under target=production
         └ createWorkforceApplication()    application/composition.ts
              ├ createWorkforceDomainFromPrisma()   persistence/prisma-composition.ts
              │    └ PrismaMission/Task/ExecutionRecord/Review repositories
              ├ bootstrapStrategyAnalyst()          orchestration/strategy-analyst.ts
              │    └ Actor + Capability + Assignment + AgentRuntime
              └ ExecutionReconciler                 execution/execution-reconciler.ts
    └ WorkforceCommandService.submit()     application/command-service.ts
         └ claim(scope, idempotencyKey)    ai_command_intents  (durable idempotency ledger)
         └ MissionOrchestrator.plan()      orchestration/mission-orchestrator.ts
              Mission(DRAFT→PLANNING) + Task rows (PENDING→READY)
         └ MissionOrchestrator.advance()
              └ startTask()
                   ├ ActorRegistry.require(actorId)
                   ├ RuntimeRegistry.runtimeForActor(actor)        runtimes/runtime-registry.ts
                   ├ ActorAssignmentService.hasCapability(...)     assignments/
                   └ AgentRuntimeDispatcher.startJob()             runtimes/agent-runtime-dispatcher.ts
                        ├ refuses with no authorization source
                        ├ refuses unknown actor / missing capability
                        └ runtime.startJob() → AgentJobHandle
                   └ ExecutionRecorder.open() → ai_execution_records
  POST /api/ai-workforce/missions/:id       ← the resumption driver
    └ WorkforceCommandService.drain()
         ├ reconciler.reconcileMission()   re-adopt in-flight handles (never resubmits)
         ├ orchestrator.settleTask()       per RUNNING task, bounded by caller timeout
         └ orchestrator.advance()          promote at most ONE next task
  POST /api/ai-workforce/decisions          ← the ONLY place a task completes
    └ WorkforceCommandService.decide()     APPROVED→COMPLETED / REJECTED→FAILED / REVISION→READY
```

### 2.2 Hermes leg

```
HermesRuntimeAdapter (runtimes/hermes/hermes-runtime-adapter.ts)
  ├ mapJobToHermesPayload()   capability + actor + mission + constraints → {instruction, contextJson}
  ├ HermesBridgeTransport     HMAC-signed HTTP → VPS bridge (HERMES_RUNTIME_BRIDGE_URL)
  │     └ bridge/src/api/app.ts
  │          ├ pre-auth rate limit → signature verify → clock skew → replay nonce
  │          ├ assertNoCallerProfile()               the profile is pinned server-side
  │          ├ allowlist: 6 session methods + gateway.ping   (llm.oneshot EXCLUDED)
  │          └ hermes/client.ts → ws://127.0.0.1:9119/api/ws   (loopback-only, hard refusal)
  │               profile: 'saieed'  (positive allowlist both sides)
  └ status/result mapping → AgentExecutionRecord → ai_execution_records
```

### 2.3 The second (unwired) engine

```
/api/ai-workforce/jobs/**  →  modules/ai-workforce  (Phase 1 control core)
   createCore() → JobRunner (stateless, compare-and-set transitions)
        ├ ToolRegistry  (tool-definition.ts: schemas, permissions, risk, cost policy, retry/timeout)
        ├ PermissionPolicy  (mirrors the legacy session role/flags/business scope)
        ├ ApprovalGate / approval-service (money + high risk)
        ├ LocalRuntimeAdapter  → read-only ports (clients / projects / capital)
        └ run-recorder → ai_runs, ai_run_events, ai_approvals
   dispatchAgent: NOT SUPPLIED by the app bootstrap → jobs never reach Hermes.
```

### 2.4 Who controls what

| Question | Answer (repo truth) |
|---|---|
| Where do orchestration decisions live? | `MissionOrchestrator` — the ONLY place mission/task state advances |
| What does `MissionOrchestrator` control? | mission+task state machine, dependency gating, dispatch of one task, settle, retry edge, human review parking, cancellation, mission-state reconciliation |
| What does Hermes control? | **everything inside the run** — reasoning, planning, tool choice, model choice, output. NEXUP sees only `{output, outputText, status, error}` |
| What does the Bridge abstract? | network exposure, authentication, profile pinning, method confinement, redaction, rate limits, SSE progress |
| What does `AgentRuntime` abstract? | execution hosting: start / status / events / wait / cancel / adopt |
| Where do Hermes assumptions leak? | exactly two places, both intentional: the composition root (`strategy-analyst` → `createHermesRuntimeFromEnv`) and `runtimes/hermes/**` |
| Where do provider/model assumptions leak? | nowhere on the mission path; the only model surface is `ActorModelPolicy`, unread |
| Where do persistence assumptions leak? | `persistence-safety.ts` (policy) and the Prisma repositories. The domain contracts are storage-neutral (`MissionRepository`, `TaskRepository`, `ExecutionRecordRepository`, `ReviewRepository`, `CommandIntentRepository`) |
| Where are tools coupled to agents? | they are not: tools are bound to *runtimes* via capability permissions, and handlers receive ports. The coupling that exists is the opposite — tools are bypassed entirely on the mission path |

### 2.5 Component classification

| Component | Class |
|---|---|
| `AgentRuntime`, `AsyncAgentRuntime`, `AgentExecutionRecovery`, `isReconcilableRuntime` | **KEEP** |
| `RuntimeRegistry.runtimeForActor` (null is a first-class answer) | **KEEP** |
| `MissionOrchestrator` (single state advancer, human review default ALWAYS) | **KEEP** |
| `ExecutionReconciler` (ADOPTED / UNKNOWN / UNAVAILABLE, never resubmits) | **KEEP** |
| `CommandIntent` ledger + compare-and-set transitions | **KEEP** |
| `persistence-safety.ts` (two-statement enable + host allowlist + loopback rule) | **KEEP** |
| `bridge/**` (HMAC, nonce, rate limit, pinned profile, method allowlist, loopback) | **KEEP** |
| Actor / Capability / Assignment contract shapes | **KEEP** (already carry model policy, memory scope, approval policy, runtime requirements) |
| Actor / Capability / Assignment **registries** | **KEEP + EXTEND** → must become durable before a real roster exists |
| `CapabilityRuntimeRequirement.requiredRuntimeTypes` | **KEEP + EXTEND** → becomes the ModelRouter's selection input |
| `ActorModelPolicy` | **KEEP + EXTEND** → wire to a real `ModelRouter`; today unread |
| `EstimatedCostPolicy` | **KEEP + EXTEND** → becomes the Budget Governor's per-execution class |
| `HermesRuntimeAdapter` + transports | **KEEP + EXTEND** → add the profile/skill/memory surface deliberately |
| `Bridge` method allowlist | **REFACTOR BOUNDARY** → the place where Hermes reach is widened or not |
| `modules/ai-workforce` JobRunner + tool registry | **KEEP**, but decide: rejoin the mission path, or be retired as "Phase-1 legacy" |
| `toJobRunnerDispatcher` binding | **REPLACE** (it's a test-only seam; the real decision is above) |
| `src/components/command/state/*` ModelRoute/Budget/actor mocks | **REPLACE** by Step 6 against real registries |
| `/office/ai-workforce` page | **REMOVE** (legacy naming; the operator UI is `/command`) |
| Vercel + Hostinger dual deploy story (`DEPLOY.md`) | **REMOVE** one — two documented hosts is a governance hole |

---

## 3. TARGET ARCHITECTURE MAP

```
┌─────────────────────────── NEXUP (governance / control plane) ───────────────────────────┐
│                                                                                          │
│  OPERATIONS PLANE (the company)              ENGINEERING PLANE (the product)             │
│  /command + /api/ai-workforce/**             EngineeringController (NEW)                 │
│  Human authority: approve / reject / cancel   ├ read:  diagnostics (no credentials)       │
│                                               ├ edit:  branch via git provider            │
│  MissionOrchestrator  ← single truth          ├ test:  CI on the branch                   │
│    Mission → Task → Assignment → Review       ├ preview: preview deployment               │
│                                               └ deploy: gated, human-approved, audited     │
│  ── authority services ──                     EngineeringRuntime port (NEW)                │
│  PermissionPolicy · ApprovalGate ·            ├ CodexAdapter                              │
│  RiskClassification · MoneySafety ·           ├ FreeBuffAdapter                           │
│  human review (ALWAYS)                        └ FutureAdapter                             │
│                                                                                          │
│  ── new: intelligence selection ──                                                       │
│  ModelRouter        (tier selection, no provider hardcode)                                │
│  BudgetGovernor     (Tier 0/1/2/3, spend ceiling, no silent top-up)                       │
│  ContextAssembler   (business truth + agent memory → bounded prompt context)              │
└───────────────────────────────────────┬──────────────────────────────────────────────────┘
                                        │  AgentRuntime port  (unchanged contract)
                    ┌───────────────────┼───────────────────┬────────────────────┐
                    │                   │                   │                    │
              HermesAdapter      FutureRuntimeAdapter   DeterministicRuntime   HumanRuntime
                    │                                                            (review step)
              ┌─────▼─────┐
              │  BRIDGE   │  auth · profile pin · method confine · redaction · limits
              └─────┬─────┘
                    │  loopback only
              ┌─────▼──────────────────────────────────────────────┐
              │ Hermes profile `saieed`  (persistent agents,        │
              │ skills, memory, sessions, subagents, cron)          │
              └────────────────────────────────────────────────────┘

    Supabase / Postgres  =  durable business truth (System of Record)
    R2                   =  files ·  Hermes profile store = agent memory (NOT business truth)
```

---

## 4. GAP MATRIX

| # | Current | Target | Gap | Severity | When required | Change |
|---|---|---|---|---|---|---|
| 1 | `ActorModelPolicy` / `EstimatedCostPolicy` exist, unread | `ModelRouter` + `BudgetGovernor` on every execution | No spend or model decision point exists | **HIGH** | Before any execution can reach a paid provider | Add a router + governor between dispatcher and runtime; persist the decision on the execution record |
| 2 | Hermes run = 1 prompt, 6 methods | Hermes used at native strength where it helps | Skills, memory, subagents, cron unreachable | **HIGH** (capability) / LOW (safety) | Before the "digital company" claim (Step 8) | Extend the bridge allowlist deliberately, method by method, each with its own profile scope |
| 3 | Advancement requires an inbound HTTP request (`drain`) | Durable, self-driving long-running work | No scheduler/lease/heartbeat; a mission stalls when nobody calls | **HIGH** | Before any unattended/8-hour mission | One leased worker loop + `next_run_at` on the mission; reuse the existing reconciler |
| 4 | Actor/Capability/Assignment registries are in-memory, re-seeded per boot | Durable roster of record | Config lives in code; a roster cannot be edited | **HIGH** | Before Step 6 draws real Command Center data | Add `ai_actors` / `ai_capabilities` / `ai_assignments` tables + repositories (contracts already exist) |
| 5 | No engineering plane; remote work needs the DB credential | Contracted engineering controller with scoped permissions | Engineering agents have no boundary | **HIGH** (security) | Before the next remote development cycle | Define the plane as a contract + permission ladder; no broad DB credential for agents |
| 6 | Two engines, one wired | One execution authority | Capability is a label, not an executable | **MEDIUM** | Before real capability work (Step 7/8) | Decide: capability → ToolDefinition → adapter on the mission path, or retire the job engine |
| 7 | No external adapters (`social.publish`, `crm.*`, `email.send`) | Capability → Adapter → external system | No integration surface | **MEDIUM** | Per capability, as needed | Add adapters behind the existing `ToolAdapter` shape; no boundary change needed |
| 8 | No RLS; app-level authorization only | Stated posture | DB is one credential away from everything | **MEDIUM** | Before commercial scale / multi-tenant | Decide explicitly: app-level (current) vs RLS. Do not add RLS "just in case" |
| 9 | Two migration ledgers (Supabase CLI on prod, Prisma registered) | One authority | `prisma migrate deploy` would replay 14 migrations | **MEDIUM** | Before the next schema change lands | Declare ONE authority; baseline the other. Do not reconcile as part of this audit |
| 10 | Grader: no prompt-injection containment between Hermes output and tool execution | Tool calls authorized by NEXUP, not by model output | **MEDIUM** | Yes | Before autonomous write capability | Keep tools unreachable from model output; the current design already does this — protect it |
| 11 | No CI (`.github` absent) | Tests run on every branch | No gate for engineering agents | **MEDIUM** | Before engineering plane opens | Add a workflow running `vitest` + `eslint` + `tsc` |
| 12 | Deploy story split (Vercel + Hostinger doc) | One host | Ambiguous production target | **LOW** | Before Step 6 | Delete the stale guide |

---

## 5. KEEP / CHANGE / REMOVE TABLE

**KEEP (do not rewrite — these are the foundation):**
`AgentRuntime` + `AsyncAgentRuntime` + `AgentExecutionRecovery`; `RuntimeRegistry`;
`MissionOrchestrator`; `ExecutionReconciler`; the `CommandIntent` ledger; the
compare-and-set repository pattern; `persistence-safety.ts`; the whole
`bridge/**` security posture; the actor/capability/assignment *contract shapes*;
`LocalRuntimeAdapter` + read ports; the review-gates-everything default.

**CHANGE (extend, don't replace):**
- `Actor`/`Capability`/`Assignment` registries → durable repositories.
- `AgentRuntimeDispatcher` → gains a ModelRouter/BudgetGovernor step.
- `HermesRuntimeAdapter` → gains the extended Hermes surface behind explicit flags.
- `AgentExecutionRecord` → gains `modelRef` + `costClass` (audit of spend).
- Capability registry → gains the executable binding (or is retired in favour of one engine).

**REMOVE (deliberately, with a migration):**
- `toJobRunnerDispatcher` as a test-only seam (resolve which engine owns execution).
- `/office/ai-workforce` page (legacy naming).
- `DEPLOY.md` Hostinger guide (stale).
- The UI `ModelRoute`/`Budget` mocks — replaced by Step 6, not before.

---

## 6. HERMES DECISION

**Preferred relationship (correct, and to be adopted):** NEXUP = governance and
control plane; Hermes = primary cognitive/agent runtime.

**Why it beats the current shape** ("NEXUP orchestrates intelligence, Hermes
executes jobs"): the current shape makes NEXUP re-implement planning,
decomposition and tool selection — which it does not do and should not — while
preventing Hermes from using its own agent loop. Every capability NEXUP adds
would otherwise have to be built twice.

**Hermes MUST own:** reasoning, planning, decomposition, tool *choice within a
run*, subagent delegation, session continuity, profile memory, skill execution,
parallel work inside a mission step, model routing *inside its own tier*,
long-running work and its own recovery.

**Hermes MUST NEVER own:** the mission/task lifecycle; who may act
(`Assignment`); the permission set; financial authority; the human approval
gate; the audit of record (`ai_execution_records`, `ai_run_events`); mission
identity and idempotency; the durable business truth; security policy; and the
choice of which profile is addressable.

**Concretely, the reach decision to make (one decision, several steps):**
today 6 methods. The next deliberate step is **profile-scoped skills + memory**
(`session.create` already gives sessions; what is missing is a way to *name* a
skill and to *read back* what the profile learned). Subagents and cron should
follow only once the Budget Governor exists, because both multiply spend
silently. Each widening is a reviewable bridge-allowlist change with its own
test — never a generic proxy (`llm.oneshot` stays excluded).

---

## 7. SUPABASE DECISION

**The foundation is sound — better than the target requires.** Verified:

- Zero `@supabase/*` in `package.json`; a repo-wide search for `@supabase|SUPABASE_|supabase-js` returns **0 matches**.
- Auth is **NEXUP's own**: `jose` JWT + `bcryptjs` (`src/lib/auth.ts`), not Supabase Auth.
- File storage is **R2** via `@aws-sdk/client-s3` (`src/lib/r2.ts`), not Supabase Storage.
- No RLS anywhere in `prisma/migrations`.
- Persistence is Prisma 7 + `@prisma/adapter-pg` + `pg`.

⇒ Supabase is being used as **managed Postgres**, exactly as intended. Replacing
it with another managed Postgres is a connection-string change plus a migration
re-application; nothing in the application names Supabase. Keep it.

**What must change: migration governance.** Production carries the **Supabase CLI
ledger** (3 entries: `add_mcp_audit_log`, `add_mcp_pending_action`,
`add_capital_ledger_and_fixed_expenses`) and **no `_prisma_migrations`** table,
while 14 Prisma migrations are registered in `prisma/migrations/`. Any naive
`prisma migrate deploy` would replay all 14 onto a populated database. Two
further facts to hold: production carries two **unmodelled** tables with live
rows (`McpAuditLog` 12, `McpPendingAction` 2) that no code in this branch reads,
and `CapitalSpend.spendType/recipientName/recipientPartnerId` are drift items.

**One authority, recommended:** **Prisma is the sole schema authority going
forward**, and the production baseline is recorded **once** by marking the 14 as
applied (`prisma migrate resolve --applied`) on the already-matching database —
never by replaying them. The Supabase CLI ledger is retained read-only as
historical evidence and used for no further DDL. Nothing here is reconciled in
this audit.

**Is a Persistence abstraction justified?** It already exists and is *correctly
scoped*: interface + Prisma implementation **only** for the four lifecycle
repositories, the command-intent ledger and the read ports. That is the right
amount. A generic `Repository<T>` layer, a unit-of-work, or a second ORM would
be abstraction for abstraction's sake — **do not add one**.

---

## 8. COST ARCHITECTURE (ADDITIONAL VARIABLE AI SPEND = 0 BY DEFAULT)

**Current state: NEXUP cannot spend anything, and also cannot stop anything.** It
holds no provider key, calls no model API, and reaches exactly one Hermes profile
through one bridge. There is no budget code path at all. That is safe by
omission, not by design.

**Where this belongs architecturally:** between `AgentRuntimeDispatcher` and the
`AgentRuntime`, so no execution can be started without having been *classified*
first. The classification is derived from data that already exists in contracts:

```
Capability.runtimeRequirements.requiredRuntimeTypes
Capability.riskLevel / approvalRequirement
Actor.modelPolicy { strategy, preferredModelRef, fallbackModelRef, maxCostTier, dataHandling }
ToolDefinition.estimatedCostPolicy { kind, units }
```

**ModelRouter** (new, small): resolves a *logical tier* — `FREE_LOCAL`,
`INCLUDED`, `INCLUDED_STRONG`, `PREMIUM` — never a vendor model id. It reads the
actor's policy, the capability's requirement and the declared tier of each
registered runtime, and emits an ordered candidate list with a fallback chain.
Agents never name a model.

**BudgetGovernor** (new, small), evaluated per execution:

| Tier | Meaning | Default |
|---|---|---|
| 0 | no LLM — deterministic code/tools | allowed |
| 1 | free / local / included cheap | allowed |
| 2 | strong included intelligence, when justified | allowed with a recorded justification |
| 3 | premium / paid | **BLOCKED** unless the owner approves that specific execution |

Rules: no auto-top-up; no silent pay-as-you-go fallback; when the free/included
quota is exhausted the order is **fallback → local/free alternative → queue and
wait**, never purchase. Every decision is written onto the execution record
(`modelRef`, `costClass`, `tier`, `fallbackReason`) so spend is auditable after
the fact. The Governor must be able to refuse *before* the transport call, which
is why it belongs at the dispatcher, not inside the Hermes adapter.

**Required before production activation:** because the mission path can reach the
owner's Hermes profile, the ceiling that actually protects today is at
*Hermes*, not in NEXUP. One explicit statement is needed — which model/profile
`saieed` runs on and its spend ceiling — plus the rule that no *second* profile
and no premium transport is ever reachable from NEXUP. The BudgetGovernor itself
is not required to *start* the lifecycle; it is required before the lifecycle can
grow.

---

## 9. OPERATIONS vs ENGINEERING PLANES

**Operations Plane — exists, sound.** `/command` + `/api/ai-workforce/**`,
session-authenticated, business-scoped, human-authoritative. Contracts:
`WorkforceCommandService` (issue/drain/decide/cancel/snapshot), never a direct
state write from a route.

**Engineering Plane — does not exist.** A repo-wide search for
`codex|freebuff|engineering plane|deploy hook` in `src/`, `scripts/`, `docs/`,
`.github/` returns **0 matches**, and there is no CI. Today the only way an
engineering agent can do anything is to be handed the production environment —
which is precisely the uncontrolled production access the mission forbids.

**The boundary to define (contract first, implementation later):**

```
Saeed (mobile/desktop) → EngineeringController → EngineeringRuntime port → CodexAdapter | FreeBuffAdapter | FutureAdapter
                              │
                              └ every action carries an explicit permission, audited
```

| Permission | Scope | Default |
|---|---|---|
| READ | repository, docs, logs (redacted) | granted |
| EDIT_BRANCH | a new branch, never `master` | granted |
| RUN_TESTS | CI on that branch | granted |
| CREATE_PREVIEW | preview deployment, isolated env | granted |
| DEPLOY_APPROVED | production, only after a human approval row | **denied by default** |
| PRODUCTION_DIAGNOSTICS | read-only, scoped queries | **denied by default** |
| PRODUCTION_MUTATION | schema/data change | **denied — a separate, explicitly approved act, always** |

The Engineering Plane is a *separate credential domain*: engineering agents get a
git/deploy credential and a **preview** database URL, and never the production
`DATABASE_URL`. That single rule is what makes remote development safe, and it is
achievable now because the persistence policy already refuses non-allowlisted
hosts under `local`.

---

## 10. MINIMUM REFACTOR PLAN (ordered, smallest first)

**Required before production activation of the already-proven lifecycle (3 items):**

1. **Declare the intelligence ceiling.** A written statement of what `saieed`
   uses, its ceiling, and the rule that no second profile/premium transport is
   reachable. No code.
2. **Freeze the migration authority decision** (Prisma-as-authority + one-time
   baseline) and record it in the migration package. No schema change.
3. **Make the extended Hermes surface a decision, not a default.** Confirm the
   bridge allowlist and profile allowlist are the *only* widening point, with a
   test asserting `llm.oneshot` and any second profile are refused.

**Required before Step 6 (real Command Center data):**

4. **Durable actor/capability/assignment registries** (`ai_actors`,
   `ai_capabilities`, `ai_assignments`) + repositories. Contracts exist; this is
   plumbing. Step 6 cannot draw a real roster without it.
5. **CI** (`.github/workflows`: `vitest`, `eslint`, `tsc`) — the gate the
   engineering plane will need.
6. **Delete the stale artifacts**: `/office/ai-workforce`, `DEPLOY.md`'s
   Hostinger guide, and the `ModelRoute`/`Budget` UI mocks once Step 6 replaces
   them.

**Required before autonomous / long-running work (Step 8 claim):**

7. **ModelRouter + BudgetGovernor** (Section 8), with the decision recorded on
   the execution record.
8. **One leased worker loop** with `next_run_at` + heartbeat, reusing the
   existing `ExecutionReconciler` for recovery. Not a queue product.
9. **Engineering Plane contract** (Section 9) with its permission ladder.
10. **Reach decision executed**: skills + memory first, subagents/cron after the
    Governor exists.

**Required before commercial scale:**

11. One external capability adapter end to end (`social.publish` or `email.send`)
    to prove the Capability → Adapter path on the mission engine.
12. Explicit RLS posture decision (app-level or DB-level — not both halves).
13. OpenTelemetry-style tracing across NEXUP → bridge → Hermes correlation ids.

---

## 11. WHAT CAN WAIT (prevent scope explosion)

Do **not** build any of these now: Kubernetes, Kafka, Temporal, microservices,
a second database, Redis, a vector database, a message broker, a separate cache
tier, a generic `Repository<T>` abstraction, an ORM replacement, an event bus, a
streaming architecture, multi-region, or a worker framework. Each of them solves
a problem the current scale does not have, and each would obscure the seams that
already work.

Also defer: re-plotting the mission path through the Phase-1 tool engine
(decide, don't build, in step 6 of section 10); per-actor avatar/presence work
(Step 7); the entire Command Center data mapping (Step 6, blueprint already
written).

---

## 12. RISK REGISTER

| Rank | Risk | Impact | Mitigation |
|---|---|---|---|
| 1 | An engineering agent obtains production DB or Vercel credentials, making every other control moot | total | Engineering plane + preview-only credentials (Section 9); CI |
| 2 | Hermes is asked to perform financial or publishing work with no governed spend and no capability adapter | real money, real brand | Keep Tier-3 blocked; capability adapters with approval; money-safety already rejects money-writing tools without approval |
| 3 | A mission stalls silently because nothing drives it (no scheduler) and an operator assumes it is running | trust | Make stillness observable: a mission with no active drain and a non-terminal state must surface as STALLED in the Command Center |
| 4 | Two engines diverge — a capability that exists in one registry and not the other | correctness | Decide one execution authority; if both remain, add a parity test |
| 5 | Migration authority conflict causes a destructive replay | data loss | The preflight control already refuses it; keep it refusing |
| 6 | Reconciler is never called in production (no cron), so restarted work stays RUNNING forever | availability | The leased worker loop; the drive endpoint is a stopgap |
| 7 | Hermes output is trusted as an instruction | injection | Tools stay unreachable from model output — preserve this invariant explicitly in the engineering plane too |
| 8 | Production carries two unmodelled tables with live rows and no reader | governance | Model or explicitly freeze them; do not delete |

---

## 13. ROADMAP IMPACT

**No new top-level steps.** The Architecture Gate lives inside Step 5/8. The
authoritative roadmap labels are:

```
STEP 1/8 ✅ Command Center
STEP 2/8 ✅ Production Bridge
STEP 3/8 ✅ First NEXUP → Bridge → Hermes run
STEP 4/8 ✅ First real Agent
STEP 5/8 🟡 Architecture Gate + Mission Lifecycle / Production Activation
STEP 6/8 ⏳ Real Command Center Data
STEP 7/8 ⏳ Character Identities
STEP 8/8 ⏳ Full end-to-end digital company
```

Documents in `docs/` currently label Step 5 as
"Mission Lifecycle / Production activation" and Step 8 as blank; the corrected
Step-5 label above (which adds **Architecture Gate**) and the Step-8 label are
the only roadmap edits this audit implies. The gate does not move the step
boundary: production activation remains inside Step 5/8, after the gate.

---

## APPENDIX C — ACTOR MODEL (brief section C)

**`NEXUP Actor → Runtime Binding → Hermes Profile/Bot` is the correct model**, and
the repository already expresses its first two links: `Actor.runtimeBinding =
{ runtimeId, runtimeType, profileRef, requiredCapabilities }`,
`runtimeRefForActor(actor)`, and `requiresRuntime(type)` which returns true for
`AI_AGENT` only — so a human or a service identity has *no* runtime and the
type system says so instead of fabricating one.

What exists today: `actor_founder` (HUMAN), `actor_exec` (EXECUTIVE, no runtime),
and `internal-strategy-analyst` (AI_AGENT, bound to the one Hermes runtime, one
capability, one assignment, `maxRiskLevel: MEDIUM`).

**The decisive finding for the third link.** The adapter addresses exactly ONE
profile (`saieed`), pinned server-side by the bridge and enforced by a positive
allowlist on both sides. `profileRef` is carried opaquely and never read. So:

- an **ephemeral specialist** needs a Hermes **session**, not a profile — and the
  adapter already mints one (`session.create` per run). Ephemeral specialists are
  therefore *already supported* and need no allowlist change: isolate by session,
  bound the run by `timeoutPolicy`, release on terminal status.
- a **persistent agent** (EXES, Strategy / Growth / Sales / Creative / Tech /
  Finance Controller) needs continuity *across* runs — i.e. a profile or a
  Hermes-side persistent bot. **That is the widening decision**, and it is the only
  one that changes the security posture: it means the profile allowlist grows from
  one entry to N, each entry a reviewable act.

| Class | Examples | Identity | Memory | Skills | Permissions | Hermes mapping |
|---|---|---|---|---|---|---|
| Persistent agent | EXEC, Strategy / Growth / Sales / Creative / Tech Director, Finance Controller | durable actor row; one stable `profileRef` | `memoryScope: ACTOR` or `DEPARTMENT`, `retention: LONG_TERM` | named capability set, versioned + revocable via assignments | explicit `permissions[]` + `approvalPolicy`; money roles `RISK_AT_LEAST HIGH` | one pinned profile per persistent agent (NEW allowlist entry) |
| Ephemeral specialist | a research pass, a draft, a one-off analysis | actor row may be seeded/parameterised; no standing identity | `memoryScope: MISSION` or `NONE`, `retention: EPHEMERAL` | a single capability, granted for the mission and revoked on completion | `maxRiskLevel` bounded by the grant constraints | a **session** under its parent's profile — no allowlist change |

The rule to preserve: **an ephemeral specialist may never escalate.** Its
assignment is the ceiling; it inherits no persistent memory and its output is
advisory until a human or a persistent agent accepts it.

What must change: `actors`, `capabilities` and `assignments` become durable
tables (gap 4) — otherwise a roster cannot exist and `profileRef` can never mean
anything stable.

---

## APPENDIX D — CONTEXT & MEMORY ARCHITECTURE (brief section D)

The company must not depend on one model remembering everything. The repository
already separates the two stores conceptually — and already has the one
mechanism that keeps them from duplicating each other.

**The mechanism that exists:** `mapJobToHermesPayload` builds a bounded context
object carrying `actor`, `capability`, `mission`, `constraints`, `approval` and
**`contextRefs` sliced to 8 entries**, serialised with a byte cap
(`DEFAULT_MAX_CONTEXT_BYTES`). NEXUP therefore already sends *references* to
business truth, not copies of it. That is the correct pattern and must be
protected, not replaced.

| Store | Contents | Authority |
|---|---|---|
| **Postgres (System of Record)** | clients, projects, missions, tasks, execution attempts, reviews/decisions, approvals, capital + ledger, files' metadata, audit (`ai_runs`, `ai_run_events`) | **authoritative, always** |
| **R2** | file bodies | authoritative for bytes; referenced by id |
| **NEXUP mission context** | `mission.input`, `task.input`, run `output`/`outputText` | authoritative for the work order |
| **Hermes profile store (agent memory)** | learned preferences, role knowledge, reasoning summaries, skill refinements | **advisory only** |
| **Ephemeral run context** | the bounded `contextJson` for one execution | disposable |
| **Vector retrieval** | not present, and **not justified yet** — context is bounded by 8 refs + a byte cap | — |

**What belongs where, stated as rules:**

1. Business truth lives in Postgres and is **never copied** into agent memory.
   Hermes receives ids (`contextRefs`), never a mirror of a client, a balance or
   an approval.
2. Agent memory lives in the Hermes profile store and is **never** consulted for
   money, permissions, approvals or mission state.
3. **On conflict, Postgres wins, unconditionally.** If Hermes "remembers" a
   client balance or an approval that NEXUP's rows contradict, the rows are the
   truth and the memory is stale — the runtime must be given the rows again on
   the next run.
4. Durable business lifecycle stays in NEXUP (`ai_missions`/`ai_tasks`); a
   session is not a business record.

The one new component is a **ContextAssembler**: the piece that decides which
bounded slice of business truth a given actor+capability+mission may see, so a
model never receives the whole database and never has to "remember" anything to
be useful. `ActorMemoryScope` (`scope`, `retention`, `namespaces`) is already the
right configuration surface for it — currently unread (default `NONE` /
`EPHEMERAL`), which is the safe default to keep until the assembler exists.

---

## APPENDIX N — FAILURE / REPLACEMENT EXERCISES (brief section N)

| # | Scenario | CURRENT impact | TARGET impact | Required protection |
|---|---|---|---|---|
| 1 | **Hermes disappears tomorrow** | No execution. In-flight attempts reconcile to `UNAVAILABLE` ("could not look"), which is correctly *not* treated as failure and is never resubmitted. The mission parks. | A second adapter is selected by the ModelRouter | The port already provides this. Add: adapter `healthCheck()` driving a `DEGRADED` runtime declaration so a mission parks *visibly* |
| 2 | **Supabase → any managed Postgres** | Re-point `AI_WORKFORCE_DATABASE_URL` + `DATABASE_URL`; re-apply schema. Nothing in the app names Supabase (0 matches; no Supabase Auth, no RLS, no Supabase Storage) | same | One declared migration authority (gap 9) |
| 3 | **Current model becomes too expensive** | **No protection exists.** NEXUP has no model layer, so it cannot detect, downgrade or refuse | Router falls back `PREMIUM → INCLUDED_STRONG → INCLUDED → FREE_LOCAL`; Governor refuses Tier 3 without approval | ModelRouter + BudgetGovernor (gap 1) — the single largest hole |
| 4 | **FreeBuff disappears** | **Zero impact.** No reference to FreeBuff exists anywhere in the repo | Adapter swap behind `EngineeringRuntime` | Define that port before depending on it (gap 5) |
| 5 | **Codex replaced by a better agent** | Zero impact today (no integration) | Adapter swap, no NEXUP change | Same port; keep the boundary provider-neutral |
| 6 | **X / Meta / WhatsApp changes API** | Zero impact today (no external adapters exist) | One adapter changes; agents never notice | Preserve `ToolAdapter = {definition, handler}` + ports as the only external surface |
| 7 | **Agent crashes mid-way through an 8-hour mission** | **Best-handled case in the system.** The record is durable; the reconciler reports `ADOPTED` / `UNKNOWN` / `UNAVAILABLE`; `UNKNOWN` is explicitly *not* a retry; an unverifiable attempt escalates to a human via `escalateUnverifiedExecution` instead of guessing | same | Preserve the invariant "never auto-retry work that may have succeeded". Add the worker loop so recovery does not depend on a human calling the endpoint |
| 8 | **100 concurrent missions** | Bottleneck is threefold: the Postgres pool; the bridge's own caps (`maxConcurrency` 4, 60 req/min); and the fact that advancement is a synchronous inbound HTTP request on a serverless function | Leased worker pool with bounded concurrency; queue depth visible on `/command` | Do **not** raise the bridge limits — they are the spend and blast-radius ceiling. Add leases + a queue, not more parallel callers |
| 9 | **An AI attempts an unauthorized financial / production action** | **Multiple independent blocks.** `assertMoneySafety` refuses a money-writing tool that is not ≥ HIGH risk *and* approval-requiring (at registration, not at run time); `PermissionPolicy` mirrors the legacy role/flags/business-scope and refuses a widening `businessId`; `ApprovalGate`; the dispatcher refuses dispatch with no authorization source or no assignment; the bridge refuses any profile but `saieed`; persistence refuses a non-allowlisted host | same, plus Governor Tier-3 refusal | Preserve: **tools must remain unreachable from model output.** The current design achieves this by never letting Hermes call a tool — only NEXUP does. Any future adapter must keep the call NEXUP-initiated and NEXUP-authorized |

---

## 14. FINAL RECOMMENDATION

The direction is correct, the interesting seams already exist, and nothing needs
to be redesigned. The evolutions are additive and ordered; three of them are
small enough to be statements and tests rather than work.

**ARCHITECTURE SAFE — PROCEED WITH MINIMAL STEP-5 REFACTOR**
