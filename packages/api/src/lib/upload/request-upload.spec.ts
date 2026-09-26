import { describe, it, expect, vi, beforeEach } from 'vitest';
import { requestUpload } from './request-upload';
import { createApp } from '../../app';
import type { StorageAdapter, DatabaseAdapter, Tenant } from '@storage-brain/shared';

const TENANT_ID = '550e8400-e29b-41d4-a716-446655440000';
const WORKSPACE_ID = '770e8400-e29b-41d4-a716-446655440000';
const ADMIN_KEY = 'admin-secret-key';

const ENV = {
  ENVIRONMENT: 'development' as const,
  ADMIN_API_KEY: ADMIN_KEY,
  URL_SIGNING_SECRET: 'test-secret',
  DB: {} as never,
  BUCKET: {} as never,
};

const mockTenant: Tenant = {
  id: TENANT_ID,
  name: 'test-tenant',
  apiKeyHash: 'hashed',
  keyPrefix: 'sk_live_test',
  authWorkspaceId: null,
  authTenantId: null,
  quotaBytes: 500 * 1024 * 1024,
  usedBytes: 1000,
  allowedFileTypes: null,
  createdAt: Date.now(),
  updatedAt: Date.now(),
};

function createMockDb() {
  return {
    createTenant: vi.fn(),
    getTenantByApiKey: vi.fn().mockResolvedValue(mockTenant),
    getTenantByName: vi.fn(),
    getTenantById: vi.fn().mockResolvedValue(mockTenant),
    updateTenantApiKeyHash: vi.fn(),
    getFileById: vi.fn(),
    getFileByIdUnscoped: vi.fn(),
    getFileByStoredPath: vi.fn(),
    listFilesByTenant: vi.fn(),
    updateFileMetadata: vi.fn(),
    createWorkspace: vi.fn(),
    getWorkspaceById: vi.fn().mockResolvedValue({ id: WORKSPACE_ID, tenantId: TENANT_ID }),
    listWorkspacesByTenant: vi.fn(),
    updateWorkspace: vi.fn(),
    deleteWorkspace: vi.fn(),
    getActiveFilesByWorkspace: vi.fn(),
    getUploadSessionByFileId: vi.fn(),
    createPendingUpload: vi.fn().mockResolvedValue({ created: true, sessionId: 'session-1' }),
    claimUploadSession: vi.fn().mockResolvedValue(true),
    settleUploadSession: vi.fn().mockResolvedValue(true),
    expireStaleUploadSessions: vi.fn().mockResolvedValue(0),
    deleteFileAndReleaseQuota: vi.fn().mockResolvedValue(null),
    deleteWorkspaceFilesAndReleaseQuota: vi.fn().mockResolvedValue(0),
    checkQuota: vi.fn().mockResolvedValue({
      hasCapacity: true,
      quotaBytes: 500 * 1024 * 1024,
      usedBytes: 0,
      availableBytes: 500 * 1024 * 1024,
    }),
    getQuotaUsage: vi.fn(),
    recalculateQuota: vi.fn(),
    checkWorkspaceQuota: vi
      .fn()
      .mockResolvedValue({ hasCapacity: true, quotaBytes: 100, usedBytes: 0 }),
    migrate: vi.fn(),
  };
}

function createMockStorage(): StorageAdapter {
  return { put: vi.fn(), get: vi.fn(), delete: vi.fn(), exists: vi.fn(), head: vi.fn() };
}

const validBody = {
  fileType: 'image/png',
  fileName: 'test.png',
  fileSizeBytes: 1024,
};

describe('requestUpload (shared helper)', () => {
  let db: ReturnType<typeof createMockDb>;

  beforeEach(() => {
    db = createMockDb();
  });

  it('returns a handshake and creates file + session + reserves quota', async () => {
    const handshake = await requestUpload({
      db: db as unknown as DatabaseAdapter,
      tenant: mockTenant,
      body: validBody,
      urlSigningSecret: 'test-secret',
    });

    expect(handshake.fileId).toBeDefined();
    expect(handshake.presignedUrl).toContain('/_internal/upload/');
    expect(handshake.expiresAt).toBeDefined();
    expect(handshake.uploadMetadata.maxSizeBytes).toBe(100 * 1024 * 1024);
    // One atomic call reserves the declared size and creates file + session.
    expect(db.createPendingUpload).toHaveBeenCalledTimes(1);
    const [input] = db.createPendingUpload.mock.calls[0] as [
      {
        file: { id: string; tenantId: string; sizeBytes: number };
        session: { presignedUrl: string };
      },
    ];
    expect(input.file).toMatchObject({
      id: handshake.fileId,
      tenantId: TENANT_ID,
      sizeBytes: 1024,
    });
    expect(input.session.presignedUrl).toBe(handshake.presignedUrl);
  });

  it('rejects a request without a declared size with 400 and writes nothing', async () => {
    const withoutSize: Record<string, unknown> = { ...validBody };
    delete withoutSize.fileSizeBytes;

    await expect(
      requestUpload({
        db: db as unknown as DatabaseAdapter,
        tenant: mockTenant,
        body: withoutSize,
        urlSigningSecret: 'test-secret',
      })
    ).rejects.toMatchObject({
      issues: [
        expect.objectContaining({
          path: ['fileSizeBytes'],
          message: 'fileSizeBytes is required: declare the exact size of the file in bytes',
        }),
      ],
    });
    expect(db.createPendingUpload).not.toHaveBeenCalled();
  });

  it('answers 403 when a concurrent request took the last free bytes (atomic reserve lost)', async () => {
    db.createPendingUpload.mockResolvedValueOnce({ created: false });

    await expect(
      requestUpload({
        db: db as unknown as DatabaseAdapter,
        tenant: mockTenant,
        body: validBody,
        urlSigningSecret: 'test-secret',
      })
    ).rejects.toMatchObject({
      code: 'QUOTA_EXCEEDED',
      message: 'Quota exceeded: no room left to reserve 1024 bytes for this upload',
    });
  });

  it('rejects a disallowed MIME type for a restricted tenant', async () => {
    await expect(
      requestUpload({
        db: db as unknown as DatabaseAdapter,
        tenant: { ...mockTenant, allowedFileTypes: ['application/pdf'] },
        body: validBody,
        urlSigningSecret: 'test-secret',
      })
    ).rejects.toMatchObject({ code: 'INVALID_FILE_TYPE' });
  });

  it('rejects when tenant quota is exceeded', async () => {
    db.checkQuota.mockResolvedValueOnce({
      hasCapacity: false,
      quotaBytes: 100,
      usedBytes: 100,
      availableBytes: 0,
    });

    await expect(
      requestUpload({
        db: db as unknown as DatabaseAdapter,
        tenant: mockTenant,
        body: validBody,
        urlSigningSecret: 'test-secret',
      })
    ).rejects.toMatchObject({ code: 'QUOTA_EXCEEDED' });
  });

  it('rejects when workspace does not exist', async () => {
    db.getWorkspaceById.mockResolvedValueOnce(null);

    await expect(
      requestUpload({
        db: db as unknown as DatabaseAdapter,
        tenant: mockTenant,
        body: { ...validBody, workspaceId: WORKSPACE_ID },
        urlSigningSecret: 'test-secret',
      })
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('rejects when workspace quota is exceeded', async () => {
    db.checkWorkspaceQuota.mockResolvedValueOnce({
      hasCapacity: false,
      quotaBytes: 10,
      usedBytes: 10,
    });

    await expect(
      requestUpload({
        db: db as unknown as DatabaseAdapter,
        tenant: mockTenant,
        body: { ...validBody, workspaceId: WORKSPACE_ID },
        urlSigningSecret: 'test-secret',
      })
    ).rejects.toMatchObject({ code: 'QUOTA_EXCEEDED' });
  });
});

/**
 * Drift guard: the tenant route and the admin route MUST produce identical
 * validation results for the same inputs, because they share `requestUpload`.
 */
describe('tenant vs admin upload-request parity', () => {
  let db: ReturnType<typeof createMockDb>;
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    db = createMockDb();
    app = createApp({
      db: db as unknown as DatabaseAdapter,
      storage: createMockStorage() as unknown as StorageAdapter,
    });
  });

  function tenantRequest(body: unknown) {
    return app.request(
      '/api/v1/upload/request',
      {
        method: 'POST',
        headers: { Authorization: 'Bearer sk_live_test123', 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      },
      ENV
    );
  }

  function adminRequest(body: unknown) {
    return app.request(
      `/api/v1/admin/tenants/${TENANT_ID}/upload/request`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${ADMIN_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      },
      ENV
    );
  }

  const cases: Array<{ name: string; body: Record<string, unknown>; setup?: () => void }> = [
    { name: 'valid request', body: validBody },
    {
      name: 'disallowed MIME',
      body: validBody,
      setup: () => {
        db.getTenantByApiKey.mockResolvedValue({
          ...mockTenant,
          allowedFileTypes: ['application/pdf'],
        });
        db.getTenantById.mockResolvedValue({
          ...mockTenant,
          allowedFileTypes: ['application/pdf'],
        });
      },
    },
    { name: 'too large', body: { ...validBody, fileSizeBytes: 200 * 1024 * 1024 } },
    { name: 'size missing', body: { fileType: 'image/png', fileName: 'test.png' } },
    {
      name: 'tenant quota exceeded',
      body: validBody,
      setup: () => {
        db.checkQuota.mockResolvedValue({
          hasCapacity: false,
          quotaBytes: 100,
          usedBytes: 100,
          availableBytes: 0,
        });
      },
    },
    {
      name: 'workspace missing',
      body: { ...validBody, workspaceId: WORKSPACE_ID },
      setup: () => {
        db.getWorkspaceById.mockResolvedValue(null);
      },
    },
  ];

  for (const c of cases) {
    it(`tenant and admin agree on status for: ${c.name}`, async () => {
      c.setup?.();
      const tenantRes = await tenantRequest(c.body);
      const adminRes = await adminRequest(c.body);
      expect(adminRes.status).toBe(tenantRes.status);
    });
  }
});
