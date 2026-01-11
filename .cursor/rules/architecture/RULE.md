---
description: "Edge-first architecture standards for the storage brain micro-product"
alwaysApply: true
---

# Architecture Standards

## Core Principles

- **Edge-First**: All services must be deployable to Cloudflare Workers
- **TypeScript First**: All code must be TypeScript with strict type checking
- **Micro-Product Ready**: Design all components as exportable, reusable modules
- **Zero Technical Debt**: No shortcuts that create maintenance burden

## Stack Requirements

### Runtime & Framework
- **Hono** on Cloudflare Workers (not Express)
- Ultra-lightweight, <20ms global response time target
- Edge-native deployment only

### Database
- **D1** (Cloudflare's serverless SQL) as primary
- **Prisma with Accelerate** as alternative if needed
- Relational structure required for `tenant_id` and `file_metadata` tracking

### Storage
- **Cloudflare R2** for object storage
- Presigned URLs for secure uploads
- No direct client access to R2 credentials

### Validation & Communication
- **Zod** for all schema validation
- **Webhooks** for post-upload processing
- Type-safe contracts between services

## Three-Layer Architecture

### A. Gatekeeper (Internal API)
- Handshake endpoint pattern: `POST /request-upload`
- Business logic enforcement before upload
- Tenant quota validation
- Presigned URL generation

### B. Processor (Worker)
- Post-upload hooks
- Context-aware processing (OCR, thumbnails, etc.)
- Async processing pipeline

### C. Exportable Client SDK
- TypeScript client library
- Full autocomplete support
- Pluggable into other products
- Zero configuration where possible

## Code Standards

- **File Size**: Keep files under 200 lines
- **Modularity**: Single Responsibility Principle
- **Documentation**: Heavy inline comments explaining "why"
- **Error Handling**: Structured Try-Catch, no empty catch blocks
- **Security**: Zero hardcoded secrets, environment variables only
- **Testing**: Unit-testable pure functions with injected dependencies
