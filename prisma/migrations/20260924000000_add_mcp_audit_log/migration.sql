-- Additive, non-destructive audit trail for MCP (Hermes) write tools.
--
-- Only CREATE TABLE + CREATE INDEX. No existing table, column, constraint,
-- index or row is touched, and no foreign key is created here:
--   * ActivityLog keeps its NOT NULL User FK untouched — MCP never fakes
--     a human actor, so its rows live in this separate table instead.
--   * The trail carries businessId/businessSlug as plain columns so it can
--     never add a new RESTRICT constraint that blocks a user/business op.
--   * metadata stores non-secret change details only (never tokens,
--     headers, credentials or environment values).

CREATE TABLE "McpAuditLog" (
    "id" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'MCP/Hermes',
    "actor" TEXT NOT NULL,
    "actorName" TEXT NOT NULL,
    "tool" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "businessSlug" TEXT NOT NULL,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "McpAuditLog_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "McpAuditLog_businessId_idx" ON "McpAuditLog"("businessId");

CREATE INDEX "McpAuditLog_entityType_entityId_idx" ON "McpAuditLog"("entityType", "entityId");

CREATE INDEX "McpAuditLog_createdAt_idx" ON "McpAuditLog"("createdAt");

CREATE INDEX "McpAuditLog_tool_idx" ON "McpAuditLog"("tool");
