import { z } from 'zod';
import { ALLOWED_MIME_TYPES, MAX_FILE_SIZE_BYTES } from './constants';

// Re-export shared schemas from brain-core
export { uuidSchema, apiKeySchema, cursorSchema, workspaceSlugSchema } from '@marlinjai/brain-core';

/**
 * File type validation
 */
export const fileTypeSchema = z.enum(ALLOWED_MIME_TYPES as unknown as [string, ...string[]]);

/**
 * Tags validation (string key-value pairs)
 */
export const tagsSchema = z.record(z.string().max(100), z.string().max(500)).optional();

/**
 * POST /request-upload request body
 */
export const requestUploadSchema = z.object({
  fileType: fileTypeSchema,
  fileName: z
    .string()
    .min(1, 'File name is required')
    .max(255, 'File name too long')
    .regex(/^[^<>:"/\\|?*\x00-\x1f]+$/, 'File name contains invalid characters'),
  fileSizeBytes: z
    .number()
    .int()
    .positive()
    .max(MAX_FILE_SIZE_BYTES, `File size exceeds maximum of ${MAX_FILE_SIZE_BYTES} bytes`)
    .optional(),
  context: z.string().max(100).optional(),
  tags: tagsSchema,
  webhookUrl: z.string().url().optional(),
  workspaceId: z.string().uuid().optional(),
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
  workspaceId: z.string().uuid().optional(),
});

export type ListFilesQuerySchema = z.infer<typeof listFilesQuerySchema>;

/**
 * File ID parameter validation
 */
export const fileIdSchema = z.string().uuid('Invalid file ID format');

/**
 * Tenant creation (admin)
 */
export const createTenantSchema = z.object({
  name: z.string().min(1).max(100),
  quotaBytes: z.number().int().positive().optional(),
  allowedFileTypes: z.array(fileTypeSchema).optional(),
});

export type CreateTenantSchema = z.infer<typeof createTenantSchema>;

/**
 * Webhook payload validation
 */
export const webhookPayloadSchema = z.object({
  event: z.enum(['file.uploaded', 'file.failed']),
  fileId: z.string().uuid(),
  tenantId: z.string().uuid(),
  workspaceId: z.string().uuid().nullable(),
  file: z.object({
    id: z.string().uuid(),
    url: z.string().url(),
    originalName: z.string(),
    fileType: fileTypeSchema,
    sizeBytes: z.number().int().positive(),
    context: z.string().max(100).nullable(),
    tags: z.record(z.string(), z.string()).nullable(),
    metadata: z.record(z.string(), z.unknown()).nullable(),
    processingStatus: z.enum(['pending', 'processing', 'completed', 'failed']),
    workspaceId: z.string().uuid().nullable(),
    createdAt: z.string().datetime(),
  }),
  timestamp: z.string().datetime(),
});

/**
 * Workspace creation
 */
export const createWorkspaceSchema = z.object({
  name: z.string().min(1).max(255),
  slug: z.string().min(1).max(100).regex(/^[a-z0-9][a-z0-9-]*[a-z0-9]$|^[a-z0-9]$/, 'Slug must be lowercase alphanumeric with hyphens'),
  quotaBytes: z.number().int().positive().optional(),
  metadata: z.record(z.unknown()).optional(),
});

export type CreateWorkspaceSchema = z.infer<typeof createWorkspaceSchema>;

/**
 * Workspace update
 */
export const updateWorkspaceSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  quotaBytes: z.number().int().positive().nullable().optional(),
  metadata: z.record(z.unknown()).optional(),
});

export type UpdateWorkspaceSchema = z.infer<typeof updateWorkspaceSchema>;
