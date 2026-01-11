import type { R2Bucket } from '@cloudflare/workers-types';
import { PRESIGNED_URL_EXPIRATION_SECONDS } from '@storage-brain/shared';

interface PresignedUrlResult {
  presignedUrl: string;
  expiresAt: number;
}

/**
 * Generate a presigned URL for uploading a file to R2
 *
 * Note: R2 presigned URLs are generated differently from S3.
 * We create a URL that the client can PUT to directly.
 */
export async function generatePresignedUrl(
  _bucket: R2Bucket,
  key: string
): Promise<PresignedUrlResult> {
  // Calculate expiration
  const expiresAt = Date.now() + PRESIGNED_URL_EXPIRATION_SECONDS * 1000;

  // For R2, we need to use the createMultipartUpload or provide a custom signing approach
  // Since R2 doesn't have native presigned URL support like S3, we'll use a different approach:
  // We'll create a temporary upload endpoint that the client calls, which then uploads to R2

  // For MVP, we'll return a URL to our own upload endpoint
  // The client will upload to our worker, which will stream to R2
  // This is simpler but means data goes through our worker

  // TODO: For production, implement true presigned URLs using custom signing
  // or use Cloudflare's upcoming presigned URL feature for R2

  // For now, return a placeholder URL that points to our upload confirmation endpoint
  const presignedUrl = `/_internal/upload/${encodeURIComponent(key)}`;

  return {
    presignedUrl,
    expiresAt,
  };
}

/**
 * Upload a file to R2
 */
export async function uploadToR2(
  bucket: R2Bucket,
  key: string,
  data: ReadableStream | ArrayBuffer | string,
  contentType: string
): Promise<void> {
  await bucket.put(key, data, {
    httpMetadata: {
      contentType,
    },
  });
}

/**
 * Get an object from R2
 */
export async function getFromR2(
  bucket: R2Bucket,
  key: string
): Promise<R2ObjectBody | null> {
  return bucket.get(key);
}

/**
 * Delete an object from R2
 */
export async function deleteFromR2(bucket: R2Bucket, key: string): Promise<void> {
  await bucket.delete(key);
}

/**
 * Get the public URL for a file
 * Note: This requires the bucket to have public access enabled
 * or you need to configure a custom domain
 */
export function getPublicUrl(_bucket: R2Bucket, key: string): string {
  // For MVP, return a URL to our worker that will serve the file
  // In production, configure R2 public access or custom domain
  return `/api/v1/files/download/${encodeURIComponent(key)}`;
}

/**
 * Check if an object exists in R2
 */
export async function existsInR2(bucket: R2Bucket, key: string): Promise<boolean> {
  const head = await bucket.head(key);
  return head !== null;
}

/**
 * Get object metadata from R2
 */
export async function getR2ObjectMetadata(
  bucket: R2Bucket,
  key: string
): Promise<R2Object | null> {
  return bucket.head(key);
}
