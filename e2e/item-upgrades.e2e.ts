import { expect, test, type Page } from '@playwright/test'

import { startGameSession } from './helpers/session'

const QA_GLOBAL_KEY = '__NERIMA_GAMES_QA__'

type GameplaySnapshot = {
  readonly vitals: { readonly totalExperience: number }
  readonly inventory: {
    readonly slots: ReadonlyArray<{ readonly item: string; readonly count: number } | null>
    readonly durability: ReadonlyArray<{ readonly current: number; readonly max: number } | null>
  }
  readonly itemMetadata: {
    readonly customNames: Readonly<Record<string, string>>
    readonly enchantedItems: Readonly<Record<string, {
      readonly item: string
      readonly durability: { readonly current: number; readonly max: number } | null
      readonly enchantments: ReadonlyArray<{ readonly id: string; readonly level: number }>
    }>>
  }
}

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

const inventoryCount = (current: GameplaySnapshot, item: string): number =>
  current.inventory.slots.reduce(
    (total, stack) => total + (stack?.item === item ? stack.count : 0),
    0,
  )

const totalExperienceAtLevel = (level: number): number => {
  const normalized = Math.max(0, Math.floor(level))
  if (normalized <= 16) return normalized * normalized + 6 * normalized
  if (normalized <= 31) return 352 + ((normalized - 16) * (5 * normalized - 1)) / 2
  return 1507 + ((normalized - 31) * (9 * normalized - 46)) / 2
}

const openTargetedStation = async (page: Page): Promise<void> => {
  await page.evaluate(() => {
    const canvas = document.querySelector<HTMLCanvasElement>('#game-canvas')
    if (canvas === null) throw new Error('missing game canvas')
    Object.defineProperty(document, 'pointerLockElement', {
      configurable: true,
      get: () => canvas,
    })
    document.dispatchEvent(new Event('pointerlockchange'))
  })
  const canvas = page.locator('#game-canvas')
  await canvas.hover()
  await canvas.click({ button: 'right' })
}

test('enchants, repairs, renames, and persists an upgraded item', async ({ page }) => {
  test.setTimeout(120_000)
  const sessionId = `item-upgrades-${String(Date.now())}`
  await startGameSession(page, sessionId)
  await expect(page.locator('body')).toHaveAttribute('data-mc-compose-boot', 'running')
  const seeded = await callQa<GameplaySnapshot>(page, 'gameplay.seedItemUpgradeEncounter')
  expect(seeded.inventory.slots[0]).toEqual({ item: 'diamond_pickaxe', count: 1 })
  expect(inventoryCount(seeded, 'lapis_lazuli')).toBe(3)
  expect(inventoryCount(seeded, 'iron_ingot')).toBe(1)
  expect(seeded.itemMetadata.customNames).toEqual({})
  expect(seeded.itemMetadata.enchantedItems).toEqual({})
  expect(seeded.vitals.totalExperience).toBe(totalExperienceAtLevel(30))
  expect(seeded.inventory.durability[0]?.current).toBeLessThan(
    seeded.inventory.durability[0]?.max ?? 0,
  )

  await openTargetedStation(page)
  const enchanting = page.locator('[data-mx-ui="enchanting-table"]')
  await expect(enchanting).toBeVisible()
  await enchanting.locator('[data-operation-target="offer-1"]').click()
  await expect(page.locator('body')).toHaveAttribute('data-enchanting-result', /^Applied /)
  const enchanted = await snapshot(page)
  expect(enchanted.itemMetadata.enchantedItems['0']?.enchantments.length).toBeGreaterThan(0)
  expect(inventoryCount(enchanted, 'lapis_lazuli')).toBe(inventoryCount(seeded, 'lapis_lazuli') - 1)
  expect(enchanted.vitals.totalExperience).toBe(totalExperienceAtLevel(29))

  await callQa(page, 'gameplay.switchItemUpgradeStationToAnvil')
  await openTargetedStation(page)
  const anvil = page.locator('[data-mx-ui="anvil"]')
  await expect(anvil).toBeVisible()
  await anvil.locator('[data-operation-target="name"]').fill('Deep Delver')
  await anvil.locator('[data-operation-target="output"]').click()
  await expect(page.locator('body')).toHaveAttribute('data-anvil-result', 'Renamed to Deep Delver')

  const upgraded = await snapshot(page)
  expect(upgraded.itemMetadata.customNames['0']).toBe('Deep Delver')
  expect(upgraded.itemMetadata.enchantedItems['0']?.enchantments).toEqual(
    enchanted.itemMetadata.enchantedItems['0']?.enchantments,
  )
  expect(upgraded.inventory.durability[0]?.current).toBe(upgraded.inventory.durability[0]?.max)
  expect(upgraded.itemMetadata.enchantedItems['0']?.durability).toEqual(
    upgraded.inventory.durability[0],
  )
  expect(inventoryCount(upgraded, 'iron_ingot')).toBe(inventoryCount(enchanted, 'iron_ingot') - 1)
  expect(upgraded.vitals.totalExperience).toBe(totalExperienceAtLevel(28))

  await callQa(page, 'persistence.flush')
  await page.reload()
  await expect(page.locator('body')).toHaveAttribute('data-mc-compose-boot', 'running')
  const restored = await snapshot(page)
  expect(restored.itemMetadata.customNames['0']).toBe('Deep Delver')
  expect(restored.itemMetadata.enchantedItems['0']).toEqual(upgraded.itemMetadata.enchantedItems['0'])
  expect(restored.inventory.durability[0]).toEqual(upgraded.inventory.durability[0])
  expect(restored.inventory.slots).toEqual(upgraded.inventory.slots)
  expect(restored.vitals.totalExperience).toBe(upgraded.vitals.totalExperience)
})
