/**
 * Replay protection: a bounded, TTL-expiring set of `(keyId, nonce)` pairs.
 *
 * A nonce is single-use within the acceptance window. `consume` records it and
 * returns true the first time; a second use returns false (→ REPLAY). Entries
 * older than the window are swept on every write, and the store is hard-capped
 * so a flood cannot grow memory without bound — when the cap is hit, the
 * OLDEST entry is evicted (a replayed nonce from long ago is already outside
 * the timestamp window, so eviction cannot reopen a replay hole).
 */

export type NonceStoreOptions = {
  /** How long a nonce stays remembered. Should be >= the clock-skew window. */
  ttlMs: number;
  /** Hard cap on remembered nonces. */
  maxEntries?: number;
};

export class NonceStore {
  private readonly ttlMs: number;
  private readonly maxEntries: number;
  /** key → expiry epoch ms. Insertion order is eviction order. */
  private readonly seen = new Map<string, number>();

  constructor(options: NonceStoreOptions) {
    this.ttlMs = options.ttlMs;
    this.maxEntries = options.maxEntries ?? 100_000;
  }

  get size(): number {
    return this.seen.size;
  }

  private sweep(nowMs: number): void {
    for (const [key, expiry] of this.seen) {
      if (expiry > nowMs) break; // Map preserves insertion order; all later ones are newer.
      this.seen.delete(key);
    }
  }

  /**
   * Records a nonce. Returns true when it is FRESH (first use), false when it
   * was already consumed within the window.
   */
  consume(keyId: string, nonce: string, nowMs: number): boolean {
    this.sweep(nowMs);
    const key = `${keyId}:${nonce}`;
    if (this.seen.has(key)) return false;
    this.seen.set(key, nowMs + this.ttlMs);
    while (this.seen.size > this.maxEntries) {
      const oldest = this.seen.keys().next();
      if (oldest.done) break;
      this.seen.delete(oldest.value);
    }
    return true;
  }

  clear(): void {
    this.seen.clear();
  }
}
