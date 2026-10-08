# AI Workforce — Step 5 PRODUCTION PREFLIGHT (read-only)

**Scope of this document: INSPECTION ONLY.** No migration was run, no schema was
changed, no row was written, no configuration (DNS, Vercel, Supabase, env file)
was touched, no Step-6 work was started, and no paid provider credit was used.
The only production interaction is a set of `select` statements — the exact ones
are in `scripts/check-production-preflight-readonly.mjs` and the raw result is in
[`docs/evidence/step5-production-preflight-readonly.json`](evidence/step5-production-preflight-readonly.json).

```
CONFIGURED HOST : db.hoahuemoxjwivbuvxlkt.supabase.co:6543   (AAAA record only)
THIS WORKSTATION: no global IPv6 route  →  that host cannot answer (measured)
ROUTE USED      : aws-1-eu-west-1.pooler.supabase.com  (IPv4 Supavisor pooler,
                  SAME project, SAME credentials, select-only, no config change)
```

---

## 0. The four questions, answered

| # | Question | Answer |
|---|----------|--------|
| 1 | Which migrations does production actually have? | **No Prisma migration history at all** (`_prisma_migrations` does not exist). Production is tracked by the **Supabase CLI ledger**: 3 entries. The **schema effects** of all 14 registered Prisma migrations *are* present. **0 of the 84** net proposed AI objects exist. |
| 2 | The Phase 1B `DROP TABLE ai_tool_invocations` | **Guaranteed no-op in production.** The table does not exist, never existed in any deployed database, and nothing in the codebase reads or writes it. **Data-loss risk: NONE.** No owner decision is needed to avoid data loss. |
| 3 | The exact delta that would be applied | **84 net objects, all `ai_*`, none of them present** — proven equal to the four committed files by a `prisma migrate diff` run *against production itself* (§4). **Nothing would be dropped.** |
| 4 | Roadmap labels | Corrected in §4 (authoritative roadmap restored). |

**Verdict:** the DDL is safe to request approval for, **but only with the three
procedure corrections in §5** — in particular the package's Path A is now struck
out and its history-recording step is wrong as written.

---

## 1. How production was reached (read-only route)

The direct Supabase host publishes an **AAAA record only**:

```
db.hoahuemoxjwivbuvxlkt.supabase.co   A    -> (none, ENODATA)
db.hoahuemoxjwivbuvxlkt.supabase.co   AAAA -> 2a05:d018:48a:c900:1dc4:b7bb:481:721d
```

This workstation has **no global IPv6 route** (`Wi-Fi` carries only ULA/link-local
addresses; a raw TCP connect to that address returns `ENETUNREACH`), so
`getaddrinfo` legitimately returns `ENOENT` — a **network/route outcome, not a
credential or permission one**. This is the same result the earlier check recorded.

The same database is reachable over IPv4 through the project's **Supavisor
pooler**, and the region is derived from the project's own AAAA address
(`2a05:d018::/36` = AWS `eu-west-1`):

```
aws-0-eu-west-1.pooler.supabase.com:6543 -> tenant/user postgres.<ref> not found   (wrong cluster)
aws-1-eu-west-1.pooler.supabase.com:6543 -> OK   (transaction pooler)
aws-1-eu-west-1.pooler.supabase.com:5432 -> OK   (session pooler — used for the Prisma diff)
```

What this route is **not**: it is not a DNS, Vercel, Supabase or server
configuration change; it does not move credentials anywhere (they are read from
`.env.local` in-process and never printed); it runs no DDL. Every statement sent
is asserted to start with `select` before it is executed.

Reproduce (after approval or at any time):

```bash
node scripts/check-production-preflight-readonly.mjs   # exit 0 = inspected, 2 = unreachable
```

---

## 2. Question 1 — the migration state production actually has

### 2.1 Prisma's ledger

**`_prisma_migrations` does not exist in the `public` schema.** Therefore:

- applied Prisma migrations: **0 of 14**;
- unfinished / rolled back: **0 / 0**;
- "missing from production": **all 14 registered migrations** — as *records*.

### 2.2 The ledger production really uses

Production's schema is tracked by the **Supabase CLI** ledger
(`supabase_migrations.schema_migrations`), which holds exactly 3 entries:

| version | name | effect visible in production |
|---------|------|------------------------------|
| `20260924173648` | `add_mcp_audit_log` | creates `McpAuditLog` (12 rows) — **not in `schema.prisma`** |
| `20260925105933` | `add_mcp_pending_action` | creates `McpPendingAction` (2 rows) — **not in `schema.prisma`** |
| `20260927005713` | `add_capital_ledger_and_fixed_expenses` | name matches registered Prisma migration `20260926120000_…` |

### 2.3 But the 14 registered migrations' *effects* are present

Production's legacy shape was compared with the **branch-point datamodel** the
proposal was generated against, using the **same fingerprint algorithm** the dev
baseline used (sha256 over `table|column|type|nullable|default` of every
non-`ai_*` column):

```
production (28 modeled legacy tables) : 0e72c9ecdfd4a470…  282 columns
branch-point baseline (recorded)      : 0e72c9ecdfd4a470…  282 columns   ← IDENTICAL
```

Including the newest migration's effect, e.g. `CapitalSpend` carries
`spendType`, `recipientName`, `recipientPartnerId`, and `deletedAt`/
`deletedByUserId` are present on every soft-delete model. So **no registered
migration's schema effect is missing**; what is missing is its *identity* in a
ledger Prisma can read.

### 2.4 Are any AI-workforce migrations already represented?

**No.** There are **0 `ai_*` tables** and **0 `Ai*` enum types**, and **0 of the
91 objects** the four proposed files would create. Nothing is partially applied.

### 2.5 Consequence for the apply procedure

**Path A in `AI_WORKFORCE_PRODUCTION_MIGRATION_PACKAGE.md` §6 is struck out.**
`prisma migrate deploy` would treat all 14 registered migrations as pending and
attempt to replay the chain onto a populated database. That is wrong twice over:
the objects already exist, and the chain cannot even replay onto an *empty*
database (`20260824120000` drops a `Client_phone_key` **constraint** that
`20260823221818_init` created as a **UNIQUE INDEX** → SQLSTATE 42704; recorded in
`docs/evidence/step5-dev-migration-2026-10-07.json`). Path B is the only route.

**Also note:** production has `Client_businessId_phone_key` (the model's
`@@unique([businessId, phone])`), while the chain would generate `Client_phone_key`
— further evidence the chain was never replayed here.

---

## 3. Question 2 — the Phase 1B `DROP`

**File:** [`prisma/proposed-migrations/AI_WORKFORCE_PHASE_1B/migration.sql`](../prisma/proposed-migrations/AI_WORKFORCE_PHASE_1B/migration.sql), lines 50–51:

```sql
DROP TABLE IF EXISTS "ai_tool_invocations";
DROP TYPE IF EXISTS "AiToolInvocationStatus";
```

**Why it exists.** `AI_WORKFORCE_PHASE_1A` creates `ai_tool_invocations` and its
enum as part of the Phase-1 engine. In this engine **a run *is* the tool
invocation** — the runtime calls exactly one capability per run — so the table
would have duplicated `ai_runs` row-for-row. Phase 1B removes it and moves the
call and its structured result onto the run itself (`ai_runs.input` /
`ai_runs.output`); the ordered event trail stays in `ai_run_events` and the
per-attempt audit trail is the `audit` JSON column on the execution record.

**Does it exist in production?** **No.** Verified directly:
`ai_*` tables = 0; `Ai*` enum types = 0; `to_regclass('public.ai_tool_invocations')`
= `null`.

**Can it contain production data?** **No, structurally.** The table has never
existed in any deployed database (the dev baseline started with 0 AI tables), it
is not declared in `schema.prisma`, so `prisma generate` / `prisma db push` cannot
create it, and no application code can address it.

**What reads or writes it?** **Nothing.**
`grep` over `src/`, `bridge/`, `tests/`, `scripts/`, `prisma/` finds **no TypeScript
reference at all**; the only mentions are the proposed SQL, the review notes, a
comment in `schema.prisma` (§ "the same reasoning that removed the duplicating
`ai_tool_invocations` table in Phase 1B"), and the certification documents.

**What replaces it?** `ai_runs.input` / `ai_runs.output` (added by this same
file) plus `ai_run_events` and the execution record's `audit` JSON.

**Is the DROP genuinely required?** Yes, for datamodel parity: `schema.prisma` has
no such model, and the authoritative diff below confirms the datamodel wants **no**
`ai_tool_invocations` table and **no** `AiToolInvocationStatus` enum. Making the
verifier "green" here would be wrong — `scripts/verify-proposed-migration.mjs`
**must keep refusing any DROP**; that refusal is the control that makes a silent
one impossible.

**Data-loss classification: NONE — an inert no-op.** Both statements use
`IF EXISTS` and both targets are absent, so the only possible effect on production
is `NOTICE: table does not exist, skipping`.

---

## 4. Question 3 — the exact delta that WOULD be applied

Generated against **production itself** (read-only) with the project's own tool:

```bash
prisma migrate diff --from-config-datasource \
                    --to-schema=prisma/schema.prisma --script
# datasource pointed at the session pooler in-process; exit 0; 13,409 bytes; no URL in output
```

Its content splits cleanly into **the AI proposal** and **pre-existing drift the
proposal does not touch**.

> Reproducibility note: the diff needs the **session** pooler port **5432**
> (`aws-1-eu-west-1.pooler.supabase.com:5432`). Prisma's schema engine hangs
> against the **transaction** pooler on 6543, while the select-only inventory in
> `scripts/check-production-preflight-readonly.mjs` works on either.

| Class | Object | Count |
|-------|--------|-------|
| **ALREADY PRESENT** | the 28 modelled legacy tables (282 columns) + their data | 28 tables |
| **WOULD CREATE — the AI proposal** | enums `AiJobStatus`, `AiRiskLevel`, `AiReadWriteMode`, `AiTriggerType`, `AiAutonomyLevel`, `AiRunStatus`, `AiApprovalStatus` | 7 |
| | tables `ai_jobs`, `ai_runs`, `ai_run_events`, `ai_approvals`, `ai_missions`, `ai_tasks`, `ai_execution_records`, `ai_task_reviews`, `ai_command_intents` | 9 |
| | indexes on those tables (incl. `ai_tasks_missionId_sequence_key`, `ai_execution_records_taskId_attempt_key`, `ai_command_intents_scope_idempotencyKey_key`) | 52 |
| **WOULD ADD INDEX/FK — the AI proposal** | foreign keys (9× `ALTER TABLE … ADD CONSTRAINT`), all **between the new tables only** | 9 |
| **WOULD ALTER — the AI proposal** | 7× `ADD COLUMN IF NOT EXISTS` (on `ai_jobs`, `ai_runs`, `ai_approvals`, all created earlier in the same batch) | 7 |
| **WOULD ALTER — legacy** | **none.** Every `ALTER TABLE` in the four files targets an `ai_*` table created earlier in the same batch | 0 |
| **WOULD DROP — the AI proposal** | **nothing takes effect**: both drop targets are already absent | 0 |
| **NO CHANGE** | every legacy table's columns; all 136 public indexes except the two below; all legacy constraints | — |
| **OUTSIDE the proposal** | `DROP TABLE "McpAuditLog"` (12 rows) and `DROP TABLE "McpPendingAction"` (2 rows) — only if the *whole datamodel diff* were applied | 2 |
| **OUTSIDE the proposal** | `DROP INDEX "OfficeExpense_fixedExpenseId_idx"` (an index the datamodel does not declare) | 1 |
| **OUTSIDE the proposal** | `CREATE UNIQUE INDEX "CapitalSpend_fixedExpenseId_key"` (declared by the datamodel, absent in production) | 1 |

**The proposal and the diff are the same thing, proven, not assumed.** The four
files contain **91 create-statements**, of which 7 belong to objects Phase 1B
removes (the `ai_tool_invocations` table, its enum, its 4 indexes and its 1 FK),
leaving **84 net objects** — which is exactly what the diff against production
contains: 7 enums, 9 tables, 52 indexes, 9 FKs, 7 added columns. Mechanically: the
9 `CREATE TABLE` bodies in the diff are **column-identical** to the union of the
four committed files (with `ai_tool_invocations` removed); the 52 `ai_*` indexes
are the files' 56 minus those 4; 9 FKs = 1A's 4 − 1 + Phase 2's 6; 7 enums = 1A's
8 − 1.

**The four statements that are NOT the proposal** are pre-existing drift between
production and `schema.prisma`:

- the two `Mcp*` tables are Supabase-CLI-owned and **carry live data** (12 + 2 rows);
- `OfficeExpense_fixedExpenseId_idx` exists in production but not in the datamodel;
- `CapitalSpend_fixedExpenseId_key` is declared but missing. **It constrains
  nothing today**: `CapitalSpend` has 18 rows and **0** with a non-null
  `fixedExpenseId`, and **0 duplicate values** (`group by … having count(*) > 1`
  returns nothing). So the missing uniqueness has not yet allowed a duplicate.

**Therefore: applying the four files changes nothing except adding empty `ai_*`
objects. It cannot lose data.** The destructive statements exist only in the
*broader* datamodel diff, which this migration is not.

**Time/lock footprint:** every object created is new, so no lock is taken on any
table with rows; `CREATE INDEX` (no `CONCURRENTLY`) on empty tables is effectively
instantaneous; expected downtime none; added storage negligible (9 empty tables +
61 indexes when PKs are counted).

---

## 5. Question 4 — roadmap labels (authoritative) and what was corrected

```
STEP 1/8 ✅ Command Center
STEP 2/8 ✅ Production Bridge
STEP 3/8 ✅ First NEXUP → Bridge → Hermes run
STEP 4/8 ✅ First real Agent
STEP 5/8 🟡 Mission Lifecycle / Production activation
STEP 6/8 ⏳ Real Command Center data
STEP 7/8 ⏳ Character identities
STEP 8/8 ⏳ Full end-to-end wow moment
```

The steps had drifted into re-labelled descriptions ("mission lifecycle
foundation", "persistence", "agent bridge + capability authorization", "async
execution") in three documents; those labels are restored to the roadmap above in
`AI_WORKFORCE_STEP5_FINAL_CERTIFICATION.md`, `AI_WORKFORCE_STEP4_STEP5_CLOSURE.md`
and `AI_WORKFORCE_STEP5_INTEGRATION_GATE.md`. Step 5 remains 🟡 for exactly the
reason recorded before: the durable path has never been activated on a real
deployment.

---

## 6. Mandatory corrections and owner decisions (before any approval)

1. **Path A is struck out.** `prisma migrate deploy` must not be run — there is no
   `_prisma_migrations` table, so it would replay 14 migrations onto a populated
   database. Apply with `prisma db execute --file … --schema prisma/schema.prisma`,
   one file at a time, in order **1A → 1B → PHASE_2 → PHASE_3**, from a host that
   can reach the database (IPv6, or the IPv4 pooler `aws-1-eu-west-1.pooler.supabase.com`).
2. **The package's history-recording step is wrong as written.** `prisma migrate
   resolve --applied <the four>` would create `_prisma_migrations` containing
   *only* the four new names, leaving the 14 legacy migrations unrecorded — after
   which any `migrate deploy` (yours or CI's) would attempt the legacy chain
   against production. Owner decision, one of:
   - **baseline first** — record the 14 as applied (`migrate resolve --applied …`,
     metadata only, runs no SQL), *then* apply and record the four; or
   - **use no Prisma ledger here** — keep applying this project's SQL through the
     same mechanism production already uses (the Supabase CLI ledger, 3 entries),
     and treat `prisma/migrations/` as a historical artifact.
3. **`prisma db push` must never be run against production.** It would drop
   `McpAuditLog` and `McpPendingAction` (14 live rows). A second, independent
   owner decision: model those two tables so the datamodel stops describing a
   database that has them (out of scope here — no application change was made).
4. **Two legacy drift items — backlog, not this batch:** the missing
   `CapitalSpend_fixedExpenseId_key` unique index and the undeclared
   `OfficeExpense_fixedExpenseId_idx`. Neither is touched by the AI proposal and
   neither is currently causing an observed defect.
5. **Re-run the preflight before applying and verify after.** Before: exit 0 with
   "would create 91 / would drop nothing". After: 9 `ai_*` tables, 61 `ai_*`
   indexes, 9 FKs, and the legacy fingerprint still
   `0e72c9ecdfd4a470…`/282 columns.

---

## 7. What was and was not done

**Done:** a read-only inspection of production (migration ledgers, object
inventory, legacy fingerprint parity, and an authoritative `prisma migrate diff`
against production); a durable, select-only preflight script; this report and its
evidence JSON; roadmap-label corrections in three documents.

**Not done, deliberately:** no migration applied, no schema change, no write, no
`prisma db push`, no `migrate deploy`, no DNS/Vercel/Supabase configuration
change, no credential exposure, **no Step-6 work**, no paid provider credits.
Production mutation count: **zero**.

---

**SAFE TO REQUEST OWNER PRODUCTION MIGRATION APPROVAL**
— conditional on decisions 1–5 in §6; this document does not authorise the apply.
