/**
 * The browser E2E harness — docs/e2e-triage.md's 25 本, the final gate.
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
 * `pnpm e2e:browser` is this. It needs Chromium, a dev server, and — critically
 * — SIBLING CHECKOUTS ON DISK, because nothing is published (see
 * `vite.config.ts`). It therefore CANNOT be in `pnpm verify`, for exactly the
 * reason docs/testing.md §3.5 keeps `pnpm check:roster` out: mc-compose's CI
 * clones mc-compose and nothing else, and a gate that cannot run in CI, placed
 * in the command CI runs, stops `pnpm verify` from meaning "this is green".
 * `check:mirrors` and `check:repoint` set the same precedent in mc-dev-meta.
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
 * The port is 5181, not the reference's 5180 — `vite.config.ts` explains why.
 */
import { defineConfig, devices } from '@playwright/test'

// Read by specs that need to loosen a threshold for software rendering. Set
// here rather than in each spec so that there is one answer to "was this a real
// GPU", and it is the same answer the launch flags below produce.
process.env['PLAYWRIGHT_USE_SWIFTSHADER'] = '1'

export const E2E_PORT = 5181
export const E2E_BASE_URL = `http://127.0.0.1:${String(E2E_PORT)}`

export default defineConfig({
  testDir: './e2e',
  testMatch: '**/*.e2e.ts',
  timeout: 60_000,

  // No retries. The reference used one, for a measured reason — two local
  // workers starved each other's render loop and dropped synthetic key presses.
  // This suite has one worker and no synthetic input yet, so a retry here would
  // only hide flake that has not been diagnosed. Add it back with the
  // measurement that justifies it.
  retries: 0,
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

  webServer: {
    command: `pnpm dev --port ${String(E2E_PORT)} --strictPort`,
    url: E2E_BASE_URL,
    // Never reuse. The dev server prints which roster root it resolved, and a
    // server left over from another checkout would serve a different game than
    // the one under test — the drift docs/testing.md §3.5 warns about, with the
    // evidence scrolled off the top of somebody else's terminal.
    reuseExistingServer: false,
    timeout: 60_000,
    stdout: 'pipe',
    stderr: 'pipe',
  },
})
