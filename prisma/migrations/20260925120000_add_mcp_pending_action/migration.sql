-- Phase 2B: pending confirmation for sensitive ("Red") MCP actions.
-- Additive only: CREATE TABLE + CREATE INDEX. No existing table, column,
-- constraint, index or row is touched, and no foreign key is created:
--   * Like McpAuditLog, this is lifecycle machinery that must never add
--     a RESTRICT constraint blocking a user/business operation.
--   * confirmTokenHash stores only the SHA-256 of the one-time token —
--     the plaintext token is never persisted, logged or audited.
--   * approvalChannel / approvedAt / approvedBy are pre-declared for a
--     future trusted approval channel (dashboard, Telegram, …) and are
--     unused in v1 (status stays PENDING → EXECUTED | EXPIRED | FAILED).

CREATE TABLE "McpPendingAction" (
    "id" TEXT NOT NULL,
    "actor" TEXT NOT NULL,
    "actorName" TEXT NOT NULL,
    "tool" TEXT NOT NULL,
    "actionType" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT,
    "businessId" TEXT NOT NULL,
    "businessSlug" TEXT NOT NULL,
    "argsSnapshot" JSONB NOT NULL,
    "preview" JSONB NOT NULL,
    "preconditionFingerprint" JSONB,
    "requestHash" TEXT NOT NULL,
    "confirmTokenHash" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "confirmedAt" TIMESTAMP(3),
    "executedAt" TIMESTAMP(3),
    "resultAuditLogId" TEXT,
    "approvalChannel" TEXT,
    "approvedAt" TIMESTAMP(3),
    "approvedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "McpPendingAction_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "McpPendingAction_status_expires_at_idx" ON "McpPendingAction"("status", "expiresAt");
CREATE INDEX "McpPendingAction_actor_idx" ON "McpPendingAction"("actor");
CREATE INDEX "McpPendingAction_business_id_idx" ON "McpPendingAction"("businessId");
CREATE INDEX "McpPendingAction_entityType_entityId_idx" ON "McpPendingAction"("entityType", "entityId");
