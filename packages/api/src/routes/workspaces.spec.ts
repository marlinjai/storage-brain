import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createApp } from '../app';
import type { StorageAdapter, DatabaseAdapter, Tenant, Workspace } from '@storage-brain/shared';

const TENANT_ID = '550e8400-e29b-41d4-a716-446655440000';
const WORKSPACE_ID = '770e8400-e29b-41d4-a716-446655440000';

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
  usedBytes: 0,
  allowedFileTypes: null,
  createdAt: Date.now(),
  updatedAt: Date.now(),
};

const mockWorkspace: Workspace = {
  id: WORKSPACE_ID,
  tenantId: TENANT_ID,
  name: 'My Workspace',
  slug: 'my-workspace',
  quotaBytes: null,
  usedBytes: 0,
  metadata: null,
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
    getFileById: vi.fn(),
    getFileByIdUnscoped: vi.fn(),
    getFileByStoredPath: vi.fn(),
    listFilesByTenant: vi.fn(),
    updateFileMetadata: vi.fn(),
    createWorkspace: vi.fn().mockResolvedValue(mockWorkspace),
    getWorkspaceById: vi.fn().mockResolvedValue(mockWorkspace),
    listWorkspacesByTenant: vi.fn().mockResolvedValue([mockWorkspace]),
    updateWorkspace: vi.fn().mockResolvedValue({ ...mockWorkspace, name: 'Updated' }),
    deleteWorkspace: vi.fn(),
    getActiveFilesByWorkspace: vi.fn().mockResolvedValue([]),
    getUploadSessionByFileId: vi.fn(),
    createPendingUpload: vi.fn().mockResolvedValue({ created: true, sessionId: 'session-1' }),
    claimUploadSession: vi.fn().mockResolvedValue(true),
    settleUploadSession: vi.fn().mockResolvedValue(true),
    expireStaleUploadSessions: vi.fn().mockResolvedValue({ scanned: 0, expired: 0 }),
    deleteFileAndReleaseQuota: vi.fn().mockResolvedValue(null),
    deleteWorkspaceFilesAndReleaseQuota: vi.fn().mockResolvedValue({ releasedBytes: 0, files: [] }),
    checkQuota: vi.fn(),
    getQuotaUsage: vi.fn(),
    recalculateQuota: vi.fn(),
    checkWorkspaceQuota: vi.fn(),
    migrate: vi.fn(),
  };
}

function createMockStorage() {
  return { put: vi.fn(), get: vi.fn(), delete: vi.fn(), exists: vi.fn(), head: vi.fn() };
}

interface TestResponseBody {
  id?: string;
  workspaces?: Array<Record<string, unknown>>;
}

describe('workspace routes', () => {
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

  describe('GET /api/v1/workspaces', () => {
    it('lists workspaces', async () => {
      const res = await app.request(
        '/api/v1/workspaces',
        {
          headers: { Authorization: 'Bearer sk_live_test123' },
        },
        ENV
      );

      expect(res.status).toBe(200);
      const body = await res.json<TestResponseBody>();
      expect(body.workspaces).toHaveLength(1);
      expect(body.workspaces?.[0]?.id).toBe(WORKSPACE_ID);
    });
  });

  describe('POST /api/v1/workspaces', () => {
    it('creates a workspace', async () => {
      const res = await app.request(
        '/api/v1/workspaces',
        {
          method: 'POST',
          headers: {
            Authorization: 'Bearer sk_live_test123',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ name: 'My Workspace', slug: 'my-workspace' }),
        },
        ENV
      );

      expect(res.status).toBe(201);
      expect(db.createWorkspace).toHaveBeenCalledTimes(1);
    });

    it('rejects invalid slug', async () => {
      const res = await app.request(
        '/api/v1/workspaces',
        {
          method: 'POST',
          headers: {
            Authorization: 'Bearer sk_live_test123',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ name: 'Test', slug: 'INVALID_SLUG' }),
        },
        ENV
      );

      expect(res.status).toBe(400);
    });
  });

  describe('GET /api/v1/workspaces/:workspaceId', () => {
    it('returns workspace', async () => {
      const res = await app.request(
        `/api/v1/workspaces/${WORKSPACE_ID}`,
        {
          headers: { Authorization: 'Bearer sk_live_test123' },
        },
        ENV
      );

      expect(res.status).toBe(200);
      const body = await res.json<TestResponseBody>();
      expect(body.id).toBe(WORKSPACE_ID);
    });

    it('returns 404 for unknown workspace', async () => {
      db.getWorkspaceById.mockResolvedValueOnce(null);

      const res = await app.request(
        `/api/v1/workspaces/${WORKSPACE_ID}`,
        {
          headers: { Authorization: 'Bearer sk_live_test123' },
        },
        ENV
      );
      expect(res.status).toBe(404);
    });

    it('scopes lookup to tenant', async () => {
      await app.request(
        `/api/v1/workspaces/${WORKSPACE_ID}`,
        {
          headers: { Authorization: 'Bearer sk_live_test123' },
        },
        ENV
      );

      expect(db.getWorkspaceById).toHaveBeenCalledWith(WORKSPACE_ID, TENANT_ID);
    });
  });

  describe('PATCH /api/v1/workspaces/:workspaceId', () => {
    it('updates workspace', async () => {
      const res = await app.request(
        `/api/v1/workspaces/${WORKSPACE_ID}`,
        {
          method: 'PATCH',
          headers: {
            Authorization: 'Bearer sk_live_test123',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ name: 'Updated' }),
        },
        ENV
      );

      expect(res.status).toBe(200);
      expect(db.updateWorkspace).toHaveBeenCalled();
    });

    it('returns 404 if workspace does not exist', async () => {
      db.getWorkspaceById.mockResolvedValueOnce(null);

      const res = await app.request(
        `/api/v1/workspaces/${WORKSPACE_ID}`,
        {
          method: 'PATCH',
          headers: {
            Authorization: 'Bearer sk_live_test123',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ name: 'Updated' }),
        },
        ENV
      );

      expect(res.status).toBe(404);
    });
  });

  describe('DELETE /api/v1/workspaces/:workspaceId', () => {
    it('deletes workspace, deletes binaries from storage, and releases quota', async () => {
      db.deleteWorkspaceFilesAndReleaseQuota.mockResolvedValueOnce({
        releasedBytes: 800,
        files: [
          { id: 'f1', storedPath: `tenants/${TENANT_ID}/files/f1/a.png` },
          { id: 'f2', storedPath: `tenants/${TENANT_ID}/files/f2/b.pdf` },
        ],
      });

      const res = await app.request(
        `/api/v1/workspaces/${WORKSPACE_ID}`,
        {
          method: 'DELETE',
          headers: { Authorization: 'Bearer sk_live_test123' },
        },
        ENV
      );

      expect(res.status).toBe(200);
      expect(storage.delete).toHaveBeenCalledTimes(2);
      expect(storage.delete).toHaveBeenCalledWith(`tenants/${TENANT_ID}/files/f1/a.png`);
      expect(storage.delete).toHaveBeenCalledWith(`tenants/${TENANT_ID}/files/f2/b.pdf`);
      // Soft delete of every file plus the tenant + workspace release is one
      // atomic adapter call (covered by the adapter specs).
      expect(db.deleteWorkspaceFilesAndReleaseQuota).toHaveBeenCalledWith(WORKSPACE_ID, TENANT_ID);
      expect(db.deleteWorkspace).toHaveBeenCalledWith(WORKSPACE_ID, TENANT_ID);
    });

    it('removes the objects of exactly the files the atomic soft-delete selected', async () => {
      // A file stored after any earlier listing is still in the adapter's
      // result, so its object is removed too; nothing is listed separately.
      db.deleteWorkspaceFilesAndReleaseQuota.mockResolvedValueOnce({
        releasedBytes: 300,
        files: [{ id: 'late', storedPath: `tenants/${TENANT_ID}/files/late/c.bin` }],
      });

      const res = await app.request(
        `/api/v1/workspaces/${WORKSPACE_ID}`,
        {
          method: 'DELETE',
          headers: { Authorization: 'Bearer sk_live_test123' },
        },
        ENV
      );

      expect(res.status).toBe(200);
      expect(db.getActiveFilesByWorkspace).not.toHaveBeenCalled();
      expect(storage.delete).toHaveBeenCalledTimes(1);
      expect(storage.delete).toHaveBeenCalledWith(`tenants/${TENANT_ID}/files/late/c.bin`);
      // The soft-delete runs before the storage cleanup it drives.
      expect(db.deleteWorkspaceFilesAndReleaseQuota.mock.invocationCallOrder[0]).toBeLessThan(
        storage.delete.mock.invocationCallOrder[0] as number
      );
    });

    it('still deletes the workspace when a storage delete fails', async () => {
      db.deleteWorkspaceFilesAndReleaseQuota.mockResolvedValueOnce({
        releasedBytes: 500,
        files: [{ id: 'f1', storedPath: `tenants/${TENANT_ID}/files/f1/a.png` }],
      });
      storage.delete.mockRejectedValueOnce(new Error('object already gone'));
      vi.spyOn(console, 'error').mockImplementation(() => undefined);

      const res = await app.request(
        `/api/v1/workspaces/${WORKSPACE_ID}`,
        {
          method: 'DELETE',
          headers: { Authorization: 'Bearer sk_live_test123' },
        },
        ENV
      );

      expect(res.status).toBe(200);
      expect(db.deleteWorkspaceFilesAndReleaseQuota).toHaveBeenCalledWith(WORKSPACE_ID, TENANT_ID);
      expect(db.deleteWorkspace).toHaveBeenCalledWith(WORKSPACE_ID, TENANT_ID);
    });

    it('still runs the atomic release when the workspace has no files', async () => {
      // The default mock soft-deletes nothing, so there is nothing to remove.
      const res = await app.request(
        `/api/v1/workspaces/${WORKSPACE_ID}`,
        {
          method: 'DELETE',
          headers: { Authorization: 'Bearer sk_live_test123' },
        },
        ENV
      );

      expect(res.status).toBe(200);
      expect(db.deleteWorkspaceFilesAndReleaseQuota).toHaveBeenCalledWith(WORKSPACE_ID, TENANT_ID);
      expect(storage.delete).not.toHaveBeenCalled();
      expect(db.deleteWorkspace).toHaveBeenCalledWith(WORKSPACE_ID, TENANT_ID);
    });

    it('returns 404 if workspace not found', async () => {
      db.getWorkspaceById.mockResolvedValueOnce(null);

      const res = await app.request(
        `/api/v1/workspaces/${WORKSPACE_ID}`,
        {
          method: 'DELETE',
          headers: { Authorization: 'Bearer sk_live_test123' },
        },
        ENV
      );

      expect(res.status).toBe(404);
    });
  });
});
