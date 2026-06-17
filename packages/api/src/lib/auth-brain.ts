import { AuthBrainError, AuthBrainNetworkError } from '@marlinjai/auth-brain-sdk';
import type { Env } from '../env';

/**
 * auth-brain machine-auth client for the Storage Brain Worker.
 *
 * Fetch-based and Cloudflare-Workers-safe (no Node deps), mirroring the
 * dashboard's slice-2A client and analytics-platform's singleton pattern. It
 * exposes exactly the two operations the compound auth middleware needs:
 *
 *   - verifyApiKey: resolve a service-account key to its principal
 *   - can:          authorize that principal against an OpenFGA relation
 *
 * NOTE: the published @marlinjai/auth-brain-sdk (1.1.0) only exposes the
 * browser-session surface (verifySession / getCurrentUser / user-scoped can).
 * The service-account key-verify call and the service_account-subject `can`
 * tuple are implemented here by direct fetch against the documented auth-brain
 * and OpenFGA REST shapes until a later SDK release exposes them. We still reuse
 * the SDK's error types so callers see one consistent failure surface.
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
}

/** Resource handle for `can()` checks (subset of the SDK's ResourceHandle). */
export interface ResourceHandle {
  id?: string;
  workspaceId?: string;
  tenantId?: string;
  tenantGroupId?: string;
}

export interface CanOptions {
  /** OpenFGA user-object type. Defaults to 'user'. */
  subjectType?: 'user' | 'service_account';
}

export interface StorageAuthBrainClient {
  /** Resolve a service-account key. Returns null for unknown/expired/revoked
   * keys; throws on network/transport errors so callers can fail closed. */
  verifyApiKey(apiKey: string): Promise<ApiKeyVerifyResponse | null>;
  /** Authorize `subjectId` for `scope.role` (e.g. 'workspace.member') on
   * `resource`. Throws on transport/config errors so callers can fail closed. */
  can(
    subjectId: string,
    requirement: string,
    resource: ResourceHandle,
    opts?: CanOptions
  ): Promise<boolean>;
}

interface ClientConfig {
  baseUrl: string;
  openfgaUrl?: string;
  openfgaStoreId?: string;
  openfgaModelId?: string;
  openfgaToken?: string;
  fetchImpl?: typeof fetch;
}

function openfgaObject(requirementScope: string, resource: ResourceHandle): string {
  switch (requirementScope) {
    case 'workspace':
      return `workspace:${resource.workspaceId ?? resource.id}`;
    case 'tenant':
      return `tenant:${resource.tenantId ?? resource.id}`;
    case 'tenant_group':
      return `tenant_group:${resource.tenantGroupId ?? resource.id}`;
    default:
      throw new AuthBrainError(`Unknown scope: ${requirementScope}`);
  }
}

export function createStorageAuthBrainClient(config: ClientConfig): StorageAuthBrainClient {
  const fetchImpl = config.fetchImpl ?? globalThis.fetch;

  return {
    async verifyApiKey(apiKey: string): Promise<ApiKeyVerifyResponse | null> {
      let res: Response;
      try {
        res = await fetchImpl(`${config.baseUrl}/api/api-keys/verify`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${apiKey}`,
          },
          body: JSON.stringify({}),
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

    async can(
      subjectId: string,
      requirement: string,
      resource: ResourceHandle,
      opts?: CanOptions
    ): Promise<boolean> {
      const [scope, role] = requirement.split('.');
      if (!scope || !role) {
        throw new AuthBrainError(`Invalid requirement: ${requirement}`);
      }
      const object = openfgaObject(scope, resource);
      if (!config.openfgaUrl || !config.openfgaStoreId) {
        throw new AuthBrainError('openfgaUrl + openfgaStoreId required for can()');
      }
      const user = `${opts?.subjectType ?? 'user'}:${subjectId}`;
      let res: Response;
      try {
        res = await fetchImpl(`${config.openfgaUrl}/stores/${config.openfgaStoreId}/check`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(config.openfgaToken ? { Authorization: `Bearer ${config.openfgaToken}` } : {}),
          },
          body: JSON.stringify({
            tuple_key: { user, relation: role, object },
            authorization_model_id: config.openfgaModelId,
          }),
        });
      } catch (err) {
        throw new AuthBrainNetworkError(err);
      }
      if (!res.ok) throw new AuthBrainError(`OpenFGA check failed: ${res.status}`, res.status);
      const body: { allowed?: boolean } = await res.json();
      return body.allowed === true;
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

  const client = createStorageAuthBrainClient({
    baseUrl,
    openfgaUrl: env.OPENFGA_API_URL,
    openfgaStoreId: env.OPENFGA_STORE_ID,
    openfgaModelId: env.OPENFGA_MODEL_ID,
    openfgaToken: env.OPENFGA_API_TOKEN,
  });
  clientCache.set(baseUrl, client);
  return client;
}
