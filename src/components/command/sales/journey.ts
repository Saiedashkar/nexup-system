/**
 * NEXUP COMMAND — SALES DEMO JOURNEY (pure state, no I/O)
 * ─────────────────────────────────────────────────────
 * The one "طلب متجر إلكتروني" journey the sales room runs, as data and pure
 * functions. It exists separately from the component for three reasons:
 *
 *   · it can be tested without a browser (`tests/sales-journey.test.ts`);
 *   · the room cannot invent a step order, an owner or a gate — they are here;
 *   · nothing in this file can write. There is no fetch, no Prisma, no provider:
 *     the journey lives in React state for the life of the tab and a reload
 *     starts it again. That is the honest behaviour for a demo that must not
 *     create records.
 *
 * A step closes only when its own input is present:
 *   qualify → nothing to fill (reading the request closes it);
 *   assign  → an owner AND a follow-up date;
 *   offer   → an edited draft AND a review;
 *   accept  → a recorded demo acceptance;
 *   deliver → a client AND a project name.
 * `advanceManually` exists because the room offers "أكمل يدويًا": it moves the
 * journey on WITHOUT pretending the gate was met, and the UI says so.
 */

import type { JourneyStepId, RoleId, StationId } from "./copy";

export const JOURNEY_ORDER: JourneyStepId[] = ["qualify", "assign", "offer", "accept", "deliver"];

/** Who holds each step. Roles only — the product never names a person. */
export const STEP_OWNER: Record<JourneyStepId, RoleId> = {
  qualify: "opportunity-scout",
  assign: "sales-manager",
  offer: "offer-manager",
  accept: "sales-manager",
  deliver: "sales-manager",
};

/** The station that draws each step on the stage. */
export function stationForStep(step: JourneyStepId): StationId {
  if (step === "qualify") return "qualify";
  if (step === "assign") return "follow";
  return "offer";
}

/** The station a role stands at, or null for the role that runs the room. */
export const ROLE_STATION: Record<RoleId, StationId | null> = {
  "sales-manager": null,
  "opportunity-scout": "qualify",
  "follow-up-agent": "follow",
  "offer-manager": "offer",
};

/** The first step a role owns, or null when that role runs the room instead. */
export function stepForOwner(role: RoleId): JourneyStepId | null {
  return JOURNEY_ORDER.find((step) => STEP_OWNER[step] === role) ?? null;
}

/** The step a station opens when it is pressed. */
export function stepForStation(station: StationId): JourneyStepId {
  if (station === "qualify") return "qualify";
  if (station === "follow") return "assign";
  return "offer";
}

export type DeliveryChoice = "existing" | "new";

export type DeliveryPlan = {
  choice: DeliveryChoice;
  clientName: string;
  projectName: string;
};

export type JourneyState = {
  /** Index into `JOURNEY_ORDER`; `JOURNEY_ORDER.length` means the journey ended. */
  stepIndex: number;
  owner: RoleId;
  /** `yyyy-mm-dd`, or empty until the manager sets it. */
  followUpAt: string;
  offer: string;
  offerReviewed: boolean;
  accepted: boolean;
  delivery: DeliveryPlan | null;
};

/** The journey as it starts: nothing decided, nothing recorded. */
export function initialJourney(offerDraft: string): JourneyState {
  return {
    stepIndex: 0,
    owner: STEP_OWNER.qualify,
    followUpAt: "",
    offer: offerDraft,
    offerReviewed: false,
    accepted: false,
    delivery: null,
  };
}

/** The step that is open right now, or `"done"` once all five are closed. */
export function currentStep(state: JourneyState): JourneyStepId | "done" {
  return JOURNEY_ORDER[state.stepIndex] ?? "done";
}

/** How many steps are closed. Used by the rail's progress label. */
export function completedCount(state: JourneyState): number {
  return Math.max(0, Math.min(JOURNEY_ORDER.length, state.stepIndex));
}

/**
 * A date input's value, accepted only when it is a real `yyyy-mm-dd` day.
 *
 * The round-trip check is the point: `new Date("2026-02-31")` does not fail, it
 * silently rolls over to 3 March. Comparing the ISO day back to the input is what
 * rejects a day that does not exist instead of quietly accepting a different one.
 */
export function isValidFollowUp(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return false;
  return parsed.toISOString().slice(0, 10) === value;
}

/** The offer must actually say something before it can be called reviewed. */
export function offerIsSubstantial(offer: string): boolean {
  return offer.trim().length >= 12;
}

export function deliveryIsComplete(plan: DeliveryPlan | null): plan is DeliveryPlan {
  return plan !== null && plan.clientName.trim().length > 0 && plan.projectName.trim().length > 0;
}

/** Whether the OPEN step can be closed with what it has. */
export function canAdvance(state: JourneyState): boolean {
  switch (currentStep(state)) {
    case "qualify":
      return true;
    case "assign":
      return isValidFollowUp(state.followUpAt);
    case "offer":
      return offerIsSubstantial(state.offer) && state.offerReviewed;
    case "accept":
      return state.accepted;
    case "deliver":
      return deliveryIsComplete(state.delivery);
    default:
      return false;
  }
}

/** Move to the next step, handing the work to that step's owner. */
function stepForward(state: JourneyState): JourneyState {
  const nextIndex = Math.min(JOURNEY_ORDER.length, state.stepIndex + 1);
  const nextStep = JOURNEY_ORDER[nextIndex];
  return {
    ...state,
    stepIndex: nextIndex,
    owner: nextStep ? STEP_OWNER[nextStep] : "sales-manager",
  };
}

/** Close the open step, but only if its gate is met. Otherwise: unchanged. */
export function advance(state: JourneyState): JourneyState {
  return canAdvance(state) ? stepForward(state) : state;
}

/** "أكمل يدويًا": move on without meeting the gate. The UI says it was manual. */
export function advanceManually(state: JourneyState): JourneyState {
  if (state.stepIndex >= JOURNEY_ORDER.length) return state;
  return stepForward(state);
}

export function assignOwner(state: JourneyState, owner: RoleId, followUpAt: string): JourneyState {
  return { ...state, owner, followUpAt };
}

export function editOffer(state: JourneyState, offer: string): JourneyState {
  /* Editing after a review invalidates the review: the reviewed text is not the
     text on screen any more, so the gate closes again. */
  return { ...state, offer, offerReviewed: false };
}

/** Saving the draft without changing the words keeps a review that already happened. */
export function saveOffer(state: JourneyState, offer: string): JourneyState {
  return offer === state.offer ? state : editOffer(state, offer);
}

export function reviewOffer(state: JourneyState): JourneyState {
  return offerIsSubstantial(state.offer) ? { ...state, offerReviewed: true } : state;
}

export function recordAcceptance(state: JourneyState): JourneyState {
  return { ...state, accepted: true };
}

export function planDelivery(state: JourneyState, plan: DeliveryPlan): JourneyState {
  return { ...state, delivery: plan };
}

/** Where the delivery preview points. Both routes already exist in the product. */
export const DELIVERY_LINKS = {
  clients: "/command/clients",
  projects: "/command/projects",
} as const;
