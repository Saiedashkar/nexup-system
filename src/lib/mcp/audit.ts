import type { Prisma } from "@prisma/client";
import type { McpActionToolName, McpPrincipal } from "./auth";

/* ═══════════════════════════════════════════════════════════════
   NEXUP MCP — audit trail for the four Phase 2A write tools

   Every successful MCP write is committed together with exactly one
   `McpAuditLog` row, inside a single transaction (see `actions.ts`).
   That gives two properties the review asked for:

   • a success can never exist without its audit record — if the audit
     insert fails the whole transaction rolls back, so the tool reports
     an error and nothing was written;
   • a rejected/failed call never leaves a misleading success record —
     the row is only ever created on the same commit as the write.

   The row records source (MCP/Hermes), actor principal, tool name,
   action, entity type/id, the single affected business and a non-secret
   metadata payload. `metadata` must never contain MCP_ACCESS_TOKEN,
   authorization headers, credentials or environment values.
   ═══════════════════════════════════════════════════════════════ */

/** Human-facing source label — every MCP write is attributable to this. */
export const MCP_AUDIT_SOURCE = "MCP/Hermes";

/**
 * v1 lifecycle rows: PREPARE is written when a pending action is created;
 * CREATE/UPDATE describe executed business changes. DELETE becomes
 * writable when a Red delete action is introduced.
 */
export type McpAuditAction = "CREATE" | "UPDATE" | "PREPARE";
export type McpAuditEntityType = "Client" | "ProjectRecord" | "ClientPayment" | "McpPendingAction";

export type McpAuditInput = {
  /** Acting MCP principal — machine identity, never a human User id. */
  principal: McpPrincipal;
  /** Exact tool that performed the write or created the pending action. */
  tool: string;
  action: McpAuditAction;
  entityType: McpAuditEntityType;
  entityId: string;
  /** The one business this write touched (already allow-list checked). */
  business: { id: string; slug: string };
  /** Non-secret change details only. */
  metadata: Prisma.InputJsonValue;
};

/**
 * Build the audit row for a successful write.
 * Callers insert this through the transaction client that also performs
 * the write, so the two commit or roll back together.
 */
export function mcpAuditData(input: McpAuditInput): Prisma.McpAuditLogCreateInput {
  return {
    source: MCP_AUDIT_SOURCE,
    actor: input.principal.id,
    actorName: input.principal.displayName,
    tool: input.tool,
    action: input.action,
    entityType: input.entityType,
    entityId: input.entityId,
    businessId: input.business.id,
    businessSlug: input.business.slug,
    metadata: input.metadata,
  };
}
