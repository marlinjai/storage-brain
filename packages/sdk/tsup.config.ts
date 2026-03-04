import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts', 'src/admin.ts'],
  format: ['cjs', 'esm'],
  dts: true,
  sourcemap: true,
  clean: true,
  treeshake: true,
});
