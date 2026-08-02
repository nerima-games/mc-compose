import { EQUIPMENT_SLOTS, type PlayerStorage } from '@nerima-games/mc-sim'
import type { DroppedItemSpawn } from '@nerima-games/mx-gameplay'

export const deathDropsFromPlayerStorage = (
  storage: PlayerStorage,
  at: DroppedItemSpawn['at'],
): Array<DroppedItemSpawn> => {
  const drops: Array<DroppedItemSpawn> = []

  storage.inventory.slots.forEach((stack, index) => {
    if (stack === undefined) return
    const durability = storage.inventoryDurability[index] ?? null
    drops.push({
      ...stack,
      at,
      durability: durability === null ? null : { ...durability },
    })
  })

  EQUIPMENT_SLOTS.forEach((slot) => {
    const stack = storage.equipment.slots[slot]
    if (stack === null) return
    drops.push({
      item: stack.item,
      count: stack.count,
      at,
      durability: stack.durability === null ? null : { ...stack.durability },
    })
  })

  return drops
}
