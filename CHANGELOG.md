# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Added
- S3-compatible storage adapter and PostgreSQL adapter for self-hosting
- Node.js self-hosting support with Docker

### Changed
- Migrated shared infrastructure (auth, crypto, errors, types) to `@marlinjai/brain-core`

### Fixed
- Inject env bindings in Node.js mode for self-hosting compatibility

## [0.5.0] - 2026-02-20

### Added
- Managed workspaces — tenant → workspace hierarchy for multi-tenant apps
  - `workspaces` table with per-workspace byte quotas and metadata
  - Workspace CRUD API at `/api/v1/workspaces` (create, list, get, update, delete)
  - Upload route supports optional `workspaceId` with workspace quota checks
  - File listing/responses include `workspaceId` for workspace-scoped queries
  - Cascading quota enforcement (tenant → workspace)
  - Workspace delete soft-deletes all associated files and releases quota
  - SDK: `withWorkspace()` for scoped client instances
  - SDK: `createWorkspace()`, `listWorkspaces()`, `getWorkspace()`, `updateWorkspace()`, `deleteWorkspace()`
  - `X-Workspace-Id` CORS header support

### Fixed
- Admin routes reordered before tenant-auth routes to prevent auth interception
- Include `workspaceId` in webhook payloads

## [0.4.0] - 2026-02-19

### Removed
- **BREAKING**: Removed all processing logic (OCR, thumbnails, context-aware processing)
- Removed `ProcessingContext` type and `PROCESSING_CONTEXTS` constant
- Removed `ThumbnailUrls`, `OcrResult`, `OcrBlock`, `BoundingBox`, `ImageInfo` types
- Removed `THUMBNAIL_SIZES` constant
- Removed `waitForProcessing()` SDK method
- Removed Cloudflare Queue consumer for async processing
- Removed `ProcessingQueueMessage` type

### Changed
- **BREAKING**: `context` is now an optional free-form string (max 100 chars) instead of required enum
- Webhook events changed from `file.processed` to `file.uploaded`
- Files are marked `completed` immediately after upload (no processing step)
- `FileMetadata` simplified to `{ [key: string]: unknown }`

### Kept
- Multi-tenant authentication and authorization
- File upload/download/list/delete CRUD
- Quota management
- Presigned URL upload flow
- Webhooks (simplified)
- Soft deletes

## [0.3.0]

### Changed
- Consolidated UploadNode and storage-brain-sdk into a single "Storage Brain" monorepo
- Migrated from npm workspaces to pnpm workspaces
- Replaced old internal `@storage-brain/sdk` (v0.1.0) with published `@marlinjai/storage-brain-sdk` (v0.3.0) in `packages/sdk/`
- Updated all npm scripts to use pnpm filters
- Renamed project folder from `UploadNode` to `storage-brain`

### Added
- `packages/sdk/` — TypeScript SDK moved from standalone `storage-brain-sdk` repo
- `pnpm-workspace.yaml` for pnpm workspace configuration
- `.npmrc` with `shamefully-hoist=true` for Cloudflare Workers compatibility
- SDK-specific scripts: `dev:sdk`, `build:sdk`, `publish:sdk`

### Removed
- `packages/client-sdk/` — old internal SDK (v0.1.0, never published, browser-only)
- `package-lock.json` — replaced by `pnpm-lock.yaml`

## [0.1.0] - 2026-01-11

### Added
- Initial release
- Cloudflare Worker API with Hono
- Multi-tenant authentication with API keys
- File upload via presigned URLs to R2
- OCR processing via Google Cloud Vision
- Thumbnail generation (placeholder)
- Quota management per tenant
- Webhook notifications
- Admin endpoints for tenant management
