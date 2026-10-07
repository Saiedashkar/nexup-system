import type { JobId } from "@/modules/ai-workforce/core/types";
import type { ActorId, MissionId, RuntimeId, TraceId } from "../../core/refs";
import type { HermesTransportKind } from "./hermes-config";

/** Concrete transport implementations, including the test-only deterministic one. */
export type HermesTransportImplementation = HermesTransportKind | "DETERMINISTIC";

/**
 * Operations a transport may refuse because it does not provide them at all (a
 * synchronous one-shot run has no status/cancel/resume surface). Refusing is
 * honest: the adapter never invents a result.
 */
export type HermesUnsupportedOperation = Exclude<HermesOperation, "submit">;

/**
 * Hermes transport port.
 *
 * The transport is the ONLY place that talks to Hermes. The adapter maps the
 * generic runtime request onto a transport call; the transport returns RAW,
 * provider-owned output that never enters a core contract.
 *
 * Implementations:
 *   HermesRpcTransport            VERIFIED WebSocket JSON-RPC 2.0 on `/api/ws` (PRIMARY)
 *   DeterministicHermesTransport  tests — no network, no process
 *   HermesCliOneshotTransport     VERIFIED `hermes -p <profile> -z <prompt>` (explicit fallback/diagnostic)
 *   HermesHttpTransport           QUARANTINED scaffolding (PROVISIONAL paths; never a default)
 *   HermesCliTransport            QUARANTINED scaffolding (PROVISIONAL subcommands; never a default)
 *
 * Swapping transports never changes the adapter or the core.
 *
 * The HTTP paths and CLI subcommands the concrete transports emit are NOT
 * specified here: they come from an adapter-owned protocol config
 * (`hermes-protocol.ts`). The PRIMARY transport is the VERIFIED WebSocket
 * JSON-RPC contract; the HTTP/CLI shapes are quarantined scaffolding.
 */

export type HermesOperation = "health" | "submit" | "status" | "cancel" | "resume";

export type HermesTransportPayload = {
  /** Hermes-facing instruction text (already mapped and bounded). */
  instruction: string;
  /** Bounded, structured context, serialized by the adapter. */
  contextJson: string;
  /** Execution handle for status/cancel/resume. */
  executionId?: string;
};

export type HermesCorrelation = {
  jobId?: JobId;
  missionId?: MissionId;
  actorId: ActorId;
  traceId: TraceId;
};

export type HermesTransportRequest = {
  operation: HermesOperation;
  /** The single profile this adapter is allowed to address. */
  profile: string;
  payload?: HermesTransportPayload;
  timeoutMs: number;
  maxOutputBytes: number;
  correlation: HermesCorrelation;
};

export type HermesTransportErrorKind =
  | "TIMEOUT"
  | "UNAVAILABLE"
  | "BLOCKED_COMMAND"
  | "MALFORMED"
  | "HTTP_ERROR"
  /** The addressed profile is forbidden (e.g. the `default` profile). */
  | "FORBIDDEN"
  /** The transport does not provide this operation at all. */
  | "UNSUPPORTED";

export type HermesTransportResult = {
  ok: boolean;
  /** Raw provider output text, already bounded to `maxOutputBytes`. */
  raw: string;
  truncated: boolean;
  /** Normalized exit code (CLI transport); undefined for HTTP. */
  exitCode?: number;
  /** Separate stderr capture, already redacted and bounded. */
  stderr?: string;
  durationMs: number;
  transportError?: HermesTransportErrorKind;
  httpStatus?: number;
};

export interface HermesTransport {
  readonly kind: HermesTransportImplementation;
  invoke(request: HermesTransportRequest): Promise<HermesTransportResult>;
}

/* ═══════════════════════════════════════════════════════
   Optional NON-BLOCKING start
   ═══════════════════════════════════════════════════════

   `invoke` is one call that returns one result, so it can only express a
   transport that decides an outcome synchronously. A transport that owns a run
   lifecycle (the bridge) can additionally START the run and hand back its id
   and a completion promise, exactly like the provider does. Transports that
   cannot are unchanged and the adapter falls back to the blocking call. */

export type HermesRunStart =
  /** The run exists now. `executionId` is the id its control routes accept. */
  | { state: "STARTED"; executionId: string; completion: Promise<HermesTransportResult> }
  /** It never started; `result` carries the honest failure. */
  | { state: "NOT_STARTED"; result: HermesTransportResult };

export interface HermesAsyncTransport extends HermesTransport {
  startRun(request: HermesTransportRequest): Promise<HermesRunStart>;
}

/** Whether a transport can start a run without waiting for its end. */
export function isHermesAsyncTransport(transport: HermesTransport): transport is HermesAsyncTransport {
  return typeof (transport as Partial<HermesAsyncTransport>).startRun === "function";
}

/* ═══════════════════════════════════════════════════════
   Observability — structured adapter events
   ═══════════════════════════════════════════════════════

   Adapter-owned event stream. It NEVER carries tokens, secrets, full prompts
   or environment values; only ids, statuses, bounded details and timings. */

export const RUNTIME_EVENT_TYPES = [
  "runtime.health",
  "runtime.submit",
  "runtime.started",
  "runtime.completed",
  "runtime.failed",
  "runtime.cancelled",
] as const;
export type RuntimeEventType = (typeof RUNTIME_EVENT_TYPES)[number];

export type RuntimeEvent = {
  type: RuntimeEventType;
  at: string;
  runtimeId: RuntimeId;
  /** Non-secret profile slug. */
  profile?: string;
  executionId?: string;
  jobId?: JobId;
  missionId?: MissionId;
  actorId?: ActorId;
  traceId?: TraceId;
  status?: string;
  detail?: string;
  durationMs?: number;
  meta?: Record<string, string | number | boolean>;
};

export type RuntimeEventSink = (event: RuntimeEvent) => void;

/** Default sink: drop events. Callers wire a real sink (recorder/logger). */
export const noopRuntimeEventSink: RuntimeEventSink = () => {};
