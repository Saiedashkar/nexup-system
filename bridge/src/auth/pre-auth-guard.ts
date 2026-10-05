/**
 * Pre-authentication guard.
 *
 * Two jobs, both of which must happen BEFORE any signature verification:
 *
 *   1. RATE LIMIT. A request flood must be bounded even when it is
 *      unauthenticated, otherwise the HMAC work and the audit write per request
 *      become a denial-of-service and log-amplification vector. A per-remote
 *      token bucket plus a global token bucket bound it.
 *
 *   2. DOWNSAMPLE. Repeated authentication failures still need telemetry, but
 *      one audit line per failure is itself amplification. Only the first
 *      `failureAuditMax` failures per window (per remote AND globally) are
 *      audited; the rest are counted and suppressed.
 *
 * All state is bounded (hard entry caps with oldest-first eviction) and
 * TTL-swept, so neither map can grow without limit.
 */

/** Auth failures per window that are still written to the audit log. */
export const DEFAULT_AUTH_FAILURE_AUDIT_MAX = 5;
/** Length of the auth-failure audit window. */
export const DEFAULT_AUTH_FAILURE_AUDIT_WINDOW_MS = 60_000;

export type PreAuthGuardOptions = {
  perRemoteLimitPerMinute: number;
  globalLimitPerMinute: number;
  /** Max burst per bucket; defaults to the matching per-minute limit. */
  perRemoteBurst?: number;
  globalBurst?: number;
  /** How long an idle bucket is kept before it is swept. */
  ttlMs: number;
  /** Max tracked remote keys. */
  maxBuckets?: number;
  /** Failures per window that are still written to the audit log. */
  failureAuditMax: number;
  /** Length of the failure-audit window. */
  failureAuditWindowMs: number;
  /** Max tracked failure keys. */
  maxFailureKeys?: number;
};

type Bucket = { tokens: number; updatedAtMs: number };
type FailureWindow = { count: number; windowStartMs: number };

export class PreAuthGuard {
  private readonly perRemoteCapacity: number;
  private readonly perRemoteRefill: number;
  private readonly globalCapacity: number;
  private readonly globalRefill: number;
  private readonly ttlMs: number;
  private readonly maxBuckets: number;
  private readonly failureAuditMax: number;
  private readonly failureAuditWindowMs: number;
  private readonly maxFailureKeys: number;

  private readonly buckets = new Map<string, Bucket>();
  private readonly failures = new Map<string, FailureWindow>();
  private globalBucket: Bucket | null = null;
  private globalFailures: FailureWindow | null = null;

  constructor(options: PreAuthGuardOptions) {
    this.perRemoteCapacity = Math.max(1, options.perRemoteBurst ?? options.perRemoteLimitPerMinute);
    this.perRemoteRefill = options.perRemoteLimitPerMinute / 60_000;
    this.globalCapacity = Math.max(1, options.globalBurst ?? options.globalLimitPerMinute);
    this.globalRefill = options.globalLimitPerMinute / 60_000;
    this.ttlMs = options.ttlMs;
    this.maxBuckets = options.maxBuckets ?? 10_000;
    this.failureAuditMax = Math.max(0, options.failureAuditMax);
    this.failureAuditWindowMs = options.failureAuditWindowMs;
    this.maxFailureKeys = options.maxFailureKeys ?? 10_000;
  }

  /** True when the request may proceed to signature verification. */
  check(remoteKey: string, nowMs: number): boolean {
    this.sweepBuckets(nowMs);

    // Consume both buckets unconditionally so a rejected request still counts
    // against the global budget (otherwise many remote keys could add up).
    const perRemoteOk = this.consumeBucket(this.buckets, remoteKey, this.perRemoteCapacity, this.perRemoteRefill, nowMs);
    this.globalBucket ??= { tokens: this.globalCapacity, updatedAtMs: nowMs };
    const globalOk = this.applyToken(this.globalBucket, this.globalCapacity, this.globalRefill, nowMs);

    while (this.buckets.size > this.maxBuckets) {
      const oldest = this.buckets.keys().next();
      if (oldest.done) break;
      this.buckets.delete(oldest.value);
    }

    return perRemoteOk && globalOk;
  }

  /**
   * True when this authentication failure should be written to the audit log.
   * Always counts the failure; only the first `failureAuditMax` per window in
   * BOTH dimensions are reported.
   */
  shouldAuditAuthFailure(remoteKey: string, nowMs: number): boolean {
    this.sweepFailures(nowMs);
    const perRemote = this.bumpFailure(this.failures, remoteKey, nowMs);
    const global = this.bumpGlobalFailure(nowMs);

    while (this.failures.size > this.maxFailureKeys) {
      const oldest = this.failures.keys().next();
      if (oldest.done) break;
      this.failures.delete(oldest.value);
    }

    return perRemote <= this.failureAuditMax && global <= this.failureAuditMax;
  }

  clear(): void {
    this.buckets.clear();
    this.failures.clear();
    this.globalBucket = null;
    this.globalFailures = null;
  }

  /* ── internals ─────────────────────────────────────── */

  private applyToken(bucket: Bucket, capacity: number, refillPerMs: number, nowMs: number): boolean {
    const elapsed = Math.max(0, nowMs - bucket.updatedAtMs);
    bucket.tokens = Math.min(capacity, bucket.tokens + elapsed * refillPerMs);
    bucket.updatedAtMs = nowMs;
    if (bucket.tokens < 1) return false;
    bucket.tokens -= 1;
    return true;
  }

  private consumeBucket(
    store: Map<string, Bucket>,
    key: string,
    capacity: number,
    refillPerMs: number,
    nowMs: number,
  ): boolean {
    const bucket = store.get(key) ?? { tokens: capacity, updatedAtMs: nowMs };
    store.set(key, bucket);
    return this.applyToken(bucket, capacity, refillPerMs, nowMs);
  }

  private bumpFailure(store: Map<string, FailureWindow>, key: string, nowMs: number): number {
    const existing = store.get(key);
    const window =
      existing && nowMs - existing.windowStartMs <= this.failureAuditWindowMs
        ? existing
        : { count: 0, windowStartMs: nowMs };
    window.count += 1;
    store.delete(key); // re-insert so insertion order tracks recency for eviction
    store.set(key, window);
    return window.count;
  }

  private bumpGlobalFailure(nowMs: number): number {
    const existing = this.globalFailures;
    const window =
      existing && nowMs - existing.windowStartMs <= this.failureAuditWindowMs
        ? existing
        : { count: 0, windowStartMs: nowMs };
    window.count += 1;
    this.globalFailures = window;
    return window.count;
  }

  private sweepBuckets(nowMs: number): void {
    for (const [key, bucket] of this.buckets) {
      if (bucket.updatedAtMs + this.ttlMs > nowMs) break; // insertion order ≈ recency
      this.buckets.delete(key);
    }
  }

  private sweepFailures(nowMs: number): void {
    for (const [key, window] of this.failures) {
      if (window.windowStartMs + this.failureAuditWindowMs > nowMs) break;
      this.failures.delete(key);
    }
  }
}
