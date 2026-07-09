import { AuthBrainError, AuthBrainNetworkError } from '@marlinjai/auth-brain-sdk';
import type { Env } from '../env';

/**
 * auth-brain machine-auth client for the Storage Brain Worker.
 *
 * Fetch-based and Cloudflare-Workers-safe (no Node deps), mirroring the
 * dashboard's slice-2A client and analytics-platform's singleton pattern. It
 * exposes the single operation the compound auth middleware needs:
 *
 *   - verifyApiKey: resolve a service-account key to its principal AND run the
 *     authorization check server-side in the same round trip (auth-brain PR #38
 *     folds the OpenFGA check into POST /api/verify/api-key). The Worker never
 *     talks to OpenFGA directly, so OpenFGA stays Docker-network/tailnet-only.
 *
 * NOTE: the published @marlinjai/auth-brain-sdk (1.1.0) only exposes the
 * browser-session surface (verifySession / getCurrentUser / user-scoped can).
 * The service-account key-verify call is implemented here by direct fetch
 * against the documented auth-brain REST shape until a later SDK release
 * exposes it. We still reuse the SDK's error types so callers see one
 * consistent failure surface.
 */

/** Scope kinds an auth-brain key can carry. Only `workspace` is honored by the
 * Storage Brain API in this first cut; the others are rejected upstream. */
export type ApiKeyScopeType = 'workspace' | 'tenant' | 'tenant_group' | 'account';

export interface ApiKeyScope {
  type: ApiKeyScopeType;
  /** Id of the scoped object (e.g. the workspace id for a workspace-scoped key). */
  id: string;
}

export interface ServiceAccountPrincipal {
  /** Subject type, e.g. 'service_account'. */
  type: string;
  /** Stable subject id used as the OpenFGA user. */
  id: string;
  scope: ApiKeyScope;
  /** Role granted by the key, e.g. 'member'. */
  role: string;
}

export interface ApiKeyVerifyResponse {
  principal: ServiceAccountPrincipal;
  /** Present iff the request carried a check block: the server-side OpenFGA
   * check result. Never trust its absence as an allow. */
  authorization?: { allowed: boolean };
}

/** Folded authorization check, run server-side by auth-brain. `requirement` is
 * `<scope>.<relation>` (e.g. 'workspace.member'); the resource id defaults to
 * the key's own scope id when the scope types match. */
export interface VerifyCheck {
  requirement: string;
  resource?: { workspace_id?: string; tenant_id?: string; tenant_group_id?: string };
}

export interface StorageAuthBrainClient {
  /** Resolve a service-account key, optionally with a folded authorization
   * check. Returns null for unknown/expired/revoked keys AND for keys whose
   * check target cannot be resolved (auth-brain answers 401 for both, by
   * design); throws on network/transport errors so callers can fail closed. */
  verifyApiKey(apiKey: string, check?: VerifyCheck): Promise<ApiKeyVerifyResponse | null>;
}

interface ClientConfig {
  baseUrl: string;
  fetchImpl?: typeof fetch;
}

export function createStorageAuthBrainClient(config: ClientConfig): StorageAuthBrainClient {
  const fetchImpl = config.fetchImpl ?? globalThis.fetch;

  return {
    async verifyApiKey(apiKey: string, check?: VerifyCheck): Promise<ApiKeyVerifyResponse | null> {
      let res: Response;
      try {
        // auth-brain contract (PR #35 + #38): POST /api/verify/api-key with the
        // key in the BODY as { api_key }, no Authorization header, plus an
        // optional { check } block for the folded OpenFGA check. The endpoint
        // is fail-closed (401 on bad/expired/revoked/unknown keys and on any
        // OpenFGA transport error or unresolvable check target).
        res = await fetchImpl(`${config.baseUrl}/api/verify/api-key`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ api_key: apiKey, ...(check ? { check } : {}) }),
        });
      } catch (err) {
        throw new AuthBrainNetworkError(err);
      }
      // Unknown / expired / revoked keys are a clean "no", not an error.
      if (res.status === 401 || res.status === 403 || res.status === 404) return null;
      if (!res.ok) throw new AuthBrainError(`verifyApiKey failed: ${res.status}`, res.status);
      const data: ApiKeyVerifyResponse = await res.json();
      return data;
    },
  };
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

  const client = createStorageAuthBrainClient({ baseUrl });
  clientCache.set(baseUrl, client);
  return client;
}
