/**
 * Bridge error model.
 *
 * Every failure the bridge can produce carries a machine-readable code. The
 * HTTP status and the retryable flag are derived from the code in ONE place, so
 * handlers never hand-roll a status and the wire envelope stays uniform:
 *
 *   { "error": { "code", "message", "retryable", "detail"? } }
 *
 * `message`/`detail` NEVER contain a secret (callers redact before throwing, and
 * the server runs the envelope through the redactor again before sending).
 */

export const BRIDGE_ERROR_CODES = [
  "BAD_REQUEST",
  "UNAUTHORIZED",
  "SIGNATURE_INVALID",
  "REPLAY",
  "FORBIDDEN_PROFILE",
  "METHOD_NOT_ALLOWED",
  "RUN_NOT_FOUND",
  "RATE_LIMITED",
  "PAYLOAD_TOO_LARGE",
  "HERMES_TIMEOUT",
  "HERMES_UNAVAILABLE",
  "HERMES_PROTOCOL_ERROR",
  "INTERNAL",
] as const;

export type BridgeErrorCode = (typeof BRIDGE_ERROR_CODES)[number];

export type BridgeErrorEnvelope = {
  error: {
    code: BridgeErrorCode;
    message: string;
    retryable: boolean;
    detail?: string;
  };
};

const HTTP_STATUS: Record<BridgeErrorCode, number> = {
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  SIGNATURE_INVALID: 401,
  REPLAY: 401,
  FORBIDDEN_PROFILE: 403,
  METHOD_NOT_ALLOWED: 403,
  RUN_NOT_FOUND: 404,
  PAYLOAD_TOO_LARGE: 413,
  RATE_LIMITED: 429,
  HERMES_TIMEOUT: 503,
  HERMES_UNAVAILABLE: 503,
  HERMES_PROTOCOL_ERROR: 502,
  INTERNAL: 500,
};

const RETRYABLE: Record<BridgeErrorCode, boolean> = {
  BAD_REQUEST: false,
  UNAUTHORIZED: false,
  SIGNATURE_INVALID: false,
  REPLAY: false,
  FORBIDDEN_PROFILE: false,
  METHOD_NOT_ALLOWED: false,
  RUN_NOT_FOUND: false,
  RATE_LIMITED: true,
  PAYLOAD_TOO_LARGE: false,
  HERMES_TIMEOUT: true,
  HERMES_UNAVAILABLE: true,
  HERMES_PROTOCOL_ERROR: true,
  INTERNAL: true,
};

export class BridgeError extends Error {
  readonly code: BridgeErrorCode;
  readonly detail?: string;

  constructor(code: BridgeErrorCode, message: string, detail?: string) {
    super(message);
    this.name = "BridgeError";
    this.code = code;
    if (detail !== undefined) this.detail = detail;
  }

  get httpStatus(): number {
    return HTTP_STATUS[this.code];
  }

  get retryable(): boolean {
    return RETRYABLE[this.code];
  }
}

export function httpStatusForCode(code: BridgeErrorCode): number {
  return HTTP_STATUS[code];
}

export function isRetryableCode(code: BridgeErrorCode): boolean {
  return RETRYABLE[code];
}

/**
 * Maps a Hermes transport error kind onto a bridge error code, so the existing
 * `HermesTransportResult.transportError` vocabulary flows through unchanged.
 */
export function mapTransportErrorKind(
  kind: "TIMEOUT" | "UNAVAILABLE" | "BLOCKED_COMMAND" | "MALFORMED" | "HTTP_ERROR" | "FORBIDDEN" | "UNSUPPORTED" | undefined,
): BridgeErrorCode {
  switch (kind) {
    case "TIMEOUT":
      return "HERMES_TIMEOUT";
    case "UNAVAILABLE":
    case "HTTP_ERROR":
      return "HERMES_UNAVAILABLE";
    case "MALFORMED":
      return "HERMES_PROTOCOL_ERROR";
    case "FORBIDDEN":
      return "FORBIDDEN_PROFILE";
    case "BLOCKED_COMMAND":
    case "UNSUPPORTED":
      return "METHOD_NOT_ALLOWED";
    default:
      return "HERMES_UNAVAILABLE";
  }
}

/** Builds the wire envelope for any thrown value. */
export function toErrorEnvelope(error: unknown): { status: number; envelope: BridgeErrorEnvelope } {
  const bridge =
    error instanceof BridgeError
      ? error
      : new BridgeError("INTERNAL", error instanceof Error ? error.message : "Unexpected bridge failure");
  const envelope: BridgeErrorEnvelope = {
    error: {
      code: bridge.code,
      message: bridge.message,
      retryable: bridge.retryable,
    },
  };
  if (bridge.detail) envelope.error.detail = bridge.detail;
  return { status: bridge.httpStatus, envelope };
}
