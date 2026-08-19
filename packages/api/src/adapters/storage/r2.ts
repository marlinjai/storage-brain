import type { R2Bucket } from '@cloudflare/workers-types';
import type {
  StorageAdapter,
  StorageObject,
  PutOptions,
  GetResult,
  ByteRange,
} from '@storage-brain/shared';

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

  async get(key: string, range?: ByteRange): Promise<GetResult | null> {
    const object = await this.bucket.get(
      key,
      range
        ? {
            // R2 takes an offset plus a LENGTH; the interface's `end` is
            // inclusive, so the length is end - start + 1. An absent `end`
            // means "to the end", which R2 expresses by omitting length.
            range: {
              offset: range.start,
              ...(range.end !== undefined ? { length: range.end - range.start + 1 } : {}),
            },
          }
        : undefined,
    );
    if (!object) return null;

    // `object.size` is the full object size even on a partial read, so it is the
    // total. Only claim a range when R2 reports having served one.
    const served = servedRange(object.range, object.size);

    return {
      body: object.body,
      contentType: object.httpMetadata?.contentType ?? 'application/octet-stream',
      size: object.size,
      etag: object.etag,
      ...(served ? { range: served } : {}),
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

/**
 * Normalise R2's reported range into inclusive start/end plus the total size.
 *
 * R2 expresses a range as offset+length, or as a suffix ("last N bytes").
 * Returns null when no range was served, so the caller never advertises a
 * partial response it did not make.
 */
function servedRange(
  range: { offset?: number; length?: number; suffix?: number } | undefined,
  total: number,
): { start: number; end: number; total: number } | null {
  if (!range) return null;
  if (typeof range.suffix === 'number') {
    const start = Math.max(0, total - range.suffix);
    return { start, end: total - 1, total };
  }
  const start = range.offset ?? 0;
  const length = range.length ?? total - start;
  // Clamp: a length running past the object end still ends at the last byte.
  const end = Math.min(total - 1, start + length - 1);
  return { start, end, total };
}

