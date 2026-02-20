import type { WebhookPayload, FileResponse } from '@storage-brain/shared';
import { RETRY_CONFIG } from '@storage-brain/shared';

interface WebhookInput {
  fileId: string;
  tenantId: string;
  workspaceId?: string | null;
  file: FileResponse;
  webhookUrl: string;
  event: WebhookPayload['event'];
}

/**
 * Send a webhook notification with retry logic.
 * Returns true if the webhook was delivered successfully, false otherwise.
 */
export async function sendWebhook(input: WebhookInput): Promise<boolean> {
  const { fileId, tenantId, workspaceId, file, webhookUrl, event } = input;

  const payload: WebhookPayload = {
    event,
    fileId,
    tenantId,
    workspaceId: workspaceId ?? null,
    file,
    timestamp: new Date().toISOString(),
  };

  for (let attempt = 0; attempt < RETRY_CONFIG.maxAttempts; attempt++) {
    try {
      const response = await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (response.ok) {
        console.log(`Webhook delivered successfully for file ${fileId}`);
        return true;
      }

      console.warn(
        `Webhook attempt ${attempt + 1} failed with status ${response.status} for file ${fileId}`
      );
    } catch (fetchError) {
      console.warn(`Webhook attempt ${attempt + 1} failed for file ${fileId}:`, fetchError);
    }

    // Exponential backoff (skip delay after the last attempt)
    if (attempt < RETRY_CONFIG.maxAttempts - 1) {
      const delay = Math.min(
        RETRY_CONFIG.initialDelayMs * Math.pow(RETRY_CONFIG.backoffMultiplier, attempt),
        RETRY_CONFIG.maxDelayMs
      );
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  console.error(`All webhook attempts failed for file ${fileId}`);
  return false;
}
