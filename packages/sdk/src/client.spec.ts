import { describe, it, expect, vi, beforeEach } from 'vitest';
import { StorageBrain } from './client';
import { StorageBrainError, NetworkError } from './errors';

// Mock global fetch
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

function jsonResponse(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function errorResponse(status: number, code: string, message: string) {
  return new Response(JSON.stringify({ error: { code, message } }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('StorageBrain SDK', () => {
  let client: StorageBrain;

  beforeEach(() => {
    mockFetch.mockReset();
    client = new StorageBrain({
      apiKey: 'sk_live_test123',
      baseUrl: 'https://api.example.com',
      maxRetries: 1,
      timeout: 5000,
    });
  });

  describe('constructor', () => {
    it('throws if apiKey is empty', () => {
      expect(() => new StorageBrain({ apiKey: '' })).toThrow(StorageBrainError);
    });

    it('strips trailing slash from baseUrl', () => {
      const c = new StorageBrain({ apiKey: 'sk_live_x', baseUrl: 'https://api.example.com/' });
      // Access internal via getFile call — the URL should not have double slashes
      mockFetch.mockResolvedValueOnce(jsonResponse({ id: 'abc' }));
      c.getFile('abc');
      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.example.com/api/v1/files/abc',
        expect.anything()
      );
    });
  });

  describe('withWorkspace', () => {
    it('returns a new instance scoped to the workspace', async () => {
      const scoped = client.withWorkspace('ws-123');
      mockFetch.mockResolvedValueOnce(jsonResponse({ id: 'f1' }));
      await scoped.getFile('f1');

      const call = mockFetch.mock.calls[0]!;
      const headers = call[1].headers;
      expect(headers['X-Workspace-Id']).toBe('ws-123');
    });
  });

  describe('getFile', () => {
    it('makes GET request with auth header', async () => {
      const fileData = { id: 'file-1', originalName: 'test.png' };
      mockFetch.mockResolvedValueOnce(jsonResponse(fileData));

      const result = await client.getFile('file-1');

      expect(result).toEqual(fileData);
      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.example.com/api/v1/files/file-1',
        expect.objectContaining({
          method: 'GET',
          headers: expect.objectContaining({
            Authorization: 'Bearer sk_live_test123',
          }),
        })
      );
    });

    it('throws on 404', async () => {
      mockFetch.mockResolvedValueOnce(
        errorResponse(404, 'FILE_NOT_FOUND', 'File not found')
      );

      await expect(client.getFile('missing')).rejects.toThrow();
    });

    it('throws on 401', async () => {
      mockFetch.mockResolvedValueOnce(
        errorResponse(401, 'UNAUTHORIZED', 'Invalid API key')
      );

      await expect(client.getFile('f1')).rejects.toThrow();
    });
  });

  describe('listFiles', () => {
    it('makes GET request with query params', async () => {
      const listData = { files: [], nextCursor: null, total: 0 };
      mockFetch.mockResolvedValueOnce(jsonResponse(listData));

      const result = await client.listFiles({ limit: 10, context: 'app' });

      expect(result).toEqual(listData);
      const url = mockFetch.mock.calls[0]![0] as string;
      expect(url).toContain('limit=10');
      expect(url).toContain('context=app');
    });

    it('includes workspaceId from client default', async () => {
      const scoped = client.withWorkspace('ws-1');
      mockFetch.mockResolvedValueOnce(jsonResponse({ files: [], nextCursor: null, total: 0 }));

      await scoped.listFiles();

      const url = mockFetch.mock.calls[0]![0] as string;
      expect(url).toContain('workspaceId=ws-1');
    });

    it('per-call workspaceId overrides client default', async () => {
      const scoped = client.withWorkspace('ws-default');
      mockFetch.mockResolvedValueOnce(jsonResponse({ files: [], nextCursor: null, total: 0 }));

      await scoped.listFiles({ workspaceId: 'ws-override' });

      const url = mockFetch.mock.calls[0]![0] as string;
      expect(url).toContain('workspaceId=ws-override');
    });
  });

  describe('deleteFile', () => {
    it('makes DELETE request', async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse({ success: true }));

      await client.deleteFile('file-1');

      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.example.com/api/v1/files/file-1',
        expect.objectContaining({ method: 'DELETE' })
      );
    });
  });

  describe('getSignedUrl', () => {
    it('passes expiresIn parameter', async () => {
      mockFetch.mockResolvedValueOnce(
        jsonResponse({ fileId: 'f1', url: 'https://...', expiresAt: '2024-01-01', expiresIn: 7200 })
      );

      await client.getSignedUrl('f1', 7200);

      const url = mockFetch.mock.calls[0]![0] as string;
      expect(url).toContain('expiresIn=7200');
    });

    it('defaults expiresIn to 3600', async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse({ fileId: 'f1', url: 'https://...' }));

      await client.getSignedUrl('f1');

      const url = mockFetch.mock.calls[0]![0] as string;
      expect(url).toContain('expiresIn=3600');
    });
  });

  describe('getPermanentUrl', () => {
    it('GETs the permanent-url endpoint with auth header', async () => {
      const response = {
        fileId: 'f1',
        url: 'https://api.example.com/api/v1/files/f1/download?token=abc&expires=0&tid=t1',
      };
      mockFetch.mockResolvedValueOnce(jsonResponse(response));

      const result = await client.getPermanentUrl('f1');

      expect(result).toEqual(response);
      const url = mockFetch.mock.calls[0]![0] as string;
      expect(url).toBe('https://api.example.com/api/v1/files/f1/permanent-url');
      expect(mockFetch).toHaveBeenCalledWith(
        url,
        expect.objectContaining({ method: 'GET' }),
      );
    });

    it('throws on 404', async () => {
      mockFetch.mockResolvedValueOnce(
        errorResponse(404, 'FILE_NOT_FOUND', 'File not found'),
      );

      await expect(client.getPermanentUrl('missing')).rejects.toThrow();
    });
  });

  describe('getQuota', () => {
    it('returns quota info', async () => {
      const quota = { quotaBytes: 500000, usedBytes: 1000, availableBytes: 499000, usagePercent: 0 };
      mockFetch.mockResolvedValueOnce(jsonResponse(quota));

      const result = await client.getQuota();
      expect(result).toEqual(quota);
    });
  });

  describe('getTenantInfo', () => {
    it('returns tenant info', async () => {
      const info = { id: 't1', name: 'Test', allowedFileTypes: null, createdAt: '2024-01-01' };
      mockFetch.mockResolvedValueOnce(jsonResponse(info));

      const result = await client.getTenantInfo();
      expect(result).toEqual(info);
    });
  });

  describe('workspace methods', () => {
    it('createWorkspace sends POST', async () => {
      const ws = { id: 'ws1', name: 'Test', slug: 'test' };
      mockFetch.mockResolvedValueOnce(jsonResponse(ws, 201));

      const result = await client.createWorkspace({ name: 'Test', slug: 'test' });
      expect(result).toEqual(ws);
      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.example.com/api/v1/workspaces',
        expect.objectContaining({ method: 'POST' })
      );
    });

    it('listWorkspaces returns workspaces array', async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse({ workspaces: [{ id: 'ws1' }] }));

      const result = await client.listWorkspaces();
      expect(result).toEqual([{ id: 'ws1' }]);
    });

    it('getWorkspace sends GET with id', async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse({ id: 'ws1' }));

      await client.getWorkspace('ws1');
      const url = mockFetch.mock.calls[0]![0] as string;
      expect(url).toContain('/workspaces/ws1');
    });

    it('updateWorkspace sends PATCH', async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse({ id: 'ws1', name: 'Updated' }));

      await client.updateWorkspace('ws1', { name: 'Updated' });
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/workspaces/ws1'),
        expect.objectContaining({ method: 'PATCH' })
      );
    });

    it('deleteWorkspace sends DELETE', async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse({ success: true }));

      await client.deleteWorkspace('ws1');
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/workspaces/ws1'),
        expect.objectContaining({ method: 'DELETE' })
      );
    });
  });

  describe('retry logic', () => {
    it('throws NetworkError when single attempt fails', async () => {
      // Use maxRetries: 1 to avoid actual delay
      const retryClient = new StorageBrain({
        apiKey: 'sk_live_test',
        baseUrl: 'https://api.example.com',
        maxRetries: 1,
        timeout: 5000,
      });

      mockFetch.mockRejectedValueOnce(new Error('connection refused'));

      await expect(retryClient.getFile('f1')).rejects.toThrow(NetworkError);
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });
  });
});
