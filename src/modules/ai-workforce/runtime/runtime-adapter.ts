import type { AiWorkforceErrorCode } from "../core/errors";
import type { ExecutionContext, PermissionToken } from "../core/execution-context";
import type { ValidationIssue } from "../core/schema";
import type { JsonObject, ReadWriteMode, RiskLevel } from "../core/types";
import type { RunRecord } from "../audit/run-recorder";
import type { ApprovalEvaluation } from "../approvals/approval-policy";
import type { PermissionDecision } from "../policies/permission-policy";
import type { ToolDefinition } from "../registry/tool-definition";

/**
 * Runtime contract.
 *
 * A runtime is the ONLY thing allowed to drive a capability to execution. The
 * control core never calls a tool handler directly, which is what makes the
 * engine provider-agnostic: Hermes / OpenAI / Claude adapters implement this
 * exact interface later, with zero changes to registry, policy, approvals and
 * audit.
 *
 * Phase 1A ships `LocalRuntimeAdapter` only: deterministic, in-process, no AI
 * provider, no tokens, no external calls.
 */

export const RUNTIME_KINDS = ["LOCAL", "HERMES", "OPENAI", "CLAUDE", "GEMINI"] as const;
export type RuntimeKind = (typeof RUNTIME_KINDS)[number];

export type AiProviderKind = "NONE" | "HERMES" | "OPENAI" | "CLAUDE" | "GEMINI";

export type PersistenceKind = "IN_MEMORY" | "DATABASE";

export type RuntimeExecutionRequest = {
  /** Tool id (`client.search`) or an unambiguous shorthand (`search`). */
  capability: string;
  input?: JsonObject;
  context: ExecutionContext;
};

/** Structured explanation of everything the engine decided before executing. */
export type RuntimePreflight = {
  capability: string;
  resolved: boolean;
  tool: ToolDefinition | null;
  inputValid: boolean;
  inputIssues: ValidationIssue[];
  normalizedInput: Record<string, unknown> | null;
  permission: PermissionDecision;
  approval: ApprovalEvaluation | null;
  blocked: boolean;
  blockedCode?: AiWorkforceErrorCode;
  blockedMessage?: string;
};

export type RuntimeExecutionResult = {
  capability: string;
  toolId: string;
  toolVersion: string;
  riskLevel: RiskLevel;
  readWriteMode: ReadWriteMode;
  status: "SUCCEEDED" | "FAILED" | "WAITING_APPROVAL";
  output?: unknown;
  error?: { code: AiWorkforceErrorCode; message: string; details?: JsonObject };
  run: RunRecord | null;
  permission: PermissionDecision;
  approval: ApprovalEvaluation | null;
  attempts: number;
  durationMs: number;
  aiProvider: AiProviderKind;
};

export type RuntimeDescription = {
  kind: RuntimeKind;
  aiProvider: AiProviderKind;
  persistence: PersistenceKind;
  /** Phase 1A runtime is in-process and does not talk to any provider. */
  externalCalls: boolean;
  tools: {
    total: number;
    enabled: number;
    read: number;
    write: number;
    requiresApproval: number;
  };
  permissionTokens: readonly PermissionToken[];
  notes: string[];
};

export interface RuntimeAdapter {
  readonly kind: RuntimeKind;

  /** Capability to run, resolved through the registry. */
  preflight(request: RuntimeExecutionRequest): Promise<RuntimePreflight>;

  /**
   * Full execution path: capability lookup → input validation → permission
   * policy → approval gate → tool execution → result → audit.
   *
   * Throws `AiWorkforceError` when the execution must not proceed
   * (policy, approval, timeout, tool failure). A run record is written for
   * every attempt that reached capability resolution.
   */
  execute(request: RuntimeExecutionRequest): Promise<RuntimeExecutionResult>;

  describe(): RuntimeDescription;
}
