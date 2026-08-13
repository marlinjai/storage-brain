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
    migrateFilesToWorkspace: vi.fn(),
    aggregateFileContexts: vi.fn().mockResolvedValue([]),
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

function createMockStorage() {
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
  let storage: ReturnType<typeof createMockStorage>;
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    db = createMockDb();
    storage = createMockStorage();
    app = createApp({
      db: db as unknown as DatabaseAdapter,
      storage: storage as unknown as StorageAdapter,
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
      const body = await res.json<TestResponseBody>();
      expect(body.name).toBe('New Tenant');
      expect(body.apiKey).toBeDefined();
      expect(body.apiKey).toMatch(/^sk_(live|test)_/);
      expect(body.quotaBytes).toBeDefined();
      expect(db.createTenant).toHaveBeenCalledTimes(1);
    });

    it('creates a tenant bound to an auth-brain tenant (the company-wide default binding)', async () => {
      const res = await app.request('/api/v1/admin/tenants', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${ADMIN_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ name: 'Lola Storage', authTenantId: 'auth-tenant-lola' }),
      }, ENV);

      expect(res.status).toBe(201);
      expect(db.createTenant).toHaveBeenCalledWith(
        expect.objectContaining({ authTenantId: 'auth-tenant-lola', authWorkspaceId: undefined })
      );
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
      const body = await res.json<TestResponseBody>();
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
      const body = await res.json<TestResponseBody>();
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
      const body = await res.json<TestResponseBody>();
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
      const body = await res.json<TestResponseBody>();
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
      const body = await res.json<TestResponseBody>();
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
      const body = await res.json<TestResponseBody>();
      expect(body.quotaBytes).toBe(1024);
    });

    it('rebinds a tenant from workspace to tenant scope (authTenantId set, authWorkspaceId cleared)', async () => {
      const rebound = { ...mockTenant, authWorkspaceId: null, authTenantId: 'auth-tenant-1' };
      db.updateTenant.mockResolvedValueOnce(rebound);

      const res = await app.request('/api/v1/admin/tenants/tenant-123', {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${ADMIN_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ authTenantId: 'auth-tenant-1', authWorkspaceId: null }),
      }, ENV);

      expect(res.status).toBe(200);
      // Both fields pass through: the new binding is set and the old one is
      // explicitly nulled in the same call, so the binding is never ambiguous.
      expect(db.updateTenant).toHaveBeenCalledWith('tenant-123', {
        authTenantId: 'auth-tenant-1',
        authWorkspaceId: null,
      });
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
      const body = await res.json<TestResponseBody>();
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

  describe('DELETE /api/v1/admin/tenants/:tenantId/files/:fileId', () => {
    const FILE_ID = '660e8400-e29b-41d4-a716-446655440001';
    const mockFile = {
      id: FILE_ID,
      tenantId: 'tenant-123',
      workspaceId: null as string | null,
      originalName: 'photo.png',
      storedPath: `tenants/tenant-123/files/${FILE_ID}/photo.png`,
      fileType: 'image/png',
      sizeBytes: 2048,
      deletedAt: null,
    };

    it('soft deletes the row, deletes the binary, and releases tenant quota', async () => {
      db.getFileById.mockResolvedValueOnce(mockFile);

      const res = await app.request(`/api/v1/admin/tenants/tenant-123/files/${FILE_ID}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${ADMIN_KEY}` },
      }, ENV);

      expect(res.status).toBe(200);
      const body = await res.json<TestResponseBody>();
      expect(body.success).toBe(true);
      expect(storage.delete).toHaveBeenCalledWith(mockFile.storedPath);
      expect(db.softDeleteFile).toHaveBeenCalledWith(FILE_ID, 'tenant-123');
      expect(db.releaseQuota).toHaveBeenCalledWith('tenant-123', mockFile.sizeBytes);
      expect(db.releaseWorkspaceQuota).not.toHaveBeenCalled();
    });

    it('also releases workspace quota when the file belongs to a workspace', async () => {
      const workspaceId = '770e8400-e29b-41d4-a716-446655440002';
      db.getFileById.mockResolvedValueOnce({ ...mockFile, workspaceId });

      const res = await app.request(`/api/v1/admin/tenants/tenant-123/files/${FILE_ID}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${ADMIN_KEY}` },
      }, ENV);

      expect(res.status).toBe(200);
      expect(db.releaseQuota).toHaveBeenCalledWith('tenant-123', mockFile.sizeBytes);
      expect(db.releaseWorkspaceQuota).toHaveBeenCalledWith(workspaceId, mockFile.sizeBytes);
    });

    it('still completes the DB cleanup when the storage delete fails', async () => {
      db.getFileById.mockResolvedValueOnce(mockFile);
      storage.delete.mockRejectedValueOnce(new Error('object already gone'));

      const res = await app.request(`/api/v1/admin/tenants/tenant-123/files/${FILE_ID}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${ADMIN_KEY}` },
      }, ENV);

      expect(res.status).toBe(200);
      expect(db.softDeleteFile).toHaveBeenCalledWith(FILE_ID, 'tenant-123');
      expect(db.releaseQuota).toHaveBeenCalledWith('tenant-123', mockFile.sizeBytes);
    });

    it('returns 404 for unknown file and touches neither storage nor quota', async () => {
      db.getFileById.mockResolvedValueOnce(null);

      const res = await app.request(`/api/v1/admin/tenants/tenant-123/files/${FILE_ID}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${ADMIN_KEY}` },
      }, ENV);

      expect(res.status).toBe(404);
      expect(storage.delete).not.toHaveBeenCalled();
      expect(db.softDeleteFile).not.toHaveBeenCalled();
      expect(db.releaseQuota).not.toHaveBeenCalled();
    });
  });

  describe('POST /api/v1/admin/tenants/:tenantId/upload/request', () => {
    const WS_ID = '770e8400-e29b-41d4-a716-446655440000';
    const validBody = { fileType: 'image/png', fileName: 'test.png', fileSizeBytes: 1024 };

    function uploadDb(overrides: Partial<ReturnType<typeof createMockDb>> = {}) {
      db.getTenantById.mockResolvedValue(mockTenant);
      db.checkQuota.mockResolvedValue({
        hasCapacity: true,
        quotaBytes: 500 * 1024 * 1024,
        usedBytes: 0,
        availableBytes: 500 * 1024 * 1024,
      });
      db.createUploadSession.mockResolvedValue('session-1');
      Object.assign(db, overrides);
    }

    function post(body: unknown, tenantId = 'tenant-123', auth = `Bearer ${ADMIN_KEY}`) {
      return app.request(`/api/v1/admin/tenants/${tenantId}/upload/request`, {
        method: 'POST',
        headers: { Authorization: auth, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }, ENV);
    }

    it('returns a handshake on success', async () => {
      uploadDb();
      const res = await post(validBody);

      expect(res.status).toBe(200);
      const body = await res.json<{
        fileId?: string;
        presignedUrl?: string;
        expiresAt?: string;
        uploadMetadata?: { maxSizeBytes?: number };
      }>();
      expect(body.fileId).toBeDefined();
      expect(body.presignedUrl).toContain('/_internal/upload/');
      expect(body.expiresAt).toBeDefined();
      expect(body.uploadMetadata?.maxSizeBytes).toBeDefined();
      expect(db.createFile).toHaveBeenCalledTimes(1);
      expect(db.createUploadSession).toHaveBeenCalledTimes(1);
    });

    it('requires the admin key (401 without it)', async () => {
      const res = await post(validBody, 'tenant-123', 'Bearer wrong-key');
      expect(res.status).toBe(401);
    });

    it('returns 404 when the tenant does not exist', async () => {
      db.getTenantById.mockResolvedValue(null);
      const res = await post(validBody);
      expect(res.status).toBe(404);
    });

    it('rejects a disallowed MIME type with 400', async () => {
      uploadDb();
      db.getTenantById.mockResolvedValue({ ...mockTenant, allowedFileTypes: ['application/pdf'] });
      const res = await post(validBody);
      expect(res.status).toBe(400);
    });

    it('rejects a file over the size limit with 400', async () => {
      uploadDb();
      const res = await post({ ...validBody, fileSizeBytes: 200 * 1024 * 1024 });
      expect(res.status).toBe(400);
    });

    it('rejects when the tenant quota is exceeded with 403', async () => {
      uploadDb();
      db.checkQuota.mockResolvedValue({ hasCapacity: false, quotaBytes: 100, usedBytes: 100, availableBytes: 0 });
      const res = await post(validBody);
      expect(res.status).toBe(403);
    });

    it('returns 404 when the workspace is missing', async () => {
      uploadDb();
      db.getWorkspaceById.mockResolvedValue(null);
      const res = await post({ ...validBody, workspaceId: WS_ID });
      expect(res.status).toBe(404);
    });

    it('returns 403 when the workspace quota is exceeded', async () => {
      uploadDb();
      db.getWorkspaceById.mockResolvedValue({ id: WS_ID, tenantId: 'tenant-123' });
      db.checkWorkspaceQuota.mockResolvedValue({ hasCapacity: false, quotaBytes: 10, usedBytes: 10 });
      const res = await post({ ...validBody, workspaceId: WS_ID });
      expect(res.status).toBe(403);
    });
  });

  describe('POST /api/v1/admin/tenants/:tenantId/files/migrate-workspace', () => {
    const WS_ID = '770e8400-e29b-41d4-a716-446655440000';
    const FILE_A = '111e8400-e29b-41d4-a716-446655440000';
    const FILE_B = '222e8400-e29b-41d4-a716-446655440000';

    function post(body: unknown, tenantId = 'tenant-123', auth = `Bearer ${ADMIN_KEY}`) {
      return app.request(`/api/v1/admin/tenants/${tenantId}/files/migrate-workspace`, {
        method: 'POST',
        headers: { Authorization: auth, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }, ENV);
    }

    interface MigrateBody {
      migratedCount?: number;
      totalBytes?: number;
      workspaceId?: string;
    }

    it('requires the admin key (401 without it)', async () => {
      const res = await post({ workspaceId: WS_ID, filter: { tag: { key: 'env', value: 'production' } } }, 'tenant-123', 'Bearer wrong-key');
      expect(res.status).toBe(401);
    });

    it('migrates by tag filter and returns the counts', async () => {
      db.getWorkspaceById.mockResolvedValueOnce({ id: WS_ID, tenantId: 'tenant-123' });
      db.migrateFilesToWorkspace.mockResolvedValueOnce({ migratedCount: 3, totalBytes: 9000 });

      const res = await post({
        workspaceId: WS_ID,
        filter: { tag: { key: 'env', value: 'production' } },
      });

      expect(res.status).toBe(200);
      const body = await res.json<MigrateBody>();
      expect(body.migratedCount).toBe(3);
      expect(body.totalBytes).toBe(9000);
      expect(body.workspaceId).toBe(WS_ID);
      expect(db.migrateFilesToWorkspace).toHaveBeenCalledWith({
        tenantId: 'tenant-123',
        workspaceId: WS_ID,
        filter: { tag: { key: 'env', value: 'production' } },
        onlyUnassigned: true, // schema default
      });
    });

    it('migrates by explicit fileIds and passes onlyUnassigned=false through', async () => {
      db.getWorkspaceById.mockResolvedValueOnce({ id: WS_ID, tenantId: 'tenant-123' });
      db.migrateFilesToWorkspace.mockResolvedValueOnce({ migratedCount: 2, totalBytes: 42 });

      const res = await post({
        workspaceId: WS_ID,
        filter: { fileIds: [FILE_A, FILE_B] },
        onlyUnassigned: false,
      });

      expect(res.status).toBe(200);
      const body = await res.json<MigrateBody>();
      expect(body.migratedCount).toBe(2);
      expect(db.migrateFilesToWorkspace).toHaveBeenCalledWith({
        tenantId: 'tenant-123',
        workspaceId: WS_ID,
        filter: { fileIds: [FILE_A, FILE_B] },
        onlyUnassigned: false,
      });
    });

    it('returns migratedCount 0 for an empty match', async () => {
      db.getWorkspaceById.mockResolvedValueOnce({ id: WS_ID, tenantId: 'tenant-123' });
      db.migrateFilesToWorkspace.mockResolvedValueOnce({ migratedCount: 0, totalBytes: 0 });

      const res = await post({
        workspaceId: WS_ID,
        filter: { tag: { key: 'env', value: 'nonexistent' } },
      });

      expect(res.status).toBe(200);
      const body = await res.json<MigrateBody>();
      expect(body.migratedCount).toBe(0);
      expect(body.totalBytes).toBe(0);
    });

    it('returns 404 when the workspace does not belong to the tenant', async () => {
      db.getWorkspaceById.mockResolvedValueOnce(null);

      const res = await post({
        workspaceId: WS_ID,
        filter: { tag: { key: 'env', value: 'production' } },
      });

      expect(res.status).toBe(404);
      expect(db.migrateFilesToWorkspace).not.toHaveBeenCalled();
    });

    it('rejects a body with neither tag nor fileIds with 400', async () => {
      db.getWorkspaceById.mockResolvedValue({ id: WS_ID, tenantId: 'tenant-123' });

      const res = await post({ workspaceId: WS_ID, filter: {} });
      expect(res.status).toBe(400);
    });

    it('rejects more than 500 fileIds with 400', async () => {
      db.getWorkspaceById.mockResolvedValue({ id: WS_ID, tenantId: 'tenant-123' });

      const fileIds = Array.from({ length: 501 }, () => FILE_A);
      const res = await post({ workspaceId: WS_ID, filter: { fileIds } });
      expect(res.status).toBe(400);
    });
  });

  describe('GET /api/v1/admin/tenants/:tenantId/files/contexts', () => {
    const WS_ID = '770e8400-e29b-41d4-a716-446655440000';

    interface ContextsBody {
      contexts?: Array<{ context: string; fileCount: number; totalBytes: number }>;
    }

    it('requires the admin key (401 without it)', async () => {
      const res = await app.request('/api/v1/admin/tenants/tenant-123/files/contexts', {
        method: 'GET',
        headers: { Authorization: 'Bearer wrong-key' },
      }, ENV);
      expect(res.status).toBe(401);
    });

    it('returns the tenant context aggregate', async () => {
      db.aggregateFileContexts.mockResolvedValueOnce([
        { context: 'story-audio', fileCount: 340, totalBytes: 123456 },
        { context: 'marketplace-cover', fileCount: 25, totalBytes: 5000 },
      ]);

      const res = await app.request('/api/v1/admin/tenants/tenant-123/files/contexts', {
        method: 'GET',
        headers: { Authorization: `Bearer ${ADMIN_KEY}` },
      }, ENV);

      expect(res.status).toBe(200);
      const body = await res.json<ContextsBody>();
      expect(body.contexts).toHaveLength(2);
      expect(body.contexts?.[0]?.context).toBe('story-audio');
      expect(body.contexts?.[0]?.fileCount).toBe(340);
      expect(db.aggregateFileContexts).toHaveBeenCalledWith('tenant-123', undefined);
    });

    it('passes the workspaceId filter through', async () => {
      db.aggregateFileContexts.mockResolvedValueOnce([]);

      const res = await app.request(
        `/api/v1/admin/tenants/tenant-123/files/contexts?workspaceId=${WS_ID}`,
        { method: 'GET', headers: { Authorization: `Bearer ${ADMIN_KEY}` } },
        ENV
      );

      expect(res.status).toBe(200);
      const body = await res.json<ContextsBody>();
      expect(body.contexts).toEqual([]);
      expect(db.aggregateFileContexts).toHaveBeenCalledWith('tenant-123', WS_ID);
    });

    it('rejects a non-uuid workspaceId with 400', async () => {
      const res = await app.request(
        '/api/v1/admin/tenants/tenant-123/files/contexts?workspaceId=nope',
        { method: 'GET', headers: { Authorization: `Bearer ${ADMIN_KEY}` } },
        ENV
      );
      expect(res.status).toBe(400);
    });
  });
});
