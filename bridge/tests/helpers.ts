import { HermesBridgeClient } from "@/modules/workforce/runtimes/hermes/bridge-client";
import type { HermesRpcEvent } from "@/modules/workforce/runtimes/hermes/hermes-rpc-transport";
import type {
  HermesTransport,
  HermesTransportErrorKind,
  HermesTransportRequest,
  HermesTransportResult,
} from "@/modules/workforce/runtimes/hermes/hermes-transport";

import type { BridgeTransportFactory } from "../src/hermes/client";

/** Deterministic behavior for the fake Hermes transport. */
export type FakeBehavior = {
  health?: { ok?: boolean; status?: string; detail?: string };
  /** Delta chunks emitted through `onEvent` before the terminal result. */
  deltas?: string[];
  complete?: { status?: string; text?: string; error?: string };
  failWith?: HermesTransportErrorKind;
  delayMs?: number;
  sessionId?: string;
  onInvoke?: (request: HermesTransportRequest) => void;
};

export class FakeHermesTransport implements HermesTransport {
  readonly kind = "DETERMINISTIC";
  readonly provenance = "TEST" as const;

  constructor(
    private readonly behavior: FakeBehavior,
    private readonly onEvent?: (event: HermesRpcEvent) => void,
    private readonly onSession?: (sessionId: string) => void,
  ) {}

  async invoke(request: HermesTransportRequest): Promise<HermesTransportResult> {
    this.behavior.onInvoke?.(request);
    const started = Date.now();
    // Session creation precedes the turn: report the session id before any
    // delay so a cancellation can interrupt work that has not streamed yet.
    if (request.operation === "submit") this.onSession?.(this.behavior.sessionId ?? "sess_1");
    if (this.behavior.delayMs) await new Promise((resolve) => setTimeout(resolve, this.behavior.delayMs));

    if (this.behavior.failWith) {
      return { ok: false, raw: "", truncated: false, durationMs: Date.now() - started, transportError: this.behavior.failWith };
    }

    const done = (body: Record<string, unknown>): HermesTransportResult => ({
      ok: true,
      raw: JSON.stringify(body),
      truncated: false,
      durationMs: Date.now() - started,
    });

    switch (request.operation) {
      case "health": {
        const health = this.behavior.health ?? { status: "healthy", detail: "gateway.ready" };
        return done({ status: health.status ?? "healthy", detail: health.detail ?? "gateway.ready", profile: request.profile });
      }
      case "submit": {
        const sessionId = this.behavior.sessionId ?? "sess_1";
        for (const chunk of this.behavior.deltas ?? []) {
          this.onEvent?.({ type: "message.delta", sessionId, payload: { text: chunk } });
        }
        const complete = this.behavior.complete ?? {
          status: "succeeded",
          text: (this.behavior.deltas ?? []).join(""),
        };
        return done({
          status: complete.status ?? "succeeded",
          text: complete.text ?? "",
          error: complete.error,
          executionId: sessionId,
        });
      }
      case "cancel":
        return done({ status: "cancelled", executionId: request.payload?.executionId ?? null });
      case "status":
        return done({ status: "running", executionId: request.payload?.executionId ?? null });
      default:
        return { ok: false, raw: "", truncated: false, durationMs: Date.now() - started, transportError: "UNSUPPORTED" };
    }
  }

  close(): void {
    /* nothing to close */
  }
}

export function fakeFactory(behavior: FakeBehavior): BridgeTransportFactory {
  return ({ onEvent, onSession }) => new FakeHermesTransport(behavior, onEvent, onSession);
}

/**
 * Replays the app-side client's REAL wire payload.
 *
 * The bridge and the client are separate artifacts, so the strongest contract
 * check is to let the client build and serialize the body, then feed exactly
 * those bytes to the bridge. If the client ever adds or renames a field, the
 * bridge's strict schema test fails instead of silently dropping it at deploy.
 */
export async function wireBodyFromAppClient(
  input: Parameters<HermesBridgeClient["submitRun"]>[0],
): Promise<Record<string, unknown>> {
  let sent = "";
  const client = new HermesBridgeClient({
    baseUrl: "https://bridge.example",
    keyId: "nexup-vercel",
    secret: "0123456789abcdef0123456789abcdef",
    fetchImpl: (async (_url: string, init: { body?: string }) => {
      sent = String(init?.body ?? "");
      return new Response(JSON.stringify({ runId: "run_1", streamUrl: "/v1/runs/run_1/stream", status: "QUEUED" }), {
        status: 201,
      });
    }) as unknown as typeof fetch,
  });
  await client.submitRun(input);
  return JSON.parse(sent) as Record<string, unknown>;
}

export async function waitFor(predicate: () => boolean, timeoutMs = 2000): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) throw new Error("waitFor timed out");
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}
