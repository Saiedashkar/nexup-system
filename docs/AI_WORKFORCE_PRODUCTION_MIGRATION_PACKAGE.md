# AI Workforce — production migration readiness package

**Status: NOT APPLIED to production. Nothing in this package has been run against
Supabase or any existing cluster.** The owner approved applying the migration to
a **separate development database**; that is what was done, and this document is
the package for the *production* step, which is still awaiting explicit approval.

Step 5 stays 🟡 for exactly one reason: the durable persistence path has never
been activated on a real deployment. See "GO / NO-GO" at the end.

---

## 0. PREFLIGHT RESULT — MEASURED (2026-10-08)

> **The prerequisite in §3 was finally read, from production itself, read-only.**
> Full report: [`AI_WORKFORCE_STEP5_PRODUCTION_PREFLIGHT.md`](AI_WORKFORCE_STEP5_PRODUCTION_PREFLIGHT.md);
> raw evidence: [`docs/evidence/step5-production-preflight-readonly.json`](evidence/step5-production-preflight-readonly.json);
> repeat with `node scripts/check-production-preflight-readonly.mjs`.

| Prerequisite | Measured reality |
|---|---|
| `_prisma_migrations` lists all 14 | **The table does not exist.** 0 of 14 recorded. |
| Production's real ledger | Supabase CLI: `supabase_migrations.schema_migrations`, 3 entries (`add_mcp_audit_log`, `add_mcp_pending_action`, `add_capital_ledger_and_fixed_expenses`) |
| 14 migrations' *schema effects* | **present** — production's 28 modelled legacy tables match the branch-point datamodel fingerprint exactly (`0e72c9ecdfd4a470…`, 282 columns) |
| Any proposed object already applied | **none** — 0 `ai_*` tables, 0 `Ai*` enums, 0 of 84 net objects |
| Objects 1B would drop | **absent** — the DROP is a guaranteed no-op; **no data-loss risk** |
| Exact delta (authoritative diff vs production) | 7 enums, 9 tables, 52 indexes, 9 FKs, 7 columns — **all `ai_*`, nothing else**; no legacy change, nothing dropped |
| Pre-existing drift (NOT this batch) | `McpAuditLog` (12 rows) + `McpPendingAction` (2 rows) unmodelled; `OfficeExpense_fixedExpenseId_idx` undeclared; `CapitalSpend_fixedExpenseId_key` missing (0 rows use that column) |

**Consequences for this package: §6 Path A is STRUCK OUT, and its Path-B history
step is corrected below. Never run `prisma db push` against production (§6, §11).**

---

## 1. What would be applied

Four files, applied in this order. Each is committed, and each is the exact
output of `prisma migrate diff` (not hand-written SQL).

| # | File | sha256 (first 16) | Lines | Statements |
|---|------|-------------------|-------|------------|
| 1 | `prisma/proposed-migrations/AI_WORKFORCE_PHASE_1A/migration.sql` | `3376311a93f3bec4` | 209 | 5× CREATE TABLE, 25× CREATE INDEX, 4× ALTER TABLE (FK) |
| 2 | `prisma/proposed-migrations/AI_WORKFORCE_PHASE_1B/migration.sql` | `8418dba5841b289b` | 51 | 7× ALTER TABLE ADD COLUMN (all `ai_*`), 2× CREATE INDEX, 1× DROP TABLE, 1× DROP TYPE |
| 3 | `prisma/proposed-migrations/AI_WORKFORCE_PHASE_2/migration.sql` | `9b269aff30564d02` | 238 | 4× CREATE TABLE, 23× CREATE INDEX, 2× CREATE UNIQUE INDEX, 6× ALTER TABLE (FK) |
| 4 | `prisma/proposed-migrations/AI_WORKFORCE_PHASE_3/migration.sql` | `59e244b2a4511826` | 68 | 1× CREATE TABLE, 3× CREATE INDEX, 1× CREATE UNIQUE INDEX |

`prisma/proposed-migrations/` is **not** `prisma/migrations/`: `prisma migrate
deploy` cannot pick these files up, by construction. Nothing here becomes part of
the project's migration history until an operator deliberately moves it.

### Exact objects created

| Table | Owners | Notes |
|-------|--------|-------|
| `ai_jobs`, `ai_runs`, `ai_run_events`, `ai_approvals` | Phase 1A | Phase-1 engine. `ai_tool_invocations` is created by 1A and DROPPED by 1B — see "the one reviewed DROP" |
| `ai_missions`, `ai_tasks`, `ai_execution_records`, `ai_task_reviews` | Phase 2 | The Step-5 lifecycle |
| `ai_command_intents` | **Phase 3 (new)** | The Command idempotency ledger |

Foreign keys are declared **only between these new tables** (4 on the Phase-1 set,
but 1B drops one of them with its table, leaving **9** in total: 3 from Phase 1A
and 6 from Phase 2, none from Phase 3 — the ledger must be able to record a claim
before a mission exists). There is **no** foreign key into `users`, `Business`,
`Client`, `ProjectRecord` or any legacy table: actor/business/workspace/project/
client ids stay plain indexed columns, so the legacy models need no back-relation
fields and the legacy schema stays byte-identical.

Lifecycle state is `TEXT`, validated by the TypeScript state machines, not a
Postgres enum — so adding a state is a code change, not an `ALTER TYPE`.

### The one reviewed DROP

`AI_WORKFORCE_PHASE_1B` drops `ai_tool_invocations` (and its enum type). It is
**not** a destructive operation against production: the table was proposed in
1A, never existed in any deployed database, and the Phase-1 engine's run *is* the
tool invocation (one capability per run), so the table would have duplicated
`ai_runs` row-for-row. The decision and its reasoning are recorded in that file's
header and in `prisma/proposed-migrations/README.md`. The automated verifier
`scripts/verify-proposed-migration.mjs` therefore REFUSES that file on purpose —
every DROP requires a human decision, and the check exists to make a silent one
impossible.

---

## 2. What was actually proven on the development database

Evidence: [`docs/evidence/step5-dev-migration-2026-10-07.json`](evidence/step5-dev-migration-2026-10-07.json)

Reproduce with:

```bash
node scripts/dev-db.mjs up        # isolated loopback cluster + pre-migration schema
node scripts/dev-db.mjs migrate   # applies 1A → 1B → PHASE_2 → PHASE_3, verifies, writes evidence
node scripts/dev-db.mjs status    # identity + schema state
```

Measured on the isolated development cluster (loopback `127.0.0.1:5501`, `initdb`
by the script, trust auth, deleted with `node scripts/dev-db.mjs destroy`):

- **additive-only**: each file inspected by `scripts/verify-proposed-migration.mjs`
  (Phase 1B refuses by design, as documented above);
- **legacy schema fingerprint unchanged**: sha256 over every `information_schema`
  column of the 28 non-`ai_*` tables is identical before and after;
- **legacy row counts unchanged** and **canary rows intact** (a `Business` and a
  `User` row inserted before the migration still read back identically);
- **the missing objects were exactly the proposal**: the pre-migration
  `migrate diff` named exactly the 9 tables the four files create — nothing more;
- **the database matches `schema.prisma` after**: `prisma migrate diff
  --from-config-datasource --to-schema=prisma/schema.prisma --exit-code` is
  EMPTY. That is the strongest statement available offline: the applied SQL
  reproduces the datamodel the application is generated from.

---

## 3. Prerequisite state — and the one thing to verify FIRST

The registered history in `prisma/migrations/` **cannot be replayed onto an empty
database**:

- `20260823221818_init` creates `Client_phone_key` as a **UNIQUE INDEX**;
- `20260824120000_add_business_multitenancy` drops it as a **CONSTRAINT** →
  PostgreSQL error **42704** on the second file.

This is pre-existing, not something this work introduced; the project's own
acceptance suite documents the same conclusion and works around it with
`prisma db push` (`tests/capital.test.ts`: *"the historical migration chain has
pre-existing drift on empty databases; production DBs only ever apply the newest
migrations"*). It means production has been evolved by applying the **newest**
migrations, not by replaying the chain.

**Therefore the apply procedure below has a mandatory pre-flight check on
production's `_prisma_migrations`.** If that table does not list all 14
registered migrations with `finished_at` set, `prisma migrate deploy` would
attempt to replay the chain and fail at `20260824120000` — do **not** run it.

**MEASURED (2026-10-08): the table does not exist, so this is settled — Path A is
struck out and Path B is the only route.** Production's schema is managed by the
Supabase CLI ledger, not by Prisma; the 14 migrations' *effects* are present but
their *identities* are recorded nowhere Prisma can see (production even carries
`Client_businessId_phone_key` where the chain would generate `Client_phone_key`).

---

## 4. Pre-flight checks (read-only)

Against the production database, via the project's normal connection:

1. `select count(*) from "_prisma_migrations" where finished_at is not null;`
   → **must be 14**. If it is not (or the table is missing), use the
   `db execute` path in §6. **MEASURED 2026-10-08: the table is missing (0 of 14)
   → §6 Path B, never Path A.**
2. `select count(*) from "_prisma_migrations" where rolled_back_at is not null;`
   → **must be 0**.
3. Confirm none of the 9 target tables already exist:
   `select table_name from information_schema.tables where table_schema='public' and table_name in
   ('ai_jobs','ai_runs','ai_run_events','ai_approvals','ai_missions','ai_tasks','ai_execution_records','ai_task_reviews','ai_command_intents');`
   → **must return 0 rows**. If any exists, the batch is partly applied: resolve
   with the owner before continuing. **MEASURED 2026-10-08: 0 rows returned —
   nothing is partly applied.**
4. Confirm the legacy shape is intact (optional but cheap): `select count(*) from
   information_schema.tables where table_schema='public' and table_type='BASE TABLE';`
   → **28** expected (the branch-point datamodel's table count).
5. Confirm the application is NOT already configured to persist workforce state:
   `AI_WORKFORCE_PERSISTENCE` unset/`memory`, and no accepted
   `AI_WORKFORCE_DATABASE_URL` (unset, or a host the policy refuses). Today it is
   off; the lifecycle only boots on `database` plus a URL the host policy accepts.

---

## 5. Backup and recovery assumptions

- Supabase takes automated backups; **before applying, record the current
  backup/PITR window and confirm a restore point exists**, because every file
  except Phase 1B's reviewed DROP is additive and therefore only needs a
  *rollback* decision, never a data restore.
- No existing row is read, updated or deleted by any of the four files, so a
  failed apply cannot corrupt data. The realistic worst case is a partially
  created set of empty tables, which §7 handles.
- The one irreversible action is 1B's `DROP TABLE ai_tool_invocations`; the table
  is proposed-only and cannot hold production data (see §1).

---

## 6. Exact apply procedure

### Path A — STRUCK OUT (production's history is not complete)

> **Do not use Path A.** Measured 2026-10-08: `_prisma_migrations` does not exist
> in production, so `prisma migrate deploy` would treat all 14 registered
> migrations as pending and replay the chain onto a populated database — which
> fails immediately, and additionally cannot replay onto an empty database
> (§3). The historical procedure is kept below only for the record.

#### (historical) Path A — production's migration history is complete (14 applied)

```bash
# 1. move the files into the registered history, in order, with real timestamps
mkdir -p prisma/migrations/20261008000000_ai_workforce_phase_1a && \
  cp prisma/proposed-migrations/AI_WORKFORCE_PHASE_1A/migration.sql $_/migration.sql
# ...the same for 1B, PHASE_2, PHASE_3, each with a LATER timestamp than 20260927

# 2. inspect what will run — dry run, no writes
npx prisma migrate status

# 3. apply (this is the ONLY place `migrate deploy` is correct)
npx prisma migrate deploy

# 4. verify (§8), then commit the moved files so the history is honest
```

### Path B — the route to use (production's Prisma history does not exist)

Do **not** run `migrate deploy`. Apply the committed SQL directly, in order, and
record it so the history stays truthful. **Run this from a host that can reach the
database**: the direct Supabase host is IPv6-only, so from an IPv4-only
workstation use the project's Supavisor pooler
(`aws-1-eu-west-1.pooler.supabase.com`, user `postgres.<ref>`) without editing any
configuration file.

```bash
# one file at a time, in order, each in its own statement batch
npx prisma db execute --file prisma/proposed-migrations/AI_WORKFORCE_PHASE_1A/migration.sql --schema prisma/schema.prisma
npx prisma db execute --file prisma/proposed-migrations/AI_WORKFORCE_PHASE_1B/migration.sql --schema prisma/schema.prisma
npx prisma db execute --file prisma/proposed-migrations/AI_WORKFORCE_PHASE_2/migration.sql --schema prisma/schema.prisma
npx prisma db execute --file prisma/proposed-migrations/AI_WORKFORCE_PHASE_3/migration.sql --schema prisma/schema.prisma

# then, once §8 passes, tell Prisma these are applied so the history matches reality
# (repeat per phase, with the timestamped name you chose)
npx prisma migrate resolve --applied 20261008000000_ai_workforce_phase_1a
```

> **CORRECTED 2026-10-08 — the `resolve` step above is wrong as written.**
> `migrate resolve --applied` creates `_prisma_migrations` containing *only* the
> names you give it. Recording the four new ones alone leaves the 14 legacy
> migrations unrecorded, after which **any later `migrate deploy` — yours or CI's —
> would attempt the legacy chain against production.** Owner decision, one of:
>
> - **baseline first:** record the 14 as applied (`migrate resolve --applied
>   <name>` per migration — metadata only, it runs no SQL), *then* apply the four
>   files and record them; or
> - **keep no Prisma ledger here:** production is already tracked by the Supabase
>   CLI ledger (3 entries), so apply the four files and record them through the
>   same mechanism `prisma/migrations/` is treated as a historical artifact.
>
> Either way: **never run `prisma db push` against production** — it would drop
> `McpAuditLog` and `McpPendingAction` (14 live rows) because the datamodel does
> not describe them.

`db execute` runs the file as one batch per statement and writes nothing else.
Whichever path is used, the SQL is **byte-identical** to what the evidence file
fingerprinted.

---

## 7. Rollback / forward-fix

- **Before Phase 1B's DROP is applied**, a pure rollback is possible:
  `DROP TABLE` the created tables and `DROP TYPE` the created enums — the legacy
  schema is untouched, so nothing else is affected.
- **After 1B**, `ai_tool_invocations` is gone (it never held data). Rollback is
  still `DROP TABLE` of the nine tables; there is nothing to restore.
- **Preferred posture: forward fix.** Every object created is namespaced `ai_*`
  and referenced by nothing in the legacy schema, so a partially applied batch
  can be completed or dropped without touching business data.
- The application cannot write to any of these tables until
  `AI_WORKFORCE_PERSISTENCE=database` and a database URL the host policy accepts
  are set — loopback, or an explicitly allowlisted remote host under
  `AI_WORKFORCE_DATABASE_TARGET=production`. Today none is configured and it
  refuses to boot the lifecycle without them (`getWorkforceApplication()` →
  `PERSISTENCE_UNAVAILABLE`), so applying the schema has **no behavioural effect
  on the running application**.

---

## 8. Post-migration verification

1. Tables: the 9 names above exist;
   `select count(*) from information_schema.tables where table_schema='public' and table_name like 'ai\_%';`
   → **9**.
2. Indexes: `select count(*) from pg_indexes where schemaname='public' and tablename like 'ai\_%';`
   → **61**.
3. Foreign keys: `select count(*) from information_schema.table_constraints where
   table_schema='public' and constraint_type='FOREIGN KEY' and table_name like 'ai\_%';`
   → **9** (3 from Phase 1A after 1B removes the dropped table's FK, and 6 from
   Phase 2; Phase 3 declares none).
4. Uniqueness that the design depends on:
   - `ai_tasks_missionId_sequence_key` (one task per sequence per mission),
   - `ai_execution_records_taskId_attempt_key` (one record per attempt),
   - `ai_command_intents_scope_idempotencyKey_key` (**the Command idempotency
     claim** — without it, two retries create two missions).
5. Legacy parity: the `information_schema` fingerprint of the 28 legacy tables
   must equal the pre-migration fingerprint recorded in the evidence file.
6. Schema parity: `prisma migrate diff --from-config-datasource
   --to-schema=prisma/schema.prisma --exit-code` → exit **0** (empty diff).
7. Application: `npx prisma generate && npx tsc --noEmit` → clean; then
   `AI_WORKFORCE_PERSISTENCE=database` + a URL the host policy accepts, and
   `bash scripts/run-app-proof.sh` against a development database first.

---

## 9. Lock / risk characteristics and downtime

- `CREATE TABLE`, `CREATE INDEX` and `ADD CONSTRAINT` on **new, empty** tables
  take no lock on any existing table and cannot block a legacy query. Nothing in
  the batch touches a table with rows in it.
- The only `ALTER TABLE` statements target tables created earlier in the **same
  batch**, which is why they are on empty tables too.
- `CREATE INDEX` (non-`CONCURRENTLY`) on an empty table is effectively
  instantaneous. There is no `CONCURRENTLY` clause, so these statements **must
  not** run inside an explicit transaction block — `migrate deploy` handles that
  itself; with `db execute`, run one file per invocation as shown.
- Total added storage: nine empty tables plus 59 indexes — negligible.
- **Expected downtime: none.** No connection needs to be drained for the DDL, and
  the application does not use the tables until the persistence variables are set.

---

## 10. Application compatibility

- `prisma/schema.prisma` already declares the new models; the batch brings the
  database to *that* datamodel and the empty diff in §8.6 is the proof.
- Adding the schema is backward compatible: an application build without the
  workforce lifecycle feature ignores the tables entirely.
- Turning the lifecycle **on** is a separate, reversible act (two environment
  variables, §7) and is deliberately not part of this migration.
- The application boundary that would use these tables is implemented and proven
  offline: `createWorkforceApplication` composes the durable repositories, the
  real dispatcher, the real Hermes adapter and the Command ledger, and
  `bash scripts/run-app-proof.sh` exercises it end to end (9/9).

---

## 11. GO / NO-GO

**GO FOR PRODUCTION MIGRATION APPROVAL** — conditional on the pre-flight checks in
§4, specifically check #1:

- if `_prisma_migrations` lists all 14 registered migrations → **Path A**
  (`migrate deploy`) is safe;
- if it does not → **Path B** (`db execute` + `migrate resolve`) is the honest
  route, and a `migrate deploy` must NOT be attempted.

There is **no technical blocker** in the migration itself: it is additive, it has
been applied to a pre-migration database faithfully reconstructed from the
branch-point datamodel, and the database it produced is byte-equivalent to
`schema.prisma`.

**NO-GO** for activating the lifecycle in production (`AI_WORKFORCE_PERSISTENCE=
database`), for the two remaining, application-level reasons below — neither is
schema-level, and neither blocks applying the additive DDL:

1. **Nothing in production surfaces the lifecycle yet.** The API routes exist and
   are wired to the durable composition, but the Command Center still reads its
   demo model by design (Step 6), and no route has been exercised against a
   deployed origin.
2. **Activation is an explicit owner decision, and its prerequisite is now
   MEASURED (2026-10-08).** The pre-flight this package depends on was read from
   production read-only — through the project's IPv4 Supavisor pooler, because the
   configured host is IPv6-only and this workstation has no IPv6 route. Result:
   `_prisma_migrations` does not exist; 0 of 14 applied; 0 of 84 proposed objects
   present; both 1B DROP targets absent (no data-loss risk); the 28 modelled legacy
   tables still match the branch-point fingerprint exactly. The migration path is
   therefore **Path B with the corrected history step in §6**, and Path A is struck
   out. See `AI_WORKFORCE_STEP5_PRODUCTION_PREFLIGHT.md`.

3. **Two pre-existing drift items are NOT part of this batch** and need their own
   owner decision: production has `McpAuditLog` (12 rows) and `McpPendingAction`
   (2 rows) that `schema.prisma` does not describe, plus one undeclared index
   (`OfficeExpense_fixedExpenseId_idx`) and one missing unique index
   (`CapitalSpend_fixedExpenseId_key`, which constrains nothing today — 0 rows use
   that column). Applying the four files touches none of them.

Two blockers a previous revision of this document recorded are now **closed**,
and were replaced rather than softened:

- **A run left in flight by a process restart CAN now be settled.** A
  provider-neutral recovery service — `ExecutionReconciler`, plus the
  `AgentExecutionRecovery` adoption port on `AgentRuntime` — re-adopts a durable
  in-flight attempt by *asking* the provider (never resubmitting) and settles it
  through the SAME orchestrator path a live settle uses. It is proven by the
  adoption matrix (`tests/workforce-step5-adoption.test.ts`, 9/9) and by the
  multi-process restart proof (`tests/workforce-step5-app-restart.test.ts`, 4/4,
  asserting `runsStartedByC === 0` and exactly one execution row). A run the
  provider no longer knows becomes `UNKNOWN`/`UNKNOWN_REMOTE` and is escalated to
  a human — never auto-retried.
- **The persistence guard no longer refuses the production host by design.** The
  loopback-only allowlist was replaced by an explicit, fail-closed environment
  policy: `AI_WORKFORCE_DATABASE_TARGET` (`local` | `production`) together with
  `AI_WORKFORCE_DATABASE_HOSTS` (exact hostnames). Loopback is always allowed; a
  remote host is accepted only under `target=production` AND when it is
  explicitly allowlisted; malformed URLs, unlisted hosts and unknown targets are
  refused. Nothing is hardcoded — no project ref or secret appears in source —
  and no credential is ever logged. `assertIsolatedDatabaseUrl` remains strictly
  loopback for the isolated-test path. See
  `tests/workforce-persistence-host-policy.test.ts` (13/13).

The DDL is safe to apply, and the lifecycle stays off until the owner decides to
activate it.

---

## 12. Related evidence

| Artifact | What it proves |
|----------|----------------|
| [`docs/evidence/step5-dev-migration-2026-10-07.json`](evidence/step5-dev-migration-2026-10-07.json) | the apply on a real, isolated, pre-migration database, with the additive checks and the replay defect measured |
| [`docs/evidence/step5-app-acceptance-2026-10-07.json`](evidence/step5-app-acceptance-2026-10-07.json) | the lifecycle end to end through the application boundary, Command idempotency, and the multi-process restart proof |
| [`docs/evidence/step5-http-boundary-2026-10-07.json`](evidence/step5-http-boundary-2026-10-07.json) | the real HTTP routes against a running `next start` server: 401/403 auth, Command issue, idempotent retry, reused-key 409, malformed 400, read/settle/human decision, and no secret in any error body |
| [`docs/evidence/step5-production-migration-history-2026-10-07.json`](evidence/step5-production-migration-history-2026-10-07.json) | the READ-ONLY production `_prisma_migrations` pre-flight: 14 registered in the repo, and that the production host could not be reached from this machine (no mutation attempted) |
| [`docs/AI_WORKFORCE_STEP5_PREPRODUCTION_CLOSURE.md`](AI_WORKFORCE_STEP5_PREPRODUCTION_CLOSURE.md) | the final pre-production closure: in-flight re-adoption, the host policy, the HTTP boundary, and the single readiness verdict |
| [`docs/AI_WORKFORCE_STEP4_STEP5_CLOSURE.md`](AI_WORKFORCE_STEP4_STEP5_CLOSURE.md) | the graded Step 4 / Step 5 audit |
| [`docs/AI_WORKFORCE_AUDIT_EVIDENCE.md`](AI_WORKFORCE_AUDIT_EVIDENCE.md) | the gated commands behind every claim |
