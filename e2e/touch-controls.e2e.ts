import { expect, test, type CDPSession, type Page } from '@playwright/test'

import { startGameSession } from './helpers/session'

const QA_GLOBAL_KEY = '__NERIMA_GAMES_QA__'

type Position = { readonly x: number; readonly y: number; readonly z: number }
type GameplaySnapshot = {
  readonly pose: {
    readonly feetPosition: Position
    readonly yawRadians: number
  }
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

const horizontalDistance = (left: Position, right: Position): number =>
  Math.hypot(right.x - left.x, right.z - left.z)

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
    await page.waitForTimeout(120)
    const afterEnd = await snapshot(page)
    await page.waitForTimeout(280)
    const settledAfterEnd = await snapshot(page)
    expect(horizontalDistance(afterEnd.pose.feetPosition, settledAfterEnd.pose.feetPosition)).toBeLessThan(0.03)

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
    await page.waitForTimeout(120)
    const afterCancel = await snapshot(page)
    await page.waitForTimeout(280)
    const settledAfterCancel = await snapshot(page)
    expect(horizontalDistance(afterCancel.pose.feetPosition, settledAfterCancel.pose.feetPosition)).toBeLessThan(0.03)

    const right = await centerOf(page, '[data-touch-action="moveRight"]')
    await dispatchTouch(client, 'touchStart', right)
    await page.waitForTimeout(180)
    await page.evaluate(() => window.dispatchEvent(new Event('blur')))
    await page.waitForTimeout(120)
    const afterBlur = await snapshot(page)
    await page.waitForTimeout(280)
    const settledAfterBlur = await snapshot(page)
    expect(horizontalDistance(afterBlur.pose.feetPosition, settledAfterBlur.pose.feetPosition)).toBeLessThan(0.03)
    await dispatchTouch(client, 'touchEnd')
  })
})
