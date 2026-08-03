import { describe, expect, it } from 'vitest'

import type { WireText } from '@nerima-games/mx-multiplayer'

import { decodeWitherWireMessage, WITHER_MAX_WIRE_LENGTH } from '../apps/multiplayer-shared/wither-network'

const wire = (message: unknown): WireText => JSON.stringify(message) as WireText

const snapshot = {
  nextWitherId: 2,
  nextSkullId: 1,
  withers: [{
    id: 'wither-1',
    dimension: 'overworld',
    snapshot: {
      kind: 'wither',
      version: 1,
      state: {
        phase: 'airborne',
        healthPoints: 300,
        chargeRemainingSecs: 0,
        feetPosition: { x: 1, y: 64, z: 1 },
        velocity: { x: 0, y: 0, z: 0 },
      },
    },
    rangedCooldownSecs: 2,
    meleeCooldownSecs: 0,
    shotsFired: 3,
  }],
  skulls: [],
}

describe('decodeWitherWireMessage', () => {
  it('reconstructs every supported command without trusting parsed JSON', () => {
    expect(decodeWitherWireMessage(wire({
      _tag: 'WitherCommand',
      command: {
        _tag: 'SummonWither', actor: 'alice', requestId: 'summon-1', expectedRevision: 0,
        dimension: 'overworld', position: { x: 1, y: 64, z: 1 },
      },
    }))).toEqual({
      _tag: 'WitherCommand',
      command: {
        _tag: 'SummonWither', actor: 'alice', requestId: 'summon-1', expectedRevision: 0,
        dimension: 'overworld', position: { x: 1, y: 64, z: 1 },
      },
    })

    for (const kind of ['magic', 'void'] as const) {
      expect(decodeWitherWireMessage(wire({
        _tag: 'WitherCommand',
        command: {
          _tag: 'DamageWither', actor: 'alice', requestId: `damage-${kind}`, expectedRevision: 1,
          id: 'wither-1', amount: 4, kind,
        },
      }))).toMatchObject({ _tag: 'WitherCommand', command: { _tag: 'DamageWither', kind } })
    }
  })

  it('requires result consistency and complete runtime snapshots', () => {
    expect(decodeWitherWireMessage(wire({
      _tag: 'WitherCommandResult', requestId: 'summon-1', accepted: false, revision: 1,
      reason: 'stale-revision',
    }))).toEqual({
      _tag: 'WitherCommandResult', requestId: 'summon-1', accepted: false, revision: 1,
      reason: 'stale-revision',
    })
    expect(decodeWitherWireMessage(wire({
      _tag: 'WitherCommandResult', requestId: 'summon-1', accepted: false, revision: 1,
    }))).toBeUndefined()
    expect(decodeWitherWireMessage(wire({ _tag: 'WitherSnapshot', revision: 2, snapshot }))).toMatchObject({
      _tag: 'WitherSnapshot', revision: 2, snapshot,
    })
    expect(decodeWitherWireMessage(wire({
      _tag: 'WitherSnapshot',
      revision: 2,
      snapshot: { ...snapshot, withers: [{ ...snapshot.withers[0], snapshot: { kind: 'wither', version: 1 } }] },
    }))).toBeUndefined()
  })

  it('rejects extra fields and oversized messages at the protocol boundary', () => {
    expect(decodeWitherWireMessage(wire({
      _tag: 'WitherCommand',
      command: {
        _tag: 'SummonWither', actor: 'alice', requestId: 'summon-1', expectedRevision: 0,
        dimension: 'overworld', position: { x: 1, y: 64, z: 1 }, extra: true,
      },
    }))).toBeUndefined()
    expect(decodeWitherWireMessage('x'.repeat(WITHER_MAX_WIRE_LENGTH + 1) as WireText)).toBeUndefined()
  })
})
