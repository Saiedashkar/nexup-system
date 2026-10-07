import { assertNexupProfile } from "../hermes-config";
import type {
  HermesAsyncTransport,
  HermesRunStart,
  HermesTransportErrorKind,
  HermesTransportRequest,
  HermesTransportResult,
} from "../hermes-transport";

/**
 * DeterministicHermesTransport — TEST SUPPORT, NOT A PRODUCTION TRANSPORT.
 *
 * This module exists so the test suite can exercise the whole runtime chain —
 * handles, status readback, in-flight cancellation, streaming completion —
 * with no network and no process. It is:
 *
 *   - declared `provenance: "TEST"`, so the runtime adapter refuses to bind it
 *     unless the caller explicitly opted into test transports;
 *   - NOT re-exported from any production barrel (`../index`, the workforce
 *     module surface). Production composition (`createHermesRuntimeFromEnv`)
 *     cannot name it, because it does not build transports from anything but
 *     configuration.
 *
 * Keeping the mock in its own file, behind its own declared provenance, is the
 * architectural separation: the production path does not filter mocks out by
 * provider name, it simply never has one to filter.
 */

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
  /**
   * How long a started run stays RUNNING before its completion resolves. The
   * default 0 models a provider that answers instantly; a larger value makes an
   * IN-FLIGHT run representable offline, which is what status-readback and
   * in-flight cancellation have to be tested against.
   */
  holdCompletionMs?: number;
};

/** One run the deterministic transport is hosting, keyed by its own id. */
type DeterministicRun = {
  executionId: string;
  status: string;
  resolve: (result: HermesTransportResult) => void;
  settled: boolean;
};

export class DeterministicHermesTransport implements HermesAsyncTransport {
  readonly kind = "DETERMINISTIC";
  readonly provenance = "TEST" as const;
  private readonly executions = new Map<string, string>();
  private readonly runs = new Map<string, DeterministicRun>();
  private counter = 0;
  private statusReads = 0;

  constructor(private readonly options: DeterministicHermesOptions = {}) {}

  /**
   * Starts a run and returns its id immediately. This is the shape the real
   * bridge has: the run exists before it has finished, so `status` and `cancel`
   * are meaningful while it is alive.
   */
  async startRun(request: HermesTransportRequest): Promise<HermesRunStart> {
    assertNexupProfile(request.profile);
    const startedAt = Date.now();

    if (this.options.failWith) {
      // It never started. The caller must be told that, not handed a handle to
      // a run that does not exist.
      return {
        state: "NOT_STARTED",
        result: { ok: false, raw: "", truncated: false, durationMs: Date.now() - startedAt, transportError: this.options.failWith },
      };
    }

    this.counter += 1;
    const executionId = `exec_${String(this.counter).padStart(4, "0")}`;
    this.executions.set(executionId, "running");

    if (this.options.malformed) {
      // The run exists; its OUTPUT is uninterpretable. Both facts travel.
      return {
        state: "STARTED",
        executionId,
        completion: Promise.resolve({ ok: true, raw: "", truncated: false, durationMs: Date.now() - startedAt }),
      };
    }

    let settle: (result: HermesTransportResult) => void = () => {};
    const completion = new Promise<HermesTransportResult>((resolve) => {
      settle = resolve;
    });
    const run: DeterministicRun = {
      executionId,
      status: "running",
      settled: false,
      resolve: (result) => {
        run.settled = true;
        settle(result);
      },
    };
    this.runs.set(executionId, run);

    const success = () =>
      this.result(startedAt, {
        executionId,
        status: "succeeded",
        output: { summary: "deterministic market summary", findings: [] },
      });

    const holdMs = this.options.holdCompletionMs ?? 0;
    if (holdMs > 0) {
      setTimeout(() => {
        if (!run.settled) {
          run.status = "succeeded";
          run.resolve(success());
        }
      }, holdMs).unref?.();
    } else {
      run.status = "succeeded";
      run.resolve(success());
    }

    return { state: "STARTED", executionId, completion };
  }

  async invoke(request: HermesTransportRequest): Promise<HermesTransportResult> {
    assertNexupProfile(request.profile);
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
            : {
                ok: true,
                status: this.options.health === "DEGRADED" ? "degraded" : "healthy",
                version: this.options.version ?? "1.0.0-deterministic",
                profile: request.profile,
              },
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
        // A run the transport is ACTUALLY hosting reports its own state. Only an
        // unknown id falls back to the canned sequence, so a status read can
        // never contradict a run this transport started.
        const hosting = this.runs.get(executionId);
        const known = hosting ? hosting.status : this.executions.get(executionId);
        if (known) return this.result(startedAt, { executionId, status: known });
        const sequence = this.options.statusSequence ?? ["queued", "running", "succeeded"];
        const value = sequence[Math.min(this.statusReads, sequence.length - 1)];
        this.statusReads += 1;
        return this.result(startedAt, { executionId, status: value });
      }
      case "cancel": {
        const executionId = request.payload?.executionId ?? "";
        const run = this.runs.get(executionId);
        if (run && !run.settled) {
          // A real cancel ENDS the run: the background consumer must see the
          // cancelled terminal frame, exactly like the bridge.
          run.status = "cancelled";
          run.resolve(this.result(startedAt, { executionId, status: "cancelled" }));
        }
        return this.result(startedAt, { executionId: request.payload?.executionId ?? null, status: "cancelled" });
      }
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
