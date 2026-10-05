import { describe, expect, it } from "vitest";

import { BridgeSigner } from "@/modules/workforce/bridge/signing";

import { createBridgeApp, type BridgeResult } from "../src/api/app";
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
import { fakeFactory, waitFor, type FakeBehavior } from "./helpers";

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
  const call = (method: string, path: string, body?: Record<string, unknown>) => {
    const bodyText = body ? JSON.stringify(body) : "";
    const headers = { ...signer.sign({ method, path, body: bodyText }) } as Record<string, string>;
    return app.handle({ method, path, headers, body: bodyText });
  };

  return { app, config, metrics, auditSink, logLines, runManager, call, signer };
}

const submitBody = { instruction: "summarize the market", correlation: { actorId: "actor_1", traceId: "trace_1" } };

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
