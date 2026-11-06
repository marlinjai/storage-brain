import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { StorageAdapter } from '@storage-brain/shared';
import { makeD1Adapter, seedFile } from '../../test-utils/d1-sqlite';
import { runPurgeSweep, runOrphanReport, ORPHAN_MIN_AGE_MS } from './purge-sweeper';

const NOW = Date.parse('2026-11-06T12:00:00Z');

describe('purge sweeper', () => {
  let db: ReturnType<typeof makeD1Adapter>;
  let tenantId: string;

  beforeEach(async () => {
    db = makeD1Adapter();
    tenantId = `t-${crypto.randomUUID()}`;
    await db.createTenant({
      id: tenantId,
      name: `Purge ${tenantId}`,
      apiKeyHash: `hash-${tenantId}`,
      keyPrefix: 'sk_live_pg',
      quotaBytes: 10_000,
      allowedFileTypes: null,
    });
  });

  function fileInput(overrides: Partial<{ id: string; storedPath: string }> = {}) {
    const id = overrides.id ?? crypto.randomUUID();
    return {
      id,
      tenantId,
      originalName: `${id}.bin`,
      storedPath: overrides.storedPath ?? `tenants/${tenantId}/files/${id}/${id}.bin`,
      fileType: 'application/octet-stream',
      sizeBytes: 100,
      context: 'default',
      tags: null,
    };
  }

  /** Soft-delete a seeded file WITHOUT confirming its object is gone. */
  async function softDeleteUnpurged(input: ReturnType<typeof fileInput>): Promise<void> {
    await seedFile(db, input);
    await db.deleteFileAndReleaseQuota(input.id, tenantId);
  }

  function storageWith(deleteImpl: () => Promise<void>): StorageAdapter {
    const deleteFn = vi.fn(deleteImpl);
    const listObjects = vi.fn().mockResolvedValue([]);
    return { delete: deleteFn, listObjects } as unknown as StorageAdapter;
  }

  it('leaves a failed delete unpurged, logs it, and raises an alert', async () => {
    const file = fileInput();
    await softDeleteUnpurged(file);
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const storage = storageWith(() => Promise.reject(new Error('r2 down')));
    const outcome = await runPurgeSweep({ db, storage, now: () => NOW });

    expect(outcome).toEqual({ scanned: 1, purged: 0, failed: 1 });
    // The row still holds no purged_at, so the sweeper will retry it.
    const pending = await db.listUnpurgedFiles(10);
    expect(pending).toHaveLength(1);
    expect(pending[0]!.id).toBe(file.id);
    expect(errorSpy).toHaveBeenCalled();
    const open = await db.listOpenAlerts();
    expect(open).toHaveLength(1);
    expect(open[0]!.kind).toBe('purge_failed');
    expect(open[0]!.fileId).toBe(file.id);
    expect(open[0]!.tenantId).toBe(tenantId);
    expect(open[0]!.storedPath).toBe(file.storedPath);
    errorSpy.mockRestore();
  });

  it('purges a previously failed file on the next run once storage recovers', async () => {
    const file = fileInput();
    await softDeleteUnpurged(file);

    const failing = storageWith(() => Promise.reject(new Error('r2 down')));
    expect((await runPurgeSweep({ db, storage: failing, now: () => NOW })).failed).toBe(1);

    const recovered = storageWith(() => Promise.resolve());
    const outcome = await runPurgeSweep({ db, storage: recovered, now: () => NOW });

    expect(outcome).toEqual({ scanned: 1, purged: 1, failed: 0 });
    expect(await db.listUnpurgedFiles(10)).toEqual([]);
  });

  it('counts an already-missing object as purged', async () => {
    const file = fileInput();
    await softDeleteUnpurged(file);

    // R2/S3 `delete` answer a missing key without an error, so a resolved
    // delete means "the object is gone, whatever its prior state".
    const storage = storageWith(() => Promise.resolve());
    const outcome = await runPurgeSweep({ db, storage, now: () => NOW });

    expect(outcome).toEqual({ scanned: 1, purged: 1, failed: 0 });
    expect(await db.listUnpurgedFiles(10)).toEqual([]);
  });

  it('raises exactly one alert for a repeated failure, not one per cycle', async () => {
    const file = fileInput();
    await softDeleteUnpurged(file);
    const storage = storageWith(() => Promise.reject(new Error('r2 down')));

    await runPurgeSweep({ db, storage, now: () => NOW });
    await runPurgeSweep({ db, storage, now: () => NOW + 60_000 });
    await runPurgeSweep({ db, storage, now: () => NOW + 120_000 });

    const open = await db.listOpenAlerts();
    expect(open).toHaveLength(1);
    expect(open[0]!.fileId).toBe(file.id);
    // The second failure bumped the same row instead of adding a new one.
    expect(open[0]!.updatedAt).toBeGreaterThanOrEqual(open[0]!.createdAt);
    expect(await db.listUnpurgedFiles(10)).toHaveLength(1);
  });

  it('turns a repeated failure into one alert per distinct object', async () => {
    const a = fileInput({ id: 'f-aaaa' });
    const b = fileInput({ id: 'f-bbbb' });
    await softDeleteUnpurged(a);
    await softDeleteUnpurged(b);
    const storage = storageWith(() => Promise.reject(new Error('r2 down')));

    await runPurgeSweep({ db, storage, now: () => NOW });

    const open = await db.listOpenAlerts();
    expect(open).toHaveLength(2);
    expect(new Set(open.map((alert) => alert.fileId))).toEqual(new Set(['f-aaaa', 'f-bbbb']));
  });
});

describe('orphan report', () => {
  let db: ReturnType<typeof makeD1Adapter>;
  let tenantId: string;

  beforeEach(async () => {
    db = makeD1Adapter();
    tenantId = `t-${crypto.randomUUID()}`;
    await db.createTenant({
      id: tenantId,
      name: `Orphan ${tenantId}`,
      apiKeyHash: `hash-${tenantId}`,
      keyPrefix: 'sk_live_orp',
      quotaBytes: 10_000,
      allowedFileTypes: null,
    });
  });

  const HOUR = 60 * 60 * 1000;

  it('ignores keys younger than 24 hours and keys that have a row', async () => {
    const file = fileInputFactory();
    await seedFile(db, file);

    const storage = {
      listObjects: vi.fn().mockResolvedValue([
        // Old orphan: counted.
        { key: 'tenants/x/files/orphan1.bin', size: 100, lastModified: new Date(NOW - 48 * HOUR) },
        // Young object: ignored even though it has no row (an upload may be mid-flight).
        { key: 'tenants/x/files/orphan2.bin', size: 200, lastModified: new Date(NOW - 1 * HOUR) },
        // Old but HAS a row: ignored.
        { key: file.storedPath, size: 300, lastModified: new Date(NOW - 48 * HOUR) },
      ]),
    } as unknown as StorageAdapter;

    const report = await runOrphanReport({
      db,
      storage,
      now: () => NOW,
      minAgeMs: ORPHAN_MIN_AGE_MS,
    });

    expect(report).toEqual({ orphanCount: 1, orphanBytes: 100, olderThanMs: ORPHAN_MIN_AGE_MS });
  });

  function fileInputFactory() {
    const id = crypto.randomUUID();
    return {
      id,
      tenantId,
      originalName: `${id}.bin`,
      storedPath: `tenants/${tenantId}/files/${id}/${id}.bin`,
      fileType: 'application/octet-stream',
      sizeBytes: 300,
      context: 'default',
      tags: null,
    };
  }
});
