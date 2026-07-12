import { describe, it, expect, beforeEach } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { D1Database } from '@cloudflare/workers-types';
import { D1DatabaseAdapter } from './d1';

const MIGRATIONS_DIR = fileURLToPath(new URL('../../../migrations', import.meta.url));

/**
 * Minimal D1Database shim over node:sqlite, enough for the tenant code paths the
 * adapter exercises (prepare().bind().run()/first()/all()).
 */
function createD1(sqlite: DatabaseSync): D1Database {
  return {
    prepare(sql: string) {
      let bound: unknown[] = [];
      const stmt = {
        bind(...args: unknown[]) {
          bound = args;
          return stmt;
        },
        run() {
          const r = sqlite.prepare(sql).run(...(bound as never[]));
          return Promise.resolve({
            success: true,
            meta: { changes: Number(r.changes), last_row_id: Number(r.lastInsertRowid) },
          });
        },
        first() {
          const row = sqlite.prepare(sql).get(...(bound as never[]));
          return Promise.resolve(row ?? null);
        },
        all() {
          const results = sqlite.prepare(sql).all(...(bound as never[]));
          return Promise.resolve({ success: true, results, meta: {} });
        },
      };
      return stmt;
    },
  } as unknown as D1Database;
}

/**
 * Apply every D1 migration (0001..0005) in order. 0004 is a Postgres-only column
 * widening (ALTER COLUMN ... TYPE) that SQLite cannot parse; it is a no-op for
 * SQLite (key_prefix already has TEXT affinity), so we tolerate only that file
 * throwing. Any other migration failing is a real error.
 */
function applyMigrations(sqlite: DatabaseSync): void {
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  for (const file of files) {
    const sql = readFileSync(`${MIGRATIONS_DIR}/${file}`, 'utf8');
    try {
      sqlite.exec(sql);
    } catch (err) {
      if (!file.startsWith('0004')) {
        throw new Error(`Migration ${file} failed: ${(err as Error).message}`);
      }
    }
  }
}

function makeAdapter() {
  const sqlite = new DatabaseSync(':memory:');
  applyMigrations(sqlite);
  return new D1DatabaseAdapter(createD1(sqlite));
}

const baseTenant = {
  name: 'Acme',
  apiKeyHash: 'hash-abc',
  keyPrefix: 'sk_live_ab',
  quotaBytes: 500 * 1024 * 1024,
  allowedFileTypes: ['image/png' as const],
};

describe('D1DatabaseAdapter auth_workspace_id', () => {
  let db: D1DatabaseAdapter;

  beforeEach(() => {
    db = makeAdapter();
  });

  it('migration 0005 applies on top of 0001-0004 and round-trips authWorkspaceId on create', async () => {
    await db.createTenant({ id: 't1', ...baseTenant, authWorkspaceId: 'ws-1' });

    const tenant = await db.getTenantById('t1');
    expect(tenant).not.toBeNull();
    expect(tenant?.authWorkspaceId).toBe('ws-1');
    // Existing fields still map (no regression).
    expect(tenant?.name).toBe('Acme');
    expect(tenant?.quotaBytes).toBe(500 * 1024 * 1024);
    expect(tenant?.allowedFileTypes).toEqual(['image/png']);
  });

  it('a tenant created without authWorkspaceId maps to null (no regression)', async () => {
    await db.createTenant({ id: 't2', ...baseTenant, name: 'NoWorkspace' });

    const tenant = await db.getTenantById('t2');
    expect(tenant?.authWorkspaceId).toBeNull();
  });

  it('getTenantByAuthWorkspaceId hits and misses', async () => {
    await db.createTenant({ id: 't3', ...baseTenant, name: 'Bound', authWorkspaceId: 'ws-3' });

    const hit = await db.getTenantByAuthWorkspaceId('ws-3');
    expect(hit?.id).toBe('t3');

    const miss = await db.getTenantByAuthWorkspaceId('ws-does-not-exist');
    expect(miss).toBeNull();
  });

  it('updateTenant sets and clears authWorkspaceId', async () => {
    await db.createTenant({ id: 't4', ...baseTenant, name: 'Updatable' });

    const set = await db.updateTenant('t4', { authWorkspaceId: 'ws-4' });
    expect(set?.authWorkspaceId).toBe('ws-4');
    expect((await db.getTenantByAuthWorkspaceId('ws-4'))?.id).toBe('t4');

    const cleared = await db.updateTenant('t4', { authWorkspaceId: null });
    expect(cleared?.authWorkspaceId).toBeNull();
    expect(await db.getTenantByAuthWorkspaceId('ws-4')).toBeNull();
  });

  it('updateTenant leaves authWorkspaceId untouched when not provided', async () => {
    await db.createTenant({ id: 't5', ...baseTenant, name: 'Keep', authWorkspaceId: 'ws-5' });

    const updated = await db.updateTenant('t5', { name: 'KeepRenamed' });
    expect(updated?.name).toBe('KeepRenamed');
    expect(updated?.authWorkspaceId).toBe('ws-5');
  });
});

describe('D1DatabaseAdapter migrateFilesToWorkspace', () => {
  let db: D1DatabaseAdapter;

  const TENANT = 'tenant-mig';
  const TARGET = 'ws-target';
  const SOURCE = 'ws-source';

  async function seedFile(
    id: string,
    opts: { size: number; tags?: Record<string, string>; workspaceId?: string; deleted?: boolean },
  ): Promise<void> {
    await db.createFile({
      id,
      tenantId: TENANT,
      originalName: `${id}.bin`,
      storedPath: `tenants/${TENANT}/${id}.bin`,
      fileType: 'image/png',
      sizeBytes: opts.size,
      context: 'default',
      tags: opts.tags ?? null,
      workspaceId: opts.workspaceId,
    });
    if (opts.deleted) {
      await db.softDeleteFile(id, TENANT);
    }
  }

  beforeEach(async () => {
    db = makeAdapter();
    await db.createTenant({ id: TENANT, ...baseTenant, name: 'Migration Tenant' });
    await db.createWorkspace({ id: TARGET, tenantId: TENANT, name: 'Target', slug: 'target' });
    // Source has an explicit quota so we can seed its used_bytes via reserve.
    await db.createWorkspace({
      id: SOURCE,
      tenantId: TENANT,
      name: 'Source',
      slug: 'source',
      quotaBytes: 1024 * 1024,
    });

    await seedFile('f-prod-1', { size: 100, tags: { env: 'production' } });
    await seedFile('f-prod-2', { size: 200, tags: { env: 'production' } });
    await seedFile('f-dev-1', { size: 50, tags: { env: 'development' } });
    await seedFile('f-notags', { size: 10 });
    await seedFile('f-in-source', { size: 300, tags: { env: 'production' }, workspaceId: SOURCE });
    await seedFile('f-deleted', { size: 999, tags: { env: 'production' }, deleted: true });
    // Reflect f-in-source's bytes in the source workspace usage.
    await db.reserveWorkspaceQuota(SOURCE, 300);
  });

  it('migrates unassigned files matching a tag and adds bytes to the target', async () => {
    const result = await db.migrateFilesToWorkspace({
      tenantId: TENANT,
      workspaceId: TARGET,
      filter: { tag: { key: 'env', value: 'production' } },
      onlyUnassigned: true,
    });

    // f-prod-1 + f-prod-2 only (dev wrong env, notags no tag, in-source assigned, deleted inactive).
    expect(result.migratedCount).toBe(2);
    expect(result.totalBytes).toBe(300);

    const target = await db.getWorkspaceById(TARGET, TENANT);
    expect(target?.usedBytes).toBe(300);

    const targetFiles = await db.getActiveFilesByWorkspace(TARGET, TENANT);
    expect(targetFiles.map((f) => f.id).sort()).toEqual(['f-prod-1', 'f-prod-2']);

    // Source untouched (nothing moved out of it).
    const source = await db.getWorkspaceById(SOURCE, TENANT);
    expect(source?.usedBytes).toBe(300);
  });

  it('with onlyUnassigned=false also moves files out of a source workspace and releases its quota', async () => {
    const result = await db.migrateFilesToWorkspace({
      tenantId: TENANT,
      workspaceId: TARGET,
      filter: { tag: { key: 'env', value: 'production' } },
      onlyUnassigned: false,
    });

    // f-prod-1 (100) + f-prod-2 (200) + f-in-source (300).
    expect(result.migratedCount).toBe(3);
    expect(result.totalBytes).toBe(600);

    const target = await db.getWorkspaceById(TARGET, TENANT);
    expect(target?.usedBytes).toBe(600);

    // Source released its 300 bytes.
    const source = await db.getWorkspaceById(SOURCE, TENANT);
    expect(source?.usedBytes).toBe(0);
    expect(await db.getActiveFilesByWorkspace(SOURCE, TENANT)).toHaveLength(0);
  });

  it('migrates by explicit fileIds regardless of tag', async () => {
    const result = await db.migrateFilesToWorkspace({
      tenantId: TENANT,
      workspaceId: TARGET,
      filter: { fileIds: ['f-dev-1', 'f-notags'] },
      onlyUnassigned: true,
    });

    expect(result.migratedCount).toBe(2);
    expect(result.totalBytes).toBe(60);
    const targetFiles = await db.getActiveFilesByWorkspace(TARGET, TENANT);
    expect(targetFiles.map((f) => f.id).sort()).toEqual(['f-dev-1', 'f-notags']);
  });

  it('does not move soft-deleted files even when they match', async () => {
    await db.migrateFilesToWorkspace({
      tenantId: TENANT,
      workspaceId: TARGET,
      filter: { fileIds: ['f-deleted'] },
      onlyUnassigned: false,
    });

    const target = await db.getWorkspaceById(TARGET, TENANT);
    expect(target?.usedBytes).toBe(0);
    expect(await db.getActiveFilesByWorkspace(TARGET, TENANT)).toHaveLength(0);
  });

  it('returns migratedCount 0 for a non-matching tag and leaves usage untouched', async () => {
    const result = await db.migrateFilesToWorkspace({
      tenantId: TENANT,
      workspaceId: TARGET,
      filter: { tag: { key: 'env', value: 'staging' } },
      onlyUnassigned: true,
    });

    expect(result).toEqual({ migratedCount: 0, totalBytes: 0 });
    const target = await db.getWorkspaceById(TARGET, TENANT);
    expect(target?.usedBytes).toBe(0);
  });

  it('skips files already in the target workspace (no double counting)', async () => {
    // First move puts f-prod-1/2 into the target.
    await db.migrateFilesToWorkspace({
      tenantId: TENANT,
      workspaceId: TARGET,
      filter: { tag: { key: 'env', value: 'production' } },
      onlyUnassigned: true,
    });

    // Re-run with onlyUnassigned=false: the two already-in-target files are
    // excluded; only f-in-source moves.
    const result = await db.migrateFilesToWorkspace({
      tenantId: TENANT,
      workspaceId: TARGET,
      filter: { tag: { key: 'env', value: 'production' } },
      onlyUnassigned: false,
    });

    expect(result.migratedCount).toBe(1);
    expect(result.totalBytes).toBe(300);
    const target = await db.getWorkspaceById(TARGET, TENANT);
    expect(target?.usedBytes).toBe(600); // 300 from first move + 300 from f-in-source
  });
});
