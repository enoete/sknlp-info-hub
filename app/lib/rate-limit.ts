// Basic in-memory per-IP rate limiting for /api/ask. Deliberately simple:
// this runs as a single long-lived Node process (next start in one
// container, no serverless/multi-instance replicas), so a module-level Map
// is a real shared counter, not per-request throwaway state. Would need to
// move to a shared store (Redis) if this app is ever scaled to >1 instance.

interface Bucket {
  count: number;
  resetAt: number;
}

const WINDOW_MS = 60_000;
const MAX_REQUESTS_PER_WINDOW = 10;

const buckets = new Map<string, Bucket>();

export function checkRateLimit(ip: string): { allowed: boolean; retryAfterSeconds?: number } {
  const now = Date.now();
  const bucket = buckets.get(ip);

  if (!bucket || now >= bucket.resetAt) {
    buckets.set(ip, { count: 1, resetAt: now + WINDOW_MS });
    return { allowed: true };
  }

  if (bucket.count >= MAX_REQUESTS_PER_WINDOW) {
    return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil((bucket.resetAt - now) / 1000)) };
  }

  bucket.count += 1;
  return { allowed: true };
}

// Lazy sweep so one-off IPs don't accumulate in the map forever.
const g = globalThis as unknown as { __sknlpRateLimitSweeper?: ReturnType<typeof setInterval> };
if (!g.__sknlpRateLimitSweeper) {
  g.__sknlpRateLimitSweeper = setInterval(() => {
    const now = Date.now();
    for (const [ip, bucket] of buckets) {
      if (now >= bucket.resetAt) buckets.delete(ip);
    }
  }, WINDOW_MS);
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
