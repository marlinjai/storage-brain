import { Hono } from 'hono';
import type { AppEnv } from '../env';
import { ApiError } from '../middleware/error-handler';
import { createAdminAuthMiddleware } from '@marlinjai/brain-core';
import {
  createTenantSchema,
  updateTenantSchema,
  listTenantsQuerySchema,
  listFilesQuerySchema,
  fileIdSchema,
  DEFAULT_QUOTA_BYTES,
  ALLOWED_MIME_TYPES,
  type AllowedMimeType,
  type ListFilesInput,
  type RotationConfig,
} from '@storage-brain/shared';
import { generateApiKey, hashApiKey, getKeyPrefix } from '../utils/crypto';
import { generateSignedToken } from '../services/signed-url';
import { pushKeyToInfisical } from '../services/infisical-push';
import { triggerDeploy } from '../services/coolify-deploy';

interface RotationStatus {
  keyRotated: boolean;
  gracePeriodSeconds: number;
  infisicalPush: 'success' | 'failed' | null;
  infisicalError?: string;
  deployTrigger: 'success' | 'failed' | null;
  deployError?: string;
}

export const adminRoutes = new Hono<AppEnv>();

// Runtime-only admin key override (not persisted across restarts)
let runtimeAdminKey: string | null = null;

/**
 * Injection middleware — overrides ADMIN_API_KEY with runtime key when set.
 * Must run BEFORE admin auth middleware.
 */
adminRoutes.use('*', async (c, next) => {
  if (runtimeAdminKey) {
    c.env.ADMIN_API_KEY = runtimeAdminKey;
  }
  await next();
});

/**
 * Admin authentication middleware
 * Uses timing-safe comparison from brain-core
 */
adminRoutes.use('*', createAdminAuthMiddleware());

/**
 * POST /api/v1/admin/rotate-key
 * Rotate the admin API key at runtime
 */
adminRoutes.post('/rotate-key', async (c) => {
  const body = await c.req.json();
  const { newKey } = body as { newKey?: string };

  if (!newKey || typeof newKey !== 'string' || newKey.length < 32) {
    throw ApiError.badRequest('newKey must be a string of at least 32 characters');
  }

  const currentKey = c.env.ADMIN_API_KEY as string;
  const oldKeyPrefix = currentKey.substring(0, 8);

  runtimeAdminKey = newKey;

  console.warn(
    `[admin] Admin API key rotated at runtime (old prefix: ${oldKeyPrefix}). Update ADMIN_API_KEY env var to persist across restarts.`
  );

  return c.json({
    success: true,
    oldKeyPrefix,
    message: 'Key rotated. Update ADMIN_API_KEY env var to persist across restarts.',
  });
});

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
  const keyPrefix = getKeyPrefix(apiKey);

  // Create tenant
  const tenantId = crypto.randomUUID();
  const allowedFileTypes = (validatedBody.allowedFileTypes as AllowedMimeType[] | undefined) ?? [...ALLOWED_MIME_TYPES];
  const quotaBytes = validatedBody.quotaBytes ?? DEFAULT_QUOTA_BYTES;

  await db.createTenant({
    id: tenantId,
    name: validatedBody.name,
    apiKeyHash,
    keyPrefix,
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
 * Regenerate API key for a tenant with optional grace period
 */
adminRoutes.post('/tenants/:tenantId/regenerate-key', async (c) => {
  const db = c.get('db');
  const tenantId = c.req.param('tenantId');

  const body = await c.req.json().catch(() => ({}));
  const gracePeriodSeconds = Math.max(0, Math.min(
    typeof body.gracePeriodSeconds === 'number' ? body.gracePeriodSeconds : 600,
    86400, // max 24 hours
  ));

  // Generate new API key
  const apiKey = generateApiKey();
  const apiKeyHash = await hashApiKey(apiKey);
  const keyPrefix = getKeyPrefix(apiKey);

  // Update tenant (copies old key to previous if grace period > 0)
  const updated = await db.updateTenantApiKeyHash(tenantId, apiKeyHash, keyPrefix, gracePeriodSeconds);

  if (!updated) {
    throw ApiError.notFound('Tenant not found');
  }

  // If tenant has rotation config, run the automated pipeline
  const tenant = await db.getTenantById(tenantId);
  const rotationStatus: RotationStatus = {
    keyRotated: true,
    gracePeriodSeconds,
    infisicalPush: null,
    deployTrigger: null,
  };

  if (tenant?.rotationConfig?.infisical) {
    try {
      await pushKeyToInfisical(tenant.rotationConfig.infisical, apiKey, {
        clientId: c.env.INFISICAL_CLIENT_ID,
        clientSecret: c.env.INFISICAL_CLIENT_SECRET,
        siteUrl: c.env.INFISICAL_SITE_URL,
      });
      rotationStatus.infisicalPush = 'success';
    } catch (err) {
      rotationStatus.infisicalPush = 'failed';
      rotationStatus.infisicalError = err instanceof Error ? err.message : 'Unknown error';
      console.error(`[rotation] Infisical push failed for tenant ${tenantId}:`, err);
    }
  }

  if (tenant?.rotationConfig?.deploy && rotationStatus.infisicalPush === 'success') {
    try {
      await triggerDeploy(tenant.rotationConfig.deploy, {
        coolifyToken: c.env.COOLIFY_API_TOKEN,
        coolifyUrl: c.env.COOLIFY_URL,
      });
      rotationStatus.deployTrigger = 'success';
    } catch (err) {
      rotationStatus.deployTrigger = 'failed';
      rotationStatus.deployError = err instanceof Error ? err.message : 'Unknown error';
      console.error(`[rotation] Deploy trigger failed for tenant ${tenantId}:`, err);
    }
  }

  return c.json({
    tenantId,
    apiKey, // Only returned once!
    keyPrefix,
    rotation: rotationStatus,
    message: 'API key regenerated successfully. Store this key securely.',
  });
});

/**
 * GET /api/v1/admin/tenants/:tenantId/rotation-config
 * Get the rotation config for a tenant
 */
adminRoutes.get('/tenants/:tenantId/rotation-config', async (c) => {
  const db = c.get('db');
  const tenantId = c.req.param('tenantId');

  const tenant = await db.getTenantById(tenantId);
  if (!tenant) {
    throw ApiError.notFound('Tenant not found');
  }

  return c.json({
    tenantId,
    rotationConfig: tenant.rotationConfig,
  });
});

/**
 * PUT /api/v1/admin/tenants/:tenantId/rotation-config
 * Set the rotation config for a tenant
 */
adminRoutes.put('/tenants/:tenantId/rotation-config', async (c) => {
  const db = c.get('db');
  const tenantId = c.req.param('tenantId');
  const body = await c.req.json();

  const config: RotationConfig | null = body.rotationConfig ?? null;

  const updated = await db.updateTenantRotationConfig(tenantId, config);
  if (!updated) {
    throw ApiError.notFound('Tenant not found');
  }

  return c.json({
    tenantId,
    rotationConfig: config,
    message: 'Rotation config updated successfully.',
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
      keyPrefix: t.keyPrefix,
      quotaBytes: t.quotaBytes,
      usedBytes: t.usedBytes,
      allowedFileTypes: t.allowedFileTypes,
      hasRotationConfig: t.rotationConfig !== null,
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
    keyPrefix: tenant.keyPrefix,
    quotaBytes: tenant.quotaBytes,
    usedBytes: tenant.usedBytes,
    allowedFileTypes: tenant.allowedFileTypes,
    rotationConfig: tenant.rotationConfig,
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
    keyPrefix: tenant.keyPrefix,
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

// ─── File & Workspace Browsing ───────────────────────────────────────────────

/**
 * GET /api/v1/admin/tenants/:tenantId/files
 * List files for a specific tenant
 */
adminRoutes.get('/tenants/:tenantId/files', async (c) => {
  const db = c.get('db');
  const tenantId = c.req.param('tenantId');
  const query = c.req.query();

  const validatedQuery = listFilesQuerySchema.parse(query) as ListFilesInput;

  const result = await db.listFilesByTenant(tenantId, validatedQuery);

  const files = result.files.map((file) => ({
    id: file.id,
    url: `/api/v1/files/${file.id}/download`,
    originalName: file.originalName,
    fileType: file.fileType,
    sizeBytes: file.sizeBytes,
    context: file.context,
    tags: file.tags,
    metadata: file.metadata,
    processingStatus: file.processingStatus,
    workspaceId: file.workspaceId,
    createdAt: new Date(file.createdAt).toISOString(),
  }));

  return c.json({
    files,
    nextCursor: result.nextCursor,
    total: result.total,
  });
});

/**
 * GET /api/v1/admin/tenants/:tenantId/files/:fileId
 * Get a single file detail for a tenant
 */
adminRoutes.get('/tenants/:tenantId/files/:fileId', async (c) => {
  const db = c.get('db');
  const tenantId = c.req.param('tenantId');
  const fileId = c.req.param('fileId');

  fileIdSchema.parse(fileId);

  const file = await db.getFileById(fileId, tenantId);
  if (!file) {
    throw ApiError.notFound('File not found');
  }

  return c.json({
    id: file.id,
    url: `/api/v1/files/${file.id}/download`,
    originalName: file.originalName,
    fileType: file.fileType,
    sizeBytes: file.sizeBytes,
    context: file.context,
    tags: file.tags,
    metadata: file.metadata,
    processingStatus: file.processingStatus,
    workspaceId: file.workspaceId,
    createdAt: new Date(file.createdAt).toISOString(),
  });
});

/**
 * GET /api/v1/admin/tenants/:tenantId/files/:fileId/signed-url
 * Generate a signed download URL for a tenant's file
 */
adminRoutes.get('/tenants/:tenantId/files/:fileId/signed-url', async (c) => {
  const db = c.get('db');
  const tenantId = c.req.param('tenantId');
  const fileId = c.req.param('fileId');

  fileIdSchema.parse(fileId);

  const file = await db.getFileById(fileId, tenantId);
  if (!file) {
    throw ApiError.notFound('File not found');
  }

  const expiresInParam = c.req.query('expiresIn');
  const expiresIn = expiresInParam ? Math.min(Math.max(parseInt(expiresInParam, 10), 60), 86400) : 3600;
  const expiresAt = Date.now() + expiresIn * 1000;

  const token = await generateSignedToken(fileId, tenantId, expiresAt, c.env.URL_SIGNING_SECRET);

  const url = new URL(c.req.url);
  const baseUrl = `${url.protocol}//${url.host}`;

  return c.json({
    fileId,
    url: `${baseUrl}/api/v1/files/${fileId}/download?token=${token}&expires=${expiresAt}&tid=${tenantId}`,
    expiresAt: new Date(expiresAt).toISOString(),
    expiresIn,
  });
});

/**
 * DELETE /api/v1/admin/tenants/:tenantId/files/:fileId
 * Soft-delete a file for a tenant
 */
adminRoutes.delete('/tenants/:tenantId/files/:fileId', async (c) => {
  const db = c.get('db');
  const tenantId = c.req.param('tenantId');
  const fileId = c.req.param('fileId');

  fileIdSchema.parse(fileId);

  const file = await db.getFileById(fileId, tenantId);
  if (!file) {
    throw ApiError.notFound('File not found');
  }

  await db.softDeleteFile(fileId, tenantId);

  return c.json({ success: true });
});

/**
 * GET /api/v1/admin/tenants/:tenantId/workspaces
 * List workspaces for a tenant
 */
adminRoutes.get('/tenants/:tenantId/workspaces', async (c) => {
  const db = c.get('db');
  const tenantId = c.req.param('tenantId');

  const workspaces = await db.listWorkspacesByTenant(tenantId);

  return c.json({
    workspaces: workspaces.map((ws) => ({
      id: ws.id,
      name: ws.name,
      slug: ws.slug,
      quotaBytes: ws.quotaBytes,
      usedBytes: ws.usedBytes,
      metadata: ws.metadata,
      createdAt: ws.createdAt,
      updatedAt: ws.updatedAt,
    })),
  });
});

/**
 * GET /api/v1/admin/tenants/:tenantId/quota
 * Get quota usage for a tenant
 */
adminRoutes.get('/tenants/:tenantId/quota', async (c) => {
  const db = c.get('db');
  const tenantId = c.req.param('tenantId');

  const quota = await db.getQuotaUsage(tenantId);

  return c.json(quota);
});
