import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NodeHttpHandler } from '@smithy/node-http-handler';
import { S3StorageAdapter, putRequestTimeoutMs } from './s3';
import type { StorageAdapter } from '@storage-brain/shared';

const mockSend = vi.fn();
const s3ClientConfigs: unknown[] = [];

vi.mock('@aws-sdk/client-s3', () => {
  return {
    S3Client: class MockS3Client {
      send = mockSend;
      constructor(config: unknown) {
        s3ClientConfigs.push(config);
      }
    },
    PutObjectCommand: class MockPutObjectCommand {
      constructor(public input: unknown) {}
    },
    GetObjectCommand: class MockGetObjectCommand {
      constructor(public input: unknown) {}
    },
    DeleteObjectCommand: class MockDeleteObjectCommand {
      constructor(public input: unknown) {}
    },
    HeadObjectCommand: class MockHeadObjectCommand {
      constructor(public input: unknown) {}
    },
  };
});

vi.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: vi.fn().mockResolvedValue('https://presigned.example.com/file'),
}));

describe('S3StorageAdapter', () => {
  let adapter: StorageAdapter;

  beforeEach(() => {
    mockSend.mockReset();
    s3ClientConfigs.length = 0;
    adapter = new S3StorageAdapter({
      bucket: 'test-bucket',
      region: 'us-east-1',
      credentials: { accessKeyId: 'key', secretAccessKey: 'secret' },
    });
  });

  describe('request handler (incident 2026-09-11: a hung R2 connection never freed its socket)', () => {
    it('gives the S3 client a request handler with real timeouts, not the default (no timeout at all)', () => {
      expect(s3ClientConfigs).toHaveLength(1);
      const config = s3ClientConfigs[0] as { requestHandler?: NodeHttpHandler };
      expect(config.requestHandler).toBeInstanceOf(NodeHttpHandler);

      // NodeHttpHandler keeps its resolved config on `.metadata`... in practice
      // the config object handed to the constructor is the source of truth we
      // actually control, so assert against it directly rather than reaching
      // into the handler's internals.
      const handler = config.requestHandler as unknown as {
        configProvider: Promise<{
          connectionTimeout?: number;
          requestTimeout?: number;
          throwOnRequestTimeout?: boolean;
          httpAgent?: { maxSockets?: number };
          httpsAgent?: { maxSockets?: number };
        }>;
      };
      return handler.configProvider.then((resolved) => {
        expect(resolved.connectionTimeout).toBe(5_000);
        expect(resolved.requestTimeout).toBe(30_000);
        // Without this, requestTimeout only logs a warning and the stuck
        // request keeps its socket (incident 2026-09-26).
        expect(resolved.throwOnRequestTimeout).toBe(true);
        expect(resolved.httpAgent?.maxSockets).toBe(300);
        expect(resolved.httpsAgent?.maxSockets).toBe(300);
      });
    });

    it('reuses one request handler across every S3StorageAdapter instance', () => {
      new S3StorageAdapter({
        bucket: 'other-bucket',
        region: 'us-east-1',
        credentials: { accessKeyId: 'key2', secretAccessKey: 'secret2' },
      });

      expect(s3ClientConfigs).toHaveLength(2);
      const configs = s3ClientConfigs as { requestHandler?: NodeHttpHandler }[];
      // Sharing one handler (and its underlying agent/socket pool) across
      // adapters is deliberate: a per-instance handler would give each new
      // adapter its OWN 300-socket allowance, defeating the point of a cap.
      expect(configs[0]!.requestHandler).toBe(configs[1]!.requestHandler);
    });
  });

  describe('put', () => {
    it('uploads ArrayBuffer and returns StorageObject', async () => {
      mockSend.mockResolvedValueOnce({ ETag: '"abc123"' });

      const data = new ArrayBuffer(10);
      const result = await adapter.put('test/file.png', data, { contentType: 'image/png' });

      expect(result.key).toBe('test/file.png');
      expect(result.size).toBe(10);
      expect(result.contentType).toBe('image/png');
      expect(result.etag).toBe('abc123');
    });

    it('gives a PUT time for its upload, not only the flat header wait', async () => {
      // S3 answers a PUT only after the last byte, so the header timeout covers
      // the whole upload and must grow with it.
      mockSend.mockResolvedValueOnce({ ETag: '"big"' });

      await adapter.put('test/big.bin', new ArrayBuffer(100 * 1024 * 1024), {
        contentType: 'application/octet-stream',
      });

      expect(mockSend.mock.calls[0]![1]).toEqual({ requestTimeout: 130_000 });
      expect(putRequestTimeoutMs(0)).toBe(30_000);
      expect(putRequestTimeoutMs(1)).toBe(31_000);
    });

    it('handles ReadableStream input', async () => {
      mockSend.mockResolvedValueOnce({ ETag: '"def456"' });

      const chunk = new Uint8Array([1, 2, 3, 4, 5]);
      const stream = new ReadableStream({
        start(controller) {
          controller.enqueue(chunk);
          controller.close();
        },
      });

      const result = await adapter.put('test/file.bin', stream, {
        contentType: 'application/octet-stream',
      });
      expect(result.size).toBe(5);
    });
  });

  describe('get', () => {
    it('returns file content', async () => {
      const mockStream = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new Uint8Array([1, 2, 3]));
          controller.close();
        },
      });
      mockSend.mockResolvedValueOnce({
        Body: { transformToWebStream: () => mockStream },
        ContentType: 'image/png',
        ContentLength: 2048,
        ETag: '"xyz"',
      });

      const result = await adapter.get('test/file.png');
      expect(result).not.toBeNull();
      expect(result!.contentType).toBe('image/png');
      expect(result!.size).toBe(2048);
      // The body is a guarded wrapper, and passes the bytes through unchanged.
      expect(new Uint8Array(await new Response(result!.body).arrayBuffer())).toEqual(
        new Uint8Array([1, 2, 3])
      );
    });

    it('hands the request signal to the SDK so a queued or in-flight read is abandoned', async () => {
      mockSend.mockResolvedValueOnce({
        Body: { transformToWebStream: () => new ReadableStream() },
        ContentType: 'image/png',
      });
      const controller = new AbortController();

      await adapter.get('test/file.png', undefined, { signal: controller.signal });

      expect(mockSend.mock.calls[0]![1]).toEqual({ abortSignal: controller.signal });
    });

    it('releases the S3 body when the request aborts after the body was handed out', async () => {
      let sourceCancelled = false;
      const source = new ReadableStream<Uint8Array>({
        cancel() {
          sourceCancelled = true;
        },
      });
      mockSend.mockResolvedValueOnce({
        Body: { transformToWebStream: () => source },
        ContentType: 'video/mp4',
      });
      const controller = new AbortController();

      const result = await adapter.get('clip.mp4', undefined, { signal: controller.signal });
      // Lock it the way the HTTP layer does, then abort: release must not
      // depend on whoever holds the returned stream.
      result!.body.getReader();
      controller.abort();
      await Promise.resolve();

      expect(sourceCancelled).toBe(true);
    });

    it('returns null for NoSuchKey error', async () => {
      const error = new Error('NoSuchKey');
      error.name = 'NoSuchKey';
      mockSend.mockRejectedValueOnce(error);

      const result = await adapter.get('missing');
      expect(result).toBeNull();
    });

    it('returns null if Body is empty', async () => {
      mockSend.mockResolvedValueOnce({ Body: null });
      const result = await adapter.get('empty');
      expect(result).toBeNull();
    });
  });

  describe('delete', () => {
    it('sends DeleteObjectCommand', async () => {
      mockSend.mockResolvedValueOnce({});
      await adapter.delete('test/file.png');
      expect(mockSend).toHaveBeenCalledTimes(1);
    });
  });

  describe('exists', () => {
    it('returns true when head succeeds', async () => {
      mockSend.mockResolvedValueOnce({
        ContentLength: 100,
        ContentType: 'image/png',
        LastModified: new Date(),
      });

      expect(await adapter.exists('key')).toBe(true);
    });

    it('returns false for NotFound error', async () => {
      const error = new Error('NotFound');
      error.name = 'NotFound';
      mockSend.mockRejectedValueOnce(error);

      expect(await adapter.exists('missing')).toBe(false);
    });
  });

  describe('head', () => {
    it('returns metadata for existing object', async () => {
      const date = new Date('2024-06-01');
      mockSend.mockResolvedValueOnce({
        ContentLength: 3000,
        ContentType: 'application/pdf',
        LastModified: date,
        ETag: '"head-etag"',
      });

      const result = await adapter.head('doc.pdf');
      expect(result).not.toBeNull();
      expect(result!.key).toBe('doc.pdf');
      expect(result!.size).toBe(3000);
      expect(result!.contentType).toBe('application/pdf');
    });

    it('returns null for NotFound error', async () => {
      const error = new Error('NotFound');
      error.name = 'NotFound';
      mockSend.mockRejectedValueOnce(error);

      expect(await adapter.head('missing')).toBeNull();
    });

    it('returns null for NoSuchKey error', async () => {
      const error = new Error('NoSuchKey');
      error.name = 'NoSuchKey';
      mockSend.mockRejectedValueOnce(error);

      expect(await adapter.head('missing')).toBeNull();
    });

    it('returns null for 404 status code', async () => {
      const error = { name: 'HeadError', $metadata: { httpStatusCode: 404 } };
      mockSend.mockRejectedValueOnce(error);

      expect(await adapter.head('missing')).toBeNull();
    });
  });

  describe('getPresignedUploadUrl', () => {
    it('returns a presigned URL', async () => {
      const url = await adapter.getPresignedUploadUrl!('key', {
        expiresIn: 900,
        contentType: 'image/png',
      });
      expect(url).toBe('https://presigned.example.com/file');
    });
  });

  describe('getPresignedDownloadUrl', () => {
    it('returns a presigned URL', async () => {
      const url = await adapter.getPresignedDownloadUrl!('key', { expiresIn: 3600 });
      expect(url).toBe('https://presigned.example.com/file');
    });
  });
});

describe('S3StorageAdapter range reads', () => {
  let adapter: StorageAdapter;

  beforeEach(() => {
    mockSend.mockReset();
    s3ClientConfigs.length = 0;
    adapter = new S3StorageAdapter({
      bucket: 'test-bucket',
      region: 'us-east-1',
      credentials: { accessKeyId: 'key', secretAccessKey: 'secret' },
    });
  });

  function body() {
    return { transformToWebStream: () => new ReadableStream() };
  }

  it('sends a bytes range and reports what S3 actually served', async () => {
    mockSend.mockResolvedValueOnce({
      Body: body(),
      ContentType: 'video/mp4',
      ContentLength: 100,
      ContentRange: 'bytes 0-99/5000',
    });

    const res = await adapter.get('k', { start: 0, end: 99 });

    // The TOTAL comes from Content-Range; ContentLength is only the slice.
    expect(res!.size).toBe(5000);
    expect(res!.range).toEqual({ start: 0, end: 99, total: 5000 });
  });

  it('reports no range when S3 ignored the request', async () => {
    // Then the caller must answer a truthful 200, not a 206.
    mockSend.mockResolvedValueOnce({ Body: body(), ContentType: 'video/mp4', ContentLength: 5000 });

    const res = await adapter.get('k', { start: 0, end: 99 });

    expect(res!.range).toBeUndefined();
    expect(res!.size).toBe(5000);
  });

  it('sends an open-ended range without a trailing end', async () => {
    mockSend.mockResolvedValueOnce({
      Body: body(),
      ContentType: 'video/mp4',
      ContentRange: 'bytes 100-4999/5000',
    });

    await adapter.get('k', { start: 100 });

    expect((mockSend.mock.calls[0]![0] as { input: { Range?: string } }).input.Range).toBe(
      'bytes=100-'
    );
  });

  it('falls back to the whole object when S3 rejects the range', async () => {
    // The route decides satisfiability from the database row's size. If that has
    // drifted from the bucket, an InvalidRange would otherwise surface as a 500
    // on an ordinary video request.
    const invalidRange = Object.assign(new Error('InvalidRange'), { name: 'InvalidRange' });
    mockSend.mockRejectedValueOnce(invalidRange);
    mockSend.mockResolvedValueOnce({ Body: body(), ContentType: 'video/mp4', ContentLength: 10 });

    const res = await adapter.get('k', { start: 99999 });

    expect(res!.range).toBeUndefined();
    expect(res!.size).toBe(10);
    // Second call carries no Range header at all.
    expect(
      (mockSend.mock.calls[1]![0] as { input: { Range?: string } }).input.Range
    ).toBeUndefined();
  });

  it('keeps the request signal on the whole-object fallback read', async () => {
    const invalidRange = Object.assign(new Error('InvalidRange'), { name: 'InvalidRange' });
    mockSend.mockRejectedValueOnce(invalidRange);
    mockSend.mockResolvedValueOnce({ Body: body(), ContentType: 'video/mp4', ContentLength: 10 });
    const controller = new AbortController();

    await adapter.get('k', { start: 99999 }, { signal: controller.signal });

    expect(mockSend.mock.calls[1]![1]).toEqual({ abortSignal: controller.signal });
  });

  it('still propagates a non-range error', async () => {
    mockSend.mockRejectedValueOnce(Object.assign(new Error('boom'), { name: 'InternalError' }));

    await expect(adapter.get('k', { start: 0, end: 9 })).rejects.toThrow('boom');
  });
});
