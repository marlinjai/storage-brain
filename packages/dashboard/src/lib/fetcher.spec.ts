import { describe, it, expect, vi, afterEach } from 'vitest';
import { fetcher, FetchError } from './fetcher';

function mockFetch(status: number, body: unknown) {
  const res = {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  };
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(res));
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('fetcher', () => {
  it('returns the parsed body on 2xx', async () => {
    mockFetch(200, { tenants: [{ id: 't1' }] });
    await expect(fetcher('/api/tenants')).resolves.toEqual({
      tenants: [{ id: 't1' }],
    });
  });

  it('throws FetchError with status + server error message on 401', async () => {
    mockFetch(401, { error: 'Not authenticated' });
    const err = await fetcher('/api/tenants').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(FetchError);
    expect((err as FetchError).status).toBe(401);
    expect((err as FetchError).message).toContain('Not authenticated');
  });

  it('throws FetchError on 500 even when the body is not JSON', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        json: () => Promise.reject(new Error('not json')),
      })
    );
    const err = await fetcher('/api/tenants').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(FetchError);
    expect((err as FetchError).status).toBe(500);
  });
});
