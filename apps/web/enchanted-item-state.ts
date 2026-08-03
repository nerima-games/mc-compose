import type { Durability, ItemStack } from '@nerima-games/mc-sim'
import {
  decodeEnchantedItemSnapshot,
  snapshotEnchantedItem,
  type EnchantedItem,
} from '@nerima-games/mx-gameplay'

export const projectEnchantedItem = (
  stack: ItemStack | undefined,
  durability: Durability | null | undefined,
  saved: EnchantedItem | undefined,
): EnchantedItem | null => {
  if (stack === undefined) return null

  const projected = snapshotEnchantedItem({
    item: stack.item,
    durability: durability ?? null,
    enchantments: saved?.item === stack.item ? saved.enchantments : [],
  })
  return projected.ok ? projected.value : null
}

export const decodeProjectedEnchantedItem = (
  encoded: string,
  stack: ItemStack | undefined,
  durability: Durability | null | undefined,
): EnchantedItem | null => {
  const decoded = decodeEnchantedItemSnapshot(encoded)
  if (!decoded.ok || decoded.value.item !== stack?.item) return null
  return projectEnchantedItem(stack, durability, decoded.value)
}
