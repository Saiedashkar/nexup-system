import { BridgeSigner, type BridgeSignatureHeaders } from "@/modules/workforce/bridge/signing";

/**
 * HermesBridgeClient — the NEXUP (Vercel) side of the trust boundary.
 *
 * It signs every request with the shared HMAC primitive (`@/modules/workforce/
 * bridge/signing`) and speaks the narrow `/v1` bridge API. It never sees the
 * Hermes session token and never talks to Hermes directly: Hermes is loopback
 * only and reachable solely through the bridge.
 *
 * Server-only: it uses the HMAC primitive and must never be imported into a
 * client bundle or an edge runtime.
 */

export type BridgeClientOptions = {
  /** e.g. `https://bridge.hymanna.com` (no trailing slash required). */
  baseUrl: string;
  keyId: string;
  secret: string;
  fetchImpl?: typeof fetch;
  now?: () => Date;
  nonceFactory?: () => string;
  /** Per-request timeout for non-streaming calls. */
  requestTimeoutMs?: number;
};

export type BridgeRunEventName = "delta" | "complete" | "error";

export type BridgeRunEvent = { event: BridgeRunEventName; data: Record<string, unknown> };

export type BridgeSubmitInput = {
  instruction: string;
  contextJson?: string;
  correlation: { jobId?: string; missionId?: string; actorId: string; traceId: string };
  timeoutMs?: number;
};

export type BridgeSubmitResult = { runId: string; streamUrl: string; status: string };

export type BridgeRunStatus = {
  runId: string;
  status: string;
  executionId: string | null;
  startedAt: string;
  endedAt: string | null;
  bytesOut: number;
  errorCode: string | null;
};

export type BridgeHealth = { bridge: string; hermes: string; detail: string; profile: string };

/** Carries the bridge's machine-readable error code and HTTP status. */
export class BridgeClientError extends Error {
  readonly code: string;
  readonly status: number;
  readonly retryable: boolean;

  constructor(code: string, message: string, status: number, retryable = false) {
    super(message);
    this.name = "BridgeClientError";
    this.code = code;
    this.status = status;
    this.retryable = retryable;
  }
}

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

function parseSseFrame(raw: string): { event: string; data: string } | null {
  const lines = raw.split("\n");
  let event = "message";
  const dataLines: string[] = [];
  let sawField = false;
  for (const line of lines) {
    if (line.startsWith(":")) continue; // comment / keep-alive
    if (line.startsWith("event:")) {
      event = line.slice(6).trim();
      sawField = true;
    } else if (line.startsWith("data:")) {
      dataLines.push(line.slice(5).replace(/^ /, ""));
      sawField = true;
    }
  }
  if (!sawField) return null;
  return { event, data: dataLines.join("\n") };
}

async function* parseSseBody(body: ReadableStream<Uint8Array>): AsyncGenerator<{ event: string; data: string }> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let index = buffer.indexOf("\n\n");
      while (index !== -1) {
        const raw = buffer.slice(0, index);
        buffer = buffer.slice(index + 2);
        const frame = parseSseFrame(raw);
        if (frame) yield frame;
        index = buffer.indexOf("\n\n");
      }
    }
    if (buffer.trim()) {
      const frame = parseSseFrame(buffer);
      if (frame) yield frame;
    }
  } finally {
    try {
      await reader.cancel();
    } catch {
      /* the stream may already be closed */
    }
  }
}

export class HermesBridgeClient {
  private readonly baseUrl: string;
  private readonly signer: BridgeSigner;
  private readonly fetchImpl: typeof fetch;
  private readonly requestTimeoutMs: number;

  constructor(options: BridgeClientOptions) {
    if (!options.baseUrl) throw new Error("HermesBridgeClient requires a baseUrl");
    this.baseUrl = trimTrailingSlash(options.baseUrl);
    this.signer = new BridgeSigner({
      keyId: options.keyId,
      secret: options.secret,
      ...(options.now ? { now: options.now } : {}),
      ...(options.nonceFactory ? { nonceFactory: options.nonceFactory } : {}),
    });
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch;
    if (typeof this.fetchImpl !== "function") {
      throw new Error("HermesBridgeClient requires fetch (Node 18+ / Next server runtime)");
    }
    this.requestTimeoutMs = options.requestTimeoutMs ?? 30_000;
  }

  private headers(method: string, path: string, body: string): Record<string, string> {
    const signature: BridgeSignatureHeaders = this.signer.sign({ method, path, body });
    return { ...signature };
  }

  private async callJson<T>(method: string, path: string, body?: Record<string, unknown>): Promise<T> {
    const bodyText = body ? JSON.stringify(body) : "";
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.requestTimeoutMs);
    try {
      const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
        method,
        headers: {
          ...this.headers(method, path, bodyText),
          accept: "application/json",
          ...(body ? { "content-type": "application/json" } : {}),
        },
        body: body ? bodyText : undefined,
        signal: controller.signal,
      });
      const text = await response.text();
      let parsed: unknown = {};
      try {
        parsed = text ? JSON.parse(text) : {};
      } catch {
        parsed = {};
      }
      if (!response.ok) {
        const envelope = parsed as { error?: { code?: string; message?: string; retryable?: boolean } };
        throw new BridgeClientError(
          envelope.error?.code ?? "INTERNAL",
          envelope.error?.message ?? `Bridge request failed (${response.status})`,
          response.status,
          envelope.error?.retryable ?? false,
        );
      }
      return parsed as T;
    } catch (error) {
      if (error instanceof BridgeClientError) throw error;
      const aborted = error instanceof Error && error.name === "AbortError";
      throw new BridgeClientError(aborted ? "HERMES_TIMEOUT" : "HERMES_UNAVAILABLE", aborted ? "Bridge request timed out" : "Bridge is unreachable", 0, true);
    } finally {
      clearTimeout(timer);
    }
  }

  submitRun(input: BridgeSubmitInput): Promise<BridgeSubmitResult> {
    return this.callJson<BridgeSubmitResult>("POST", "/v1/runs", {
      instruction: input.instruction,
      ...(input.contextJson ? { contextJson: input.contextJson } : {}),
      correlation: input.correlation,
      ...(input.timeoutMs ? { timeoutMs: input.timeoutMs } : {}),
    });
  }

  getRun(runId: string): Promise<BridgeRunStatus> {
    return this.callJson<BridgeRunStatus>("GET", `/v1/runs/${encodeURIComponent(runId)}`);
  }

  cancelRun(runId: string): Promise<{ runId: string; status: string }> {
    return this.callJson<{ runId: string; status: string }>("POST", `/v1/runs/${encodeURIComponent(runId)}/cancel`);
  }

  health(): Promise<BridgeHealth> {
    return this.callJson<BridgeHealth>("GET", "/v1/health");
  }

  /**
   * Streams a run's events. Terminates on a `complete`/`error` frame or when the
   * socket closes. The `signal` lets a caller impose its own timeout.
   */
  async *streamRun(runId: string, options: { signal?: AbortSignal } = {}): AsyncGenerator<BridgeRunEvent> {
    const path = `/v1/runs/${encodeURIComponent(runId)}/stream`;
    const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
      method: "GET",
      headers: { ...this.headers("GET", path, ""), accept: "text/event-stream" },
      signal: options.signal,
    });
    if (!response.ok || !response.body) {
      throw new BridgeClientError("HERMES_UNAVAILABLE", `Bridge stream failed (${response.status})`, response.status, true);
    }
    for await (const frame of parseSseBody(response.body)) {
      if (frame.event === "delta" || frame.event === "complete" || frame.event === "error") {
        let data: Record<string, unknown> = {};
        try {
          const parsed = JSON.parse(frame.data);
          if (parsed && typeof parsed === "object") data = parsed as Record<string, unknown>;
        } catch {
          data = { text: frame.data };
        }
        yield { event: frame.event, data };
      }
    }
  }
}
