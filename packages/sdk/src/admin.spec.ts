import { describe, it, expect, vi, beforeEach } from 'vitest';
import { StorageBrainAdmin } from './admin';
import { StorageBrainError } from './errors';

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

describe('StorageBrainAdmin SDK', () => {
  let admin: StorageBrainAdmin;

  beforeEach(() => {
    mockFetch.mockReset();
    admin = new StorageBrainAdmin({
      adminApiKey: 'admin-secret',
      baseUrl: 'https://api.example.com',
      maxRetries: 1,
    });
  });

  describe('constructor', () => {
    it('throws if adminApiKey is empty', () => {
      expect(() => new StorageBrainAdmin({ adminApiKey: '' })).toThrow(StorageBrainError);
    });

    it('strips trailing slash from baseUrl', () => {
      const a = new StorageBrainAdmin({ adminApiKey: 'key', baseUrl: 'https://api.example.com/' });
      mockFetch.mockResolvedValueOnce(jsonResponse({ tenants: [], nextCursor: null, total: 0 }));
      a.listTenants();
      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.example.com/api/v1/admin/tenants',
        expect.anything(),
      );
    });
  });

  describe('createTenant', () => {
    it('creates a tenant and returns result', async () => {
      const result = { id: 't1', name: 'Acme', apiKey: 'sk_live_abc', quotaBytes: 500, allowedFileTypes: ['image/png'] };
      mockFetch.mockResolvedValueOnce(jsonResponse(result, 201));

      const tenant = await admin.createTenant({ name: 'Acme' });

      expect(tenant.id).toBe('t1');
      expect(tenant.apiKey).toBe('sk_live_abc');
      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.example.com/api/v1/admin/tenants',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ name: 'Acme' }),
        }),
      );
    });

    it('sends Authorization header with admin key', async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse({ id: 't1' }));

      await admin.createTenant({ name: 'Test' });

      const headers = mockFetch.mock.calls[0]![1].headers;
      expect(headers.Authorization).toBe('Bearer admin-secret');
    });
  });

  describe('listTenants', () => {
    it('lists tenants without options', async () => {
      const result = { tenants: [{ id: 't1', name: 'A' }], nextCursor: null, total: 1 };
      mockFetch.mockResolvedValueOnce(jsonResponse(result));

      const response = await admin.listTenants();

      expect(response.tenants).toHaveLength(1);
      expect(response.total).toBe(1);
      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.example.com/api/v1/admin/tenants',
        expect.anything(),
      );
    });

    it('passes limit and cursor as query params', async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse({ tenants: [], nextCursor: null, total: 0 }));

      await admin.listTenants({ limit: 5, cursor: 'abc' });

      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.example.com/api/v1/admin/tenants?limit=5&cursor=abc',
        expect.anything(),
      );
    });
  });

  describe('getTenant', () => {
    it('fetches tenant by ID', async () => {
      const tenant = { id: 't1', name: 'A', quota: { quotaBytes: 500 } };
      mockFetch.mockResolvedValueOnce(jsonResponse(tenant));

      const result = await admin.getTenant('t1');

      expect(result.id).toBe('t1');
      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.example.com/api/v1/admin/tenants/t1',
        expect.objectContaining({ method: 'GET' }),
      );
    });

    it('throws on 404', async () => {
      mockFetch.mockResolvedValueOnce(errorResponse(404, 'NOT_FOUND', 'Tenant not found'));

      await expect(admin.getTenant('unknown')).rejects.toThrow();
    });
  });

  describe('updateTenant', () => {
    it('sends PATCH with updates', async () => {
      const updated = { id: 't1', name: 'Updated' };
      mockFetch.mockResolvedValueOnce(jsonResponse(updated));

      const result = await admin.updateTenant('t1', { name: 'Updated' });

      expect(result.name).toBe('Updated');
      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.example.com/api/v1/admin/tenants/t1',
        expect.objectContaining({
          method: 'PATCH',
          body: JSON.stringify({ name: 'Updated' }),
        }),
      );
    });
  });

  describe('deleteTenant', () => {
    it('deletes tenant', async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse({ success: true }));

      await expect(admin.deleteTenant('t1')).resolves.toBeUndefined();

      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.example.com/api/v1/admin/tenants/t1',
        expect.objectContaining({ method: 'DELETE' }),
      );
    });
  });

  describe('regenerateKey', () => {
    it('regenerates API key', async () => {
      const result = { tenantId: 't1', apiKey: 'sk_live_new', message: 'Regenerated' };
      mockFetch.mockResolvedValueOnce(jsonResponse(result));

      const response = await admin.regenerateKey('t1');

      expect(response.apiKey).toBe('sk_live_new');
      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.example.com/api/v1/admin/tenants/t1/regenerate-key',
        expect.objectContaining({ method: 'POST' }),
      );
    });
  });

  describe('error handling', () => {
    it('throws StorageBrainError on 401', async () => {
      mockFetch.mockResolvedValueOnce(errorResponse(401, 'UNAUTHORIZED', 'Invalid key'));

      await expect(admin.listTenants()).rejects.toThrow();
    });

    it('throws on network error', async () => {
      mockFetch.mockRejectedValueOnce(new Error('fetch failed'));

      await expect(admin.listTenants()).rejects.toThrow();
    });
  });
});
