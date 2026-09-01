import { expect, test, type ConsoleMessage, type Page } from '@playwright/test'

import { startGameSession } from './helpers/session'

const QA_GLOBAL_KEY = '__NERIMA_GAMES_QA__'

type Position = Readonly<{ x: number; y: number; z: number }>
type InventorySlot = Readonly<{ item: string; count: number }> | null
type ProjectileSnapshot = Readonly<{
  id: string
  state: 'flying' | 'stuck' | 'despawned'
  position: Position
  ageSeconds: number
}>
type GameplaySnapshot = Readonly<{
  pose: Readonly<{
    feetPosition: Position
    yawRadians: number
    pitchRadians: number
  }>
  inventory: Readonly<{
    slots: ReadonlyArray<InventorySlot>
    durability: ReadonlyArray<Readonly<{ current: number; max: number }> | null>
  }>
  projectiles: ReadonlyArray<ProjectileSnapshot>
}>

const callQa = <A>(page: Page, command: string): Promise<A> => page.evaluate(
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

const snapshot = (page: Page): Promise<GameplaySnapshot> =>
  callQa(page, 'gameplay.snapshot')

const itemCount = (current: GameplaySnapshot, item: string): number =>
  current.inventory.slots.reduce(
    (total, slot) => total + (slot?.item === item ? slot.count : 0),
    0,
  )

const bowDurability = (current: GameplaySnapshot): number => {
  const bowIndex = current.inventory.slots.findIndex((slot) => slot?.item === 'bow')
  const durability = current.inventory.durability[bowIndex]
  if (bowIndex < 0 || durability === null || durability === undefined) {
    throw new Error('bow fixture must provide a damageable bow')
  }
  return durability.current
}

const grantPointerLock = async (page: Page): Promise<void> => {
  await page.evaluate(() => {
    const canvas = document.querySelector<HTMLCanvasElement>('#game-canvas')
    if (canvas === null) throw new Error('missing game canvas')
    Object.defineProperty(document, 'pointerLockElement', {
      configurable: true,
      get: () => canvas,
    })
    document.dispatchEvent(new Event('pointerlockchange'))
  })
}

// Forces every animation frame to cost at least `stallMs` of real wall-clock
// time, well past MAX_FRAME_SECS (apps/web/main.ts), by busy-waiting inside a
// wrapped requestAnimationFrame installed before the game's own script runs.
// A CPU-throttled CDP session does not reliably reproduce this on a fast
// host — a fixture this cheap per frame stays under the clamp threshold even
// at the DevTools Protocol's 20x throttling ceiling — so this simulates the
// stall directly instead of relying on CPU throttling to induce one.
const stallEachAnimationFrame = async (page: Page, stallMs: number): Promise<void> => {
  await page.addInitScript((ms: number) => {
    const request = window.requestAnimationFrame.bind(window)
    window.requestAnimationFrame = (callback) => request((time) => {
      const stallUntil = performance.now() + ms
      while (performance.now() < stallUntil) { /* hold the main thread so real elapsed time exceeds the clamp */ }
      callback(time)
    })
  }, stallMs)
}

test('charges, fires, and embeds an arrow while settling inventory wear', async ({ page }) => {
  const consoleErrors: Array<string> = []
  const pageErrors: Array<string> = []
  page.on('console', (message: ConsoleMessage) => {
    if (message.type() === 'error') consoleErrors.push(message.text())
  })
  page.on('pageerror', (error: Error) => pageErrors.push(`${error.name}: ${error.message}`))

  await startGameSession(page)
  await expect(page.locator('body')).toHaveAttribute('data-mc-compose-boot', 'running')

  const seeded = await callQa<GameplaySnapshot>(page, 'gameplay.seedBowProjectileEncounter')
  const initialArrowCount = itemCount(seeded, 'arrow')
  const initialBowDurability = bowDurability(seeded)
  expect(initialArrowCount).toBeGreaterThan(0)
  expect(seeded.projectiles).toEqual([])

  await grantPointerLock(page)
  await page.locator('#game-canvas').hover()
  await page.mouse.down({ button: 'right' })
  await page.waitForTimeout(350)
  const charged = await snapshot(page)
  expect(charged.projectiles).toEqual([])
  expect(itemCount(charged, 'arrow')).toBe(initialArrowCount)
  expect(bowDurability(charged)).toBe(initialBowDurability)
  await page.mouse.up({ button: 'right' })

  let createdProjectile: ProjectileSnapshot | undefined
  await expect.poll(async () => {
    const current = await snapshot(page)
    const projectile = current.projectiles[0]
    if (projectile !== undefined && projectile.state !== 'despawned') {
      expect(current.projectiles).toHaveLength(1)
      createdProjectile = projectile
      return true
    }
    return false
  }).toBe(true)

  const fired = await snapshot(page)
  expect(itemCount(fired, 'arrow')).toBe(initialArrowCount - 1)
  expect(bowDurability(fired)).toBe(initialBowDurability - 1)
  expect(createdProjectile).toBeDefined()

  let stuckProjectile: ProjectileSnapshot | undefined
  await expect.poll(async () => {
    const current = await snapshot(page)
    const projectile = current.projectiles.find(({ id }) => id === createdProjectile!.id)
    if (projectile?.state === 'stuck') {
      expect(current.projectiles).toHaveLength(1)
      stuckProjectile = projectile
      return true
    }
    return false
  }).toBe(true)

  expect(stuckProjectile!.id).toBe(createdProjectile!.id)
  expect(stuckProjectile!.position.z).toBeLessThan(seeded.pose.feetPosition.z)
  expect(stuckProjectile!.position.x).toBeGreaterThanOrEqual(6)
  expect(stuckProjectile!.position.x).toBeLessThan(11)
  expect(stuckProjectile!.position.y).toBeGreaterThanOrEqual(62)
  expect(stuckProjectile!.position.y).toBeLessThan(70)
  expect(stuckProjectile!.position.z).toBeGreaterThanOrEqual(2)
  expect(stuckProjectile!.position.z).toBeLessThan(3.1)

  expect(pageErrors).toEqual([])
  expect(consoleErrors).toEqual([])
})

test('still fires a genuinely long hold when every frame stalls well past the physics clamp', async ({ page }) => {
  // A 600ms/frame stall bounds each real frame to cost AT LEAST 600ms, so a
  // 700ms hold can fit at most one full extra frame after the one that
  // starts the draw — structurally at most 2 charge-contributing frames,
  // never the 4 a clamped accumulator (MAX_FRAME_SECS=0.05s) would need to
  // reach mx-gameplay's BOW_MIN_CHARGE_SECS=0.2s by accident (4 * 0.05 =
  // 0.20, the inclusive boundary — an earlier version of this probe used
  // parameters that landed almost exactly on it and passed even against the
  // pre-fix clamped-delta code, which is why the margin here is deliberate
  // and documented rather than tuned by feel). Real elapsed time across
  // those same 1-2 frames is ~0.6-1.2s, well clear of the 0.2s threshold.
  await stallEachAnimationFrame(page, 600)

  const consoleErrors: Array<string> = []
  const pageErrors: Array<string> = []
  page.on('console', (message: ConsoleMessage) => {
    if (message.type() === 'error') consoleErrors.push(message.text())
  })
  page.on('pageerror', (error: Error) => pageErrors.push(`${error.name}: ${error.message}`))

  await startGameSession(page)
  await expect(page.locator('body')).toHaveAttribute('data-mc-compose-boot', 'running')

  const seeded = await callQa<GameplaySnapshot>(page, 'gameplay.seedBowProjectileEncounter')
  const initialArrowCount = itemCount(seeded, 'arrow')
  expect(initialArrowCount).toBeGreaterThan(0)

  await grantPointerLock(page)
  await page.locator('#game-canvas').hover()
  await page.mouse.down({ button: 'right' })
  await page.waitForTimeout(700)
  await page.mouse.up({ button: 'right' })

  await expect.poll(async () => {
    const current = await snapshot(page)
    return current.projectiles.length
  }, { timeout: 30_000 }).toBeGreaterThan(0)

  const fired = await snapshot(page)
  expect(itemCount(fired, 'arrow')).toBe(initialArrowCount - 1)

  expect(pageErrors).toEqual([])
  expect(consoleErrors).toEqual([])
})
