import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createApp } from '../app';
import { getAuthBrainClient, type StorageAuthBrainClient } from '../lib/auth-brain';
import type { StorageAdapter, DatabaseAdapter, Tenant, StoredFile } from '@storage-brain/shared';

// Finding 4 + cross-tenant isolation: the public-download Bearer branch now runs
// the SAME compound auth as the middleware, so auth-brain keys can download and
// a key scoped to company A cannot reach company B's files.

vi.mock('../lib/auth-brain', () => ({ getAuthBrainClient: vi.fn() }));

const TENANT_A = 'aaaa1111-e29b-41d4-a716-446655440000';
const TENANT_B = 'bbbb2222-e29b-41d4-a716-446655440000';
const COMPANY_A = 'tnt_companyA';
const FILE_A = 'ffff1111-e29b-41d4-a716-446655440001';
const FILE_B = 'ffff2222-e29b-41d4-a716-446655440002';

const ENV = {
  ENVIRONMENT: 'development' as const,
  URL_SIGNING_SECRET: 'test-secret',
  AUTH_BRAIN_URL: 'https://auth.test',
  DB: {} as never,
  BUCKET: {} as never,
};

function tenant(id: string, authTenantId: string | null): Tenant {
  return {
    id,
    name: `tenant-${id}`,
    apiKeyHash: 'hashed',
    keyPrefix: 'sk_live_test',
    authWorkspaceId: null,
    authTenantId,
    quotaBytes: 500 * 1024 * 1024,
    usedBytes: 0,
    allowedFileTypes: null,
    createdAt: 1700000000000,
    updatedAt: 1700000000000,
  };
}

function file(id: string, tenantId: string): StoredFile {
  return {
    id,
    tenantId,
    workspaceId: null,
    originalName: 'photo.png',
    storedPath: `tenants/${tenantId}/files/${id}/photo.png`,
    fileType: 'image/png',
    sizeBytes: 2048,
    context: 'uploads',
    tags: null,
    metadata: null,
    processingStatus: 'completed',
    webhookUrl: null,
    createdAt: 1700000000000,
    updatedAt: 1700000000000,
    deletedAt: null,
  };
}

// Files keyed by id, each owned by exactly one tenant. getFileById is
// tenant-scoped exactly like the real adapters, so cross-tenant reads miss.
const FILES: Record<string, StoredFile> = {
  [FILE_A]: file(FILE_A, TENANT_A),
  [FILE_B]: file(FILE_B, TENANT_B),
};

function createMockDb() {
  return {
    getTenantByApiKey: vi.fn().mockResolvedValue(null),
    getTenantByAuthWorkspaceId: vi.fn().mockResolvedValue(null),
    getTenantByAuthTenantId: vi.fn(),
    getFileById: vi.fn((fileId: string, tenantId: string) => {
      const f = FILES[fileId];
      return Promise.resolve(f && f.tenantId === tenantId ? f : null);
    }),
  };
}

function createMockStorage(): StorageAdapter {
  return {
    put: vi.fn(),
    get: vi.fn().mockResolvedValue({ body: new ReadableStream(), contentType: 'image/png', size: 2048 }),
    delete: vi.fn(),
    exists: vi.fn(),
    head: vi.fn(),
  };
}

function companyPrincipal(companyId: string, grants: string[] = ['storage']) {
  return {
    principal: {
      type: 'service_account',
      id: 'sa_1',
      scope: { type: 'tenant', id: companyId, app_grants: grants },
      role: 'member',
    },
    key: { id: 'k1', name: null, expires_at: null },
  };
}

describe('public download: auth-brain key + cross-tenant isolation', () => {
  let db: ReturnType<typeof createMockDb>;
  let client: { verifyApiKey: ReturnType<typeof vi.fn> };
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    vi.clearAllMocks();
    db = createMockDb();
    client = { verifyApiKey: vi.fn() };
    vi.mocked(getAuthBrainClient).mockReturnValue(client as unknown as StorageAuthBrainClient);
    app = createApp({ db: db as unknown as DatabaseAdapter, storage: createMockStorage() });
  });

  const AUTH = { Authorization: 'Bearer sk_live_companyAkey' };

  function download(fileId: string) {
    return app.request(`/api/v1/files/${fileId}/download`, { headers: AUTH }, ENV);
  }

  it('downloads with a company-scoped auth-brain key (finding 4 fixed)', async () => {
    client.verifyApiKey.mockResolvedValue(companyPrincipal(COMPANY_A));
    db.getTenantByAuthTenantId.mockResolvedValue(tenant(TENANT_A, COMPANY_A));

    const res = await download(FILE_A);

    expect(res.status).toBe(200);
    expect(db.getTenantByAuthTenantId).toHaveBeenCalledWith(COMPANY_A);
    expect(db.getFileById).toHaveBeenCalledWith(FILE_A, TENANT_A);
  });

  it("cannot download another company's file via the download route (404, not 200)", async () => {
    client.verifyApiKey.mockResolvedValue(companyPrincipal(COMPANY_A));
    db.getTenantByAuthTenantId.mockResolvedValue(tenant(TENANT_A, COMPANY_A));

    const res = await download(FILE_B);

    expect(res.status).toBe(404);
    // The lookup was tenant-scoped to A; B's file is invisible.
    expect(db.getFileById).toHaveBeenCalledWith(FILE_B, TENANT_A);
  });

  it("cannot read another company's file via the files metadata route (404)", async () => {
    client.verifyApiKey.mockResolvedValue(companyPrincipal(COMPANY_A));
    db.getTenantByAuthTenantId.mockResolvedValue(tenant(TENANT_A, COMPANY_A));

    const res = await app.request(`/api/v1/files/${FILE_B}`, { headers: AUTH }, ENV);

    expect(res.status).toBe(404);
    expect(db.getFileById).toHaveBeenCalledWith(FILE_B, TENANT_A);
  });

  it('a download with an ungranted company key is denied (403), never served', async () => {
    client.verifyApiKey.mockResolvedValue(companyPrincipal(COMPANY_A, ['analytics']));
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    const res = await download(FILE_A);

    expect(res.status).toBe(403);
    expect(db.getFileById).not.toHaveBeenCalled();
  });
});
