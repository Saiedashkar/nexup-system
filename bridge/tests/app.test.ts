import type { Server } from "node:http";

import { afterEach, describe, expect, it } from "vitest";

import { BridgeSigner } from "@/modules/workforce/bridge/signing";

import { createBridgeApp, type BridgeResult } from "../src/api/app";
import { createBridgeServer } from "../src/server";
import { NonceStore } from "../src/auth/nonce-store";
import {
  DEFAULT_AUTH_FAILURE_AUDIT_MAX,
  DEFAULT_AUTH_FAILURE_AUDIT_WINDOW_MS,
  PreAuthGuard,
} from "../src/auth/pre-auth-guard";
import { RateLimiter } from "../src/auth/rate-limit";
import { resolveBridgeConfig } from "../src/config";
import { RunManager } from "../src/hermes/run-manager";
import { AuditLog, createMemoryAuditSink } from "../src/observability/audit";
import { Logger } from "../src/observability/logger";
import { Metrics } from "../src/observability/metrics";
import { createRedactor } from "../src/redaction";
import { SseStream, createMemorySseWriter } from "../src/stream/sse";
import { fakeFactory, waitFor, wireBodyFromAppClient, type FakeBehavior } from "./helpers";

const SECRET = "0123456789abcdef0123456789abcdef";
const KEY_ID = "nexup-vercel";
const ENV = {
  NEXUP_BRIDGE_HMAC_SECRET: SECRET,
  NEXUP_BRIDGE_ALLOWED_KEY_IDS: KEY_ID,
  HERMES_SESSION_TOKEN: "hermes-session-token",
  HERMES_PROFILE: "saieed",
  HERMES_RPC_URL: "ws://127.0.0.1:9119/api/ws",
};

function asJson(result: BridgeResult) {
  if (result.kind !== "json") throw new Error("expected a JSON result");
  return { status: result.status, body: result.body as Record<string, unknown> };
}

function makeHarness(behavior: FakeBehavior = {}, envOverrides: Record<string, string> = {}) {
  const resolution = resolveBridgeConfig({ ...ENV, ...envOverrides });
  if (!resolution.enabled) throw new Error(resolution.reason);
  const config = resolution.config;

  const metrics = new Metrics();
  const auditSink = createMemoryAuditSink();
  const audit = new AuditLog({ sink: auditSink.sink });
  const logLines: string[] = [];
  const logger = new Logger({ sink: (line) => logLines.push(line), level: "info" });
  const redactor = createRedactor([SECRET, ENV.HERMES_SESSION_TOKEN]);
  const runManager = new RunManager({
    profile: config.hermes.profile,
    timeoutMs: config.timeoutMs,
    maxOutputBytes: config.maxOutputBytes,
    maxConcurrency: config.maxConcurrency,
    transportFactory: fakeFactory(behavior),
    logger,
    metrics,
  });

  const app = createBridgeApp({
    config,
    hmacSecret: SECRET,
    runManager,
    audit,
    logger,
    metrics,
    redactor,
    nonceStore: new NonceStore({ ttlMs: 300_000 }),
    rateLimiter: new RateLimiter({ limitPerMinute: config.rateLimitPerMinute }),
    preAuthGuard: new PreAuthGuard({
      perRemoteLimitPerMinute: config.preAuthPerRemotePerMinute,
      globalLimitPerMinute: config.preAuthGlobalPerMinute,
      ttlMs: config.clockSkewSeconds * 1000,
      failureAuditMax: DEFAULT_AUTH_FAILURE_AUDIT_MAX,
      failureAuditWindowMs: DEFAULT_AUTH_FAILURE_AUDIT_WINDOW_MS,
    }),
  });

  let counter = 0;
  const signer = new BridgeSigner({ keyId: KEY_ID, secret: SECRET, nonceFactory: () => `nonce-${(counter += 1)}` });
  /** `identity` models the TCP peer address and any extra request headers. */
  const call = (
    method: string,
    path: string,
    body?: Record<string, unknown>,
    identity?: { remote?: string; headers?: Record<string, string | string[]> },
  ) => {
    const bodyText = body ? JSON.stringify(body) : "";
    const headers = {
      ...signer.sign({ method, path, body: bodyText }),
      ...(identity?.headers ?? {}),
    } as Record<string, string>;
    return app.handle({ method, path, headers, body: bodyText, ...(identity?.remote ? { remote: identity.remote } : {}) });
  };

  return { app, config, metrics, auditSink, logLines, runManager, call, signer };
}

const servers: Server[] = [];

const submitBody = { instruction: "summarize the market", correlation: { actorId: "actor_1", traceId: "trace_1" } };

afterEach(async () => {
  await Promise.all(
    servers.map(
      (server) =>
        new Promise<void>((resolve) => {
          server.close(() => resolve());
        }),
    ),
  );
  servers.length = 0;
});

describe("bridge app — authentication", () => {
  it("rejects an unsigned request", async () => {
    const { app } = makeHarness();
    const result = asJson(await app.handle({ method: "GET", path: "/v1/health", headers: {}, body: "" }));
    expect(result.status).toBe(401);
    expect((result.body.error as Record<string, unknown>).code).toBe("UNAUTHORIZED");
  });

  it("rejects a tampered signature", async () => {
    const { app, signer } = makeHarness();
    const headers = { ...signer.sign({ method: "GET", path: "/v1/health", body: "" }) } as Record<string, string>;
    headers["x-nexup-signature"] = "0".repeat(headers["x-nexup-signature"].length);
    const result = asJson(await app.handle({ method: "GET", path: "/v1/health", headers, body: "" }));
    expect(result.status).toBe(401);
    expect((result.body.error as Record<string, unknown>).code).toBe("SIGNATURE_INVALID");
  });

  it("rejects a replayed nonce", async () => {
    const { app, signer } = makeHarness();
    const headers = { ...signer.sign({ method: "GET", path: "/v1/health", body: "" }) } as Record<string, string>;
    const first = asJson(await app.handle({ method: "GET", path: "/v1/health", headers, body: "" }));
    const second = asJson(await app.handle({ method: "GET", path: "/v1/health", headers, body: "" }));
    expect(first.status).toBe(200);
    expect(second.status).toBe(401);
    expect((second.body.error as Record<string, unknown>).code).toBe("REPLAY");
  });

  it("enforces the per-key rate limit", async () => {
    const { call } = makeHarness({}, { NEXUP_BRIDGE_RATE_LIMIT_PER_MINUTE: "1" });
    const first = asJson(await call("GET", "/v1/health"));
    const second = asJson(await call("GET", "/v1/health"));
    expect(first.status).toBe(200);
    expect(second.status).toBe(429);
    expect((second.body.error as Record<string, unknown>).code).toBe("RATE_LIMITED");
  });
});

describe("bridge app — endpoints", () => {
  it("reports health and capabilities, pinning the profile", async () => {
    const { call } = makeHarness({ health: { status: "healthy", detail: "gateway.ready" } });
    const health = asJson(await call("GET", "/v1/health"));
    expect(health.status).toBe(200);
    expect(health.body).toMatchObject({ bridge: "ok", hermes: "healthy", profile: "saieed" });

    const capabilities = asJson(await call("GET", "/v1/capabilities"));
    expect(capabilities.status).toBe(200);
    expect(capabilities.body.profile).toBe("saieed");
    expect(capabilities.body.pinnedProfile).toBe(true);
    expect(capabilities.body.lifecycleManaged).toBe(false);
    expect(capabilities.body.hermesMethods).toContain("session.create");
    expect(capabilities.body.hermesMethods).not.toContain("llm.oneshot");
    expect(capabilities.body.excludedMethods).toContain("llm.oneshot");
  });

  it("maps every Hermes health state onto its documented HTTP status", async () => {
    // `degraded` is servable (the gateway answered, just short of ready), so it
    // is 200 with an explicit hermes:"degraded" — only unavailable is 503.
    const scenarios: Array<{ behavior: FakeBehavior; hermes: string; status: number }> = [
      { behavior: { health: { status: "healthy", detail: "gateway.ready" } }, hermes: "healthy", status: 200 },
      {
        behavior: { health: { status: "degraded", detail: "gateway.ping unsupported (-32601)" } },
        hermes: "degraded",
        status: 200,
      },
      { behavior: { failWith: "UNAVAILABLE" }, hermes: "unavailable", status: 503 },
    ];
    for (const scenario of scenarios) {
      const { call } = makeHarness(scenario.behavior);
      const health = asJson(await call("GET", "/v1/health"));
      expect(health.status, `hermes reported ${scenario.hermes}`).toBe(scenario.status);
      expect(health.body).toMatchObject({ bridge: "ok", hermes: scenario.hermes });
    }
  });

  it("submits a run, streams it, reports status and cancels", async () => {
    const { call, runManager } = makeHarness({ deltas: ["Hello ", "world"], complete: { status: "succeeded", text: "Hello world" } });

    const submitted = asJson(await call("POST", "/v1/runs", submitBody));
    expect(submitted.status).toBe(201);
    const runId = submitted.body.runId as string;
    expect(runId).toMatch(/^run_/);
    expect(submitted.body.streamUrl).toBe(`/v1/runs/${runId}/stream`);

    // Stream (late or live): replay yields the deltas and terminal frame.
    const streamResult = await call("GET", `/v1/runs/${runId}/stream`);
    expect(streamResult.kind).toBe("sse");
    const writer = createMemorySseWriter();
    const stream = new SseStream(writer, { heartbeatMs: 0 });
    if (streamResult.kind === "sse") streamResult.open(stream);
    const output = writer.chunks.join("");
    expect(output).toContain("event: delta");
    expect(output).toContain("event: complete");
    expect(output).toContain("Hello ");

    await waitFor(() => runManager.get(runId)?.status === "COMPLETED");
    const status = asJson(await call("GET", `/v1/runs/${runId}`));
    expect(status.status).toBe(200);
    expect(status.body.status).toBe("COMPLETED");
    expect(status.body.executionId).toBe("sess_1");

    const cancelled = asJson(await call("POST", `/v1/runs/${runId}/cancel`));
    expect(cancelled.status).toBe(200);
    expect(cancelled.body.status).toBe("COMPLETED"); // already terminal: cancel is a no-op
  });

  it("cancels a live run", async () => {
    const { call, runManager } = makeHarness({ delayMs: 50 });
    const submitted = asJson(await call("POST", "/v1/runs", submitBody));
    const runId = submitted.body.runId as string;
    const cancelled = asJson(await call("POST", `/v1/runs/${runId}/cancel`));
    expect(cancelled.status).toBe(200);
    expect(cancelled.body.status).toBe("CANCELLED");
    expect(runManager.get(runId)?.status).toBe("CANCELLED");
  });

  it("rejects a caller-supplied profile, a missing instruction, and unknown routes", async () => {
    const { call } = makeHarness();
    const forbidden = asJson(await call("POST", "/v1/runs", { ...submitBody, profile: "default" }));
    expect(forbidden.status).toBe(403);
    expect((forbidden.body.error as Record<string, unknown>).code).toBe("FORBIDDEN_PROFILE");

    const bad = asJson(await call("POST", "/v1/runs", { correlation: submitBody.correlation }));
    expect(bad.status).toBe(400);

    const unknown = asJson(await call("GET", "/v1/anything"));
    expect(unknown.status).toBe(403);
    expect((unknown.body.error as Record<string, unknown>).code).toBe("METHOD_NOT_ALLOWED");
  });

  it("accepts the exact payload the app-side client puts on the wire", async () => {
    const { call } = makeHarness();
    const body = await wireBodyFromAppClient({
      instruction: "summarize the market",
      contextJson: '{"clients":1}',
      correlation: { jobId: "job_1", missionId: "mis_1", actorId: "actor_1", traceId: "trace_1" },
      timeoutMs: 5_000,
    });
    const result = asJson(await call("POST", "/v1/runs", body));
    expect(result.status).toBe(201);
  });

  it("refuses an undefined field instead of silently ignoring it", async () => {
    const { call } = makeHarness();
    // A caller-supplied `method` used to be ignored, so this returned 201.
    const result = asJson(await call("POST", "/v1/runs", { ...submitBody, method: "llm.oneshot" }));
    expect(result.status).toBe(400);
    expect((result.body.error as Record<string, unknown>).code).toBe("BAD_REQUEST");
    expect(String((result.body.error as Record<string, unknown>).message)).toContain("method");
  });

  it("refuses an undefined field nested inside the correlation", async () => {
    const { call } = makeHarness();
    const result = asJson(
      await call("POST", "/v1/runs", {
        ...submitBody,
        correlation: { ...submitBody.correlation, scope: "everything" },
      }),
    );
    expect(result.status).toBe(400);
    expect((result.body.error as Record<string, unknown>).code).toBe("BAD_REQUEST");
    expect(String((result.body.error as Record<string, unknown>).message)).toContain("scope");
  });

  it("404s an unknown run", async () => {
    const { call } = makeHarness();
    const result = asJson(await call("GET", "/v1/runs/run_missing"));
    expect(result.status).toBe(404);
    expect((result.body.error as Record<string, unknown>).code).toBe("RUN_NOT_FOUND");
  });

  it("records an audit entry for every request", async () => {
    const { call, auditSink } = makeHarness();
    await call("GET", "/v1/health");
    expect(auditSink.entries.length).toBeGreaterThan(0);
    const entry = auditSink.entries.at(-1);
    expect(entry).toMatchObject({ action: "health", keyId: KEY_ID, profile: "saieed", outcome: "allowed", statusCode: 200 });
    expect(typeof entry?.at).toBe("string");
  });
});

describe("bridge app — hardening", () => {
  it("bounds unauthenticated traffic before signature verification", async () => {
    const { call } = makeHarness({}, { NEXUP_BRIDGE_PREAUTH_GLOBAL_PER_MINUTE: "1" });
    const first = asJson(await call("GET", "/v1/health"));
    const second = asJson(await call("GET", "/v1/health"));
    expect(first.status).toBe(200);
    expect(second.status).toBe(429);
    expect((second.body.error as Record<string, unknown>).code).toBe("RATE_LIMITED");
  });

  it("counts every authentication failure but audits only a downsampled few", async () => {
    const { app, auditSink, metrics } = makeHarness();
    for (let i = 0; i < 12; i += 1) {
      await app.handle({ method: "GET", path: "/v1/health", headers: {}, body: "" });
    }
    expect(auditSink.entries.filter((entry) => entry.detail === "UNAUTHORIZED")).toHaveLength(
      DEFAULT_AUTH_FAILURE_AUDIT_MAX,
    );
    expect(metrics.getCounter("bridge_auth_failures")).toBe(12);
  });

  it("rejects a malformed run id instead of throwing", async () => {
    const { call } = makeHarness();
    const result = asJson(await call("GET", "/v1/runs/%"));
    expect(result.status).toBe(400);
    expect((result.body.error as Record<string, unknown>).code).toBe("BAD_REQUEST");
  });

  it("rejects any query string", async () => {
    const { app, signer } = makeHarness();
    const path = "/v1/runs/run_1";
    const headers = { ...signer.sign({ method: "GET", path, body: "" }) } as Record<string, string>;
    const result = asJson(await app.handle({ method: "GET", path, query: "?x=1", headers, body: "" }));
    expect(result.status).toBe(400);
    expect((result.body.error as Record<string, unknown>).code).toBe("BAD_REQUEST");
  });

  it("gives each proxied client its own pre-auth budget", async () => {
    const { call } = makeHarness({}, { NEXUP_BRIDGE_PREAUTH_PER_REMOTE_PER_MINUTE: "1" });
    const proxy = { remote: "127.0.0.1", headers: { "x-nexup-client-ip": "203.0.113.7" } };
    const otherClient = { remote: "127.0.0.1", headers: { "x-nexup-client-ip": "198.51.100.4" } };
    expect(asJson(await call("GET", "/v1/health", undefined, proxy)).status).toBe(200);
    expect(asJson(await call("GET", "/v1/health", undefined, otherClient)).status).toBe(200);
    expect(asJson(await call("GET", "/v1/health", undefined, proxy)).status).toBe(429);
  });

  it("refuses to mint fresh budgets from a spoofed header on an untrusted peer", async () => {
    const { call } = makeHarness({}, { NEXUP_BRIDGE_PREAUTH_PER_REMOTE_PER_MINUTE: "1" });
    const spoof = (clientIp: string) => ({
      remote: "10.0.0.9",
      headers: { "x-nexup-client-ip": clientIp },
    });
    expect(asJson(await call("GET", "/v1/health", undefined, spoof("203.0.113.7"))).status).toBe(200);
    expect(asJson(await call("GET", "/v1/health", undefined, spoof("198.51.100.4"))).status).toBe(429);
  });

  it("records the resolved client in the audit line, and the peer address when the value is unusable", async () => {
    const { call, auditSink } = makeHarness();
    await call("GET", "/v1/health", undefined, {
      remote: "127.0.0.1",
      headers: { "x-nexup-client-ip": "203.0.113.7" },
    });
    expect(auditSink.entries.at(-1)?.remote).toBe("203.0.113.7");

    await call("GET", "/v1/health", undefined, {
      remote: "127.0.0.1",
      headers: { "x-nexup-client-ip": "not-an-ip" },
    });
    expect(auditSink.entries.at(-1)?.remote).toBe("127.0.0.1");

    await call("GET", "/v1/health", undefined, { remote: "10.0.0.9", headers: { "x-nexup-client-ip": "203.0.113.7" } });
    expect(auditSink.entries.at(-1)?.remote).toBe("10.0.0.9");
  });

  it("resolves the client from a real request header over the wire", async () => {
    const { app, auditSink, signer } = makeHarness();
    const server = createBridgeServer(app, { maxBodyBytes: 4096 });
    servers.push(server);
    const port = await new Promise<number>((resolve) => {
      server.listen(0, "127.0.0.1", () => resolve((server.address() as { port: number }).port));
    });
    const send = (clientIp: string) => {
      const headers = {
        ...signer.sign({ method: "GET", path: "/v1/health", body: "" }),
        "x-nexup-client-ip": clientIp,
      } as Record<string, string>;
      return fetch(`http://127.0.0.1:${port}/v1/health`, { headers });
    };

    // The loopback peer IS the trusted proxy, so the header is believed here.
    expect((await send("203.0.113.7")).status).toBe(200);
    expect(auditSink.entries.at(-1)?.remote).toBe("203.0.113.7");

    // An unusable value degrades to the real socket address, not a shared bucket.
    expect((await send("203.0.113.7:443")).status).toBe(200);
    expect(auditSink.entries.at(-1)?.remote).toBe("127.0.0.1");
  });

  it("accepts the app client's real payload over the wire and refuses an undefined field", async () => {
    const { app, signer } = makeHarness({ deltas: ["ok"] });
    const server = createBridgeServer(app, { maxBodyBytes: 4096 });
    servers.push(server);
    const port = await new Promise<number>((resolve) => {
      server.listen(0, "127.0.0.1", () => resolve((server.address() as { port: number }).port));
    });
    const post = async (body: Record<string, unknown>) => {
      const bodyText = JSON.stringify(body);
      const headers = {
        ...signer.sign({ method: "POST", path: "/v1/runs", body: bodyText }),
        "content-type": "application/json",
      } as Record<string, string>;
      return fetch(`http://127.0.0.1:${port}/v1/runs`, { method: "POST", headers, body: bodyText });
    };

    // The exact bytes the app client builds, through HMAC verification and the
    // strict schema: a real end-to-end acceptance, not a unit-level one.
    const accepted = await post(
      await wireBodyFromAppClient({ instruction: "summarize", correlation: { actorId: "actor_1", traceId: "trace_1" } }),
    );
    expect(accepted.status).toBe(201);

    const refused = await post({
      instruction: "summarize",
      correlation: { actorId: "actor_1", traceId: "trace_1" },
      method: "llm.oneshot",
    });
    expect(refused.status).toBe(400);
    const envelope = (await refused.json()) as { error: { code: string; retryable: boolean } };
    expect(envelope.error.code).toBe("BAD_REQUEST");
    expect(envelope.error.retryable).toBe(false);
  });

  it("caps correlation fields and never logs the prompt", async () => {
    const { call, logLines } = makeHarness({ deltas: ["ok"] });
    const longTrace = "t".repeat(500);
    const result = asJson(
      await call("POST", "/v1/runs", {
        instruction: "TOP_SECRET_PROMPT",
        correlation: { actorId: "actor_1", traceId: longTrace },
      }),
    );
    expect(result.status).toBe(201);
    const joined = logLines.join("\n");
    expect(joined).not.toContain("TOP_SECRET_PROMPT");
    expect(joined).not.toContain(longTrace);
    expect(joined).toContain("t".repeat(128));
  });
});
