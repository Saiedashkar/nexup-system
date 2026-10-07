# Step 5/8 — final pre-production closure

**Owner command.** Close the remaining technical blockers on
`feature/ai-workforce-foundation` (`4fde70b`) so the NEXT decision can be a
narrow production migration/activation approval. **No production migration was
applied. Step 6 was not started. The production lifecycle was not activated.**
`master` / `origin/master` remain at `bf701fac`.

This document is the closure report. Its last line is the single verdict.

---

## 1. Commits and branch state

| | |
|---|---|
| Authoritative starting point | `4fde70b` (`feature/ai-workforce-foundation`) |
| This closure | the next commit on the same branch (all work below is in it) |
| `master` / `origin/master` | `bf701fac705cfbb2672cf931dda3962e7fafc617` — **untouched** |
| `prisma/migrations/` | still exactly 14 directories, unchanged from `master` (`git diff --stat master...HEAD -- prisma/migrations` empty) |

Nothing in this closure is registered as a migration, and no `.env` /
`.env.local` value was changed (`git diff master...HEAD -- .env .env.local`
empty).

---

## 2. In-flight execution re-adoption — architecture

The proven restart gap was: an execution submitted to the provider outlives the
NEXUP process that submitted it, and the old runtime adapter kept its handle
bookkeeping in memory, so nothing could settle the attempt after a restart.

It is closed by a **provider-neutral recovery service**, not Hermes-specific
orchestration:

- `src/modules/workforce/runtimes/agent-runtime.ts` adds the adoption port —
  `AgentExecutionReference`, `AgentExecutionAdoption` (`ADOPTED` · `UNKNOWN` ·
  `UNAVAILABLE`) and `AgentExecutionRecovery` — plus the `UNKNOWN_REMOTE` error
  category. Any future runtime adapter implements the same port.
- `src/modules/workforce/execution/execution-reconciler.ts` — `ExecutionReconciler`
  — loads the DURABLE record (handleId, providerExecutionId, actor, runtime,
  capability, attempt, timestamps; never process memory), asks the runtime to
  **adopt** the execution, writes what it learned onto the record as a
  `RECONCILED` audit event plus the runtime's own status, and hands a
  confirmed-terminal attempt to the orchestrator — the SAME settle path a live
  dispatch uses. Reconciliation adds no second way to complete a task.
- `hermes-runtime-adapter.ts` implements `adoptExecution()`: it **observes** by
  asking the bridge; it never resubmits. A 404 is preserved as knowledge
  (`UNKNOWN`), other failures are `UNAVAILABLE` (retryable).
- `command-service.drain()` reconciles FIRST, then settles, then advances;
  `advance()` deliberately does NOT reconcile.

Truthful handling of every remote outcome (reconciliation kinds):

| Remote says | Kind | Effect |
|---|---|---|
| still running | `ADOPTED_RUNNING` | nothing moves, nothing is faked |
| finished while we were down | `ADOPTED_TERMINAL` | settles via the orchestrator (→ REVIEW / retry) |
| cancelled while we were down | `ADOPTED_TERMINAL` | task and mission CANCELLED |
| failed while we were down | `ADOPTED_TERMINAL` | FAILED; a provider-reported failure never auto-retries |
| the runtime no longer knows it | `REMOTE_UNKNOWN` | status `UNKNOWN` + `UNKNOWN_REMOTE`, a review is parked for a HUMAN; never a fabricated FAILED, never an automatic retry |
| the runtime can't be asked (outage) | `RUNTIME_UNAVAILABLE` | nothing changes, the attempt is recorded, retry later |
| no runtime registered | `NO_RUNTIME` | reported, not invented |
| the task already moved on | `NOT_RUNNING` | left alone, reported |

---

## 3. Restart / re-adoption proof (real OS processes)

`tests/workforce-step5-app-restart.test.ts` (+ `vitest.process.config.ts`,
`tests/process/*`) spawns whole OS processes against the isolated dev cluster,
sharing nothing but rows. **4/4 passed this closure.**

- **A** issues a Command and exits — either holding an OPEN human decision, or
  with the task RUNNING and the provider run genuinely still alive
  (`APP_PROOF_HOLD_MS`).
- **B** builds a fresh Prisma/application composition, rehydrates the mission
  from the rows, takes the human decision and completes it.
- **C** re-adopts the in-flight execution A left behind — **asserting
  `runsStartedByC === 0`** (it did not resubmit) — settles it to `SUCCEEDED`,
  and the raw rows confirm **exactly one execution row** for the mission, **one
  distinct handle**, and a `RECONCILED` audit event on the row itself.
- **E** covers the run the provider no longer knows: status `UNKNOWN`,
  `error.category = UNKNOWN_REMOTE`, `escalated: true`, `settled: false`, no
  retry, no second run, and a PENDING review in the decision queue.

The parent verifies the final state from a further composition AND from the raw
rows, so no child grades its own work.

`tests/workforce-step5-adoption.test.ts` is the outcome **matrix** on a real
database — one in-flight attempt, then a fresh application whose runtime reports
each remote outcome. **9/9 passed.** Every case also asserts
`transport.counts().runsStarted === 0` and exactly one execution record.

---

## 4. Command / execution exactly-once safety

- Ledger: `ai_command_intents`, unique `(scope, idempotencyKey)`;
  `PrismaCommandIntentRepository` claims with an INSERT and resolves a unique
  violation by re-reading → `claimed` / `replay` / `in-progress` / `conflict`.
  A `FAILED` claim is re-claimable only through a compare-and-set.
- Same key → **same mission, no new task, no second execution**; a reused key
  with a DIFFERENT body → `COMMAND_KEY_REUSED` (HTTP **409**).
- The restart proof re-issues the same Command after two/three real process
  restarts and asserts `kind === "replayed"`, the same mission id, and that the
  execution-record count is **unchanged** — no restart creates a second real run.
- Where true exactly-once cannot be guaranteed across a network boundary, the
  guarantee is made honest rather than assumed: the durable intent row is the
  source of truth, and an unverifiable remote run becomes `UNKNOWN_REMOTE`
  escalated to a human — never an automatic retry (the one edge that could start
  a duplicate run).

---

## 5. HTTP API boundary proof

`bash scripts/run-api-http-proof.sh` builds the app, starts a real
`next start` server, and speaks HTTP to the real routes with real signed session
cookies, on a throwaway database inside the isolated cluster.
**8/8 passed, script exit 0.**

Proven over the wire: unauthenticated **401**; signed-in without workforce
access **403** (before any lifecycle work); issue a Command and read back the
durable mission; idempotent retry returns the **same** mission and creates **no
second execution**; reused key + different command **409**; malformed input
**400** without touching the lifecycle; read · settle · human decision completes
the mission; and **no error body leaks a database URL, bridge endpoint or
secret**.

Routes exercised: `src/app/api/ai-workforce/missions/route.ts` (POST),
`.../missions/[id]/route.ts` (GET read, POST drain), `.../decisions/route.ts`
(GET queue, POST decision; the decider is hard-coded to `actor_founder`).

*Harness note:* the proof script's cleanup was hardened this closure so the
server is actually stopped (the previous `npx` wrapper kill left the
`next-server` child listening; `stop_port_listener()` now also kills whatever
holds the proof port, and the script exits 0 only after the port is free —
verified).

---

## 6. Production database host policy

The loopback-only guard was replaced by an explicit, **fail-closed** environment
policy in `src/modules/ai-workforce/policies/persistence-safety.ts`:

- `AI_WORKFORCE_DATABASE_TARGET` = `local` | `production`;
- `AI_WORKFORCE_DATABASE_HOSTS` = an exact hostname allowlist;
- loopback is **always** allowed;
- a remote host is accepted **only** under `target=production` AND when it is
  explicitly allowlisted;
- malformed URLs, unlisted hosts and unknown targets are **refused**;
- `parseWorkforceDatabaseUrl` was split out so `assertIsolatedDatabaseUrl` stays
  strictly loopback for the isolated-test path;
- **nothing is hardcoded** — no project ref, no secret, and no credential is
  ever logged.

`tests/workforce-persistence-host-policy.test.ts` (13/13) tests a prod-like
Supabase hostname **without contacting production**, and refuses every malformed
/ unlisted / localhost-confusion / unknown-target case.

---

## 7. Production migration-history read-only result

`node scripts/check-production-migration-history.mjs` performs SELECT-only
statements (no DDL, no migration, no write) against the host configured in
`.env.local`.

Result this closure: **NOT INSPECTED — `getaddrinfo ENOTFOUND
db.hoahuemoxjwivbuvxlkt.supabase.co`; the script exits 2 and mutates nothing.**
The host is not reachable from this machine. 14 migrations are registered in the
repository. The read-only report is recorded in
[`docs/evidence/step5-production-migration-history-2026-10-07.json`](evidence/step5-production-migration-history-2026-10-07.json).

This is why the migration-path decision stays **conditional**: the §4 pre-flight
(`_prisma_migrations` must list all 14) has to be re-run from a host that can
reach the pooler before Path A (`migrate deploy`) vs Path B (`db execute` +
`migrate resolve`) is chosen. **No migration was applied.**

---

## 8. Migration readiness and additive audit

- The four proposed files remain unmodified in `prisma/proposed-migrations/`,
  with sha256 recorded in the dev-migration evidence; each passes
  `scripts/verify-proposed-migration.mjs` except 1B's **reviewed** DROP of
  `ai_tool_invocations` (proposed-only; it never existed in any database).
- Applying them to a pre-migration database reconstructed from the branch-point
  datamodel left the legacy schema fingerprint and row counts unchanged, kept the
  canary rows intact, created exactly the 9 expected `ai_*` tables, and left an
  **empty** `migrate diff` — the database IS `prisma/schema.prisma`
  ([`docs/evidence/step5-dev-migration-2026-10-07.json`](evidence/step5-dev-migration-2026-10-07.json)).
- Backward compatible: an application build without the lifecycle feature ignores
  the tables entirely; turning the lifecycle on is two env vars and is not part
  of the migration.
- saieed-only profile isolation, capability fail-closed, and production-mock
  exclusion are unchanged and remain covered by the Step 4 safety suites
  (`workforce-step4-safety-closure`, `workforce-step4-async`) — all passing.

---

## 9. Tests and counts (measured this closure)

| Gate | Command | Result |
|---|---|---|
| TypeScript | `npx tsc --noEmit` | **0 errors** |
| Host policy | `npx vitest run tests/workforce-persistence-host-policy.test.ts` | **13/13**, exit 0 |
| Bridge adoption | `npx vitest run tests/workforce-bridge-adoption.test.ts` | **5/5**, exit 0 |
| Adoption matrix (DB) | `npx vitest run tests/workforce-step5-adoption.test.ts` | **9/9**, exit 0 |
| Process restart (DB) | `npx vitest run tests/workforce-step5-app-restart.test.ts` | **4/4**, exit 0 |
| HTTP boundary | `bash scripts/run-api-http-proof.sh` | **8/8**, exit 0 |
| App acceptance | `bash scripts/run-app-proof.sh` | **2 files, 10/10**, exit 0 |
| Workforce + AI-workforce suites | `npx vitest run tests/ai-workforce*.test.ts tests/workforce-*.test.ts tests/command-center-state.test.ts` | **18 files passed · 3 skipped; 268 passed · 15 skipped**, exit 0 |

**Known local limitation (reported, not suppressed).** A whole-repo
`npx vitest run` exits 1 solely on 16 pre-existing *unhandled* `pg` errors
("Connection terminated unexpectedly") emitted by the three `capital*` suites,
which share and drop one test database. No workforce code is involved. This was
measured by the earlier gate run (it is not re-run here) and is recorded rather
than papered over.

---

## 10. DEV cluster cleanup

After all evidence was captured, the isolated cluster was destroyed with the
documented project command:

```
node scripts/dev-db.mjs destroy     # exit 0
```

Verified gone: `node scripts/dev-db.mjs status` → `"running": false`; the data
directory `%LOCALAPPDATA%/nexup-dev-db` **does not exist**; nothing is
**LISTENING on 127.0.0.1:5501**; and the **same 10 unrelated PostgreSQL service
processes remain untouched** (PIDs 7244, 9704, 9748, 9760, 9768, 9776, 9784,
9988, 9996, 10008). No other PostgreSQL instance was started, stopped or
modified.

---

## 11. Production mutations and master

- **Production mutations: NONE.** No migration was applied or registered; no
  production object was created; the Supabase host was only ever read from
  `.env` to *print* it, and the one read-only attempt could not even resolve it.
- Every database command in this work used an explicit `127.0.0.1` URL.
- `master` / `origin/master` = `bf701fac705cfbb2672cf931dda3962e7fafc617` —
  untouched. Only the feature branch was pushed.

---

## 12. Remaining blockers (owner-decision only)

1. **Production migration/activation approval** — owner action. The §4 pre-flight
   (`_prisma_migrations` lists all 14) must be re-run where the pooler is
   reachable; then choose Path A vs Path B.
2. **Activation is a deliberate decision to write production data.** The host
   policy now supports it without a code change (`target=production` + an
   allowlisted host), but nothing should be activated until the owner says so.
3. **Step 6 (deployed UI) remains locked**, as instructed.

No open *technical* blocker remains in the code, durability, exactly-once,
recovery, host-policy or HTTP-boundary layers.

READY FOR STEP 5 PRODUCTION ACTIVATION APPROVAL
