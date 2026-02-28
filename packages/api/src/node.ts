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

async function main() {
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

  // Run migrations
  console.log('Running database migrations…');
  await db.migrate();
  console.log('Migrations complete.');

  // Create Hono app with injected adapters
  const app = createApp({ storage, db });

  console.log(`Storage Brain API listening on http://0.0.0.0:${port}`);

  serve({
    fetch: app.fetch,
    port,
    hostname: '0.0.0.0',
  });

  // Graceful shutdown
  const shutdown = async () => {
    console.log('\nShutting down…');
    await db.close();
    process.exit(0);
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
