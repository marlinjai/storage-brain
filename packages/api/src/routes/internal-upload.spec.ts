import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createApp } from '../app';
import { generateUploadToken } from '../services/signed-url';
import { MAX_FILE_SIZE_BYTES, MAX_JSON_BODY_BYTES } from '@storage-brain/shared';
import type {
  StorageAdapter,
  DatabaseAdapter,
  StoredFile,
  UploadSession,
} from '@storage-brain/shared';
import { countingStream } from '../test-utils/counting-stream';

// ROADMAP 2026-09-26: the byte upload used to buffer the whole request body
// with arrayBuffer() and never compared it with the 100 MB maximum or with the
// size declared when the upload was requested. These specs pin that the body
// is now refused unread on an oversized Content-Length, cut off while
// streaming otherwise, and that a valid upload still stores exactly its bytes.

const SECRET = 'test-secret';
const TENANT_ID = 'aaaa1111-e29b-41d4-a716-446655440000';
const FILE_ID = 'ffff1111-e29b-41d4-a716-446655440001';
const STORED_PATH = `tenants/${TENANT_ID}/files/${FILE_ID}/photo.png`;
const MIB = 1024 * 1024;

const ENV = {
  ENVIRONMENT: 'development' as const,
  URL_SIGNING_SECRET: SECRET,
  R2_WEBHOOK_SIGNING_SECRET: 'r2-webhook-secret-000000000000',
  DB: {} as never,
  BUCKET: {} as never,
};

function file(sizeBytes: number): StoredFile {
  return {
    id: FILE_ID,
    tenantId: TENANT_ID,
    workspaceId: null,
    originalName: 'photo.png',
    storedPath: STORED_PATH,
    fileType: 'image/png',
    sizeBytes,
    context: null,
    tags: null,
    metadata: null,
    processingStatus: 'pending',
    webhookUrl: null, // no outbound webhook, so no execution context is needed
    createdAt: 1700000000000,
    updatedAt: 1700000000000,
    deletedAt: null,
  };
}

function session(): UploadSession {
  return {
    id: 'session-1',
    fileId: FILE_ID,
    tenantId: TENANT_ID,
    presignedUrl: '',
    status: 'pending',
    expiresAt: Date.now() + 60_000,
    createdAt: Date.now(),
  } as UploadSession;
}

function createMockDb(declaredSize: number) {
  return {
    getFileByStoredPath: vi.fn().mockResolvedValue(file(declaredSize)),
    getUploadSessionByFileId: vi.fn().mockResolvedValue(session()),
    claimUploadSession: vi.fn().mockResolvedValue(true),
    settleUploadSession: vi.fn().mockResolvedValue(true),
    getFileById: vi.fn(),
  };
}

interface ErrorBody {
  error: { code: string; message: string };
}

async function uploadUrl(): Promise<string> {
  const expires = Date.now() + 60_000;
  const token = await generateUploadToken(STORED_PATH, expires, SECRET);
  return `/_internal/upload/${encodeURIComponent(STORED_PATH)}?token=${token}&expires=${expires}`;
}

describe('PUT /_internal/upload/* body size limit', () => {
  let db: ReturnType<typeof createMockDb>;
  let storage: { put: ReturnType<typeof vi.fn>; delete: ReturnType<typeof vi.fn> };
  let app: ReturnType<typeof createApp>;

  function setup(declaredSize: number) {
    db = createMockDb(declaredSize);
    storage = { put: vi.fn().mockResolvedValue({}), delete: vi.fn().mockResolvedValue(undefined) };
    app = createApp({
      db: db as unknown as DatabaseAdapter,
      storage: storage as unknown as StorageAdapter,
    });
  }

  async function put(body: ReadableStream<Uint8Array>, headers: Record<string, string> = {}) {
    return app.request(
      await uploadUrl(),
      {
        method: 'PUT',
        headers: { 'Content-Type': 'image/png', ...headers },
        body,
        duplex: 'half',
      } as RequestInit,
      ENV
    );
  }

  // Declared at the maximum, so only the global limit is in play by default.
  beforeEach(() => setup(MAX_FILE_SIZE_BYTES));

  it('rejects a Content-Length above the maximum with 413 before reading or touching the DB', async () => {
    const src = countingStream(MAX_FILE_SIZE_BYTES + 1, MIB);

    const res = await put(src.stream, { 'Content-Length': String(MAX_FILE_SIZE_BYTES + 1) });

    expect(res.status).toBe(413);
    const body = await res.json<ErrorBody>();
    expect(body.error.code).toBe('PAYLOAD_TOO_LARGE');
    expect(body.error.message).toBe(
      `Upload body of ${MAX_FILE_SIZE_BYTES + 1} bytes exceeds the maximum of ${MAX_FILE_SIZE_BYTES} bytes`
    );
    expect(src.pulls).toBe(0);
    expect(db.getFileByStoredPath).not.toHaveBeenCalled();
    expect(db.claimUploadSession).not.toHaveBeenCalled();
    expect(storage.put).not.toHaveBeenCalled();
  });

  it('cuts a streamed body without Content-Length off at the maximum with 413', async () => {
    const src = countingStream(MAX_FILE_SIZE_BYTES + 50 * MIB, MIB);

    const res = await put(src.stream);

    expect(res.status).toBe(413);
    const body = await res.json<ErrorBody>();
    expect(body.error.code).toBe('PAYLOAD_TOO_LARGE');
    expect(body.error.message).toBe(
      `Upload body exceeds the maximum of ${MAX_FILE_SIZE_BYTES} bytes`
    );
    // Reading stopped at the first chunk past the limit: never more than the
    // limit plus one chunk was produced (and so could have been buffered).
    expect(src.bytesProduced).toBeLessThanOrEqual(MAX_FILE_SIZE_BYTES + MIB);
    expect(src.pulls).toBeLessThanOrEqual(MAX_FILE_SIZE_BYTES / MIB + 2);
    expect(src.cancelled).toBe(true);
    expect(storage.put).not.toHaveBeenCalled();
    // The cut-off transfer releases its whole reservation.
    expect(db.settleUploadSession).toHaveBeenCalledWith(
      'session-1',
      { status: 'failed' },
      'uploading'
    );
  });

  it('rejects a Content-Length above the declared size with 413 without reading', async () => {
    setup(1_000);
    const src = countingStream(2_000, 500);

    const res = await put(src.stream, { 'Content-Length': '2000' });

    expect(res.status).toBe(413);
    const body = await res.json<ErrorBody>();
    expect(body.error.message).toBe(
      'Upload body of 2000 bytes exceeds the 1000 bytes declared for this upload'
    );
    expect(src.pulls).toBe(0);
    expect(storage.put).not.toHaveBeenCalled();
    expect(db.settleUploadSession).toHaveBeenCalledWith(
      'session-1',
      { status: 'failed' },
      'uploading'
    );
  });

  it('cuts off a body larger than the declared size even when Content-Length lies', async () => {
    setup(1_000);
    const src = countingStream(10 * MIB, 256);

    const res = await put(src.stream, { 'Content-Length': '500' });

    expect(res.status).toBe(413);
    const body = await res.json<ErrorBody>();
    expect(body.error.message).toBe('Upload body exceeds the 1000 bytes declared for this upload');
    expect(src.bytesProduced).toBeLessThanOrEqual(1_000 + 256);
    expect(src.cancelled).toBe(true);
    expect(storage.put).not.toHaveBeenCalled();
    // The cut-off transfer releases its whole reservation.
    expect(db.settleUploadSession).toHaveBeenCalledWith(
      'session-1',
      { status: 'failed' },
      'uploading'
    );
  });

  it('stores exactly the bytes of a valid upload', async () => {
    setup(5_000);
    const src = countingStream(4_321, 1_000, (offset, chunk) => {
      for (let i = 0; i < chunk.length; i++) chunk[i] = (offset + i) % 251;
    });

    const res = await put(src.stream, { 'Content-Length': '4321' });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: 'completed', fileId: FILE_ID, sizeBytes: 4_321 });
    expect(storage.put).toHaveBeenCalledTimes(1);
    const [key, stored, opts] = storage.put.mock.calls[0] as [string, ArrayBuffer, unknown];
    expect(key).toBe(STORED_PATH);
    expect(opts).toEqual({ contentType: 'image/png' });
    const expected = Uint8Array.from({ length: 4_321 }, (_, i) => i % 251);
    expect(new Uint8Array(stored)).toEqual(expected);
    // A body smaller than declared is still accepted and the real size recorded.
    expect(db.settleUploadSession).toHaveBeenCalledWith(
      'session-1',
      { status: 'completed', actualBytes: 4_321 },
      'uploading'
    );
  });

  it('accepts an upload of exactly the maximum size without Content-Length', async () => {
    setup(MAX_FILE_SIZE_BYTES);
    const src = countingStream(MAX_FILE_SIZE_BYTES, MIB, (offset, chunk) => {
      chunk[0] = (offset / MIB) % 256;
    });

    const res = await put(src.stream);

    expect(res.status).toBe(200);
    const [, stored] = storage.put.mock.calls[0] as [string, ArrayBuffer];
    expect(stored.byteLength).toBe(MAX_FILE_SIZE_BYTES);
    const bytes = new Uint8Array(stored);
    expect(bytes[0]).toBe(0);
    expect(bytes[MAX_FILE_SIZE_BYTES - MIB]).toBe((MAX_FILE_SIZE_BYTES / MIB - 1) % 256);
    expect(db.settleUploadSession).toHaveBeenCalledWith(
      'session-1',
      { status: 'completed', actualBytes: MAX_FILE_SIZE_BYTES },
      'uploading'
    );
  });
});

describe('PUT /_internal/upload/* settles its upload session on every path', () => {
  let db: ReturnType<typeof createMockDb>;
  let storage: { put: ReturnType<typeof vi.fn>; delete: ReturnType<typeof vi.fn> };
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    db = createMockDb(1_000);
    storage = { put: vi.fn().mockResolvedValue({}), delete: vi.fn().mockResolvedValue(undefined) };
    app = createApp({
      db: db as unknown as DatabaseAdapter,
      storage: storage as unknown as StorageAdapter,
    });
  });

  async function put(bytes: number) {
    return app.request(
      await uploadUrl(),
      {
        method: 'PUT',
        headers: { 'Content-Type': 'image/png' },
        body: countingStream(bytes, 256).stream,
        duplex: 'half',
      } as RequestInit,
      ENV
    );
  }

  it('claims the session before reading, then settles the smaller-than-declared size', async () => {
    const res = await put(600);

    expect(res.status).toBe(200);
    expect(db.claimUploadSession).toHaveBeenCalledWith('session-1');
    // 600 of the 1000 reserved bytes are kept; the adapter releases the other 400.
    expect(db.settleUploadSession).toHaveBeenCalledWith(
      'session-1',
      { status: 'completed', actualBytes: 600 },
      'uploading'
    );
  });

  it('refuses a second transfer for a session another one already claimed (409, nothing read)', async () => {
    db.claimUploadSession.mockResolvedValueOnce(false);
    const src = countingStream(600, 256);

    const res = await app.request(
      await uploadUrl(),
      { method: 'PUT', body: src.stream, duplex: 'half' } as RequestInit,
      ENV
    );

    expect(res.status).toBe(409);
    expect(src.pulls).toBe(0);
    expect(db.settleUploadSession).not.toHaveBeenCalled();
    expect(storage.put).not.toHaveBeenCalled();
  });

  it('releases the reservation when storing the bytes fails', async () => {
    storage.put.mockRejectedValueOnce(new Error('R2 unavailable'));

    const res = await put(600);

    expect(res.status).toBe(500);
    expect(db.settleUploadSession).toHaveBeenCalledTimes(1);
    expect(db.settleUploadSession).toHaveBeenCalledWith(
      'session-1',
      { status: 'failed' },
      'uploading'
    );
  });

  it('releases the reservation for an empty body (400)', async () => {
    const res = await put(0);

    expect(res.status).toBe(400);
    expect(db.settleUploadSession).toHaveBeenCalledWith(
      'session-1',
      { status: 'failed' },
      'uploading'
    );
    expect(storage.put).not.toHaveBeenCalled();
  });

  it('still answers with the upload error when settling the failure also fails', async () => {
    storage.put.mockRejectedValueOnce(new Error('R2 unavailable'));
    db.settleUploadSession.mockRejectedValueOnce(new Error('db down'));
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const res = await put(600);

    expect(res.status).toBe(500);
  });

  it('deletes the stored object when the session was closed while the bytes were in flight', async () => {
    db.settleUploadSession.mockResolvedValueOnce(false);

    const res = await put(600);

    expect(res.status).toBe(409);
    expect(storage.delete).toHaveBeenCalledWith(STORED_PATH);
  });

  it('settles a lapsed pending session as expired (410), releasing its reservation', async () => {
    db.getUploadSessionByFileId.mockResolvedValueOnce({
      ...session(),
      expiresAt: Date.now() - 1,
    });

    const res = await put(600);

    expect(res.status).toBe(410);
    expect(db.settleUploadSession).toHaveBeenCalledWith(
      'session-1',
      { status: 'expired' },
      'pending'
    );
    expect(db.claimUploadSession).not.toHaveBeenCalled();
  });

  it('answers 409 for a session that is already settled, without touching it', async () => {
    db.getUploadSessionByFileId.mockResolvedValueOnce({ ...session(), status: 'completed' });

    const res = await put(600);

    expect(res.status).toBe(409);
    expect(db.claimUploadSession).not.toHaveBeenCalled();
    expect(db.settleUploadSession).not.toHaveBeenCalled();
  });
});

describe('body size cap on JSON and webhook routes', () => {
  const app = createApp({
    db: {} as unknown as DatabaseAdapter,
    storage: {} as unknown as StorageAdapter,
  });

  it('refuses an oversized Content-Length on the unauthenticated webhook unread', async () => {
    const src = countingStream(MAX_JSON_BODY_BYTES + 1, 64 * 1024);

    const res = await app.request(
      '/webhooks/r2-upload-complete',
      {
        method: 'POST',
        headers: { 'Content-Length': String(MAX_JSON_BODY_BYTES + 1) },
        body: src.stream,
        duplex: 'half',
      } as RequestInit,
      ENV
    );

    expect(res.status).toBe(413);
    const body = await res.json<ErrorBody>();
    expect(body.error).toEqual({
      code: 'PAYLOAD_TOO_LARGE',
      message: `Request body exceeds the maximum of ${MAX_JSON_BODY_BYTES} bytes`,
    });
    expect(src.pulls).toBe(0);
  });

  it('cuts a streamed webhook body without Content-Length off at the cap', async () => {
    const src = countingStream(20 * MAX_JSON_BODY_BYTES, 64 * 1024);

    const res = await app.request(
      '/webhooks/r2-upload-complete',
      { method: 'POST', body: src.stream, duplex: 'half' } as RequestInit,
      ENV
    );

    expect(res.status).toBe(413);
    const body = await res.json<ErrorBody>();
    expect(body.error.code).toBe('PAYLOAD_TOO_LARGE');
    expect(src.bytesProduced).toBeLessThanOrEqual(MAX_JSON_BODY_BYTES + 2 * 64 * 1024);
  });

  it('answers 413, not 404, for an unbounded streamed body to an unknown /api/v1 path', async () => {
    // No handler reads this body, so the cap must fire before the 404 does.
    const src = countingStream(20 * MAX_JSON_BODY_BYTES, 64 * 1024);

    const res = await app.request(
      '/api/v1/no-such-route',
      { method: 'POST', body: src.stream, duplex: 'half' } as RequestInit,
      ENV
    );

    expect(res.status).toBe(413);
    const body = await res.json<ErrorBody>();
    expect(body.error.code).toBe('PAYLOAD_TOO_LARGE');
    expect(src.bytesProduced).toBeLessThanOrEqual(MAX_JSON_BODY_BYTES + 2 * 64 * 1024);
  });

  it('caps the signed erasure webhook too', async () => {
    const res = await app.request(
      '/api/v1/internal/erasure',
      {
        method: 'POST',
        headers: { 'Content-Length': String(MAX_JSON_BODY_BYTES + 1) },
        body: countingStream(MAX_JSON_BODY_BYTES + 1, 64 * 1024).stream,
        duplex: 'half',
      } as RequestInit,
      ENV
    );

    expect(res.status).toBe(413);
  });
});
