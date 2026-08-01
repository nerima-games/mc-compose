import { expect, test, type ConsoleMessage, type Page } from '@playwright/test'

import { startGameSession } from './helpers/session'

const QA_GLOBAL_KEY = '__NERIMA_GAMES_QA__'
const DATABASE_NAME = 'nerima-games-minecraft'
const AIR_BLOCK_ID = 0
const OBSIDIAN_BLOCK_ID = 40
const NETHER_PORTAL_BLOCK_ID = 118

type Position = { readonly x: number; readonly y: number; readonly z: number }
type Pose = {
  readonly feetPosition: Position
  readonly yawRadians: number
  readonly pitchRadians: number
}
type InventorySlot = null | { readonly itemId: string; readonly count: number }
type GameplaySnapshot = {
  readonly pose: Pose
  readonly dimension: string
  readonly activeChunkDimension: string
  readonly entities: ReadonlyArray<{
    readonly id: string
    readonly kind: string
    readonly feetPosition: Position
    readonly healthPoints: number
    readonly behaviour: unknown
  }>
  readonly weather: {
    readonly weather: 'clear' | 'rain' | 'thunder'
    readonly remainingSecs: number
  }
  readonly vitals: {
    readonly foodTimerSecs: number
    readonly [key: string]: unknown
  }
  readonly inventory: { readonly slots: ReadonlyArray<InventorySlot> }
  readonly target: {
    readonly position: Position
    readonly reading: string
    readonly block: number | null
  }
  readonly portals: ReadonlyArray<{
    readonly dimension: string
    readonly position: Position
  }>
  readonly activePortal: null | {
    readonly anchor: Position
    readonly interiorBlock: number | null
    readonly framePosition: Position
    readonly frameBlock: number | null
  }
  readonly environmentalContact: {
    readonly simulationElapsedSecs: number
    readonly lastDamageElapsedSecs: number | null
    readonly cells: ReadonlyArray<{
      readonly position: Position
      readonly block: 'lava' | 'cactus'
      readonly contactDamage: number
    }>
  }
}

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
        | Record<string, (...arguments_: ReadonlyArray<unknown>) => unknown>
        | undefined
      const operation = surface?.[commandName]
      if (operation === undefined) throw new Error(`missing QA command: ${commandName}`)
      return await operation()
    },
    { key: QA_GLOBAL_KEY, commandName: command },
  ) as Promise<A>

const snapshot = (page: Page): Promise<GameplaySnapshot> =>
  callQa(page, 'gameplay.snapshot')

const hotbarText = (page: Page): Promise<ReadonlyArray<string | null>> =>
  page.locator('[data-mx-ui="hotbar"] [data-mx-ui="slot"]').allTextContents()

const deleteSessionDatabase = async (page: Page): Promise<void> => {
  // Use a same-origin document that does not start the game, so no open session
  // connection can block deletion before this test's first boot.
  await page.goto('/@vite/client')
  await page.evaluate(async (databaseName) => {
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.deleteDatabase(databaseName)
      request.addEventListener('success', () => resolve(), { once: true })
      request.addEventListener('error', () => reject(request.error), { once: true })
      request.addEventListener('blocked', () => reject(new Error('database deletion blocked')), {
        once: true,
      })
    })
  }, DATABASE_NAME)
}

test('restores a dynamic entity with stable identity and state', async ({ page }) => {
  const faults = watchForFaults(page)
  await deleteSessionDatabase(page)

  await startGameSession(page)
  await expect(page.locator('body')).toHaveAttribute('data-mc-compose-boot', 'running')
  await callQa(page, 'gameplay.seedMeleeDropEncounter')
  const published = await snapshot(page)
  expect(published.entities).toHaveLength(1)

  await callQa(page, 'persistence.flush')
  await expect(page.locator('body')).toHaveAttribute('data-session-persistence', 'saved')
  await page.reload()
  await expect(page.locator('body')).toHaveAttribute('data-mc-compose-boot', 'running')

  const restored = await snapshot(page)
  expect(restored.entities).toEqual(published.entities)
  expect(faults.pageErrors).toEqual([])
  expect(faults.consoleErrors).toEqual([])
})

test('publishes a mined world, inventory, and exact pose across reload', async ({ page }) => {
  const faults = watchForFaults(page)
  await deleteSessionDatabase(page)

  await startGameSession(page)
  await expect(page.locator('body')).toHaveAttribute('data-mc-compose-boot', 'running')
  await expect(page.locator('[data-mx-ui="hotbar"] [data-mx-ui="slot"]')).toHaveCount(9)

  await callQa(page, 'gameplay.setPose')
  const beforeBreak = await snapshot(page)
  expect(beforeBreak.target.reading).toBe('Block')
  expect(beforeBreak.target.block).not.toBe(AIR_BLOCK_ID)

  expect(await callQa<unknown>(page, 'gameplay.breakTarget')).not.toBeNull()
  await expect.poll(async () => (await snapshot(page)).target.block).toBe(AIR_BLOCK_ID)
  await expect(page.locator('#game-canvas')).toHaveAttribute('data-player-grounded', 'true')

  await callQa(page, 'gameplay.setWeather')
  await expect(page.locator('#game-canvas')).toHaveAttribute('data-weather', 'thunder')

  const published = await snapshot(page)
  const publishedHotbar = await hotbarText(page)
  expect(published.inventory.slots).toHaveLength(36)
  expect(publishedHotbar).toHaveLength(9)

  await callQa(page, 'persistence.flush')
  await expect(page.locator('body')).toHaveAttribute('data-session-persistence', 'saved')
  await page.reload()
  await expect(page).toHaveURL(/\?session=e2e$/u)
  await expect(page.locator('body')).toHaveAttribute('data-mc-compose-boot', 'running')
  await expect(page.locator('#game-canvas')).toHaveAttribute('data-world-source', 'persisted')
  await expect(page.locator('#game-canvas')).toHaveAttribute('data-weather', 'thunder')

  await expect.poll(async () => (await snapshot(page)).target.block).toBe(AIR_BLOCK_ID)
  const restored = await snapshot(page)
  expect(restored.pose).toEqual(published.pose)
  expect(restored.dimension).toBe(published.dimension)
  expect(restored.weather.weather).toBe(published.weather.weather)
  expect(Math.abs(restored.weather.remainingSecs - published.weather.remainingSecs)).toBeLessThan(5)
  expect(restored.inventory).toEqual(published.inventory)
  expect(await hotbarText(page)).toEqual(publishedHotbar)
  expect(faults.pageErrors).toEqual([])
  expect(faults.consoleErrors).toEqual([])
})

test('debounces dirty gameplay into a durable save without an explicit flush', async ({ page }) => {
  const faults = watchForFaults(page)
  await deleteSessionDatabase(page)

  await startGameSession(page)
  await expect(page.locator('body')).toHaveAttribute('data-mc-compose-boot', 'running')

  await callQa(page, 'gameplay.setPose')
  expect(await callQa<unknown>(page, 'gameplay.breakTarget')).not.toBeNull()
  await expect.poll(async () => (await snapshot(page)).target.block).toBe(AIR_BLOCK_ID)
  await expect(page.locator('#game-canvas')).toHaveAttribute('data-player-grounded', 'true')

  await expect(page.locator('body')).toHaveAttribute('data-session-persistence', 'saved')
  const published = await snapshot(page)

  await page.reload()
  await expect(page).toHaveURL(/\?session=e2e$/u)
  await expect(page.locator('body')).toHaveAttribute('data-mc-compose-boot', 'running')
  await expect(page.locator('#game-canvas')).toHaveAttribute('data-world-source', 'persisted')
  await expect.poll(async () => (await snapshot(page)).target.block).toBe(AIR_BLOCK_ID)
  const restored = await snapshot(page)
  expect(restored).toEqual({
    ...published,
    environmentalContact: {
      ...published.environmentalContact,
      simulationElapsedSecs: expect.any(Number),
    },
    weather: {
      ...published.weather,
      remainingSecs: expect.any(Number),
    },
    vitals: {
      ...published.vitals,
      foodTimerSecs: expect.any(Number),
    },
  })
  expect(Math.abs(restored.weather.remainingSecs - published.weather.remainingSecs)).toBeLessThan(5)
  expect(restored.vitals.foodTimerSecs).toBeGreaterThanOrEqual(0)
  expect(restored.vitals.foodTimerSecs).toBeLessThan(4)
  expect(faults.pageErrors).toEqual([])
  expect(faults.consoleErrors).toEqual([])
})

test('isolates and restores edits while travelling overworld to nether and back', async ({ page }) => {
  const faults = watchForFaults(page)
  await deleteSessionDatabase(page)

  await startGameSession(page)
  await expect(page.locator('body')).toHaveAttribute('data-mc-compose-boot', 'running')

  await callQa(page, 'gameplay.setPose')
  expect(await callQa<unknown>(page, 'gameplay.breakTarget')).not.toBeNull()
  await expect.poll(async () => (await snapshot(page)).target.block).toBe(AIR_BLOCK_ID)

  await callQa(page, 'gameplay.enterNether')
  await expect.poll(async () => (await snapshot(page)).activeChunkDimension).toBe('nether')
  const nether = await snapshot(page)
  expect(nether.dimension).toBe('nether')
  expect(nether.target.reading).toBe('Block')
  expect(nether.target.block).not.toBe(AIR_BLOCK_ID)

  await callQa(page, 'gameplay.enterOverworld')
  await expect.poll(async () => (await snapshot(page)).activeChunkDimension).toBe('overworld')
  const overworld = await snapshot(page)
  expect(overworld.dimension).toBe('overworld')
  expect(overworld.target.block).toBe(AIR_BLOCK_ID)
  expect(faults.pageErrors).toEqual([])
  expect(faults.consoleErrors).toEqual([])
})

test('materializes, persists, and reuses a portal round trip without duplicates', async ({ page }) => {
  const faults = watchForFaults(page)
  await deleteSessionDatabase(page)

  await startGameSession(page)
  await expect(page.locator('body')).toHaveAttribute('data-mc-compose-boot', 'running')

  const seeded = await callQa<GameplaySnapshot>(page, 'gameplay.seedPortalEncounter')
  expect(seeded.dimension).toBe('overworld')
  expect(seeded.portals).toEqual([
    { dimension: 'overworld', position: { x: 120, y: 65, z: 8 } },
  ])
  expect(seeded.activePortal?.interiorBlock).toBe(NETHER_PORTAL_BLOCK_ID)
  expect(seeded.activePortal?.frameBlock).toBe(OBSIDIAN_BLOCK_ID)

  await expect.poll(
    async () => (await snapshot(page)).dimension,
    { timeout: 10_000 },
  ).toBe('nether')
  const generated = await snapshot(page)
  expect(generated.activeChunkDimension).toBe('nether')
  expect(generated.portals).toEqual([
    { dimension: 'overworld', position: { x: 120, y: 65, z: 8 } },
    { dimension: 'nether', position: { x: 15, y: 65, z: 1 } },
  ])
  expect(generated.activePortal?.anchor).toEqual({ x: 15, y: 65, z: 1 })
  expect(generated.activePortal?.interiorBlock).toBe(NETHER_PORTAL_BLOCK_ID)
  expect(generated.activePortal?.frameBlock).toBe(OBSIDIAN_BLOCK_ID)

  await callQa(page, 'persistence.flush')
  await expect(page.locator('body')).toHaveAttribute('data-session-persistence', 'saved')
  await page.reload()
  await expect(page.locator('body')).toHaveAttribute('data-mc-compose-boot', 'running')
  await expect(page.locator('#game-canvas')).toHaveAttribute('data-world-source', 'persisted')

  const restored = await snapshot(page)
  expect(restored.dimension).toBe('nether')
  expect(restored.activeChunkDimension).toBe('nether')
  expect(restored.portals).toEqual(generated.portals)
  expect(restored.activePortal?.interiorBlock).toBe(NETHER_PORTAL_BLOCK_ID)
  expect(restored.activePortal?.frameBlock).toBe(OBSIDIAN_BLOCK_ID)

  await expect.poll(
    async () => (await snapshot(page)).dimension,
    { timeout: 10_000 },
  ).toBe('overworld')
  const returned = await snapshot(page)
  expect(returned.activeChunkDimension).toBe('overworld')
  expect(returned.portals).toEqual(generated.portals)
  expect(returned.portals.filter(({ dimension }) => dimension === 'overworld')).toHaveLength(1)
  expect(returned.portals.filter(({ dimension }) => dimension === 'nether')).toHaveLength(1)
  expect(returned.activePortal?.anchor).toEqual({ x: 120, y: 65, z: 8 })
  expect(returned.activePortal?.interiorBlock).toBe(NETHER_PORTAL_BLOCK_ID)
  expect(returned.activePortal?.frameBlock).toBe(OBSIDIAN_BLOCK_ID)
  expect(faults.pageErrors).toEqual([])
  expect(faults.consoleErrors).toEqual([])
})
