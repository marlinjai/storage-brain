---
description: "Standards for post-upload processing workers (OCR, thumbnails, etc.)"
alwaysApply: false
globs:
  - "**/workers/**"
  - "**/processors/**"
---

# Processing Worker Standards

## Context-Aware Processing

### Supported Contexts

- `invoice`: Trigger Google Cloud Vision OCR
- `framer-site`: Generate thumbnails
- `newsletter`: Extract metadata, validate format
- `default`: Basic validation only

## Processing Pipeline

1. **Trigger**: Webhook from R2 after upload completion
2. **Validation**: Verify file exists and is accessible
3. **Context Routing**: Determine processing based on `context` field
4. **Execution**: Run context-specific processor
5. **Storage**: Save results to file metadata in database
6. **Notification**: Optional webhook to requesting service

## Error Handling

- Retry transient failures (network, API limits)
- Dead letter queue for permanent failures
- Log all processing attempts
- Update file metadata with error status

## External Services

- **Google Cloud Vision**: OCR for invoices
- **Image Processing**: Thumbnail generation (Sharp or similar)
- Rate limit and quota management per tenant

## Async Processing

- Use Cloudflare Queues for background jobs
- Idempotent operations (safe to retry)
- Progress tracking in database
