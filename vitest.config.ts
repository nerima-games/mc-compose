import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: {
      // mc-audio migrated its entry point to src/index.ts (PACKAGE_STANDARD.md);
      // this alias follows it there rather than the pre-migration path.
      '@nerima-games/mc-audio': fileURLToPath(new URL('../mc-audio/src/index.ts', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
    globals: false,
    pool: 'forks',
    poolOptions: {
      forks: {
        maxForks: '50%',
        minForks: 1,
        isolate: true,
        singleFork: false,
      },
    },
    include: ['test/**/*.{test,spec}.ts'],
    exclude: ['**/node_modules/**', '**/dist/**', '**/coverage/**', '**/.git/**'],
    testTimeout: 10000,
    hookTimeout: 10000,
    teardownTimeout: 5000,
    slowTestThreshold: 300,
    fileParallelism: true,
    sequence: {
      seed: 0,
      hooks: 'stack',
    },
    reporters: ['default'],
    coverage: {
      provider: 'v8',
      enabled: false,
      include: ['src/index.ts', 'src/domain/**/*.ts'],
      exclude: ['**/*.d.ts', '**/*.config.ts', '**/*.test.ts', '**/*.spec.ts'],
      all: true,
      reporter: ['text', 'json', 'html', 'lcov'],
      reportsDirectory: './coverage',
      // Org-wide 99% gate (TEST_STANDARD.md §3), enabled immediately and without
      // a staged rollout, per the organisation's decision to apply it to all 16
      // repositories on rollout day regardless of where each repository's
      // coverage actually stands (TEST_STANDARD.md §3 / §4).
      //
      // This repository's real baseline, measured via `pnpm test:coverage`
      // when this gate was turned on: statements 96.13%, branches 88.39%,
      // functions 100%, lines 96.13%. Three of the four metrics are BELOW the
      // 99% threshold, so this gate goes red the moment it is enabled. That is
      // an accepted, known result (TEST_STANDARD.md §4 lists mc-compose by
      // name as a repository whose CI is expected to go red on rollout) and
      // not a reason to defer or to lower the threshold — closing the gap is
      // tracked as follow-up work, most of it in src/domain/qa-api.ts (90.38%
      // stmts) and src/domain/modding.ts (93.24% stmts), both short a handful
      // of error-path branches.
      thresholds: { branches: 99, functions: 99, lines: 99, statements: 99 },
    },
  },
  esbuild: {
    target: 'node22',
    format: 'esm',
    platform: 'node',
  },
})
