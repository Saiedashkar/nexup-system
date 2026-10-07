import type { JsonObject } from "./types";

/**
 * Every failure the control core can raise carries a machine-readable code.
 * Nothing in the module throws raw strings, so callers (jobs, runtime, audit)
 * can branch on the code instead of parsing messages.
 */
export const AI_WORKFORCE_ERROR_CODES = [
  // registry / capability
  "TOOL_NOT_FOUND",
  "DUPLICATE_TOOL_ID",
  "CAPABILITY_AMBIGUOUS",
  // contract / configuration
  "TOOL_DISABLED",
  "INVALID_TOOL_DEFINITION",
  "INVALID_INPUT",
  "INVALID_OUTPUT",
  // policy / approvals
  "PERMISSION_DENIED",
  "SCOPE_MISSING",
  "SCOPE_DENIED",
  "APPROVAL_REQUIRED",
  "APPROVAL_REJECTED",
  "APPROVAL_NOT_FOUND",
  "APPROVAL_ALREADY_DECIDED",
  "APPROVAL_WRONG_TOOL",
  "CRITICAL_AUTONOMY_FORBIDDEN",
  "MONEY_SAFETY_VIOLATION",
  // job engine
  "INVALID_JOB_TRANSITION",
  "JOB_NOT_FOUND",
  "JOB_ALREADY_FINISHED",
  /** Lost a compare-and-set: another execution advanced the job first. */
  "JOB_CONCURRENT_UPDATE",
  /** The job row carries no execution context snapshot and none was supplied. */
  "JOB_CONTEXT_MISSING",
  // approvals
  "APPROVAL_FORBIDDEN",
  // persistence
  "PERSISTENCE_UNSAFE",
  "PERSISTENCE_UNAVAILABLE",
  // execution
  "TOOL_EXECUTION_FAILED",
  "TOOL_TIMEOUT",
  "RUN_NOT_FOUND",
  "RUNTIME_UNAVAILABLE",
  "NOT_IMPLEMENTED",
  // ── Phase 2A — workforce domain (Actor / Capability / Runtime / Mission) ──
  "INVALID_ACTOR",
  "ACTOR_NOT_FOUND",
  "ACTOR_SLUG_TAKEN",
  "INVALID_ACTOR_TRANSITION",
  "ACTOR_DISABLED",
  "INVALID_CAPABILITY",
  "CAPABILITY_NOT_FOUND",
  "CAPABILITY_VERSION_CONFLICT",
  "INVALID_ASSIGNMENT",
  "ASSIGNMENT_NOT_FOUND",
  "ASSIGNMENT_CONFLICT",
  "RUNTIME_NOT_FOUND",
  "RUNTIME_UNSUPPORTED",
  "RUNTIME_UNHEALTHY",
  /** A caller stopped WAITING for an execution; the execution itself may still be running. */
  "RUNTIME_TIMEOUT",
  "INVALID_MISSION",
  "MISSION_NOT_FOUND",
  "INVALID_MISSION_TRANSITION",
  "MISSION_CONFLICT",
] as const;

export type AiWorkforceErrorCode = (typeof AI_WORKFORCE_ERROR_CODES)[number];

export class AiWorkforceError extends Error {
  readonly code: AiWorkforceErrorCode;
  readonly details?: JsonObject;

  constructor(code: AiWorkforceErrorCode, message: string, details?: JsonObject) {
    super(message);
    this.name = "AiWorkforceError";
    this.code = code;
    this.details = details;
  }

  toJSON(): { code: AiWorkforceErrorCode; message: string; details?: JsonObject } {
    return this.details ? { code: this.code, message: this.message, details: this.details } : { code: this.code, message: this.message };
  }
}

export function isAiWorkforceError(value: unknown): value is AiWorkforceError {
  return value instanceof AiWorkforceError;
}

/** Normalises any thrown value into a serialisable error payload. */
export function toErrorPayload(value: unknown): { code: AiWorkforceErrorCode; message: string; details?: JsonObject } {
  if (isAiWorkforceError(value)) return value.toJSON();
  const message = value instanceof Error ? value.message : String(value);
  return { code: "TOOL_EXECUTION_FAILED", message };
}
