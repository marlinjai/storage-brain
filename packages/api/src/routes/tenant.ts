import { Hono } from 'hono';
import type { AppEnv } from '../env';
import { authMiddleware } from '../middleware/auth';
import { getQuotaUsage } from '../services/quota';

export const tenantRoutes = new Hono<AppEnv>();

// Apply auth middleware to all routes
tenantRoutes.use('*', authMiddleware);

/**
 * GET /api/v1/tenant/quota
 * Get quota usage for the authenticated tenant
 */
tenantRoutes.get('/quota', async (c) => {
  const tenant = c.get('tenant');

  const usage = await getQuotaUsage(c.env.DB, tenant.id);

  return c.json({
    quotaBytes: usage.quotaBytes,
    usedBytes: usage.usedBytes,
    availableBytes: usage.availableBytes,
    usagePercent: usage.usagePercent,
  });
});

/**
 * GET /api/v1/tenant/info
 * Get tenant information
 */
tenantRoutes.get('/info', async (c) => {
  const tenant = c.get('tenant');

  return c.json({
    id: tenant.id,
    name: tenant.name,
    allowedFileTypes: tenant.allowedFileTypes,
    createdAt: new Date(tenant.createdAt).toISOString(),
  });
});
