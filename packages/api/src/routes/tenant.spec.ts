import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createApp } from '../app';
import type { StorageAdapter, DatabaseAdapter, Tenant } from '@storage-brain/shared';

const TENANT_ID = '550e8400-e29b-41d4-a716-446655440000';

const ENV = {
  ENVIRONMENT: 'development' as const,
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
  quotaBytes: 500 * 1024 * 1024,
  usedBytes: 100 * 1024 * 1024,
  allowedFileTypes: ['image/png', 'application/pdf'],
  createdAt: 1700000000000,
  updatedAt: 1700000000000,
};

function createMockDb() {
  return {
    createTenant: vi.fn(),
    getTenantByApiKey: vi.fn().mockResolvedValue(mockTenant),
    getTenantByName: vi.fn(),
    getTenantById: vi.fn(),
    updateTenantApiKeyHash: vi.fn(),
    createFile: vi.fn(),
    getFileById: vi.fn(),
    getFileByIdUnscoped: vi.fn(),
    getFileByStoredPath: vi.fn(),
    listFilesByTenant: vi.fn(),
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
      usedBytes: 100 * 1024 * 1024,
      availableBytes: 400 * 1024 * 1024,
      usagePercent: 20,
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

describe('tenant routes', () => {
  let db: ReturnType<typeof createMockDb>;
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    db = createMockDb();
    app = createApp({
      db: db as unknown as DatabaseAdapter,
      storage: createMockStorage() as unknown as StorageAdapter,
    });
  });

  describe('GET /api/v1/tenant/quota', () => {
    it('returns quota usage', async () => {
      const res = await app.request('/api/v1/tenant/quota', {
        headers: { Authorization: 'Bearer sk_live_test123' },
      }, ENV);

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.quotaBytes).toBe(500 * 1024 * 1024);
      expect(body.usedBytes).toBe(100 * 1024 * 1024);
      expect(body.usagePercent).toBe(20);
    });

    it('requires authentication', async () => {
      const res = await app.request('/api/v1/tenant/quota', {}, ENV);
      expect(res.status).toBe(401);
    });
  });

  describe('GET /api/v1/tenant/info', () => {
    it('returns tenant info', async () => {
      const res = await app.request('/api/v1/tenant/info', {
        headers: { Authorization: 'Bearer sk_live_test123' },
      }, ENV);

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.id).toBe(TENANT_ID);
      expect(body.name).toBe('test-tenant');
      expect(body.allowedFileTypes).toEqual(['image/png', 'application/pdf']);
      expect(body.createdAt).toBeDefined();
    });
  });
});
