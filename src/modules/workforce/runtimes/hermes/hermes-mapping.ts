import type { AgentExecutionStatus, AgentJobRequest, AgentExecutionErrorCategory } from "../agent-runtime";
import type { HermesCorrelation, HermesTransportPayload, HermesTransportResult } from "./hermes-transport";

/**
 * Adapter-owned mapping.
 *
 * Direction 1 — MAP IN: a generic `AgentJobRequest` (+ optional richer context)
 * becomes a bounded Hermes payload. "Load what is needed, when it is needed":
 * only the actor role, capability, mission goal and approval state travel — no
 * database dump, no conversation history, no memory, no skill list.
 *
 * Direction 2 — MAP OUT: raw Hermes output becomes a generic execution record.
 * Raw provider output never becomes a core schema; it is parsed, bounded, and
 * optionally referenced.
 */

/* ═══════════════════════════════════════════════════════
   Map in — generic → Hermes
   ═══════════════════════════════════════════════════════ */

/* Hermes-specific context lives HERE, in the adapter. It is never added to a
   core contract. */
export type HermesJobContext = {
  actorRole?: string;
  actorType?: string;
  missionTitle?: string;
  missionGoal?: string;
  approvalRequired?: boolean;
  approvalState?: string;
  /** Explicit, small set of context references the caller chose to include. */
  contextRefs?: string[];
};

/** The generic request, optionally enriched with adapter-owned context. */
export type HermesJobRequest = AgentJobRequest & { context?: HermesJobContext };

export const DEFAULT_HERMES_INSTRUCTION =
  "Summarize the assigned market-research task and return a structured response.";

export const DEFAULT_MAX_CONTEXT_BYTES = 8_192;

function readString(source: Record<string, unknown> | undefined, keys: readonly string[]): string | undefined {
  if (!source) return undefined;
  for (const key of keys) {
    const value = source[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return undefined;
}

function boundString(text: string, maxBytes: number): string {
  return text.length <= maxBytes ? text : text.slice(0, maxBytes);
}

export type MappedHermesJob = {
  payload: HermesTransportPayload;
  correlation: HermesCorrelation;
};

/**
 * Maps a generic job request to a bounded, side-effect-free Hermes payload.
 * No field of the original job is interpolated into anything command-like —
 * the payload is structured JSON consumed by the transport.
 */
export function mapJobToHermesPayload(
  request: HermesJobRequest,
  options: { maxContextBytes?: number } = {},
): MappedHermesJob {
  const maxContextBytes = options.maxContextBytes ?? DEFAULT_MAX_CONTEXT_BYTES;
  const input = request.input as Record<string, unknown> | undefined;

  const instruction =
    readString(input, ["instruction", "prompt", "goal", "task", "objective"]) ?? DEFAULT_HERMES_INSTRUCTION;

  const ctx = request.context ?? {};
  const contextObject = {
    actor: { id: request.actorId, type: ctx.actorType ?? null, role: ctx.actorRole ?? null },
    capability: { id: request.capabilityId, version: request.capabilityVersion ?? null },
    mission: request.missionId
      ? { id: request.missionId, title: ctx.missionTitle ?? null, goal: ctx.missionGoal ?? null }
      : null,
    // Explicit constraint: this slice performs NO external side effects.
    constraints: { sideEffects: "NONE", timeoutMs: null },
    approval: { required: ctx.approvalRequired ?? false, state: ctx.approvalState ?? "NOT_REQUIRED" },
    contextRefs: (ctx.contextRefs ?? []).slice(0, 8),
  };

  const contextJson = boundString(JSON.stringify(contextObject), maxContextBytes);

  const payload: HermesTransportPayload = { instruction: boundString(instruction, maxContextBytes), contextJson };

  const correlation: HermesCorrelation = {
    actorId: request.actorId,
    traceId: request.traceId,
  };
  if (request.jobId) correlation.jobId = request.jobId;
  if (request.missionId) correlation.missionId = request.missionId;

  return { payload, correlation };
}

/* ═══════════════════════════════════════════════════════
   Map out — Hermes status → generic status
   ═══════════════════════════════════════════════════════ */

const HERMES_STATUS_MAP: Record<string, AgentExecutionStatus> = {
  // queued-equivalents → ACCEPTED
  queued: "ACCEPTED",
  pending: "ACCEPTED",
  created: "ACCEPTED",
  accepted: "ACCEPTED",
  scheduled: "ACCEPTED",
  // running
  running: "RUNNING",
  "in_progress": "RUNNING",
  inprogress: "RUNNING",
  executing: "RUNNING",
  started: "RUNNING",
  processing: "RUNNING",
  // waiting
  waiting: "WAITING",
  blocked: "WAITING",
  paused: "WAITING",
  needs_input: "WAITING",
  awaiting_approval: "WAITING",
  // terminal
  succeeded: "SUCCEEDED",
  success: "SUCCEEDED",
  completed: "SUCCEEDED",
  complete: "SUCCEEDED",
  done: "SUCCEEDED",
  ok: "SUCCEEDED",
  failed: "FAILED",
  failure: "FAILED",
  error: "FAILED",
  errored: "FAILED",
  cancelled: "CANCELLED",
  canceled: "CANCELLED",
  aborted: "CANCELLED",
  stopped: "CANCELLED",
  killed: "CANCELLED",
};

/** Maps a raw provider status to the neutral vocabulary. Unknown → UNKNOWN. */
export function mapHermesStatus(raw: unknown): AgentExecutionStatus {
  if (typeof raw !== "string") return "UNKNOWN";
  const key = raw.trim().toLowerCase().replace(/[\s-]+/g, "_");
  return HERMES_STATUS_MAP[key] ?? "UNKNOWN";
}

/* ═══════════════════════════════════════════════════════
   Map out — raw output → generic execution record
   ═══════════════════════════════════════════════════════ */

/* The adapter's own richer vocabulary maps INTO the neutral one, so a generic
   execution record never grows an HTTP-specific field just because this
   provider needs one. */
const GENERIC_ERROR_CATEGORY: Record<HermesErrorCategory, AgentExecutionErrorCategory> = {
  NONE: "NONE",
  TIMEOUT: "TIMEOUT",
  TRANSPORT: "TRANSPORT",
  HTTP: "TRANSPORT",
  BLOCKED: "BLOCKED",
  MALFORMED_OUTPUT: "MALFORMED_OUTPUT",
  RUNTIME_ERROR: "RUNTIME_ERROR",
  UNSUPPORTED: "UNSUPPORTED",
};

/** Maps a provider-specific category into the provider-neutral set. */
export function toGenericErrorCategory(category: HermesErrorCategory): AgentExecutionErrorCategory {
  return GENERIC_ERROR_CATEGORY[category] ?? "RUNTIME_ERROR";
}

export type HermesErrorCategory =
  | "NONE"
  | "TIMEOUT"
  | "TRANSPORT"
  | "HTTP"
  | "BLOCKED"
  | "MALFORMED_OUTPUT"
  | "RUNTIME_ERROR"
  | "UNSUPPORTED";

export type HermesExecutionRecord = {
  /**
   * The handle for `status`/`cancel`/`resume`: the BRIDGE's run id on the bridge
   * transport, the Hermes session id elsewhere. See `extractExecutionId`.
   */
  executionId: string | null;
  /**
   * The provider's own execution reference when it differs from the handle —
   * on the bridge transport, the Hermes session id the run used. Provider
   * metadata: reported for audit/trace, never used as a handle.
   */
  providerExecutionId?: string;
  status: AgentExecutionStatus;
  outputText?: string;
  output?: unknown;
  startedAt?: string;
  completedAt?: string;
  durationMs?: number;
  runtime: { id: string; type: string };
  error?: { category: HermesErrorCategory; message: string; retryable: boolean };
  truncated: boolean;
  /** Opaque reference; the raw provider output is not promoted to a core type. */
  rawRef?: string;
  /** True when this record answered an idempotent replay: no new run was made. */
  replayed?: boolean;
};

/** Tolerant JSON parse: a non-JSON body is not an exception, it is `malformed`. */
export function parseHermesRaw(raw: string): { parsed: Record<string, unknown> | null; malformed: boolean } {
  const trimmed = raw?.trim();
  if (!trimmed) return { parsed: null, malformed: true };
  try {
    const value = JSON.parse(trimmed);
    if (value && typeof value === "object" && !Array.isArray(value)) {
      return { parsed: value as Record<string, unknown>, malformed: false };
    }
    // A bare scalar/array is accepted as the output body itself.
    return { parsed: { output: value }, malformed: false };
  } catch {
    // Plain-text providers are common — treat non-JSON as text output, not a crash.
    return { parsed: { output: trimmed }, malformed: false };
  }
}

function extractExecutionId(parsed: Record<string, unknown> | null): string | null {
  if (!parsed) return null;
  // `runId` FIRST. On the bridge transport it is the bridge's OWN run id — the
  // only id its `status`/`cancel`/`stream` routes accept — while `executionId`
  // is the Hermes session it reports alongside. Preferring the session id (the
  // previous order) made every status/cancel call fail: measured against the
  // deployed bridge, `GET /v1/runs/58b92fb1` → 404 RUN_NOT_FOUND versus
  // `GET /v1/runs/run_muxjhitf_79c4e201` → 200 COMPLETED for the same run.
  const value = parsed.runId ?? parsed.executionId ?? parsed.execution_id ?? parsed.id;
  return typeof value === "string" && value.trim() ? value : null;
}

/** The provider's own reference, when it is not the handle we kept. */
function extractProviderExecutionId(
  parsed: Record<string, unknown> | null,
  handle: string | null,
): string | undefined {
  if (!parsed) return undefined;
  for (const key of ["executionId", "execution_id", "sessionId", "session_id"] as const) {
    const value = parsed[key];
    if (typeof value === "string" && value.trim() && value !== handle) return value;
  }
  return undefined;
}

function extractStatus(parsed: Record<string, unknown> | null): AgentExecutionStatus {
  if (!parsed) return "UNKNOWN";
  return mapHermesStatus(parsed.status ?? parsed.state ?? parsed.phase);
}

function extractOutput(parsed: Record<string, unknown> | null): { output?: unknown; outputText?: string } {
  if (!parsed) return {};
  const candidate = parsed.output ?? parsed.result ?? parsed.response ?? parsed.text ?? parsed.message;
  if (candidate === undefined || candidate === null) return {};
  if (typeof candidate === "string") return { outputText: candidate };
  return { output: candidate };
}

function classifyTransportError(result: HermesTransportResult): { category: HermesErrorCategory; retryable: boolean } {
  switch (result.transportError) {
    case "TIMEOUT":
      return { category: "TIMEOUT", retryable: true };
    case "UNAVAILABLE":
      return { category: "TRANSPORT", retryable: true };
    case "BLOCKED_COMMAND":
    case "FORBIDDEN":
      return { category: "BLOCKED", retryable: false };
    case "MALFORMED":
      return { category: "MALFORMED_OUTPUT", retryable: false };
    case "UNSUPPORTED":
      // The transport does not provide this operation — retrying cannot help.
      return { category: "UNSUPPORTED", retryable: false };
    case "HTTP_ERROR":
      return { category: "HTTP", retryable: (result.httpStatus ?? 500) >= 500 };
    default:
      return { category: "TRANSPORT", retryable: true };
  }
}

/**
 * Normalizes a transport result into a generic execution record.
 * A transport failure becomes a FAILED record (never a thrown core error), so
 * the caller always gets a structured result.
 */
export function normalizeHermesTransportResult(input: {
  result: HermesTransportResult;
  runtime: { id: string; type: string };
  now: Date;
  /**
   * The provider prints ONLY final response text (e.g. the verified Hermes
   * one-shot mode). An exit-0 plain-text body with no explicit status is then a
   * SUCCESS, not an unknown state.
   */
  textOnly?: boolean;
}): HermesExecutionRecord {
  const { result, runtime, now } = input;

  if (!result.ok) {
    const { category, retryable } = classifyTransportError(result);
    return {
      executionId: null,
      status: "FAILED",
      runtime,
      truncated: result.truncated,
      durationMs: result.durationMs,
      error: {
        category,
        message: `Hermes transport failed (${category})`,
        retryable,
      },
      rawRef: undefined,
    };
  }

  const { parsed } = parseHermesRaw(result.raw);
  if (parsed === null) {
    // A 2xx response with no interpretable body is malformed output.
    return {
      executionId: null,
      status: "FAILED",
      runtime,
      truncated: result.truncated,
      durationMs: result.durationMs,
      completedAt: now.toISOString(),
      error: { category: "MALFORMED_OUTPUT", message: "Hermes returned an empty or uninterpretable body", retryable: false },
    };
  }

  const executionId = extractExecutionId(parsed);
  let status = extractStatus(parsed);
  const { output, outputText } = extractOutput(parsed);

  // One-shot mode: final text only, with no JSON status envelope. Exit-0 text
  // is a successful run; a real status in the body always wins.
  const hasExplicitStatus = parsed.status !== undefined || parsed.state !== undefined || parsed.phase !== undefined;
  if (input.textOnly && !hasExplicitStatus && status === "UNKNOWN") status = "SUCCEEDED";

  const record: HermesExecutionRecord = {
    executionId,
    status,
    runtime,
    truncated: result.truncated,
    durationMs: result.durationMs,
    completedAt: now.toISOString(),
  };
  const providerExecutionId = extractProviderExecutionId(parsed, executionId);
  if (providerExecutionId) record.providerExecutionId = providerExecutionId;
  if (output !== undefined) record.output = output;
  if (outputText !== undefined) record.outputText = outputText;

  // Error detail carried in a 2xx body (e.g. a failed run with a message).
  const parsedError = parsed?.error;
  if (record.status === "FAILED") {
    const message =
      (typeof parsedError === "string" && parsedError) ||
      (parsedError && typeof parsedError === "object" && typeof (parsedError as Record<string, unknown>).message === "string"
        ? ((parsedError as Record<string, unknown>).message as string)
        : typeof parsed?.message === "string"
          ? parsed.message
          : "Hermes reported a failed execution");
    record.error = { category: "RUNTIME_ERROR", message, retryable: false };
  }

  // A non-null executionId is the opaque reference we keep for polling.
  if (executionId) record.rawRef = `hermes:${runtime.id}:${executionId}`;

  return record;
}
