import { Hono } from 'hono';
import type { AppEnv } from '../env';
import { authMiddleware } from '../middleware/auth';
import { ApiError } from '../middleware/error-handler';
import { listFilesQuerySchema, fileIdSchema, type ListFilesInput } from '@storage-brain/shared';
import { generateSignedToken, generatePermanentToken } from '../services/signed-url';
import { buildContentDisposition } from '../utils/content-disposition';
import { resolvePublicBaseUrl } from '../utils/public-url';

export const fileRoutes = new Hono<AppEnv>();

// Apply auth middleware to all routes
fileRoutes.use('*', authMiddleware);

/**
 * Get the download URL for a file by its ID.
 * Returns a relative path to the authenticated download endpoint.
 */
function getFileUrl(fileId: string): string {
  return `/api/v1/files/${fileId}/download`;
}

/**
 * GET /api/v1/files
 * List files for the authenticated tenant
 */
fileRoutes.get('/', async (c) => {
  const tenant = c.get('tenant');
  const db = c.get('db');
  const query = c.req.query();

  // Validate query parameters
  const validatedQuery = listFilesQuerySchema.parse(query) as ListFilesInput;

  // Fetch files from database
  const result = await db.listFilesByTenant(tenant.id, validatedQuery);

  // Map to response format with public URLs
  const files = result.files.map((file) => ({
    id: file.id,
    url: getFileUrl(file.id),
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
  const db = c.get('db');
  const fileId = c.req.param('fileId');

  // Validate file ID
  fileIdSchema.parse(fileId);

  // Fetch file from database
  const file = await db.getFileById(fileId, tenant.id);

  if (!file) {
    throw ApiError.notFound('File not found');
  }

  return c.json({
    id: file.id,
    url: getFileUrl(file.id),
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
  const db = c.get('db');
  const fileId = c.req.param('fileId');

  // Validate file ID
  fileIdSchema.parse(fileId);

  // Fetch file to verify ownership
  const file = await db.getFileById(fileId, tenant.id);

  if (!file) {
    throw ApiError.notFound('File not found');
  }

  // Soft delete
  await db.softDeleteFile(fileId, tenant.id);

  return c.json({ success: true });
});

/**
 * GET /api/v1/files/:fileId/signed-url
 * Generate a time-limited signed URL for unauthenticated download
 */
fileRoutes.get('/:fileId/signed-url', async (c) => {
  const tenant = c.get('tenant');
  const db = c.get('db');
  const fileId = c.req.param('fileId');

  fileIdSchema.parse(fileId);

  const file = await db.getFileById(fileId, tenant.id);
  if (!file) {
    throw ApiError.notFound('File not found');
  }

  const expiresInParam = c.req.query('expiresIn');
  const expiresIn = expiresInParam ? Math.min(Math.max(parseInt(expiresInParam, 10), 60), 86400) : 3600;
  const expiresAt = Date.now() + expiresIn * 1000;

  const token = await generateSignedToken(fileId, tenant.id, expiresAt, c.env.URL_SIGNING_SECRET);
  const baseUrl = resolvePublicBaseUrl(c);

  return c.json({
    fileId,
    url: `${baseUrl}/api/v1/files/${fileId}/download?token=${token}&expires=${expiresAt}&tid=${tenant.id}`,
    expiresAt: new Date(expiresAt).toISOString(),
    expiresIn,
  });
});

/**
 * GET /api/v1/files/:fileId/permanent-url
 *
 * Generate a permanent (non-expiring) URL for unauthenticated download.
 * Suitable for review backlogs, Trello attachments, or any consumer that
 * needs a link that survives indefinitely.
 *
 * Revocation: rotate `URL_SIGNING_SECRET` — every existing permanent URL
 * becomes invalid (no per-token state to manage).
 */
fileRoutes.get('/:fileId/permanent-url', async (c) => {
  const tenant = c.get('tenant');
  const db = c.get('db');
  const fileId = c.req.param('fileId');

  fileIdSchema.parse(fileId);

  const file = await db.getFileById(fileId, tenant.id);
  if (!file) {
    throw ApiError.notFound('File not found');
  }

  const token = await generatePermanentToken(fileId, tenant.id, c.env.URL_SIGNING_SECRET);
  const baseUrl = resolvePublicBaseUrl(c);

  return c.json({
    fileId,
    url: `${baseUrl}/api/v1/files/${fileId}/download?token=${token}&expires=0&tid=${tenant.id}`,
  });
});

/**
 * GET /api/v1/files/:fileId/download
 * Download a file from storage
 */
fileRoutes.get('/:fileId/download', async (c) => {
  const tenant = c.get('tenant');
  const db = c.get('db');
  const storage = c.get('storage');
  const fileId = c.req.param('fileId');

  // Validate file ID
  fileIdSchema.parse(fileId);

  // Fetch file to verify ownership
  const file = await db.getFileById(fileId, tenant.id);

  if (!file) {
    throw ApiError.notFound('File not found');
  }

  // Get file from storage
  const object = await storage.get(file.storedPath);

  if (!object) {
    throw ApiError.notFound('File not found in storage');
  }

  // Return file with appropriate headers
  const headers = new Headers();
  headers.set('Content-Type', file.fileType);
  headers.set('Content-Disposition', buildContentDisposition('attachment', file.originalName));
  headers.set('Content-Length', file.sizeBytes.toString());

  return new Response(object.body, {
    status: 200,
    headers,
  });
});
