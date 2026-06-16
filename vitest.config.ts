import path from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      // Dashboard package uses the "@/..." path alias. Map it so its route /
      // lib specs resolve. Does not match scoped package specifiers like
      // "@storage-brain/..." (those do not start with "@/").
      '@': path.resolve(__dirname, 'packages/dashboard/src'),
    },
  },
  test: {
    include: ['packages/*/src/**/*.spec.ts'],
    environment: 'node',
    setupFiles: ['./vitest.setup.ts'],
  },
});
