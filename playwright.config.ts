/**
 * The browser E2E harness. The complete discovered suite is the final gate;
 * docs/e2e-triage.md records the historical 25-test reference migration.
 *
 * PRE-AUDIT FIRST CUT (叩き台).
 *
 * ---------------------------------------------------------------------------
 * This is NOT `pnpm e2e`, and the two names must not merge
 * ---------------------------------------------------------------------------
 *
 * `pnpm e2e` is `vitest run test/e2e` — the roster frame-order test, which is
 * pure, needs only `effect` and `domain/`, and IS in `pnpm verify`
 * (docs/testing.md §3.5). It answers half (a) of plan.md §3.15: do the declared
 * ids compose into one total order.
 *
 * `pnpm e2e:browser` is this. It needs Chromium, a production preview, and — critically
 * — published runtime packages from node_modules. It stays outside
 * `pnpm verify` because Chromium is an explicit, heavier final gate.
 *
 * ---------------------------------------------------------------------------
 * Carried over from the reference implementation's `playwright.config.ts`
 * ---------------------------------------------------------------------------
 *
 * Chromium only, and SwiftShader. There is no GPU in headless CI, and
 * docs/testing.md §3.3 records the consequence the reference paid for: pointer
 * lock does not work headless, so anything needing mouselook goes through the
 * QA API rather than through real pointer capture.
 *
 * The base port is 5181, not the reference's 5180 — `vite.config.ts` explains
 * why. The default here is derived per checkout path rather than fixed at
 * 5181, so two `git worktree` checkouts running this suite concurrently on
 * one machine land on different ports instead of racing each other's
 * `vite preview` for the URL — see the port derivation below.
 */
import { createHash } from 'node:crypto'

import { defineConfig, devices } from '@playwright/test'

// Read by specs that need to loosen a threshold for software rendering. Set
// here rather than in each spec so that there is one answer to "was this a real
// GPU", and it is the same answer the launch flags below produce.
process.env['PLAYWRIGHT_USE_SWIFTSHADER'] = '1'

const readPort = (name: string, fallback: number): number => {
  const value = process.env[name]
  if (value === undefined) return fallback
  const port = Number(value)
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error(`${name} must be an integer between 1 and 65535`)
  }
  return port
}

// `reuseExistingServer: false` below throws if THIS run's own port is
// already bound — but that only guards a single run against its own leaked
// orphan. Two separate `git worktree` checkouts of this repo both defaulting
// to the hardcoded 5181/5182 would each pass that check independently, then
// race each other for the URL: whichever server answers first is silently
// accepted as "ready" by the other's health-check poll, so a concurrent
// local run can end up testing a different worktree's build entirely.
// Deriving the default from the absolute checkout path makes two worktrees
// land on different ports without requiring a manually-set env var, so the
// race has nothing to race over. CI is unaffected — one checkout per job.
const PORT_RANGE_BASE = 20_000
const PORT_RANGE_SIZE = 20_000
const derivedPort = (seed: string): number => {
  const digest = createHash('sha256').update(seed).digest()
  return PORT_RANGE_BASE + (digest.readUInt32BE(0) % PORT_RANGE_SIZE)
}

export const E2E_PORT: number = readPort('E2E_PORT', derivedPort(`${process.cwd()}:e2e`))
export const E2E_BASE_URL: string = `http://127.0.0.1:${String(E2E_PORT)}`
export const E2E_MULTIPLAYER_PORT: number = readPort(
  'E2E_MULTIPLAYER_PORT',
  derivedPort(`${process.cwd()}:multiplayer`),
)
export const E2E_MULTIPLAYER_URL: string = `ws://127.0.0.1:${String(E2E_MULTIPLAYER_PORT)}/ws`

if (E2E_PORT === E2E_MULTIPLAYER_PORT) {
  throw new Error('E2E_PORT and E2E_MULTIPLAYER_PORT must be different')
}

const config: ReturnType<typeof defineConfig> = defineConfig({
  testDir: './e2e',
  testMatch: '**/*.e2e.ts',
  timeout: 60_000,

  // Keep local failures immediate while retaining the first failure's trace in
  // CI, where renderer scheduling can be noisy under software WebGL.
  retries: process.env['CI'] === undefined ? 0 : 1,
  workers: 1,
  forbidOnly: process.env['CI'] !== undefined,

  reporter: [['list'], ['json', { outputFile: 'test-results/e2e-browser.json' }]],

  use: {
    baseURL: E2E_BASE_URL,
    viewport: { width: 1280, height: 720 },
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    launchOptions: {
      args: [
        // ANGLE over SwiftShader: software WebGL, and the only thing that works
        // on headless macOS arm64.
        '--use-gl=angle',
        '--use-angle=swiftshader',
        '--enable-webgl',
        '--enable-webgl2',
        '--ignore-gpu-blocklist',
        '--enable-unsafe-swiftshader',
        // A backgrounded renderer stops servicing requestAnimationFrame, and
        // this suite's central claim is that the frame loop RUNS. Without these
        // three, "FPS is zero" would mean "Chromium throttled the tab".
        '--disable-background-timer-throttling',
        '--disable-backgrounding-occluded-windows',
        '--disable-renderer-backgrounding',
      ],
    },
  },

  projects: [{ name: 'chromium-webgl', use: { ...devices['Desktop Chrome'] } }],

  webServer: [
    {
      command: `corepack pnpm build:web && corepack pnpm exec vite preview --host 127.0.0.1 --port ${String(E2E_PORT)} --strictPort`,
      url: E2E_BASE_URL,
      // Never reuse: the final gate must serve the current checkout and its
      // lockfile-resolved public packages, not a stale process.
      reuseExistingServer: false,
      timeout: 60_000,
      stdout: 'pipe',
      stderr: 'pipe',
    },
    {
      command: `corepack pnpm tsx apps/multiplayer-server/main.ts --port ${String(E2E_MULTIPLAYER_PORT)}`,
      url: `http://127.0.0.1:${String(E2E_MULTIPLAYER_PORT)}/health`,
      reuseExistingServer: false,
      timeout: 60_000,
      stdout: 'pipe',
      stderr: 'pipe',
    },
  ],
})

export default config
