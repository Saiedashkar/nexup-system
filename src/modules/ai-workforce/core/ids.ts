import type { Clock, IdFactory } from "./types";

/**
 * Deterministic-free id factory backed by `crypto.randomUUID`.
 * Used in the running application.
 */
export function createIdFactory(prefix = "aw"): IdFactory {
  return {
    next(kind: string): string {
      const rand = globalThis.crypto?.randomUUID
        ? globalThis.crypto.randomUUID().replace(/-/g, "").slice(0, 16)
        : Math.random().toString(36).slice(2, 18);
      return `${prefix}_${kind}_${rand}`;
    },
  };
}

/**
 * Monotonic id factory (`<prefix>_<kind>_0001`). Used by tests and by the
 * local runtime when a reproducible trace is required.
 */
export function createSequentialIdFactory(prefix = "t"): IdFactory {
  const counters = new Map<string, number>();
  return {
    next(kind: string): string {
      const n = (counters.get(kind) ?? 0) + 1;
      counters.set(kind, n);
      return `${prefix}_${kind}_${String(n).padStart(4, "0")}`;
    },
  };
}

export function systemClock(): Clock {
  return () => new Date();
}

/** A clock that advances by a fixed step on every read — deterministic traces. */
export function sequentialClock(start = "2026-01-01T00:00:00.000Z", stepMs = 1000): Clock {
  let t = new Date(start).getTime();
  return () => {
    const current = new Date(t);
    t += stepMs;
    return current;
  };
}
