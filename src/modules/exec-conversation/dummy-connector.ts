import type { ExecConnector, ExecConnectorReply, ExecConnectorTurn } from "./connector";

/**
 * The dummy connector: a deterministic, offline stand-in for the model.
 *
 * Hard rules (enforced by review, not just by convention):
 *   - no network, no provider SDK, no `bridge/`, no Hermes transport;
 *   - no Prisma, no missions, no approvals, no capability invocation;
 *   - no environment reads here — enablement belongs to the composition layer,
 *     so this file cannot accidentally become reachable in production.
 *
 * It exists to prove the transport, the contract and the UI wiring; the reply
 * is explicitly labelled as a test reply so nobody mistakes it for a model.
 */

const DEFAULT_DELAY_MS = 0;
const MAX_DELAY_MS = 2_000;

export function clampDummyDelayMs(raw: unknown): number {
  const parsed = typeof raw === "number" ? raw : Number(raw ?? DEFAULT_DELAY_MS);
  if (!Number.isFinite(parsed)) return DEFAULT_DELAY_MS;
  return Math.min(Math.max(Math.trunc(parsed), 0), MAX_DELAY_MS);
}

function abortError(): Error {
  const error = new Error("Aborted");
  error.name = "AbortError";
  return error;
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise<void>((resolve, reject) => {
    if (signal.aborted) {
      reject(abortError());
      return;
    }
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    function onAbort() {
      clearTimeout(timer);
      reject(abortError());
    }
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

export function buildDummyReply(turn: ExecConnectorTurn): string {
  const length = [...turn.message].length;
  return [
    "رد اختباري من الموصل الوهمي — لا يوجد اتصال بنموذج حقيقي.",
    `استُلمت رسالة بطول ${length} حرفًا.`,
    "لم تُنفَّذ أي أداة أو مهمة، ولم يُحفظ شيء.",
  ].join(" ");
}

export function createDummyConnector(options: { delayMs?: number } = {}): ExecConnector {
  const delayMs = clampDummyDelayMs(options.delayMs);

  return {
    kind: "DUMMY",
    provenance: "TEST",
    async send(turn: ExecConnectorTurn): Promise<ExecConnectorReply> {
      const startedAt = Date.now();
      // Observing the signal here is what makes cancellation observable in
      // review; the server-side binding does not depend on it (see runExecTurn).
      await sleep(delayMs, turn.signal);
      if (turn.signal.aborted) throw abortError();

      return {
        text: buildDummyReply(turn),
        durationMs: Date.now() - startedAt,
      };
    },
  };
}
