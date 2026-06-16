import { describe, it, expect, vi, beforeEach } from 'vitest';

const { verifySession, can, cookieGet, getSessionMock, authBrainClientMock } = vi.hoisted(
  () => {
    const verifySessionFn = vi.fn();
    const canFn = vi.fn();
    return {
      verifySession: verifySessionFn,
      can: canFn,
      cookieGet: vi.fn(),
      getSessionMock: vi.fn(),
      authBrainClientMock: { verifySession: verifySessionFn, can: canFn },
    };
  }
);

vi.mock('next/headers', () => ({
  cookies: () => Promise.resolve({ get: cookieGet }),
}));

vi.mock('./auth-brain', () => ({
  getAuthBrainClient: () => authBrainClientMock,
}));

vi.mock('./session', () => ({
  getSession: getSessionMock,
}));

import { getDashboardSession } from './dashboard-auth';

const LUMITRA = { value: 'lumitra-cookie-value' };

beforeEach(() => {
  vi.clearAllMocks();
  // Default: no cookies, no legacy session.
  cookieGet.mockReturnValue(undefined);
  getSessionMock.mockResolvedValue({});
});

describe('getDashboardSession', () => {
  it('valid lumitra session + platform admin -> auth-brain mode', async () => {
    cookieGet.mockReturnValue(LUMITRA);
    verifySession.mockResolvedValue({ user: { id: 'user-1', email: 'a@b.c' } });
    can.mockResolvedValue(true);

    const result = await getDashboardSession();

    expect(result).toEqual({
      mode: 'auth-brain',
      user: { id: 'user-1', email: 'a@b.c' },
    });
    expect(can).toHaveBeenCalledWith('user-1', 'platform.admin', expect.any(Object));
  });

  it('valid session but can()=false -> unauthorized (null), never legacy', async () => {
    cookieGet.mockReturnValue(LUMITRA);
    verifySession.mockResolvedValue({ user: { id: 'user-1' } });
    can.mockResolvedValue(false);
    // Even if a legacy session exists, an authenticated-but-unauthorized user
    // must NOT be silently allowed in.
    getSessionMock.mockResolvedValue({ adminApiKey: 'legacy-key' });

    const result = await getDashboardSession();

    expect(result).toBeNull();
    expect(can).toHaveBeenCalledTimes(1);
  });

  it('no auth-brain cookie but valid iron-session -> legacy mode', async () => {
    cookieGet.mockReturnValue(undefined);
    getSessionMock.mockResolvedValue({ adminApiKey: 'legacy-key', baseUrl: 'https://api' });

    const result = await getDashboardSession();

    expect(result).toEqual({
      mode: 'legacy',
      adminApiKey: 'legacy-key',
      baseUrl: 'https://api',
    });
    expect(verifySession).not.toHaveBeenCalled();
  });

  it('neither auth-brain nor legacy -> null', async () => {
    const result = await getDashboardSession();
    expect(result).toBeNull();
  });

  it('fail-closed: verifySession throws -> unauthorized (null)', async () => {
    cookieGet.mockReturnValue(LUMITRA);
    verifySession.mockRejectedValue(new Error('network/timeout'));
    getSessionMock.mockResolvedValue({ adminApiKey: 'legacy-key' });

    const result = await getDashboardSession();

    expect(result).toBeNull();
  });

  it('fail-closed: can() throws -> unauthorized (null)', async () => {
    cookieGet.mockReturnValue(LUMITRA);
    verifySession.mockResolvedValue({ user: { id: 'user-1' } });
    can.mockRejectedValue(new Error('openfga timeout'));

    const result = await getDashboardSession();

    expect(result).toBeNull();
  });

  it('lumitra cookie present but session invalid -> null, no legacy fallthrough', async () => {
    cookieGet.mockReturnValue(LUMITRA);
    verifySession.mockResolvedValue(null);
    getSessionMock.mockResolvedValue({ adminApiKey: 'legacy-key' });

    const result = await getDashboardSession();

    expect(result).toBeNull();
    expect(can).not.toHaveBeenCalled();
  });
});
