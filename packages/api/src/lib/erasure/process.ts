import type { DatabaseAdapter, StorageAdapter } from '@storage-brain/shared';
import type { ErasurePayload } from './schema';

export interface ErasureResult {
  kind: ErasurePayload['kind'];
  /** Storage Brain tenant ids that matched and were fully deleted. */
  matchedTenantIds: string[];
  /** Number of stored objects the storage adapter was asked to delete. */
  deletedObjectCount: number;
}

// Objects are deleted in bounded batches so a company with many files does not
// open thousands of concurrent adapter calls at once.
const OBJECT_DELETE_BATCH = 50;

/**
 * Delete every stored object, in batches. R2 and S3 `delete` are idempotent for
 * a missing key (no throw), so an object that was already deleted on a prior
 * attempt is tolerated for free. A genuine adapter error rejects, and we surface
 * the first one so the caller fails the delivery (5xx) and auth-brain retries —
 * a partial deletion must not be acked as complete.
 */
async function deleteObjects(storage: StorageAdapter, paths: string[]): Promise<void> {
  for (let i = 0; i < paths.length; i += OBJECT_DELETE_BATCH) {
    const chunk = paths.slice(i, i + OBJECT_DELETE_BATCH);
    const results = await Promise.allSettled(chunk.map((key) => storage.delete(key)));
    for (const r of results) {
      // Surface the first genuine failure so the delivery is retried (5xx). A
      // key that was already gone does not reject in R2/S3 (delete is
      // idempotent), so this only trips on a real storage error.
      if (r.status === 'rejected') throw r.reason;
    }
  }
}

/**
 * Execute the erasure described by a verified webhook payload. Idempotent by
 * construction: object deletes tolerate already-gone keys and `deleteTenant`
 * hard-deletes whatever rows remain, so a retry after a partial failure
 * converges. Throws on any storage/DB error so the caller returns a retryable
 * 5xx and never records the delivery as acked.
 */
export async function processErasure(deps: {
  db: DatabaseAdapter;
  storage: StorageAdapter;
  payload: ErasurePayload;
}): Promise<ErasureResult> {
  const { db, storage, payload } = deps;

  if (payload.kind === 'user.erased') {
    // Verified no-op. Storage Brain keys ALL data to tenants (auth-brain
    // COMPANIES), never to individual users: there is no user_id / owner_user
    // column on tenants, files, workspaces, or upload_sessions, so a user
    // erasure has no artifact to remove here. Recorded + acked as success. If SB
    // ever gains a user-keyed column, delete those rows and their objects here.
    return { kind: 'user.erased', matchedTenantIds: [], deletedObjectCount: 0 };
  }

  // kind === 'tenant.erased'
  // Resolve every SB tenant bound to the erased company: by its auth-brain
  // company id (auth_tenant_id) OR by any of the company's workspace ids
  // (auth_workspace_id, the legacy 1:1 binding). Unmatched -> empty list ->
  // nothing to do, which is itself success (the caller still records + acks).
  const authTenantId = payload.tenant_id ?? null;
  const workspaceIds = payload.workspace_ids ?? [];
  const tenants = await db.findTenantsForErasure(authTenantId, workspaceIds);

  const matchedTenantIds: string[] = [];
  let deletedObjectCount = 0;

  for (const tenant of tenants) {
    // Gather object keys BEFORE deleting DB rows — deleteTenant removes the file
    // rows that hold stored_path. Includes soft-deleted files so no object
    // outlives the erasure.
    const paths = await db.getAllStoredPathsByTenant(tenant.id);
    await deleteObjects(storage, paths);
    deletedObjectCount += paths.length;

    // Hard-delete in FK-safe order: upload_sessions -> files -> workspaces ->
    // the tenant row itself.
    await db.deleteTenant(tenant.id);
    matchedTenantIds.push(tenant.id);
  }

  return { kind: 'tenant.erased', matchedTenantIds, deletedObjectCount };
}
