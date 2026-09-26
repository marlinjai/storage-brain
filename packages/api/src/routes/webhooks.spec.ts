import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createApp } from '../app';
import { signWebhookBody } from '../services/webhook';
import type { StorageAdapter, DatabaseAdapter, StoredFile } from '@storage-brain/shared';

// S3 finding 3: POST /webhooks/r2-upload-complete now fails closed unless the
// raw body carries a valid HMAC-SHA256 signature under R2_WEBHOOK_SIGNING_SECRET.

const SECRET = 'r2-webhook-secret-000000000000';
const TENANT_ID = 'aaaa1111-e29b-41d4-a716-446655440000';
const FILE_ID = 'ffff1111-e29b-41d4-a716-446655440001';

const ENV = {
  ENVIRONMENT: 'development' as const,
  URL_SIGNING_SECRET: 'test-secret',
  R2_WEBHOOK_SIGNING_SECRET: SECRET,
  DB: {} as never,
  BUCKET: {} as never,
};

const RAW_BODY = JSON.stringify({
  object: { key: `tenants/${TENANT_ID}/files/${FILE_ID}/photo.png` },
});

function file(): StoredFile {
  return {
    id: FILE_ID,
    tenantId: TENANT_ID,
    workspaceId: null,
    originalName: 'photo.png',
    storedPath: `tenants/${TENANT_ID}/files/${FILE_ID}/photo.png`,
    fileType: 'image/png',
    sizeBytes: 2048,
    context: 'uploads',
    tags: null,
    metadata: null,
    processingStatus: 'completed',
    webhookUrl: null, // null so the route does not fire an outbound webhook
    createdAt: 1700000000000,
    updatedAt: 1700000000000,
    deletedAt: null,
  };
}

function createMockDb() {
  return {
    getUploadSessionByFileId: vi.fn().mockResolvedValue({ id: 'sess-1', status: 'pending' }),
    settleUploadSession: vi.fn().mockResolvedValue(true),
    getFileById: vi.fn().mockResolvedValue(file()),
  };
}

function createMockStorage() {
  return {
    put: vi.fn(),
    get: vi.fn(),
    delete: vi.fn(),
    exists: vi.fn(),
    head: vi.fn(),
  };
}

describe('POST /webhooks/r2-upload-complete signature gate', () => {
  let db: ReturnType<typeof createMockDb>;
  let storage: ReturnType<typeof createMockStorage>;
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    vi.clearAllMocks();
    db = createMockDb();
    storage = createMockStorage();
    app = createApp({
      db: db as unknown as DatabaseAdapter,
      storage: storage as unknown as StorageAdapter,
    });
  });

  function post(
    body: string,
    headers: Record<string, string>,
    env: typeof ENV | Record<string, unknown> = ENV
  ) {
    return app.request(
      '/webhooks/r2-upload-complete',
      { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body },
      env
    );
  }

  it('accepts a request with a valid signature and processes it', async () => {
    const signature = await signWebhookBody(RAW_BODY, SECRET);

    const res = await post(RAW_BODY, { 'X-Webhook-Signature': signature });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: 'completed', fileId: FILE_ID });
    // No size in the event: the reservation (the file's declared size) stands.
    // Pending-only: the webhook never settles a transfer the internal route claimed.
    expect(db.settleUploadSession).toHaveBeenCalledWith(
      'sess-1',
      { status: 'completed', actualBytes: 2048 },
      'pending'
    );
  });

  it('settles with the object size R2 reports, replacing the reservation', async () => {
    const body = JSON.stringify({
      object: { key: `tenants/${TENANT_ID}/files/${FILE_ID}/photo.png`, size: 1500 },
    });
    const signature = await signWebhookBody(body, SECRET);

    const res = await post(body, { 'X-Webhook-Signature': signature });

    expect(res.status).toBe(200);
    expect(db.settleUploadSession).toHaveBeenCalledWith(
      'sess-1',
      { status: 'completed', actualBytes: 1500 },
      'pending'
    );
  });

  it('ignores the event for an upload the internal route claimed, leaving the object alone', async () => {
    // The adapter refuses a pending-only settle of an `uploading` session.
    db.getUploadSessionByFileId.mockResolvedValueOnce({ id: 'sess-1', status: 'uploading' });
    db.settleUploadSession.mockResolvedValueOnce(false);
    const signature = await signWebhookBody(RAW_BODY, SECRET);

    const res = await post(RAW_BODY, { 'X-Webhook-Signature': signature });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: 'ignored' });
    expect(db.settleUploadSession).toHaveBeenCalledWith('sess-1', expect.anything(), 'pending');
    expect(storage.delete).not.toHaveBeenCalled();
  });

  it('refuses an object larger than the declared size: fails the session and deletes it', async () => {
    const key = `tenants/${TENANT_ID}/files/${FILE_ID}/photo.png`;
    const body = JSON.stringify({ object: { key, size: 4096 } });
    const signature = await signWebhookBody(body, SECRET);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    const res = await post(body, { 'X-Webhook-Signature': signature });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: 'rejected', fileId: FILE_ID });
    expect(db.settleUploadSession).toHaveBeenCalledTimes(1);
    expect(db.settleUploadSession).toHaveBeenCalledWith('sess-1', { status: 'failed' }, 'pending');
    expect(storage.delete).toHaveBeenCalledWith(key);
  });

  it('leaves an oversized object alone when the session was already settled elsewhere', async () => {
    const body = JSON.stringify({
      object: { key: `tenants/${TENANT_ID}/files/${FILE_ID}/photo.png`, size: 4096 },
    });
    db.settleUploadSession.mockResolvedValueOnce(false);
    const signature = await signWebhookBody(body, SECRET);

    const res = await post(body, { 'X-Webhook-Signature': signature });

    expect(await res.json()).toEqual({ status: 'ignored' });
    expect(storage.delete).not.toHaveBeenCalled();
  });

  it("ignores an event whose key is not the file's own object", async () => {
    const body = JSON.stringify({
      object: { key: `tenants/${TENANT_ID}/files/${FILE_ID}/other.png`, size: 10 },
    });
    const signature = await signWebhookBody(body, SECRET);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    const res = await post(body, { 'X-Webhook-Signature': signature });

    expect(await res.json()).toEqual({ status: 'ignored' });
    expect(db.settleUploadSession).not.toHaveBeenCalled();
    expect(storage.delete).not.toHaveBeenCalled();
  });

  it('ignores a redelivered event for an already settled session', async () => {
    db.settleUploadSession.mockResolvedValueOnce(false);
    const signature = await signWebhookBody(RAW_BODY, SECRET);

    const res = await post(RAW_BODY, { 'X-Webhook-Signature': signature });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: 'ignored' });
  });

  it('rejects a request with an invalid signature (401), no side effects', async () => {
    const badSignature = await signWebhookBody(RAW_BODY, 'the-wrong-secret-000000000');

    const res = await post(RAW_BODY, { 'X-Webhook-Signature': badSignature });

    expect(res.status).toBe(401);
    expect(db.settleUploadSession).not.toHaveBeenCalled();
  });

  it('rejects a request whose body was tampered after signing (401)', async () => {
    const signature = await signWebhookBody(RAW_BODY, SECRET);
    const tampered = JSON.stringify({ object: { key: 'tenants/evil/files/x/y.png' } });

    const res = await post(tampered, { 'X-Webhook-Signature': signature });

    expect(res.status).toBe(401);
    expect(db.getFileById).not.toHaveBeenCalled();
  });

  it('rejects a request with no signature header (401)', async () => {
    const res = await post(RAW_BODY, {});

    expect(res.status).toBe(401);
    expect(db.settleUploadSession).not.toHaveBeenCalled();
  });

  it('fails closed with 500 when the signing secret is unset (misconfig)', async () => {
    const signature = await signWebhookBody(RAW_BODY, SECRET);
    const envWithout = { ...ENV };
    delete (envWithout as Partial<typeof ENV>).R2_WEBHOOK_SIGNING_SECRET;
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const res = await post(RAW_BODY, { 'X-Webhook-Signature': signature }, envWithout);

    expect(res.status).toBe(500);
    expect(db.settleUploadSession).not.toHaveBeenCalled();
  });

  it('fails closed with 500 when the signing secret is too short (misconfig)', async () => {
    const shortSecret = 'short';
    const signature = await signWebhookBody(RAW_BODY, shortSecret);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const res = await post(
      RAW_BODY,
      { 'X-Webhook-Signature': signature },
      { ...ENV, R2_WEBHOOK_SIGNING_SECRET: shortSecret }
    );

    expect(res.status).toBe(500);
    expect(db.settleUploadSession).not.toHaveBeenCalled();
  });
});
