---
title: Storage Brain
description: Edge-native file storage service with multi-tenant workspaces
order: 0
icon: "💾"
---

# Storage Brain

An edge-native file storage and management service built on Cloudflare Workers, R2, and D1 -- with a self-hosting path via Docker (S3 + Postgres).

## Features

- **Edge-First Performance** -- <20ms global response time via Cloudflare Workers
- **Multi-Tenant Workspaces** -- Tenant and workspace isolation with per-level quota management
- **Signed Download URLs** -- HMAC token-based URLs for time-limited, unauthenticated file downloads
- **TypeScript SDK** -- Full type safety with workspace scoping, progress tracking, and retry logic
- **Self-Hosting** -- Run locally or on your own infrastructure with Docker (S3-compatible storage + Postgres)
- **Brain Core Integration** -- Shared auth, crypto, and error handling via `@marlinjai/brain-core`

## Architecture

Storage Brain uses a two-layer design:

1. **API Layer** -- Hono-based API on Cloudflare Workers handling auth, quota enforcement, uploads, file management, workspace CRUD, webhooks, and signed URLs
2. **Client SDK** -- TypeScript SDK (`@marlinjai/storage-brain-sdk`) with upload progress tracking, workspace scoping via `withWorkspace()`, and automatic retries

Storage and database are abstracted via adapters (R2/S3 for files, D1/Postgres for metadata), enabling both edge deployment and self-hosting.

## Quick Links

- [Quick Start](/quickstart) -- Get started with Storage Brain
- [Architecture](/architecture) -- System design and tech stack
- [API Reference](/api-reference) -- Full endpoint documentation
- [SDK Guide](/sdk) -- TypeScript SDK usage
