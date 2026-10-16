/**
 * In-process sliding-window rate limiter (same design as the reference
 * TensorSave project). Single-instance deployment assumption: correct for the
 * docker-compose single-container setup; for horizontal scaling swap the
 * store for Redis (interface stays identical).
 */

export class RateLimitError extends Error {
  constructor(public retryAfterSec: number) {
    super("rate_limited");
    this.name = "RateLimitError";
  }
}

type Bucket = { count: number; resetAt: number };

const buckets = new Map<string, Bucket>();
let lastSweep = Date.now();
const SWEEP_INTERVAL_MS = 300_000;
/** Hard cap so abusive unique-IP floods cannot grow the map unboundedly. */
const MAX_BUCKETS = 100_000;

export function rateLimit(key: string, limit: number, windowMs: number): void {
  const now = Date.now();
  if (now - lastSweep > SWEEP_INTERVAL_MS) {
    lastSweep = now;
    for (const [k, b] of buckets) if (b.resetAt <= now) buckets.delete(k);
  }

  const bucket = buckets.get(key);
  if (!bucket || bucket.resetAt <= now) {
    if (!bucket && buckets.size >= MAX_BUCKETS) {
      // Evict expired entries; if still full, drop the oldest bucket.
      for (const [k, b] of buckets) {
        if (b.resetAt <= now) buckets.delete(k);
      }
      if (buckets.size >= MAX_BUCKETS) {
        const oldest = [...buckets.entries()].sort((a, b) => a[1].resetAt - b[1].resetAt)[0];
        if (oldest) buckets.delete(oldest[0]);
      }
    }
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return;
  }

  bucket.count += 1;
  if (bucket.count > limit) {
    throw new RateLimitError(
      Math.max(1, Math.ceil((bucket.resetAt - now) / 1000)),
    );
  }
}

/** Test/introspection helper. */
export function peekRateLimit(key: string): Bucket | undefined {
  return buckets.get(key);
}

export function resetRateLimits(): void {
  buckets.clear();
}
