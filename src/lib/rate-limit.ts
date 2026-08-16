/**
 * In-process fixed-window rate limiter.
 *
 * Scope: one instance. It is not a distributed limiter and does not pretend to
 * be — behind several replicas each holds its own counter. That is acceptable
 * for what it guards (the webhook test endpoint, which makes outbound requests
 * to a customer-supplied URL and would otherwise be a convenient scanner), and
 * the honest alternative in production is Redis or the platform's edge limiter.
 */

interface Window {
  count: number;
  resetAt: number;
}

const windows = new Map<string, Window>();

/** Bound the map so a flood of distinct keys cannot grow it without limit. */
const MAX_TRACKED_KEYS = 10_000;

export interface RateLimitResult {
  readonly allowed: boolean;
  readonly remaining: number;
  /** Seconds until the window resets. */
  readonly retryAfter: number;
}

export function rateLimit(key: string, limit: number, windowMs: number): RateLimitResult {
  const now = Date.now();
  const existing = windows.get(key);

  if (!existing || existing.resetAt <= now) {
    if (windows.size >= MAX_TRACKED_KEYS) {
      for (const [entryKey, entry] of windows) {
        if (entry.resetAt <= now) windows.delete(entryKey);
      }
      // Still full of live windows: fail closed rather than grow unbounded.
      if (windows.size >= MAX_TRACKED_KEYS) {
        return { allowed: false, remaining: 0, retryAfter: Math.ceil(windowMs / 1000) };
      }
    }

    windows.set(key, { count: 1, resetAt: now + windowMs });
    return { allowed: true, remaining: limit - 1, retryAfter: 0 };
  }

  existing.count += 1;
  const remaining = Math.max(0, limit - existing.count);

  return {
    allowed: existing.count <= limit,
    remaining,
    retryAfter: Math.ceil((existing.resetAt - now) / 1000),
  };
}

/**
 * Best-effort client identity.
 *
 * `x-forwarded-for` is spoofable when nothing trusted sets it, so this is a
 * speed bump for accidental floods, not an authorisation boundary.
 */
export function clientKey(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  const first = forwarded?.split(",")[0]?.trim();
  return first || request.headers.get("x-real-ip") || "anonymous";
}

/** Test helper — the module-level map would otherwise leak between cases. */
export function resetRateLimits(): void {
  windows.clear();
}
