import { describe, it, expect, vi, beforeEach } from 'vitest';

const { getAdmin } = vi.hoisted(() => ({ getAdmin: vi.fn() }));

vi.mock('@/lib/sdk', () => ({ getAdmin }));

vi.mock('next/server', () => ({
  NextResponse: {
    json: (body: unknown, init?: { status?: number }) => ({
      status: init?.status ?? 200,
      json: () => Promise.resolve(body),
    }),
  },
}));

import { GET } from './route';

function makeRequest(search = '') {
  return {
    nextUrl: { searchParams: new URLSearchParams(search) },
  } as unknown as Parameters<typeof GET>[0];
}

function makeParams(id: string) {
  return { params: Promise.resolve({ id }) };
}

const contexts = [
  { context: 'story-audio', fileCount: 340, totalBytes: 123456 },
  { context: 'default', fileCount: 2, totalBytes: 20 },
];

describe('GET /api/tenants/[id]/files/contexts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 401 when not authenticated', async () => {
    getAdmin.mockRejectedValueOnce(new Error('Not authenticated'));

    const res = await GET(makeRequest(), makeParams('t1'));

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: 'Not authenticated' });
  });

  it('forwards the aggregate without a workspace filter', async () => {
    const listFileContexts = vi.fn().mockResolvedValue({ contexts });
    getAdmin.mockResolvedValueOnce({ listFileContexts });

    const res = await GET(makeRequest(), makeParams('t1'));

    expect(listFileContexts).toHaveBeenCalledWith('t1', undefined);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ contexts });
  });

  it('passes the workspaceId query through to the SDK', async () => {
    const listFileContexts = vi.fn().mockResolvedValue({ contexts: [] });
    getAdmin.mockResolvedValueOnce({ listFileContexts });

    const res = await GET(makeRequest('workspaceId=ws-1'), makeParams('t1'));

    expect(listFileContexts).toHaveBeenCalledWith('t1', { workspaceId: 'ws-1' });
    expect(res.status).toBe(200);
  });
});
