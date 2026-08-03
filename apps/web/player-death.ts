import { EQUIPMENT_SLOTS, type PlayerStorage } from '@nerima-games/mc-sim'
import type { DroppedItemSpawn, Enchantment, EnchantedItem } from '@nerima-games/mx-gameplay'

export type DeathDropMetadata = {
  readonly customName?: string
  readonly enchantments?: ReadonlyArray<Enchantment>
}

export type DeathDropSpawn = DroppedItemSpawn & DeathDropMetadata

export type PlayerSlotMetadata = {
  readonly customNames: Readonly<Record<string, string>>
  readonly enchantedItems: Readonly<Record<string, EnchantedItem>>
}

const metadataForSlot = (
  key: string,
  item: DroppedItemSpawn['item'],
  metadata: PlayerSlotMetadata | undefined,
): DeathDropMetadata => {
  if (metadata === undefined) return {}
  const customName = metadata.customNames[key]
  const enchantedItem = metadata.enchantedItems[key]
  const enchantments = enchantedItem?.item === item
    ? enchantedItem.enchantments.map((enchantment) => ({ ...enchantment }))
    : undefined
  return {
    ...(customName === undefined ? {} : { customName }),
    ...(enchantments === undefined ? {} : { enchantments }),
  }
}

export const deathDropsFromPlayerStorage = (
  storage: PlayerStorage,
  at: DroppedItemSpawn['at'],
  metadata?: PlayerSlotMetadata,
): Array<DeathDropSpawn> => {
  const drops: Array<DeathDropSpawn> = []

  storage.inventory.slots.forEach((stack, index) => {
    if (stack === undefined) return
    const durability = storage.inventoryDurability[index] ?? null
    drops.push({
      ...stack,
      at,
      durability: durability === null ? null : { ...durability },
      ...metadataForSlot(String(index), stack.item, metadata),
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
      ...metadataForSlot(`equipment:${slot}`, stack.item, metadata),
    })
  })

  return drops
}
