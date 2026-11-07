/**
 * NEXUP COMMAND — MARKETING ROOM · what a request leaves on screen
 * ────────────────────────────────────────────────────────────────────────────
 * One function turns a `RequestOutcome` into the single sentence the room shows.
 * It lives beside the copy rather than inside the React component so the notice
 * a reader actually sees — in either language, including the Arabic refusal —
 * can be asserted by a test without rendering the room.
 */

import { fill, type CampaignCopy } from "./campaign-copy";
import type { RequestOutcome } from "./campaign-model";

export type CampaignNotice = {
  tone: "ok" | "error" | "info";
  title: string;
  body: string;
};

/** Turn the model's outcome into the one sentence the room shows. */
export function noticeFrom(outcome: RequestOutcome, copy: CampaignCopy): CampaignNotice {
  switch (outcome.outcome) {
    case "accepted":
      return {
        tone: "ok",
        title: copy.publish.successTitle,
        body: fill(copy.publish.successBody, { receipt: outcome.receiptId }),
      };
    case "failed":
      return {
        tone: "error",
        title: copy.publish.failureTitle,
        body: fill(copy.publish.failureBody, {
          message: outcome.errorMessage,
          code: outcome.errorCode,
        }),
      };
    case "duplicate":
      return {
        tone: "info",
        title: copy.publish.duplicateTitle,
        body: copy.publish.duplicateBody,
      };
    case "blocked":
      return {
        tone: "info",
        title: copy.publish.blockedTitle,
        body: copy.publish.blocked[outcome.reason],
      };
  }
}
