import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createApp } from '../app';
import { getAuthBrainClient, type StorageAuthBrainClient } from '../lib/auth-brain';
import type { StorageAdapter, DatabaseAdapter, Tenant } from '@storage-brain/shared';

// Mock the auth-brain client factory so each test controls whether auth-brain
// is configured and how verifyApiKey behaves. Mirrors mocking the network
// boundary rather than the transport (which the SDK owns now).
vi.mock('../lib/auth-brain', () => ({
  getAuthBrainClient: vi.fn(),
}));

const LEGACY_TENANT_ID = '550e8400-e29b-41d4-a716-446655440000';
const WORKSPACE_TENANT_ID = '660e8400-e29b-41d4-a716-446655440111';
const COMPANY_TENANT_ID = '770e8400-e29b-41d4-a716-446655440222';
const WORKSPACE_ID = 'ws_01HX';
const COMPANY_ID = 'tnt_01HX';
const SERVICE_ACCOUNT_ID = 'sa_01HX';

const ENV = {
  ENVIRONMENT: 'development' as const,
  URL_SIGNING_SECRET: 'test-secret',
  AUTH_BRAIN_URL: 'https://auth.test',
  DB: {} as never,
  BUCKET: {} as never,
};

function makeTenant(
  id: string,
  name: string,
  bindings: { authWorkspaceId?: string | null; authTenantId?: string | null } = {}
): Tenant {
  return {
    id,
    name,
    apiKeyHash: 'hashed',
    keyPrefix: 'sk_live_test',
    authWorkspaceId: bindings.authWorkspaceId ?? null,
    authTenantId: bindings.authTenantId ?? null,
    quotaBytes: 500 * 1024 * 1024,
    usedBytes: 0,
    allowedFileTypes: ['image/png'],
    createdAt: 1700000000000,
    updatedAt: 1700000000000,
  };
}

const legacyTenant = makeTenant(LEGACY_TENANT_ID, 'legacy-tenant');
const workspaceTenant = makeTenant(WORKSPACE_TENANT_ID, 'workspace-tenant', {
  authWorkspaceId: WORKSPACE_ID,
});
const companyTenant = makeTenant(COMPANY_TENANT_ID, 'company-tenant', {
  authTenantId: COMPANY_ID,
});

function createMockDb(): {
  getTenantByApiKey: ReturnType<typeof vi.fn>;
  getTenantByAuthWorkspaceId: ReturnType<typeof vi.fn>;
  getTenantByAuthTenantId: ReturnType<typeof vi.fn>;
} {
  return {
    getTenantByApiKey: vi.fn().mockResolvedValue(null),
    getTenantByAuthWorkspaceId: vi.fn().mockResolvedValue(null),
    getTenantByAuthTenantId: vi.fn().mockResolvedValue(null),
  };
}

function createMockStorage(): StorageAdapter {
  return { put: vi.fn(), get: vi.fn(), delete: vi.fn(), exists: vi.fn(), head: vi.fn() };
}

/** A verify response with a scope of the given type, optionally carrying grants.
 * Pass `grants: undefined` to model a version-skew response (field absent). */
function principal(
  scopeType: 'workspace' | 'tenant' | 'tenant_group',
  scopeId: string,
  grants: string[] | undefined = ['storage']
) {
  const scope: Record<string, unknown> = { type: scopeType, id: scopeId };
  if (grants !== undefined) scope.app_grants = grants;
  return {
    principal: { type: 'service_account', id: SERVICE_ACCOUNT_ID, scope, role: 'member' },
    key: { id: 'key_1', name: null, expires_at: null },
  };
}

const AUTH = { Authorization: 'Bearer sk_live_machinekey123' };

describe('compound auth middleware (legacy + auth-brain workspace/company classes)', () => {
  let db: ReturnType<typeof createMockDb>;
  let client: { verifyApiKey: ReturnType<typeof vi.fn> };
  let app: ReturnType<typeof createApp>;
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    db = createMockDb();
    client = { verifyApiKey: vi.fn() };
    vi.mocked(getAuthBrainClient).mockReturnValue(client as unknown as StorageAuthBrainClient);
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    app = createApp({
      db: db as unknown as DatabaseAdapter,
      storage: createMockStorage(),
    });
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  function request(headers: Record<string, string> = AUTH) {
    return app.request('/api/v1/tenant/info', { headers }, ENV);
  }

  it('authenticates a legacy tenant key without touching auth-brain', async () => {
    db.getTenantByApiKey.mockResolvedValue(legacyTenant);

    const res = await request();

    expect(res.status).toBe(200);
    const body = await res.json<{ id: string }>();
    expect(body.id).toBe(LEGACY_TENANT_ID);
    expect(client.verifyApiKey).not.toHaveBeenCalled();
  });

  it('authenticates a workspace-scoped auth-brain key and resolves the bound tenant', async () => {
    client.verifyApiKey.mockResolvedValue(principal('workspace', WORKSPACE_ID));
    db.getTenantByAuthWorkspaceId.mockResolvedValue(workspaceTenant);

    const res = await request();

    expect(res.status).toBe(200);
    const body = await res.json<{ id: string }>();
    expect(body.id).toBe(WORKSPACE_TENANT_ID);
    expect(db.getTenantByAuthWorkspaceId).toHaveBeenCalledWith(WORKSPACE_ID);
    // Verify is called with just the key (the SDK owns the transport now).
    expect(client.verifyApiKey).toHaveBeenCalledWith('sk_live_machinekey123');
  });

  it('authenticates a NEW tenant/company-scoped key and resolves via auth_tenant_id', async () => {
    client.verifyApiKey.mockResolvedValue(principal('tenant', COMPANY_ID));
    db.getTenantByAuthTenantId.mockResolvedValue(companyTenant);

    const res = await request();

    expect(res.status).toBe(200);
    const body = await res.json<{ id: string }>();
    expect(body.id).toBe(COMPANY_TENANT_ID);
    expect(db.getTenantByAuthTenantId).toHaveBeenCalledWith(COMPANY_ID);
    expect(db.getTenantByAuthWorkspaceId).not.toHaveBeenCalled();
  });

  it('returns 403 and logs when the company lacks the storage app grant (company scope)', async () => {
    client.verifyApiKey.mockResolvedValue(principal('tenant', COMPANY_ID, ['analytics']));

    const res = await request();

    expect(res.status).toBe(403);
    // Never resolves a tenant when the grant door is closed.
    expect(db.getTenantByAuthTenantId).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('storage app grant not present'),
      expect.objectContaining({ scopeType: 'tenant', scopeId: COMPANY_ID })
    );
  });

  it('returns 403 and logs the grant-denied line for an ungranted workspace-scoped key', async () => {
    client.verifyApiKey.mockResolvedValue(principal('workspace', WORKSPACE_ID, []));

    const res = await request();

    expect(res.status).toBe(403);
    expect(db.getTenantByAuthWorkspaceId).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('storage app grant not present'),
      expect.objectContaining({ scopeType: 'workspace' })
    );
  });

  it('returns 403 with a distinct version-skew log when app_grants is absent entirely', async () => {
    // Build the response WITHOUT an app_grants field (older auth-brain). Cannot
    // go through the helper: passing undefined there hits its default grant.
    client.verifyApiKey.mockResolvedValue({
      principal: {
        type: 'service_account',
        id: SERVICE_ACCOUNT_ID,
        scope: { type: 'tenant', id: COMPANY_ID },
        role: 'member',
      },
      key: { id: 'key_1', name: null, expires_at: null },
    });

    const res = await request();

    expect(res.status).toBe(403);
    expect(db.getTenantByAuthTenantId).not.toHaveBeenCalled();
    // Distinct pattern from the grant-denied line above.
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('version skew'),
      expect.objectContaining({ scopeType: 'tenant', scopeId: COMPANY_ID })
    );
  });

  it('returns 401 when no SB tenant is bound to the workspace', async () => {
    client.verifyApiKey.mockResolvedValue(principal('workspace', WORKSPACE_ID));
    db.getTenantByAuthWorkspaceId.mockResolvedValue(null);

    const res = await request();
    expect(res.status).toBe(401);
  });

  it('returns 401 when no SB tenant is bound to the company', async () => {
    client.verifyApiKey.mockResolvedValue(principal('tenant', COMPANY_ID));
    db.getTenantByAuthTenantId.mockResolvedValue(null);

    const res = await request();
    expect(res.status).toBe(401);
  });

  it('rejects a tenant_group-scoped key with 403 (unsupported scope)', async () => {
    client.verifyApiKey.mockResolvedValue(principal('tenant_group', 'tg_1'));

    const res = await request();
    expect(res.status).toBe(403);
    const body = await res.json<{ error: { message: string } }>();
    expect(body.error.message).toMatch(/workspace- or company-scoped/i);
    expect(db.getTenantByAuthWorkspaceId).not.toHaveBeenCalled();
    expect(db.getTenantByAuthTenantId).not.toHaveBeenCalled();
  });

  it('falls through to 401 when verifyApiKey returns null (bad/expired/revoked)', async () => {
    client.verifyApiKey.mockResolvedValue(null);

    const res = await request();
    expect(res.status).toBe(401);
    expect(db.getTenantByAuthWorkspaceId).not.toHaveBeenCalled();
    expect(db.getTenantByAuthTenantId).not.toHaveBeenCalled();
  });

  it('fails closed (401) when verifyApiKey throws (network error/timeout)', async () => {
    client.verifyApiKey.mockRejectedValue(new Error('network down'));

    const res = await request();
    expect(res.status).toBe(401);
  });

  it('requires an Authorization header', async () => {
    const res = await request({});
    expect(res.status).toBe(401);
  });
});

describe('compound auth middleware degradation (AUTH_BRAIN_URL unset)', () => {
  let db: ReturnType<typeof createMockDb>;
  let app: ReturnType<typeof createApp>;

  const DEGRADED_ENV = {
    ENVIRONMENT: 'development' as const,
    URL_SIGNING_SECRET: 'test-secret',
    DB: {} as never,
    BUCKET: {} as never,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    db = createMockDb();
    // auth-brain not configured -> factory returns null, branch is skipped.
    vi.mocked(getAuthBrainClient).mockReturnValue(null);
    app = createApp({
      db: db as unknown as DatabaseAdapter,
      storage: createMockStorage(),
    });
  });

  it('still authenticates legacy tenant keys', async () => {
    db.getTenantByApiKey.mockResolvedValue(legacyTenant);

    const res = await app.request('/api/v1/tenant/info', { headers: AUTH }, DEGRADED_ENV);

    expect(res.status).toBe(200);
    const body = await res.json<{ id: string }>();
    expect(body.id).toBe(LEGACY_TENANT_ID);
  });

  it('returns 401 for an unknown key without crashing', async () => {
    db.getTenantByApiKey.mockResolvedValue(null);

    const res = await app.request('/api/v1/tenant/info', { headers: AUTH }, DEGRADED_ENV);

    expect(res.status).toBe(401);
  });
});
