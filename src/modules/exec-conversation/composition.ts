import {
  EXEC_TURN_TIMEOUT_MS,
  execErrorStatus,
  limitExecReplyText,
  type ExecTurnErrorCode,
} from "./contracts";
import type { ExecConnector, ExecConnectorTurn } from "./connector";
import { isExecConnectorError } from "./connector";
import { clampDummyDelayMs, createDummyConnector } from "./dummy-connector";

/**
 * Composition + the binding that turns one connector call into one outcome.
 *
 * Two responsibilities live here on purpose:
 *
 *  1. `resolveExecConnector` — the ONLY place that decides whether a connector
 *     may run. It fails closed: nothing is enabled unless the environment
 *     states it explicitly, and production never is.
 *  2. `runExecTurn` — the timeout is a BINDING, not a hint. An AbortSignal is
 *     only a request to cooperate, so a connector that ignores it must not be
 *     able to answer after its turn was abandoned.
 */

/** String discriminant: boolean-literal unions do not narrow under `strict: false`. */
export type ExecConnectorResolution =
  | { kind: "connector"; connector: ExecConnector; delayMs: number }
  | { kind: "refused"; reason: "production" | "not_requested" | "allow_test_missing" };

/**
 * Enablement rules, all three required — no implicit path to the dummy:
 *   - NODE_ENV is not "production";
 *   - EXEC_CONNECTOR === "dummy" (the only registered kind);
 *   - EXEC_CONNECTOR_ALLOW_TEST === "1" (a second, deliberate opt-in).
 *
 * There is no fallback: a refused resolution becomes 503 CONNECTOR_UNAVAILABLE
 * and the UI shows the error. It never quietly falls back to the demo engine.
 */
export function resolveExecConnector(env: NodeJS.ProcessEnv = process.env): ExecConnectorResolution {
  if ((env.NODE_ENV ?? "").trim().toLowerCase() === "production") {
    return { kind: "refused", reason: "production" };
  }

  if ((env.EXEC_CONNECTOR ?? "").trim().toLowerCase() !== "dummy") {
    return { kind: "refused", reason: "not_requested" };
  }

  if ((env.EXEC_CONNECTOR_ALLOW_TEST ?? "").trim() !== "1") {
    return { kind: "refused", reason: "allow_test_missing" };
  }

  const delayMs = clampDummyDelayMs(env.EXEC_DUMMY_DELAY_MS);
  return { kind: "connector", connector: createDummyConnector({ delayMs }), delayMs };
}

export type ExecTurnOutcome =
  | { kind: "reply"; text: string; truncated: boolean; durationMs: number }
  | { kind: "timeout" }
  | { kind: "failed"; code: Extract<ExecTurnErrorCode, "CONNECTOR_UNAVAILABLE" | "INTERNAL"> };

export type RunExecTurnInput = {
  connector: ExecConnector;
  turn: Omit<ExecConnectorTurn, "signal">;
  /** Defaults to the contract constant. Only tests pass a smaller binding. */
  timeoutMs?: number;
  /** Observability hook. Receives text only — never the user's message. */
  onEvent?: (event: string) => void;
};

/**
 * Runs exactly one connector turn under a hard deadline.
 *
 * Guarantees:
 *   - the connector is invoked exactly once;
 *   - the returned promise settles exactly once;
 *   - whatever a connector does after the deadline (resolve or reject) is
 *     consumed for logging and can neither produce a reply nor mutate state;
 *   - a rejection never escapes as an unhandled rejection.
 */
export async function runExecTurn({
  connector,
  turn,
  timeoutMs = EXEC_TURN_TIMEOUT_MS,
  onEvent,
}: RunExecTurnInput): Promise<ExecTurnOutcome> {
  const log = (event: string) => {
    try {
      onEvent?.(event);
    } catch {
      // Observability must never break the turn.
    }
  };

  const controller = new AbortController();
  const startedAt = Date.now();
  let settled = false;
  let timer: ReturnType<typeof setTimeout> | undefined;

  return new Promise<ExecTurnOutcome>((resolve) => {
    const finish = (outcome: ExecTurnOutcome) => {
      if (settled) return;
      settled = true;
      if (timer !== undefined) clearTimeout(timer);
      resolve(outcome);
    };

    timer = setTimeout(() => {
      if (settled) return;
      // Abort first so a cooperating connector stops working right away; the
      // deadline itself does not depend on that cooperation.
      controller.abort();
      log("exec-conversation.timeout");
      finish({ kind: "timeout" });
      // `finish` clears the timer; the deadline cannot fire twice.
    }, timeoutMs);

    let pending: Promise<{ text: string; durationMs: number }>;
    try {
      pending = connector.send({ ...turn, signal: controller.signal });
    } catch (error) {
      log(`exec-conversation.send_threw:${error instanceof Error ? error.name : "unknown"}`);
      finish({ kind: "failed", code: "INTERNAL" });
      return;
    }

    pending.then(
      (reply) => {
        if (settled) {
          // Late fulfillment: consumed, logged, discarded.
          log("exec-conversation.late_reply_discarded");
          return;
        }
        const limited = limitExecReplyText(typeof reply?.text === "string" ? reply.text : "");
        if (limited.text.length === 0) {
          finish({ kind: "failed", code: "INTERNAL" });
          return;
        }
        finish({
          kind: "reply",
          text: limited.text,
          truncated: limited.truncated,
          durationMs: typeof reply?.durationMs === "number" ? reply.durationMs : Date.now() - startedAt,
        });
      },
      (error: unknown) => {
        if (settled) {
          // Late rejection: consumed (no unhandled rejection), never surfaced.
          log("exec-conversation.late_rejection_discarded");
          return;
        }
        if (isExecConnectorError(error) && error.code === "CONNECTOR_UNAVAILABLE") {
          finish({ kind: "failed", code: "CONNECTOR_UNAVAILABLE" });
          return;
        }
        log(`exec-conversation.failed:${error instanceof Error ? error.name : "unknown"}`);
        finish({ kind: "failed", code: "INTERNAL" });
      },
    );
  });
}

/** The single mapping from an outcome to a wire status. */
export function execTurnOutcomeStatus(outcome: ExecTurnOutcome): number {
  if (outcome.kind === "reply") return 200;
  if (outcome.kind === "timeout") return execErrorStatus("CONNECTOR_TIMEOUT");
  return execErrorStatus(outcome.code);
}
