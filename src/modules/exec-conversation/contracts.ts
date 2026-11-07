/**
 * exec-conversation/v1 — the single contract for one EXEC chat turn.
 *
 * PROPOSED. This module is the only source of truth for the wire shape,
 * limits and error envelope of `POST /api/exec/turn`. It is deliberately
 * ISOMORPHIC: no `next/server`, no `@/lib/auth`, no Prisma, so the NEXUP AGENT
 * client imports both the types and the validators from here instead of
 * copying them.
 *
 * Scope of v1:
 *   - ONE user message in, ONE text reply out. No streaming, no history.
 *   - `conversationId` is an opaque correlation echo. The server never stores
 *     it, never validates it against anything and never replays a transcript.
 *   - `turnId` correlates request/response and is NOT an idempotency key:
 *     replaying a turnId produces a second reply. Re-sending is a user action.
 *
 * Nothing here performs I/O or reads the environment.
 */

export const EXEC_CONVERSATION_CONTRACT = "exec-conversation/v1" as const;

/** The only route that speaks this contract. */
export const EXEC_TURN_PATH = "/api/exec/turn" as const;

/** Echoed on every response (and inside the body) so a failure is traceable. */
export const EXEC_REQUEST_ID_HEADER = "X-Nexup-Request-Id" as const;

/** Server-side binding: the turn is answered or abandoned within this window. */
export const EXEC_TURN_TIMEOUT_MS = 20_000;

/** Client-side patience. Deliberately larger than the server binding. */
export const EXEC_TURN_CLIENT_TIMEOUT_MS = 25_000;

/** Hard cap on the request body, enforced by counting bytes actually read. */
export const EXEC_BODY_MAX_BYTES = 16_384;

/** Message limits. Both apply; the smaller one wins. */
export const EXEC_MESSAGE_MAX_CODE_POINTS = 4_000;
export const EXEC_MESSAGE_MAX_BYTES = 8_192;

/** Cap on the reply text, applied on a code-point boundary. */
export const EXEC_REPLY_MAX_BYTES = 8_192;

/** Max length of `turnId` / `conversationId`. */
export const EXEC_ID_MAX_LENGTH = 128;

const EXEC_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;

export type ExecTurnRequest = {
  turnId: string;
  message: string;
  conversationId?: string | null;
};

export type ExecTurnReply = {
  text: string;
  truncated: boolean;
  durationMs: number;
};

export type ExecTurnSuccess = {
  contract: typeof EXEC_CONVERSATION_CONTRACT;
  requestId: string;
  turnId: string;
  conversationId: string | null;
  reply: ExecTurnReply;
  connector: { kind: "DUMMY"; provenance: "TEST" };
};

export type ExecTurnErrorCode =
  | "INVALID_INPUT"
  | "UNAUTHORIZED"
  | "CSRF_REJECTED"
  | "MESSAGE_TOO_LARGE"
  | "PAYLOAD_TOO_LARGE"
  | "UNSUPPORTED_MEDIA_TYPE"
  | "CONNECTOR_UNAVAILABLE"
  | "CONNECTOR_TIMEOUT"
  | "INTERNAL";

export type ExecTurnError = {
  error: ExecTurnErrorCode;
  message: string;
  requestId: string;
  details: null;
};

/** One status per code — the only place that mapping is allowed to live. */
const EXEC_ERROR_STATUS: Record<ExecTurnErrorCode, number> = {
  INVALID_INPUT: 400,
  UNAUTHORIZED: 401,
  CSRF_REJECTED: 403,
  MESSAGE_TOO_LARGE: 413,
  PAYLOAD_TOO_LARGE: 413,
  UNSUPPORTED_MEDIA_TYPE: 415,
  CONNECTOR_UNAVAILABLE: 503,
  CONNECTOR_TIMEOUT: 504,
  INTERNAL: 500,
};

/**
 * Safe, user-facing text. Never carries engine detail, stack, provider name or
 * echoed input, so it is safe to render and safe to show in a review.
 */
const EXEC_ERROR_MESSAGE: Record<ExecTurnErrorCode, string> = {
  INVALID_INPUT: "تعذّر قراءة الطلب.",
  UNAUTHORIZED: "الجلسة غير صالحة. أعد تسجيل الدخول.",
  CSRF_REJECTED: "رُفض الطلب لأنه لم يأتِ من أصل التطبيق.",
  MESSAGE_TOO_LARGE: "الرسالة تتجاوز الحد المسموح.",
  PAYLOAD_TOO_LARGE: "حجم الطلب يتجاوز الحد المسموح.",
  UNSUPPORTED_MEDIA_TYPE: "نوع المحتوى غير مدعوم.",
  CONNECTOR_UNAVAILABLE: "الموصل غير متاح في هذه البيئة.",
  CONNECTOR_TIMEOUT: "انتهت مهلة الرد. لم يُنفَّذ شيء.",
  INTERNAL: "خطأ داخلي. لم يُنفَّذ شيء.",
};

export function execErrorStatus(code: ExecTurnErrorCode): number {
  return EXEC_ERROR_STATUS[code];
}

export function createExecErrorBody(code: ExecTurnErrorCode, requestId: string): ExecTurnError {
  return { error: code, message: EXEC_ERROR_MESSAGE[code], requestId, details: null };
}

function isValidExecId(value: unknown): value is string {
  return typeof value === "string" && EXEC_ID_PATTERN.test(value);
}

/** Unicode code points, not UTF-16 units — an emoji counts as one. */
export function countCodePoints(text: string): number {
  return [...text].length;
}

export function utf8Bytes(text: string): number {
  return new TextEncoder().encode(text).length;
}

export type ExecTurnValidationFailure = {
  code: Extract<ExecTurnErrorCode, "INVALID_INPUT" | "MESSAGE_TOO_LARGE">;
  message: string;
};

/**
 * String discriminant on purpose: this project compiles with `strict: false`,
 * where a boolean-literal union does not narrow (same reason `GuardResult` in
 * `adapters/api-guard.ts` uses `kind`).
 */
export type ExecTurnValidation =
  | { kind: "valid"; value: { turnId: string; message: string; conversationId: string | null } }
  | { kind: "invalid"; failure: ExecTurnValidationFailure };

/**
 * Validates an already-parsed JSON body. Unknown fields are ignored on
 * purpose: v1 has no forward-compatibility promises, and ignoring is safer
 * than rejecting a client that adds a field we did not ask for.
 */
export function parseExecTurnRequest(input: unknown): ExecTurnValidation {
  if (input === null || typeof input !== "object" || Array.isArray(input)) {
    return { kind: "invalid", failure: { code: "INVALID_INPUT", message: "جسم الطلب يجب أن يكون كائن JSON." } };
  }

  const body = input as Record<string, unknown>;

  if (!isValidExecId(body.turnId)) {
    return { kind: "invalid", failure: { code: "INVALID_INPUT", message: "turnId غير صالح." } };
  }

  if (typeof body.message !== "string") {
    return { kind: "invalid", failure: { code: "INVALID_INPUT", message: "message مطلوب كنص." } };
  }

  const message = body.message.trim();
  if (message.length === 0) {
    return { kind: "invalid", failure: { code: "INVALID_INPUT", message: "message فارغة." } };
  }

  if (countCodePoints(message) > EXEC_MESSAGE_MAX_CODE_POINTS || utf8Bytes(message) > EXEC_MESSAGE_MAX_BYTES) {
    return { kind: "invalid", failure: { code: "MESSAGE_TOO_LARGE", message: "الرسالة تتجاوز الحد المسموح." } };
  }

  let conversationId: string | null = null;
  if (body.conversationId !== undefined && body.conversationId !== null) {
    if (!isValidExecId(body.conversationId)) {
      return { kind: "invalid", failure: { code: "INVALID_INPUT", message: "conversationId غير صالح." } };
    }
    conversationId = body.conversationId;
  }

  return { kind: "valid", value: { turnId: body.turnId, message, conversationId } };
}

/**
 * Truncates on a code-point boundary so a multi-byte character is never split.
 * `truncated` is reported instead of silently shortening the reply.
 */
export function limitExecReplyText(raw: string): { text: string; truncated: boolean } {
  if (utf8Bytes(raw) <= EXEC_REPLY_MAX_BYTES) return { text: raw, truncated: false };

  let text = "";
  let bytes = 0;
  for (const char of raw) {
    const size = utf8Bytes(char);
    if (bytes + size > EXEC_REPLY_MAX_BYTES) break;
    text += char;
    bytes += size;
  }
  return { text, truncated: true };
}

export function isExecJsonContentType(value: string | null): boolean {
  if (!value) return false;
  const [mediaType] = value.split(";");
  return mediaType.trim().toLowerCase() === "application/json";
}

/**
 * Client-side acceptance check. A reply is only rendered when it belongs to the
 * turn that is still in flight — the caller compares `turnId` itself.
 */
export function isExecTurnSuccess(payload: unknown): payload is ExecTurnSuccess {
  if (payload === null || typeof payload !== "object") return false;
  const body = payload as Record<string, unknown>;
  if (body.contract !== EXEC_CONVERSATION_CONTRACT) return false;
  if (typeof body.requestId !== "string" || body.requestId.length === 0) return false;
  if (typeof body.turnId !== "string") return false;
  if (body.conversationId !== null && typeof body.conversationId !== "string") return false;

  const reply = body.reply;
  if (reply === null || typeof reply !== "object") return false;
  const { text, truncated, durationMs } = reply as Record<string, unknown>;
  if (typeof text !== "string" || text.length === 0) return false;
  if (typeof truncated !== "boolean") return false;
  if (typeof durationMs !== "number" || !Number.isFinite(durationMs)) return false;

  const connector = body.connector;
  if (connector === null || typeof connector !== "object") return false;
  const { kind, provenance } = connector as Record<string, unknown>;
  if (kind !== "DUMMY" || provenance !== "TEST") return false;

  return true;
}
