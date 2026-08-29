import {
  isDroppedItemBehaviour,
  type EnchantedItem,
} from '@nerima-games/mx-gameplay'

import { persistedItemDropMetadata } from './session-persistence'

export type DroppedItemMetadata = {
  readonly customName?: string
  readonly enchantedItem?: EnchantedItem
}

export const droppedItemMetadataFromBehaviour = (behaviour: unknown): DroppedItemMetadata => {
  if (!isDroppedItemBehaviour(behaviour)) return {}
  const metadata = persistedItemDropMetadata(behaviour)
  return {
    ...(metadata.customName === undefined ? {} : { customName: metadata.customName }),
    ...(metadata.enchantments === undefined
      ? {}
      : {
          enchantedItem: {
            item: behaviour.item,
            durability: behaviour.durability,
            enchantments: metadata.enchantments,
          },
        }),
  }
}
