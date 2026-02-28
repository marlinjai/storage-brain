import { createAuthMiddleware } from '@marlinjai/brain-core';
import { apiKeySchema } from '@storage-brain/shared';
import { getTenantByApiKey } from '../db/queries';
import type { Tenant } from '@storage-brain/shared';

/**
 * Authentication middleware
 * Validates API key and attaches tenant context to request
 */
export const authMiddleware = createAuthMiddleware<Tenant>({
  apiKeySchema,
  lookupTenant: (c, apiKey) => getTenantByApiKey(c.env.DB, apiKey),
});
