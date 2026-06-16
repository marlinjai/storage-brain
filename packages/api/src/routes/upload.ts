import { Hono } from 'hono';
import type { AppEnv } from '../env';
import { authMiddleware } from '../middleware/auth';
import { requestUpload } from '../lib/upload/request-upload';

export const uploadRoutes = new Hono<AppEnv>();

// Apply auth middleware to all routes
uploadRoutes.use('*', authMiddleware);

/**
 * POST /api/v1/upload/request
 * Request a presigned URL for file upload.
 *
 * Tenant is resolved from the API key by authMiddleware. The validation,
 * quota, and handshake logic is shared with the admin-scoped upload route via
 * `requestUpload` so the two routes can never drift.
 */
uploadRoutes.post('/request', async (c) => {
  const tenant = c.get('tenant');
  const db = c.get('db');
  const body = await c.req.json();

  const handshake = await requestUpload({
    db,
    tenant,
    body,
    urlSigningSecret: c.env.URL_SIGNING_SECRET,
  });

  return c.json(handshake);
});
