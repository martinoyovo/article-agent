// A small, dependency-free per-IP rate limiter. Bring-your-own-key means
// abuse spends the caller's tokens, not the host's, so the remaining concern
// is compute: someone hammering the endpoint. This caps requests per IP.
//
// Caveat: state lives in process memory, so on serverless it is per-instance,
// not global. With Fluid Compute, instances are reused, so this stops casual
// hammering well. For hard, global guarantees use Vercel Firewall rate limiting
// or a shared store (Upstash Redis). Tune with the env vars below.

const WINDOW_MS = (Number(process.env.RATE_LIMIT_WINDOW_SEC) || 60) * 1000;
const MAX = Number(process.env.RATE_LIMIT_MAX) || 5;

interface Bucket {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, Bucket>();
let lastSweep = 0;

// Drop expired buckets occasionally so the map cannot grow without bound.
function sweep(now: number): void {
  if (now - lastSweep < WINDOW_MS) return;
  lastSweep = now;
  for (const [key, b] of buckets) {
    if (b.resetAt <= now) buckets.delete(key);
  }
}

export interface RateResult {
  ok: boolean;
  limit: number;
  remaining: number;
  retryAfterSec: number;
}

// Fixed-window counter. Returns ok:false once a key exceeds MAX in the window.
export function rateLimit(key: string): RateResult {
  const now = Date.now();
  sweep(now);

  let b = buckets.get(key);
  if (!b || b.resetAt <= now) {
    b = { count: 0, resetAt: now + WINDOW_MS };
    buckets.set(key, b);
  }
  b.count++;

  if (b.count > MAX) {
    return { ok: false, limit: MAX, remaining: 0, retryAfterSec: Math.ceil((b.resetAt - now) / 1000) };
  }
  return { ok: true, limit: MAX, remaining: MAX - b.count, retryAfterSec: 0 };
}

// Derive a client key from the proxy header (Vercel sets x-forwarded-for) or
// the socket address when running standalone.
export function clientKey(forwardedFor?: string | string[], remote?: string): string {
  const xff = Array.isArray(forwardedFor) ? forwardedFor[0] : forwardedFor;
  return xff?.split(",")[0]?.trim() || remote || "unknown";
}
