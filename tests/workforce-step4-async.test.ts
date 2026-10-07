import { describe, expect, it } from "vitest";

import { createSequentialIdFactory, sequentialClock } from "@/modules/ai-workforce/core/ids";
import {
  AgentRuntimeDispatcher,
  bootstrapStrategyAnalyst,
  createHermesRuntime,
  createHermesRuntimeFromEnv,
  createWorkforceDomain,
  DeterministicRuntimeAdapter,
  founderActorRegistration,
  INTERNAL_STRATEGY_ANALYST_ACTOR_ID,
  isAsyncAgentRuntime,
  isTerminalExecutionStatus,
  resolveHermesConfig,
  STRATEGY_INTERNAL_BRIEF_CAPABILITY_ID,
  STRATEGY_INTERNAL_BRIEF_CAPABILITY_VERSION,
  type HermesAsyncTransport,
  type HermesRuntimeConfig,
  type HermesTransport,
  type HermesTransportProvenance,
  type HermesTransportRequest,
  type HermesTransportResult,
  type RuntimeEvent,
} from "@/modules/workforce";

// The mock transport is NOT on the production module surface: it lives in its
// own test-support module and declares `provenance: "TEST"`.
import { DeterministicHermesTransport } from "@/modules/workforce/runtimes/hermes/testing/deterministic-transport";

/**
 * STEP 4/8 — the asynchronous execution contract, and the first REAL actor.
 *
 * Two claims, and this file is where they are settled:
 *
 *   A/B/C. `startJob → handle → status/events → terminal → cancel` is a
 *          provider-NEUTRAL contract, satisfied by the deterministic runtime AND
 *          by the Hermes adapter — including idempotent submits (one retry can
 *          never create a second real run), in-flight status, in-flight
 *          cancellation through the PORT, and a wait timeout that does NOT
 *          silently cancel the execution.
 *
 *   D/E.   ONE real Actor Registry actor (the Internal Strategy Analyst) travels
 *          Actor → capability assignment → runtime assignment → AgentRuntime →
 *          Hermes runtime adapter → bridge transport → (the bridge's own
 *          routes), and every step refuses what it must refuse.
 *
 * Section C drives the REAL `HermesBridgeTransport` against a fetch double that
 * mirrors the deployed bridge's routes (201 + runId, an SSE stream, its own
 * status/cancel keyed by ITS run id). Section H is the same path against the
 * deployed bridge, spent only with `NEXUP_BRIDGE_E2E=1`.
 */

const CAPABILITY_ID = STRATEGY_INTERNAL_BRIEF_CAPABILITY_ID;
const BRIDGE_RUN_ID = "run_step4_1";
const SESSION_ID = "sess_step4_1";
const MARKER = "NEXUP_STEP4_AGENT_OK";
const INSTRUCTION = `Return exactly: ${MARKER}`;
const ACTOR_ID = INTERNAL_STRATEGY_ANALYST_ACTOR_ID;

/* ══════════════════════════════════════════════════════
   Fixtures
   ══════════════════════════════════════════════════════ */

function hermesConfig(overrides: Partial<HermesRuntimeConfig> = {}): HermesRuntimeConfig {
  return {
    runtimeId: "runtime_hermes_saeed",
    displayName: "Hermes Agent Runtime",
    transport: "BRIDGE",
    profile: "saieed",
    bridgeEndpoint: "https://bridge.invalid",
    bridgeKeyId: "nexup-vercel",
    bridgeSecretPresent: true,
    timeoutMs: 5_000,
    maxOutputBytes: 8_192,
    capabilities: { submit: true, status: true, health: true, cancel: true, resume: false },
    authTokenPresent: false,
    authHeaderName: "Authorization",
    authScheme: "Bearer",
    ...overrides,
  };
}

/** Blind delegation that also counts what the adapter asked the transport to do. */
class CountingTransport implements HermesAsyncTransport {
  readonly kind = "DETERMINISTIC";
  readonly provenance: HermesTransportProvenance;
  startCalls = 0;
  statusCalls = 0;
  cancelCalls = 0;
  constructor(private readonly inner: HermesAsyncTransport) {
    this.provenance = inner.provenance;
  }

  async startRun(request: HermesTransportRequest) {
    this.startCalls += 1;
    return this.inner.startRun(request);
  }

  async invoke(request: HermesTransportRequest): Promise<HermesTransportResult> {
    if (request.operation === "status") this.statusCalls += 1;
    if (request.operation === "cancel") this.cancelCalls += 1;
    return this.inner.invoke(request);
  }
}

function deterministicAdapter(transport: HermesTransport, sink?: (event: RuntimeEvent) => void) {
  const options = {
    transport,
    ids: createSequentialIdFactory("h"),
    now: sequentialClock("2026-05-01T00:00:00.000Z", 1000),
    // These fixtures run on `provenance: "TEST"` transports, so the adapter's
    // provenance gate must be opted into — exactly what production never does.
    allowTestTransport: true,
    ...(sink ? { eventSink: sink } : {}),
  };
  return { adapter: createHermesRuntime(hermesConfig(), options) };
}

/* ══════════════════════════════════════════════════════
   A bridge double: the deployed bridge's OWN routes
   ══════════════════════════════════════════════════════ */

type Call = { method: string; path: string };

type BridgeDouble = {
  fetchImpl: typeof fetch;
  calls: Call[];
};

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

/**
 * Mirrors the deployed bridge: `POST /v1/runs` answers 201 with a RUN id, the
 * stream is keyed by that id, and `status`/`cancel` accept ONLY that id (the
 * Hermes session id is reported alongside as provider metadata).
 */
function bridgeRunDouble(
  options: { holdUntilCancel?: boolean; terminalDelayMs?: number; text?: string } = {},
): BridgeDouble {
  const encoder = new TextEncoder();
  const calls: Call[] = [];
  const state = { status: "RUNNING" };
  const controllers: ReadableStreamDefaultController<Uint8Array>[] = [];
  const text = options.text ?? MARKER;

  const closeStream = (status: string) => {
    state.status = status === "succeeded" ? "COMPLETED" : "CANCELLED";
    for (const controller of controllers.splice(0)) {
      try {
        controller.enqueue(
          encoder.encode(`event: complete\ndata: ${JSON.stringify({ status, text, executionId: SESSION_ID })}\n\n`),
        );
        controller.close();
      } catch {
        /* already closed */
      }
    }
  };

  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url);
    const method = (init?.method ?? "GET").toUpperCase();
    calls.push({ method, path: url.pathname });

    if (method === "POST" && url.pathname === "/v1/runs") {
      return jsonResponse(201, { runId: BRIDGE_RUN_ID, streamUrl: `/v1/runs/${BRIDGE_RUN_ID}/stream`, status: "RUNNING" });
    }

    if (method === "GET" && url.pathname === `/v1/runs/${BRIDGE_RUN_ID}/stream`) {
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          controllers.push(controller);
          controller.enqueue(encoder.encode('event: delta\ndata: {"text":"partial"}\n\n'));
          if (options.holdUntilCancel) return; // stays open until cancelled
          const finish = () => closeStream("succeeded");
          if (options.terminalDelayMs) setTimeout(finish, options.terminalDelayMs);
          else finish();
        },
      });
      return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
    }

    if (method === "GET" && url.pathname === `/v1/runs/${BRIDGE_RUN_ID}`) {
      return jsonResponse(200, {
        runId: BRIDGE_RUN_ID,
        status: state.status,
        executionId: state.status === "RUNNING" ? null : SESSION_ID,
        startedAt: "2026-05-01T00:00:00.000Z",
        endedAt: state.status === "RUNNING" ? null : "2026-05-01T00:00:01.000Z",
        bytesOut: 19,
        errorCode: null,
      });
    }

    if (method === "POST" && url.pathname === `/v1/runs/${BRIDGE_RUN_ID}/cancel`) {
      closeStream("cancelled");
      return jsonResponse(200, { runId: BRIDGE_RUN_ID, status: "CANCELLED" });
    }

    return jsonResponse(404, { error: { code: "RUN_NOT_FOUND", message: `No run "${url.pathname}"`, retryable: false } });
  }) as typeof fetch;

  return { fetchImpl, calls };
}

function bridgeEnv(): Record<string, string | undefined> {
  return {
    ...process.env,
    HERMES_RUNTIME_TRANSPORT: "BRIDGE",
    HERMES_RUNTIME_PROFILE: "saieed",
    HERMES_RUNTIME_BRIDGE_URL: "https://bridge.invalid",
    HERMES_RUNTIME_BRIDGE_SECRET: "s3cret",
    HERMES_RUNTIME_TIMEOUT_MS: "5000",
  };
}

function bridgeAdapter(fetchImpl: typeof fetch, sink?: (event: RuntimeEvent) => void) {
  const built = createHermesRuntimeFromEnv(bridgeEnv(), {
    fetchImpl,
    ids: createSequentialIdFactory("h"),
    now: sequentialClock("2026-05-01T00:00:00.000Z", 1000),
    ...(sink ? { eventSink: sink } : {}),
  });
  if (!built.enabled) throw new Error(built.reason);
  return built.adapter;
}

async function waitFor(predicate: () => boolean, label: string, timeoutMs = 2_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error(`timed out waiting for ${label}`);
}

/* ══════════════════════════════════════════════════════
   A. The deterministic runtime satisfies the async contract
   ══════════════════════════════════════════════════════ */

describe("STEP 4 A — the deterministic runtime satisfies the async contract", () => {
  function runtime() {
    const ids = createSequentialIdFactory("w");
    const now = sequentialClock("2026-05-01T00:00:00.000Z", 1000);
    return new DeterministicRuntimeAdapter({ ids, now });
  }

  it("is recognisable as an AsyncAgentRuntime and behaves like the blocking port", async () => {
    const adapter = runtime();
    expect(isAsyncAgentRuntime(adapter)).toBe(true);

    const handle = await adapter.startJob({ actorId: "a", capabilityId: "c", traceId: "t" });
    expect(handle.status).toBe("SUCCEEDED");
    const record = await adapter.waitForExecution(handle.handleId);
    expect(record.status).toBe("SUCCEEDED");
    expect(record.completedAt).toBeTruthy();
    expect(isTerminalExecutionStatus(record.status)).toBe(true);
  });

  it("returns the SAME execution for a retried submit — no duplicate run", async () => {
    const adapter = runtime();
    const first = await adapter.startJob({ actorId: "a", capabilityId: "c", jobId: "job_1", traceId: "t" });
    const second = await adapter.startJob({ actorId: "a", capabilityId: "c", jobId: "job_1", traceId: "t" });

    expect(second.handleId).toBe(first.handleId);
    expect((await adapter.getExecution(second.handleId))?.replayed).toBe(true);
    // A different job is a different execution.
    const other = await adapter.startJob({ actorId: "a", capabilityId: "c", jobId: "job_2", traceId: "t" });
    expect(other.handleId).not.toBe(first.handleId);
  });

  it("exposes ordered per-execution events", async () => {
    const adapter = runtime();
    const handle = await adapter.startJob({ actorId: "a", capabilityId: "c", traceId: "t" });
    const events = await adapter.executionEvents(handle.handleId);
    expect(events.map((event) => event.type)).toEqual(["SUBMITTED", "COMPLETED"]);
    expect(events.map((event) => event.seq)).toEqual([1, 2]);
    expect(events.every((event) => event.runtimeId === adapter.identity.id)).toBe(true);
  });

  it("cancels through the port and never invents a state for an unknown handle", async () => {
    const adapter = runtime();
    const handle = await adapter.startJob({ actorId: "a", capabilityId: "c", traceId: "t" });
    expect((await adapter.cancelJob(handle.handleId, "step4")).status).toBe("CANCELLED");
    await expect(adapter.waitForExecution("nope")).rejects.toThrow(/no handle|no execution/i);
  });
});

/* ══════════════════════════════════════════════════════
   B. The async life cycle on the Hermes adapter
   ══════════════════════════════════════════════════════ */

describe("STEP 4 B — Hermes adapter: in-flight status, wait, cancel, idempotency", () => {
  it("startJob returns an ACCEPTED handle while the run is still alive", async () => {
    const transport = new CountingTransport(new DeterministicHermesTransport({ holdCompletionMs: 200 }));
    const { adapter } = deterministicAdapter(transport);
    expect(isAsyncAgentRuntime(adapter)).toBe(true);
    expect(adapter.identity.metadata.supportsAsync).toBe(true);

    const handle = await adapter.startJob({ actorId: ACTOR_ID, capabilityId: CAPABILITY_ID, traceId: "t" });
    expect(handle.status).toBe("ACCEPTED");
    expect(handle.handleId).toBe("exec_0001");

    // Status is observable DURING the run, without asking the provider again.
    expect((await adapter.getExecutionStatus(handle.handleId)).status).toBe("ACCEPTED");
    expect(transport.statusCalls).toBe(0);
    expect((await adapter.executionEvents(handle.handleId)).map((event) => event.type)).toEqual(["SUBMITTED"]);

    const record = await adapter.waitForExecution(handle.handleId);
    expect(record.status).toBe("SUCCEEDED");
    expect((await adapter.getExecutionStatus(handle.handleId)).status).toBe("SUCCEEDED");
  });

  it("answers a retried submit from the SAME handle, starting exactly one run", async () => {
    const transport = new CountingTransport(new DeterministicHermesTransport());
    const events: RuntimeEvent[] = [];
    const { adapter } = deterministicAdapter(transport, (event) => events.push(event));

    const request = { actorId: ACTOR_ID, capabilityId: CAPABILITY_ID, jobId: "job_retry", traceId: "t" };
    const first = await adapter.startJob(request);
    const second = await adapter.startJob(request);

    // The proof: exactly ONE real run was ever started, and both calls name it.
    expect(transport.startCalls).toBe(1);
    expect(second.handleId).toBe(first.handleId);
    expect((await adapter.getExecution(second.handleId))?.replayed).toBe(true);

    // The replay is visible in the audit trail and is distinguishable from the
    // original submit.
    const submits = events.filter((event) => event.type === "runtime.submit");
    expect(submits).toHaveLength(2);
    expect(submits[1]?.detail).toMatch(/replayed idempotency key/);
  });

  it("cancels an IN-FLIGHT execution through the port, and a late completion cannot overwrite it", async () => {
    const transport = new CountingTransport(new DeterministicHermesTransport({ holdCompletionMs: 120 }));
    const { adapter } = deterministicAdapter(transport);

    const handle = await adapter.startJob({ actorId: ACTOR_ID, capabilityId: CAPABILITY_ID, traceId: "t" });
    expect(handle.status).toBe("ACCEPTED");

    const cancelled = await adapter.cancelJob(handle.handleId, "step4 in-flight");
    expect(cancelled.status).toBe("CANCELLED");
    expect(transport.cancelCalls).toBe(1);

    // Give the run's own completion every chance to arrive and be WRONG.
    await new Promise((resolve) => setTimeout(resolve, 220));
    expect((await adapter.waitForExecution(handle.handleId)).status).toBe("CANCELLED");
    const types = (await adapter.executionEvents(handle.handleId)).map((event) => event.type);
    expect(types).toContain("CANCELLED");
    expect(types).not.toContain("COMPLETED");
  });

  it("a wait timeout throws RUNTIME_TIMEOUT and does NOT cancel the execution", async () => {
    const transport = new CountingTransport(new DeterministicHermesTransport({ holdCompletionMs: 150 }));
    const { adapter } = deterministicAdapter(transport);

    const handle = await adapter.startJob({ actorId: ACTOR_ID, capabilityId: CAPABILITY_ID, traceId: "t" });

    await expect(adapter.waitForExecution(handle.handleId, { timeoutMs: 30 })).rejects.toMatchObject({
      code: "RUNTIME_TIMEOUT",
    });
    // Still running, still cancellable, still observable — the wait abandoned
    // the CALLER, not the execution.
    expect((await adapter.getExecutionStatus(handle.handleId)).status).toBe("ACCEPTED");
    expect(transport.cancelCalls).toBe(0);
    expect((await adapter.waitForExecution(handle.handleId)).status).toBe("SUCCEEDED");
  });

  it("keeps a transport-level failure FAILED and retryable, through the async path", async () => {
    const transport = new CountingTransport(new DeterministicHermesTransport({ failWith: "UNAVAILABLE" }));
    const { adapter } = deterministicAdapter(transport);
    const handle = await adapter.startJob({ actorId: ACTOR_ID, capabilityId: CAPABILITY_ID, traceId: "t" });
    const record = await adapter.waitForExecution(handle.handleId);
    expect(record.status).toBe("FAILED");
    expect(record.error?.category).toBe("TRANSPORT");
    expect(record.error?.retryable).toBe(true);
    expect(transport.startCalls).toBe(1);
  });
});

/* ══════════════════════════════════════════════════════
   C. The real bridge transport, non-blocking, offline
   ══════════════════════════════════════════════════════ */

describe("STEP 4 C — the bridge transport starts a run without waiting for it", () => {
  it("returns the bridge's run id at once, answers status in flight, and cancels in flight", async () => {
    const double = bridgeRunDouble({ holdUntilCancel: true });
    const adapter = bridgeAdapter(double.fetchImpl);
    expect(adapter.identity.metadata.supportsAsync).toBe(true);

    const handle = await adapter.startJob({ actorId: ACTOR_ID, capabilityId: CAPABILITY_ID, traceId: "t" });
    // The handle is the bridge's OWN run id — the only id its routes accept.
    expect(handle.handleId).toBe(BRIDGE_RUN_ID);
    expect(handle.status).toBe("ACCEPTED");

    // In flight: status comes from the state WE own, so no extra provider call.
    await waitFor(() => double.calls.some((call) => call.path.endsWith("/stream")), "the run's stream");
    const callsBefore = double.calls.length;
    expect((await adapter.getExecutionStatus(handle.handleId)).status).toBe("ACCEPTED");
    expect(double.calls.length).toBe(callsBefore);

    // Cancel through the PORT (never by hand), while the run is alive.
    const cancelled = await adapter.cancelJob(handle.handleId, "step4 in-flight cancel");
    expect(cancelled.status).toBe("CANCELLED");
    expect(double.calls.some((call) => call.method === "POST" && call.path === `/v1/runs/${BRIDGE_RUN_ID}/cancel`)).toBe(true);

    const settled = await adapter.waitForExecution(handle.handleId);
    expect(settled.status).toBe("CANCELLED");
    // The Hermes session the run used is preserved as provider metadata...
    expect(settled.providerExecutionId).toBe(SESSION_ID);
    // ...and was NEVER used as a handle.
    expect(double.calls.some((call) => call.path === `/v1/runs/${SESSION_ID}`)).toBe(false);
  });

  it("completes a background run and reads the result back with its own route", async () => {
    const double = bridgeRunDouble({ terminalDelayMs: 40 });
    const adapter = bridgeAdapter(double.fetchImpl);

    const handle = await adapter.startJob({
      actorId: ACTOR_ID,
      capabilityId: CAPABILITY_ID,
      traceId: "t",
      input: { instruction: INSTRUCTION },
    });
    expect(handle.status).toBe("ACCEPTED");

    const settled = await adapter.waitForExecution(handle.handleId);
    expect(settled.status).toBe("SUCCEEDED");
    expect(settled.providerExecutionId).toBe(SESSION_ID);
    expect(`${settled.outputText ?? ""}${JSON.stringify(settled.output ?? {})}`).toContain(MARKER);

    expect((await adapter.getExecutionStatus(handle.handleId)).status).toBe("SUCCEEDED");
    expect(double.calls.some((call) => call.method === "GET" && call.path === `/v1/runs/${BRIDGE_RUN_ID}`)).toBe(true);
  });
});

/* ══════════════════════════════════════════════════════
   D. Isolation and refusal
   ══════════════════════════════════════════════════════ */

describe("STEP 4 D — the chain refuses what it must", () => {
  async function wired(fetchImpl: typeof fetch) {
    const domain = createWorkforceDomain({
      ids: createSequentialIdFactory("w"),
      now: sequentialClock("2026-05-01T00:00:00.000Z", 1000),
    });
    const built = await bootstrapStrategyAnalyst(domain, { runtime: bridgeAdapter(fetchImpl) });
    if (!built.enabled) throw new Error(built.reason);
    const dispatcher = new AgentRuntimeDispatcher({
      runtimes: domain.runtimes,
      actors: domain.actors,
      assignments: domain.assignments,
    });
    return { domain, dispatcher, runtimeId: built.runtimeId };
  }

  it("registers a REAL actor with a real capability assignment and runtime binding", async () => {
    const { domain, runtimeId } = await wired(bridgeRunDouble().fetchImpl);
    // A genuine Actor Registry actor, resolvable by slug.
    const actor = await domain.actors.resolve("internal-strategy-analyst");
    expect(actor.id).toBe(ACTOR_ID);
    expect(actor.type).toBe("AI_AGENT");
    expect(actor.lifecycle).toBe("SHADOW");
    expect(actor.runtimeBinding?.runtimeId).toBe(runtimeId);
    expect(actor.runtimeBinding?.profileRef).toBe("saieed");
    // The capability is a separate, revocable edge.
    expect(domain.assignments.hasCapability(actor.id, CAPABILITY_ID, STRATEGY_INTERNAL_BRIEF_CAPABILITY_VERSION)).toBe(true);
    // The registry resolves the runtime for that actor.
    expect(domain.runtimes.runtimeForActor(actor)?.identity.id).toBe(runtimeId);
    // And it is NOT autonomous: a human stays the authority.
    expect(actor.autonomyLevel).toBe("ASSISTED");
    expect(actor.approvalPolicy.mode).toBe("RISK_AT_LEAST");
    expect(actor.escalationTarget).toBe("actor_founder");
  });

  it("refuses a capability the actor was never assigned, before any transport call", async () => {
    const double = bridgeRunDouble();
    const { dispatcher, runtimeId } = await wired(double.fetchImpl);
    const outcome = await dispatcher.startJob({
      actorId: ACTOR_ID,
      runtimeId,
      capabilityId: "strategy.publish",
      jobId: "job_unassigned",
      traceId: "t",
    });
    expect(outcome.dispatched).toBe(false);
    expect(outcome.reason).toBe("CAPABILITY_NOT_ASSIGNED");
    expect(outcome.error?.code).toBe("PERMISSION_DENIED");
    expect(double.calls).toHaveLength(0);
  });

  it("refuses to move the actor to a runtime it is not bound to (runtime isolation)", async () => {
    const double = bridgeRunDouble();
    const { domain, dispatcher } = await wired(double.fetchImpl);
    domain.runtimes.register(new DeterministicRuntimeAdapter({ ids: domain.ids, now: domain.now }));

    const outcome = await dispatcher.startJob({
      actorId: ACTOR_ID,
      runtimeId: "runtime_deterministic",
      capabilityId: CAPABILITY_ID,
      traceId: "t",
    });
    expect(outcome.dispatched).toBe(false);
    expect(outcome.reason).toBe("RUNTIME_NOT_BOUND_TO_ACTOR");
    expect(double.calls).toHaveLength(0);
  });

  it("cannot observe a handle on a runtime that did not mint it", async () => {
    const double = bridgeRunDouble({ terminalDelayMs: 400 });
    const { domain, dispatcher, runtimeId } = await wired(double.fetchImpl);
    domain.runtimes.register(new DeterministicRuntimeAdapter({ ids: domain.ids, now: domain.now }));

    const started = await dispatcher.startJob({
      actorId: ACTOR_ID,
      runtimeId,
      capabilityId: CAPABILITY_ID,
      jobId: "job_iso",
      traceId: "t",
    });
    expect(started.dispatched).toBe(true);

    const crossRuntime = await dispatcher.getExecution({
      runtimeId: "runtime_deterministic",
      handleId: started.handle!.handleId,
    });
    expect(crossRuntime.dispatched).toBe(false);
    expect(crossRuntime.error?.code).toBe("RUN_NOT_FOUND");
    await dispatcher.cancelJob({ runtimeId, handleId: started.handle!.handleId }, "cleanup");
  });

  it("never sends a human actor to a machine runtime", async () => {
    const { domain, dispatcher, runtimeId } = await wired(bridgeRunDouble().fetchImpl);
    await domain.actors.register(founderActorRegistration());

    const outcome = await dispatcher.startJob({
      actorId: "actor_founder",
      runtimeId,
      capabilityId: CAPABILITY_ID,
      traceId: "t",
    });
    expect(outcome.dispatched).toBe(false);
    expect(outcome.reason).toBe("HUMAN_ACTOR");
  });

  it("refuses the default profile, and only ever addresses the configured one", () => {
    const base = {
      HERMES_RUNTIME_TRANSPORT: "BRIDGE",
      HERMES_RUNTIME_BRIDGE_URL: "https://bridge.invalid",
      HERMES_RUNTIME_BRIDGE_SECRET: "s3cret",
    };
    // `default` is refused in the environment resolution: there is no runtime to
    // build, so there is no request to leak.
    const refused = resolveHermesConfig({ ...base, HERMES_RUNTIME_PROFILE: "default" });
    expect(refused.enabled).toBe(false);
    if (!refused.enabled) expect(refused.reason).toMatch(/forbidden/i);

    // The runtime carries exactly the CONFIGURED profile, as an opaque ref.
    const configured = resolveHermesConfig({ ...base, HERMES_RUNTIME_PROFILE: "saieed" });
    expect(configured.enabled).toBe(true);
    if (!configured.enabled) return;
    const adapter = createHermesRuntime(configured.config, {
      transport: new DeterministicHermesTransport(),
      allowTestTransport: true,
    });
    expect(adapter.identity.metadata.profileRef).toBe("saieed");
  });
});

/* ══════════════════════════════════════════════════════
   E. The full chain, offline, through the real bridge transport
   ══════════════════════════════════════════════════════ */

describe("STEP 4 E — Actor → assignment → runtime → adapter → bridge transport → result", () => {
  it("carries a real task through the whole chain and attributes the result", async () => {
    const double = bridgeRunDouble({ terminalDelayMs: 250 });
    const events: RuntimeEvent[] = [];
    const domain = createWorkforceDomain({
      ids: createSequentialIdFactory("w"),
      now: sequentialClock("2026-05-01T00:00:00.000Z", 1000),
    });
    const built = await bootstrapStrategyAnalyst(domain, {
      runtime: bridgeAdapter(double.fetchImpl, (event) => events.push(event)),
    });
    if (!built.enabled) throw new Error(built.reason);

    const dispatcher = new AgentRuntimeDispatcher({
      runtimes: domain.runtimes,
      actors: domain.actors,
      assignments: domain.assignments,
    });

    const started = await dispatcher.startJob({
      actorId: built.actorId,
      runtimeId: built.runtimeId,
      capabilityId: CAPABILITY_ID,
      capabilityVersion: STRATEGY_INTERNAL_BRIEF_CAPABILITY_VERSION,
      jobId: "job_strategy_brief_1",
      traceId: "step4-chain",
      input: { instruction: INSTRUCTION },
    });
    expect(started.dispatched).toBe(true);
    expect(started.handle?.status).toBe("ACCEPTED");

    // Status works DURING the execution.
    const during = await dispatcher.getExecution({ runtimeId: built.runtimeId, handleId: started.handle!.handleId });
    expect(during.dispatched).toBe(true);
    expect(during.status).toBe("ACCEPTED");

    const settled = await dispatcher.waitForExecution({
      runtimeId: built.runtimeId,
      handleId: started.handle!.handleId,
    });
    expect(settled.dispatched).toBe(true);
    expect(settled.status).toBe("SUCCEEDED");

    // Nothing about the result is anonymous.
    const record = settled.execution!;
    expect(record.runtimeId).toBe(built.runtimeId);
    expect(record.actorId).toBe(ACTOR_ID);
    expect(record.capabilityId).toBe(CAPABILITY_ID);
    expect(record.handleId).toBe(BRIDGE_RUN_ID);
    expect(record.providerExecutionId).toBe(SESSION_ID);
    expect(record.idempotencyKey).toBe("job:job_strategy_brief_1");
    expect(record.submittedAt).toBeTruthy();
    expect(record.completedAt).toBeTruthy();
    expect(`${record.outputText ?? ""}${JSON.stringify(record.output ?? {})}`).toContain(MARKER);

    // A structured audit trail exists, naming the same execution.
    const types = events.map((event) => event.type);
    expect(types).toContain("runtime.submit");
    expect(types).toContain("runtime.completed");
    expect(events.every((event) => event.profile === "saieed")).toBe(true);

    // And exactly one real run was created for that job, however many times the
    // caller asks for it.
    const replay = await dispatcher.startJob({
      actorId: built.actorId,
      runtimeId: built.runtimeId,
      capabilityId: CAPABILITY_ID,
      jobId: "job_strategy_brief_1",
      traceId: "step4-chain-retry",
      input: { instruction: INSTRUCTION },
    });
    expect(replay.handle?.handleId).toBe(BRIDGE_RUN_ID);
    expect(double.calls.filter((call) => call.method === "POST" && call.path === "/v1/runs")).toHaveLength(1);
  });
});

/* ══════════════════════════════════════════════════════
   H. LIVE — one real execution through the real actor
   ══════════════════════════════════════════════════════ */

const liveRequested = process.env.NEXUP_BRIDGE_E2E === "1";

describe.skipIf(!liveRequested)("STEP 4 H — the real actor, the real bridge", () => {
  it(
    "runs one harmless task and records who, where and how it finished",
    async () => {
      const domain = createWorkforceDomain({ ids: createSequentialIdFactory("w") });
      const events: RuntimeEvent[] = [];
      const runtime = createHermesRuntimeFromEnv(process.env, { eventSink: (event) => events.push(event) });
      if (!runtime.enabled) throw new Error(runtime.reason);
      const built = await bootstrapStrategyAnalyst(domain, { runtime: runtime.adapter });
      if (!built.enabled) throw new Error(built.reason);

      const dispatcher = new AgentRuntimeDispatcher({
        runtimes: domain.runtimes,
        actors: domain.actors,
        assignments: domain.assignments,
      });

      const startedAt = Date.now();
      const started = await dispatcher.startJob({
        actorId: built.actorId,
        runtimeId: built.runtimeId,
        capabilityId: CAPABILITY_ID,
        capabilityVersion: STRATEGY_INTERNAL_BRIEF_CAPABILITY_VERSION,
        jobId: `job_step4_live_${Date.now()}`,
        traceId: "step4-live",
        input: { instruction: INSTRUCTION },
      });
      if (!started.dispatched) throw new Error(JSON.stringify(started.error ?? started.reason));

      const handleId = started.handle!.handleId;
      const acceptedMs = Date.now() - startedAt;
      const during = await dispatcher.getExecution({ runtimeId: built.runtimeId, handleId });

      const settled = await dispatcher.waitForExecution({ runtimeId: built.runtimeId, handleId });
      const wallMs = Date.now() - startedAt;
      const record = settled.execution!;
      const text = `${record.outputText ?? ""}${JSON.stringify(record.output ?? {})}`;
      const actor = await domain.actors.resolve(built.actorId);
      const runtimeIdentity = domain.runtimes.require(built.runtimeId).identity;

      console.log(
        `[step4-audit] ${JSON.stringify({
          step: "4",
          at: new Date().toISOString(),
          actorId: record.actorId,
          actorSlug: actor.slug,
          actorLifecycle: actor.lifecycle,
          runtimeId: record.runtimeId,
          runtimeType: runtimeIdentity.type,
          capabilityId: record.capabilityId,
          assignmentId: built.assignmentId,
          handleId: record.handleId,
          providerExecutionId: record.providerExecutionId ?? null,
          statusDuring: during.status,
          statusFinal: record.status,
          submittedAt: record.submittedAt,
          completedAt: record.completedAt ?? null,
          acceptedMs,
          wallMs,
          markerFound: text.includes(MARKER),
          idempotencyKey: record.idempotencyKey ?? null,
          eventTypes: [...new Set(events.map((event) => event.type))],
          outputPreview: text.slice(0, 200),
        })}`,
      );

      expect(started.handle?.status).not.toBe("FAILED");
      expect(record.status).toBe("SUCCEEDED");
      expect(record.handleId).toBeTruthy();
      expect(record.providerExecutionId).toBeTruthy();
      expect(text).toContain(MARKER);
      expect(record.actorId).toBe(ACTOR_ID);
      expect(events.every((event) => event.profile === "saieed")).toBe(true);
    },
    180_000,
  );
});
