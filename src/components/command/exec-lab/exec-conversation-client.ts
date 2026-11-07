import {
  EXEC_REQUEST_ID_HEADER,
  EXEC_TURN_CLIENT_TIMEOUT_MS,
  EXEC_TURN_PATH,
  execErrorStatus,
  isExecTurnSuccess,
  parseExecTurnRequest,
  type ExecTurnErrorCode,
  type ExecTurnRequest,
  type ExecTurnSuccess,
} from "@/modules/exec-conversation/contracts";

export type ExecConversationErrorCode = ExecTurnErrorCode | "PROTOCOL_ERROR" | "NETWORK_ERROR" | "CLIENT_TIMEOUT";

export type ExecConversationResult =
  | { kind: "success"; value: ExecTurnSuccess }
  | { kind: "error"; code: ExecConversationErrorCode; requestId: string | null };

export async function postExecTurn(
  request: ExecTurnRequest,
  options: { fetchImpl?: typeof fetch; signal?: AbortSignal } = {},
): Promise<ExecConversationResult> {
  const parsed = parseExecTurnRequest(request);
  if (parsed.kind === "invalid") {
    return { kind: "error", code: parsed.failure.code, requestId: null };
  }

  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const controller = new AbortController();
  let timedOut = false;
  const abortFromCaller = () => controller.abort();
  if (options.signal?.aborted) controller.abort();
  else options.signal?.addEventListener("abort", abortFromCaller, { once: true });
  const deadline = globalThis.setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, EXEC_TURN_CLIENT_TIMEOUT_MS);
  try {
    const response = await fetchImpl(EXEC_TURN_PATH, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(parsed.value),
      cache: "no-store",
      credentials: "same-origin",
      signal: controller.signal,
    });

    const headerRequestId = response.headers.get(EXEC_REQUEST_ID_HEADER);
    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      if (timedOut) return { kind: "error", code: "CLIENT_TIMEOUT", requestId: headerRequestId };
      if (options.signal?.aborted) return { kind: "error", code: "NETWORK_ERROR", requestId: headerRequestId };
      return { kind: "error", code: "PROTOCOL_ERROR", requestId: headerRequestId };
    }

    const bodyRequestId =
      payload !== null && typeof payload === "object" && typeof (payload as { requestId?: unknown }).requestId === "string"
        ? (payload as { requestId: string }).requestId
        : null;
    // The header and the body must agree: one of them is what the server logged.
    if (headerRequestId !== null && bodyRequestId !== null && headerRequestId !== bodyRequestId) {
      return { kind: "error", code: "PROTOCOL_ERROR", requestId: headerRequestId };
    }
    const requestId = headerRequestId ?? bodyRequestId;

    if (response.ok) {
      if (
        !isExecTurnSuccess(payload) ||
        payload.turnId !== parsed.value.turnId ||
        payload.conversationId !== parsed.value.conversationId
      ) {
        return { kind: "error", code: "PROTOCOL_ERROR", requestId };
      }
      return { kind: "success", value: payload };
    }

    const candidate =
      payload !== null && typeof payload === "object" ? (payload as { error?: unknown }).error : undefined;
    if (typeof candidate === "string") {
      const code = candidate as ExecTurnErrorCode;
      // The envelope is part of the contract: a safe message and details:null.
      // A body that leaks details is a protocol violation, not a mapped error.
      const envelope = payload as { message?: unknown; details?: unknown };
      const wellFormed =
        typeof envelope.message === "string" && envelope.message.length > 0 && envelope.details === null;
      if (wellFormed && execErrorStatus(code) === response.status) return { kind: "error", code, requestId };
    }
    return { kind: "error", code: "PROTOCOL_ERROR", requestId };
  } catch {
    return { kind: "error", code: timedOut ? "CLIENT_TIMEOUT" : "NETWORK_ERROR", requestId: null };
  } finally {
    globalThis.clearTimeout(deadline);
    options.signal?.removeEventListener("abort", abortFromCaller);
  }
}
