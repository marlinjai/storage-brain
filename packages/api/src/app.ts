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
import { internalErasureRoutes } from './routes/internal-erasure';
import { errorHandler } from './middleware/error-handler';
import { rateLimiter, tenantKeyFn } from './middleware/rate-limit';
import { publicDownloadHandler } from './routes/public-download';

export interface AppConfig {
  storage: StorageAdapter;
  db: DatabaseAdapter;
  /** Optional env overrides — used by Node.js entry point to inject process.env values into c.env */
  env?: Partial<Env>;
  /**
   * Called on each /health request. Return false while the app is still
   * initialising (e.g. running migrations) so the healthcheck gets a 503
   * instead of blocking port bind until init completes. Defaults to true
   * (always ready) so Cloudflare Workers and tests are unaffected.
   */
  isReady?: () => boolean;
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

  // Health check — returns 503 while the app is still initialising so
  // Coolify's healthcheck gets a real HTTP response (not "connection refused")
  // immediately after container start, even before migrations complete.
  app.get('/health', (c) => {
    const ready = config.isReady?.() ?? true;
    if (!ready) {
      c.header('Retry-After', '5');
      return c.json({ status: 'starting', timestamp: new Date().toISOString() }, 503);
    }
    return c.json({
      status: 'ok',
      timestamp: new Date().toISOString(),
      environment: c.env.ENVIRONMENT,
    });
  });

  // --- Rate limiting (per route group, not global) ---
  const apiRateLimit = rateLimiter({ windowMs: 60_000, max: 100, keyFn: tenantKeyFn });
  // Byte downloads arrive one-per-file when a gallery renders, so they get a
  // dedicated, generous bucket instead of sharing the 100/60s API-operation
  // budget (tenant-keyed like the rest of the public group).
  const downloadRateLimit = rateLimiter({ windowMs: 60_000, max: 1000, keyFn: tenantKeyFn });
  // Admin & internal limiters stay IP-keyed: admin auth is a single shared key
  // (per-key keying gives no isolation) and the internal uploader is one trusted
  // caller, so per-tenant keying does not apply.
  const adminRateLimit = rateLimiter({ windowMs: 60_000, max: 30 });
  const internalRateLimit = rateLimiter({ windowMs: 60_000, max: 60 });

  // Admin routes first (own auth middleware, must not be intercepted by tenant auth)
  app.use('/api/v1/admin/*', adminRateLimit);
  app.route('/api/v1/admin', adminRoutes);

  // auth-brain GDPR erasure webhook consumer (company-isolation S4). Authenticated
  // ONLY by its HMAC signature over the raw body: it intentionally bypasses the
  // tenant Bearer middleware but never the signature. Registered before the tenant
  // route groups so nothing intercepts it.
  app.route('/api/v1/internal', internalErasureRoutes);

  // Tenant & workspace routes (tenant authMiddleware)
  app.use('/api/v1/tenant/*', apiRateLimit);
  app.use('/api/v1/workspaces/*', apiRateLimit);
  app.route('/api/v1/tenant', tenantRoutes);
  app.route('/api/v1/workspaces', workspaceRoutes);

  // Per-file URL vending on the generous download bucket. A gallery render fans
  // these out one-per-file (download bytes, plus signed-url / permanent-url to
  // mint the link for each tile), so a single page of N files must not exhaust
  // the 100/60s API-operation budget. Mounted before the broad /files limiter
  // (and, for /download, before fileRoutes) so the specific route matches first.
  // The public download route additionally uses token-based auth (no Bearer).
  app.use('/api/v1/files/:fileId/download', downloadRateLimit);
  app.get('/api/v1/files/:fileId/download', publicDownloadHandler);
  app.use('/api/v1/files/:fileId/signed-url', downloadRateLimit);
  app.use('/api/v1/files/:fileId/permanent-url', downloadRateLimit);

  // Remaining /files API operations (list, get, rename, delete) — genuine
  // API operations, not per-file URL vending — stay on the 100/60s bucket.
  // Matched by single-segment patterns (bare collection + one :fileId segment)
  // so the two-segment vending/download routes mounted above are NOT also
  // caught here: a broad /files/* wildcard would double-meter them onto the
  // 100/60s budget and re-introduce the gallery-load 429s.
  app.use('/api/v1/files', apiRateLimit);
  app.use('/api/v1/files/:fileId', apiRateLimit);

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
