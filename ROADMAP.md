---
title: Storage Brain Roadmap
type: roadmap
tags: [storage-brain, roadmap]
date: 2026-04-09
---

# Roadmap

## Planned

- **[Per-Workspace API Keys](docs/plans/2026-04-06-per-workspace-api-keys.md)** — Scoped API keys (`wk_live_` prefix) that restrict access to a single workspace within a tenant, enabling multi-app tenants with isolated credentials.

- **[Automated Key Rotation](docs/plans/2026-04-06-automated-key-rotation.md)** — End-to-end automated key rotation with dual-key grace period, Infisical push, and Coolify auto-redeploy.

- **[Bring Your Own S3 Bucket](docs/plans/2026-04-06-bring-your-own-s3.md)** — Per-tenant S3/R2/GCS bucket configuration for data sovereignty and cost isolation.

## In Progress

<!-- Currently being implemented -->

- **[Dashboard auth via auth-brain (slice 2A)](docs/plans/2026-06-16-storage-brain-auth-brain-dashboard-session.md)**: Dashboard humans authenticate via auth-brain's `lumitra_session` (`verifySession` + `can(platform.admin)`), with the legacy admin-key login kept as a transitional fallback; adds the nullable `auth_workspace_id` tenant binding as plumbing for future per-tenant authz.

## Completed

- **v0.5.0** — Multi-tenant workspaces, workspace quotas, workspace-scoped file listing
- **v0.4.0** — Removed processing pipeline (OCR, thumbnails) — Storage Brain is now storage-only
- **v0.3.0** — Self-hosting with Docker, S3 + Postgres adapters, admin SDK
- **v0.2.0** — TypeScript SDK (`@marlinjai/storage-brain-sdk`), presigned URL uploads
- **v0.1.0** — Initial release: multi-tenant file storage on Cloudflare R2 + D1
