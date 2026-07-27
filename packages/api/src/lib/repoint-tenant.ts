/**
 * Repoint tooling for company-isolation S2 (`storage-split-tenants`).
 *
 * Moves a storage tenant's rows (`files`, `workspaces`, `upload_sessions`) from
 * an old tenant id to a new one, one `--map old=new` pair at a time, each inside
 * its own transaction. It is idempotent: re-running a completed pair moves zero
 * rows because nothing still carries the old tenant id.
 *
 * PERMANENT-URL CAVEAT (from the plan): permanent download tokens sign
 * `${tenantId}:${fileId}`, so any file that changes tenant has its existing
 * permanent links break. The tool captures and reports the affected file ids per
 * pair so the S2 slice can decide (regenerate links vs a legacy-token shim).
 *
 * This module is pure orchestration over a small store port so it can be unit
 * tested without a database; `scripts/repoint-tenant.ts` supplies the Postgres
 * implementation. No tenant ids are hardcoded here or in the CLI: they come only
 * from the `--map` arguments.
 */

export interface RepointPair {
  from: string;
  to: string;
}

export interface RepointPairResult {
  from: string;
  to: string;
  /** Rows moved per table. */
  files: number;
  workspaces: number;
  uploadSessions: number;
  /** Active file ids whose permanent URLs break because they were re-tenanted. */
  brokenPermanentUrlFileIds: string[];
}

/** Table operations for one pair, executed inside a single transaction. */
export interface RepointTx {
  /** Active (non-deleted) file ids currently owned by `tenantId`. */
  listActiveFileIds(tenantId: string): Promise<string[]>;
  moveFiles(from: string, to: string): Promise<number>;
  moveWorkspaces(from: string, to: string): Promise<number>;
  moveUploadSessions(from: string, to: string): Promise<number>;
}

export interface RepointStore {
  withTransaction<T>(fn: (tx: RepointTx) => Promise<T>): Promise<T>;
}

/**
 * Parse `--map oldTenantId=newTenantId` arguments. Supports repeated `--map`
 * flags, `--map=value` form, and comma-separated pairs within one value.
 * Rejects malformed pairs, self-maps, and duplicate source tenants. Throws on
 * any problem rather than silently dropping input.
 */
export function parseMapArgs(argv: string[]): RepointPair[] {
  const rawValues: string[] = [];

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === undefined) continue;

    if (arg === '--map') {
      const value = argv[i + 1];
      if (value === undefined || value.startsWith('--')) {
        throw new Error('--map requires a value like oldTenantId=newTenantId');
      }
      rawValues.push(value);
      i++;
    } else if (arg.startsWith('--map=')) {
      rawValues.push(arg.slice('--map='.length));
    } else {
      throw new Error(`Unrecognized argument: ${arg}`);
    }
  }

  if (rawValues.length === 0) {
    throw new Error('No --map pairs provided. Usage: --map oldTenantId=newTenantId [--map ...]');
  }

  const pairs: RepointPair[] = [];
  const seenFrom = new Set<string>();

  for (const value of rawValues) {
    for (const token of value.split(',')) {
      const trimmed = token.trim();
      if (!trimmed) continue;

      const eq = trimmed.indexOf('=');
      if (eq <= 0 || eq === trimmed.length - 1) {
        throw new Error(`Malformed --map pair "${trimmed}" (expected oldTenantId=newTenantId)`);
      }

      const from = trimmed.slice(0, eq).trim();
      const to = trimmed.slice(eq + 1).trim();
      if (!from || !to) {
        throw new Error(`Malformed --map pair "${trimmed}" (empty side)`);
      }
      if (from === to) {
        throw new Error(`--map pair "${trimmed}" maps a tenant to itself`);
      }
      if (seenFrom.has(from)) {
        throw new Error(`Duplicate source tenant "${from}" in --map`);
      }

      seenFrom.add(from);
      pairs.push({ from, to });
    }
  }

  return pairs;
}

/**
 * Repoint every pair. Each pair runs in its own transaction so a failure on one
 * pair leaves the others intact. The affected-file list is captured BEFORE the
 * files move (once moved they belong to the new tenant).
 */
export async function repointTenants(
  store: RepointStore,
  pairs: RepointPair[]
): Promise<RepointPairResult[]> {
  const results: RepointPairResult[] = [];

  for (const pair of pairs) {
    const result = await store.withTransaction(async (tx): Promise<RepointPairResult> => {
      const brokenPermanentUrlFileIds = await tx.listActiveFileIds(pair.from);
      const uploadSessions = await tx.moveUploadSessions(pair.from, pair.to);
      const workspaces = await tx.moveWorkspaces(pair.from, pair.to);
      const files = await tx.moveFiles(pair.from, pair.to);
      return {
        from: pair.from,
        to: pair.to,
        files,
        workspaces,
        uploadSessions,
        brokenPermanentUrlFileIds,
      };
    });
    results.push(result);
  }

  return results;
}

/** Human-readable report: per-table counts plus the broken permanent-URL ids. */
export function formatRepointResults(results: RepointPairResult[]): string {
  const lines: string[] = [];

  for (const r of results) {
    lines.push(`${r.from} -> ${r.to}`);
    lines.push(
      `  files: ${r.files}, workspaces: ${r.workspaces}, upload_sessions: ${r.uploadSessions}`
    );
    if (r.brokenPermanentUrlFileIds.length === 0) {
      lines.push('  permanent URLs broken: none');
    } else {
      lines.push(`  permanent URLs broken (${r.brokenPermanentUrlFileIds.length}):`);
      for (const id of r.brokenPermanentUrlFileIds) {
        lines.push(`    ${id}`);
      }
    }
  }

  return lines.join('\n');
}
