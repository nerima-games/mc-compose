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
  itemMetadata: {
    customNames: Record<string, string>
    enchantedItems: Record<
      string,
      {
        item: string
        durability: { current: number; max: number } | null
        enchantments: Array<{ id: string; level: number }>
      }
    >
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
      const qa = (globalThis as unknown as Record<string, unknown>)['__NERIMA_GAMES_QA__'] as
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

  await expect.poll(async () => {
    const snapshot = await callQa<GameplaySnapshot>(page, 'gameplay.snapshot')
    return snapshot.inventory.slots.findIndex((slot) => slot?.item === 'oak_log')
  }, { timeout: 15_000 }).toBeGreaterThanOrEqual(0)

  snapshot = await callQa<GameplaySnapshot>(page, 'gameplay.snapshot')
  expect(snapshot.containerStorage.containers).toEqual([])
  const pickedUpSlot = snapshot.inventory.slots.findIndex((slot) => slot?.item === 'oak_log')
  expect(snapshot.inventory.slots[pickedUpSlot]).toEqual({ item: 'oak_log', count: 1 })
  expect(snapshot.inventory.durability[pickedUpSlot]).toBeNull()
})

test('moves chest item metadata without merging incompatible stacks', async ({ page }) => {
  await clearDatabase(page)
  await startGameSession(page, 'chest-item-metadata-e2e')
  await waitForGame(page)
  await callQa(page, 'gameplay.seedChestTransferMetadata')
  await callQa(page, 'gameplay.setPose', 105)

  await openTargetedChest(page)
  const chest = page.locator('[data-mx-ui="chest-storage"]')
  await chest.locator('[data-region="player-hotbar"] [data-interaction-slot="0"]').click()
  await chest.locator('[data-region="chest"] [data-interaction-slot="0"]').click()

  let snapshot = await callQa<GameplaySnapshot>(page, 'gameplay.snapshot')
  const containerId = snapshot.containerStorage.containers[0]?.id
  expect(containerId).toBeDefined()
  const containerKey = `container:${containerId}:0`
  expect(snapshot.itemMetadata.customNames['0']).toBeUndefined()
  expect(snapshot.itemMetadata.customNames[containerKey]).toBe('Silk Runner')
  expect(snapshot.itemMetadata.enchantedItems['0']).toBeUndefined()
  expect(snapshot.itemMetadata.enchantedItems[containerKey]).toMatchObject({
    item: 'diamond_pickaxe',
    enchantments: [{ id: 'efficiency', level: 5 }],
  })

  await chest.getByRole('button', { name: 'Close chest' }).click()
  await callQa(page, 'persistence.flush')
  await page.reload()
  await waitForGame(page)
  await openTargetedChest(page)

  snapshot = await callQa<GameplaySnapshot>(page, 'gameplay.snapshot')
  expect(snapshot.itemMetadata.customNames[containerKey]).toBe('Silk Runner')
  expect(snapshot.itemMetadata.enchantedItems[containerKey]).toMatchObject({
    item: 'diamond_pickaxe',
    enchantments: [{ id: 'efficiency', level: 5 }],
  })

  await callQa(page, 'gameplay.seedChestTransferMetadataConflict')
  await chest.locator('[data-region="chest"] [data-interaction-slot="0"]').click()
  await chest.locator('[data-region="player-hotbar"] [data-interaction-slot="0"]').click()
  await expect(chest.getByText('Destination contains different item metadata')).toBeVisible()

  snapshot = await callQa<GameplaySnapshot>(page, 'gameplay.snapshot')
  expect(snapshot.itemMetadata.customNames['0']).toBe('Fortune Runner')
  expect(snapshot.itemMetadata.customNames[containerKey]).toBe('Silk Runner')

  await chest.locator('[data-region="player-hotbar"] [data-interaction-slot="1"]').click()
  await expect(chest.getByText('Moved 1 diamond_pickaxe')).toBeVisible()

  snapshot = await callQa<GameplaySnapshot>(page, 'gameplay.snapshot')
  expect(snapshot.containerStorage.containers[0]?.slots[0]).toBeNull()
  expect(snapshot.itemMetadata.customNames[containerKey]).toBeUndefined()
  expect(snapshot.itemMetadata.customNames['0']).toBe('Fortune Runner')
  expect(snapshot.itemMetadata.customNames['1']).toBe('Silk Runner')
  expect(snapshot.itemMetadata.enchantedItems[containerKey]).toBeUndefined()
  expect(snapshot.itemMetadata.enchantedItems['0']).toMatchObject({
    enchantments: [{ id: 'fortune', level: 3 }],
  })
  expect(snapshot.itemMetadata.enchantedItems['1']).toMatchObject({
    enchantments: [{ id: 'efficiency', level: 5 }],
  })
})

test('retains chest item metadata through destruction, pickup, and reload', async ({ page }) => {
  await clearDatabase(page)
  await startGameSession(page, 'chest-dropped-item-metadata-e2e')
  await waitForGame(page)
  await callQa(page, 'gameplay.seedChestTransferMetadata')
  await callQa(page, 'gameplay.setPose', 105)

  await openTargetedChest(page)
  const chest = page.locator('[data-mx-ui="chest-storage"]')
  await chest.locator('[data-region="player-hotbar"] [data-interaction-slot="0"]').click()
  await chest.locator('[data-region="chest"] [data-interaction-slot="0"]').click()
  await chest.getByRole('button', { name: 'Close chest' }).click()
  await mineCurrentTarget(page)

  await expect.poll(async () => {
    const snapshot = await callQa<GameplaySnapshot>(page, 'gameplay.snapshot')
    return snapshot.inventory.slots.findIndex((slot) => slot?.item === 'diamond_pickaxe')
  }, { timeout: 15_000 }).toBeGreaterThanOrEqual(0)

  let snapshot = await callQa<GameplaySnapshot>(page, 'gameplay.snapshot')
  const pickedUpSlot = snapshot.inventory.slots
    .findIndex((slot) => slot?.item === 'diamond_pickaxe')
  expect(snapshot.containerStorage.containers).toEqual([])
  expect(snapshot.itemMetadata.customNames[String(pickedUpSlot)]).toBe('Silk Runner')
  expect(snapshot.itemMetadata.enchantedItems[String(pickedUpSlot)]).toMatchObject({
    item: 'diamond_pickaxe',
    enchantments: [{ id: 'efficiency', level: 5 }],
  })

  await callQa(page, 'persistence.flush')
  await page.reload()
  await waitForGame(page)
  snapshot = await callQa<GameplaySnapshot>(page, 'gameplay.snapshot')
  const restoredSlot = snapshot.inventory.slots
    .findIndex((slot) => slot?.item === 'diamond_pickaxe')
  expect(snapshot.itemMetadata.customNames[String(restoredSlot)]).toBe('Silk Runner')
  expect(snapshot.itemMetadata.enchantedItems[String(restoredSlot)]).toMatchObject({
    item: 'diamond_pickaxe',
    enchantments: [{ id: 'efficiency', level: 5 }],
  })
})

test('discards restored custom names without a backing stack', async ({ page }) => {
  await clearDatabase(page)
  await startGameSession(page, 'stale-custom-name-e2e')
  await waitForGame(page)
  await callQa(page, 'gameplay.seedStaleCustomNames')
  await callQa(page, 'persistence.flush')
  await page.reload()
  await waitForGame(page)

  const snapshot = await callQa<GameplaySnapshot>(page, 'gameplay.snapshot')
  expect(snapshot.itemMetadata.customNames['35']).toBeUndefined()
  expect(snapshot.itemMetadata.customNames['equipment:head']).toBeUndefined()
  expect(snapshot.itemMetadata.customNames['unknown:slot']).toBeUndefined()
})
