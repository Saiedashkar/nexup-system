// ═══════════════════════════════════════════════════════════════
// NEXUP MCP — Red/Yellow action classification registry (Phase 2B v1)
//
// Single source of truth for which MCP write tools are ordinary
// "Yellow" actions (execute directly, one transaction, one audit row)
// and which are sensitive "Red" actions (never executed directly:
// prepare → human-readable summary → one-time confirmation token →
// confirm → atomic execution + audit).
//
// v1 contains NO Red business actions. Financial writes, payments,
// expenses, withdrawals, deletes and subscription mutations will be
// added here — each as one entry in RED_ACTIONS — only after the
// pending-action core has been proven. Adding an entry is the ONLY
// change needed to wire a new Red action into registration.
// ═══════════════════════════════════════════════════════════════

/**
 * A Red action: the tool that prepares an intent and the tool that
 * confirms it. `confirmTool` always executes from the server-side
 * snapshot stored at prepare time — arguments are never re-sent.
 */
export type RedActionDefinition = {
  /** prepare_* tool name. */
  prepareTool: string;
  /** confirm_* tool name. */
  confirmTool: string;
  /** Business-facing name of the action (used in summaries/audit). */
  actionName: string;
};

/**
 * v1 registry — intentionally empty of business actions.
 * The create_client_payment Red action lands here in a later,
 * separately approved step.
 */
export const RED_ACTIONS: readonly RedActionDefinition[] = [];

/** All prepare_* tool names (v1: none). */
export const RED_PREPARE_TOOL_NAMES: readonly string[] = RED_ACTIONS.map((a) => a.prepareTool);

/** All confirm_* tool names (v1: none). */
export const RED_CONFIRM_TOOL_NAMES: readonly string[] = RED_ACTIONS.map((a) => a.confirmTool);

/** Every tool a Red action contributes to tools/list (v1: none). */
export const RED_TOOL_NAMES: readonly string[] = [...RED_PREPARE_TOOL_NAMES, ...RED_CONFIRM_TOOL_NAMES];

/** Is this tool name part of the Red (confirmation-gated) surface? */
export function isRedTool(toolName: string): boolean {
  return RED_TOOL_NAMES.includes(toolName);
}

/**
 * Pending-action statuses that confirm_execute may consume.
 * v1: only PENDING. When a trusted approval channel (dashboard,
 * Telegram, …) lands, channel-gated actions flip this to
 * ["APPROVED"] — one constant, no redesign.
 */
export const CONSUMABLE_STATUSES = ["PENDING"] as const;

/** Non-terminal statuses of a pending action (v1: PENDING only). */
export const OPEN_STATUSES = ["PENDING"] as const;
