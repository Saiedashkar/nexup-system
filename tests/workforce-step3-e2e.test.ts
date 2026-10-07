import { describe, expect, it } from "vitest";

import {
  createHermesRuntimeFromEnv,
  HermesBridgeClient,
  type AgentJobRequest,
  type BridgeRunEvent,
  type HermesExecutionRecord,
  type RuntimeEvent,
} from "@/modules/workforce";

/**
 * STEP 3/8 — the first REAL end-to-end run.
 *
 *   NEXUP → HermesBridgeTransport → production Bridge → Hermes RPC → saieed → NEXUP
 *
 * The point of this file is to be the seam where the mocked suite and reality
 * disagree. `workforce-phase2b-bridge.test.ts` proves the transport against a
 * fetch double; this file proves the SAME code against the deployed bridge, with
 * one deterministic, minimal, harmless prompt, and records what actually
 * happened (latency, ids, provider metadata, audit trail).
 *
 * Two halves:
 *
 *   A. OFFLINE — always run. The failure paths the live run must not discover
 *      for the first time: a stalled stream (timeout), an unreachable bridge,
 *      and a profile the adapter refuses before any network call.
 *   B. LIVE — runs ONLY with `NEXUP_BRIDGE_E2E=1` plus the bridge credentials in
 *      the environment, because it spends a real Hermes turn. It prints one
 *      `[step3-audit]` JSON line (no secrets) that is the execution's audit
 *      record.
 *
 * `HERMES_RUNTIME_TRANSPORT` is forced to BRIDGE here so a stray environment
 * cannot silently route the run some other way: the whole claim is that the
 * result crossed the production bridge.
 */

const EXPECTED_MARKER = "NEXUP_BRIDGE_E2E_OK";
const INSTRUCTION = `Return exactly: ${EXPECTED_MARKER}`;

const ACTOR_ID = "actor_step3_e2e";
const CAPABILITY_ID = "capability_step3_e2e";

/* ══════════════════════════════════════════════════════
   A. Offline — the failure paths
   ══════════════════════════════════════════════════════ */

type Call = { method: string; path: string };

function sseBody(chunks: string[], signal?: AbortSignal | null): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      // A stream that never closes is what a stalled bridge looks like from
      // here; the transport's own AbortController must end it, not the socket.
      signal?.addEventListener("abort", () => {
        controller.error(Object.assign(new Error("aborted"), { name: "AbortError" }));
      });
    },
  });
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function envForLive(): Record<string, string | undefined> {
  return {
    ...process.env,
    HERMES_RUNTIME_TRANSPORT: "BRIDGE",
    HERMES_RUNTIME_PROFILE: process.env.HERMES_RUNTIME_PROFILE?.trim() || "saieed",
  };
}

function job(overrides: Partial<AgentJobRequest> = {}): AgentJobRequest {
  return {
    actorId: ACTOR_ID,
    capabilityId: CAPABILITY_ID,
    input: { instruction: INSTRUCTION },
    traceId: `step3-e2e-${Date.now()}`,
    ...overrides,
  };
}

describe("STEP 3 A — the transport's failure paths, before the live run needs them", () => {
  it("records TIMEOUT (not a hang, not a throw) when the stream never terminates", async () => {
    const calls: Call[] = [];
    const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url);
      calls.push({ method: (init?.method ?? "GET").toUpperCase(), path: url.pathname });
      if (url.pathname === "/v1/runs") return jsonResponse(201, { runId: "run_stall", streamUrl: "/v1/runs/run_stall/stream", status: "RUNNING" });
      if (url.pathname === "/v1/runs/run_stall/stream") {
        return new Response(sseBody(['event: delta\ndata: {"text":"partial"}\n\n'], init?.signal), {
          status: 200,
          headers: { "content-type": "text/event-stream" },
        });
      }
      return jsonResponse(404, { error: { code: "RUN_NOT_FOUND", message: "no such run" } });
    }) as typeof fetch;

    const built = createHermesRuntimeFromEnv(
      { ...envForLive(), HERMES_RUNTIME_BRIDGE_URL: "https://bridge.invalid", HERMES_RUNTIME_BRIDGE_SECRET: "s3cret", HERMES_RUNTIME_TIMEOUT_MS: "400" },
      { fetchImpl },
    );
    if (!built.enabled) throw new Error(built.reason);

    const startedAt = Date.now();
    const handle = await built.adapter.submitJob(job());
    const elapsed = Date.now() - startedAt;
    const record = built.adapter.getExecutionRecord(handle.handleId) as HermesExecutionRecord;

    expect(record.status).toBe("FAILED");
    expect(record.error?.category).toBe("TIMEOUT");
    expect(record.error?.retryable).toBe(true);
    // The abort fired from OUR timer: not "eventually", not "when the socket felt like it".
    expect(elapsed).toBeGreaterThanOrEqual(350);
    expect(elapsed).toBeLessThan(5_000);
    // And the INJECTED fetch was the one used. Measured the hard way: the bridge
    // transport used to ignore `fetchImpl` and fall back to `globalThis.fetch`,
    // so this test reached the real network in 52 ms and reported TRANSPORT.
    expect(calls.some((call) => call.path === "/v1/runs/run_stall/stream")).toBe(true);
  });

  it("records an unreachable bridge as a retryable failure (not a throw)", async () => {
    let attempts = 0;
    const fetchImpl = (async () => {
      attempts += 1;
      throw new TypeError("fetch failed");
    }) as typeof fetch;

    const built = createHermesRuntimeFromEnv(
      { ...envForLive(), HERMES_RUNTIME_BRIDGE_URL: "https://bridge.invalid", HERMES_RUNTIME_BRIDGE_SECRET: "s3cret" },
      { fetchImpl },
    );
    if (!built.enabled) throw new Error(built.reason);

    const handle = await built.adapter.submitJob(job());
    const record = built.adapter.getExecutionRecord(handle.handleId) as HermesExecutionRecord;
    expect(record.status).toBe("FAILED");
    // The transport's UNAVAILABLE maps to the record's TRANSPORT category
    // (`classifyTransportError`), and it is retryable — a broken bridge must be
    // distinguishable from a refused profile or a malformed reply.
    expect(record.error?.category).toBe("TRANSPORT");
    expect(record.error?.retryable).toBe(true);
    expect(attempts).toBe(1);
  });

  it("refuses the default profile before any network call", async () => {
    const calls: Call[] = [];
    const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url);
      calls.push({ method: (init?.method ?? "GET").toUpperCase(), path: url.pathname });
      return jsonResponse(500, {});
    }) as typeof fetch;

    // The environment resolution refuses `default` outright, so there is no
    // runtime to build and therefore no request to leak.
    const refused = createHermesRuntimeFromEnv(
      { ...envForLive(), HERMES_RUNTIME_PROFILE: "default", HERMES_RUNTIME_BRIDGE_URL: "https://bridge.invalid", HERMES_RUNTIME_BRIDGE_SECRET: "s3cret" },
      { fetchImpl },
    );
    expect(refused.enabled).toBe(false);
    if (!refused.enabled) expect(refused.reason).toMatch(/forbidden/i);
    expect(calls).toHaveLength(0);
  });
});

/* ══════════════════════════════════════════════════════
   A2. The handle the bridge actually accepts
   ══════════════════════════════════════════════════════

   The bridge keys `status`/`cancel`/`stream` by ITS OWN run id (`run_…`); the
   Hermes session id it reports alongside is provider metadata. Measured against
   the deployed bridge: `GET /v1/runs/run_muxjhitf_79c4e201` → 200 COMPLETED,
   `GET /v1/runs/58b92fb1` (the session id NEXUP kept as its handle) →
   404 RUN_NOT_FOUND. So the adapter's status/cancel path could never work
   against the real bridge. These tests reproduce that 404 through the same code
   path, offline and deterministically. */

const BRIDGE_RUN_ID = "run_bridge_1";
const HERMES_SESSION_ID = "sess_hermes_1";

function bridgeDouble(): { fetchImpl: typeof fetch; calls: Call[] } {
  const calls: Call[] = [];
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url);
    const method = (init?.method ?? "GET").toUpperCase();
    calls.push({ method, path: url.pathname });

    if (method === "POST" && url.pathname === "/v1/runs") {
      return jsonResponse(201, { runId: BRIDGE_RUN_ID, streamUrl: `/v1/runs/${BRIDGE_RUN_ID}/stream`, status: "RUNNING" });
    }
    if (method === "GET" && url.pathname === `/v1/runs/${BRIDGE_RUN_ID}/stream`) {
      return new Response(
        sseBody([
          'event: delta\ndata: {"text":"NEXUP_BRIDGE_E2E"}\n\n',
          `event: complete\ndata: ${JSON.stringify({ status: "succeeded", text: EXPECTED_MARKER, executionId: HERMES_SESSION_ID })}\n\n`,
        ]),
        { status: 200, headers: { "content-type": "text/event-stream" } },
      );
    }
    // The bridge's own routes — and ONLY these ids are found, exactly like the
    // deployed bridge.
    if (method === "GET" && url.pathname === `/v1/runs/${BRIDGE_RUN_ID}`) {
      return jsonResponse(200, {
        runId: BRIDGE_RUN_ID,
        status: "COMPLETED",
        executionId: HERMES_SESSION_ID,
        startedAt: "2026-10-07T03:19:54.243Z",
        endedAt: "2026-10-07T03:19:59.982Z",
        bytesOut: 19,
        errorCode: null,
      });
    }
    if (method === "POST" && url.pathname === `/v1/runs/${BRIDGE_RUN_ID}/cancel`) {
      return jsonResponse(200, { runId: BRIDGE_RUN_ID, status: "CANCELLED" });
    }
    return jsonResponse(404, { error: { code: "RUN_NOT_FOUND", message: `No run "${url.pathname}"`, retryable: false } });
  }) as typeof fetch;
  return { fetchImpl, calls };
}

function bridgeRuntime(fetchImpl: typeof fetch) {
  const built = createHermesRuntimeFromEnv(
    { ...envForLive(), HERMES_RUNTIME_BRIDGE_URL: "https://bridge.invalid", HERMES_RUNTIME_BRIDGE_SECRET: "s3cret" },
    { fetchImpl },
  );
  if (!built.enabled) throw new Error(built.reason);
  return built.adapter;
}

describe("STEP 3 A2 — the handle is the bridge's run id, not the provider session", () => {
  it("keeps the bridge run id as the handle and the session id as provider metadata", async () => {
    const { fetchImpl } = bridgeDouble();
    const adapter = bridgeRuntime(fetchImpl);

    const handle = await adapter.submitJob(job());
    const record = adapter.getExecutionRecord(handle.handleId) as HermesExecutionRecord;

    expect(handle.handleId).toBe(BRIDGE_RUN_ID);
    expect(record.executionId).toBe(BRIDGE_RUN_ID);
    // The provider session is NOT the handle, but it must not be lost either.
    expect(record.providerExecutionId).toBe(HERMES_SESSION_ID);
    expect(record.status).toBe("SUCCEEDED");
  });

  it("reads status back through the bridge's own route", async () => {
    const { fetchImpl, calls } = bridgeDouble();
    const adapter = bridgeRuntime(fetchImpl);

    const handle = await adapter.submitJob(job());
    const readBack = await adapter.getExecutionStatus(handle.handleId);

    expect(calls.some((call) => call.method === "GET" && call.path === `/v1/runs/${BRIDGE_RUN_ID}`)).toBe(true);
    // The pre-fix path: GET /v1/runs/sess_hermes_1 → 404 in the double, exactly
    // as the deployed bridge answers.
    expect(calls.some((call) => call.path === `/v1/runs/${HERMES_SESSION_ID}`)).toBe(false);
    expect(readBack.status).toBe("SUCCEEDED");
  });

  it("cancels through the bridge's own route", async () => {
    const { fetchImpl, calls } = bridgeDouble();
    const adapter = bridgeRuntime(fetchImpl);

    const handle = await adapter.submitJob(job());
    const cancelled = await adapter.cancelJob(handle.handleId, "step3 test");

    expect(calls.some((call) => call.method === "POST" && call.path === `/v1/runs/${BRIDGE_RUN_ID}/cancel`)).toBe(true);
    expect(cancelled.status).toBe("CANCELLED");
  });
});

/* ══════════════════════════════════════════════════════
   B. Live — one real turn through the production bridge
   ══════════════════════════════════════════════════════ */

const liveRequested = process.env.NEXUP_BRIDGE_E2E === "1";

describe.skipIf(!liveRequested)("STEP 3 B — the real round trip", () => {
  it(
    "returns the deterministic marker, crossing the bridge, with an audit record",
    async () => {
      const env = envForLive();
      const events: RuntimeEvent[] = [];
      const built = createHermesRuntimeFromEnv(env, { eventSink: (event) => events.push(event) });
      expect(built.enabled).toBe(true);
      if (!built.enabled) throw new Error(built.reason);

      const adapter = built.adapter;
      const bridgeHost = env.HERMES_RUNTIME_BRIDGE_URL ?? "<unset>";

      // No bypass: the runtime addresses the bridge and nothing else.
      expect(adapter.identity.metadata.transport).toBe("BRIDGE");
      expect(adapter.identity.metadata.profileRef).toBe("saieed");

      const healthStartedAt = Date.now();
      const health = await adapter.healthCheck();
      const healthLatencyMs = Date.now() - healthStartedAt;

      const submittedAt = Date.now();
      const handle = await adapter.submitJob(job());
      const wallMs = Date.now() - submittedAt;

      const record = adapter.getExecutionRecord(handle.handleId) as HermesExecutionRecord;
      const raw = record.outputText ?? JSON.stringify(record.output ?? {});

      const audit = {
        step: "3",
        at: new Date().toISOString(),
        bridgeHost: bridgeHost.replace(/\/+$/, ""),
        profile: adapter.identity.metadata.profileRef,
        transport: adapter.identity.metadata.transport,
        runtimeId: adapter.identity.id,
        timeoutMs: adapter.identity.metadata.timeoutMs,
        instructionSha256: undefined as string | undefined,
        marker: EXPECTED_MARKER,
        markerFound: raw.includes(EXPECTED_MARKER),
        handleId: handle.handleId,
        executionId: record.executionId,
        status: record.status,
        durationMs: record.durationMs,
        wallMs,
        healthStatus: health.status,
        healthLatencyMs,
        truncated: record.truncated,
        eventTypes: [...new Set(events.map((event) => event.type))],
        outputPreview: raw.slice(0, 200),
      };

      const { createHash } = await import("node:crypto");
      audit.instructionSha256 = createHash("sha256").update(INSTRUCTION, "utf8").digest("hex");
      console.log(`[step3-audit] ${JSON.stringify(audit)}`);

      // The result itself — the whole point of the run.
      expect(health.status).toBe("HEALTHY");
      expect(record.status).toBe("SUCCEEDED");
      expect(record.executionId).toBeTruthy();
      expect(raw).toContain(EXPECTED_MARKER);
      expect(record.truncated).toBe(false);
      expect(record.durationMs).toBeGreaterThan(0);

      // An audit trail exists and names the same execution.
      expect(events.map((event) => event.type)).toContain("runtime.submit");
      expect(events.map((event) => event.type)).toContain("runtime.completed");
      expect(events.every((event) => event.profile === "saieed")).toBe(true);
    },
    180_000,
  );

  it(
    "cancels an IN-FLIGHT run through the bridge's own cancel route",
    async () => {
      // Transport-level on purpose: the adapter's `submitJob` is synchronous
      // (it awaits the terminal frame), so an in-flight cancel is not reachable
      // through it — a Step-4 input, recorded rather than hidden. This exercises
      // the same client + run id the adapter now keeps as its handle.
      const env = envForLive();
      const client = new HermesBridgeClient({
        baseUrl: env.HERMES_RUNTIME_BRIDGE_URL ?? "",
        keyId: env.HERMES_RUNTIME_BRIDGE_KEY_ID ?? "nexup-vercel",
        secret: env.HERMES_RUNTIME_BRIDGE_SECRET ?? "",
      });

      const submitted = await client.submitRun({
        instruction: "Count slowly from one to two hundred, one number per line, and do not stop early.",
        correlation: { actorId: ACTOR_ID, traceId: `step3-cancel-${Date.now()}` },
        timeoutMs: 60_000,
      });

      // Subscribe BEFORE cancelling: the bridge closes a stream immediately for
      // an already-terminal run, so a late subscriber would see no frames.
      const events: BridgeRunEvent[] = [];
      const streamDone = (async () => {
        for await (const event of client.streamRun(submitted.runId, { signal: AbortSignal.timeout(60_000) })) {
          events.push(event);
          if (event.event === "complete" || event.event === "error") break;
        }
      })();

      await new Promise((resolve) => setTimeout(resolve, 2_500)); // let the turn start
      const cancelAck = await client.cancelRun(submitted.runId);
      await streamDone;

      const terminalFrame = events.at(-1);
      console.log(
        `[step3-audit] ${JSON.stringify({
          step: "3",
          phase: "cancel",
          runId: submitted.runId,
          cancelAck,
          terminalEvent: terminalFrame?.event ?? null,
          terminalStatus: terminalFrame?.data.status ?? null,
          frames: events.length,
        })}`,
      );

      expect(cancelAck.status).toBe("CANCELLED");
      expect(terminalFrame?.event).toBe("complete");
      expect(terminalFrame?.data.status).toBe("cancelled");
    },
    120_000,
  );

  it(
    "can read the run back from the bridge for the handle it returned",
    async () => {
      const built = createHermesRuntimeFromEnv(envForLive());
      if (!built.enabled) throw new Error(built.reason);
      const adapter = built.adapter;

      const handle = await adapter.submitJob(job({ traceId: `step3-status-${Date.now()}` }));
      const readBack = await adapter.getExecutionStatus(handle.handleId);
      const record = adapter.getExecutionRecord(handle.handleId) as HermesExecutionRecord;
      console.log(
        `[step3-audit] ${JSON.stringify({
          step: "3",
          phase: "status-readback",
          handleId: handle.handleId,
          expectedStatus: record.status,
          readBackStatus: readBack.status,
          readBackDetail: readBack.detail ?? null,
        })}`,
      );

      expect(readBack.status).toBe("SUCCEEDED");
    },
    180_000,
  );
});
