import type { Context } from 'hono';
import type { AppEnv } from '../env';
import { ApiError } from '../middleware/error-handler';
import { fileIdSchema, apiKeySchema } from '@storage-brain/shared';
import { verifySignedToken } from '../services/signed-url';
import { buildContentDisposition } from '../utils/content-disposition';

/**
 * Public download handler that accepts either:
 *  1. Authorization: Bearer <apiKey>  (standard tenant auth)
 *  2. ?token=<hmac>&expires=<timestamp>  (signed URL)
 *
 * Registered before fileRoutes so it matches first for GET /api/v1/files/:fileId/download.
 */
export async function publicDownloadHandler(c: Context<AppEnv>) {
  const db = c.get('db');
  const storage = c.get('storage');
  const fileId = c.req.param('fileId');
  fileIdSchema.parse(fileId);

  const token = c.req.query('token');
  const expiresParam = c.req.query('expires');
  const authHeader = c.req.header('Authorization');

  let storedPath: string;
  let fileType: string;
  let originalName: string;
  let sizeBytes: number;

  if (token && expiresParam) {
    // --- Signed-token path ---
    const tenantId = c.req.query('tid');
    if (!tenantId) {
      throw ApiError.unauthorized('Missing tenant ID parameter');
    }

    const expiresAt = parseInt(expiresParam, 10);
    if (isNaN(expiresAt)) {
      throw ApiError.unauthorized('Invalid expires parameter');
    }

    const valid = await verifySignedToken(fileId, tenantId, expiresAt, token, c.env.URL_SIGNING_SECRET);
    if (!valid) {
      throw ApiError.unauthorized('Invalid or expired download token');
    }

    // Tenant-scoped lookup for defense in depth
    const file = await db.getFileById(fileId, tenantId);
    if (!file) {
      throw ApiError.notFound('File not found');
    }

    storedPath = file.storedPath;
    fileType = file.fileType;
    originalName = file.originalName;
    sizeBytes = file.sizeBytes;
  } else if (authHeader?.startsWith('Bearer ')) {
    // --- Bearer auth path (same as authMiddleware logic) ---
    const apiKey = authHeader.slice(7);
    const parseResult = apiKeySchema.safeParse(apiKey);
    if (!parseResult.success) {
      throw ApiError.unauthorized('Invalid API key format');
    }

    const tenant = await db.getTenantByApiKey(apiKey);
    if (!tenant) {
      throw ApiError.unauthorized('Invalid API key');
    }

    const file = await db.getFileById(fileId, tenant.id);
    if (!file) {
      throw ApiError.notFound('File not found');
    }

    storedPath = file.storedPath;
    fileType = file.fileType;
    originalName = file.originalName;
    sizeBytes = file.sizeBytes;
  } else {
    throw ApiError.unauthorized('Missing authorization. Provide Bearer token or signed URL parameters.');
  }

  // Fetch from storage
  const object = await storage.get(storedPath);
  if (!object) {
    throw ApiError.notFound('File not found in storage');
  }

  const disposition = c.req.query('disposition') === 'inline' ? 'inline' : 'attachment';

  const headers = new Headers();
  headers.set('Content-Type', fileType);
  headers.set('Content-Disposition', buildContentDisposition(disposition, originalName));
  headers.set('Content-Length', sizeBytes.toString());
  headers.set('Accept-Ranges', 'bytes');

  // Explicit cross-origin embedding headers so audio/video/image elements on
  // other origins can load this file. CORS headers are added by the global
  // cors() middleware; CORP is set here (and globally via secureHeaders) to
  // allow embedding without the crossorigin attribute as well.
  headers.set('Cross-Origin-Resource-Policy', 'cross-origin');
  headers.set('Access-Control-Allow-Origin', '*');
  headers.set('Access-Control-Expose-Headers', 'Content-Length, Content-Range, Accept-Ranges');

  // Allow browser caching for signed URLs (they have expiry built in)
  if (token) {
    headers.set('Cache-Control', 'public, max-age=3600');
  }

  return new Response(object.body, { status: 200, headers });
}
