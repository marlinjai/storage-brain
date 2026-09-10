module.exports = {
  root: true,
  parser: '@typescript-eslint/parser',
  parserOptions: {
    ecmaVersion: 2022,
    sourceType: 'module',
    // Fixed, not cwd-relative: makes `project` resolve correctly whether
    // eslint runs from the repo root (`pnpm run lint`) or from inside a
    // single package (`pnpm --filter <pkg> lint`, or `next lint`, which both
    // change cwd first). Before this, running from inside a package broke
    // the relative "./packages/*/tsconfig.json" glob below and made every
    // type-aware rule (prefer-nullish-coalescing etc.) throw instead of lint.
    tsconfigRootDir: __dirname,
    project: ['./packages/*/tsconfig.json'],
  },
  plugins: ['@typescript-eslint'],
  extends: [
    'eslint:recommended',
    'plugin:@typescript-eslint/recommended',
    'plugin:@typescript-eslint/recommended-requiring-type-checking',
  ],
  rules: {
    '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    '@typescript-eslint/explicit-function-return-type': 'off',
    '@typescript-eslint/no-explicit-any': 'warn',
    '@typescript-eslint/prefer-nullish-coalescing': 'error',
    '@typescript-eslint/prefer-optional-chain': 'error',
    'no-console': ['warn', { allow: ['warn', 'error'] }],
  },
  overrides: [
    {
      files: ['**/*.spec.ts', '**/vitest.setup.ts'],
      rules: {
        '@typescript-eslint/no-unsafe-member-access': 'off',
        '@typescript-eslint/no-unsafe-assignment': 'off',
        '@typescript-eslint/no-unsafe-call': 'off',
        '@typescript-eslint/no-unsafe-argument': 'off',
        '@typescript-eslint/no-unsafe-return': 'off',
      },
    },
  ],
  ignorePatterns: ['dist/', 'node_modules/', '*.js'],
};
