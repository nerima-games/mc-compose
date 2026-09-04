import { expect, test, type ConsoleMessage, type Page } from '@playwright/test'

import { startGameSession } from './helpers/session'
import { waitForSimulationProgress } from './helpers/simulation-wait'

const QA_GLOBAL_KEY = '__NERIMA_GAMES_QA__'

/**
 * mc-render 0.7.0 wires a dimension into `planRenderEnvironment`, and
 * `apps/web/main.ts` now passes the player's active dimension through the
 * per-frame weather snapshot — see the comment at that call site. This is
 * the test that a player would actually notice: the sky changes.
 *
 * WHAT THIS CAN AND CANNOT SEE. Nothing in the DOM reflects the planned
 * `RenderEnvironmentPlan` directly — `setEnvironment` (application/
 * world-renderer.ts) applies it straight to the THREE.WebGLRenderer via
 * `renderer.setClearColor(environment.skyColor, ...)`, which three.js turns
 * into a `gl.clearColor(...)` call. Reading `gl.getParameter(gl.
 * COLOR_CLEAR_VALUE)` from the real WebGL2 context is therefore an
 * observation of the actual rendering pipeline, in the same spirit as
 * smoke.e2e.ts #1's `canvas.getContext('webgl2')` probe — not a re-derivation
 * of `planRenderEnvironment`'s own arithmetic. What this deliberately does
 * NOT assert is the exact clear-colour components: three.js's colour
 * management can transform the value `setClearColor` receives before it
 * reaches `gl.clearColor`, so pinning specific floats would be testing that
 * pipeline's colour-space behaviour rather than this change. Nor does the
 * "restores on return" half assert an exact match: `planRenderEnvironment`
 * interpolates the overworld sky by daylight, and simulated time keeps
 * advancing for the seconds this test spends in the Nether and the End, so
 * the restored colour is close but not bit-identical to where it started.
 * The claim this test carries is comparative — the colour visibly CHANGES
 * between dimensions, and on return lands far closer to where it started
 * than to either dimension visited — which is what this fix makes true and
 * an exact-equality assertion would get wrong on a live clock.
 */

type PageFaults = {
  readonly consoleErrors: ReadonlyArray<string>
  readonly pageErrors: ReadonlyArray<string>
}

const watchForFaults = (page: Page): PageFaults => {
  const consoleErrors: Array<string> = []
  const pageErrors: Array<string> = []
  page.on('console', (message: ConsoleMessage) => {
    if (message.type() === 'error') consoleErrors.push(message.text())
  })
  page.on('pageerror', (error: Error) => pageErrors.push(`${error.name}: ${error.message}`))
  return { consoleErrors, pageErrors }
}

const callQa = <A>(page: Page, command: string): Promise<A> =>
  page.evaluate(
    async ({ key, commandName }) => {
      const surface = (globalThis as unknown as Record<string, unknown>)[key] as
        | Record<string, () => unknown>
        | undefined
      const operation = surface?.[commandName]
      if (operation === undefined) throw new Error(`missing QA command: ${commandName}`)
      return await operation()
    },
    { key: QA_GLOBAL_KEY, commandName: command },
  ) as Promise<A>

const framesNow = (page: Page): Promise<number> =>
  page.evaluate(() => Number(document.body.getAttribute('data-frames')))

/**
 * `[r, g, b, a]`, always length 4 at runtime (that is what `COLOR_CLEAR_VALUE`
 * returns) — a plain array rather than a 4-tuple so indexing stays
 * `number | undefined` under `noUncheckedIndexedAccess` without a cast.
 * `undefined` means the canvas has no live WebGL2 context to read from.
 */
type ClearColor = ReadonlyArray<number>

const readClearColor = (page: Page): Promise<ClearColor | undefined> =>
  page.evaluate(() => {
    const canvas = document.getElementById('game-canvas')
    if (!(canvas instanceof HTMLCanvasElement)) return undefined
    const gl = canvas.getContext('webgl2')
    if (gl === null) return undefined
    const value = gl.getParameter(gl.COLOR_CLEAR_VALUE) as Float32Array
    return Array.from(value)
  })

// The QA dimension switch (enterQaDimension in apps/web/main.ts) mutates
// currentChunkContext synchronously, but the environment only reaches the
// GPU on the running game loop's NEXT requestAnimationFrame tick, inside
// presentWeatherRuntime's call to worldRenderer.weather.frame. Waiting for
// the frame counter to advance past its value at call time is what makes
// "the sky updated" distinguishable from "we read stale GL state" — the
// same shape waitForSimulationProgress is used for elsewhere in this suite.
const waitForFrameAdvance = (page: Page, before: number): Promise<number> =>
  waitForSimulationProgress(
    page,
    async () => {
      const frames = await framesNow(page)
      return { frames, value: frames }
    },
    (frames) => frames > before,
    { description: 'render loop advancing past a QA dimension change' },
  )

const colorDistance = (a: ClearColor, b: ClearColor): number =>
  Math.hypot((a[0] ?? 0) - (b[0] ?? 0), (a[1] ?? 0) - (b[1] ?? 0), (a[2] ?? 0) - (b[2] ?? 0))

/** Narrows `value` for the rest of the caller's scope instead of casting it. */
function assertClearColor(
  value: ClearColor | undefined,
  message: string,
): asserts value is ClearColor {
  expect(value, message).toBeDefined()
}

const NOTICEABLE_COLOR_DISTANCE = 0.05

test('the rendered sky changes when the player crosses dimensions, and restores on return', async ({ page }) => {
  const faults = watchForFaults(page)

  await startGameSession(page)
  await expect(page.locator('body')).toHaveAttribute('data-mc-compose-boot', 'running')

  const overworldClear = await readClearColor(page)
  assertClearColor(overworldClear, 'the overworld should already be drawing through a live WebGL2 context')

  let frames = await framesNow(page)
  await callQa(page, 'gameplay.enterNether')
  frames = await waitForFrameAdvance(page, frames)
  const netherClear = await readClearColor(page)
  assertClearColor(netherClear, 'the Nether should still be drawing through a live WebGL2 context')
  expect(
    colorDistance(overworldClear, netherClear),
    `the Nether's fixed sunless haze should read as a visibly different clear colour than the overworld sky, got overworld=${JSON.stringify(overworldClear)} nether=${JSON.stringify(netherClear)}`,
  ).toBeGreaterThan(NOTICEABLE_COLOR_DISTANCE)

  await callQa(page, 'gameplay.enterEnd')
  frames = await waitForFrameAdvance(page, frames)
  const endClear = await readClearColor(page)
  assertClearColor(endClear, 'the End should still be drawing through a live WebGL2 context')
  expect(
    colorDistance(netherClear, endClear),
    `the End's dark void should read as a visibly different clear colour than the Nether haze, got nether=${JSON.stringify(netherClear)} end=${JSON.stringify(endClear)}`,
  ).toBeGreaterThan(NOTICEABLE_COLOR_DISTANCE)

  await callQa(page, 'gameplay.enterOverworld')
  frames = await waitForFrameAdvance(page, frames)
  const overworldClearAgain = await readClearColor(page)
  assertClearColor(overworldClearAgain, 'the overworld should still be drawing through a live WebGL2 context')
  // NOT an exact round-trip: planRenderEnvironment interpolates the overworld
  // sky by daylight (day/night cycle), and simulated time keeps advancing
  // for the seconds this test spends in the Nether and the End — measured
  // ~0.007 of drift on an otherwise-correct run. So the claim this makes is
  // comparative rather than exact: returning is far closer to where the test
  // started than to either dimension it visited. A broken restore (still
  // showing Nether or End) would fail this the same way an exact-match
  // assertion would, without being sensitive to the clock having moved on.
  const restoredDistance = colorDistance(overworldClear, overworldClearAgain)
  expect(
    restoredDistance,
    `returning to the overworld should land far closer to its original sky than to the Nether's, got before=${JSON.stringify(overworldClear)} after=${JSON.stringify(overworldClearAgain)} nether=${JSON.stringify(netherClear)}`,
  ).toBeLessThan(colorDistance(overworldClear, netherClear) / 2)
  expect(
    restoredDistance,
    `returning to the overworld should land far closer to its original sky than to the End's, got before=${JSON.stringify(overworldClear)} after=${JSON.stringify(overworldClearAgain)} end=${JSON.stringify(endClear)}`,
  ).toBeLessThan(colorDistance(overworldClear, endClear) / 2)

  expect(faults.pageErrors).toEqual([])
  expect(faults.consoleErrors).toEqual([])
})
