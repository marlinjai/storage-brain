import { Hono } from 'hono';
import type { AppEnv } from '../env';
import { sendWebhook } from '../services/webhook';
import type { DatabaseAdapter, FileResponse } from '@storage-brain/shared';
import { MAX_FILE_SIZE_BYTES } from '@storage-brain/shared';
import { verifyUploadToken } from '../services/signed-url';
import { ApiError } from '../middleware/error-handler';
import {
  BodyTooLargeError,
  declaredContentLength,
  readBodyWithLimit,
} from '../utils/read-body-limited';

export const internalUploadRoutes = new Hono<AppEnv>();

// CORS note: browser-direct uploads from the dashboard PUT bytes straight to
// this endpoint (cross-origin: dashboard origin -> API origin) with an
// XMLHttpRequest, using only the HMAC token in the query string (no
// Authorization header, no tenant key). The global CORS middleware in app.ts
// (origin '*', allowMethods includes PUT/OPTIONS, allowHeaders includes
// Content-Type) already permits that preflight + PUT for every origin,
// including the dashboard. We deliberately do NOT add a second, route-scoped
// cors() here: layering it over the global '*' would emit duplicate
// Access-Control-Allow-Origin headers and browsers would then reject the
// response. If the global policy is ever tightened away from '*', the
// dashboard origin must be added to its allowlist for browser-direct upload to
// keep working.

/**
 * PUT /_internal/upload/:storedPath
 * Receives file data and uploads it to storage
 * The storedPath is URL-encoded in the path parameter
 */
internalUploadRoutes.put('/upload/*', async (c) => {
  const db = c.get('db');
  const storage = c.get('storage');

  // Extract the stored path from the URL (everything after /upload/)
  const fullPath = c.req.path;
  const storedPathEncoded = fullPath.replace('/_internal/upload/', '');
  const storedPath = decodeURIComponent(storedPathEncoded);

  if (!storedPath) {
    return c.json({ error: 'Missing storage path' }, 400);
  }

  // Validate HMAC upload token
  const token = c.req.query('token');
  const expiresStr = c.req.query('expires');

  if (!token || !expiresStr) {
    return c.json({ error: 'Missing upload token or expires parameter' }, 403);
  }

  const expiresAt = Number(expiresStr);
  if (Number.isNaN(expiresAt)) {
    return c.json({ error: 'Invalid expires parameter' }, 403);
  }

  const isValid = await verifyUploadToken(storedPath, expiresAt, token, c.env.URL_SIGNING_SECRET);
  if (!isValid) {
    return c.json({ error: 'Invalid or expired upload token' }, 403);
  }

  // Cheapest rejection first: a Content-Length above the global per-file
  // maximum can never be a valid upload, so answer before any DB lookup and
  // without reading a byte of the body.
  const contentLength = declaredContentLength(c.req.raw);
  if (contentLength !== null && contentLength > MAX_FILE_SIZE_BYTES) {
    throw ApiError.payloadTooLarge(
      `Upload body of ${contentLength} bytes exceeds the maximum of ${MAX_FILE_SIZE_BYTES} bytes`
    );
  }

  // Get the file record by stored path
  const file = await db.getFileByStoredPath(storedPath);
  if (!file) {
    return c.json({ error: 'File record not found' }, 404);
  }

  // Get the upload session
  const session = await db.getUploadSessionByFileId(file.id);
  if (!session) {
    return c.json({ error: 'Upload session not found' }, 404);
  }

  // A pending session whose URL lapsed is settled as expired here, which
  // releases its reservation (the periodic sweep does the same for sessions
  // nobody comes back to).
  if (session.status === 'pending' && Date.now() > session.expiresAt) {
    await db.settleUploadSession(session.id, { status: 'expired' }, 'pending');
    return c.json({ error: 'Upload session expired' }, 410);
  }

  if (session.status !== 'pending') {
    return c.json({ error: `Upload session already ${session.status}` }, 409);
  }

  // Claim the session so exactly one transfer runs against this reservation.
  if (!(await db.claimUploadSession(session.id))) {
    return c.json({ error: 'Upload session is no longer pending' }, 409);
  }

  // Get the content type from request header (fallback to file record)
  const contentType = c.req.header('Content-Type') ?? file.fileType;

  // The body may be no larger than the size declared when the upload was
  // requested (that is the quota reserved for it), and never larger than the
  // global maximum. Sessions requested before the declared size became
  // mandatory can still carry 0; for those only the global maximum applies.
  const declaredSize = file.sizeBytes;
  const limit =
    declaredSize > 0 ? Math.min(declaredSize, MAX_FILE_SIZE_BYTES) : MAX_FILE_SIZE_BYTES;
  const tooLarge = (declaredBytes: number | null): ApiError => {
    const subject =
      declaredBytes === null ? 'Upload body' : `Upload body of ${declaredBytes} bytes`;
    return ApiError.payloadTooLarge(
      limit < MAX_FILE_SIZE_BYTES
        ? `${subject} exceeds the ${declaredSize} bytes declared for this upload`
        : `${subject} exceeds the maximum of ${MAX_FILE_SIZE_BYTES} bytes`
    );
  };

  // From here every way out settles the session: a transfer that is rejected,
  // cut off or cannot be stored releases its whole reservation, and the
  // client requests a new upload (as the SDK and the dashboard already do).
  let actualSize: number;
  try {
    // Read the body counting bytes as they stream, so a missing or lying
    // Content-Length is cut off at the limit instead of buffered whole.
    let body: ArrayBuffer;
    try {
      body = await readBodyWithLimit(c.req.raw, limit);
    } catch (err) {
      if (err instanceof BodyTooLargeError) {
        throw tooLarge(err.declaredBytes);
      }
      throw err;
    }
    actualSize = body.byteLength;

    if (actualSize === 0) {
      throw ApiError.badRequest('Empty file body');
    }

    await storage.put(storedPath, body, { contentType });
  } catch (err) {
    await settleFailed(db, session.id);
    throw err;
  }

  // Replace the reservation with the bytes actually stored (releasing the
  // unused part when the file is smaller than declared) and complete the file.
  // Only this transfer's claim ('uploading') is settled here; the R2
  // completion webhook settles pending sessions only, so it cannot race this.
  const settled = await db.settleUploadSession(
    session.id,
    { status: 'completed', actualBytes: actualSize },
    'uploading'
  );
  if (!settled) {
    // The session was closed while the bytes were in flight (the file was
    // deleted, or the sweep reclaimed it after the grace period): its quota is
    // already gone, so the object must not stay behind either.
    await storage.delete(storedPath).catch(() => {});
    return c.json({ error: 'Upload session was closed before the upload finished' }, 409);
  }

  // Fire webhook if configured (non-blocking via waitUntil)
  if (file.webhookUrl) {
    const updatedFile = await db.getFileById(file.id, file.tenantId);
    if (updatedFile) {
      const fileResponse: FileResponse = {
        id: updatedFile.id,
        url: `/api/v1/files/${updatedFile.id}/download`,
        originalName: updatedFile.originalName,
        fileType: updatedFile.fileType,
        sizeBytes: updatedFile.sizeBytes,
        context: updatedFile.context,
        tags: updatedFile.tags,
        metadata: updatedFile.metadata,
        processingStatus: updatedFile.processingStatus,
        workspaceId: updatedFile.workspaceId,
        createdAt: new Date(updatedFile.createdAt).toISOString(),
      };

      c.executionCtx.waitUntil(
        sendWebhook({
          fileId: updatedFile.id,
          tenantId: updatedFile.tenantId,
          workspaceId: updatedFile.workspaceId,
          file: fileResponse,
          webhookUrl: file.webhookUrl,
          event: 'file.uploaded',
        })
      );
    }
  }

  return c.json({
    status: 'completed',
    fileId: file.id,
    sizeBytes: actualSize,
  });
});

/**
 * Settle a failed transfer, without letting a settle error mask the error that
 * failed the upload. If the settle itself fails, the sweep reclaims the
 * reservation once the in-flight grace period is over.
 */
async function settleFailed(db: DatabaseAdapter, sessionId: string): Promise<void> {
  try {
    await db.settleUploadSession(sessionId, { status: 'failed' }, 'uploading');
  } catch (settleErr) {
    console.error(`Failed to settle upload session ${sessionId} as failed:`, settleErr);
  }
}
