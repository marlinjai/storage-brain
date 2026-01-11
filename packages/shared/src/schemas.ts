import { z } from 'zod';
import {
  ALLOWED_MIME_TYPES,
  PROCESSING_CONTEXTS,
  MAX_FILE_SIZE_BYTES,
  API_KEY_PREFIX_LIVE,
  API_KEY_PREFIX_TEST,
} from './constants';

/**
 * File type validation
 */
export const fileTypeSchema = z.enum(ALLOWED_MIME_TYPES as unknown as [string, ...string[]]);

/**
 * Processing context validation
 */
export const processingContextSchema = z.enum(PROCESSING_CONTEXTS);

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
  context: processingContextSchema,
  tags: tagsSchema,
  webhookUrl: z.string().url().optional(),
});

export type RequestUploadSchema = z.infer<typeof requestUploadSchema>;

/**
 * GET /files query parameters
 */
export const listFilesQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  cursor: z.string().optional(),
  context: processingContextSchema.optional(),
  fileType: fileTypeSchema.optional(),
});

export type ListFilesQuerySchema = z.infer<typeof listFilesQuerySchema>;

/**
 * File ID parameter validation
 */
export const fileIdSchema = z.string().uuid('Invalid file ID format');

/**
 * API key validation
 */
export const apiKeySchema = z
  .string()
  .min(1, 'API key is required')
  .refine(
    (key) => key.startsWith(API_KEY_PREFIX_LIVE) || key.startsWith(API_KEY_PREFIX_TEST),
    `API key must start with '${API_KEY_PREFIX_LIVE}' or '${API_KEY_PREFIX_TEST}'`
  );

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
  event: z.enum(['file.processed', 'file.failed']),
  fileId: z.string().uuid(),
  tenantId: z.string().uuid(),
  file: z.object({
    id: z.string().uuid(),
    url: z.string().url(),
    originalName: z.string(),
    fileType: fileTypeSchema,
    sizeBytes: z.number().int().positive(),
    context: processingContextSchema,
    tags: z.record(z.string(), z.string()).nullable(),
    metadata: z.record(z.string(), z.unknown()).nullable(),
    processingStatus: z.enum(['pending', 'processing', 'completed', 'failed']),
    createdAt: z.string().datetime(),
  }),
  timestamp: z.string().datetime(),
});

/**
 * UUID validation helper
 */
export const uuidSchema = z.string().uuid();

/**
 * Pagination cursor (base64 encoded)
 */
export const cursorSchema = z
  .string()
  .regex(/^[A-Za-z0-9+/=]+$/, 'Invalid cursor format')
  .optional();
