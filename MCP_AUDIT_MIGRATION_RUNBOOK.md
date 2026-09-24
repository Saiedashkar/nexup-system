# Runbook — Applying the `McpAuditLog` Migration

Scope: migration `20260924000000_add_mcp_audit_log` (MCP/Hermes audit trail, branch `feature/mcp-phase-1`).
Companion to `DEPLOY.md` — read that for general deployment steps first.

## What this migration is

- `CREATE TABLE "McpAuditLog"` + 4 indexes (`businessId`, `(entityType, entityId)`, `createdAt`, `tool`).
- **Additive only**: no ALTERs, no FKs, touches no existing table, column, constraint or row.
- Written by every successful MCP write tool call (`create_client`, `update_client`, `create_project`, `update_project`), committed in the same transaction as the write. The app also logs human actions to `ActivityLog` — that table is untouched.

## The deploy-order question

`npm run build` only runs `prisma generate && next build` — it **never** applies migrations. So the table exists only after you deliberately run the migration against the production database. Two orders are safe because of the additive design:

| Order | What happens | Risk |
|---|---|---|
| **A. Migrate first** *(recommended)* | Table exists before the new code deploys. First MCP write tool call atomically records its audit row. | Essentially none — nothing else reads or writes this table yet. |
| B. Deploy first | New code can technically issue INSERTs into a missing table → the first MCP write fails with `[internal_error]` and rolls back (no partial write, no audit row). Human-facing app is unaffected. | Only if you enable/expose MCP tools before migrating. |

**Recommendation: A — apply the migration any time before (or with) the next deployment.** There is no downtime component: `CREATE TABLE` + 4 `CREATE INDEX` on an empty table is instant.

## Before you apply — checklist

1. Working tree contains `prisma/migrations/20260924000000_add_mcp_audit_log/migration.sql` (pull `feature/mcp-phase-1` first).
2. ⚠️ **Where to run it:** the production Supabase host (the `DATABASE_URL` in `.env.production`) is **IPv6-only and unreachable from this dev machine**. Run the migration **on the server** (or another host with IPv6), not locally.
3. ⚠️ **Env file quirk:** `prisma.config.ts` loads `dotenv/config`, i.e. **`.env`**, not `.env.production`. On the server, make sure the shell you run the CLI from has `DATABASE_URL` exported, or temporarily copy `.env.production` to `.env` for the command and restore it after.
4. Take a note of the current migration state (`npx prisma migrate status` output) so you can diff it after.

## Apply (on the server)

```bash
cd nexup-business-system
git pull                      # ensure the migration folder is present
export DATABASE_URL="postgresql://...production..."   # or use .env as above
npx prisma migrate status     # shows 1 pending migration
npx prisma migrate deploy     # applies only pending migrations, in order
npx prisma migrate status     # should now show: database is up to date
```

`migrate deploy` is non-interactive and applies only recorded, pending migrations — it will not prompt and will not drift-correct.

### If it fails halfway

`CREATE TABLE`/`CREATE INDEX` in this migration commit atomically; a failure leaves no partial table. Re-run `npx prisma migrate deploy` after fixing the cause. If a failed run is recorded in `_prisma_migrations`, mark it rolled back first:

```bash
npx prisma migrate resolve --rolled-back 20260924000000_add_mcp_audit_log
```

## Verify post-deploy

1. **Table exists with expected shape** (on the server, or any DB console):

```sql
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_name = 'McpAuditLog' ORDER BY ordinal_position;
-- Expect 12 columns: id, source, actor, actorName, tool, action,
-- entityType, entityId, businessId, businessSlug, metadata, createdAt

SELECT indexname FROM pg_indexes WHERE tablename = 'McpAuditLog';
-- Expect: pkey + businessId_idx + entityType_entityId_idx + createdAt_idx + tool_idx
```

2. **Migration recorded**: `npx prisma migrate status` → up to date, no drift warnings.

3. **Existing app unaffected**: log into the office app, open the clients and finance pages, confirm they load and that a manual (human) save still writes `ActivityLog` — never `McpAuditLog`.

4. **MCP end-to-end** (once the tools are actually enabled in prod): make one write-tool call (e.g. `create_client` with test data), then:

```sql
SELECT "tool", "action", "entityType", "actor", "businessSlug", "createdAt"
FROM "McpAuditLog" ORDER BY "createdAt" DESC LIMIT 5;
```

   Expect exactly one row per successful write with `source = 'MCP/Hermes'`. A failed/rejected MCP call must add **no** row (audit is committed atomically with the write). Delete the test entity afterwards.

5. **No secrets in audit rows**:

```sql
SELECT count(*) FROM "McpAuditLog"
WHERE "metadata"::text ~* '(token|password|secret|authorization|postgres://)';
-- Expect 0
```

## Do NOT

- Do **not** run `prisma migrate reset`, `db push`, or anything interactive against production.
- Do **not** add FKs from `McpAuditLog` to `User`/`Business` later without revisiting the design — the table deliberately uses plain `businessId`/`businessSlug` columns so it can never block a business operation via RESTRICT.
- Do **not** deploy from this dev machine — the prod DB is unreachable from here (IPv6-only); treat any successful local run against `127.0.0.1` as a test, not a deploy.
