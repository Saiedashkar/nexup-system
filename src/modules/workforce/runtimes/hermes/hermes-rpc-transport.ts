import { assertNexupProfile } from "./hermes-config";
import { DEFAULT_HERMES_RPC_PROTOCOL, type HermesRpcProtocol } from "./hermes-protocol";
import { boundText, redactSecrets } from "./hermes-spawn";
import type {
  HermesTransport,
  HermesTransportErrorKind,
  HermesTransportRequest,
  HermesTransportResult,
} from "./hermes-transport";

/**
 * HermesRpcTransport — the PRIMARY Hermes transport.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 *  VERIFIED: Hermes headless/backend transport is WebSocket JSON-RPC 2.0
 *
 *    endpoint  → configurable `ws(s)://…` (default route `/api/ws`)
 *    request   → {"jsonrpc":"2.0","id":<id>,"method":<method>,"params":{…}}
 *    response  → {"jsonrpc":"2.0","id":<id>,"result":{…}} | {"…","error":{…}}
 *    event     → {"jsonrpc":"2.0","method":"event","params":{"type":…,"session_id":…,"payload":{…}}}
 *
 *  Responses correlate by `id`. The server emits a `gateway.ready` event right
 *  after accept and streams a turn's output as `event` notifications
 *  (`message.delta` … `message.complete`). This shape was READ FROM the Hermes
 *  source (`tui_gateway/ws.py`, `methods_session.py`, `methods_prompt.py`).
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Safety posture:
 *   - the endpoint is fully configurable; NO Hermes host/port is hardcoded;
 *   - Hermes networking knowledge stays inside this adapter layer;
 *   - the profile must be an addressable slug — a forbidden `default` is refused
 *     and `session.create` is always scoped to the adapter's OWN profile;
 *   - inbound frames larger than `protocol.maxFrameBytes` are dropped;
 *   - every request is bounded by `timeoutMs`; a disconnect rejects the pending
 *     calls instead of hanging;
 *   - the auth token is sent only as a header and is redacted from any output;
 *   - the transport NEVER starts, stops, restarts or reconfigures Hermes.
 */

/* ═══════════════════════════════════════════════════════
   WebSocket port (injectable for tests)
   ═══════════════════════════════════════════════════════ */

export type HermesWebSocketEvent = {
  data?: unknown;
  code?: number;
  reason?: string;
  message?: string;
};

export type HermesWebSocketLike = {
  /** 0 CONNECTING, 1 OPEN, 2 CLOSING, 3 CLOSED (WHATWG semantics). */
  readonly readyState: number;
  send(data: string): void;
  close(code?: number, reason?: string): void;
  addEventListener(type: "open" | "message" | "close" | "error", listener: (event: HermesWebSocketEvent) => void): void;
};

export type HermesWebSocketFactory = (
  url: string,
  options: { headers?: Record<string, string> },
) => HermesWebSocketLike;

/**
 * A server event observed on the wire, normalized to its public fields. The
 * bridge uses this to forward streamed deltas without reaching into the
 * transport's private frame handling. Additive: transports without a subscriber
 * behave exactly as before.
 */
export type HermesRpcEvent = {
  type?: string;
  sessionId?: string;
  payload?: Record<string, unknown>;
};

const WS_OPEN = 1;

/**
 * Default factory over the runtime's global `WebSocket` (Node 22 / undici).
 * Throws when the runtime has no WebSocket — the caller degrades to UNAVAILABLE
 * rather than crashing.
 */
export const defaultHermesWebSocketFactory: HermesWebSocketFactory = (url, options) => {
  const ctor = (globalThis as { WebSocket?: unknown }).WebSocket;
  if (typeof ctor !== "function") {
    throw new Error("WebSocket is not available in this runtime");
  }
  const Ctor = ctor as new (u: string, o?: unknown) => HermesWebSocketLike;
  return new Ctor(url, options.headers ? { headers: options.headers } : undefined);
};

/* ═══════════════════════════════════════════════════════
   Internal errors
   ═══════════════════════════════════════════════════════ */

class HermesRpcError extends Error {
  constructor(
    readonly code: number | undefined,
    message: string,
  ) {
    super(message);
    this.name = "HermesRpcError";
  }
}

class HermesRpcTimeoutError extends Error {
  constructor() {
    super("Hermes RPC request timed out");
    this.name = "HermesRpcTimeoutError";
  }
}

class HermesRpcDisconnectedError extends Error {
  constructor() {
    super("Hermes WebSocket disconnected before the request completed");
    this.name = "HermesRpcDisconnectedError";
  }
}

/* ═══════════════════════════════════════════════════════
   Transport
   ═══════════════════════════════════════════════════════ */

export type HermesRpcTransportOptions = {
  /** WebSocket endpoint URL (`ws://` / `wss://`). */
  endpoint: string;
  /** The single operational profile this transport may address. */
  profile: string;
  /** Adapter-owned VERIFIED protocol. Falls back to the verified defaults. */
  protocol?: HermesRpcProtocol;
  /** Secret sent as a header; NEVER logged or returned. */
  token?: string;
  authHeaderName?: string;
  authScheme?: string;
  /** Extra headers (e.g. an Origin the Hermes host guard expects). */
  headers?: Record<string, string>;
  /**
   * Optional sink for every inbound server event. Invoked for notifications
   * only (never responses). Never throws into the socket loop — a throwing
   * subscriber is swallowed so it cannot break request correlation.
   */
  onEvent?: (event: HermesRpcEvent) => void;
  /**
   * Optional sink invoked as soon as `session.create` returns a session id.
   * Lets a caller (the bridge) learn the session id BEFORE the first event, so
   * it can interrupt a turn that has not yet streamed anything.
   */
  onSession?: (sessionId: string) => void;
  /** Connect timeout; defaults to the request timeout. */
  connectTimeoutMs?: number;
  /** Injected for tests. */
  webSocketFactory?: HermesWebSocketFactory;
  now?: () => Date;
};

type PendingCall = {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};

type EventWaiter = {
  predicate: (frame: JsonRpcFrame) => boolean;
  resolve: (frame: JsonRpcFrame) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};

type JsonRpcFrame = {
  jsonrpc?: string;
  id?: string | number | null;
  method?: string;
  params?: Record<string, unknown>;
  result?: unknown;
  error?: { code?: number; message?: string };
};

export class HermesRpcTransport implements HermesTransport {
  readonly kind = "RPC";
  readonly provenance = "PRODUCTION" as const;

  private readonly options: HermesRpcTransportOptions;
  private readonly protocol: HermesRpcProtocol;

  private socket: HermesWebSocketLike | null = null;
  private connectPromise: Promise<void> | null = null;
  private connectReject: ((error: Error) => void) | null = null;
  private closed = false;

  private counter = 0;
  private readonly pending = new Map<string, PendingCall>();
  private readonly waiters = new Set<EventWaiter>();

  constructor(options: HermesRpcTransportOptions) {
    this.options = options;
    this.protocol = options.protocol ?? DEFAULT_HERMES_RPC_PROTOCOL;
  }

  async invoke(request: HermesTransportRequest): Promise<HermesTransportResult> {
    const startedAt = Date.now();

    // Refuse anything outside the NEXUP allowlist (e.g. `default`, another
    // operator's profile) before touching the socket.
    try {
      assertNexupProfile(request.profile);
    } catch {
      return this.failure("FORBIDDEN", startedAt);
    }

    // No verified resume method exists on the RPC surface.
    if (request.operation === "resume") {
      return this.failure("UNSUPPORTED", startedAt);
    }

    try {
      switch (request.operation) {
        case "health":
          return await this.health(request, startedAt);
        case "submit":
          return await this.submit(request, startedAt);
        case "status":
          return await this.status(request, startedAt);
        case "cancel":
          return await this.cancel(request, startedAt);
        default:
          return this.failure("UNSUPPORTED", startedAt);
      }
    } catch (error) {
      return this.failure(this.classify(error), startedAt);
    }
  }

  /** Close the socket and reject anything in flight. Tests + teardown use this. */
  close(): void {
    this.closed = true;
    const socket = this.socket;
    this.socket = null;
    this.connectPromise = null;
    try {
      socket?.close();
    } catch {
      /* ignore */
    }
    this.teardown(new HermesRpcDisconnectedError());
  }

  /* ── operations ─────────────────────────────────────── */

  private async health(request: HermesTransportRequest, startedAt: number): Promise<HermesTransportResult> {
    await this.ensureConnected(this.connectTimeout(request));
    // `gateway.ping` is the verified-named liveness method. A build that does
    // not expose it (method not found) still proves liveness by accepting the
    // connection — report DEGRADED rather than inventing a failure.
    let status = "healthy";
    let detail = "gateway.ready";
    try {
      await this.call(this.protocol.methods.health, {}, request.timeoutMs);
    } catch (error) {
      if (error instanceof HermesRpcError && error.code === -32601) {
        status = "degraded";
        detail = "gateway.ping not supported";
      } else {
        status = "degraded";
        detail = "gateway.ping failed";
      }
    }
    return this.ok(JSON.stringify({ status, detail, profile: request.profile }), request, startedAt);
  }

  private async submit(request: HermesTransportRequest, startedAt: number): Promise<HermesTransportResult> {
    await this.ensureConnected(this.connectTimeout(request));

    const sessionId = await this.createSession(request);

    // Register the terminal-event waiter BEFORE submitting, so a fast turn
    // cannot emit `message.complete` before we are listening. The predicate
    // also accumulates streamed deltas as a fallback for a complete frame that
    // carries no text.
    let deltaText = "";
    const waiter = this.waitForEvent((frame) => {
      const type = this.eventType(frame);
      if (type === this.protocol.deltaEvent && this.eventSessionId(frame) === sessionId) {
        const text = this.eventText(frame);
        if (text) deltaText += text;
        return false;
      }
      return (
        (type === this.protocol.completeEvent || type === this.protocol.errorEvent) &&
        this.eventSessionId(frame) === sessionId
      );
    }, request.timeoutMs);

    // Now that we are listening, send the prompt. A synchronous turn can then
    // never complete before we are subscribed.
    try {
      await this.call(
        this.protocol.methods.promptSubmit,
        { [this.protocol.sessionIdField]: sessionId, [this.protocol.textField]: request.payload?.instruction ?? "" },
        request.timeoutMs,
      );
    } catch (error) {
      waiter.promise.catch(() => {});
      waiter.dispose();
      throw error;
    }
    const terminal = await waiter.promise;

    const type = this.eventType(terminal);
    const payload = this.eventPayload(terminal) ?? {};

    if (type === this.protocol.errorEvent) {
      const message = typeof payload.message === "string" ? payload.message : "Hermes turn failed";
      return this.ok(JSON.stringify({ status: "failed", error: message, executionId: sessionId }), request, startedAt);
    }

    const text = typeof payload.text === "string" && payload.text.length > 0 ? payload.text : deltaText;
    // The real `message.complete` payload carries `text`, `status` and `usage`.
    // We forward it verbatim (plus the correlation session id) so the adapter's
    // normalizer sees the genuine provider status.
    const body: Record<string, unknown> = { ...payload, executionId: sessionId };
    if (typeof body.text !== "string") body.text = text;
    return this.ok(JSON.stringify(body), request, startedAt);
  }

  private async status(request: HermesTransportRequest, startedAt: number): Promise<HermesTransportResult> {
    const sessionId = request.payload?.executionId;
    if (!sessionId) return this.failure("UNSUPPORTED", startedAt);
    await this.ensureConnected(this.connectTimeout(request));
    const result = await this.call(this.protocol.methods.sessionStatus, { [this.protocol.sessionIdField]: sessionId }, request.timeoutMs);
    return this.ok(JSON.stringify(result), request, startedAt);
  }

  private async cancel(request: HermesTransportRequest, startedAt: number): Promise<HermesTransportResult> {
    const sessionId = request.payload?.executionId;
    if (!sessionId) return this.failure("UNSUPPORTED", startedAt);
    await this.ensureConnected(this.connectTimeout(request));
    // VERIFIED mapping: cancel → `session.interrupt`.
    const result = await this.call(
      this.protocol.methods.sessionInterrupt,
      { [this.protocol.sessionIdField]: sessionId },
      request.timeoutMs,
    );
    return this.ok(JSON.stringify(result), request, startedAt);
  }

  private async createSession(request: HermesTransportRequest): Promise<string> {
    // VERIFIED: `session.create` reads `params.profile` and returns `session_id`.
    const result = await this.call(
      this.protocol.methods.sessionCreate,
      { [this.protocol.profileParam]: request.profile },
      request.timeoutMs,
    );
    const sessionId =
      result && typeof result === "object" ? (result as Record<string, unknown>)[this.protocol.sessionIdField] : undefined;
    if (typeof sessionId !== "string" || sessionId.length === 0) {
      throw new HermesRpcError(undefined, "session.create did not return a session_id");
    }
    if (this.options.onSession) {
      try {
        this.options.onSession(sessionId);
      } catch {
        /* a subscriber must never break the request */
      }
    }
    return sessionId;
  }

  /* ── JSON-RPC plumbing ──────────────────────────────── */

  private call(method: string, params: Record<string, unknown>, timeoutMs: number): Promise<unknown> {
    this.counter += 1;
    const id = `${this.protocol.requestIdPrefix}-${this.counter}`;
    return new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new HermesRpcTimeoutError());
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      try {
        this.send({ jsonrpc: "2.0", id, method, params });
      } catch (error) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(error instanceof Error ? error : new HermesRpcDisconnectedError());
      }
    });
  }

  private send(frame: JsonRpcFrame): void {
    const socket = this.socket;
    if (this.closed || !socket || socket.readyState !== WS_OPEN) {
      throw new HermesRpcDisconnectedError();
    }
    socket.send(JSON.stringify(frame));
  }

  private handleFrame(data: unknown): void {
    const text = frameText(data);
    if (text === null) return;
    if (text.length > this.protocol.maxFrameBytes) return; // bounded frames

    let frame: JsonRpcFrame;
    try {
      frame = JSON.parse(text) as JsonRpcFrame;
    } catch {
      return;
    }
    if (frame === null || typeof frame !== "object") return;

    // A server event is a notification (`method:"event"`, no `id`).
    if (frame.method === this.protocol.eventMethod && (frame.id === undefined || frame.id === null)) {
      // Fan out to the optional event sink BEFORE waiter matching, so a
      // streaming consumer sees a delta even if it also resolves a waiter.
      if (this.options.onEvent) {
        try {
          this.options.onEvent({
            type: this.eventType(frame),
            sessionId: this.eventSessionId(frame),
            payload: this.eventPayload(frame),
          });
        } catch {
          /* a subscriber must never break the socket loop */
        }
      }
      for (const waiter of [...this.waiters]) {
        let matched = false;
        try {
          matched = waiter.predicate(frame);
        } catch {
          matched = false;
        }
        if (matched) {
          clearTimeout(waiter.timer);
          this.waiters.delete(waiter);
          waiter.resolve(frame);
        }
      }
      return;
    }

    // A response correlates by `id`.
    if (frame.id !== undefined && frame.id !== null) {
      const key = String(frame.id);
      const call = this.pending.get(key);
      if (!call) return;
      clearTimeout(call.timer);
      this.pending.delete(key);
      if (frame.error) {
        call.reject(new HermesRpcError(frame.error.code, frame.error.message ?? "Hermes RPC error"));
      } else {
        call.resolve(frame.result);
      }
    }
  }

  /**
   * Registers an event waiter. Returns the pending promise plus a `dispose`
   * that removes it (rejecting the promise) so a failed send cannot leak a
   * waiter or its timer.
   */
  private waitForEvent(
    predicate: (frame: JsonRpcFrame) => boolean,
    timeoutMs: number,
  ): { promise: Promise<JsonRpcFrame>; dispose: () => void } {
    let entry: EventWaiter;
    const promise = new Promise<JsonRpcFrame>((resolve, reject) => {
      entry = {
        predicate,
        resolve,
        reject,
        timer: setTimeout(() => {
          this.waiters.delete(entry);
          reject(new HermesRpcTimeoutError());
        }, timeoutMs),
      };
      this.waiters.add(entry);
    });
    const dispose = () => {
      if (this.waiters.delete(entry)) {
        clearTimeout(entry.timer);
        entry.reject(new HermesRpcDisconnectedError());
      }
    };
    return { promise, dispose };
  }

  /* ── connection lifecycle ───────────────────────────── */

  private ensureConnected(timeoutMs: number): Promise<void> {
    if (this.socket && this.socket.readyState === WS_OPEN) return Promise.resolve();
    if (this.connectPromise) return this.connectPromise;

    const factory = this.options.webSocketFactory ?? defaultHermesWebSocketFactory;
    const promise = new Promise<void>((resolve, reject) => {
      this.connectReject = reject;
      const timer = setTimeout(() => {
        this.connectPromise = null;
        reject(new HermesRpcTimeoutError());
      }, timeoutMs);

      let socket: HermesWebSocketLike;
      try {
        socket = factory(this.options.endpoint, { headers: this.buildHeaders() });
      } catch (error) {
        clearTimeout(timer);
        this.connectPromise = null;
        reject(error instanceof Error ? error : new HermesRpcDisconnectedError());
        return;
      }
      this.socket = socket;

      socket.addEventListener("open", () => {
        clearTimeout(timer);
        this.connectReject = null;
        resolve();
      });
      socket.addEventListener("message", (event) => this.handleFrame(event.data));
      socket.addEventListener("close", () => {
        this.socket = null;
        this.connectPromise = null;
        this.teardown(new HermesRpcDisconnectedError());
      });
      socket.addEventListener("error", () => {
        if (this.connectReject) {
          clearTimeout(timer);
          this.connectPromise = null;
          this.connectReject(new HermesRpcDisconnectedError());
          this.connectReject = null;
        }
      });
    });
    this.connectPromise = promise;
    return promise;
  }

  /** Reject every pending call/waiter — used on disconnect and close. */
  private teardown(error: Error): void {
    for (const [key, call] of this.pending) {
      clearTimeout(call.timer);
      this.pending.delete(key);
      call.reject(error);
    }
    for (const waiter of [...this.waiters]) {
      clearTimeout(waiter.timer);
      this.waiters.delete(waiter);
      waiter.reject(error);
    }
  }

  /* ── helpers ────────────────────────────────────────── */

  private buildHeaders(): Record<string, string> {
    const headers: Record<string, string> = { ...(this.options.headers ?? {}) };
    if (this.options.token) {
      const scheme = this.options.authScheme ?? "Bearer";
      headers[this.options.authHeaderName ?? "Authorization"] = scheme
        ? `${scheme} ${this.options.token}`
        : this.options.token;
    }
    return headers;
  }

  private eventType(frame: JsonRpcFrame): string | undefined {
    const value = frame.params?.type;
    return typeof value === "string" ? value : undefined;
  }

  private eventSessionId(frame: JsonRpcFrame): string | undefined {
    const value = frame.params?.[this.protocol.sessionIdField];
    return typeof value === "string" ? value : undefined;
  }

  private eventPayload(frame: JsonRpcFrame): Record<string, unknown> | undefined {
    const value = frame.params?.payload;
    return value && typeof value === "object" ? (value as Record<string, unknown>) : undefined;
  }

  private eventText(frame: JsonRpcFrame): string {
    const payload = this.eventPayload(frame);
    const value = payload?.[this.protocol.textField];
    return typeof value === "string" ? value : "";
  }

  private connectTimeout(request: HermesTransportRequest): number {
    return this.options.connectTimeoutMs ?? request.timeoutMs;
  }

  private ok(raw: string, request: HermesTransportRequest, startedAt: number): HermesTransportResult {
    const secrets = this.options.token ? [this.options.token] : [];
    const bounded = boundText(redactSecrets(raw, secrets), request.maxOutputBytes);
    return {
      ok: true,
      raw: bounded.text,
      truncated: bounded.truncated,
      durationMs: Date.now() - startedAt,
    };
  }

  private failure(kind: HermesTransportErrorKind, startedAt: number): HermesTransportResult {
    return { ok: false, raw: "", truncated: false, durationMs: Date.now() - startedAt, transportError: kind };
  }

  private classify(error: unknown): HermesTransportErrorKind {
    if (error instanceof HermesRpcTimeoutError) return "TIMEOUT";
    if (error instanceof HermesRpcDisconnectedError) return "UNAVAILABLE";
    if (error instanceof HermesRpcError) return "MALFORMED";
    return "UNAVAILABLE";
  }
}

/* ═══════════════════════════════════════════════════════
   Frame coercion
   ═══════════════════════════════════════════════════════ */

function frameText(data: unknown): string | null {
  if (typeof data === "string") return data;
  if (data instanceof Uint8Array) {
    try {
      return new TextDecoder().decode(data);
    } catch {
      return null;
    }
  }
  // Node Buffer (guard so the browser build never references it).
  const BufferCtor = (globalThis as { Buffer?: { isBuffer?: (value: unknown) => boolean } }).Buffer;
  if (BufferCtor?.isBuffer?.(data)) {
    return (data as unknown as { toString(encoding: string): string }).toString("utf8");
  }
  return null;
}
