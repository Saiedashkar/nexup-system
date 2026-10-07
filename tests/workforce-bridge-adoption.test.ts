import { describe, expect, it } from "vitest";

import { createHermesRuntime, type HermesRuntimeConfig } from "@/modules/workforce";
import { BridgeClientError } from "@/modules/workforce/runtimes/hermes/bridge-client";
import { HermesBridgeTransport } from "@/modules/workforce/runtimes/hermes/hermes-bridge-transport";

/**
 * RE-ADOPTION ON THE PRODUCTION PATH — no database, no network.
 *
 * The deterministic fixture models a remote that answers 404 for a run it lost.
 * This file proves the PRODUCTION transport actually reports that 404 as
 * knowledge, through the real `HermesBridgeTransport` and a fake bridge client.
 *
 * Why it matters: the bridge answers `404 RUN_NOT_FOUND` for a run it does not
 * know, and the generic error classification turns any unrecognized bridge code
 * into `UNAVAILABLE` — "ask again later". A lost run is not that: it is a fact
 * the platform has to act on, because a human may need to decide whether to
 * retry work that might already have succeeded. So the transport must preserve
 * the 404, and `adoptExecution` must turn it into UNKNOWN.
 */

function config(): HermesRuntimeConfig {
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
  };
}

/** The smallest bridge client that can answer (or refuse) a status read. */
function clientAnswering(runId: string, answer: { status: string } | Error) {
  return {
    async getRun(id: string) {
      if (answer instanceof Error) throw answer;
      if (id !== runId) throw new BridgeClientError("RUN_NOT_FOUND", `No run "${id}"`, 404);
      return { runId: id, status: answer.status, executionId: "session-1" };
    },
    async cancelRun() {
      throw new BridgeClientError("RUN_NOT_FOUND", "no run", 404);
    },
  } as never;
}

function adapterFor(client: unknown) {
  const transport = new HermesBridgeTransport({
    client: client as never,
    profile: "saieed",
  });
  return createHermesRuntime(config(), { transport, allowTestTransport: false });
}

describe("the BRIDGE transport reports a lost run as knowledge, not as an outage", () => {
  it("maps the bridge's 404 RUN_NOT_FOUND to HTTP_ERROR/404 on a status read", async () => {
    const transport = new HermesBridgeTransport({
      client: clientAnswering("run-1", new BridgeClientError("RUN_NOT_FOUND", "No run", 404)) as never,
      profile: "saieed",
    });
    const result = await transport.invoke({
      operation: "status",
      profile: "saieed",
      payload: { instruction: "", contextJson: "{}", executionId: "run-1" },
      timeoutMs: 1_000,
      maxOutputBytes: 1_024,
      correlation: { actorId: "system", traceId: "run-1" },
    });
    expect(result.ok).toBe(false);
    expect(result.transportError).toBe("HTTP_ERROR");
    expect(result.httpStatus).toBe(404);
  });

  it("adopts a run the bridge still knows, and reports the state it gave", async () => {
    const adapter = adapterFor(clientAnswering("run-1", { status: "succeeded" }));
    const adoption = await adapter.adoptExecution({ handleId: "run-1" });
    expect(adoption.kind).toBe("ADOPTED");
    if (adoption.kind !== "ADOPTED") throw new Error("expected an adoption");
    expect(adoption.record.status).toBe("SUCCEEDED");
    expect(adoption.record.handleId).toBe("run-1");
  });

  it("reports a run the bridge does NOT know as UNKNOWN — never as FAILED", async () => {
    const adapter = adapterFor(clientAnswering("run-1", new BridgeClientError("RUN_NOT_FOUND", "No run \"run-1\"", 404)));
    const adoption = await adapter.adoptExecution({ handleId: "run-1" });
    expect(adoption.kind).toBe("UNKNOWN");
    if (adoption.kind !== "UNKNOWN") throw new Error("expected an unknown remote execution");
    expect(adoption.detail).toMatch(/404/);
  });

  it("reports a bridge OUTAGE as retryable UNAVAILABLE — the absence of knowledge", async () => {
    const adapter = adapterFor(clientAnswering("run-1", new BridgeClientError("HERMES_UNAVAILABLE", "bridge down", 503, true)));
    const adoption = await adapter.adoptExecution({ handleId: "run-1" });
    expect(adoption.kind).toBe("UNAVAILABLE");
    if (adoption.kind !== "UNAVAILABLE") throw new Error("expected an outage");
    expect(adoption.retryable).toBe(true);
  });

  it("re-adopting something it already holds makes no second call", async () => {
    let statusReads = 0;
    const client = {
      async getRun(id: string) {
        statusReads += 1;
        return { runId: id, status: "running", executionId: "session-1" };
      },
      async cancelRun() {
        return { runId: "run-1", status: "cancelled" };
      },
    };
    const adapter = adapterFor(client);
    const first = await adapter.adoptExecution({ handleId: "run-1" });
    const second = await adapter.adoptExecution({ handleId: "run-1" });
    expect(first.kind).toBe("ADOPTED");
    expect(second.kind).toBe("ADOPTED");
    // One read, not two: the second adoption answers from what the adapter holds.
    expect(statusReads).toBe(1);
  });
});
