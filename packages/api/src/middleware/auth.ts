import { ApiError } from '@marlinjai/brain-core';
import { apiKeySchema } from '@storage-brain/shared';
import type { Tenant } from '@storage-brain/shared';
import type { Context, Next } from 'hono';
import type { AppEnv } from '../env';
import { getAuthBrainClient, type StorageAuthBrainClient } from '../lib/auth-brain';

/**
 * Compound authentication middleware (slice 2B).
 *
 * Both legacy SB tenant keys and auth-brain service-account keys share the
 * `sk_live_` prefix, so they cannot be told apart by shape. We try both, in a
 * fail-closed order:
 *
 *   1. Legacy first (cheap, local D1): getTenantByApiKey. Hit -> done, no
 *      network call. Keeps existing-key latency unchanged.
 *   2. auth-brain fallback (network), only when configured: verifyApiKey ->
 *      workspace-scope guard -> bound-tenant lookup -> can(). Any error,
 *      timeout, or denial resolves to 401/403, never a silent allow.
 *   3. Neither resolves -> 401.
 *
 * Additive: the legacy path and every downstream tenant route are unchanged;
 * with AUTH_BRAIN_URL unset the auth-brain branch is skipped entirely.
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

  // 1. Legacy tenant key (local D1 lookup, no network).
  const legacyTenant = await c.get('db').getTenantByApiKey(apiKey);
  if (legacyTenant) {
    c.set('tenant', legacyTenant);
    await next();
    return;
  }

  // 2. auth-brain service-account key (network), only when configured.
  const client = getAuthBrainClient(c.env);
  if (client) {
    const tenant = await resolveServiceAccountTenant(c, client, apiKey);
    if (tenant) {
      c.set('tenant', tenant);
      await next();
      return;
    }
  }

  // 3. Neither path resolved.
  throw ApiError.unauthorized('Invalid API key');
}

/**
 * Resolve an auth-brain service-account key to a bound Storage Brain tenant.
 *
 * Returns a Tenant when the key authenticates and authorizes, or null when the
 * key is simply not an auth-brain key we recognize (so the caller falls through
 * to a 401). Throws ApiError for explicit rejections (403 deferred-scope, 403
 * not-permitted, 401 no-bound-tenant) and fails closed (401) on any auth-brain
 * transport error so an outage can never become an allow.
 */
async function resolveServiceAccountTenant(
  c: Context<AppEnv>,
  client: StorageAuthBrainClient,
  apiKey: string
): Promise<Tenant | null> {
  let verified;
  try {
    // Single round trip: verify the key AND run the OpenFGA authorization
    // check server-side in auth-brain (`member` is the floor to act as the
    // tenant; this is the read/write gate for the tenant data routes). With no
    // explicit resource, the check targets the key's own workspace scope, so a
    // non-workspace-scoped key (unresolvable target) comes back as a 401 ->
    // null -> generic 401 below.
    verified = await client.verifyApiKey(apiKey, { requirement: 'workspace.member' });
  } catch {
    // Network/transport error: fail closed. Legacy already missed, so this is a 401.
    throw ApiError.unauthorized('Invalid API key');
  }

  // Unknown / expired / revoked key, or a check target auth-brain could not
  // resolve (e.g. a tenant-scoped key): not a key we accept -> fall through to 401.
  if (!verified) return null;

  const { principal, authorization } = verified;

  // First cut: only workspace-scoped keys map 1:1 to an SB tenant. Broader
  // scopes span multiple tenants and need a target-resolution UX we have not
  // built yet. Defense in depth behind auth-brain's own 401 on these.
  if (principal.scope.type !== 'workspace') {
    throw ApiError.forbidden(
      'Only workspace-scoped keys are supported for the Storage Brain API'
    );
  }

  // The folded check result MUST be present and true. An absent block (e.g. an
  // older auth-brain that ignores `check`) is a deny, never a silent allow.
  if (authorization?.allowed !== true) {
    throw ApiError.forbidden('Service account is not permitted to act on this workspace');
  }

  const tenant = await c.get('db').getTenantByAuthWorkspaceId(principal.scope.id);
  if (!tenant) {
    throw ApiError.unauthorized('No Storage Brain tenant is bound to this workspace');
  }

  return tenant;
}
