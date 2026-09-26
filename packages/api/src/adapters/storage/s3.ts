import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { NodeHttpHandler } from '@smithy/node-http-handler';
import type {
  StorageAdapter,
  StorageObject,
  PutOptions,
  GetResult,
  ByteRange,
  GetOptions,
  PresignedUrlOptions,
} from '@storage-brain/shared';
import { guardBody } from '../../utils/guard-body';

export interface S3StorageAdapterConfig {
  bucket: string;
  region: string;
  endpoint?: string;
  credentials: {
    accessKeyId: string;
    secretAccessKey: string;
  };
  forcePathStyle?: boolean;
  /** Overrides BODY_IDLE_TIMEOUT_MS (tests). */
  bodyIdleTimeoutMs?: number;
}

// What each NodeHttpHandler option really does in @smithy/node-http-handler 4.x
// (read from its source, because the names mislead):
//
// - connectionTimeout: how long a request may wait for its socket to CONNECT.
//   The clock starts when the request is created, so a request queued behind a
//   full pool also hits it. That is the `did not establish a connection ...
//   within 5000 ms` error of the 2026-09-26 incident: the pool was full, not
//   the backend down.
// - requestTimeout: a wall clock on getting the RESPONSE HEADERS. Without
//   throwOnRequestTimeout it only logs a warning and the request keeps its
//   socket; with it the request is destroyed and the socket freed. The timer is
//   cleared as soon as headers arrive, so it never cuts a long body short.
// - Nothing in the handler watches the BODY. Once headers are in, a body that
//   nobody reads or destroys pins its socket for the life of the process. That
//   is what exhausted all 300 sockets on 2026-09-26 (the 2026-09-11 incident
//   had the same signature). Bodies are therefore guarded in get() below: released
//   on client abort and after BODY_IDLE_TIMEOUT_MS without progress.
//   (`socketTimeout` is no substitute: values of 6000 ms or more are armed on a
//   deferral that a fast response cancels, and smaller ones would cut off any
//   consumer that pauses for a few seconds.)
//
// A timeout turns a silent hang into a normal, retryable failure, which is what
// makes 300 concurrent sockets safe instead of 300 ways to wedge.
const REQUEST_HANDLER = new NodeHttpHandler({
  connectionTimeout: 5_000,
  requestTimeout: 30_000,
  throwOnRequestTimeout: true,
  socketAcquisitionWarningTimeout: 5_000,
  httpAgent: { maxSockets: 300 },
  httpsAgent: { maxSockets: 300 },
});

/**
 * How long a GetObject body may make no progress (no chunk passed from the
 * backend to the client) before it is released. Matches the nginx
 * proxy_send_timeout default.
 * A paused `<video>` that trips it simply re-requests with Range on resume.
 */
export const BODY_IDLE_TIMEOUT_MS = 60_000;

export class S3StorageAdapter implements StorageAdapter {
  private client: S3Client;
  private bucket: string;
  private bodyIdleTimeoutMs: number;

  constructor(config: S3StorageAdapterConfig) {
    this.bucket = config.bucket;
    this.bodyIdleTimeoutMs = config.bodyIdleTimeoutMs ?? BODY_IDLE_TIMEOUT_MS;
    this.client = new S3Client({
      region: config.region,
      endpoint: config.endpoint,
      credentials: config.credentials,
      forcePathStyle: config.forcePathStyle ?? !!config.endpoint,
      requestHandler: REQUEST_HANDLER,
    });
  }

  async put(
    key: string,
    data: ReadableStream | ArrayBuffer,
    options: PutOptions
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

  async get(key: string, range?: ByteRange, options?: GetOptions): Promise<GetResult | null> {
    try {
      const command = new GetObjectCommand({
        Bucket: this.bucket,
        Key: key,
        // RFC 9110 byte range. An open-ended request is `bytes=<start>-`.
        ...(range ? { Range: `bytes=${range.start}-${range.end ?? ''}` } : {}),
      });

      // The signal also takes a request that is still queued for a socket out
      // of the queue once its client has gone.
      const result = await this.client.send(command, { abortSignal: options?.signal });

      if (!result.Body) return null;

      // Trust the RESPONSE, not the request: `range` is reported only when S3
      // actually answered with a partial body (206 + Content-Range). If it
      // ignored the header, ContentRange is absent and the caller correctly
      // treats this as a whole-object response.
      const served = parseContentRange(result.ContentRange);

      return {
        // Guarded so the socket behind it is released on every path, not only
        // when the body is read to the end (see REQUEST_HANDLER above).
        body: guardBody(result.Body.transformToWebStream() as ReadableStream<Uint8Array>, {
          signal: options?.signal,
          idleTimeoutMs: this.bodyIdleTimeoutMs,
        }),
        contentType: result.ContentType ?? 'application/octet-stream',
        // On a partial read ContentLength is the length of the SLICE, so the
        // total has to come from Content-Range.
        size: served?.total ?? result.ContentLength ?? 0,
        etag: result.ETag?.replace(/"/g, ''),
        ...(served ? { range: served } : {}),
      };
    } catch (err: unknown) {
      if (isNoSuchKey(err)) return null;
      // The route decides satisfiability from the SIZE ON THE DATABASE ROW. If
      // that has drifted from the object actually in the bucket, S3 rejects the
      // range and this would surface as a 500 on an ordinary video request,
      // which is a miserable thing to debug. Fall back to reading the whole
      // object and report no range, so the caller answers a truthful 200.
      if (isInvalidRange(err) && range) return this.get(key, undefined, options);
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

  async getPresignedUploadUrl(key: string, options: PresignedUrlOptions): Promise<string> {
    const command = new PutObjectCommand({
      Bucket: this.bucket,
      Key: key,
      ContentType: options.contentType,
    });

    return getSignedUrl(this.client, command, {
      expiresIn: options.expiresIn,
    });
  }

  async getPresignedDownloadUrl(key: string, options: PresignedUrlOptions): Promise<string> {
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
        (err as { $metadata: { httpStatusCode?: number } }).$metadata.httpStatusCode === 404))
  );
}

/**
 * Parse an S3 `Content-Range: bytes <start>-<end>/<total>` response header.
 *
 * Returns null for an absent or unparseable header, and for the `*` total form,
 * so a caller can never mistake an unknown range for a served one.
 */
function parseContentRange(
  header: string | undefined
): { start: number; end: number; total: number } | null {
  if (!header) return null;
  const match = /^bytes\s+(\d+)-(\d+)\/(\d+)$/.exec(header.trim());
  if (!match) return null;
  const [, start, end, total] = match;
  return { start: Number(start), end: Number(end), total: Number(total) };
}

function isInvalidRange(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'name' in err &&
    ((err as { name: string }).name === 'InvalidRange' ||
      ('$metadata' in err &&
        typeof (err as Record<string, unknown>).$metadata === 'object' &&
        (err as { $metadata: { httpStatusCode?: number } }).$metadata.httpStatusCode === 416))
  );
}
