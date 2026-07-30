import { expect, test, type Page } from '@playwright/test'

import { startGameSession } from './helpers/session'

const DATABASE_NAME = 'nerima-games-minecraft'

type StoredStack = {
  item: string
  count: number
  durability: { current: number; max: number } | null
}

type GameplaySnapshot = {
  target: { block: number }
  inventory: {
    slots: Array<{ item: string; count: number } | null>
    durability: Array<{ current: number; max: number } | null>
  }
  containerStorage: {
    containers: Array<{
      id: string
      slots: Array<StoredStack | null>
    }>
  }
  entities: Array<{
    item?: string
    count?: number
    durability?: { current: number; max: number } | null
  }>
}

const callQa = async <Result>(
  page: Page,
  command: string,
  ...arguments_: unknown[]
): Promise<Result> =>
  page.evaluate(
    ({ command: commandName, arguments: commandArguments }) => {
      const qa = (globalThis as unknown as Record<string, unknown>).__NERIMA_GAMES_QA__ as
        | Record<string, (...values: unknown[]) => unknown>
        | undefined
      const operation = qa?.[commandName]
      if (operation === undefined) throw new Error(`missing QA command: ${commandName}`)
      return operation(...commandArguments) as Result
    },
    { command, arguments: arguments_ },
  )

const clearDatabase = async (page: Page): Promise<void> => {
  await page.goto('/@vite/client')
  await page.evaluate(
    (databaseName) =>
      new Promise<void>((resolve, reject) => {
        const request = indexedDB.deleteDatabase(databaseName)
        request.onsuccess = () => resolve()
        request.onerror = () => reject(request.error)
        request.onblocked = () => reject(new Error(`Database ${databaseName} deletion was blocked`))
      }),
    DATABASE_NAME,
  )
}

const grantPointerLock = async (page: Page): Promise<void> => {
  await page.evaluate(() => {
    const gameCanvas = document.querySelector('#game-canvas')
    if (gameCanvas === null) {
      throw new Error('Game canvas is unavailable')
    }
    Object.defineProperty(document, 'pointerLockElement', {
      configurable: true,
      get: () => gameCanvas,
    })
    document.dispatchEvent(new Event('pointerlockchange'))
  })
}

const openTargetedChest = async (page: Page): Promise<void> => {
  const canvas = page.locator('#game-canvas')
  await canvas.hover()
  await grantPointerLock(page)
  await canvas.click({ button: 'right' })
  await expect(page.locator('[data-mx-ui="chest-storage"]')).toBeVisible()
}

const mineCurrentTarget = async (page: Page): Promise<void> => {
  const canvas = page.locator('#game-canvas')
  const requestedBefore = Number(await canvas.getAttribute('data-breaks-requested'))
  await canvas.hover()
  await grantPointerLock(page)
  await page.mouse.down({ button: 'left' })
  try {
    await expect(canvas).toHaveAttribute(
      'data-breaks-requested',
      String(requestedBefore + 1),
      { timeout: 15_000 },
    )
  } finally {
    await page.mouse.up({ button: 'left' })
  }
}

const waitForGame = async (page: Page): Promise<void> => {
  await expect(page.locator('body')).toHaveAttribute('data-mc-compose-boot', 'running')
  await expect(page.locator('[data-mx-ui="hotbar"] [data-mx-ui="slot"]')).toHaveCount(9)
}

test('moves, persists, and spills chest contents', async ({ page }) => {
  await clearDatabase(page)
  await startGameSession(page, 'chest-storage-e2e')
  await waitForGame(page)
  await callQa(page, 'gameplay.seedCraftingLog')
  await callQa(page, 'gameplay.setPose', 105)

  await openTargetedChest(page)
  const chest = page.locator('[data-mx-ui="chest-storage"]')
  await chest
    .locator('[data-region="player-hotbar"] [data-interaction-slot="0"]')
    .click()
  await chest.locator('[data-region="chest"] [data-interaction-slot="0"]').click()

  await expect(chest.getByText('Moved 1 oak_log')).toBeVisible()
  let snapshot = await callQa<GameplaySnapshot>(page, 'gameplay.snapshot')
  expect(snapshot.containerStorage.containers).toHaveLength(1)
  expect(snapshot.containerStorage.containers[0]?.id).toMatch(/^overworld:/)
  expect(snapshot.containerStorage.containers[0]?.slots[0]).toEqual({
    item: 'oak_log',
    count: 1,
    durability: null,
  })

  await chest.getByRole('button', { name: 'Close chest' }).click()
  await callQa(page, 'persistence.flush')
  await page.reload()
  await waitForGame(page)

  await openTargetedChest(page)
  await expect(
    page.locator(
      '[data-region="chest"] [data-interaction-slot="0"][aria-label*="oak_log"]',
    ),
  ).toBeVisible()
  snapshot = await callQa<GameplaySnapshot>(page, 'gameplay.snapshot')
  expect(snapshot.containerStorage.containers[0]?.slots[0]).toEqual({
    item: 'oak_log',
    count: 1,
    durability: null,
  })

  await page.getByRole('button', { name: 'Close chest' }).click()
  await mineCurrentTarget(page)
  await expect
    .poll(async () => (await callQa<GameplaySnapshot>(page, 'gameplay.snapshot')).target.block, {
      timeout: 15_000,
    })
    .toBe(0)

  snapshot = await callQa<GameplaySnapshot>(page, 'gameplay.snapshot')
  expect(snapshot.containerStorage.containers).toEqual([])
  const dropped = snapshot.entities
    .filter((entity) => entity.item === 'oak_log')
    .map(({ item, count, durability }) => ({ item, count, durability }))
  const collected = snapshot.inventory.slots.flatMap((slot, index) =>
    slot?.item === 'oak_log'
      ? [{ ...slot, durability: snapshot.inventory.durability[index] ?? null }]
      : [],
  )
  expect([...dropped, ...collected]).toEqual([
    { item: 'oak_log', count: 1, durability: null },
  ])
})
