---
title: Storage Brain
description: Edge-native file storage service with OCR and AI processing
order: 0
---

# Storage Brain

An edge-native file storage and processing service built on Cloudflare Workers, R2, and D1.

## Features

- **Edge-First Performance** — <20ms global response time via Cloudflare Workers
- **Context-Aware Processing** — OCR, thumbnails, metadata extraction
- **Multi-Tenant** — Secure tenant isolation with quota management
- **TypeScript SDK** — Full type safety with zero external dependencies

## Architecture

Storage Brain uses a three-layer design:

1. **Gatekeeper API** — Handshake endpoint, quota validation, presigned URLs
2. **Processor Worker** — Post-upload OCR, thumbnail generation, webhooks
3. **Client SDK** — TypeScript client with progress tracking and retry logic

## Documentation

- [RFC](/projects/storage-brain/rfc) — Full architecture specification
- [Quick Start](/projects/storage-brain/quickstart) — Key decisions and deployment architecture
- [Implementation Plan](/projects/storage-brain/implementation-plan) — Phase-by-phase execution guide
- [Decisions](/projects/storage-brain/decisions) — Architectural rationale
- [Clarifying Questions](/projects/storage-brain/clarifying-questions) — Q&A on design choices
