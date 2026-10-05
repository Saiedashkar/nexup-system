import { describe, expect, it } from "vitest";

import {
  createHermesRuntimeFromEnv,
  createHermesTransport,
  HermesBridgeClient,
  HermesBridgeTransport,
  resolveHermesConfig,
  type HermesTransportRequest,
} from "@/modules/workforce";
import { verifySignature } from "@/modules/workforce/bridge/signing";

const KEY_ID = "nexup-vercel";
const SECRET = "0123456789abcdef0123456789abcdef";

/* ── fetch double speaking the bridge's wire contract ── */

type CapturedCall = { method: string; path: string; headers: Record<string, string>; body?: string };

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function sseResponse(chunks: string[]): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
  return new Response(stream, { status: 200, headers: { "content-type": "text/event-stream" } });
}

function makeFetch(options: { streamChunks?: string[]; completeText?: string; errorCode?: string; health?: string } = {}) {
  const calls: CapturedCall[] = [];
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url);
    const method = (init?.method ?? "GET").toUpperCase();
    calls.push({
      method,
      path: url.pathname,
      headers: (init?.headers ?? {}) as Record<string, string>,
      ...(typeof init?.body === "string" ? { body: init.body } : {}),
    });

    if (url.pathname === "/v1/runs" && method === "POST") {
      return jsonResponse(201, { runId: "run_1", streamUrl: "/v1/runs/run_1/stream", status: "RUNNING" });
    }
    if (url.pathname === "/v1/runs/run_1/stream") {
      return sseResponse(
        options.streamChunks ?? [
          'event: delta\ndata: {"text":"Hello "}\n\n',
          'event: delta\ndata: {"text":"world"}\n\n',
          `event: complete\ndata: ${JSON.stringify({ status: "succeeded", text: options.completeText ?? "Hello world" })}\n\n`,
        ],
      );
    }
    if (url.pathname === "/v1/health") {
      return jsonResponse(200, { bridge: "ok", hermes: options.health ?? "healthy", detail: "gateway.ready", profile: "saieed" });
    }
    if (url.pathname === "/v1/runs/run_1/cancel") return jsonResponse(200, { runId: "run_1", status: "CANCELLED" });
    if (url.pathname === "/v1/runs/run_1") {
      return jsonResponse(200, {
        runId: "run_1",
        status: "COMPLETED",
        executionId: "sess_1",
        startedAt: "2026-01-01T00:00:00.000Z",
        endedAt: "2026-01-01T00:00:01.000Z",
        bytesOut: 11,
        errorCode: null,
      });
    }
    return jsonResponse(404, { error: { code: "RUN_NOT_FOUND", message: "no such run", retryable: false } });
  }) as typeof fetch;
  return { fetchImpl, calls };
}

function makeTransport(fetchImpl: typeof fetch, secrets: readonly string[] = [SECRET]) {
  const client = new HermesBridgeClient({
    baseUrl: "https://bridge.example",
    keyId: KEY_ID,
    secret: SECRET,
    fetchImpl,
  });
  return new HermesBridgeTransport({ client, profile: "saieed", secrets });
}

function request(overrides: Partial<HermesTransportRequest> = {}): HermesTransportRequest {
  return {
    operation: "submit",
    profile: "saieed",
    payload: { instruction: "summarize", contextJson: "{}" },
    timeoutMs: 5_000,
    maxOutputBytes: 8_192,
    correlation: { actorId: "actor_1", traceId: "trace_1" },
    ...overrides,
  };
}

/* ── tests ── */

describe("A. bridge client signing", () => {
  it("signs every request so the bridge verifier accepts it", async () => {
    const { fetchImpl, calls } = makeFetch();
    const client = new HermesBridgeClient({ baseUrl: "https://bridge.example", keyId: KEY_ID, secret: SECRET, fetchImpl });

    await client.getRun("run_1");
    const call = calls.at(-1)!;
    expect(call.method).toBe("GET");
    expect(call.path).toBe("/v1/runs/run_1");
    expect(call.headers["x-nexup-key-id"]).toBe(KEY_ID);
    expect(
      verifySignature(
        SECRET,
        {
          method: call.method,
          path: call.path,
          timestamp: call.headers["x-nexup-timestamp"],
          nonce: call.headers["x-nexup-nonce"],
          body: call.body ?? "",
        },
        call.headers["x-nexup-signature"],
      ),
    ).toBe(true);
  });

  it("signs the exact body of a POST", async () => {
    const { fetchImpl, calls } = makeFetch();
    const client = new HermesBridgeClient({ baseUrl: "https://bridge.example", keyId: KEY_ID, secret: SECRET, fetchImpl });
    await client.submitRun({ instruction: "hi", correlation: { actorId: "a", traceId: "t" } });
    const call = calls.at(-1)!;
    expect(call.method).toBe("POST");
    expect(
      verifySignature(
        SECRET,
        {
          method: "POST",
          path: "/v1/runs",
          timestamp: call.headers["x-nexup-timestamp"],
          nonce: call.headers["x-nexup-nonce"],
          body: call.body!,
        },
        call.headers["x-nexup-signature"],
      ),
    ).toBe(true);
  });

  it("surfaces the bridge error envelope as a typed client error", async () => {
    const { fetchImpl } = makeFetch();
    const client = new HermesBridgeClient({ baseUrl: "https://bridge.example", keyId: KEY_ID, secret: SECRET, fetchImpl });
    await expect(client.getRun("run_missing")).rejects.toMatchObject({ code: "RUN_NOT_FOUND", status: 404 });
  });
});

describe("B. HermesBridgeTransport", () => {
  it("completes a submit on the terminal frame, streaming deltas", async () => {
    const { fetchImpl, calls } = makeFetch();
    const transport = makeTransport(fetchImpl);
    const result = await transport.invoke(request());

    expect(result.ok).toBe(true);
    const parsed = JSON.parse(result.raw) as Record<string, unknown>;
    expect(parsed.text).toBe("Hello world");
    expect(parsed.status).toBe("succeeded");
    expect(calls.some((call) => call.path === "/v1/runs/run_1/stream")).toBe(true);
  });

  it("falls back to accumulated deltas when the complete frame carries no text", async () => {
    const { fetchImpl } = makeFetch({
      streamChunks: [
        'event: delta\ndata: {"text":"from "}\n\n',
        'event: delta\ndata: {"text":"deltas"}\n\n',
        'event: complete\ndata: {"status":"succeeded"}\n\n',
      ],
    });
    const result = await makeTransport(fetchImpl).invoke(request());
    expect(JSON.parse(result.raw).text).toBe("from deltas");
  });

  it("maps an error frame onto a transport error kind", async () => {
    const { fetchImpl } = makeFetch({
      streamChunks: ['event: error\ndata: {"code":"HERMES_TIMEOUT","message":"slow"}\n\n'],
    });
    const result = await makeTransport(fetchImpl).invoke(request());
    expect(result.ok).toBe(false);
    expect(result.transportError).toBe("TIMEOUT");
  });

  it("supports health, status and cancel", async () => {
    const { fetchImpl, calls } = makeFetch();
    const transport = makeTransport(fetchImpl);

    const health = await transport.invoke(request({ operation: "health" }));
    expect(health.ok).toBe(true);
    expect(JSON.parse(health.raw).status).toBe("healthy");

    const status = await transport.invoke(request({ operation: "status", payload: { instruction: "", contextJson: "{}", executionId: "run_1" } }));
    expect(JSON.parse(status.raw).status).toBe("COMPLETED");

    const cancel = await transport.invoke(request({ operation: "cancel", payload: { instruction: "", contextJson: "{}", executionId: "run_1" } }));
    expect(JSON.parse(cancel.raw).status).toBe("CANCELLED");
    expect(calls.some((call) => call.method === "POST" && call.path === "/v1/runs/run_1/cancel")).toBe(true);
  });

  it("refuses a forbidden profile and the unsupported resume before any network call", async () => {
    const { fetchImpl, calls } = makeFetch();
    const transport = makeTransport(fetchImpl);
    const forbidden = await transport.invoke(request({ profile: "default" }));
    expect(forbidden.ok).toBe(false);
    expect(forbidden.transportError).toBe("FORBIDDEN");
    const resume = await transport.invoke(request({ operation: "resume" }));
    expect(resume.transportError).toBe("UNSUPPORTED");
    expect(calls).toHaveLength(0);
  });

  it("redacts a secret that appears in provider output", async () => {
    const { fetchImpl } = makeFetch({
      streamChunks: [`event: complete\ndata: ${JSON.stringify({ status: "succeeded", text: `leaked ${SECRET}` })}\n\n`],
    });
    const result = await makeTransport(fetchImpl).invoke(request());
    expect(result.raw).not.toContain(SECRET);
    expect(result.raw).toContain("[REDACTED]");
  });

  it("bounds oversized output", async () => {
    const { fetchImpl } = makeFetch({
      streamChunks: [`event: complete\ndata: ${JSON.stringify({ status: "succeeded", text: "x".repeat(500) })}\n\n`],
    });
    const result = await makeTransport(fetchImpl).invoke(request({ maxOutputBytes: 64 }));
    expect(result.truncated).toBe(true);
    expect(result.raw.length).toBeLessThanOrEqual(64);
  });
});

describe("C. BRIDGE transport configuration", () => {
  const env = {
    HERMES_RUNTIME_PROFILE: "saieed",
    HERMES_RUNTIME_TRANSPORT: "BRIDGE",
    HERMES_RUNTIME_BRIDGE_URL: "https://bridge.example",
    HERMES_RUNTIME_BRIDGE_SECRET: SECRET,
  };

  it("requires a bridge URL and secret, and stays disabled without them", () => {
    expect(resolveHermesConfig({ ...env, HERMES_RUNTIME_BRIDGE_URL: undefined }).enabled).toBe(false);
    expect(resolveHermesConfig({ ...env, HERMES_RUNTIME_BRIDGE_SECRET: undefined }).enabled).toBe(false);
    expect(resolveHermesConfig({ ...env, HERMES_RUNTIME_BRIDGE_URL: "not-a-url" }).enabled).toBe(false);
  });

  it("resolves capabilities and never exposes the secret", () => {
    const resolution = resolveHermesConfig(env);
    expect(resolution.enabled).toBe(true);
    if (!resolution.enabled) return;
    expect(resolution.config.bridgeEndpoint).toBe("https://bridge.example");
    expect(resolution.config.bridgeKeyId).toBe(KEY_ID);
    expect(resolution.config.bridgeSecretPresent).toBe(true);
    expect(resolution.config.capabilities).toMatchObject({ submit: true, status: true, cancel: true, resume: false });
    expect(JSON.stringify(resolution.config)).not.toContain(SECRET);
  });

  it("builds a HermesBridgeTransport from the factory", () => {
    const resolution = resolveHermesConfig(env);
    if (!resolution.enabled) throw new Error(resolution.reason);
    const transport = createHermesTransport(resolution.config, { bridgeSecret: SECRET });
    expect(transport.kind).toBe("BRIDGE");
    expect(transport).toBeInstanceOf(HermesBridgeTransport);
  });

  it("builds a runtime from the environment", () => {
    const built = createHermesRuntimeFromEnv(env);
    expect(built.enabled).toBe(true);
    if (!built.enabled) return;
    expect(built.adapter.identity.metadata.profileRef).toBe("saieed");
    expect(JSON.stringify(built.adapter.identity)).not.toContain(SECRET);
  });
});
