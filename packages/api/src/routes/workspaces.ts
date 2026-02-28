import { Hono } from 'hono';
import type { AppEnv } from '../env';
import { authMiddleware } from '../middleware/auth';
import { ApiError } from '../middleware/error-handler';
import { createWorkspaceSchema, updateWorkspaceSchema, uuidSchema } from '@storage-brain/shared';

export const workspaceRoutes = new Hono<AppEnv>();

// Apply auth middleware to all routes
workspaceRoutes.use('*', authMiddleware);

/**
 * GET /api/v1/workspaces
 * List workspaces for the authenticated tenant
 */
workspaceRoutes.get('/', async (c) => {
  const tenant = c.get('tenant');
  const db = c.get('db');
  const workspaces = await db.listWorkspacesByTenant(tenant.id);

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
 * POST /api/v1/workspaces
 * Create a new workspace
 */
workspaceRoutes.post('/', async (c) => {
  const tenant = c.get('tenant');
  const db = c.get('db');
  const body = await c.req.json();

  const validated = createWorkspaceSchema.parse(body);

  const workspace = await db.createWorkspace({
    id: crypto.randomUUID(),
    tenantId: tenant.id,
    name: validated.name,
    slug: validated.slug,
    quotaBytes: validated.quotaBytes,
    metadata: validated.metadata,
  });

  return c.json(
    {
      id: workspace.id,
      name: workspace.name,
      slug: workspace.slug,
      quotaBytes: workspace.quotaBytes,
      usedBytes: workspace.usedBytes,
      metadata: workspace.metadata,
      createdAt: workspace.createdAt,
      updatedAt: workspace.updatedAt,
    },
    201
  );
});

/**
 * GET /api/v1/workspaces/:workspaceId
 * Get a workspace by ID
 */
workspaceRoutes.get('/:workspaceId', async (c) => {
  const tenant = c.get('tenant');
  const db = c.get('db');
  const workspaceId = c.req.param('workspaceId');

  uuidSchema.parse(workspaceId);

  const workspace = await db.getWorkspaceById(workspaceId, tenant.id);
  if (!workspace) {
    throw ApiError.notFound('Workspace not found');
  }

  return c.json({
    id: workspace.id,
    name: workspace.name,
    slug: workspace.slug,
    quotaBytes: workspace.quotaBytes,
    usedBytes: workspace.usedBytes,
    metadata: workspace.metadata,
    createdAt: workspace.createdAt,
    updatedAt: workspace.updatedAt,
  });
});

/**
 * PATCH /api/v1/workspaces/:workspaceId
 * Update a workspace
 */
workspaceRoutes.patch('/:workspaceId', async (c) => {
  const tenant = c.get('tenant');
  const db = c.get('db');
  const workspaceId = c.req.param('workspaceId');

  uuidSchema.parse(workspaceId);

  // Verify workspace exists and belongs to tenant
  const existing = await db.getWorkspaceById(workspaceId, tenant.id);
  if (!existing) {
    throw ApiError.notFound('Workspace not found');
  }

  const body = await c.req.json();
  const validated = updateWorkspaceSchema.parse(body);

  const updated = await db.updateWorkspace(workspaceId, tenant.id, validated);
  if (!updated) {
    throw ApiError.notFound('Workspace not found');
  }

  return c.json({
    id: updated.id,
    name: updated.name,
    slug: updated.slug,
    quotaBytes: updated.quotaBytes,
    usedBytes: updated.usedBytes,
    metadata: updated.metadata,
    createdAt: updated.createdAt,
    updatedAt: updated.updatedAt,
  });
});

/**
 * DELETE /api/v1/workspaces/:workspaceId
 * Delete a workspace and soft-delete all its files
 */
workspaceRoutes.delete('/:workspaceId', async (c) => {
  const tenant = c.get('tenant');
  const db = c.get('db');
  const workspaceId = c.req.param('workspaceId');

  uuidSchema.parse(workspaceId);

  // Verify workspace exists and belongs to tenant
  const workspace = await db.getWorkspaceById(workspaceId, tenant.id);
  if (!workspace) {
    throw ApiError.notFound('Workspace not found');
  }

  // Get active files to calculate total bytes to release
  const activeFiles = await db.getActiveFilesByWorkspace(workspaceId, tenant.id);
  const totalBytes = activeFiles.reduce((sum, f) => sum + f.sizeBytes, 0);

  // Soft-delete all files in the workspace
  await db.softDeleteFilesByWorkspace(workspaceId, tenant.id);

  // Release quota from both workspace and tenant levels
  if (totalBytes > 0) {
    await db.releaseWorkspaceQuota(workspaceId, totalBytes);
    await db.releaseQuota(tenant.id, totalBytes);
  }

  // Delete the workspace itself
  await db.deleteWorkspace(workspaceId, tenant.id);

  return c.json({ success: true });
});
