/**
 * Signed URL utilities using HMAC-SHA256 via crypto.subtle (zero dependencies).
 * Works in Cloudflare Workers, Node 18+, and any Web Crypto API environment.
 */

const ALGORITHM = { name: 'HMAC', hash: 'SHA-256' } as const;

async function getKey(secret: string): Promise<CryptoKey> {
  const enc = new TextEncoder();
  return crypto.subtle.importKey('raw', enc.encode(secret), ALGORITHM, false, [
    'sign',
    'verify',
  ]);
}

function bufToHex(buf: ArrayBuffer): string {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function hexToBuf(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16);
  }
  return bytes;
}

/**
 * Generate a signed token for a file download URL.
 *
 * @param fileId   - The file's UUID
 * @param expiresAt - Expiry as Unix ms timestamp
 * @param secret   - HMAC key (URL_SIGNING_SECRET)
 * @returns Hex-encoded HMAC-SHA256 token
 */
export async function generateSignedToken(
  fileId: string,
  expiresAt: number,
  secret: string,
): Promise<string> {
  const key = await getKey(secret);
  const data = new TextEncoder().encode(`${fileId}:${expiresAt}`);
  const sig = await crypto.subtle.sign('HMAC', key, data);
  return bufToHex(sig);
}

/**
 * Verify a signed token using timing-safe comparison.
 *
 * @returns `true` if token is valid and not expired
 */
export async function verifySignedToken(
  fileId: string,
  expiresAt: number,
  token: string,
  secret: string,
): Promise<boolean> {
  // Check expiry first
  if (expiresAt <= Date.now()) {
    return false;
  }

  const key = await getKey(secret);
  const data = new TextEncoder().encode(`${fileId}:${expiresAt}`);
  const tokenBytes = hexToBuf(token);

  // crypto.subtle.verify performs timing-safe comparison internally
  return crypto.subtle.verify('HMAC', key, tokenBytes, data);
}

/**
 * Generate a signed token for an internal upload URL.
 *
 * @param storedPath - The file's storage path
 * @param expiresAt  - Expiry as Unix ms timestamp
 * @param secret     - HMAC key (URL_SIGNING_SECRET)
 * @returns Hex-encoded HMAC-SHA256 token
 */
export async function generateUploadToken(
  storedPath: string,
  expiresAt: number,
  secret: string,
): Promise<string> {
  const key = await getKey(secret);
  const data = new TextEncoder().encode(`upload:${storedPath}:${expiresAt}`);
  const sig = await crypto.subtle.sign('HMAC', key, data);
  return bufToHex(sig);
}

/**
 * Verify an upload token using timing-safe comparison.
 *
 * @returns `true` if token is valid and not expired
 */
export async function verifyUploadToken(
  storedPath: string,
  expiresAt: number,
  token: string,
  secret: string,
): Promise<boolean> {
  if (expiresAt <= Date.now()) {
    return false;
  }

  const key = await getKey(secret);
  const data = new TextEncoder().encode(`upload:${storedPath}:${expiresAt}`);
  const tokenBytes = hexToBuf(token);

  return crypto.subtle.verify('HMAC', key, tokenBytes, data);
}
