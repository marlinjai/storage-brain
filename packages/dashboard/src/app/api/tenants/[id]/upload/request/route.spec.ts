import { describe, it, expect, vi, beforeEach } from 'vitest';

const { getAdmin, getStorageBrainBaseUrl } = vi.hoisted(() => ({
  getAdmin: vi.fn(),
  getStorageBrainBaseUrl: vi.fn(),
}));

vi.mock('@/lib/sdk', () => ({ getAdmin, getStorageBrainBaseUrl }));

vi.mock('next/server', () => ({
  NextResponse: {
    json: (body: unknown, init?: { status?: number }) => ({
      status: init?.status ?? 200,
      json: () => Promise.resolve(body),
    }),
  },
}));

import { POST } from './route';

function makeRequest(body: unknown) {
  return { json: () => Promise.resolve(body) } as unknown as Request;
}

function makeParams(id: string) {
  return { params: Promise.resolve({ id }) };
}

const handshake = {
  fileId: 'file-1',
  presignedUrl: '/_internal/upload/tenants/t1/files/file-1/a.png?token=x&expires=1',
  expiresAt: '2026-06-16T00:00:00.000Z',
  uploadMetadata: { maxSizeBytes: 100 * 1024 * 1024, allowedTypes: null },
};

describe('POST /api/tenants/[id]/upload/request', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 401 when not authenticated', async () => {
    getAdmin.mockRejectedValueOnce(new Error('Not authenticated'));

    const res = await POST(makeRequest({}), makeParams('t1'));

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: 'Not authenticated' });
  });

  it('forwards the body and absolutizes the presigned URL', async () => {
    const requestTenantUpload = vi.fn().mockResolvedValue(handshake);
    getAdmin.mockResolvedValueOnce({ requestTenantUpload });
    getStorageBrainBaseUrl.mockResolvedValueOnce('https://api.example.com');

    const input = { fileName: 'a.png', fileType: 'image/png', fileSizeBytes: 1024 };
    const res = await POST(makeRequest(input), makeParams('t1'));

    expect(requestTenantUpload).toHaveBeenCalledWith('t1', input);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { presignedUrl: string; fileId: string };
    expect(body.fileId).toBe('file-1');
    expect(body.presignedUrl).toBe(`https://api.example.com${handshake.presignedUrl}`);
  });

  it('leaves an already-absolute presigned URL untouched', async () => {
    const absolute = { ...handshake, presignedUrl: 'https://r2.example.com/upload/x' };
    getAdmin.mockResolvedValueOnce({ requestTenantUpload: vi.fn().mockResolvedValue(absolute) });
    getStorageBrainBaseUrl.mockResolvedValueOnce('https://api.example.com');

    const res = await POST(makeRequest({}), makeParams('t1'));
    const body = (await res.json()) as { presignedUrl: string };
    expect(body.presignedUrl).toBe('https://r2.example.com/upload/x');
  });

  it('maps an SDK error that carries a statusCode and code', async () => {
    const err = Object.assign(new Error('File exceeds limit'), {
      statusCode: 413,
      code: 'FILE_TOO_LARGE',
    });
    getAdmin.mockResolvedValueOnce({ requestTenantUpload: vi.fn().mockRejectedValue(err) });
    getStorageBrainBaseUrl.mockResolvedValueOnce('https://api.example.com');

    const res = await POST(makeRequest({}), makeParams('t1'));

    expect(res.status).toBe(413);
    const body = (await res.json()) as { error: string; code: string };
    expect(body.code).toBe('FILE_TOO_LARGE');
    expect(body.error).toBe('File exceeds limit');
  });

  it('maps an SDK error without a statusCode using its code', async () => {
    const err = Object.assign(new Error('Storage quota exceeded'), { code: 'QUOTA_EXCEEDED' });
    getAdmin.mockResolvedValueOnce({ requestTenantUpload: vi.fn().mockRejectedValue(err) });
    getStorageBrainBaseUrl.mockResolvedValueOnce('https://api.example.com');

    const res = await POST(makeRequest({}), makeParams('t1'));

    expect(res.status).toBe(403);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe('QUOTA_EXCEEDED');
  });

  it('falls back to 500 for an unknown error', async () => {
    getAdmin.mockResolvedValueOnce({
      requestTenantUpload: vi.fn().mockRejectedValue(new Error('boom')),
    });
    getStorageBrainBaseUrl.mockResolvedValueOnce('https://api.example.com');

    const res = await POST(makeRequest({}), makeParams('t1'));
    expect(res.status).toBe(500);
  });
});
