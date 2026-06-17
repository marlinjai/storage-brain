import { describe, it, expect, vi } from 'vitest';
import { createStorageAuthBrainClient } from './auth-brain';

// These tests exercise the REAL fetch contract inside createStorageAuthBrainClient
// (the middleware tests mock the client, so they never hit these shapes). This is
// the layer where a wrong endpoint/body would pass mocked middleware tests but
// fail against live auth-brain, so it is asserted explicitly here.

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  } as unknown as Response;
}

describe('createStorageAuthBrainClient.verifyApiKey', () => {
  it('POSTs /api/verify/api-key with { api_key } in the body and no Authorization header', async () => {
    const principal = {
      type: 'service_account',
      id: 'sa-1',
      scope: { type: 'workspace', id: 'ws-1' },
      role: 'member',
    };
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, { principal }));
    const client = createStorageAuthBrainClient({ baseUrl: 'https://auth.test', fetchImpl });

    const result = await client.verifyApiKey('sk_live_abc');

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const call = fetchImpl.mock.calls[0];
    expect(call).toBeDefined();
    const url = call?.[0];
    const init = call?.[1];
    expect(url).toBe('https://auth.test/api/verify/api-key');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body)).toEqual({ api_key: 'sk_live_abc' });
    // The key goes in the body, NOT an Authorization header.
    expect(init.headers.Authorization).toBeUndefined();
    expect(result?.principal.scope).toEqual({ type: 'workspace', id: 'ws-1' });
  });

  it('returns null on 401 (bad/expired/revoked/unknown)', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(401, { error: { code: 'unauthorized' } }));
    const client = createStorageAuthBrainClient({ baseUrl: 'https://auth.test', fetchImpl });
    expect(await client.verifyApiKey('sk_live_bad')).toBeNull();
  });
});

describe('createStorageAuthBrainClient.can', () => {
  it('checks OpenFGA with a service_account subject and the workspace object', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, { allowed: true }));
    const client = createStorageAuthBrainClient({
      baseUrl: 'https://auth.test',
      openfgaUrl: 'https://fga.test',
      openfgaStoreId: 'store-1',
      fetchImpl,
    });

    const allowed = await client.can('sa-1', 'workspace.member', { workspaceId: 'ws-1' }, {
      subjectType: 'service_account',
    });

    expect(allowed).toBe(true);
    const call = fetchImpl.mock.calls[0];
    expect(call).toBeDefined();
    const url = call?.[0];
    const init = call?.[1];
    expect(url).toBe('https://fga.test/stores/store-1/check');
    expect(JSON.parse(init.body).tuple_key).toEqual({
      user: 'service_account:sa-1',
      relation: 'member',
      object: 'workspace:ws-1',
    });
  });

  it('returns false when OpenFGA says not allowed', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, { allowed: false }));
    const client = createStorageAuthBrainClient({
      baseUrl: 'https://auth.test',
      openfgaUrl: 'https://fga.test',
      openfgaStoreId: 'store-1',
      fetchImpl,
    });
    expect(
      await client.can('sa-1', 'workspace.member', { workspaceId: 'ws-1' }, { subjectType: 'service_account' })
    ).toBe(false);
  });
});
