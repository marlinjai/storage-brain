import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import type {
  StorageAdapter,
  StorageObject,
  PutOptions,
  GetResult,
  PresignedUrlOptions,
} from '@storage-brain/shared';

export interface S3StorageAdapterConfig {
  bucket: string;
  region: string;
  endpoint?: string;
  credentials: {
    accessKeyId: string;
    secretAccessKey: string;
  };
  forcePathStyle?: boolean;
}

export class S3StorageAdapter implements StorageAdapter {
  private client: S3Client;
  private bucket: string;

  constructor(config: S3StorageAdapterConfig) {
    this.bucket = config.bucket;
    this.client = new S3Client({
      region: config.region,
      endpoint: config.endpoint,
      credentials: config.credentials,
      forcePathStyle: config.forcePathStyle ?? !!config.endpoint,
    });
  }

  async put(
    key: string,
    data: ReadableStream | ArrayBuffer,
    options: PutOptions,
  ): Promise<StorageObject> {
    // S3 SDK needs Buffer/Uint8Array; convert ReadableStream if needed
    let body: Uint8Array;
    if (data instanceof ArrayBuffer) {
      body = new Uint8Array(data);
    } else {
      const reader = (data as ReadableStream<Uint8Array>).getReader();
      const chunks: Uint8Array[] = [];
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
      }
      const totalLength = chunks.reduce((acc, c) => acc + c.length, 0);
      body = new Uint8Array(totalLength);
      let offset = 0;
      for (const chunk of chunks) {
        body.set(chunk, offset);
        offset += chunk.length;
      }
    }

    const command = new PutObjectCommand({
      Bucket: this.bucket,
      Key: key,
      Body: body,
      ContentType: options.contentType,
    });

    const result = await this.client.send(command);

    return {
      key,
      size: body.length,
      contentType: options.contentType,
      lastModified: new Date(),
      etag: result.ETag?.replace(/"/g, ''),
    };
  }

  async get(key: string): Promise<GetResult | null> {
    try {
      const command = new GetObjectCommand({
        Bucket: this.bucket,
        Key: key,
      });

      const result = await this.client.send(command);

      if (!result.Body) return null;

      return {
        body: result.Body.transformToWebStream(),
        contentType: result.ContentType ?? 'application/octet-stream',
        size: result.ContentLength ?? 0,
        etag: result.ETag?.replace(/"/g, ''),
      };
    } catch (err: unknown) {
      if (isNoSuchKey(err)) return null;
      throw err;
    }
  }

  async delete(key: string): Promise<void> {
    const command = new DeleteObjectCommand({
      Bucket: this.bucket,
      Key: key,
    });
    await this.client.send(command);
  }

  async exists(key: string): Promise<boolean> {
    return (await this.head(key)) !== null;
  }

  async head(key: string): Promise<StorageObject | null> {
    try {
      const command = new HeadObjectCommand({
        Bucket: this.bucket,
        Key: key,
      });

      const result = await this.client.send(command);

      return {
        key,
        size: result.ContentLength ?? 0,
        contentType: result.ContentType ?? 'application/octet-stream',
        lastModified: result.LastModified ?? new Date(),
        etag: result.ETag?.replace(/"/g, ''),
      };
    } catch (err: unknown) {
      if (isNotFound(err)) return null;
      throw err;
    }
  }

  async getPresignedUploadUrl(
    key: string,
    options: PresignedUrlOptions,
  ): Promise<string> {
    const command = new PutObjectCommand({
      Bucket: this.bucket,
      Key: key,
      ContentType: options.contentType,
    });

    return getSignedUrl(this.client, command, {
      expiresIn: options.expiresIn,
    });
  }

  async getPresignedDownloadUrl(
    key: string,
    options: PresignedUrlOptions,
  ): Promise<string> {
    const command = new GetObjectCommand({
      Bucket: this.bucket,
      Key: key,
    });

    return getSignedUrl(this.client, command, {
      expiresIn: options.expiresIn,
    });
  }
}

function isNoSuchKey(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'name' in err &&
    (err as { name: string }).name === 'NoSuchKey'
  );
}

function isNotFound(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'name' in err &&
    ((err as { name: string }).name === 'NotFound' ||
      (err as { name: string }).name === 'NoSuchKey' ||
      ('$metadata' in err &&
        typeof (err as Record<string, unknown>).$metadata === 'object' &&
        (err as { $metadata: { httpStatusCode?: number } }).$metadata
          .httpStatusCode === 404))
  );
}
