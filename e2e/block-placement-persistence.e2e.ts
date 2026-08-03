import { expect, test, type Page } from '@playwright/test'

import { startGameSession } from './helpers/session'

const DATABASE_NAME = 'nerima-games-minecraft'
const SESSION_ID = 'block-placement-persistence-e2e'
const AIR_BLOCK_ID = 0
const STONE_BLOCK_ID = 2

type GameplaySnapshot = {
  readonly mode: 'survival' | 'creative'
  readonly inventory: {
    readonly slots: ReadonlyArray<{ readonly item: string; readonly count: number } | null>
  }
  readonly ignitionTarget: {
    readonly position: { readonly x: number; readonly y: number; readonly z: number }
    readonly block: number | null
  }
}

const callQa = <Result>(page: Page, command: string): Promise<Result> =>
  page.evaluate(async (commandName) => {
    const qa = (globalThis as unknown as Record<string, unknown>)['__NERIMA_GAMES_QA__'] as
      | Record<string, () => unknown>
      | undefined
    const operation = qa?.[commandName]
    if (operation === undefined) throw new Error(`missing QA command: ${commandName}`)
    return await operation()
  }, command) as Promise<Result>

const snapshot = (page: Page): Promise<GameplaySnapshot> =>
  callQa(page, 'gameplay.snapshot')

const inventoryCount = (current: GameplaySnapshot, item: string): number =>
  current.inventory.slots.reduce(
    (total, slot) => total + (slot?.item === item ? slot.count : 0),
    0,
  )

const clearDatabase = async (page: Page): Promise<void> => {
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

test('places one survival block atomically and restores it across reload', async ({ page }) => {
  await clearDatabase(page)
  await startGameSession(page, SESSION_ID)
  await expect(page.locator('body')).toHaveAttribute('data-mc-compose-boot', 'running')

  const seeded = await callQa<GameplaySnapshot>(page, 'gameplay.seedCreativePlacementEncounter')
  expect(seeded.mode).toBe('survival')
  expect(seeded.ignitionTarget.block).toBe(AIR_BLOCK_ID)
  expect(inventoryCount(seeded, 'stone')).toBe(2)

  const canvas = page.locator('#game-canvas')
  const placementsBefore = Number(await canvas.getAttribute('data-placements-requested'))
  await canvas.hover()
  await grantPointerLock(page)
  await canvas.click({ button: 'right' })

  await expect.poll(async () => {
    const current = await snapshot(page)
    return {
      requests: Number(await canvas.getAttribute('data-placements-requested')),
      block: current.ignitionTarget.block,
      stone: inventoryCount(current, 'stone'),
    }
  }).toEqual({
    requests: placementsBefore + 1,
    block: STONE_BLOCK_ID,
    stone: 1,
  })

  const placed = await snapshot(page)
  await callQa(page, 'persistence.flush')
  await page.reload()
  await expect(page.locator('body')).toHaveAttribute('data-mc-compose-boot', 'running')

  const restored = await snapshot(page)
  expect(restored.mode).toBe('survival')
  expect(restored.ignitionTarget).toMatchObject({
    position: placed.ignitionTarget.position,
    block: STONE_BLOCK_ID,
  })
  expect(inventoryCount(restored, 'stone')).toBe(1)
})
