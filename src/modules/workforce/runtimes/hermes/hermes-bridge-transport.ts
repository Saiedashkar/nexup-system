import type { HermesBridgeClient } from "./bridge-client";
import { assertAddressableProfile } from "./hermes-config";
import { boundText, redactSecrets } from "./hermes-spawn";
import type {
  HermesAsyncTransport,
  HermesRunStart,
  HermesTransport,
  HermesTransportErrorKind,
  HermesTransportRequest,
  HermesTransportResult,
} from "./hermes-transport";

/**
 * HermesBridgeTransport.
 *
 * A `HermesTransport` implementation that reaches Hermes the production way:
 * through the authenticated NEXUP VPS bridge. The adapter and the core are
 * unchanged — this is just another transport behind the same port, selected by
 * `HERMES_RUNTIME_TRANSPORT=BRIDGE`.
 *
 * Safety posture:
 *   - it never chooses a profile (the request carries the pinned one);
 *   - it never picks a Hermes method (the bridge fixes the sequence);
 *   - completion comes from the bridge's terminal frame, which in turn comes
 *     from Hermes' `message.complete`/terminal state — never from text matching;
 *   - output is bounded and secrets are redacted before it leaves the transport.
 */

export type HermesBridgeTransportOptions = {
  client: HermesBridgeClient;
  /** The single operational profile this transport may address. */
  profile: string;
  /** Secret redacted from any output (the HMAC secret); never logged. */
  secrets?: readonly string[];
};

function mapBridgeErrorCode(code: string | undefined): HermesTransportErrorKind {
  switch (code) {
    case "HERMES_TIMEOUT":
      return "TIMEOUT";
    case "HERMES_UNAVAILABLE":
    case "RATE_LIMITED":
      return "UNAVAILABLE";
    case "HERMES_PROTOCOL_ERROR":
    case "INTERNAL":
      return "MALFORMED";
    case "FORBIDDEN_PROFILE":
      return "FORBIDDEN";
    case "METHOD_NOT_ALLOWED":
      return "UNSUPPORTED";
    default:
      return "UNAVAILABLE";
  }
}

export class HermesBridgeTransport implements HermesTransport, HermesAsyncTransport {
  readonly kind = "BRIDGE";

  private readonly options: HermesBridgeTransportOptions;

  constructor(options: HermesBridgeTransportOptions) {
    this.options = options;
  }

  async invoke(request: HermesTransportRequest): Promise<HermesTransportResult> {
    const startedAt = Date.now();

    try {
      assertAddressableProfile(request.profile);
    } catch {
      return this.failure("FORBIDDEN", startedAt);
    }
    if (!this.options.client) return this.failure("UNAVAILABLE", startedAt);
    if (request.operation === "resume") return this.failure("UNSUPPORTED", startedAt);

    try {
      switch (request.operation) {
        case "health":
          return await this.health(request, startedAt);
        case "submit":
          return await this.submit(request);
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

  /**
   * Starts the run and returns its id at once, with the terminal result arriving
   * on `completion`. This is the bridge's real shape: `/v1/runs` answers 201 the
   * moment the run is accepted, and the run then lives until its terminal frame.
   *
   * `submit` below is the fused form built on this one, so there is a single
   * implementation of the streaming/terminal logic.
   */
  async startRun(request: HermesTransportRequest): Promise<HermesRunStart> {
    const startedAt = Date.now();

    try {
      assertAddressableProfile(request.profile);
    } catch {
      return { state: "NOT_STARTED", result: this.failure("FORBIDDEN", startedAt) };
    }
    if (!this.options.client) return { state: "NOT_STARTED", result: this.failure("UNAVAILABLE", startedAt) };
    if (request.operation !== "submit") return { state: "NOT_STARTED", result: this.failure("UNSUPPORTED", startedAt) };

    try {
      const submitted = await this.options.client.submitRun({
        instruction: request.payload?.instruction ?? "",
        contextJson: request.payload?.contextJson,
        correlation: request.correlation,
        timeoutMs: request.timeoutMs,
      });
      const runId = submitted?.runId;
      if (typeof runId !== "string" || !runId) {
        // A 201 without the id its own routes are keyed by is useless: say so.
        return { state: "NOT_STARTED", result: this.failure("MALFORMED", startedAt) };
      }
      const completion = this.consumeRun(runId, request).then((terminal) =>
        terminal.ok
          ? this.ok(terminal.raw, request, startedAt)
          : this.failure(terminal.errorKind ?? "UNAVAILABLE", startedAt),
      );
      return { state: "STARTED", executionId: runId, completion };
    } catch (error) {
      return { state: "NOT_STARTED", result: this.failure(this.classify(error), startedAt) };
    }
  }

  private async health(request: HermesTransportRequest, startedAt: number): Promise<HermesTransportResult> {
    const health = await this.options.client.health();
    const status = health.hermes === "unavailable" ? "unavailable" : health.hermes === "degraded" ? "degraded" : "healthy";
    if (status === "unavailable") return this.failure("UNAVAILABLE", startedAt);
    return this.ok(JSON.stringify({ status, detail: health.detail, profile: request.profile }), request, startedAt);
  }

  private async submit(request: HermesTransportRequest): Promise<HermesTransportResult> {
    const start = await this.startRun(request);
    if (start.state === "NOT_STARTED") return start.result;
    return start.completion;
  }

  /** Drains the SSE stream, accumulating deltas as a fallback for an empty complete frame. */
  private async consumeRun(
    runId: string,
    request: HermesTransportRequest,
  ): Promise<{ ok: boolean; raw: string; errorKind?: HermesTransportErrorKind }> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), request.timeoutMs);
    let text = "";
    let terminal: { event: string; data: Record<string, unknown> } | undefined;

    try {
      for await (const event of this.options.client.streamRun(runId, { signal: controller.signal })) {
        if (event.event === "delta") {
          const chunk = typeof event.data.text === "string" ? event.data.text : "";
          text += chunk;
          continue;
        }
        terminal = { event: event.event, data: event.data };
        break;
      }
    } catch (error) {
      const aborted = error instanceof Error && error.name === "AbortError";
      return { ok: false, raw: "", errorKind: aborted ? "TIMEOUT" : "UNAVAILABLE" };
    } finally {
      clearTimeout(timer);
    }

    if (!terminal) return { ok: false, raw: "", errorKind: "UNAVAILABLE" };

    if (terminal.event === "error") {
      const code = typeof terminal.data.code === "string" ? terminal.data.code : undefined;
      return { ok: false, raw: "", errorKind: mapBridgeErrorCode(code) };
    }

    const frameText = typeof terminal.data.text === "string" && terminal.data.text.length > 0 ? terminal.data.text : text;
    // BOTH identities travel. The bridge's OWN run id is the handle its
    // `status`/`cancel`/`stream` routes are keyed by; the `executionId` in its
    // terminal frame is the Hermes session (provider metadata). The frame
    // carries only the latter, so the former is added here — measured against
    // the deployed bridge, using the session id as the handle made every
    // status/cancel call answer `404 RUN_NOT_FOUND`.
    const body: Record<string, unknown> = { ...terminal.data, runId, text: frameText };
    return { ok: true, raw: JSON.stringify(body) };
  }

  private async status(request: HermesTransportRequest, startedAt: number): Promise<HermesTransportResult> {
    const runId = request.payload?.executionId;
    if (!runId) return this.failure("UNSUPPORTED", startedAt);
    const status = await this.options.client.getRun(runId);
    return this.ok(JSON.stringify(status), request, startedAt);
  }

  private async cancel(request: HermesTransportRequest, startedAt: number): Promise<HermesTransportResult> {
    const runId = request.payload?.executionId;
    if (!runId) return this.failure("UNSUPPORTED", startedAt);
    const result = await this.options.client.cancelRun(runId);
    return this.ok(JSON.stringify(result), request, startedAt);
  }

  private ok(raw: string, request: HermesTransportRequest, startedAt: number): HermesTransportResult {
    const secrets = this.options.secrets ?? [];
    const bounded = boundText(redactSecrets(raw, secrets), request.maxOutputBytes);
    return { ok: true, raw: bounded.text, truncated: bounded.truncated, durationMs: Date.now() - startedAt };
  }

  private failure(kind: HermesTransportErrorKind, startedAt: number): HermesTransportResult {
    return { ok: false, raw: "", truncated: false, durationMs: Date.now() - startedAt, transportError: kind };
  }

  private classify(error: unknown): HermesTransportErrorKind {
    if (error && typeof error === "object" && "code" in error) {
      return mapBridgeErrorCode(String((error as { code?: unknown }).code));
    }
    if (error instanceof Error && error.name === "AbortError") return "TIMEOUT";
    return "UNAVAILABLE";
  }
}
