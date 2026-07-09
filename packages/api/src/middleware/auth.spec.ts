import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createApp } from '../app';
import { getAuthBrainClient, type StorageAuthBrainClient } from '../lib/auth-brain';
import type { StorageAdapter, DatabaseAdapter, Tenant } from '@storage-brain/shared';

// Mock the auth-brain client factory so each test controls whether auth-brain
// is configured and how verifyApiKey / can behave. Mirrors mocking the network
// boundary rather than the transport.
vi.mock('../lib/auth-brain', () => ({
  getAuthBrainClient: vi.fn(),
}));

const LEGACY_TENANT_ID = '550e8400-e29b-41d4-a716-446655440000';
const BOUND_TENANT_ID = '660e8400-e29b-41d4-a716-446655440111';
const WORKSPACE_ID = 'ws_01HX';
const SERVICE_ACCOUNT_ID = 'sa_01HX';

const ENV = {
  ENVIRONMENT: 'development' as const,
  URL_SIGNING_SECRET: 'test-secret',
  AUTH_BRAIN_URL: 'https://auth.test',
  DB: {} as never,
  BUCKET: {} as never,
};

function makeTenant(id: string, name: string, authWorkspaceId: string | null): Tenant {
  return {
    id,
    name,
    apiKeyHash: 'hashed',
    keyPrefix: 'sk_live_test',
    authWorkspaceId,
    quotaBytes: 500 * 1024 * 1024,
    usedBytes: 0,
    allowedFileTypes: ['image/png'],
    createdAt: 1700000000000,
    updatedAt: 1700000000000,
  };
}

const legacyTenant = makeTenant(LEGACY_TENANT_ID, 'legacy-tenant', null);
const boundTenant = makeTenant(BOUND_TENANT_ID, 'workspace-tenant', WORKSPACE_ID);

function createMockDb(): {
  getTenantByApiKey: ReturnType<typeof vi.fn>;
  getTenantByAuthWorkspaceId: ReturnType<typeof vi.fn>;
} {
  return {
    getTenantByApiKey: vi.fn().mockResolvedValue(null),
    getTenantByAuthWorkspaceId: vi.fn().mockResolvedValue(null),
  };
}

function createMockStorage(): StorageAdapter {
  return { put: vi.fn(), get: vi.fn(), delete: vi.fn(), exists: vi.fn(), head: vi.fn() };
}

function workspacePrincipal(allowed: boolean | null = true) {
  return {
    principal: {
      type: 'service_account',
      id: SERVICE_ACCOUNT_ID,
      scope: { type: 'workspace' as const, id: WORKSPACE_ID },
      role: 'member',
    },
    ...(allowed === null ? {} : { authorization: { allowed } }),
  };
}

const AUTH = { Authorization: 'Bearer sk_live_machinekey123' };

describe('compound auth middleware (legacy + auth-brain)', () => {
  let db: ReturnType<typeof createMockDb>;
  let client: { verifyApiKey: ReturnType<typeof vi.fn> };
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    vi.clearAllMocks();
    db = createMockDb();
    client = { verifyApiKey: vi.fn() };
    vi.mocked(getAuthBrainClient).mockReturnValue(client as unknown as StorageAuthBrainClient);
    app = createApp({
      db: db as unknown as DatabaseAdapter,
      storage: createMockStorage(),
    });
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

  it('authenticates a workspace-scoped auth-brain key (folded check) and resolves the bound tenant', async () => {
    client.verifyApiKey.mockResolvedValue(workspacePrincipal());
    db.getTenantByAuthWorkspaceId.mockResolvedValue(boundTenant);

    const res = await request();

    expect(res.status).toBe(200);
    const body = await res.json<{ id: string }>();
    expect(body.id).toBe(BOUND_TENANT_ID);
    expect(db.getTenantByAuthWorkspaceId).toHaveBeenCalledWith(WORKSPACE_ID);
    // The authorization check rides along in the verify call itself.
    expect(client.verifyApiKey).toHaveBeenCalledWith('sk_live_machinekey123', {
      requirement: 'workspace.member',
    });
  });

  it('returns 403 when the folded check denies the service account', async () => {
    client.verifyApiKey.mockResolvedValue(workspacePrincipal(false));
    db.getTenantByAuthWorkspaceId.mockResolvedValue(boundTenant);

    const res = await request();
    expect(res.status).toBe(403);
    expect(db.getTenantByAuthWorkspaceId).not.toHaveBeenCalled();
  });

  it('returns 403 (never a silent allow) when the authorization block is absent', async () => {
    // e.g. an older auth-brain that ignores the check block entirely.
    client.verifyApiKey.mockResolvedValue(workspacePrincipal(null));
    db.getTenantByAuthWorkspaceId.mockResolvedValue(boundTenant);

    const res = await request();
    expect(res.status).toBe(403);
  });

  it('returns 401 when no SB tenant is bound to the workspace', async () => {
    client.verifyApiKey.mockResolvedValue(workspacePrincipal());
    db.getTenantByAuthWorkspaceId.mockResolvedValue(null);

    const res = await request();
    expect(res.status).toBe(401);
  });

  it('returns 403 deferred-scope for a tenant-scoped key (defense in depth)', async () => {
    client.verifyApiKey.mockResolvedValue({
      principal: {
        type: 'service_account',
        id: SERVICE_ACCOUNT_ID,
        scope: { type: 'tenant', id: 'tnt_1' },
        role: 'member',
      },
      authorization: { allowed: true },
    });

    const res = await request();
    expect(res.status).toBe(403);
    const body = await res.json<{ error: { message: string } }>();
    expect(body.error.message).toMatch(/workspace-scoped/i);
    expect(db.getTenantByAuthWorkspaceId).not.toHaveBeenCalled();
  });

  it('falls through to 401 when verifyApiKey returns null (bad/expired/revoked)', async () => {
    client.verifyApiKey.mockResolvedValue(null);

    const res = await request();
    expect(res.status).toBe(401);
    expect(db.getTenantByAuthWorkspaceId).not.toHaveBeenCalled();
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

    const res = await app.request('/api/v1/tenant/info', { headers: AUTH }, {
      ENVIRONMENT: 'development' as const,
      URL_SIGNING_SECRET: 'test-secret',
      DB: {} as never,
      BUCKET: {} as never,
    });

    expect(res.status).toBe(200);
    const body = await res.json<{ id: string }>();
    expect(body.id).toBe(LEGACY_TENANT_ID);
  });

  it('returns 401 for an unknown key without crashing', async () => {
    db.getTenantByApiKey.mockResolvedValue(null);

    const res = await app.request('/api/v1/tenant/info', { headers: AUTH }, {
      ENVIRONMENT: 'development' as const,
      URL_SIGNING_SECRET: 'test-secret',
      DB: {} as never,
      BUCKET: {} as never,
    });

    expect(res.status).toBe(401);
  });
});
