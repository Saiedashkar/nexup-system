import { describe, expect, it } from "vitest";

import { BridgeError } from "../src/api/errors";
import { RunManager } from "../src/hermes/run-manager";
import { AuditLog, createMemoryAuditSink } from "../src/observability/audit";
import { Logger } from "../src/observability/logger";
import { Metrics } from "../src/observability/metrics";
import { fakeFactory, waitFor, type FakeBehavior } from "./helpers";

function makeManager(behavior: FakeBehavior, overrides: Partial<ConstructorParameters<typeof RunManager>[0]> = {}) {
  const metrics = new Metrics();
  const logger = new Logger({ sink: () => {}, level: "error" });
  const manager = new RunManager({
    profile: "saieed",
    timeoutMs: 5_000,
    maxOutputBytes: 8_192,
    maxConcurrency: 4,
    transportFactory: fakeFactory(behavior),
    logger,
    metrics,
    ...overrides,
  });
  return { manager, metrics };
}

const spec = { keyId: "nexup-vercel", instruction: "do the thing", correlation: { actorId: "actor_1", traceId: "trace_1" } };

describe("RunManager — lifecycle", () => {
  it("streams deltas and completes on the terminal result, not on text", async () => {
    const { manager } = makeManager({
      deltas: ["Hello ", "world"],
      complete: { status: "succeeded", text: "Hello world" },
    });
    const record = manager.submit(spec);
    await waitFor(() => record.status === "COMPLETED");
    expect(record.events.map((event) => event.event)).toEqual(["delta", "delta", "complete"]);
    expect(record.bytesOut).toBe(Buffer.byteLength("Hello world", "utf8"));
    expect(record.executionId).toBe("sess_1");
    expect(record.endedAt).toBeDefined();
  });

  it("marks a transport failure as FAILED with a mapped error code", async () => {
    const { manager } = makeManager({ failWith: "TIMEOUT" });
    const record = manager.submit(spec);
    await waitFor(() => record.status === "FAILED");
    expect(record.errorCode).toBe("HERMES_TIMEOUT");
    expect(record.events.at(-1)?.event).toBe("error");
  });

  it("marks a provider-reported failed turn as FAILED (protocol error)", async () => {
    const { manager } = makeManager({ complete: { status: "failed", error: "provider said no" } });
    const record = manager.submit(spec);
    await waitFor(() => record.status === "FAILED");
    expect(record.errorCode).toBe("HERMES_PROTOCOL_ERROR");
    expect(record.events.at(-1)?.data.message).toBe("provider said no");
  });

  it("bounds concurrency, rejecting excess rather than queueing", async () => {
    const { manager } = makeManager({ delayMs: 40 }, { maxConcurrency: 1 });
    manager.submit(spec);
    expect(() => manager.submit(spec)).toThrow(BridgeError);
    try {
      manager.submit(spec);
    } catch (error) {
      expect((error as BridgeError).code).toBe("RATE_LIMITED");
    }
  });

  it("cancels through the transport and emits a terminal complete frame", async () => {
    const operations: string[] = [];
    const { manager } = makeManager({ delayMs: 30, onInvoke: (request) => operations.push(request.operation) });
    const record = manager.submit(spec);
    await manager.abort(record.runId);
    expect(record.status).toBe("CANCELLED");
    expect(record.events.at(-1)).toEqual({
      event: "complete",
      data: { status: "cancelled", executionId: "sess_1", reason: "cancelled by request" },
    });
    expect(operations).toContain("cancel");
  });

  it("replays buffered events to a late subscriber", async () => {
    const { manager } = makeManager({ deltas: ["a", "b"] });
    const record = manager.submit(spec);
    await waitFor(() => record.status === "COMPLETED");
    const seen: string[] = [];
    manager.subscribe(record.runId, (event) => seen.push(event.event));
    expect(seen).toEqual(["delta", "delta", "complete"]);
  });

  it("reports health, and unavailable when the transport fails", async () => {
    const healthy = makeManager({ health: { status: "healthy", detail: "gateway.ready" } });
    expect((await healthy.manager.health()).status).toBe("healthy");
    const down = makeManager({ failWith: "UNAVAILABLE" });
    expect((await down.manager.health()).status).toBe("unavailable");
  });

  it("rejects an unknown run on abort", async () => {
    const { manager } = makeManager({});
    await expect(manager.abort("run_missing")).rejects.toThrow(/No run/);
  });

  it("attributes a run outcome to the authenticated key id, not the run id", async () => {
    const sink = createMemoryAuditSink();
    const { manager } = makeManager({ deltas: ["x"] }, { audit: new AuditLog({ sink: sink.sink }) });
    const record = manager.submit(spec);
    await waitFor(() => record.status === "COMPLETED");
    const entry = sink.entries.find((candidate) => candidate.action === "run");
    expect(entry?.keyId).toBe("nexup-vercel");
    expect(entry?.runId).toBe(record.runId);
  });
});
