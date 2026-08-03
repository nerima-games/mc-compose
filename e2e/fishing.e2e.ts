import { expect, test, type ConsoleMessage, type Page } from '@playwright/test'

import { startGameSession } from './helpers/session'

const QA_GLOBAL_KEY = '__NERIMA_GAMES_QA__'

type InventorySlot = { readonly item: string; readonly count: number } | null
type Durability = { readonly current: number; readonly maximum: number } | null
type GameplaySnapshot = {
  readonly inventory: {
    readonly slots: ReadonlyArray<InventorySlot>
    readonly durability: ReadonlyArray<Durability>
  }
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

test('catches fishing loot and consumes rod durability during the bite window', async ({ page }) => {
  const consoleErrors: Array<string> = []
  const pageErrors: Array<string> = []
  page.on('console', (message: ConsoleMessage) => {
    if (message.type() === 'error') consoleErrors.push(message.text())
  })
  page.on('pageerror', (error: Error) => pageErrors.push(`${error.name}: ${error.message}`))

  await startGameSession(page, 'fishing-e2e')
  await expect(page.locator('body')).toHaveAttribute('data-mc-compose-boot', 'running')

  const seeded = await callQa<GameplaySnapshot>(page, 'gameplay.seedFishingEncounter')
  const rodSlot = seeded.inventory.slots.findIndex((slot) => slot?.item === 'fishing_rod')
  if (rodSlot < 0) throw new Error('seeded fishing encounter has no fishing rod')
  const durabilityBefore = seeded.inventory.durability[rodSlot]
  if (durabilityBefore === null || durabilityBefore === undefined) {
    throw new Error('seeded fishing rod has no durability')
  }

  await grantPointerLock(page)
  const canvas = page.locator('#game-canvas')
  await canvas.click({ button: 'right' })
  await expect(page.locator('body')).toHaveAttribute('data-fishing-phase', 'waiting')

  await expect(page.locator('body')).toHaveAttribute('data-fishing-phase', 'bite', {
    timeout: 15_000,
  })
  await canvas.click({ button: 'right' })
  await expect(page.locator('body')).toHaveAttribute('data-fishing-result', /^caught-/)
  await expect(page.locator('body')).toHaveAttribute('data-fishing-phase', 'idle')

  const caughtItem = (await page.locator('body').getAttribute('data-fishing-result'))?.replace(
    'caught-',
    '',
  )
  expect(caughtItem).toBeTruthy()

  const caught = await callQa<GameplaySnapshot>(page, 'gameplay.snapshot')
  expect(caught.inventory.slots.some((slot) => slot !== null && slot.item === caughtItem && slot.count === 1)).toBe(true)
  expect(caught.inventory.durability[rodSlot]?.current).toBe(durabilityBefore.current - 1)
  expect(consoleErrors).toEqual([])
  expect(pageErrors).toEqual([])
})
