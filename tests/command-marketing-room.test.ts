import { describe, expect, it } from "vitest";

import {
  SCHEDULE_SLOTS,
  STATION_ORDER,
  analysisKey,
  approveBrief,
  approveDraft,
  canApprove,
  editDraft,
  initialCampaign,
  isRequestDisabled,
  nextStep,
  requestBlockedReason,
  requestFingerprint,
  requestSchedule,
  selectSlot,
  stationStates,
  teamStates,
  type CampaignState,
  type SlotId,
} from "@/components/command/marketing/campaign-model";
import {
  createDemoScheduleConnector,
  type ScheduleConnector,
} from "@/components/command/marketing/schedule-connector";
import { noticeFrom } from "@/components/command/marketing/campaign-notice";
import { MARKETING_COPY } from "@/components/command/marketing/campaign-copy";

/**
 * THE MARKETING ROOM CONTRACT
 * ───────────────────────────
 * These are the claims the room makes, turned into things a run can fail on:
 *
 *   · the flow actually starts at the brief, and the brief gates the rest;
 *   · editing the approved text CANCELS the approval (and the accepted
 *     schedule), so the reader has to ask again;
 *   · the same text + slot is never sent twice, and the connector is not
 *     called a second time for it;
 *   · a refusal is surfaced and retryable;
 *   · ACCEPTING A SCHEDULE IS NOT PUBLISHING — `published` stays false and the
 *     type makes it impossible to set otherwise;
 *   · both languages carry every string.
 */

const SEED = "متجرك على سلة أو زد يستحق واجهة تبيع قبل أن تشرح الآن.";

function countingConnector(failSlots: readonly SlotId[] = []) {
  const demo = createDemoScheduleConnector({ latencyMs: 0, failSlots });
  let calls = 0;
  const connector: ScheduleConnector = {
    id: "counting-demo",
    label: demo.label,
    mode: demo.mode,
    async schedule(input) {
      calls += 1;
      return demo.schedule(input);
    },
  };
  return { connector, calls: () => calls };
}

function approvedDraft(): CampaignState {
  let state = initialCampaign(SEED);
  state = approveBrief(state);
  state = approveDraft(state);
  return state;
}

function readyToRequest(): CampaignState {
  return selectSlot(approvedDraft(), "today-evening");
}

describe("marketing room · the flow opens on the brief", () => {
  it("starts with the brief unapproved, so the room opens on step one", () => {
    const state = initialCampaign(SEED);
    expect(state.briefApproved).toBe(false);
    expect(state.approval).toBe("none");
    expect(nextStep(state)).toEqual({ step: "brief", station: "strategy", owner: "strategy" });
  });

  it("refuses to approve a draft before the brief", () => {
    const state = initialCampaign(SEED);
    expect(canApprove(state)).toBe(false);
    const after = approveDraft(state);
    expect(after).toBe(state);
    expect(after.approvedText).toBeNull();
  });

  it("cannot schedule anything before the brief is approved", async () => {
    const { connector, calls } = countingConnector();
    const { outcome } = await requestSchedule(initialCampaign(SEED), connector);
    expect(outcome).toEqual({ outcome: "blocked", reason: "brief" });
    expect(calls()).toBe(0);
  });

  it("moves to the review once the brief is approved and a draft exists", () => {
    const state = approveBrief(initialCampaign(SEED));
    expect(nextStep(state)).toEqual({ step: "approve", station: "publish", owner: "publish" });
  });

  it("names each station's state from the same derivation the room reads", () => {
    const state = readyToRequest();
    const stations = stationStates(state);
    expect(stations.strategy).toBe("done");
    expect(stations.content).toBe("done");
    expect(stations.publish).toBe("active");
    expect(teamStates(state).publish).toBe("working");
    expect(STATION_ORDER).toEqual(["strategy", "content", "publish"]);
  });
});

describe("marketing room · approval belongs to a version of the text", () => {
  it("expires the approval when the text is edited by hand", () => {
    const approved = approvedDraft();
    const edited = editDraft(approved, `${SEED} نضيف جملة.`);

    expect(edited.approval).toBe("stale");
    expect(nextStep(edited).step).toBe("approve");
    expect(stationStates(edited).publish).toBe("attention");
    expect(edited.approvedText).toBe(approved.approvedText);
  });

  it("refuses a request from a stale approval, without calling the connector", async () => {
    const { connector, calls } = countingConnector();
    const approved = readyToRequest();
    const edited = editDraft(approved, `${SEED} نسخة معدّلة.`);

    const { outcome } = await requestSchedule(edited, connector);
    expect(outcome).toEqual({ outcome: "blocked", reason: "approval" });
    expect(calls()).toBe(0);
  });

  it("restores the flow only through a new approval, which bumps the version", () => {
    const edited = editDraft(approvedDraft(), `${SEED} نسخة معدّلة.`);
    expect(edited.version).toBe(1);

    const reapproved = approveDraft(edited);
    expect(reapproved.approval).toBe("approved");
    expect(reapproved.version).toBe(2);
    expect(reapproved.approvedText).toBe(`${SEED} نسخة معدّلة.`.trim());
    expect(nextStep(reapproved).step).toBe("schedule");
  });

  it("withdraws an accepted schedule when the text changes under it", async () => {
    const { connector } = countingConnector();
    const { state: accepted } = await requestSchedule(readyToRequest(), connector);
    expect(accepted.scheduleState).toBe("accepted");
    expect(accepted.acceptedReceiptId).not.toBeNull();

    const edited = editDraft(accepted, `${SEED} وبعد التسليم تقرير.`);
    expect(edited.scheduleState).toBe("stale");
    expect(edited.acceptedReceiptId).toBeNull();
  });

  it("withdraws an accepted schedule when the slot changes", async () => {
    const { connector } = countingConnector();
    const { state: accepted } = await requestSchedule(readyToRequest(), connector);
    const moved = selectSlot(accepted, "tomorrow-morning");

    expect(moved.slotId).toBe("tomorrow-morning");
    expect(moved.scheduleState).toBe("stale");
    expect(moved.acceptedReceiptId).toBeNull();
  });
});

describe("marketing room · one request, not two", () => {
  it("requires a slot before the request is sent", async () => {
    const { connector, calls } = countingConnector();
    const { outcome } = await requestSchedule(approvedDraft(), connector);
    expect(outcome).toEqual({ outcome: "blocked", reason: "slot" });
    expect(calls()).toBe(0);
  });

  it("sends once and reports the second identical request as a duplicate", async () => {
    const { connector, calls } = countingConnector();
    const first = await requestSchedule(readyToRequest(), connector);
    expect(first.outcome.outcome).toBe("accepted");

    const second = await requestSchedule(first.state, connector);
    expect(second.outcome.outcome).toBe("duplicate");
    expect(calls()).toBe(1);
    expect(second.state.requests).toHaveLength(1);
  });

  it("treats a whitespace-only difference as the same request", async () => {
    const { connector, calls } = countingConnector();
    const first = await requestSchedule(readyToRequest(), connector);

    const respaced = selectSlot(
      editDraft(first.state, `  ${SEED.replace(/\s+/g, "   ")}  `),
      "today-evening",
    );
    const reapproved = approveDraft(respaced);
    const second = await requestSchedule(reapproved, connector);

    expect(second.outcome.outcome).toBe("duplicate");
    expect(calls()).toBe(1);
  });

  it("gives a different slot its own request", async () => {
    const { connector, calls } = countingConnector();
    const first = await requestSchedule(readyToRequest(), connector);
    const moved = approveDraft(selectSlot(first.state, "tomorrow-morning"));
    const second = await requestSchedule(moved, connector);

    expect(second.outcome.outcome).toBe("accepted");
    expect(calls()).toBe(2);
    expect(second.state.requests).toHaveLength(2);
  });

  it("keys a request by the text AND the slot", () => {
    expect(requestFingerprint("نص", "today-evening")).toBe(
      requestFingerprint("  نص  ", "today-evening"),
    );
    expect(requestFingerprint("نص", "today-evening")).not.toBe(
      requestFingerprint("نص", "tomorrow-morning"),
    );
    expect(requestFingerprint("نص أول", "today-evening")).not.toBe(
      requestFingerprint("نص ثانٍ", "today-evening"),
    );
  });
});

describe("marketing room · refusal is shown, and retryable", () => {
  it("surfaces the demo connector's refusal and keeps the post unpublished", async () => {
    const { connector, calls } = countingConnector(["thursday-night"]);
    const state = selectSlot(approvedDraft(), "thursday-night");
    const { state: settled, outcome } = await requestSchedule(state, connector);

    expect(outcome.outcome).toBe("failed");
    if (outcome.outcome === "failed") {
      expect(outcome.errorCode).toBe("x_schedule_refused");
    }
    expect(settled.scheduleState).toBe("failed");
    expect(settled.acceptedReceiptId).toBeNull();
    expect(settled.published).toBe(false);
    expect(calls()).toBe(1);
  });

  it("lets a refused request be retried, and counts the attempt", async () => {
    const { connector, calls } = countingConnector(["thursday-night"]);
    const state = selectSlot(approvedDraft(), "thursday-night");

    const first = await requestSchedule(state, connector);
    const retried = await requestSchedule(first.state, connector);

    expect(calls()).toBe(2);
    expect(retried.outcome.outcome).toBe("failed");
    expect(retried.state.requests).toHaveLength(2);
    expect(retried.state.requests[1].attempt).toBe(2);
  });

  it("refuses an empty draft and an over-limit draft in the model", async () => {
    const { connector, calls } = countingConnector();
    const empty = selectSlot(approveBrief(initialCampaign("")), "today-evening");
    expect((await requestSchedule(empty, connector)).outcome).toEqual({
      outcome: "blocked",
      reason: "approval",
    });

    const tooLong = `${"ا".repeat(281)}`;
    let long = initialCampaign(tooLong);
    long = approveBrief(long);
    long = selectSlot(long, "today-evening");
    expect(canApprove(long)).toBe(false);
    expect(calls()).toBe(0);
  });

  it("refuses an empty or over-limit text in the demo connector itself", async () => {
    const connector = createDemoScheduleConnector({ latencyMs: 0 });
    const empty = await connector.schedule({
      campaignId: "campaign-salla-zid-stores",
      text: "   ",
      slotId: "today-evening",
      version: 1,
    });
    expect(empty.ok).toBe(false);

    const long = await connector.schedule({
      campaignId: "campaign-salla-zid-stores",
      text: "ا".repeat(281),
      slotId: "today-evening",
      version: 1,
    });
    expect(long.ok).toBe(false);
  });
});

describe("marketing room · an accepted schedule is not a publication", () => {
  it("records the acceptance and still reports published: false", async () => {
    const { connector } = countingConnector();
    const { state, outcome } = await requestSchedule(readyToRequest(), connector);

    expect(outcome.outcome).toBe("accepted");
    expect(state.scheduleState).toBe("accepted");
    expect(state.acceptedReceiptId).toMatch(/^demo-x-/);
    expect(state.published).toBe(false);
    expect(state.requests.at(-1)?.receiptId).toBe(state.acceptedReceiptId);
    expect(nextStep(state)).toEqual({ step: "scheduled", station: "publish", owner: "manager" });
  });

  it("never publishes, whatever the connector returns", async () => {
    const connector: ScheduleConnector = {
      id: "always-accepts",
      label: "test",
      mode: "demo",
      async schedule(input) {
        return {
          ok: true,
          receipt: {
            id: `receipt-${input.version}`,
            channel: "x",
            mode: "demo",
            slotId: input.slotId,
            scheduledFor: "2026-11-03T18:00:00.000Z",
          },
        };
      },
    };
    const { state } = await requestSchedule(readyToRequest(), connector);
    expect(state.published).toBe(false);
    expect(state.scheduleState).toBe("accepted");
  });

  it("exposes exactly one demo-refusal slot, so the failure path is reachable", () => {
    expect(SCHEDULE_SLOTS.filter((slot) => slot.demoFails)).toHaveLength(1);
    expect(SCHEDULE_SLOTS.filter((slot) => slot.demoFails)[0].id).toBe("thursday-night");
  });
});

describe("marketing room · both languages carry every string", () => {
  function leafPaths(value: unknown, prefix = ""): string[] {
    if (typeof value === "string") return [prefix];
    if (!value || typeof value !== "object") return [];
    return Object.entries(value as Record<string, unknown>).flatMap(([key, child]) =>
      leafPaths(child, prefix ? `${prefix}.${key}` : key),
    );
  }

  const en = leafPaths(MARKETING_COPY.en).sort();
  const ar = leafPaths(MARKETING_COPY.ar).sort();

  it("has identical keys in Arabic and English", () => {
    expect(ar).toEqual(en);
  });

  it("writes Arabic in the Arabic copy, not the English text again", () => {
    const identical = en.filter((path) => {
      const read = (root: unknown) =>
        path
          .split(".")
          .reduce<unknown>(
            (node, part) =>
              node && typeof node === "object"
                ? (node as Record<string, unknown>)[part]
                : undefined,
            root,
          ) as string;
      return read(MARKETING_COPY.ar) === read(MARKETING_COPY.en);
    });
    /* The campaign's brand identifiers are the only legitimate matches. */
    expect(identical.length).toBeLessThan(6);
  });

  it("keeps the approved Arabic draft inside the X limit", () => {
    expect(MARKETING_COPY.ar.content.seedDraft.length).toBeLessThanOrEqual(280);
    expect(MARKETING_COPY.ar.content.alternateDraft.length).toBeLessThanOrEqual(280);
    expect(MARKETING_COPY.en.content.seedDraft.length).toBeLessThanOrEqual(280);
  });
});

describe("marketing room · the changed-after-approval line needs a real change", () => {
  it("opens on the brief, so no approval line is shown at all", () => {
    const state = initialCampaign(SEED);
    expect(analysisKey(state)).toBe("brief");
    expect(analysisKey(state)).not.toBe("stale");
  });

  it("asks for the FIRST approval without claiming the text changed", () => {
    const state = approveBrief(initialCampaign(SEED));
    expect(state.approval).toBe("none");
    expect(analysisKey(state)).toBe("approve");
  });

  it("shows the changed-after-approval line only once an approved text moved", () => {
    const approved = approvedDraft();
    expect(analysisKey(approved)).toBe("schedule");

    const edited = editDraft(approved, `${SEED} نسخة معدّلة.`);
    expect(edited.approval).toBe("stale");
    expect(analysisKey(edited)).toBe("stale");
  });

  it("returns to the first line after a reset, even from an expired approval", () => {
    const stale = editDraft(approvedDraft(), `${SEED} نسخة معدّلة.`);
    expect(analysisKey(stale)).toBe("stale");

    const reset = initialCampaign(MARKETING_COPY.ar.content.seedDraft);
    expect(reset.approval).toBe("none");
    expect(reset.approvedText).toBeNull();
    expect(analysisKey(reset)).toBe("brief");
  });

  it("keeps two different sentences for 'not approved yet' and 'changed after approval'", () => {
    expect(MARKETING_COPY.en.analysis.approve).not.toBe(MARKETING_COPY.en.analysis.stale);
    expect(MARKETING_COPY.ar.analysis.approve).not.toBe(MARKETING_COPY.ar.analysis.stale);
    expect(MARKETING_COPY.ar.analysis.stale).toContain("تغيّر");
    expect(MARKETING_COPY.ar.analysis.approve).not.toContain("تغيّر");
  });
});

describe("marketing room · the request button explains why it is off", () => {
  it("walks the reasons in the order the flow does", () => {
    expect(requestBlockedReason(initialCampaign(SEED))).toBe("brief");
    expect(requestBlockedReason(approveBrief(initialCampaign(SEED)))).toBe("approval");
    expect(requestBlockedReason(approvedDraft())).toBe("slot");
    expect(requestBlockedReason(readyToRequest())).toBeNull();
  });

  it("blocks an approved campaign again once its text moved away from the approval", () => {
    const edited = editDraft(readyToRequest(), `${SEED} نسخة معدّلة.`);
    expect(requestBlockedReason(edited)).toBe("approval");
    expect(isRequestDisabled(edited, false)).toBe(true);
  });

  it("disables the button while a request is in flight, even from a ready state", () => {
    const ready = readyToRequest();
    expect(isRequestDisabled(ready, false)).toBe(false);
    expect(isRequestDisabled(ready, true)).toBe(true);
    /* The reason is what the hint says, so the busy case must not claim one. */
    expect(requestBlockedReason(ready)).toBeNull();
  });

  it("names every reason in Arabic and in English", () => {
    for (const reason of ["brief", "approval", "slot", "empty", "limit"] as const) {
      expect(MARKETING_COPY.ar.publish.blocked[reason].length).toBeGreaterThan(0);
      expect(MARKETING_COPY.en.publish.blocked[reason].length).toBeGreaterThan(0);
      expect(MARKETING_COPY.ar.publish.blocked[reason]).not.toBe(
        MARKETING_COPY.en.publish.blocked[reason],
      );
    }
  });
});

describe("marketing room · Arabic notices from a fresh demo state", () => {
  it("accepts a fresh request, then reports the identical one as a duplicate", async () => {
    const { connector, calls } = countingConnector();
    const first = await requestSchedule(readyToRequest(), connector);
    expect(first.outcome.outcome).toBe("accepted");

    const accepted = noticeFrom(first.outcome, MARKETING_COPY.ar);
    expect(accepted.tone).toBe("ok");
    expect(accepted.title).toBe(MARKETING_COPY.ar.publish.successTitle);
    expect(accepted.title).toMatch(/[\u0600-\u06FF]/);
    expect(accepted.body).toContain("demo-x-");

    const second = await requestSchedule(first.state, connector);
    expect(second.outcome.outcome).toBe("duplicate");
    const duplicate = noticeFrom(second.outcome, MARKETING_COPY.ar);
    expect(duplicate.title).toBe(MARKETING_COPY.ar.publish.duplicateTitle);
    expect(duplicate.title).toMatch(/[\u0600-\u06FF]/);
    expect(calls()).toBe(1);
  });

  it("reports the demo connector's refusal in Arabic, with the code", async () => {
    /* The helper passes its own `failSlots`, so the demo refusal is named here. */
    const { connector, calls } = countingConnector(["thursday-night"]);
    const state = selectSlot(approvedDraft(), "thursday-night");
    const { state: settled, outcome } = await requestSchedule(state, connector);
    expect(calls()).toBe(1);
    expect(outcome.outcome).toBe("failed");

    const notice = noticeFrom(outcome, MARKETING_COPY.ar);
    expect(notice.tone).toBe("error");
    expect(notice.title).toBe(MARKETING_COPY.ar.publish.failureTitle);
    expect(notice.title).toMatch(/[\u0600-\u06FF]/);
    expect(notice.body).toContain("x_schedule_refused");
    expect(notice.body).toMatch(/[\u0600-\u06FF]/);
    expect(notice.body).not.toContain("This slot is refused");
    expect(settled.scheduleState).toBe("failed");
    expect(settled.published).toBe(false);
  });

  it("keeps the blocked notice in Arabic and pointed at the same reason", async () => {
    const { connector, calls } = countingConnector();
    const { outcome } = await requestSchedule(earlyState(), connector);
    expect(outcome.outcome).toBe("blocked");
    expect(calls()).toBe(0);

    const notice = noticeFrom(outcome, MARKETING_COPY.ar);
    expect(notice.title).toBe(MARKETING_COPY.ar.publish.blockedTitle);
    expect(notice.body).toBe(MARKETING_COPY.ar.publish.blocked.approval);
    expect(notice.body).toMatch(/[\u0600-\u06FF]/);
  });
});

/** The brief approved and a draft written, but nothing approved yet. */
function earlyState(): CampaignState {
  return approveBrief(initialCampaign(SEED));
}
