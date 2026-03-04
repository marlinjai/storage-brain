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
