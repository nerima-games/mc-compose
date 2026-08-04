import type { WireText } from '@nerima-games/mx-multiplayer'
import { describe, expect, it } from 'vitest'

import { decodeCraftingWireMessage } from '../apps/multiplayer-shared/crafting-network'

const wire = (value: unknown): WireText => JSON.stringify(value) as WireText

const command = {
  _tag: 'CraftingCommand',
  commandId: 'craft-1',
  player: 'alice',
  world: 'world-1',
  expectedRevision: 4,
  grid: { width: 2, height: 2, cells: ['oak_log', null, null, null] },
} as const

describe('crafting wire codec', () => {
  it('decodes a valid command', () => {
    expect(decodeCraftingWireMessage(wire(command))).toEqual(command)
  })

  it.each([
    ['non-square grid', { ...command, grid: { width: 2, height: 3, cells: Array(6).fill(null) } }],
    ['wrong cell count', { ...command, grid: { width: 2, height: 2, cells: [null] } }],
    ['unknown item', { ...command, grid: { width: 2, height: 2, cells: ['not-an-item', null, null, null] } }],
    ['extra command field', { ...command, extra: true }],
  ])('rejects %s', (_case, message) => {
    expect(decodeCraftingWireMessage(wire(message))).toBeUndefined()
  })

  it('rejects client-declared output and item counts', () => {
    expect(decodeCraftingWireMessage(wire({ ...command, output: { item: 'oak_planks', count: 64 } }))).toBeUndefined()
    expect(decodeCraftingWireMessage(wire({
      ...command,
      grid: { width: 2, height: 2, cells: [{ item: 'oak_log', count: 64 }, null, null, null] },
    }))).toBeUndefined()
  })
})
