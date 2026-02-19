import { Hono } from 'hono';
import type { AppEnv } from '../env';
import { authMiddleware } from '../middleware/auth';
import { requestUploadSchema, type AllowedMimeType } from '@storage-brain/shared';
import { ApiError } from '../middleware/error-handler';
import { checkQuota, reserveQuota } from '../services/quota';
import { generatePresignedUrl } from '../services/r2';
import { createUploadSession, createFile } from '../db/queries';
import { MAX_FILE_SIZE_BYTES, ALLOWED_MIME_TYPES } from '@storage-brain/shared';

export const uploadRoutes = new Hono<AppEnv>();

// Apply auth middleware to all routes
uploadRoutes.use('*', authMiddleware);

/**
 * POST /api/v1/upload/request
 * Request a presigned URL for file upload
 */
uploadRoutes.post('/request', async (c) => {
  const tenant = c.get('tenant');
  const body = await c.req.json();

  // Validate request body
  const validatedBody = requestUploadSchema.parse(body);
  const fileType = validatedBody.fileType as AllowedMimeType;

  // Check if file type is allowed for this tenant
  const allowedTypes = tenant.allowedFileTypes ?? ALLOWED_MIME_TYPES;
  if (!allowedTypes.includes(fileType)) {
    throw ApiError.invalidFileType(
      `File type '${fileType}' is not allowed for this tenant`
    );
  }

  // Check file size if provided
  const fileSize = validatedBody.fileSizeBytes ?? 0;
  if (fileSize > MAX_FILE_SIZE_BYTES) {
    throw ApiError.fileTooLarge(
      `File size ${fileSize} bytes exceeds maximum of ${MAX_FILE_SIZE_BYTES} bytes`
    );
  }

  // Check quota
  const quotaCheck = await checkQuota(c.env.DB, tenant.id, fileSize);
  if (!quotaCheck.hasCapacity) {
    throw ApiError.quotaExceeded(
      `Quota exceeded. Used: ${quotaCheck.usedBytes}/${quotaCheck.quotaBytes} bytes`
    );
  }

  // Generate file ID and storage path
  const fileId = crypto.randomUUID();
  const storedPath = `tenants/${tenant.id}/files/${fileId}/${validatedBody.fileName}`;

  // Create file record in database
  await createFile(c.env.DB, {
    id: fileId,
    tenantId: tenant.id,
    originalName: validatedBody.fileName,
    storedPath,
    fileType,
    sizeBytes: fileSize,
    context: validatedBody.context ?? null,
    tags: validatedBody.tags ?? null,
    webhookUrl: validatedBody.webhookUrl,
  });

  // Generate presigned URL for R2 upload
  const { presignedUrl, expiresAt } = await generatePresignedUrl(c.env.BUCKET, storedPath);

  // Create upload session
  await createUploadSession(c.env.DB, {
    fileId,
    presignedUrl,
    expiresAt,
  });

  // Reserve quota (will be confirmed after upload completes)
  if (fileSize > 0) {
    await reserveQuota(c.env.DB, tenant.id, fileSize);
  }

  return c.json({
    fileId,
    presignedUrl,
    expiresAt: new Date(expiresAt).toISOString(),
    uploadMetadata: {
      maxSizeBytes: MAX_FILE_SIZE_BYTES,
      allowedTypes,
    },
  });
});
