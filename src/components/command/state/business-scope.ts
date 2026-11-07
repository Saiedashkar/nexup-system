"use client";

import { useSyncExternalStore } from "react";

/**
 * COMPANY SCOPE — the one place the operating scope lives
 * ─────────────────────────────────────────────────────
 * The scope selector used to be private `useState` inside the command bar, which
 * meant a second surface could not show it without keeping a second copy — and
 * two copies of a scope are two scopes. It lives here instead, as the same kind
 * of external store the locale uses:
 *
 *   · one module-level value, so every reader sees the same scope;
 *   · `useSyncExternalStore` rather than `useState` + an effect, so there is no
 *     cascading render on first paint and no hydration mismatch (the server and
 *     the hydrating client both read index 0);
 *   · NO React state, NO route and NO demo state inside — which is why changing
 *     the language, opening a department or replaying a scenario cannot reset it,
 *     and changing the scope cannot reset any of them.
 *
 * The first scope is copy and is translated (`tc`); the three business names are
 * identifiers and stay as written in both languages.
 */
export const BUSINESS_SCOPES = ["All Companies", "NEXUP System", "REBOUND", "Abomazen"] as const;

export type BusinessScope = (typeof BUSINESS_SCOPES)[number];

let currentIndex = 0;
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

export function subscribeScope(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function readScopeIndex(): number {
  return currentIndex;
}

export function serverScopeIndex(): number {
  return 0;
}

/** Move to the next scope — what the scope control calls. */
export function cycleScope(): number {
  currentIndex = (currentIndex + 1) % BUSINESS_SCOPES.length;
  emit();
  return currentIndex;
}

export function setScopeIndex(index: number): number {
  const next = ((index % BUSINESS_SCOPES.length) + BUSINESS_SCOPES.length) % BUSINESS_SCOPES.length;
  currentIndex = next;
  emit();
  return next;
}

export function useScopeIndex(): number {
  return useSyncExternalStore(subscribeScope, readScopeIndex, serverScopeIndex);
}
