import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createApp } from '../app';
import { getAuthBrainClient, type StorageAuthBrainClient } from '../lib/auth-brain';
import type { StorageAdapter, DatabaseAdapter, Tenant, StoredFile } from '@storage-brain/shared';

// Finding 4 + cross-tenant isolation: the public-download Bearer branch now runs
// the SAME compound auth as the middleware, so auth-brain keys can download and
// a key scoped to company A cannot reach company B's files.

vi.mock('../lib/auth-brain', () => ({ getAuthBrainClient: vi.fn() }));

const TENANT_A = 'aaaa1111-e29b-41d4-a716-446655440000';
const TENANT_B = 'bbbb2222-e29b-41d4-a716-446655440000';
const COMPANY_A = 'tnt_companyA';
const FILE_A = 'ffff1111-e29b-41d4-a716-446655440001';
const FILE_B = 'ffff2222-e29b-41d4-a716-446655440002';

const ENV = {
  ENVIRONMENT: 'development' as const,
  URL_SIGNING_SECRET: 'test-secret',
  AUTH_BRAIN_URL: 'https://auth.test',
  DB: {} as never,
  BUCKET: {} as never,
};

function tenant(id: string, authTenantId: string | null): Tenant {
  return {
    id,
    name: `tenant-${id}`,
    apiKeyHash: 'hashed',
    keyPrefix: 'sk_live_test',
    authWorkspaceId: null,
    authTenantId,
    quotaBytes: 500 * 1024 * 1024,
    usedBytes: 0,
    allowedFileTypes: null,
    createdAt: 1700000000000,
    updatedAt: 1700000000000,
  };
}

function file(id: string, tenantId: string): StoredFile {
  return {
    id,
    tenantId,
    workspaceId: null,
    originalName: 'photo.png',
    storedPath: `tenants/${tenantId}/files/${id}/photo.png`,
    fileType: 'image/png',
    sizeBytes: 2048,
    context: 'uploads',
    tags: null,
    metadata: null,
    processingStatus: 'completed',
    webhookUrl: null,
    createdAt: 1700000000000,
    updatedAt: 1700000000000,
    deletedAt: null,
  };
}

// Files keyed by id, each owned by exactly one tenant. getFileById is
// tenant-scoped exactly like the real adapters, so cross-tenant reads miss.
const FILES: Record<string, StoredFile> = {
  [FILE_A]: file(FILE_A, TENANT_A),
  [FILE_B]: file(FILE_B, TENANT_B),
};

function createMockDb() {
  return {
    getTenantByApiKey: vi.fn().mockResolvedValue(null),
    getTenantByAuthWorkspaceId: vi.fn().mockResolvedValue(null),
    getTenantByAuthTenantId: vi.fn(),
    getFileById: vi.fn((fileId: string, tenantId: string) => {
      const f = FILES[fileId];
      return Promise.resolve(f && f.tenantId === tenantId ? f : null);
    }),
  };
}

function createMockStorage(): StorageAdapter {
  return {
    put: vi.fn(),
    get: vi.fn().mockResolvedValue({ body: new ReadableStream(), contentType: 'image/png', size: 2048 }),
    delete: vi.fn(),
    exists: vi.fn(),
    head: vi.fn(),
  };
}

function companyPrincipal(companyId: string, grants: string[] = ['storage']) {
  return {
    principal: {
      type: 'service_account',
      id: 'sa_1',
      scope: { type: 'tenant', id: companyId, app_grants: grants },
      role: 'member',
    },
    key: { id: 'k1', name: null, expires_at: null },
  };
}

describe('public download: auth-brain key + cross-tenant isolation', () => {
  let db: ReturnType<typeof createMockDb>;
  let client: { verifyApiKey: ReturnType<typeof vi.fn> };
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    vi.clearAllMocks();
    db = createMockDb();
    client = { verifyApiKey: vi.fn() };
    vi.mocked(getAuthBrainClient).mockReturnValue(client as unknown as StorageAuthBrainClient);
    app = createApp({ db: db as unknown as DatabaseAdapter, storage: createMockStorage() });
  });

  const AUTH = { Authorization: 'Bearer sk_live_companyAkey' };

  function download(fileId: string) {
    return app.request(`/api/v1/files/${fileId}/download`, { headers: AUTH }, ENV);
  }

  it('downloads with a company-scoped auth-brain key (finding 4 fixed)', async () => {
    client.verifyApiKey.mockResolvedValue(companyPrincipal(COMPANY_A));
    db.getTenantByAuthTenantId.mockResolvedValue(tenant(TENANT_A, COMPANY_A));

    const res = await download(FILE_A);

    expect(res.status).toBe(200);
    expect(db.getTenantByAuthTenantId).toHaveBeenCalledWith(COMPANY_A);
    expect(db.getFileById).toHaveBeenCalledWith(FILE_A, TENANT_A);
  });

  it("cannot download another company's file via the download route (404, not 200)", async () => {
    client.verifyApiKey.mockResolvedValue(companyPrincipal(COMPANY_A));
    db.getTenantByAuthTenantId.mockResolvedValue(tenant(TENANT_A, COMPANY_A));

    const res = await download(FILE_B);

    expect(res.status).toBe(404);
    // The lookup was tenant-scoped to A; B's file is invisible.
    expect(db.getFileById).toHaveBeenCalledWith(FILE_B, TENANT_A);
  });

  it("cannot read another company's file via the files metadata route (404)", async () => {
    client.verifyApiKey.mockResolvedValue(companyPrincipal(COMPANY_A));
    db.getTenantByAuthTenantId.mockResolvedValue(tenant(TENANT_A, COMPANY_A));

    const res = await app.request(`/api/v1/files/${FILE_B}`, { headers: AUTH }, ENV);

    expect(res.status).toBe(404);
    expect(db.getFileById).toHaveBeenCalledWith(FILE_B, TENANT_A);
  });

  it('a download with an ungranted company key is denied (403), never served', async () => {
    client.verifyApiKey.mockResolvedValue(companyPrincipal(COMPANY_A, ['analytics']));
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    const res = await download(FILE_A);

    expect(res.status).toBe(403);
    expect(db.getFileById).not.toHaveBeenCalled();
  });
});

// Range support. The route advertises `Accept-Ranges: bytes`, and until this was
// added it ignored `Range` and answered 200 with the whole body. Clients that
// trust the advertisement act on it: browser <video> seeking, and third-party
// video fetchers such as Meta's when it ingests a Reel.
describe('public download: byte ranges', () => {
  let db: ReturnType<typeof createMockDb>;
  let client: { verifyApiKey: ReturnType<typeof vi.fn> };
  // Held separately from the adapter so assertions do not reference an unbound
  // method off the object (eslint @typescript-eslint/unbound-method).
  let getSpy: ReturnType<typeof vi.fn>;

  const AUTH = { Authorization: 'Bearer sk_live_companyAkey' };

  function appWith(storageAdapter: StorageAdapter) {
    return createApp({ db: db as unknown as DatabaseAdapter, storage: storageAdapter });
  }

  /** A storage adapter that honours ranges, like S3 and R2 do. */
  function rangeAwareStorage(): StorageAdapter {
    getSpy = vi.fn((_key: string, range?: { start: number; end?: number }) => {
        if (!range) {
          return Promise.resolve({
            body: new ReadableStream(),
            contentType: 'image/png',
            size: 2048,
          });
        }
        const end = range.end ?? 2047;
        return Promise.resolve({
          body: new ReadableStream(),
          contentType: 'image/png',
          size: 2048,
          range: { start: range.start, end, total: 2048 },
        });
    });
    return {
      put: vi.fn(),
      get: getSpy,
      delete: vi.fn(),
      exists: vi.fn(),
      head: vi.fn(),
    } as unknown as StorageAdapter;
  }

  beforeEach(() => {
    vi.clearAllMocks();
    db = createMockDb();
    client = { verifyApiKey: vi.fn() };
    vi.mocked(getAuthBrainClient).mockReturnValue(client as unknown as StorageAuthBrainClient);
    client.verifyApiKey.mockResolvedValue(companyPrincipal(COMPANY_A));
    db.getTenantByAuthTenantId.mockResolvedValue(tenant(TENANT_A, COMPANY_A));
  });

  it('answers a ranged request with 206 and a matching Content-Range', async () => {
    const app = appWith(rangeAwareStorage());

    const res = await app.request(
      `/api/v1/files/${FILE_A}/download`,
      { headers: { ...AUTH, Range: 'bytes=0-99' } },
      ENV,
    );

    expect(res.status).toBe(206);
    expect(res.headers.get('Content-Range')).toBe('bytes 0-99/2048');
    expect(res.headers.get('Content-Length')).toBe('100');
    expect(res.headers.get('Accept-Ranges')).toBe('bytes');
    expect(getSpy).toHaveBeenCalledWith(expect.any(String), { start: 0, end: 99 });
  });

  it('serves an open-ended range to the last byte', async () => {
    const app = appWith(rangeAwareStorage());

    const res = await app.request(
      `/api/v1/files/${FILE_A}/download`,
      { headers: { ...AUTH, Range: 'bytes=2000-' } },
      ENV,
    );

    expect(res.status).toBe(206);
    expect(res.headers.get('Content-Range')).toBe('bytes 2000-2047/2048');
    expect(res.headers.get('Content-Length')).toBe('48');
  });

  it('rejects an unsatisfiable range with 416 and never reads storage', async () => {
    const app = appWith(rangeAwareStorage());

    const res = await app.request(
      `/api/v1/files/${FILE_A}/download`,
      { headers: { ...AUTH, Range: 'bytes=99999-' } },
      ENV,
    );

    expect(res.status).toBe(416);
    expect(res.headers.get('Content-Range')).toBe('bytes */2048');
    // The size comes from the database row, so this is settled before any object read.
    expect(getSpy).not.toHaveBeenCalled();
  });

  it('does NOT claim 206 when the adapter ignored the range', async () => {
    // The regression guard for the original bug: advertising a partial response
    // whose body is actually the whole object. An adapter that cannot serve
    // ranges leaves `range` unset, and the answer must be a truthful 200.
    getSpy = vi.fn().mockResolvedValue({
      body: new ReadableStream(),
      contentType: 'image/png',
      size: 2048,
    });
    const ignoringStorage = {
      put: vi.fn(),
      get: getSpy,
      delete: vi.fn(),
      exists: vi.fn(),
      head: vi.fn(),
    } as unknown as StorageAdapter;
    const app = appWith(ignoringStorage);

    const res = await app.request(
      `/api/v1/files/${FILE_A}/download`,
      { headers: { ...AUTH, Range: 'bytes=0-99' } },
      ENV,
    );

    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Range')).toBeNull();
    expect(res.headers.get('Content-Length')).toBe('2048');
  });

  it('is unchanged for a request with no Range header', async () => {
    const app = appWith(rangeAwareStorage());

    const res = await app.request(`/api/v1/files/${FILE_A}/download`, { headers: AUTH }, ENV);

    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Length')).toBe('2048');
    expect(res.headers.get('Content-Range')).toBeNull();
    expect(getSpy).toHaveBeenCalledWith(expect.any(String), undefined);
  });
});

// Caching and CORS on partial responses. Both were found reviewing the range
// change before merge, not in production.
describe('public download: partial-response headers', () => {
  let db: ReturnType<typeof createMockDb>;

  function rangeAwareStorage(): StorageAdapter {
    return {
      put: vi.fn(),
      get: vi.fn((_key: string, range?: { start: number; end?: number }) =>
        Promise.resolve({
          body: new ReadableStream(),
          contentType: 'image/png',
          size: 2048,
          ...(range ? { range: { start: range.start, end: range.end ?? 2047, total: 2048 } } : {}),
        }),
      ),
      delete: vi.fn(),
      exists: vi.fn(),
      head: vi.fn(),
    } as unknown as StorageAdapter;
  }

  beforeEach(() => {
    vi.clearAllMocks();
    db = createMockDb();
  });

  async function permanentUrlRequest(headers: Record<string, string> = {}) {
    const { generatePermanentToken } = await import('../services/signed-url');
    const tok = await generatePermanentToken(FILE_A, TENANT_A, ENV.URL_SIGNING_SECRET);
    const app = createApp({ db: db as unknown as DatabaseAdapter, storage: rangeAwareStorage() });
    return app.request(
      `/api/v1/files/${FILE_A}/download?token=${tok}&expires=0&tid=${TENANT_A}`,
      { headers },
      ENV,
    );
  }

  it('does not mark a 206 immutable, even on a permanent URL', async () => {
    // `immutable` claims the whole representation never changes. On a partial
    // response that is a lie about a slice, and a naive cache could later serve
    // the fragment as the entire file.
    const res = await permanentUrlRequest({ Range: 'bytes=0-99' });

    expect(res.status).toBe(206);
    expect(res.headers.get('Cache-Control')).not.toContain('immutable');
  });

  it('still marks a full permanent response immutable', async () => {
    const res = await permanentUrlRequest();

    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toContain('immutable');
  });

  it('exposes Content-Range on a 416 so a cross-origin caller can read the real size', async () => {
    const res = await permanentUrlRequest({ Range: 'bytes=99999-' });

    expect(res.status).toBe(416);
    expect(res.headers.get('Content-Range')).toBe('bytes */2048');
    expect(res.headers.get('Access-Control-Expose-Headers') ?? '').toContain('Content-Range');
  });
});
