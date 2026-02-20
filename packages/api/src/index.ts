import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { secureHeaders } from 'hono/secure-headers';
import { requestId } from 'hono/request-id';

import type { AppEnv } from './env';
import { uploadRoutes } from './routes/upload';
import { fileRoutes } from './routes/files';
import { tenantRoutes } from './routes/tenant';
import { adminRoutes } from './routes/admin';
import { workspaceRoutes } from './routes/workspaces';
import { webhookRoutes } from './routes/webhooks';
import { internalUploadRoutes } from './routes/internal-upload';
import { errorHandler } from './middleware/error-handler';

// Create Hono app
const app = new Hono<AppEnv>();

// Global middleware
app.use('*', secureHeaders());
app.use('*', requestId());
app.use('*', logger());
app.use(
  '*',
  cors({
    origin: '*', // Configure appropriately for production
    allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowHeaders: ['Content-Type', 'Authorization', 'X-Workspace-Id'],
    exposeHeaders: ['X-Request-Id'],
    maxAge: 86400,
  })
);

// Error handling
app.onError(errorHandler);

// Health check
app.get('/health', (c) => {
  return c.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    environment: c.env.ENVIRONMENT,
  });
});

// Admin routes first (own auth middleware, must not be intercepted by tenant auth)
app.route('/api/v1/admin', adminRoutes);

// Tenant & workspace routes (tenant authMiddleware)
app.route('/api/v1/tenant', tenantRoutes);
app.route('/api/v1/workspaces', workspaceRoutes);

// Data routes (all use tenant authMiddleware)
app.route('/api/v1/upload', uploadRoutes);
app.route('/api/v1/files', fileRoutes);
app.route('/webhooks', webhookRoutes);

// Internal routes (for presigned URL uploads)
app.route('/_internal', internalUploadRoutes);

// 404 handler
app.notFound((c) => {
  return c.json(
    {
      error: {
        code: 'NOT_FOUND',
        message: `Route ${c.req.method} ${c.req.path} not found`,
      },
    },
    404
  );
});

// Export for Cloudflare Workers
export default {
  fetch: app.fetch,
};
