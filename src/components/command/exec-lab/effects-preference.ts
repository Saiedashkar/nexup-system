"use client";

/**
 * The saved effect preference — as an external store
 * ──────────────────────────────────────────────────
 * “Reduce effects” is the one setting the surface has to be TOLD rather than
 * render. A reviewer who asked their SYSTEM for reduced motion or reduced
 * transparency is answered by the stylesheet's own media queries and needs no
 * JavaScript at all; this module exists only for the in-app switch.
 *
 * WHY A STORE AND NOT AN EFFECT. The saved value lives in `localStorage`, which is
 * an external system, and React's own answer for reading one is
 * `useSyncExternalStore`: it renders the server's value ("full") during
 * hydration and then adopts the saved one — no `setState` inside an effect, and so
 * no second render pass on every mount. Storage can also change in another tab,
 * which the same subscription handles for free.
 *
 * Nothing about the demo state depends on any of this: the setting decides blur,
 * the pointer response and one notice line, and nothing else.
 */

import { useSyncExternalStore } from "react";

export type EffectsLevel = "full" | "calm";

/* Local to this visitor and this browser. */
const KEY = "nce-effects";

const listeners = new Set<() => void>();

/* Read once per change, not once per render: `useSyncExternalStore` compares
   snapshots, and a fresh string from storage on every call would be a snapshot
   that never looks equal. */
let cached: EffectsLevel | null = null;

function read(): EffectsLevel {
  if (cached !== null) return cached;
  try {
    cached = window.localStorage.getItem(KEY) === "calm" ? "calm" : "full";
  } catch {
    /* Storage can be unavailable (private mode, blocked cookies). The default is
       the full surface, which is what the server already rendered. */
    cached = "full";
  }
  return cached;
}

function serverSnapshot(): EffectsLevel {
  return "full";
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  /* A second tab changing the setting is the same event as this tab doing it. */
  const onStorage = (event: StorageEvent) => {
    if (event.key !== KEY && event.key !== null) return;
    cached = null;
    listener();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

/** The saved level. `"full"` on the server and until the saved value arrives. */
export function useEffectsPreference(): EffectsLevel {
  return useSyncExternalStore(subscribe, read, serverSnapshot);
}

/** Writes the level and tells every reader — including this one. */
export function setEffectsPreference(next: EffectsLevel): void {
  cached = next;
  try {
    window.localStorage.setItem(KEY, next);
  } catch {
    /* Not being able to remember it is not a reason to refuse the change. */
  }
  for (const listener of listeners) listener();
}

/** The other level. Kept here so the switch and the tests share one rule. */
export function otherEffectsLevel(current: EffectsLevel): EffectsLevel {
  return current === "calm" ? "full" : "calm";
}
