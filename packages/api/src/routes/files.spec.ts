import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createApp } from '../app';
import { generateSignedToken, generatePermanentToken, verifyPermanentToken } from '../services/signed-url';
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
  keyPrefix: 'sk_live_test',
  authWorkspaceId: null,
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
    renameFile: vi.fn().mockResolvedValue(mockFile),
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
    aggregateFileContexts: vi.fn().mockResolvedValue([]),
    migrate: vi.fn(),
  };
}

function createMockStorage() {
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

interface TestResponseBody {
  success?: boolean;
  fileId?: string;
  id?: string;
  originalName?: string;
  url?: string;
  total?: number;
  files?: Array<Record<string, unknown>>;
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
      const body: TestResponseBody = await res.json();
      expect(body.files).toHaveLength(1);
      expect(body.files?.[0]?.id).toBe(FILE_ID);
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

  describe('GET /api/v1/files/contexts', () => {
    it('returns the context aggregate for the authenticated tenant', async () => {
      db.aggregateFileContexts.mockResolvedValueOnce([
        { context: 'story-audio', fileCount: 3, totalBytes: 9000 },
        { context: 'default', fileCount: 1, totalBytes: 10 },
      ]);

      const res = await app.request('/api/v1/files/contexts', {
        headers: { Authorization: 'Bearer sk_live_test123' },
      }, ENV);

      expect(res.status).toBe(200);
      const body = await res.json<{ contexts?: Array<{ context: string }> }>();
      expect(body.contexts).toHaveLength(2);
      expect(body.contexts?.[0]?.context).toBe('story-audio');
      // Tenant-scoped: aggregate is called with the authenticated tenant's id.
      expect(db.aggregateFileContexts).toHaveBeenCalledWith(TENANT_ID, undefined);
    });

    it('passes the workspaceId filter through', async () => {
      const WS = '770e8400-e29b-41d4-a716-446655440000';
      db.aggregateFileContexts.mockResolvedValueOnce([]);

      const res = await app.request(`/api/v1/files/contexts?workspaceId=${WS}`, {
        headers: { Authorization: 'Bearer sk_live_test123' },
      }, ENV);

      expect(res.status).toBe(200);
      expect(db.aggregateFileContexts).toHaveBeenCalledWith(TENANT_ID, WS);
    });

    it('rejects a non-uuid workspaceId with 400', async () => {
      const res = await app.request('/api/v1/files/contexts?workspaceId=not-a-uuid', {
        headers: { Authorization: 'Bearer sk_live_test123' },
      }, ENV);

      expect(res.status).toBe(400);
    });

    it('returns 401 without auth header', async () => {
      const res = await app.request('/api/v1/files/contexts', {}, ENV);
      expect(res.status).toBe(401);
    });
  });

  describe('GET /api/v1/files/:fileId', () => {
    it('returns file info', async () => {
      const res = await app.request(`/api/v1/files/${FILE_ID}`, {
        headers: { Authorization: 'Bearer sk_live_test123' },
      }, ENV);

      expect(res.status).toBe(200);
      const body: TestResponseBody = await res.json();
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

  describe('PATCH /api/v1/files/:fileId', () => {
    it('renames the file and returns the updated file info', async () => {
      const renamed = { ...mockFile, originalName: 'voice-sample_max-mustermann_2026-07-08_ab12.webm' };
      db.renameFile.mockResolvedValueOnce(renamed);

      const res = await app.request(
        `/api/v1/files/${FILE_ID}`,
        {
          method: 'PATCH',
          headers: {
            Authorization: 'Bearer sk_live_test123',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ originalName: 'voice-sample_max-mustermann_2026-07-08_ab12.webm' }),
        },
        ENV,
      );

      expect(res.status).toBe(200);
      const body: TestResponseBody = await res.json();
      expect(body.originalName).toBe('voice-sample_max-mustermann_2026-07-08_ab12.webm');
      expect(db.renameFile).toHaveBeenCalledWith(
        FILE_ID,
        TENANT_ID,
        'voice-sample_max-mustermann_2026-07-08_ab12.webm',
      );
    });

    it('never touches the storage adapter (metadata-only rename)', async () => {
      await app.request(
        `/api/v1/files/${FILE_ID}`,
        {
          method: 'PATCH',
          headers: {
            Authorization: 'Bearer sk_live_test123',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ originalName: 'renamed.png' }),
        },
        ENV,
      );

      expect(storage.put).not.toHaveBeenCalled();
      expect(storage.delete).not.toHaveBeenCalled();
    });

    it('returns 404 when the file does not exist for this tenant', async () => {
      db.renameFile.mockResolvedValueOnce(null);

      const res = await app.request(
        `/api/v1/files/${FILE_ID}`,
        {
          method: 'PATCH',
          headers: {
            Authorization: 'Bearer sk_live_test123',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ originalName: 'renamed.png' }),
        },
        ENV,
      );

      expect(res.status).toBe(404);
    });

    it('rejects an empty originalName with 400', async () => {
      const res = await app.request(
        `/api/v1/files/${FILE_ID}`,
        {
          method: 'PATCH',
          headers: {
            Authorization: 'Bearer sk_live_test123',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ originalName: '' }),
        },
        ENV,
      );

      expect(res.status).toBe(400);
      expect(db.renameFile).not.toHaveBeenCalled();
    });

    it('rejects a name with a path separator with 400', async () => {
      const res = await app.request(
        `/api/v1/files/${FILE_ID}`,
        {
          method: 'PATCH',
          headers: {
            Authorization: 'Bearer sk_live_test123',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ originalName: '../etc/passwd' }),
        },
        ENV,
      );

      expect(res.status).toBe(400);
      expect(db.renameFile).not.toHaveBeenCalled();
    });

    it('rejects a malformed file id with 400', async () => {
      const res = await app.request(
        '/api/v1/files/not-a-uuid',
        {
          method: 'PATCH',
          headers: {
            Authorization: 'Bearer sk_live_test123',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ originalName: 'renamed.png' }),
        },
        ENV,
      );

      expect(res.status).toBe(400);
    });

    it('returns 401 without auth header', async () => {
      const res = await app.request(
        `/api/v1/files/${FILE_ID}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ originalName: 'renamed.png' }),
        },
        ENV,
      );
      expect(res.status).toBe(401);
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

  describe('GET /api/v1/files/:fileId/permanent-url', () => {
    it('returns a permanent download URL with token, expires=0, and tid', async () => {
      const res = await app.request(
        `/api/v1/files/${FILE_ID}/permanent-url`,
        { headers: { Authorization: 'Bearer sk_live_test123' } },
        ENV,
      );

      expect(res.status).toBe(200);
      const body: { fileId: string; url: string } = await res.json();
      expect(body.fileId).toBe(FILE_ID);

      const u = new URL(body.url);
      expect(u.pathname).toBe(`/api/v1/files/${FILE_ID}/download`);
      expect(u.searchParams.get('expires')).toBe('0');
      expect(u.searchParams.get('tid')).toBe(TENANT_ID);
      const token = u.searchParams.get('token');
      expect(token).toMatch(/^[0-9a-f]{64}$/);

      // Token must verify against the same secret + ids
      const valid = await verifyPermanentToken(FILE_ID, TENANT_ID, token!, ENV.URL_SIGNING_SECRET);
      expect(valid).toBe(true);
    });

    it('uses PUBLIC_BASE_URL when configured (no internal hostname leak)', async () => {
      const envWithBase = { ...ENV, PUBLIC_BASE_URL: 'https://files.example.com' };

      const res = await app.request(
        `/api/v1/files/${FILE_ID}/permanent-url`,
        { headers: { Authorization: 'Bearer sk_live_test123' } },
        envWithBase,
      );

      expect(res.status).toBe(200);
      const body: { url: string } = await res.json();
      expect(body.url.startsWith('https://files.example.com/api/v1/files/')).toBe(true);
    });

    it('returns 401 without auth header', async () => {
      const res = await app.request(`/api/v1/files/${FILE_ID}/permanent-url`, {}, ENV);
      expect(res.status).toBe(401);
    });

    it('returns 404 when file not found', async () => {
      db.getFileById.mockResolvedValueOnce(null);

      const res = await app.request(
        `/api/v1/files/${FILE_ID}/permanent-url`,
        { headers: { Authorization: 'Bearer sk_live_test123' } },
        ENV,
      );
      expect(res.status).toBe(404);
    });

    it('scopes file lookup to the tenant (cross-tenant access denied)', async () => {
      await app.request(
        `/api/v1/files/${FILE_ID}/permanent-url`,
        { headers: { Authorization: 'Bearer sk_live_test123' } },
        ENV,
      );

      expect(db.getFileById).toHaveBeenCalledWith(FILE_ID, TENANT_ID);
    });
  });

  describe('GET /api/v1/files/:fileId/download (permanent-token path)', () => {
    it('serves the file when the permanent token is valid', async () => {
      const token = await generatePermanentToken(FILE_ID, TENANT_ID, ENV.URL_SIGNING_SECRET);

      const res = await app.request(
        `/api/v1/files/${FILE_ID}/download?token=${token}&expires=0&tid=${TENANT_ID}`,
        { method: 'GET' },
        ENV,
      );

      expect(res.status).toBe(200);
      expect(res.headers.get('Content-Type')).toBe('image/png');
    });

    it('serves the file when expires is omitted entirely', async () => {
      // expires=0 OR expires absent both signal "permanent" mode.
      const token = await generatePermanentToken(FILE_ID, TENANT_ID, ENV.URL_SIGNING_SECRET);

      const res = await app.request(
        `/api/v1/files/${FILE_ID}/download?token=${token}&tid=${TENANT_ID}`,
        { method: 'GET' },
        ENV,
      );

      expect(res.status).toBe(200);
    });

    it('returns 401 when the permanent token is wrong', async () => {
      const wrongToken = 'a'.repeat(64);

      const res = await app.request(
        `/api/v1/files/${FILE_ID}/download?token=${wrongToken}&expires=0&tid=${TENANT_ID}`,
        { method: 'GET' },
        ENV,
      );

      expect(res.status).toBe(401);
    });

    it('returns 401 when tid is missing', async () => {
      const token = await generatePermanentToken(FILE_ID, TENANT_ID, ENV.URL_SIGNING_SECRET);

      const res = await app.request(
        `/api/v1/files/${FILE_ID}/download?token=${token}&expires=0`,
        { method: 'GET' },
        ENV,
      );

      expect(res.status).toBe(401);
    });

    it('returns 401 after secret rotation (revocation)', async () => {
      const token = await generatePermanentToken(FILE_ID, TENANT_ID, ENV.URL_SIGNING_SECRET);

      const rotatedEnv = { ...ENV, URL_SIGNING_SECRET: 'rotated-secret' };
      const res = await app.request(
        `/api/v1/files/${FILE_ID}/download?token=${token}&expires=0&tid=${TENANT_ID}`,
        { method: 'GET' },
        rotatedEnv,
      );

      expect(res.status).toBe(401);
    });

    it('returns 404 when file not found (cross-tenant denial)', async () => {
      // Token is valid for OTHER_TENANT, but DB lookup is scoped to that tenant
      // and finds nothing (defense in depth).
      const OTHER_TENANT = '770e8400-e29b-41d4-a716-446655440099';
      const token = await generatePermanentToken(FILE_ID, OTHER_TENANT, ENV.URL_SIGNING_SECRET);
      db.getFileById.mockResolvedValueOnce(null);

      const res = await app.request(
        `/api/v1/files/${FILE_ID}/download?token=${token}&expires=0&tid=${OTHER_TENANT}`,
        { method: 'GET' },
        ENV,
      );

      expect(res.status).toBe(404);
    });

    it('still serves time-limited signed URLs (backward compat)', async () => {
      // The existing expires=<timestamp> path must keep working unchanged.
      const expiresAt = Date.now() + 60_000;
      const token = await generateSignedToken(FILE_ID, TENANT_ID, expiresAt, ENV.URL_SIGNING_SECRET);

      const res = await app.request(
        `/api/v1/files/${FILE_ID}/download?token=${token}&expires=${expiresAt}&tid=${TENANT_ID}`,
        { method: 'GET' },
        ENV,
      );

      expect(res.status).toBe(200);
    });
  });

  describe('DELETE /api/v1/files/:fileId', () => {
    it('soft deletes a file', async () => {
      const res = await app.request(`/api/v1/files/${FILE_ID}`, {
        method: 'DELETE',
        headers: { Authorization: 'Bearer sk_live_test123' },
      }, ENV);

      expect(res.status).toBe(200);
      const body: TestResponseBody = await res.json();
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
