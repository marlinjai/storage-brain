import type { Context, Next } from 'hono';
import type { AppEnv } from '../env';
import { ApiError } from './error-handler';
import { getTenantByApiKey } from '../db/queries';
import { apiKeySchema } from '@storage-brain/shared';

/**
 * Authentication middleware
 * Validates API key and attaches tenant context to request
 */
export async function authMiddleware(c: Context<AppEnv>, next: Next) {
  // Extract API key from Authorization header
  const authHeader = c.req.header('Authorization');

  if (!authHeader) {
    throw ApiError.unauthorized('Missing Authorization header');
  }

  if (!authHeader.startsWith('Bearer ')) {
    throw ApiError.unauthorized('Invalid Authorization header format. Expected: Bearer {api_key}');
  }

  const apiKey = authHeader.slice(7); // Remove 'Bearer ' prefix

  // Validate API key format
  const parseResult = apiKeySchema.safeParse(apiKey);
  if (!parseResult.success) {
    throw ApiError.unauthorized('Invalid API key format');
  }

  // Look up tenant by API key
  // Note: We need to check against all tenants since we hash the key
  const tenant = await getTenantByApiKey(c.env.DB, apiKey);

  if (!tenant) {
    throw ApiError.unauthorized('Invalid API key');
  }

  // Attach tenant to context
  c.set('tenant', tenant);

  await next();
}
