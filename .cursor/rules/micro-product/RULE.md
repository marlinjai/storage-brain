---
description: "Standards for packaging the storage brain as a micro-product"
alwaysApply: false
globs:
  - "**/widget/**"
  - "**/dashboard/**"
  - "**/docs/**"
---

# Micro-Product Standards

## Packaging Requirements

### Exportable Components

1. **Iframe/Widget**: Pre-built React/Vue component
   - Drag & Drop UI
   - Progress indicators
   - Error handling
   - Returns final URL to parent app

2. **Dashboard**: Tenant management UI
   - Storage usage per tenant
   - File browser
   - Quota management
   - Analytics

3. **Documentation**: API docs and integration guides
   - OpenAPI/Swagger spec
   - Code examples
   - SDK documentation

## Monetization Features

- Usage-based billing hooks
- Tenant quota enforcement
- Analytics and reporting
- Multi-tenant isolation

## Deployment

- Standalone deployable package
- Environment variable configuration
- Health check endpoints
- Monitoring and observability

## Security for Multi-Tenancy

- Tenant isolation at all layers
- API key management
- Rate limiting per tenant
- Audit logging
