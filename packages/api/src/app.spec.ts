import { describe, it, expect, vi } from 'vitest';
import { createApp } from './app';
import type { StorageAdapter, DatabaseAdapter } from '@storage-brain/shared';

const ENV = {
  ENVIRONMENT: 'development' as const,
  URL_SIGNING_SECRET: 'test-secret',
  DB: {} as never,
  BUCKET: {} as never,
};

function createMockDb(): DatabaseAdapter {
  return {
    createTenant: vi.fn(),
    getTenantByApiKey: vi.fn(),
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
    getQuotaUsage: vi.fn(),
    recalculateQuota: vi.fn(),
    checkWorkspaceQuota: vi.fn(),
    reserveWorkspaceQuota: vi.fn(),
    releaseWorkspaceQuota: vi.fn(),
    migrate: vi.fn(),
  } as unknown as DatabaseAdapter;
}

function createMockStorage(): StorageAdapter {
  return { put: vi.fn(), get: vi.fn(), delete: vi.fn(), exists: vi.fn(), head: vi.fn() };
}

interface TestResponseBody {
  status?: string;
  timestamp?: string;
  environment?: string;
  error?: { code?: string; message?: string };
}

describe('app', () => {
  const app = createApp({
    db: createMockDb(),
    storage: createMockStorage(),
  });

  describe('GET /health', () => {
    it('returns status ok', async () => {
      const res = await app.request('/health', {}, ENV);
      expect(res.status).toBe(200);

      const body = await res.json<TestResponseBody>();
      expect(body.status).toBe('ok');
      expect(body.timestamp).toBeDefined();
      expect(body.environment).toBe('development');
    });
  });

  describe('404 handler', () => {
    it('returns 404 for unknown routes', async () => {
      const res = await app.request('/unknown/path', {}, ENV);
      expect(res.status).toBe(404);

      const body = await res.json<TestResponseBody>();
      expect(body.error?.code).toBe('NOT_FOUND');
      expect(body.error?.message).toContain('GET');
    });
  });
});
