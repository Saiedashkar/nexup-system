import { AiWorkforceError } from "../core/errors";
import type { AiWorkforceErrorCode } from "../core/errors";
import type { ToolHandler } from "../core/ports";
import type { ObjectSchema } from "../core/schema";
import type { PermissionToken } from "../core/execution-context";
import type { ReadWriteMode, RiskLevel, ToolDomain, ToolId } from "../core/types";

/* ═══════════════════════════════════════════════════════
   Policies attached to every tool
   ═══════════════════════════════════════════════════════ */

/**
 * What a single execution of this tool is expected to cost.
 * Phase 1A has no paid provider, so everything is NONE — the field exists so
 * token/credit budgeting never needs a contract change.
 */
export type EstimatedCostPolicy = {
  kind: "NONE" | "FIXED_UNITS" | "PROVIDER_TOKENS";
  units?: number;
  note?: string;
};

export type TimeoutPolicy = {
  timeoutMs: number;
  /** What the job engine should do when the timeout fires. */
  onTimeout?: "FAIL" | "MARK_WAITING_HUMAN";
};

export type RetryPolicy = {
  maxAttempts: number;
  backoff?: "NONE" | "FIXED" | "EXPONENTIAL";
  backoffMs?: number;
  /** Only these error codes are retried. Everything else fails fast. */
  retryOn?: AiWorkforceErrorCode[];
};

/* ═══════════════════════════════════════════════════════
   Tool definition
   ═══════════════════════════════════════════════════════ */

export type ToolDefinition = {
  /** Stable capability id, `namespace.action` — e.g. `client.search`. */
  id: ToolId;
  /** Contract version. Bump on any breaking input/output change. */
  version: string;
  name: string;
  description: string;
  domain: ToolDomain;
  action: string;
  riskLevel: RiskLevel;
  readWriteMode: ReadWriteMode;
  inputSchema: ObjectSchema;
  outputSchema: ObjectSchema;
  requiredPermissions: PermissionToken[];
  /** Forced approval regardless of the risk policy. */
  requiresApproval: boolean;
  estimatedCostPolicy: EstimatedCostPolicy;
  timeoutPolicy: TimeoutPolicy;
  retryPolicy: RetryPolicy;
  enabled: boolean;
  /** Requires a resolved business scope; input's businessId must match it. */
  businessScoped: boolean;
};

export const DEFAULT_TIMEOUT_MS = 10_000;

export const DEFAULT_TIMEOUT_POLICY: TimeoutPolicy = { timeoutMs: DEFAULT_TIMEOUT_MS, onTimeout: "FAIL" };

export const DEFAULT_RETRY_POLICY: RetryPolicy = { maxAttempts: 1, backoff: "NONE", retryOn: [] };

export const DEFAULT_COST_POLICY: EstimatedCostPolicy = { kind: "NONE" };

/** Definition input — policy objects are optional and defaulted. */
export type ToolDefinitionInput = Omit<
  ToolDefinition,
  "estimatedCostPolicy" | "timeoutPolicy" | "retryPolicy" | "enabled" | "requiresApproval" | "businessScoped" | "version"
> &
  Partial<
    Pick<
      ToolDefinition,
      | "estimatedCostPolicy"
      | "timeoutPolicy"
      | "retryPolicy"
      | "enabled"
      | "requiresApproval"
      | "businessScoped"
      | "version"
    >
  >;

/* ═══════════════════════════════════════════════════════
   Adapter
   ═══════════════════════════════════════════════════════

   A definition is pure metadata (serialisable, exposed by the tools API).
   The executable part is kept separate, so listing capabilities can never
   leak a handler. */

export type ToolAdapter = {
  definition: ToolDefinition;
  handler: ToolHandler;
};

const TOOL_ID_PATTERN = /^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$/;

/**
 * Builds a tool adapter: defaults are applied and the id format is enforced
 * here so a malformed definition fails at construction, not at execution.
 * Risk / money guards run in `ToolRegistry.register`.
 */
export function defineTool(input: ToolDefinitionInput, handler: ToolHandler): ToolAdapter {
  if (!TOOL_ID_PATTERN.test(input.id)) {
    throw new AiWorkforceError("INVALID_TOOL_DEFINITION", `Tool id must look like "namespace.action", received "${input.id}"`, {
      toolId: input.id,
    });
  }
  if (!input.action || input.id.split(".")[1] !== input.action) {
    throw new AiWorkforceError("INVALID_TOOL_DEFINITION", `Tool action must match the id suffix for "${input.id}"`, {
      toolId: input.id,
      action: input.action,
    });
  }
  if (typeof handler !== "function") {
    throw new AiWorkforceError("INVALID_TOOL_DEFINITION", `Tool "${input.id}" has no handler`);
  }

  return {
    definition: {
      ...input,
      version: input.version ?? "1.0.0",
      enabled: input.enabled ?? true,
      requiresApproval: input.requiresApproval ?? false,
      businessScoped: input.businessScoped ?? false,
      estimatedCostPolicy: input.estimatedCostPolicy ?? DEFAULT_COST_POLICY,
      timeoutPolicy: input.timeoutPolicy ?? DEFAULT_TIMEOUT_POLICY,
      retryPolicy: input.retryPolicy ?? DEFAULT_RETRY_POLICY,
    },
    handler,
  };
}
