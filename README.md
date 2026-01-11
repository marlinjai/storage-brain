# Storage Brain - Edge-Native File Storage Micro-Product

A lightweight, edge-native file storage service built on Cloudflare Workers, R2, and D1. Designed as both an internal foundation for a suite of products and a standalone micro-product (private "Upload-as-a-Service").

## Goals

- **Edge-First Performance**: <20ms global response time
- **Micro-Product Ready**: Exportable, reusable, pluggable architecture
- **Type-Safe**: Full TypeScript with autocomplete support
- **Multi-Tenant**: Secure tenant isolation and quota management
- **Context-Aware Processing**: OCR, thumbnails, and extensible pipeline

## Tech Stack

| Component | Technology | Notes |
|-----------|------------|-------|
| **Runtime** | Cloudflare Workers | Edge-native, <20ms latency |
| **Framework** | Hono | Ultra-lightweight, faster than Express |
| **Language** | TypeScript | Full type safety |
| **Database** | D1 | Cloudflare SQL, edge-native |
| **Storage** | R2 | S3-compatible, presigned URLs |
| **Validation** | Zod | Runtime type safety |
| **Processing** | Cloudflare Queues | Async job processing |

## Architecture

Three-layer design:

```
┌─────────────────────────────────────────┐
│         Client Applications             │
└─────────────────┬───────────────────────┘
                  │ TypeScript SDK
┌─────────────────▼───────────────────────┐
│       C. Exportable Client SDK          │
│   - Type-safe API client                │
│   - Progress tracking, retry logic      │
└─────────────────┬───────────────────────┘
                  │ HTTP/REST
┌─────────────────▼───────────────────────┐
│       A. Gatekeeper (API)               │
│   - Handshake + presigned URLs          │
│   - Quota validation                    │
│   - API key authentication              │
└─────────────────┬───────────────────────┘
                  │ R2 Upload
┌─────────────────▼───────────────────────┐
│       B. Processor (Worker)             │
│   - OCR (invoice context)               │
│   - Thumbnails (framer-site context)    │
│   - Webhooks                            │
└─────────────────────────────────────────┘
```

## Project Structure

```
UploadNode/
├── docs/                    # Documentation
│   ├── RFC.md              # Architecture spec (approved)
│   ├── DECISIONS.md        # Architecture rationale
│   ├── CLARIFYING_QUESTIONS.md  # All decisions
│   └── IMPLEMENTATION_PLAN.md   # Execution guide
├── packages/
│   ├── api/                # Cloudflare Workers API
│   ├── client-sdk/         # TypeScript SDK
│   └── shared/             # Shared types & utilities
└── .cursor/rules/          # Development rules
```

## Key Decisions

- **Database**: D1 (free tier: 5M reads/day, 100K writes/day)
- **Auth**: Simple API keys per tenant (`sk_live_` / `sk_test_` prefix)
- **File Types**: Images (JPEG, PNG, WebP, GIF, AVIF) + PDFs
- **Quotas**: Hard limits, per-tenant configurable (default 500MB)
- **Thumbnails**: 3 sizes (200x200, 400x400, 800x800) in WebP
- **Deployment**: Single worker on workers.dev (MVP)

See [DECISIONS.md](./docs/DECISIONS.md) for full rationale.

## Documentation

- **[RFC.md](./docs/RFC.md)**: Complete architecture specification
- **[DECISIONS.md](./docs/DECISIONS.md)**: Architecture decisions and rationale
- **[IMPLEMENTATION_PLAN.md](./docs/IMPLEMENTATION_PLAN.md)**: Step-by-step execution guide
- **[CLARIFYING_QUESTIONS.md](./docs/CLARIFYING_QUESTIONS.md)**: All answered questions

## Status

**Current Phase**: Ready for Implementation
**All Decisions**: Finalized

### Implementation Phases

1. **Foundation Setup** - Project structure, Workers, D1 schema, shared types
2. **Gatekeeper API** - Auth, handshake, file management, quotas
3. **Client SDK** - TypeScript SDK with progress tracking
4. **Processing Pipeline** - OCR, thumbnails, webhooks
5. **Testing & Deployment** - Tests, docs, production deploy

## Getting Started

1. **Review**: Read [RFC.md](./docs/RFC.md) and [DECISIONS.md](./docs/DECISIONS.md)
2. **Prerequisites**: Set up Cloudflare account, R2 bucket, D1 database
3. **Implement**: Follow [IMPLEMENTATION_PLAN.md](./docs/IMPLEMENTATION_PLAN.md)

## References

- [Cloudflare Workers Docs](https://developers.cloudflare.com/workers/)
- [Hono Framework](https://hono.dev/)
- [Cloudflare R2](https://developers.cloudflare.com/r2/)
- [Cloudflare D1](https://developers.cloudflare.com/d1/)
- [Zod Validation](https://zod.dev/)
