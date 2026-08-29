import type { Dimension } from '@nerima-games/mc-worldgen'
import type { EnchantedItem } from '@nerima-games/mx-gameplay'
import type { EquipmentSlotId } from '@nerima-games/mx-ui'

import type { DroppedItemMetadata } from './dropped-item-metadata'

export type ItemMetadataStore = {
  readonly customNames: Map<string, string>
  readonly enchantedItems: Map<string, EnchantedItem>
  readonly droppedItemMetadata: Map<string, DroppedItemMetadata>
  readonly droppedItemMetadataKey: (dimension: Dimension, entityId: string) => string
  readonly equipmentMetadataKey: (slot: EquipmentSlotId) => string
  readonly containerMetadataKey: (containerId: string, slot: number) => string
  readonly containerMetadataLocation: (
    key: string,
  ) => { readonly containerId: string; readonly slot: number } | undefined
  readonly sameItemMetadata: (left: string, right: string) => boolean
  readonly copyItemMetadata: (source: string, target: string) => void
  readonly deleteItemMetadata: (key: string) => void
  readonly deleteContainerMetadata: (containerId: string) => void
  readonly moveItemMetadata: (source: string, target: string) => void
}

export const createItemMetadataStore = (): ItemMetadataStore => {
  const customNames = new Map<string, string>()
  const enchantedItems = new Map<string, EnchantedItem>()
  const droppedItemMetadata = new Map<string, DroppedItemMetadata>()
  const droppedItemMetadataKey = (dimension: Dimension, entityId: string): string =>
    `${dimension}:${entityId}`
  const equipmentMetadataKey = (slot: EquipmentSlotId): string => `equipment:${slot}`
  const containerMetadataKey = (containerId: string, slot: number): string =>
    `container:${containerId}:${String(slot)}`
  const containerMetadataLocation = (
    key: string,
  ): { readonly containerId: string; readonly slot: number } | undefined => {
    if (!key.startsWith('container:')) return undefined
    const separator = key.lastIndexOf(':')
    const slot = Number(key.slice(separator + 1))
    if (separator <= 'container:'.length || !Number.isInteger(slot) || slot < 0) return undefined
    return { containerId: key.slice('container:'.length, separator), slot }
  }
  const sameItemMetadata = (left: string, right: string): boolean =>
    customNames.get(left) === customNames.get(right)
    && JSON.stringify(enchantedItems.get(left) ?? null)
      === JSON.stringify(enchantedItems.get(right) ?? null)
  const copyItemMetadata = (source: string, target: string): void => {
    const enchantedItem = enchantedItems.get(source)
    const customName = customNames.get(source)
    if (enchantedItem === undefined) enchantedItems.delete(target)
    else enchantedItems.set(target, enchantedItem)
    if (customName === undefined) customNames.delete(target)
    else customNames.set(target, customName)
  }
  const deleteItemMetadata = (key: string): void => {
    enchantedItems.delete(key)
    customNames.delete(key)
  }
  const deleteContainerMetadata = (containerId: string): void => {
    const prefix = `container:${containerId}:`
    for (const key of [...customNames.keys(), ...enchantedItems.keys()]) {
      if (key.startsWith(prefix)) deleteItemMetadata(key)
    }
  }
  const moveItemMetadata = (source: string, target: string): void => {
    copyItemMetadata(source, target)
    deleteItemMetadata(source)
  }

  return {
    customNames,
    enchantedItems,
    droppedItemMetadata,
    droppedItemMetadataKey,
    equipmentMetadataKey,
    containerMetadataKey,
    containerMetadataLocation,
    sameItemMetadata,
    copyItemMetadata,
    deleteItemMetadata,
    deleteContainerMetadata,
    moveItemMetadata,
  }
}
