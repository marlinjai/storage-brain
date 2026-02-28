import type { R2Bucket } from '@cloudflare/workers-types';
import type { StorageAdapter, StorageObject, PutOptions, GetResult } from '@storage-brain/shared';

export class R2StorageAdapter implements StorageAdapter {
  constructor(private bucket: R2Bucket) {}

  async put(key: string, data: ReadableStream | ArrayBuffer, options: PutOptions): Promise<StorageObject> {
    const result = await this.bucket.put(key, data, {
      httpMetadata: {
        contentType: options.contentType,
      },
    });

    return {
      key,
      size: result?.size ?? 0,
      contentType: options.contentType,
      lastModified: result?.uploaded ?? new Date(),
      etag: result?.etag,
    };
  }

  async get(key: string): Promise<GetResult | null> {
    const object = await this.bucket.get(key);
    if (!object) return null;

    return {
      body: object.body,
      contentType: object.httpMetadata?.contentType ?? 'application/octet-stream',
      size: object.size,
      etag: object.etag,
    };
  }

  async delete(key: string): Promise<void> {
    await this.bucket.delete(key);
  }

  async exists(key: string): Promise<boolean> {
    const head = await this.bucket.head(key);
    return head !== null;
  }

  async head(key: string): Promise<StorageObject | null> {
    const object = await this.bucket.head(key);
    if (!object) return null;

    return {
      key,
      size: object.size,
      contentType: object.httpMetadata?.contentType ?? 'application/octet-stream',
      lastModified: object.uploaded,
      etag: object.etag,
    };
  }
}
