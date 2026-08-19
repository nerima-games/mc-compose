import { describe, expect, it } from 'vitest'

import type { EnchantedItem } from '@nerima-games/mx-gameplay'

import { createItemMetadataStore } from '../apps/web/item-metadata-store'

const enchantedItem: EnchantedItem = {
  item: 'diamond_sword',
  durability: { current: 1561, max: 1561 },
  enchantments: [{ id: 'sharpness', level: 5 }],
}

describe('item metadata store', () => {
  it('builds stable keys and parses container locations', () => {
    const store = createItemMetadataStore()

    expect(store.droppedItemMetadataKey('nether', 'drop-1')).toBe('nether:drop-1')
    expect(store.equipmentMetadataKey('head')).toBe('equipment:head')
    expect(store.containerMetadataKey('chest-1', 3)).toBe('container:chest-1:3')
    expect(store.containerMetadataLocation('container:chest-1:3')).toEqual({
      containerId: 'chest-1',
      slot: 3,
    })
    expect(store.containerMetadataLocation('container:chest-1:-1')).toBeUndefined()
    expect(store.containerMetadataLocation('container:chest-1:bad')).toBeUndefined()
  })

  it('copies and compares both metadata fields', () => {
    const store = createItemMetadataStore()
    store.customNames.set('source', 'Swift')
    store.enchantedItems.set('source', enchantedItem)

    store.copyItemMetadata('source', 'target')

    expect(store.sameItemMetadata('source', 'target')).toBe(true)
    expect(store.customNames.get('target')).toBe('Swift')
    expect(store.enchantedItems.get('target')).toEqual(enchantedItem)
  })

  it('clears stale target fields when copying unannotated metadata', () => {
    const store = createItemMetadataStore()
    store.customNames.set('target', 'stale')
    store.enchantedItems.set('target', enchantedItem)

    store.copyItemMetadata('source', 'target')

    expect(store.sameItemMetadata('source', 'target')).toBe(true)
    expect(store.customNames.has('target')).toBe(false)
    expect(store.enchantedItems.has('target')).toBe(false)
  })

  it('moves metadata and removes the source', () => {
    const store = createItemMetadataStore()
    store.customNames.set('source', 'Swift')
    store.enchantedItems.set('source', enchantedItem)

    store.moveItemMetadata('source', 'target')

    expect(store.sameItemMetadata('target', 'source')).toBe(false)
    expect(store.customNames.get('target')).toBe('Swift')
    expect(store.customNames.has('source')).toBe(false)
    expect(store.enchantedItems.has('source')).toBe(false)
  })

  it('deletes item metadata without affecting dropped item metadata', () => {
    const store = createItemMetadataStore()
    store.customNames.set('item', 'Swift')
    store.enchantedItems.set('item', enchantedItem)
    store.droppedItemMetadata.set('overworld:drop-1', { customName: 'Drop' })

    store.deleteItemMetadata('item')

    expect(store.sameItemMetadata('item', 'missing')).toBe(true)
    expect(store.droppedItemMetadata.get('overworld:drop-1')).toEqual({ customName: 'Drop' })
  })

  it('deletes metadata for one container only', () => {
    const store = createItemMetadataStore()
    store.customNames.set('container:chest-1:0', 'One')
    store.enchantedItems.set('container:chest-1:1', enchantedItem)
    store.customNames.set('container:chest-2:0', 'Two')

    store.deleteContainerMetadata('chest-1')

    expect(store.customNames.has('container:chest-1:0')).toBe(false)
    expect(store.enchantedItems.has('container:chest-1:1')).toBe(false)
    expect(store.customNames.get('container:chest-2:0')).toBe('Two')
  })
})
