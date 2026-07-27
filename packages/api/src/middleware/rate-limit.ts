import { createMiddleware } from 'hono/factory';
import type { Context } from 'hono';
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
  keyFn?: (c: Context<AppEnv>) => string;
}

const DEFAULT_KEY_FN = (c: Context<AppEnv>): string =>
  // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- empty-string fallthrough intended
  c.req.header('x-forwarded-for')?.split(',')[0]?.trim() || c.req.header('x-real-ip') || 'unknown';

// Fast non-cryptographic hash (FNV-1a). Used only to derive a stable rate-limit
// bucket key from the API key without holding the plaintext secret in the store.
function fnv1a(s: string): string {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(36);
}

/**
 * Rate-limit key for tenant-facing routes: isolate per authenticated tenant
 * instead of per IP, so server-side SDK callers sharing one egress IP don't
 * share a bucket (and one tenant can't starve others). Runs before auth, so it
 * keys on the Bearer API key (hashed) or the `tid` query param used by
 * token-based downloads, falling back to client IP.
 */
export const tenantKeyFn = (c: Context<AppEnv>): string => {
  const auth = c.req.header('Authorization');
  if (auth?.startsWith('Bearer ')) {
    return `key:${fnv1a(auth.slice(7))}`;
  }
  const tid = c.req.query('tid');
  if (tid) {
    return `tid:${tid}`;
  }
  return DEFAULT_KEY_FN(c);
};

/**
 * Simple in-memory sliding window rate limiter.
 *
 * Suitable for single-instance deployments (Coolify on Hetzner).
 * No external dependencies — uses a plain Map for tracking.
 */
export function rateLimiter(options: RateLimitOptions) {
  const { windowMs, max, keyFn = DEFAULT_KEY_FN } = options;
  // HORIZONTAL-SCALE CAVEAT (recon finding 11): this Map is per-process. Counts
  // are NOT shared across instances, so running more than one API replica (or a
  // rolling deploy overlapping two containers) multiplies the effective limit
  // by the instance count and lets a client exceed `max` by hitting different
  // instances. Correct for the current single-instance Coolify/Hetzner
  // deployment; before scaling out horizontally, move this store to a shared
  // backend (e.g. Redis/Durable Object) keyed the same way. Left in-memory
  // deliberately for now; no infra change in this slice.
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
