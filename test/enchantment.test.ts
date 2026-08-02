import { describe, expect, it } from 'vitest'

import {
  armorDamageWithEnchantments,
  bowDamageWithEnchantments,
  decodeEnchantedItemSnapshot,
  durabilityWearWithEnchantments,
  encodeEnchantedItem,
  fortuneDropCountWithEnchantments,
  meleeDamageWithEnchantments,
  miningSpeedWithEnchantments,
  type EnchantedItem,
} from '@nerima-games/mx-gameplay'

const enchantedItem = (
  item: EnchantedItem['item'],
  durability: EnchantedItem['durability'],
  enchantments: EnchantedItem['enchantments'],
): EnchantedItem => ({ item, durability, enchantments })

describe('enchantment effects', () => {
  it('applies Sharpness V to melee damage', () => {
    const sword = enchantedItem(
      'diamond_sword',
      { current: 1561, max: 1561 },
      [{ id: 'sharpness', level: 5 }],
    )

    expect(meleeDamageWithEnchantments(7, sword)).toBe(10)
  })

  it('applies Power I to bow damage', () => {
    const bow = enchantedItem(
      'bow',
      { current: 384, max: 384 },
      [{ id: 'power', level: 1 }],
    )

    expect(bowDamageWithEnchantments(5, bow)).toBe(8)
  })

  it('applies total Protection IV after armor reduction', () => {
    const chestplate = enchantedItem(
      'iron_chestplate',
      { current: 240, max: 240 },
      [{ id: 'protection', level: 4 }],
    )

    expect(
      armorDamageWithEnchantments({ amount: 10, cause: 'generic' }, 15, [chestplate]),
    ).toEqual({ amount: 3.36, cause: 'generic' })
  })

  it('applies Efficiency V to mining speed', () => {
    const pickaxe = enchantedItem(
      'diamond_pickaxe',
      { current: 1561, max: 1561 },
      [{ id: 'efficiency', level: 5 }],
    )

    expect(miningSpeedWithEnchantments(2, pickaxe)).toBe(28)
  })

  it('uses the Fortune III fractional boundary', () => {
    const pickaxe = enchantedItem(
      'diamond_pickaxe',
      { current: 1561, max: 1561 },
      [{ id: 'fortune', level: 3 }],
    )

    expect(fortuneDropCountWithEnchantments(2, pickaxe, 0.499)).toBe(4)
    expect(fortuneDropCountWithEnchantments(2, pickaxe, 0.5)).toBe(3)
  })

  it('counts boundary and invalid Unbreaking II rolls as wear', () => {
    const pickaxe = enchantedItem(
      'diamond_pickaxe',
      { current: 1561, max: 1561 },
      [{ id: 'unbreaking', level: 2 }],
    )

    expect(durabilityWearWithEnchantments(4, pickaxe, [0, 0.65, 2 / 3, Number.NaN])).toBe(2)
  })
})

describe('enchanted item snapshots', () => {
  it('encodes and decodes the canonical enchantment order', () => {
    const pickaxe = enchantedItem(
      'diamond_pickaxe',
      { current: 1500, max: 1561 },
      [
        { id: 'fortune', level: 3 },
        { id: 'efficiency', level: 5 },
        { id: 'unbreaking', level: 2 },
      ],
    )

    const encoded = encodeEnchantedItem(pickaxe)
    expect(encoded).toEqual({
      ok: true,
      encoded:
        '{"item":"diamond_pickaxe","durability":{"current":1500,"max":1561},"enchantments":[{"id":"efficiency","level":5},{"id":"unbreaking","level":2},{"id":"fortune","level":3}]}',
    })
    if (!encoded.ok) throw new Error('expected the enchanted item to encode')

    expect(decodeEnchantedItemSnapshot(encoded.encoded)).toEqual({
      ok: true,
      value: {
        item: 'diamond_pickaxe',
        durability: { current: 1500, max: 1561 },
        enchantments: [
          { id: 'efficiency', level: 5 },
          { id: 'unbreaking', level: 2 },
          { id: 'fortune', level: 3 },
        ],
      },
    })
  })

  it('rejects malformed snapshots', () => {
    expect(decodeEnchantedItemSnapshot('{')).toEqual({
      ok: false,
      issues: [{ path: '$', reason: 'must be valid JSON' }],
    })

    expect(
      decodeEnchantedItemSnapshot(
        '{"item":"diamond_sword","durability":null,"enchantments":[]}',
      ),
    ).toEqual({
      ok: false,
      issues: [{ path: 'durability', reason: 'does not match the item durability catalog' }],
    })
  })
})
