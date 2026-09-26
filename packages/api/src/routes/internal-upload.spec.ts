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
    updateUploadSessionStatus: vi.fn(),
    updateFileSizeBytes: vi.fn(),
    updateFileProcessingStatus: vi.fn(),
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
  let storage: { put: ReturnType<typeof vi.fn> };
  let app: ReturnType<typeof createApp>;

  function setup(declaredSize: number) {
    db = createMockDb(declaredSize);
    storage = { put: vi.fn().mockResolvedValue({}) };
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

  beforeEach(() => setup(0));

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
    expect(db.updateUploadSessionStatus).not.toHaveBeenCalled();
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
    expect(db.updateUploadSessionStatus).not.toHaveBeenCalled();
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
    expect(db.updateFileSizeBytes).toHaveBeenCalledWith(FILE_ID, 4_321);
    expect(db.updateUploadSessionStatus).toHaveBeenCalledWith('session-1', 'completed');
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
    expect(db.updateFileSizeBytes).toHaveBeenCalledWith(FILE_ID, MAX_FILE_SIZE_BYTES);
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
