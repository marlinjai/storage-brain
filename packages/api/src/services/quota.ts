import type { D1Database } from '@cloudflare/workers-types';
import type { QuotaResponse } from '@storage-brain/shared';

interface QuotaCheckResult {
  hasCapacity: boolean;
  quotaBytes: number;
  usedBytes: number;
  availableBytes: number;
}

/**
 * Check if a tenant has enough quota for a file of the given size
 */
export async function checkQuota(
  db: D1Database,
  tenantId: string,
  fileSizeBytes: number
): Promise<QuotaCheckResult> {
  const result = await db
    .prepare('SELECT quota_bytes, used_bytes FROM tenants WHERE id = ?')
    .bind(tenantId)
    .first<{ quota_bytes: number; used_bytes: number }>();

  if (!result) {
    return {
      hasCapacity: false,
      quotaBytes: 0,
      usedBytes: 0,
      availableBytes: 0,
    };
  }

  const availableBytes = result.quota_bytes - result.used_bytes;
  const hasCapacity = availableBytes >= fileSizeBytes;

  return {
    hasCapacity,
    quotaBytes: result.quota_bytes,
    usedBytes: result.used_bytes,
    availableBytes,
  };
}

/**
 * Reserve quota for an upcoming upload
 * This is called before the upload starts to prevent race conditions
 */
export async function reserveQuota(
  db: D1Database,
  tenantId: string,
  sizeBytes: number
): Promise<void> {
  const now = Date.now();

  // Atomic update: increment used_bytes only if there's enough capacity
  const result = await db
    .prepare(
      `UPDATE tenants
       SET used_bytes = used_bytes + ?, updated_at = ?
       WHERE id = ? AND (quota_bytes - used_bytes) >= ?`
    )
    .bind(sizeBytes, now, tenantId, sizeBytes)
    .run();

  if (result.meta.changes === 0) {
    throw new Error('Insufficient quota or tenant not found');
  }
}

/**
 * Release reserved quota (e.g., when upload fails)
 */
export async function releaseQuota(
  db: D1Database,
  tenantId: string,
  sizeBytes: number
): Promise<void> {
  const now = Date.now();

  await db
    .prepare(
      `UPDATE tenants
       SET used_bytes = MAX(0, used_bytes - ?), updated_at = ?
       WHERE id = ?`
    )
    .bind(sizeBytes, now, tenantId)
    .run();
}

/**
 * Update quota after file deletion
 */
export async function decrementQuota(
  db: D1Database,
  tenantId: string,
  sizeBytes: number
): Promise<void> {
  await releaseQuota(db, tenantId, sizeBytes);
}

/**
 * Get current quota usage for a tenant
 */
export async function getQuotaUsage(db: D1Database, tenantId: string): Promise<QuotaResponse> {
  const result = await db
    .prepare('SELECT quota_bytes, used_bytes FROM tenants WHERE id = ?')
    .bind(tenantId)
    .first<{ quota_bytes: number; used_bytes: number }>();

  if (!result) {
    return {
      quotaBytes: 0,
      usedBytes: 0,
      availableBytes: 0,
      usagePercent: 0,
    };
  }

  const availableBytes = Math.max(0, result.quota_bytes - result.used_bytes);
  const usagePercent =
    result.quota_bytes > 0 ? Math.round((result.used_bytes / result.quota_bytes) * 100) : 0;

  return {
    quotaBytes: result.quota_bytes,
    usedBytes: result.used_bytes,
    availableBytes,
    usagePercent,
  };
}

/**
 * Recalculate quota usage from actual files
 * Useful for fixing discrepancies
 */
export async function recalculateQuota(db: D1Database, tenantId: string): Promise<number> {
  const result = await db
    .prepare(
      `SELECT COALESCE(SUM(size_bytes), 0) as total
       FROM files
       WHERE tenant_id = ? AND deleted_at IS NULL`
    )
    .bind(tenantId)
    .first<{ total: number }>();

  const totalUsed = result?.total ?? 0;
  const now = Date.now();

  await db
    .prepare('UPDATE tenants SET used_bytes = ?, updated_at = ? WHERE id = ?')
    .bind(totalUsed, now, tenantId)
    .run();

  return totalUsed;
}
