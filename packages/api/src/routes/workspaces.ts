import { Hono } from 'hono';
import type { AppEnv } from '../env';
import { authMiddleware } from '../middleware/auth';
import { ApiError } from '../middleware/error-handler';
import { createWorkspaceSchema, updateWorkspaceSchema, uuidSchema } from '@storage-brain/shared';
import {
  createWorkspace,
  getWorkspaceById,
  listWorkspacesByTenant,
  updateWorkspace,
  deleteWorkspace,
  getActiveFilesByWorkspace,
  softDeleteFilesByWorkspace,
} from '../db/queries';
import { releaseQuota } from '../services/quota';
import { releaseWorkspaceQuota } from '../services/quota';

export const workspaceRoutes = new Hono<AppEnv>();

// Apply auth middleware to all routes
workspaceRoutes.use('*', authMiddleware);

/**
 * GET /api/v1/workspaces
 * List workspaces for the authenticated tenant
 */
workspaceRoutes.get('/', async (c) => {
  const tenant = c.get('tenant');
  const workspaces = await listWorkspacesByTenant(c.env.DB, tenant.id);

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
  const body = await c.req.json();

  const validated = createWorkspaceSchema.parse(body);

  const workspace = await createWorkspace(c.env.DB, {
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
  const workspaceId = c.req.param('workspaceId');

  uuidSchema.parse(workspaceId);

  const workspace = await getWorkspaceById(c.env.DB, workspaceId, tenant.id);
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
  const workspaceId = c.req.param('workspaceId');

  uuidSchema.parse(workspaceId);

  // Verify workspace exists and belongs to tenant
  const existing = await getWorkspaceById(c.env.DB, workspaceId, tenant.id);
  if (!existing) {
    throw ApiError.notFound('Workspace not found');
  }

  const body = await c.req.json();
  const validated = updateWorkspaceSchema.parse(body);

  const updated = await updateWorkspace(c.env.DB, workspaceId, tenant.id, validated);
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
  const workspaceId = c.req.param('workspaceId');

  uuidSchema.parse(workspaceId);

  // Verify workspace exists and belongs to tenant
  const workspace = await getWorkspaceById(c.env.DB, workspaceId, tenant.id);
  if (!workspace) {
    throw ApiError.notFound('Workspace not found');
  }

  // Get active files to calculate total bytes to release
  const activeFiles = await getActiveFilesByWorkspace(c.env.DB, workspaceId, tenant.id);
  const totalBytes = activeFiles.reduce((sum, f) => sum + f.sizeBytes, 0);

  // Soft-delete all files in the workspace
  await softDeleteFilesByWorkspace(c.env.DB, workspaceId, tenant.id);

  // Release quota from both workspace and tenant levels
  if (totalBytes > 0) {
    await releaseWorkspaceQuota(c.env.DB, workspaceId, totalBytes);
    await releaseQuota(c.env.DB, tenant.id, totalBytes);
  }

  // Delete the workspace itself
  await deleteWorkspace(c.env.DB, workspaceId, tenant.id);

  return c.json({ success: true });
});
