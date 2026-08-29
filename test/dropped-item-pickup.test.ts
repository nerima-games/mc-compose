import { describe, expect, it } from 'vitest'

import { droppedItemMetadataFromBehaviour } from '../apps/web/dropped-item-metadata'
import { isDroppedItemPickupEligible } from '../apps/web/dropped-item-pickup'

describe('isDroppedItemPickupEligible', () => {
  it('allows drops without a deferred pickup frame', () => {
    expect(isDroppedItemPickupEligible(0, undefined)).toBe(true)
  })

  it('keeps a drop unavailable before its eligibility frame', () => {
    expect(isDroppedItemPickupEligible(7, 8)).toBe(false)
  })

  it('allows a drop at and after its eligibility frame', () => {
    expect(isDroppedItemPickupEligible(8, 8)).toBe(true)
    expect(isDroppedItemPickupEligible(9, 8)).toBe(true)
  })
})

describe('droppedItemMetadataFromBehaviour', () => {
  it('rejects non-dropped behaviours', () => {
    expect(droppedItemMetadataFromBehaviour({ _tag: 'Other' })).toEqual({})
  })

  it('restores a dropped item custom name without enchantments', () => {
    expect(droppedItemMetadataFromBehaviour({
      _tag: 'DroppedItem',
      item: 'stone',
      count: 2,
      durability: null,
      customName: 'Named Stone',
    })).toEqual({ customName: 'Named Stone' })
  })

  it('restores an enchanted damageable dropped item', () => {
    expect(droppedItemMetadataFromBehaviour({
      _tag: 'DroppedItem',
      item: 'diamond_pickaxe',
      count: 1,
      durability: { current: 1500, max: 1561 },
      enchantments: [{ id: 'efficiency', level: 5 }],
    })).toEqual({
      enchantedItem: {
        item: 'diamond_pickaxe',
        durability: { current: 1500, max: 1561 },
        enchantments: [{ id: 'efficiency', level: 5 }],
      },
    })
  })

  it('omits malformed metadata', () => {
    expect(droppedItemMetadataFromBehaviour({
      _tag: 'DroppedItem',
      item: 'stone',
      count: 2,
      durability: null,
      customName: ' ',
      enchantments: [{ id: 'fortune', level: 99 }],
    })).toEqual({})
  })
})
