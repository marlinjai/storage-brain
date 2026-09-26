import { describe, it, expect, beforeEach, vi, type Mock } from 'vitest';
import type { StorageAdapter } from '@storage-brain/shared';
import { D1DatabaseAdapter } from '../adapters/database/d1';
import { createApp } from '../app';
import { signErasureBody, ERASURE_SIGNATURE_HEADER } from '../lib/erasure/signature';
import { makeD1Adapter, seedFile as seedUpload } from '../test-utils/d1-sqlite';

const SECRET = 'erasure-webhook-secret';

const baseTenant = {
  apiKeyHash: 'hash',
  keyPrefix: 'sk_live_ab',
  quotaBytes: 1024 * 1024,
  allowedFileTypes: ['image/png' as const],
};

interface Harness {
  db: D1DatabaseAdapter;
  storage: StorageAdapter;
  /** The storage.delete spy, exposed typed so tests inspect it without an
   *  unbound-method reference to storage.delete. */
  deleteMock: Mock;
  app: ReturnType<typeof createApp>;
}

function makeHarness(): Harness {
  const db = makeD1Adapter();
  const deleteMock: Mock = vi.fn().mockResolvedValue(undefined);
  const storage: StorageAdapter = {
    put: vi.fn(),
    get: vi.fn(),
    delete: deleteMock,
    exists: vi.fn(),
    head: vi.fn(),
  };
  const app = createApp({ db, storage });
  return { db, storage, deleteMock, app };
}

function envWith(secret: string | undefined): Record<string, unknown> {
  return {
    ENVIRONMENT: 'development',
    URL_SIGNING_SECRET: 'url-secret',
    STORAGE_ERASURE_WEBHOOK_SECRET: secret,
    DB: {} as never,
    BUCKET: {} as never,
  };
}

async function seedFile(
  db: D1DatabaseAdapter,
  tenantId: string,
  id: string,
  opts: { workspaceId?: string; deleted?: boolean; pending?: boolean } = {}
): Promise<string> {
  const storedPath = `tenants/${tenantId}/files/${id}/${id}.png`;
  await seedUpload(
    db,
    {
      id,
      tenantId,
      originalName: `${id}.png`,
      storedPath,
      fileType: 'image/png',
      sizeBytes: 10,
      context: 'default',
      tags: null,
      workspaceId: opts.workspaceId,
    },
    { pending: opts.pending, deleted: opts.deleted }
  );
  return storedPath;
}

async function post(
  app: Harness['app'],
  env: Record<string, unknown>,
  body: string,
  sig?: string | null
): Promise<Response> {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (sig !== null && sig !== undefined) headers[ERASURE_SIGNATURE_HEADER] = sig;
  return app.request('/api/v1/internal/erasure', { method: 'POST', headers, body }, env);
}

function tenantErasedBody(fields: {
  eventId: string;
  tenantId?: string;
  workspaceIds?: string[];
}): string {
  const payload: Record<string, unknown> = {
    event_id: fields.eventId,
    kind: 'tenant.erased',
    user_id: 'user-1',
    requested_at: '2026-07-27T00:00:00.000Z',
  };
  if (fields.tenantId !== undefined) payload.tenant_id = fields.tenantId;
  if (fields.workspaceIds !== undefined) payload.workspace_ids = fields.workspaceIds;
  return JSON.stringify(payload);
}

describe('POST /api/v1/internal/erasure — signature paths', () => {
  let h: Harness;
  beforeEach(() => {
    h = makeHarness();
  });

  it('returns 500 (fail-closed) when the secret is not configured', async () => {
    const body = tenantErasedBody({ eventId: 'e-noc', tenantId: 'company-x' });
    // Even a body signed with SOME secret cannot pass when the server has none.
    const sig = await signErasureBody(body, SECRET);
    const res = await post(h.app, envWith(undefined), body, sig);
    expect(res.status).toBe(500);
    expect(h.deleteMock).not.toHaveBeenCalled();
  });

  it('returns 401 when the signature header is missing', async () => {
    const body = tenantErasedBody({ eventId: 'e-nosig', tenantId: 'company-x' });
    const res = await post(h.app, envWith(SECRET), body, null);
    expect(res.status).toBe(401);
  });

  it('returns 401 when the signature is invalid', async () => {
    const body = tenantErasedBody({ eventId: 'e-badsig', tenantId: 'company-x' });
    const res = await post(h.app, envWith(SECRET), body, 'sha256=deadbeef');
    expect(res.status).toBe(401);
  });

  it('returns 401 when the signature was made with the wrong secret', async () => {
    const body = tenantErasedBody({ eventId: 'e-wrong', tenantId: 'company-x' });
    const sig = await signErasureBody(body, 'not-the-secret');
    const res = await post(h.app, envWith(SECRET), body, sig);
    expect(res.status).toBe(401);
  });

  it('returns 400 for a signed-but-malformed body', async () => {
    const body = '{not json';
    const sig = await signErasureBody(body, SECRET);
    const res = await post(h.app, envWith(SECRET), body, sig);
    expect(res.status).toBe(400);
  });
});

describe('POST /api/v1/internal/erasure — tenant.erased cascade', () => {
  let h: Harness;

  beforeEach(async () => {
    h = makeHarness();
    // Company A: matched by auth_tenant_id. Two live files + one soft-deleted +
    // a workspace + an upload session.
    await h.db.createTenant({
      id: 'sb-A',
      name: 'Company A',
      ...baseTenant,
      authTenantId: 'company-A',
    });
    await h.db.createWorkspace({ id: 'ws-A', tenantId: 'sb-A', name: 'WS A', slug: 'ws-a' });
    // a-1's upload is still open, so it also has a pending upload session.
    await seedFile(h.db, 'sb-A', 'a-1', { workspaceId: 'ws-A', pending: true });
    await seedFile(h.db, 'sb-A', 'a-2');
    await seedFile(h.db, 'sb-A', 'a-gone', { deleted: true });

    // Company W: matched by a legacy auth_workspace_id binding only.
    await h.db.createTenant({
      id: 'sb-W',
      name: 'Company W',
      ...baseTenant,
      authWorkspaceId: 'auth-ws-legacy',
    });
    await seedFile(h.db, 'sb-W', 'w-1');

    // Company B: an unrelated bystander. Must survive untouched.
    await h.db.createTenant({
      id: 'sb-B',
      name: 'Company B',
      ...baseTenant,
      authTenantId: 'company-B',
    });
    await seedFile(h.db, 'sb-B', 'b-1');
  });

  it('deletes objects + rows for matched tenants and leaves bystanders intact', async () => {
    const body = tenantErasedBody({
      eventId: 'evt-cascade',
      tenantId: 'company-A',
      workspaceIds: ['auth-ws-legacy'],
    });
    const sig = await signErasureBody(body, SECRET);
    const res = await post(h.app, envWith(SECRET), body, sig);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: 'ok', idempotent: false });

    const deleted = h.deleteMock.mock.calls.map((c) => c[0]);
    // Every A object (incl. the soft-deleted one) and W's object deleted.
    expect(deleted).toEqual(
      expect.arrayContaining([
        'tenants/sb-A/files/a-1/a-1.png',
        'tenants/sb-A/files/a-2/a-2.png',
        'tenants/sb-A/files/a-gone/a-gone.png',
        'tenants/sb-W/files/w-1/w-1.png',
      ])
    );
    // Cross-tenant isolation: B's object was never touched.
    expect(deleted).not.toContain('tenants/sb-B/files/b-1/b-1.png');

    // Matched tenants and their rows are gone.
    expect(await h.db.getTenantById('sb-A')).toBeNull();
    expect(await h.db.getTenantById('sb-W')).toBeNull();
    expect(await h.db.getAllStoredPathsByTenant('sb-A')).toEqual([]);
    expect(await h.db.listWorkspacesByTenant('sb-A')).toEqual([]);
    expect(await h.db.getUploadSessionByFileId('a-1')).toBeNull();

    // Bystander B fully intact.
    expect(await h.db.getTenantById('sb-B')).not.toBeNull();
    expect(await h.db.getAllStoredPathsByTenant('sb-B')).toEqual([
      'tenants/sb-B/files/b-1/b-1.png',
    ]);

    // Ledger recorded the delivery.
    const ledger = await h.db.getErasureEvent('evt-cascade');
    expect(ledger?.kind).toBe('tenant.erased');
  });

  it('is idempotent: a replay is a no-op success and re-deletes nothing', async () => {
    const body = tenantErasedBody({
      eventId: 'evt-replay',
      tenantId: 'company-A',
      workspaceIds: ['auth-ws-legacy'],
    });
    const sig = await signErasureBody(body, SECRET);

    const first = await post(h.app, envWith(SECRET), body, sig);
    expect(first.status).toBe(200);
    const callsAfterFirst = h.deleteMock.mock.calls.length;
    expect(callsAfterFirst).toBeGreaterThan(0);

    const second = await post(h.app, envWith(SECRET), body, sig);
    expect(second.status).toBe(200);
    expect(await second.json()).toEqual({ status: 'ok', idempotent: true });
    // No further object deletions on replay.
    expect(h.deleteMock.mock.calls.length).toBe(callsAfterFirst);
  });

  it('records + acks an unmatched company with nothing to do', async () => {
    const body = tenantErasedBody({ eventId: 'evt-nomatch', tenantId: 'company-unknown' });
    const sig = await signErasureBody(body, SECRET);
    const res = await post(h.app, envWith(SECRET), body, sig);

    expect(res.status).toBe(200);
    expect(h.deleteMock).not.toHaveBeenCalled();
    expect(await h.db.getErasureEvent('evt-nomatch')).not.toBeNull();
    // Bystanders all still present.
    expect(await h.db.getTenantById('sb-A')).not.toBeNull();
    expect(await h.db.getTenantById('sb-B')).not.toBeNull();
  });

  it('retries on a partial failure: 5xx, nothing recorded, tenant survives for the retry', async () => {
    h.deleteMock.mockRejectedValueOnce(new Error('storage down'));

    const body = tenantErasedBody({ eventId: 'evt-partial', tenantId: 'company-A' });
    const sig = await signErasureBody(body, SECRET);

    const failed = await post(h.app, envWith(SECRET), body, sig);
    expect(failed.status).toBe(500);
    // Not acked: no ledger row, tenant + its rows still present so a retry redoes it.
    expect(await h.db.getErasureEvent('evt-partial')).toBeNull();
    expect(await h.db.getTenantById('sb-A')).not.toBeNull();

    // Retry (storage healthy now) completes and is idempotent w.r.t. already-gone objects.
    const ok = await post(h.app, envWith(SECRET), body, sig);
    expect(ok.status).toBe(200);
    expect(await h.db.getTenantById('sb-A')).toBeNull();
    expect(await h.db.getErasureEvent('evt-partial')).not.toBeNull();
  });
});

describe('POST /api/v1/internal/erasure — user.erased', () => {
  let h: Harness;
  beforeEach(async () => {
    h = makeHarness();
    await h.db.createTenant({
      id: 'sb-U',
      name: 'Company U',
      ...baseTenant,
      authTenantId: 'company-U',
    });
    await seedFile(h.db, 'sb-U', 'u-file-1');
  });

  it('is a verified no-op: records + acks, touches no tenant data', async () => {
    const body = JSON.stringify({
      event_id: 'evt-user',
      kind: 'user.erased',
      user_id: 'user-42',
      requested_at: '2026-07-27T00:00:00.000Z',
    });
    const sig = await signErasureBody(body, SECRET);
    const res = await post(h.app, envWith(SECRET), body, sig);

    expect(res.status).toBe(200);
    expect(h.deleteMock).not.toHaveBeenCalled();
    // Tenant data untouched — SB keys data to companies, not users.
    expect(await h.db.getTenantById('sb-U')).not.toBeNull();
    expect(await h.db.getAllStoredPathsByTenant('sb-U')).toHaveLength(1);
    // Delivery recorded so a replay is a no-op.
    expect((await h.db.getErasureEvent('evt-user'))?.kind).toBe('user.erased');
  });
});
