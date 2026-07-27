/**
 * HMAC-SHA256 verification for the auth-brain GDPR erasure webhook.
 *
 * Mirrors the auth-brain sender contract byte-for-byte:
 *   - the signature travels in the `x-lumitra-erasure-signature` header,
 *   - its value is `sha256=<hex>` where <hex> is HMAC-SHA256 over the EXACT raw
 *     request body bytes (never a re-serialized object),
 *   - the event id travels in `x-lumitra-erasure-event-id`.
 *
 * Implemented on crypto.subtle so it runs identically on Cloudflare Workers and
 * Node 18+ (the sender uses node:crypto; the digests are identical). Never logs
 * the body, secret, or signature.
 */

const ALGORITHM = { name: 'HMAC', hash: 'SHA-256' } as const;

/** Header the sender and consumer both agree the signature travels in. */
export const ERASURE_SIGNATURE_HEADER = 'x-lumitra-erasure-signature';
/** Header carrying the delivery's stable event id (idempotency key). */
export const ERASURE_EVENT_ID_HEADER = 'x-lumitra-erasure-event-id';

const SIGNATURE_PREFIX = 'sha256=';

async function getKey(secret: string): Promise<CryptoKey> {
  const enc = new TextEncoder();
  return crypto.subtle.importKey('raw', enc.encode(secret), ALGORITHM, false, ['sign', 'verify']);
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
 * Compute the `sha256=<hex>` signature for a raw body. Exported so the contract
 * is exercised directly in tests (and to keep sign/verify symmetric).
 */
export async function signErasureBody(rawBody: string, secret: string): Promise<string> {
  const key = await getKey(secret);
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(rawBody));
  return `${SIGNATURE_PREFIX}${bufToHex(sig)}`;
}

/**
 * Constant-time verification of a received signature header against the raw body.
 * A missing, malformed, or wrong-length header is a clean `false`, never a throw.
 * crypto.subtle.verify performs the comparison in constant time internally.
 */
export async function verifyErasureSignature(
  rawBody: string,
  header: string | null | undefined,
  secret: string
): Promise<boolean> {
  if (!header || !header.startsWith(SIGNATURE_PREFIX)) return false;

  const hex = header.slice(SIGNATURE_PREFIX.length);
  // Must be an even-length lowercase-hex string; anything else can't be a valid
  // HMAC digest, so reject before touching the crypto layer.
  if (hex.length === 0 || hex.length % 2 !== 0 || !/^[0-9a-f]+$/.test(hex)) return false;

  const key = await getKey(secret);
  const data = new TextEncoder().encode(rawBody);
  return crypto.subtle.verify('HMAC', key, hexToBuf(hex), data);
}
