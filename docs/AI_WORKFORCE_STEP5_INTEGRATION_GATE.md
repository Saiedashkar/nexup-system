# Step 5/8 — final integration gate (application boundary)

**Owner decision honored: the proposed AI Workforce migrations were applied to a
SEPARATE DEVELOPMENT DATABASE only.** The production Supabase database was not
touched. Step 6 was not started. `master` / `origin/master` remain at `bf701fac`.

Step 5 stays **🟡 awaiting production migration approval** — DEV passing is not a
production activation.

---

## 1. Commits

| | |
|---|---|
| Authoritative starting point | `cec9056` (`feature/ai-workforce-foundation`) |
| Application boundary + Command identity | `dacdc32` |
| This gate (this document, the readiness package, the refreshed evidence) | see the commit that adds this file |
| `master` / `origin/master` | `bf701fac705cfbb2672cf931dda3962e7fafc617` — **untouched** |

Only the feature branch was pushed. No migration file was added to
`prisma/migrations/` (`git diff --stat master...HEAD -- prisma/migrations` is empty).

## 2. Development database identity — no credentials

The approved target is a cluster this work created itself, on loopback, with
`initdb` — never an existing data directory and never a service:

```
data directory      C:\Users\MegaStore\AppData\Local\nexup-dev-db
port                5501        listen_addresses   127.0.0.1
database            nexup_dev   isLoopbackConnection  yes
server              PostgreSQL 18.6 (x86_64-windows)
postmaster started  2026-10-07 20:59:27+03   (fresh for this run)
ai_* tables         9           legacy tables        28
auth                trust on loopback  (no password exists to leak)
production host     db.hoahuemoxjwivbuvxlkt.supabase.co:6543  (from .env, REPORTED only)
```

The distinction that matters: the dev cluster is `127.0.0.1:5501`; production is a
remote Supabase pooler host. `scripts/dev-db.mjs` **never reads `DATABASE_URL` to
decide where to connect** — every command it runs is given its own explicit
`postgresql://postgres@127.0.0.1:5501/...` URL, and `node scripts/dev-db.mjs
status` reads `.env` only to *print* the production host so an operator can see
the two are different. No credential is printed anywhere.

## 3. Migration result (dev only)

`node scripts/dev-db.mjs up` → pre-migration baseline at the branch point
(`git merge-base HEAD master` = `bf701fac`), 28 tables, and
`prisma migrate diff --from-config-datasource --exit-code` **empty**: the
database *is* the branch-point datamodel, not an approximation of it.

`node scripts/dev-db.mjs migrate` → applied the four committed files, unmodified:

| File | sha256 (12) | verifier |
|---|---|---|
| `AI_WORKFORCE_PHASE_1A/migration.sql` | `3376311a93f3` | ok |
| `AI_WORKFORCE_PHASE_1B/migration.sql` | `8418dba5841b` | REFUSED (reviewed — see the readiness package §1) |
| `AI_WORKFORCE_PHASE_2/migration.sql` | `9b269aff3056` | ok |
| `AI_WORKFORCE_PHASE_3/migration.sql` | `59e244b2a451` | ok |

Ordering is 1A → 1B → PHASE_2 → PHASE_3, strictly after the required 1A/1B pair.

Checks in the evidence file, all `true`:

- `legacySchemaFingerprintUnchanged` — sha256 over every `information_schema`
  column of the 28 legacy tables is identical before and after;
- `legacyRowCountsUnchanged` and `canaryRowsIntact` — a `Business` and a `User`
  row inserted *before* the migration read back identically;
- `theMissingTablesWereExactlyTheProposal` — the pre-migration diff named exactly
  the 9 tables the proposal creates;
- `newTablesExactlyAsExpected` — those 9 tables, nothing else;
- `databaseMatchesSchemaAfter` — `migrate diff … --exit-code` is **empty**, i.e.
  the applied SQL reproduces `prisma/schema.prisma`.

Post-migration inventories, measured on the dev database: `ai_*` tables **9**,
`ai_*` indexes **61**, `ai_*` foreign keys **9**, legacy tables **28**.

Also recorded, because it is a real property of the repository and not a
success to claim: replaying the **registered** history onto an empty database
fails at `20260824120000_add_business_multitenancy` (`Client_phone_key` created
as a UNIQUE INDEX by `init` and dropped as a CONSTRAINT → 42704). Pre-existing,
unrelated to this work, and the reason the baseline comes from the datamodel.

## 4. Application lifecycle mounting

The audit's gap — dispatcher + orchestrator + durable repositories existed with
no real caller — is closed by three layers, in this order:

1. `src/modules/workforce/persistence/prisma-composition.ts` —
   `createWorkforceDomainFromPrisma` binds the four lifecycle repositories to a
   real client. **No in-memory repository is reachable from it.**
2. `src/modules/workforce/application/composition.ts` —
   `createWorkforceApplication(handleOrClient)` composes the durable domain, the
   real Hermes runtime resolved exactly as production resolves it, the real
   dispatcher, the Command service and the Phase-3 idempotency ledger. With no
   usable runtime it **refuses to boot** (`RUNTIME_UNAVAILABLE`) rather than
   create missions nothing can execute.
3. `src/modules/workforce/application/runtime.ts` — `getWorkforceApplication()`
   is what a route imports: one boot per process, and it refuses (503,
   `PERSISTENCE_UNAVAILABLE`) unless `AI_WORKFORCE_PERSISTENCE=database` **and** a
   verified loopback `AI_WORKFORCE_DATABASE_URL` are present. It never downgrades
   to memory.

Routes: `src/app/api/ai-workforce/missions/[id]/route.ts` (GET = read the whole
mission; POST = continue it from the rows) and the commands route. UI components
do not import the orchestrator.

## 5. Command idempotency

`ai_command_intents` (Phase 3), keyed `(scope, idempotencyKey)` with a unique
index, is the ledger; `PrismaCommandIntentRepository` claims with an `INSERT`,
resolves a unique violation by re-reading the row, and distinguishes
`claimed` / `replay` / `in-progress` / `conflict`. A `FAILED` claim with no
mission is re-claimable **through a compare-and-set**, so two concurrent retries
cannot both win.

Proven at the application boundary (`tests/workforce-step5-app-integration.test.ts`):

- retry with the same key → **same mission**, no new task, no second execution;
- reused key + different command → `COMMAND_KEY_REUSED`, refused;
- a genuinely new command → a **new** mission.

## 6. Restart / rehydration proof

`tests/workforce-step5-app-restart.test.ts` spawns **real OS processes** under
`vitest.process.config.ts` (`tests/process/app-process-{a,b,c}.test.ts`), each
booting the real application composition against the dev database and sharing
nothing but the rows:

- **A** issues a Command, persists mission + task + execution, leaves an OPEN
  human decision, and exits;
- **B** builds a fresh Prisma/application composition, rehydrates the mission
  from the rows, takes the human decision and completes it;
- **C** measures the case that *does not* work, so the limitation is asserted
  rather than hidden.

And `tests/workforce-step5-app-integration.test.ts` rehydrates a finished mission
through a **fresh** application in-process.

## 7. Adversarial audit — asked, then measured

Each row is covered by a named, passing test; the test is the evidence, not this
table.

| Challenge | Where it is measured | Result |
|---|---|---|
| saieed-only profile invariant | `workforce-step4-safety-closure` A1 · `workforce-step4-async` D | allowlist of exactly `saieed`; `Saieed` is not `saieed` |
| Adel / `default` refusal | A1: config boundary, HTTP transport, RPC socket, deterministic transport | refused, **zero** network calls |
| capability fail-closed | A2: unassigned capability, no authorization source, human actor, JobRunner path | refused with zero runtime calls |
| production mock exclusion | A3: TEST provenance refused without explicit opt-in, undeclared provenance refused, mock not exported from the production surface, app boots with no runtime of its own | pass |
| Command idempotency / duplicate submit | `workforce-step5-app-integration` (4 cases) | same mission, no duplicate execution |
| stale CAS | `workforce-step5-persistence` ("a transition that lost the compare-and-set does not land"), `ai-workforce-persistence`, `ai-workforce-phase1b` | refused |
| failure persistence | `workforce-step5-persistence`, `workforce-step4-async` | FAILED survives the restart |
| cancellation persistence | `workforce-step5-persistence` ("persists CANCELLATION"), `workforce-step5-mission` E | execution, task and mission all CANCELLED |
| retry exhaustion | `workforce-step5-persistence` ("persists EXHAUSTION") | allowance runs out, FAILED survives |
| non-human approval refusal | `workforce-step5-mission` C · `workforce-step5-persistence` · `ai-workforce-phase1b` §6 | refused; a human decision requires a human |
| duplicate human decision | `workforce-step5-mission` C ("permits exactly ONE decision") · `workforce-step5-persistence` ("across processes") | second decision refused |
| process restart / rehydration | `workforce-step5-app-restart`, `workforce-step5-persistence` | see §6 |
| durable repository composition | `prisma-composition` + both app suites; DB asserted at composition time | pass |
| migration safety | §3 evidence file | all boolean checks true |
| production DB untouched | §2 + §8 | no registered migration, no `.env` change, loopback-only connections |

## 8. Gates re-run on the final tree

| Gate | Command | Result |
|---|---|---|
| TypeScript | `npx tsc --noEmit` | **0 errors** |
| Prisma schema | `npx prisma validate` / `npx prisma generate` | **valid** / generated |
| Production build | `npx next build --webpack` | **succeeded**; `/office/ai-workforce` and the API routes compile |
| Workforce + AI-workforce suites (17 files) | `npx vitest run tests/ai-workforce*.test.ts tests/workforce-*.test.ts tests/command-center-state.test.ts` | **15 files passed, 2 skipped; 240 passed, 7 skipped; exit 0** |
| Application acceptance proof | `bash scripts/run-app-proof.sh` | **2 files, 9/9 passed, exit 0** |
| Dev migration proof | `node scripts/dev-db.mjs up && node scripts/dev-db.mjs migrate` | all boolean checks true, exit 0 |
| ESLint, changed files | `npx eslint scripts/dev-db.mjs` | **0 problems** |

The 7 skips are gated, not ignored: `workforce-step4-live-cancel` and
`workforce-step5-live-durability` need a real execution against the deployed
bridge, and a few cases in `step3-e2e` / `step4-async` / `step5-mission` are
env-gated variants.

**Honest note on the whole-repo run.** `npx vitest run` (everything) reports
18 files passed / 290 tests passed / 7 skipped but exits **1**, because the three
pre-existing `capital*` suites emit 16 *unhandled* `pg` errors
("Connection terminated unexpectedly"). They are caused by those suites sharing
one `capital_test` database and dropping/recreating it while a previous file's
pool is still open — reproducible by running **only** those three files (`50
tests passed, 16 errors`, exit 1), with no workforce code involved. It is a local
harness artifact, unrelated to this work and unchanged by it; previously it
surfaced as plain failures because no cluster was listening on 5435. It is
recorded here rather than papered over.

## 9. Production database untouched

- `git diff master...HEAD -- .env .env.local` → empty; `git status` on them → clean.
- No migration was registered: `prisma/migrations/` still holds exactly 14
  directories, unchanged since `master`; the four files live in
  `prisma/proposed-migrations/`, which `prisma migrate deploy` cannot pick up.
- Every database command in this work used an explicit `127.0.0.1` URL
  (`psql -h 127.0.0.1`, `DATABASE_URL` set per invocation by the scripts); the
  Supabase host was read from `.env` **only** to print it.
- The application-level guard is itself a proof: `assertIsolatedDatabaseUrl`
  allowlists loopback, so the production host would be refused.

## 10. Production migration readiness package

[`docs/AI_WORKFORCE_PRODUCTION_MIGRATION_PACKAGE.md`](AI_WORKFORCE_PRODUCTION_MIGRATION_PACKAGE.md)
— exact files/sha256, exact objects, additive-only confirmation, prerequisite
`_prisma_migrations` state (and the mandatory pre-flight check), backup
assumptions, Path A (`migrate deploy`) vs Path B (`db execute` + `migrate
resolve`), post-migration verification, rollback/forward-fix, lock/risk
characteristics, and expected downtime (**none**).

**Verdict: GO FOR PRODUCTION MIGRATION APPROVAL** — conditional on the §4
pre-flight check on `_prisma_migrations`.

**Separately, NO-GO for *activating* the lifecycle in production**, for three
application-level reasons (none schema-level): an execution left in flight by a
restart cannot be settled; nothing deployed surfaces the lifecycle yet (Step 6);
and the loopback-only persistence allowlist would refuse the production Supabase
host, so activation needs an explicit owner decision, not just two env vars.

## 11. Remaining blockers

1. **Production migration approval** — owner action; nothing else in Step 5 moves.
2. **In-flight executions do not survive a restart.** The runtime adapter's handle
   bookkeeping is in-process and `AgentExecutionLifecycle` has no re-adoption
   seam, so `waitForExecution` throws `RUNTIME_NOT_FOUND` for a durable handle
   after a restart. Such a mission can only be released by cancelling it, which
   does not confirm the provider run stopped. Asserted by the restart suite, not
   hidden.
3. **Activation policy.** Production persistence requires widening the loopback
   allowlist (deliberate owner decision about writing production data).
4. **Nothing deployed exercises these routes yet** — Step 6 (Command Center real
   data) remains locked, as instructed.

## 12. Rollback state

Nothing to roll back. The dev cluster is disposable
(`node scripts/dev-db.mjs destroy`); no production object was created; the four
migrations are still unregistered files in `prisma/proposed-migrations/`. The
feature branch is additive on top of `cec9056`; `master` is untouched at
`bf701fac`.

## 13. Roadmap (unchanged)

```
STEP 1/8 ✅   STEP 2/8 ✅   STEP 3/8 ✅   STEP 4/8 ✅
STEP 5/8 🟡 — awaiting production migration approval
STEP 6/8 ⏳   STEP 7/8 ⏳   STEP 8/8 ⏳
```
