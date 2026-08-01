import { expect, test, type Page } from '@playwright/test'

import { startGameSession } from './helpers/session'

const QA_GLOBAL_KEY = '__NERIMA_GAMES_QA__'

type InventorySlot = null | { readonly item: string; readonly count: number }
type Offer = {
  readonly id: string
  readonly input: { readonly item: string; readonly count: number }
  readonly output: { readonly item: string; readonly count: number }
  readonly uses: number
}
type Snapshot = {
  readonly inventory: { readonly slots: ReadonlyArray<InventorySlot> }
  readonly villagerUi: {
    readonly open: boolean
    readonly activeVillagerId: string | null
    readonly status: string
  }
  readonly villagers: ReadonlyArray<{ readonly id: string }>
  readonly villagerTrades: {
    readonly villagers: ReadonlyArray<{
      readonly id: string
      readonly profession: 'farmer' | 'toolsmith'
      readonly offers: ReadonlyArray<Offer>
    }>
  }
}

const callQa = <A>(page: Page, command: string): Promise<A> =>
  page.evaluate(async ({ key, commandName }) => {
    const qa = (globalThis as unknown as Record<string, unknown>)[key] as
      | Record<string, () => unknown>
      | undefined
    const operation = qa?.[commandName]
    if (operation === undefined) throw new Error(`missing QA command: ${commandName}`)
    return await operation()
  }, { key: QA_GLOBAL_KEY, commandName: command }) as Promise<A>

const snapshot = (page: Page): Promise<Snapshot> => callQa(page, 'gameplay.snapshot')

const inventoryCount = (current: Snapshot, item: string): number =>
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

test('trades with a generated village resident and persists its stable state', async ({ page }) => {
  await startGameSession(page, `villager-${crypto.randomUUID()}`)
  await expect(page.locator('body')).toHaveAttribute('data-mc-compose-boot', 'running')

  const seeded = await callQa<Snapshot>(page, 'gameplay.seedVillageTradingEncounter')
  expect(seeded.villagers.length).toBeGreaterThan(0)
  expect(new Set(seeded.villagers.map(({ id }) => id)).size).toBe(seeded.villagers.length)
  expect(seeded.villagers[0]?.id).toMatch(/^village:/)

  await grantPointerLock(page)
  await page.locator('#game-canvas').click({ button: 'right' })
  await expect(page.locator('#trade-root')).toBeVisible()
  const opened = await snapshot(page)
  const villagerId = opened.villagerUi.activeVillagerId
  expect(villagerId).not.toBeNull()
  const offer = opened.villagerTrades.villagers
    .find(({ id }) => id === villagerId)?.offers[0]
  expect(offer).toBeDefined()

  await page.locator(`[data-trade-offer-id="${offer!.id}"]`).click()
  await expect.poll(async () => (await snapshot(page)).villagerUi.status)
    .toBe('You do not have the required items')
  expect(inventoryCount(await snapshot(page), offer!.output.item)).toBe(0)

  await callQa(page, 'gameplay.grantNearestVillagerTradeInput')
  expect(inventoryCount(await snapshot(page), offer!.input.item)).toBe(offer!.input.count)
  await page.locator(`[data-trade-offer-id="${offer!.id}"]`).click()
  await expect.poll(async () => (await snapshot(page)).villagerUi.status).toBe('Trade complete')
  const traded = await snapshot(page)
  expect(inventoryCount(traded, offer!.input.item)).toBe(0)
  expect(inventoryCount(traded, offer!.output.item)).toBe(offer!.output.count)
  expect(traded.villagerTrades.villagers
    .find(({ id }) => id === villagerId)?.offers[0]?.uses).toBe(1)

  await callQa(page, 'persistence.flush')
  await page.reload()
  await expect(page.locator('body')).toHaveAttribute('data-mc-compose-boot', 'running')
  const restored = await snapshot(page)
  expect(restored.villagers.filter(({ id }) => id === villagerId)).toHaveLength(1)
  expect(restored.villagerTrades.villagers
    .find(({ id }) => id === villagerId)?.offers[0]?.uses).toBe(1)
})
