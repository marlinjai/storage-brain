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
    updateUploadSessionStatus: vi.fn().mockResolvedValue(undefined),
    getFileById: vi.fn().mockResolvedValue(file()),
    updateFileProcessingStatus: vi.fn().mockResolvedValue(undefined),
  };
}

function createMockStorage(): StorageAdapter {
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
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    vi.clearAllMocks();
    db = createMockDb();
    app = createApp({ db: db as unknown as DatabaseAdapter, storage: createMockStorage() });
  });

  function post(body: string, headers: Record<string, string>, env: typeof ENV | Record<string, unknown> = ENV) {
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
    expect(db.updateFileProcessingStatus).toHaveBeenCalledWith(FILE_ID, 'completed');
  });

  it('rejects a request with an invalid signature (401), no side effects', async () => {
    const badSignature = await signWebhookBody(RAW_BODY, 'the-wrong-secret-000000000');

    const res = await post(RAW_BODY, { 'X-Webhook-Signature': badSignature });

    expect(res.status).toBe(401);
    expect(db.updateFileProcessingStatus).not.toHaveBeenCalled();
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
    expect(db.updateFileProcessingStatus).not.toHaveBeenCalled();
  });

  it('fails closed with 500 when the signing secret is unset (misconfig)', async () => {
    const signature = await signWebhookBody(RAW_BODY, SECRET);
    const envWithout = { ...ENV };
    delete (envWithout as Partial<typeof ENV>).R2_WEBHOOK_SIGNING_SECRET;
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const res = await post(RAW_BODY, { 'X-Webhook-Signature': signature }, envWithout);

    expect(res.status).toBe(500);
    expect(db.updateFileProcessingStatus).not.toHaveBeenCalled();
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
    expect(db.updateFileProcessingStatus).not.toHaveBeenCalled();
  });
});
