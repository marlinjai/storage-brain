import { z } from 'zod';
import {
  MAX_ALLOWED_FILE_TYPES,
  MAX_FILE_SIZE_BYTES,
  MAX_METADATA_KEYS,
  MAX_TAGS,
} from './constants';

// Re-export shared schemas from brain-core
export { uuidSchema, apiKeySchema, cursorSchema, workspaceSlugSchema } from '@marlinjai/brain-core';

/**
 * File type validation — accepts any valid MIME type string (e.g. "image/png", "audio/wav")
 */
export const fileTypeSchema = z
  .string()
  .regex(/^[a-z]+\/[a-z0-9.+-]+$/i, 'Invalid MIME type format');

/**
 * A record whose entry count is checked BEFORE any entry is parsed. Zod has no
 * `.max()` on records, and a refinement on the record itself would only run
 * after every entry had been parsed (one issue per failing entry). The first
 * stage of the pipe only counts keys; a pipe never runs its second stage when
 * the first one failed, so an oversized record is refused with a single issue.
 */
function boundedRecord<K extends z.ZodType<string, string>, V extends z.ZodType>(
  key: K,
  value: V,
  maxEntries: number
) {
  return z
    .record(z.string(), z.unknown())
    .refine((record) => Object.keys(record).length <= maxEntries, {
      error: `Too many entries: at most ${maxEntries} are allowed`,
      abort: true,
    })
    .pipe(z.record(key, value));
}

/**
 * Tags validation (string key-value pairs)
 */
export const tagsSchema = boundedRecord(
  z.string().max(100),
  z.string().max(500),
  MAX_TAGS
).optional();

/** Free-form workspace metadata, bounded in its number of top-level keys. */
const metadataSchema = boundedRecord(z.string(), z.unknown(), MAX_METADATA_KEYS);

/**
 * File name validation, shared by upload and rename: no path separators or
 * control characters (both would corrupt Content-Disposition headers and,
 * for separators, break the flat `tenants/<id>/files/<id>/<name>` storage
 * key convention).
 */
export const fileNameSchema = z
  .string()
  .min(1, 'File name is required')
  .max(255, 'File name too long')
  // eslint-disable-next-line no-control-regex -- intentionally reject ASCII control chars (\x00-\x1f) in filenames
  .regex(/^[^<>:"/\\|?*\x00-\x1f]+$/, 'File name contains invalid characters');

/**
 * POST /request-upload request body
 */
export const requestUploadSchema = z.object({
  fileType: fileTypeSchema,
  fileName: fileNameSchema,
  // Required: the declared size is what quota is reserved for, and the upload
  // route refuses any body larger than it.
  fileSizeBytes: z
    .number({
      error: (issue) =>
        issue.input === undefined
          ? 'fileSizeBytes is required: declare the exact size of the file in bytes'
          : 'fileSizeBytes must be a number of bytes',
    })
    .int('fileSizeBytes must be a whole number of bytes')
    .positive('fileSizeBytes must be greater than 0: empty files cannot be uploaded')
    .max(MAX_FILE_SIZE_BYTES, `File size exceeds maximum of ${MAX_FILE_SIZE_BYTES} bytes`),
  context: z.string().max(100).optional(),
  tags: tagsSchema,
  webhookUrl: z.url().optional(),
  workspaceId: z.uuid().optional(),
});

export type RequestUploadSchema = z.infer<typeof requestUploadSchema>;

/**
 * GET /files query parameters
 */
export const listFilesQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  cursor: z.string().optional(),
  context: z.string().max(100).optional(),
  fileType: fileTypeSchema.optional(),
  workspaceId: z.uuid().optional(),
});

export type ListFilesQuerySchema = z.infer<typeof listFilesQuerySchema>;

/**
 * File ID parameter validation
 */
export const fileIdSchema = z.uuid('Invalid file ID format');

/**
 * PATCH /files/:fileId request body — rename a file's display name.
 */
export const renameFileSchema = z.object({
  originalName: fileNameSchema,
});

export type RenameFileSchema = z.infer<typeof renameFileSchema>;

/**
 * Tenant creation (admin)
 */
export const createTenantSchema = z.object({
  name: z.string().min(1).max(100),
  quotaBytes: z.number().int().positive().optional(),
  // null/undefined = accept any type
  allowedFileTypes: z.array(fileTypeSchema).max(MAX_ALLOWED_FILE_TYPES).optional(),
  // auth-brain bindings. Tenant binding is the default for company-wide storage;
  // workspace binding is reserved for project isolation (one company, several
  // storage tenants). See docs/plans/2026-08-13-tenant-scope-rebinding.md.
  authWorkspaceId: z.string().min(1).max(255).optional(),
  authTenantId: z.string().min(1).max(255).optional(),
});

export type CreateTenantSchema = z.infer<typeof createTenantSchema>;

/**
 * Tenant update (admin)
 */
export const updateTenantSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  quotaBytes: z.number().int().positive().optional(),
  allowedFileTypes: z.array(fileTypeSchema).max(MAX_ALLOWED_FILE_TYPES).nullable().optional(),
  // Nullable so a rebind can explicitly clear the old binding
  // (authWorkspaceId: null + authTenantId: <id> makes the binding unambiguous).
  authWorkspaceId: z.string().min(1).max(255).nullable().optional(),
  authTenantId: z.string().min(1).max(255).nullable().optional(),
});

export type UpdateTenantSchema = z.infer<typeof updateTenantSchema>;

/**
 * List tenants query (admin)
 */
export const listTenantsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  cursor: z.string().optional(),
});

/**
 * Webhook payload validation
 */
export const webhookPayloadSchema = z.object({
  event: z.enum(['file.uploaded', 'file.failed']),
  fileId: z.uuid(),
  tenantId: z.uuid(),
  workspaceId: z.uuid().nullable(),
  file: z.object({
    id: z.uuid(),
    url: z.url(),
    originalName: z.string(),
    fileType: fileTypeSchema,
    sizeBytes: z.number().int().positive(),
    context: z.string().max(100).nullable(),
    tags: z.record(z.string(), z.string()).nullable(),
    metadata: z.record(z.string(), z.unknown()).nullable(),
    processingStatus: z.enum(['pending', 'processing', 'completed', 'failed']),
    workspaceId: z.uuid().nullable(),
    createdAt: z.iso.datetime(),
  }),
  timestamp: z.iso.datetime(),
});

/**
 * Workspace creation
 */
export const createWorkspaceSchema = z.object({
  name: z.string().min(1).max(255),
  slug: z
    .string()
    .min(1)
    .max(100)
    .regex(
      /^[a-z0-9][a-z0-9-]*[a-z0-9]$|^[a-z0-9]$/,
      'Slug must be lowercase alphanumeric with hyphens'
    ),
  quotaBytes: z.number().int().positive().optional(),
  metadata: metadataSchema.optional(),
});

export type CreateWorkspaceSchema = z.infer<typeof createWorkspaceSchema>;

/**
 * Bulk file-to-workspace migration (admin)
 *
 * Moves matching files into a target workspace. Files are selected EITHER by a
 * single tag key/value pair (e.g. the `env` provenance tag) OR by an explicit
 * list of file IDs. `onlyUnassigned` (default true) restricts the move to files
 * that currently have no workspace, which is the common backfill case.
 */
export const migrateWorkspaceSchema = z.object({
  workspaceId: z.uuid(),
  filter: z.union([
    z.object({
      tag: z.object({
        key: z.string().min(1).max(100),
        value: z.string().max(500),
      }),
    }),
    z.object({
      fileIds: z.array(z.uuid()).min(1).max(500),
    }),
  ]),
  onlyUnassigned: z.boolean().default(true),
});

export type MigrateWorkspaceSchema = z.infer<typeof migrateWorkspaceSchema>;

/**
 * Context aggregate query — optional workspace scope for the "folder" view.
 */
export const listContextsQuerySchema = z.object({
  workspaceId: z.uuid().optional(),
});

export type ListContextsQuerySchema = z.infer<typeof listContextsQuerySchema>;

/**
 * Workspace update
 */
export const updateWorkspaceSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  quotaBytes: z.number().int().positive().nullable().optional(),
  metadata: metadataSchema.optional(),
});

export type UpdateWorkspaceSchema = z.infer<typeof updateWorkspaceSchema>;
