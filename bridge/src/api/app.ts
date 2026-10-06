import type { NonceStore } from "../auth/nonce-store";
import { resolveClientIdentity } from "../auth/client-identity";
import type { PreAuthGuard } from "../auth/pre-auth-guard";
import type { RateLimiter } from "../auth/rate-limit";
import { verifySignedRequest } from "../auth/signature";
import type { BridgeConfig } from "../config";
import { isTerminalRunStatus, type RunManager, type RunSpec } from "../hermes/run-manager";
import type { AuditLog } from "../observability/audit";
import type { Logger } from "../observability/logger";
import type { Metrics } from "../observability/metrics";
import type { Redactor } from "../redaction";
import type { SseStream } from "../stream/sse";
import { BRIDGE_ALLOWED_HERMES_METHODS, BRIDGE_EXCLUDED_HERMES_METHODS } from "../hermes/allowlist";
import { BridgeError, toErrorEnvelope } from "./errors";
import { parseRunSubmission } from "./run-request";

/**
 * The bridge HTTP application.
 *
 * A pure request → result function (no socket, no globals) so the entire
 * security perimeter and the route table can be tested in-process:
 *
 *   1. verify the HMAC signature, timestamp window and nonce (replay);
 *   2. apply the per-key rate limit;
 *   3. route — every path is NEXUP-owned, there is NO generic RPC passthrough;
 *   4. audit the outcome.
 *
 * The application never chooses a Hermes method or profile from the request.
 */

export type BridgeRequest = {
  method: string;
  /** Path only (query string already stripped). */
  path: string;
  /** Query string including `?`, or `undefined`/`""` when absent. Never used. */
  query?: string;
  headers: Record<string, string | undefined>;
  body: string;
  remote?: string;
};

export type BridgeJsonResult = { kind: "json"; status: number; body: unknown };

export type BridgeSseResult = {
  kind: "sse";
  status: number;
  headers: Record<string, string>;
  /** Wires the run's event stream to `stream`; returns a cleanup function. */
  open: (stream: SseStream) => () => void;
};

export type BridgeResult = BridgeJsonResult | BridgeSseResult;

export type BridgeAppDeps = {
  config: BridgeConfig;
  /** The HMAC secret, held separately from the config so the config stays safe to log. */
  hmacSecret: string;
  runManager: RunManager;
  audit: AuditLog;
  logger: Logger;
  metrics: Metrics;
  redactor: Redactor;
  nonceStore: NonceStore;
  rateLimiter: RateLimiter;
  /** Bounds unauthenticated traffic and downsamples auth-failure auditing. */
  preAuthGuard: PreAuthGuard;
  now?: () => Date;
};

export type BridgeApp = { handle(request: BridgeRequest): Promise<BridgeResult> };

const RUN_PATH = /^\/v1\/runs\/([^/]+)(?:\/(stream|cancel))?$/;

type RunPathMatch = { id: string | null; action: "status" | "stream" | "cancel" } | null;

/**
 * Never throws: a malformed percent-encoding yields `id: null` (→ BAD_REQUEST)
 * instead of escaping routing or the audit path.
 */
function matchRunPath(path: string): RunPathMatch {
  const match = RUN_PATH.exec(path);
  if (!match) return null;
  let id: string | null;
  try {
    id = decodeURIComponent(match[1]);
  } catch {
    id = null;
  }
  const tail = match[2];
  return { id, action: tail === "stream" ? "stream" : tail === "cancel" ? "cancel" : "status" };
}

function parseJsonBody(body: string): Record<string, unknown> {
  if (!body) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    throw new BridgeError("BAD_REQUEST", "Request body must be valid JSON");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new BridgeError("BAD_REQUEST", "Request body must be a JSON object");
  }
  return parsed as Record<string, unknown>;
}

/** Total and non-throwing: naming an audit line must never fail a request. */
function actionFor(request: BridgeRequest): string {
  try {
    if (request.path === "/v1/health") return "health";
    if (request.path === "/v1/capabilities") return "capabilities";
    if (request.path === "/v1/runs") return "run.submit";
    const run = matchRunPath(request.path);
    if (run) return run.action === "stream" ? "run.stream" : run.action === "cancel" ? "run.cancel" : "run.status";
  } catch {
    /* fall through to the generic action */
  }
  return "request";
}

export function createBridgeApp(deps: BridgeAppDeps): BridgeApp {
  const { config, runManager } = deps;
  const now = deps.now ?? (() => new Date());

  async function route(request: BridgeRequest, keyId: string): Promise<BridgeResult> {
    const { method } = request;

    if (method === "GET" && request.path === "/v1/health") {
      const health = await runManager.health();
      const ok = health.status !== "unavailable";
      deps.metrics.setGauge("bridge_hermes_up", ok ? 1 : 0);
      return {
        kind: "json",
        status: ok ? 200 : 503,
        body: { bridge: "ok", hermes: health.status, detail: health.detail, profile: health.profile },
      };
    }

    if (method === "GET" && request.path === "/v1/capabilities") {
      return {
        kind: "json",
        status: 200,
        body: {
          bridge: "nexup-vps-bridge",
          version: 1,
          profile: config.hermes.profile,
          pinnedProfile: true,
          transport: "rpc",
          operations: ["health", "submit", "status", "cancel"],
          hermesMethods: [...BRIDGE_ALLOWED_HERMES_METHODS],
          excludedMethods: [...BRIDGE_EXCLUDED_HERMES_METHODS],
          lifecycleManaged: false,
          limits: {
            maxConcurrency: config.maxConcurrency,
            rateLimitPerMinute: config.rateLimitPerMinute,
            maxOutputBytes: config.maxOutputBytes,
            timeoutMs: config.timeoutMs,
          },
        },
      };
    }

    if (method === "POST" && request.path === "/v1/runs") {
      // Strict, declarative schema: an undeclared field is refused rather than
      // ignored, so the bridge never accepts a scope it cannot honour.
      const submission = parseRunSubmission(parseJsonBody(request.body), { maxTimeoutMs: config.timeoutMs });

      const spec: RunSpec = {
        // The authenticated key id travels with the run so its outcome is
        // attributed to the real caller, not to the run id.
        keyId,
        ...submission,
      };

      const record = runManager.submit(spec);
      return {
        kind: "json",
        status: 201,
        body: { runId: record.runId, streamUrl: `/v1/runs/${record.runId}/stream`, status: record.status, keyId },
      };
    }

    const run = matchRunPath(request.path);
    if (run) {
      if (run.id === null) throw new BridgeError("BAD_REQUEST", "Run id is not valid percent-encoded text");
      const record = runManager.get(run.id);
      if (!record) throw new BridgeError("RUN_NOT_FOUND", `No run "${run.id}"`);

      if (method === "GET" && run.action === "status") {
        return {
          kind: "json",
          status: 200,
          body: {
            runId: record.runId,
            status: record.status,
            executionId: record.executionId ?? null,
            startedAt: record.startedAt,
            endedAt: record.endedAt ?? null,
            bytesOut: record.bytesOut,
            errorCode: record.errorCode ?? null,
          },
        };
      }

      if (method === "POST" && run.action === "cancel") {
        const updated = await runManager.abort(record.runId);
        return { kind: "json", status: 200, body: { runId: updated.runId, status: updated.status } };
      }

      if (method === "GET" && run.action === "stream") {
        return {
          kind: "sse",
          status: 200,
          headers: { "x-nexup-run-id": record.runId },
          open: (stream: SseStream) => {
            const unsubscribe = runManager.subscribe(record.runId, (event) => {
              stream.send(event.event, event.data);
              if (event.event === "complete" || event.event === "error") stream.close();
            });
            const current = runManager.get(record.runId);
            if (current && isTerminalRunStatus(current.status)) stream.close();
            const offClose = stream.onClose(() => {
              unsubscribe();
              void runManager.abort(record.runId).catch(() => {});
            });
            return () => {
              unsubscribe();
              offClose();
            };
          },
        };
      }
    }

    throw new BridgeError("METHOD_NOT_ALLOWED", `No bridge route for ${method} ${request.path}`);
  }

  return {
    async handle(request: BridgeRequest): Promise<BridgeResult> {
      const startedAt = Date.now();
      const nowMs = now().getTime();
      // Behind the loopback proxy the socket peer is always the proxy, so the
      // caller identity comes from the proxy-overwritten header — and only when
      // the peer really is the proxy. Otherwise this is the peer address.
      const remoteKey = resolveClientIdentity({
        headers: request.headers,
        socketAddress: request.remote,
        trustedProxies: config.trustedProxyAddresses,
        headerName: config.clientIpHeader,
      });
      deps.metrics.inc("bridge_requests");

      // PRE-AUTHENTICATION GUARD. Runs before any signature/HMAC work so an
      // unauthenticated flood is bounded, and so auth-failure auditing is
      // downsampled rather than amplified.
      if (!deps.preAuthGuard.check(remoteKey, nowMs)) {
        deps.metrics.inc("bridge_preauth_rejected");
        if (deps.preAuthGuard.shouldAuditAuthFailure(remoteKey, nowMs)) {
          deps.audit.record({
            action: actionFor(request),
            keyId: "unauthenticated",
            profile: config.hermes.profile,
            outcome: "denied",
            statusCode: 429,
            durationMs: Date.now() - startedAt,
            detail: "PREAUTH_RATE_LIMITED",
            remote: remoteKey,
          });
        }
        const throttled = toErrorEnvelope(
          new BridgeError("RATE_LIMITED", "Bridge pre-authentication rate limit exceeded"),
        );
        return { kind: "json", status: throttled.status, body: deps.redactor.value(throttled.envelope) };
      }

      let keyId = "unknown";

      try {
        const identity = verifySignedRequest({
          method: request.method,
          path: request.path,
          headers: request.headers,
          body: request.body,
          nowMs,
          hmacSecret: deps.hmacSecret,
          allowedKeyIds: config.allowedKeyIds,
          clockSkewSeconds: config.clockSkewSeconds,
          nonceStore: deps.nonceStore,
        });
        keyId = identity.keyId;

        // The bridge API takes no query parameters. A query string is unsigned,
        // so it is rejected outright rather than silently ignored.
        if (request.query) {
          throw new BridgeError("BAD_REQUEST", "Query strings are not accepted by the bridge API");
        }

        if (!deps.rateLimiter.check(keyId, nowMs)) {
          deps.metrics.inc("bridge_rate_limited");
          throw new BridgeError("RATE_LIMITED", "Bridge rate limit exceeded");
        }

        const result = await route(request, keyId);
        deps.audit.record({
          action: actionFor(request),
          keyId,
          profile: config.hermes.profile,
          outcome: "allowed",
          statusCode: result.status,
          durationMs: Date.now() - startedAt,
          remote: remoteKey,
        });
        return result;
      } catch (error) {
        const { status, envelope } = toErrorEnvelope(error);
        const isAuthFailure =
          envelope.error.code === "SIGNATURE_INVALID" ||
          envelope.error.code === "REPLAY" ||
          envelope.error.code === "UNAUTHORIZED";
        if (isAuthFailure) deps.metrics.inc("bridge_auth_failures");
        deps.metrics.inc("bridge_errors");

        // Authentication failures are counted in full but audited only up to a
        // per-window threshold, so repeated failures cannot amplify the log.
        if (!isAuthFailure || deps.preAuthGuard.shouldAuditAuthFailure(remoteKey, nowMs)) {
          deps.audit.record({
            action: actionFor(request),
            keyId,
            profile: config.hermes.profile,
            outcome: "denied",
            statusCode: status,
            durationMs: Date.now() - startedAt,
            detail: envelope.error.code,
            remote: remoteKey,
          });
        }
        return { kind: "json", status, body: deps.redactor.value(envelope) };
      }
    },
  };
}
