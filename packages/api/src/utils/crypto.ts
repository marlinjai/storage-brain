import { API_KEY_PREFIX_LIVE } from '@storage-brain/shared';

/**
 * Generate a new API key
 * Format: sk_live_{32 random characters}
 */
export function generateApiKey(): string {
  const randomBytes = new Uint8Array(24);
  crypto.getRandomValues(randomBytes);

  // Convert to base64url (URL-safe base64)
  const base64 = btoa(String.fromCharCode(...randomBytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '');

  return `${API_KEY_PREFIX_LIVE}${base64}`;
}

/**
 * Hash an API key using SHA-256
 * We use SHA-256 instead of bcrypt for performance in edge environment
 */
export async function hashApiKey(apiKey: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(apiKey);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Verify an API key against a hash
 */
export async function verifyApiKey(apiKey: string, hash: string): Promise<boolean> {
  const computedHash = await hashApiKey(apiKey);
  // Use timing-safe comparison
  return timingSafeEqual(computedHash, hash);
}

/**
 * Timing-safe string comparison to prevent timing attacks
 */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) {
    return false;
  }

  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }

  return result === 0;
}

/**
 * Generate a random UUID
 * Uses crypto.randomUUID() which is available in Cloudflare Workers
 */
export function generateId(): string {
  return crypto.randomUUID();
}
