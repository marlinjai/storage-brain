import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['packages/*/src/**/*.spec.ts'],
    environment: 'node',
    setupFiles: ['./vitest.setup.ts'],
  },
});
