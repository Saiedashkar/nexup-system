import http from "node:http";

import type { BridgeApp, BridgeRequest } from "./api/app";
import { BridgeError, toErrorEnvelope } from "./api/errors";
import { SseStream, type SseWriter } from "./stream/sse";

/**
 * Node HTTP adapter.
 *
 * Thin by design: it reads a BOUNDED body, builds a `BridgeRequest`, calls the
 * pure application, and writes either a JSON envelope or an SSE stream. All
 * security decisions live in the application layer.
 */

export type BridgeServerOptions = {
  maxBodyBytes: number;
};

function readBody(req: http.IncomingMessage, maxBytes: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let settled = false;

    req.on("data", (chunk: Buffer) => {
      if (settled) return;
      size += chunk.length;
      if (size > maxBytes) {
        // Stop buffering and reject. The socket is NOT destroyed here so the
        // 413 can actually be written; the caller closes the connection.
        settled = true;
        reject(new BridgeError("PAYLOAD_TOO_LARGE", "Request body exceeds the bridge limit"));
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      if (settled) return;
      settled = true;
      resolve(Buffer.concat(chunks).toString("utf8"));
    });
    req.on("error", () => {
      if (settled) return;
      settled = true;
      reject(new BridgeError("BAD_REQUEST", "Failed to read request body"));
    });
  });
}

function writeJson(
  res: http.ServerResponse,
  status: number,
  body: unknown,
  extraHeaders?: Record<string, string>,
): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(payload),
    "cache-control": "no-store",
    ...(extraHeaders ?? {}),
  });
  res.end(payload);
}

export function createBridgeServer(app: BridgeApp, options: BridgeServerOptions): http.Server {
  return http.createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    const path = url.pathname;
    const query = url.search;

    let body = "";
    try {
      body = await readBody(req, options.maxBodyBytes);
    } catch (error) {
      const { status, envelope } = toErrorEnvelope(error);
      // A rejected body leaves unread bytes on the socket, so keep-alive can no
      // longer be trusted for this connection.
      writeJson(res, status, envelope, status === 413 ? { connection: "close" } : undefined);
      return;
    }

    const request: BridgeRequest = {
      method: req.method ?? "GET",
      path,
      headers: req.headers as Record<string, string | undefined>,
      body,
      ...(query ? { query } : {}),
      ...(req.socket.remoteAddress ? { remote: req.socket.remoteAddress } : {}),
    };

    let result;
    try {
      result = await app.handle(request);
    } catch (error) {
      const { status, envelope } = toErrorEnvelope(error);
      writeJson(res, status, envelope);
      return;
    }

    if (result.kind === "json") {
      writeJson(res, result.status, result.body);
      return;
    }

    res.writeHead(result.status, {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      "x-accel-buffering": "no",
      ...result.headers,
    });

    const writer: SseWriter = {
      write: (chunk: string) => {
        res.write(chunk);
      },
      end: () => {
        res.end();
      },
      get finished() {
        return res.writableEnded;
      },
    };

    const stream = new SseStream(writer);
    const cleanup = result.open(stream);

    const onClose = () => {
      stream.close();
      cleanup();
    };
    res.on("close", onClose);
    res.on("error", onClose);
  });
}
