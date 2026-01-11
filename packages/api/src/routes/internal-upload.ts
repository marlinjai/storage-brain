import { Hono } from 'hono';
import type { AppEnv } from '../env';
import {
  getFileByStoredPath,
  getUploadSessionByFileId,
  updateUploadSessionStatus,
  updateFileSizeBytes,
  updateFileProcessingStatus,
} from '../db/queries';
import { uploadToR2 } from '../services/r2';
import type { ProcessingQueueMessage } from '@storage-brain/shared';

export const internalUploadRoutes = new Hono<AppEnv>();

/**
 * PUT /_internal/upload/:storedPath
 * Receives file data and uploads it to R2
 * The storedPath is URL-encoded in the path parameter
 */
internalUploadRoutes.put('/upload/*', async (c) => {
  // Extract the stored path from the URL (everything after /upload/)
  const fullPath = c.req.path;
  const storedPathEncoded = fullPath.replace('/_internal/upload/', '');
  const storedPath = decodeURIComponent(storedPathEncoded);

  if (!storedPath) {
    return c.json({ error: 'Missing storage path' }, 400);
  }

  // Get the file record by stored path
  const file = await getFileByStoredPath(c.env.DB, storedPath);
  if (!file) {
    return c.json({ error: 'File record not found' }, 404);
  }

  // Get the upload session
  const session = await getUploadSessionByFileId(c.env.DB, file.id);
  if (!session) {
    return c.json({ error: 'Upload session not found' }, 404);
  }

  // Check if session is expired
  if (Date.now() > session.expiresAt) {
    await updateUploadSessionStatus(c.env.DB, session.id, 'expired');
    return c.json({ error: 'Upload session expired' }, 410);
  }

  // Check if session is still pending
  if (session.status !== 'pending') {
    return c.json({ error: `Upload session already ${session.status}` }, 409);
  }

  // Get the content type from request header (fallback to file record)
  const contentType = c.req.header('Content-Type') ?? file.fileType;

  // Get the request body as ArrayBuffer
  const body = await c.req.arrayBuffer();
  const actualSize = body.byteLength;

  if (actualSize === 0) {
    return c.json({ error: 'Empty file body' }, 400);
  }

  // Upload to R2
  await uploadToR2(c.env.BUCKET, storedPath, body, contentType);

  // Update file size in database (use actual uploaded size)
  await updateFileSizeBytes(c.env.DB, file.id, actualSize);

  // Update upload session status
  await updateUploadSessionStatus(c.env.DB, session.id, 'completed');

  // Queue for processing if queue is available
  if (c.env.PROCESSING_QUEUE) {
    const message: ProcessingQueueMessage = {
      fileId: file.id,
      tenantId: file.tenantId,
      context: file.context,
      storedPath: file.storedPath,
      fileType: file.fileType,
    };

    await c.env.PROCESSING_QUEUE.send(message);
    console.log(`Queued file for processing: ${file.id}`);

    return c.json({
      status: 'queued',
      fileId: file.id,
      sizeBytes: actualSize,
    });
  }

  // No queue available - mark as completed immediately
  await updateFileProcessingStatus(c.env.DB, file.id, 'completed');
  console.log(`File upload completed (no queue): ${file.id}`);

  return c.json({
    status: 'completed',
    fileId: file.id,
    sizeBytes: actualSize,
  });
});
