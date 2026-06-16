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
