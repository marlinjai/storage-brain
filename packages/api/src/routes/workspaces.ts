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
  const body: unknown = await c.req.json();

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

  const body: unknown = await c.req.json();
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
  const storage = c.get('storage');
  const workspaceId = c.req.param('workspaceId');

  uuidSchema.parse(workspaceId);

  // Verify workspace exists and belongs to tenant
  const workspace = await db.getWorkspaceById(workspaceId, tenant.id);
  if (!workspace) {
    throw ApiError.notFound('Workspace not found');
  }

  // Soft-delete all files in the workspace, release their bytes from the
  // workspace and the tenant and close their open upload sessions, atomically.
  // The adapter returns exactly the files it soft-deleted, so the storage
  // cleanup below covers every one of them, including a file whose upload was
  // requested after any earlier listing would have been taken.
  const { files: deletedFiles } = await db.deleteWorkspaceFilesAndReleaseQuota(
    workspaceId,
    tenant.id
  );

  // Delete their binaries from storage. Best-effort, mirroring tenant deletion:
  // an object that is already gone (or was never written) must not fail the
  // request. An upload still in flight for one of these files finds its
  // session closed when it settles and deletes the object it wrote itself.
  for (const file of deletedFiles) {
    try {
      await storage.delete(file.storedPath);
    } catch (err) {
      console.error(`Failed to delete storage object ${file.storedPath}:`, err);
    }
  }

  // Delete the workspace itself
  await db.deleteWorkspace(workspaceId, tenant.id);

  return c.json({ success: true });
});
