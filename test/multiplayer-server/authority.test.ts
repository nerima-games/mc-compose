import {
  decodeFrame,
  encodeFrame,
  type CommandId,
  type NetworkMessage,
  type PlayerId,
  type PlayerName,
  type WireText,
  type WorldId,
} from '@nerima-games/mx-multiplayer'
import { Either } from 'effect'
import { describe, expect, it } from 'vitest'

import {
  makeMultiplayerServerCore,
  type MultiplayerServerState,
  type ReceiveResult,
} from '../../apps/multiplayer-server/core'
import { decodeSleepWireMessage } from '../../apps/web/sleep-network'

const playerId = (value: string): PlayerId => value as PlayerId
const playerName = (value: string): PlayerName => value as PlayerName
const worldId = (value: string): WorldId => value as WorldId
const commandId = (value: string): CommandId => value as CommandId

const frame = (message: NetworkMessage): WireText => {
  const encoded = encodeFrame(message)
  if (Either.isLeft(encoded)) throw encoded.left
  return encoded.right
}

const messages = (frames: ReadonlyArray<WireText>): ReadonlyArray<NetworkMessage> =>
  frames.filter((wire) => decodeSleepWireMessage(wire) === undefined).map((wire) => {
    const decoded = decodeFrame(wire)
    if (Either.isLeft(decoded)) throw decoded.left
    return decoded.right
  })

const initialState = (): MultiplayerServerState => ({
  revision: 4,
  blocks: [],
  inventories: [{
    player: playerId('alice'),
    state: {
      slots: [
        { item: 'stone', count: 5 },
        { item: 'coal', count: 3 },
        null,
      ],
      selectedSlot: 0,
    },
  }],
  vitals: [{ player: playerId('alice'), state: { health: 3, hunger: 2, experience: 7 } }],
  timeWeather: { timeOfDay: 6_000, weather: 'clear' },
  containers: [{ containerId: 'chest-1', slots: [null, { item: 'apple', count: 2 }] }],
  furnaces: [{
    furnaceId: 'furnace-1',
    input: null,
    fuel: null,
    output: { item: 'iron-ingot', count: 2 },
    burnTicksRemaining: 0,
    cookTicks: 0,
  }],
  villagerTrades: [],
})

const makeFixture = (state: MultiplayerServerState = initialState()) => {
  const sent: Array<WireText> = []
  const persisted: Array<MultiplayerServerState> = []
  const server = makeMultiplayerServerCore({
    worldId: 'world-1',
    seed: 42,
    allowedBlocks: new Set(['stone']),
    initialState: state,
    onStateChanged: (state) => persisted.push(state),
  })
  expect(server.connect('socket-a', (wire) => sent.push(wire))).toBe(true)
  const receive = (message: NetworkMessage): ReceiveResult => server.receive('socket-a', frame(message))
  expect(receive({
    _tag: 'PlayerJoin',
    player: playerId('alice'),
    name: playerName('Alice'),
    at: { x: 0, y: 64, z: 0 },
  }).accepted).toBe(true)
  return { sent, persisted, receive, server }
}

describe('multiplayer server authoritative state', () => {
  it('sends authoritative state on join and explicit resync', () => {
    const fixture = makeFixture()
    expect(messages(fixture.sent)[1]).toMatchObject({
      _tag: 'AuthoritativeSnapshot',
      world: 'world-1',
      revision: 4,
      inventories: [{ player: 'alice', state: { selectedSlot: 0 } }],
      vitals: [{ player: 'alice', state: { health: 3, hunger: 2, experience: 7 } }],
      timeWeather: { timeOfDay: 6_000, weather: 'clear' },
      containers: [{ containerId: 'chest-1' }],
      furnaces: [{ furnaceId: 'furnace-1' }],
    })

    fixture.sent.length = 0
    expect(fixture.receive({
      _tag: 'AuthoritativeResyncRequest',
      world: worldId('world-1'),
      lastKnownRevision: 1,
    }).accepted).toBe(true)
    expect(messages(fixture.sent)).toEqual([
      expect.objectContaining({ _tag: 'AuthoritativeSnapshot', revision: 4 }),
    ])
  })

  it('applies inventory and vitals commands once and rejects stale revisions', () => {
    const fixture = makeFixture()
    fixture.sent.length = 0
    const inventoryCommand: NetworkMessage = {
      _tag: 'PlayerInventoryCommand',
      commandId: commandId('inventory-1'),
      player: playerId('alice'),
      world: worldId('world-1'),
      expectedRevision: 4,
      action: { _tag: 'move-item', source: 0, destination: 2, count: 2 },
    }

    expect(fixture.receive(inventoryCommand).accepted).toBe(true)
    expect(messages(fixture.sent)).toEqual([
      expect.objectContaining({ _tag: 'AuthoritativeCommandAccepted', commandId: 'inventory-1', revision: 5 }),
      expect.objectContaining({
        _tag: 'PlayerInventoryDelta',
        revision: 5,
        state: expect.objectContaining({
          slots: [{ item: 'stone', count: 3 }, { item: 'coal', count: 3 }, { item: 'stone', count: 2 }],
        }),
      }),
    ])
    expect(fixture.persisted).toHaveLength(1)

    fixture.sent.length = 0
    expect(fixture.receive(inventoryCommand).accepted).toBe(true)
    expect(messages(fixture.sent)).toEqual([
      expect.objectContaining({ _tag: 'AuthoritativeCommandAccepted', commandId: 'inventory-1', revision: 5 }),
    ])
    expect(fixture.persisted).toHaveLength(1)

    fixture.sent.length = 0
    const staleCommand: NetworkMessage = {
      _tag: 'PlayerVitalsCommand',
      commandId: commandId('vitals-stale'),
      player: playerId('alice'),
      world: worldId('world-1'),
      expectedRevision: 4,
      action: 'respawn',
    }
    expect(fixture.receive(staleCommand)).toEqual({ accepted: false, reason: 'invalid-command' })
    expect(messages(fixture.sent)).toEqual([
      expect.objectContaining({
        _tag: 'AuthoritativeCommandRejected',
        commandId: 'vitals-stale',
        revision: 5,
        reason: 'stale-revision',
        resyncRequired: true,
      }),
    ])

    fixture.sent.length = 0
    const vitalsCommand: NetworkMessage = { ...staleCommand, commandId: commandId('vitals-1'), expectedRevision: 5 }
    expect(fixture.receive(vitalsCommand).accepted).toBe(true)
    expect(messages(fixture.sent)).toEqual([
      expect.objectContaining({ _tag: 'AuthoritativeCommandAccepted', revision: 6 }),
      expect.objectContaining({
        _tag: 'PlayerVitalsDelta',
        revision: 6,
        state: { health: 20, hunger: 20, experience: 0 },
      }),
    ])
  })

  it('uses hunger authority for activity ticks and preserves state across rejoin', () => {
    const fixture = makeFixture()
    fixture.sent.length = 0
    expect(fixture.receive({
      _tag: 'PlayerVitalsCommand',
      commandId: commandId('activity-1'),
      player: playerId('alice'),
      world: worldId('world-1'),
      expectedRevision: 4,
      action: { _tag: 'activity', activity: 'jump', amount: 100 },
    }).accepted).toBe(true)
    fixture.sent.length = 0
    fixture.server.tick(2_000)
    expect(messages(fixture.sent)).toEqual([])
    fixture.server.tick(2_000)
    expect(messages(fixture.sent)).toEqual([
      expect.objectContaining({
        _tag: 'PlayerVitalsDelta',
        revision: 6,
        player: 'alice',
        state: { health: 3, hunger: 2, experience: 7 },
      }),
    ])

    fixture.server.disconnect('socket-a')
    fixture.sent.length = 0
    expect(fixture.server.connect('socket-b', (wire) => fixture.sent.push(wire))).toBe(true)
    expect(fixture.server.receive('socket-b', frame({
      _tag: 'PlayerJoin',
      player: playerId('alice'),
      name: playerName('Alice'),
      at: { x: 0, y: 64, z: 0 },
    })).accepted).toBe(true)
    expect(messages(fixture.sent)).toContainEqual(expect.objectContaining({
      _tag: 'AuthoritativeSnapshot',
      revision: 6,
      vitals: [{ player: 'alice', state: { health: 3, hunger: 2, experience: 7 } }],
    }))
  })

  it('consumes food and broadcasts inventory and vitals deltas atomically', () => {
    const state = initialState()
    const fixture = makeFixture({
      ...state,
      inventories: [{
        player: playerId('alice'),
        state: { slots: [...state.inventories[0]!.state.slots, { item: 'potato', count: 2 }], selectedSlot: 0 },
      }],
    })
    fixture.sent.length = 0
    expect(fixture.receive({
      _tag: 'PlayerVitalsCommand',
      commandId: commandId('eat-1'),
      player: playerId('alice'),
      world: worldId('world-1'),
      expectedRevision: 4,
      action: { _tag: 'eat', item: 'potato' },
    }).accepted).toBe(true)
    expect(messages(fixture.sent)).toEqual([
      expect.objectContaining({ _tag: 'AuthoritativeCommandAccepted', revision: 5 }),
      expect.objectContaining({ _tag: 'PlayerVitalsDelta', revision: 5, state: { health: 3, hunger: 3, experience: 7 } }),
      expect.objectContaining({
        _tag: 'PlayerInventoryDelta',
        revision: 5,
        state: expect.objectContaining({ slots: expect.arrayContaining([{ item: 'potato', count: 1 }]) }),
      }),
    ])
  })

  it('authoritatively updates time, containers, furnaces, and persistent state', () => {
    const fixture = makeFixture()
    fixture.sent.length = 0

    expect(fixture.receive({
      _tag: 'WorldTimeWeatherCommand',
      commandId: commandId('weather-1'),
      player: playerId('alice'),
      world: worldId('world-1'),
      expectedRevision: 4,
      action: { _tag: 'set-weather', weather: 'rain' },
    }).accepted).toBe(true)
    expect(fixture.receive({
      _tag: 'ContainerCommand',
      commandId: commandId('container-1'),
      player: playerId('alice'),
      world: worldId('world-1'),
      expectedRevision: 5,
      containerId: 'chest-1',
      action: {
        _tag: 'move-item',
        source: { _tag: 'player-slot', slot: 0 },
        destination: { _tag: 'container-slot', slot: 0 },
        count: 2,
      },
    }).accepted).toBe(true)
    expect(fixture.receive({
      _tag: 'FurnaceCommand',
      commandId: commandId('furnace-fuel-1'),
      player: playerId('alice'),
      world: worldId('world-1'),
      expectedRevision: 6,
      furnaceId: 'furnace-1',
      action: {
        _tag: 'move-item',
        source: { _tag: 'player-slot', slot: 1 },
        destination: { _tag: 'furnace-slot', slot: 'fuel' },
        count: 1,
      },
    }).accepted).toBe(true)
    expect(fixture.receive({
      _tag: 'FurnaceCommand',
      commandId: commandId('furnace-output-1'),
      player: playerId('alice'),
      world: worldId('world-1'),
      expectedRevision: 7,
      furnaceId: 'furnace-1',
      action: {
        _tag: 'take-output',
        source: { _tag: 'furnace-slot', slot: 'output' },
        destination: { _tag: 'player-slot', slot: 2 },
        count: 1,
      },
    }).accepted).toBe(true)

    const output = messages(fixture.sent)
    expect(output).toContainEqual(expect.objectContaining({
      _tag: 'ContainerDelta',
      revision: 6,
      state: { containerId: 'chest-1', slots: [{ item: 'stone', count: 2 }, { item: 'apple', count: 2 }] },
    }))
    expect(output).toContainEqual(expect.objectContaining({
      _tag: 'FurnaceDelta',
      revision: 8,
      state: expect.objectContaining({ fuel: { item: 'coal', count: 1 }, output: { item: 'iron-ingot', count: 1 } }),
    }))
    expect(fixture.persisted.at(-1)).toMatchObject({
      revision: 8,
      timeWeather: { timeOfDay: 6_000, weather: 'rain' },
      inventories: [{
        player: 'alice',
        state: { slots: [{ item: 'stone', count: 3 }, { item: 'coal', count: 2 }, { item: 'iron-ingot', count: 1 }] },
      }],
      containers: [{ containerId: 'chest-1', slots: [{ item: 'stone', count: 2 }, { item: 'apple', count: 2 }] }],
      furnaces: [{ furnaceId: 'furnace-1', fuel: { item: 'coal', count: 1 }, output: { item: 'iron-ingot', count: 1 } }],
    })
  })

  it('rejects unauthorized and missing-resource commands without advancing revision', () => {
    const fixture = makeFixture()
    fixture.sent.length = 0
    expect(fixture.receive({
      _tag: 'PlayerInventoryCommand',
      commandId: commandId('spoof-1'),
      player: playerId('bob'),
      world: worldId('world-1'),
      expectedRevision: 4,
      action: { _tag: 'select-slot', slot: 0 },
    })).toEqual({ accepted: false, reason: 'identity-spoof' })
    expect(fixture.receive({
      _tag: 'ContainerCommand',
      commandId: commandId('missing-1'),
      player: playerId('alice'),
      world: worldId('world-1'),
      expectedRevision: 4,
      containerId: 'missing',
      action: { _tag: 'open' },
    })).toEqual({ accepted: false, reason: 'invalid-command' })

    expect(messages(fixture.sent)).toEqual([
      expect.objectContaining({
        _tag: 'AuthoritativeCommandRejected',
        reason: 'unauthorized-player',
        revision: 4,
        resyncRequired: false,
      }),
      expect.objectContaining({
        _tag: 'AuthoritativeCommandRejected',
        reason: 'resource-not-found',
        revision: 4,
        resyncRequired: false,
      }),
    ])
    expect(fixture.persisted).toEqual([])
  })
})
