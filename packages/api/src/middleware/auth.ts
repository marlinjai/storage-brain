import { ApiError } from '@marlinjai/brain-core';
import { apiKeySchema } from '@storage-brain/shared';
import type { DatabaseAdapter, Tenant } from '@storage-brain/shared';
import type { Context, Next } from 'hono';
import type { AppEnv } from '../env';
import {
  getAuthBrainClient,
  type ApiKeyVerifyResponse,
  type StorageAuthBrainClient,
} from '../lib/auth-brain';

/**
 * Compound authentication (company-isolation S1).
 *
 * Legacy SB tenant keys and auth-brain service-account keys all share the
 * `sk_live_` prefix, so they cannot be told apart by shape. We accept THREE
 * credential classes, tried in a fail-closed order:
 *
 *   1. Legacy tenant key (cheap, local D1): getTenantByApiKey. Hit -> done, no
 *      network call. Unchanged from the prior slice.
 *   2. auth-brain `workspace`-scoped key: verifyApiKey -> `storage` app-grant
 *      door -> resolve the bound tenant via `auth_workspace_id`. Unchanged
 *      mapping.
 *   3. auth-brain `tenant`-scoped key (NEW): verifyApiKey -> `storage` app-grant
 *      door -> resolve the bound tenant via `auth_tenant_id` (a storage tenant
 *      maps 1:1 to an auth-brain COMPANY).
 *
 * `tenant_group`-scoped keys stay rejected. Any auth-brain error, timeout, or
 * denial resolves to 401/403, never a silent allow. With AUTH_BRAIN_URL unset
 * the auth-brain branch is skipped entirely (legacy keys only).
 */
export async function authMiddleware(c: Context<AppEnv>, next: Next): Promise<void> {
  const authHeader = c.req.header('Authorization');
  if (!authHeader) {
    throw ApiError.unauthorized('Missing Authorization header');
  }
  if (!authHeader.startsWith('Bearer ')) {
    throw ApiError.unauthorized('Invalid Authorization header format. Expected: Bearer {api_key}');
  }

  const apiKey = authHeader.slice(7);
  if (!apiKeySchema.safeParse(apiKey).success) {
    throw ApiError.unauthorized('Invalid API key format');
  }

  const tenant = await authenticateApiKey(c.get('db'), getAuthBrainClient(c.env), apiKey);
  c.set('tenant', tenant);
  await next();
}

/**
 * Resolve an `sk_live_` API key to a Storage Brain tenant using the same
 * compound auth as the middleware. Shared so the public-download Bearer branch
 * runs the identical legacy + both-auth-brain-classes + grant checks instead of
 * a legacy-only lookup (finding 4). Throws ApiError (401/403) on failure.
 */
export async function authenticateApiKey(
  db: DatabaseAdapter,
  client: StorageAuthBrainClient | null,
  apiKey: string
): Promise<Tenant> {
  // 1. Legacy tenant key (local D1 lookup, no network).
  const legacyTenant = await db.getTenantByApiKey(apiKey);
  if (legacyTenant) return legacyTenant;

  // 2/3. auth-brain service-account key (network), only when configured.
  if (client) {
    const tenant = await resolveServiceAccountTenant(db, client, apiKey);
    if (tenant) return tenant;
  }

  // Neither path resolved.
  throw ApiError.unauthorized('Invalid API key');
}

/**
 * Resolve an auth-brain service-account key to a bound Storage Brain tenant.
 *
 * Returns a Tenant when the key authenticates and authorizes, or null when the
 * key is simply not an auth-brain key we recognize (so the caller falls through
 * to a 401). Throws ApiError for explicit rejections (403 ungranted, 403
 * unsupported scope, 401 no-bound-tenant) and fails closed (401) on any
 * auth-brain transport error so an outage can never become an allow.
 */
async function resolveServiceAccountTenant(
  db: DatabaseAdapter,
  client: StorageAuthBrainClient,
  apiKey: string
): Promise<Tenant | null> {
  let verified: ApiKeyVerifyResponse | null;
  try {
    verified = await client.verifyApiKey(apiKey);
  } catch {
    // Network/HTTP error: fail closed. Legacy already missed, so this is a 401.
    throw ApiError.unauthorized('Invalid API key');
  }

  // Unknown / expired / revoked key: not a key we accept -> fall through to 401.
  if (!verified) return null;

  const { principal } = verified;
  const scope = principal.scope;

  // `workspace` and `tenant` scopes both map 1:1 to an SB tenant and both
  // require the `storage` app grant. `tenant_group` (and anything else) is
  // rejected: it spans multiple companies and is not an accepted machine path.
  if (scope.type === 'workspace') {
    requireStorageGrant(scope, principal.id);
    const tenant = await db.getTenantByAuthWorkspaceId(scope.id);
    if (!tenant) {
      throw ApiError.unauthorized('No Storage Brain tenant is bound to this workspace');
    }
    return tenant;
  }

  if (scope.type === 'tenant') {
    requireStorageGrant(scope, principal.id);
    const tenant = await db.getTenantByAuthTenantId(scope.id);
    if (!tenant) {
      throw ApiError.unauthorized('No Storage Brain tenant is bound to this company');
    }
    return tenant;
  }

  throw ApiError.forbidden(
    'Only workspace- or company-scoped keys are supported for the Storage Brain API'
  );
}

/**
 * The `storage` app-grant door for auth-brain keys (both scopes).
 *
 * Fails closed with a 403 in two distinct, separately-logged cases:
 *   - the scope's `app_grants` field is absent entirely (a version-skew signal
 *     that this auth-brain predates grant delivery); never treated as an allow;
 *   - `app_grants` is present but does not include `storage` (the company is
 *     not granted the storage app).
 *
 * Never logs the key, token, or signature (only stable ids and the scope).
 */
function requireStorageGrant(
  scope: ApiKeyVerifyResponse['principal']['scope'],
  serviceAccountId: string
): void {
  const grants: string[] | undefined = scope.app_grants;

  if (grants === undefined) {
    console.warn(
      '[auth-brain] app_grants missing from verify response (version skew); denying storage access',
      { scopeType: scope.type, scopeId: scope.id, serviceAccountId }
    );
    throw ApiError.forbidden('Storage app grant could not be verified');
  }

  if (!grants.includes('storage')) {
    console.warn('[auth-brain] storage app grant not present; denying storage access', {
      scopeType: scope.type,
      scopeId: scope.id,
      serviceAccountId,
    });
    throw ApiError.forbidden('This company is not granted the storage app');
  }
}
