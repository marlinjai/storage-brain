---
description: "API design standards for the storage brain handshake and processing endpoints"
alwaysApply: false
globs:
  - "**/api/**"
  - "**/routes/**"
  - "**/handlers/**"
---

# API Standards

## Endpoint Patterns

### Handshake Endpoint
```
POST /request-upload
```

**Request Schema:**
- `tenant_id`: string (required)
- `file_type`: string (required, validated against allowed types)
- `context`: string (required, e.g., 'newsletter', 'invoice', 'framer-site')
- `tags?`: Record<string, string> (optional metadata)

**Response Schema:**
- `file_id`: string (UUID)
- `presigned_url`: string (R2 presigned URL)
- `expires_at`: ISO 8601 timestamp
- `upload_metadata`: object (context-specific)

### Validation Rules
- All requests validated with Zod schemas
- File type whitelist enforcement
- Tenant quota checks before presigned URL generation
- Rate limiting per tenant

## Error Response Format

```typescript
{
  error: {
    code: string;
    message: string;
    details?: Record<string, unknown>;
  }
}
```

## Post-Upload Webhook

After R2 confirms file upload:
- Trigger context-aware processing
- Update file metadata in database
- Notify requesting service (if configured)

## Security

- API keys for client authentication
- Presigned URLs with expiration
- Tenant isolation enforced at database level
- Input sanitization on all endpoints
