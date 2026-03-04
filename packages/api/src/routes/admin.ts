import { Hono } from 'hono';
import type { AppEnv } from '../env';
import { ApiError } from '../middleware/error-handler';
import { createAdminAuthMiddleware } from '@marlinjai/brain-core';
import {
  createTenantSchema,
  updateTenantSchema,
  listTenantsQuerySchema,
  DEFAULT_QUOTA_BYTES,
  ALLOWED_MIME_TYPES,
  type AllowedMimeType,
} from '@storage-brain/shared';
import { generateApiKey, hashApiKey } from '../utils/crypto';

export const adminRoutes = new Hono<AppEnv>();

/**
 * Admin authentication middleware
 * Uses timing-safe comparison from brain-core
 */
adminRoutes.use('*', createAdminAuthMiddleware());

/**
 * POST /api/v1/admin/tenants
 * Create a new tenant
 */
adminRoutes.post('/tenants', async (c) => {
  const db = c.get('db');
  const body = await c.req.json();

  // Validate request body
  const validatedBody = createTenantSchema.parse(body);

  // Check if tenant name already exists
  const existingTenant = await db.getTenantByName(validatedBody.name);
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

  await db.createTenant({
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
  const db = c.get('db');
  const tenantId = c.req.param('tenantId');

  // Generate new API key
  const apiKey = generateApiKey();
  const apiKeyHash = await hashApiKey(apiKey);

  // Update tenant
  const updated = await db.updateTenantApiKeyHash(tenantId, apiKeyHash);

  if (!updated) {
    throw ApiError.notFound('Tenant not found');
  }

  return c.json({
    tenantId,
    apiKey, // Only returned once!
    message: 'API key regenerated successfully. Store this key securely.',
  });
});

/**
 * GET /api/v1/admin/tenants
 * List all tenants with pagination
 */
adminRoutes.get('/tenants', async (c) => {
  const db = c.get('db');
  const query = listTenantsQuerySchema.parse({
    limit: c.req.query('limit'),
    cursor: c.req.query('cursor'),
  });

  const result = await db.listTenants(query);

  return c.json({
    tenants: result.tenants.map((t) => ({
      id: t.id,
      name: t.name,
      quotaBytes: t.quotaBytes,
      usedBytes: t.usedBytes,
      allowedFileTypes: t.allowedFileTypes,
      createdAt: t.createdAt,
      updatedAt: t.updatedAt,
    })),
    nextCursor: result.nextCursor,
    total: result.total,
  });
});

/**
 * GET /api/v1/admin/tenants/:tenantId
 * Get tenant details by ID
 */
adminRoutes.get('/tenants/:tenantId', async (c) => {
  const db = c.get('db');
  const tenantId = c.req.param('tenantId');

  const tenant = await db.getTenantById(tenantId);
  if (!tenant) {
    throw ApiError.notFound('Tenant not found');
  }

  const quota = await db.getQuotaUsage(tenantId);

  return c.json({
    id: tenant.id,
    name: tenant.name,
    quotaBytes: tenant.quotaBytes,
    usedBytes: tenant.usedBytes,
    allowedFileTypes: tenant.allowedFileTypes,
    createdAt: tenant.createdAt,
    updatedAt: tenant.updatedAt,
    quota,
  });
});

/**
 * PATCH /api/v1/admin/tenants/:tenantId
 * Update tenant properties
 */
adminRoutes.patch('/tenants/:tenantId', async (c) => {
  const db = c.get('db');
  const tenantId = c.req.param('tenantId');
  const body = await c.req.json();

  const updates = updateTenantSchema.parse(body);

  // Check if name is being changed and already exists
  if (updates.name) {
    const existing = await db.getTenantByName(updates.name);
    if (existing && existing.id !== tenantId) {
      throw ApiError.conflict(`Tenant with name '${updates.name}' already exists`);
    }
  }

  const tenant = await db.updateTenant(tenantId, updates);
  if (!tenant) {
    throw ApiError.notFound('Tenant not found');
  }

  return c.json({
    id: tenant.id,
    name: tenant.name,
    quotaBytes: tenant.quotaBytes,
    usedBytes: tenant.usedBytes,
    allowedFileTypes: tenant.allowedFileTypes,
    createdAt: tenant.createdAt,
    updatedAt: tenant.updatedAt,
  });
});

/**
 * DELETE /api/v1/admin/tenants/:tenantId
 * Delete tenant and all associated data
 */
adminRoutes.delete('/tenants/:tenantId', async (c) => {
  const db = c.get('db');
  const storage = c.get('storage');
  const tenantId = c.req.param('tenantId');

  // Verify tenant exists
  const tenant = await db.getTenantById(tenantId);
  if (!tenant) {
    throw ApiError.notFound('Tenant not found');
  }

  // Delete all files from storage
  const files = await db.listFilesByTenant(tenantId, { limit: 1000 });
  for (const file of files.files) {
    try {
      await storage.delete(file.storedPath);
    } catch {
      // Best-effort deletion — continue even if storage delete fails
    }
  }

  // Delete tenant and all associated DB records
  await db.deleteTenant(tenantId);

  return c.json({ success: true });
});
