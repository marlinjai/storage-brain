import type { DatabaseAdapter, Tenant } from '@storage-brain/shared';
import {
  requestUploadSchema,
  PRESIGNED_URL_EXPIRATION_SECONDS,
  MAX_FILE_SIZE_BYTES,
} from '@storage-brain/shared';
import { ApiError } from '../../middleware/error-handler';
import { generateUploadToken } from '../../services/signed-url';

/**
 * Upload handshake returned to the caller after a successful upload request.
 * Identical shape for the tenant-scoped and admin-scoped routes.
 */
export interface UploadHandshake {
  fileId: string;
  presignedUrl: string;
  expiresAt: string;
  uploadMetadata: {
    maxSizeBytes: number;
    allowedTypes: string[] | null;
  };
}

export interface RequestUploadParams {
  db: DatabaseAdapter;
  /** Already-resolved tenant (by API key for the tenant route, by id for the admin route). */
  tenant: Tenant;
  /** Raw, unvalidated request body. */
  body: unknown;
  urlSigningSecret: string;
}

/**
 * Shared upload-request handshake logic.
 *
 * Validates the body (the declared `fileSizeBytes` is required), enforces
 * allowed-MIME / max-size / tenant-quota / workspace-existence /
 * workspace-quota, atomically reserves the declared size and creates the file
 * record + upload session, and returns the presigned-URL handshake.
 *
 * This is the single source of truth for the upload-request checks. Both the
 * tenant-scoped route (`POST /api/v1/upload/request`) and the admin-scoped
 * route (`POST /api/v1/admin/tenants/:tenantId/upload/request`) call it with a
 * tenant resolved by their respective auth path, so the two routes can never
 * drift in their validation.
 */
export async function requestUpload(params: RequestUploadParams): Promise<UploadHandshake> {
  const { db, tenant, body, urlSigningSecret } = params;

  // Validate request body
  const validatedBody = requestUploadSchema.parse(body);
  const fileType = validatedBody.fileType;

  // Check if file type is allowed for this tenant (only if tenant has restrictions set)
  if (tenant.allowedFileTypes && !tenant.allowedFileTypes.includes(fileType)) {
    throw ApiError.invalidFileType(`File type '${fileType}' is not allowed for this tenant`);
  }

  // The declared size is required by the schema and is what gets reserved.
  const fileSize = validatedBody.fileSizeBytes;

  // Friendly pre-checks with the current numbers in the message. They are not
  // what enforces the quota: createPendingUpload re-checks atomically below.
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

  // Generate presigned URL for upload with HMAC token
  // MVP: uses internal worker endpoint, not true R2 presigned URLs
  const expiresAt = Date.now() + PRESIGNED_URL_EXPIRATION_SECONDS * 1000;
  const uploadToken = await generateUploadToken(storedPath, expiresAt, urlSigningSecret);
  const presignedUrl = `/_internal/upload/${encodeURIComponent(storedPath)}?token=${uploadToken}&expires=${expiresAt}`;

  // Reserve the declared size and create the file record and its upload
  // session in one atomic step. The session is stamped with the owning tenant
  // so the token-only upload route can scope its lookups (company-isolation
  // S1, finding 7). A concurrent request can take the last free bytes between
  // the pre-check above and here; the reservation then fails and nothing is
  // written.
  const pending = await db.createPendingUpload({
    file: {
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
    },
    session: { presignedUrl, expiresAt },
  });
  if (!pending.created) {
    throw ApiError.quotaExceeded(
      `Quota exceeded: no room left to reserve ${fileSize} bytes for this upload`
    );
  }

  return {
    fileId,
    presignedUrl,
    expiresAt: new Date(expiresAt).toISOString(),
    uploadMetadata: {
      maxSizeBytes: MAX_FILE_SIZE_BYTES,
      allowedTypes: tenant.allowedFileTypes,
    },
  };
}
