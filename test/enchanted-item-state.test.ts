import { describe, expect, it } from 'vitest'
import { itemStack } from '@nerima-games/mc-sim'

import {
  decodeProjectedEnchantedItem,
  projectEnchantedItem,
} from '../apps/web/enchanted-item-state'

describe('enchanted item state', () => {
  it('uses authoritative durability for a damageable item', () => {
    expect(projectEnchantedItem(
      itemStack('diamond_pickaxe', 1),
      { current: 1400, max: 1561 },
      {
        item: 'diamond_pickaxe',
        durability: { current: 1500, max: 1561 },
        enchantments: [{ id: 'efficiency', level: 3 }],
      },
    )).toEqual({
      item: 'diamond_pickaxe',
      durability: { current: 1400, max: 1561 },
      enchantments: [{ id: 'efficiency', level: 3 }],
    })
  })

  it('does not attach stale enchantments to a replacement item', () => {
    expect(projectEnchantedItem(
      itemStack('iron_sword', 1),
      { current: 250, max: 250 },
      {
        item: 'diamond_pickaxe',
        durability: { current: 1500, max: 1561 },
        enchantments: [{ id: 'efficiency', level: 3 }],
      },
    )).toEqual({
      item: 'iron_sword',
      durability: { current: 250, max: 250 },
      enchantments: [],
    })
  })

  it('rejects malformed and mismatched persisted metadata', () => {
    const stack = itemStack('stone_pickaxe', 1)
    const durability = { current: 100, max: 131 }
    expect(decodeProjectedEnchantedItem('{', stack, durability)).toBeNull()
    expect(decodeProjectedEnchantedItem(JSON.stringify({
      item: 'diamond_pickaxe',
      durability: { current: 1500, max: 1561 },
      enchantments: [{ id: 'efficiency', level: 2 }],
    }), stack, durability)).toBeNull()
  })
})
