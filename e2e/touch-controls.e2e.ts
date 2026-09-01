import { expect, test, type CDPSession, type Page } from '@playwright/test'

import { startGameSession } from './helpers/session'
import { waitForSimulationProgress } from './helpers/simulation-wait'

const QA_GLOBAL_KEY = '__NERIMA_GAMES_QA__'

type Position = { readonly x: number; readonly y: number; readonly z: number }
type GameplaySnapshot = {
  readonly pose: {
    readonly feetPosition: Position
    readonly yawRadians: number
  }
  // Despite the nesting, this is the host's single global cumulative
  // simulated-time clock (apps/web/main.ts's `simulationElapsedSecs`, `+=
  // deltaSecs` unconditionally every frame) — not scoped to environmental
  // contact. It is the one field in `gameplay.snapshot` that measures
  // simulated time directly, so it is what a speed-in-game-terms assertion
  // needs to divide by.
  readonly environmentalContact: { readonly simulationElapsedSecs: number }
}

const snapshot = (page: Page): Promise<GameplaySnapshot> =>
  page.evaluate(async (key) => {
    const surface = (globalThis as unknown as Record<string, unknown>)[key] as
      | Record<string, () => unknown>
      | undefined
    const operation = surface?.['gameplay.snapshot']
    if (operation === undefined) throw new Error('missing QA command: gameplay.snapshot')
    return await operation()
  }, QA_GLOBAL_KEY) as Promise<GameplaySnapshot>

const snapshotWithFrames = (page: Page): Promise<{ frames: number; value: GameplaySnapshot }> =>
  page.evaluate(async (key) => {
    const surface = (globalThis as unknown as Record<string, unknown>)[key] as
      | Record<string, () => unknown>
      | undefined
    const operation = surface?.['gameplay.snapshot']
    if (operation === undefined) throw new Error('missing QA command: gameplay.snapshot')
    return {
      frames: Number(document.body.getAttribute('data-frames')),
      value: await operation() as GameplaySnapshot,
    }
  }, QA_GLOBAL_KEY)

const horizontalDistance = (left: Position, right: Position): number =>
  Math.hypot(right.x - left.x, right.z - left.z)

// What "settled" means: horizontal speed below a floor, in game terms —
// blocks per SIMULATED second, not blocks per real-time sample. The original
// 0.03-blocks-per-280ms-sample bar is preserved as the intended threshold
// (≈0.107 blocks/simulated-second); only the denominator changes. A
// wall-clock sample interval is the wrong unit here: simulated time runs
// slower than real time under host contention (see
// waitForSimulationProgress), so a fixed real-time window covers less
// simulated ground on a slow runner, and a delta-per-real-sample assertion
// reads that as "still moving" when the simulation is behaving correctly —
// exactly CI's observed failure. Speed-per-simulated-second stays true
// regardless of how fast or slow the host is.
const SETTLED_SPEED_BLOCKS_PER_SIMULATED_SECOND = 0.03 / 0.28

const awaitMovementSettled = (page: Page): Promise<void> => {
  let previous: { readonly position: Position; readonly simSecs: number } | undefined
  return waitForSimulationProgress(
    page,
    async () => {
      const { frames, value } = await snapshotWithFrames(page)
      return {
        frames,
        value: {
          position: value.pose.feetPosition,
          simSecs: value.environmentalContact.simulationElapsedSecs,
        },
      }
    },
    (current) => {
      if (previous === undefined) {
        previous = current
        return false
      }
      const deltaSimSecs = current.simSecs - previous.simSecs
      // No simulated time passed between these two reads (possible under
      // dense polling): there is nothing to divide by, so this pair cannot
      // judge speed — not evidence of settling.
      const speed = deltaSimSecs > 0
        ? horizontalDistance(previous.position, current.position) / deltaSimSecs
        : Number.POSITIVE_INFINITY
      previous = current
      return speed < SETTLED_SPEED_BLOCKS_PER_SIMULATED_SECOND
    },
    { description: 'touch movement settles' },
  ).then(() => undefined)
}

const centerOf = async (page: Page, selector: string): Promise<{ readonly x: number; readonly y: number }> => {
  const box = await page.locator(selector).boundingBox()
  if (box === null) throw new Error(`touch target has no box: ${selector}`)
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 }
}

const dispatchTouch = (
  client: CDPSession,
  type: 'touchStart' | 'touchMove' | 'touchEnd' | 'touchCancel',
  point?: { readonly x: number; readonly y: number },
): Promise<unknown> => client.send('Input.dispatchTouchEvent', {
  type,
  touchPoints: point === undefined ? [] : [{ ...point, id: 1, radiusX: 4, radiusY: 4, force: 1 }],
})

test('keeps touch controls hidden on a desktop input surface', async ({ page }) => {
  await startGameSession(page, 'touch-desktop')
  await expect(page.locator('body')).toHaveAttribute('data-mc-compose-boot', 'running')
  await expect(page.getByTestId('touch-controls')).toBeHidden()
})

test.describe('touch input surface', () => {
  test.use({ hasTouch: true, viewport: { width: 844, height: 390 } })

  test('moves, looks, follows overlays, and clears interrupted holds', async ({ page }) => {
    await startGameSession(page, 'touch-gameplay')
    await expect(page.locator('body')).toHaveAttribute('data-mc-compose-boot', 'running')

    const controls = page.getByTestId('touch-controls')
    await expect(controls).toBeVisible()
    await expect(controls).not.toHaveAttribute('inert', '')

    const client = await page.context().newCDPSession(page)
    const forward = await centerOf(page, '[data-touch-action="moveForward"]')
    const beforeMove = await snapshot(page)
    await dispatchTouch(client, 'touchStart', forward)
    await page.waitForTimeout(350)
    await dispatchTouch(client, 'touchEnd')
    const afterMove = await snapshot(page)
    expect(horizontalDistance(beforeMove.pose.feetPosition, afterMove.pose.feetPosition)).toBeGreaterThan(0.05)
    // Ground movement retains physical momentum briefly after input is released.
    await page.waitForTimeout(1_100)
    await awaitMovementSettled(page)

    const lookStart = await centerOf(page, '[data-testid="touch-look-surface"]')
    const beforeLook = await snapshot(page)
    await dispatchTouch(client, 'touchStart', lookStart)
    await dispatchTouch(client, 'touchMove', { x: lookStart.x + 70, y: lookStart.y - 24 })
    await page.waitForTimeout(100)
    await dispatchTouch(client, 'touchEnd')
    const afterLook = await snapshot(page)
    expect(Math.abs(afterLook.pose.yawRadians - beforeLook.pose.yawRadians)).toBeGreaterThan(0.01)

    await page.locator('[data-touch-action="openInventory"]').tap()
    await expect(controls).toBeHidden()
    await expect(page.locator('body')).toHaveAttribute('data-inventory-open', 'true')
    await page.keyboard.press('Escape')
    await expect(controls).toBeVisible()

    await page.locator('[data-touch-action="escape"]').tap()
    await expect(controls).toBeHidden()
    await expect(page.locator('body')).toHaveAttribute('data-session-paused', 'true')
    await page.locator('#resume-button').click()
    await expect(controls).toBeVisible()

    await dispatchTouch(client, 'touchStart', forward)
    await page.waitForTimeout(180)
    await dispatchTouch(client, 'touchCancel')
    await page.waitForTimeout(1_100)
    await awaitMovementSettled(page)

    const right = await centerOf(page, '[data-touch-action="moveRight"]')
    await dispatchTouch(client, 'touchStart', right)
    await page.waitForTimeout(180)
    await page.evaluate(() => window.dispatchEvent(new Event('blur')))
    await page.waitForTimeout(1_100)
    await awaitMovementSettled(page)
    await dispatchTouch(client, 'touchEnd')
  })
})
