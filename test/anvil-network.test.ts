import type { WireText } from '@nerima-games/mx-multiplayer'
import { describe, expect, it } from 'vitest'

import { decodeAnvilWireMessage } from '../apps/multiplayer-shared/anvil-network'

const wire = (value: unknown): WireText => JSON.stringify(value) as WireText

const command = {
  _tag: 'AnvilCommand',
  commandId: 'anvil-1',
  player: 'alice',
  world: 'world-1',
  expectedRevision: 4,
  slot: 5,
  name: 'Hunter',
} as const

describe('anvil wire codec', () => {
  it('decodes a valid command', () => {
    expect(decodeAnvilWireMessage(wire(command))).toEqual(command)
  })

  it.each([
    ['invalid slot', { ...command, slot: 36 }],
    ['control character in name', { ...command, name: 'Hunter\n' }],
    ['oversized name', { ...command, name: 'x'.repeat(51) }],
    ['extra command field', { ...command, extra: true }],
  ])('rejects %s', (_case, message) => {
    expect(decodeAnvilWireMessage(wire(message))).toBeUndefined()
  })

  it('decodes private name deltas and rejects duplicate slots', () => {
    expect(decodeAnvilWireMessage(wire({
      _tag: 'PlayerAnvilNamesDelta', world: 'world-1', revision: 5, player: 'alice', names: [{ slot: 5, name: 'Hunter' }],
    }))).toEqual({
      _tag: 'PlayerAnvilNamesDelta', world: 'world-1', revision: 5, player: 'alice', names: [{ slot: 5, name: 'Hunter' }],
    })
    expect(decodeAnvilWireMessage(wire({
      _tag: 'PlayerAnvilNamesDelta', world: 'world-1', revision: 5, player: 'alice', names: [{ slot: 5, name: 'Hunter' }, { slot: 5, name: 'Bow' }],
    }))).toBeUndefined()
  })
})
