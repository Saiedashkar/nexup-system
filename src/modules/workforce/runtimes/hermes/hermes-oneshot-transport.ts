import { assertSafeProfile } from "./hermes-config";
import { DEFAULT_HERMES_INSTRUCTION } from "./hermes-mapping";
import { DEFAULT_HERMES_CLI_ONESHOT_PROTOCOL, type HermesCliOneshotProtocol } from "./hermes-protocol";
import {
  boundText,
  defaultHermesSpawn,
  DEFAULT_HERMES_EXECUTABLE_ALLOWLIST,
  isAllowlistedExecutable,
  redactSecrets,
  type HermesSpawnLike,
} from "./hermes-spawn";
import type {
  HermesOperation,
  HermesTransport,
  HermesTransportErrorKind,
  HermesTransportRequest,
  HermesTransportResult,
} from "./hermes-transport";

/**
 * Hermes CLI one-shot transport — the FIRST REAL transport candidate.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 *  VERIFIED invocation (Hermes Agent v0.21.2, 2026.9.11):
 *
 *      hermes -p <profile> -z <prompt>
 *
 *  `--oneshot / -z` sends a single prompt and prints ONLY the final response
 *  text to stdout. Profile isolation is `-p <profile>`. This shape WAS verified
 *  against a real Hermes install — unlike the PROVISIONAL HTTP/CLI transports.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Security posture:
 *   - spawn with an ARGUMENT ARRAY and `shell: false` — the prompt is ALWAYS one
 *     array element, never interpolated into a command string;
 *   - `--yolo` is forbidden and is never emitted;
 *   - the executable basename must be on an allowlist;
 *   - the profile is re-validated as a safe slug; the adapter only ever
 *     addresses its OWN configured profile (never `default`);
 *   - a hard timeout SIGKILLs the process; stdout/stderr are captured separately
 *     and bounded; the auth token is redacted from any captured output;
 *   - it is a SYNCHRONOUS submit only: status/cancel/resume/health are refused
 *     with an UNSUPPORTED result rather than faked.
 *
 * NOT wired yet (deliberately, per discovery): `--usage-file`, `--resume`,
 * `--continue`, `--skills`, `--toolsets`.
 */

/** Flags this transport must never emit. */
export const FORBIDDEN_HERMES_FLAGS: readonly string[] = ["--yolo"];

export type HermesCliOneshotTransportOptions = {
  executablePath: string;
  executableAllowlist?: readonly string[];
  /** Secret to redact from output; never logged. */
  token?: string;
  /** Overridable for tests. Returns spawn-like output. */
  spawnImpl?: HermesSpawnLike;
  /** VERIFIED one-shot flag mapping (`-p`/`-z`). Overridable for a future Hermes. */
  protocol?: HermesCliOneshotProtocol;
  /** Include the bounded job context in the prompt. Default true. */
  includeContext?: boolean;
};

/** Operations a synchronous one-shot run can perform. */
const ONESHOT_SUPPORTED: readonly HermesOperation[] = ["submit"];

/**
 * Composes the single prompt string. It is passed as ONE argv element, so shell
 * metacharacters inside it are inert data.
 */
export function composeOneshotPrompt(request: HermesTransportRequest, includeContext = true): string {
  const instruction = request.payload?.instruction?.trim() || DEFAULT_HERMES_INSTRUCTION;
  const contextJson = request.payload?.contextJson;
  if (!includeContext || !contextJson || contextJson === "{}") return instruction;
  return `${instruction}\n\n---\nCONTEXT (JSON):\n${contextJson}`;
}

export class HermesCliOneshotTransport implements HermesTransport {
  readonly kind = "CLI_ONESHOT";

  private readonly options: HermesCliOneshotTransportOptions;
  /** VERIFIED flag mapping (`-p`/`-z`), adapter-owned. */
  private readonly protocol: HermesCliOneshotProtocol;

  constructor(options: HermesCliOneshotTransportOptions) {
    this.options = options;
    this.protocol = options.protocol ?? DEFAULT_HERMES_CLI_ONESHOT_PROTOCOL;
  }

  /**
   * Builds the VERIFIED argument array: `<profileFlag> <profile> <oneshotFlag> <prompt>`.
   * The prompt is a single element. No other operation is buildable.
   */
  buildArgs(request: HermesTransportRequest): string[] {
    assertSafeProfile(request.profile);
    if (request.operation !== "submit") return [];
    const prompt = composeOneshotPrompt(request, this.options.includeContext ?? true);
    return [this.protocol.profileFlag, request.profile, this.protocol.oneshotFlag, prompt];
  }

  async invoke(request: HermesTransportRequest): Promise<HermesTransportResult> {
    const startedAt = Date.now();

    // A synchronous one-shot run has no status/health/cancel/resume surface.
    // Refuse honestly instead of inventing a result or spawning blindly.
    if (!ONESHOT_SUPPORTED.includes(request.operation)) {
      return this.failure("UNSUPPORTED", startedAt);
    }

    const allowlist = this.options.executableAllowlist ?? DEFAULT_HERMES_EXECUTABLE_ALLOWLIST;
    if (!isAllowlistedExecutable(this.options.executablePath, allowlist)) {
      return this.failure("BLOCKED_COMMAND", startedAt);
    }

    let args: string[];
    try {
      args = this.buildArgs(request);
    } catch {
      return this.failure("BLOCKED_COMMAND", startedAt);
    }
    // Defense in depth: a forbidden flag can never reach the process.
    if (args.some((arg) => FORBIDDEN_HERMES_FLAGS.includes(arg))) {
      return this.failure("BLOCKED_COMMAND", startedAt);
    }

    const run = this.options.spawnImpl ?? defaultHermesSpawn;
    const result = await run({
      executablePath: this.options.executablePath,
      args,
      timeoutMs: request.timeoutMs,
      maxOutputBytes: request.maxOutputBytes,
    });

    const secrets = this.options.token ? [this.options.token] : [];
    const stdout = redactSecrets(result.stdout, secrets);
    const stderr = redactSecrets(result.stderr, secrets);
    const bounded = boundText(stdout, request.maxOutputBytes);

    return {
      ok: !result.timedOut && result.code === 0,
      raw: bounded.text,
      truncated: bounded.truncated,
      exitCode: result.code ?? undefined,
      stderr: stderr || undefined,
      durationMs: Date.now() - startedAt,
      transportError: result.timedOut ? "TIMEOUT" : result.code === 0 ? undefined : "UNAVAILABLE",
    };
  }

  private failure(kind: HermesTransportErrorKind, startedAt: number): HermesTransportResult {
    return { ok: false, raw: "", truncated: false, durationMs: Date.now() - startedAt, transportError: kind };
  }
}
