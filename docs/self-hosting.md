# Self-Hosting Storage Brain

Run Storage Brain on your own infrastructure with Docker.

## Quick Start

```bash
git clone https://github.com/marlinjai/storage-brain.git
cd storage-brain
docker compose up
```

The API will be available at `http://localhost:3000`.

## Create a Tenant

```bash
curl -X POST http://localhost:3000/api/v1/admin/tenants \
  -H "Authorization: Bearer admin-dev-key" \
  -H "Content-Type: application/json" \
  -d '{"name": "my-app"}'
```

Save the `apiKey` from the response — you'll use it with the SDK.

## Use the SDK

```bash
npm install @marlinjai/storage-brain-sdk
```

```typescript
import { StorageBrain } from '@marlinjai/storage-brain-sdk';

const client = new StorageBrain({
  apiKey: 'sb_live_...',
  baseUrl: 'http://localhost:3000',
});

// Upload a file
const file = await client.upload(buffer, {
  fileName: 'photo.jpg',
  fileType: 'image/jpeg',
});
```

## Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `S3_BUCKET` | Yes | — | S3-compatible bucket name |
| `S3_REGION` | Yes | — | Bucket region |
| `S3_ENDPOINT` | No | — | Custom S3 endpoint (MinIO, DO Spaces) |
| `AWS_ACCESS_KEY_ID` | Yes | — | S3 access key |
| `AWS_SECRET_ACCESS_KEY` | Yes | — | S3 secret key |
| `DATABASE_URL` | Yes | — | Postgres connection string |
| `ADMIN_API_KEY` | Yes | — | Admin API key for tenant management |
| `URL_SIGNING_SECRET` | Yes | — | Secret for signing download URLs |
| `PORT` | No | `3000` | API server port |
| `ENVIRONMENT` | No | `production` | `development`, `staging`, or `production` |

## Architecture

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│  Your App   │────▶│  API        │────▶│  Postgres   │
│  (SDK)      │     │  (Node.js)  │     │  (metadata) │
└─────────────┘     └──────┬──────┘     └─────────────┘
                           │
                    ┌──────▼──────┐
                    │  S3 / MinIO │
                    │  (files)    │
                    └─────────────┘
```

## Production Tips

- Replace `ADMIN_API_KEY` and `URL_SIGNING_SECRET` with strong random values
- Use a managed Postgres instance (RDS, Supabase, Neon)
- Use a managed S3-compatible store (AWS S3, Backblaze B2, DigitalOcean Spaces)
- Put a reverse proxy (nginx/Caddy) in front for TLS
