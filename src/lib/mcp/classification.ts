// ═══════════════════════════════════════════════════════════════
// NEXUP MCP — Red/Yellow action classification registry (Phase 2B v1)
//
// Single source of truth for which MCP write tools are ordinary
// "Yellow" actions (execute directly, one transaction, one audit row)
// and which are sensitive "Red" actions (never executed directly:
// prepare → human-readable summary → one-time confirmation token →
// confirm → atomic execution + audit).
//
// The pending-action core (pending.ts) must be proven before more
// entries land. Adding an entry here is the ONLY change needed to wire
// a new Red action into registration: the prepare/confirm tool names
// propagate to the principal (auth.ts) and registration (server.ts)
// automatically, always behind MCP_WRITE_TOOLS_ENABLED AND
// MCP_RED_ACTIONS_ENABLED.
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
 * The Red registry. create_client_payment is the FIRST business
 * action here: recording money moves the pool, so it is never
 * executed directly — prepare stages a validated intent with a
 * human-readable preview, and only a later confirm_create_client_payment
 * (same principal, one-time token, re-checked preconditions) executes
 * it atomically. Tool implementations live in redActions.ts; the
 * registry entry alone controls registration and principal scope.
 */
export const RED_ACTIONS: readonly RedActionDefinition[] = [
  {
    prepareTool: "prepare_create_client_payment",
    confirmTool: "confirm_create_client_payment",
    actionName: "create_client_payment",
  },
];

/** All prepare_* tool names. */
export const RED_PREPARE_TOOL_NAMES: readonly string[] = RED_ACTIONS.map((a) => a.prepareTool);

/** All confirm_* tool names. */
export const RED_CONFIRM_TOOL_NAMES: readonly string[] = RED_ACTIONS.map((a) => a.confirmTool);

/** Every tool a Red action contributes to tools/list. */
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
