import type { Server } from "node:http";

import { afterEach, describe, expect, it } from "vitest";

import type { BridgeApp, BridgeRequest } from "../src/api/app";
import { createBridgeServer } from "../src/server";

/**
 * HTTP adapter tests. They exercise the real Node server so the wire-level
 * behaviours (cache headers, query propagation, body limit) are tested through
 * the interface the bridge actually exposes.
 */

describe("bridge server adapter", () => {
  const servers: Server[] = [];

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

  function start(app: BridgeApp, maxBodyBytes = 1024): Promise<number> {
    const server = createBridgeServer(app, { maxBodyBytes });
    servers.push(server);
    return new Promise<number>((resolve) => {
      server.listen(0, "127.0.0.1", () => {
        const address = server.address() as { port: number };
        resolve(address.port);
      });
    });
  }

  it("sets Cache-Control: no-store on JSON responses", async () => {
    const app: BridgeApp = {
      async handle() {
        return { kind: "json", status: 200, body: { ok: true } };
      },
    };
    const port = await start(app);
    const response = await fetch(`http://127.0.0.1:${port}/v1/health`);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({ ok: true });
  });

  it("passes the query string to the application so it can be rejected", async () => {
    const seen: BridgeRequest[] = [];
    const app: BridgeApp = {
      async handle(request) {
        seen.push(request);
        return { kind: "json", status: 200, body: {} };
      },
    };
    const port = await start(app);
    await fetch(`http://127.0.0.1:${port}/v1/health?x=1`);
    expect(seen.at(-1)?.query).toBe("?x=1");

    await fetch(`http://127.0.0.1:${port}/v1/health`);
    expect(seen.at(-1)?.query).toBeUndefined();
  });

  it("streams SSE with the headers that keep frames unbuffered, and exact framing", async () => {
    const app: BridgeApp = {
      async handle() {
        return {
          kind: "sse",
          status: 200,
          headers: { "x-nexup-run-id": "run_1" },
          open: (stream) => {
            stream.send("delta", { text: "Hello " });
            stream.send("delta", { text: "world" });
            stream.send("complete", { status: "succeeded", text: "Hello world" });
            stream.close();
            return () => {};
          },
        };
      },
    };
    const port = await start(app);
    const response = await fetch(`http://127.0.0.1:${port}/v1/runs/run_1/stream`);

    expect(response.status).toBe(200);
    // A proxy that buffers the response would defeat live streaming, so these
    // four headers are part of the contract, not cosmetics.
    expect(response.headers.get("content-type")).toBe("text/event-stream; charset=utf-8");
    expect(response.headers.get("cache-control")).toBe("no-cache, no-transform");
    expect(response.headers.get("x-accel-buffering")).toBe("no");
    expect(response.headers.get("x-nexup-run-id")).toBe("run_1");

    expect(await response.text()).toBe(
      'event: delta\ndata: {"text":"Hello "}\n\n' +
        'event: delta\ndata: {"text":"world"}\n\n' +
        'event: complete\ndata: {"status":"succeeded","text":"Hello world"}\n\n',
    );
  });

  it("rejects an oversized body with 413 before buffering without bound", async () => {
    const app: BridgeApp = {
      async handle() {
        return { kind: "json", status: 200, body: {} };
      },
    };
    const port = await start(app, 1024);
    const response = await fetch(`http://127.0.0.1:${port}/v1/runs`, {
      method: "POST",
      body: "x".repeat(8_192),
    });
    expect(response.status).toBe(413);
    const envelope = (await response.json()) as { error: { code: string } };
    expect(envelope.error.code).toBe("PAYLOAD_TOO_LARGE");
  });
});
