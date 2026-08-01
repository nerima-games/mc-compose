import {
  decodeFrame,
  encodeFrame,
  type NetworkMessage,
  type PlayerId,
  type PlayerName,
  type WireText,
  type WorldId,
} from '@nerima-games/mx-multiplayer'
import { Either } from 'effect'
import { describe, expect, it } from 'vitest'

import { makeMultiplayerServerCore, type ReceiveResult } from '../../apps/multiplayer-server/core'
import { decodeSleepWireMessage, type SleepWireMessage } from '../../apps/web/sleep-network'
import { decodeWitherWireMessage, type WitherWireMessage } from '../../apps/web/wither-network'

const playerId = (value: string): PlayerId => value as PlayerId
const playerName = (value: string): PlayerName => value as PlayerName
const worldId = (value: string): WorldId => value as WorldId

const frame = (message: NetworkMessage): WireText => {
  const result = encodeFrame(message)
  if (Either.isLeft(result)) throw result.left
  return result.right
}

const messages = (frames: ReadonlyArray<WireText>): ReadonlyArray<NetworkMessage> =>
  frames.filter((wire) => decodeSleepWireMessage(wire) === undefined && decodeWitherWireMessage(wire) === undefined).map((wire) => {
    const result = decodeFrame(wire)
    if (Either.isLeft(result)) throw result.left
    return result.right
  })

const sleepMessages = (frames: ReadonlyArray<WireText>): ReadonlyArray<SleepWireMessage> =>
  frames.flatMap((wire) => {
    const message = decodeSleepWireMessage(wire)
    return message === undefined ? [] : [message]
  })

const witherMessages = (frames: ReadonlyArray<WireText>): ReadonlyArray<WitherWireMessage> =>
  frames.flatMap((wire) => {
    const message = decodeWitherWireMessage(wire)
    return message === undefined ? [] : [message]
  })

const join = (player: string, name = player): NetworkMessage => ({
  _tag: 'PlayerJoin',
  player: playerId(player),
  name: playerName(name),
  at: { x: 0, y: 64, z: 0 },
})

const makeFixture = (
  generatedBlockAt: (at: { x: number; y: number; z: number }) => string | null = () => null,
  timeOfDay = 6_000,
) => {
  const sent = new Map<string, Array<WireText>>()
  const server = makeMultiplayerServerCore({
    worldId: 'world-1',
    seed: 42,
    allowedBlocks: new Set(['stone', 'dirt']),
    bounds: { minX: -10, maxX: 10, minY: 0, maxY: 100, minZ: -10, maxZ: 10 },
    generatedBlockAt,
    initialState: {
      revision: 0,
      blocks: [],
      inventories: [],
      vitals: [],
      timeWeather: { timeOfDay, weather: 'clear' },
      containers: [],
      furnaces: [],
      villagerTrades: [],
    },
  })
  const connect = (clientId: string): Array<WireText> => {
    const out: Array<WireText> = []
    sent.set(clientId, out)
    expect(server.connect(clientId, (wire) => out.push(wire))).toBe(true)
    return out
  }
  const receive = (clientId: string, message: NetworkMessage): ReceiveResult =>
    server.receive(clientId, frame(message))
  const receiveSleep = (clientId: string, message: SleepWireMessage): ReceiveResult =>
    server.receive(clientId, JSON.stringify(message) as WireText)
  const receiveWither = (clientId: string, message: WitherWireMessage): ReceiveResult =>
    server.receive(clientId, JSON.stringify(message) as WireText)
  return { server, sent, connect, receive, receiveSleep, receiveWither }
}

describe('authoritative multiplayer server core', () => {
  it('binds identity on join and snapshots the mutual roster', () => {
    const fixture = makeFixture()
    const aliceFrames = fixture.connect('socket-a')
    const bobFrames = fixture.connect('socket-b')

    expect(fixture.receive('socket-a', join('alice', 'Alice')).accepted).toBe(true)
    expect(messages(aliceFrames)[0]).toMatchObject({
      _tag: 'WorldSnapshot',
      world: 'world-1',
      seed: 42,
      revision: 0,
      players: [{ player: 'alice', name: 'Alice' }],
    })

    expect(fixture.receive('socket-b', join('bob', 'Bob')).accepted).toBe(true)
    expect(messages(bobFrames)[0]).toMatchObject({
      _tag: 'WorldSnapshot',
      players: [{ player: 'alice' }, { player: 'bob' }],
    })
    expect(messages(aliceFrames).at(-1)).toMatchObject({ _tag: 'PlayerJoin', player: 'bob' })
  })

  it('rejects duplicate ids, pre-join traffic, and identity spoofing', () => {
    const fixture = makeFixture()
    fixture.connect('socket-a')
    fixture.connect('socket-b')
    fixture.receive('socket-a', join('alice'))

    expect(fixture.receive('socket-b', join('alice'))).toEqual({ accepted: false, reason: 'duplicate-player' })
    expect(fixture.receive('socket-b', {
      _tag: 'PlayerMove',
      player: playerId('bob'),
      at: { x: 1, y: 64, z: 1 },
      facing: { yawRadians: 0, pitchRadians: 0 },
    })).toEqual({ accepted: false, reason: 'join-required' })

    fixture.receive('socket-b', join('bob'))
    expect(fixture.receive('socket-b', {
      _tag: 'PlayerMove',
      player: playerId('alice'),
      at: { x: 9, y: 64, z: 9 },
      facing: { yawRadians: 0, pitchRadians: 0 },
    })).toEqual({ accepted: false, reason: 'identity-spoof' })
    expect(fixture.server.snapshot().players.find((player) => player.player === playerId('alice'))?.at).toEqual({ x: 0, y: 64, z: 0 })
  })

  it('updates movement and broadcasts movement and chat as authoritative events', () => {
    const fixture = makeFixture()
    const aliceFrames = fixture.connect('socket-a')
    const bobFrames = fixture.connect('socket-b')
    fixture.receive('socket-a', join('alice'))
    fixture.receive('socket-b', join('bob'))
    aliceFrames.length = 0
    bobFrames.length = 0

    const move: NetworkMessage = {
      _tag: 'PlayerMove',
      player: playerId('alice'),
      at: { x: 4, y: 65, z: -2 },
      facing: { yawRadians: 1.25, pitchRadians: -0.5 },
    }
    const chat: NetworkMessage = { _tag: 'Chat', player: playerId('alice'), text: 'hello' }
    expect(fixture.receive('socket-a', move).accepted).toBe(true)
    expect(fixture.receive('socket-a', chat).accepted).toBe(true)

    for (const frames of [aliceFrames, bobFrames]) {
      expect(messages(frames)).toEqual([
        expect.objectContaining({ ...move, world: 'world-1' }),
        chat,
      ])
    }
    expect(fixture.server.snapshot().players.find((player) => player.player === playerId('alice'))).toMatchObject({
      at: move.at,
      facing: move.facing,
    })
  })

  it('rejects movement that exceeds the speed limit or intersects generated terrain', () => {
    const fixture = makeFixture(({ x, y, z }) => x === 1 && y === 64 && z === 0 ? 'stone' : null)
    const aliceFrames = fixture.connect('socket-a')
    fixture.receive('socket-a', join('alice'))
    aliceFrames.length = 0

    const move = (at: { x: number; y: number; z: number }): ReceiveResult => fixture.receive('socket-a', {
      _tag: 'PlayerMove',
      player: playerId('alice'),
      at,
      facing: { yawRadians: 1, pitchRadians: 0 },
    })
    expect(move({ x: 9, y: 64, z: 0 })).toEqual({ accepted: false, reason: 'invalid-movement' })
    expect(move({ x: 1, y: 64, z: 0 })).toEqual({ accepted: false, reason: 'invalid-movement' })
    expect(fixture.server.snapshot().players[0]?.at).toEqual({ x: 0, y: 64, z: 0 })
    expect(messages(aliceFrames)).toEqual([
      expect.objectContaining({ _tag: 'PlayerMove', at: { x: 0, y: 64, z: 0 } }),
      expect.objectContaining({ _tag: 'PlayerMove', at: { x: 0, y: 64, z: 0 } }),
    ])
  })

  it('rejects a spoofed mutation without changing authoritative state', () => {
    const fixture = makeFixture()
    const bobFrames = fixture.connect('socket-b')
    fixture.receive('socket-b', join('bob'))
    bobFrames.length = 0

    expect(fixture.receive('socket-b', {
      _tag: 'BlockPlace',
      player: playerId('alice'),
      at: { x: 2, y: 65, z: 2 },
      block: 'stone',
    })).toEqual({ accepted: false, reason: 'identity-spoof' })
    expect(messages(bobFrames)).toEqual([
      expect.objectContaining({ _tag: 'BlockMutationRejected', reason: 'unauthorized-player', revision: 0 }),
    ])
    expect(fixture.server.snapshot()).toMatchObject({ revision: 0, blocks: [] })
  })

  it('broadcasts accepted placement and break with monotonic revisions', () => {
    const fixture = makeFixture()
    fixture.connect('socket-a')
    const bobFrames = fixture.connect('socket-b')
    fixture.receive('socket-a', join('alice'))
    fixture.receive('socket-b', join('bob'))
    bobFrames.length = 0

    const at = { x: 2, y: 65, z: 3 }
    expect(fixture.receive('socket-a', {
      _tag: 'BlockPlace', player: playerId('alice'), world: worldId('world-1'), at, block: 'stone',
    }).accepted).toBe(true)
    expect(messages(bobFrames)).toContainEqual(expect.objectContaining({ _tag: 'BlockPlace', at, block: 'stone' }))
    expect(fixture.server.snapshot()).toMatchObject({ revision: 1, blocks: [{ at, block: 'stone' }] })

    expect(fixture.receive('socket-a', {
      _tag: 'BlockBreak', player: playerId('alice'), world: worldId('world-1'), at,
    }).accepted).toBe(true)
    expect(messages(bobFrames)).toContainEqual(expect.objectContaining({ _tag: 'BlockBreak', at }))
    expect(fixture.server.snapshot()).toMatchObject({ revision: 2, blocks: [{ at, block: null }] })
  })

  it.each([
    ['unknown block', { x: 0, y: 60, z: 0 }, 'lava', 'unknown-block'],
    ['air placement', { x: 0, y: 60, z: 0 }, 'air', 'unknown-block'],
    ['out of bounds', { x: 11, y: 60, z: 0 }, 'stone', 'out-of-bounds'],
  ] as const)('rejects %s without changing the revision', (_label, at, block, reason) => {
    const fixture = makeFixture()
    const aliceFrames = fixture.connect('socket-a')
    fixture.receive('socket-a', join('alice'))
    aliceFrames.length = 0

    expect(fixture.receive('socket-a', {
      _tag: 'BlockPlace', player: playerId('alice'), world: worldId('world-1'), at, block,
    })).toEqual({ accepted: false, reason: 'invalid-mutation' })
    expect(messages(aliceFrames)).toEqual([
      expect.objectContaining({ _tag: 'BlockMutationRejected', operation: 'place', reason, revision: 0 }),
    ])
    expect(fixture.server.snapshot().revision).toBe(0)
  })

  it('rejects occupied placement and missing break from authoritative state', () => {
    const fixture = makeFixture(({ x, y, z }) => x === 1 && y === 63 && z === 1 ? 'stone' : null)
    const aliceFrames = fixture.connect('socket-a')
    fixture.receive('socket-a', join('alice'))
    aliceFrames.length = 0

    fixture.receive('socket-a', {
      _tag: 'BlockPlace', player: playerId('alice'), at: { x: 1, y: 63, z: 1 }, block: 'dirt',
    })
    fixture.receive('socket-a', {
      _tag: 'BlockBreak', player: playerId('alice'), at: { x: 5, y: 63, z: 5 },
    })
    expect(messages(aliceFrames).map((message) => message._tag === 'BlockMutationRejected' ? message.reason : null)).toEqual(['occupied', 'missing-block'])
    expect(fixture.server.snapshot().revision).toBe(0)
  })

  it('broadcasts leave on disconnect and gives a reconnecting identity the current snapshot', () => {
    const fixture = makeFixture()
    const aliceFrames = fixture.connect('socket-a')
    fixture.connect('socket-b')
    fixture.receive('socket-a', join('alice'))
    fixture.receive('socket-b', join('bob'))
    fixture.receive('socket-a', {
      _tag: 'BlockPlace', player: playerId('alice'), at: { x: 3, y: 70, z: 3 }, block: 'dirt',
    })
    aliceFrames.length = 0

    fixture.server.disconnect('socket-b')
    expect(messages(aliceFrames)).toContainEqual(expect.objectContaining({ _tag: 'PlayerLeave', player: 'bob' }))

    const reconnectFrames = fixture.connect('socket-b2')
    expect(fixture.receive('socket-b2', join('bob', 'Bob')).accepted).toBe(true)
    expect(messages(reconnectFrames)[0]).toMatchObject({
      _tag: 'WorldSnapshot',
      revision: 1,
      players: [{ player: 'alice' }, { player: 'bob' }],
      blocks: [{ at: { x: 3, y: 70, z: 3 }, block: 'dirt' }],
    })
  })

  it('handles an explicit leave with the same authoritative cleanup', () => {
    const fixture = makeFixture()
    fixture.connect('socket-a')
    const bobFrames = fixture.connect('socket-b')
    fixture.receive('socket-a', join('alice'))
    fixture.receive('socket-b', join('bob'))
    bobFrames.length = 0

    expect(fixture.receive('socket-a', { _tag: 'PlayerLeave', player: playerId('alice') }).accepted).toBe(true)
    expect(messages(bobFrames)).toEqual([expect.objectContaining({ _tag: 'PlayerLeave', player: 'alice' })])
    expect(fixture.server.snapshot().players.map((player) => player.player)).toEqual(['bob'])
    expect(fixture.receive('socket-a', { _tag: 'Chat', player: playerId('alice'), text: 'after leave' })).toEqual({
      accepted: false,
      reason: 'join-required',
    })
  })

  it('answers ping before join without broadcasting it', () => {
    const fixture = makeFixture()
    const frames = fixture.connect('socket-a')
    expect(fixture.receive('socket-a', { _tag: 'Ping', nonce: 17 }).accepted).toBe(true)
    expect(messages(frames)).toEqual([{ _tag: 'Pong', nonce: 17 }])
  })

  it('accepts sleep commands authoritatively and cleans sleepers on disconnect', () => {
    const fixture = makeFixture(({ x, y, z }) => x === 0 && y === 64 && z === 1 ? 'bed' : null, 13_000)
    const aliceFrames = fixture.connect('socket-a')
    const bobFrames = fixture.connect('socket-b')
    fixture.receive('socket-a', join('alice'))
    fixture.receive('socket-b', join('bob'))
    aliceFrames.length = 0
    bobFrames.length = 0

    const receiveResult = fixture.receiveSleep('socket-a', {
      _tag: 'SleepCommand',
      command: {
        _tag: 'EnterSleep', actor: playerId('alice'), session: 'alice', requestId: 'sleep-a',
        expectedRevision: 0, clientTick: 20, bed: { x: 0, y: 64, z: 1 },
      },
    })
    expect(sleepMessages(aliceFrames)).toContainEqual(expect.objectContaining({
      _tag: 'SleepCommandResult', result: expect.objectContaining({ accepted: true, revision: 1 }),
    }))
    expect(receiveResult).toEqual(expect.objectContaining({ accepted: true }))
    expect(sleepMessages(bobFrames)).toContainEqual(expect.objectContaining({
      _tag: 'SleepEvents', revision: 1,
    }))

    aliceFrames.length = 0
    fixture.server.disconnect('socket-a')
    expect(sleepMessages(bobFrames)).toContainEqual(expect.objectContaining({
      _tag: 'SleepEvents',
      events: expect.arrayContaining([expect.objectContaining({ _tag: 'ActorSleepChanged', sleeping: null })]),
    }))
  })

  it('synchronizes authoritative Wither state to two clients and a rejoining session', () => {
    const fixture = makeFixture()
    const aliceFrames = fixture.connect('socket-a')
    const bobFrames = fixture.connect('socket-b')
    fixture.receive('socket-a', join('alice'))
    fixture.receive('socket-b', join('bob'))
    aliceFrames.length = 0
    bobFrames.length = 0

    expect(fixture.receiveWither('socket-a', {
      _tag: 'WitherCommand',
      command: {
        _tag: 'SummonWither', actor: 'alice', requestId: 'summon-1', expectedRevision: 0,
        dimension: 'world-1', position: { x: 2, y: 64, z: 3 },
      },
    })).toEqual(expect.objectContaining({ accepted: true }))
    expect(witherMessages(aliceFrames)).toContainEqual(expect.objectContaining({
      _tag: 'WitherCommandResult', requestId: 'summon-1', accepted: true, revision: 1,
    }))
    for (const frames of [aliceFrames, bobFrames]) {
      expect(witherMessages(frames)).toContainEqual(expect.objectContaining({
        _tag: 'WitherSnapshot', revision: 1,
        snapshot: expect.objectContaining({ withers: [expect.objectContaining({ id: 'wither-1' })] }),
      }))
    }

    fixture.server.disconnect('socket-b')
    const rejoinedFrames = fixture.connect('socket-b2')
    fixture.receive('socket-b2', join('bob'))
    expect(witherMessages(rejoinedFrames)).toContainEqual(expect.objectContaining({
      _tag: 'WitherSnapshot', revision: 1,
      snapshot: expect.objectContaining({ withers: [expect.objectContaining({ id: 'wither-1' })] }),
    }))
  })
})
