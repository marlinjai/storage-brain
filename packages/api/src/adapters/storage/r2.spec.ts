import { describe, it, expect, vi, beforeEach } from 'vitest';
import { R2StorageAdapter } from './r2';
import type { StorageAdapter } from '@storage-brain/shared';

function createMockBucket() {
  return {
    put: vi.fn().mockResolvedValue({
      size: 1024,
      uploaded: new Date('2024-01-01'),
      etag: 'abc123',
    }),
    get: vi.fn(),
    delete: vi.fn().mockResolvedValue(undefined),
    head: vi.fn(),
    list: vi.fn(),
  };
}

describe('R2StorageAdapter', () => {
  let bucket: ReturnType<typeof createMockBucket>;
  let adapter: StorageAdapter;

  beforeEach(() => {
    bucket = createMockBucket();
    adapter = new R2StorageAdapter(bucket as never);
  });

  describe('listObjects', () => {
    it('pages through the bucket and returns every object', async () => {
      bucket.list
        .mockResolvedValueOnce({
          objects: [{ key: 'a.png', size: 10, uploaded: new Date('2026-01-01') }],
          truncated: true,
          cursor: 'cursor-2',
        })
        .mockResolvedValueOnce({
          objects: [{ key: 'b.pdf', size: 20, uploaded: new Date('2026-02-01') }],
          truncated: false,
        });

      const objects = await adapter.listObjects();

      expect(objects).toEqual([
        { key: 'a.png', size: 10, lastModified: new Date('2026-01-01') },
        { key: 'b.pdf', size: 20, lastModified: new Date('2026-02-01') },
      ]);
      expect(bucket.list).toHaveBeenCalledTimes(2);
      expect(bucket.list).toHaveBeenNthCalledWith(1, {});
      expect(bucket.list).toHaveBeenNthCalledWith(2, { cursor: 'cursor-2' });
    });
  });

  describe('put', () => {
    it('uploads data and returns StorageObject', async () => {
      const data = new ArrayBuffer(10);
      const result = await adapter.put('test/file.png', data, { contentType: 'image/png' });

      expect(result.key).toBe('test/file.png');
      expect(result.size).toBe(1024);
      expect(result.contentType).toBe('image/png');
      expect(result.etag).toBe('abc123');
      expect(bucket.put).toHaveBeenCalledWith('test/file.png', data, {
        httpMetadata: { contentType: 'image/png' },
      });
    });

    it('handles null result from R2', async () => {
      bucket.put.mockResolvedValueOnce(null);
      const result = await adapter.put('key', new ArrayBuffer(0), { contentType: 'image/png' });
      expect(result.size).toBe(0);
    });
  });

  describe('get', () => {
    it('returns file content', async () => {
      const mockBody = new ReadableStream();
      bucket.get.mockResolvedValueOnce({
        body: mockBody,
        httpMetadata: { contentType: 'image/png' },
        size: 2048,
        etag: 'def456',
      });

      const result = await adapter.get('test/file.png');

      expect(result).not.toBeNull();
      expect(result!.body).toBe(mockBody);
      expect(result!.contentType).toBe('image/png');
      expect(result!.size).toBe(2048);
    });

    it('returns null for non-existent key', async () => {
      bucket.get.mockResolvedValueOnce(null);
      const result = await adapter.get('missing');
      expect(result).toBeNull();
    });

    it('defaults to application/octet-stream when no contentType', async () => {
      bucket.get.mockResolvedValueOnce({
        body: new ReadableStream(),
        httpMetadata: {},
        size: 100,
      });

      const result = await adapter.get('key');
      expect(result!.contentType).toBe('application/octet-stream');
    });
  });

  describe('delete', () => {
    it('calls bucket.delete', async () => {
      await adapter.delete('test/file.png');
      expect(bucket.delete).toHaveBeenCalledWith('test/file.png');
    });
  });

  describe('exists', () => {
    it('returns true when object exists', async () => {
      bucket.head.mockResolvedValueOnce({ size: 100 });
      expect(await adapter.exists('key')).toBe(true);
    });

    it('returns false when object does not exist', async () => {
      bucket.head.mockResolvedValueOnce(null);
      expect(await adapter.exists('missing')).toBe(false);
    });
  });

  describe('head', () => {
    it('returns metadata for existing object', async () => {
      bucket.head.mockResolvedValueOnce({
        size: 1500,
        httpMetadata: { contentType: 'application/pdf' },
        uploaded: new Date('2024-06-01'),
        etag: 'xyz',
      });

      const result = await adapter.head('doc.pdf');
      expect(result).not.toBeNull();
      expect(result!.key).toBe('doc.pdf');
      expect(result!.size).toBe(1500);
      expect(result!.contentType).toBe('application/pdf');
    });

    it('returns null for missing object', async () => {
      bucket.head.mockResolvedValueOnce(null);
      expect(await adapter.head('missing')).toBeNull();
    });
  });
});
