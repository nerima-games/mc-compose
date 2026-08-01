import { expect, test, type Page } from '@playwright/test'

import { startGameSession } from './helpers/session'

const QA_GLOBAL_KEY = '__NERIMA_GAMES_QA__'

type EquipmentEntry = {
  readonly item: string
  readonly durability: { readonly current: number; readonly max: number } | null
}

type Equipment = {
  readonly head: EquipmentEntry | null
  readonly chest: EquipmentEntry | null
  readonly legs: EquipmentEntry | null
  readonly feet: EquipmentEntry | null
  readonly offhand: EquipmentEntry | null
}

type GameplaySnapshot = {
  readonly vitals: { readonly healthPoints: number }
  readonly inventory: { readonly equipment: Equipment }
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

const equipmentItems = (equipment: Equipment): Record<keyof Equipment, string | null> => ({
  head: equipment.head?.item ?? null,
  chest: equipment.chest?.item ?? null,
  legs: equipment.legs?.item ?? null,
  feet: equipment.feet?.item ?? null,
  offhand: equipment.offhand?.item ?? null,
})

test('equips armour and offhand, rejects invalid gear, persists, and applies armour', async ({
  page,
}) => {
  await startGameSession(page, 'equipment-ui')
  const body = page.locator('body')
  const inventory = page.locator('#inventory-root')
  await expect(body).toHaveAttribute('data-mc-compose-boot', 'running')
  await callQa(page, 'gameplay.seedIronArmor')

  await page.keyboard.press('KeyE')
  await expect(inventory).toBeVisible()
  const armour = inventory.locator('[data-region="armour"] [data-mx-ui="slot"]')
  const offhand = inventory.locator('[data-region="offhand"] [data-mx-ui="slot"]')
  const hotbar = inventory.locator('[data-region="hotbar"] [data-mx-ui="slot"]')
  await expect(armour).toHaveCount(4)
  await expect(offhand).toHaveCount(1)

  for (let index = 0; index < 4; index += 1) await armour.nth(index).click()
  await expect.poll(async () => equipmentItems((await snapshot(page)).inventory.equipment))
    .toEqual({ head: null, chest: null, legs: null, feet: null, offhand: null })

  await hotbar.nth(1).dragTo(armour.nth(1))
  await expect(body).toHaveAttribute('data-equipment-action', /rejected:.*cannot be equipped/i)
  expect(equipmentItems((await snapshot(page)).inventory.equipment).chest).toBeNull()

  await hotbar.nth(1).dragTo(armour.nth(0))
  await hotbar.nth(2).click({ modifiers: ['Shift'] })
  await hotbar.nth(3).dragTo(armour.nth(2))
  await hotbar.nth(4).click({ modifiers: ['Shift'] })
  await hotbar.nth(0).dragTo(offhand)
  await expect(body).toHaveAttribute('data-equipment-action', 'accepted')

  const expectedItems = {
    head: 'iron_helmet',
    chest: 'iron_chestplate',
    legs: 'iron_leggings',
    feet: 'iron_boots',
    offhand: 'iron_sword',
  }
  await expect.poll(async () => equipmentItems((await snapshot(page)).inventory.equipment))
    .toEqual(expectedItems)
  await expect(body).toHaveAttribute('data-session-persistence', /dirty|saved/)

  await callQa(page, 'persistence.flush')
  await expect(body).toHaveAttribute('data-session-persistence', 'saved')
  const savedEquipment = (await snapshot(page)).inventory.equipment
  await page.reload()
  await expect(body).toHaveAttribute('data-mc-compose-boot', 'running')
  const restoredEquipment = (await snapshot(page)).inventory.equipment
  expect(equipmentItems(restoredEquipment)).toEqual(expectedItems)
  expect(restoredEquipment).toEqual(savedEquipment)

  await callQa(page, 'gameplay.seedZombiePursuitEncounter')
  const armoredStart = await snapshot(page)
  await expect.poll(async () => (await snapshot(page)).vitals.healthPoints, { timeout: 10_000 })
    .toBeLessThan(armoredStart.vitals.healthPoints)
  const armoredHit = await snapshot(page)
  expect(armoredStart.vitals.healthPoints - armoredHit.vitals.healthPoints).toBeCloseTo(0.48, 5)
  for (const slot of ['head', 'chest', 'legs', 'feet'] as const) {
    expect(armoredHit.inventory.equipment[slot]!.durability!.current)
      .toBeLessThan(armoredStart.inventory.equipment[slot]!.durability!.current)
  }

  await page.keyboard.press('KeyE')
  await expect(inventory).toBeVisible()
  for (let index = 0; index < 4; index += 1) await armour.nth(index).click()
  await expect.poll(async () => equipmentItems((await snapshot(page)).inventory.equipment))
    .toEqual({ ...expectedItems, head: null, chest: null, legs: null, feet: null })
  const unarmoredStart = await snapshot(page)
  await expect.poll(async () => (await snapshot(page)).vitals.healthPoints, { timeout: 10_000 })
    .toBeLessThan(unarmoredStart.vitals.healthPoints)
  const unarmoredHit = await snapshot(page)
  expect(unarmoredStart.vitals.healthPoints - unarmoredHit.vitals.healthPoints)
    .toBeGreaterThan(armoredStart.vitals.healthPoints - armoredHit.vitals.healthPoints)
})
