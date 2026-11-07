# Step 5A-4 — P1 correction handoff (2026-10-11)

Second independent Codex review verdict: **5A-4 REQUIRES CORRECTIONS — DO NOT CHECKPOINT.**
This document is the finding-by-finding correction map, the exact changed files, the
tests run with their **actual** results, the exact-tree build/HTTP/concurrency evidence,
the remaining blockers, and the final git status + fingerprints.

Nothing here is committed, pushed, merged or deployed, and no production/shared database
was contacted. All database work ran on **isolated loopback throwaway clusters**:
`workforce_claim_test`, the app/restart DBs, the `nexup_http_proof` database inside the
isolated development cluster on `127.0.0.1:5501`, and a dedicated fresh cluster on
`127.0.0.1:5435` for the full suite (created and deleted by the run itself).

---

## 1. Finding-by-finding correction map

The review used two numberings: a **table** (`P1-1` … `P1-9`) and a list of **concrete
unresolved findings**. Both are mapped below.

| # | Review finding | Status | Where it is corrected | Proof |
|---|---|---|---|---|
| 1 | **Cancellation does not target the current attempt.** Historical DISPATCHED claim selected; READY cancellation reserved through two writes; multi-task partial cancellation could poison tasks; `cancel()` authority weak. | **FIXED** | `execution-claim.ts` (new `reserveCancellation` / `rollbackCancellation` / `recoveryFor` on the repository contract and the in-memory reference); `prisma-execution-claim-repository.ts` (single-statement `reserveCancellation` INSERT `CANCELLED`); `capability-execution-service.ts` (`cancelMissionAttempts` selects the authoritative current attempt, reserves in ONE write, rolls back on an unresolved task); `execution-authority.ts` (`assertForegroundAuthority`). | `tests/workforce-step5a4-correction-p1.test.ts` P1-1 (4 tests: historical attempt untouched, one-write reservation via a counting ledger, rollback + re-dispatch proof, authority refusal). `tests/workforce-step5a-durable-claim.test.ts` § "the cancellation reservation is ONE atomic, terminal write" (4 tests, **real PostgreSQL**: lands the exact attempt CANCELLED with no stranded CLAIMED row; beats a concurrent dispatch; refuses a live claim and flips a lapsed one in the SAME write; reserves the current attempt and leaves a historical one untouched). |
| 2 | **Idempotency is still caller-controlled** (`request.idempotencyKey \|\| derived`). | **FIXED** | `capability-execution-contracts.ts`: `ExecutionAttemptRequest.idempotencyKey` is documented **IGNORED**; `ExecutionAttemptEnvelope.idempotencyKey` is the derived value. `capability-execution-service.ts`: `envelopeFor()` computes `executionIdempotencyKeyForAttempt(taskId, attempt)` **unconditionally**, synchronously, on entry; the derived key is used for claim, reservation and delivery. | `tests/workforce-step5a4-execution-cutover.test.ts` § "one attempt, one execution, however many callers" — **"IGNORES a caller-supplied key and resolves the same attempt"** (a hostile key can no longer reserve `(task, attempt)` and block the legitimate call). |
| 3 | **Claim/replay classification bypasses final authority checks** — REPLAYED / IN_PROGRESS / UNVERIFIED / CANCELLED metadata reachable by a substituted mission/actor/capability/input; terminal replay wrongly refused by fresh-dispatch state rules. | **FIXED** | `capability-execution-service.ts` `execute()`: the **canonical, non-mutating** authorization runs FIRST; only canonical **identity** refusals (`CANONICAL_IDENTITY_REFUSAL_CODES`) short-circuit **before** the claim, so a substituted request never reaches classification and can create **no** claim row. A legitimate retry of a terminal task still returns `REPLAYED`. | `tests/workforce-step5a4-correction-p1.test.ts` P1-3 (2 tests: a substituted capability creates **zero** claim rows; a legitimate retry of a COMPLETED task still REPLAYS). |
| 4 | **Claim-first recovery is unreachable from application entry points**; READY crash claims not durably escalated; UNVERIFIED disappears after the first sweep; must not redispatch uncertain work. | **FIXED** | `execution-reconciler.ts` (`reconcileDispatchingClaims`, `openClaimIncidents`, durable operator escalation for **both** READY and RUNNING tasks, UNVERIFIED kept in the `listUnresolved` sweep); `application/command-service.ts` (`reconcile()`, `reconcileInFlight()`, `drain()` all invoke claim-first recovery; `claimIncidents()` is the read). | `tests/workforce-step5a4-correction-p1.test.ts` P1-4 (3 tests): an entered-but-unidentified attempt is found through `reconcile()`, `reconcileInFlight()` **and** `drain()`; an UNVERIFIED incident stays discoverable across **repeated** sweeps and surfaces as an inert read; a RUNNING crash claim escalates to a human through a durable PENDING review. Nothing is redispatched and no execution record is fabricated. |
| 5 | **Runtime timeout reported as runtime outage** — `observe()` flattened a thrown `RUNTIME_TIMEOUT` into `UNAVAILABLE`; `settleTask`'s intended non-terminal `RUNTIME_TIMEOUT` branch was unreachable. | **FIXED** | `capability-execution-service.ts`: `observe()` returns a typed `TIMEOUT` outcome carrying the runtime's own non-terminal status; `mission-orchestrator.ts` `settleTask` returns `BLOCKED: RUNTIME_TIMEOUT` and leaves the task RUNNING. | `tests/workforce-step5a4-correction-p1.test.ts` P1-2: `observe` → `TIMEOUT`/`RUNNING`; `settleTask` → blocked `RUNTIME_TIMEOUT`, state RUNNING; the durable record is **not** relabelled. |
| 6 | **Approval policy incomplete** — actor `RISK_AT_LEAST`/`minRiskLevel` ignored; an `APPROVED` record without `decidedAt` bypassed expiry; expiry/binding not enforced. | **FIXED** | `capability-execution-service.ts` `effectiveApprovalPolicy()` merges the composition and the **actor's** policy (most restrictive wins; ALWAYS ≻ RISK_AT_LEAST ≻ NEVER/INHERIT; lower `minRiskLevel` is stricter); an `APPROVED` record must carry a **valid decision timestamp**, must not be dated in the future, must be within expiry, and must match the attempt's exact binding. | `tests/workforce-step5a4-correction-p1.test.ts` P1-6 (3 tests: actor threshold forces approval on an AUTOMATIC attempt while a MANUAL human still passes; an APPROVED record with **no** timestamp is refused; an APPROVED record dated in the future is refused). `tests/workforce-step5a4-execution-cutover.test.ts` § "an approval must be BOUND to the attempt it authorises". |
| 7 | **Mutable-request authorization TOCTOU** — delivery/finalization consumed the caller's mutable `request`. | **FIXED** | `capability-execution-contracts.ts` defines `ExecutionAttemptEnvelope`; `capability-execution-service.ts` `envelopeFor()` deep-clones + `deepFreeze`s the canonical input and authority **synchronously** on entry; every awaited check, the receipt, the deterministic invocation, the runtime submission and finalization read the envelope **exclusively**. | `tests/workforce-step5a4-correction-p1.test.ts` P1-7: the caller parks the preflight inside an `await`, then mutates `request.input` and `request.authority`; the handler still runs the captured input and the durable receipt still names the captured operator. |
| P1-5 (table) | Exact deterministic version | FIXED (prior batch, re-verified) | `capability-lookup.ts` + invoker `descriptorVersion` | `tests/workforce-step5a4-execution-cutover.test.ts`, `authority-correction` |
| P1-8 (table) | Typed budget refusal | FIXED (prior batch) | `capability-execution-service.ts` (`BUDGET_POLICY_DENIED`, structured preflight budget) | HTTP **CASE A** |
| P1-7 (table) | Safe deterministic application path | **FIXED + PROVEN this session** | `workforce-read-only-capabilities.ts`, `governed-deterministic-invoker.ts`, `composition.ts`; see §2 | HTTP **CASE B**, clean build |

### Corrections made **in this session** (on top of the interrupted turn's work)

1. **Read-only deterministic leg was not actually executable (CASE B blocker).** The
   command layer folds the task `instruction` into the capability input
   (`command-contracts.ts`), and a no-input read tool (`capital.summary`, `fields: {}`)
   rejected it as `Unknown field` — every read-only mission attempt failed with
   `INVALID_REQUEST`. `governed-deterministic-invoker.ts` now projects the platform's own
   **envelope keys** out of the input when the target schema does not declare them
   (`PLATFORM_ENVELOPE_KEYS = ["instruction"]`). A tool that *does* declare `instruction`
   keeps it, and any **other** undeclared key is still a hard validation failure — a
   narrow projection of the platform envelope, not a relaxation of the tool contract.
2. **HTTP CASE A assertion corrected to the corrected semantics.** A budget refusal is a
   **policy** refusal decided after the claim, so the attempt is durably accounted for as
   a `RELEASED` claim (dispatch never entered) rather than no row at all. The assertion now
   requires exactly `RELEASED` — never `DISPATCHING`/`DISPATCHED` — which is what "zero
   provider execution" means.
3. **HTTP lifecycle column typo** (`state` → `status` on `ai_execution_records`).
4. **`workforce-step5-persistence.test.ts` composition completed.** The proof composes a
   foreground authority with `accessibleBusinessSlugs: ["nexup"]` and a mission naming
   `biz_nexup`; the dispatch preflight fails **closed** without a business registry
   (P1-3), so the test now supplies the resolver the gate needs.
5. **Lint hygiene**: removed three unused imports in `capability-execution-service.ts`,
   a dead `submissions` field and an unused `ids` parameter in the correction suite.

---

## 2. Exact changed files

**Tracked, modified (33):**

```
scripts/run-api-http-proof.sh
src/app/api/ai-workforce/decisions/route.ts
src/app/api/ai-workforce/missions/[id]/route.ts
src/app/api/ai-workforce/missions/route.ts
src/modules/ai-workforce/core/errors.ts
src/modules/ai-workforce/registry/capability-lookup.ts
src/modules/workforce/application/command-service.ts
src/modules/workforce/application/composition.ts
src/modules/workforce/application/runtime.ts
src/modules/workforce/execution/capability-execution-contracts.ts
src/modules/workforce/execution/execution-authority.ts
src/modules/workforce/execution/execution-claim.ts
src/modules/workforce/execution/execution-reconciler.ts
src/modules/workforce/execution/execution-record.ts
src/modules/workforce/index.ts
src/modules/workforce/orchestration/mission-orchestrator.ts
src/modules/workforce/persistence/index.ts
src/modules/workforce/persistence/prisma-execution-claim-repository.ts
src/modules/workforce/persistence/prisma-lifecycle-repositories.ts
tests/process/app-process-a.test.ts
tests/process/app-process-b.test.ts
tests/process/app-process-c.test.ts
tests/process/app-process-e.test.ts
tests/process/support.ts
tests/workforce-api-http.test.ts
tests/workforce-command-center-queries.test.ts
tests/workforce-step5-adoption.test.ts
tests/workforce-step5-app-integration.test.ts
tests/workforce-step5-app-restart.test.ts
tests/workforce-step5-mission.test.ts
tests/workforce-step5-persistence.test.ts
tests/workforce-step5a-claim.test.ts
tests/workforce-step5a-durable-claim.test.ts
```

**Untracked, new (11):**

```
src/modules/workforce/execution/capability-execution-service.ts
src/modules/workforce/execution/execution-claim-receipt.ts
src/modules/workforce/execution/governed-deterministic-invoker.ts
src/modules/workforce/execution/workforce-read-only-capabilities.ts
src/modules/workforce/orchestration/create-mission-orchestrator.ts
src/modules/workforce/persistence/prisma-execution-attempt-committer.ts
tests/workforce-step5a4-authority-correction.test.ts
tests/workforce-step5a4-correction-p1.test.ts
tests/workforce-step5a4-execution-cutover.test.ts
docs/evidence/step5a4-http-boundary-2026-10-10.json
docs/evidence/step5a4-p1-corrections-2026-10-11.md   (this document)
```

**Files touched only by this session:** `src/modules/workforce/execution/governed-deterministic-invoker.ts`,
`src/modules/workforce/execution/capability-execution-service.ts` (lint only),
`tests/workforce-step5a4-correction-p1.test.ts` (lint only),
`tests/workforce-api-http.test.ts`, `tests/workforce-step5-persistence.test.ts`.

**No** Product Builder or Agent Studio worktree was touched. **No** schema or migration
change was made (`git status` lists no file under `prisma/`).

---

## 3. Tests and actual results

| Validation | Command | Actual result |
|---|---|---|
| P1 correction suite | `vitest run tests/workforce-step5a4-correction-p1.test.ts` | **14 passed / 14** |
| Focused Step 5/5A offline | 7 files (correction-p1, authority-correction, execution-cutover, step5-mission, command-center-queries, step5a3-authority-scope, step5a-claim) | **169 passed / 1 skipped** |
| Durable claim, **real PostgreSQL** (throwaway cluster) | `PROOF_TEST=tests/workforce-step5a-durable-claim.test.ts bash scripts/run-persistence-proof.sh` | **18 passed / 18**, exit 0 — includes the 4 § "cancellation reservation is ONE atomic, terminal write" cases and the race/restart cases |
| HTTP boundary, real `next start` + isolated DB + build of this tree | `bash scripts/run-api-http-proof.sh` | **16 passed / 16**, exit **0** — evidence `docs/evidence/step5a4-http-boundary-2026-10-10.json` |
| Clean exact-tree build | `npm run build` (`prisma generate && next build --webpack`) | **exit 0** ("Compiled successfully", 81/81 static pages) |
| `tsc --noEmit` | `npx tsc --noEmit` | **exit 0** |
| Targeted ESLint | `npx eslint src/modules/workforce src/modules/ai-workforce src/app/api/ai-workforce tests/...` | **exit 0** |
| Prisma validate | `npx prisma validate` | **exit 0** ("schema is valid") |
| Additive migration verifier | `node scripts/verify-proposed-migration.mjs prisma/proposed-migrations/AI_WORKFORCE_PHASE_4/migration.sql` | **exit 0**, "no DROP/DELETE/TRUNCATE/RENAME", only `ai_execution_claims` created |
| Full suite, isolated cluster `:5435` | `TEST_DATABASE_URL=… AI_WORKFORCE_TEST_DATABASE_URL=… npx vitest run` | **487 passed / 16 skipped / 0 failed** (27 files passed, 3 skipped). Process exit **1** solely from 16 unhandled pg-pool `ECONNRESET` errors raised by the **capital** suites' teardown — see §5. |
| `git diff --check` | `git diff --check` | no whitespace errors (only the repository's existing LF→CRLF warnings) |

### HTTP CASE A / CASE B (the two previously-unproven boundaries)

* **CASE A — default runtime denied by BUDGET with zero provider execution.** `201` `ISSUED`,
  the task is neither RUNNING nor COMPLETED, the result reads `BUDGET_POLICY_DENIED`, the
  mission row exists, there are **0** `ai_execution_records`, the claim ledger holds exactly
  **`RELEASED`** (never DISPATCHING/DISPATCHED), and the Phase-1 `ai_jobs`/`ai_runs`/
  `ai_run_events` counts are unchanged.
* **CASE B — real-composition read-only deterministic execution.** `capital.summary` runs
  through the governed deterministic invoker; the durable execution record is **`SUCCEEDED`**
  with a persisted output (`currency: "EGP"`); the task settles to **REVIEW** with a PENDING
  human review over HTTP; the same execution stays `SUCCEEDED`; and the Phase-1 job-engine
  counts are **unchanged** (no AiJob / AiRun / AiRunEvent).

---

## 4. Exact-tree evidence

* Build: `npm run build` **exit 0** on this working tree; the HTTP proof also rebuilt the
  tree itself (`npx next build --webpack` → "build ok") before starting the server.
* HTTP: 16/16 assertions passed against a running `next start` on `127.0.0.1:3111` with real
  signed session cookies, on the `nexup_http_proof` database inside the isolated development
  cluster, using the deterministic test transport (which the application only honours for a
  verified loopback database). The evidence JSON records `exitStatus: "0"`, 3 files / 16 tests
  / 16 passed / 0 failed.
* Concurrency (real PostgreSQL): `workforce-step5a-durable-claim.test.ts` — two independent
  instances yield exactly ONE winner; a burst of six concurrent claims yields exactly one
  winner; the loser CAS is refused; a concurrent cancellation-vs-dispatch race leaves a
  terminal attempt that the racing `claim()` cannot enter; a live claim is refused while a
  lapsed one flips in the same write.

---

## 5. Remaining blockers / limitations (not claimed as passes)

1. **Full-suite process exit is 1 while 487 tests pass and 0 fail.** The non-zero exit is
   caused by **16 unhandled `ECONNRESET` errors** originating in the **capital** test files
   (`capital.test.ts`, `capital-withdrawals.test.ts`, `capital-auth.test.ts`) when their
   shared `pg` pool races the suites' `DROP DATABASE … WITH (FORCE)`. Running **only** those
   three suites against a fresh isolated cluster reproduces it identically: **50 passed /
   0 failed / 16 errors / exit 1**. Those suites are **byte-identical to `master`** and are
   not in this diff, so the artifact is pre-existing and environmental, not a regression of
   this task. It is reported, not hidden.
2. **Multi-task partial cancellation is proven in the in-memory reference, not against real
   PostgreSQL.** The repository-level `reserveCancellation`/`rollbackCancellation` and the
   current-vs-historical-attempt selection **are** proven on real PostgreSQL; the
   orchestrator's multi-task rollback test (`correction-p1` P1-1) uses the in-memory ledger.
   A real-database multi-task cancellation suite remains outstanding.
3. **Claim-first recovery is proven through real application entry points but against the
   reference ledger.** The READY crash claim / UNVERIFIED-discovery / RUNNING-escalation cases
   go through `WorkforceCommandService.reconcile()`, `reconcileInFlight()` and `drain()`; the
   durable claim-first recovery mechanics are separately proven on real PostgreSQL. A single
   test that wires the real application **and** a real PostgreSQL through the recovery entry
   points was not added.
4. **No production/shared-database validation was attempted** (by instruction): the full
   suite ran against a dedicated throwaway cluster created and destroyed by the run.

---

## 6. Final git status and fingerprints

```
branch              : feature/ai-workforce-foundation
HEAD                : 4ecc1a7fd1a28f2a45d2dfbd32a878914133356f
upstream            : origin/feature/ai-workforce-foundation (0 ahead / 0 behind)
index               : empty (nothing staged)
tracked modified    : 33 files
tracked diff        : 33 files changed, 3249 insertions(+), 416 deletions(-)
tracked-diff sha1   : 1372d4b3fed227e17c31c66bcfcac2faeca412ec
untracked files     : 11 (10 source/test artifacts + this document)
untracked (name list, all 11)          sha1 : 5dcc7283438ff5248381599e39cbbf26ee1e98c0
untracked (name list, excl this doc)   sha1 : 2fdbe135c74fc8e81bf16f35d30d537de8bedd38
untracked (file contents, excl this doc) sha1 : 80a23ca45b75daf34aacef8c2b46505487ab0ede
working-tree porcelain sha1 : 4558840cd423508626d8c3d7411310503b76535f
git diff --check    : clean (only existing LF→CRLF warnings)
```

The untracked fingerprints are stated **excluding this document**, because a document cannot
contain a hash of itself; the 10 source/test artifacts are what the hash covers.

Fingerprints are reproducible with:

```bash
git rev-parse HEAD
git diff | sha1sum
git status --porcelain | sort | sha1sum
# over the 10 source/test artifacts, excluding this handoff document:
git ls-files --others --exclude-standard \
  | grep -v 'step5a4-p1-corrections-2026-10-11.md' | sort | xargs sha1sum | sha1sum
```

**Not done, deliberately:** no commit, no stage, no push, no merge, no deploy, no production
contact, no other session's process stopped, no shared cache deleted. The two sibling
worktrees (`nexup-command-product`, `nexup-exec-experience`) were not touched.
