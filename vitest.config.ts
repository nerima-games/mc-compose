import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

// A sibling mc-audio checkout is a local-monorepo convenience, not a guarantee: CI's
// actions/checkout only clones mc-compose itself, with no sibling repos on disk. When no
// sibling source is found, fall back to the installed @nerima-games/mc-audio package (the
// registry dependency already declared in package.json) instead of throwing — every other
// @nerima-games/* dependency in this suite resolves that way already.
const audioSource = ['../mc-audio/src/index.ts', '../../../../mc-audio/src/index.ts']
  .map((relativePath) => new URL(relativePath, import.meta.url))
  .find((url) => existsSync(url))

export default defineConfig({
  resolve: {
    alias: audioSource
      ? {
          // mc-audio migrated its entry point to src/index.ts (PACKAGE_STANDARD.md);
          // this alias follows it there rather than the pre-migration path.
          '@nerima-games/mc-audio': fileURLToPath(audioSource),
        }
      : {},
  },
  test: {
    environment: 'node',
    globals: false,
    server: {
      deps: {
        inline: ['@nerima-games/mc-audio'],
      },
    },
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
      include: [
        'src/index.ts',
        'src/domain/**/*.ts',
        'apps/web/render-entity-projection.ts',
      ],
      exclude: ['**/*.d.ts', '**/*.config.ts', '**/*.test.ts', '**/*.spec.ts'],
      all: true,
      reporter: ['text', 'json', 'html', 'lcov'],
      reportsDirectory: './coverage',
      // Keep this gate strict. Pure application projections are included here
      // when they can be tested without booting a browser or server.
      thresholds: { branches: 99, functions: 99, lines: 99, statements: 99 },
    },
  },
  esbuild: {
    target: 'node24',
    format: 'esm',
    platform: 'node',
  },
})
