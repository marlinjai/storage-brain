import { timingSafeEqual } from 'node:crypto';

// Polyfill crypto.subtle.timingSafeEqual for Node.js test environment.
// This method is available in Cloudflare Workers but not in Node.js.
if (typeof crypto.subtle.timingSafeEqual !== 'function') {
  (crypto.subtle as Record<string, unknown>).timingSafeEqual = (
    a: ArrayBuffer,
    b: ArrayBuffer,
  ): boolean => {
    return timingSafeEqual(Buffer.from(a), Buffer.from(b));
  };
}
