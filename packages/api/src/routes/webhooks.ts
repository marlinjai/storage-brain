import { Hono } from 'hono';
import type { AppEnv } from '../env';
import {
  sendWebhook,
  verifyWebhookSignature,
  MIN_WEBHOOK_SECRET_LENGTH,
} from '../services/webhook';
import type { FileResponse } from '@storage-brain/shared';

export const webhookRoutes = new Hono<AppEnv>();

/**
 * POST /webhooks/r2-upload-complete
 *
 * Caller (finding 3): our own R2 event-notification pipeline. R2 does not POST
 * to HTTP endpoints directly; it delivers object-created events to a
 * Cloudflare Queue, and a queue-consumer Worker we control forwards each event
 * to this route. Because that consumer is internal and holds our secrets, it
 * CAN sign, so we gate on a real signature rather than a shared bearer token:
 * the consumer computes HMAC-SHA256 over the exact raw request body with
 * `R2_WEBHOOK_SIGNING_SECRET` and sends the lowercase hex digest in the
 * `X-Webhook-Signature` header.
 *
 * Fail-closed contract:
 *   - env unset / secret shorter than MIN_WEBHOOK_SECRET_LENGTH -> 500 (misconfig)
 *   - missing or invalid signature                             -> 401
 * Only a request whose signature verifies against the raw body is processed.
 */
webhookRoutes.post('/r2-upload-complete', async (c) => {
  const db = c.get('db');

  // --- Signature gate (must run before any body parsing / side effects) ---
  const signingSecret = c.env.R2_WEBHOOK_SIGNING_SECRET;
  if (!signingSecret || signingSecret.length < MIN_WEBHOOK_SECRET_LENGTH) {
    // Misconfiguration, not a caller error: never process an unsigned webhook.
    console.error('R2 webhook rejected: signing secret unset or too short');
    return c.json({ error: 'Webhook signing is not configured' }, 500);
  }

  // Read the RAW body exactly as sent; the HMAC is computed over these bytes,
  // so we must not re-serialize before verifying.
  const rawBody = await c.req.text();
  const signature = c.req.header('X-Webhook-Signature');
  if (!signature) {
    return c.json({ error: 'Missing webhook signature' }, 401);
  }

  const signatureValid = await verifyWebhookSignature(rawBody, signature, signingSecret);
  if (!signatureValid) {
    return c.json({ error: 'Invalid webhook signature' }, 401);
  }

  let body: unknown;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return c.json({ error: 'Invalid webhook payload' }, 400);
  }

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
      url: `/api/v1/files/${file.id}/download`,
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
