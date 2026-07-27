/**
 * Signed URL utilities using HMAC-SHA256 via crypto.subtle (zero dependencies).
 * Works in Cloudflare Workers, Node 18+, and any Web Crypto API environment.
 */

const ALGORITHM = { name: 'HMAC', hash: 'SHA-256' } as const;

/**
 * Deprecation-window flag (S3, finding 5).
 *
 * URL tokens are now signed with a PER-TENANT key derived via
 * HKDF(URL_SIGNING_SECRET, tenantId) instead of the raw global secret, so a
 * single tenant's URLs can be revoked in isolation (rotate that tenant's
 * derived material) instead of all-or-nothing global rotation. New tokens are
 * minted derived-only.
 *
 * While this is `true`, verification ALSO accepts signatures produced with the
 * legacy raw global secret, so permanent/signed URLs minted before this change
 * (and the re-tenant caveat links flagged by S2) keep working. Flip to `false`
 * once every live legacy token has expired or been regenerated; at that point
 * legacy signatures stop verifying and revocation is fully per-tenant.
 */
const ACCEPT_LEGACY_GLOBAL_SIGNATURES = true;

/** Legacy path: HMAC key from the raw global secret (pre-derivation tokens). */
async function getKey(secret: string): Promise<CryptoKey> {
  const enc = new TextEncoder();
  return crypto.subtle.importKey('raw', enc.encode(secret), ALGORITHM, false, [
    'sign',
    'verify',
  ]);
}

/**
 * Derive a per-tenant HMAC key from the global secret via HKDF-SHA256, binding
 * the key to `tenantId`. Two different tenants get cryptographically unrelated
 * keys from the same global secret, so a token minted for one tenant can never
 * verify under another tenant's derived key.
 */
async function getDerivedKey(secret: string, tenantId: string): Promise<CryptoKey> {
  const enc = new TextEncoder();
  const baseKey = await crypto.subtle.importKey('raw', enc.encode(secret), 'HKDF', false, [
    'deriveBits',
  ]);
  const bits = await crypto.subtle.deriveBits(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt: enc.encode('storage-brain/url-signing/v1'),
      info: enc.encode(`tenant:${tenantId}`),
    },
    baseKey,
    256
  );
  return crypto.subtle.importKey('raw', bits, ALGORITHM, false, ['sign', 'verify']);
}

/**
 * Verify `data`'s hex signature against the per-tenant derived key first, then
 * (during the deprecation window) fall back to the legacy raw-global-secret
 * key. Both paths use `crypto.subtle.verify`, which compares in constant time.
 */
async function verifyWithDerivedOrLegacy(
  secret: string,
  tenantId: string,
  data: Uint8Array,
  token: string
): Promise<boolean> {
  const tokenBytes = hexToBuf(token);

  const derivedKey = await getDerivedKey(secret, tenantId);
  if (await crypto.subtle.verify('HMAC', derivedKey, tokenBytes, data)) {
    return true;
  }

  if (ACCEPT_LEGACY_GLOBAL_SIGNATURES) {
    const legacyKey = await getKey(secret);
    return crypto.subtle.verify('HMAC', legacyKey, tokenBytes, data);
  }

  return false;
}

/**
 * Extract the owning tenant id from a stored path of the shape
 * `tenants/{tenantId}/files/{fileId}/{fileName}`. Upload tokens don't carry the
 * tenant id separately, but the path embeds it, so key derivation can bind to
 * it without changing the function signatures. Returns '' for non-standard
 * paths (derivation still deterministic; legacy verify path still covers any
 * pre-existing token).
 */
function tenantIdFromStoredPath(storedPath: string): string {
  const parts = storedPath.split('/');
  return parts[0] === 'tenants' && parts[1] ? parts[1] : '';
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
 * @param fileId    - The file's UUID
 * @param tenantId  - The tenant's UUID (defense in depth)
 * @param expiresAt - Expiry as Unix ms timestamp
 * @param secret    - HMAC key (URL_SIGNING_SECRET)
 * @returns Hex-encoded HMAC-SHA256 token
 */
export async function generateSignedToken(
  fileId: string,
  tenantId: string,
  expiresAt: number,
  secret: string,
): Promise<string> {
  // Minted derived-only: sign with the per-tenant HKDF key (finding 5).
  const key = await getDerivedKey(secret, tenantId);
  const data = new TextEncoder().encode(`${tenantId}:${fileId}:${expiresAt}`);
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
  tenantId: string,
  expiresAt: number,
  token: string,
  secret: string,
): Promise<boolean> {
  // Check expiry first
  if (expiresAt <= Date.now()) {
    return false;
  }

  const data = new TextEncoder().encode(`${tenantId}:${fileId}:${expiresAt}`);
  // Accept the per-tenant derived signature, or (deprecation window) a legacy
  // global-secret signature. Both compare in constant time.
  return verifyWithDerivedOrLegacy(secret, tenantId, data, token);
}

/**
 * Generate a permanent (non-expiring) signed token for a file download URL.
 *
 * Revocation: rotate `URL_SIGNING_SECRET` to invalidate every existing
 * permanent token. Same inputs → same token, so this is fully deterministic.
 *
 * @param fileId   - The file's UUID
 * @param tenantId - The tenant's UUID (defense in depth)
 * @param secret   - HMAC key (URL_SIGNING_SECRET)
 * @returns Hex-encoded HMAC-SHA256 token
 */
export async function generatePermanentToken(
  fileId: string,
  tenantId: string,
  secret: string,
): Promise<string> {
  // Minted derived-only: sign with the per-tenant HKDF key (finding 5).
  const key = await getDerivedKey(secret, tenantId);
  const data = new TextEncoder().encode(`${tenantId}:${fileId}:permanent`);
  const sig = await crypto.subtle.sign('HMAC', key, data);
  return bufToHex(sig);
}

/**
 * Verify a permanent (non-expiring) signed token using timing-safe comparison.
 *
 * @returns `true` if token is valid for (fileId, tenantId, secret)
 */
export async function verifyPermanentToken(
  fileId: string,
  tenantId: string,
  token: string,
  secret: string,
): Promise<boolean> {
  const data = new TextEncoder().encode(`${tenantId}:${fileId}:permanent`);
  // Per-tenant derived signature, or legacy global-secret signature during the
  // deprecation window (see ACCEPT_LEGACY_GLOBAL_SIGNATURES).
  return verifyWithDerivedOrLegacy(secret, tenantId, data, token);
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
  // Minted derived-only: the tenant id is embedded in the stored path, so the
  // key binds to it just like signed/permanent tokens (finding 5).
  const key = await getDerivedKey(secret, tenantIdFromStoredPath(storedPath));
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

  const data = new TextEncoder().encode(`upload:${storedPath}:${expiresAt}`);
  // Per-tenant derived signature (tenant from the stored path), or legacy
  // global-secret signature during the deprecation window.
  return verifyWithDerivedOrLegacy(secret, tenantIdFromStoredPath(storedPath), data, token);
}
