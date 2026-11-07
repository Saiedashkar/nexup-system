/**
 * NEXUP COMMAND — MARKETING ROOM · campaign model
 * ────────────────────────────────────────────────────────────────────────────
 * The campaign «تصميم متاجر سلة وزد» as a small, testable state machine that
 * the room renders and the reviewer exercises:
 *
 *   brief  →  draft  →  approve  →  choose a slot  →  request scheduling
 *
 * Three rules are enforced here rather than in the UI, because they are the
 * claims this surface makes and a disabled button is not a proof:
 *
 *   1 · NOTHING IS SCHEDULED FROM AN UNAPPROVED TEXT. `requestSchedule` refuses
 *       until the brief and the exact text are approved and a slot is chosen.
 *   2 · EDITING THE TEXT CANCELS THE APPROVAL. `editDraft` marks a previous
 *       approval `stale`, so the reader must approve again before a request can
 *       be made — the approval belongs to a version, not to a box.
 *   3 · THE SAME REQUEST IS NEVER SENT TWICE. A fingerprint of the approved
 *       text + the chosen slot identifies a request; an accepted (or still
 *       pending) request with that fingerprint is reported as a duplicate and
 *       the connector is not called again. A FAILED request may be retried,
 *       because nothing was accepted the first time.
 *
 * And one thing this model deliberately cannot say: `published` is typed as
 * `false` and no function ever sets it. An accepted schedule is a REQUEST that
 * a connector accepted — it is not a publication, and the type says so.
 *
 * Everything is local and synchronous except the connector call the caller
 * hands in, which is a demo implementation in `schedule-connector.ts`. No
 * network, no provider, no database and no credentials are involved.
 */

/* ── Identity ──────────────────────────────────────────────────────────── */

export const CAMPAIGN_ID = "campaign-salla-zid-stores";

/** X's post limit, in characters. Approval is gated on it. */
export const X_POST_LIMIT = 280;

/* ── Vocabulary ────────────────────────────────────────────────────────── */

export type StationId = "strategy" | "content" | "publish";

/** The four seats credited on this campaign. Roles only — never a person. */
export type TeamRoleId = "manager" | "strategy" | "content" | "publish";

export type StationOrder = readonly StationId[];

export const STATION_ORDER: StationOrder = ["strategy", "content", "publish"];

export type ApprovalState = "none" | "approved" | "stale";

export type ScheduleState = "none" | "pending" | "accepted" | "failed" | "stale";

export type SlotId = "today-evening" | "tomorrow-morning" | "thursday-night";

export type ScheduleSlot = {
  id: SlotId;
  /**
   * The demo connector refuses this slot ON PURPOSE, so the failure path is
   * reachable by a reviewer instead of only by a luckier provider.
   */
  demoFails: boolean;
};

export const SCHEDULE_SLOTS: readonly ScheduleSlot[] = [
  { id: "today-evening", demoFails: false },
  { id: "tomorrow-morning", demoFails: false },
  { id: "thursday-night", demoFails: true },
];

export function slotById(id: SlotId): ScheduleSlot | null {
  return SCHEDULE_SLOTS.find((slot) => slot.id === id) ?? null;
}

export type ScheduleRequestStatus = "pending" | "accepted" | "failed";

export type ScheduleRequestRecord = {
  id: string;
  /** The approved text + slot this request belongs to. */
  fingerprint: string;
  text: string;
  slotId: SlotId;
  status: ScheduleRequestStatus;
  /** 1 on the first send, 2+ when a failed request is retried. */
  attempt: number;
  receiptId?: string;
  errorCode?: string;
  errorMessage?: string;
};

export type CampaignState = {
  campaignId: string;
  briefApproved: boolean;
  /** The working draft. Edited by hand in the content station. */
  draft: string;
  /** The text the current approval belongs to, or null before any approval. */
  approvedText: string | null;
  approval: ApprovalState;
  /** Bumped on every approval, so a version is named rather than implied. */
  version: number;
  slotId: SlotId | null;
  scheduleState: ScheduleState;
  acceptedReceiptId: string | null;
  requests: ScheduleRequestRecord[];
  /**
   * ALWAYS false. Kept as a literal so "scheduling ≠ publishing" is a type the
   * compiler enforces, not a sentence in a document.
   */
  published: false;
};

/* ── Construction ──────────────────────────────────────────────────────── */

/**
 * The room opens on the FIRST state of the campaign: the brief is not yet
 * approved, and the content agent's first pass is already in the draft — which
 * is what a reviewer sees in the reference, and what makes the first decision
 * the brief rather than an empty box.
 */
export function initialCampaign(seedDraft = ""): CampaignState {
  return {
    campaignId: CAMPAIGN_ID,
    briefApproved: false,
    draft: seedDraft,
    approvedText: null,
    approval: "none",
    version: 0,
    slotId: null,
    scheduleState: "none",
    acceptedReceiptId: null,
    requests: [],
    published: false,
  };
}

/* ── Editing ───────────────────────────────────────────────────────────── */

function normalize(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/** Approve the brief. A no-op once approved — approving twice is not a state. */
export function approveBrief(state: CampaignState): CampaignState {
  if (state.briefApproved) return state;
  return { ...state, briefApproved: true };
}

/**
 * Record a manual edit.
 *
 * The approval belongs to a VERSION of the text, so an edit that makes the
 * draft differ from `approvedText` moves the approval to `stale` and withdraws
 * the previously accepted receipt. The reader then has to approve again — the
 * requirement this pass exists to honour.
 */
export function editDraft(state: CampaignState, text: string): CampaignState {
  if (text === state.draft) return state;

  const textChanged =
    state.approvedText !== null && normalize(text) !== normalize(state.approvedText);

  if (!textChanged) {
    return { ...state, draft: text };
  }

  const hadRequest =
    state.scheduleState === "accepted" ||
    state.scheduleState === "failed" ||
    state.scheduleState === "pending";

  return {
    ...state,
    draft: text,
    approval: "stale",
    scheduleState: hadRequest ? "stale" : state.scheduleState,
    acceptedReceiptId: null,
  };
}

export function isOverLimit(text: string): boolean {
  return text.trim().length > X_POST_LIMIT;
}

/** Approvable = brief approved, a non-empty draft, and within the X limit. */
export function canApprove(state: CampaignState): boolean {
  const trimmed = state.draft.trim();
  return state.briefApproved && trimmed.length > 0 && trimmed.length <= X_POST_LIMIT;
}

/**
 * Approve the current draft as a NAMED version.
 *
 * Every approval bumps the version, and a new approval always resets the
 * scheduling state to `none`: the request that came before it belonged to the
 * previous version. A re-approval of the SAME text after a stale edit also
 * resets it, so a fresh request is a deliberate act rather than an implicit one.
 */
export function approveDraft(state: CampaignState): CampaignState {
  if (!canApprove(state)) return state;

  const approvedText = state.draft.trim();
  const sameAsPrevious = state.approvedText !== null && approvedText === state.approvedText;

  if (sameAsPrevious && state.approval === "approved") return state;

  return {
    ...state,
    approvedText,
    approval: "approved",
    version: state.version + 1,
    scheduleState: "none",
    acceptedReceiptId: null,
  };
}

/**
 * Choose a schedule slot.
 *
 * Changing the slot after an accepted request invalidates that request: it was
 * accepted for a different time, so the room must not show it as the current
 * schedule.
 */
export function selectSlot(state: CampaignState, slotId: SlotId): CampaignState {
  if (state.slotId === slotId) return state;

  const invalidates =
    state.scheduleState === "accepted" ||
    state.scheduleState === "failed" ||
    state.scheduleState === "pending";

  return {
    ...state,
    slotId,
    scheduleState: invalidates ? "stale" : state.scheduleState,
    acceptedReceiptId: invalidates ? null : state.acceptedReceiptId,
  };
}

/* ── Request identity ──────────────────────────────────────────────────── */

/**
 * A stable identity for "this approved text, at this slot".
 *
 * A short djb2 hash keeps the record readable while still being exact for the
 * purpose: two requests dedupe when their text normalises identically and their
 * slot matches. This is a local demo key, not a security primitive.
 */
export function requestFingerprint(text: string, slotId: SlotId): string {
  const normalized = normalize(text);
  let hash = 5381;
  for (let index = 0; index < normalized.length; index += 1) {
    hash = ((hash << 5) + hash + normalized.charCodeAt(index)) >>> 0;
  }
  return `${slotId}:${hash.toString(36)}`;
}

/* ── The one asynchronous action ───────────────────────────────────────── */

import type {
  ScheduleConnector,
  ScheduleConnectorFailure,
  ScheduleConnectorResult,
} from "./schedule-connector";

/**
 * An explicit type guard rather than a bare `if (result.ok)`: this repository's
 * TypeScript configuration does not narrow a boolean-discriminated union across
 * the early return, and a guard says the same thing in a way the compiler can
 * prove here too.
 */
function refused(result: ScheduleConnectorResult): result is ScheduleConnectorFailure {
  return result.ok === false;
}

export type RequestBlockReason = "brief" | "approval" | "slot" | "empty" | "limit";

/**
 * WHY the request button is unavailable — the one reason, or null when the
 * campaign may be sent.
 *
 * The room disables the button with this and the model refuses the request with
 * this same derivation, so a reader never meets a dead button without a reason
 * and a request can never leave through a state the button called blocked.
 */
export function requestBlockedReason(state: CampaignState): RequestBlockReason | null {
  if (!state.briefApproved) return "brief";
  if (state.approval !== "approved" || !state.approvedText) return "approval";
  if (!state.slotId) return "slot";
  if (!state.approvedText.trim()) return "empty";
  if (isOverLimit(state.approvedText)) return "limit";
  return null;
}

/** The button is off while a request is in flight, and while a reason stands. */
export function isRequestDisabled(state: CampaignState, busy: boolean): boolean {
  return busy || requestBlockedReason(state) !== null;
}

export type RequestOutcome =
  | { outcome: "accepted"; fingerprint: string; receiptId: string }
  | { outcome: "failed"; fingerprint: string; errorCode: string; errorMessage: string }
  | { outcome: "duplicate"; fingerprint: string; existing: ScheduleRequestRecord }
  | { outcome: "blocked"; reason: RequestBlockReason };

function replaceRequest(
  requests: ScheduleRequestRecord[],
  id: string,
  next: ScheduleRequestRecord,
): ScheduleRequestRecord[] {
  return requests.map((request) => (request.id === id ? next : request));
}

/**
 * Ask the connector to schedule the approved version at the chosen slot.
 *
 * The caller supplies the connector, so replacing the demo with a real
 * integration is a one-line change at the call site and not a change to this
 * model. Nothing here retries on its own: a failed request is reported, and a
 * second attempt is a deliberate click.
 */
export async function requestSchedule(
  state: CampaignState,
  connector: ScheduleConnector,
): Promise<{ state: CampaignState; outcome: RequestOutcome }> {
  /* The SAME derivation the button is disabled by: the room says why it is off,
     and the model refuses a request for that identical reason if it is called
     anyway. The internal guard stays — a disabled control is not a proof. */
  const blocked = requestBlockedReason(state);
  if (blocked) {
    return { state, outcome: { outcome: "blocked", reason: blocked } };
  }

  /* Re-stated after the guard so the compiler narrows without an assertion. */
  const slotId = state.slotId;
  const approvedText = state.approvedText;
  if (!slotId || approvedText === null) {
    return { state, outcome: { outcome: "blocked", reason: slotId ? "approval" : "slot" } };
  }

  const text = approvedText.trim();
  const fingerprint = requestFingerprint(text, slotId);
  const existing = state.requests.find((request) => request.fingerprint === fingerprint);

  /* Dedupe: an accepted request — or one still in flight — for this exact text
     and slot is the SAME request. It is reported, and the connector is NOT
     called again. A failed request may be retried: nothing was accepted. */
  if (existing && existing.status !== "failed") {
    return { state, outcome: { outcome: "duplicate", fingerprint, existing } };
  }

  const record: ScheduleRequestRecord = {
    id: `market-req-${state.requests.length + 1}`,
    fingerprint,
    text,
    slotId,
    status: "pending",
    attempt: (existing?.attempt ?? 0) + 1,
  };

  const pendingState: CampaignState = {
    ...state,
    scheduleState: "pending",
    requests: [...state.requests, record],
  };

  const result = await connector.schedule({
    campaignId: state.campaignId,
    text,
    slotId,
    version: state.version,
  });

  if (refused(result)) {
    return {
      state: {
        ...pendingState,
        scheduleState: "failed",
        acceptedReceiptId: null,
        requests: replaceRequest(pendingState.requests, record.id, {
          ...record,
          status: "failed",
          errorCode: result.error.code,
          errorMessage: result.error.message,
        }),
      },
      outcome: {
        outcome: "failed",
        fingerprint,
        errorCode: result.error.code,
        errorMessage: result.error.message,
      },
    };
  }

  return {
    state: {
      ...pendingState,
      scheduleState: "accepted",
      acceptedReceiptId: result.receipt.id,
      requests: replaceRequest(pendingState.requests, record.id, {
        ...record,
        status: "accepted",
        receiptId: result.receipt.id,
      }),
    },
    outcome: { outcome: "accepted", fingerprint, receiptId: result.receipt.id },
  };
}

/* ── Derivations the room reads ────────────────────────────────────────── */

export type RoomStep = "brief" | "draft" | "approve" | "schedule" | "scheduled";

export type StationVisualState = "done" | "active" | "waiting" | "attention";

/**
 * The ONE step the campaign is on, the station that owns it and the role
 * responsible. The decisions panel, the station badges, the analysis line and
 * the team strip all read this, so the room cannot point at two different next
 * steps at once.
 */
export function nextStep(state: CampaignState): {
  step: RoomStep;
  station: StationId;
  owner: TeamRoleId;
} {
  if (!state.briefApproved) return { step: "brief", station: "strategy", owner: "strategy" };
  if (!state.draft.trim()) return { step: "draft", station: "content", owner: "content" };
  if (state.approval !== "approved") return { step: "approve", station: "publish", owner: "publish" };
  if (state.scheduleState === "accepted") {
    return { step: "scheduled", station: "publish", owner: "manager" };
  }
  return { step: "schedule", station: "publish", owner: "publish" };
}

/**
 * WHICH analysis line the room shows.
 *
 * `approve` and `stale` are different facts and must not share a sentence:
 * "this version has not been approved yet" is not "the text changed after you
 * approved it". `stale` is only reachable once an approval exists and the text
 * then moved away from it, so a first pass — and a reset — can never accuse the
 * reader of changing something they never approved.
 */
export type AnalysisKey = RoomStep | "stale";

export function analysisKey(state: CampaignState): AnalysisKey {
  const { step } = nextStep(state);
  if (step !== "approve") return step;
  return state.approval === "stale" ? "stale" : "approve";
}

export function stationStates(state: CampaignState): Record<StationId, StationVisualState> {
  const strategy: StationVisualState = state.briefApproved ? "done" : "active";

  const content: StationVisualState = !state.draft.trim()
    ? state.briefApproved
      ? "active"
      : "waiting"
    : state.approval === "approved"
      ? "done"
      : state.approval === "stale"
        ? "attention"
        : "active";

  const publish: StationVisualState =
    state.scheduleState === "accepted"
      ? "done"
      : state.approval === "stale"
        ? "attention"
        : state.approval === "approved"
          ? "active"
          : "waiting";

  return { strategy, content, publish };
}

export type TeamVisualState = "working" | "available" | "waiting";

export function teamStates(state: CampaignState): Record<TeamRoleId, TeamVisualState> {
  const { step } = nextStep(state);

  return {
    manager: step === "scheduled" ? "working" : "available",
    strategy: step === "brief" ? "working" : "available",
    content: step === "draft" ? "working" : state.draft.trim() ? "available" : "waiting",
    publish:
      step === "approve" || step === "schedule"
        ? "working"
        : state.approval === "approved"
          ? "available"
          : "waiting",
  };
}

/** The request that produced the current acceptance, if there is one. */
export function acceptedRequest(state: CampaignState): ScheduleRequestRecord | null {
  if (!state.acceptedReceiptId) return null;
  return (
    state.requests.find((request) => request.receiptId === state.acceptedReceiptId) ?? null
  );
}
