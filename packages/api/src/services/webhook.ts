import type { WebhookPayload, FileResponse } from '@storage-brain/shared';
import { RETRY_CONFIG } from '@storage-brain/shared';

/**
 * Minimum length for `R2_WEBHOOK_SIGNING_SECRET`. A too-short secret is treated
 * as a misconfiguration (the route fails closed with 500), not a runtime auth
 * failure, so a weak secret can never silently protect the webhook.
 */
export const MIN_WEBHOOK_SECRET_LENGTH = 16;

/** HMAC-SHA256 over `rawBody` with `secret`, returned as a lowercase hex digest. */
export async function signWebhookBody(rawBody: string, secret: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(rawBody));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Verify a webhook's hex `signature` against HMAC-SHA256(rawBody, secret) using
 * `crypto.subtle.verify`, which compares in constant time (no early-exit byte
 * comparison). Returns false for a malformed hex signature rather than throwing.
 */
export async function verifyWebhookSignature(
  rawBody: string,
  signature: string,
  secret: string
): Promise<boolean> {
  if (!/^[0-9a-f]+$/i.test(signature) || signature.length % 2 !== 0) {
    return false;
  }
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['verify']
  );
  const sigBytes = new Uint8Array(signature.length / 2);
  for (let i = 0; i < signature.length; i += 2) {
    sigBytes[i / 2] = parseInt(signature.substring(i, i + 2), 16);
  }
  return crypto.subtle.verify('HMAC', key, sigBytes, enc.encode(rawBody));
}

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
