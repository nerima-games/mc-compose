import type { WireText } from '@nerima-games/mx-multiplayer'
import { describe, expect, it } from 'vitest'

import { decodeEnchantingWireMessage } from '../apps/multiplayer-shared/enchanting-network'

const wire = (value: unknown): WireText => JSON.stringify(value) as WireText

const command = {
  _tag: 'EnchantingCommand',
  commandId: 'enchant-1',
  player: 'alice',
  world: 'world-1',
  expectedRevision: 4,
  slot: 5,
  offer: 1,
} as const

describe('enchanting wire codec', () => {
  it('decodes a valid command', () => {
    expect(decodeEnchantingWireMessage(wire(command))).toEqual(command)
  })

  it.each([
    ['invalid slot', { ...command, slot: 36 }],
    ['invalid offer', { ...command, offer: 3 }],
    ['extra command field', { ...command, extra: true }],
  ])('rejects %s', (_case, message) => {
    expect(decodeEnchantingWireMessage(wire(message))).toBeUndefined()
  })

  it('decodes private enchantment deltas and rejects duplicate slots', () => {
    const delta = {
      _tag: 'PlayerEnchantmentsDelta', world: 'world-1', revision: 5, player: 'alice', seed: 43,
      items: [{
        slot: 5,
        item: {
          item: 'iron_boots', durability: { current: 195, max: 195 },
          enchantments: [{ id: 'protection', level: 2 }],
        },
      }],
    } as const
    expect(decodeEnchantingWireMessage(wire(delta))).toEqual(delta)
    expect(decodeEnchantingWireMessage(wire({ ...delta, items: [...delta.items, delta.items[0]] }))).toBeUndefined()
  })
})
