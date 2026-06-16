import { createAuthMiddleware } from '@marlinjai/brain-core';
import { apiKeySchema } from '@storage-brain/shared';
import type { Tenant } from '@storage-brain/shared';
import type { Context } from 'hono';
import type { AppEnv } from '../env';

/**
 * Authentication middleware
 * Validates API key and attaches tenant context to request
 */
export const authMiddleware = createAuthMiddleware<Tenant>({
  apiKeySchema,
  lookupTenant: (c: Context<AppEnv>, apiKey) => c.get('db').getTenantByApiKey(apiKey),
});
