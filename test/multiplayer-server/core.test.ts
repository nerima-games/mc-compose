import {
  decodeFrame,
  encodeFrame,
  type CommandId,
  type EntityId,
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

const join = (player: string, name = player): Extract<NetworkMessage, { readonly _tag: 'PlayerJoin' }> => ({
  _tag: 'PlayerJoin',
  player: playerId(player),
  name: playerName(name),
  at: { x: 0, y: 64, z: 0 },
})

const witherStructureAt = ({ x, y, z }: { x: number; y: number; z: number }): string | null => {
  const blocks = new Map([
    ['0,64,0', 'soul_sand'],
    ['-1,65,0', 'soul_sand'],
    ['0,65,0', 'soul_sand'],
    ['1,65,0', 'soul_sand'],
    ['-1,66,0', 'wither_skeleton_skull'],
    ['0,66,0', 'wither_skeleton_skull'],
    ['1,66,0', 'wither_skeleton_skull'],
  ])
  return blocks.get(`${String(x)},${String(y)},${String(z)}`) ?? null
}

const makeFixture = (
  generatedBlockAt: (at: { x: number; y: number; z: number }) => string | null = () => null,
  timeOfDay = 6_000,
  spawnAt?: { x: number; y: number; z: number },
  initialWeather: 'clear' | 'rain' | 'thunder' = 'clear',
) => {
  const sent = new Map<string, Array<WireText>>()
  let nowMs = 0
  const server = makeMultiplayerServerCore({
    worldId: 'world-1',
    seed: 42,
    allowedBlocks: new Set(['stone', 'dirt']),
    bounds: { minX: -10, maxX: 10, minY: 0, maxY: 100, minZ: -10, maxZ: 10 },
    generatedBlockAt,
    ...(spawnAt === undefined ? {} : { spawnAt }),
    now: () => nowMs,
    initialState: {
      revision: 0,
      blocks: [],
      inventories: [
        { player: playerId('alice'), state: { slots: [{ item: 'stone', count: 16 }, { item: 'dirt', count: 16 }], selectedSlot: 0 } },
        { player: playerId('bob'), state: { slots: [{ item: 'stone', count: 16 }, { item: 'dirt', count: 16 }], selectedSlot: 0 } },
      ],
      vitals: [],
      timeWeather: { timeOfDay, weather: initialWeather },
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
  const advanceTime = (elapsedMs: number): void => { nowMs += elapsedMs }
  return { server, sent, connect, receive, receiveSleep, receiveWither, advanceTime }
}

describe('authoritative multiplayer server core', () => {
  it('overrides the client-reported join position with spawn and self-corrects the player', () => {
    const spawnAt = { x: 3, y: 70, z: -4 }
    const fixture = makeFixture(() => null, 6_000, spawnAt)
    const aliceFrames = fixture.connect('socket-a')

    const reportedJoin = join('alice', 'Alice')
    expect(fixture.receive('socket-a', {
      ...reportedJoin,
      at: { x: 9, y: 99, z: 9 },
    }).accepted).toBe(true)

    expect(messages(aliceFrames).slice(0, 2)).toEqual([
      expect.objectContaining({
        _tag: 'WorldSnapshot',
        players: [expect.objectContaining({ player: 'alice', at: spawnAt })],
      }),
      expect.objectContaining({
        _tag: 'PlayerMove',
        player: 'alice',
        at: spawnAt,
        facing: { yawRadians: 0, pitchRadians: 0 },
      }),
    ])
  })

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

  it('rejects pathing through terrain even when the reported destination is clear', () => {
    const fixture = makeFixture(({ x, y, z }) => x === 1 && y === 64 && z === 0 ? 'stone' : null)
    fixture.connect('socket-a')
    fixture.receive('socket-a', join('alice'))

    expect(fixture.receive('socket-a', {
      _tag: 'PlayerMove', player: playerId('alice'), at: { x: 3, y: 64, z: 0 }, facing: { yawRadians: 0, pitchRadians: 0 },
    })).toEqual({ accepted: false, reason: 'invalid-movement' })
    expect(fixture.server.snapshot().players[0]?.at).toEqual({ x: 0, y: 64, z: 0 })
  })

  it('limits consecutive player movement by server elapsed time', () => {
    const fixture = makeFixture()
    fixture.connect('socket-a')
    fixture.receive('socket-a', join('alice'))
    const move = (at: { x: number; y: number; z: number }): ReceiveResult => fixture.receive('socket-a', {
      _tag: 'PlayerMove', player: playerId('alice'), at, facing: { yawRadians: 0, pitchRadians: 0 },
    })

    expect(move({ x: 6, y: 64, z: 0 })).toEqual(expect.objectContaining({ accepted: true }))
    expect(move({ x: 10, y: 64, z: 0 })).toEqual({ accepted: false, reason: 'invalid-movement' })
    fixture.advanceTime(500)
    expect(move({ x: 10, y: 64, z: 0 })).toEqual(expect.objectContaining({ accepted: true }))
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

  it('accepts block mutations within reach and rejects remote placement and break', () => {
    const near = { x: 4, y: 64, z: 1 }
    const far = { x: 5, y: 64, z: 0 }
    const fixture = makeFixture(({ x, y, z }) => x === far.x && y === far.y && z === far.z ? 'stone' : null)
    const aliceFrames = fixture.connect('socket-a')
    fixture.receive('socket-a', join('alice'))
    aliceFrames.length = 0

    expect(fixture.receive('socket-a', {
      _tag: 'BlockPlace', player: playerId('alice'), at: near, block: 'stone',
    }).accepted).toBe(true)
    expect(fixture.receive('socket-a', {
      _tag: 'BlockBreak', player: playerId('alice'), at: near,
    }).accepted).toBe(true)
    expect(fixture.receive('socket-a', {
      _tag: 'BlockPlace', player: playerId('alice'), at: far, block: 'dirt',
    })).toEqual({ accepted: false, reason: 'identity-spoof' })
    expect(fixture.receive('socket-a', {
      _tag: 'BlockBreak', player: playerId('alice'), at: far,
    })).toEqual({ accepted: false, reason: 'identity-spoof' })

    expect(messages(aliceFrames).filter(({ _tag }) => _tag === 'BlockMutationRejected')).toEqual([
      expect.objectContaining({ operation: 'place', at: far, reason: 'unauthorized-player', revision: 2 }),
      expect.objectContaining({ operation: 'break', at: far, reason: 'unauthorized-player', revision: 2 }),
    ])
    expect(fixture.server.snapshot()).toMatchObject({ revision: 2, blocks: [{ at: near, block: null }] })
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
      _tag: 'BlockBreak', player: playerId('alice'), at: { x: 3, y: 63, z: 0 },
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
      _tag: 'BlockPlace', player: playerId('alice'), at: { x: 3, y: 64, z: 0 }, block: 'stone',
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
      blocks: [{ at: { x: 3, y: 64, z: 0 }, block: 'stone' }],
    })
  })

  it('restores the last authoritative position after disconnect and reconnect', () => {
    const fixture = makeFixture()
    fixture.connect('socket-a')
    fixture.receive('socket-a', join('alice', 'Alice'))
    const restoredAt = { x: 4, y: 65, z: -2 }
    const restoredFacing = { yawRadians: 1.25, pitchRadians: -0.5 }
    expect(fixture.receive('socket-a', {
      _tag: 'PlayerMove', player: playerId('alice'), at: restoredAt, facing: restoredFacing,
    }).accepted).toBe(true)
    fixture.server.disconnect('socket-a')

    const reconnectFrames = fixture.connect('socket-a2')
    const reconnectJoin = join('alice', 'Alice')
    expect(fixture.receive('socket-a2', {
      ...reconnectJoin,
      at: { x: -8, y: 80, z: 8 },
    }).accepted).toBe(true)

    expect(messages(reconnectFrames).slice(0, 2)).toEqual([
      expect.objectContaining({
        _tag: 'WorldSnapshot',
        players: [expect.objectContaining({ player: 'alice', at: restoredAt, facing: restoredFacing })],
      }),
      expect.objectContaining({
        _tag: 'PlayerMove', player: 'alice', at: restoredAt, facing: restoredFacing,
      }),
    ])
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

  it('authoritatively advances morning and clears weather when all players sleep', () => {
    const fixture = makeFixture(
      ({ x, y, z }) => x === 0 && y === 64 && z === 1 ? 'bed' : null,
      13_000,
      undefined,
      'thunder',
    )
    const aliceFrames = fixture.connect('socket-a')
    fixture.receive('socket-a', join('alice'))
    aliceFrames.length = 0

    expect(fixture.receiveSleep('socket-a', {
      _tag: 'SleepCommand',
      command: {
        _tag: 'EnterSleep', actor: playerId('alice'), session: 'alice', requestId: 'sleep-a',
        expectedRevision: 0, clientTick: 20, bed: { x: 0, y: 64, z: 1 },
      },
    }).accepted).toBe(true)

    expect(messages(aliceFrames)).toContainEqual({
      _tag: 'WorldTimeWeatherDelta',
      world: 'world-1',
      revision: 1,
      state: { timeOfDay: 6_000, weather: 'clear' },
    })
    expect(fixture.server.snapshot().revision).toBe(1)
  })

  it('synchronizes authoritative Wither state to two clients and a rejoining session', () => {
    const fixture = makeFixture(witherStructureAt)
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
        dimension: 'world-1', position: { x: 1, y: 66, z: 0 },
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

  it('advances Withers and commits a lethal competing hit and nether star drop once', () => {
    const fixture = makeFixture(witherStructureAt)
    const aliceFrames = fixture.connect('socket-a')
    const bobFrames = fixture.connect('socket-b')
    fixture.receive('socket-a', join('alice'))
    fixture.receive('socket-b', join('bob'))
    fixture.receiveWither('socket-a', {
      _tag: 'WitherCommand',
      command: {
        _tag: 'SummonWither', actor: 'alice', requestId: 'summon', expectedRevision: 0,
        dimension: 'world-1', position: { x: 1, y: 66, z: 0 },
      },
    })

    for (const at of [{ x: 0, y: 72, z: 0 }, { x: 5, y: 78, z: 0 }, { x: 8, y: 81, z: 0 }]) {
      for (const [socket, player] of [['socket-a', 'alice'], ['socket-b', 'bob']] as const) {
        fixture.receive(socket, {
          _tag: 'PlayerMove', player: playerId(player), at,
          facing: { yawRadians: 0, pitchRadians: 0 },
        })
      }
      fixture.advanceTime(1_000)
    }
    fixture.server.tick(10_000)
    for (const at of [{ x: 5, y: 78, z: 0 }, { x: 0, y: 72, z: 0 }, { x: 0, y: 64, z: 0 }]) {
      fixture.advanceTime(1_000)
      for (const [socket, player] of [['socket-a', 'alice'], ['socket-b', 'bob']] as const) {
        fixture.receive(socket, {
          _tag: 'PlayerMove', player: playerId(player), at,
          facing: { yawRadians: 0, pitchRadians: 0 },
        })
      }
    }
    aliceFrames.length = 0
    bobFrames.length = 0
    for (let hit = 0; hit < 74; hit += 1) {
      if (hit > 0) fixture.advanceTime(500)
      expect(fixture.receiveWither('socket-a', {
        _tag: 'WitherCommand',
        command: {
          _tag: 'DamageWither', actor: 'alice', requestId: `setup-${String(hit)}`, expectedRevision: hit + 2,
          id: 'wither-1', amount: 300, kind: 'melee',
        },
      })).toEqual(expect.objectContaining({ accepted: true }))
    }
    aliceFrames.length = 0
    bobFrames.length = 0
    fixture.advanceTime(500)
    const lethal = (actor: string, requestId: string): WitherWireMessage => ({
      _tag: 'WitherCommand',
      command: {
        _tag: 'DamageWither', actor, requestId, expectedRevision: 76,
        id: 'wither-1', amount: 300, kind: 'melee',
      },
    })

    expect(fixture.receiveWither('socket-a', lethal('alice', 'hit-a'))).toEqual(expect.objectContaining({ accepted: true }))
    expect(fixture.receiveWither('socket-b', lethal('bob', 'hit-b'))).toEqual(expect.objectContaining({ accepted: false }))
    expect(witherMessages(aliceFrames)).toContainEqual(expect.objectContaining({
      _tag: 'WitherCommandResult', requestId: 'hit-a', accepted: true, revision: 77,
    }))
    expect(witherMessages(bobFrames)).toContainEqual(expect.objectContaining({
      _tag: 'WitherCommandResult', requestId: 'hit-b', accepted: false, revision: 77, reason: 'stale-revision',
    }))
    for (const frames of [aliceFrames, bobFrames]) {
      expect(witherMessages(frames)).toContainEqual(expect.objectContaining({
        _tag: 'WitherSnapshot', revision: 77,
        snapshot: expect.objectContaining({ withers: [] }),
      }))
      expect(messages(frames).filter((message) => message._tag === 'EntitySpawnDelta')).toEqual([
        expect.objectContaining({
          entity: expect.objectContaining({ _tag: 'item-drop', stack: { item: 'nether_star', count: 1 } }),
        }),
      ])
    }

    fixture.server.disconnect('socket-b')
    const rejoinedFrames = fixture.connect('socket-b2')
    fixture.receive('socket-b2', join('bob'))
    expect(witherMessages(rejoinedFrames)).toContainEqual(expect.objectContaining({
      _tag: 'WitherSnapshot', revision: 77,
      snapshot: expect.objectContaining({ withers: [] }),
    }))
    expect(messages(rejoinedFrames)).toContainEqual(expect.objectContaining({
      _tag: 'AuthoritativeSnapshot',
      entities: [expect.objectContaining({ _tag: 'item-drop', stack: { item: 'nether_star', count: 1 } })],
    }))
  })

  it('rejects Wither summons without a valid structure and ignores forged damage amounts', () => {
    const invalid = makeFixture()
    invalid.connect('socket-a')
    invalid.receive('socket-a', join('alice'))
    expect(invalid.receiveWither('socket-a', {
      _tag: 'WitherCommand',
      command: {
        _tag: 'SummonWither', actor: 'alice', requestId: 'invalid', expectedRevision: 0,
        dimension: 'world-1', position: { x: 1, y: 66, z: 0 },
      },
    })).toEqual({ accepted: false, reason: 'invalid-command' })

    const valid = makeFixture(witherStructureAt)
    const frames = valid.connect('socket-a')
    valid.receive('socket-a', join('alice'))
    valid.receiveWither('socket-a', {
      _tag: 'WitherCommand',
      command: {
        _tag: 'SummonWither', actor: 'alice', requestId: 'summon', expectedRevision: 0,
        dimension: 'world-1', position: { x: 1, y: 66, z: 0 },
      },
    })
    for (const at of [{ x: 0, y: 72, z: 0 }, { x: 5, y: 78, z: 0 }, { x: 8, y: 81, z: 0 }]) {
      valid.receive('socket-a', {
        _tag: 'PlayerMove', player: playerId('alice'), at,
        facing: { yawRadians: 0, pitchRadians: 0 },
      })
      valid.advanceTime(1_000)
    }
    valid.server.tick(10_000)
    for (const at of [{ x: 5, y: 78, z: 0 }, { x: 0, y: 72, z: 0 }, { x: 0, y: 64, z: 0 }]) {
      valid.advanceTime(1_000)
      valid.receive('socket-a', {
        _tag: 'PlayerMove', player: playerId('alice'), at,
        facing: { yawRadians: 0, pitchRadians: 0 },
      })
    }
    valid.receiveWither('socket-a', {
      _tag: 'WitherCommand',
      command: {
        _tag: 'DamageWither', actor: 'alice', requestId: 'forged', expectedRevision: 2,
        id: 'wither-1', amount: 300, kind: 'melee',
      },
    })
    expect(witherMessages(frames).at(-1)).toMatchObject({
      _tag: 'WitherSnapshot', snapshot: { withers: [expect.objectContaining({
        snapshot: expect.objectContaining({ state: expect.objectContaining({ healthPoints: 296 }) }),
      })] },
    })

    const revision = (witherMessages(frames).at(-1) as Extract<WitherWireMessage, { _tag: 'WitherSnapshot' }>).revision
    const rapid = {
      _tag: 'WitherCommand',
      command: {
        _tag: 'DamageWither', actor: 'alice', requestId: 'rapid', expectedRevision: revision,
        id: 'wither-1', amount: 4, kind: 'melee',
      },
    } as const satisfies WitherWireMessage
    expect(valid.receiveWither('socket-a', rapid)).toEqual({ accepted: false, reason: 'invalid-command' })
    const rapidResult = witherMessages(frames).at(-1)
    expect(rapidResult).toMatchObject({ _tag: 'WitherCommandResult', requestId: 'rapid', accepted: false, reason: 'invalid-command' })
    valid.advanceTime(500)
    expect(valid.receiveWither('socket-a', rapid)).toEqual({ accepted: false, reason: 'invalid-command' })
    expect(witherMessages(frames).at(-1)).toEqual(rapidResult)

    expect(valid.receiveWither('socket-a', {
      _tag: 'WitherCommand',
      command: {
        _tag: 'DamageWither', actor: 'alice', requestId: 'ranged', expectedRevision: revision,
        id: 'wither-1', amount: 4, kind: 'ranged',
      },
    })).toEqual({ accepted: false, reason: 'invalid-command' })

    expect(valid.receiveWither('socket-a', {
      _tag: 'WitherCommand',
      command: {
        _tag: 'DamageWither', actor: 'alice', requestId: 'after-cooldown', expectedRevision: revision,
        id: 'wither-1', amount: 999, kind: 'melee',
      },
    })).toEqual(expect.objectContaining({ accepted: true }))
  })
  it('authoritatively drops Blaze loot when a Blaze dies', () => {
    const fixture = makeFixture()
    const frames = fixture.connect('socket-a')
    fixture.receive('socket-a', join('alice'))
    expect(fixture.server.spawnEntity({
      _tag: 'living',
      entityId: 'blaze-1' as EntityId,
      entityType: 'blaze',
      at: { x: 1, y: 64, z: 0 },
      health: 4,
      maxHealth: 20,
    })).toBe(true)
    frames.length = 0

    expect(fixture.receive('socket-a', {
      _tag: 'EntityAttackCommand',
      commandId: 'blaze-kill' as CommandId,
      player: playerId('alice'),
      world: worldId('world-1'),
      expectedRevision: fixture.server.snapshot().revision,
      entityId: 'blaze-1' as EntityId,
    })).toEqual(expect.objectContaining({ accepted: true }))

    expect(messages(frames)).toEqual(expect.arrayContaining([
      expect.objectContaining({ _tag: 'EntityDespawnDelta', entityId: 'blaze-1' }),
      expect.objectContaining({
        _tag: 'EntitySpawnDelta',
        entity: expect.objectContaining({
          _tag: 'item-drop',
          stack: { item: 'blaze_powder', count: 1 },
        }),
      }),
    ]))
  })
})
