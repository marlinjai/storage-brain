import { Hono } from 'hono';
import type { AppEnv } from '../env';
import { getUploadSessionByFileId, updateUploadSessionStatus, getFileById, updateFileProcessingStatus } from '../db/queries';
import type { ProcessingQueueMessage } from '@storage-brain/shared';

export const webhookRoutes = new Hono<AppEnv>();

/**
 * POST /webhooks/r2-upload-complete
 * Called by R2 when a file upload completes
 * Note: R2 event notifications must be configured to call this endpoint
 */
webhookRoutes.post('/r2-upload-complete', async (c) => {
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
  const session = await getUploadSessionByFileId(c.env.DB, fileId);
  if (!session) {
    console.warn(`No upload session found for file: ${fileId}`);
    return c.json({ status: 'ignored' });
  }

  // Update session status
  await updateUploadSessionStatus(c.env.DB, session.id, 'completed');

  // Get file record to queue processing
  const file = await getFileById(c.env.DB, fileId, tenantId);
  if (!file) {
    console.error(`File record not found: ${fileId}`);
    return c.json({ error: 'File record not found' }, 404);
  }

  // Queue file for processing (if queue is available)
  if (c.env.PROCESSING_QUEUE) {
    const message: ProcessingQueueMessage = {
      fileId: file.id,
      tenantId: file.tenantId,
      context: file.context,
      storedPath: file.storedPath,
      fileType: file.fileType,
      // webhookUrl is stored in file metadata if provided
    };

    await c.env.PROCESSING_QUEUE.send(message);
    console.log(`Queued file for processing: ${fileId}`);
    return c.json({ status: 'queued', fileId });
  }

  // No queue available - mark as completed without processing
  console.log(`Queue not available, marking file as completed: ${fileId}`);
  await updateFileProcessingStatus(c.env.DB, file.id, 'completed');
  return c.json({ status: 'completed', fileId, note: 'Processing queue not available' });
});
