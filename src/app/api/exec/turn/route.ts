import { NextRequest, NextResponse } from "next/server";
import { getCurrentSession } from "@/lib/auth";
import {
  EXEC_BODY_MAX_BYTES,
  EXEC_CONVERSATION_CONTRACT,
  EXEC_REQUEST_ID_HEADER,
  createExecErrorBody,
  execErrorStatus,
  isExecJsonContentType,
  parseExecTurnRequest,
  type ExecTurnErrorCode,
  type ExecTurnSuccess,
} from "@/modules/exec-conversation/contracts";
import { checkExecRequestOrigin } from "@/modules/exec-conversation/http-guard";
import {
  execTurnOutcomeStatus,
  resolveExecConnector,
  runExecTurn,
} from "@/modules/exec-conversation/composition";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/exec/turn — one EXEC chat turn, exec-conversation/v1.
 *
 * ROUTE-MANAGED AUTH. The `/api/exec/turn` path is excluded from the blanket
 * `/api/**` 401 in `src/middleware.ts` (exact path only) so that this handler
 * can own the error envelope and the order below. The route is NOT public: the
 * third gate below is the session check, and no connector runs without it.
 *
 * Gate order (deliberate — see the architecture decision):
 *   1. requestId            every answer, including failures, is traceable;
 *   2. same-origin / CSRF   a foreign origin gets 403 before anything else;
 *   3. session              unauthenticated same-origin gets the same envelope;
 *   4. media type + body    bounded read, then schema validation;
 *   5. connector            explicit review-only resolution, bounded turn.
 *
 * Nothing else: no mission, no approval, no capability, no persistence, no
 * transcript, no rate-limit store, no retry, no CORS.
 */

const BASE_HEADERS = { "Cache-Control": "no-store" } as const;

function execResponse(requestId: string, status: number, body: unknown): NextResponse {
  return NextResponse.json(body, {
    status,
    headers: { ...BASE_HEADERS, [EXEC_REQUEST_ID_HEADER]: requestId },
  });
}

function execError(requestId: string, code: ExecTurnErrorCode): NextResponse {
  return execResponse(requestId, execErrorStatus(code), createExecErrorBody(code, requestId));
}

type BodyRead =
  | { kind: "text"; text: string }
  | { kind: "reject"; code: Extract<ExecTurnErrorCode, "PAYLOAD_TOO_LARGE" | "INVALID_INPUT"> };

/**
 * Reads at most EXEC_BODY_MAX_BYTES bytes that were actually SENT.
 *
 * `Content-Length` is consulted only as an early reject: it is a claim, and a
 * missing or lying header must not let a large body through.
 */
async function readBoundedBody(request: NextRequest): Promise<BodyRead> {
  const declared = request.headers.get("content-length");
  if (declared !== null) {
    const parsed = Number(declared);
    if (!Number.isFinite(parsed) || parsed < 0) return { kind: "reject", code: "INVALID_INPUT" };
    if (parsed > EXEC_BODY_MAX_BYTES) return { kind: "reject", code: "PAYLOAD_TOO_LARGE" };
  }

  const body = request.body;
  if (!body) return { kind: "reject", code: "INVALID_INPUT" };

  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > EXEC_BODY_MAX_BYTES) {
        try {
          await reader.cancel();
        } catch {
          // Cancelling a stream that already ended is not an error worth a 500.
        }
        return { kind: "reject", code: "PAYLOAD_TOO_LARGE" };
      }
      chunks.push(value);
    }
  } catch {
    return { kind: "reject", code: "INVALID_INPUT" };
  }

  if (total === 0) return { kind: "reject", code: "INVALID_INPUT" };

  try {
    const merged = Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)));
    // `fatal` so invalid UTF-8 is a 400, never a silently mangled message.
    return { kind: "text", text: new TextDecoder("utf-8", { fatal: true }).decode(merged) };
  } catch {
    return { kind: "reject", code: "INVALID_INPUT" };
  }
}

export async function POST(request: NextRequest) {
  const requestId = globalThis.crypto.randomUUID();
  const warn = (event: string) => console.warn("[exec-conversation]", event, requestId);

  // 1 → 2. Same-origin before anything that could leak whether a session exists.
  const origin = checkExecRequestOrigin(request);
  if (origin.kind === "reject") {
    warn(`origin_rejected:${origin.reason}`);
    return execError(requestId, "CSRF_REJECTED");
  }

  // 3. Session. Re-checked here even though the page and middleware also do it.
  const session = await getCurrentSession();
  if (!session) {
    warn("unauthenticated");
    return execError(requestId, "UNAUTHORIZED");
  }

  // 4. Media type, then a bounded body read, then the schema.
  if (!isExecJsonContentType(request.headers.get("content-type"))) {
    warn("unsupported_media_type");
    return execError(requestId, "UNSUPPORTED_MEDIA_TYPE");
  }

  const read = await readBoundedBody(request);
  if (read.kind === "reject") {
    warn(`body_rejected:${read.code}`);
    return execError(requestId, read.code);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(read.text);
  } catch {
    warn("json_parse_failed");
    return execError(requestId, "INVALID_INPUT");
  }

  const validation = parseExecTurnRequest(parsed);
  if (validation.kind === "invalid") {
    warn(`invalid_input:${validation.failure.code}`);
    return execError(requestId, validation.failure.code);
  }

  const { turnId, message, conversationId } = validation.value;

  // 5. Connector. Resolution fails closed; there is no demo fallback.
  const resolution = resolveExecConnector();
  if (resolution.kind === "refused") {
    warn(`connector_unavailable:${resolution.reason}`);
    return execError(requestId, "CONNECTOR_UNAVAILABLE");
  }

  const outcome = await runExecTurn({
    connector: resolution.connector,
    turn: { requestId, turnId, conversationId, message },
    // Text-free observability: a turn id and an outcome, never the message.
    onEvent: (event) => warn(event),
  });

  if (outcome.kind === "timeout") return execError(requestId, "CONNECTOR_TIMEOUT");
  if (outcome.kind === "failed") return execError(requestId, outcome.code);

  const body: ExecTurnSuccess = {
    contract: EXEC_CONVERSATION_CONTRACT,
    requestId,
    turnId,
    conversationId,
    reply: {
      text: outcome.text,
      truncated: outcome.truncated,
      durationMs: outcome.durationMs,
    },
    connector: { kind: "DUMMY", provenance: "TEST" },
  };

  return execResponse(requestId, execTurnOutcomeStatus(outcome), body);
}
