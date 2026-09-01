// Basic in-memory per-IP rate limiting. Deliberately simple: this runs as
// a single long-lived Node process (next start in one container, no
// serverless/multi-instance replicas), so a module-level Map is a real
// shared counter, not per-request throwaway state. Would need to move to
// a shared store (Redis) if this app is ever scaled to >1 instance.
//
// Named limiter instances (not one shared bucket) -- decided 2026-09-01,
// prompted by a real concern: "the suggestions back-end... could blow up
// very quick and we need to weed out spam, message bombing." /api/ask's
// original 10-per-60s limit is reasonable for a chat conversation (a
// citizen asking several follow-ups quickly is normal); a citizen has no
// legitimate reason to submit many priority suggestions in a minute, so
// /api/suggestions gets its own, much stricter limiter -- see
// SUGGESTION_LIMITER below and citizenSuggestions.ts's submitSuggestion.

interface Bucket {
  count: number;
  resetAt: number;
}

interface LimiterConfig {
  windowMs: number;
  maxRequests: number;
}

export const ASK_LIMITER: LimiterConfig = { windowMs: 60_000, maxRequests: 10 };
export const SUGGESTION_LIMITER: LimiterConfig = { windowMs: 10 * 60_000, maxRequests: 3 };

const bucketsByLimiter = new Map<LimiterConfig, Map<string, Bucket>>();

export function checkRateLimit(ip: string, limiter: LimiterConfig = ASK_LIMITER): { allowed: boolean; retryAfterSeconds?: number } {
  let buckets = bucketsByLimiter.get(limiter);
  if (!buckets) {
    buckets = new Map();
    bucketsByLimiter.set(limiter, buckets);
  }

  const now = Date.now();
  const bucket = buckets.get(ip);

  if (!bucket || now >= bucket.resetAt) {
    buckets.set(ip, { count: 1, resetAt: now + limiter.windowMs });
    return { allowed: true };
  }

  if (bucket.count >= limiter.maxRequests) {
    return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil((bucket.resetAt - now) / 1000)) };
  }

  bucket.count += 1;
  return { allowed: true };
}

// Lazy sweep so one-off IPs don't accumulate in the maps forever.
const g = globalThis as unknown as { __sknlpRateLimitSweeper?: ReturnType<typeof setInterval> };
if (!g.__sknlpRateLimitSweeper) {
  g.__sknlpRateLimitSweeper = setInterval(() => {
    const now = Date.now();
    for (const buckets of bucketsByLimiter.values()) {
      for (const [ip, bucket] of buckets) {
        if (now >= bucket.resetAt) buckets.delete(ip);
      }
    }
  }, ASK_LIMITER.windowMs);
  g.__sknlpRateLimitSweeper.unref?.();
}

export function getClientIp(headers: Headers): string {
  const forwarded = headers.get('x-forwarded-for');
  if (forwarded) {
    // nginx sets this via $proxy_add_x_forwarded_for, which APPENDS the real
    // connecting IP to whatever the client already sent — so the first
    // entry is client-controlled/spoofable, the LAST entry is the one
    // nginx itself observed and is the only one worth trusting here.
    // (Only correct because app:3000 isn't reachable except through nginx —
    // see docker-compose.yml's 127.0.0.1-bound port mapping.)
    const parts = forwarded.split(',').map((p) => p.trim());
    return parts[parts.length - 1] || 'unknown';
  }
  return 'unknown';
}
