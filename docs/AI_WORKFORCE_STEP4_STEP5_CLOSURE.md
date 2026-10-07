# AI Workforce — Step 4 + Step 5 closure report

**Branch:** `feature/ai-workforce-foundation` · **Audited SHA:** `b438bdc34e3b3bcb25cc9d1f18cbd792e377bc93` (the commit carrying this report adds only documentation)
**Date:** 2026-10-07 · **Master:** `bf701fac705cfbb2672cf931dda3962e7fafc617` — untouched, equal to `origin/master`
**Step 6:** NOT STARTED.

This report is written from a fresh read-only audit of the tree, not from the
implementation summary. Every verdict below was re-derived by reading the code
that is actually on this branch, and every command was re-run on the final tree.
Where a claim could not be re-established, it says so.

---

## 1. Commits

| Commit | What it is |
| --- | --- |
| `5da402c` | Step-4 safety closure (A1 profile allowlist, A2 fail-closed authorization, A3 mock exclusion) |
| `359d922` | Step-4 live cancel evidence |
| `bcd8821` | Durable mission lifecycle behind the existing ports (B/C/D) |
| `29e7f35` | Durability evidence |
| `06e1611` | Read-only Command Center query surfaces (G) |
| `0f8b29a` | Correct two unresolvable commit SHAs in the evidence |
| `bbe68cc` | Durability proved from a second operating-system process |
| `b438bdc` | Durable exhaustion and cancellation proofs |
| `b2648a3` | Re-certify the durability evidence at the process boundary |
| `fefce65` | Drop an unused date helper from the durable adapters |

`33b7549` → `9c13ecb` → `3581cdf` are the earlier Step 3 / 4 / 5 commits this
work builds on.

---

## 2. Gates, re-run on the final tree

| Gate | Result |
| --- | --- |
| `npx tsc --noEmit -p tsconfig.json` | 0 errors |
| `npx prisma validate` | schema valid |
| `node scripts/verify-proposed-migration.mjs …AI_WORKFORCE_PHASE_2/migration.sql` | ok (4× CREATE TABLE, 23× CREATE INDEX, 2× CREATE UNIQUE INDEX, 6× ALTER TABLE) |
| Offline workforce suites (13 files) | **188 passed \| 14 skipped (202)** |
| Durable suites, gated | **9 passed** (persistence) · **1 passed** (live, certified at `bcd8821`) |
| `bridge/` — `tsc --noEmit` + `vitest run` | 0 errors · **202 passed** |
| `bridge/tests/supervisor.test.sh` | **72 passed, 0 failed** |
| `bash scripts/run-persistence-proof.sh` | **9 passed** (real PostgreSQL) |
| `eslint` over `src/modules/workforce`, the new tests and the new scripts | 0 errors, 0 warnings |

The 14 skips are the gated suites: `workforce-step4-live-cancel` (needs
`NEXUP_BRIDGE_E2E=1`), `workforce-step5-persistence` and
`workforce-step5-live-durability` (need `AI_WORKFORCE_TEST_DATABASE_URL`).

Not re-run this session: `tests/workforce-step5-live-durability.test.ts` (1/1
live, certified at `bcd8821`) and `tests/workforce-step4-live-cancel.test.ts`
(1/1 live, certified at `5da402c`). Both require a real execution against the
deployed bridge. Their evidence artifacts pin the commits to check out.

Three `capital*` suites fail locally because they need a PostgreSQL on 5435 that
is not running. Pre-existing, unrelated, unchanged.

---

## 3. Acceptance items

### A1 — Profile isolation is a positive NEXUP allowlist — **DEMONSTRATED**

`NEXUP_ALLOWED_PROFILES = ["saieed"]`; `isNexupAllowedProfile` is
case-sensitive; `assertNexupProfile` throws `PROFILE_NOT_ALLOWED`.
`resolveHermesConfig` refuses before any transport exists, and **every**
transport — HTTP, CLI, RPC, one-shot, bridge and the test double — calls
`assertNexupProfile` (`grep` shows 6 call sites across 6 files).

Proven adversarially in `tests/workforce-step4-safety-closure.test.ts`: `adel`,
`default`, `the-other-operator` and `Saieed` all refuse at the config boundary,
at the bridge transport, and at the RPC transport **with a counting socket
factory showing zero connections**. Adel's profile, data and runtime were never
touched.

### A2 — Capability authorization is mandatory and fail-closed — **DEMONSTRATED**

`AgentRuntimeDispatcherDeps.actors` and `.assignments` are REQUIRED. `resolve()`
consults them unconditionally and refuses with `AUTHORIZATION_UNAVAILABLE` /
`PERMISSION_DENIED` **before** `runtimes.require`, so a refusal performs zero
runtime and zero transport work. A test deliberately casts away the types to
omit `assignments` and proves the refusal plus `submitCalls === 0`; another
proves an unassigned capability and a human actor both stop before the runtime.

### A3 — Real-path mock exclusion — **DEMONSTRATED**

`HermesTransport.provenance` is a required `"PRODUCTION" | "TEST"` field. The
runtime adapter's constructor refuses anything that is not `"PRODUCTION"` —
including an object that simply forgot the field — unless a caller passes
`allowTestTransport: true`. `grep` confirms `allowTestTransport` appears **only
in tests**, and `DeterministicHermesTransport` was moved to
`runtimes/hermes/testing/` and is imported by no production file; a test asserts
it is absent from the `@/modules/workforce` surface. `bootstrapWorkforceDomain`
registers no runtime at all.

### A4 — Live cancellation through the port — **DEMONSTRATED** (certified, not re-run today)

`docs/evidence/step4-live-cancel-2026-10-07.json` records one real run driven
through `AgentRuntime` → `cancelJob` → bridge cancel: actor
`actor_internal_strategy_analyst`, capability `strategy.internal-brief` 1.0.0,
runtime `runtime_hermes_saeed`, profile `saieed`, runId
`run_muy91cuk_84b81ca4`, providerExecutionId `16fac992`, status during
`ACCEPTED`, terminal `CANCELLED`, bridge log with one `run.cancel` 200 and no
completion. `BridgeClient.cancelRun` was not called directly by the driver.

**Step 4/8: COMPLETE.**

### B + D — Durable Mission / Task / ExecutionRecord / TaskReview — **DEMONSTRATED**

Four additive models (`AiMission`, `AiTask`, `AiExecutionRecord`,
`AiTaskReview`) reuse the existing Prisma architecture; **no second persistence
architecture**. States are validated `String`s owned by the existing TypeScript
state machines; no foreign key points into a legacy table, so the legacy schema
is byte-identical. `Prisma*Repository` adapters sit behind the existing ports;
`createWorkforceDomainFromPrisma` binds them into the ordinary domain factory.
All state transitions are compare-and-set (`updateMany` with an expected-state
`in` list) and return `null` on loss. `save()` on a missing execution record
throws a typed `RUN_NOT_FOUND` rather than inserting. The review `decide()` is
now a CAS on `PENDING`, and a lost race surfaces as `APPROVAL_ALREADY_DECIDED`.

In-memory repositories are retained for unit tests.

### C — Safe database change process — **DEMONSTRATED (nothing applied)**

`prisma/proposed-migrations/AI_WORKFORCE_PHASE_2/migration.sql` is proposed, not
applied. `scripts/verify-proposed-migration.mjs` mechanically rejects any
`DROP` / `DELETE` / `TRUNCATE` / `RENAME`, and any `ALTER TABLE` naming a table
the file does not itself create. Negative controls re-run today: a `DROP`
script → exit 1, a foreign `ALTER TABLE "users"` → exit 1, a comment containing
the word DROP → exit 0, a legitimate additive script → exit 0. `grep` confirms
`ai_missions` appears in **no** file under `prisma/migrations/`, so
`prisma migrate deploy` cannot pick the proposal up by accident.

### E — Reproducible audit evidence — **DEMONSTRATED (after a real defect was found and fixed)**

Three secret-free artifacts in `docs/evidence/`, each identifying the tested
commit, its tree fingerprint, the environment, the run/actor/runtime/capability
ids, the bridge correlation and the gated command that reproduces it. The
convention is documented in [`AI_WORKFORCE_AUDIT_EVIDENCE.md`](AI_WORKFORCE_AUDIT_EVIDENCE.md).

**Defect found by this audit:** two full commit SHAs recorded in the evidence
(`359d922…`, `29e7f35…`) did not resolve as git objects, so the fingerprint
certification was unverifiable by anyone else. They were placeholder-grade
strings that never matched the repository. They are corrected in `0f8b29a`, and
all three fingerprints were then re-verified against real objects:

```
28805f25…  3581cdf..5da402c   MATCH
4ea239dc…  359d922..bcd8821   MATCH
01cbdc95…  29e7f35..06e1611   MATCH
b8d64e03…  06e1611..bbe68cc   MATCH   (current certification)
```

### F — Step-5 end-to-end durability — **DEMONSTRATED locally; Step 5 itself still BLOCKED**

`tests/workforce-step5-persistence.test.ts` (9/9, real PostgreSQL) runs
Command → Mission → Task → real Step-4 agent → Execution → PENDING Review →
human approval → COMPLETED Task → COMPLETED Mission, then re-reads the chain
through fresh domains, and — since `bbe68cc` — through **a separate
operating-system process** (`scripts/read-durable-mission.cjs`) that imports
nothing from `src/` and therefore cannot reach any registry or module state the
test built. It also proves, durably: a stale snapshot loses its compare-and-set;
a second decision is refused across processes; a non-human approver is refused;
both attempts of a retry persist with their own keys, records and audit trails;
**a retryable failure returns the task to `READY` and, once the allowance runs
out, the task and mission end `FAILED`**; **a cancel through the runtime port
leaves the execution record, the task and the mission `CANCELLED`, with the
timestamp and reason**; foreign keys and the `(missionId, sequence)` unique hold;
a missing execution record is a typed error, not an insert.

`tests/workforce-step5-live-durability.test.ts` (1/1, certified at `bcd8821`)
does the same with the **real agent over the real bridge to Hermes `saieed`**.

**But the database in both proofs is a throwaway cluster, not NEXUP's.** The
proposed migration has not been applied to production, because doing so requires
the owner's explicit approval against a separate development database. The
mission explicitly forbids faking this, so Step 5 stays open.

### G — Command Center query surfaces — **DEMONSTRATED**

`createCommandCenterQueries` answers Active Missions, execution/agent status,
Recent Activity and the Decision Queue from the four repository **ports**.
It imports only repository interfaces and calls no write method; a test hashes
every repository before and after running all four queries and asserts nothing
changed. It sorts explicitly rather than trusting repository ordering, returns
`TaskState` keys verbatim, and takes an injected clock so a snapshot is
reproducible. No UI was redesigned and no mock was replaced.

---

## 4. The adversarial challenge list

| Challenge | Verdict | Where |
| --- | --- | --- |
| Unauthorized profile (`adel`, `default`, unknown) | **DEMONSTRATED** | config + 3 transports, zero sockets/requests |
| Missing capability authority | **DEMONSTRATED** | `AUTHORIZATION_UNAVAILABLE`, zero runtime calls |
| Mock injection | **DEMONSTRATED** | provenance gate; mock off the production surface |
| Duplicate submit / idempotency | **PARTIAL** | transport replays a duplicate key and refuses to re-run it (offline test); keys are deterministic per task+attempt and distinct per attempt. A repeated *Command* creating a second Mission has **no** dedupe guard |
| Stale CAS update | **DEMONSTRATED** | in-memory and durable |
| Execution failure | **DEMONSTRATED** | in memory and, since `b438bdc`, on the durable path: both attempts persist as `FAILED` with their `TRANSPORT` error category |
| Cancellation | **DEMONSTRATED** | live through the port (certified at `5da402c`), and the `CANCELLED` execution record now persists and re-reads on the durable path |
| Retry exhaustion | **DEMONSTRATED** | in memory and, since `b438bdc`, on the durable path: `maxAttempts` exhausted → task and mission `FAILED`, re-read out of process |
| Duplicate human decision | **DEMONSTRATED** | CAS on `PENDING`, across processes |
| Non-human approval | **DEMONSTRATED** | in memory and durable |
| Process / repository rehydration | **DEMONSTRATED** | fresh domains **and** a separate OS process, from the database alone |

---

## 5. Security and isolation findings

- No credential, HMAC secret, session token or prompt-sensitive string appears
  in any committed artifact. The bridge secret was retrieved without printing it
  and never written to disk.
- The durability proof never reads `DATABASE_URL`; it stands up its own loopback,
  trust-auth cluster and deletes it on every exit path, including failure.
- The local PostgreSQL on 5432 was never touched — its password was never
  guessed.
- NEXUP addresses exactly one Hermes profile. No test or command addresses
  Adel's or `default`.
- Hermes was never restarted, recreated or reconfigured; 9119/9220 were never
  exposed; no Hostinger-managed path was modified; `hymanna-keepalive.sh` was
  never executed.

## 6. Remaining technical debt

1. **No production call site mounts any of this.** `grep` across `src/` finds no
   route, page or service that constructs `AgentRuntimeDispatcher`,
   `createMissionOrchestrator`, `createWorkforceDomainFromPrisma` or
   `bootstrapWorkforceDomain`. Steps 4 and 5 delivered a library plus its tests;
   nothing in the running application dispatches a mission yet.
2. **No process-level restart is exercised**: the proofs re-read through fresh
   clients, fresh domains and one genuinely separate OS process, but never by
   killing and restarting the application.
3. **Command-level idempotency is absent** — two identical Commands create two
   Missions.
4. **`AI_WORKFORCE_PHASE_1B` intentionally fails** the additive verifier (it
   drops a table that was never created). It is reviewed and documented, but the
   mechanical guarantee does not cover it.
5. The live proofs were not re-executed in this final session; they remain
   certified at their own commits.

## 7. Rollback state

Every change is additive and branch-local. `prisma/schema.prisma` changes add
four models and change nothing existing. The proposed DDL touches no existing
table. No migration was applied anywhere real. Reverting the branch removes all
of it; nothing in production depends on any of it.

---

## 8. Roadmap

```
STEP 1/8 ✅
STEP 2/8 ✅
STEP 3/8 ✅
STEP 4/8 ✅   ← safety closure complete, live cancel proven
STEP 5/8 🟡 BLOCKED
STEP 6/8 ⏳ NOT STARTED
STEP 7/8 ⏳
STEP 8/8 ⏳
```

**Exact action required to close Step 5:** the owner must approve applying
`prisma/proposed-migrations/AI_WORKFORCE_PHASE_2/migration.sql` (preceded by
`AI_WORKFORCE_PHASE_1A`/`1B`) to a **separate development database first**,
confirm the additive-only verification and the post-migration table list there,
and only then authorise production. Until then the lifecycle is durable in
design and proven durable in a real database — but not in NEXUP's.

**Step 6 has not been started, as instructed.**
