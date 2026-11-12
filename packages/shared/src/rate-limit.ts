export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfterMs: number;
}

export interface RateLimiterOptions {
  windowMs: number;
  max: number;
  now?: () => number;
}

export interface RateLimiter {
  consume(key: string): RateLimitResult;
}

// Fixed-window limiter held in process memory. This protects a single instance
// from brute force and burst abuse. For multi-instance deployments back it with
// Redis (same interface) so the window is shared.
export function createRateLimiter(options: RateLimiterOptions): RateLimiter {
  const now = options.now ?? Date.now;
  const windows = new Map<string, { count: number; resetAt: number }>();

  return {
    consume(key) {
      const current = now();
      const entry = windows.get(key);

      if (!entry || entry.resetAt <= current) {
        const resetAt = current + options.windowMs;
        windows.set(key, { count: 1, resetAt });
        // Opportunistic sweep so the map cannot grow without bound.
        if (windows.size > 10_000) {
          for (const [k, v] of windows) if (v.resetAt <= current) windows.delete(k);
        }
        return { allowed: true, remaining: options.max - 1, retryAfterMs: 0 };
      }

      if (entry.count >= options.max) {
        return { allowed: false, remaining: 0, retryAfterMs: entry.resetAt - current };
      }

      entry.count += 1;
      return { allowed: true, remaining: options.max - entry.count, retryAfterMs: 0 };
    },
  };
}
