import { describe, expect, it } from "vitest";

import {
  DEFAULT_HERMES_RPC_PROTOCOL,
  HERMES_RPC_METHODS,
  type HermesRpcProtocol,
} from "@/modules/workforce/runtimes/hermes/hermes-protocol";
import type {
  HermesWebSocketEvent,
  HermesWebSocketFactory,
  HermesWebSocketLike,
} from "@/modules/workforce/runtimes/hermes/hermes-rpc-transport";
import type { HermesTransportRequest } from "@/modules/workforce/runtimes/hermes/hermes-transport";

import { BridgeError } from "../src/api/errors";
import { RunManager } from "../src/hermes/run-manager";
import { Logger } from "../src/observability/logger";
import { Metrics } from "../src/observability/metrics";
import { BRIDGE_ALLOWED_HERMES_METHODS } from "../src/hermes/allowlist";
import { createBridgeTransportFactory } from "../src/hermes/client";
import { assertOperationMethodsAllowed, hermesMethodsForOperation } from "../src/hermes/method-guard";
import { waitFor } from "./helpers";

/*
 * F5 — the Hermes method allowlist must be enforced AT RUNTIME on the outbound
 * path, not merely by construction or by the pure-function tests in
 * `security.test.ts`. These tests drive the real bridge transport factory (and
 * a real RunManager) and prove a non-allowlisted method is refused before a
 * single frame reaches the socket.
 */

type RpcFrame = {
  jsonrpc?: string;
  id?: string | number;
  method?: string;
  params?: Record<string, unknown>;
  result?: unknown;
  error?: { code: number; message: string };
};

/** Minimal in-memory WebSocket whose "server" is a callback per request. */
class FakeWebSocket implements HermesWebSocketLike {
  readyState = 0;
  readonly received: RpcFrame[] = [];
  private readonly listeners: Record<string, ((event: HermesWebSocketEvent) => void)[]> = {};

  constructor(private readonly server?: (frame: RpcFrame, socket: FakeWebSocket) => void) {
    queueMicrotask(() => {
      this.readyState = 1;
      this.emit("open", {});
      this.notify({ type: "gateway.ready", payload: { change_events: true } });
    });
  }

  addEventListener(type: "open" | "message" | "close" | "error", listener: (event: HermesWebSocketEvent) => void): void {
    (this.listeners[type] ??= []).push(listener);
  }

  send(data: string): void {
    const frame = JSON.parse(data) as RpcFrame;
    this.received.push(frame);
    this.server?.(frame, this);
  }

  close(): void {
    this.readyState = 3;
    this.emit("close", {});
  }

  reply(id: string | number, result: unknown): void {
    this.deliver({ jsonrpc: "2.0", id, result });
  }

  notify(params: Record<string, unknown>): void {
    this.deliver({ jsonrpc: "2.0", method: "event", params });
  }

  deliver(frame: RpcFrame): void {
    this.emit("message", { data: JSON.stringify(frame) });
  }

  private emit(type: string, event: HermesWebSocketEvent): void {
    for (const listener of this.listeners[type] ?? []) listener(event);
  }
}

/** A well-behaved Hermes stand-in that completes a turn. */
function completingServer(): (frame: RpcFrame, socket: FakeWebSocket) => void {
  return (frame, socket) => {
    if (frame.method === DEFAULT_HERMES_RPC_PROTOCOL.methods.sessionCreate) {
      socket.reply(frame.id as string, { session_id: "sess_1" });
      return;
    }
    if (frame.method === DEFAULT_HERMES_RPC_PROTOCOL.methods.promptSubmit) {
      socket.reply(frame.id as string, {});
      socket.notify({
        type: DEFAULT_HERMES_RPC_PROTOCOL.completeEvent,
        session_id: "sess_1",
        payload: { text: "done", status: "succeeded" },
      });
    }
  };
}

function bridgeFactory(options: { protocol?: HermesRpcProtocol; server?: (frame: RpcFrame, socket: FakeWebSocket) => void } = {}) {
  let socket: FakeWebSocket | null = null;
  const webSocketFactory: HermesWebSocketFactory = () => {
    socket = new FakeWebSocket(options.server);
    return socket;
  };
  const factory = createBridgeTransportFactory({
    rpcUrl: "ws://127.0.0.1:9119/api/ws",
    sessionToken: "session-token-value",
    profile: "saieed",
    origin: "http://127.0.0.1:9119",
    ...(options.protocol ? { protocol: options.protocol } : {}),
    webSocketFactory,
  });
  return { factory, getSocket: () => socket };
}

function tampered(patch: Partial<HermesRpcProtocol["methods"]>): HermesRpcProtocol {
  return { ...DEFAULT_HERMES_RPC_PROTOCOL, methods: { ...DEFAULT_HERMES_RPC_PROTOCOL.methods, ...patch } };
}

const submitRequest: HermesTransportRequest = {
  operation: "submit",
  profile: "saieed",
  payload: { instruction: "do the thing", contextJson: "{}" },
  timeoutMs: 2_000,
  maxOutputBytes: 8_192,
  correlation: { actorId: "actor_1", traceId: "trace_1" },
};

describe("F5.1 every currently-used bridge Hermes method is allowlisted", () => {
  it("covers each bridge operation's derived method plan", () => {
    for (const operation of ["health", "submit", "status", "cancel"]) {
      const methods = hermesMethodsForOperation(operation);
      expect(methods.length).toBeGreaterThan(0);
      for (const method of methods) expect(BRIDGE_ALLOWED_HERMES_METHODS).toContain(method);
    }
  });

  it("covers the hard-coded run sequence and gateway.ping", () => {
    for (const method of [
      HERMES_RPC_METHODS.health,
      HERMES_RPC_METHODS.sessionCreate,
      HERMES_RPC_METHODS.promptSubmit,
      HERMES_RPC_METHODS.sessionStatus,
      HERMES_RPC_METHODS.sessionInterrupt,
    ]) {
      expect(BRIDGE_ALLOWED_HERMES_METHODS).toContain(method);
    }
  });

  it("emits exactly the allowlisted methods on the wire for a real run", async () => {
    const { factory, getSocket } = bridgeFactory({ server: completingServer() });
    const transport = factory({});
    const result = await transport.invoke(submitRequest);
    expect(result.ok).toBe(true);
    const sent = (getSocket()?.received ?? []).map((frame) => frame.method);
    expect(sent).toEqual([HERMES_RPC_METHODS.sessionCreate, HERMES_RPC_METHODS.promptSubmit]);
    for (const method of sent) expect(BRIDGE_ALLOWED_HERMES_METHODS).toContain(method);
    (transport as { close?: () => void }).close?.();
  });
});

describe("F5.2 llm.oneshot is rejected at runtime", () => {
  it("refuses a run whose protocol would emit llm.oneshot, before any frame is sent", async () => {
    const { factory, getSocket } = bridgeFactory({
      protocol: tampered({ promptSubmit: HERMES_RPC_METHODS.llmOneshot }),
    });
    const transport = factory({});
    await expect(transport.invoke(submitRequest)).rejects.toMatchObject({
      name: "BridgeError",
      code: "METHOD_NOT_ALLOWED",
    });
    // The guard runs BEFORE the delegate connects: nothing reached a socket.
    expect(getSocket()).toBeNull();
  });
});

describe("F5.3 an arbitrary method is rejected at runtime", () => {
  it("refuses a drifted session.create (e.g. shell.exec)", async () => {
    const { factory, getSocket } = bridgeFactory({ protocol: tampered({ sessionCreate: "shell.exec" }) });
    await expect(factory({}).invoke(submitRequest)).rejects.toBeInstanceOf(BridgeError);
    expect(getSocket()).toBeNull();
  });

  it("refuses an unknown operation that would emit no allowlisted method", async () => {
    const { factory, getSocket } = bridgeFactory({ server: completingServer() });
    await expect(factory({}).invoke({ ...submitRequest, operation: "resume" as never })).rejects.toMatchObject({
      code: "METHOD_NOT_ALLOWED",
    });
    expect(getSocket()).toBeNull();
    expect(() => assertOperationMethodsAllowed("delete-everything")).toThrow(BridgeError);
  });
});

describe("F5.4 the runtime guard is exercised on the outbound path", () => {
  it("blocks a tampered protocol end-to-end through RunManager with METHOD_NOT_ALLOWED", async () => {
    const { factory, getSocket } = bridgeFactory({
      protocol: tampered({ promptSubmit: HERMES_RPC_METHODS.llmOneshot }),
    });
    const manager = new RunManager({
      profile: "saieed",
      timeoutMs: 2_000,
      maxOutputBytes: 8_192,
      maxConcurrency: 2,
      transportFactory: factory,
      logger: new Logger({ sink: () => {}, level: "error" }),
      metrics: new Metrics(),
    });
    const record = manager.submit({
      keyId: "nexup-vercel",
      instruction: "do the thing",
      correlation: { actorId: "actor_1", traceId: "trace_1" },
    });
    await waitFor(() => record.status === "FAILED");
    expect(record.errorCode).toBe("METHOD_NOT_ALLOWED");
    expect(record.events.at(-1)?.event).toBe("error");
    expect(getSocket()).toBeNull();
  });

  it("lets the same RunManager complete a normal run (guard does not block allowlisted methods)", async () => {
    const { factory, getSocket } = bridgeFactory({ server: completingServer() });
    const manager = new RunManager({
      profile: "saieed",
      timeoutMs: 2_000,
      maxOutputBytes: 8_192,
      maxConcurrency: 2,
      transportFactory: factory,
      logger: new Logger({ sink: () => {}, level: "error" }),
      metrics: new Metrics(),
    });
    const record = manager.submit({
      keyId: "nexup-vercel",
      instruction: "do the thing",
      correlation: { actorId: "actor_1", traceId: "trace_1" },
    });
    await waitFor(() => record.status === "COMPLETED");
    expect((getSocket()?.received ?? []).map((frame) => frame.method)).toEqual([
      HERMES_RPC_METHODS.sessionCreate,
      HERMES_RPC_METHODS.promptSubmit,
    ]);
  });
});
