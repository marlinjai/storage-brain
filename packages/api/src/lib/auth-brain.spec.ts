import { describe, it, expect } from 'vitest';
import { getAuthBrainClient } from './auth-brain';
import type { Env } from '../env';

// The verify transport itself now lives in @marlinjai/auth-brain-sdk
// (verifyApiKey), which the SDK tests cover. What remains local is the
// factory: it must skip auth-brain entirely when unconfigured, and hand back a
// verify-capable client (cached per base URL) when configured.

function env(overrides: Partial<Env> = {}): Env {
  return {
    ENVIRONMENT: 'development',
    URL_SIGNING_SECRET: 'secret',
    DB: {} as never,
    BUCKET: {} as never,
    ...overrides,
  };
}

describe('getAuthBrainClient', () => {
  it('returns null when AUTH_BRAIN_URL is unset (degradation: legacy keys only)', () => {
    expect(getAuthBrainClient(env())).toBeNull();
  });

  it('returns a verify-capable client when AUTH_BRAIN_URL is set', () => {
    const client = getAuthBrainClient(env({ AUTH_BRAIN_URL: 'https://auth.example' }));
    expect(client).not.toBeNull();
    expect(typeof client?.verifyApiKey).toBe('function');
  });

  it('caches the client per base URL', () => {
    const url = 'https://auth.cache-test.example';
    const a = getAuthBrainClient(env({ AUTH_BRAIN_URL: url }));
    const b = getAuthBrainClient(env({ AUTH_BRAIN_URL: url }));
    expect(a).toBe(b);
  });
});
