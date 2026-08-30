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

const config: ReturnType<typeof defineConfig> = defineConfig({
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
    maxWorkers: '50%',
    isolate: true,
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
      // org standard (§2.8): src/** is the coverage surface. apps/ is not a
      // distributed package (it is this repository's Vite web application), so
      // it is out of the gate — the four files listed here previously were a
      // repo-specific extension of the standard include list; e2e/ and
      // test/support doubles still exercise apps/ code, just without a
      // coverage requirement on it.
      include: ['src/**/*.ts'],
      exclude: ['**/*.d.ts', '**/*.config.ts', '**/*.test.ts', '**/*.spec.ts'],
      reporter: ['text', 'json', 'html', 'lcov'],
      reportsDirectory: './coverage',
      // Full source coverage is the release gate; `test:coverage` enables V8
      // collection explicitly.
      thresholds: { branches: 100, functions: 100, lines: 100, statements: 100 },
    },
  },
  esbuild: {
    target: 'node24',
    format: 'esm',
    platform: 'node',
  },
})

export default config
