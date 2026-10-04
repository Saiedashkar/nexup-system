import type { ToolDefinition } from "../registry/tool-definition";
import { DEFAULT_COST_POLICY, DEFAULT_RETRY_POLICY, DEFAULT_TIMEOUT_MS } from "../registry/tool-definition";

/**
 * Authorization guard for external agent-runtime dispatch.
 *
 * Hermes one-shot executions AUTO-BYPASS Hermes' own approvals, so NEXUP must
 * make the authorization decision BEFORE it hands anything to a runtime. This
 * synthetic, non-executable capability lets the EXISTING `PermissionPolicy` and
 * `ApprovalGate` evaluate a dispatch exactly as they evaluate a tool — no new
 * policy engine, no second source of truth.
 *
 * It is never registered in the tool registry and never executed: it exists
 * only so a runtime dispatch is treated as a HIGH-risk, approval-forcing
 * external side effect that requires `aiworkforce.access`.
 */

export const RUNTIME_DISPATCH_TOOL_ID = "runtime.dispatch";

export const RUNTIME_DISPATCH_DEFINITION: ToolDefinition = {
  id: RUNTIME_DISPATCH_TOOL_ID,
  version: "1.0.0",
  name: "Agent runtime dispatch",
  description: "Dispatches a job to an external agent runtime (for authorization only).",
  domain: "system",
  action: "dispatch",
  riskLevel: "HIGH",
  readWriteMode: "WRITE",
  inputSchema: { kind: "object", fields: {} },
  outputSchema: { kind: "object", fields: {} },
  requiredPermissions: ["aiworkforce.access"],
  // External side effect in a runtime that bypasses its own approvals: always
  // require NEXUP authorization first.
  requiresApproval: true,
  estimatedCostPolicy: DEFAULT_COST_POLICY,
  timeoutPolicy: { timeoutMs: DEFAULT_TIMEOUT_MS, onTimeout: "FAIL" },
  retryPolicy: DEFAULT_RETRY_POLICY,
  enabled: true,
  businessScoped: false,
};
