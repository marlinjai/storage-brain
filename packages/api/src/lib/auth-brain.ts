import { createAuthBrainClient, type ApiKeyVerifyResponse } from '@marlinjai/auth-brain-sdk';
import type { Env } from '../env';

/**
 * auth-brain machine-auth client for the Storage Brain Worker.
 *
 * As of company-isolation S1 this is a thin wrapper over the published SDK's
 * `verifyApiKey` (`@marlinjai/auth-brain-sdk` >= 1.3.0), replacing the earlier
 * hand-rolled verify fetch. The SDK call is fetch-based and
 * Cloudflare-Workers-safe (no Node deps) and resolves a plaintext
 * service-account key to its principal; the scope block carries `app_grants`,
 * which the compound auth middleware uses as the `storage` app door.
 *
 * The verify endpoint is fail-closed by contract: a bad/expired/revoked/unknown
 * key comes back as `null`, and any transport/HTTP error throws (the SDK raises
 * AuthBrainNetworkError / AuthBrainError). The middleware turns a throw into a
 * 401 so an auth-brain outage can never become a silent allow.
 */

export type { ApiKeyVerifyResponse };

/** Narrow surface the middleware depends on (the SDK client is a superset). */
export interface StorageAuthBrainClient {
  /** Resolve a plaintext service-account key to its principal. `null` for
   * unknown/expired/revoked keys; throws on transport/HTTP error. */
  verifyApiKey(apiKey: string): Promise<ApiKeyVerifyResponse | null>;
}

// Lazily-built singletons keyed by base URL, mirroring the dashboard's cached
// client. Caching is keyed so multi-env Node hosts / tests do not cross talk.
const clientCache = new Map<string, StorageAuthBrainClient>();

/**
 * Return the auth-brain client for this environment, or null when auth-brain is
 * not configured (AUTH_BRAIN_URL unset). Returning null lets the middleware
 * skip the auth-brain branch entirely so the Worker boots and legacy tenant
 * keys keep working with no hard dependency on auth-brain being reachable.
 */
export function getAuthBrainClient(env: Env): StorageAuthBrainClient | null {
  const baseUrl = env.AUTH_BRAIN_URL;
  if (!baseUrl) return null;

  const cached = clientCache.get(baseUrl);
  if (cached) return cached;

  const client = createAuthBrainClient({ baseUrl });
  clientCache.set(baseUrl, client);
  return client;
}
