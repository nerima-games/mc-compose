import type { WireText } from '@nerima-games/mx-multiplayer'
import { describe, expect, it } from 'vitest'

import { decodeBrewingWireMessage } from '../apps/multiplayer-shared/brewing-network'

const wire = (value: unknown): WireText => JSON.stringify(value) as WireText

const command = {
  _tag: 'BrewingCommand',
  commandId: 'brew-1',
  player: 'alice',
  world: 'world-1',
  expectedRevision: 4,
  at: { x: 12, y: 64, z: -8 },
  action: { _tag: 'insert', slot: 5 },
} as const

describe('brewing wire codec', () => {
  it('decodes a valid command', () => {
    expect(decodeBrewingWireMessage(wire(command))).toEqual(command)
  })

  it.each([
    ['non-integer coordinate', { ...command, at: { ...command.at, x: 1.5 } }],
    ['out-of-range coordinate', { ...command, at: { ...command.at, z: 30_000_001 } }],
    ['invalid slot', { ...command, action: { _tag: 'insert', slot: 36 } }],
    ['extra command field', { ...command, extra: true }],
  ])('rejects %s', (_case, message) => {
    expect(decodeBrewingWireMessage(wire(message))).toBeUndefined()
  })

  it('decodes accepted and rejected results', () => {
    expect(decodeBrewingWireMessage(wire({
      _tag: 'BrewingCommandResult', commandId: 'brew-1', accepted: true, revision: 5,
    }))).toEqual({ _tag: 'BrewingCommandResult', commandId: 'brew-1', accepted: true, revision: 5 })
    expect(decodeBrewingWireMessage(wire({
      _tag: 'BrewingCommandResult', commandId: 'brew-1', accepted: false, revision: 4, reason: 'missing-ingredients',
    }))).toEqual({ _tag: 'BrewingCommandResult', commandId: 'brew-1', accepted: false, revision: 4, reason: 'missing-ingredients' })
  })

  it('rejects an invalid result reason', () => {
    expect(decodeBrewingWireMessage(wire({
      _tag: 'BrewingCommandResult', commandId: 'brew-1', accepted: false, revision: 4, reason: 'server-error',
    }))).toBeUndefined()
  })
})
