import type { WireText } from '@nerima-games/mx-multiplayer'
import { describe, expect, it } from 'vitest'

import {
  decodePlayerDamageWireMessage,
  PLAYER_DAMAGE_MAX_MINIMUM_HEALTH_POINTS,
} from '../apps/web/player-damage-network'

const wire = (value: unknown): WireText => JSON.stringify(value) as WireText

const command = {
  _tag: 'PlayerDamageCommand',
  commandId: 'damage-1',
  player: 'alice',
  world: 'world-1',
  expectedRevision: 4,
  amount: 1,
} as const

const acceptedResult = {
  _tag: 'PlayerDamageCommandResult',
  commandId: 'damage-1',
  accepted: true,
  revision: 5,
} as const

const rejectedResult = {
  _tag: 'PlayerDamageCommandResult',
  commandId: 'damage-1',
  accepted: false,
  revision: 4,
  reason: 'stale-revision',
} as const

describe('player damage wire codec', () => {
  it.each([command, acceptedResult, rejectedResult])('decodes a valid $_tag', (message) => {
    expect(decodePlayerDamageWireMessage(wire(message))).toEqual(message)
  })

  it.each([
    ['accepted result with reason', { ...acceptedResult, reason: 'stale-revision' }],
    ['rejected result without reason', { ...rejectedResult, reason: undefined }],
    ['rejected result with unknown reason', { ...rejectedResult, reason: 'server-error' }],
  ])('rejects %s', (_case, message) => {
    expect(decodePlayerDamageWireMessage(wire(message))).toBeUndefined()
  })

  it.each([
    ['command', { ...command, extra: true }],
    ['accepted result', { ...acceptedResult, extra: true }],
    ['rejected result', { ...rejectedResult, extra: true }],
  ])('rejects excess fields on a %s', (_case, message) => {
    expect(decodePlayerDamageWireMessage(wire(message))).toBeUndefined()
  })

  it('decodes a command with an optional minimum health point floor', () => {
    const message = { ...command, minimumHealthPoints: 1 }
    expect(decodePlayerDamageWireMessage(wire(message))).toEqual(message)
  })

  it.each([
    ['negative', -0.1],
    ['too large', PLAYER_DAMAGE_MAX_MINIMUM_HEALTH_POINTS + 0.1],
    ['non-finite', Number.POSITIVE_INFINITY],
    ['wrong type', '1'],
  ] as const)('rejects %s minimum health point floor', (_case, minimumHealthPoints) => {
    expect(decodePlayerDamageWireMessage(wire({ ...command, minimumHealthPoints }))).toBeUndefined()
  })

  it.each(['commandId', 'player', 'world'] as const)(
    'rejects control characters in command %s',
    (key) => {
      for (const control of ['\u0000', '\n', '\u007f']) {
        expect(decodePlayerDamageWireMessage(wire({ ...command, [key]: `bad${control}id` }))).toBeUndefined()
      }
    },
  )

  it('rejects control characters in result commandId', () => {
    for (const control of ['\u0000', '\n', '\u007f']) {
      expect(decodePlayerDamageWireMessage(wire({
        ...acceptedResult,
        commandId: `bad${control}id`,
      }))).toBeUndefined()
    }
  })
})
