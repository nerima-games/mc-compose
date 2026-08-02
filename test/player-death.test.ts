import { describe, expect, it } from '@effect/vitest'

import {
  emptyPlayerStorage,
  equipmentItem,
  itemStack,
  type PlayerStorage,
} from '@nerima-games/mc-sim'

import { deathDropsFromPlayerStorage } from '../apps/web/player-death'

describe('deathDropsFromPlayerStorage', () => {
  it('converts all inventory and equipped items into drops with durability preserved', () => {
    const empty = emptyPlayerStorage()
    const inventorySlots = [...empty.inventory.slots]
    inventorySlots[0] = itemStack('stone', 12)
    inventorySlots[7] = itemStack('diamond_pickaxe', 1)

    const storage: PlayerStorage = {
      inventory: { slots: inventorySlots },
      inventoryDurability: empty.inventoryDurability.map((_, index) =>
        index === 7 ? { current: 733, max: 1561 } : null
      ),
      equipment: {
        slots: {
          head: equipmentItem(itemStack('iron_helmet', 1), { current: 120, max: 165 }),
          chest: equipmentItem(itemStack('iron_chestplate', 1), { current: 201, max: 240 }),
          legs: equipmentItem(itemStack('iron_leggings', 1), { current: 180, max: 225 }),
          feet: equipmentItem(itemStack('iron_boots', 1), { current: 99, max: 195 }),
          offhand: equipmentItem(itemStack('iron_sword', 1), { current: 140, max: 250 }),
        },
      },
    }
    const at = { x: 4.5, y: 65, z: -2.25 }

    const drops = deathDropsFromPlayerStorage(storage, at)

    expect(drops).toStrictEqual([
      { item: 'stone', count: 12, at, durability: null },
      { item: 'diamond_pickaxe', count: 1, at, durability: { current: 733, max: 1561 } },
      { item: 'iron_helmet', count: 1, at, durability: { current: 120, max: 165 } },
      { item: 'iron_chestplate', count: 1, at, durability: { current: 201, max: 240 } },
      { item: 'iron_leggings', count: 1, at, durability: { current: 180, max: 225 } },
      { item: 'iron_boots', count: 1, at, durability: { current: 99, max: 195 } },
      { item: 'iron_sword', count: 1, at, durability: { current: 140, max: 250 } },
    ])
    expect(storage.inventoryDurability[7]).toStrictEqual({ current: 733, max: 1561 })
  })

  it('ignores empty inventory and equipment slots', () => {
    expect(deathDropsFromPlayerStorage(emptyPlayerStorage(), { x: 0, y: 64, z: 0 }))
      .toStrictEqual([])
  })
})
