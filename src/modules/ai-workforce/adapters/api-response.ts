import { NextResponse } from "next/server";
import { isAiWorkforceError, type AiWorkforceErrorCode } from "../core/errors";

/**
 * One place that turns a workforce error into an HTTP status.
 *
 * Server-only. The mapping is deliberately coarse: the client learns what kind
 * of problem it hit (forbidden, not found, conflict, bad request) without the
 * engine leaking internals or stack traces.
 */

const STATUS_BY_CODE: Partial<Record<AiWorkforceErrorCode, number>> = {
  JOB_NOT_FOUND: 404,
  RUN_NOT_FOUND: 404,
  APPROVAL_NOT_FOUND: 404,
  TOOL_NOT_FOUND: 404,
  // Authorisation
  PERMISSION_DENIED: 403,
  SCOPE_DENIED: 403,
  SCOPE_MISSING: 403,
  APPROVAL_FORBIDDEN: 403,
  // Conflicts / one-way doors
  APPROVAL_ALREADY_DECIDED: 409,
  JOB_CONCURRENT_UPDATE: 409,
  JOB_ALREADY_FINISHED: 409,
  CRITICAL_AUTONOMY_FORBIDDEN: 409,
  COMMAND_KEY_REUSED: 409,
  COMMAND_IN_PROGRESS: 409,
  // Bad request
  INVALID_INPUT: 400,
  INVALID_JOB_TRANSITION: 400,
  INVALID_MISSION: 400,
  MISSION_CONFLICT: 409,
  TOOL_DISABLED: 400,
  CAPABILITY_AMBIGUOUS: 400,
  PERSISTENCE_UNAVAILABLE: 503,
  PERSISTENCE_UNSAFE: 503,
  RUNTIME_UNAVAILABLE: 503,
};

export function workforceErrorResponse(error: unknown, fallbackMessage: string): NextResponse {
  if (!isAiWorkforceError(error)) {
    console.error("[ai-workforce]", fallbackMessage, error);
    return NextResponse.json({ error: fallbackMessage }, { status: 500 });
  }

  const status = STATUS_BY_CODE[error.code] ?? 422;
  return NextResponse.json(
    { error: error.code, message: error.message, details: error.details ?? null },
    { status },
  );
}
