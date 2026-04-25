import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { secureHeaders } from 'hono/secure-headers';
import { requestId } from 'hono/request-id';

import type { AppEnv, Env } from './env';
import type { StorageAdapter, DatabaseAdapter } from '@storage-brain/shared';
import { uploadRoutes } from './routes/upload';
import { fileRoutes } from './routes/files';
import { tenantRoutes } from './routes/tenant';
import { adminRoutes } from './routes/admin';
import { workspaceRoutes } from './routes/workspaces';
import { webhookRoutes } from './routes/webhooks';
import { internalUploadRoutes } from './routes/internal-upload';
import { errorHandler } from './middleware/error-handler';
import { rateLimiter } from './middleware/rate-limit';
import { publicDownloadHandler } from './routes/public-download';

export interface AppConfig {
  storage: StorageAdapter;
  db: DatabaseAdapter;
  /** Optional env overrides — used by Node.js entry point to inject process.env values into c.env */
  env?: Partial<Env>;
}

export function createApp(config: AppConfig): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  // Inject env bindings (for Node.js mode where c.env isn't populated automatically)
  if (config.env) {
    app.use('*', async (c, next) => {
      for (const [key, value] of Object.entries(config.env!)) {
        if (value !== undefined) {
          (c.env as unknown as Record<string, unknown>)[key] = value;
        }
      }
      await next();
    });
  }

  // Inject adapters into Hono context
  app.use('*', async (c, next) => {
    c.set('storage', config.storage);
    c.set('db', config.db);
    await next();
  });

  // Global middleware
  // Note: crossOriginResourcePolicy is set to 'cross-origin' so that file
  // download responses (audio, image, video) can be embedded by browsers on
  // other origins via <audio>/<video>/<img> tags. Without this, Chrome blocks
  // the response with ERR_BLOCKED_BY_RESPONSE.NotSameOrigin even when CORS
  // headers are present.
  app.use('*', secureHeaders({
    xFrameOptions: false,
    crossOriginResourcePolicy: 'cross-origin',
  }));
  app.use('*', requestId());
  app.use('*', logger());
  app.use(
    '*',
    cors({
      origin: '*',
      allowMethods: ['GET', 'HEAD', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
      allowHeaders: ['Content-Type', 'Authorization', 'X-Workspace-Id', 'Range'],
      exposeHeaders: ['X-Request-Id', 'Content-Length', 'Content-Range', 'Accept-Ranges'],
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

  // --- Rate limiting (per route group, not global) ---
  const apiRateLimit = rateLimiter({ windowMs: 60_000, max: 100 });
  const adminRateLimit = rateLimiter({ windowMs: 60_000, max: 30 });
  const internalRateLimit = rateLimiter({ windowMs: 60_000, max: 60 });

  // Admin routes first (own auth middleware, must not be intercepted by tenant auth)
  app.use('/api/v1/admin/*', adminRateLimit);
  app.route('/api/v1/admin', adminRoutes);

  // Tenant & workspace routes (tenant authMiddleware)
  app.use('/api/v1/tenant/*', apiRateLimit);
  app.use('/api/v1/workspaces/*', apiRateLimit);
  app.route('/api/v1/tenant', tenantRoutes);
  app.route('/api/v1/workspaces', workspaceRoutes);

  // Public download route (token-based auth, no Bearer required) — must be registered before fileRoutes
  app.use('/api/v1/files/*', apiRateLimit);
  app.get('/api/v1/files/:fileId/download', publicDownloadHandler);

  // Data routes (all use tenant authMiddleware)
  app.use('/api/v1/upload/*', apiRateLimit);
  app.route('/api/v1/upload', uploadRoutes);
  app.route('/api/v1/files', fileRoutes);
  app.route('/webhooks', webhookRoutes);

  // Internal routes (for presigned URL uploads)
  app.use('/_internal/*', internalRateLimit);
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

  return app;
}
