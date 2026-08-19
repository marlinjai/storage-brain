import { describe, it, expect, vi, beforeEach } from 'vitest';
import { S3StorageAdapter } from './s3';
import type { StorageAdapter } from '@storage-brain/shared';

const mockSend = vi.fn();

vi.mock('@aws-sdk/client-s3', () => {
  return {
    S3Client: class MockS3Client {
      send = mockSend;
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
    adapter = new S3StorageAdapter({
      bucket: 'test-bucket',
      region: 'us-east-1',
      credentials: { accessKeyId: 'key', secretAccessKey: 'secret' },
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

    it('handles ReadableStream input', async () => {
      mockSend.mockResolvedValueOnce({ ETag: '"def456"' });

      const chunk = new Uint8Array([1, 2, 3, 4, 5]);
      const stream = new ReadableStream({
        start(controller) {
          controller.enqueue(chunk);
          controller.close();
        },
      });

      const result = await adapter.put('test/file.bin', stream, { contentType: 'application/octet-stream' });
      expect(result.size).toBe(5);
    });
  });

  describe('get', () => {
    it('returns file content', async () => {
      const mockStream = new ReadableStream();
      mockSend.mockResolvedValueOnce({
        Body: { transformToWebStream: () => mockStream },
        ContentType: 'image/png',
        ContentLength: 2048,
        ETag: '"xyz"',
      });

      const result = await adapter.get('test/file.png');
      expect(result).not.toBeNull();
      expect(result!.body).toBe(mockStream);
      expect(result!.contentType).toBe('image/png');
      expect(result!.size).toBe(2048);
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
      const url = await adapter.getPresignedUploadUrl!('key', { expiresIn: 900, contentType: 'image/png' });
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

    expect((mockSend.mock.calls[0]![0] as { input: { Range?: string } }).input.Range).toBe('bytes=100-');
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
    expect((mockSend.mock.calls[1]![0] as { input: { Range?: string } }).input.Range).toBeUndefined();
  });

  it('still propagates a non-range error', async () => {
    mockSend.mockRejectedValueOnce(Object.assign(new Error('boom'), { name: 'InternalError' }));

    await expect(adapter.get('k', { start: 0, end: 9 })).rejects.toThrow('boom');
  });
});
