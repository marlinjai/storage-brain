---
title: "BYOS Platform: Self-Hosting, Adapters & Cloud Tiers"
summary: Design plan to transform Storage Brain and Data Brain from single-provider hosted services into provider-agnostic, self-hostable platforms with free self-hosted and paid cloud tiers including BYOS (Bring Your Own Storage/Database).
category: plan
tags: [self-hosting, byos, storage-brain, data-brain, docker, adapters]
projects: [storage-brain, data-brain, self-hosted]
status: active
date: 2026-02-28
---

# BYOS Platform: Self-Hosting, Adapters & Cloud Tiers for Storage Brain & Data Brain

## Overview

Transform **Storage Brain** and **Data Brain** from single-provider hosted services into **provider-agnostic, self-hostable** platforms — with a free self-hosted tier and a paid cloud tier including BYOS (Bring Your Own Storage / Bring Your Own Database).

The BYOS vision applies the same principle to both services:
- **Storage Brain BYOS**: Connect your own S3/R2/MinIO/GCS bucket — files never touch our servers
- **Data Brain BYOS**: Connect your own Postgres (Neon, Supabase, RDS, Railway) — data stays in your database

This is modeled on how Supabase, Plausible, and GitLab operate: the core is open-source and self-deployable, while the managed cloud offering adds convenience, scale, and premium features.

---

## Current Architecture

```
┌─────────────────────────────────────────────────┐
│  Storage Brain API (Cloudflare Worker)          │
│  ┌───────────┐  ┌────────────┐  ┌───────────┐  │
│  │ Routes    │→ │ r2.ts      │→ │ R2 Bucket │  │
│  │ (Hono)    │  │ (hardcoded)│  │           │  │
│  └───────────┘  └────────────┘  └───────────┘  │
│        ↓                                        │
│  ┌────────────┐                                 │
│  │ queries.ts │→ D1 Database                    │
│  │ (hardcoded)│                                 │
│  └────────────┘                                 │
└─────────────────────────────────────────────────┘
         ↑
  SDK (npm) ─── Users point at our hosted URL
```

**Problems:**
- Storage is hardcoded to Cloudflare R2
- Database is hardcoded to Cloudflare D1
- Users store data on our servers (security/compliance concern)
- No way to swap providers or self-host
- Single point of failure / vendor lock-in

---

## Target Architecture

```
┌──────────────────────────────────────────────────────────────┐
│  Storage Brain API (runs anywhere)                           │
│  ┌───────────┐  ┌──────────────────┐  ┌───────────────────┐ │
│  │ Routes    │→ │ StorageAdapter   │→ │ R2 / S3 / GCS /   │ │
│  │ (Hono)    │  │ (interface)      │  │ MinIO / Azure /   │ │
│  └───────────┘  └──────────────────┘  │ Local disk        │ │
│        ↓                               └───────────────────┘ │
│  ┌──────────────────┐                                        │
│  │ DatabaseAdapter  │→ D1 / Postgres / SQLite / Turso        │
│  │ (interface)      │                                        │
│  └──────────────────┘                                        │
└──────────────────────────────────────────────────────────────┘
         ↑                        ↑
  SDK (npm) ─ same API     Self-hosters deploy this themselves
```

---

## Product Tiers

### Tier 1: Self-Hosted (Free, Open Source)

**What the user gets:**
- Full Storage Brain API + SDK
- Deploy on their own infrastructure (Cloudflare, AWS, Vercel, bare metal)
- Bring their own storage (R2, S3, MinIO, GCS, local disk)
- Bring their own database (D1, Postgres, SQLite, Turso)
- Full control over data residency and security
- Community support (GitHub Issues)

**What they must do:**
- Clone the repo, configure adapters, deploy
- Manage their own infrastructure (buckets, databases, secrets)
- Handle their own backups, monitoring, scaling

**Example setup (self-hosted on AWS):**
```bash
git clone https://github.com/marlinjai/storage-brain
cd storage-brain

# Configure storage + database
cat > config.ts << EOF
export default {
  storage: {
    adapter: 's3',
    bucket: 'my-files',
    region: 'eu-central-1',
    credentials: {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    },
  },
  database: {
    adapter: 'postgres',
    connectionString: process.env.DATABASE_URL,
  },
}
EOF

# Deploy (e.g., Docker, Node, serverless)
docker compose up
```

---

### Tier 2: Cloud Managed (Paid)

**What the user gets:**
- Zero-config hosted Storage Brain at `api.storagebrain.dev`
- Managed R2 storage (default) — no infra to set up
- Managed D1 database — no migrations to run
- Dashboard for file management, usage, billing
- Automatic backups, monitoring, CDN
- Priority support

**Pricing model ideas (placeholder):**

| Plan | Storage | Bandwidth | Price |
|------|---------|-----------|-------|
| Free | 500 MB | 1 GB/mo | $0 |
| Pro | 50 GB | 100 GB/mo | $9/mo |
| Team | 500 GB | 1 TB/mo | $29/mo |
| Enterprise | Custom | Custom | Contact |

---

### Tier 3: Cloud BYOS — Bring Your Own Infrastructure (Paid, Premium)

Enterprise customers use our managed APIs but connect their own storage and/or database backends. Both BYOS features are included in the **Cloud Team** tier ($29/mo).

#### Storage Brain BYOS — Bring Your Own Storage

**What the user gets:**
- Managed Storage Brain API (we run the server)
- But files go to **their** bucket (their S3, GCS, Azure Blob, R2, MinIO)
- They pass credentials during setup; we store them encrypted
- Files never touch our servers — presigned URLs go directly to their bucket
- Useful for enterprises with compliance requirements

**How it works:**

```
User's App → Storage Brain Cloud API → generates presigned URL → User's S3 Bucket
                     ↓
              Our D1 (metadata only)
              Files never stored on our infra
```

**Credential flow:**
1. User creates a tenant on the cloud dashboard
2. Provides: `{ provider: 's3', bucket, region, accessKeyId, secretAccessKey }`
3. We encrypt credentials at rest (using Workers secrets or a KMS)
4. On upload: we generate a presigned PUT URL directly to their bucket
5. On download: we generate a presigned GET URL directly to their bucket
6. Our database only stores metadata (file name, size, type, tags) — not the file

**Supported storage providers:**

| Provider | Config |
|----------|--------|
| AWS S3 | bucket, region, accessKeyId, secretAccessKey |
| Cloudflare R2 | bucket, accountId, accessKeyId, secretAccessKey |
| MinIO | bucket, endpoint, accessKeyId, secretAccessKey |
| Google Cloud Storage | bucket, credentials (service account JSON) |
| DigitalOcean Spaces | bucket, region, endpoint, accessKeyId, secretAccessKey |

---

#### Data Brain BYOS — Bring Your Own Database

**What the user gets:**
- Managed Data Brain API (we run the server)
- But structured data goes to **their** Postgres database
- They provide a connection string during setup; we store it encrypted
- Data never touches our D1 — queries execute directly against their Postgres
- Same API, same SDK, same multi-tenant isolation — just a different backend

**How it works:**

```
User's App → Data Brain Cloud API → PostgresAdapter → User's Neon/Supabase/RDS
                     ↓
              Tenant lookup still on our D1
              But all table/row/column data lives in their Postgres
```

**Supported Postgres providers:**

| Provider | Connection Format |
|----------|------------------|
| Neon | `postgresql://user:pass@ep-xxx.us-east-2.aws.neon.tech/dbname?sslmode=require` |
| Supabase | `postgresql://postgres:pass@db.xxx.supabase.co:5432/postgres` |
| AWS RDS | `postgresql://user:pass@xxx.region.rds.amazonaws.com:5432/dbname` |
| Railway | `postgresql://postgres:pass@xxx.railway.app:5432/railway` |
| Any Postgres-compatible | Any standard `postgresql://` connection string |

**Credential flow:**
1. User creates a tenant on the cloud dashboard
2. Provides: `{ provider: 'postgres', connectionString: 'postgresql://...' }`
3. We encrypt the connection string at rest (using Workers secrets or a KMS)
4. We run a connectivity test (simple `SELECT 1`) before saving
5. We run Data Brain migrations on their database to create the `dt_*` tables
6. On every request: decrypt connection string, connect via connection pool, execute query
7. Tenant management tables remain on our D1 — only the data tables live on their Postgres

**Key constraint:** The PostgresAdapter already exists (used in self-hosted mode). Data Brain BYOS reuses the exact same adapter — the only difference is credential source (encrypted tenant config vs. environment variable).

---

## Per-Tenant Adapter Resolution (Unified Pattern)

Both Storage Brain BYOS and Data Brain BYOS follow the same per-tenant adapter resolution pattern:

```
Request → Auth middleware → Resolve tenant → Check tenant config
  → If custom config: decrypt credentials, instantiate provider-specific adapter
  → If no config: use default managed infrastructure (R2/D1)
```

### Unified Resolution Flow

```typescript
// Middleware that resolves the correct adapter per-tenant (works for both services)
app.use('*', async (c, next) => {
  const tenant = c.get('tenant');

  // Storage Brain: resolve storage adapter
  if (tenant.storageConfig) {
    const config = await decrypt(tenant.storageConfig, env.ENCRYPTION_KEY);
    c.set('storage', createStorageAdapter(config)); // S3, GCS, R2, etc.
  } else {
    c.set('storage', new R2StorageAdapter(env.BUCKET)); // default
  }

  // Data Brain: resolve database adapter
  if (tenant.databaseConfig) {
    const config = await decrypt(tenant.databaseConfig, env.ENCRYPTION_KEY);
    c.set('database', createDatabaseAdapter(config)); // Postgres via Neon, Supabase, etc.
  } else {
    c.set('database', new D1DatabaseAdapter(env.DB)); // default
  }

  await next();
});
```

### Database Schema Additions for BYOS

```sql
-- Storage Brain BYOS
ALTER TABLE tenants ADD COLUMN storage_config TEXT;
-- Encrypted JSON: { provider, bucket, region, credentials }
-- NULL = use managed R2 storage (default)

-- Data Brain BYOS
ALTER TABLE tenants ADD COLUMN database_config TEXT;
-- Encrypted JSON: { provider: 'postgres', connectionString }
-- NULL = use managed D1 database (default)
```

---

## Storage Adapter Interface

The core abstraction. Every storage provider implements this.

```typescript
// packages/shared/src/storage-adapter.ts

export interface StorageObject {
  key: string;
  size: number;
  contentType: string;
  lastModified: Date;
  etag?: string;
}

export interface PutOptions {
  contentType: string;
  metadata?: Record<string, string>;
}

export interface GetResult {
  body: ReadableStream | ArrayBuffer;
  contentType: string;
  size: number;
  etag?: string;
}

export interface PresignedUrlOptions {
  expiresIn: number;     // seconds
  contentType?: string;  // for PUT URLs
}

export interface StorageAdapter {
  /**
   * Store a file. Used for server-side uploads (small files, internal ops).
   */
  put(key: string, data: ReadableStream | ArrayBuffer, options: PutOptions): Promise<StorageObject>;

  /**
   * Retrieve a file.
   */
  get(key: string): Promise<GetResult | null>;

  /**
   * Delete a file.
   */
  delete(key: string): Promise<void>;

  /**
   * Check if a file exists.
   */
  exists(key: string): Promise<boolean>;

  /**
   * Get file metadata without downloading.
   */
  head(key: string): Promise<StorageObject | null>;

  /**
   * Generate a presigned URL for direct upload (browser → storage).
   * Returns null if the adapter doesn't support presigning (e.g., local disk).
   */
  getPresignedUploadUrl?(key: string, options: PresignedUrlOptions): Promise<string>;

  /**
   * Generate a presigned URL for direct download (browser ← storage).
   * Returns null if the adapter doesn't support presigning.
   */
  getPresignedDownloadUrl?(key: string, options: PresignedUrlOptions): Promise<string>;
}
```

### Adapter Implementations

#### 1. R2 Adapter (Cloudflare — current default)

```typescript
// packages/api/src/adapters/storage/r2.ts

export class R2StorageAdapter implements StorageAdapter {
  constructor(private bucket: R2Bucket) {}

  async put(key, data, options) {
    const obj = await this.bucket.put(key, data, {
      httpMetadata: { contentType: options.contentType },
      customMetadata: options.metadata,
    });
    return { key, size: obj.size, contentType: options.contentType, ... };
  }

  async get(key) {
    const obj = await this.bucket.get(key);
    if (!obj) return null;
    return { body: obj.body, contentType: obj.httpMetadata?.contentType, size: obj.size };
  }

  // R2 presigned URLs require S3-compatible API access
  // This uses the S3 client with R2's S3 endpoint
  async getPresignedDownloadUrl(key, options) {
    // Uses @aws-sdk/s3-request-presigner with R2's S3 endpoint
    // Requires R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_ACCOUNT_ID env vars
  }
}
```

#### 2. S3 Adapter (AWS / any S3-compatible)

```typescript
// packages/api/src/adapters/storage/s3.ts

export class S3StorageAdapter implements StorageAdapter {
  private client: S3Client;

  constructor(config: {
    bucket: string;
    region: string;
    endpoint?: string;  // For MinIO, Backblaze, etc.
    credentials: { accessKeyId: string; secretAccessKey: string };
  }) {}

  async put(key, data, options) { /* PutObjectCommand */ }
  async get(key) { /* GetObjectCommand */ }
  async getPresignedUploadUrl(key, options) { /* @aws-sdk/s3-request-presigner */ }
  async getPresignedDownloadUrl(key, options) { /* @aws-sdk/s3-request-presigner */ }
}
```

#### 3. GCS Adapter (Google Cloud Storage)

```typescript
// packages/api/src/adapters/storage/gcs.ts

export class GCSStorageAdapter implements StorageAdapter {
  constructor(config: { bucket: string; credentials: object }) {}
  // Uses @google-cloud/storage
}
```

#### 4. Local Filesystem Adapter (Development / Testing)

```typescript
// packages/api/src/adapters/storage/local.ts

export class LocalStorageAdapter implements StorageAdapter {
  constructor(private basePath: string) {}

  async put(key, data, options) {
    const filePath = path.join(this.basePath, key);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, Buffer.from(data));
  }

  // No presigning — files served through the API proxy route
  getPresignedUploadUrl = undefined;
  getPresignedDownloadUrl = undefined;
}
```

---

## Database Adapter Interface

```typescript
// packages/shared/src/database-adapter.ts

export interface DatabaseAdapter {
  // Tenant operations
  getTenantByApiKeyHash(hash: string): Promise<Tenant | null>;
  createTenant(input: CreateTenantInput): Promise<Tenant>;

  // File operations
  createFile(input: CreateFileInput): Promise<StoredFile>;
  getFile(fileId: string, tenantId: string): Promise<StoredFile | null>;
  listFiles(tenantId: string, options: ListFilesOptions): Promise<{ files: StoredFile[]; total: number }>;
  softDeleteFile(fileId: string, tenantId: string): Promise<void>;
  updateFileStatus(fileId: string, status: string): Promise<void>;

  // Upload sessions
  createUploadSession(input: CreateUploadSessionInput): Promise<UploadSession>;
  getUploadSession(fileId: string): Promise<UploadSession | null>;
  completeUploadSession(sessionId: string): Promise<void>;

  // Quota
  checkQuota(tenantId: string, sizeBytes: number): Promise<{ hasCapacity: boolean; available: number }>;
  reserveQuota(tenantId: string, sizeBytes: number): Promise<void>;
  decrementQuota(tenantId: string, sizeBytes: number): Promise<void>;

  // Workspaces
  createWorkspace(input: CreateWorkspaceInput): Promise<Workspace>;
  getWorkspace(workspaceId: string, tenantId: string): Promise<Workspace | null>;
  listWorkspaces(tenantId: string): Promise<Workspace[]>;
  updateWorkspace(workspaceId: string, tenantId: string, input: UpdateWorkspaceInput): Promise<Workspace>;
  deleteWorkspace(workspaceId: string, tenantId: string): Promise<void>;

  // Migrations
  migrate(): Promise<void>;
}
```

### Database Adapter Implementations

| Adapter | Target | Use Case |
|---------|--------|----------|
| `D1DatabaseAdapter` | Cloudflare D1 | Cloud tier, Cloudflare self-host |
| `PostgresDatabaseAdapter` | PostgreSQL | Self-host on AWS/VPS/Docker |
| `SqliteDatabaseAdapter` | SQLite (via better-sqlite3) | Local dev, testing, small self-host |
| `TursoDatabaseAdapter` | Turso (libSQL) | Edge-native Postgres alternative |

---

## Configuration System

Self-hosters configure Storage Brain via a config file or environment variables.

### Option A: Config file (`storage-brain.config.ts`)

```typescript
import { defineConfig } from '@storage-brain/api';
import { S3StorageAdapter } from '@storage-brain/adapter-s3';
import { PostgresDatabaseAdapter } from '@storage-brain/adapter-postgres';

export default defineConfig({
  storage: new S3StorageAdapter({
    bucket: 'my-app-files',
    region: 'eu-central-1',
    credentials: {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
    },
  }),

  database: new PostgresDatabaseAdapter({
    connectionString: process.env.DATABASE_URL!,
  }),

  auth: {
    adminApiKey: process.env.ADMIN_API_KEY!,
  },

  // Optional
  cors: { origins: ['https://myapp.com'] },
  maxFileSize: 50 * 1024 * 1024, // 50MB
  allowedFileTypes: ['image/*', 'application/pdf'],
});
```

### Option B: Environment variables only (simpler)

```env
STORAGE_ADAPTER=s3
S3_BUCKET=my-app-files
S3_REGION=eu-central-1
AWS_ACCESS_KEY_ID=...
AWS_SECRET_ACCESS_KEY=...

DATABASE_ADAPTER=postgres
DATABASE_URL=postgresql://user:pass@host:5432/storage_brain

ADMIN_API_KEY=...
```

**Recommendation:** Support both. Config file for full control, env vars for Docker/serverless deployments.

---

## Package Structure (After Refactor)

```
projects/lumitra-infra/storage-brain/
├── packages/
│   ├── api/                          # Core API (Hono) — provider-agnostic
│   │   ├── src/
│   │   │   ├── index.ts              # Entry point, loads config
│   │   │   ├── routes/               # Same routes, but use adapter interfaces
│   │   │   ├── middleware/           # Auth (unchanged)
│   │   │   ├── adapters/
│   │   │   │   ├── storage/
│   │   │   │   │   ├── interface.ts  # StorageAdapter interface
│   │   │   │   │   ├── r2.ts        # Cloudflare R2 (default)
│   │   │   │   │   ├── s3.ts        # AWS S3 / S3-compatible
│   │   │   │   │   ├── gcs.ts       # Google Cloud Storage
│   │   │   │   │   ├── azure.ts     # Azure Blob (later)
│   │   │   │   │   └── local.ts     # Local filesystem (dev)
│   │   │   │   └── database/
│   │   │   │       ├── interface.ts  # DatabaseAdapter interface
│   │   │   │       ├── d1.ts         # Cloudflare D1 (default)
│   │   │   │       ├── postgres.ts   # PostgreSQL
│   │   │   │       ├── sqlite.ts     # SQLite
│   │   │   │       └── turso.ts      # Turso (later)
│   │   │   ├── config.ts            # Config loading (file + env)
│   │   │   └── services/
│   │   │       ├── quota.ts          # Uses DatabaseAdapter
│   │   │       └── webhook.ts        # Unchanged
│   │   ├── wrangler.toml             # Cloudflare deployment (uses R2 + D1)
│   │   ├── Dockerfile                # Docker deployment (uses S3 + Postgres)
│   │   └── docker-compose.yml        # One-command self-hosting
│   │
│   ├── sdk/                          # SDK — unchanged, provider-agnostic already
│   │   └── src/
│   │       ├── client.ts             # Points at any Storage Brain URL
│   │       └── ...
│   │
│   └── shared/                       # Shared types & schemas
│       └── src/
│           ├── types.ts              # Add adapter interfaces
│           ├── schemas.ts            # Unchanged
│           └── constants.ts          # Unchanged
│
├── docker-compose.yml                # Self-hosting quick start
├── Dockerfile                        # API container image
└── docs/
    ├── self-hosting.md               # Self-hosting guide
    └── adapters.md                   # How to write custom adapters
```

---

## How the Refactor Works

### Step 1: Extract Storage Interface (from `r2.ts`)

Current `r2.ts` has 5 functions. Map them to the interface:

| Current function | Adapter method |
|------------------|---------------|
| `uploadToR2(bucket, key, data, contentType)` | `adapter.put(key, data, { contentType })` |
| `getFromR2(bucket, key)` | `adapter.get(key)` |
| `existsInR2(bucket, key)` | `adapter.exists(key)` |
| `deleteFromR2(bucket, key)` | `adapter.delete(key)` |
| `generatePresignedUrl(bucket, key)` | `adapter.getPresignedUploadUrl(key, opts)` |

### Step 2: Extract Database Interface (from `queries.ts`)

Current `queries.ts` has ~15 functions that take `db: D1Database`. Wrap them into a class:

| Current function | Adapter method |
|------------------|---------------|
| `getTenantByApiKeyHash(db, hash)` | `adapter.getTenantByApiKeyHash(hash)` |
| `insertFile(db, ...)` | `adapter.createFile(input)` |
| `getFileById(db, id, tenantId)` | `adapter.getFile(id, tenantId)` |
| `listFiles(db, tenantId, ...)` | `adapter.listFiles(tenantId, options)` |
| etc. | etc. |

### Step 3: Dependency Injection via Hono Context

```typescript
// packages/api/src/index.ts

import { Hono } from 'hono';
import { loadConfig } from './config';

const config = loadConfig();

const app = new Hono();

// Inject adapters into Hono context
app.use('*', async (c, next) => {
  c.set('storage', config.storage);   // StorageAdapter
  c.set('database', config.database); // DatabaseAdapter
  await next();
});

// Routes use adapters from context
app.get('/api/v1/files/:fileId/download', async (c) => {
  const storage = c.get('storage');
  const db = c.get('database');
  const file = await db.getFile(fileId, tenantId);
  const result = await storage.get(file.storedPath);
  // ...
});
```

### Step 4: Cloudflare Entry Point (backward compatible)

```typescript
// packages/api/src/cloudflare.ts — Cloudflare Workers entry point

import { createApp } from './index';
import { R2StorageAdapter } from './adapters/storage/r2';
import { D1DatabaseAdapter } from './adapters/database/d1';

export default {
  async fetch(request: Request, env: Env) {
    const app = createApp({
      storage: new R2StorageAdapter(env.BUCKET),
      database: new D1DatabaseAdapter(env.DB),
      adminApiKey: env.ADMIN_API_KEY,
    });
    return app.fetch(request);
  },
};
```

### Step 5: Docker Entry Point (self-hosting)

```typescript
// packages/api/src/node.ts — Node.js entry point

import { serve } from '@hono/node-server';
import { createApp } from './index';
import { S3StorageAdapter } from './adapters/storage/s3';
import { PostgresDatabaseAdapter } from './adapters/database/postgres';

const app = createApp({
  storage: new S3StorageAdapter({
    bucket: process.env.S3_BUCKET!,
    region: process.env.S3_REGION!,
    endpoint: process.env.S3_ENDPOINT,     // For MinIO
    credentials: {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
    },
  }),
  database: new PostgresDatabaseAdapter({
    connectionString: process.env.DATABASE_URL!,
  }),
  adminApiKey: process.env.ADMIN_API_KEY!,
});

serve({ fetch: app.fetch, port: 3000 });
```

---

## Docker Self-Hosting (One Command)

```yaml
# docker-compose.yml
services:
  storage-brain:
    build: .
    ports:
      - "3000:3000"
    environment:
      - STORAGE_ADAPTER=s3
      - S3_ENDPOINT=http://minio:9000
      - S3_BUCKET=storage-brain
      - AWS_ACCESS_KEY_ID=minioadmin
      - AWS_SECRET_ACCESS_KEY=minioadmin
      - DATABASE_ADAPTER=postgres
      - DATABASE_URL=postgresql://postgres:postgres@postgres:5432/storage_brain
      - ADMIN_API_KEY=your-admin-key
    depends_on:
      - postgres
      - minio

  postgres:
    image: postgres:16-alpine
    environment:
      POSTGRES_DB: storage_brain
      POSTGRES_PASSWORD: postgres
    volumes:
      - pgdata:/var/lib/postgresql/data

  minio:
    image: minio/minio
    command: server /data --console-address ":9001"
    environment:
      MINIO_ROOT_USER: minioadmin
      MINIO_ROOT_PASSWORD: minioadmin
    volumes:
      - miniodata:/data
    ports:
      - "9001:9001"  # MinIO console

volumes:
  pgdata:
  miniodata:
```

**Self-hosting in 3 commands:**
```bash
git clone https://github.com/marlinjai/storage-brain
cd storage-brain
docker compose up
```

---

## Cloud BYOS: How Credential Management Works

For the paid cloud tier where users bring their own storage (S3/GCS/R2) and/or their own database (Postgres):

### Credential Storage

```
User Dashboard                      Lumitra Cloud
┌─────────────┐     HTTPS          ┌──────────────────────────┐
│ Configure   │ ──────────────────→│ Encrypt credentials      │
│ S3 bucket   │                    │ with Workers KMS         │
│ + creds     │                    │ Store in D1 (tenants)    │
└─────────────┘                    └──────────────────────────┘

┌─────────────┐     HTTPS          ┌──────────────────────────┐
│ Configure   │ ──────────────────→│ Encrypt connection string│
│ Postgres DB │                    │ with Workers KMS         │
│ + conn str  │                    │ Store in D1 (tenants)    │
└─────────────┘                    └──────────────────────────┘
```

- Credentials encrypted at rest using Cloudflare Workers `crypto.subtle`
- Encryption key stored as a Worker secret (never in code/D1)
- Credentials decrypted only at request time, never logged
- Users can rotate credentials via dashboard
- Connection test runs before saving (storage: HEAD request on bucket; database: `SELECT 1`)

### Per-Tenant Storage Adapter Resolution

```typescript
// Cloud mode: resolve storage adapter per-tenant
async function getStorageAdapter(tenant: Tenant): Promise<StorageAdapter> {
  if (tenant.storageConfig) {
    // BYOS tenant — decrypt their credentials, build adapter
    const config = await decrypt(tenant.storageConfig, env.ENCRYPTION_KEY);
    switch (config.provider) {
      case 's3': return new S3StorageAdapter(config);
      case 'gcs': return new GCSStorageAdapter(config);
      case 'r2': return new R2StorageAdapter(config);
    }
  }
  // Default: use our managed R2 bucket
  return new R2StorageAdapter(env.BUCKET);
}
```

### Per-Tenant Database Adapter Resolution

```typescript
// Cloud mode: resolve database adapter per-tenant
async function getDatabaseAdapter(tenant: Tenant): Promise<TenantDatabaseAdapter> {
  if (tenant.databaseConfig) {
    // BYOS tenant — decrypt their connection string, build adapter
    const config = await decrypt(tenant.databaseConfig, env.ENCRYPTION_KEY);
    switch (config.provider) {
      case 'postgres':
        return new PostgresDatabaseAdapter({
          connectionString: config.connectionString,
          // Use connection pooling to avoid exhausting their pool
          maxConnections: config.maxConnections ?? 5,
        });
    }
  }
  // Default: use our managed D1 database
  return new D1DatabaseAdapter(env.DB);
}
```

### Database Schema Additions for BYOS

```sql
-- Storage Brain BYOS
ALTER TABLE tenants ADD COLUMN storage_config TEXT;
-- Encrypted JSON: { provider, bucket, region, credentials }
-- NULL = use managed storage (default)

-- Data Brain BYOS
ALTER TABLE tenants ADD COLUMN database_config TEXT;
-- Encrypted JSON: { provider: 'postgres', connectionString, maxConnections? }
-- NULL = use managed database (default)
```

---

## Request Flows: Self-Hosted vs Cloud vs BYOS

### Storage Brain Flows

#### Self-Hosted (user's own infra)

```
Browser → Storage Brain API → adapter.put() → User's S3/MinIO/local
                ↓
         User's Postgres/SQLite (metadata)
```

#### Cloud Managed (our infra)

```
Browser → Storage Brain Cloud API → R2StorageAdapter.put() → Our R2 Bucket
                   ↓
            Our D1 (metadata)
```

#### Cloud Storage BYOS (our API, their storage)

```
Browser → Storage Brain Cloud API → getPresignedUploadUrl() → returns URL to User's S3
Browser ──────── direct upload ──────────────────────────────→ User's S3 Bucket
Browser → Storage Brain Cloud API → confirmUpload()
                   ↓
            Our D1 (metadata only, no file bytes)
```

### Data Brain Flows

#### Self-Hosted (user's own infra)

```
App → Data Brain API → PostgresAdapter → User's Postgres
         (all data on user's infra)
```

#### Cloud Managed (our infra)

```
App → Data Brain Cloud API → D1Adapter → Our D1 Database
         (all data on Cloudflare edge)
```

#### Cloud Database BYOS (our API, their database)

```
App → Data Brain Cloud API → Resolve tenant → Decrypt connection string
         ↓                                         ↓
  Tenant lookup on our D1              PostgresAdapter → User's Neon/Supabase/RDS
  (tenant management only)             (all table/row/column data on their Postgres)
```

---

## SDK Impact

**None.** The SDK is already provider-agnostic — it talks to a URL. Self-hosters just point it at their own URL:

```typescript
// Cloud user
const sb = new StorageBrain({
  apiKey: 'sk_live_...',
  // baseUrl defaults to https://api.storagebrain.dev
});

// Self-hosted user
const sb = new StorageBrain({
  apiKey: 'sk_live_...',
  baseUrl: 'https://storage.my-company.com',
});
```

---

## Implementation Phases

### Phase 1: Storage Adapter Extraction (Foundation)

**Goal:** Decouple R2 from routes. No new providers yet, but the interface exists.

1. Define `StorageAdapter` interface in `shared/`
2. Create `R2StorageAdapter` implementing the interface (wrap existing `r2.ts`)
3. Create `D1DatabaseAdapter` implementing `DatabaseAdapter` (wrap existing `queries.ts`)
4. Refactor `createApp()` to accept adapters via config
5. Update Cloudflare entry point (`cloudflare.ts`) to inject R2 + D1 adapters
6. All existing tests pass, zero behavior change

**Effort:** ~2-3 sessions. Purely mechanical refactor.

### Phase 2: S3 Adapter + Docker Deployment

**Goal:** Self-hosting works with S3 + Postgres.

1. Implement `S3StorageAdapter` (using `@aws-sdk/client-s3` + presigner)
2. Implement `PostgresDatabaseAdapter` (using `pg` or `postgres`)
3. Create Node.js entry point (`node.ts`)
4. Write Postgres migration SQL (matching D1 schema)
5. Create `Dockerfile` + `docker-compose.yml` with MinIO + Postgres
6. Write self-hosting documentation
7. Test: `docker compose up` → upload a file → download it

**Effort:** ~3-4 sessions

### Phase 3: Presigned URLs (Signed Download URLs)

**Goal:** Generate time-limited download URLs for browser consumption.

1. Add `getPresignedDownloadUrl` to `StorageAdapter` interface
2. Implement for R2 (S3-compatible presigning via R2's S3 endpoint)
3. Implement for S3 (native presigning)
4. Add `GET /api/v1/files/:fileId/signed-url` route
5. Add `getSignedUrl(fileId)` to SDK
6. Fallback for adapters without presigning: HMAC-signed proxy URL through the API

**Effort:** ~1-2 sessions

### Phase 4: Local Filesystem Adapter

**Goal:** Zero-dependency local development.

1. Implement `LocalStorageAdapter` (reads/writes to disk)
2. Implement `SqliteDatabaseAdapter` (using better-sqlite3)
3. Add `storage-brain dev` CLI command (starts API with local adapters)
4. No Docker, no cloud credentials needed for development

**Effort:** ~1-2 sessions

### Phase 5: Cloud Storage BYOS

**Goal:** Cloud users can attach their own S3/GCS bucket (Storage Brain).

1. Add `storage_config` column to tenants table
2. Build credential encryption/decryption layer (shared by both BYOS features)
3. Per-tenant storage adapter resolution at request time
4. Dashboard UI for configuring storage provider + credentials
5. Validation: test connection before saving (try a HEAD request on bucket)

**Effort:** ~3-4 sessions

### Phase 6: Cloud Database BYOS

**Goal:** Cloud users can attach their own Postgres database (Data Brain).

1. Add `database_config` column to tenants table
2. Reuse credential encryption/decryption layer from Phase 5
3. Per-tenant database adapter resolution at request time
4. PostgresAdapter already exists — reuse from self-hosted mode
5. Auto-run Data Brain migrations (`dt_*` tables) on their database on first connect
6. Connection pooling configuration (respect their provider's connection limits)
7. Dashboard UI for configuring Postgres connection string
8. Validation: test connection before saving (`SELECT 1`), verify migrations

**Supported providers (day one):**
- Neon (serverless Postgres, connection pooling built-in)
- Supabase (managed Postgres)
- AWS RDS (standard managed Postgres)
- Railway (simple managed Postgres)
- Any Postgres-compatible database with a standard connection string

**Effort:** ~2-3 sessions (less than Storage BYOS because the PostgresAdapter already exists)

### Phase 7: Additional Providers (As Needed)

- GCS storage adapter
- Azure Blob storage adapter
- Turso database adapter
- Backblaze B2 (S3-compatible, works via S3 adapter with custom endpoint)
- CockroachDB (Postgres-compatible, works via Postgres adapter)

---

## What Changes, What Doesn't

| Component | Changes? | Notes |
|-----------|----------|-------|
| SDK (`@marlinjai/storage-brain-sdk`) | No | Already provider-agnostic |
| API routes | Minimal | Replace `r2.function()` → `adapter.method()` |
| Auth middleware | No | Same Bearer token flow |
| Quota system | Minimal | Moves from raw SQL to `DatabaseAdapter` methods |
| Webhook system | No | Unchanged |
| Shared types/schemas | Additions | New adapter interfaces |
| `wrangler.toml` | No | Still works for Cloudflare deployments |
| Database schema | No | Same tables, adapters just target different DBs |

---

## Risks & Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| S3 SDK bundle too large for Workers | Can't deploy S3 adapter on Cloudflare | Use tree-shaking; S3 adapter only loaded when configured. Or use lightweight `aws4fetch` instead of full SDK |
| Postgres adapter adds latency on edge | Slower than D1 on Cloudflare | Only used for self-hosting; Cloudflare users keep D1 |
| BYOS credential leak | Security breach | Encrypt at rest, decrypt only at request time, audit log access, rotate support |
| Docker image size | Slow pulls | Multi-stage build, Alpine base, exclude unused adapters |
| Too many adapters to maintain | Maintenance burden | Start with R2 + S3 only. GCS/Azure only if demanded. S3-compatible covers MinIO, Backblaze, DigitalOcean Spaces |

---

## Decision Points

Before implementation, decisions needed:

1. **Config format**: TypeScript config file vs env vars vs both?
   - Recommendation: Both (config file for complex setups, env vars for Docker)

2. **Adapter packaging**: Adapters in API package or separate npm packages?
   - Recommendation: Start in API package, extract to `@storage-brain/adapter-s3` etc. only if bundle size becomes an issue

3. **Minimum viable adapters**: Which adapters for v1?
   - Recommendation: R2 (existing) + S3 (covers MinIO, Backblaze, DO Spaces) + Local (dev)

4. **Database adapters for v1?**
   - Recommendation: D1 (existing) + Postgres (self-hosting) + SQLite (dev/testing)

5. **Should the repo go public / open source for self-hosting?**
   - Needed for the "free self-hosted" model to work. License: MIT or AGPLv3 (AGPL prevents competitors from hosting it without contributing back — this is what Supabase uses for some components)

---

## Comparable Products

| Product | Self-hosted | Cloud | BYOS Storage | BYOS Database | License |
|---------|-------------|-------|--------------|---------------|---------|
| Supabase | Yes (Docker) | Yes | Yes (S3) | No (managed only) | Apache 2.0 |
| MinIO | Yes | Yes | N/A (it IS the storage) | N/A | AGPL |
| Uploadthing | No | Yes | No | No | Proprietary |
| Cloudinary | No | Yes | No | No | Proprietary |
| Neon | No | Yes | N/A | N/A (it IS the DB) | Apache 2.0 |
| **Lumitra (target)** | **Yes** | **Yes** | **Yes (S3/R2/GCS/MinIO)** | **Yes (any Postgres)** | **TBD** |

---

## Summary

This design turns **both Storage Brain and Data Brain** from Cloudflare-locked hosted services into **portable, provider-agnostic platforms** with three deployment modes:

1. **Self-hosted free** — clone, configure adapters, deploy anywhere
2. **Cloud managed paid** — zero-config, we handle everything
3. **Cloud BYOS paid** — we run the APIs, but data goes to their infrastructure:
   - **Storage Brain BYOS**: files go to their S3/R2/MinIO/GCS bucket
   - **Data Brain BYOS**: structured data goes to their Postgres (Neon, Supabase, RDS, Railway)

Both BYOS features share the same patterns:
- Per-tenant adapter resolution at request time
- Encrypted credential storage with Workers KMS
- Connection validation before saving
- Same SDK, same API routes — only the backend adapter changes

The SDKs stay identical. The API routes stay identical. Only the storage and database layers become pluggable via clean adapter interfaces. Implementation starts with a mechanical refactor (Phase 1) and builds up incrementally through Phase 7.
