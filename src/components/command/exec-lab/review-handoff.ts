"use client";

/**
 * NEXUP COMMAND — EXEC EXPERIENCE · REVIEW HANDOFF
 * ───────────────────────────────────────────────
 * One value, held in memory, that lets the review tools ask the conversation to
 * start a demo scenario.
 *
 * WHY THIS EXISTS AT ALL: the demo run lives in React state inside
 * `exec-experience.tsx`, and the scenario picker deliberately does NOT — it sits
 * in the tools, out of the primary experience. Those two facts need a single
 * seam, and this is the smallest honest one.
 *
 * WHY IT IS A PEEK AND A CLEAR, NOT A TAKE: the conversation reads this in its
 * state initializer, and React may invoke an initializer twice in development.
 * A `take` that cleared on read would therefore hand back the scenario on the
 * first call and `null` on the second — the run would vanish in dev and survive
 * in production, which is the worst kind of difference. Reading is pure here, and
 * clearing is an explicit effect, so both calls see the same value.
 *
 * HYDRATION: this can only ever be non-null during a CLIENT-side navigation from
 * the tools to the conversation — the tools are the only writer, and a fresh page
 * load starts with an empty module. Next renders client components on the server
 * for a direct request but not while serving a client-side navigation, so the
 * server never renders the state this seeds; and after a reload the value is gone
 * anyway, so the two renders cannot disagree.
 *
 * NOT a store, not persistence, not a URL seed. Module state in one tab: a reload
 * drops it, nothing else in the app can see it, and it carries exactly one
 * scenario id — no conversation, no locale, no scope, no fixture data — so it
 * cannot move client context anywhere.
 */

import type { ScenarioId } from "./types";

let pending: ScenarioId | null = null;

/** Records the scenario the reviewer asked for. Called from the tools page. */
export function requestScenario(id: ScenarioId): void {
  pending = id;
}

/** Pure read. Safe to call during render, and safe to call twice. */
export function peekRequestedScenario(): ScenarioId | null {
  return pending;
}

/** Drops the request. Called once from an effect after the surface mounts. */
export function clearRequestedScenario(): void {
  pending = null;
}
