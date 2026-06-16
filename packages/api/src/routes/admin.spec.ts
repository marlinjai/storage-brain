import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createApp } from '../app';
import type { StorageAdapter, DatabaseAdapter } from '@storage-brain/shared';

const ADMIN_KEY = 'admin-secret-key';

const ENV = {
  ENVIRONMENT: 'development' as const,
  ADMIN_API_KEY: ADMIN_KEY,
  URL_SIGNING_SECRET: 'test-secret',
  DB: {} as never,
  BUCKET: {} as never,
};

const mockTenant = {
  id: 'tenant-123',
  name: 'Test Tenant',
  apiKeyHash: 'hashed',
  quotaBytes: 500 * 1024 * 1024,
  usedBytes: 1000,
  allowedFileTypes: null,
  createdAt: Date.now(),
  updatedAt: Date.now(),
};

function createMockDb() {
  return {
    createTenant: vi.fn(),
    getTenantByApiKey: vi.fn(),
    getTenantByName: vi.fn().mockResolvedValue(null),
    getTenantById: vi.fn(),
    updateTenantApiKeyHash: vi.fn().mockResolvedValue(true),
    listTenants: vi.fn().mockResolvedValue({ tenants: [], nextCursor: null, total: 0 }),
    updateTenant: vi.fn(),
    deleteTenant: vi.fn().mockResolvedValue(true),
    createFile: vi.fn(),
    getFileById: vi.fn(),
    getFileByIdUnscoped: vi.fn(),
    getFileByStoredPath: vi.fn(),
    listFilesByTenant: vi.fn().mockResolvedValue({ files: [], nextCursor: null, total: 0 }),
    softDeleteFile: vi.fn(),
    updateFileMetadata: vi.fn(),
    updateFileProcessingStatus: vi.fn(),
    updateFileSizeBytes: vi.fn(),
    createWorkspace: vi.fn(),
    getWorkspaceById: vi.fn(),
    listWorkspacesByTenant: vi.fn(),
    updateWorkspace: vi.fn(),
    deleteWorkspace: vi.fn(),
    getActiveFilesByWorkspace: vi.fn(),
    softDeleteFilesByWorkspace: vi.fn(),
    createUploadSession: vi.fn(),
    getUploadSessionByFileId: vi.fn(),
    updateUploadSessionStatus: vi.fn(),
    checkQuota: vi.fn(),
    reserveQuota: vi.fn(),
    releaseQuota: vi.fn(),
    getQuotaUsage: vi.fn().mockResolvedValue({
      quotaBytes: 500 * 1024 * 1024,
      usedBytes: 1000,
      availableBytes: 500 * 1024 * 1024 - 1000,
      usagePercent: 0,
    }),
    recalculateQuota: vi.fn(),
    checkWorkspaceQuota: vi.fn(),
    reserveWorkspaceQuota: vi.fn(),
    releaseWorkspaceQuota: vi.fn(),
    migrate: vi.fn(),
  };
}

function createMockStorage(): StorageAdapter {
  return { put: vi.fn(), get: vi.fn(), delete: vi.fn(), exists: vi.fn(), head: vi.fn() };
}

interface TestResponseBody {
  success?: boolean;
  id?: string;
  name?: string;
  tenantId?: string;
  apiKey?: string;
  allowedFileTypes?: string[];
  quotaBytes?: number;
  quota?: { quotaBytes?: number };
  nextCursor?: string | null;
  total?: number;
  tenants?: Array<Record<string, unknown>>;
}

describe('admin routes', () => {
  let db: ReturnType<typeof createMockDb>;
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    db = createMockDb();
    app = createApp({
      db: db as unknown as DatabaseAdapter,
      storage: createMockStorage() as unknown as StorageAdapter,
    });
  });

  describe('admin authentication', () => {
    it('rejects requests without auth header', async () => {
      const res = await app.request('/api/v1/admin/tenants', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Test' }),
      }, ENV);

      expect(res.status).toBe(401);
    });

    it('rejects requests with wrong admin key', async () => {
      const res = await app.request('/api/v1/admin/tenants', {
        method: 'POST',
        headers: {
          Authorization: 'Bearer wrong-key',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ name: 'Test' }),
      }, ENV);

      expect(res.status).toBe(401);
    });
  });

  describe('POST /api/v1/admin/tenants', () => {
    it('creates a tenant and returns API key', async () => {
      const res = await app.request('/api/v1/admin/tenants', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${ADMIN_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ name: 'New Tenant' }),
      }, ENV);

      expect(res.status).toBe(201);
      const body = (await res.json()) as TestResponseBody;
      expect(body.name).toBe('New Tenant');
      expect(body.apiKey).toBeDefined();
      expect(body.apiKey).toMatch(/^sk_(live|test)_/);
      expect(body.quotaBytes).toBeDefined();
      expect(db.createTenant).toHaveBeenCalledTimes(1);
    });

    it('rejects duplicate tenant name', async () => {
      db.getTenantByName.mockResolvedValueOnce({ id: 'existing', name: 'Existing' });

      const res = await app.request('/api/v1/admin/tenants', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${ADMIN_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ name: 'Existing' }),
      }, ENV);

      expect(res.status).toBe(409);
    });

    it('accepts custom quotaBytes and allowedFileTypes', async () => {
      const res = await app.request('/api/v1/admin/tenants', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${ADMIN_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          name: 'Custom',
          quotaBytes: 1024 * 1024,
          allowedFileTypes: ['image/png'],
        }),
      }, ENV);

      expect(res.status).toBe(201);
      const body = (await res.json()) as TestResponseBody;
      expect(body.quotaBytes).toBe(1024 * 1024);
      expect(body.allowedFileTypes).toEqual(['image/png']);
    });
  });

  describe('POST /api/v1/admin/tenants/:tenantId/regenerate-key', () => {
    it('regenerates API key', async () => {
      const res = await app.request('/api/v1/admin/tenants/tenant-123/regenerate-key', {
        method: 'POST',
        headers: { Authorization: `Bearer ${ADMIN_KEY}` },
      }, ENV);

      expect(res.status).toBe(200);
      const body = (await res.json()) as TestResponseBody;
      expect(body.apiKey).toBeDefined();
      expect(body.tenantId).toBe('tenant-123');
      expect(db.updateTenantApiKeyHash).toHaveBeenCalledTimes(1);
    });

    it('returns 404 if tenant not found', async () => {
      db.updateTenantApiKeyHash.mockResolvedValueOnce(false);

      const res = await app.request('/api/v1/admin/tenants/unknown/regenerate-key', {
        method: 'POST',
        headers: { Authorization: `Bearer ${ADMIN_KEY}` },
      }, ENV);

      expect(res.status).toBe(404);
    });
  });

  describe('GET /api/v1/admin/tenants', () => {
    it('lists tenants with default pagination', async () => {
      db.listTenants.mockResolvedValueOnce({
        tenants: [mockTenant],
        nextCursor: null,
        total: 1,
      });

      const res = await app.request('/api/v1/admin/tenants', {
        method: 'GET',
        headers: { Authorization: `Bearer ${ADMIN_KEY}` },
      }, ENV);

      expect(res.status).toBe(200);
      const body = (await res.json()) as TestResponseBody;
      expect(body.tenants).toHaveLength(1);
      expect(body.tenants?.[0]?.id).toBe('tenant-123');
      expect(body.tenants?.[0]?.name).toBe('Test Tenant');
      expect(body.total).toBe(1);
      expect(body.nextCursor).toBeNull();
    });

    it('passes limit and cursor to db', async () => {
      db.listTenants.mockResolvedValueOnce({ tenants: [], nextCursor: null, total: 0 });

      await app.request('/api/v1/admin/tenants?limit=5&cursor=abc', {
        method: 'GET',
        headers: { Authorization: `Bearer ${ADMIN_KEY}` },
      }, ENV);

      expect(db.listTenants).toHaveBeenCalledWith({ limit: 5, cursor: 'abc' });
    });
  });

  describe('GET /api/v1/admin/tenants/:tenantId', () => {
    it('returns tenant details with quota', async () => {
      db.getTenantById.mockResolvedValueOnce(mockTenant);

      const res = await app.request('/api/v1/admin/tenants/tenant-123', {
        method: 'GET',
        headers: { Authorization: `Bearer ${ADMIN_KEY}` },
      }, ENV);

      expect(res.status).toBe(200);
      const body = (await res.json()) as TestResponseBody;
      expect(body.id).toBe('tenant-123');
      expect(body.name).toBe('Test Tenant');
      expect(body.quota).toBeDefined();
      expect(body.quota?.quotaBytes).toBe(500 * 1024 * 1024);
    });

    it('returns 404 for unknown tenant', async () => {
      db.getTenantById.mockResolvedValueOnce(null);

      const res = await app.request('/api/v1/admin/tenants/unknown', {
        method: 'GET',
        headers: { Authorization: `Bearer ${ADMIN_KEY}` },
      }, ENV);

      expect(res.status).toBe(404);
    });
  });

  describe('PATCH /api/v1/admin/tenants/:tenantId', () => {
    it('updates tenant name', async () => {
      const updatedTenant = { ...mockTenant, name: 'Updated Name' };
      db.updateTenant.mockResolvedValueOnce(updatedTenant);

      const res = await app.request('/api/v1/admin/tenants/tenant-123', {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${ADMIN_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ name: 'Updated Name' }),
      }, ENV);

      expect(res.status).toBe(200);
      const body = (await res.json()) as TestResponseBody;
      expect(body.name).toBe('Updated Name');
      expect(db.updateTenant).toHaveBeenCalledWith('tenant-123', { name: 'Updated Name' });
    });

    it('updates quotaBytes', async () => {
      const updatedTenant = { ...mockTenant, quotaBytes: 1024 };
      db.updateTenant.mockResolvedValueOnce(updatedTenant);

      const res = await app.request('/api/v1/admin/tenants/tenant-123', {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${ADMIN_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ quotaBytes: 1024 }),
      }, ENV);

      expect(res.status).toBe(200);
      const body = (await res.json()) as TestResponseBody;
      expect(body.quotaBytes).toBe(1024);
    });

    it('returns 404 if tenant not found', async () => {
      db.updateTenant.mockResolvedValueOnce(null);

      const res = await app.request('/api/v1/admin/tenants/unknown', {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${ADMIN_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ name: 'Nope' }),
      }, ENV);

      expect(res.status).toBe(404);
    });

    it('rejects duplicate name on update', async () => {
      db.getTenantByName.mockResolvedValueOnce({ id: 'other-tenant', name: 'Taken' });

      const res = await app.request('/api/v1/admin/tenants/tenant-123', {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${ADMIN_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ name: 'Taken' }),
      }, ENV);

      expect(res.status).toBe(409);
    });
  });

  describe('DELETE /api/v1/admin/tenants/:tenantId', () => {
    it('deletes tenant and associated data', async () => {
      db.getTenantById.mockResolvedValueOnce(mockTenant);

      const res = await app.request('/api/v1/admin/tenants/tenant-123', {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${ADMIN_KEY}` },
      }, ENV);

      expect(res.status).toBe(200);
      const body = (await res.json()) as TestResponseBody;
      expect(body.success).toBe(true);
      expect(db.deleteTenant).toHaveBeenCalledWith('tenant-123');
    });

    it('deletes files from storage before DB deletion', async () => {
      db.getTenantById.mockResolvedValueOnce(mockTenant);
      db.listFilesByTenant.mockResolvedValueOnce({
        files: [
          { id: 'f1', storedPath: 'tenants/tenant-123/file1.jpg' },
          { id: 'f2', storedPath: 'tenants/tenant-123/file2.pdf' },
        ],
        nextCursor: null,
        total: 2,
      });

      const mockStorage = createMockStorage();
      app = createApp({
        db: db as unknown as DatabaseAdapter,
        storage: mockStorage as unknown as StorageAdapter,
      });

      const res = await app.request('/api/v1/admin/tenants/tenant-123', {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${ADMIN_KEY}` },
      }, ENV);

      expect(res.status).toBe(200);
      expect(mockStorage.delete).toHaveBeenCalledTimes(2);
      expect(mockStorage.delete).toHaveBeenCalledWith('tenants/tenant-123/file1.jpg');
      expect(mockStorage.delete).toHaveBeenCalledWith('tenants/tenant-123/file2.pdf');
    });

    it('returns 404 for unknown tenant', async () => {
      db.getTenantById.mockResolvedValueOnce(null);

      const res = await app.request('/api/v1/admin/tenants/unknown', {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${ADMIN_KEY}` },
      }, ENV);

      expect(res.status).toBe(404);
    });
  });
});
