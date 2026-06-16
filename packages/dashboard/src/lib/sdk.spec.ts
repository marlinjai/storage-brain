import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { getDashboardSession, StorageBrainAdmin } = vi.hoisted(() => ({
  getDashboardSession: vi.fn(),
  StorageBrainAdmin: vi.fn(),
}));

vi.mock('./dashboard-auth', () => ({ getDashboardSession }));
vi.mock('@marlinjai/storage-brain-sdk/admin', () => ({ StorageBrainAdmin }));

import { getAdmin } from './sdk';

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

describe('getAdmin', () => {
  it('auth-brain mode builds the client from server env', async () => {
    getDashboardSession.mockResolvedValue({ mode: 'auth-brain', user: { id: 'u1' } });
    process.env.STORAGE_BRAIN_ADMIN_KEY = 'env-admin-key';
    process.env.STORAGE_BRAIN_URL = 'https://api.env';

    await getAdmin();

    expect(StorageBrainAdmin).toHaveBeenCalledWith({
      adminApiKey: 'env-admin-key',
      baseUrl: 'https://api.env',
    });
  });

  it('legacy mode builds the client from the iron-session values', async () => {
    getDashboardSession.mockResolvedValue({
      mode: 'legacy',
      adminApiKey: 'session-key',
      baseUrl: 'https://api.legacy',
    });

    await getAdmin();

    expect(StorageBrainAdmin).toHaveBeenCalledWith({
      adminApiKey: 'session-key',
      baseUrl: 'https://api.legacy',
    });
  });

  it('throws "Not authenticated" when there is no session', async () => {
    getDashboardSession.mockResolvedValue(null);

    await expect(getAdmin()).rejects.toThrow('Not authenticated');
    expect(StorageBrainAdmin).not.toHaveBeenCalled();
  });

  it('auth-brain mode throws when the server admin key is not configured', async () => {
    getDashboardSession.mockResolvedValue({ mode: 'auth-brain', user: { id: 'u1' } });
    delete process.env.STORAGE_BRAIN_ADMIN_KEY;

    await expect(getAdmin()).rejects.toThrow('STORAGE_BRAIN_ADMIN_KEY is not configured');
    expect(StorageBrainAdmin).not.toHaveBeenCalled();
  });
});
