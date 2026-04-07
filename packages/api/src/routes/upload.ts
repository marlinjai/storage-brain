import { Hono } from 'hono';
import type { AppEnv } from '../env';
import { authMiddleware } from '../middleware/auth';
import { requestUploadSchema, PRESIGNED_URL_EXPIRATION_SECONDS } from '@storage-brain/shared';
import { ApiError } from '../middleware/error-handler';
import { MAX_FILE_SIZE_BYTES } from '@storage-brain/shared';
import { generateUploadToken } from '../services/signed-url';

export const uploadRoutes = new Hono<AppEnv>();

// Apply auth middleware to all routes
uploadRoutes.use('*', authMiddleware);

/**
 * POST /api/v1/upload/request
 * Request a presigned URL for file upload
 */
uploadRoutes.post('/request', async (c) => {
  const tenant = c.get('tenant');
  const db = c.get('db');
  const body = await c.req.json();

  // Validate request body
  const validatedBody = requestUploadSchema.parse(body);
  const fileType = validatedBody.fileType;

  // Check if file type is allowed for this tenant (only if tenant has restrictions set)
  if (tenant.allowedFileTypes && !tenant.allowedFileTypes.includes(fileType)) {
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

  // Check tenant quota
  const quotaCheck = await db.checkQuota(tenant.id, fileSize);
  if (!quotaCheck.hasCapacity) {
    throw ApiError.quotaExceeded(
      `Quota exceeded. Used: ${quotaCheck.usedBytes}/${quotaCheck.quotaBytes} bytes`
    );
  }

  // If workspaceId provided, verify workspace and check workspace quota
  const workspaceId = validatedBody.workspaceId;
  if (workspaceId) {
    const workspace = await db.getWorkspaceById(workspaceId, tenant.id);
    if (!workspace) {
      throw ApiError.notFound('Workspace not found');
    }

    const wsQuota = await db.checkWorkspaceQuota(workspaceId, fileSize);
    if (wsQuota && !wsQuota.hasCapacity) {
      throw ApiError.quotaExceeded(
        `Workspace quota exceeded. Used: ${wsQuota.usedBytes}/${wsQuota.quotaBytes} bytes`
      );
    }
  }

  // Generate file ID and storage path
  const fileId = crypto.randomUUID();
  const storedPath = `tenants/${tenant.id}/files/${fileId}/${validatedBody.fileName}`;

  // Create file record in database
  await db.createFile({
    id: fileId,
    tenantId: tenant.id,
    originalName: validatedBody.fileName,
    storedPath,
    fileType,
    sizeBytes: fileSize,
    context: validatedBody.context ?? null,
    tags: validatedBody.tags ?? null,
    webhookUrl: validatedBody.webhookUrl,
    workspaceId,
  });

  // Generate presigned URL for upload with HMAC token
  // MVP: uses internal worker endpoint, not true R2 presigned URLs
  const expiresAt = Date.now() + PRESIGNED_URL_EXPIRATION_SECONDS * 1000;
  const uploadToken = await generateUploadToken(storedPath, expiresAt, c.env.URL_SIGNING_SECRET);
  const presignedUrl = `/_internal/upload/${encodeURIComponent(storedPath)}?token=${uploadToken}&expires=${expiresAt}`;

  // Create upload session
  await db.createUploadSession({
    fileId,
    presignedUrl,
    expiresAt,
  });

  // Reserve quota (will be confirmed after upload completes)
  if (fileSize > 0) {
    await db.reserveQuota(tenant.id, fileSize);
    if (workspaceId) {
      await db.reserveWorkspaceQuota(workspaceId, fileSize);
    }
  }

  return c.json({
    fileId,
    presignedUrl,
    expiresAt: new Date(expiresAt).toISOString(),
    uploadMetadata: {
      maxSizeBytes: MAX_FILE_SIZE_BYTES,
      allowedTypes: tenant.allowedFileTypes,
    },
  });
});
