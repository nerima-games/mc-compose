import { expect, test, type Page } from '@playwright/test'

import { startGameSession } from './helpers/session'

const SAMPLE_INTERVAL_MS = 250
const SAMPLE_DURATION_MS = 8_000

// Headless CI renders WebGL through SwiftShader. These budgets intentionally
// reject a stopped or effectively unusable loop without pretending software
// rendering has desktop-GPU throughput.
const MINIMUM_AVERAGE_FPS = 8
const MAXIMUM_STALL_MS = 2_000
const MAXIMUM_HEAP_GROWTH_BYTES = 192 * 1024 * 1024

interface PerformanceSample {
  readonly frames: number
  readonly fps: number
  readonly heapBytes: number | null
  readonly observedAt: number
}

const readSample = (page: Page): Promise<PerformanceSample> =>
  page.evaluate(() => {
    const frames = Number(document.body.dataset['frames'])
    const fps = Number(document.querySelector('#fps-value')?.textContent)
    const memory = performance as Performance & {
      readonly memory?: { readonly usedJSHeapSize?: number }
    }
    const heapBytes = memory.memory?.usedJSHeapSize

    return {
      frames,
      fps,
      heapBytes: typeof heapBytes === 'number' ? heapBytes : null,
      observedAt: performance.now(),
    }
  })

const measureSustainedPerformance = async (page: Page): Promise<void> => {
  await startGameSession(page, `performance-${crypto.randomUUID()}`)
  await expect(page.locator('body')).toHaveAttribute('data-mc-compose-boot', 'running')
  await expect(page.locator('#game-canvas')).toHaveAttribute('data-world-source', 'generated')

  const fpsReadout = page.locator('#fps-value[data-fps-source="mx-ui-frame-dt"]')
  await expect(fpsReadout).not.toHaveText('0', { timeout: 15_000 })

  // Exclude startup compilation, chunk creation, and the first FPS window from
  // the measured interval. The gate covers steady interactive play, not boot.
  await page.waitForTimeout(2_000)

  const samples: Array<PerformanceSample> = [await readSample(page)]
  const sampleCount = Math.ceil(SAMPLE_DURATION_MS / SAMPLE_INTERVAL_MS)
  for (let index = 0; index < sampleCount; index += 1) {
    await page.waitForTimeout(SAMPLE_INTERVAL_MS)
    samples.push(await readSample(page))
  }

  const first = samples[0]
  const last = samples.at(-1)
  expect(first).toBeDefined()
  expect(last).toBeDefined()
  if (first === undefined || last === undefined) return

  const elapsedSeconds = (last.observedAt - first.observedAt) / 1_000
  const measuredAverageFps = (last.frames - first.frames) / elapsedSeconds
  const displayedAverageFps =
    samples.reduce((total, sample) => total + sample.fps, 0) / samples.length

  expect(last.frames).toBeGreaterThan(first.frames)
  expect(measuredAverageFps).toBeGreaterThanOrEqual(MINIMUM_AVERAGE_FPS)
  expect(displayedAverageFps).toBeGreaterThanOrEqual(MINIMUM_AVERAGE_FPS)

  let lastProgressAt = first.observedAt
  let previousFrames = first.frames
  let longestStallMs = 0
  for (const sample of samples.slice(1)) {
    if (sample.frames > previousFrames) lastProgressAt = sample.observedAt
    longestStallMs = Math.max(longestStallMs, sample.observedAt - lastProgressAt)
    previousFrames = sample.frames
  }
  expect(longestStallMs).toBeLessThanOrEqual(MAXIMUM_STALL_MS)

  if (first.heapBytes !== null && last.heapBytes !== null) {
    expect(last.heapBytes - first.heapBytes).toBeLessThanOrEqual(MAXIMUM_HEAP_GROWTH_BYTES)
  }
}

test.describe('browser performance budget', () => {
  test('desktop 1280x720 sustains an interactive frame rate', async ({ page }) => {
    await measureSustainedPerformance(page)
  })

  test.describe('touch mobile 390x844', () => {
    test.use({ hasTouch: true, viewport: { width: 390, height: 844 } })

    test('sustains an interactive frame rate', async ({ page }) => {
      await measureSustainedPerformance(page)
    })
  })
})
