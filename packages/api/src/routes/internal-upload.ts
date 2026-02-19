import { Hono } from 'hono';
import type { AppEnv } from '../env';
import {
  getFileByStoredPath,
  getFileById,
  getUploadSessionByFileId,
  updateUploadSessionStatus,
  updateFileSizeBytes,
  updateFileProcessingStatus,
} from '../db/queries';
import { uploadToR2 } from '../services/r2';
import { sendWebhook } from '../services/webhook';
import type { FileResponse } from '@storage-brain/shared';

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

  // Mark file as completed (no processing)
  await updateFileProcessingStatus(c.env.DB, file.id, 'completed');

  // Fire webhook if configured (non-blocking via waitUntil)
  if (file.webhookUrl) {
    const updatedFile = await getFileById(c.env.DB, file.id, file.tenantId);
    if (updatedFile) {
      const fileResponse: FileResponse = {
        id: updatedFile.id,
        url: `/api/v1/files/download/${encodeURIComponent(updatedFile.storedPath)}`,
        originalName: updatedFile.originalName,
        fileType: updatedFile.fileType,
        sizeBytes: updatedFile.sizeBytes,
        context: updatedFile.context,
        tags: updatedFile.tags,
        metadata: updatedFile.metadata,
        processingStatus: updatedFile.processingStatus,
        createdAt: new Date(updatedFile.createdAt).toISOString(),
      };

      c.executionCtx.waitUntil(
        sendWebhook({
          fileId: updatedFile.id,
          tenantId: updatedFile.tenantId,
          file: fileResponse,
          webhookUrl: file.webhookUrl,
          event: 'file.uploaded',
        })
      );
    }
  }

  return c.json({
    status: 'completed',
    fileId: file.id,
    sizeBytes: actualSize,
  });
});
