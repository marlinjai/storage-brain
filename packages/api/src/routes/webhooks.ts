import { Hono } from 'hono';
import type { AppEnv } from '../env';
import { sendWebhook } from '../services/webhook';
import type { FileResponse } from '@storage-brain/shared';

export const webhookRoutes = new Hono<AppEnv>();

/**
 * POST /webhooks/r2-upload-complete
 * Called by R2 when a file upload completes
 * Note: R2 event notifications must be configured to call this endpoint
 */
webhookRoutes.post('/r2-upload-complete', async (c) => {
  const db = c.get('db');
  const body = await c.req.json();

  // R2 event notification payload structure
  // https://developers.cloudflare.com/r2/buckets/event-notifications/
  const { object } = body as { object?: { key?: string } };

  if (!object?.key) {
    return c.json({ error: 'Invalid webhook payload' }, 400);
  }

  const storedPath = object.key;

  // Extract file ID from path: tenants/{tenantId}/files/{fileId}/{fileName}
  const pathParts = storedPath.split('/');
  if (pathParts.length < 4 || pathParts[0] !== 'tenants' || pathParts[2] !== 'files') {
    console.warn(`Ignoring upload for non-standard path: ${storedPath}`);
    return c.json({ status: 'ignored' });
  }

  const tenantId = pathParts[1];
  const fileId = pathParts[3];

  if (!tenantId || !fileId) {
    console.warn(`Could not extract tenant/file ID from path: ${storedPath}`);
    return c.json({ status: 'ignored' });
  }

  // Get upload session
  const session = await db.getUploadSessionByFileId(fileId);
  if (!session) {
    console.warn(`No upload session found for file: ${fileId}`);
    return c.json({ status: 'ignored' });
  }

  // Update session status
  await db.updateUploadSessionStatus(session.id, 'completed');

  // Get file record
  const file = await db.getFileById(fileId, tenantId);
  if (!file) {
    console.error(`File record not found: ${fileId}`);
    return c.json({ error: 'File record not found' }, 404);
  }

  // Mark file as completed immediately
  await db.updateFileProcessingStatus(file.id, 'completed');
  console.log(`File marked as completed: ${fileId}`);

  // Fire webhook if configured (non-blocking via waitUntil)
  if (file.webhookUrl) {
    const fileResponse: FileResponse = {
      id: file.id,
      url: `/api/v1/files/download/${encodeURIComponent(file.storedPath)}`,
      originalName: file.originalName,
      fileType: file.fileType,
      sizeBytes: file.sizeBytes,
      context: file.context,
      tags: file.tags,
      metadata: file.metadata,
      processingStatus: 'completed',
      workspaceId: file.workspaceId,
      createdAt: new Date(file.createdAt).toISOString(),
    };

    c.executionCtx.waitUntil(
      sendWebhook({
        fileId: file.id,
        tenantId: file.tenantId,
        workspaceId: file.workspaceId,
        file: fileResponse,
        webhookUrl: file.webhookUrl,
        event: 'file.uploaded',
      })
    );
  }

  return c.json({ status: 'completed', fileId });
});
