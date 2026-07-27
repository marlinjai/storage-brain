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
    createUploadSession: vi.fn().mockResolvedValue('session-1'),
    getUploadSessionByFileId: vi.fn(),
    updateUploadSessionStatus: vi.fn(),
    checkQuota: vi.fn().mockResolvedValue({
      hasCapacity: true,
      quotaBytes: 500 * 1024 * 1024,
      usedBytes: 0,
      availableBytes: 500 * 1024 * 1024,
    }),
    reserveQuota: vi.fn(),
    releaseQuota: vi.fn(),
    getQuotaUsage: vi.fn(),
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
  fileId?: string;
  presignedUrl?: string;
  expiresAt?: string;
  uploadMetadata?: { maxSizeBytes?: number };
}

describe('upload routes', () => {
  let db: ReturnType<typeof createMockDb>;
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    db = createMockDb();
    app = createApp({
      db: db as unknown as DatabaseAdapter,
      storage: createMockStorage() as unknown as StorageAdapter,
    });
  });

  describe('POST /api/v1/upload/request', () => {
    const validBody = {
      fileType: 'image/png',
      fileName: 'test.png',
      fileSizeBytes: 1024,
    };

    it('returns presigned URL for valid request', async () => {
      const res = await app.request('/api/v1/upload/request', {
        method: 'POST',
        headers: {
          Authorization: 'Bearer sk_live_test123',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(validBody),
      }, ENV);

      expect(res.status).toBe(200);
      const body = await res.json<TestResponseBody>();
      expect(body.fileId).toBeDefined();
      expect(body.presignedUrl).toContain('/_internal/upload/');
      expect(body.expiresAt).toBeDefined();
      expect(body.uploadMetadata?.maxSizeBytes).toBeDefined();
    });

    it('creates file record and upload session', async () => {
      await app.request('/api/v1/upload/request', {
        method: 'POST',
        headers: {
          Authorization: 'Bearer sk_live_test123',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(validBody),
      }, ENV);

      expect(db.createFile).toHaveBeenCalledTimes(1);
      expect(db.createUploadSession).toHaveBeenCalledTimes(1);
    });

    it('reserves quota for non-zero file size', async () => {
      await app.request('/api/v1/upload/request', {
        method: 'POST',
        headers: {
          Authorization: 'Bearer sk_live_test123',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(validBody),
      }, ENV);

      expect(db.reserveQuota).toHaveBeenCalledWith(TENANT_ID, 1024);
    });

    it('rejects invalid MIME type format', async () => {
      const res = await app.request('/api/v1/upload/request', {
        method: 'POST',
        headers: {
          Authorization: 'Bearer sk_live_test123',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ ...validBody, fileType: 'not-a-mime-type' }),
      }, ENV);

      expect(res.status).toBe(400);
    });

    it('rejects when quota exceeded', async () => {
      db.checkQuota.mockResolvedValueOnce({
        hasCapacity: false,
        quotaBytes: 100,
        usedBytes: 100,
        availableBytes: 0,
      });

      const res = await app.request('/api/v1/upload/request', {
        method: 'POST',
        headers: {
          Authorization: 'Bearer sk_live_test123',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(validBody),
      }, ENV);

      expect(res.status).toBe(403);
    });

    it('rejects file exceeding max size', async () => {
      const res = await app.request('/api/v1/upload/request', {
        method: 'POST',
        headers: {
          Authorization: 'Bearer sk_live_test123',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ ...validBody, fileSizeBytes: 200 * 1024 * 1024 }),
      }, ENV);

      expect(res.status).toBe(400);
    });

    it('restricts file types per tenant allowedFileTypes', async () => {
      db.getTenantByApiKey.mockResolvedValueOnce({
        ...mockTenant,
        allowedFileTypes: ['application/pdf'],
      });

      const res = await app.request('/api/v1/upload/request', {
        method: 'POST',
        headers: {
          Authorization: 'Bearer sk_live_test123',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(validBody),
      }, ENV);

      expect(res.status).toBe(400);
    });

    it('validates workspace exists when workspaceId provided', async () => {
      const wsId = '770e8400-e29b-41d4-a716-446655440000';
      db.getWorkspaceById.mockResolvedValueOnce(null);

      const res = await app.request('/api/v1/upload/request', {
        method: 'POST',
        headers: {
          Authorization: 'Bearer sk_live_test123',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ ...validBody, workspaceId: wsId }),
      }, ENV);

      expect(res.status).toBe(404);
    });
  });
});
