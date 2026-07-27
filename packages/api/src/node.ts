import { serve } from '@hono/node-server';
import { createApp } from './app';
import { S3StorageAdapter } from './adapters/storage/s3';
import { PostgresDatabaseAdapter } from './adapters/database/postgres';

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    console.error(`Missing required env var: ${name}`);
    process.exit(1);
  }
  return value;
}

function main(): void {
  const port = parseInt(process.env.PORT ?? '3000', 10);

  // Storage adapter — S3 / MinIO / DO Spaces
  const storage = new S3StorageAdapter({
    bucket: required('S3_BUCKET'),
    region: required('S3_REGION'),
    endpoint: process.env.S3_ENDPOINT,
    credentials: {
      accessKeyId: required('AWS_ACCESS_KEY_ID'),
      secretAccessKey: required('AWS_SECRET_ACCESS_KEY'),
    },
  });

  // Database adapter — Postgres
  const db = new PostgresDatabaseAdapter({
    connectionString: required('DATABASE_URL'),
  });

  // Port binds BEFORE migrations so Coolify's healthcheck gets a real HTTP
  // response immediately. /health returns 503 until migrations complete, then
  // flips to 200. This prevents "connection refused" rollbacks on slow starts.
  let ready = false;

  const app = createApp({
    storage,
    db,
    env: {
      ADMIN_API_KEY: required('ADMIN_API_KEY'),
      URL_SIGNING_SECRET: required('URL_SIGNING_SECRET'),
      ENVIRONMENT: (process.env.ENVIRONMENT as 'development' | 'staging' | 'production') ?? 'production',
      PUBLIC_BASE_URL: process.env.PUBLIC_BASE_URL,
      // HMAC secret for the R2 upload-complete webhook. Optional at boot, but
      // the route fails closed (500) until it is set, so provide it in any
      // environment that receives R2 upload-complete callbacks.
      R2_WEBHOOK_SIGNING_SECRET: process.env.R2_WEBHOOK_SIGNING_SECRET,
      // auth-brain machine-auth (optional; absent -> legacy-only auth). The
      // OpenFGA check is folded into auth-brain's verify endpoint, so this is
      // the only auth-brain config the server needs.
      AUTH_BRAIN_URL: process.env.AUTH_BRAIN_URL,
      // auth-brain GDPR erasure webhook secret (optional at boot; the endpoint
      // fails closed with a 500 if a delivery arrives while it is unset).
      STORAGE_ERASURE_WEBHOOK_SECRET: process.env.STORAGE_ERASURE_WEBHOOK_SECRET,
    },
    isReady: () => ready,
  });

  console.log(`Storage Brain API listening on http://0.0.0.0:${port}`);

  serve({
    fetch: app.fetch,
    port,
    hostname: '0.0.0.0',
  });

  // Run migrations in background — /health returns 503 until this resolves.
  console.log('Running database migrations…');
  db.migrate()
    .then(() => {
      console.log('Migrations complete.');
      ready = true;
    })
    .catch((err) => {
      console.error('Migration failed:', err);
      process.exit(1);
    });

  // Graceful shutdown
  const shutdown = async (): Promise<void> => {
    console.log('\nShutting down…');
    await db.close();
    process.exit(0);
  };

  process.on('SIGTERM', () => void shutdown());
  process.on('SIGINT', () => void shutdown());
}

try {
  main();
} catch (err) {
  console.error('Fatal:', err);
  process.exit(1);
}
