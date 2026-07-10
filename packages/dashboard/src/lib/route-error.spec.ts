import { describe, it, expect, vi, afterEach } from 'vitest';

vi.mock('next/server', () => ({
  NextResponse: {
    json: (body: unknown, init?: { status?: number }) => ({
      status: init?.status ?? 200,
      json: () => Promise.resolve(body),
    }),
  },
}));

import { routeError } from './route-error';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('routeError', () => {
  it('maps the auth miss to 401 without logging', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = routeError(new Error('Not authenticated'), 'GET /api/tenants');
    expect((res as unknown as { status: number }).status).toBe(401);
    expect(spy).not.toHaveBeenCalled();
  });

  it('logs unexpected errors and returns 500', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const boom = new Error('Unknown scope: platform');
    const res = routeError(boom, 'GET /api/tenants');
    expect((res as unknown as { status: number }).status).toBe(500);
    expect(spy).toHaveBeenCalledWith(
      '[dashboard] GET /api/tenants failed:',
      boom
    );
  });
});
