import { assertNoCallerProfile } from "../hermes/profile-policy";
import type { RunCorrelation } from "../hermes/run-manager";
import { BridgeError } from "./errors";

/**
 * Strict request schema for `POST /v1/runs`.
 *
 * The bridge exposes a FIXED set of named fields and NO generic method/RPC
 * field — operations are enumerated in the route table, not chosen by the
 * caller. That only holds if an undeclared field is REFUSED: a field that is
 * silently ignored is indistinguishable from a working one at the call site, so
 * a caller could believe a run used a method or scope it never used. Every
 * field the bridge defines is listed here, and the app-side client's exact wire
 * payload is pinned by a contract test so a future payload change fails loudly.
 *
 * Named fields keep their existing semantics: a malformed optional value is
 * dropped (as before), while a missing REQUIRED value and a caller-supplied
 * `profile` keep their dedicated errors.
 */

/** Max length of a correlation field, so it cannot inflate a log or audit line. */
export const MAX_CORRELATION_FIELD_LENGTH = 128;

/** Exactly the fields `POST /v1/runs` defines. Nothing else is accepted. */
export const SUBMIT_FIELDS = ["instruction", "contextJson", "correlation", "timeoutMs"] as const;

/** Exactly the fields `correlation` defines. Nothing else is accepted. */
export const CORRELATION_FIELDS = ["actorId", "traceId", "jobId", "missionId"] as const;

export type RunSubmission = {
  instruction: string;
  contextJson?: string;
  correlation: RunCorrelation;
  timeoutMs?: number;
};

function capField(value: string): string {
  return value.length > MAX_CORRELATION_FIELD_LENGTH ? value.slice(0, MAX_CORRELATION_FIELD_LENGTH) : value;
}

/** Arrays are not objects here: a JSON array can never carry named fields. */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function assertKnownFields(body: Record<string, unknown>, allowed: readonly string[], where: string): void {
  for (const field of Object.keys(body)) {
    if (!allowed.includes(field)) {
      throw new BridgeError(
        "BAD_REQUEST",
        `Unknown field "${field}" in ${where}; the bridge defines only ${allowed.join(", ")}`,
      );
    }
  }
}

/**
 * Validates and normalizes a run submission.
 *
 * @throws BridgeError BAD_REQUEST for an undeclared field or a missing/invalid
 * required field, and FORBIDDEN_PROFILE for a caller-supplied profile.
 */
export function parseRunSubmission(body: unknown, limits: { maxTimeoutMs: number }): RunSubmission {
  if (!isPlainObject(body)) throw new BridgeError("BAD_REQUEST", "Request body must be a JSON object");

  // The profile check runs FIRST so a caller-supplied profile keeps its dedicated
  // 403 rather than degenerating into a generic unknown-field rejection.
  assertNoCallerProfile(body);
  assertKnownFields(body, SUBMIT_FIELDS, "the run submission");

  const instruction = typeof body.instruction === "string" ? body.instruction.trim() : "";
  if (!instruction) throw new BridgeError("BAD_REQUEST", "instruction is required");

  const rawCorrelation = body.correlation ?? {};
  if (!isPlainObject(rawCorrelation)) throw new BridgeError("BAD_REQUEST", "correlation must be an object");
  assertKnownFields(rawCorrelation, CORRELATION_FIELDS, "correlation");

  const actorId = capField(typeof rawCorrelation.actorId === "string" ? rawCorrelation.actorId : "");
  const traceId = capField(typeof rawCorrelation.traceId === "string" ? rawCorrelation.traceId : "");
  if (!actorId) throw new BridgeError("BAD_REQUEST", "correlation.actorId is required");
  if (!traceId) throw new BridgeError("BAD_REQUEST", "correlation.traceId is required");

  const submission: RunSubmission = {
    instruction,
    correlation: {
      actorId,
      traceId,
      ...(typeof rawCorrelation.jobId === "string" ? { jobId: capField(rawCorrelation.jobId) } : {}),
      ...(typeof rawCorrelation.missionId === "string" ? { missionId: capField(rawCorrelation.missionId) } : {}),
    },
  };

  if (typeof body.contextJson === "string" && body.contextJson.trim()) submission.contextJson = body.contextJson;

  if (typeof body.timeoutMs === "number" && Number.isFinite(body.timeoutMs) && body.timeoutMs > 0) {
    submission.timeoutMs = Math.min(body.timeoutMs, limits.maxTimeoutMs);
  }

  return submission;
}
