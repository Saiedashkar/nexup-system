-- ═══════════════════════════════════════════════════════════════════════
-- NEXUP AI WORKFORCE — PHASE 1B (persistence + approval loop)
-- ═══════════════════════════════════════════════════════════════════════
--
-- STATUS: PROPOSED — NOT APPLIED TO ANY DATABASE.
--
-- Apply order: AI_WORKFORCE_PHASE_1A first, then this file.
--
-- Rules honoured:
--   * ADDITIVE ONLY. No legacy table, column, index or row is touched — every
--     statement below targets an `ai_*` table created by the Phase 1A file.
--   * `IF NOT EXISTS` / `IF EXISTS` everywhere, so applying this file to a
--     database that already has the Phase 1B shape is a no-op.
--   * Nothing here is registered in `prisma/migrations/`, so
--     `prisma migrate deploy` cannot pick it up by accident.
--
-- Phase 1B review decision (recorded so it is not silently reverted):
--   `ai_tool_invocations` is DROPPED. In this engine a run IS the tool
--   invocation — the runtime calls exactly one capability per run — so the
--   table would have duplicated `ai_runs` row-for-row. The exact call and its
--   result are now persisted on the run itself (`ai_runs.input` / `.output`).
--   This is a removal of a PROPOSED table that never existed anywhere, not a
--   retirement of a live table.
-- ═══════════════════════════════════════════════════════════════════════

-- ── ai_jobs: resumable execution context, state history, result run ─────

-- Nullable: a job only has a run once it has successfully executed.
ALTER TABLE "ai_jobs" ADD COLUMN IF NOT EXISTS "runId" TEXT;

ALTER TABLE "ai_jobs" ADD COLUMN IF NOT EXISTS "context" JSONB NOT NULL DEFAULT '{}';
ALTER TABLE "ai_jobs" ADD COLUMN IF NOT EXISTS "history" JSONB NOT NULL DEFAULT '[]';

CREATE INDEX IF NOT EXISTS "ai_jobs_runId_idx" ON "ai_jobs"("runId");

-- ── ai_runs: the exact call and its structured result ───────────────────

ALTER TABLE "ai_runs" ADD COLUMN IF NOT EXISTS "input" JSONB NOT NULL DEFAULT '{}';
ALTER TABLE "ai_runs" ADD COLUMN IF NOT EXISTS "output" JSONB;

-- ── ai_approvals: who the decision is for, and its correlation id ───────

ALTER TABLE "ai_approvals" ADD COLUMN IF NOT EXISTS "requestedForUserId" TEXT;
ALTER TABLE "ai_approvals" ADD COLUMN IF NOT EXISTS "correlationId" TEXT;

CREATE INDEX IF NOT EXISTS "ai_approvals_requestedForUserId_idx" ON "ai_approvals"("requestedForUserId");

-- ── Phase 1A review: remove the run-duplicating table ───────────────────

DROP TABLE IF EXISTS "ai_tool_invocations";
DROP TYPE IF EXISTS "AiToolInvocationStatus";
