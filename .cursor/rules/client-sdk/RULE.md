---
description: "Standards for the exportable client SDK that plugs into other products"
alwaysApply: false
globs:
  - "**/storage-client/**"
  - "**/sdk/**"
---

# Client SDK Standards

## Design Principles

- **Zero Configuration**: Works out of the box with minimal setup
- **Full TypeScript**: Complete type definitions for autocomplete
- **Pluggable**: Can be imported into any TypeScript/JavaScript project
- **Lightweight**: Minimal dependencies, tree-shakeable

## API Surface

### Core Client Class

```typescript
class MyStorageBrain {
  constructor(config: { apiKey: string; baseUrl?: string });
  upload(file: File, options: UploadOptions): Promise<FileInfo>;
  // ... other methods
}
```

## Type Definitions

- Export all types for consumer use
- Use branded types for IDs (e.g., `TenantId`, `FileId`)
- Context types as union literals for autocomplete

## Error Handling

- Custom error classes (e.g., `StorageBrainError`, `QuotaExceededError`)
- Retry logic for transient failures
- Clear error messages for debugging

## Examples

Always include usage examples in JSDoc comments:

```typescript
/**
 * Uploads a file with context-aware processing
 * @example
 * const storage = new MyStorageBrain({ apiKey: 'key' });
 * const info = await storage.upload(file, { 
 *   context: 'newsletter',
 *   tags: { campaign: 'january_promo' } 
 * });
 */
```
