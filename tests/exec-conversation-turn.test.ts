import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * exec-conversation/v1 — contract, CSRF matrix, route gates, middleware scope.
 *
 * Focused on purpose: no database, no server, no provider. The session source is
 * the only mocked thing (same convention as tests/capital-auth.test.ts); the
 * route handler, the guard, the composition and the contract are all real.
 */

const authState = vi.hoisted(() => ({ current: null as unknown }));

vi.mock("@/lib/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth")>();
  return { ...actual, getCurrentSession: async () => authState.current };
});

import { POST } from "@/app/api/exec/turn/route";
import middleware from "@/middleware";
import { createSessionToken, SESSION_COOKIE, verifySessionToken } from "@/lib/auth";
import {
  EXEC_BODY_MAX_BYTES,
  EXEC_CONVERSATION_CONTRACT,
  EXEC_MESSAGE_MAX_CODE_POINTS,
  EXEC_REQUEST_ID_HEADER,
  EXEC_TURN_TIMEOUT_MS,
  countCodePoints,
  execErrorStatus,
  isExecTurnSuccess,
  limitExecReplyText,
  parseExecTurnRequest,
  utf8Bytes,
} from "@/modules/exec-conversation/contracts";
import { checkExecRequestOrigin } from "@/modules/exec-conversation/http-guard";
import { execTurnOutcomeStatus, resolveExecConnector, runExecTurn } from "@/modules/exec-conversation/composition";
import { createDummyConnector } from "@/modules/exec-conversation/dummy-connector";

const TRUSTED = "http://localhost:3100";
const TURN_URL = `${TRUSTED}/api/exec/turn`;

process.env.AUTH_SECRET ||= "exec-review-test-secret-value-at-least-32-chars";

const REVIEW_SESSION = {
  userId: "review-exec-user",
  name: "EXEC Review",
  role: "EMPLOYEE",
  businessId: "review",
  canAccessNexup: false,
  canAccessRebound: false,
  canAccessAbomazen: false,
  canAccessOfficeFinanceFull: false,
};

const ENV_KEYS = [
  "EXEC_TRUSTED_ORIGIN",
  "EXEC_CONNECTOR",
  "EXEC_CONNECTOR_ALLOW_TEST",
  "EXEC_DUMMY_DELAY_MS",
] as const;

let savedEnv: Record<string, string | undefined> = {};

beforeEach(() => {
  savedEnv = {};
  for (const key of ENV_KEYS) savedEnv[key] = process.env[key];
  process.env.EXEC_TRUSTED_ORIGIN = TRUSTED;
  process.env.EXEC_CONNECTOR = "dummy";
  process.env.EXEC_CONNECTOR_ALLOW_TEST = "1";
  delete process.env.EXEC_DUMMY_DELAY_MS;
  authState.current = null;
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (savedEnv[key] === undefined) delete process.env[key];
    else process.env[key] = savedEnv[key];
  }
});

function makeRequest(
  body: string | undefined,
  headers: Record<string, string> = {},
): NextRequest {
  return new NextRequest(TURN_URL, {
    method: "POST",
    headers: { "content-type": "application/json", origin: TRUSTED, ...headers },
    ...(body !== undefined ? { body } : {}),
  });
}

function jsonBody(value: unknown): string {
  return JSON.stringify(value);
}

async function post(
  body: string | undefined,
  headers: Record<string, string> = {},
): Promise<{ status: number; body: Record<string, unknown>; headers: Headers }> {
  const response = await POST(makeRequest(body, headers));
  const parsed = (await response.json()) as Record<string, unknown>;
  return { status: response.status, body: parsed, headers: response.headers };
}

describe("contract — validation and limits", () => {
  it("rejects a non-object body", () => {
    for (const input of [null, "x", 42, []]) {
      const result = parseExecTurnRequest(input);
      expect(result.kind).toBe("invalid");
    }
  });

  it("rejects an invalid turnId and accepts the documented id alphabet", () => {
    expect(parseExecTurnRequest({ turnId: "turn id", message: "x" }).kind).toBe("invalid");
    expect(parseExecTurnRequest({ turnId: "a".repeat(129), message: "x" }).kind).toBe("invalid");
    expect(parseExecTurnRequest({ turnId: "turn_1-A", message: "x" }).kind).toBe("valid");
  });

  it("trims the message and rejects an empty one", () => {
    const valid = parseExecTurnRequest({ turnId: "t1", message: "  مرحبا  " });
    expect(valid.kind === "valid" && valid.value.message).toBe("مرحبا");
    expect(parseExecTurnRequest({ turnId: "t1", message: "   " }).kind).toBe("invalid");
  });

  it("counts code points, not UTF-16 units, for the code-point ceiling", () => {
    const emojiAtLimit = "🙂".repeat(EXEC_MESSAGE_MAX_CODE_POINTS);
    expect(countCodePoints(emojiAtLimit)).toBe(4000);
    // Rejected by the BYTE ceiling, not the code-point one.
    const result = parseExecTurnRequest({ turnId: "t1", message: emojiAtLimit });
    expect(result.kind).toBe("invalid");
    expect(result.kind === "invalid" && result.failure.code).toBe("MESSAGE_TOO_LARGE");
  });

  it("accepts the largest message that fits both ceilings", () => {
    const arabic = "م".repeat(4000); // 4000 code points, 8000 bytes
    expect(utf8Bytes(arabic)).toBeLessThanOrEqual(8192);
    const result = parseExecTurnRequest({ turnId: "t1", message: arabic });
    expect(result.kind).toBe("valid");
  });

  it("rejects over-long code points and over-long bytes with the same code", () => {
    const tooManyCodePoints = parseExecTurnRequest({ turnId: "t1", message: "م".repeat(4001) });
    expect(tooManyCodePoints.kind === "invalid" && tooManyCodePoints.failure.code).toBe("MESSAGE_TOO_LARGE");

    const tooManyBytes = parseExecTurnRequest({ turnId: "t1", message: "🙂".repeat(2100) });
    expect(tooManyBytes.kind === "invalid" && tooManyBytes.failure.code).toBe("MESSAGE_TOO_LARGE");
  });

  it("treats conversationId as an optional opaque echo", () => {
    expect(parseExecTurnRequest({ turnId: "t1", message: "x" })).toEqual({
      kind: "valid",
      value: { turnId: "t1", message: "x", conversationId: null },
    });
    const echoed = parseExecTurnRequest({ turnId: "t1", message: "x", conversationId: "c-1" });
    expect(echoed.kind === "valid" && echoed.value.conversationId).toBe("c-1");
    expect(parseExecTurnRequest({ turnId: "t1", message: "x", conversationId: "bad id" }).kind).toBe("invalid");
  });

  it("truncates replies on a code-point boundary, never mid-character", () => {
    const raw = "🙂".repeat(3000);
    const limited = limitExecReplyText(raw);
    expect(limited.truncated).toBe(true);
    expect(utf8Bytes(limited.text)).toBeLessThanOrEqual(8192);
    expect(limited.text.includes("\uFFFD")).toBe(false);
    expect(countCodePoints(limited.text)).toBe(2048);
  });

  it("keeps the wire statuses of the decision", () => {
    expect(execErrorStatus("INVALID_INPUT")).toBe(400);
    expect(execErrorStatus("UNAUTHORIZED")).toBe(401);
    expect(execErrorStatus("CSRF_REJECTED")).toBe(403);
    expect(execErrorStatus("MESSAGE_TOO_LARGE")).toBe(413);
    expect(execErrorStatus("PAYLOAD_TOO_LARGE")).toBe(413);
    expect(execErrorStatus("UNSUPPORTED_MEDIA_TYPE")).toBe(415);
    expect(execErrorStatus("CONNECTOR_UNAVAILABLE")).toBe(503);
    expect(execErrorStatus("CONNECTOR_TIMEOUT")).toBe(504);
    expect(execErrorStatus("INTERNAL")).toBe(500);
    expect(execErrorStatus).toBeDefined();
    expect(EXEC_TURN_TIMEOUT_MS).toBe(20_000);
    expect(EXEC_BODY_MAX_BYTES).toBe(16_384);
    expect(execTurnOutcomeStatus({ kind: "timeout" })).toBe(504);
    expect(execTurnOutcomeStatus({ kind: "failed", code: "CONNECTOR_UNAVAILABLE" })).toBe(503);
  });

  it("accepts only a well-formed success payload on the client side", () => {
    const good = {
      contract: EXEC_CONVERSATION_CONTRACT,
      requestId: "r1",
      turnId: "t1",
      conversationId: null,
      reply: { text: "x", truncated: false, durationMs: 1 },
      connector: { kind: "DUMMY", provenance: "TEST" },
    };
    expect(isExecTurnSuccess(good)).toBe(true);
    expect(isExecTurnSuccess({ ...good, contract: "exec-conversation/v2" })).toBe(false);
    expect(isExecTurnSuccess({ ...good, reply: { text: "", truncated: false, durationMs: 1 } })).toBe(false);
    expect(isExecTurnSuccess({ ...good, connector: { kind: "HERMES", provenance: "LIVE" } })).toBe(false);
  });
});

describe("origin guard — explicit trusted origin, fail closed", () => {
  const env = (trusted: string | undefined) =>
    ({ EXEC_TRUSTED_ORIGIN: trusted }) as unknown as NodeJS.ProcessEnv;

  const req = (headers: Record<string, string>, url = TURN_URL) =>
    new NextRequest(url, { method: "POST", headers });

  it("refuses when the trusted origin is unset, malformed, or not an origin", () => {
    const request = req({ origin: TRUSTED });
    expect(checkExecRequestOrigin(request, env(undefined)).kind).toBe("reject");
    expect(checkExecRequestOrigin(request, env("")).kind).toBe("reject");
    expect(checkExecRequestOrigin(request, env("127.0.0.1:3100")).kind).toBe("reject");
    expect(checkExecRequestOrigin(request, env("http://127.0.0.1:3100/path")).kind).toBe("reject");
    expect(checkExecRequestOrigin(request, env("http://127.0.0.1:3100?x=1")).kind).toBe("reject");
    expect(checkExecRequestOrigin(request, env("ftp://127.0.0.1:3100")).kind).toBe("reject");
  });

  it("never derives the expectation from the request", () => {
    // No configured origin: a matching Origin header must not be enough.
    const request = req({ origin: TRUSTED, "sec-fetch-site": "same-origin" });
    expect(checkExecRequestOrigin(request, env(undefined)).kind).toBe("reject");
  });

  it("accepts an exact Origin, with or without a same-origin Sec-Fetch-Site", () => {
    expect(checkExecRequestOrigin(req({ origin: TRUSTED }), env(TRUSTED)).kind).toBe("allow");
    expect(checkExecRequestOrigin(req({ origin: TRUSTED, "sec-fetch-site": "same-origin" }), env(TRUSTED)).kind).toBe("allow");
  });

  it("refuses a foreign, opaque, empty or multiple Origin regardless of Sec-Fetch-Site", () => {
    const cases: Record<string, string>[] = [
      { origin: "http://evil.example", "sec-fetch-site": "same-origin" },
      { origin: "null", "sec-fetch-site": "same-origin" },
      { origin: "", "sec-fetch-site": "same-origin" },
      { origin: `${TRUSTED}, http://evil.example`, "sec-fetch-site": "same-origin" },
      { origin: `${TRUSTED}/`, "sec-fetch-site": "same-origin" },
      { origin: "http://127.0.0.1:3101", "sec-fetch-site": "same-origin" },
    ];
    for (const headers of cases) {
      expect(checkExecRequestOrigin(req(headers), env(TRUSTED)).kind).toBe("reject");
    }
  });

  it("refuses an exact Origin when the browser says the request is cross-site", () => {
    for (const site of ["cross-site", "same-site", "none"]) {
      expect(checkExecRequestOrigin(req({ origin: TRUSTED, "sec-fetch-site": site }), env(TRUSTED)).kind).toBe("reject");
    }
  });

  it("requires both a same-origin Sec-Fetch-Site and a matching request origin when Origin is absent", () => {
    expect(checkExecRequestOrigin(req({}), env(TRUSTED)).kind).toBe("reject");
    expect(checkExecRequestOrigin(req({ "sec-fetch-site": "cross-site" }), env(TRUSTED)).kind).toBe("reject");
    expect(checkExecRequestOrigin(req({ "sec-fetch-site": "same-origin" }), env(TRUSTED)).kind).toBe("allow");
    // Sec-Fetch-Site claims same-origin but the request addressed elsewhere.
    expect(
      checkExecRequestOrigin(
        req({ "sec-fetch-site": "same-origin" }, "http://localhost:3999/api/exec/turn"),
        env(TRUSTED),
      ).kind,
    ).toBe("reject");
  });

  it("documents the loopback spelling Next owns, and still refuses a different port", () => {
    // Next's NextURL rewrites 127.0.0.1 to localhost, so the two loopback
    // spellings of the SAME port are one origin to Next. Another port is not.
    // The browser path is unaffected: a real fetch POST always carries Origin.
    expect(
      checkExecRequestOrigin(
        req({ "sec-fetch-site": "same-origin" }, "http://127.0.0.1:3100/api/exec/turn"),
        env(TRUSTED),
      ).kind,
    ).toBe("allow");
    expect(
      checkExecRequestOrigin(
        req({ "sec-fetch-site": "same-origin" }, "http://127.0.0.1:3101/api/exec/turn"),
        env(TRUSTED),
      ).kind,
    ).toBe("reject");
  });
});

describe("route — gate order and envelope", () => {
  it("refuses a foreign origin with 403 before saying anything about the session", async () => {
    const result = await post(jsonBody({ turnId: "t1", message: "x" }), { origin: "http://evil.example" });
    expect(result.status).toBe(403);
    expect(result.body.error).toBe("CSRF_REJECTED");
    expect(result.body.details).toBeNull();
    expect(typeof result.body.requestId).toBe("string");
    expect(result.headers.get(EXEC_REQUEST_ID_HEADER)).toBe(result.body.requestId);
  });

  it("answers an unauthenticated same-origin request with the v1 envelope, not the legacy one", async () => {
    const result = await post(jsonBody({ turnId: "t1", message: "x" }));
    expect(result.status).toBe(401);
    expect(result.body.error).toBe("UNAUTHORIZED");
    expect(result.body).not.toEqual({ error: "Unauthorized" });
    expect(result.body.requestId).toBe(result.headers.get(EXEC_REQUEST_ID_HEADER));
    expect(result.headers.get("cache-control")).toBe("no-store");
  });

  it("refuses a non-JSON media type", async () => {
    authState.current = REVIEW_SESSION;
    const result = await post(jsonBody({ turnId: "t1", message: "x" }), { "content-type": "text/plain" });
    expect(result.status).toBe(415);
    expect(result.body.error).toBe("UNSUPPORTED_MEDIA_TYPE");
  });

  it("refuses malformed JSON, a bad turnId and an empty message", async () => {
    authState.current = REVIEW_SESSION;
    expect((await post("{not json")).body.error).toBe("INVALID_INPUT");
    expect((await post(jsonBody({ turnId: "bad id", message: "x" }))).body.error).toBe("INVALID_INPUT");
    expect((await post(jsonBody({ turnId: "t1", message: "   " }))).body.error).toBe("INVALID_INPUT");
  });

  it("refuses a message over the code-point ceiling", async () => {
    authState.current = REVIEW_SESSION;
    const result = await post(jsonBody({ turnId: "t1", message: "م".repeat(4001) }));
    expect(result.status).toBe(413);
    expect(result.body.error).toBe("MESSAGE_TOO_LARGE");
  });

  it("refuses an oversized body that was actually sent, with no Content-Length at all", async () => {
    authState.current = REVIEW_SESSION;
    const request = makeRequest("a".repeat(20_000));
    expect(request.headers.get("content-length")).toBeNull();

    const response = await POST(request);
    expect(response.status).toBe(413);
    expect(((await response.json()) as Record<string, unknown>).error).toBe("PAYLOAD_TOO_LARGE");
  });

  it("refuses an oversized body even when Content-Length lies", async () => {
    authState.current = REVIEW_SESSION;
    const response = await POST(makeRequest("a".repeat(20_000), { "content-length": "100" }));
    expect(response.status).toBe(413);
    expect(((await response.json()) as Record<string, unknown>).error).toBe("PAYLOAD_TOO_LARGE");
  });

  it("refuses with 503 when the connector was not explicitly enabled", async () => {
    authState.current = REVIEW_SESSION;
    delete process.env.EXEC_CONNECTOR;
    const result = await post(jsonBody({ turnId: "t1", message: "مرحبا" }));
    expect(result.status).toBe(503);
    expect(result.body.error).toBe("CONNECTOR_UNAVAILABLE");
  });

  it("refuses with 503 when only one of the two opt-ins is present", async () => {
    authState.current = REVIEW_SESSION;
    delete process.env.EXEC_CONNECTOR_ALLOW_TEST;
    expect((await post(jsonBody({ turnId: "t1", message: "x" }))).status).toBe(503);

    process.env.EXEC_CONNECTOR_ALLOW_TEST = "1";
    process.env.EXEC_CONNECTOR = "hermes";
    expect((await post(jsonBody({ turnId: "t1", message: "x" }))).status).toBe(503);
  });

  it("never enables the dummy connector in production", () => {
    const resolution = resolveExecConnector({
      NODE_ENV: "production",
      EXEC_CONNECTOR: "dummy",
      EXEC_CONNECTOR_ALLOW_TEST: "1",
    } as unknown as NodeJS.ProcessEnv);
    expect(resolution).toEqual({ kind: "refused", reason: "production" });
  });

  it("answers one turn through the dummy connector, echoing the correlation ids", async () => {
    authState.current = REVIEW_SESSION;
    const result = await post(jsonBody({ turnId: "turn-1", message: "مرحبا", conversationId: "conv-1" }));

    expect(result.status).toBe(200);
    expect(result.body.contract).toBe(EXEC_CONVERSATION_CONTRACT);
    expect(result.body.turnId).toBe("turn-1");
    expect(result.body.conversationId).toBe("conv-1");
    expect(result.body.requestId).toBe(result.headers.get(EXEC_REQUEST_ID_HEADER));
    expect(result.headers.get("cache-control")).toBe("no-store");
    expect(result.body.connector).toEqual({ kind: "DUMMY", provenance: "TEST" });
    expect(isExecTurnSuccess(result.body)).toBe(true);
    const reply = result.body.reply as Record<string, unknown>;
    expect(String(reply.text)).toContain("لا يوجد اتصال بنموذج حقيقي");
    expect(reply.truncated).toBe(false);
  });

  it("returns conversationId null when the client omits it", async () => {
    authState.current = REVIEW_SESSION;
    const result = await post(jsonBody({ turnId: "turn-2", message: "x" }));
    expect(result.body.conversationId).toBeNull();
  });

  it("is not idempotent: the same turnId twice yields two replies with two request ids", async () => {
    authState.current = REVIEW_SESSION;
    const first = await post(jsonBody({ turnId: "dup", message: "x" }));
    const second = await post(jsonBody({ turnId: "dup", message: "x" }));
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(first.body.requestId).not.toBe(second.body.requestId);
  });
});

describe("composition — the deadline is a binding, not a hint", () => {
  it("abandons a cooperative connector at the deadline and reports a timeout", async () => {
    const connector = createDummyConnector({ delayMs: 500 });
    const outcome = await runExecTurn({
      connector,
      turn: { requestId: "r1", turnId: "t1", conversationId: null, message: "x" },
      timeoutMs: 25,
    });
    expect(outcome).toEqual({ kind: "timeout" });
  });

  it("abandons a connector that ignores its AbortSignal and discards the late reply", async () => {
    const events: string[] = [];
    let calls = 0;
    const hostile = {
      kind: "DUMMY" as const,
      provenance: "TEST" as const,
      async send() {
        calls += 1;
        // Deliberately ignores the signal.
        await new Promise((resolve) => setTimeout(resolve, 150));
        return { text: "رد متأخر", durationMs: 150 };
      },
    };

    const outcome = await runExecTurn({
      connector: hostile,
      turn: { requestId: "r1", turnId: "t1", conversationId: null, message: "x" },
      timeoutMs: 20,
      onEvent: (event) => events.push(event),
    });

    expect(outcome).toEqual({ kind: "timeout" });
    expect(calls).toBe(1);

    // Let the late fulfillment land: it must be consumed, not surfaced.
    await new Promise((resolve) => setTimeout(resolve, 220));
    expect(calls).toBe(1);
    expect(events).toContain("exec-conversation.timeout");
    expect(events).toContain("exec-conversation.late_reply_discarded");
  });

  it("maps a connector failure to a safe code, and a connector refusal to 503", async () => {
    const failing = {
      kind: "DUMMY" as const,
      provenance: "TEST" as const,
      async send() {
        throw new Error("boom: secret-provider-detail");
      },
    };
    const outcome = await runExecTurn({
      connector: failing,
      turn: { requestId: "r1", turnId: "t1", conversationId: null, message: "x" },
    });
    expect(outcome).toEqual({ kind: "failed", code: "INTERNAL" });
    expect(JSON.stringify(outcome)).not.toContain("secret-provider-detail");
  });

  it("never returns an empty reply text", async () => {
    const empty = {
      kind: "DUMMY" as const,
      provenance: "TEST" as const,
      async send() {
        return { text: "   ", durationMs: 1 };
      },
    };
    const outcome = await runExecTurn({
      connector: empty,
      turn: { requestId: "r1", turnId: "t1", conversationId: null, message: "x" },
    });
    expect(outcome.kind).toBe("reply");
    expect((outcome as { text: string }).text.length).toBeGreaterThan(0);
  });
});

describe("middleware — one exact route-managed path, everything else unchanged", () => {
  async function sessionCookie(): Promise<string> {
    const token = await createSessionToken(REVIEW_SESSION as Parameters<typeof createSessionToken>[0]);
    return `${SESSION_COOKIE}=${token}`;
  }

  it("passes /api/exec/turn through to the handler so the handler owns the envelope", async () => {
    const response = await middleware(new NextRequest(TURN_URL, { method: "POST", headers: {} }));
    expect(response.headers.get("x-middleware-next")).toBe("1");
    expect(response.status).toBe(200);
  });

  it("keeps the legacy 401 for every other API path", async () => {
    for (const url of [`${TRUSTED}/api/ai-workforce/runs`, `${TRUSTED}/api/office/partners`]) {
      const response = await middleware(new NextRequest(url, { headers: {} }));
      expect(response.status).toBe(401);
      expect(await response.json()).toEqual({ error: "Unauthorized" });
    }
  });

  it("does not widen the exception to a prefix", async () => {
    const response = await middleware(new NextRequest(`${TURN_URL}/extra`, { headers: {} }));
    expect(response.status).toBe(401);
  });

  it("still redirects an unauthenticated page to /login", async () => {
    const response = await middleware(new NextRequest(`${TRUSTED}/command/exec`, { headers: {} }));
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toContain("/login");
  });

  it("lets the review session reach the EXEC page and the turn route", async () => {
    const cookie = await sessionCookie();
    expect((await verifySessionToken(cookie.split("=")[1]))?.userId).toBe("review-exec-user");

    const page = await middleware(new NextRequest(`${TRUSTED}/command/exec`, { headers: { cookie } }));
    expect(page.headers.get("x-middleware-next")).toBe("1");

    const turn = await middleware(new NextRequest(TURN_URL, { method: "POST", headers: { cookie } }));
    expect(turn.headers.get("x-middleware-next")).toBe("1");
  });
});

/** The header name comes from the contract, never a second literal. */
