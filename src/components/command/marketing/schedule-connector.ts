/**
 * NEXUP COMMAND — MARKETING ROOM · the scheduling connector seam
 * ────────────────────────────────────────────────────────────────────────────
 * The room can ask ONE thing of the outside world: "schedule this approved text
 * at this slot". That ask lives behind `ScheduleConnector`, a two-method type, so
 * the room never imports an SDK, never reads a token and never learns how the
 * answer was produced.
 *
 * `createDemoScheduleConnector()` is the implementation shipped with this pass:
 *
 *   · it makes NO network call and needs NO account, app id or credentials;
 *   · it is DETERMINISTIC — the same slot is refused every time, so a reviewer
 *     can reach the failure path on purpose and a test can assert it;
 *   · it refuses an empty or over-limit text, which is the same rule the model
 *     enforces, so a bug in the UI cannot schedule nothing;
 *   · it returns a RECEIPT, and that receipt is the only thing the room stores.
 *     It is explicitly a scheduling request the connector accepted, not a post
 *     anyone published.
 *
 * TO GO LIVE, implement `ScheduleConnector` against the real X API and pass it
 * to `requestSchedule` — the campaign model, the dedupe rule and the UI states
 * are unchanged. Nothing else in this pass needs to know.
 */

import { X_POST_LIMIT, slotById, type SlotId } from "./campaign-model";

/* ── The contract ──────────────────────────────────────────────────────── */

export type ScheduleConnectorInput = {
  campaignId: string;
  /** The text of the APPROVED version — never the working draft. */
  text: string;
  slotId: SlotId;
  /** The approval version this request belongs to. */
  version: number;
};

export type ScheduleConnectorReceipt = {
  id: string;
  channel: "x";
  /** `demo` until a real connector replaces this one. */
  mode: "demo" | "live";
  slotId: SlotId;
  /** ISO timestamp the connector says it queued the post for. */
  scheduledFor: string;
};

export type ScheduleConnectorError = {
  code: string;
  /** Shown to the reader — a sentence, not a stack trace. */
  message: string;
  retryable: boolean;
};

export type ScheduleConnectorFailure = { ok: false; error: ScheduleConnectorError };

export type ScheduleConnectorResult =
  | { ok: true; receipt: ScheduleConnectorReceipt }
  | ScheduleConnectorFailure;

export type ScheduleConnector = {
  /** Stable id, so the UI can say which connector answered. */
  id: string;
  /** Display name. Kept free of vendor claims: this one says "demo". */
  label: string;
  mode: "demo" | "live";
  schedule(input: ScheduleConnectorInput): Promise<ScheduleConnectorResult>;
};

/* ── The demo implementation ───────────────────────────────────────────── */

export type DemoConnectorOptions = {
  /** Simulated latency in ms. Tests pass 0 so the suite stays fast. */
  latencyMs?: number;
  /** Slots the demo refuses. Defaults to the one flagged in `SCHEDULE_SLOTS`. */
  failSlots?: readonly SlotId[];
  /** Injectable clock, so a receipt is reproducible in a test. */
  now?: () => Date;
};

export const DEMO_CONNECTOR_ID = "x-demo-local";
export const DEMO_CONNECTOR_LABEL = "X · local demo connector";

function slotInstant(slotId: SlotId, from: Date): string {
  const next = new Date(from.getTime());
  const offsetHours = slotId === "today-evening" ? 6 : slotId === "tomorrow-morning" ? 18 : 54;
  next.setHours(next.getHours() + offsetHours);
  return next.toISOString();
}

export function createDemoScheduleConnector(
  options: DemoConnectorOptions = {},
): ScheduleConnector {
  const latencyMs = options.latencyMs ?? 420;
  const now = options.now ?? (() => new Date());
  const failSlots =
    options.failSlots ??
    (["thursday-night"] as const satisfies readonly SlotId[]);

  let issued = 0;

  return {
    id: DEMO_CONNECTOR_ID,
    label: DEMO_CONNECTOR_LABEL,
    mode: "demo",
    async schedule(input) {
      if (latencyMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, latencyMs));
      }

      const text = input.text.trim();
      if (!text) {
        return {
          ok: false,
          error: {
            code: "empty_text",
            message: "The connector received an empty post and refused it.",
            retryable: false,
          },
        };
      }
      if (text.length > X_POST_LIMIT) {
        return {
          ok: false,
          error: {
            code: "post_too_long",
            message: `The post is longer than ${X_POST_LIMIT} characters, so X would reject it.`,
            retryable: false,
          },
        };
      }
      if (!slotById(input.slotId)) {
        return {
          ok: false,
          error: {
            code: "unknown_slot",
            message: "The connector does not know this slot.",
            retryable: false,
          },
        };
      }
      if (failSlots.includes(input.slotId)) {
        return {
          ok: false,
          error: {
            code: "x_schedule_refused",
            message:
              "This slot is refused on purpose by the demo connector, to show the failure path.",
            retryable: true,
          },
        };
      }

      issued += 1;
      return {
        ok: true,
        receipt: {
          id: `demo-x-${issued}-${input.version}`,
          channel: "x",
          mode: "demo",
          slotId: input.slotId,
          scheduledFor: slotInstant(input.slotId, now()),
        },
      };
    },
  };
}
