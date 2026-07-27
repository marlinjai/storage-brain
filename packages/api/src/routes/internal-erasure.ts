import { Hono } from 'hono';
import type { AppEnv } from '../env';
import { ApiError } from '../middleware/error-handler';
import { verifyErasureSignature, ERASURE_SIGNATURE_HEADER } from '../lib/erasure/signature';
import { erasureWebhookPayloadSchema } from '../lib/erasure/schema';
import { processErasure } from '../lib/erasure/process';

export const internalErasureRoutes = new Hono<AppEnv>();

/**
 * POST /api/v1/internal/erasure
 *
 * Consumes auth-brain's signed GDPR erasure webhook (company-isolation S4). Same
 * contract as the Studio/analytics consumers:
 *   - authenticated ONLY by the `x-lumitra-erasure-signature` HMAC over the raw
 *     body (this route bypasses the tenant Bearer middleware, never the
 *     signature); the secret is `STORAGE_ERASURE_WEBHOOK_SECRET`,
 *   - fail-closed: unconfigured secret -> 500, bad/missing signature -> 401,
 *   - idempotent by `event_id`: a replay of an already-processed delivery is a
 *     no-op success,
 *   - acks 2xx ONLY after ALL work is done; any storage/DB failure returns a
 *     retryable 5xx and does NOT record the delivery, so auth-brain retries and
 *     the idempotent handler reprocesses.
 *
 * Never logs the request body, secret, or signature.
 */
internalErasureRoutes.post('/erasure', async (c) => {
  const secret = c.env.STORAGE_ERASURE_WEBHOOK_SECRET;
  // Fail closed: an unconfigured secret can never become an accepted erasure.
  if (!secret) {
    console.error(
      '[erasure] STORAGE_ERASURE_WEBHOOK_SECRET is not configured; rejecting delivery'
    );
    throw ApiError.internal('Erasure webhook secret is not configured');
  }

  // Verify over the EXACT raw bytes received, not a re-serialized object.
  const rawBody = await c.req.text();
  const signature = c.req.header(ERASURE_SIGNATURE_HEADER);
  const valid = await verifyErasureSignature(rawBody, signature, secret);
  if (!valid) {
    throw ApiError.unauthorized('Invalid erasure webhook signature');
  }

  // A signed-but-malformed body is a sender bug, not a transient failure: 400
  // (a retry cannot fix it) rather than a retryable 5xx.
  let json: unknown;
  try {
    json = JSON.parse(rawBody);
  } catch {
    throw ApiError.badRequest('Erasure webhook body is not valid JSON');
  }
  const parsed = erasureWebhookPayloadSchema.safeParse(json);
  if (!parsed.success) {
    throw ApiError.badRequest('Erasure webhook payload failed validation');
  }
  const payload = parsed.data;

  const db = c.get('db');
  const storage = c.get('storage');

  // Idempotency: a delivery we already fully processed is a no-op success.
  const existing = await db.getErasureEvent(payload.event_id);
  if (existing) {
    return c.json({ status: 'ok', idempotent: true });
  }

  // Do ALL the work first. Throws on any storage/DB error -> 5xx -> retry.
  const result = await processErasure({ db, storage, payload });

  // Record only after the work succeeded, so a failed attempt leaves no ledger
  // row and the retry reprocesses (object deletes + deleteTenant are idempotent).
  await db.recordErasureEvent({
    eventId: payload.event_id,
    kind: payload.kind,
    authTenantId: payload.tenant_id ?? null,
    matchedTenantCount: result.matchedTenantIds.length,
    processedAt: Date.now(),
  });

  // Ack only now that every object + row is gone and the ledger is written.
  return c.json({ status: 'ok', idempotent: false });
});
