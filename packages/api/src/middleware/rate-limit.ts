import { createMiddleware } from 'hono/factory';
import type { AppEnv } from '../env';

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

interface RateLimitOptions {
  /** Time window in milliseconds */
  windowMs: number;
  /** Max requests per window */
  max: number;
  /** Function to extract rate limit key (default: client IP) */
  keyFn?: (c: any) => string;
}

const DEFAULT_KEY_FN = (c: any): string =>
  c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ||
  c.req.header('x-real-ip') ||
  'unknown';

/**
 * Simple in-memory sliding window rate limiter.
 *
 * Suitable for single-instance deployments (Coolify on Hetzner).
 * No external dependencies — uses a plain Map for tracking.
 */
export function rateLimiter(options: RateLimitOptions) {
  const { windowMs, max, keyFn = DEFAULT_KEY_FN } = options;
  const store = new Map<string, RateLimitEntry>();

  // Periodic cleanup: remove expired entries every 60s
  const CLEANUP_INTERVAL_MS = 60_000;
  const MAX_STORE_SIZE = 10_000;
  let lastCleanup = Date.now();

  function cleanup(now: number) {
    for (const [key, entry] of store) {
      if (now >= entry.resetAt) {
        store.delete(key);
      }
    }
    lastCleanup = now;
  }

  return createMiddleware<AppEnv>(async (c, next): Promise<void | Response> => {
    const now = Date.now();

    // Clean up expired entries periodically or when store gets large
    if (now - lastCleanup > CLEANUP_INTERVAL_MS || store.size > MAX_STORE_SIZE) {
      cleanup(now);
    }

    const key = keyFn(c);
    const entry = store.get(key);

    if (!entry || now >= entry.resetAt) {
      // New window
      store.set(key, { count: 1, resetAt: now + windowMs });
      await next();
      return;
    }

    if (entry.count >= max) {
      const retryAfterSeconds = Math.ceil((entry.resetAt - now) / 1000);
      c.header('Retry-After', String(retryAfterSeconds));
      return c.json(
        {
          error: {
            code: 'RATE_LIMITED',
            message: 'Too many requests, please try again later',
          },
        },
        429
      );
    }

    entry.count++;
    await next();
  });
}
