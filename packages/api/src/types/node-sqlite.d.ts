// Minimal ambient types for the built-in `node:sqlite` module. It ships with
// Node 22 at runtime but is not declared by @types/node@20 (the pinned version),
// so tsc cannot resolve it. Used only by tests (d1.spec.ts) to back a D1 shim.
declare module 'node:sqlite' {
  export interface StatementSync {
    run(...params: unknown[]): { changes: number; lastInsertRowid: number | bigint };
    get(...params: unknown[]): Record<string, unknown> | undefined;
    all(...params: unknown[]): Record<string, unknown>[];
  }

  export class DatabaseSync {
    constructor(path: string);
    exec(sql: string): void;
    prepare(sql: string): StatementSync;
    close(): void;
  }
}
