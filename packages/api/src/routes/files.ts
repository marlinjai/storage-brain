import { Hono } from 'hono';
import type { AppEnv } from '../env';
import { authMiddleware } from '../middleware/auth';
import { ApiError } from '../middleware/error-handler';
import { listFilesQuerySchema, fileIdSchema, type ListFilesInput } from '@storage-brain/shared';
import { getFileById, listFilesByTenant, softDeleteFile } from '../db/queries';
import { getPublicUrl, getFromR2 } from '../services/r2';

export const fileRoutes = new Hono<AppEnv>();

// Apply auth middleware to all routes
fileRoutes.use('*', authMiddleware);

/**
 * GET /api/v1/files
 * List files for the authenticated tenant
 */
fileRoutes.get('/', async (c) => {
  const tenant = c.get('tenant');
  const query = c.req.query();

  // Validate query parameters
  const validatedQuery = listFilesQuerySchema.parse(query) as ListFilesInput;

  // Fetch files from database
  const result = await listFilesByTenant(c.env.DB, tenant.id, validatedQuery);

  // Map to response format with public URLs
  const files = result.files.map((file) => ({
    id: file.id,
    url: getPublicUrl(c.env.BUCKET, file.storedPath),
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
 * GET /api/v1/files/:fileId
 * Get a specific file by ID
 */
fileRoutes.get('/:fileId', async (c) => {
  const tenant = c.get('tenant');
  const fileId = c.req.param('fileId');

  // Validate file ID
  fileIdSchema.parse(fileId);

  // Fetch file from database
  const file = await getFileById(c.env.DB, fileId, tenant.id);

  if (!file) {
    throw ApiError.notFound('File not found');
  }

  return c.json({
    id: file.id,
    url: getPublicUrl(c.env.BUCKET, file.storedPath),
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
 * DELETE /api/v1/files/:fileId
 * Soft delete a file
 */
fileRoutes.delete('/:fileId', async (c) => {
  const tenant = c.get('tenant');
  const fileId = c.req.param('fileId');

  // Validate file ID
  fileIdSchema.parse(fileId);

  // Fetch file to verify ownership
  const file = await getFileById(c.env.DB, fileId, tenant.id);

  if (!file) {
    throw ApiError.notFound('File not found');
  }

  // Soft delete
  await softDeleteFile(c.env.DB, fileId, tenant.id);

  return c.json({ success: true });
});

/**
 * GET /api/v1/files/:fileId/download
 * Download a file from R2
 */
fileRoutes.get('/:fileId/download', async (c) => {
  const tenant = c.get('tenant');
  const fileId = c.req.param('fileId');

  // Validate file ID
  fileIdSchema.parse(fileId);

  // Fetch file to verify ownership
  const file = await getFileById(c.env.DB, fileId, tenant.id);

  if (!file) {
    throw ApiError.notFound('File not found');
  }

  // Get file from R2
  const r2Object = await getFromR2(c.env.BUCKET, file.storedPath);

  if (!r2Object) {
    throw ApiError.notFound('File not found in storage');
  }

  // Return file with appropriate headers
  const headers = new Headers();
  headers.set('Content-Type', file.fileType);
  headers.set('Content-Disposition', `attachment; filename="${file.originalName}"`);
  headers.set('Content-Length', file.sizeBytes.toString());

  return new Response(r2Object.body, {
    status: 200,
    headers,
  });
});
