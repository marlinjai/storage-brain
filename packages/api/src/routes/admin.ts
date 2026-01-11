import { Hono } from 'hono';
import type { AppEnv } from '../env';
import { ApiError } from '../middleware/error-handler';
import {
  createTenantSchema,
  DEFAULT_QUOTA_BYTES,
  ALLOWED_MIME_TYPES,
  type AllowedMimeType,
} from '@storage-brain/shared';
import { createTenant, getTenantByName } from '../db/queries';
import { generateApiKey, hashApiKey } from '../utils/crypto';

export const adminRoutes = new Hono<AppEnv>();

/**
 * Admin authentication middleware
 * Checks for ADMIN_API_KEY in Authorization header
 */
adminRoutes.use('*', async (c, next) => {
  const adminKey = c.env.ADMIN_API_KEY;

  if (!adminKey) {
    throw ApiError.internal('Admin API key not configured');
  }

  const authHeader = c.req.header('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    throw ApiError.unauthorized('Missing or invalid Authorization header');
  }

  const providedKey = authHeader.slice(7);
  if (providedKey !== adminKey) {
    throw ApiError.unauthorized('Invalid admin API key');
  }

  await next();
});

/**
 * POST /api/v1/admin/tenants
 * Create a new tenant
 */
adminRoutes.post('/tenants', async (c) => {
  const body = await c.req.json();

  // Validate request body
  const validatedBody = createTenantSchema.parse(body);

  // Check if tenant name already exists
  const existingTenant = await getTenantByName(c.env.DB, validatedBody.name);
  if (existingTenant) {
    throw ApiError.conflict(`Tenant with name '${validatedBody.name}' already exists`);
  }

  // Generate API key
  const apiKey = generateApiKey();
  const apiKeyHash = await hashApiKey(apiKey);

  // Create tenant
  const tenantId = crypto.randomUUID();
  const allowedFileTypes = (validatedBody.allowedFileTypes as AllowedMimeType[] | undefined) ?? [...ALLOWED_MIME_TYPES];
  const quotaBytes = validatedBody.quotaBytes ?? DEFAULT_QUOTA_BYTES;

  await createTenant(c.env.DB, {
    id: tenantId,
    name: validatedBody.name,
    apiKeyHash,
    quotaBytes,
    allowedFileTypes,
  });

  return c.json(
    {
      id: tenantId,
      name: validatedBody.name,
      apiKey, // Only returned once at creation!
      quotaBytes,
      allowedFileTypes,
    },
    201
  );
});

/**
 * POST /api/v1/admin/tenants/:tenantId/regenerate-key
 * Regenerate API key for a tenant
 */
adminRoutes.post('/tenants/:tenantId/regenerate-key', async (c) => {
  const tenantId = c.req.param('tenantId');

  // Generate new API key
  const apiKey = generateApiKey();
  const apiKeyHash = await hashApiKey(apiKey);

  // Update tenant
  const result = await c.env.DB.prepare(
    'UPDATE tenants SET api_key_hash = ?, updated_at = ? WHERE id = ?'
  )
    .bind(apiKeyHash, Date.now(), tenantId)
    .run();

  if (result.meta.changes === 0) {
    throw ApiError.notFound('Tenant not found');
  }

  return c.json({
    tenantId,
    apiKey, // Only returned once!
    message: 'API key regenerated successfully. Store this key securely.',
  });
});
