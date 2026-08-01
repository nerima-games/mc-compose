import { expect, test, type ConsoleMessage, type Page } from '@playwright/test'

import { startGameSession } from './helpers/session'

const QA_GLOBAL_KEY = '__NERIMA_GAMES_QA__'
const DATABASE_NAME = 'nerima-games-minecraft'
const AIR_BLOCK_ID = 0
const FARMLAND_BLOCK_ID = 49
const POTATO_CROP_BLOCK_ID = 72
const POTATO_MATURITY_SECS = 480

type InventorySlot = { readonly item: string; readonly count: number } | null
type CropState = {
  readonly dimension: string
  readonly position: { readonly x: number; readonly y: number; readonly z: number }
  readonly crop: 'potato_crop'
  readonly growthSecs: number
}
type GameplaySnapshot = {
  readonly vitals: {
    readonly hungerPoints: number
    readonly maxHungerPoints: number
  }
  readonly inventory: { readonly slots: ReadonlyArray<InventorySlot> }
  readonly itemUse: null | {
    readonly action?: 'HarvestPotato' | 'EatPotato' | 'PlantPotato'
    readonly success: boolean
  }
  readonly farming: {
    readonly soilBlock: number | null
    readonly cropBlock: number | null
    readonly crops: ReadonlyArray<CropState>
    readonly cropStage: 'empty' | 'growing' | 'mature'
  }
  readonly persistence: { readonly formatVersion: number }
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

const inventoryCount = (current: GameplaySnapshot, item: string): number =>
  current.inventory.slots.reduce(
    (total, slot) => total + (slot?.item === item ? slot.count : 0),
    0,
  )

const grantPointerLock = async (page: Page): Promise<void> => {
  await page.evaluate(() => {
    const gameCanvas = document.querySelector<HTMLCanvasElement>('#game-canvas')
    if (gameCanvas === null) throw new Error('missing game canvas')
    Object.defineProperty(document, 'pointerLockElement', {
      configurable: true,
      get: () => gameCanvas,
    })
    document.dispatchEvent(new Event('pointerlockchange'))
  })
}

const deleteSessionDatabase = async (page: Page): Promise<void> => {
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

test('matures, persists, harvests, eats, and replants potatoes', async ({ page }) => {
  const faults = watchForFaults(page)
  await deleteSessionDatabase(page)
  await startGameSession(page)
  await expect(page.locator('body')).toHaveAttribute('data-mc-compose-boot', 'running')

  const seeded = await callQa<GameplaySnapshot>(page, 'gameplay.seedFarmingEncounter')
  expect(seeded.farming).toMatchObject({
    soilBlock: FARMLAND_BLOCK_ID,
    cropBlock: POTATO_CROP_BLOCK_ID,
    cropStage: 'growing',
  })

  await expect.poll(async () => (await snapshot(page)).farming.cropStage).toBe('mature')
  const mature = await snapshot(page)
  expect(mature.farming.crops).toHaveLength(1)
  expect(mature.farming.crops[0]?.growthSecs).toBe(POTATO_MATURITY_SECS)

  await callQa(page, 'persistence.flush')
  await expect(page.locator('body')).toHaveAttribute('data-session-persistence', 'saved')
  await page.reload()
  await expect(page.locator('body')).toHaveAttribute('data-mc-compose-boot', 'running')
  const restored = await snapshot(page)
  expect(restored.persistence.formatVersion).toBe(13)
  expect(restored.farming.cropStage).toBe('mature')
  expect(restored.farming.crops[0]?.growthSecs).toBe(POTATO_MATURITY_SECS)

  const potatoesBeforeHarvest = inventoryCount(restored, 'potato')
  await callQa(page, 'gameplay.harvestFarmingCrop')
  await expect.poll(async () => {
    const current = await snapshot(page)
    return {
      action: current.itemUse?.action,
      cropBlock: current.farming.cropBlock,
      cropCount: current.farming.crops.length,
      potatoes: inventoryCount(current, 'potato'),
    }
  }).toMatchObject({
    action: 'HarvestPotato',
    cropBlock: AIR_BLOCK_ID,
    cropCount: 0,
  })
  const harvested = await snapshot(page)
  const harvestYield = inventoryCount(harvested, 'potato') - potatoesBeforeHarvest
  expect(harvestYield).toBeGreaterThanOrEqual(2)
  expect(harvestYield).toBeLessThanOrEqual(5)

  await callQa(page, 'gameplay.preparePotatoEating')
  await expect.poll(async () => (await snapshot(page)).vitals.hungerPoints).toBeLessThan(
    harvested.vitals.maxHungerPoints,
  )
  const hungry = await snapshot(page)
  const potatoesBeforeEating = inventoryCount(hungry, 'potato')
  await grantPointerLock(page)
  await page.locator('#game-canvas').click({ button: 'right' })
  await expect.poll(async () => {
    const current = await snapshot(page)
    return {
      action: current.itemUse?.action,
      hunger: current.vitals.hungerPoints,
      potatoes: inventoryCount(current, 'potato'),
    }
  }).toEqual({
    action: 'EatPotato',
    hunger: hungry.vitals.hungerPoints + 1,
    potatoes: potatoesBeforeEating - 1,
  })
  expect(inventoryCount(await snapshot(page), 'potato')).toBeGreaterThan(1)

  await callQa(page, 'gameplay.returnToFarmingPlot')
  const potatoesBeforePlanting = inventoryCount(await snapshot(page), 'potato')
  await page.locator('#game-canvas').click({ button: 'right' })
  await expect.poll(async () => {
    const current = await snapshot(page)
    return {
      action: current.itemUse?.action,
      cropBlock: current.farming.cropBlock,
      cropCount: current.farming.crops.length,
      potatoes: inventoryCount(current, 'potato'),
    }
  }).toEqual({
    action: 'PlantPotato',
    cropBlock: POTATO_CROP_BLOCK_ID,
    cropCount: 1,
    potatoes: potatoesBeforePlanting - 1,
  })

  expect(faults.pageErrors).toEqual([])
  expect(faults.consoleErrors).toEqual([])
})
