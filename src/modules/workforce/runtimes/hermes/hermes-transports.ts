import type { HermesRuntimeConfig } from "./hermes-config";
import { assertSafeProfile } from "./hermes-config";
import { HermesCliOneshotTransport } from "./hermes-oneshot-transport";
import { HermesRpcTransport, type HermesWebSocketFactory } from "./hermes-rpc-transport";
import {
  DEFAULT_HERMES_CLI_PROTOCOL,
  DEFAULT_HERMES_HTTP_PROTOCOL,
  DEFAULT_HERMES_SUBMIT_BODY,
  renderHermesHttpPath,
  type HermesCliProtocol,
  type HermesHttpProtocol,
  type HermesProtocolConfig,
} from "./hermes-protocol";
import {
  boundText,
  defaultHermesSpawn,
  DEFAULT_HERMES_EXECUTABLE_ALLOWLIST,
  isAllowlistedExecutable,
  redactSecrets,
  type HermesSpawnInput,
  type HermesSpawnLike,
} from "./hermes-spawn";
import type {
  HermesOperation,
  HermesTransport,
  HermesTransportErrorKind,
  HermesTransportRequest,
  HermesTransportResult,
} from "./hermes-transport";

// Re-exported so existing importers (and the module surface) keep working.
export * from "./hermes-spawn";

/**
 * Hermes transport implementations.
 *
 *   HermesRpcTransport            VERIFIED WebSocket JSON-RPC 2.0 — the PRIMARY
 *                                 production transport (see hermes-rpc-transport.ts)
 *   DeterministicHermesTransport  tests only — no network, no process
 *   HermesCliOneshotTransport     VERIFIED `hermes -p <profile> -z <prompt>` — an
 *                                 explicit fallback/diagnostic, not the default
 *   HermesHttpTransport           QUARANTINED — PROVISIONAL guessed REST paths;
 *   HermesCliTransport            QUARANTINED — PROVISIONAL guessed subcommands.
 *                                 Both are kept ONLY as inactive scaffolding: they
 *                                 are NOT reachable from the default factory and
 *                                 must never be presented as verified Hermes APIs.
 *
 * The HTTP paths and CLI subcommands the quarantined transports emit are NOT
 * hardcoded here; they come from an adapter-owned PROVISIONAL protocol object
 * (`hermes-protocol.ts`). The PRIMARY (RPC) contract is VERIFIED.
 */

/* ═══════════════════════════════════════════════════════
   Deterministic transport (tests only)
   ═══════════════════════════════════════════════════════ */

export type DeterministicHermesOptions = {
  /** Forced health outcome. */
  health?: "HEALTHY" | "DEGRADED" | "UNAVAILABLE";
  /** Statuses returned by successive `status` calls; the last repeats. */
  statusSequence?: readonly string[];
  /** Force a transport-level failure. */
  failWith?: HermesTransportErrorKind;
  /** Return non-JSON garbage. */
  malformed?: boolean;
  version?: string;
};

export class DeterministicHermesTransport implements HermesTransport {
  readonly kind = "DETERMINISTIC";
  private readonly executions = new Map<string, string>();
  private counter = 0;
  private statusReads = 0;

  constructor(private readonly options: DeterministicHermesOptions = {}) {}

  async invoke(request: HermesTransportRequest): Promise<HermesTransportResult> {
    assertSafeProfile(request.profile);
    const startedAt = Date.now();

    if (this.options.failWith) {
      return {
        ok: false,
        raw: "",
        truncated: false,
        durationMs: Date.now() - startedAt,
        transportError: this.options.failWith,
      };
    }
    if (this.options.malformed) {
      // A 2xx response with no interpretable body.
      return { ok: true, raw: "", truncated: false, durationMs: Date.now() - startedAt };
    }

    switch (request.operation) {
      case "health":
        return this.result(
          startedAt,
          this.options.health === "UNAVAILABLE"
            ? { ok: false, status: "unavailable" }
            : { ok: true, status: this.options.health === "DEGRADED" ? "degraded" : "healthy", version: this.options.version ?? "1.0.0-deterministic", profile: request.profile },
        );
      case "submit": {
        this.counter += 1;
        const executionId = `exec_${String(this.counter).padStart(4, "0")}`;
        this.executions.set(executionId, "succeeded");
        // A synchronous-style provider completes on submit; the async path is
        // exercised through `status` (see statusSequence).
        return this.result(startedAt, {
          executionId,
          status: "succeeded",
          output: { summary: "deterministic market summary", findings: [] },
        });
      }
      case "status": {
        const executionId = request.payload?.executionId ?? "exec_0001";
        const sequence = this.options.statusSequence ?? ["queued", "running", "succeeded"];
        const value = sequence[Math.min(this.statusReads, sequence.length - 1)];
        this.statusReads += 1;
        return this.result(startedAt, { executionId, status: value });
      }
      case "cancel":
        return this.result(startedAt, { executionId: request.payload?.executionId ?? null, status: "cancelled" });
      case "resume":
        return this.result(startedAt, { executionId: request.payload?.executionId ?? null, status: "running" });
      default:
        return this.result(startedAt, { status: "unknown" });
    }
  }

  private result(startedAt: number, body: unknown): HermesTransportResult {
    return {
      ok: true,
      raw: JSON.stringify(body),
      truncated: false,
      durationMs: Date.now() - startedAt,
    };
  }
}

/* ═══════════════════════════════════════════════════════
   HTTP transport — QUARANTINED (PROVISIONAL, never a default)

   The REST paths below are ASSUMPTIONS, retained only so the surface can be
   swapped in one place. This transport is NOT selected by `resolveHermesConfig`
   unless an operator explicitly sets HERMES_RUNTIME_TRANSPORT=HTTP, and it must
   not be described as a verified Hermes API. The real production path is RPC.
   ═══════════════════════════════════════════════════════ */

export type HermesHttpTransportOptions = {
  endpoint: string;
  authHeaderName: string;
  authScheme: string;
  /** Secret. Read from env by the factory; never logged or returned. */
  token?: string;
  fetchImpl?: typeof fetch;
  /**
   * Adapter-owned PROVISIONAL HTTP protocol (assumed paths, not a verified
   * contract). Falls back to the provisional defaults when absent.
   */
  protocol?: HermesHttpProtocol;
};

async function readBounded(response: Response, maxBytes: number): Promise<{ text: string; truncated: boolean }> {
  const body = response.body;
  if (!body || typeof body.getReader !== "function") {
    return boundText(await response.text(), maxBytes);
  }
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let text = "";
  let truncated = false;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    text += decoder.decode(value, { stream: true });
    if (text.length >= maxBytes) {
      truncated = true;
      await reader.cancel().catch(() => {});
      break;
    }
  }
  text += decoder.decode();
  const bounded = boundText(text, maxBytes);
  return { text: bounded.text, truncated: truncated || bounded.truncated };
}

export class HermesHttpTransport implements HermesTransport {
  readonly kind = "HTTP";

  private readonly options: HermesHttpTransportOptions;
  /** PROVISIONAL, adapter-owned. Assumed paths; UNVERIFIED contract. */
  private readonly protocol: HermesHttpProtocol;

  constructor(options: HermesHttpTransportOptions) {
    this.options = options;
    this.protocol = options.protocol ?? DEFAULT_HERMES_HTTP_PROTOCOL;
  }

  async invoke(request: HermesTransportRequest): Promise<HermesTransportResult> {
    assertSafeProfile(request.profile);

    const fetchImpl = this.options.fetchImpl ?? globalThis.fetch;
    if (typeof fetchImpl !== "function") {
      return this.failure("UNAVAILABLE", Date.now());
    }

    const base = this.options.endpoint.replace(/\/+$/, "");
    const startedAt = Date.now();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), request.timeoutMs);

    const headers: Record<string, string> = { "content-type": "application/json", accept: "application/json" };
    if (this.options.token) {
      headers[this.options.authHeaderName] = this.options.authScheme
        ? `${this.options.authScheme} ${this.options.token}`
        : this.options.token;
    }

    try {
      const { url, method, body } = this.route(base, request);
      const response = await fetchImpl(url, {
        method,
        headers,
        signal: controller.signal,
        body: body ? JSON.stringify(body) : undefined,
      });

      const bounded = await readBounded(response, request.maxOutputBytes);
      const secrets = this.options.token ? [this.options.token] : [];
      return {
        ok: response.ok,
        raw: redactSecrets(bounded.text, secrets),
        truncated: bounded.truncated,
        durationMs: Date.now() - startedAt,
        httpStatus: response.status,
        transportError: response.ok ? undefined : "HTTP_ERROR",
      };
    } catch (error) {
      const aborted = error instanceof Error && error.name === "AbortError";
      return this.failure(aborted ? "TIMEOUT" : "UNAVAILABLE", startedAt);
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Builds the request from the adapter-owned PROVISIONAL protocol. No path or
   * body field name is treated as universal — everything comes from config.
   */
  private route(
    base: string,
    request: HermesTransportRequest,
  ): { url: string; method: string; body?: Record<string, unknown> } {
    const operation: HermesOperation = request.operation;
    const spec = this.protocol[operation] ?? this.protocol.health;
    const path = renderHermesHttpPath(spec.path, {
      profile: encodeURIComponent(request.profile),
      id: encodeURIComponent(request.payload?.executionId ?? ""),
    });
    const url = `${base}${path.startsWith("/") ? "" : "/"}${path}`;
    const entry: { url: string; method: string; body?: Record<string, unknown> } = { url, method: spec.method };
    if (operation === "submit") {
      const mapping = this.protocol.submitBody ?? DEFAULT_HERMES_SUBMIT_BODY;
      entry.body = {
        [mapping.profile]: request.profile,
        [mapping.instruction]: request.payload?.instruction ?? "",
        [mapping.context]: request.payload?.contextJson ?? "{}",
        [mapping.correlation]: request.correlation,
      };
    }
    return entry;
  }

  private failure(kind: HermesTransportErrorKind, startedAt: number): HermesTransportResult {
    return { ok: false, raw: "", truncated: false, durationMs: Date.now() - startedAt, transportError: kind };
  }
}

/* ═══════════════════════════════════════════════════════
   CLI transport — QUARANTINED (PROVISIONAL subcommands, never a default)

   Only selected when an operator explicitly sets HERMES_RUNTIME_TRANSPORT=CLI.
   The subcommand mapping is an ASSUMPTION; the verified CLI surface is one-shot.

   Safety controls:
     - `spawn` with an ARGUMENT ARRAY, `shell: false` — never a shell string
     - the executable basename must be in an allowlist
     - the profile is re-validated as a safe slug before use
     - hard timeout kills the process
     - stdout/stderr captured SEPARATELY and bounded
     - the auth token is redacted from any captured output
     - arguments are built from a fixed template; no job payload is ever
       interpolated into a command */

export type HermesCliTransportOptions = {
  executablePath: string;
  executableAllowlist?: readonly string[];
  /** Secret to redact from output; never logged. */
  token?: string;
  /** Overridable for tests. Returns spawn-like output. */
  spawnImpl?: HermesSpawnLike;
  /**
   * Adapter-owned PROVISIONAL CLI protocol (assumed subcommand mapping, not a
   * verified contract). Falls back to the provisional defaults when absent.
   */
  protocol?: HermesCliProtocol;
};

export class HermesCliTransport implements HermesTransport {
  readonly kind = "CLI";

  private readonly options: HermesCliTransportOptions;
  /** PROVISIONAL, adapter-owned. Assumed subcommand mapping; UNVERIFIED contract. */
  private readonly protocol: HermesCliProtocol;

  constructor(options: HermesCliTransportOptions) {
    this.options = options;
    this.protocol = options.protocol ?? DEFAULT_HERMES_CLI_PROTOCOL;
  }

  /**
   * Builds the argument ARRAY from the adapter-owned PROVISIONAL protocol. The
   * subcommand tokens and flags are config, never hardcoded; profile and
   * execution id are always single array elements (never a shell fragment).
   */
  buildArgs(request: HermesTransportRequest): string[] {
    assertSafeProfile(request.profile);
    const spec = this.protocol[request.operation] ?? this.protocol.health;
    const args: string[] = [...spec.command];
    if (spec.profileFlag) args.push(spec.profileFlag, request.profile);
    if (spec.executionFlag) args.push(spec.executionFlag, request.payload?.executionId ?? "");
    if (spec.stdinFlag) args.push(spec.stdinFlag);
    return args;
  }

  async invoke(request: HermesTransportRequest): Promise<HermesTransportResult> {
    const startedAt = Date.now();
    const allowlist = this.options.executableAllowlist ?? DEFAULT_HERMES_EXECUTABLE_ALLOWLIST;
    if (!isAllowlistedExecutable(this.options.executablePath, allowlist)) {
      return { ok: false, raw: "", truncated: false, durationMs: Date.now() - startedAt, transportError: "BLOCKED_COMMAND" };
    }

    let args: string[];
    try {
      args = this.buildArgs(request);
    } catch {
      return { ok: false, raw: "", truncated: false, durationMs: Date.now() - startedAt, transportError: "BLOCKED_COMMAND" };
    }

    const run = this.options.spawnImpl ?? defaultHermesSpawn;
    const spawnInput: HermesSpawnInput = {
      executablePath: this.options.executablePath,
      args,
      timeoutMs: request.timeoutMs,
      maxOutputBytes: request.maxOutputBytes,
    };
    // stdin carries the mapped payload for submit; it is DATA, never a command.
    if (request.operation === "submit" && request.payload) {
      spawnInput.stdin = JSON.stringify({ instruction: request.payload.instruction, context: request.payload.contextJson });
    }
    const result = await run(spawnInput);

    const secrets = this.options.token ? [this.options.token] : [];
    const stdout = redactSecrets(result.stdout, secrets);
    const stderr = redactSecrets(result.stderr, secrets);

    return {
      ok: !result.timedOut && result.code === 0,
      raw: stdout,
      truncated: stdout.length >= request.maxOutputBytes,
      exitCode: result.code ?? undefined,
      stderr: stderr || undefined,
      durationMs: Date.now() - startedAt,
      transportError: result.timedOut ? "TIMEOUT" : result.code === 0 ? undefined : "UNAVAILABLE",
    };
  }
}

/* ═══════════════════════════════════════════════════════
   Factory
   ═══════════════════════════════════════════════════════ */

export type CreateHermesTransportOptions = {
  fetchImpl?: typeof fetch;
  spawnImpl?: HermesSpawnLike;
  /** Secret read from the environment by the caller; never logged. */
  token?: string;
  /** Injected WebSocket factory for the RPC transport (tests). */
  webSocketFactory?: HermesWebSocketFactory;
  /** Adapter-owned protocol; defaults to `config.protocol`. */
  protocol?: HermesProtocolConfig;
};

export function createHermesTransport(
  config: HermesRuntimeConfig,
  options: CreateHermesTransportOptions = {},
): HermesTransport {
  const protocol = options.protocol ?? config.protocol;
  if (config.transport === "RPC") {
    return new HermesRpcTransport({
      endpoint: config.rpcEndpoint ?? config.endpoint ?? "",
      profile: config.profile,
      token: options.token,
      authHeaderName: config.authHeaderName,
      authScheme: config.authScheme,
      ...(protocol ? { protocol: protocol.rpc } : {}),
      ...(options.webSocketFactory ? { webSocketFactory: options.webSocketFactory } : {}),
    });
  }
  if (config.transport === "CLI_ONESHOT") {
    return new HermesCliOneshotTransport({
      executablePath: config.executablePath ?? "",
      protocol: protocol?.oneshot,
      token: options.token,
      spawnImpl: options.spawnImpl,
    });
  }
  if (config.transport === "CLI") {
    const cli: HermesCliTransportOptions = {
      executablePath: config.executablePath ?? "",
      token: options.token,
    };
    if (options.spawnImpl) cli.spawnImpl = options.spawnImpl;
    if (protocol) cli.protocol = protocol.cli;
    return new HermesCliTransport(cli);
  }
  const http: HermesHttpTransportOptions = {
    endpoint: config.endpoint ?? "",
    authHeaderName: config.authHeaderName,
    authScheme: config.authScheme,
  };
  if (options.fetchImpl) http.fetchImpl = options.fetchImpl;
  if (options.token) http.token = options.token;
  if (protocol) http.protocol = protocol.http;
  return new HermesHttpTransport(http);
}
