# Storage Brain - Edge-Native File Storage Micro-Product

A lightweight, edge-native file storage service built on Cloudflare Workers, R2, and D1. Designed as both an internal foundation for a suite of products and a standalone micro-product (private "Upload-as-a-Service").

## Goals

- **Edge-First Performance**: <20ms global response time
- **Micro-Product Ready**: Exportable, reusable, pluggable architecture
- **Type-Safe**: Full TypeScript with autocomplete support
- **Multi-Tenant**: Secure tenant isolation and quota management

## Tech Stack

| Component | Technology | Notes |
|-----------|------------|-------|
| **Runtime** | Cloudflare Workers | Edge-native, <20ms latency |
| **Framework** | Hono | Ultra-lightweight, faster than Express |
| **Language** | TypeScript | Full type safety |
| **Database** | D1 | Cloudflare SQL, edge-native |
| **Storage** | R2 | S3-compatible, presigned URLs |
| **Validation** | Zod | Runtime type safety |
| **Package Manager** | pnpm | Workspaces for monorepo |

## Architecture

Two-layer design:

```
┌─────────────────────────────────────────┐
│         Client Applications             │
└─────────────────┬───────────────────────┘
                  │ TypeScript SDK
┌─────────────────▼───────────────────────┐
│   SDK (@marlinjai/storage-brain-sdk)    │
│   - Type-safe API client                │
│   - Progress tracking, retry logic      │
└─────────────────┬───────────────────────┘
                  │ HTTP/REST
┌─────────────────▼───────────────────────┐
│       Gatekeeper (API)                  │
│   - Handshake + presigned URLs          │
│   - Quota validation                    │
│   - API key authentication              │
│   - Webhooks                            │
└─────────────────┬───────────────────────┘
                  │
         ┌───────┴───────┐
         ▼               ▼
┌─────────────┐  ┌─────────────┐
│  R2 Bucket  │  │ D1 Database │
└─────────────┘  └─────────────┘
```

## Project Structure

```
storage-brain/
├── packages/
│   ├── api/      # Cloudflare Workers API (@storage-brain/api)
│   ├── sdk/      # TypeScript SDK (@marlinjai/storage-brain-sdk on npm)
│   └── shared/   # Internal types & Zod schemas (@storage-brain/shared)
├── docs/         # Clearify documentation
└── package.json  # pnpm workspaces root
```

## Key Decisions

- **Database**: D1 (free tier: 5M reads/day, 100K writes/day)
- **Auth**: Simple API keys per tenant (`sk_live_` / `sk_test_` prefix)
- **File Types**: Images (JPEG, PNG, WebP, GIF, AVIF) + PDFs
- **Quotas**: Hard limits, per-tenant configurable (default 500MB)
- **Deployment**: Single worker on workers.dev (MVP)

See [DECISIONS.md](./docs/internal/decisions.md) for full rationale.

## Getting Started

```bash
# Install dependencies
pnpm install

# Start API dev server
pnpm dev

# Build all packages
pnpm build

# Build SDK only
pnpm build:sdk

# Type check
pnpm typecheck
```

## SDK Usage

```bash
npm install @marlinjai/storage-brain-sdk
```

```typescript
import { StorageBrain } from '@marlinjai/storage-brain-sdk';

const storage = new StorageBrain({
  apiKey: 'sk_live_your_api_key_here',
});

const file = await storage.upload(fileBlob, {
  context: 'invoice',
  onProgress: (p) => console.log(`${p}%`),
});
```

See [packages/sdk/README.md](./packages/sdk/README.md) for full SDK documentation.

## Documentation

- **[Architecture](./docs/public/architecture.md)**: System architecture and design overview
- **[SDK Guide](./docs/public/sdk.md)**: TypeScript SDK usage and reference
- **[API Reference](./docs/public/api-reference.md)**: REST API endpoints
- **[Quickstart](./docs/public/quickstart.md)**: Getting started guide

## Status

**Current Phase**: Ready for Implementation
**All Decisions**: Finalized

### Implementation Phases

1. **Foundation Setup** - Project structure, Workers, D1 schema, shared types
2. **Gatekeeper API** - Auth, handshake, file management, quotas
3. **Client SDK** - TypeScript SDK with progress tracking
4. **Testing & Deployment** - Tests, docs, production deploy

## References

- [Cloudflare Workers Docs](https://developers.cloudflare.com/workers/)
- [Hono Framework](https://hono.dev/)
- [Cloudflare R2](https://developers.cloudflare.com/r2/)
- [Cloudflare D1](https://developers.cloudflare.com/d1/)
- [Zod Validation](https://zod.dev/)
