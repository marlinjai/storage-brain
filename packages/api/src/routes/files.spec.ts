import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createApp } from '../app';
import { generateSignedToken } from '../services/signed-url';
import type { StorageAdapter, DatabaseAdapter, Tenant, StoredFile } from '@storage-brain/shared';

const TENANT_ID = '550e8400-e29b-41d4-a716-446655440000';
const FILE_ID = '660e8400-e29b-41d4-a716-446655440001';

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
  quotaBytes: 500 * 1024 * 1024,
  usedBytes: 1000,
  allowedFileTypes: null,
  createdAt: Date.now(),
  updatedAt: Date.now(),
};

const mockFile: StoredFile = {
  id: FILE_ID,
  tenantId: TENANT_ID,
  workspaceId: null,
  originalName: 'photo.png',
  storedPath: `tenants/${TENANT_ID}/files/${FILE_ID}/photo.png`,
  fileType: 'image/png',
  sizeBytes: 2048,
  context: 'uploads',
  tags: { category: 'photo' },
  metadata: null,
  processingStatus: 'completed',
  webhookUrl: null,
  createdAt: Date.now(),
  updatedAt: Date.now(),
  deletedAt: null,
};

function createMockDb() {
  return {
    createTenant: vi.fn(),
    getTenantByApiKey: vi.fn().mockResolvedValue(mockTenant),
    getTenantByName: vi.fn(),
    getTenantById: vi.fn(),
    updateTenantApiKeyHash: vi.fn(),
    createFile: vi.fn(),
    getFileById: vi.fn().mockResolvedValue(mockFile),
    getFileByIdUnscoped: vi.fn().mockResolvedValue(mockFile),
    getFileByStoredPath: vi.fn(),
    listFilesByTenant: vi.fn().mockResolvedValue({ files: [mockFile], nextCursor: null, total: 1 }),
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
    checkQuota: vi.fn().mockResolvedValue({ hasCapacity: true, quotaBytes: 500 * 1024 * 1024, usedBytes: 0, availableBytes: 500 * 1024 * 1024 }),
    reserveQuota: vi.fn(),
    releaseQuota: vi.fn(),
    getQuotaUsage: vi.fn().mockResolvedValue({ quotaBytes: 500 * 1024 * 1024, usedBytes: 0, availableBytes: 500 * 1024 * 1024, usagePercent: 0 }),
    recalculateQuota: vi.fn(),
    checkWorkspaceQuota: vi.fn(),
    reserveWorkspaceQuota: vi.fn(),
    releaseWorkspaceQuota: vi.fn(),
    migrate: vi.fn(),
  };
}

function createMockStorage(): StorageAdapter {
  return {
    put: vi.fn(),
    get: vi.fn().mockResolvedValue({
      body: new ReadableStream(),
      contentType: 'image/png',
      size: 2048,
    }),
    delete: vi.fn(),
    exists: vi.fn(),
    head: vi.fn(),
  };
}

describe('file routes', () => {
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

  describe('GET /api/v1/files', () => {
    it('returns file list for authenticated tenant', async () => {
      const res = await app.request('/api/v1/files', {
        headers: { Authorization: 'Bearer sk_live_test123' },
      }, ENV);

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.files).toHaveLength(1);
      expect(body.files[0].id).toBe(FILE_ID);
      expect(body.total).toBe(1);
    });

    it('returns 401 without auth header', async () => {
      const res = await app.request('/api/v1/files', {}, ENV);
      expect(res.status).toBe(401);
    });

    it('returns 401 with invalid auth format', async () => {
      const res = await app.request('/api/v1/files', {
        headers: { Authorization: 'Basic invalid' },
      }, ENV);
      expect(res.status).toBe(401);
    });

    it('returns 401 when tenant not found', async () => {
      db.getTenantByApiKey.mockResolvedValueOnce(null);

      const res = await app.request('/api/v1/files', {
        headers: { Authorization: 'Bearer sk_live_test123' },
      }, ENV);
      expect(res.status).toBe(401);
    });
  });

  describe('GET /api/v1/files/:fileId', () => {
    it('returns file info', async () => {
      const res = await app.request(`/api/v1/files/${FILE_ID}`, {
        headers: { Authorization: 'Bearer sk_live_test123' },
      }, ENV);

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.id).toBe(FILE_ID);
      expect(body.originalName).toBe('photo.png');
    });

    it('returns 404 when file not found', async () => {
      db.getFileById.mockResolvedValueOnce(null);

      const res = await app.request(`/api/v1/files/${FILE_ID}`, {
        headers: { Authorization: 'Bearer sk_live_test123' },
      }, ENV);
      expect(res.status).toBe(404);
    });

    it('scopes file lookup to tenant', async () => {
      await app.request(`/api/v1/files/${FILE_ID}`, {
        headers: { Authorization: 'Bearer sk_live_test123' },
      }, ENV);

      expect(db.getFileById).toHaveBeenCalledWith(FILE_ID, TENANT_ID);
    });
  });

  describe('GET /api/v1/files/:fileId/download (cross-origin embedding)', () => {
    it('responds with CORS + CORP headers so browsers can embed the file cross-origin', async () => {
      const expiresAt = Date.now() + 60_000;
      const token = await generateSignedToken(FILE_ID, TENANT_ID, expiresAt, ENV.URL_SIGNING_SECRET);

      const res = await app.request(
        `/api/v1/files/${FILE_ID}/download?token=${token}&expires=${expiresAt}&tid=${TENANT_ID}`,
        { method: 'GET' },
        ENV,
      );

      expect(res.status).toBe(200);
      expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*');
      expect(res.headers.get('Cross-Origin-Resource-Policy')).toBe('cross-origin');
      expect(res.headers.get('Accept-Ranges')).toBe('bytes');
      const expose = res.headers.get('Access-Control-Expose-Headers') ?? '';
      expect(expose).toContain('Content-Length');
      expect(expose).toContain('Accept-Ranges');
    });

    it('returns 200 and RFC 6266 Content-Disposition for non-ASCII filenames', async () => {
      const expiresAt = Date.now() + 60_000;
      const token = await generateSignedToken(FILE_ID, TENANT_ID, expiresAt, ENV.URL_SIGNING_SECRET);
      // NFD-decomposed "ü" (u + U+0308 combining diaeresis): the exact prod failure mode.
      const decomposedName = 'Rechnung für Test.pdf';
      db.getFileById.mockResolvedValueOnce({ ...mockFile, originalName: decomposedName });

      const res = await app.request(
        `/api/v1/files/${FILE_ID}/download?token=${token}&expires=${expiresAt}&tid=${TENANT_ID}`,
        { method: 'GET' },
        ENV,
      );

      expect(res.status).toBe(200);
      const cd = res.headers.get('Content-Disposition') ?? '';
      expect(cd).toContain('filename="Rechnung fu_r Test.pdf"');
      expect(cd).toContain("filename*=UTF-8''Rechnung%20fu%CC%88r%20Test.pdf");
    });

    it('OPTIONS preflight succeeds with CORS allow headers', async () => {
      const res = await app.request(
        `/api/v1/files/${FILE_ID}/download`,
        {
          method: 'OPTIONS',
          headers: {
            Origin: 'http://localhost:3010',
            'Access-Control-Request-Method': 'GET',
            'Access-Control-Request-Headers': 'Range',
          },
        },
        ENV,
      );

      expect(res.status).toBeLessThan(400);
      expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*');
      const allowMethods = res.headers.get('Access-Control-Allow-Methods') ?? '';
      expect(allowMethods).toContain('GET');
      const allowHeaders = res.headers.get('Access-Control-Allow-Headers') ?? '';
      expect(allowHeaders.toLowerCase()).toContain('range');
    });
  });

  describe('DELETE /api/v1/files/:fileId', () => {
    it('soft deletes a file', async () => {
      const res = await app.request(`/api/v1/files/${FILE_ID}`, {
        method: 'DELETE',
        headers: { Authorization: 'Bearer sk_live_test123' },
      }, ENV);

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.success).toBe(true);
      expect(db.softDeleteFile).toHaveBeenCalledWith(FILE_ID, TENANT_ID);
    });

    it('returns 404 if file not found', async () => {
      db.getFileById.mockResolvedValueOnce(null);

      const res = await app.request(`/api/v1/files/${FILE_ID}`, {
        method: 'DELETE',
        headers: { Authorization: 'Bearer sk_live_test123' },
      }, ENV);
      expect(res.status).toBe(404);
    });
  });
});
