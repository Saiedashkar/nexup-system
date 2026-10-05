/**
 * Rate limiting: a token bucket per key id.
 *
 * Buckets refill continuously at `limitPerMinute / 60000` tokens per ms, so a
 * client can burst up to `limitPerMinute` and then settles to a steady rate
 * without a fixed-window double-spend at the boundary. Unknown keys get their
 * own bucket, which is harmless (they fail signature verification anyway) but
 * keeps the limiter from being a shared DoS surface.
 */

export type RateLimiterOptions = {
  limitPerMinute: number;
  /** Max burst; defaults to the per-minute limit. */
  burst?: number;
};

type Bucket = { tokens: number; updatedAtMs: number };

export class RateLimiter {
  private readonly capacity: number;
  private readonly refillPerMs: number;
  private readonly buckets = new Map<string, Bucket>();

  constructor(options: RateLimiterOptions) {
    const capacity = options.burst ?? options.limitPerMinute;
    this.capacity = Math.max(1, capacity);
    this.refillPerMs = options.limitPerMinute / 60_000;
  }

  /** True when the request is allowed; false when the bucket is empty. */
  check(keyId: string, nowMs: number): boolean {
    const bucket = this.buckets.get(keyId) ?? { tokens: this.capacity, updatedAtMs: nowMs };
    const elapsed = Math.max(0, nowMs - bucket.updatedAtMs);
    bucket.tokens = Math.min(this.capacity, bucket.tokens + elapsed * this.refillPerMs);
    bucket.updatedAtMs = nowMs;

    if (bucket.tokens < 1) {
      this.buckets.set(keyId, bucket);
      return false;
    }
    bucket.tokens -= 1;
    this.buckets.set(keyId, bucket);
    return true;
  }

  remaining(keyId: string, nowMs: number): number {
    const bucket = this.buckets.get(keyId);
    if (!bucket) return this.capacity;
    const elapsed = Math.max(0, nowMs - bucket.updatedAtMs);
    return Math.min(this.capacity, Math.floor(bucket.tokens + elapsed * this.refillPerMs));
  }

  clear(): void {
    this.buckets.clear();
  }
}
